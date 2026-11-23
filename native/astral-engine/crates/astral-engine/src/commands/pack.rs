//! `pack-textures`: из готовых файлов DDS собираются небольшие словари `.ytd`.
//!
//! Запрос проверяется целиком до любых действий с диском. Дальше для каждого словаря по
//! порядку читаются DDS, при желании берётся служебный образец листа из штатного словаря
//! (`source` и `from`), словарь собирается `write_host`, читается заново и пишется в папку вывода.

use std::{
    collections::{hash_map, HashMap, HashSet},
    fmt, fs,
    ops::RangeInclusive,
    path::{Path, PathBuf},
};

use rage_res::{
    dds::{self, Dds},
    hash::sha256_hex,
    ytd_write::{self, Entry, NewTexture, TEXTURE_BYTES},
};
use serde_json::{json, Map, Value};

use super::shop::{valid_name, write_atomic};
use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const REQUEST_FORMAT: &str = "astral.pack-textures";
const REQUEST_FILE: &[&str] = &[".json"];
const REQUEST_BYTES: RangeInclusive<u64> = 1..=262_144;
const DICTIONARIES: RangeInclusive<usize> = 1..=64;
const SHEETS: RangeInclusive<usize> = 1..=16;
const DICTIONARY_NAME_BYTES: RangeInclusive<usize> = 1..=63;
const DDS_BYTES: RangeInclusive<u64> = 1..=33_554_432;
const SOURCE_BYTES: RangeInclusive<u64> = 1..=100_663_296;

// ---------------------------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------------------------

/// Слова отказов. Верхний уровень - по-русски с приставкой, словари и листы - по-английски.
enum Refusal<'a> {
    RequestSize,
    Json,
    Format,
    NoList,
    DictionaryCount,
    DictionaryName,
    DictionaryTwice(&'a str),
    NoSheets(&'a str),
    SheetCount(&'a str),
    SheetName(&'a str),
    SheetTwice(&'a str, &'a str),
    DdsMissing(&'a str),
    OutputIsFile,
    DdsUnreadable(&'a str),
    SourceMissing(&'a str),
    SourceUnreadable(&'a str),
    SourceLacks(&'a str, &'a str),
    Reopen(&'a str),
}

impl Refusal<'_> {
    fn words(&self) -> String {
        match self {
            Refusal::RequestSize => "pack-textures: запрос от 1 байта до 256 КБ.".to_owned(),
            Refusal::Json => "pack-textures: JSON не разбирается.".to_owned(),
            Refusal::Format => "pack-textures: неизвестный формат запроса.".to_owned(),
            Refusal::NoList => "pack-textures: нужен список dictionaries.".to_owned(),
            Refusal::DictionaryCount => "pack-textures: от 1 до 64 словарей.".to_owned(),
            Refusal::DictionaryName => {
                "Dictionary name must be lowercase letters, digits and underscores.".to_owned()
            }
            Refusal::DictionaryTwice(name) => format!("Dictionary {name} is listed twice."),
            Refusal::NoSheets(name) => format!("Dictionary {name} has no textures."),
            Refusal::SheetCount(name) => format!("Dictionary {name} takes 1 to 16 textures."),
            Refusal::SheetName(dictionary) => {
                format!("Texture name in {dictionary} is not valid.")
            }
            Refusal::SheetTwice(sheet, dictionary) => {
                format!("Texture {sheet} is listed twice in {dictionary}.")
            }
            Refusal::DdsMissing(sheet) => format!("DDS for {sheet} is missing or too large."),
            Refusal::OutputIsFile => "Pack-textures output must be a directory.".to_owned(),
            Refusal::DdsUnreadable(sheet) => format!("DDS for {sheet} does not read."),
            Refusal::SourceMissing(path) => {
                format!("Source dictionary {path} is missing or too large.")
            }
            Refusal::SourceUnreadable(path) => format!("Source dictionary {path} does not open."),
            Refusal::SourceLacks(sheet, path) => format!("Texture {sheet} is not in {path}."),
            Refusal::Reopen(dictionary) => {
                format!("Dictionary {dictionary} failed semantic reopen.")
            }
        }
    }
}

impl fmt::Display for Refusal<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.words())
    }
}

impl From<Refusal<'_>> for EngineError {
    fn from(refusal: Refusal<'_>) -> Self {
        EngineError::invalid_data(refusal.words())
    }
}

// ---------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------

/// Откуда брать служебные поля листа: словарь-источник и имя штатного листа в нём.
struct Donor {
    source: String,
    from: String,
}

struct SheetPlan {
    name: String,
    dds: String,
    donor: Option<Donor>,
}

struct DictionaryPlan {
    name: String,
    file: String,
    sheets: Vec<SheetPlan>,
}

/// Узел запроса; ключи читаются с учётом регистра, значение не того типа равно отсутствующему.
#[derive(Clone, Copy)]
struct Node<'a>(&'a Value);

impl<'a> Node<'a> {
    fn text(self, key: &str) -> Option<&'a str> {
        self.0.get(key)?.as_str()
    }

    fn list(self, key: &str) -> Option<&'a [Value]> {
        self.0.get(key)?.as_array().map(Vec::as_slice)
    }
}

