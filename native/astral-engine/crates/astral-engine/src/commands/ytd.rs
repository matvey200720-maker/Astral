//! `ytd-texture-patch` и `ytd-texture-set`: правка существующих словарей текстур `.ytd`.
//!
//! Первая команда заменяет данные листов (раскладка обязана совпасть), вторая снимает «семью»
//! листов по префиксу и добавляет новые листы семьи. Остальные листы переносятся как есть.
//! Оба выхода пишутся через свой черновик `<выход>.ytd-stage`.

use std::{
    collections::{HashMap, HashSet},
    fmt, fs,
    ops::RangeInclusive,
    path::{Path, PathBuf},
};

use rage_res::{
    dds::{self, Dds},
    hash::sha256_hex,
    ytd_write::{self, Edit, Entry, NewTexture},
};
use serde_json::{Map, Value};

use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const CAP: usize = 64;
const STAGE_SUFFIX: &str = ".ytd-stage";
const FAMILY_LEN: RangeInclusive<usize> = 4..=32;
const ADDED_NAME_LEN: RangeInclusive<usize> = 3..=64;
const ADDED_SIDES: RangeInclusive<u32> = 4..=1024;
const ADDED_LEVELS: RangeInclusive<u8> = 1..=11;

// ---------------------------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------------------------

