//! Картинки из архивов установки: диски неба, плитки большой карты и
//! предпросмотр. Модуль только читает архивы; на диск уходят одни PNG.

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use rage_res::{
    convert::{extract_textures, Dictionary},
    png_io,
    texture::{self, Image, TextureRef},
    Resource,
};
use rage_rpf::{Archive, Entry, EntryId, EntryKind, KeySet};
use serde_json::Value;

use super::{game_root, index::compare_ignore_case, load_keys, sha256_hex};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths::{existing_file, full_path, normalize_relative},
    progress::Progress,
};

const SKY_ABSENT: &str = "skydome.ytd was not found in the game archives.";
const SKY_HUGE: &str = "skydome.ytd is too large to decode.";
const SKY_NO_SLOTS: &str = "skydome.ytd holds none of the expected sky textures.";
const NO_TILES: &str = "Плитки большой карты не найдены в архивах игры.";
const NO_TILE_TEXTURES: &str = "В плитках большой карты не нашлось текстур.";

/// Словарь тяжелее этого (64 МиБ) за словарь не считается.
const DICTIONARY_CEILING: usize = 64 << 20;
/// Корень архива — нулевая глубина; ниже восьмой обход не спускается.
const MAX_DEPTH: u32 = 8;
/// Сколько каталогов ниже корня просматривает поиск неба.
const SKY_FOLDERS: u32 = 6;
/// Достаточное число плиток: после архива, где оно набралось, обход кончается.
const TILE_STOP: usize = 64;
const CATALOG_LIMIT: usize = 4000;

const SKY_FILE: &str = "skydome.ytd";
const SKY_SLOTS: [(&str, &[&str]); 2] = [
    ("moon", &["moon-new", "moon"]),
    ("starfield", &["starfield", "starsfield"]),
];

const LOADER_FILES: [&str; 3] = ["dinput8.dll", "xinput1_4.dll", "dsound.dll"];
const PLUGIN_FILES: [&str; 4] = ["OpenIV.asi", "RageOpenV.asi", "OpenRPF.asi", "ClosedIV.asi"];
const DLC_ROOT: &str = "update/x64/dlcpacks";

// ---------------------------------------------------------------------------
// Записи ответа и мелочи
// ---------------------------------------------------------------------------

/// Пара «ключ, значение» для `object`.
fn field<V: Into<Value>>(key: &'static str, value: V) -> (&'static str, Value) {
    (key, value.into())
}