fn valid_dictionary_name(name: &str) -> bool {
    let tail_ok = |byte: &u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_';
    DICTIONARY_NAME_BYTES.contains(&name.len())
        && !name.starts_with('_')
        && name.as_bytes().iter().all(tail_ok)
}

/// Файл DDS пригоден по размеру: папка проходит (отказ придёт при чтении), файл - от 1 байта до 32 МиБ.
fn dds_size_fits(path: &str) -> bool {
    match fs::metadata(path) {
        Ok(meta) => meta.is_dir() || DDS_BYTES.contains(&meta.len()),
        Err(_) => false,
    }
}

/// Имя листа: края срезаны, регистр нижний, допустимо только по правилу хоста.
fn normal_name(node: Node) -> Option<String> {
    let name = node.text("name").unwrap_or_default().trim().to_lowercase();
    valid_name(&name).then_some(name)
}

/// Образец служебных полей: нужен непустой `source`; `from` по умолчанию - имя самого листа.
fn donor_of(node: Node, name: &str) -> Option<Donor> {
    let from = node
        .text("from")
        .filter(|raw| !raw.is_empty())
        .map_or_else(|| name.to_owned(), |raw| raw.trim().to_lowercase());
    let source = node.text("source").filter(|path| !path.is_empty())?;
    Some(Donor {
        source: source.to_owned(),
        from,
    })
}

fn sheet_plan(node: Node, dictionary: &str, taken: &mut HashSet<String>) -> Result<SheetPlan> {
    let name = normal_name(node).ok_or(Refusal::SheetName(dictionary))?;
    if !taken.insert(name.clone()) {
        return Err(Refusal::SheetTwice(&name, dictionary).into());
    }
    let dds = node.text("dds").unwrap_or_default();
    if !dds_size_fits(dds) {
        return Err(Refusal::DdsMissing(&name).into());
    }
    Ok(SheetPlan {
        dds: dds.to_owned(),
        donor: donor_of(node, &name),
        name,
    })
}

fn dictionary_plan(node: Node, earlier: &mut HashSet<String>) -> Result<DictionaryPlan> {
    let name = node.text("name").unwrap_or_default();
    if !valid_dictionary_name(name) {
        return Err(Refusal::DictionaryName.into());
    }
    if !earlier.insert(name.to_owned()) {
        return Err(Refusal::DictionaryTwice(name).into());
    }
    let listed = node.list("textures").ok_or(Refusal::NoSheets(name))?;
    if !SHEETS.contains(&listed.len()) {
        return Err(Refusal::SheetCount(name).into());
    }
    let mut taken = HashSet::new();
    let sheets = listed
        .iter()
        .map(|item| sheet_plan(Node(item), name, &mut taken))
        .collect::<Result<_>>()?;
    Ok(DictionaryPlan {
        name: name.to_owned(),
        file: format!("{name}.ytd"),
        sheets,
    })
}

fn parse_request(path: &Path) -> Result<Vec<DictionaryPlan>> {
    let bytes = fs::read(path)?;
    if !REQUEST_BYTES.contains(&(bytes.len() as u64)) {
        return Err(Refusal::RequestSize.into());
    }
    let Ok(document) = serde_json::from_slice::<Value>(&bytes) else {
        return Err(Refusal::Json.into());
    };
    let root = Node(&document);
    let version_one = document.get("version").and_then(Value::as_u64) == Some(1);
    if root.text("format") != Some(REQUEST_FORMAT) || !version_one {
        return Err(Refusal::Format.into());
    }
    let listed = root.list("dictionaries").ok_or(Refusal::NoList)?;
    if !DICTIONARIES.contains(&listed.len()) {
        return Err(Refusal::DictionaryCount.into());
    }
    let mut earlier = HashSet::new();
    listed
        .iter()
        .map(|item| dictionary_plan(Node(item), &mut earlier))
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------------------------

/// Лист словаря по имени (регистр не важен).
fn named<'e>(entries: &'e [Entry], wanted: &str) -> Option<&'e Entry> {
    entries
        .iter()
        .find(|entry| entry.name.eq_ignore_ascii_case(wanted))
}

/// Штатные словари-источники: каждый читается и разбирается один раз на всю команду.
#[derive(Default)]
struct Sources {
    opened: HashMap<String, Vec<Entry>>,
}