/// Слова отказов (все - `InvalidDataException`).
enum Refusal {
    Unparsable(&'static str),
    NotAList(&'static str),
    NoSource(&'static str, String),
    PatchCount,
    PatchNames,
    Checksum(String),
    Missing(String),
    Mismatch(String),
    NotHeld(String),
    Altered(String),
    ListChanged(&'static str),
    Vanished,
    Family,
    SetCount,
    AddedName(String),
    AddedTwice(String),
    NothingLeft,
    Sides(String),
    Layout(String),
    StockVanished,
    StockAltered(String),
}

impl Refusal {
    fn words(&self) -> String {
        match self {
            Refusal::Unparsable(label) => format!("{label}: JSON не разбирается."),
            Refusal::NotAList(label) => format!("{label}: нужен список."),
            Refusal::NoSource(label, name) => format!("{label}: у {name} нет source."),
            Refusal::PatchCount => format!("YTD texture patches: от 1 до {CAP}."),
            Refusal::PatchNames => {
                "YTD texture patch names must be unique and non-empty.".to_owned()
            }
            Refusal::Checksum(name) => format!("YTD texture checksum mismatch: {name}"),
            Refusal::Missing(name) => format!("YTD texture does not exist: {name}"),
            Refusal::Mismatch(name) => {
                format!("DDS layout must match the existing YTD texture exactly: {name}")
            }
            Refusal::NotHeld(name) => format!("Patched YTD texture does not hold its DDS: {name}"),
            Refusal::Altered(name) => format!("Untouched YTD texture changed: {name}"),
            Refusal::ListChanged(verb) => format!("YTD texture list changed while {verb} it."),
            Refusal::Vanished => "YTD texture disappeared while patching it.".to_owned(),
            Refusal::Family => {
                "YTD texture family must be a lowercase prefix ending with '_'.".to_owned()
            }
            Refusal::SetCount => format!("YTD texture set must not add more than {CAP} textures."),
            Refusal::AddedName(name) => {
                format!("YTD texture name must be lowercase and belong to the family: {name}")
            }
            Refusal::AddedTwice(name) => format!("YTD texture names must be unique: {name}"),
            Refusal::NothingLeft => {
                "YTD would lose every stock texture — refusing to rebuild it.".to_owned()
            }
            Refusal::Sides(name) => {
                format!("YTD texture must be a power of two between 4 and 1024: {name}")
            }
            Refusal::Layout(name) => format!("YTD texture layout is not supported: {name}"),
            Refusal::StockVanished => {
                "YTD stock texture disappeared while rebuilding it.".to_owned()
            }
            Refusal::StockAltered(name) => format!("Stock YTD texture changed: {name}"),
        }
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.words())
    }
}

impl From<Refusal> for EngineError {
    fn from(refusal: Refusal) -> Self {
        EngineError::invalid_data(refusal.words())
    }
}

// ---------------------------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------------------------

/// Ответ команды: ключи идут в том порядке, в каком их вставили.
#[derive(Default)]
struct Reply(Map<String, Value>);

impl Reply {
    fn with(mut self, key: &str, value: impl Into<Value>) -> Reply {
        self.0.insert(key.to_owned(), value.into());
        self
    }

    fn path(self, key: &str, path: &Path) -> Reply {
        self.with(key, path.display().to_string())
    }

    fn sealed(self) -> Value {
        Value::Object(self.0)
    }
}

// ---------------------------------------------------------------------------------------------
// Общие части: список, DDS, запись
// ---------------------------------------------------------------------------------------------

/// Элемент списка до чтения DDS: имя уже обрезано, файл проверен на существование.
struct Order {
    name: String,
    file: PathBuf,
    sha256: Option<String>,
}

/// Файл DDS, прошедший сверку суммы и разбор.
struct Picture {
    file: PathBuf,
    digest: String,
    image: Dds,
}

impl Order {
    /// Элемент массива: `source` обязателен и должен быть существующим `.dds`.
    fn from_node(node: &Value, label: &'static str) -> Result<Order> {
        let field = |key: &str| node.get(key).and_then(Value::as_str);
        let name = field("texture").unwrap_or_default().trim().to_owned();
        let Some(source) = field("source") else {
            return Err(Refusal::NoSource(label, name).into());
        };
        Ok(Order {
            file: paths::existing_file(source, &[".dds"])?,
            sha256: field("sha256").map(str::to_lowercase),
            name,
        })
    }

    /// Сумма сверяется раньше разбора DDS.
    fn open(&self) -> Result<Picture> {
        let bytes = fs::read(&self.file)?;
        let digest = sha256_hex(&bytes);
        if self.sha256.as_ref().is_some_and(|wanted| *wanted != digest) {
            return Err(Refusal::Checksum(self.name.clone()).into());
        }
        let image = dds::parse(&bytes)?;
        Ok(Picture {
            file: self.file.clone(),
            digest,
            image,
        })
    }
}

/// Список читается как UTF-8-массив; у каждого элемента по порядку должен быть существующий `.dds`.
fn read_orders(list: &Path, label: &'static str) -> Result<Vec<Order>> {
    let document: Value =
        serde_json::from_str(&fs::read_to_string(list)?).map_err(|_| Refusal::Unparsable(label))?;
    let Value::Array(items) = document else {
        return Err(Refusal::NotAList(label).into());
    };
    items
        .iter()
        .map(|item| Order::from_node(item, label))
        .collect()
}

fn find_entry<'e>(entries: &'e [Entry], name: &str) -> Option<&'e Entry> {
    entries
        .iter()
        .find(|entry| entry.name.eq_ignore_ascii_case(name))
}

/// Запись через черновик `<выход>.ytd-stage`; при отказе переименования черновик убирается.
fn stage_and_replace(output: &Path, bytes: &[u8]) -> Result<()> {
    let mut stage_name = output.as_os_str().to_owned();
    stage_name.push(STAGE_SUFFIX);
    let stage = PathBuf::from(stage_name);
    fs::write(&stage, bytes)?;
    if let Err(failure) = fs::rename(&stage, output) {
        let _ = fs::remove_file(&stage);
        return Err(failure.into());
    }
    Ok(())
}

/// Общие пути обеих команд: вход и выход (папка выхода создаётся).
struct Paths {
    input: PathBuf,
    output: PathBuf,
}

impl Paths {
    fn from(options: &Options) -> Result<Paths> {
        Ok(Paths {
            input: paths::existing_file(options.required("input")?, &[".ytd"])?,
            output: paths::output_file(options.required("output")?, &[".ytd"])?,
        })
    }

