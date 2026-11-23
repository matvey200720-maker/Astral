//! `downscale-textures`: варианты текстур игры с меньшими сторонами.
//!
//! Для каждого словаря (`.ytd`) и каждой модели (`.ydr`, `.ydd`) с зашитыми текстурами команда читает запись из
//! архива игры (только чтение) и строит по варианту на каждый предел: отрезает верхние ступени, а если ступеней
//! нет или цепочка не сходится, пересжимает картинку заново. Вариант ложится в `<outputDirectory>/<предел>/<имя>`;
//! необязательные стадии (чёрно-белая, стиль мира) применяются после среза, и папка называется
//! `<предел>+<стадии>`. Модель правится на месте: меняются описания текстур и байты их данных, остальное в файле
//! остаётся как было. Фрагменты `.yft` движок берёт только с `ASTRAL_RUST_DOWNSCALE_YFT=on` (`levels_yft`); без него запись
//! отказывает текстом и остаётся без варианта.
//!
//! Устройство: запрос читается в `Job`, записи группируются по меткам архива, каждая группа открывает свой архив
//! (`Vault`); одна запись проходит через `process_bytes`: контейнер (словарь или модель), пределы по убыванию с
//! накоплением, сборка файла на каждый предел.

use std::collections::{HashMap, HashSet};
use std::{
    fs,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use rage_res::{hash, resource::Resource, texture::Format, ytd_write};
use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind, KeySet};
use serde_json::{Map, Value};

use super::{fresh_dirs::FreshDirs, shop::write_atomic, Command};
use crate::{
    archives,
    args::Options,
    error::{EngineError, Result},
    model_textures, paths,
    progress::Progress,
    texture_levels::{self, Level},
    texture_stages,
};

// ---------------------------------------------------------------------------------------------------------------
// Пределы и таблицы
// ---------------------------------------------------------------------------------------------------------------

mod limits {
    use std::ops::RangeInclusive;

    pub const ITEMS: RangeInclusive<usize> = 1..=120_000;
    pub const CAPS: RangeInclusive<usize> = 4..=4096;
    pub const NAME_CHARS: usize = 5;
    /// Запись архива длиннее этого не читается.
    pub const ENTRY_BYTES: usize = 268_435_456;
    pub const PACK_NAME: RangeInclusive<usize> = 1..=40;
}

mod dlc {
    pub const PREFIX: &str = "update/x64/dlcpacks/";
    pub const SUFFIX: &str = "/dlc.rpf";
}

const PHASE: &str = "prepare";
const KINDS: [&str; 4] = [".ytd", ".ydr", ".ydd", ".yft"];
const YFT_REFUSAL: &str = "downscale-textures: фрагменты .yft ещё не перенесены в движок.";

fn broken_request(text: &str) -> EngineError {
    EngineError::invalid_data(format!("downscale-textures: {text}"))
}

fn not_loaded() -> EngineError {
    EngineError::invalid_data("resource did not load")
}

/// Объект из пар «ключ, значение» в том же порядке.
fn object(pairs: Vec<(&str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<_, _>>(),
    )
}

// ---------------------------------------------------------------------------------------------------------------
// Контейнер записи: словарь или модель
// ---------------------------------------------------------------------------------------------------------------

/// Что внутри записи: словарь текстур или модель с зашитыми текстурами.
enum Container {
    Dictionary,
    Model {
        kind: model_textures::Kind,
        textures: Vec<model_textures::Texture>,
    },
}

/// Описание текстуры для среза: стороны `[ширина, высота, шаг]`, число ступеней, глубина и данные всех ступеней.
fn level_from(
    name: String,
    format: Format,
    sides: [u16; 3],
    (levels, depth): (u8, u16),
    data: Vec<u8>,
) -> Level {
    let [width, height, stride] = sides.map(usize::from);
    let mut level = Level {
        name,
        format,
        width,
        height,
        stride,
        levels: usize::from(levels),
        depth: usize::from(depth),
        data,
    };
    // Данные игры длиннее хостовых на хвост полной цепочки: дальше работа идёт на том, что видит хост.
    texture_levels::as_host_sees(&mut level);
    level
}

fn open_dictionary(bytes: &[u8]) -> Result<(Container, Vec<Level>)> {
    let entries = ytd_write::read_entries(bytes).map_err(|_| not_loaded())?;
    let levels = entries
        .into_iter()
        .map(|entry| {
            let sides = [entry.width, entry.height, entry.stride];
            level_from(
                entry.name,
                entry.format,
                sides,
                (entry.levels, entry.depth),
                entry.payload,
            )
        })
        .collect();
    Ok((Container::Dictionary, levels))
}

/// Текстура модели с её данными из ресурса.
fn level_of(resource: &Resource, texture: &model_textures::Texture) -> Result<Level> {
    let data = resource
        .bytes(texture.data_at, texture.payload_len)?
        .to_vec();
    let sides = [texture.width, texture.height, texture.stride];
    Ok(level_from(
        texture.name.clone(),
        texture.format,
        sides,
        (texture.levels, 1),
        data,
    ))
}

fn open_model(kind: model_textures::Kind, bytes: &[u8]) -> Result<(Container, Vec<Level>)> {
    let resource = Resource::parse(bytes).map_err(|_| not_loaded())?;
    let textures = model_textures::embedded_textures(&resource, kind).map_err(|_| not_loaded())?;
    let mut levels = Vec::with_capacity(textures.len());
    for texture in &textures {
        levels.push(level_of(&resource, texture)?);
    }
    Ok((Container::Model { kind, textures }, levels))
}

fn open_container(kind: &str, bytes: &[u8]) -> Result<(Container, Vec<Level>)> {
    match kind {
        ".ytd" => open_dictionary(bytes),
        ".ydr" => open_model(model_textures::Kind::Ydr, bytes),
        ".ydd" => open_model(model_textures::Kind::Ydd, bytes),
        _ => Err(EngineError::invalid_data(YFT_REFUSAL)),
    }
}

/// Перечитанная модель обязана дать те же текстуры: число, размеры, шаг, ступени, формат и байты.
fn reads_back_as(bytes: &[u8], kind: model_textures::Kind, expected: &[Level]) -> bool {
    let Ok(resource) = Resource::parse(bytes) else {
        return false;
    };
    let Ok(found) = model_textures::embedded_textures(&resource, kind) else {
        return false;
    };
    let shape = |level: &Level| {
        (
            level.width,
            level.height,
            level.stride,
            level.levels,
            level.format,
        )
    };
    found.len() == expected.len()
        && found.iter().zip(expected).all(|(texture, want)| {
            level_of(&resource, texture)
                .is_ok_and(|read| shape(&read) == shape(want) && read.data == want.data)
        })
}

/// Изменённые против исходных текстуры, с их номерами.
fn altered<'a>(before: &'a [Level], now: &'a [Level]) -> impl Iterator<Item = (usize, &'a Level)> {
    now.iter()
        .enumerate()
        .filter(|(index, level)| **level != before[*index])
}

fn rebuild_dictionary(original: &[u8], before: &[Level], now: &[Level]) -> Result<Vec<u8>> {
    let edits: Vec<ytd_write::Edit> = altered(before, now)
        .map(|(_, level)| ytd_write::Edit::Add {
            texture: ytd_write::NewTexture {
                name: level.name.clone(),
                width: level.width as u16,
                height: level.height as u16,
                format: level.format,
                levels: level.levels as u8,
                payload: texture_levels::stored_bytes(level),
            },
            donor: Some(level.name.clone()),
        })
        .collect();
    // Данные текстур вплотную, как у хоста: иначе словарь из мелких текстур держит в игре в разы больше памяти ресурса.
    Ok(ytd_write::edit_aligned_with(original, &edits, rage_res::meta_graph::deflate_body, ytd_write::TIGHT_DATA_ALIGN)?)
}

fn rebuild_model(
    original: &[u8],
    (kind, textures): (model_textures::Kind, &[model_textures::Texture]),
    before: &[Level],
    now: &[Level],
) -> Result<Vec<u8>> {
    let changes: Vec<model_textures::Change> = altered(before, now)
        .map(|(index, level)| model_textures::Change {
            // Прежнее место стирается ровно по длине, которую видел хост, и не заходит дальше.
            texture: model_textures::Texture {
                payload_len: before[index].data.len(),
                ..textures[index].clone()
            },
            width: level.width as u16,
            height: level.height as u16,
            stride: level.stride as u16,
            levels: level.levels as u8,
            format: level.format,
            payload: level.data.clone(),
        })
        .collect();
    let Some(patched) = model_textures::patch_in_place(original, &changes) else {
        return Err(EngineError::invalid_data(
            "model textures could not be written in place",
        ));
    };
    match reads_back_as(&patched, kind, now) {
        true => Ok(patched),
        false => Err(EngineError::invalid_data("model did not survive a save")),
    }
}