/// Объект JSON с ключами в порядке перечисления.
fn object(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn show_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn invalid_data_of(error: rage_res::Error) -> EngineError {
    EngineError::invalid_data(error.message)
}

fn resolve_keys(root: &Path, options: &Options) -> Result<(Arc<KeySet>, &'static str)> {
    load_keys(&show_path(root), options.optional("keys"))
}

/// Имена записей каталога, прошедших `keep`; нечитаемый каталог пуст.
fn entry_names(folder: &Path, keep: fn(&Path) -> bool) -> Vec<String> {
    // Первый `flatten` раскрывает `Result<ReadDir>`, второй — `Result<DirEntry>`.
    fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| keep(&entry.path()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect()
}

fn open_archive_file(path: &Path, keys: &Arc<KeySet>) -> Option<Archive> {
    if !path.is_file() {
        return None;
    }
    Archive::open_path(path, Some(Arc::clone(keys))).ok()
}

fn open_under(root: &Path, name: &str, keys: &Arc<KeySet>) -> Option<Archive> {
    open_archive_file(&root.join(name), keys)
}

/// Имя текстуры, пригодное для файла (без расширения).
fn file_stem(texture_name: &str) -> String {
    let swapped: String = texture_name
        .chars()
        .map(|ch| match ch {
            _ if ch.is_control() => '_',
            '"' | '<' | '>' | '|' | ':' | '*' | '?' | '\\' | '/' => '_',
            other => other,
        })
        .collect();
    match swapped.trim() {
        "" => String::from("texture"),
        kept => kept.to_string(),
    }
}

/// Пишет PNG файлом `<имя>.png` и возвращает его путь строкой.
fn store_png(dir: &Path, texture_name: &str, png: &[u8]) -> Result<String> {
    let target = dir.join(file_stem(texture_name) + ".png");
    fs::write(&target, png)?;
    Ok(show_path(&target))
}

/// PNG самого крупного уровня; `None`, если текстура не декодируется.
fn png_of(res: &Resource, texture: &TextureRef) -> Option<Vec<u8>> {
    match texture::decode(res, texture, Some(0), None) {
        Ok(Image {
            width,
            height,
            rgba,
            ..
        }) => png_io::encode(width, height, &rgba).ok(),
        Err(_) => None,
    }
}

fn format_text(texture: &TextureRef) -> String {
    match texture.format {
        Some(known) => format!("D3DFMT_{}", known.name()),
        None => texture.format_code.to_string(),
    }
}

/// Общий хвост строк о текстуре: размеры, число уровней, формат.
fn size_fields(texture: &TextureRef) -> [(&'static str, Value); 4] {
    [
        field("width", texture.width),
        field("height", texture.height),
        field("levels", texture.levels),
        field("format", format_text(texture)),
    ]
}

// ---------------------------------------------------------------------------
// Порядок просмотра архивов
// ---------------------------------------------------------------------------

/// Слой модов включён, когда есть и загрузчик, и плагин.
fn mods_enabled(root: &Path) -> bool {
    [&LOADER_FILES[..], &PLUGIN_FILES[..]]
        .iter()
        .all(|group| group.iter().any(|name| root.join(name).is_file()))
}

fn other_archives(root: &Path) -> Vec<String> {
    let mut names = entry_names(root, Path::is_file);
    names.retain(|name| {
        let lower = name.to_ascii_lowercase();
        lower != "x64a.rpf" && lower.starts_with("x64") && lower.ends_with(".rpf")
    });
    names.sort_by(|left, right| compare_ignore_case(left, right));
    names
}

/// Имена архивов игры в том порядке, в каком движок их открывает. Это только
/// имена: есть ли файл на диске, решает вызывающий.
pub fn archive_search_order(game_root: &Path) -> Vec<String> {
    let layered = mods_enabled(game_root);
    ["x64a.rpf", "update/update.rpf"]
        .into_iter()
        .map(str::to_owned)
        .chain(other_archives(game_root))
        .map(|name| {
            let modded = format!("mods/{name}");
            if layered && game_root.join(&modded).is_file() {
                modded
            } else {
                name
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Обход записей архива
// ---------------------------------------------------------------------------

/// Что ещё предстоит обойти: каталог целиком или одна запись.
enum Pending {
    Folder {
        archive: Rc<Archive>,
        id: EntryId,
        prefix: String,
        depth: u32,
    },
    Item {
        archive: Rc<Archive>,
        id: EntryId,
        prefix: String,
        depth: u32,
    },
}

/// Файл, на который наткнулся обход: чей он и по какому пути лежит.
struct Spot {
    archive: Rc<Archive>,
    id: EntryId,
    path: String,
}

impl Spot {
    fn name(&self) -> &str {
        &self.archive.entry(self.id).name
    }

    /// Содержимое, годное под словарь: читается, не пусто, не тяжелее предела.
    fn dictionary_bytes(&self) -> Option<Vec<u8>> {
        match self.archive.export(self.id) {
            Ok(bytes) if !bytes.is_empty() && bytes.len() <= DICTIONARY_CEILING => Some(bytes),
            _ => None,
        }
    }
}

fn holds_archive(entry: &Entry) -> bool {
    matches!(entry.kind, EntryKind::Binary(_)) && Archive::is_nested_archive_name(&entry.name)
}

/// Ленивый обход на стеке задач: файлы каталога (вложенные `.rpf`
/// раскрываются на месте), затем его подкаталоги по очереди.
struct Crawl {
    todo: Vec<Pending>,
}

impl Crawl {
    fn over(archive: Archive) -> Crawl {
        let archive = Rc::new(archive);
        let top = Pending::Folder {
            id: archive.root(),
            archive,
            prefix: String::new(),
            depth: 0,
        };
        Crawl { todo: vec![top] }
    }

    /// Кладёт содержимое каталога на стек: подкаталоги первыми, чтобы они
    /// вышли после файлов.
    fn schedule(&mut self, archive: &Rc<Archive>, dir: EntryId, prefix: &str, depth: u32) {
        if depth < MAX_DEPTH {
            let subfolders = archive.dirs(dir).iter().rev().map(|&sub| Pending::Folder {
                archive: Rc::clone(archive),
                id: sub,
                prefix: format!("{prefix}{}/", archive.entry(sub).name),
                depth: depth + 1,
            });
            self.todo.extend(subfolders);
        }
        let files = archive.files(dir).iter().rev().map(|&id| Pending::Item {
            archive: Rc::clone(archive),
            id,
            prefix: prefix.to_owned(),
            depth,
        });
        self.todo.extend(files);
    }
}

impl Iterator for Crawl {
    type Item = Spot;

    fn next(&mut self) -> Option<Spot> {
        while let Some(task) = self.todo.pop() {
            match task {
                Pending::Folder {
                    archive,
                    id,
                    prefix,
                    depth,
                } => self.schedule(&archive, id, &prefix, depth),
                Pending::Item {
                    archive,
                    id,
                    prefix,
                    depth,
                } => {
                    let (path, nested) = {
                        let entry = archive.entry(id);
                        (format!("{prefix}{}", entry.name), holds_archive(entry))
                    };
                    if !nested {
                        return Some(Spot { archive, id, path });
                    }
                    // Негодный вложенный архив тихо пропускаем.
                    if depth < MAX_DEPTH {
                        if let Ok(inner) = archive.open_nested(id) {
                            let inner = Rc::new(inner);
                            self.schedule(&inner, inner.root(), &format!("{path}/"), depth + 1);
                        }
                    }
                }
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// extract-sky-textures
// ---------------------------------------------------------------------------

fn find_skydome(archive: &Archive, dir: EntryId, depth: u32) -> Option<EntryId> {
    let here = archive.find_file(dir, SKY_FILE);
    let deeper = || {
        (depth < SKY_FOLDERS)
            .then(|| {
                let mut below = archive.dirs(dir).iter();
                below.find_map(|&sub| find_skydome(archive, sub, depth + 1))
            })
            .flatten()
    };
    here.or_else(deeper)
}

/// Первый архив порядка просмотра, где словарь неба нашёлся и прочитался.
fn first_skydome(root: &Path, keys: &Arc<KeySet>) -> Result<(String, Vec<u8>)> {
    let found = archive_search_order(root).into_iter().find_map(|name| {
        let archive = open_under(root, &name, keys)?;
        let entry = find_skydome(&archive, archive.root(), 0)?;
        Some((name, archive.export(entry).ok()?))
    });
    found.ok_or_else(|| EngineError::file_not_found(SKY_ABSENT))
}

/// Текстура, выбранная для слота неба.
struct DiscPick<'a> {
    slot: &'static str,
    listed: &'static str,
    png: &'a [u8],
}

impl<'a> DiscPick<'a> {
    /// Первое из имён слота, которое есть среди текстур словаря.
    fn choose(
        slot: &'static str,
        names: &[&'static str],
        sheets: &'a [(String, Vec<u8>)],
    ) -> Option<DiscPick<'a>> {
        names.iter().find_map(|&listed| {
            let at = sheets
                .iter()
                .position(|(have, _)| have.eq_ignore_ascii_case(listed))?;
            Some(DiscPick {
                slot,
                listed,
                png: &sheets[at].1,
            })
        })
    }

    fn write_to(&self, dir: &Path) -> Result<Value> {
        let file = store_png(dir, self.slot, self.png)?;
        Ok(object([
            field("slot", self.slot),
            field("name", self.listed),
            field("file", file),
            field("bytes", self.png.len()),
            field("sha256", sha256_hex(self.png).to_ascii_uppercase()),
        ]))
    }
}

pub fn extract_sky_textures(options: &Options, _progress: &Progress) -> Result<Value> {
    let root = game_root(options)?;
    let out_dir = options.required("output").and_then(full_path)?;
    fs::create_dir_all(&out_dir)?;
    let (keys, key_source) = resolve_keys(&root, options)?;

    let (archive_name, bytes) = first_skydome(&root, &keys)?;
    let sheets = match bytes.len() {
        len if len > DICTIONARY_CEILING => return Err(EngineError::invalid_data(SKY_HUGE)),
        _ => extract_textures(&bytes).map_err(invalid_data_of)?,
    };
    let picks: Vec<DiscPick> = SKY_SLOTS
        .iter()
        .filter_map(|&(slot, names)| DiscPick::choose(slot, names, &sheets))
        .collect();
    if picks.is_empty() {
        return Err(EngineError::invalid_data(SKY_NO_SLOTS));
    }

    let written = picks
        .iter()
        .map(|pick| pick.write_to(&out_dir))
        .collect::<Result<Vec<Value>>>()?;
    let missing: Vec<&str> = SKY_SLOTS
        .iter()
        .map(|(slot, _)| *slot)
        .filter(|slot| !picks.iter().any(|pick| pick.slot == *slot))
        .collect();
    Ok(object([
        field("archive", archive_name),
        field("entry", SKY_FILE),
        field("textures", written),
        field("missing", missing),
        field("keySource", key_source),
    ]))
}

// ---------------------------------------------------------------------------
// Плитки большой карты
// ---------------------------------------------------------------------------

/// Плитка атласа: словарь целиком и откуда он взят.
pub(crate) struct Tile {
    pub(crate) archive: String,
    pub(crate) entry: String,
    pub(crate) file: String,
    pub(crate) bytes: Vec<u8>,
}

fn is_number(text: &str) -> bool {
    matches!(text.len(), 1..) && text.chars().all(|ch| ch.is_ascii_digit())
}

/// `minimap_<ряд>_<столбец>.ytd` и `minimap_sea_<ряд>_<столбец>.ytd`.
fn is_tile_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let Some(stem) = lower.strip_suffix(".ytd") else {
        return false;
    };
    let parts: Vec<&str> = stem.split('_').collect();
    match parts.as_slice() {
        ["minimap", row, column] | ["minimap", "sea", row, column] => {
            is_number(row) && is_number(column)
        }
        _ => false,
    }
}

/// Поиск плиток как итератор: держит очередь архивов, текущий обход и
/// множество занятых имён.
struct TileSearch<'a> {
    root: &'a Path,
    keys: &'a Arc<KeySet>,
    base: Option<&'a Path>,
    queue: std::vec::IntoIter<String>,
    current: Option<(String, Crawl)>,
    seen: BTreeSet<String>,
    yielded: usize,
    /// После архива, давшего столько плиток, дальше не ищем; `None` — ищем во всех.
    stop_at: Option<usize>,
    /// Имена (нижний регистр), которые нужны; словари остальных плиток не извлекаются. `None` — нужны все.
    only: Option<BTreeSet<String>>,
    /// Сколько из нужных имён ещё не отдано; на нуле обход кончается, не доходя до конца списка архивов.
    left: Option<usize>,
}

impl<'a> TileSearch<'a> {
    fn new(
        root: &'a Path,
        keys: &'a Arc<KeySet>,
        base: Option<&'a Path>,
        stop_at: Option<usize>,
    ) -> Self {
        TileSearch {
            root,
            keys,
            base,
            queue: archive_search_order(root).into_iter(),
            current: None,
            seen: BTreeSet::new(),
            yielded: 0,
            stop_at,
            only: None,
            left: None,
        }
    }

    /// Отдавать только плитки с этими именами (нижний регистр).
    fn only(mut self, names: &BTreeSet<String>) -> Self {
        self.left = Some(names.len());
        self.only = Some(names.clone());
        self
    }

    /// Обход архива порядка просмотра; `update.rpf` подменяется базой, если она задана.
    fn open(&self, name: &str) -> Option<Crawl> {
        let source = match self.base {
            Some(replacement) if name.to_ascii_lowercase().ends_with("update/update.rpf") => {
                replacement.to_path_buf()
            }
            _ => self.root.join(name),
        };
        open_archive_file(&source, self.keys).map(Crawl::over)
    }
}

impl Iterator for TileSearch<'_> {
    type Item = Tile;

    fn next(&mut self) -> Option<Tile> {
        loop {
            if self.left == Some(0) {
                return None;
            }
            let Some((label, walk)) = self.current.as_mut() else {
                let name = self.queue.next()?;
                self.current = self.open(&name).map(|walk| (name, walk));
                continue;
            };
            let seen = &mut self.seen;
            let only = self.only.as_ref();
            let found = walk.find_map(|hit| {
                let file = hit.name();
                let lower = is_tile_name(file).then(|| file.to_ascii_lowercase());
                // Имя занято с первой встречи, даже если плитка потом негодна.
                let fresh = lower
                    .as_ref()
                    .is_some_and(|name| seen.replace(name.clone()).is_none());
                // Словарь извлекается только у нужной плитки: остальные не попадают в память.
                let wanted = fresh
                    && lower
                        .as_ref()
                        .is_some_and(|name| only.map_or(true, |names| names.contains(name)));
                let bytes = wanted.then(|| hit.dictionary_bytes()).flatten()?;
                Some(Tile {
                    archive: label.clone(),
                    entry: hit.path.clone(),
                    file: file.to_owned(),
                    bytes,
                })
            });
            if let Some(tile) = found {
                self.yielded += 1;
                if let Some(left) = self.left.as_mut() {
                    *left = left.saturating_sub(1);
                }
                return Some(tile);
            }
            // Архив пройден целиком: набралось достаточно — дальше не идём.
            self.current = None;
            if self.stop_at.is_some_and(|limit| self.yielded >= limit) {
                self.queue = Vec::new().into_iter();
            }
        }
    }
}

/// Плитки для `extract-map-tiles`: после архива, давшего 64 плитки, следующие не читаются.
pub(crate) fn find_map_tiles(root: &Path, keys: &Arc<KeySet>, base: Option<&Path>) -> Vec<Tile> {
    TileSearch::new(root, keys, base, Some(TILE_STOP)).collect()
}

/// Плитки из всех архивов порядка просмотра, без остановки по числу и без отбора по именам: проверкам порядка архивов
/// (`build-map-patch` берёт `find_named_map_tiles`: держать в памяти все плитки игры ему незачем).
#[cfg(test)]
pub(crate) fn find_all_map_tiles(
    root: &Path,
    keys: &Arc<KeySet>,
    base: Option<&Path>,
) -> Vec<Tile> {
    TileSearch::new(root, keys, base, None).collect()
}

/// Плитки с именами из `names` (нижний регистр) из всех архивов порядка просмотра: плитка ищется по имени из запроса и
/// может лежать в позднем архиве (например в `update.rpf`), поэтому остановки по числу нет. Порядок архивов и правило
/// занятого имени те же, что у `find_all_map_tiles`; словари остальных плиток не извлекаются, обход кончается,
/// когда нужные найдены.
pub(crate) fn find_named_map_tiles(
    root: &Path,
    keys: &Arc<KeySet>,
    base: Option<&Path>,
    names: &BTreeSet<String>,
) -> Vec<Tile> {
    TileSearch::new(root, keys, base, None)
        .only(names)
        .collect()
}

/// Раскладывает одну плитку: PNG каждой читаемой текстуры и строки ответа.
fn write_tile(tile: &Tile, out_dir: &Path) -> Result<Vec<Value>> {
    let dictionary = Dictionary::parse(&tile.file, &tile.bytes).map_err(invalid_data_of)?;
    dictionary
        .textures()
        .iter()
        .filter_map(|texture| png_of(dictionary.resource(), texture).map(|png| (texture, png)))
        .map(|(texture, png)| {
            let png_path = store_png(out_dir, &texture.name, &png)?;
            let head = [
                field("archive", tile.archive.as_str()),
                field("entry", tile.entry.as_str()),
                field("file", tile.file.as_str()),
                field("texture", texture.name.as_str()),
            ];
            let tail = [field("png", png_path), field("bytes", png.len())];
            Ok(object(
                head.into_iter().chain(size_fields(texture)).chain(tail),
            ))
        })
        .collect()
}

pub fn extract_map_tiles(options: &Options, _progress: &Progress) -> Result<Value> {
    let root = game_root(options)?;
    let out_dir = options.required("output").and_then(full_path)?;
    let (keys, key_source) = resolve_keys(&root, options)?;
    let base = match options.optional("base-archive") {
        Some(given) => Some(existing_file(given, &[".rpf"])?),
        None => None,
    };
    fs::create_dir_all(&out_dir)?;

    let mut tiles = match find_map_tiles(&root, &keys, base.as_deref()) {
        found if found.is_empty() => return Err(EngineError::file_not_found(NO_TILES)),
        found => found,
    };
    // Предел плиток действует и внутри архива: остаются первые по порядку поиска.
    tiles.truncate(TILE_STOP);
    let per_tile = tiles
        .iter()
        .map(|tile| write_tile(tile, &out_dir))
        .collect::<Result<Vec<Vec<Value>>>>()?;
    let rows: Vec<Value> = per_tile.into_iter().flatten().collect();
    if rows.is_empty() {
        return Err(EngineError::invalid_data(NO_TILE_TEXTURES));
    }

    let map = object([
        field("output", show_path(&out_dir)),
        field("count", rows.len()),
        field("tiles", rows),
    ]);
    Ok(object([
        field("keySource", key_source),
        field("baseArchive", base.as_deref().map(show_path)),
        field("map", map),
    ]))
}

// ---------------------------------------------------------------------------
// Предпросмотр: маски, режимы, сбор
// ---------------------------------------------------------------------------

/// Маска с `*` и `?` без учёта регистра; совпасть должна вся строка.
struct Pattern(Vec<char>);

impl Pattern {
    fn compile(pattern: &str) -> Pattern {
        Pattern(Vec::from_iter(pattern.trim().to_lowercase().chars()))
    }

    /// Разбор по столбцам: `reach[j]` — начало маски, уже съеденное,
    /// покрывает ровно `j` первых знаков текста.
    fn fits(&self, text: &[char]) -> bool {
        let mut reach = vec![false; text.len() + 1];
        reach[0] = true;
        for &piece in &self.0 {
            if piece == '*' {
                for column in 1..reach.len() {
                    reach[column] |= reach[column - 1];
                }
            } else {
                for column in (1..reach.len()).rev() {
                    reach[column] =
                        reach[column - 1] && (piece == '?' || piece == text[column - 1]);
                }
                reach[0] = false;
            }
        }
        reach[text.len()]
    }
}

/// Список масок: пустой список пропускает всё.
struct MaskSet(Vec<Pattern>);

impl MaskSet {
    fn from_values(values: &[String]) -> MaskSet {
        MaskSet(
            values
                .iter()
                .map(String::as_str)
                .map(Pattern::compile)
                .collect(),
        )
    }

    fn is_vacant(&self) -> bool {
        self.0.is_empty()
    }

    fn admits(&self, text: &str) -> bool {
        self.is_vacant() || {
            let lowered = text.to_lowercase().chars().collect::<Vec<_>>();
            self.0.iter().any(|mask| mask.fits(&lowered))
        }
    }
}

enum Purpose {
    Catalog,
    Inspect,
    Extract(PathBuf),
}

impl Purpose {
    fn label(&self) -> &'static str {
        match self {
            Purpose::Catalog => "catalog",
            Purpose::Inspect => "inspect",
            Purpose::Extract(_) => "extract",
        }
    }
}

/// Предел из `--limit`: положительное 32-битное число, всё прочее — «без предела».
fn parse_limit(raw: Option<&str>) -> Option<usize> {
    let number: i32 = raw?.trim().parse().ok()?;
    usize::try_from(number).ok().filter(|&limit| limit > 0)
}

fn looks_like_ytd(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".ytd")
}

/// Пакеты DLC с файлом `dlc.rpf`; `filter` — подстрока имени папки.
fn dlc_archives(root: &Path, filter: Option<&str>) -> Vec<String> {
    let needle = filter
        .map(|text| text.trim().to_lowercase())
        .filter(|text| !text.is_empty());
    let base = root.join(DLC_ROOT);
    let mut folders = entry_names(&base, Path::is_dir);
    folders.sort_by(|left, right| compare_ignore_case(left, right));
    folders.retain(|folder| {
        let named = needle
            .as_deref()
            .is_none_or(|part| folder.to_lowercase().contains(part));
        named && base.join(folder).join("dlc.rpf").is_file()
    });
    folders
        .into_iter()
        .map(|folder| format!("{DLC_ROOT}/{folder}/dlc.rpf"))
        .collect()
}

/// Архивы просмотра: названные `--archive` или порядок игры плюс DLC.
fn preview_archives(root: &Path, options: &Options) -> Result<Vec<String>> {
    match options.values("archive") {
        [] => {
            let mut order = archive_search_order(root);
            order.extend(dlc_archives(root, options.optional("dlc")));
            Ok(order)
        }
        named => named
            .iter()
            .map(|given| normalize_relative(given))
            .collect(),
    }
}

/// Состояние одного прохода предпросмотра.
struct Collector {
    intent: Purpose,
    cap: usize,
    by_dictionary: MaskSet,
    by_texture: MaskSet,
    listed: Vec<Value>,
    found: Vec<Value>,
    claimed: BTreeSet<String>,
    /// Предел набран, а подходящее за ним нашлось: список обрезан.
    cut: bool,
}

impl Collector {
    fn saturated(&self) -> bool {
        let have = match self.intent {
            Purpose::Catalog => self.listed.len(),
            Purpose::Inspect | Purpose::Extract(_) => self.found.len(),
        };
        have >= self.cap
    }

    /// Просматривает архив; возвращает, сколько словарей под маски он дал.
    fn sweep(&mut self, label: &str, archive: Archive) -> usize {
        let mut matched = 0;
        let mut walk = Crawl::over(archive);
        while !self.saturated() {
            let Some(hit) = walk.next() else { break };
            let name = hit.name();
            let wanted = looks_like_ytd(name)
                && (self.by_dictionary.admits(&hit.path) || self.by_dictionary.admits(name));
            if wanted {
                matched += 1;
                self.absorb(label, &hit);
            }
        }
        if self.saturated() && !self.cut {
            self.cut = self.has_more(&mut walk);
        }
        matched
    }

    /// PNG и сведения для текстуры; `None` — текстуру надо пропустить.
    fn render(&self, res: &Resource, texture: &TextureRef) -> Option<(Value, usize)> {
        let Purpose::Extract(dir) = &self.intent else {
            return Some((Value::Null, 0));
        };
        let png = png_of(res, texture).filter(|png| !png.is_empty())?;
        let path = store_png(dir, &texture.name, &png).ok()?;
        Some((Value::String(path), png.len()))
    }

    /// Дошла бы текстура до списка, будь предел больше: то же, что `render`, но
    /// без записи файла (сбой записи этой проверкой не виден).
    fn would_render(&self, res: &Resource, texture: &TextureRef) -> bool {
        match self.intent {
            Purpose::Extract(_) => png_of(res, texture).is_some_and(|png| !png.is_empty()),
            Purpose::Catalog | Purpose::Inspect => true,
        }
    }

    /// Есть ли среди `queue` текстура, которую набранный предел не пустил в
    /// список. Ничего не пишет и не заносит в списки; имена занимает как обычно.
    fn has_more_textures<'a>(
        &mut self,
        res: &Resource,
        mut queue: impl Iterator<Item = &'a TextureRef>,
    ) -> bool {
        queue.any(|texture| {
            !texture.name.is_empty()
                && self.by_texture.admits(&texture.name)
                && self.claimed.replace(texture.name.to_lowercase()).is_none()
                && self.would_render(res, texture)
        })
    }

    /// Есть ли в остатке обхода словарь (или текстура), которую набранный предел
    /// не пустил в список. Счёт словарей архива и списки не трогает.
    fn has_more(&mut self, walk: &mut Crawl) -> bool {
        for hit in walk.by_ref() {
            let name = hit.name();
            let wanted = looks_like_ytd(name)
                && (self.by_dictionary.admits(&hit.path) || self.by_dictionary.admits(name));
            if !wanted {
                continue;
            }
            if matches!(self.intent, Purpose::Catalog) {
                return true;
            }
            let parsed = hit
                .dictionary_bytes()
                .and_then(|bytes| Dictionary::parse(name, &bytes).ok());
            if let Some(dictionary) = parsed {
                if self.has_more_textures(dictionary.resource(), dictionary.textures().iter()) {
                    return true;
                }
            }
        }
        false
    }

    fn absorb(&mut self, label: &str, hit: &Spot) {
        let file = hit.name();
        let entry = object([
            field("archive", label),
            field("entry", hit.path.as_str()),
            field("file", file),
        ]);
        if matches!(self.intent, Purpose::Catalog) {
            self.listed.push(entry);
            return;
        }
        let parsed = hit
            .dictionary_bytes()
            .and_then(|bytes| Dictionary::parse(file, &bytes).ok());
        let Some(dictionary) = parsed else { return };
        let relevant = dictionary
            .textures()
            .iter()
            .any(|texture| self.by_texture.admits(&texture.name));
        if !relevant {
            return;
        }
        // Словарь попадает в список до выбора текстур.
        self.listed.push(entry);
        let mut queue = dictionary.textures().iter();
        while !self.saturated() {
            let Some(texture) = queue.next() else { break };
            if texture.name.is_empty() || !self.by_texture.admits(&texture.name) {
                continue;
            }
            // Имя занимается с первой попытки, получилась картинка или нет.
            if self.claimed.replace(texture.name.to_lowercase()).is_some() {
                continue;
            }
            let Some((png_value, png_len)) = self.render(dictionary.resource(), texture) else {
                continue;
            };
            let head = [
                field("texture", texture.name.as_str()),
                field("archive", label),
                field("entry", hit.path.as_str()),
                field("dictionary", file),
            ];
            let tail = [field("png", png_value), field("bytes", png_len)];
            self.found.push(object(
                head.into_iter().chain(size_fields(texture)).chain(tail),
            ));
        }
        // Предел набран посреди словаря: остаток его текстур тоже «больше».
        if self.saturated() && !self.cut {
            self.cut = self.has_more_textures(dictionary.resource(), queue);
        }
    }
}

pub fn scan_preview_textures(options: &Options, _progress: &Progress) -> Result<Value> {
    let root = game_root(options)?;
    let (keys, key_source) = resolve_keys(&root, options)?;
    let limit = parse_limit(options.optional("limit"));
    let out_dir = match options.optional("output") {
        Some(given) => Some(full_path(given)?),
        None => None,
    };
    if let Some(dir) = &out_dir {
        fs::create_dir_all(dir)?;
    }
    let targets = preview_archives(&root, options)?;

    let by_texture = MaskSet::from_values(options.values("texture"));
    let intent = match (by_texture.is_vacant(), &out_dir) {
        (true, _) => Purpose::Catalog,
        (false, Some(dir)) => Purpose::Extract(dir.clone()),
        (false, None) => Purpose::Inspect,
    };
    let label = intent.label();
    let cap = limit.unwrap_or(match intent {
        Purpose::Catalog => CATALOG_LIMIT,
        _ => usize::MAX,
    });
    let mut scan = Collector {
        intent,
        cap,
        by_dictionary: MaskSet::from_values(options.values("dictionary")),
        by_texture,
        listed: Vec::new(),
        found: Vec::new(),
        claimed: BTreeSet::new(),
        cut: false,
    };

    let mut scanned: Vec<Value> = Vec::new();
    for name in targets.iter().filter(|name| root.join(name).is_file()) {
        if scan.cut {
            break;
        }
        let archive = open_under(&root, name, &keys);
        if scan.saturated() {
            // Предел набран раньше: оставшиеся архивы лишь проверяются на
            // «есть ли ещё», в `scanned` они не попадают.
            if let Some(archive) = archive {
                scan.cut = scan.has_more(&mut Crawl::over(archive));
            }
            continue;
        }
        let matched = archive.map_or(0, |archive| scan.sweep(name, archive));
        scanned.push(object([
            field("archive", name.as_str()),
            field("dictionaries", matched),
        ]));
    }

    let preview = object([
        field("mode", label),
        field("output", out_dir.as_deref().map(show_path)),
        field("scanned", scanned),
        field("truncated", scan.cut),
        field("dictionaries", scan.listed),
        field("textures", scan.found),
    ]);
    Ok(object([
        field("keySource", key_source),
        field("preview", preview),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_res::texture::Format;
    use rage_res::ytd_write::{payload_bytes, write, NewTexture};
    use rage_rpf::fixtures::noise;
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use tempfile::{tempdir, TempDir};

    // ----- стенд -----

    enum Node {
        Dir(String, Vec<Node>),
        Bin(String, Vec<u8>),
        Pack(String, Vec<Node>),
    }

    fn dir(name: &str, kids: Vec<Node>) -> Node {
        Node::Dir(name.to_owned(), kids)
    }

    fn bin(name: &str, bytes: Vec<u8>) -> Node {
        Node::Bin(name.to_owned(), bytes)
    }

    fn pack(name: &str, kids: Vec<Node>) -> Node {
        Node::Pack(name.to_owned(), kids)
    }

    fn build(name: &str, kids: Vec<Node>) -> DirNode {
        let mut node = DirNode::new(name);
        for kid in kids {
            match kid {
                Node::Dir(inner_name, inner) => node.dirs.push(build(&inner_name, inner)),
                Node::Bin(file_name, bytes) => node.files.push(FileNode {
                    name: file_name,
                    body: Body::Binary {
                        data: Data::memory(bytes),
                        compress: Compress::Store,
                    },
                }),
                Node::Pack(file_name, inner) => node.files.push(FileNode {
                    name: file_name,
                    body: Body::Nested(Box::new(build("", inner))),
                }),
            }
        }
        node
    }

    /// Файл с недостающими родительскими папками.
    fn put(world: &Path, rel: &str, bytes: &[u8]) {
        let target = world.join(rel);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, bytes).unwrap();
    }

    fn rpf(world: &Path, rel: &str, kids: Vec<Node>) {
        let target = world.join(rel);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        let mut file = fs::File::create(&target).unwrap();
        let mut context = WriteContext {
            staging: target.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(&build("", kids), &mut file, &mut context, &mut |_| {}).unwrap();
    }

    struct Lab {
        root: TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let root = tempdir().unwrap();
            let keys = root.path().join("keys");
            fs::create_dir_all(&keys).unwrap();
            fs::write(keys.join("gtav_aes_key.dat"), vec![7u8; 32]).unwrap();
            fs::write(keys.join("gtav_ng_key.dat"), vec![1u8; 101 * 68 * 4]).unwrap();
            fs::write(
                keys.join("gtav_ng_decrypt_tables.dat"),
                vec![2u8; 17 * 4096 * 4],
            )
            .unwrap();
            fs::write(keys.join("gtav_hash_lut.dat"), vec![3u8; 256]).unwrap();
            Lab { root }
        }

        fn keys(&self) -> String {
            self.root.path().join("keys").to_string_lossy().into_owned()
        }

        /// Папка «игры» с пустым `GTA5.exe`.
        fn world(&self, name: &str) -> PathBuf {
            let path = self.root.path().join("worlds").join(name);
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("GTA5.exe"), b"").unwrap();
            path
        }

        /// Папка вывода: сама не создаётся.
        fn out(&self, name: &str) -> PathBuf {
            self.root.path().join("out").join(name)
        }
    }

    fn text(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    type Command = fn(&Options, &Progress) -> Result<Value>;

    fn call(command: Command, args: &[&str]) -> Result<Value> {
        let owned: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        command(&Options::parse(&owned)?, &Progress::silent())
    }

    fn ok(command: Command, args: &[&str]) -> Value {
        call(command, args).unwrap_or_else(|error| panic!("команда отказала: {error}"))
    }

    fn refused(command: Command, args: &[&str]) -> (String, String) {
        match call(command, args) {
            Err(error) => (error.code, error.message),
            Ok(done) => panic!("ожидался отказ, а вышло {done}"),
        }
    }

    fn refusal_is(got: (String, String), code: &str, message: &str) {
        assert_eq!((got.0.as_str(), got.1.as_str()), (code, message));
    }

    /// Содержимое папки: имена по порядку, у каталогов косая в конце.
    fn listing(dir_path: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir_path)
            .unwrap()
            .flatten()
            .map(|item| {
                let mark = if item.path().is_dir() { "/" } else { "" };
                format!("{}{mark}", item.file_name().to_string_lossy())
            })
            .collect();
        names.sort();
        names
    }

    fn texture(
        name: &str,
        format: Format,
        width: u16,
        height: u16,
        levels: u8,
        seed: u64,
    ) -> NewTexture {
        let size = payload_bytes(
            format,
            usize::from(width),
            usize::from(height),
            usize::from(levels),
        );
        NewTexture {
            name: name.to_owned(),
            width,
            height,
            format,
            levels,
            payload: noise(size, seed),
        }
    }

    fn ytd(parts: &[NewTexture]) -> Vec<u8> {
        write(parts).unwrap()
    }

    /// Текстура, где один и тот же блок повторён до нужного размера.
    fn solid_texture(
        name: &str,
        format: Format,
        width: u16,
        height: u16,
        levels: u8,
        block: &[u8],
    ) -> NewTexture {
        let mut piece = texture(name, format, width, height, levels, 0);
        piece.payload = block
            .iter()
            .copied()
            .cycle()
            .take(piece.payload.len())
            .collect();
        piece
    }

    /// Переименование текстуры той же длины прямо в данных словаря.
    fn rename_texture(bytes: &[u8], from: &str, to: &str) -> Vec<u8> {
        assert_eq!(from.len(), to.len());
        let mut res = Resource::parse(bytes).unwrap();
        let wanted = [from.as_bytes(), &[0]].concat();
        let at = res
            .data()
            .windows(wanted.len())
            .position(|window| window == wanted.as_slice())
            .expect("имя в данных словаря");
        res.data_mut()[at..at + to.len()].copy_from_slice(to.as_bytes());
        res.to_file_bytes().unwrap()
    }

    /// Словарь из одной текстуры 4×4.
    fn quick(name: &str, seed: u64) -> Vec<u8> {
        ytd(&[texture(name, Format::Dxt1, 4, 4, 1, seed)])
    }

    /// Словарь неба из примера `sky-basic`.
    fn sky_full() -> Vec<u8> {
        ytd(&[
            texture("moon-new", Format::Dxt5, 16, 16, 1, 11),
            texture("moon", Format::Dxt1, 8, 8, 1, 12),
            texture("starfield", Format::Dxt1, 16, 8, 2, 13),
            texture("starsfield", Format::A8R8G8B8, 8, 8, 1, 14),
            texture("halo", Format::Dxt1, 4, 4, 1, 15),
        ])
    }

    enum Fault {
        Format(u32),
        Size(u16, u16),
    }

    /// Портит поля одной текстуры готового словаря.
    fn tamper(bytes: &[u8], name: &str, fault: Fault) -> Vec<u8> {
        let mut res = Resource::parse(bytes).unwrap();
        let list = res.pointer_list(res.root().unwrap() + 0x30).unwrap();
        let array = res.at(list.entries).unwrap();
        let target = (0..usize::from(list.count))
            .filter_map(|index| res.pointer_at(array + index * 8))
            .find(|&object| {
                res.u64(object + 0x28)
                    .ok()
                    .and_then(|pointer| res.cstring(pointer))
                    .as_deref()
                    == Some(name)
            })
            .expect("текстура в словаре");
        let data = res.data_mut();
        match fault {
            Fault::Format(code) => {
                data[target + 0x58..target + 0x5c].copy_from_slice(&code.to_le_bytes())
            }
            Fault::Size(width, height) => {
                data[target + 0x50..target + 0x52].copy_from_slice(&width.to_le_bytes());
                data[target + 0x52..target + 0x54].copy_from_slice(&height.to_le_bytes());
            }
        }
        res.to_file_bytes().unwrap()
    }

    /// Словарь, у которого в заголовке другая версия ресурса.
    fn with_version(bytes: &[u8], version: u32) -> Vec<u8> {
        let mut patched = bytes.to_vec();
        let word = |from: usize| u32::from_le_bytes(patched[from..from + 4].try_into().unwrap());
        let system = word(8) & 0x0fff_ffff | (version >> 4) << 28;
        let graphics = word(12) & 0x0fff_ffff | (version & 0xf) << 28;
        patched[8..12].copy_from_slice(&system.to_le_bytes());
        patched[12..16].copy_from_slice(&graphics.to_le_bytes());
        patched
    }

    /// PNG текстуры по версии соседа `extract_textures` (без учёта регистра имени).
    fn oracle_png(dictionary: &[u8], name: &str) -> Vec<u8> {
        extract_textures(dictionary)
            .unwrap()
            .into_iter()
            .find(|(have, _)| have.eq_ignore_ascii_case(name))
            .unwrap_or_else(|| panic!("в словаре нет {name}"))
            .1
    }

    fn arg(path: &Path) -> String {
        text(path)
    }

    // ----- порядок просмотра архивов -----

    fn lay_out_files(root: &Path, files: &[&str]) {
        for entry in files {
            match entry.strip_suffix('/') {
                Some(folder) => fs::create_dir_all(root.join(folder)).unwrap(),
                None => put(root, entry, b"x"),
            }
        }
    }

    #[test]
    fn search_order_follows_the_table() {
        let layered = ["dinput8.dll", "OpenIV.asi", "X64B.rpf"];
        let mods_files = [
            "mods/x64a.rpf",
            "mods/update/update.rpf",
            "mods/X64B.rpf",
            "mods/x64q.rpf",
        ];
        let with_mods = |head: &[&'static str]| -> Vec<&'static str> {
            head.iter().chain(mods_files.iter()).copied().collect()
        };
        let layer_result = vec!["mods/x64a.rpf", "mods/update/update.rpf", "mods/X64B.rpf"];
        let plain_result = vec!["x64a.rpf", "update/update.rpf", "X64B.rpf"];
        let cases: Vec<(&str, Vec<&str>, Vec<&str>)> = vec![
            ("Пк1", vec![], vec!["x64a.rpf", "update/update.rpf"]),
            (
                "Пк2",
                vec![
                    "x64a.rpf",
                    "x64e.rpf",
                    "X64B.rpf",
                    "update/update.rpf",
                    "common.rpf",
                    "mods/x64a.rpf",
                ],
                vec!["x64a.rpf", "update/update.rpf", "X64B.rpf", "x64e.rpf"],
            ),
            (
                "Пк3",
                vec!["X64A.rpf", "x64b.rpf"],
                vec!["x64a.rpf", "update/update.rpf", "x64b.rpf"],
            ),
            (
                "Пк4",
                vec![
                    "x64.rpf",
                    "x64a.rpf.rpf",
                    "x64b.RPF",
                    "x64z.rpf",
                    "x65a.rpf",
                    "ax64.rpf",
                    "x64c.rpf.bak",
                    "x64_b.rpf",
                    "x64B2.rpf",
                    "X64-d.rpf",
                    "x64.rpf.rpf",
                    "x64d.rpf/",
                ],
                vec![
                    "x64a.rpf",
                    "update/update.rpf",
                    "X64-d.rpf",
                    "x64.rpf",
                    "x64.rpf.rpf",
                    "x64a.rpf.rpf",
                    "x64b.RPF",
                    "x64B2.rpf",
                    "x64z.rpf",
                    "x64_b.rpf",
                ],
            ),
            (
                "Пк5",
                vec!["x64b.rpf"],
                vec!["x64a.rpf", "update/update.rpf", "x64b.rpf"],
            ),
            ("Пк6", with_mods(&layered), layer_result.clone()),
            (
                "Пк7",
                with_mods(&["xinput1_4.dll", "RageOpenV.asi", "X64B.rpf"]),
                layer_result.clone(),
            ),
            (
                "Пк8",
                with_mods(&["dsound.dll", "OpenRPF.asi", "X64B.rpf"]),
                layer_result.clone(),
            ),
            (
                "Пк9",
                with_mods(&["dsound.dll", "ClosedIV.asi", "X64B.rpf"]),
                layer_result.clone(),
            ),
            (
                "Пк11",
                with_mods(&["dinput8.dll", "other.asi", "X64B.rpf"]),
                plain_result.clone(),
            ),
            (
                "Пк12",
                with_mods(&["other.dll", "OpenIV.asi", "X64B.rpf"]),
                plain_result.clone(),
            ),
            (
                "Пк13",
                vec!["dinput8.dll", "OpenIV.asi", "x64b.rpf", "mods/x64b.rpf"],
                vec!["x64a.rpf", "update/update.rpf", "mods/x64b.rpf"],
            ),
            (
                "Пк14",
                vec!["dinput8.dll/", "OpenIV.asi/", "mods/x64a.rpf/"],
                vec!["x64a.rpf", "update/update.rpf"],
            ),
        ];
        for (label, files, expected) in cases {
            let lab = Lab::new();
            let root = lab.world(label);
            lay_out_files(&root, &files);
            assert_eq!(archive_search_order(&root), expected, "{label}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn search_order_on_a_case_insensitive_disk() {
        let lab = Lab::new();
        let mixed = lab.world("Пк10");
        lay_out_files(
            &mixed,
            &[
                "DINPUT8.DLL",
                "openiv.ASI",
                "X64B.rpf",
                "mods/x64a.rpf",
                "mods/update/update.rpf",
                "mods/X64B.rpf",
            ],
        );
        assert_eq!(
            archive_search_order(&mixed),
            ["mods/x64a.rpf", "mods/update/update.rpf", "mods/X64B.rpf"]
        );
        // Пк15: на таком диске x64B и x64b — одно имя, поэтому набор без повторов.
        let tangled = lab.world("Пк15");
        let names = [
            "x64d",
            "x64C",
            "x64_b",
            "x64B",
            "x64Z",
            "x640",
            "x64[",
            "x64\u{e9}",
        ];
        for name in names {
            put(&tangled, &format!("{name}.rpf"), b"x");
        }
        assert_eq!(
            archive_search_order(&tangled),
            [
                "x64a.rpf",
                "update/update.rpf",
                "x640.rpf",
                "x64B.rpf",
                "x64C.rpf",
                "x64d.rpf",
                "x64Z.rpf",
                "x64[.rpf",
                "x64_b.rpf",
                "x64\u{e9}.rpf"
            ]
        );
    }

    #[test]
    fn search_order_without_a_readable_folder() {
        let lab = Lab::new();
        let expected = ["x64a.rpf", "update/update.rpf"];
        assert_eq!(
            archive_search_order(&lab.root.path().join("missing")),
            expected
        );
        let plain = lab.root.path().join("plain.txt");
        fs::write(&plain, b"x").unwrap();
        assert_eq!(archive_search_order(&plain), expected);
    }

    #[test]
    fn search_order_sorts_by_upper_case_code_points() {
        let lab = Lab::new();
        let root = lab.world("sorting");
        for name in ["x64b", "x64Z", "x64[", "x64_b", "x640", "x64\u{e9}"] {
            put(&root, &format!("{name}.rpf"), b"x");
        }
        assert_eq!(
            archive_search_order(&root)[2..],
            [
                "x640.rpf",
                "x64b.rpf",
                "x64Z.rpf",
                "x64[.rpf",
                "x64_b.rpf",
                "x64\u{e9}.rpf"
            ]
        );
    }

    // ----- маски, имена, предел -----

    #[test]
    fn masks_follow_the_search_box_rules() {
        let admits = |patterns: &[&str], text: &str| {
            let values: Vec<String> = patterns.iter().map(|p| (*p).to_owned()).collect();
            MaskSet::from_values(&values).admits(text)
        };
        let table: &[(&[&str], &str, bool)] = &[
            (&["*arena*"], "x64/Arena_01/road.ytd", true),
            (&["minimap_0_*"], "MINIMAP_0_1", true),
            (&["a?c"], "abc", true),
            (&["a?c"], "abbc", false),
            (&["*"], "", true),
            (&["moon"], "moon-new", false),
            (&[], "anything", true),
            (&[""], "anything", false),
            (&[""], "", true),
            (
                &["streets/im_road_001.ytd"],
                "x64/levels/gta5/streets/im_road_001.ytd",
                false,
            ),
            (
                &["*streets/im_road_00?.ytd"],
                "x64/levels/gta5/streets/im_road_001.ytd",
                true,
            ),
            (
                &["*streets\\im_road*"],
                "x64/levels/gta5/streets/im_road_001.ytd",
                false,
            ),
            (&["im_road_00[12]"], "im_road_001", false),
            (&["im_road_00[12]"], "im_road_00[12]", true),
            (&["im_road_001.*"], "im_road_001", false),
            (&["  prop_a_tex "], "prop_a_tex", true),
            (&["PROP_?_TEX"], "prop_b_tex", true),
            (&["a*b*c"], "aXbYbZc", true),
            (&["a*b*c"], "aXbYbZ", false),
            (&["**"], "", true),
            (&["?"], "", false),
            (&["\u{419}*"], "\u{439}\u{43e}", true),
            (&["zzz*", "arena_w?ll"], "arena_wall", true),
        ];
        for (patterns, text, expected) in table {
            assert_eq!(
                admits(patterns, text),
                *expected,
                "{patterns:?} против {text:?}"
            );
        }
    }

    #[test]
    fn only_atlas_tiles_match_the_tile_rule() {
        for good in [
            "minimap_0_0.ytd",
            "MINIMAP_10_3.YTD",
            "Minimap_SEA_1_1.ytd",
            "minimap_sea_12_345.ytd",
            "minimap_007_00.ytd",
        ] {
            assert!(is_tile_name(good), "{good}");
        }
        for bad in [
            "minimap_lod_128.ytd",
            "minimap_0.ytd",
            "minimap_0_0_0.ytd",
            "minimap_a_b.ytd",
            "map_0_0.ytd",
            "minimap_0_0.ytd.bak",
            "minimap__0_0.ytd",
            "minimap_sea_sea_0_0.ytd",
            "minimap_sea_0.ytd",
            "minimap_0_.ytd",
            ".ytd",
        ] {
            assert!(!is_tile_name(bad), "{bad}");
        }
    }

    #[test]
    fn file_names_lose_forbidden_characters() {
        let nel = char::from(0x85u8).to_string();
        let del = char::from(0x7fu8);
        let table: Vec<(String, &str)> = vec![
            ("a/b:c*d".to_owned(), "a_b_c_d"),
            ("  ".to_owned(), "texture"),
            ("moon-new".to_owned(), "moon-new"),
            ("q?*\"<>|".to_owned(), "q______"),
            ("  spaced  ".to_owned(), "spaced"),
            ("back\\slash".to_owned(), "back_slash"),
            ("tail.".to_owned(), "tail."),
            (nel, "_"),
            (format!("x{del}"), "x_"),
            ("a\tb".to_owned(), "a_b"),
            ("dot.name.v2".to_owned(), "dot.name.v2"),
            ("\u{e9}\u{436}".to_owned(), "\u{e9}\u{436}"),
            ("x/y".to_owned(), "x_y"),
            (String::new(), "texture"),
        ];
        for (input, expected) in table {
            assert_eq!(file_stem(&input), expected, "{input:?}");
        }
    }

    #[test]
    fn limit_reads_like_a_number_or_means_none() {
        let table: &[(Option<&str>, Option<usize>)] = &[
            (None, None),
            (Some("abc"), None),
            (Some("-5"), None),
            (Some(" 7 "), Some(7)),
            (Some("2.5"), None),
            (Some("99999999999"), None),
            (Some("2147483648"), None),
            (Some("2147483647"), Some(2_147_483_647)),
            (Some("+3"), Some(3)),
            (Some("0"), None),
            (Some(""), None),
        ];
        for (raw, expected) in table {
            assert_eq!(parse_limit(*raw), *expected, "{raw:?}");
        }
    }

    // ----- extract-sky-textures -----

    const SKY: Command = extract_sky_textures;
    const KEY_LABEL: &str = "configured-key-directory";

    fn sky_answer(archive: &str, rows: Vec<Value>, missing: &[&str]) -> Value {
        json!({
            "archive": archive,
            "entry": "skydome.ytd",
            "textures": rows,
            "missing": missing,
            "keySource": KEY_LABEL,
        })
    }

    fn sky_row(out_dir: &Path, slot: &str, name: &str, png: &[u8]) -> Value {
        json!({
            "slot": slot,
            "name": name,
            "file": text(&out_dir.join(format!("{slot}.png"))),
            "bytes": png.len(),
            "sha256": sha256_hex(png).to_uppercase(),
        })
    }

    fn wrap(dirs: &[&str], leaf: Node) -> Node {
        dirs.iter()
            .rev()
            .fold(leaf, |inner, name| dir(name, vec![inner]))
    }

    /// Мир с `skydome.ytd` в каждом из названных архивов (путь `levels/gta5`).
    fn sky_world(lab: &Lab, name: &str, placed: &[(&str, Vec<u8>)]) -> PathBuf {
        let root = lab.world(name);
        for (archive, bytes) in placed {
            let leaf = wrap(&["levels", "gta5"], bin("skydome.ytd", bytes.clone()));
            rpf(&root, archive, vec![leaf]);
        }
        root
    }

    fn sky_run(lab: &Lab, root: &Path, tag: &str) -> Result<Value> {
        let out = lab.out(tag);
        call(
            SKY,
            &[
                "--game-root",
                &arg(root),
                "--output",
                &arg(&out),
                "--keys",
                &lab.keys(),
            ],
        )
    }

    /// Что ждём от слота: имя слота, имя из списка слота, имя текстуры в словаре.
    type Pick = (&'static str, &'static str, &'static str);

    /// Строка таблицы выбора слотов: метка примера, словарь, ожидаемые слоты, пропавшие слоты.
    type SkyCase<'a> = (&'a str, &'a Vec<u8>, Vec<Pick>, Vec<&'a str>);

    fn expected_sky(
        out_dir: &Path,
        archive: &str,
        dictionary: &[u8],
        picks: &[Pick],
        missing: &[&str],
    ) -> Value {
        let rows = picks
            .iter()
            .map(|(slot, listed, present)| {
                sky_row(out_dir, slot, listed, &oracle_png(dictionary, present))
            })
            .collect();
        sky_answer(archive, rows, missing)
    }

    #[test]
    fn sky_picks_slot_names_and_writes_the_discs() {
        let alt = ytd(&[
            texture("moon", Format::Dxt5, 8, 8, 1, 21),
            texture("starsfield", Format::A8R8G8B8, 8, 8, 1, 22),
            texture("halo", Format::Dxt1, 4, 4, 1, 23),
        ]);
        let only_moon = ytd(&[
            texture("moon", Format::Dxt1, 8, 8, 1, 24),
            texture("halo", Format::Dxt1, 4, 4, 1, 25),
        ]);
        let cased = ytd(&[
            texture("MOON-NEW", Format::Dxt1, 8, 8, 1, 26),
            texture("StarField", Format::Dxt1, 8, 8, 1, 27),
        ]);
        let spoiled = {
            let base = ytd(&[
                texture("moon-new", Format::Dxt1, 4, 4, 1, 28),
                texture("moon", Format::Dxt1, 8, 8, 1, 29),
                texture("starfield", Format::Dxt1, 4, 4, 1, 30),
            ]);
            let base = tamper(&base, "moon-new", Fault::Format(0x1234_5678));
            tamper(&base, "starfield", Fault::Size(32768, 32768))
        };
        let full = sky_full();
        let cases: Vec<SkyCase> = vec![
            (
                "Нб1",
                &full,
                vec![
                    ("moon", "moon-new", "moon-new"),
                    ("starfield", "starfield", "starfield"),
                ],
                vec![],
            ),
            (
                "Нб2",
                &alt,
                vec![
                    ("moon", "moon", "moon"),
                    ("starfield", "starsfield", "starsfield"),
                ],
                vec![],
            ),
            (
                "Нб3",
                &only_moon,
                vec![("moon", "moon", "moon")],
                vec!["starfield"],
            ),
            (
                "Нб5",
                &cased,
                vec![
                    ("moon", "moon-new", "MOON-NEW"),
                    ("starfield", "starfield", "StarField"),
                ],
                vec![],
            ),
            (
                "Нб6",
                &spoiled,
                vec![("moon", "moon", "moon")],
                vec!["starfield"],
            ),
        ];
        for (label, dictionary, picks, missing) in cases {
            let lab = Lab::new();
            let root = sky_world(&lab, label, &[("x64a.rpf", dictionary.clone())]);
            let answer = ok(
                SKY,
                &[
                    "--game-root",
                    &arg(&root),
                    "--output",
                    &arg(&lab.out("S")),
                    "--keys",
                    &lab.keys(),
                ],
            );
            let out = lab.out("S");
            assert_eq!(
                answer,
                expected_sky(&out, "x64a.rpf", dictionary, &picks, &missing),
                "{label}"
            );
            for (slot, _, present) in &picks {
                assert_eq!(
                    fs::read(out.join(format!("{slot}.png"))).unwrap(),
                    oracle_png(dictionary, present),
                    "{label}: {slot}"
                );
            }
            assert_eq!(listing(&out).len(), picks.len(), "{label}");
        }
    }

    #[test]
    fn sky_png_files_have_the_shape_of_the_old_ones() {
        let lab = Lab::new();
        // Однотонные блоки: луна полупрозрачная (цвет 6), звёзды непрозрачные (цвет 2).
        let translucent = [128u8, 128, 0, 0, 0, 0, 0, 0, 0, 0xf8, 0x1f, 0, 0, 0, 0, 0];
        let opaque = [0u8, 0xf8, 0x1f, 0, 0, 0, 0, 0];
        let sheets = [
            solid_texture("moon-new", Format::Dxt5, 16, 16, 1, &translucent),
            solid_texture("starfield", Format::Dxt1, 16, 8, 2, &opaque),
        ];
        let root = sky_world(&lab, "sky-basic", &[("x64a.rpf", ytd(&sheets))]);
        ok(
            SKY,
            &[
                "--game-root",
                &arg(&root),
                "--output",
                &arg(&lab.out("S")),
                "--keys",
                &lab.keys(),
            ],
        );
        let moon = fs::read(lab.out("S").join("moon.png")).unwrap();
        let star = fs::read(lab.out("S").join("starfield.png")).unwrap();
        assert_eq!(&moon[..8], b"\x89PNG\r\n\x1a\n");
        // 16×16 с альфой (цвет 6) и 16×8 без неё (цвет 2), как в примере Нб1.
        let header = |png: &[u8]| (png[16..24].to_vec(), png[24], png[25]);
        assert_eq!(header(&star), (vec![0, 0, 0, 16, 0, 0, 0, 8], 8, 2));
        assert_eq!(header(&moon).0, vec![0, 0, 0, 16, 0, 0, 0, 16]);
    }

    #[test]
    fn sky_searches_archives_in_the_game_order() {
        let full = sky_full();
        let other = ytd(&[
            texture("moon", Format::Dxt1, 8, 8, 1, 31),
            texture("starfield", Format::Dxt1, 8, 8, 1, 32),
        ]);
        // Нб7, Нб8, Нб9: где найден словарь, тот архив и назван.
        let lab = Lab::new();
        let root = sky_world(
            &lab,
            "sky-update-only",
            &[("update/update.rpf", full.clone())],
        );
        let answer = sky_run(&lab, &root, "S7").unwrap();
        assert_eq!(answer["archive"], "update/update.rpf");
        let root = sky_world(&lab, "sky-x64c-only", &[("x64c.rpf", full.clone())]);
        assert_eq!(sky_run(&lab, &root, "S8").unwrap()["archive"], "x64c.rpf");
        let root = sky_world(
            &lab,
            "sky-both",
            &[
                ("x64a.rpf", other.clone()),
                ("update/update.rpf", full.clone()),
            ],
        );
        let answer = sky_run(&lab, &root, "S9").unwrap();
        assert_eq!(
            answer,
            expected_sky(
                &lab.out("S9"),
                "x64a.rpf",
                &other,
                &[
                    ("moon", "moon", "moon"),
                    ("starfield", "starfield", "starfield")
                ],
                &[]
            )
        );
        // Нб10 и Нб11: слой модов подменяет архив, одного загрузчика мало.
        let root = sky_world(
            &lab,
            "sky-mods",
            &[("mods/x64a.rpf", other.clone()), ("x64a.rpf", full.clone())],
        );
        put(&root, "dinput8.dll", b"x");
        put(&root, "OpenIV.asi", b"x");
        assert_eq!(
            sky_run(&lab, &root, "S10").unwrap()["archive"],
            "mods/x64a.rpf"
        );
        let root = sky_world(
            &lab,
            "sky-mods-loader-only",
            &[("mods/x64a.rpf", other.clone()), ("x64a.rpf", full)],
        );
        put(&root, "dinput8.dll", b"x");
        let answer = sky_run(&lab, &root, "S11").unwrap();
        assert_eq!(answer["archive"], "x64a.rpf");
        assert_eq!(answer["textures"][0]["name"], "moon-new");
        // Нб13: x64a.rpf не архив, поиск идёт дальше.
        let root = lab.world("sky-broken-first");
        put(&root, "x64a.rpf", b"this is not an archive at all");
        rpf(
            &root,
            "update/update.rpf",
            vec![wrap(&["levels", "gta5"], bin("skydome.ytd", sky_full()))],
        );
        assert_eq!(
            sky_run(&lab, &root, "S13").unwrap()["archive"],
            "update/update.rpf"
        );
    }

    #[test]
    fn sky_looks_down_six_directories_and_not_into_nested_archives() {
        let lab = Lab::new();
        let chain = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"];
        for (label, depth, found) in [("Нб17", 6, true), ("Нб18", 7, false)] {
            let root = lab.world(label);
            rpf(
                &root,
                "x64a.rpf",
                vec![wrap(&chain[..depth], bin("SkyDome.YTD", sky_full()))],
            );
            match sky_run(&lab, &root, label) {
                Ok(answer) => assert!(found && answer["archive"] == "x64a.rpf", "{label}"),
                Err(failure) => {
                    assert!(!found, "{label}: словарь должен находиться");
                    refusal_is(
                        (failure.code, failure.message),
                        "FileNotFoundException",
                        SKY_ABSENT,
                    );
                }
            }
        }
        let root = lab.world("sky-nested-only");
        rpf(
            &root,
            "x64a.rpf",
            vec![pack("inner.rpf", vec![bin("skydome.ytd", sky_full())])],
        );
        let failure = sky_run(&lab, &root, "S19").unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "FileNotFoundException",
            SKY_ABSENT,
        );
    }

    #[test]
    fn sky_takes_the_first_match_and_the_root_one_wins() {
        let lab = Lab::new();
        let in_root = sky_full();
        let a_first = ytd(&[texture("moon", Format::Dxt1, 4, 4, 1, 41)]);
        let b_second = ytd(&[texture("moon", Format::Dxt1, 4, 4, 1, 42)]);
        let root = lab.world("sky-two-dirs");
        rpf(
            &root,
            "x64a.rpf",
            vec![
                bin("skydome.ytd", in_root.clone()),
                dir("a_first", vec![bin("skydome.ytd", a_first)]),
                dir("b_second", vec![bin("skydome.ytd", b_second)]),
            ],
        );
        let answer = sky_run(&lab, &root, "S23").unwrap();
        assert_eq!(
            answer,
            expected_sky(
                &lab.out("S23"),
                "x64a.rpf",
                &in_root,
                &[
                    ("moon", "moon-new", "moon-new"),
                    ("starfield", "starfield", "starfield")
                ],
                &[]
            )
        );
        // Мусорный словарь в раннем архиве мешает хорошему в update.rpf (Нб14).
        let root = lab.world("sky-garbage-ytd");
        rpf(&root, "x64a.rpf", vec![bin("skydome.ytd", noise(64, 9))]);
        rpf(
            &root,
            "update/update.rpf",
            vec![bin("skydome.ytd", sky_full())],
        );
        let failure = sky_run(&lab, &root, "S14").unwrap_err();
        assert_eq!(
            (failure.code.as_str(), failure.message.as_str()),
            ("InvalidDataException", "Файл не является ресурсом RSC7.")
        );
    }

    #[test]
    fn sky_dictionary_refusals_leave_the_folder_empty() {
        let lab = Lab::new();
        let full = sky_full();
        let halo_only = ytd(&[
            texture("halo", Format::Dxt1, 4, 4, 1, 51),
            texture("moonlight", Format::Dxt1, 4, 4, 1, 52),
        ]);
        let other_name = {
            let root = lab.world("sky-notfound");
            rpf(&root, "x64a.rpf", vec![bin("other.ytd", full.clone())]);
            root
        };
        let cases: Vec<(&str, PathBuf, &str, String)> = vec![
            (
                "Нб4",
                sky_world(&lab, "sky-none-expected", &[("x64a.rpf", halo_only)]),
                "InvalidDataException",
                SKY_NO_SLOTS.to_owned(),
            ),
            (
                "Нб12",
                other_name,
                "FileNotFoundException",
                SKY_ABSENT.to_owned(),
            ),
            (
                "Нб20",
                sky_world(
                    &lab,
                    "sky-enhanced",
                    &[("x64a.rpf", with_version(&full, 5))],
                ),
                "InvalidDataException",
                "Словарь текстур из GTA V Enhanced: Astral читает Legacy.".to_owned(),
            ),
            (
                "Нб21",
                sky_world(
                    &lab,
                    "sky-version165",
                    &[("x64a.rpf", with_version(&full, 165))],
                ),
                "InvalidDataException",
                "Это не словарь текстур Legacy (версия 165).".to_owned(),
            ),
            (
                "пустая запись",
                sky_world(&lab, "sky-empty", &[("x64a.rpf", Vec::new())]),
                "InvalidDataException",
                "Ресурс короче заголовка RSC7.".to_owned(),
            ),
        ];
        for (label, root, code, message) in cases {
            let out = lab.out(label);
            let got = refused(
                SKY,
                &[
                    "--game-root",
                    &arg(&root),
                    "--output",
                    &arg(&out),
                    "--keys",
                    &lab.keys(),
                ],
            );
            refusal_is(got, code, &message);
            assert!(listing(&out).is_empty(), "{label}: вывод должен быть пуст");
        }
    }

    #[test]
    fn sky_size_limit_is_inclusive() {
        let lab = Lab::new();
        let over = lab.world("sky-huge");
        rpf(
            &over,
            "x64a.rpf",
            vec![bin("skydome.ytd", vec![0u8; DICTIONARY_CEILING + 1])],
        );
        refusal_is(
            refused(
                SKY,
                &[
                    "--game-root",
                    &arg(&over),
                    "--output",
                    &arg(&lab.out("S15")),
                    "--keys",
                    &lab.keys(),
                ],
            ),
            "InvalidDataException",
            SKY_HUGE,
        );
        let exact = lab.world("sky-limit");
        rpf(
            &exact,
            "x64a.rpf",
            vec![bin("skydome.ytd", vec![0u8; DICTIONARY_CEILING])],
        );
        refusal_is(
            refused(
                SKY,
                &[
                    "--game-root",
                    &arg(&exact),
                    "--output",
                    &arg(&lab.out("S16")),
                    "--keys",
                    &lab.keys(),
                ],
            ),
            "InvalidDataException",
            "Файл не является ресурсом RSC7.",
        );
    }

    #[test]
    fn sky_duplicate_names_keep_the_last_picture() {
        let lab = Lab::new();
        // Писатель словарей одинаковых имён не принимает: второе имя правим в готовом файле.
        let first = texture("moon", Format::Dxt1, 4, 4, 1, 51);
        let second = texture("mooX", Format::Dxt1, 4, 4, 1, 52);
        let twice = rename_texture(&ytd(&[first.clone(), second.clone()]), "mooX", "moon");
        let root = sky_world(&lab, "sky-dup", &[("x64a.rpf", twice.clone())]);
        let answer = sky_run(&lab, &root, "S22").unwrap();
        let listed = extract_textures(&twice).unwrap();
        assert_eq!(listed.len(), 1);
        let png = &listed[0].1;
        // Картинка одна из двух; сосед сводит одинаковые имена в одну запись.
        let alone = |t: NewTexture, name: &str| oracle_png(&ytd(&[t]), name);
        let (a, b) = (alone(first, "moon"), alone(second, "mooX"));
        assert_ne!(a, b);
        assert!(*png == a || *png == b);
        assert_eq!(answer["textures"][0]["bytes"], png.len());
        assert_eq!(fs::read(lab.out("S22").join("moon.png")).unwrap(), *png);
    }

    #[test]
    fn sky_argument_refusals_come_in_the_documented_order() {
        let lab = Lab::new();
        let root = sky_world(&lab, "sky-basic", &[("x64a.rpf", sky_full())]);
        let keys = lab.keys();
        let (game, out, no_keys) = (
            arg(&root),
            arg(&lab.out("A")),
            arg(&lab.root.path().join("worlds")),
        );
        let noexe = lab.root.path().join("worlds").join("sky-noexe");
        fs::create_dir_all(&noexe).unwrap();
        let noexe = arg(&noexe);
        let cases: Vec<(&str, Vec<&str>, &str, &str)> = vec![
            (
                "Нб24",
                vec!["--output", &out, "--keys", &keys],
                "ArgumentException",
                "--game-root is required.",
            ),
            (
                "Нб25",
                vec!["--game-root", &game, "--keys", &keys],
                "ArgumentException",
                "--output is required.",
            ),
            (
                "Нб26",
                vec!["--game-root", &game, "--output", "", "--keys", &keys],
                "ArgumentException",
                "The path is empty.",
            ),
            (
                "Нб27",
                vec!["--game-root", &noexe, "--output", &out, "--keys", &keys],
                "DirectoryNotFoundException",
                "The selected directory is not a GTA V installation.",
            ),
            (
                "Нб39",
                vec!["--keys", &keys],
                "ArgumentException",
                "--game-root is required.",
            ),
            (
                "ошибка игры раньше ошибки вывода",
                vec!["--game-root", &noexe, "--output", ""],
                "DirectoryNotFoundException",
                "The selected directory is not a GTA V installation.",
            ),
        ];
        for (label, args, code, message) in cases {
            refusal_is(refused(SKY, &args), code, message);
            assert!(!lab.out("A").exists(), "{label}: каталога быть не должно");
        }
        // Нб30: ключи не читаются; папка вывода к этому моменту уже создана.
        let failure = refused(
            SKY,
            &["--game-root", &game, "--output", &out, "--keys", &no_keys],
        );
        assert_eq!(failure.0, "InvalidOperationException");
        assert!(failure
            .1
            .starts_with("The GTA V RPF key file gtav_aes_key.dat could not be read from"));
        assert!(lab.out("A").is_dir() && listing(&lab.out("A")).is_empty());
    }

    #[test]
    fn sky_output_folder_is_created_with_all_parents_and_collapsed() {
        let lab = Lab::new();
        let full = sky_full();
        let root = sky_world(&lab, "sky-basic", &[("x64a.rpf", full)]);
        let sep = std::path::MAIN_SEPARATOR;
        // Нб32: кириллица и несколько новых уровней.
        let deep = lab
            .out("S32")
            .join("\u{432}\u{44b}\u{445}\u{43e}\u{434}")
            .join("\u{43d}\u{435}\u{431}\u{43e}");
        let answer = ok(
            SKY,
            &[
                "--game-root",
                &arg(&root),
                "--output",
                &arg(&deep),
                "--keys",
                &lab.keys(),
            ],
        );
        assert_eq!(answer["textures"][0]["file"], text(&deep.join("moon.png")));
        assert_eq!(listing(&deep), ["moon.png", "starfield.png"]);
        // Нб38: `.` и `..` сворачиваются, косая в конце пропадает.
        let messy = format!(
            "{}{sep}sub{sep}..{sep}.{sep}final{sep}",
            text(&lab.out("S38"))
        );
        let answer = ok(
            SKY,
            &[
                "--game-root",
                &arg(&root),
                "--output",
                &messy,
                "--keys",
                &lab.keys(),
            ],
        );
        assert_eq!(
            answer["textures"][1]["file"],
            text(&lab.out("S38").join("final").join("starfield.png"))
        );
        assert_eq!(listing(&lab.out("S38")), ["final/"]);
        // Нб33: параметр повторён, имя в другом регистре; берётся последний.
        let answer = ok(
            SKY,
            &[
                "--GAME-ROOT",
                &arg(&root),
                "--output",
                &arg(&lab.out("S33x")),
                "--Output",
                &arg(&lab.out("S33")),
                "--keys",
                &lab.keys(),
            ],
        );
        assert_eq!(
            answer["textures"][0]["file"],
            text(&lab.out("S33").join("moon.png"))
        );
        assert!(!lab.out("S33x").exists());
    }

    #[test]
    fn sky_second_run_leaves_earlier_files_alone() {
        let lab = Lab::new();
        let both = sky_world(&lab, "sky-basic", &[("x64a.rpf", sky_full())]);
        let moon_only = sky_world(
            &lab,
            "sky-onlymoon",
            &[(
                "x64a.rpf",
                ytd(&[texture("moon", Format::Dxt1, 8, 8, 1, 61)]),
            )],
        );
        let out = lab.out("S34");
        let keys = lab.keys();
        ok(
            SKY,
            &[
                "--game-root",
                &arg(&both),
                "--output",
                &arg(&out),
                "--keys",
                &keys,
            ],
        );
        let before = fs::read(out.join("starfield.png")).unwrap();
        fs::write(out.join("other.txt"), b"keep").unwrap();
        let answer = ok(
            SKY,
            &[
                "--game-root",
                &arg(&moon_only),
                "--output",
                &arg(&out),
                "--keys",
                &keys,
            ],
        );
        assert_eq!(answer["missing"], json!(["starfield"]));
        assert_eq!(fs::read(out.join("starfield.png")).unwrap(), before);
        assert_eq!(listing(&out), ["moon.png", "other.txt", "starfield.png"]);
    }

    #[cfg(windows)]
    #[test]
    fn sky_write_failures_follow_the_windows_codes() {
        let lab = Lab::new();
        let root = sky_world(&lab, "sky-basic", &[("x64a.rpf", sky_full())]);
        let keys = lab.keys();
        let denied = "Отказано в доступе. (os error 5)";
        // Нб31: --output — существующий файл.
        let blocked = lab.out("S31");
        fs::create_dir_all(blocked.parent().unwrap()).unwrap();
        fs::write(&blocked, b"1234").unwrap();
        refusal_is(
            refused(
                SKY,
                &[
                    "--game-root",
                    &arg(&root),
                    "--output",
                    &arg(&blocked),
                    "--keys",
                    &keys,
                ],
            ),
            "IOException",
            "Невозможно создать файл, так как он уже существует. (os error 183)",
        );
        assert_eq!(fs::read(&blocked).unwrap(), b"1234");
        // Нб35: на месте moon.png каталог — ничего нового не записано.
        let first = lab.out("S35");
        fs::create_dir_all(first.join("moon.png")).unwrap();
        refusal_is(
            refused(
                SKY,
                &[
                    "--game-root",
                    &arg(&root),
                    "--output",
                    &arg(&first),
                    "--keys",
                    &keys,
                ],
            ),
            "UnauthorizedAccessException",
            denied,
        );
        assert_eq!(listing(&first), ["moon.png/"]);
        // Нб40: на месте starfield.png каталог — moon.png уже записан.
        let second = lab.out("S40");
        fs::create_dir_all(second.join("starfield.png")).unwrap();
        refusal_is(
            refused(
                SKY,
                &[
                    "--game-root",
                    &arg(&root),
                    "--output",
                    &arg(&second),
                    "--keys",
                    &keys,
                ],
            ),
            "UnauthorizedAccessException",
            denied,
        );
        assert_eq!(listing(&second), ["moon.png", "starfield.png/"]);
        // Нб36б: moon.png прежнего запуска только для чтения.
        let third = lab.out("S36");
        ok(
            SKY,
            &[
                "--game-root",
                &arg(&root),
                "--output",
                &arg(&third),
                "--keys",
                &keys,
            ],
        );
        let writable = fs::metadata(third.join("moon.png")).unwrap().permissions();
        let mut locked = writable.clone();
        locked.set_readonly(true);
        fs::set_permissions(third.join("moon.png"), locked).unwrap();
        refusal_is(
            refused(
                SKY,
                &[
                    "--game-root",
                    &arg(&root),
                    "--output",
                    &arg(&third),
                    "--keys",
                    &keys,
                ],
            ),
            "UnauthorizedAccessException",
            denied,
        );
        fs::set_permissions(third.join("moon.png"), writable).unwrap();
    }

    // ----- extract-map-tiles -----

    const TILES: Command = extract_map_tiles;

    /// Что ждём от одной записи `map.tiles`.
    #[derive(Clone, Copy)]
    struct Want<'a> {
        archive: &'a str,
        entry: &'a str,
        file: &'a str,
        dictionary: &'a [u8],
        texture: &'a str,
        size: (u32, u32, u32),
        format: &'a str,
    }

    fn want_rows(out_dir: &Path, rows: &[Want<'_>]) -> Vec<Value> {
        rows.iter()
            .map(|row| {
                let png = oracle_png(row.dictionary, row.texture);
                json!({
                    "archive": row.archive,
                    "entry": row.entry,
                    "file": row.file,
                    "texture": row.texture,
                    "width": row.size.0,
                    "height": row.size.1,
                    "levels": row.size.2,
                    "format": row.format,
                    "png": text(&out_dir.join(format!("{}.png", file_stem(row.texture)))),
                    "bytes": png.len(),
                })
            })
            .collect()
    }

    fn tiles_answer(out_dir: &Path, base: Option<&Path>, rows: Vec<Value>) -> Value {
        json!({
            "keySource": KEY_LABEL,
            "baseArchive": base.map(text),
            "map": { "output": text(out_dir), "count": rows.len(), "tiles": rows },
        })
    }

    fn tiles_args(lab: &Lab, root: &Path, tag: &str, extra: &[&str]) -> Vec<String> {
        let mut args = vec![
            "--game-root".to_owned(),
            arg(root),
            "--output".to_owned(),
            arg(&lab.out(tag)),
            "--keys".to_owned(),
            lab.keys(),
        ];
        args.extend(extra.iter().map(|part| (*part).to_owned()));
        args
    }

    fn run_with(command: Command, args: &[String]) -> Result<Value> {
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        call(command, &borrowed)
    }

    fn tiles_run(lab: &Lab, root: &Path, tag: &str, extra: &[&str]) -> Result<Value> {
        run_with(TILES, &tiles_args(lab, root, tag, extra))
    }

    /// Словари «игры» `tiles-basic` и «базы» вне игры.
    struct Atlas {
        d99: Vec<u8>,
        d00: Vec<u8>,
        d01: Vec<u8>,
        sea: Vec<u8>,
        upd2: Vec<u8>,
        n10: Vec<u8>,
        b30: Vec<u8>,
        base10: Vec<u8>,
        base77: Vec<u8>,
    }

    fn atlas() -> Atlas {
        Atlas {
            d99: quick("minimap_9_9", 71),
            d00: ytd(&[
                texture("minimap_0_0", Format::Dxt5, 16, 16, 2, 72),
                texture("minimap_0_0_mask", Format::Dxt5, 8, 8, 1, 73),
            ]),
            d01: quick("minimap_0_1", 74),
            sea: ytd(&[texture("minimap_sea_0_0", Format::Ati2, 8, 8, 1, 75)]),
            upd2: quick("Minimap_2_0", 78),
            n10: quick("minimap_1_0", 79),
            b30: quick("minimap_3_0", 81),
            base10: quick("minimap_1_0", 91),
            base77: quick("minimap_7_7", 92),
        }
    }

    fn tiles_basic(lab: &Lab, name: &str, atlas: &Atlas) -> PathBuf {
        let root = lab.world(name);
        let gta5 = dir(
            "x64",
            vec![dir(
                "levels",
                vec![dir(
                    "gta5",
                    vec![
                        bin("minimap_0_0.ytd", atlas.d00.clone()),
                        bin("minimap_0_1.ytd", atlas.d01.clone()),
                        bin("minimap_lod_128.ytd", quick("minimap_lod_128", 76)),
                        bin("minimap_sea_0_0.ytd", atlas.sea.clone()),
                        bin("other.ytd", quick("other", 77)),
                    ],
                )],
            )],
        );
        rpf(
            &root,
            "x64a.rpf",
            vec![bin("minimap_9_9.ytd", atlas.d99.clone()), gta5],
        );
        let update = dir(
            "x64",
            vec![dir(
                "levels",
                vec![dir(
                    "gta5",
                    vec![
                        bin("Minimap_2_0.YTD", atlas.upd2.clone()),
                        pack(
                            "minimap.rpf",
                            vec![
                                bin("minimap_1_0.ytd", atlas.n10.clone()),
                                bin("minimap_0_0.ytd", quick("minimap_0_0", 80)),
                            ],
                        ),
                    ],
                )],
            )],
        );
        rpf(&root, "update/update.rpf", vec![update]);
        rpf(
            &root,
            "x64b.rpf",
            vec![bin("minimap_3_0.ytd", atlas.b30.clone())],
        );
        put(&root, "x64c.rpf", b"not an archive");
        rpf(
            &root,
            "common.rpf",
            vec![bin("minimap_4_0.ytd", quick("minimap_4_0", 82))],
        );
        root
    }

    /// Файлы «базы»: `update.rpf` с плитками вне папки игры и негодные соседи.
    fn tiles_base(lab: &Lab, atlas: &Atlas) -> PathBuf {
        let folder = lab
            .root
            .path()
            .join("worlds")
            .join("tiles-base")
            .join("original");
        let plain = vec![dir(
            "x64",
            vec![dir(
                "levels",
                vec![dir(
                    "gta5",
                    vec![
                        bin("minimap_1_0.ytd", atlas.base10.clone()),
                        bin("minimap_7_7.ytd", atlas.base77.clone()),
                    ],
                )],
            )],
        )];
        rpf(&folder, "update.rpf", plain);
        fs::copy(folder.join("update.rpf"), folder.join("UPDATE2.RPF")).unwrap();
        put(&folder, "update.zip", b"zip");
        put(&folder, "fake.rpf", b"this is text, not an archive");
        fs::create_dir_all(folder.join("folder.rpf")).unwrap();
        folder
    }

    fn basic_rows<'a>(atlas: &'a Atlas, update: &'a [Want<'a>]) -> Vec<Want<'a>> {
        let mut rows = vec![
            Want {
                archive: "x64a.rpf",
                entry: "minimap_9_9.ytd",
                file: "minimap_9_9.ytd",
                dictionary: &atlas.d99,
                texture: "minimap_9_9",
                size: (4, 4, 1),
                format: "D3DFMT_DXT1",
            },
            Want {
                archive: "x64a.rpf",
                entry: "x64/levels/gta5/minimap_0_0.ytd",
                file: "minimap_0_0.ytd",
                dictionary: &atlas.d00,
                texture: "minimap_0_0",
                size: (16, 16, 2),
                format: "D3DFMT_DXT5",
            },
            Want {
                archive: "x64a.rpf",
                entry: "x64/levels/gta5/minimap_0_0.ytd",
                file: "minimap_0_0.ytd",
                dictionary: &atlas.d00,
                texture: "minimap_0_0_mask",
                size: (8, 8, 1),
                format: "D3DFMT_DXT5",
            },
            Want {
                archive: "x64a.rpf",
                entry: "x64/levels/gta5/minimap_0_1.ytd",
                file: "minimap_0_1.ytd",
                dictionary: &atlas.d01,
                texture: "minimap_0_1",
                size: (4, 4, 1),
                format: "D3DFMT_DXT1",
            },
            Want {
                archive: "x64a.rpf",
                entry: "x64/levels/gta5/minimap_sea_0_0.ytd",
                file: "minimap_sea_0_0.ytd",
                dictionary: &atlas.sea,
                texture: "minimap_sea_0_0",
                size: (8, 8, 1),
                format: "D3DFMT_ATI2",
            },
        ];
        rows.extend(update.iter().copied());
        rows.push(Want {
            archive: "x64b.rpf",
            entry: "minimap_3_0.ytd",
            file: "minimap_3_0.ytd",
            dictionary: &atlas.b30,
            texture: "minimap_3_0",
            size: (4, 4, 1),
            format: "D3DFMT_DXT1",
        });
        rows
    }

    #[test]
    fn tiles_come_out_in_archive_order_with_the_atlas_rules() {
        let lab = Lab::new();
        let atlas = atlas();
        let root = tiles_basic(&lab, "tiles-basic", &atlas);
        let out = lab.out("T1");
        let update = [
            Want {
                archive: "update/update.rpf",
                entry: "x64/levels/gta5/Minimap_2_0.YTD",
                file: "Minimap_2_0.YTD",
                dictionary: &atlas.upd2,
                texture: "Minimap_2_0",
                size: (4, 4, 1),
                format: "D3DFMT_DXT1",
            },
            Want {
                archive: "update/update.rpf",
                entry: "x64/levels/gta5/minimap.rpf/minimap_1_0.ytd",
                file: "minimap_1_0.ytd",
                dictionary: &atlas.n10,
                texture: "minimap_1_0",
                size: (4, 4, 1),
                format: "D3DFMT_DXT1",
            },
        ];
        let answer = tiles_run(&lab, &root, "T1", &[]).unwrap();
        let rows = want_rows(&out, &basic_rows(&atlas, &update));
        assert_eq!(answer, tiles_answer(&out, None, rows));
        // Пл1: имена файлов и их содержимое; common.rpf и x64c.rpf не участвуют.
        assert_eq!(
            listing(&out),
            [
                "Minimap_2_0.png",
                "minimap_0_0.png",
                "minimap_0_0_mask.png",
                "minimap_0_1.png",
                "minimap_1_0.png",
                "minimap_3_0.png",
                "minimap_9_9.png",
                "minimap_sea_0_0.png"
            ]
        );
        assert_eq!(
            fs::read(out.join("minimap_0_0.png")).unwrap(),
            oracle_png(&atlas.d00, "minimap_0_0")
        );
        // Пл36: лишние параметры команда не читает.
        let again = tiles_run(&lab, &root, "T36", &["--limit", "3", "--unknown", "x"]).unwrap();
        assert_eq!(again["map"]["count"], 8);
    }

    #[test]
    fn tiles_take_update_from_the_base_archive() {
        let lab = Lab::new();
        let atlas = atlas();
        let root = tiles_basic(&lab, "tiles-basic", &atlas);
        let base_dir = tiles_base(&lab, &atlas);
        let base = base_dir.join("update.rpf");
        let from_base = [
            Want {
                archive: "update/update.rpf",
                entry: "x64/levels/gta5/minimap_1_0.ytd",
                file: "minimap_1_0.ytd",
                dictionary: &atlas.base10,
                texture: "minimap_1_0",
                size: (4, 4, 1),
                format: "D3DFMT_DXT1",
            },
            Want {
                archive: "update/update.rpf",
                entry: "x64/levels/gta5/minimap_7_7.ytd",
                file: "minimap_7_7.ytd",
                dictionary: &atlas.base77,
                texture: "minimap_7_7",
                size: (4, 4, 1),
                format: "D3DFMT_DXT1",
            },
        ];
        // Пл2 и Пл8 (расширение прописными).
        for (tag, base_file) in [("T2", base.clone()), ("T8", base_dir.join("UPDATE2.RPF"))] {
            let answer =
                tiles_run(&lab, &root, tag, &["--base-archive", &arg(&base_file)]).unwrap();
            let rows = want_rows(&lab.out(tag), &basic_rows(&atlas, &from_base));
            assert_eq!(
                answer,
                tiles_answer(&lab.out(tag), Some(&base_file), rows),
                "{tag}"
            );
        }
        // Пл3: в игре нет update.rpf вовсе, а плитки базы всё равно берутся.
        let bare = lab.world("tiles-no-update");
        rpf(
            &bare,
            "x64a.rpf",
            vec![bin("minimap_0_0.ytd", quick("minimap_0_0", 83))],
        );
        let answer = tiles_run(&lab, &bare, "T3", &["--base-archive", &arg(&base)]).unwrap();
        let archives: Vec<&str> = answer["map"]["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["archive"].as_str().unwrap())
            .collect();
        assert_eq!(
            archives,
            ["x64a.rpf", "update/update.rpf", "update/update.rpf"]
        );
        // Пл39: база — файл .rpf, но не архив: update пропущен, остальное читается.
        let fake = base_dir.join("fake.rpf");
        let answer = tiles_run(&lab, &root, "T39", &["--base-archive", &arg(&fake)]).unwrap();
        assert_eq!(answer["map"]["count"], 6);
        // Пл24 и Пл25: слой модов; база подставляется и вместо mods/update/update.rpf.
        let modded = lab.world("tiles-mods");
        put(&modded, "dinput8.dll", b"x");
        put(&modded, "OpenIV.asi", b"x");
        rpf(
            &modded,
            "mods/update/update.rpf",
            vec![
                bin("minimap_0_0.ytd", quick("minimap_0_0", 84)),
                bin("minimap_5_5.ytd", quick("minimap_5_5", 85)),
            ],
        );
        let answer = tiles_run(&lab, &modded, "T24", &[]).unwrap();
        let seen: Vec<(&str, &str)> = answer["map"]["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                (
                    row["archive"].as_str().unwrap(),
                    row["entry"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            [
                ("mods/update/update.rpf", "minimap_0_0.ytd"),
                ("mods/update/update.rpf", "minimap_5_5.ytd")
            ]
        );
        let answer = tiles_run(&lab, &modded, "T25", &["--base-archive", &arg(&base)]).unwrap();
        let seen: Vec<&str> = answer["map"]["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["entry"].as_str().unwrap())
            .collect();
        assert_eq!(
            seen,
            [
                "x64/levels/gta5/minimap_1_0.ytd",
                "x64/levels/gta5/minimap_7_7.ytd"
            ]
        );
        assert_eq!(
            answer["map"]["tiles"][0]["archive"],
            "mods/update/update.rpf"
        );
    }

    #[test]
    fn tiles_refuse_in_order_before_creating_the_folder() {
        let lab = Lab::new();
        let atlas = atlas();
        let root = tiles_basic(&lab, "tiles-basic", &atlas);
        let none = lab.world("tiles-none");
        rpf(&none, "x64a.rpf", vec![bin("other.ytd", quick("other", 1))]);
        let base_dir = tiles_base(&lab, &atlas);
        let missing = base_dir.join("missing.rpf");
        let cases: Vec<(&str, &Path, Vec<String>, &str, String)> = vec![
            (
                "Пл4",
                &root,
                vec!["--base-archive".into(), arg(&missing)],
                "FileNotFoundException",
                format!("File was not found: {}", missing.display()),
            ),
            (
                "Пл5",
                &root,
                vec!["--base-archive".into(), arg(&base_dir.join("update.zip"))],
                "ArgumentException",
                "Unsupported file extension: .zip".into(),
            ),
            (
                "Пл6",
                &root,
                vec!["--base-archive".into(), arg(&base_dir.join("folder.rpf"))],
                "FileNotFoundException",
                format!(
                    "File was not found: {}",
                    base_dir.join("folder.rpf").display()
                ),
            ),
            (
                "Пл7",
                &root,
                vec!["--base-archive".into(), String::new()],
                "ArgumentException",
                "The path is empty.".into(),
            ),
            (
                "Пл31",
                &none,
                vec!["--base-archive".into(), arg(&base_dir.join("update.zip"))],
                "ArgumentException",
                "Unsupported file extension: .zip".into(),
            ),
        ];
        for (label, world, extra, code, message) in cases {
            let tag = format!("R{label}");
            let args = tiles_args(
                &lab,
                world,
                &tag,
                &extra.iter().map(String::as_str).collect::<Vec<_>>(),
            );
            let failure = run_with(TILES, &args).unwrap_err();
            refusal_is((failure.code, failure.message), code, &message);
            assert!(
                !lab.out(&tag).exists(),
                "{label}: папки вывода быть не должно"
            );
        }
        let keys = lab.keys();
        let bad_keys = arg(&lab.root.path().join("worlds"));
        let game = arg(&root);
        let out = arg(&lab.out("Q"));
        let noexe = lab.root.path().join("worlds").join("tiles-noexe");
        fs::create_dir_all(&noexe).unwrap();
        let simple: Vec<(&str, Vec<&str>, &str, &str)> = vec![
            (
                "Пл28",
                vec!["--output", &out, "--keys", &keys],
                "ArgumentException",
                "--game-root is required.",
            ),
            (
                "Пл29",
                vec!["--game-root", &game, "--keys", &keys],
                "ArgumentException",
                "--output is required.",
            ),
            (
                "Пл37",
                vec!["--game-root", &game, "--keys", &keys, "--output"],
                "ArgumentException",
                "A value is required for --output.",
            ),
            (
                "Пл38",
                vec!["game-root", &game],
                "ArgumentException",
                "Invalid native option: game-root",
            ),
        ];
        for (label, args, code, message) in simple {
            refusal_is(refused(TILES, &args), code, message);
            assert!(!lab.out("Q").exists(), "{label}");
        }
        // Пл30 по смыслу: ключи не читаются, папка вывода не создана.
        let failure = refused(
            TILES,
            &["--game-root", &game, "--output", &out, "--keys", &bad_keys],
        );
        assert_eq!(failure.0, "InvalidOperationException");
        assert!(!lab.out("Q").exists());
        // Пл9: плиток нет совсем — папка уже создана и пуста.
        let failure = tiles_run(&lab, &none, "T9", &[]).unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "FileNotFoundException",
            NO_TILES,
        );
        assert!(lab.out("T9").is_dir() && listing(&lab.out("T9")).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn tiles_write_failures_follow_the_windows_codes() {
        let lab = Lab::new();
        let atlas = atlas();
        let root = tiles_basic(&lab, "tiles-basic", &atlas);
        // Пл32: --output — существующий файл.
        let blocked = lab.out("T32");
        fs::create_dir_all(blocked.parent().unwrap()).unwrap();
        fs::write(&blocked, b"1234").unwrap();
        let failure = tiles_run(&lab, &root, "T32", &[]).unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "IOException",
            "Невозможно создать файл, так как он уже существует. (os error 183)",
        );
        // Пл34: каталог на месте minimap_0_1.png; всё записанное раньше остаётся.
        let out = lab.out("T34");
        fs::create_dir_all(out.join("minimap_0_1.png")).unwrap();
        let failure = tiles_run(&lab, &root, "T34", &[]).unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "UnauthorizedAccessException",
            "Отказано в доступе. (os error 5)",
        );
        assert_eq!(
            listing(&out),
            [
                "minimap_0_0.png",
                "minimap_0_0_mask.png",
                "minimap_0_1.png/",
                "minimap_9_9.png"
            ]
        );
    }

    #[test]
    fn tiles_keep_foreign_files_and_replace_stale_pictures() {
        let lab = Lab::new();
        let atlas = atlas();
        let root = tiles_basic(&lab, "tiles-basic", &atlas);
        let out = lab.out("T33");
        fs::create_dir_all(&out).unwrap();
        fs::write(out.join("old.txt"), b"old").unwrap();
        fs::write(out.join("minimap_0_0.png"), b"stale").unwrap();
        tiles_run(&lab, &root, "T33", &[]).unwrap();
        assert_eq!(fs::read(out.join("old.txt")).unwrap(), b"old");
        assert_eq!(
            fs::read(out.join("minimap_0_0.png")).unwrap(),
            oracle_png(&atlas.d00, "minimap_0_0")
        );
        assert_eq!(listing(&out).len(), 9);
    }

    fn row_names(count: usize, base: usize) -> Vec<(String, Vec<u8>)> {
        (0..count)
            .map(|index| {
                let stem = format!("minimap_{}_{}", base + index / 10, index % 10);
                (format!("{stem}.ytd"), quick(&stem, 500 + index as u64))
            })
            .collect()
    }

    fn many_nodes(tiles: Vec<(String, Vec<u8>)>) -> Vec<Node> {
        tiles
            .into_iter()
            .map(|(name, bytes)| bin(&name, bytes))
            .collect()
    }

    #[test]
    fn tiles_are_capped_at_sixty_four_and_the_first_ones_in_order_are_kept() {
        // (пример, плиток в x64a.rpf, плиток в x64b.rpf, архив и файл последней плитки ответа)
        let cases = [
            ("Пл15", 70, 5, "x64a.rpf", "minimap_6_3.ytd"),
            ("Пл16", 64, 5, "x64a.rpf", "minimap_6_3.ytd"),
            ("Пл17", 63, 5, "x64b.rpf", "minimap_10_0.ytd"),
            ("Пл18", 40, 40, "x64b.rpf", "minimap_12_3.ytd"),
        ];
        for (label, first, second, archive, file) in cases {
            let lab = Lab::new();
            let root = lab.world(label);
            rpf(&root, "x64a.rpf", many_nodes(row_names(first, 0)));
            rpf(&root, "x64b.rpf", many_nodes(row_names(second, 10)));
            let answer = tiles_run(&lab, &root, "T", &[]).unwrap();
            assert_eq!(answer["map"]["count"], 64, "{label}");
            let rows = answer["map"]["tiles"].as_array().unwrap();
            assert_eq!(rows.len(), 64, "{label}");
            let last = rows.last().unwrap();
            assert_eq!(
                (&last["archive"], &last["file"]),
                (&json!(archive), &json!(file)),
                "{label}"
            );
            // лишние плитки не пишутся на диск
            assert_eq!(listing(&lab.out("T")).len(), 64, "{label}");
            // поиск плиток для `build-map-patch` предела по числу не получил
            let keys = KeySet::load_dir(&lab.root.path().join("keys")).unwrap();
            let keys = Arc::new(keys);
            let stopped = find_map_tiles(&root, &keys, None);
            let expected = if first >= 64 { first } else { first + second };
            assert_eq!(stopped.len(), expected, "{label}");
            // вариант без остановки видит плитки позднего архива и после архива с 64 плитками
            let all = find_all_map_tiles(&root, &keys, None);
            assert_eq!(all.len(), first + second, "{label}");
            assert!(
                all.iter().any(|tile| tile.archive == "x64b.rpf"),
                "{label}: плитки x64b.rpf не найдены"
            );
        }
        // меньше предела ничего не меняется
        let lab = Lab::new();
        let root = lab.world("Пл-малый");
        rpf(&root, "x64a.rpf", many_nodes(row_names(5, 0)));
        rpf(&root, "x64b.rpf", many_nodes(row_names(3, 10)));
        let answer = tiles_run(&lab, &root, "T", &[]).unwrap();
        assert_eq!(answer["map"]["count"], 8);
        assert_eq!(listing(&lab.out("T")).len(), 8);
    }

    #[test]
    fn named_map_tiles_come_from_every_archive_and_only_the_asked_ones() {
        let lab = Lab::new();
        let root = lab.world("Пл-имена");
        rpf(&root, "x64a.rpf", many_nodes(row_names(70, 0)));
        rpf(&root, "x64b.rpf", many_nodes(row_names(5, 10)));
        let keys = Arc::new(KeySet::load_dir(&lab.root.path().join("keys")).unwrap());
        let asked: BTreeSet<String> = ["minimap_10_1.ytd", "minimap_2_5.ytd", "minimap_9_9.ytd"]
            .iter()
            .map(|name| (*name).to_owned())
            .collect();
        let found = find_named_map_tiles(&root, &keys, None, &asked);
        let seen: Vec<(&str, &str)> = found
            .iter()
            .map(|tile| (tile.archive.as_str(), tile.file.as_str()))
            .collect();
        // порядок архивов, плитки без запрошенных имён не отдаются, а плитки позднего архива находятся
        assert_eq!(
            seen,
            [
                ("x64a.rpf", "minimap_2_5.ytd"),
                ("x64b.rpf", "minimap_10_1.ytd")
            ]
        );
        // словари те же байты, что отдаёт полный обход
        let all = find_all_map_tiles(&root, &keys, None);
        for tile in &found {
            let same = all.iter().find(|other| other.file == tile.file).unwrap();
            assert_eq!((&same.entry, &same.bytes), (&tile.entry, &tile.bytes));
        }
        assert!(find_named_map_tiles(&root, &keys, None, &BTreeSet::new()).is_empty());
    }

    #[test]
    fn tiles_dive_eight_levels_and_no_deeper() {
        let lab = Lab::new();
        let good = quick("minimap_0_0", 600);
        let nest = |depth: usize| {
            (1..=depth)
                .rev()
                .fold(bin("minimap_0_0.ytd", good.clone()), |inner, level| {
                    pack(&format!("n{level}.rpf"), vec![inner])
                })
        };
        let folders = |depth: usize| {
            (1..=depth)
                .rev()
                .fold(bin("minimap_0_0.ytd", good.clone()), |inner, level| {
                    dir(&format!("d{level}"), vec![inner])
                })
        };
        for (label, node, found) in [
            ("Пл19", nest(8), true),
            ("Пл20", nest(9), false),
            ("Пл21", folders(8), true),
            ("Пл22", folders(9), false),
        ] {
            let root = lab.world(label);
            rpf(&root, "x64a.rpf", vec![node]);
            match tiles_run(&lab, &root, label, &[]) {
                Ok(answer) => {
                    assert!(found, "{label}");
                    let entry = answer["map"]["tiles"][0]["entry"]
                        .as_str()
                        .unwrap()
                        .to_owned();
                    let expected_depth = if label == "Пл19" {
                        "n1.rpf/n2.rpf/n3.rpf/n4.rpf/n5.rpf/n6.rpf/n7.rpf/n8.rpf/minimap_0_0.ytd"
                    } else {
                        "d1/d2/d3/d4/d5/d6/d7/d8/minimap_0_0.ytd"
                    };
                    assert_eq!(entry, expected_depth);
                }
                Err(failure) => {
                    assert!(!found, "{label}");
                    refusal_is(
                        (failure.code, failure.message),
                        "FileNotFoundException",
                        NO_TILES,
                    );
                }
            }
        }
    }

    #[test]
    fn tiles_skip_empty_huge_and_broken_entries_and_keep_the_name_taken() {
        let lab = Lab::new();
        let good = quick("minimap_0_2", 610);
        let root = lab.world("tiles-empty-and-huge");
        rpf(
            &root,
            "x64a.rpf",
            vec![
                bin("minimap_0_0.ytd", Vec::new()),
                bin("minimap_0_1.ytd", vec![0u8; DICTIONARY_CEILING + 1]),
                bin("minimap_0_2.ytd", good.clone()),
            ],
        );
        rpf(
            &root,
            "x64b.rpf",
            vec![
                bin("minimap_0_0.ytd", quick("minimap_0_0", 611)),
                bin("minimap_0_1.ytd", quick("minimap_0_1", 612)),
            ],
        );
        let answer = tiles_run(&lab, &root, "T23", &[]).unwrap();
        assert_eq!(answer["map"]["count"], 1);
        assert_eq!(answer["map"]["tiles"][0]["entry"], "minimap_0_2.ytd");
        // Пл27: негодный вложенный архив рядом с хорошей плиткой.
        let nested = lab.world("tiles-badnest");
        rpf(
            &nested,
            "x64a.rpf",
            vec![
                bin("broken.rpf", noise(900, 5)),
                bin("minimap_0_0.ytd", quick("minimap_0_0", 613)),
            ],
        );
        assert_eq!(
            tiles_run(&lab, &nested, "T27", &[]).unwrap()["map"]["count"],
            1
        );
        // Пл26: имена плиток в другом регистре.
        let cased = lab.world("tiles-case");
        rpf(
            &cased,
            "x64a.rpf",
            vec![
                bin("MINIMAP_0_0.YTD", quick("MINIMAP_0_0", 614)),
                bin("Minimap_SEA_1_1.ytd", quick("Minimap_SEA_1_1", 615)),
            ],
        );
        let answer = tiles_run(&lab, &cased, "T26", &[]).unwrap();
        let files: Vec<&str> = answer["map"]["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["file"].as_str().unwrap())
            .collect();
        assert_eq!(files, ["MINIMAP_0_0.YTD", "Minimap_SEA_1_1.ytd"]);
    }

    #[test]
    fn tiles_unreadable_dictionaries_decide_between_skipping_and_refusing() {
        let lab = Lab::new();
        // Пл10: единственная плитка без читаемых текстур.
        let hollow = tamper(
            &quick("minimap_0_0", 620),
            "minimap_0_0",
            Fault::Format(0x1234_5678),
        );
        let root = lab.world("tiles-allskipped");
        rpf(&root, "x64a.rpf", vec![bin("minimap_0_0.ytd", hollow)]);
        let failure = tiles_run(&lab, &root, "T10", &[]).unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "InvalidDataException",
            NO_TILE_TEXTURES,
        );
        assert!(listing(&lab.out("T10")).is_empty());
        // Пл11: из трёх текстур читается одна.
        let mixed = {
            let base = ytd(&[
                texture("good", Format::Dxt1, 4, 4, 1, 621),
                texture("odd_format", Format::Dxt1, 4, 4, 1, 622),
                texture("too_big", Format::Dxt1, 4, 4, 1, 623),
            ]);
            let base = tamper(&base, "odd_format", Fault::Format(0x1234_5678));
            tamper(&base, "too_big", Fault::Size(32768, 32768))
        };
        let root = lab.world("tiles-partskipped");
        rpf(&root, "x64a.rpf", vec![bin("minimap_0_0.ytd", mixed)]);
        let answer = tiles_run(&lab, &root, "T11", &[]).unwrap();
        assert_eq!(answer["map"]["count"], 1);
        assert_eq!(answer["map"]["tiles"][0]["texture"], "good");
        // Пл12: плитка не ресурс — отказ после записанных раньше.
        let root = lab.world("tiles-garbage");
        rpf(
            &root,
            "x64a.rpf",
            vec![
                bin("minimap_0_0.ytd", quick("minimap_0_0", 624)),
                bin("minimap_0_1.ytd", noise(13, 3)),
                bin("minimap_0_2.ytd", quick("minimap_0_2", 625)),
            ],
        );
        let failure = tiles_run(&lab, &root, "T12", &[]).unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "InvalidDataException",
            "Ресурс короче заголовка RSC7.",
        );
        assert_eq!(listing(&lab.out("T12")), ["minimap_0_0.png"]);
    }

    #[test]
    fn tiles_name_files_after_textures_and_merge_equal_names() {
        let lab = Lab::new();
        let names = [
            "Plain-name_1",
            "a:b",
            "back\\slash",
            "dot.name.v2",
            "q?*\"<>|",
            "  spaced  ",
            "   ",
            "x/y",
        ];
        let sheets: Vec<NewTexture> = names
            .iter()
            .enumerate()
            .map(|(index, name)| texture(name, Format::Dxt1, 4, 4, 1, 700 + index as u64))
            .collect();
        let root = lab.world("tiles-names");
        rpf(
            &root,
            "x64a.rpf",
            vec![bin("minimap_0_0.ytd", ytd(&sheets))],
        );
        let answer = tiles_run(&lab, &root, "T13", &[]).unwrap();
        assert_eq!(answer["map"]["count"], 8);
        assert_eq!(
            listing(&lab.out("T13")),
            [
                "Plain-name_1.png",
                "a_b.png",
                "back_slash.png",
                "dot.name.v2.png",
                "q______.png",
                "spaced.png",
                "texture.png",
                "x_y.png"
            ]
        );
        // Пл35: управляющие знаки и буквы не из ASCII.
        // Писатель словарей берёт только ASCII; настоящие имена подставляются в готовый файл.
        let nel = char::from(0x85u8).to_string();
        let del = format!("x{}", char::from(0x7fu8));
        let swaps = [
            ("N0", nel.as_str()),
            ("E0", "é"),
            ("J0", "ж"),
            ("aTb", "a	b"),
            ("xD", del.as_str()),
        ];
        let placeholders = ["N0", "E0", "J0", "aTb", "tail.", "xD"];
        let sheets: Vec<NewTexture> = placeholders
            .iter()
            .enumerate()
            .map(|(index, name)| texture(name, Format::Dxt1, 4, 4, 1, 720 + index as u64))
            .collect();
        let dictionary = swaps.iter().fold(ytd(&sheets), |bytes, (from, to)| {
            rename_texture(&bytes, from, to)
        });
        let root = lab.world("tiles-ctrlnames");
        rpf(&root, "x64a.rpf", vec![bin("minimap_0_0.ytd", dictionary)]);
        tiles_run(&lab, &root, "T35", &[]).unwrap();
        assert_eq!(
            listing(&lab.out("T35")),
            [
                "_.png",
                "a_b.png",
                "tail..png",
                "x_.png",
                "\u{e9}.png",
                "\u{436}.png"
            ]
        );
        // Пл14: `shared` и `SHARED` — два имени, но один файл; записей в ответе обе.
        let root = lab.world("tiles-dupnames");
        rpf(
            &root,
            "x64a.rpf",
            vec![
                bin(
                    "minimap_0_0.ytd",
                    ytd(&[
                        texture("shared", Format::Dxt1, 4, 4, 1, 730),
                        texture("first_only", Format::Dxt1, 4, 4, 1, 731),
                    ]),
                ),
                bin(
                    "minimap_0_1.ytd",
                    ytd(&[texture("SHARED", Format::Dxt1, 8, 8, 1, 732)]),
                ),
            ],
        );
        let answer = tiles_run(&lab, &root, "T14", &[]).unwrap();
        assert_eq!(answer["map"]["count"], 3);
        assert_eq!(listing(&lab.out("T14")).len(), 2);
    }

    #[test]
    fn find_map_tiles_hands_the_dictionaries_over_as_they_are() {
        let lab = Lab::new();
        let atlas = atlas();
        let root = tiles_basic(&lab, "tiles-basic", &atlas);
        let keys = KeySet::load_dir(&lab.root.path().join("keys")).unwrap();
        let tiles = find_map_tiles(&root, &Arc::new(keys), None);
        let seen: Vec<(&str, &str, &str)> = tiles
            .iter()
            .map(|tile| {
                (
                    tile.archive.as_str(),
                    tile.entry.as_str(),
                    tile.file.as_str(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            [
                ("x64a.rpf", "minimap_9_9.ytd", "minimap_9_9.ytd"),
                (
                    "x64a.rpf",
                    "x64/levels/gta5/minimap_0_0.ytd",
                    "minimap_0_0.ytd"
                ),
                (
                    "x64a.rpf",
                    "x64/levels/gta5/minimap_0_1.ytd",
                    "minimap_0_1.ytd"
                ),
                (
                    "x64a.rpf",
                    "x64/levels/gta5/minimap_sea_0_0.ytd",
                    "minimap_sea_0_0.ytd"
                ),
                (
                    "update/update.rpf",
                    "x64/levels/gta5/Minimap_2_0.YTD",
                    "Minimap_2_0.YTD"
                ),
                (
                    "update/update.rpf",
                    "x64/levels/gta5/minimap.rpf/minimap_1_0.ytd",
                    "minimap_1_0.ytd"
                ),
                ("x64b.rpf", "minimap_3_0.ytd", "minimap_3_0.ytd"),
            ]
        );
        assert_eq!(tiles[1].bytes, atlas.d00);
        assert_eq!(tiles[6].bytes, atlas.b30);
    }

    // ----- scan-preview-textures -----

    const PREVIEW: Command = scan_preview_textures;
    const A: &str = "x64a.rpf";
    const U: &str = "update/update.rpf";
    const B: &str = "x64b.rpf";
    const XMAS: &str = "update/x64/dlcpacks/mpchristmas2/dlc.rpf";
    const HEIST: &str = "update/x64/dlcpacks/mpheist/dlc.rpf";
    const SUM: &str = "update/x64/dlcpacks/MPSum/dlc.rpf";
    const GTA5: &str = "x64/levels/gta5";

    /// Исходные словари мира `prev-main`.
    struct Preview {
        flaky: Vec<u8>,
        road1: Vec<u8>,
        road2: Vec<u8>,
        arena: Vec<u8>,
        prop_a: Vec<u8>,
        prop_b: Vec<u8>,
        update_road1: Vec<u8>,
    }

    fn preview_sheets() -> Preview {
        let flaky = {
            let base = ytd(&[
                texture("ok_one", Format::Dxt1, 4, 4, 1, 101),
                texture("unreadable_two", Format::Dxt1, 4, 4, 1, 102),
                texture("big_three", Format::Dxt1, 4, 4, 1, 103),
            ]);
            let base = tamper(&base, "unreadable_two", Fault::Format(0x1234_5678));
            tamper(&base, "big_three", Fault::Size(32768, 32768))
        };
        Preview {
            flaky,
            road1: ytd(&[
                texture("im_road_001", Format::Dxt1, 8, 8, 1, 111),
                texture("im_road_001_n", Format::Ati2, 8, 8, 1, 112),
                texture("commontex", Format::Dxt1, 4, 4, 1, 113),
            ]),
            road2: ytd(&[
                texture("im_road_002", Format::Dxt1, 8, 8, 1, 114),
                texture("commontex", Format::Dxt1, 4, 4, 1, 115),
                texture("Im_Road_003", Format::Dxt5, 8, 8, 2, 116),
            ]),
            arena: ytd(&[
                texture("arena_wall", Format::Dxt5, 8, 8, 1, 117),
                texture("arena_floor", Format::Dxt1, 8, 8, 1, 118),
            ]),
            prop_a: ytd(&[texture("prop_a_tex", Format::Dxt1, 8, 8, 1, 119)]),
            prop_b: ytd(&[texture("Prop_B_Tex", Format::A8R8G8B8, 4, 4, 1, 120)]),
            update_road1: ytd(&[texture("im_road_001", Format::Dxt1, 8, 8, 1, 121)]),
        }
    }

    fn preview_world(lab: &Lab, sheets: &Preview) -> PathBuf {
        let root = lab.world("prev-main");
        let streets = dir(
            "streets",
            vec![
                bin("im_road_001.ytd", sheets.road1.clone()),
                bin("im_road_002.ytd", sheets.road2.clone()),
            ],
        );
        let arena = dir(
            "Arena_01",
            vec![bin("arena_wall.ytd", sheets.arena.clone())],
        );
        let props = pack(
            "props.rpf",
            vec![
                bin("prop_a.ytd", sheets.prop_a.clone()),
                bin("PROP_B.YTD", sheets.prop_b.clone()),
            ],
        );
        let heap = vec![
            bin("flaky.ytd", sheets.flaky.clone()),
            bin("garbage.ytd", noise(64, 7)),
            bin("readme.txt", b"hello".to_vec()),
            bin("data.xml", b"<a/>".to_vec()),
            bin("broken.rpf", noise(400, 8)),
            props,
            arena,
            streets,
        ];
        rpf(
            &root,
            "x64a.rpf",
            vec![dir("x64", vec![dir("levels", vec![dir("gta5", heap)])])],
        );
        let update = vec![dir(
            "x64",
            vec![dir(
                "levels",
                vec![dir(
                    "gta5",
                    vec![
                        bin("update_only.ytd", quick("update_tex", 122)),
                        dir(
                            "streets",
                            vec![bin("im_road_001.ytd", sheets.update_road1.clone())],
                        ),
                    ],
                )],
            )],
        )];
        rpf(&root, "update/update.rpf", update);
        rpf(
            &root,
            "x64b.rpf",
            vec![bin("b_tex.ytd", quick("b_texture", 123))],
        );
        put(&root, "x64c.rpf", b"not an archive");
        for (pack_name, file, texture_name) in [
            ("mpheist", "heist_tex.ytd", "heist_texture"),
            ("MPSum", "sum_tex.ytd", "sum_texture"),
            ("mpchristmas2", "xmas_tex.ytd", "xmas_texture"),
        ] {
            rpf(
                &root,
                &format!("update/x64/dlcpacks/{pack_name}/dlc.rpf"),
                vec![bin(file, quick(texture_name, 130))],
            );
        }
        fs::create_dir_all(root.join("update/x64/dlcpacks/a_empty")).unwrap();
        put(&root, "update/x64/dlcpacks/loose_file.rpf", b"x");
        root
    }

    fn preview_args(lab: &Lab, root: &Path, extra: &[&str]) -> Vec<String> {
        let mut args = vec![
            "--game-root".to_owned(),
            arg(root),
            "--keys".to_owned(),
            lab.keys(),
        ];
        args.extend(extra.iter().map(|part| (*part).to_owned()));
        args
    }

    fn preview_run(lab: &Lab, root: &Path, extra: &[&str]) -> Result<Value> {
        run_with(PREVIEW, &preview_args(lab, root, extra))
    }

    fn scanned_of(answer: &Value) -> Vec<(String, u64)> {
        answer["preview"]["scanned"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                (
                    item["archive"].as_str().unwrap().to_owned(),
                    item["dictionaries"].as_u64().unwrap(),
                )
            })
            .collect()
    }

    fn listed_of(answer: &Value) -> Vec<(String, String)> {
        answer["preview"]["dictionaries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                (
                    item["archive"].as_str().unwrap().to_owned(),
                    item["entry"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    fn textures_of(answer: &Value) -> Vec<(String, String)> {
        answer["preview"]["textures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                (
                    item["texture"].as_str().unwrap().to_owned(),
                    item["dictionary"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
            .collect()
    }

    fn counts(items: &[(&str, u64)]) -> Vec<(String, u64)> {
        items.iter().map(|(a, n)| ((*a).to_owned(), *n)).collect()
    }

    const FULL_SCAN: [(&str, u64); 7] = [
        (A, 7),
        (U, 2),
        (B, 1),
        ("x64c.rpf", 0),
        (XMAS, 1),
        (HEIST, 1),
        (SUM, 1),
    ];

    fn every_dictionary() -> Vec<(String, String)> {
        pairs(&[
            (A, "x64/levels/gta5/flaky.ytd"),
            (A, "x64/levels/gta5/garbage.ytd"),
            (A, "x64/levels/gta5/props.rpf/PROP_B.YTD"),
            (A, "x64/levels/gta5/props.rpf/prop_a.ytd"),
            (A, "x64/levels/gta5/Arena_01/arena_wall.ytd"),
            (A, "x64/levels/gta5/streets/im_road_001.ytd"),
            (A, "x64/levels/gta5/streets/im_road_002.ytd"),
            (U, "x64/levels/gta5/update_only.ytd"),
            (U, "x64/levels/gta5/streets/im_road_001.ytd"),
            (B, "b_tex.ytd"),
            (XMAS, "xmas_tex.ytd"),
            (HEIST, "heist_tex.ytd"),
            (SUM, "sum_tex.ytd"),
        ])
    }

    const ROAD1: (&str, &str) = (A, "x64/levels/gta5/streets/im_road_001.ytd");
    const ROAD2: (&str, &str) = (A, "x64/levels/gta5/streets/im_road_002.ytd");
    const UP_ROAD1: (&str, &str) = (U, "x64/levels/gta5/streets/im_road_001.ytd");

    /// Одна строка таблицы: параметры и что должно прийти в ответ.
    struct Case {
        label: &'static str,
        args: &'static [&'static str],
        mode: &'static str,
        scanned: Vec<(&'static str, u64)>,
        dictionaries: Vec<(String, String)>,
        textures: Vec<(&'static str, &'static str)>,
        truncated: bool,
    }

    fn case(
        label: &'static str,
        args: &'static [&'static str],
        mode: &'static str,
        scanned: &[(&'static str, u64)],
        dictionaries: Vec<(String, String)>,
        textures: &[(&'static str, &'static str)],
    ) -> Case {
        Case {
            label,
            args,
            mode,
            scanned: scanned.to_vec(),
            dictionaries,
            textures: textures.to_vec(),
            truncated: false,
        }
    }

    #[test]
    fn preview_cases_from_the_examples_without_output() {
        let lab = Lab::new();
        let root = preview_world(&lab, &preview_sheets());
        let flat =
            |label: &'static str, args: &'static [&'static str], dictionaries: &[(&str, &str)]| {
                case(label, args, "catalog", &FULL_SCAN, pairs(dictionaries), &[])
            };
        let road_scan: Vec<(&str, u64)> = vec![
            (A, 2),
            (U, 1),
            (B, 0),
            ("x64c.rpf", 0),
            (XMAS, 0),
            (HEIST, 0),
            (SUM, 0),
        ];
        let only_x64a = |count: u64| -> Vec<(&'static str, u64)> {
            [
                (A, count),
                (U, 0),
                (B, 0),
                ("x64c.rpf", 0),
                (XMAS, 0),
                (HEIST, 0),
                (SUM, 0),
            ]
            .to_vec()
        };
        let cases = vec![
            case("Пр1", &[], "catalog", &FULL_SCAN, every_dictionary(), &[]),
            case(
                "Пр2",
                &["--dictionary", "*road*"],
                "catalog",
                &road_scan,
                pairs(&[ROAD1, ROAD2, UP_ROAD1]),
                &[],
            ),
            case(
                "Пр3",
                &["--limit", "3"],
                "catalog",
                &[(A, 3)],
                every_dictionary()[..3].to_vec(),
                &[],
            )
            .cut(),
            case(
                "Пр4",
                &["--texture", "im_road*"],
                "inspect",
                &FULL_SCAN,
                pairs(&[ROAD1, ROAD2, UP_ROAD1]),
                &[
                    ("im_road_001_n", "im_road_001.ytd"),
                    ("im_road_001", "im_road_001.ytd"),
                    ("im_road_002", "im_road_002.ytd"),
                    ("Im_Road_003", "im_road_002.ytd"),
                ],
            ),
            case(
                "Пр13",
                &[
                    "--dictionary",
                    "*arena*",
                    "--dictionary",
                    "*prop*",
                    "--texture",
                    "prop_*",
                    "--texture",
                    "arena_w?ll",
                ],
                "inspect",
                &only_x64a(3),
                pairs(&[
                    (A, "x64/levels/gta5/props.rpf/PROP_B.YTD"),
                    (A, "x64/levels/gta5/props.rpf/prop_a.ytd"),
                    (A, "x64/levels/gta5/Arena_01/arena_wall.ytd"),
                ]),
                &[
                    ("Prop_B_Tex", "PROP_B.YTD"),
                    ("prop_a_tex", "prop_a.ytd"),
                    ("arena_wall", "arena_wall.ytd"),
                ],
            ),
            case(
                "Пр14",
                &["--dictionary", "*road*", "--texture", "zzz*"],
                "inspect",
                &road_scan,
                vec![],
                &[],
            ),
            case(
                "Пр18",
                &["--dictionary", "*garbage*", "--texture", "*"],
                "inspect",
                &only_x64a(1),
                vec![],
                &[],
            ),
            case(
                "Пр19",
                &["--dictionary", ""],
                "catalog",
                &only_x64a(0),
                vec![],
                &[],
            ),
            case(
                "Пр20",
                &["--texture", ""],
                "inspect",
                &FULL_SCAN,
                vec![],
                &[],
            ),
            case(
                "Пр21",
                &["--dictionary", "*PROP_?.YTD", "--texture", "PROP_?_TEX"],
                "inspect",
                &only_x64a(2),
                pairs(&[
                    (A, "x64/levels/gta5/props.rpf/PROP_B.YTD"),
                    (A, "x64/levels/gta5/props.rpf/prop_a.ytd"),
                ]),
                &[("Prop_B_Tex", "PROP_B.YTD"), ("prop_a_tex", "prop_a.ytd")],
            ),
            case(
                "Пр22",
                &["--dictionary", "  *prop*  ", "--texture", "  prop_a_tex "],
                "inspect",
                &only_x64a(2),
                pairs(&[(A, "x64/levels/gta5/props.rpf/prop_a.ytd")]),
                &[("prop_a_tex", "prop_a.ytd")],
            ),
            flat("Пр49", &["--dictionary", "streets/im_road_001.ytd"], &[])
                .with_scan(&only_all_zero()),
            flat(
                "Пр51",
                &["--dictionary", "*streets/im_road_00?.ytd"],
                &[ROAD1, ROAD2, UP_ROAD1],
            )
            .with_scan(&road_scan),
            flat(
                "Пр53",
                &["--dictionary", "im_road_001.ytd"],
                &[ROAD1, UP_ROAD1],
            )
            .with_scan(&[
                (A, 1),
                (U, 1),
                (B, 0),
                ("x64c.rpf", 0),
                (XMAS, 0),
                (HEIST, 0),
                (SUM, 0),
            ]),
            flat("Пр50", &["--dictionary", "*streets\\im_road*"], &[]).with_scan(&only_all_zero()),
            case(
                "Пр52",
                &["--texture", "im_road_00[12]"],
                "inspect",
                &FULL_SCAN,
                vec![],
                &[],
            ),
            case(
                "Пр54",
                &["--texture", "im_road_001.*"],
                "inspect",
                &FULL_SCAN,
                vec![],
                &[],
            ),
            case(
                "Пр26",
                &["--limit", "abc"],
                "catalog",
                &FULL_SCAN,
                every_dictionary(),
                &[],
            ),
            case(
                "Пр27",
                &["--limit", "-5"],
                "catalog",
                &FULL_SCAN,
                every_dictionary(),
                &[],
            ),
            case(
                "Пр29",
                &["--limit", "2.5"],
                "catalog",
                &FULL_SCAN,
                every_dictionary(),
                &[],
            ),
            case(
                "Пр30",
                &["--limit", "99999999999"],
                "catalog",
                &FULL_SCAN,
                every_dictionary(),
                &[],
            ),
            case(
                "Пр31",
                &["--limit", "2147483648"],
                "catalog",
                &FULL_SCAN,
                every_dictionary(),
                &[],
            ),
            case(
                "Пр33",
                &["--limit", "0"],
                "catalog",
                &FULL_SCAN,
                every_dictionary(),
                &[],
            ),
            case(
                "Пр28",
                &["--limit", " 7 "],
                "catalog",
                &[(A, 7)],
                every_dictionary()[..7].to_vec(),
                &[],
            )
            .cut(),
            case(
                "Пр32",
                &["--limit", "+3"],
                "catalog",
                &[(A, 3)],
                every_dictionary()[..3].to_vec(),
                &[],
            )
            .cut(),
        ];
        for item in cases {
            let answer = preview_run(&lab, &root, item.args)
                .unwrap_or_else(|e| panic!("{}: {e}", item.label));
            assert_eq!(answer["preview"]["mode"], item.mode, "{}", item.label);
            assert_eq!(
                scanned_of(&answer),
                counts(&item.scanned),
                "{}: scanned",
                item.label
            );
            assert_eq!(
                listed_of(&answer),
                item.dictionaries,
                "{}: dictionaries",
                item.label
            );
            assert_eq!(
                textures_of(&answer),
                pairs(&item.textures),
                "{}: textures",
                item.label
            );
            assert_eq!(answer["preview"]["output"], Value::Null, "{}", item.label);
            assert_eq!(
                answer["preview"]["truncated"], item.truncated,
                "{}: truncated",
                item.label
            );
            assert_eq!(answer["keySource"], KEY_LABEL);
        }
    }

    fn only_all_zero() -> Vec<(&'static str, u64)> {
        [
            (A, 0),
            (U, 0),
            (B, 0),
            ("x64c.rpf", 0),
            (XMAS, 0),
            (HEIST, 0),
            (SUM, 0),
        ]
        .to_vec()
    }

    impl Case {
        fn with_scan(mut self, scan: &[(&'static str, u64)]) -> Case {
            self.scanned = scan.to_vec();
            self
        }

        /// Предел оборвал список: подходящих записей было больше, чем отдано.
        fn cut(mut self) -> Case {
            self.truncated = true;
            self
        }
    }

    #[test]
    fn preview_inspection_lists_every_texture_the_extraction_would_lose() {
        let lab = Lab::new();
        let root = preview_world(&lab, &preview_sheets());
        // Пр17: без --output в списке все три текстуры, у нечитаемых формат — число строкой.
        let answer =
            preview_run(&lab, &root, &["--dictionary", "flaky*", "--texture", "*"]).unwrap();
        let rows = answer["preview"]["textures"].as_array().unwrap();
        assert_eq!(rows.len(), 3);
        let find = |name: &str| {
            rows.iter()
                .find(|row| row["texture"] == name)
                .unwrap()
                .clone()
        };
        assert_eq!(find("ok_one")["format"], "D3DFMT_DXT1");
        assert_eq!(find("unreadable_two")["format"], "305419896");
        assert_eq!(find("big_three")["width"], 32768);
        assert!(rows
            .iter()
            .all(|row| row["png"].is_null() && row["bytes"] == 0));
    }

    #[test]
    fn preview_extraction_writes_pngs_and_answers_with_their_paths() {
        let lab = Lab::new();
        let sheets = preview_sheets();
        let root = preview_world(&lab, &sheets);
        let out = lab.out("P5");
        let answer = preview_run(
            &lab,
            &root,
            &["--output", &arg(&out), "--texture", "im_road*"],
        )
        .unwrap();
        assert_eq!(answer["preview"]["mode"], "extract");
        assert_eq!(answer["preview"]["output"], text(&out));
        let row = |texture_name: &str,
                   entry: &str,
                   file: &str,
                   dict: &[u8],
                   size: (u32, u32, u32),
                   format: &str| {
            let png = oracle_png(dict, texture_name);
            json!({
                "texture": texture_name, "archive": A, "entry": entry, "dictionary": file,
                "width": size.0, "height": size.1, "levels": size.2, "format": format,
                "png": text(&out.join(format!("{texture_name}.png"))), "bytes": png.len(),
            })
        };
        let road1 = format!("{GTA5}/streets/im_road_001.ytd");
        let road2 = format!("{GTA5}/streets/im_road_002.ytd");
        assert_eq!(
            answer["preview"]["textures"],
            json!([
                row(
                    "im_road_001_n",
                    &road1,
                    "im_road_001.ytd",
                    &sheets.road1,
                    (8, 8, 1),
                    "D3DFMT_ATI2"
                ),
                row(
                    "im_road_001",
                    &road1,
                    "im_road_001.ytd",
                    &sheets.road1,
                    (8, 8, 1),
                    "D3DFMT_DXT1"
                ),
                row(
                    "im_road_002",
                    &road2,
                    "im_road_002.ytd",
                    &sheets.road2,
                    (8, 8, 1),
                    "D3DFMT_DXT1"
                ),
                row(
                    "Im_Road_003",
                    &road2,
                    "im_road_002.ytd",
                    &sheets.road2,
                    (8, 8, 2),
                    "D3DFMT_DXT5"
                ),
            ])
        );
        assert_eq!(
            listing(&out),
            [
                "Im_Road_003.png",
                "im_road_001.png",
                "im_road_001_n.png",
                "im_road_002.png"
            ]
        );
        assert_eq!(
            fs::read(out.join("im_road_001.png")).unwrap(),
            oracle_png(&sheets.road1, "im_road_001")
        );
    }

    #[test]
    fn preview_limit_stops_in_the_middle_of_a_dictionary() {
        let lab = Lab::new();
        let root = preview_world(&lab, &preview_sheets());
        let out = lab.out("P6");
        let answer = preview_run(
            &lab,
            &root,
            &["--output", &arg(&out), "--texture", "*", "--limit", "2"],
        )
        .unwrap();
        assert_eq!(scanned_of(&answer), counts(&[(A, 3)]));
        assert_eq!(
            listed_of(&answer),
            pairs(&[
                (A, "x64/levels/gta5/flaky.ytd"),
                (A, "x64/levels/gta5/props.rpf/PROP_B.YTD")
            ])
        );
        assert_eq!(
            textures_of(&answer),
            pairs(&[("ok_one", "flaky.ytd"), ("Prop_B_Tex", "PROP_B.YTD")])
        );
        assert_eq!(listing(&out), ["Prop_B_Tex.png", "ok_one.png"]);
    }

    fn truncated_of(answer: &Value) -> bool {
        answer["preview"]["truncated"].as_bool().unwrap()
    }

    #[test]
    fn preview_truncated_is_true_only_when_the_limit_left_something_behind() {
        let lab = Lab::new();
        // каталог: пять словарей в первом архиве, во втором ни одного
        let root = lab.world("trunc-catalog");
        let five: Vec<Node> = (0..5)
            .map(|index| bin(&format!("t{index}.ytd"), vec![index as u8; 20]))
            .collect();
        rpf(&root, "x64a.rpf", five);
        rpf(&root, "x64b.rpf", vec![bin("readme.txt", b"x".to_vec())]);
        for (limit, expected) in [("5", false), ("6", false), ("4", true), ("1", true)] {
            let answer = preview_run(&lab, &root, &["--limit", limit]).unwrap();
            assert_eq!(truncated_of(&answer), expected, "limit {limit}");
        }
        assert!(!truncated_of(&preview_run(&lab, &root, &[]).unwrap()));
        // словарь в следующем архиве тоже «больше»: список при этом тот же
        rpf(&root, "x64b.rpf", vec![bin("more.ytd", vec![9u8; 20])]);
        let answer = preview_run(&lab, &root, &["--limit", "5"]).unwrap();
        assert!(truncated_of(&answer));
        assert_eq!(scanned_of(&answer), counts(&[(A, 5)]));
        assert_eq!(listed_of(&answer).len(), 5);
        let answer = preview_run(&lab, &root, &["--limit", "6"]).unwrap();
        assert!(!truncated_of(&answer));
        assert_eq!(scanned_of(&answer), counts(&[(A, 5), (B, 1)]));

        // встроенный предел 4000: ровно 4000 — не обрезано, 4001 — обрезано
        let many = lab.world("trunc-many");
        let numbered = |count: usize| -> Vec<Node> {
            (0..count)
                .map(|index| bin(&format!("t{index:04}.ytd"), vec![index as u8; 20]))
                .collect()
        };
        rpf(&many, "x64a.rpf", numbered(4000));
        assert!(!truncated_of(&preview_run(&lab, &many, &[]).unwrap()));
        rpf(&many, "x64a.rpf", numbered(4001));
        assert!(truncated_of(&preview_run(&lab, &many, &[]).unwrap()));

        // осмотр и выкладка считают текстуры
        let world = preview_world(&lab, &preview_sheets());
        let flaky = ["--dictionary", "flaky*", "--texture", "*"];
        for (limit, expected) in [("1", true), ("2", true), ("3", false), ("9", false)] {
            let mut args = flaky.to_vec();
            args.extend(["--limit", limit]);
            let answer = preview_run(&lab, &world, &args).unwrap();
            assert_eq!(truncated_of(&answer), expected, "inspect, limit {limit}");
        }
        // в выкладке нечитаемые текстуры не попадают в список, поэтому за пределом пусто
        let out = lab.out("trunc-flaky");
        let mut args = flaky.to_vec();
        let out_text = arg(&out);
        args.extend(["--output", out_text.as_str(), "--limit", "1"]);
        let answer = preview_run(&lab, &world, &args).unwrap();
        assert_eq!(textures_of(&answer), pairs(&[("ok_one", "flaky.ytd")]));
        assert!(!truncated_of(&answer));
        assert_eq!(listing(&out), ["ok_one.png"]);
        // имя, уже взятое раньше, остатком не считается
        let answer = preview_run(
            &lab,
            &world,
            &[
                "--dictionary",
                "im_road_00*",
                "--texture",
                "commontex",
                "--limit",
                "1",
            ],
        )
        .unwrap();
        assert_eq!(
            textures_of(&answer),
            pairs(&[("commontex", "im_road_001.ytd")])
        );
        assert!(!truncated_of(&answer));
        // предел посреди словаря: остаток словаря и следующие словари есть
        let out = lab.out("trunc-mid");
        let answer = preview_run(
            &lab,
            &world,
            &["--output", &arg(&out), "--texture", "*", "--limit", "2"],
        )
        .unwrap();
        assert!(truncated_of(&answer));
        assert_eq!(listing(&out), ["Prop_B_Tex.png", "ok_one.png"]);
    }

    #[test]
    fn preview_extraction_cases_from_the_examples() {
        let lab = Lab::new();
        let root = preview_world(&lab, &preview_sheets());
        let run = |tag: &str, extra: &[&str]| {
            let out = lab.out(tag);
            let mut args = vec!["--output", out.to_str().unwrap()];
            args.extend_from_slice(extra);
            (preview_run(&lab, &root, &args).unwrap(), out)
        };
        // Пр7: маска словаря по пути, все текстуры.
        let (answer, out) = run("P7", &["--dictionary", "*arena*", "--texture", "*"]);
        assert_eq!(
            textures_of(&answer),
            pairs(&[
                ("arena_wall", "arena_wall.ytd"),
                ("arena_floor", "arena_wall.ytd")
            ])
        );
        assert_eq!(listing(&out), ["arena_floor.png", "arena_wall.png"]);
        // Пр8: одинаковое имя в нескольких словарях — берётся первая.
        let (answer, _) = run("P8", &["--texture", "commontex"]);
        assert_eq!(listed_of(&answer), pairs(&[ROAD1, ROAD2]));
        assert_eq!(
            textures_of(&answer),
            pairs(&[("commontex", "im_road_001.ytd")])
        );
        // Пр9: свой порядок архивов, обратные косые, несуществующий архив; DLC не добавляются.
        let (answer, _) = run(
            "P9",
            &[
                "--archive",
                "update\\update.rpf",
                "--archive",
                "nothing.rpf",
                "--archive",
                "/x64a.rpf",
                "--texture",
                "im_road_001",
            ],
        );
        assert_eq!(scanned_of(&answer), counts(&[(U, 2), (A, 7)]));
        assert_eq!(listed_of(&answer), pairs(&[UP_ROAD1, ROAD1]));
        assert_eq!(answer["preview"]["textures"][0]["archive"], U);
        // Пр15: каталог с --output — файлов нет.
        let out = lab.out("P15b");
        let answer = preview_run(
            &lab,
            &root,
            &["--output", &arg(&out), "--dictionary", "*road*"],
        )
        .unwrap();
        assert_eq!(answer["preview"]["mode"], "catalog");
        assert_eq!(answer["preview"]["output"], text(&out));
        assert!(listing(&out).is_empty());
        // Пр16: словарь с нечитаемыми текстурами — выложена только читаемая.
        let (answer, out) = run("P16", &["--dictionary", "flaky*", "--texture", "*"]);
        assert_eq!(textures_of(&answer), pairs(&[("ok_one", "flaky.ytd")]));
        assert_eq!(listing(&out), ["ok_one.png"]);
        // Пр47: --output из нескольких новых уровней с кириллицей.
        let deep = lab
            .out("P47")
            .join("\u{432}\u{44b}\u{432}\u{43e}\u{434}")
            .join("\u{43f}\u{440}\u{435}\u{432}\u{44c}\u{44e}");
        let answer = preview_run(
            &lab,
            &root,
            &["--output", &arg(&deep), "--texture", "arena_*"],
        )
        .unwrap();
        assert_eq!(textures_of(&answer).len(), 2);
        assert_eq!(listing(&deep), ["arena_floor.png", "arena_wall.png"]);
    }

    #[test]
    fn preview_dlc_filter_and_archive_options() {
        let lab = Lab::new();
        let root = preview_world(&lab, &preview_sheets());
        let upper = ["x64a.rpf", "update/update.rpf", "x64b.rpf", "x64c.rpf"];
        let head = |names: &[&'static str]| -> Vec<(String, u64)> {
            let all = [(A, 7u64), (U, 2), (B, 1), ("x64c.rpf", 0)];
            all.iter()
                .filter(|(n, _)| names.contains(n))
                .map(|(n, c)| ((*n).to_owned(), *c))
                .collect()
        };
        // Пр10: --dlc heist берёт пакеты по подстроке имени папки.
        let answer = preview_run(&lab, &root, &["--dlc", "HEIST"]).unwrap();
        let mut expected = head(&upper);
        expected.push((HEIST.to_owned(), 1));
        assert_eq!(scanned_of(&answer), expected);
        // Пр11: --dlc из пробелов — фильтра нет.
        let answer =
            preview_run(&lab, &root, &["--dlc", "   ", "--dictionary", "*tex.ytd"]).unwrap();
        assert_eq!(
            scanned_of(&answer),
            counts(&[
                (A, 0),
                (U, 0),
                (B, 1),
                ("x64c.rpf", 0),
                (XMAS, 1),
                (HEIST, 1),
                (SUM, 1)
            ])
        );
        assert_eq!(
            listed_of(&answer),
            pairs(&[
                (B, "b_tex.ytd"),
                (XMAS, "xmas_tex.ytd"),
                (HEIST, "heist_tex.ytd"),
                (SUM, "sum_tex.ytd")
            ])
        );
        // Пр12: при --archive --dlc не действует.
        let answer =
            preview_run(&lab, &root, &["--dlc", "heist", "--archive", "x64b.rpf"]).unwrap();
        assert_eq!(scanned_of(&answer), counts(&[(B, 1)]));
        // Пр57: звёздочка в --dlc — часть подстроки, а не маска.
        let answer = preview_run(&lab, &root, &["--dlc", "mp*"]).unwrap();
        assert_eq!(scanned_of(&answer), head(&upper));
        // Пр37, Пр55, Пр56: нормализация, каталог вместо архива, один архив дважды.
        let answer = preview_run(&lab, &root, &["--archive", "\\\\x64b.rpf"]).unwrap();
        assert_eq!(scanned_of(&answer), counts(&[(B, 1)]));
        let answer = preview_run(
            &lab,
            &root,
            &["--archive", "update", "--archive", "x64b.rpf"],
        )
        .unwrap();
        assert_eq!(scanned_of(&answer), counts(&[(B, 1)]));
        let answer = preview_run(
            &lab,
            &root,
            &[
                "--archive",
                "x64b.rpf",
                "--archive",
                "X64B.rpf",
                "--texture",
                "*",
            ],
        )
        .unwrap();
        assert_eq!(
            scanned_of(&answer),
            counts(&[("x64b.rpf", 1), ("X64B.rpf", 1)])
        );
        assert_eq!(listed_of(&answer).len(), 2);
        assert_eq!(textures_of(&answer), pairs(&[("b_texture", "b_tex.ytd")]));
    }

    #[test]
    fn preview_archive_refusals_and_folder_state() {
        let lab = Lab::new();
        let root = preview_world(&lab, &preview_sheets());
        for (value, shown) in [
            ("../x64a.rpf", "../x64a.rpf"),
            ("", ""),
            ("C:/x64a.rpf", "C:/x64a.rpf"),
        ] {
            let failure = preview_run(&lab, &root, &["--archive", value]).unwrap_err();
            refusal_is(
                (failure.code, failure.message),
                "InvalidDataException",
                &format!("Unsafe relative path: {shown}"),
            );
        }
        // Пр45: --output задан — папка создана до отказа и пуста.
        let out = lab.out("P45");
        let failure = preview_run(
            &lab,
            &root,
            &[
                "--output",
                &arg(&out),
                "--texture",
                "*",
                "--archive",
                "../x",
            ],
        )
        .unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "InvalidDataException",
            "Unsafe relative path: ../x",
        );
        assert!(out.is_dir() && listing(&out).is_empty());
        // Пр39–Пр42: порядок отказов; папка вывода не создаётся.
        let untouched = lab.out("P41");
        let keys = lab.keys();
        let game = arg(&root);
        let out_arg = arg(&untouched);
        let bad_keys = arg(&lab.root.path().join("worlds"));
        let noexe = lab.root.path().join("worlds").join("prev-noexe");
        fs::create_dir_all(&noexe).unwrap();
        let noexe = arg(&noexe);
        let cases: Vec<(&str, Vec<&str>, &str, &str)> = vec![
            (
                "Пр39",
                vec!["--keys", &keys],
                "ArgumentException",
                "--game-root is required.",
            ),
            (
                "Пр40",
                vec!["--game-root", &noexe, "--keys", &keys],
                "DirectoryNotFoundException",
                "The selected directory is not a GTA V installation.",
            ),
            (
                "Пр42",
                vec!["--game-root", &game, "--keys", &keys, "--output", ""],
                "ArgumentException",
                "The path is empty.",
            ),
        ];
        for (label, args, code, message) in cases {
            refusal_is(refused(PREVIEW, &args), code, message);
            assert!(!untouched.exists(), "{label}");
        }
        let failure = refused(
            PREVIEW,
            &[
                "--game-root",
                &game,
                "--keys",
                &bad_keys,
                "--output",
                &out_arg,
            ],
        );
        assert_eq!(failure.0, "InvalidOperationException");
        assert!(!untouched.exists());
    }

    #[cfg(windows)]
    #[test]
    fn preview_write_failures_skip_the_texture_and_keep_its_name_taken() {
        let lab = Lab::new();
        let root = preview_world(&lab, &preview_sheets());
        // Пр44: на месте im_road_001.png каталог — текстура пропущена молча.
        let out = lab.out("P44");
        fs::create_dir_all(out.join("im_road_001.png")).unwrap();
        let answer = preview_run(
            &lab,
            &root,
            &["--output", &arg(&out), "--texture", "im_road_001*"],
        )
        .unwrap();
        assert_eq!(
            textures_of(&answer),
            pairs(&[("im_road_001_n", "im_road_001.ytd")])
        );
        assert_eq!(listing(&out), ["im_road_001.png/", "im_road_001_n.png"]);
        // Пр43: --output — существующий файл.
        let blocked = lab.out("P43");
        fs::create_dir_all(blocked.parent().unwrap()).unwrap();
        fs::write(&blocked, b"1234").unwrap();
        let failure =
            preview_run(&lab, &root, &["--output", &arg(&blocked), "--texture", "*"]).unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "IOException",
            "Невозможно создать файл, так как он уже существует. (os error 183)",
        );
        assert_eq!(fs::read(&blocked).unwrap(), b"1234");
    }

    #[test]
    fn preview_catalog_is_cut_at_four_thousand_and_by_the_limit() {
        let lab = Lab::new();
        let root = lab.world("prev-many");
        let files: Vec<Node> = (0..4010)
            .map(|index| bin(&format!("t{index:04}.ytd"), vec![index as u8; 20]))
            .collect();
        rpf(&root, "x64a.rpf", files);
        // Пр23: каталог из 4010 словарей обрезан по 4000; признак обрезки истинный.
        let answer = preview_run(&lab, &root, &[]).unwrap();
        assert_eq!(scanned_of(&answer), counts(&[(A, 4000)]));
        assert_eq!(listed_of(&answer).len(), 4000);
        assert_eq!(answer["preview"]["truncated"], true);
        assert_eq!(listed_of(&answer)[3999].1, "t3999.ytd");
        // Пр24: --limit 5.
        let answer = preview_run(&lab, &root, &["--limit", "5"]).unwrap();
        assert_eq!(scanned_of(&answer), counts(&[(A, 5)]));
        assert_eq!(listed_of(&answer).last().unwrap().1, "t0004.ytd");
    }

    #[test]
    fn preview_odd_names_and_the_mods_layer() {
        let lab = Lab::new();
        let root = lab.world("prev-odd");
        let blob = vec![1u8; 20];
        rpf(
            &root,
            "x64a.rpf",
            vec![
                bin(".ytd", blob.clone()),
                bin("a.ytd.bak", blob.clone()),
                bin("ytd", blob.clone()),
                bin("x.YTd", blob.clone()),
                bin("\u{e9}.ytd", blob.clone()),
                bin(
                    "\u{43f}\u{440}\u{438}\u{43c}\u{435}\u{440}.YTD",
                    blob.clone(),
                ),
                dir("some.ytd", vec![bin("inside.txt", blob.clone())]),
            ],
        );
        let answer = preview_run(&lab, &root, &[]).unwrap();
        let entries: Vec<String> = listed_of(&answer)
            .into_iter()
            .map(|(_, entry)| entry)
            .collect();
        assert_eq!(
            entries,
            [
                ".ytd",
                "x.YTd",
                "\u{e9}.ytd",
                "\u{43f}\u{440}\u{438}\u{43c}\u{435}\u{440}.YTD"
            ]
        );
        // Пр25: слой модов виден в порядке просмотра.
        let modded = lab.world("prev-mods");
        put(&modded, "dsound.dll", b"x");
        put(&modded, "RageOpenV.asi", b"x");
        rpf(
            &modded,
            "mods/x64a.rpf",
            vec![bin("modded.ytd", blob.clone())],
        );
        rpf(
            &modded,
            "mods/x64q.rpf",
            vec![bin("never.ytd", blob.clone())],
        );
        rpf(&modded, "update/update.rpf", vec![bin("upd.ytd", blob)]);
        let answer = preview_run(&lab, &modded, &[]).unwrap();
        assert_eq!(scanned_of(&answer), counts(&[("mods/x64a.rpf", 1), (U, 1)]));
        assert_eq!(
            listed_of(&answer),
            pairs(&[("mods/x64a.rpf", "modded.ytd"), (U, "upd.ytd")])
        );
    }
}