    /// Начало ответа, общее для обеих команд.
    fn reply(&self, mode: &str) -> Reply {
        Reply::default()
            .with("status", "ready")
            .with("mode", mode)
            .path("input", &self.input)
            .path("output", &self.output)
    }
}

/// Хеши входа и выхода и длина выхода.
fn with_hashes(reply: Reply, before: &[u8], after: &[u8]) -> Reply {
    reply
        .with("inputSha256", sha256_hex(before))
        .with("outputSha256", sha256_hex(after))
        .with("outputBytes", after.len())
}

// ---------------------------------------------------------------------------------------------
// ytd-texture-patch
// ---------------------------------------------------------------------------------------------

/// Одна проверенная правка: что писать в словарь и что сказать в ответе.
struct Fix {
    name: String,
    payload: Vec<u8>,
    echo: Value,
}

/// Правка сверяется с листом словаря: ширина, высота, ступени, формат и длина данных равны.
fn fix_for(order: &Order, entries: &[Entry]) -> Result<Fix> {
    let Picture {
        file,
        digest,
        image,
    } = order.open()?;
    let entry =
        find_entry(entries, &order.name).ok_or_else(|| Refusal::Missing(order.name.clone()))?;
    let held = (
        u32::from(entry.width),
        u32::from(entry.height),
        entry.levels,
        entry.format,
        entry.payload.len(),
    );
    let given = (
        image.width,
        image.height,
        image.levels,
        image.format,
        image.payload.len(),
    );
    let same_layout = held == given;
    if !same_layout {
        return Err(Refusal::Mismatch(order.name.clone()).into());
    }
    let echo = Reply::default()
        .with("texture", entry.name.as_str())
        .path("source", &file)
        .with("width", image.width)
        .with("height", image.height)
        .with("levels", image.levels)
        .with("format", image.format.name())
        .with("bytes", image.payload.len())
        .with("sourceSha256", digest)
        .sealed();
    Ok(Fix {
        name: entry.name.clone(),
        payload: image.payload,
        echo,
    })
}

/// После правки словарь читается заново: листы те же, правленые несут новые данные, прочие прежние.
fn confirm_patched(before: &[Entry], after: &[Entry], fixes: &[Fix]) -> Result<()> {
    if before.len() != after.len() {
        return Err(Refusal::ListChanged("patching").into());
    }
    for old in before {
        let new = find_entry(after, &old.name).ok_or(Refusal::Vanished)?;
        let (expected, refusal) = match fixes
            .iter()
            .find(|fix| fix.name.eq_ignore_ascii_case(&old.name))
        {
            Some(fix) => (&fix.payload, Refusal::NotHeld(old.name.clone())),
            None => (&old.payload, Refusal::Altered(old.name.clone())),
        };
        if *expected != new.payload {
            return Err(refusal.into());
        }
    }
    Ok(())
}

fn run_patch(options: &Options, _progress: &Progress) -> Result<Value> {
    let place = Paths::from(options)?;
    let list = paths::existing_file(options.required("patches")?, &[".json"])?;
    let orders = read_orders(&list, "patches")?;
    if !(1..=CAP).contains(&orders.len()) {
        return Err(Refusal::PatchCount.into());
    }
    let mut seen = HashSet::new();
    if orders
        .iter()
        .any(|order| order.name.is_empty() || !seen.insert(order.name.to_lowercase()))
    {
        return Err(Refusal::PatchNames.into());
    }

    let original = fs::read(&place.input)?;
    let entries = ytd_write::read_entries(&original)?;
    let fixes = orders
        .iter()
        .map(|order| fix_for(order, &entries))
        .collect::<Result<Vec<_>>>()?;

    let edits: Vec<Edit> = fixes
        .iter()
        .map(|fix| Edit::Patch {
            name: fix.name.clone(),
            payload: fix.payload.clone(),
        })
        .collect();
    let rebuilt = ytd_write::edit(&original, &edits)?;
    confirm_patched(&entries, &ytd_write::read_entries(&rebuilt)?, &fixes)?;
    stage_and_replace(&place.output, &rebuilt)?;

    let echoes: Vec<Value> = fixes.into_iter().map(|fix| fix.echo).collect();
    Ok(
        with_hashes(place.reply("ytd-texture-patch"), &original, &rebuilt)
            .with("patches", echoes)
            .with(
                "validation",
                Reply::default()
                    .with("reopened", true)
                    .with("structurePreserved", true)
                    .with("atomicOutput", true)
                    .sealed(),
            )
            .sealed(),
    )
}

// ---------------------------------------------------------------------------------------------
// ytd-texture-set
// ---------------------------------------------------------------------------------------------

/// Имя состоит из строчных латинских букв, цифр и `_`.
fn is_name_byte(byte: &u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_'
}

/// Семья: после обрезки 4…32 знака, строчная латинская буква впереди, `_` в конце, середина из `[a-z0-9_]`.
fn clean_family(raw: &str) -> Option<String> {
    let family = raw.trim();
    let (first, rest) = family.as_bytes().split_first()?;
    let shaped = FAMILY_LEN.contains(&family.len())
        && first.is_ascii_lowercase()
        && family.ends_with('_')
        && rest.iter().all(is_name_byte);
    shaped.then(|| family.to_owned())
}

/// Имя добавки: 3…64 знака, строчная буква впереди, дальше `[a-z0-9_]`, начало - семья.
fn fits_family(name: &str, family: &str) -> bool {
    let Some((first, rest)) = name.as_bytes().split_first() else {
        return false;
    };
    ADDED_NAME_LEN.contains(&name.len())
        && first.is_ascii_lowercase()
        && rest.iter().all(is_name_byte)
        && name.starts_with(family)
}

/// Сторона добавки: степень двойки от 4 до 1024.
fn good_side(side: u32) -> bool {
    ADDED_SIDES.contains(&side) && side.is_power_of_two()
}

impl Picture {
    fn into_texture(self, name: &str) -> NewTexture {
        NewTexture {
            name: name.to_owned(),
            width: self.image.width as u16,
            height: self.image.height as u16,
            format: self.image.format,
            levels: self.image.levels,
            payload: self.image.payload,
        }
    }
}

/// Готовая добавка: правка и строка ответа.
struct Addition {
    edit: Edit,
    echo: Value,
}

fn addition_for(order: &Order, remaining: &[&Entry]) -> Result<Addition> {
    let picture = order.open()?;
    let image = &picture.image;
    if !(good_side(image.width) && good_side(image.height)) {
        return Err(Refusal::Sides(order.name.clone()).into());
    }
    if !ADDED_LEVELS.contains(&image.levels) {
        return Err(Refusal::Layout(order.name.clone()).into());
    }
    // Образец служебных полей - первый оставшийся лист того же формата, иначе первый оставшийся.
    let donor = remaining
        .iter()
        .find(|entry| entry.format == image.format)
        .or(remaining.first())
        .map(|entry| entry.name.clone())
        .ok_or(Refusal::NothingLeft)?;
    let echo = Reply::default()
        .with("texture", order.name.as_str())
        .with("width", image.width)
        .with("height", image.height)
        .with("levels", image.levels)
        .with("format", image.format.name())
        .with("bytes", image.payload.len())
        .with("sourceSha256", picture.digest.as_str())
        .with("donor", donor.as_str())
        .sealed();
    Ok(Addition {
        edit: Edit::Add {
            texture: picture.into_texture(&order.name),
            donor: Some(donor),
        },
        echo,
    })
}

/// Имена добавок: подходят семье и не повторяются (повтор - точное совпадение).
fn check_added_names(orders: &[Order], family: &str) -> Result<()> {
    let mut seen = HashSet::new();
    orders.iter().try_for_each(|order| {
        if !fits_family(&order.name, family) {
            return Err(Refusal::AddedName(order.name.clone()).into());
        }
        match seen.insert(order.name.as_str()) {
            true => Ok(()),
            false => Err(Refusal::AddedTwice(order.name.clone()).into()),
        }
    })
}

/// Сколько раз встречается каждое имя (регистр ASCII не важен): повторы считаются.
fn name_tally<'n>(names: impl Iterator<Item = &'n str>) -> HashMap<String, usize> {
    let mut tally = HashMap::new();
    for name in names {
        *tally.entry(name.to_ascii_lowercase()).or_insert(0) += 1;
    }
    tally
}