impl Sources {
    fn open(path: &str) -> Result<Vec<Entry>> {
        let file = Path::new(path);
        let fits = fs::metadata(file)
            .is_ok_and(|meta| meta.is_file() && SOURCE_BYTES.contains(&meta.len()));
        if !fits {
            return Err(Refusal::SourceMissing(path).into());
        }
        let bytes = fs::read(file)?;
        ytd_write::read_entries(&bytes)
            .ok()
            .ok_or_else(|| Refusal::SourceUnreadable(path).into())
    }

    /// Служебный объект листа `donor.from` из его словаря.
    fn template(&mut self, donor: &Donor) -> Result<[u8; TEXTURE_BYTES]> {
        let entries = match self.opened.entry(donor.source.clone()) {
            hash_map::Entry::Occupied(known) => known.into_mut(),
            hash_map::Entry::Vacant(empty) => empty.insert(Self::open(&donor.source)?),
        };
        named(entries, &donor.from)
            .map(|entry| entry.object)
            .ok_or_else(|| Refusal::SourceLacks(&donor.from, &donor.source).into())
    }
}

/// Новый лист из разобранного DDS: размеры сужаются до 16 бит, ступени - до 8.
fn texture_from(name: &str, image: Dds) -> NewTexture {
    let Dds {
        width,
        height,
        levels,
        format,
        payload,
    } = image;
    NewTexture {
        name: name.to_owned(),
        width: width as u16,
        height: height as u16,
        format,
        levels,
        payload,
    }
}

impl SheetPlan {
    fn load(&self, sources: &mut Sources) -> Result<(NewTexture, Option<[u8; TEXTURE_BYTES]>)> {
        let image =
            dds::parse(&fs::read(&self.dds)?).map_err(|_| Refusal::DdsUnreadable(&self.name))?;
        let template = self
            .donor
            .as_ref()
            .map(|donor| sources.template(donor))
            .transpose()?;
        Ok((texture_from(&self.name, image), template))
    }
}

impl DictionaryPlan {
    /// Словарь собирается, читается заново и сверяется с запросом; возвращается его файл и строки листов.
    fn assemble(&self, sources: &mut Sources) -> Result<(Vec<u8>, Vec<Entry>)> {
        let rows = self
            .sheets
            .iter()
            .map(|sheet| sheet.load(sources))
            .collect::<Result<Vec<_>>>()?;
        let bytes = ytd_write::write_host(&rows)?;
        let reopened = ytd_write::read_entries(&bytes)?;
        let every_name_back = self
            .sheets
            .iter()
            .all(|sheet| named(&reopened, &sheet.name).is_some());
        if reopened.len() != self.sheets.len() || !every_name_back {
            return Err(Refusal::Reopen(&self.name).into());
        }
        Ok((bytes, reopened))
    }
}

impl DictionaryPlan {
    /// Сборка, запись в папку вывода и строка ответа про этот словарь.
    fn store(&self, folder: &Path, sources: &mut Sources) -> Result<Value> {
        let (bytes, entries) = self.assemble(sources)?;
        let file = folder.join(&self.file);
        write_atomic(&file, &bytes)?;
        Ok(dictionary_echo(&self.name, &file, &bytes, &entries))
    }
}

/// Строка ответа про один записанный словарь.
fn dictionary_echo(name: &str, file: &Path, bytes: &[u8], entries: &[Entry]) -> Value {
    let textures: Vec<Value> = entries
        .iter()
        .map(|entry| {
            json!({
                "name": entry.name,
                "width": entry.width,
                "height": entry.height,
                "levels": entry.levels,
                "format": format!("D3DFMT_{}", entry.format.name()),
            })
        })
        .collect();
    let mut fields = Map::new();
    fields.insert("name".to_owned(), name.into());
    fields.insert("file".to_owned(), file.display().to_string().into());
    fields.insert("size".to_owned(), bytes.len().into());
    fields.insert("sha256".to_owned(), sha256_hex(bytes).into());
    fields.insert("textures".to_owned(), textures.into());
    Value::Object(fields)
}

/// Папка вывода: существующий файл на её месте - отказ, остальное создаётся с родителями.
fn prepare_folder(output: &str) -> Result<PathBuf> {
    let folder = PathBuf::from(output);
    if folder.is_file() {
        return Err(Refusal::OutputIsFile.into());
    }
    fs::create_dir_all(&folder)?;
    Ok(folder)
}

fn run_pack(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = paths::existing_file(options.required("input")?, REQUEST_FILE)?;
    let plans = parse_request(&input)?;
    let output = options.required("output")?;
    let folder = prepare_folder(output)?;

    let mut sources = Sources::default();
    let written = plans
        .iter()
        .map(|plan| plan.store(&folder, &mut sources))
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({
        "format": REQUEST_FORMAT,
        "version": 1,
        "output": output,
        "dictionaries": written,
    }))
}

const PACK_TEXTURES: Command = Command::new("pack-textures", run_pack);

pub const COMMANDS: &[Command] = &[PACK_TEXTURES];

#[cfg(test)]
mod tests;