impl Container {
    /// Файл варианта: изменённые против исходных текстуры вписываются в словарь или в модель на месте.
    fn rebuild(&self, original: &[u8], before: &[Level], now: &[Level]) -> Result<Vec<u8>> {
        match self {
            Container::Dictionary => rebuild_dictionary(original, before, now),
            Container::Model { kind, textures } => {
                rebuild_model(original, (*kind, textures), before, now)
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Срез текстур
// ---------------------------------------------------------------------------------------------------------------

/// Что сделал один предел.
#[derive(Default)]
struct Tally {
    changed: usize,
    resampled: usize,
    staged: usize,
}

/// Справочные текстуры (палитры, таблицы, полоски) не режутся, но стадии на них действуют.
fn is_reference(level: &Level) -> bool {
    let name = level.name.to_ascii_lowercase();
    let strip = level.height <= 8 && level.width >= 16 * level.height.max(1);
    strip
        || name.contains("palette")
        || name.contains("_pal_")
        || name.ends_with("_pal")
        || name.ends_with("_lut")
}

/// Один предел по всем текстурам на месте: срез и пересжатие (кроме справочных), затем стадии.
fn cut_to(
    textures: &mut [Level],
    cap: usize,
    stages: &[String],
    failures: &mut Vec<String>,
) -> Tally {
    textures
        .iter_mut()
        .fold(Tally::default(), |mut tally, level| {
            let (cut, resampled) = match is_reference(level) {
                true => (false, false),
                false => {
                    let cut = texture_levels::drop_to(level, cap);
                    let still_big = level.width.max(level.height) > cap;
                    (
                        cut,
                        still_big && texture_levels::resample_to(level, cap, failures),
                    )
                }
            };
            // Каждая стадия применяется, даже если предыдущая уже изменила данные.
            let painted = stages.iter().fold(false, |hit, stage| {
                texture_stages::apply(level, stage) | hit
            });
            tally.changed += usize::from(cut || resampled || painted);
            tally.resampled += usize::from(resampled);
            tally.staged += usize::from(painted);
            tally
        })
}

/// Накопленное по пределам: текущие текстуры, сбои кодека, строки отчёта и файлы вариантов.
struct Cut {
    current: Vec<Level>,
    failures: Vec<String>,
    levels: Vec<Value>,
    files: Vec<(String, Vec<u8>)>,
}

fn level_record(cap: usize, tally: &Tally, built: &[u8], variant: &str) -> Value {
    object(vec![
        ("cap", cap.into()),
        ("changed", tally.changed.into()),
        ("bytes", built.len().into()),
        ("sha256", hash::sha256_hex(built).into()),
        ("variant", variant.into()),
        ("staged", tally.staged.into()),
        ("resampled", tally.resampled.into()),
    ])
}

/// Обрабатывает байты одной записи: по `kind` (`.ytd`, `.ydr`, `.ydd`) это словарь или модель. Пишет файлы
/// вариантов и возвращает запись отчёта.
pub(crate) fn process_bytes(
    at: &str,
    name: &str,
    kind: &str,
    bytes: &[u8],
    caps: &[usize],
    stages: &[String],
    output_directory: &Path,
) -> Result<Value> {
    if kind == ".yft" && super::levels_yft::enabled() {
        return super::levels_yft::process_bytes(at, name, bytes, caps, stages, output_directory);
    }
    let (container, originals) = open_container(kind, bytes)?;
    let mut fields: Vec<(&str, Value)> = vec![
        ("at", at.into()),
        ("name", name.into()),
        ("original", bytes.len().into()),
    ];
    if originals.is_empty() {
        fields.push(("textures", 0.into()));
        fields.push(("levels", Value::Array(Vec::new())));
        return Ok(object(fields));
    }
    let start = Cut {
        current: originals.clone(),
        failures: Vec::new(),
        levels: Vec::new(),
        files: Vec::new(),
    };
    let mut cut = caps
        .iter()
        .try_fold(start, |mut cut, &cap| -> Result<Cut> {
            let tally = cut_to(&mut cut.current, cap, stages, &mut cut.failures);
            if tally.changed > 0 {
                let built = container.rebuild(bytes, &originals, &cut.current)?;
                let variant = texture_stages::variant_key(cap, stages);
                cut.levels.push(level_record(cap, &tally, &built, &variant));
                cut.files.push((variant, built));
            }
            Ok(cut)
        })?;
    // Файлы пишутся после всех пределов записи.
    for (variant, built) in &cut.files {
        let target = output_directory.join(variant).join(name);
        if let Some(folder) = target.parent() {
            fs::create_dir_all(folder)?;
        }
        write_atomic(&target, built)?;
    }
    let smallest = caps.iter().copied().min().unwrap_or(0);
    let unmipped = cut
        .current
        .iter()
        .filter(|level| !is_reference(level) && level.width.max(level.height) > smallest)
        .count();
    fields.push(("textures", originals.len().into()));
    fields.push(("levels", Value::Array(std::mem::take(&mut cut.levels))));
    fields.push(("unmipped", unmipped.into()));
    if !cut.failures.is_empty() {
        cut.failures.sort();
        cut.failures.dedup();
        fields.push(("codecFailures", cut.failures.into()));
    }
    Ok(object(fields))
}

// ---------------------------------------------------------------------------------------------------------------
// Архив игры
// ---------------------------------------------------------------------------------------------------------------

/// Какой архив игры назван меткой.
enum Label<'a> {
    Update,
    /// `x64` и одна латинская буква: файл в корне игры.
    Base(&'a str),
    /// Имя пакета DLC.
    Pack(&'a str),
}

fn is_pack_char(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
}

fn classify(label: &str) -> Option<Label<'_>> {
    let lower = label.to_ascii_lowercase();
    if lower == "update" {
        return Some(Label::Update);
    }
    if let [b'x', b'6', b'4', letter, b'.', b'r', b'p', b'f'] = lower.as_bytes() {
        if letter.is_ascii_lowercase() {
            return Some(Label::Base(label));
        }
    }
    let pack = lower.strip_prefix(dlc::PREFIX)?.strip_suffix(dlc::SUFFIX)?;
    let fits = limits::PACK_NAME.contains(&pack.len()) && pack.bytes().all(is_pack_char);
    // Имя пакета в путь берётся так, как подано.
    fits.then(|| Label::Pack(&label[dlc::PREFIX.len()..dlc::PREFIX.len() + pack.len()]))
}

/// Куда ведёт метка: путь файла под игрой и его вид для отказа «не найден» (с обратными слэшами).
fn archive_path(game_root: &str, label: &str) -> Result<(PathBuf, String)> {
    let parts: Vec<&str> = match classify(label) {
        Some(Label::Update) => vec!["update", "update.rpf"],
        Some(Label::Base(file)) => vec![file],
        Some(Label::Pack(pack)) => vec!["update", "x64", "dlcpacks", pack, "dlc.rpf"],
        None => {
            return Err(EngineError::invalid_data(format!(
                "Unsupported archive label: {label}"
            )))
        }
    };
    let relative: PathBuf = parts.iter().collect();
    Ok((Path::new(game_root).join(relative), parts.join("\\")))
}

/// Содержимое файла архива: ресурс — с заголовком RSC7, иное — расшифрованное.
fn read_entry(archive: &Archive, directory: EntryId, name: &str) -> Result<Option<Vec<u8>>> {
    let Some(id) = archive.find_file(directory, name) else {
        return Ok(None);
    };
    let bytes = if matches!(archive.entry(id).kind, EntryKind::Resource(_)) {
        archive.export(id)?
    } else {
        archive.decode(id, EntryCipher::ByArchive)?
    };
    if bytes.len() > limits::ENTRY_BYTES {
        return Err(EngineError::invalid_data("RPF entry is too large to read."));
    }
    Ok(Some(bytes))
}

/// Корневой архив группы и вложенные архивы, открытые по пути звеньев (каждый — один раз).
struct Vault {
    root: Rc<Archive>,
    nested: HashMap<String, Rc<Archive>>,
}

impl Vault {
    fn open(game_root: &str, label: &str, keys: Arc<KeySet>) -> Result<Vault> {
        let (path, shown) = archive_path(game_root, label)?;
        if !path.is_file() {
            return Err(EngineError::io(format!("Archive was not found: {shown}")));
        }
        Ok(Vault {
            root: Rc::new(Archive::open_path(&path, Some(keys))?),
            nested: HashMap::new(),
        })
    }

    /// Вложенный архив по пути звеньев `trail`; открывается один раз.
    fn nested_archive(
        &mut self,
        trail: &str,
        parent: &Archive,
        id: EntryId,
    ) -> Result<Rc<Archive>> {
        if let Some(open) = self.nested.get(trail) {
            return Ok(Rc::clone(open));
        }
        let opened = Rc::new(parent.open_nested(id)?);
        self.nested.insert(trail.to_owned(), Rc::clone(&opened));
        Ok(opened)
    }

    /// Спуск по звеньям: `.rpf` — вложенный архив, прочие — каталоги, последнее — файл.
    fn dive(
        &mut self,
        (archive, directory): (Rc<Archive>, EntryId),
        trail: String,
        rest: &[&str],
    ) -> Result<Option<Vec<u8>>> {
        match rest {
            [] => Ok(None),
            [last] => read_entry(&archive, directory, last),
            [way, deeper @ ..] => {
                let lower = way.to_ascii_lowercase();
                let trail = format!("{trail}/{lower}");
                if lower.ends_with(".rpf") {
                    match archive.find_file(directory, way) {
                        Some(id) => {
                            let nested = self.nested_archive(&trail, &archive, id)?;
                            let top = nested.root();
                            self.dive((nested, top), trail, deeper)
                        }
                        None => Ok(None),
                    }
                } else {
                    match archive.find_dir(directory, way) {
                        Some(next) => self.dive((archive, next), trail, deeper),
                        None => Ok(None),
                    }
                }
            }
        }
    }

    /// Содержимое записи по пути внутри архива; `None` — звена или файла нет.
    fn fetch(&mut self, path: &str) -> Result<Option<Vec<u8>>> {
        let segments = path
            .split(['/', '\\'])
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        let root = Rc::clone(&self.root);
        let top = root.root();
        self.dive((root, top), String::new(), &segments)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------------------------

/// Игра: папка и необязательный каталог ключей.
struct Game {
    root: String,
    keys: Option<String>,
}

/// Что делать с каждой записью: пределы и стадии.
struct Plan {
    /// По убыванию, без повторов.
    caps: Vec<usize>,
    /// После нормализации: стиль, затем чёрно-белая.
    stages: Vec<String>,
}

struct Job {
    game: Game,
    out_dir: String,
    plan: Plan,
    items: Vec<Value>,
}

/// Строка поля объекта запроса.
fn string_field<'a>(document: &'a Value, key: &str) -> Option<&'a str> {
    document.get(key).and_then(Value::as_str)
}

/// Записи одной метки архива в порядке запроса; метка — так, как её подала первая запись.
struct Group<'a> {
    label: String,
    items: Vec<&'a Value>,
}

fn read_caps(value: Option<&Value>) -> Result<Vec<usize>> {
    let Some(Value::Array(list)) = value else {
        return Err(broken_request("нужен список caps."));
    };
    let mut caps = Vec::with_capacity(list.len());
    for cap in list {
        let Some(number) = cap.as_u64() else {
            return Err(broken_request("предел — число."));
        };
        caps.push(usize::try_from(number).unwrap_or(usize::MAX));
    }
    caps.sort_unstable_by(|left, right| right.cmp(left));
    caps.dedup();
    let sound = caps
        .iter()
        .all(|cap| limits::CAPS.contains(cap) && cap.is_power_of_two());
    match !caps.is_empty() && sound {
        true => Ok(caps),
        false => Err(EngineError::invalid_data(
            "Texture caps must be powers of two between 4 and 4096.",
        )),
    }
}

/// Стадии запроса: не массив — пусто, элементы не строки пропускаются.
fn read_stages(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(list)) => list
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

fn place_of(item: &Value) -> &str {
    item.get("at").and_then(Value::as_str).unwrap_or_default()
}

/// `(метка, путь)` по первому двоеточию; нет двоеточия или оно первое — отказ.
fn split_place(at: &str) -> Result<(&str, &str)> {
    let colon = at.find(':').filter(|&index| index > 0);
    colon
        .map(|index| (&at[..index], &at[index + 1..]))
        .ok_or_else(|| EngineError::invalid_data(format!("Dictionary place has no archive: {at}")))
}

/// Имя файла результата: часть после последнего `/` или `\`, строчными.
fn result_name(item: &Value) -> String {
    let raw = item.get("name").and_then(Value::as_str).unwrap_or_default();
    let tail = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    tail.to_lowercase()
}

/// Расширение записи, если имя годится: от пяти знаков и одно из четырёх.
fn model_kind_of(name: &str) -> Option<&str> {
    let extension = &name[name.rfind('.')?..];
    let long_enough = name.chars().count() >= limits::NAME_CHARS;
    (long_enough && KINDS.contains(&extension)).then_some(extension)
}

/// Вес записи для хода: размер из запроса, но не меньше единицы.
fn weight_of(item: &Value) -> u64 {
    item.get("size").and_then(Value::as_u64).unwrap_or(0).max(1)
}

impl Job {
    fn read(options: &Options) -> Result<Job> {
        let input = paths::existing_file(options.required("input")?, &[".json"])?;
        let text = fs::read_to_string(input)?;
        let document: Value =
            serde_json::from_str(&text).map_err(|_| broken_request("JSON не разбирается."))?;
        let game = Game {
            root: string_field(&document, "gameRoot")
                .unwrap_or_default()
                .to_owned(),
            keys: string_field(&document, "keys")
                .filter(|path| !path.is_empty())
                .map(str::to_owned),
        };
        // Пустая строка (и из одних пробелов) раньше проходила и создавала папки вариантов (`64`, `32`…) в рабочей папке процесса.
        let Some(out_dir) =
            string_field(&document, "outputDirectory").filter(|path| !path.trim().is_empty())
        else {
            return Err(broken_request("нужна outputDirectory."));
        };
        let caps = read_caps(document.get("caps"))?;
        let stages = texture_stages::normalize(&read_stages(document.get("stages")))
            .map_err(EngineError::invalid_data)?;
        let items = match document.get("items") {
            Some(Value::Array(list)) if limits::ITEMS.contains(&list.len()) => list.clone(),
            Some(Value::Array(_)) => return Err(broken_request("от 1 до 120000 записей.")),
            _ => return Err(broken_request("нужен список items.")),
        };
        Ok(Job {
            game,
            out_dir: out_dir.to_owned(),
            plan: Plan { caps, stages },
            items,
        })
    }

    /// Папки вариантов: по одной на предел, `<outputDirectory>/<ключ варианта>`.
    fn variant_folders(&self) -> Vec<PathBuf> {
        let base = Path::new(&self.out_dir);
        self.plan
            .caps
            .iter()
            .map(|&cap| base.join(texture_stages::variant_key(cap, &self.plan.stages)))
            .collect()
    }

    /// Папки вариантов создаются до обработки (отказ раньше записи убирает пустые, см. `FreshDirs`).
    fn make_variant_folders(&self) -> Result<()> {
        for folder in self.variant_folders() {
            fs::create_dir_all(folder)?;
        }
        Ok(())
    }

    /// Папка отчёта и папки вариантов создаются раньше проверок игры и меток; отказ убирает созданное, пока оно пусто.
    fn folder_guard(&self, options: &Options) -> FreshDirs {
        let variants = self
            .variant_folders()
            .into_iter()
            .map(|folder| FreshDirs::at(Ok(&folder.to_string_lossy())));
        FreshDirs::merged(
            std::iter::once(FreshDirs::beside(options.required("output"))).chain(variants),
        )
    }

    /// Игра и её ключи: папка обязана существовать, ключи берутся из `keys` или из окружения.
    fn open_game(&self) -> Result<Arc<KeySet>> {
        if !Path::new(&self.game.root).is_dir() {
            return Err(EngineError::invalid_data("GTA V folder was not found."));
        }
        Ok(archives::load_keys(&self.game.root, self.game.keys.as_deref())?.0)
    }

    /// Записи по меткам архива (без учёта регистра) в порядке первого появления. Метка каждой записи проверяется сразу.
    fn groups(&self) -> Result<Vec<Group<'_>>> {
        self.items
            .iter()
            .try_fold(Vec::new(), |mut groups: Vec<Group<'_>>, item| {
                let (label, _) = split_place(place_of(item))?;
                match groups
                    .iter()
                    .position(|g| g.label.eq_ignore_ascii_case(label))
                {
                    Some(at) => groups[at].items.push(item),
                    None => groups.push(Group {
                        label: label.to_owned(),
                        items: vec![item],
                    }),
                }
                Ok(groups)
            })
    }

    /// Запись отчёта по одной записи запроса. Отказ чтения и разбора — результат записи, а не отказ команды.
    fn process(&self, vault: &mut Vault, item: &Value, written: &mut HashSet<String>) -> Value {
        let at = place_of(item);
        let name = result_name(item);
        let refused = |text: &str| {
            object(vec![
                ("at", at.into()),
                ("name", name.as_str().into()),
                ("error", text.into()),
            ])
        };
        let Some(kind) = model_kind_of(&name) else {
            return refused("not a texture dictionary or model name");
        };
        let path = split_place(at).map_or("", |(_, path)| path);
        let bytes = match vault.fetch(path) {
            Ok(Some(bytes)) => bytes,
            Ok(None) => {
                return object(vec![
                    ("at", at.into()),
                    ("name", name.as_str().into()),
                    ("missing", true.into()),
                ])
            }
            Err(failure) => return refused(&failure.message),
        };
        // Запись, которой нет в архиве, файла не даёт; а вот прочитанная запись с уже записанным именем затёрла бы чужой файл.
        if written.contains(&name) {
            return refused("an earlier item already wrote the output file with this name");
        }
        let outcome = process_bytes(
            at,
            &name,
            kind,
            &bytes,
            &self.plan.caps,
            &self.plan.stages,
            Path::new(&self.out_dir),
        );
        match outcome {
            Ok(record) => {
                written.insert(name);
                record
            }
            Err(failure) => refused(&failure.message),
        }
    }

    /// Группа за группой: архив по метке, записи по порядку запроса, после каждой — ход.
    fn run(
        &self,
        groups: &[Group<'_>],
        keys: &Arc<KeySet>,
        progress: &Progress,
    ) -> Result<Vec<Value>> {
        let total: u64 = self
            .items
            .iter()
            .map(weight_of)
            .fold(0, u64::saturating_add);
        let mut done = 0u64;
        let mut written: HashSet<String> = HashSet::new();
        let mut records = Vec::with_capacity(self.items.len());
        for group in groups {
            let mut vault = Vault::open(&self.game.root, &group.label, Arc::clone(keys))?;
            for item in &group.items {
                records.push(self.process(&mut vault, item, &mut written));
                done = done.saturating_add(weight_of(item));
                progress.report_bytes(PHASE, done, total);
            }
        }
        Ok(records)
    }

    /// Отчёт пишется файлом, вызывающему идёт краткий ответ: путь отчёта и счётчики.
    fn report(&self, path: &Path, records: Vec<Value>) -> Result<Value> {
        let with_key = |key: &str| {
            records
                .iter()
                .filter(|record| record.get(key).is_some())
                .count()
        };
        let (missing, failed) = (with_key("missing"), with_key("error"));
        let body = object(vec![
            ("caps", self.plan.caps.clone().into()),
            ("stages", self.plan.stages.clone().into()),
            ("dictionaries", self.items.len().into()),
            ("items", Value::Array(records)),
        ]);
        write_atomic(path, body.to_string().as_bytes())?;
        Ok(object(vec![
            ("output", path.to_string_lossy().into_owned().into()),
            ("dictionaries", self.items.len().into()),
            ("missing", missing.into()),
            ("failed", failed.into()),
        ]))
    }
}

fn downscale_textures(options: &Options, progress: &Progress) -> Result<Value> {
    let job = Job::read(options)?;
    let created = job.folder_guard(options);
    let report = paths::output_file(options.required("output")?, &[".json"])?;
    let keys = job.open_game()?;
    job.make_variant_folders()?;
    let groups = job.groups()?;
    let records = job.run(&groups, &keys, progress)?;
    let answer = job.report(&report, records)?;
    created.keep();
    Ok(answer)
}

pub const COMMANDS: &[Command] = &[Command::new("downscale-textures", downscale_textures)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use crate::texture_levels::{codec_of, shrink};
    use rage_res::hash::sha256_hex;
    use rage_res::texture::Format;
    use rage_res::ytd_write::NewTexture;
    use rage_rpf::keys::{AES_KEY_FILE, HASH_LUT_FILE, NG_KEY_FILE, NG_TABLES_FILE};
    use rage_rpf::{Body, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;

    struct Bench {
        dir: tempfile::TempDir,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn at(&self, name: &str) -> PathBuf {
            name.split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
        }

        fn path(&self, name: &str) -> String {
            self.at(name).to_string_lossy().into_owned()
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.at(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        }

        fn exec(&self, request: &Value, output: Option<&str>) -> (Value, i32) {
            let input = self.put("req.json", request.to_string().as_bytes());
            let mut argv = vec!["downscale-textures".to_owned(), "--input".to_owned(), input];
            if let Some(report) = output {
                argv.extend(["--output".to_owned(), report.to_owned()]);
            }
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }
    }

    // -- подставные словари по описанию -----------------------------------------------------------------------------

    fn format_of(text: &str) -> Format {
        match text {
            "DXT1" => Format::Dxt1,
            "DXT3" => Format::Dxt3,
            "DXT5" => Format::Dxt5,
            "ATI1" => Format::Ati1,
            "ATI2" => Format::Ati2,
            "A8R8G8B8" => Format::A8R8G8B8,
            "X8R8G8B8" => Format::X8R8G8B8,
            "A8B8G8R8" => Format::A8B8G8R8,
            "L8" => Format::L8,
            "A8" => Format::A8,
            other => panic!("{other}"),
        }
    }

    /// Верхняя ступень: «градиент», «плоский», «альфа».
    fn picture(width: usize, height: usize, style: &str) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            for x in 0..width {
                let (r, g) = ((x * 255 / width) as u8, (y * 255 / height) as u8);
                rgba.extend(match style {
                    "flat" => [90, 150, 210, 255],
                    "alpha" => [r, g, 128, r],
                    _ => [r, g, 128, 255],
                });
            }
        }
        rgba
    }

    /// Спецификация `имя:ширина x высота:ФОРМАТ:число ступеней[:рисунок]` как текстура словаря.
    fn texture(spec: &str) -> NewTexture {
        let parts: Vec<&str> = spec.split(':').collect();
        let (width, height) = parts[1].split_once('x').unwrap();
        let (width, height): (usize, usize) = (width.parse().unwrap(), height.parse().unwrap());
        let format = format_of(parts[2]);
        let count: usize = parts[3].parse().unwrap();
        let codec = codec_of(format).unwrap();
        let mut rgba = picture(width, height, parts.get(4).copied().unwrap_or("gradient"));
        let (mut w, mut h) = (width, height);
        let mut payload = Vec::new();
        for level in 0..count {
            if level > 0 {
                let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
                rgba = shrink(&rgba, w, h, nw, nh);
                (w, h) = (nw, nh);
            }
            payload.extend(codec.encode(&rgba, w, h).unwrap());
        }
        NewTexture {
            name: parts[0].to_owned(),
            width: width as u16,
            height: height as u16,
            format,
            levels: count as u8,
            payload,
        }
    }

    fn dictionary(specs: &[&str]) -> Vec<u8> {
        let textures: Vec<NewTexture> = specs.iter().map(|spec| texture(spec)).collect();
        ytd_write::write(&textures).unwrap()
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    /// Запись отчёта по подставному словарю: что в ответе и какие файлы легли.
    fn process(
        bench: &Bench,
        kind: &str,
        bytes: &[u8],
        caps: &[usize],
        stages: &[&str],
    ) -> Result<Value> {
        process_bytes(
            "at",
            "t.ytd",
            kind,
            bytes,
            caps,
            &strings(stages),
            &bench.at("out"),
        )
    }

    fn level_line(record: &Value, index: usize) -> String {
        let level = &record["levels"][index];
        format!(
            "cap {}: changed {}, {} Б, sha {}, variant {}, staged {}, resampled {}",
            level["cap"],
            level["changed"],
            level["bytes"],
            &level["sha256"].as_str().unwrap()[..10],
            level["variant"].as_str().unwrap(),
            level["staged"],
            level["resampled"]
        )
    }

    #[test]
    fn dictionary_textures_are_cut_per_cap_and_cumulatively() {
        let bench = Bench::new();
        let dxt1 = dictionary(&["t_dxt1:128x128:DXT1:8"]);
        assert_eq!(dxt1.len(), 5726, "исходный словарь S1");
        let one = process(&bench, ".ytd", &dxt1, &[32], &[]).unwrap();
        assert_eq!(
            (
                one["original"].clone(),
                one["textures"].clone(),
                one["unmipped"].clone()
            ),
            (json!(5726), json!(1), json!(0))
        );
        assert_eq!(level_line(&one, 0),
            "cap 32: changed 1, 538 Б, sha ec714e81b3, variant 32, staged 0, resampled 0",
            "S1"
        );
        assert_eq!(fs::read(bench.at("out/32/t.ytd")).unwrap().len(), 538, "S1 файл");
        let two = process(&bench, ".ytd", &dxt1, &[64, 16], &[]).unwrap();
        assert_eq!(level_line(&two, 0),
            "cap 64: changed 1, 1629 Б, sha eac8089de3, variant 64, staged 0, resampled 0",
            "S2"
        );
        assert_eq!(level_line(&two, 1),
            "cap 16: changed 1, 264 Б, sha d79dd670ca, variant 16, staged 0, resampled 0",
            "S2"
        );
        for (id, cap) in [("S3", 4096), ("S4", 128)] {
            let none = process(&bench, ".ytd", &dxt1, &[cap], &[]).unwrap();
            assert_eq!(none["levels"], json!([]), "{id}");
            assert_eq!(none["unmipped"], json!(0), "{id}");
        }
        let five = process(&bench, ".ytd", &dxt1, &[4], &[]).unwrap();
        assert_eq!(level_line(&five, 0),
            "cap 4: changed 1, 166 Б, sha 562045ad63, variant 4, staged 0, resampled 0",
            "S5"
        );
    }

    #[test]
    fn other_formats_and_chains_follow_the_table() {
        let bench = Bench::new();
        type Case<'a> = (&'a str, Vec<&'a str>, usize, Vec<usize>, Vec<&'a str>);
        let cases: Vec<Case> = vec![
            (
                "S6",
                vec!["t_dxt3:64x64:DXT3:7"],
                1684,
                vec![16],
                vec!["cap 16: changed 1, 267 Б, sha 65a27d8fc0, variant 16, staged 0, resampled 0"],
            ),
            (
                "S7",
                vec!["t_dxt5:256x128:DXT5:9"],
                8746,
                vec![64],
                vec!["cap 64: changed 1, 872 Б, sha 33afd72b99, variant 64, staged 0, resampled 0"],
            ),
            (
                "S8",
                vec!["t_ati1:64x64:ATI1:7"],
                313,
                vec![16],
                vec!["cap 16: changed 1, 198 Б, sha ba4a1079b7, variant 16, staged 0, resampled 0"],
            ),
            (
                "S9",
                vec!["t_ati2:64x64:ATI2:7"],
                945,
                vec![16],
                vec!["cap 16: changed 1, 258 Б, sha dfadb5347a, variant 16, staged 0, resampled 0"],
            ),
            (
                "S11",
                vec!["t_argb:64x64:A8R8G8B8:7"],
                11164,
                vec![16],
                vec!["cap 16: changed 1, 917 Б, sha 7c34f896b3, variant 16, staged 0, resampled 0"],
            ),
            (
                "S12",
                vec!["t_xrgb:64x64:X8R8G8B8:7"],
                11168,
                vec![16],
                vec!["cap 16: changed 1, 919 Б, sha f9be18a307, variant 16, staged 0, resampled 0"],
            ),
            (
                "S13",
                vec!["t_abgr:64x64:A8B8G8R8:7"],
                7186,
                vec![16],
                vec!["cap 16: changed 1, 915 Б, sha 0121f9cddc, variant 16, staged 0, resampled 0"],
            ),
            (
                "S14",
                vec!["t_l8:64x64:L8:7"],
                339,
                vec![16],
                vec!["cap 16: changed 1, 204 Б, sha 874af1476f, variant 16, staged 0, resampled 0"],
            ),
            (
                "S15",
                vec!["t_a8:64x64:A8:7"],
                149,
                vec![16],
                vec!["cap 16: changed 1, 151 Б, sha a246967501, variant 16, staged 0, resampled 0"],
            ),
            (
                "S16",
                vec!["t_nomip:256x256:DXT1:1"],
                12592,
                vec![64],
                vec![
                    "cap 64: changed 1, 1690 Б, sha e032ead396, variant 64, staged 0, resampled 1",
                ],
            ),
            (
                "S17",
                vec!["t_nomip5:256x256:DXT5:1:alpha"],
                17109,
                vec![64],
                vec![
                    "cap 64: changed 1, 2114 Б, sha 853d60b56e, variant 64, staged 0, resampled 1",
                ],
            ),
            (
                "S25",
                vec!["ml:512x512:DXT1:10"],
                43735,
                vec![256, 128, 64],
                vec![
                "cap 256: changed 1, 18541 Б, sha d69265e4a8, variant 256, staged 0, resampled 0",
                "cap 128: changed 1, 5501 Б, sha a996887a5d, variant 128, staged 0, resampled 0",
                "cap 64: changed 1, 1578 Б, sha 85bf099a7b, variant 64, staged 0, resampled 0",
            ],
            ),
            (
                "S26",
                vec!["sc:256x256:DXT1:3"],
                18350,
                vec![64],
                vec![
                    "cap 64: changed 1, 1182 Б, sha 0a0f3d4edf, variant 64, staged 0, resampled 0",
                ],
            ),
            (
                "S27",
                vec!["ns:256x64:DXT1:9"],
                3593,
                vec![64, 16],
                vec![
                    "cap 64: changed 1, 531 Б, sha 961d219af4, variant 64, staged 0, resampled 0",
                    "cap 16: changed 1, 186 Б, sha 89f0b39aba, variant 16, staged 0, resampled 0",
                ],
            ),
            (
                "S19",
                vec!["t_odd:100x60:DXT1:1", "t_odd2:96x96:DXT1:1"],
                4208,
                vec![32],
                vec!["cap 32: changed 2, 490 Б, sha 562834e094, variant 32, staged 0, resampled 2"],
            ),
            (
                "S20",
                vec![
                    "t_tiny:4x4:DXT1:1",
                    "t_small:8x8:DXT1:4",
                    "t_16:16x16:DXT1:5",
                ],
                425,
                vec![8],
                vec!["cap 8: changed 1, 301 Б, sha 3e838d13e4, variant 8, staged 0, resampled 0"],
            ),
            (
                "S21",
                vec![
                    "t_tiny:4x4:DXT1:1",
                    "t_small:8x8:DXT1:4",
                    "t_16:16x16:DXT1:5",
                ],
                425,
                vec![4],
                vec!["cap 4: changed 2, 249 Б, sha cd45da0f1f, variant 4, staged 0, resampled 0"],
            ),
        ];
        for (id, specs, original, caps, lines) in cases {
            let bytes = dictionary(&specs);
            assert_eq!(bytes.len(), original, "{id}: исходный словарь");
            let record = process(&bench, ".ytd", &bytes, &caps, &[]).unwrap();
            let found: Vec<String> = (0..record["levels"].as_array().unwrap().len())
                .map(|index| level_line(&record, index))
                .collect();
            assert_eq!(found, lines, "{id}");
            assert_eq!(record["unmipped"], json!(0), "{id}");
        }
    }

    #[test]
    fn stages_are_applied_after_the_cut_and_name_the_variant() {
        let bench = Bench::new();
        let dxt1 = dictionary(&["t_dxt1:128x128:DXT1:8"]);
        let gray = process(&bench, ".ytd", &dxt1, &[4096], &["grayscale"]).unwrap();
        assert_eq!(level_line(&gray, 0), "cap 4096: changed 1, 2981 Б, sha ae3a375dec, variant 4096+grayscale, staged 1, resampled 0", "S28");
        let cut = process(&bench, ".ytd", &dxt1, &[32], &["grayscale"]).unwrap();
        assert_eq!(level_line(&cut, 0),
            "cap 32: changed 1, 574 Б, sha e729c81a83, variant 32+grayscale, staged 1, resampled 0",
            "S29"
        );
        let comic = process(&bench, ".ytd", &dxt1, &[32], &["style-comic"]).unwrap();
        assert_eq!(level_line(&comic, 0), "cap 32: changed 1, 780 Б, sha 4bd89c9025, variant 32+style-comic, staged 1, resampled 0", "S31");
        let retro = process(
            &bench,
            ".ytd",
            &dictionary(&["t_argb:64x64:A8R8G8B8:7"]),
            &[16],
            &["style-retro"],
        )
        .unwrap();
        assert_eq!(level_line(&retro, 0), "cap 16: changed 1, 971 Б, sha aebdb14cd4, variant 16+style-retro, staged 1, resampled 0", "S36");
        assert!(bench.at("out/4096+grayscale/t.ytd").is_file());
    }

    #[test]
    fn reference_textures_are_left_alone_by_the_cut_but_not_by_stages() {
        let level = |name: &str, width: usize, height: usize| Level {
            name: name.to_owned(),
            format: Format::Dxt1,
            width,
            height,
            stride: 0,
            levels: 1,
            depth: 1,
            data: Vec::new(),
        };
        for (name, width, height) in [
            ("tint_pal", 256, 256),
            ("wall_lut", 64, 64),
            ("my_palette_x", 64, 64),
            ("x_pal_y", 64, 64),
            ("TINT_PAL", 8, 8),
            ("strip", 512, 4),
            ("wide", 256, 16 / 2),
            ("wide2", 128, 8),
        ] {
            assert!(is_reference(&level(name, width, height)), "{name}");
        }
        for (name, width, height) in [
            ("plain", 256, 256),
            ("wide", 256, 16),
            ("tall", 8, 128),
            ("ns", 256, 64),
            ("pal", 64, 64),
            ("wall_luts", 64, 64),
        ] {
            assert!(!is_reference(&level(name, width, height)), "{name}");
        }
        // Высота 0 считается как 1: полоска из 16 и больше.
        assert!(is_reference(&level("zero_height", 16, 0)));
    }

    #[test]
    fn wrong_kinds_and_garbage_are_refused_with_their_own_words() {
        let bench = Bench::new();
        let dxt1 = dictionary(&["t_dxt1:128x128:DXT1:8"]);
        let refusal = |kind: &str, bytes: &[u8]| {
            let error = process(&bench, kind, bytes, &[32], &[]).unwrap_err();
            (error.code, error.message)
        };
        let yft = (
            "InvalidDataException".to_owned(),
            "downscale-textures: фрагменты .yft ещё не перенесены в движок.".to_owned(),
        );
        assert_eq!(refusal(".yft", &dxt1), yft, "S40");
        assert_eq!(refusal(".txt", &dxt1), yft, "S44");
        let loaded = (
            "InvalidDataException".to_owned(),
            "resource did not load".to_owned(),
        );
        assert_eq!(
            refusal(".ytd", b"{\"not\": \"a dictionary\"}"),
            loaded,
            "S41"
        );
        assert_eq!(refusal(".ytd", b""), loaded, "S45");
        for (id, kind) in [("S42", ".ydr"), ("S43", ".ydd")] {
            let none = process(&bench, kind, &dxt1, &[32], &[]).unwrap();
            assert_eq!(
                none.to_string(),
                r#"{"at":"at","name":"t.ytd","original":5726,"textures":0,"levels":[]}"#,
                "{id}"
            );
        }
        assert_eq!(refusal(".ydr", b"junk").1, "resource did not load");
        // Ничего не изменено — ни папок, ни файлов.
        assert!(!bench.at("out").exists());
    }

    // -- запрос и порядок проверок ---------------------------------------------------------------------------------------

    fn base(bench: &Bench) -> Value {
        json!({
            "gameRoot": bench.path("game"),
            "keys": bench.path("keys"),
            "outputDirectory": bench.path("levels"),
            "caps": [64],
            "items": [{ "at": "x64e.rpf:levels/gta5/vehicles.rpf/adder.ytd", "name": "adder.ytd", "size": 1000 }],
        })
    }

    fn failure(outcome: &(Value, i32)) -> (String, String) {
        assert_eq!(outcome.1, 1, "{}", outcome.0);
        (
            outcome.0["error"]["code"].as_str().unwrap().to_owned(),
            outcome.0["error"]["message"].as_str().unwrap().to_owned(),
        )
    }

    fn invalid(message: &str) -> (String, String) {
        ("InvalidDataException".to_owned(), message.to_owned())
    }

    fn patched(request: &Value, edits: &[(&str, Option<Value>)]) -> Value {
        let mut doc = request.clone();
        for (path, value) in edits {
            let (parent, key) = path.rsplit_once('/').unwrap();
            let target = doc.pointer_mut(parent).unwrap();
            match (target, value) {
                (Value::Object(map), Some(value)) => {
                    map.insert(key.to_owned(), value.clone());
                }
                (Value::Object(map), None) => {
                    map.remove(key);
                }
                (Value::Array(items), Some(value)) => {
                    items[key.parse::<usize>().unwrap()] = value.clone()
                }
                _ => panic!("{path}"),
            }
        }
        doc
    }

    #[test]
    fn the_request_is_checked_field_by_field_before_anything_else() {
        let bench = Bench::new();
        let request = base(&bench);
        let report = bench.path("out/report.json");
        let go = |edits: &[(&str, Option<Value>)]| {
            failure(&bench.exec(&patched(&request, edits), Some(&report)))
        };
        let caps_text = "Texture caps must be powers of two between 4 and 4096.";
        assert_eq!(
            go(&[("/outputDirectory", None)]),
            invalid("downscale-textures: нужна outputDirectory."),
            "L24"
        );
        assert_eq!(
            go(&[("/outputDirectory", Some(json!(5)))]),
            invalid("downscale-textures: нужна outputDirectory."),
            "L25"
        );
        // Пустая строка и строка из пробелов раньше проходили и создавали папки вариантов в рабочей папке процесса.
        for empty in ["", "   "] {
            assert_eq!(
                go(&[("/outputDirectory", Some(json!(empty)))]),
                invalid("downscale-textures: нужна outputDirectory."),
                "пустая outputDirectory {empty:?}"
            );
        }
        assert_eq!(
            go(&[("/caps", None)]),
            invalid("downscale-textures: нужен список caps."),
            "L26"
        );
        assert_eq!(
            go(&[("/caps", Some(json!(64)))]),
            invalid("downscale-textures: нужен список caps."),
            "L27"
        );
        assert_eq!(
            go(&[("/caps", Some(json!([64, "x"])))]),
            invalid("downscale-textures: предел — число."),
            "L28"
        );
        assert_eq!(
            go(&[("/caps/0", Some(json!(64.5)))]),
            invalid("downscale-textures: предел — число."),
            "L29"
        );
        assert_eq!(
            go(&[("/caps/0", Some(json!(-64)))]),
            invalid("downscale-textures: предел — число."),
            "L30"
        );
        assert_eq!(
            go(&[("/caps/0", Some(json!(64.0)))]),
            invalid("downscale-textures: предел — число."),
            "L41"
        );
        for (id, caps) in [
            ("L31", json!([])),
            ("L32", json!([3])),
            ("L33", json!([2])),
            ("L34", json!([0])),
            ("L35", json!([100])),
            ("L36", json!([8192])),
            ("L40", json!([128, 100])),
        ] {
            assert_eq!(go(&[("/caps", Some(caps))]), invalid(caps_text), "{id}");
        }
        assert_eq!(
            go(&[("/stages", Some(json!(["comic"])))]),
            invalid("Unknown texture stage: comic"),
            "L50"
        );
        assert_eq!(
            go(&[("/stages", Some(json!([""])))]),
            invalid("Unknown texture stage: "),
            "L52"
        );
        assert_eq!(
            go(&[("/stages", Some(json!(["style-comic", "style-retro"])))]),
            invalid("Only one world style can be applied at a time."),
            "L48"
        );
        assert_eq!(
            go(&[("/items", None)]),
            invalid("downscale-textures: нужен список items."),
            "L53"
        );
        assert_eq!(
            go(&[("/items", Some(json!({})))]),
            invalid("downscale-textures: нужен список items."),
            "L54"
        );
        assert_eq!(
            go(&[("/items", Some(json!([])))]),
            invalid("downscale-textures: от 1 до 120000 записей."),
            "L55"
        );
        assert_eq!(
            go(&[("/outputDirectory", None), ("/caps", None)]),
            invalid("downscale-textures: нужна outputDirectory."),
            "L56"
        );
        assert_eq!(
            go(&[("/caps/0", Some(json!(3))), ("/stages", Some(json!(["x"])))]),
            invalid(caps_text),
            "L57"
        );
        assert_eq!(
            go(&[("/items", None), ("/stages", Some(json!(["x"])))]),
            invalid("Unknown texture stage: x"),
            "L58"
        );
        // Запрос читается раньше --output и раньше игры.
        let bad_output = bench.path("out/report.bin");
        let no_items = patched(&request, &[("/items", None)]);
        assert_eq!(
            failure(&bench.exec(&no_items, Some(&bad_output))),
            invalid("downscale-textures: нужен список items."),
            "L59"
        );
        let outcome = bench.exec(
            &patched(&request, &[("/gameRoot", Some(json!("C:/nope-game")))]),
            Some(&bad_output),
        );
        assert_eq!(
            failure(&outcome),
            (
                "ArgumentException".to_owned(),
                "Unsupported output extension: .bin".to_owned()
            ),
            "L60"
        );
        assert!(!bench.at("levels").exists());
    }

    #[test]
    fn the_request_file_and_the_parameters_are_checked_first() {
        let bench = Bench::new();
        let run_with = |args: &[&str]| {
            let mut argv = vec!["downscale-textures".to_owned()];
            argv.extend(args.iter().map(|arg| (*arg).to_owned()));
            let outcome = run(&argv, &Progress::silent());
            let value: Value = serde_json::from_str(&outcome.line).unwrap();
            (
                value["error"]["code"].as_str().unwrap().to_owned(),
                value["error"]["message"].as_str().unwrap().to_owned(),
            )
        };
        assert_eq!(
            run_with(&[]),
            (
                "ArgumentException".to_owned(),
                "--input is required.".to_owned()
            ),
            "L1"
        );
        assert_eq!(
            run_with(&["--output", "x.json"]).1,
            "--input is required.",
            "L2"
        );
        assert_eq!(
            run_with(&["--input", "", "--output", "x.json"]).1,
            "The path is empty.",
            "L3"
        );
        let text = bench.put("req.txt", b"{}");
        assert_eq!(
            run_with(&["--input", &text]).1,
            "Unsupported file extension: .txt",
            "L6"
        );
        let json_file = bench.put("req.json", b"not json");
        assert_eq!(
            run_with(&["--input", &json_file]),
            invalid("downscale-textures: JSON не разбирается."),
            "L21"
        );
        let empty = bench.put("empty.json", b"");
        assert_eq!(
            run_with(&["--input", &empty]),
            invalid("downscale-textures: JSON не разбирается."),
            "L20"
        );
        let bom = bench.put("bom.json", "\u{feff}{}".as_bytes());
        assert_eq!(
            run_with(&["--input", &bom]),
            invalid("downscale-textures: JSON не разбирается."),
            "L23"
        );
        let array = bench.put("array.json", b"[]");
        assert_eq!(
            run_with(&["--input", &array]),
            invalid("downscale-textures: нужна outputDirectory."),
            "L22"
        );
        // --output требуется только после запроса.
        let request = bench.put("ok.json", base(&bench).to_string().as_bytes());
        assert_eq!(
            run_with(&["--input", &request]),
            (
                "ArgumentException".to_owned(),
                "--output is required.".to_owned()
            ),
            "L7"
        );
        assert_eq!(
            run_with(&["--input", &request, "--output", ""]).1,
            "The path is empty.",
            "L8"
        );
        assert_eq!(
            run_with(&["--input", &request, "--output", &bench.path("a.txt")]).1,
            "Unsupported output extension: .txt",
            "L9"
        );
        assert_eq!(
            run_with(&["--input", &request, "--output", &bench.path("noext")]).1,
            "Unsupported output extension: ",
            "L10"
        );
        // Расширение .JSON годится, папка отчёта создаётся до проверки игры, но отказ её убирает (раньше она оставалась).
        let nested = bench.path("deep/er/report.JSON");
        assert_eq!(
            run_with(&["--input", &request, "--output", &nested]),
            invalid("GTA V folder was not found.")
        );
        assert!(!bench.at("deep").exists());
    }

    // -- игра, ключи и записи через настоящий архив -----------------------------------------------------------------

    /// Ключи нужной длины из нулей: открытому архиву они не нужны, но набор собирается.
    fn fake_keys(bench: &Bench) {
        for (name, size) in [
            (AES_KEY_FILE, 32),
            (NG_KEY_FILE, 27_472),
            (NG_TABLES_FILE, 278_528),
            (HASH_LUT_FILE, 256),
        ] {
            bench.put(&format!("keys/{name}"), &vec![0u8; size]);
        }
    }

    fn resource_file(name: &str, bytes: &[u8]) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Resource {
                data: Data::memory(bytes.to_vec()),
            },
        }
    }