/// Словарь после сборки: имена = оставшиеся + добавки, данные оставшихся прежние.
fn confirm_rebuilt(kept: &[&Entry], orders: &[Order], after: &[Entry]) -> Result<()> {
    let promised = name_tally(
        kept.iter()
            .map(|entry| entry.name.as_str())
            .chain(orders.iter().map(|order| order.name.as_str())),
    );
    if promised != name_tally(after.iter().map(|entry| entry.name.as_str())) {
        return Err(Refusal::ListChanged("rebuilding").into());
    }
    for old in kept {
        let new = find_entry(after, &old.name).ok_or(Refusal::StockVanished)?;
        if new.payload != old.payload {
            return Err(Refusal::StockAltered(old.name.clone()).into());
        }
    }
    Ok(())
}

fn run_set(options: &Options, _progress: &Progress) -> Result<Value> {
    let place = Paths::from(options)?;
    let family = clean_family(options.required("family")?).ok_or(Refusal::Family)?;
    let list = paths::existing_file(options.required("additions")?, &[".json"])?;
    let orders = read_orders(&list, "additions")?;
    if orders.len() > CAP {
        return Err(Refusal::SetCount.into());
    }
    check_added_names(&orders, &family)?;

    let original = fs::read(&place.input)?;
    let entries = ytd_write::read_entries(&original)?;
    let (removed, kept): (Vec<&Entry>, Vec<&Entry>) = entries
        .iter()
        .partition(|entry| entry.name.to_lowercase().starts_with(&family));
    if kept.is_empty() {
        return Err(Refusal::NothingLeft.into());
    }

    let additions = orders
        .iter()
        .map(|order| addition_for(order, &kept))
        .collect::<Result<Vec<_>>>()?;
    let removals = removed.iter().map(|entry| Edit::Remove {
        name: entry.name.clone(),
    });
    let (adds, echoes): (Vec<Edit>, Vec<Value>) = additions
        .into_iter()
        .map(|added| (added.edit, added.echo))
        .unzip();
    let edits: Vec<Edit> = removals.chain(adds).collect();
    let rebuilt = ytd_write::edit(&original, &edits)?;
    confirm_rebuilt(&kept, &orders, &ytd_write::read_entries(&rebuilt)?)?;
    stage_and_replace(&place.output, &rebuilt)?;

    let removed_names: Vec<&str> = removed.iter().map(|entry| entry.name.as_str()).collect();
    Ok(
        with_hashes(place.reply("ytd-texture-set"), &original, &rebuilt)
            .with("family", family)
            .with("removed", removed_names)
            .with("added", echoes)
            .with(
                "validation",
                Reply::default()
                    .with("reopened", true)
                    .with("stockPreserved", true)
                    .with("atomicOutput", true)
                    .sealed(),
            )
            .sealed(),
    )
}

const TEXTURE_PATCH: Command = Command::new("ytd-texture-patch", run_patch);
const TEXTURE_SET: Command = Command::new("ytd-texture-set", run_set);

pub const COMMANDS: &[Command] = &[TEXTURE_PATCH, TEXTURE_SET];

#[cfg(test)]
mod tests;
