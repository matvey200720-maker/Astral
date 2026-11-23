//! Векторная карта радара: 65 плиток `minimap_R_C.ydd` в `levels/gta5/minimap.rpf`
//! внутри `x64e.rpf`. Цвет вершины говорит, что это (вода, суша, дороги…).
//! Три команды: палитра плиток, перекраска и дописывание слоёв окна
//! (`paint-minimap-tiles`, игровые архивы не меняются) и осмотр готовых `.ydd`.

use std::{
    cmp::Reverse,
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use rage_res::{
    drawable::{self, FileKind},
    drawable_write::{self, Shape},
    hash::sha256_hex,
    resource_graph::{self, Graph},
    Resource,
};
use rage_rpf::{Archive, EntryId, EntryKind, KeySet};
use serde_json::{Map, Value};

use super::{
    radar_overlay::{self, Appended, Overlay, TileBox},
    shop::write_atomic,
    Command,
};
use crate::{
    archives::{game_root, load_keys, textures::archive_search_order},
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Архив, в котором лежат плитки.
const TILE_ARCHIVE: &str = "x64e.rpf";
/// Каталог плиток внутри архива: три звена перед именем файла.
const TILE_FOLDER: [&str; 3] = ["levels", "gta5", "minimap.rpf"];
const MAX_TILES: usize = 256;
const MAX_PALETTE: usize = 512;
/// Глубже этого каталоги вложенных архивов не раскрываются.
const DEPTH_LIMIT: usize = 6;
/// Плитка крупнее этого в выдачу не попадает.
const TILE_SIZE_LIMIT: usize = 16 * 1024 * 1024;

/// Ответ-объект: ключи ложатся в порядке вызовов `with`.
#[derive(Default)]
struct Reply(Map<String, Value>);

impl Reply {
    fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.0.insert(key.to_owned(), value.into());
        self
    }

    fn done(self) -> Value {
        Value::Object(self.0)
    }
}

/// Чем кончаются поиск плиток, разбор пар цветов, перекраска и осмотр.
#[derive(Debug, PartialEq, Eq)]
enum Fault {
    NoTiles,
    NoColours,
    TooManyColours(usize),
    NothingAsked,
    TooManyPairs,
    PairShape,
    PairInvalid(String),
    Partial,
    Resized(String),
    Misplaced(String),
    Stray(String),
    NoInputs,
    TooManyInputs,
}

impl Fault {
    /// Сколько плиток дано на осмотр: от одной до двухсот пятидесяти шести.
    fn check_inputs(count: usize) -> std::result::Result<(), Fault> {
        match count {
            0 => Err(Fault::NoInputs),
            many if many > MAX_TILES => Err(Fault::TooManyInputs),
            _ => Ok(()),
        }
    }

    /// Текст отказа, как он уходит в ответ.
    fn words(&self) -> String {
        let fixed = match self {
            Fault::NoTiles => {
                "Векторные плитки радара (levels/gta5/minimap.rpf) не найдены в архивах игры."
            }
            Fault::NoColours => "В векторных плитках радара нет цвета в вершинах.",
            Fault::NothingAsked => "Не передано ни одной пары цветов и ни одного слоя.",
            Fault::TooManyPairs => "Слишком много цветов в одном запросе.",
            Fault::PairShape => "Цвет задаётся как RRGGBBAA=RRGGBBAA.",
            Fault::Partial => "Плитка распаковалась не полностью: пока на хосте.",
            Fault::NoInputs => "Не передано ни одной плитки.",
            Fault::TooManyInputs => "Слишком много плиток для осмотра.",
            Fault::TooManyColours(count) => {
                return format!(
                    "В векторных плитках радара {count} цветов — это не карта Rockstar."
                )
            }
            Fault::PairInvalid(raw) => return format!("Недопустимая пара цветов: {raw}"),
            Fault::Resized(name) => return format!("Плитка {name} изменила размер данных."),
            Fault::Misplaced(name) => return format!("Плитка {name}: цвет не лёг на место."),
            Fault::Stray(name) => {
                return format!("Плитка {name} изменилась не в местах перекраски.")
            }
        };
        fixed.to_owned()
    }
}

impl From<Fault> for EngineError {
    fn from(fault: Fault) -> Self {
        let text = fault.words();
        match fault {
            Fault::NoTiles => EngineError::file_not_found(text),
            Fault::Partial | Fault::NoInputs | Fault::TooManyInputs => EngineError::argument(text),
            _ => EngineError::invalid_data(text),
        }
    }
}

/// Четыре байта цвета как восемь заглавных шестнадцатеричных цифр, в порядке байтов буфера.
fn colour_text(colour: [u8; 4]) -> String {
    colour.map(|byte| format!("{byte:02X}")).concat()
}

/// Файл плитки: `minimap_<цифры>_<цифры>.ydd`, имя уже в нижнем регистре.
fn is_tile_file(name: &str) -> bool {
    let core = name
        .strip_prefix("minimap_")
        .and_then(|rest| rest.strip_suffix(".ydd"));
    let Some((row, column)) = core.and_then(|core| core.split_once('_')) else {
        return false;
    };
    [row, column]
        .iter()
        .all(|part| part.bytes().all(|byte| byte.is_ascii_digit()) && !part.is_empty())
}

/// Путь записи подходит под плитку: каталог `levels/gta5/minimap.rpf` (регистр не важен), перед ним что угодно
/// по границе звена, а сам файл — `minimap_<цифры>_<цифры>.ydd`.
fn tile_path_matches(path: &str) -> bool {
    let mut backwards = path.rsplit('/').map(str::to_lowercase);
    backwards.next().is_some_and(|file| is_tile_file(&file))
        && TILE_FOLDER
            .iter()
            .rev()
            .all(|want| backwards.next().as_deref() == Some(*want))
}

/// Плитка, найденная в архиве игры.
struct FoundTile {
    archive: String,
    path: String,
    name: String,
    bytes: Vec<u8>,
}

/// Файл плитки, открытый для дописывания: граф ресурса и форма до правок.
struct Draft {
    graph: Graph,
    before: Shape,
}

impl Draft {
    fn open(bytes: &[u8]) -> Result<Self> {
        let graph = drawable_write::graph_of(bytes)?;
        let before = drawable_write::shape(&graph)?;
        Ok(Draft { graph, before })
    }

    /// Собирает файл, проверяет размер и сверяет перечитанное с дописанным.
    fn seal(self, appended: &Appended) -> Result<Vec<u8>> {
        let bytes = drawable_write::finish(&self.graph)?;
        radar_overlay::check_tile_size(&bytes)?;
        let reread = drawable_write::graph_of(&bytes)?;
        radar_overlay::verify_appended(&reread, self.before, appended)?;
        Ok(bytes)
    }
}

/// Все вершинные цвета плитки и место каждого в данных ресурса.
fn colour_slots(resource: &Resource) -> Result<Vec<(usize, [u8; 4])>> {
    let mut seen = Vec::new();
    for entry in &drawable::open_model(resource, Some(FileKind::Ydd))?.entries {
        drawable::for_each_vertex_colour_slot(resource, entry.at, |at, colour| {
            seen.push((at, colour))
        })?;
    }
    Ok(seen)
}

impl FoundTile {
    fn folder(&self) -> &str {
        self.path.rsplit_once('/').map_or("", |(folder, _)| folder)
    }

    /// Рамка плитки в мире; `None` — у плитки её нет.
    fn bounds(&self) -> Result<Option<TileBox>> {
        let graph = drawable_write::graph_of(&self.bytes)?;
        Ok(drawable_write::tile_bounds(&graph)?.map(TileBox::from_bounds))
    }

    /// Дописывает слои в `current` (байты плитки, возможно уже перекрашенные). Рисовалка суши берётся у исходной
    /// плитки. `None` — у плитки нет суши.
    fn lay(
        &self,
        current: &[u8],
        layer: &Overlay,
        list: &[usize],
    ) -> Result<Option<(Vec<u8>, Appended)>> {
        let land = drawable_write::land_drawable(&drawable_write::graph_of(&self.bytes)?)?;
        let mut draft = Draft::open(current)?;
        radar_overlay::append_tile(&mut draft.graph, land, layer, list)?
            .map(|summary| -> Result<_> { Ok((draft.seal(&summary)?, summary)) })
            .transpose()
    }

    /// Плитка после перекраски и дописывания слоёв.
    fn render(&self, brief: &Brief, list: Option<&[usize]>) -> Result<Rendered> {
        let mut plan = Repaint::plan(&self.bytes, brief)?;
        let repainted = plan.places.len();
        let mut done = Rendered {
            bytes: (repainted > 0)
                .then(|| plan.apply(&self.name))
                .transpose()?,
            vertices: plan.vertices,
            repainted,
            laid: None,
            no_land: 0,
        };
        let wanted = brief
            .layer
            .as_ref()
            .zip(list.filter(|queue| !queue.is_empty()));
        if let Some((layer, queue)) = wanted {
            let current = done.bytes.as_deref().unwrap_or(&self.bytes);
            match self.lay(current, layer, queue)? {
                Some((laid, summary)) => {
                    done.bytes = Some(laid);
                    done.laid = Some(summary);
                }
                None => done.no_land = queue.len(),
            }
        }
        Ok(done)
    }
}

/// Что дала перекраска плитки: число вершин цвета, места замены и разобранный ресурс.
struct Repaint {
    vertices: usize,
    places: Vec<(usize, [u8; 4])>,
    resource: Resource,
}

impl Repaint {
    /// Разбор плитки, число её вершин с цветом и места, где цвет надо заменить по таблице.
    fn plan(bytes: &[u8], brief: &Brief) -> Result<Self> {
        let resource = Resource::parse(bytes)?;
        if !resource.complete {
            return Err(Fault::Partial.into());
        }
        let slots = colour_slots(&resource)?;
        let places = slots
            .iter()
            .filter_map(|&(at, colour)| {
                brief
                    .table
                    .get(&colour)
                    .filter(|&&target| target != colour)
                    .map(|&target| (at, target))
            })
            .collect();
        Ok(Repaint {
            vertices: slots.len(),
            places,
            resource,
        })
    }

    /// Новые цвета ложатся в данные ресурса, файл собирается и сверяется перечитыванием.
    fn apply(&mut self, name: &str) -> Result<Vec<u8>> {
        for &(at, colour) in &self.places {
            self.resource.data_mut()[at..at + 4].copy_from_slice(&colour);
        }
        let written = self.resource.to_file_bytes()?;
        let again = Resource::parse(&written)?;
        let (expected, got) = (self.resource.data(), again.data());
        // Проверки идут по порядку, и каждая смотрится, только если прежние прошли.
        let verdict = if got.len() != expected.len() {
            Some(Fault::Resized(name.to_owned()))
        } else if self
            .places
            .iter()
            .any(|&(at, colour)| got[at..at + 4] != colour)
        {
            Some(Fault::Misplaced(name.to_owned()))
        } else if got != expected {
            Some(Fault::Stray(name.to_owned()))
        } else {
            None
        };
        verdict.map_or(Ok(written), |why| Err(why.into()))
    }
}

/// Готовая плитка и всё, что о ней надо записать в ответ.
struct Rendered {
    /// `None` — плитка не изменилась и в вывод не идёт.
    bytes: Option<Vec<u8>>,
    vertices: usize,
    repainted: usize,
    laid: Option<Appended>,
    /// Сколько треугольников ждали эту плитку, но суши у неё нет.
    no_land: usize,
}

/// Шаг обхода одного архива.
enum Step {
    Folder {
        id: EntryId,
        base: String,
        level: usize,
    },
    File {
        id: EntryId,
        base: String,
        level: usize,
    },
}

/// Чем кончился осмотр одного файла.
enum Glance {
    Tile(FoundTile),
    Inside(Frame),
    Passed,
    /// Запись плитки не прочиталась: путь и причина для журнала.
    Unreadable(String),
}

/// Открытый архив и очередь его дел; дела берутся с конца, поэтому кладутся в обратном порядке.
struct Frame {
    archive: Archive,
    queue: Vec<Step>,
}

impl Frame {
    fn starting_at(archive: Archive, base: String, level: usize) -> Self {
        let id = archive.root();
        Frame {
            archive,
            queue: vec![Step::Folder { id, base, level }],
        }
    }

    /// Подкаталоги уходят вглубь очереди, файлы встают сверху и выходят первыми.
    fn open_folder(&mut self, id: EntryId, base: &str, level: usize) {
        let folders = self.archive.dirs(id).iter().rev().map(|&sub| Step::Folder {
            id: sub,
            base: format!("{base}{}/", self.archive.entry(sub).name),
            level: level + 1,
        });
        let files = self.archive.files(id).iter().rev().map(|&file| Step::File {
            id: file,
            base: base.to_owned(),
            level,
        });
        self.queue.extend(folders.chain(files));
    }

    fn glance(&self, id: EntryId, base: &str, level: usize, label: &str) -> Glance {
        let entry = self.archive.entry(id);
        let path = format!("{base}{}", entry.name);
        let nested = Archive::is_nested_archive_name(&entry.name)
            && matches!(entry.kind, EntryKind::Binary(_));
        if nested {
            // Чужой или повреждённый вложенный архив обход остальных не отменяет.
            return match self.archive.open_nested(id) {
                Ok(inner) => {
                    Glance::Inside(Frame::starting_at(inner, format!("{path}/"), level + 1))
                }
                Err(_) => Glance::Passed,
            };
        }
        if !tile_path_matches(&path) {
            return Glance::Passed;
        }
        match self.archive.export(id) {
            Err(error) => Glance::Unreadable(format!("{path}: {error}")),
            Ok(bytes) if (1..=TILE_SIZE_LIMIT).contains(&bytes.len()) => Glance::Tile(FoundTile {
                archive: label.to_owned(),
                path,
                name: entry.name.clone(),
                bytes,
            }),
            Ok(_) => Glance::Passed,
        }
    }
}

/// Ленивый обход архива плиток: файлы каталога по порядку, затем его подкаталоги, вложенные `.rpf` — на месте.
/// Нечитаемая запись пропускается, обход идёт дальше; пропущенные записи (путь и причина) копятся в `skipped`.
struct TileWalk {
    label: String,
    frames: Vec<Frame>,
    skipped: Vec<String>,
}

impl TileWalk {
    fn over(archive: Archive, label: &str) -> Self {
        TileWalk {
            label: label.to_owned(),
            frames: vec![Frame::starting_at(archive, String::new(), 0)],
            skipped: Vec::new(),
        }
    }
}

impl Iterator for TileWalk {
    type Item = FoundTile;

    fn next(&mut self) -> Option<FoundTile> {
        loop {
            let frame = self.frames.last_mut()?;
            let Some(step) = frame.queue.pop() else {
                self.frames.pop();
                continue;
            };
            match step {
                Step::Folder { id, base, level } if level <= DEPTH_LIMIT => {
                    frame.open_folder(id, &base, level)
                }
                Step::Folder { .. } => {}
                Step::File { id, base, level } => {
                    match frame.glance(id, &base, level, &self.label) {
                        Glance::Tile(found) => return Some(found),
                        Glance::Inside(inner) => self.frames.push(inner),
                        Glance::Unreadable(note) => self.skipped.push(note),
                        Glance::Passed => {}
                    }
                }
            }
        }
    }
}

/// Строка журнала о пропущенной записи: имя записи и причина.
fn skipped_line(note: &str) -> String {
    format!("minimap: запись не читается и пропущена: {note}")
}

/// Плитки из архива `x64e.rpf` с этим путём поиска; `None` — архив не открылся или в нём плиток нет.
/// Каждая нечитаемая запись даёт одну строку `journal`.
fn tiles_of(
    root: &Path,
    entry: &str,
    keys: &Arc<KeySet>,
    journal: &mut dyn FnMut(&str),
) -> Option<Vec<FoundTile>> {
    let label = entry
        .rsplit('/')
        .next()
        .filter(|last| *last == TILE_ARCHIVE)?;
    let archive = Archive::open_path(&root.join(entry), Some(keys.clone())).ok()?;
    let mut walk = TileWalk::over(archive, label);
    let found: Vec<FoundTile> = walk.by_ref().take(MAX_TILES).collect();
    walk.skipped
        .iter()
        .for_each(|note| journal(&skipped_line(note)));
    Some(found).filter(|tiles| !tiles.is_empty())
}

/// Плитки из первого архива `x64e.rpf`, где они нашлись; строки журнала о пропущенных записях — в `journal`.
fn find_tiles_logged(
    root: &Path,
    keys: &Arc<KeySet>,
    journal: &mut dyn FnMut(&str),
) -> Result<Vec<FoundTile>> {
    archive_search_order(root)
        .iter()
        .find_map(|entry| tiles_of(root, entry, keys, journal))
        .ok_or_else(|| Fault::NoTiles.into())
}

/// То же, а журнал идёт в stdout до итогового JSON (ответом считается последняя строка; прежние
/// команды тоже пишут перед ответом строки журнала, разбор итога их пропускает).
fn find_tiles(root: &Path, keys: &Arc<KeySet>) -> Result<Vec<FoundTile>> {
    find_tiles_logged(root, keys, &mut |line| println!("{line}"))
}

/// Ответная запись об источнике плиток.
fn source_json(first: &FoundTile) -> Value {
    Reply::default()
        .with("archive", first.archive.as_str())
        .with("entry", first.folder())
        .done()
}

/// Счёт цветов в порядке первой встречи.
#[derive(Default)]
struct Palette {
    order: Vec<([u8; 4], u64)>,
    slot_of: HashMap<[u8; 4], usize>,
    total: u64,
}

impl Palette {
    /// Палитра всех плиток: цвета от частых к редким; пустая или слишком пёстрая — отказ.
    fn of(tiles: &[FoundTile]) -> Result<Self> {
        let mut palette = Palette::default();
        for tile in tiles {
            palette.absorb_tile(tile)?;
        }
        match palette.order.len() {
            0 => return Err(Fault::NoColours.into()),
            count if count > MAX_PALETTE => return Err(Fault::TooManyColours(count).into()),
            _ => {}
        }
        palette.order.sort_by_key(|&(_, seen)| Reverse(seen));
        Ok(palette)
    }

    fn add(&mut self, colour: [u8; 4]) {
        self.total += 1;
        match self.slot_of.get(&colour) {
            Some(&slot) => self.order[slot].1 += 1,
            None => {
                self.slot_of.insert(colour, self.order.len());
                self.order.push((colour, 1));
            }
        }
    }

    fn absorb_tile(&mut self, tile: &FoundTile) -> Result<()> {
        let resource = Resource::parse(&tile.bytes)?;
        for entry in &drawable::open_model(&resource, Some(FileKind::Ydd))?.entries {
            drawable::for_each_vertex_colour(&resource, entry.at, |colour| self.add(colour))?;
        }
        Ok(())
    }

    fn describe(&self, tiles: &[FoundTile]) -> Value {
        let colours: Vec<Value> = self
            .order
            .iter()
            .map(|&(colour, count)| {
                Reply::default()
                    .with("rgba", colour_text(colour))
                    .with("vertices", count)
                    .done()
            })
            .collect();
        Reply::default()
            .with("tiles", tiles.len())
            .with("vertices", self.total)
            .with("source", source_json(&tiles[0]))
            .with("colours", colours)
            .done()
    }
}

pub fn minimap_tile_colours(options: &Options, _progress: &Progress) -> Result<Value> {
    game_root(options).and_then(|root| {
        let (keys, key_source) = load_keys(&root.to_string_lossy(), options.optional("keys"))?;
        let tiles = find_tiles(&root, &keys)?;
        let palette = Palette::of(&tiles)?;
        Ok(Reply::default()
            .with("keySource", key_source)
            .with("radar", palette.describe(&tiles))
            .done())
    })
}

const MINIMAP_TILE_COLOURS: Command = Command::new("minimap-tile-colours", minimap_tile_colours);

/// Цвет из ровно восьми шестнадцатеричных цифр любого регистра.
fn colour_from_hex(text: &str) -> Option<[u8; 4]> {
    let digits = <[u8; 8]>::try_from(text.as_bytes()).ok()?;
    let mut pairs = digits.chunks_exact(2).map(|pair| {
        let high = char::from(pair[0]).to_digit(16)?;
        let low = char::from(pair[1]).to_digit(16)?;
        u8::try_from(high * 16 + low).ok()
    });
    Some([
        pairs.next()??,
        pairs.next()??,
        pairs.next()??,
        pairs.next()??,
    ])
}

/// Пара `--colour` «из=в»: первый знак `=` делит, части обрезаются.
fn colour_pair(raw: &str) -> Result<([u8; 4], [u8; 4])> {
    let Some((from, to)) = raw.split_once('=').filter(|_| !raw.starts_with('=')) else {
        return Err(Fault::PairShape.into());
    };
    colour_from_hex(from.trim())
        .zip(colour_from_hex(to.trim()))
        .ok_or_else(|| Fault::PairInvalid(raw.to_owned()).into())
}

/// Таблица замен: у одного «из» побеждает последняя пара.
fn colour_table(options: &Options) -> Result<HashMap<[u8; 4], [u8; 4]>> {
    options
        .values("colour")
        .iter()
        .map(|raw| colour_pair(raw))
        .collect()
}

/// Файл слоёв `.aro`, прочитанный и разобранный.
fn load_overlay(raw: &str) -> Result<Overlay> {
    let file = paths::existing_file(raw, &[".aro"])?;
    radar_overlay::read_overlay(&std::fs::read(file)?)
}

/// Куда легли треугольники слоёв: списки по плиткам и число улетевших за край карты.
struct Routing {
    lists: Vec<Vec<usize>>,
    outside: usize,
}

/// Где игра, куда писать и чем её читать.
struct Workspace {
    root: PathBuf,
    output: PathBuf,
    keys: Arc<KeySet>,
    key_source: &'static str,
}

impl Workspace {
    fn read(options: &Options) -> Result<Self> {
        let root = game_root(options)?;
        let output = paths::full_path(options.required("output")?)?;
        let loaded = load_keys(&root.to_string_lossy(), options.optional("keys"))?;
        Ok(Workspace {
            root,
            output,
            keys: loaded.0,
            key_source: loaded.1,
        })
    }
}

/// Всё, что `paint-minimap-tiles` узнаёт из командной строки до работы с архивами.
struct Brief {
    work: Workspace,
    table: HashMap<[u8; 4], [u8; 4]>,
    layer: Option<Overlay>,
}

impl Brief {
    fn read(options: &Options) -> Result<Self> {
        let work = Workspace::read(options)?;
        let table = colour_table(options)?;
        let overlays = options
            .values("overlay")
            .iter()
            .map(|raw| load_overlay(raw))
            .collect::<Result<Vec<_>>>()?;
        if table.is_empty() && overlays.is_empty() {
            return Err(Fault::NothingAsked.into());
        }
        if table.len() > MAX_PALETTE {
            return Err(Fault::TooManyPairs.into());
        }
        let layer = if overlays.is_empty() {
            None
        } else {
            Some(radar_overlay::merge(overlays)?)
        };
        Ok(Brief { work, table, layer })
    }

    /// Раскладка слоёв по плиткам, если слои заданы.
    fn route(&self, tiles: &[FoundTile]) -> Result<Option<Routing>> {
        let Some(layer) = self.layer.as_ref() else {
            return Ok(None);
        };
        let boxes = tiles
            .iter()
            .map(FoundTile::bounds)
            .collect::<Result<Vec<_>>>()?;
        let (lists, outside) = radar_overlay::route(layer, &boxes);
        Ok(Some(Routing { lists, outside }))
    }
}

/// Итоги по слоям на всей карте.
#[derive(Default)]
struct LayerTotals {
    tiles: usize,
    vertices: usize,
    geometries: usize,
    written: usize,
    no_land: usize,
}

impl LayerTotals {
    fn count(&mut self, summary: &Appended) {
        self.tiles += 1;
        self.vertices += summary.vertices;
        self.geometries += summary.geometries.len();
        self.written += summary.triangles;
    }

    /// Раздел `overlay` ответа: `listed` — сумма длин списков по плиткам, `outside` — треугольники за краем.
    fn describe(&self, triangles: usize, listed: usize, outside: usize) -> Value {
        let dropped = Reply::default()
            .with("outside", outside)
            .with("noLand", self.no_land)
            .done();
        Reply::default()
            .with("triangles", triangles)
            .with("routed", listed - self.no_land)
            .with("tiles", self.tiles)
            .with("vertices", self.vertices)
            .with("geometries", self.geometries)
            .with("written", self.written)
            .with("dropped", dropped)
            .done()
    }
}

/// Строка плитки о дописанных слоях.
fn laid_row(summary: &Appended) -> Value {
    Reply::default()
        .with("triangles", summary.triangles)
        .with("vertices", summary.vertices)
        .with("geometries", summary.geometries.len())
        .done()
}

/// Накопленное по плиткам: записанные строки, число перекрашенных мест и итоги по слоям.
#[derive(Default)]
struct Campaign {
    rows: Vec<Value>,
    repainted: usize,
    layers: LayerTotals,
}

impl Campaign {
    /// Готовая плитка: учёт слоёв, затем файл в папку вывода и строка ответа, если плитка изменилась.
    fn file(&mut self, brief: &Brief, tile: &FoundTile, done: Rendered) -> Result<()> {
        self.layers.no_land += done.no_land;
        let overlay = done.laid.as_ref().map_or(Value::Null, |summary| {
            self.layers.count(summary);
            laid_row(summary)
        });
        let Some(bytes) = done.bytes else {
            return Ok(());
        };
        write_atomic(&brief.work.output.join(&tile.name), &bytes)?;
        self.repainted += done.repainted;
        self.rows.push(
            Reply::default()
                .with("file", tile.name.as_str())
                .with("archive", tile.archive.as_str())
                .with("entry", tile.path.as_str())
                .with("vertices", done.vertices)
                .with("repainted", done.repainted)
                .with("overlay", overlay)
                .with("bytes", bytes.len())
                .with("sha256", sha256_hex(&bytes))
                .done(),
        );
        Ok(())
    }

    fn report(
        self,
        brief: &Brief,
        source: Value,
        scanned: usize,
        routing: Option<Routing>,
    ) -> Value {
        let overlay = match (brief.layer.as_ref(), routing.as_ref()) {
            (Some(layer), Some(route)) => {
                let listed = route.lists.iter().map(Vec::len).sum();
                self.layers
                    .describe(layer.triangles(), listed, route.outside)
            }
            _ => Value::Null,
        };
        let radar = Reply::default()
            .with("output", brief.work.output.to_string_lossy().into_owned())
            .with("count", self.rows.len())
            .with("skipped", scanned - self.rows.len())
            .with("repainted", self.repainted)
            .with("source", source)
            .with("overlay", overlay)
            .with("tiles", self.rows)
            .done();
        Reply::default()
            .with("keySource", brief.work.key_source)
            .with("radar", radar)
            .done()
    }
}

pub fn paint_minimap_tiles(options: &Options, _progress: &Progress) -> Result<Value> {
    Brief::read(options).and_then(|brief| {
        std::fs::create_dir_all(&brief.work.output)?;
        let mut tiles = find_tiles(&brief.work.root, &brief.work.keys)?;
        let source = source_json(&tiles[0]);
        tiles.sort_by_cached_key(|tile| tile.name.to_lowercase());
        let routing = brief.route(&tiles)?;
        let lists = routing.as_ref().map(|route| route.lists.as_slice());
        let mut campaign = Campaign::default();
        tiles.iter().enumerate().try_for_each(|(at, tile)| {
            let done = tile.render(&brief, lists.map(|all| all[at].as_slice()))?;
            campaign.file(&brief, tile, done)
        })?;
        Ok(campaign.report(&brief, source, tiles.len(), routing))
    })
}

const PAINT_MINIMAP_TILES: Command = Command::new("paint-minimap-tiles", paint_minimap_tiles);

/// Осмотр одного готового `.ydd`.
fn inspect_one(raw: &str) -> Result<Value> {
    paths::existing_file(raw, &[".ydd"]).and_then(|path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        let bytes = std::fs::read(&path)?;
        let parsed = Resource::parse(&bytes)?;
        let graph = resource_graph::scan(&parsed)?;
        Ok(drawable_write::tile_inspection(&graph, &name, bytes.len())?)
    })
}

fn inspect_minimap_tiles(options: &Options, _progress: &Progress) -> Result<Value> {
    Fault::check_inputs(options.values("input").len())?;
    let tiles = options
        .values("input")
        .iter()
        .map(|raw| inspect_one(raw))
        .collect::<Result<Vec<Value>>>()?;
    Ok(Reply::default()
        .with("count", tiles.len())
        .with("tiles", tiles)
        .done())
}

const INSPECT_MINIMAP_TILES: Command = Command::new("inspect-minimap-tiles", inspect_minimap_tiles);

pub const COMMANDS: &[Command] = &[
    MINIMAP_TILE_COLOURS,
    PAINT_MINIMAP_TILES,
    INSPECT_MINIMAP_TILES,
];

#[cfg(test)]
mod tests;