    fn write_archive_file(path: &Path, tree: &DirNode) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = fs::File::create(path).unwrap();
        let staging = path.parent().unwrap().to_path_buf();
        let mut context = WriteContext {
            staging: &staging,
            keys: None,
            finalizer: None,
        };
        rage_rpf::write::write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
    }

    /// Игра: `x64e.rpf` с каталогом `levels/gta5`, вложенным `vehicles.rpf` и двумя словарями.
    fn fake_game(bench: &Bench) -> (Vec<u8>, Vec<u8>) {
        let first = dictionary(&["t_dxt1:128x128:DXT1:8"]);
        let second = dictionary(&["wide_tex:256x256:DXT1:9"]);
        let mut inner = DirNode::new("");
        inner.files.push(resource_file("adder.ytd", &first));
        inner.files.push(resource_file("scorcher+hi.ytd", &second));
        let mut gta5 = DirNode::new("gta5");
        gta5.files.push(FileNode {
            name: "vehicles.rpf".to_owned(),
            body: Body::Nested(Box::new(inner)),
        });
        gta5.files.push(resource_file("plain.ytd", &first));
        let mut levels = DirNode::new("levels");
        levels.dirs.push(gta5);
        let mut root = DirNode::new("");
        root.dirs.push(levels);
        write_archive_file(&bench.at("game/x64e.rpf"), &root);
        write_archive_file(&bench.at("game/update/update.rpf"), &DirNode::new(""));
        fake_keys(bench);
        (first, second)
    }

    fn item(at: &str, name: &str) -> Value {
        json!({ "at": at, "name": name, "size": 1 })
    }

    #[test]
    fn labels_and_places_are_checked_before_archives_are_opened() {
        let bench = Bench::new();
        fake_game(&bench);
        let request = base(&bench);
        let report = bench.path("out/report.json");
        let go = |items: Vec<Value>| {
            failure(&bench.exec(
                &patched(&request, &[("/items", Some(Value::Array(items)))]),
                Some(&report),
            ))
        };
        let no_archive = |at: &str| invalid(&format!("Dictionary place has no archive: {at}"));
        assert_eq!(
            go(vec![item("x64e.rpf/levels/a.ytd", "a.ytd")]),
            no_archive("x64e.rpf/levels/a.ytd"),
            "L90"
        );
        assert_eq!(
            go(vec![item(":x64e.rpf", "a.ytd")]),
            no_archive(":x64e.rpf"),
            "L91"
        );
        assert_eq!(go(vec![json!({"name": "a.ytd"})]), no_archive(""), "L92");
        assert_eq!(go(vec![json!(5)]), no_archive(""), "L112");
        assert_eq!(
            go(vec![item("common.rpf:a.ytd", "a.ytd")]),
            invalid("Unsupported archive label: common.rpf"),
            "L93"
        );
        assert_eq!(
            go(vec![item(" x64e.rpf:levels/a.ytd", "a.ytd")]),
            invalid("Unsupported archive label:  x64e.rpf"),
            "L99"
        );
        let missing = |label: &str, shown: &str| {
            go(vec![item(&format!("{label}:a.ytd"), "a.ytd")])
                == (
                    "IOException".to_owned(),
                    format!("Archive was not found: {shown}"),
                )
        };
        assert!(missing("x64z.rpf", "x64z.rpf"), "L94");
        assert!(
            missing(
                "update/x64/dlcpacks/nopack/dlc.rpf",
                "update\\x64\\dlcpacks\\nopack\\dlc.rpf"
            ),
            "L102"
        );
        // Метка второй записи отказывает раньше, чем обработана первая; папки вариантов уже созданы.
        assert_eq!(
            go(vec![
                item("x64e.rpf:levels/gta5/plain.ytd", "plain.ytd"),
                item("nocolon", "b.ytd")
            ]),
            no_archive("nocolon"),
            "L113"
        );
        assert!(
            !bench.at("levels/64").exists(),
            "L90: пустая папка варианта убрана (раньше оставалась)"
        );
        // Вторая группа неподдерживаемая: файлы первой уже лежат, отчёта нет.
        let outcome = go(vec![
            item("x64e.rpf:levels/gta5/plain.ytd", "plain.ytd"),
            item("common.rpf:a.ytd", "a.ytd"),
        ]);
        assert_eq!(
            outcome,
            invalid("Unsupported archive label: common.rpf"),
            "L114"
        );
        assert!(bench.at("levels/64/plain.ytd").is_file());
        assert!(!Path::new(&report).exists());
    }

    #[test]
    fn game_and_keys_come_before_the_variant_folders() {
        let bench = Bench::new();
        let request = base(&bench);
        let report = bench.path("out/report.json");
        let go = |edits: &[(&str, Option<Value>)]| {
            failure(&bench.exec(&patched(&request, edits), Some(&report)))
        };
        let folder = invalid("GTA V folder was not found.");
        assert_eq!(go(&[("/gameRoot", None)]), folder, "L70");
        assert_eq!(
            go(&[("/gameRoot", Some(json!(bench.path("none"))))]),
            folder,
            "L71"
        );
        assert_eq!(go(&[("/gameRoot", Some(json!(5)))]), folder, "L73");
        assert_eq!(go(&[("/gameRoot", Some(json!("")))]), folder, "L74");
        let file = bench.put("game", b"not a folder");
        assert_eq!(go(&[("/gameRoot", Some(json!(file)))]), folder, "L72");
        fs::remove_file(bench.at("game")).unwrap();
        fs::create_dir_all(bench.at("game")).unwrap();
        let (code, message) = go(&[("/keys", Some(json!(bench.path("nope-keys"))))]);
        assert_eq!(code, "InvalidOperationException", "L75");
        assert!(
            message.starts_with("The GTA V RPF key file gtav_aes_key.dat could not be read from "),
            "{message}"
        );
        let empty_keys = bench.path("emptykeys");
        fs::create_dir_all(&empty_keys).unwrap();
        assert_eq!(
            go(&[("/keys", Some(json!(empty_keys)))]).0,
            "InvalidOperationException",
            "L78"
        );
        let (_, message) = go(&[
            ("/gameRoot", Some(json!(bench.path("game")))),
            ("/keys", Some(json!(""))),
        ]);
        if std::env::var_os("MODOVIK_GTA_KEYS_PATH").is_none() {
            assert_eq!(
                message, "GTA V executable was not found for in-memory key discovery.",
                "L81"
            );
            assert_eq!(
                go(&[("/keys", Some(json!(5)))]).1,
                "GTA V executable was not found for in-memory key discovery.",
                "L79"
            );
        }
        // До ключей папки вариантов не создаются.
        assert!(!bench.at("levels").exists());
    }

    fn report_of(bench: &Bench, outcome: &(Value, i32)) -> Value {
        assert_eq!(outcome.1, 0, "{}", outcome.0);
        serde_json::from_slice(&fs::read(bench.at("out/report.json")).unwrap()).unwrap()
    }

    #[test]
    fn records_are_read_from_a_real_archive_and_reported_by_group() {
        let bench = Bench::new();
        let (first, second) = fake_game(&bench);
        let request = base(&bench);
        let report = bench.path("out/report.json");
        let nested = "x64e.rpf:levels/gta5/vehicles.rpf/";
        let items = vec![
            item(&format!("{nested}adder.ytd"), "Some\\Dir/ADDER.YTD"),
            item("update:x64/nope.ytd", "nope.ytd"),
            item(
                "X64E.RPF:LEVELS/GTA5//VEHICLES.RPF/scorcher+hi.ytd/",
                "scorcher+hi.ytd",
            ),
            item(&format!("{nested}adder.ytd"), "adder.txt"),
            item(&format!("{nested}adder.ytd"), ".ytd"),
            json!({ "at": format!("{nested}adder.ytd") }),
            item(&format!("{nested}adder.ytd"), "adder.yft"),
            item("x64e.rpf:levels/gta5", "dir.ytd"),
            item("x64e.rpf:", "a.ytd"),
            item("x64e.rpf:\\levels\\gta5\\plain.ytd", "a.ytd"),
            item(&format!("{nested}nope/adder.ytd"), "adder.ytd"),
            item(&format!("{nested}adder.ytd"), "adder.ydr"),
            item("x64e.rpf:levels/gta5/plain.ytd", "plain.ytd"),
        ];
        let outcome = bench.exec(
            &patched(&request, &[("/items", Some(Value::Array(items.clone())))]),
            Some(&report),
        );
        assert_eq!(outcome.1, 0, "{}", outcome.0);
        assert_eq!(outcome.0["result"]["dictionaries"], json!(13));
        assert_eq!(outcome.0["result"]["missing"], json!(4));
        assert_eq!(outcome.0["result"]["failed"], json!(4));
        assert_eq!(outcome.0["result"]["output"], json!(report));
        let body = report_of(&bench, &outcome);
        assert_eq!(
            (
                body["caps"].clone(),
                body["stages"].clone(),
                body["dictionaries"].clone()
            ),
            (json!([64]), json!([]), json!(13))
        );
        let records = body["items"].as_array().unwrap();
        // Группы по меткам: сначала x64e (в порядке запроса), потом update.
        let names: Vec<&str> = records
            .iter()
            .map(|record| record["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "adder.ytd",
                "scorcher+hi.ytd",
                "adder.txt",
                ".ytd",
                "",
                "adder.yft",
                "dir.ytd",
                "a.ytd",
                "a.ytd",
                "adder.ytd",
                "adder.ydr",
                "plain.ytd",
                "nope.ytd"
            ]
            .map(String::from),
            "порядок по группам"
        );
        assert_eq!(records[0]["original"], json!(first.len()));
        assert_eq!(records[0]["levels"][0]["variant"], json!("64"));
        assert_eq!(records[1]["original"], json!(second.len()));
        assert_eq!(
            records[2]["error"],
            json!("not a texture dictionary or model name")
        );
        assert_eq!(
            records[3]["error"],
            json!("not a texture dictionary or model name")
        );
        assert_eq!(
            records[4]["error"],
            json!("not a texture dictionary or model name")
        );
        assert_eq!(
            records[5]["error"],
            json!("downscale-textures: фрагменты .yft ещё не перенесены в движок.")
        );
        assert_eq!(
            records[6],
            json!({ "at": "x64e.rpf:levels/gta5", "name": "dir.ytd", "missing": true })
        );
        assert_eq!(records[7]["missing"], json!(true), "L118");
        assert_eq!(records[8]["textures"], json!(1), "L98");
        assert_eq!(records[9]["missing"], json!(true), "L124");
        assert_eq!(
            records[10],
            json!({ "at": format!("{nested}adder.ytd"), "name": "adder.ydr", "original": first.len(), "textures": 0, "levels": [] }),
            "L126"
        );
        assert_eq!(records[12]["missing"], json!(true));
        // Файлы вариантов совпадают с отчётом.
        let produced = fs::read(bench.at("levels/64/adder.ytd")).unwrap();
        assert_eq!(records[0]["levels"][0]["bytes"], json!(produced.len()));
        assert_eq!(
            records[0]["levels"][0]["sha256"],
            json!(sha256_hex(&produced))
        );
        // Одинаковое имя у двух записей: файл второй, обе записи в отчёте.
        assert_eq!(records[8]["name"], records[7]["name"]);
        assert_eq!(
            fs::read(bench.at("levels/64/a.ytd")).unwrap().len(),
            records[8]["levels"][0]["bytes"].as_u64().unwrap() as usize
        );
        // Строчное имя из пути с обратными слэшами.
        assert!(bench.at("levels/64/scorcher+hi.ytd").is_file());
    }

    /// Две прочитанные записи с одним итоговым именем: вторая отказывает в отчёте, файл первой не затёрт (раньше затирался).
    #[test]
    fn a_second_read_item_with_the_same_output_name_does_not_overwrite_the_first() {
        let bench = Bench::new();
        fake_game(&bench);
        let request = base(&bench);
        let report = bench.path("out/report.json");
        let items = vec![
            item("x64e.rpf:levels/gta5/plain.ytd", "plain.ytd"),
            item("x64e.rpf:levels/gta5/plain.ytd", "PLAIN.ytd"),
        ];
        let outcome = bench.exec(
            &patched(&request, &[("/items", Some(Value::Array(items)))]),
            Some(&report),
        );
        let body = report_of(&bench, &outcome);
        let records = body["items"].as_array().unwrap();
        let written = fs::read(bench.at("levels/64/plain.ytd")).unwrap();
        assert_eq!(records[0]["levels"][0]["bytes"], json!(written.len()));
        assert_eq!(
            records[1]["error"],
            json!("an earlier item already wrote the output file with this name")
        );
        assert_eq!(outcome.0["result"]["failed"], json!(1));
    }

    #[test]
    fn a_full_chain_is_cut_without_recompression_and_stays_a_whole_dictionary() {
        // Полная цепочка 128×128 до 1×1: хост её режет (`resampled: 0`), а не пересжимает (замер на игре 16.11:
        // 5 записей из 1 440 были пересжаты движком вместо среза).
        let bench = Bench::new();
        let source = dictionary(&["t_full:128x128:DXT1:8", "t_deep:256x128:DXT5:9"]);
        let record = process(&bench, ".ytd", &source, &[64, 32], &[]).unwrap();
        for (index, cap) in [64, 32].into_iter().enumerate() {
            assert_eq!(record["levels"][index]["cap"], json!(cap));
            assert_eq!(record["levels"][index]["changed"], json!(2), "cap {cap}");
            assert_eq!(record["levels"][index]["resampled"], json!(0), "cap {cap}");
        }
        let before = ytd_write::read_entries(&source).unwrap();
        let cut = ytd_write::read_entries(&fs::read(bench.at("out/64/t.ytd")).unwrap()).unwrap();
        let find = |list: &[ytd_write::Entry], name: &str| list.iter().find(|entry| entry.name == name).unwrap().clone();
        // 128×128 DXT1 → 64×64, 7 ступеней; данные — хвост прежних байт, а недостающее до длины писателя — нули.
        let (was, now) = (find(&before, "t_full"), find(&cut, "t_full"));
        assert_eq!((now.width, now.height, now.levels, now.stride), (64, 64, 7, 32));
        assert_eq!(now.payload[..2730], was.payload[8192..8192 + 2730]);
        assert!(now.payload[2730..].iter().all(|byte| *byte == 0));
        // 256×128 DXT5 → 64×32 при пределе 64: три ступени срезаны, остаток — ровно хвост.
        let (was, now) = (find(&before, "t_deep"), find(&cut, "t_deep"));
        assert_eq!((now.width, now.height), (64, 32));
        assert_eq!(usize::from(now.levels), usize::from(was.levels) - 2);
        // Данные мелких текстур лежат вплотную, как у хоста: словарь — две страницы по 8 КБ, а не по странице на текстуру.
        let variant = fs::read(bench.at("out/64/t.ytd")).unwrap();
        assert!(Resource::parse(&variant).unwrap().len() <= 0x4000, "{} байт", Resource::parse(&variant).unwrap().len());
    }

    #[test]
    fn a_dictionary_under_a_model_name_and_back_are_reported_per_record() {
        let bench = Bench::new();
        fake_game(&bench);
        let request = base(&bench);
        let report = bench.path("out/report.json");
        let items = vec![
            item("x64e.rpf:levels/gta5/plain.ytd", "plain.ydr"),
            item("x64e.rpf:levels/gta5/vehicles.rpf", "vehicles.ytd"),
        ];
        let outcome = bench.exec(
            &patched(&request, &[("/items", Some(Value::Array(items)))]),
            Some(&report),
        );
        let body = report_of(&bench, &outcome);
        assert_eq!(body["items"][0]["textures"], json!(0), "L126");
        assert_eq!(outcome.0["result"]["missing"], json!(0));
        // Вложенный архив под именем словаря читается как двоичная запись и не разбирается как словарь.
        assert_eq!(body["items"][1]["error"], json!("resource did not load"));
        // Пределы и стадии нормализуются в отчёте; лишние папки вариантов создаются заранее.
        let more = patched(
            &request,
            &[
                ("/caps", Some(json!([64, 128, 64, 256]))),
                ("/stages", Some(json!([" GrayScale ", "grayscale", 5]))),
            ],
        );
        let outcome = bench.exec(&more, Some(&report));
        let body = report_of(&bench, &outcome);
        assert_eq!(
            (body["caps"].clone(), body["stages"].clone()),
            (json!([256, 128, 64]), json!(["grayscale"]))
        );
        for folder in ["256+grayscale", "128+grayscale", "64+grayscale"] {
            assert!(bench.at(&format!("levels/{folder}")).is_dir(), "{folder}");
        }
    }

    #[test]
    fn an_output_directory_that_is_a_file_is_an_io_failure() {
        let bench = Bench::new();
        fake_game(&bench);
        let request = base(&bench);
        let file = bench.put("levels", b"x");
        let outcome = bench.exec(
            &patched(&request, &[("/outputDirectory", Some(json!(file)))]),
            Some(&bench.path("out/report.json")),
        );
        assert_eq!(failure(&outcome).0, "IOException");
    }
}
