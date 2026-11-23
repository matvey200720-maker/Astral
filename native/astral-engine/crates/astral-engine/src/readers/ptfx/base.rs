//! Команда `read-ptfx-base`: всё, что прежде давал JS-читатель базы эффектов, для окна
//! мастерской — текст `bloodfx.dat` с его сводкой, опись ядра, свет сцены, листы
//! окружения, сцены трассеров, тира и окружения, раздел импакта.
//!
//! Команда только читает игру (`update/update.rpf`, `common.rpf`) и необязательную
//! папку «оригиналов»; на диск ничего не пишет, хода в stderr нет.

use std::{
    collections::{BTreeMap, HashSet},
    iter,
    path::{Path, PathBuf},
    sync::Arc,
};

use rage_res::{ypt::Core, Resource};
use rage_rpf::{Archive, KeySet};
use serde_json::{Map, Value};

use super::{
    bloodfx::{self, BloodFxSummary},
    clip_regions::{self, Grid},
    core_inventory,
    environment::{self, Originals},
    impact, light, scene,
};
use crate::{
    archives::{game_root, load_keys},
    args::Options,
    error::{EngineError, Result},
    progress::Progress,
    readers::{
        archive_access,
        locator::{self, CommonHas, EntryLocator, Located},
    },
};

/// Разделы, которые считает Rust (вместе с парами `…Error`).
pub const IMPLEMENTED: [&str; 17] = [
    "bloodfx",
    "version",
    "entries",
    "core",
    "clipProblems",
    "light",
    "lightError",
    "environment",
    "environmentError",
    "tracerScene",
    "tracerSceneError",
    "rangeScene",
    "rangeSceneError",
    "environmentScene",
    "environmentSceneError",
    "impact",
    "impactError",
];

pub const BLOODFX_ENTRY: &str = "update:/common/data/effects/bloodfx.dat";
pub const PTX_CLIP_REGIONS_ENTRY: &str = "update:/common/data/effects/ptxclipregions.dat";

/// Потолок размера `bloodfx.dat` в архиве: 4 МиБ.
const BLOODFX_LIMIT: usize = 4 * 1024 * 1024;

/// Приставка записи, лежащей в `common.rpf`.
const COMMON_PREFIX: &str = "common:/";

/// Отказ команды, у которого свой текст.
enum Fault<'a> {
    /// Записи нет ни в одном месте; назван исходный путь записи.
    Missing(&'a str),
    /// `bloodfx.dat` длиннее потолка.
    CorruptBloodfx,
}

impl From<Fault<'_>> for EngineError {
    fn from(fault: Fault<'_>) -> Self {
        match fault {
            Fault::Missing(entry) => {
                EngineError::file_not_found(format!("Archive entry was not found: {entry}"))
            }
            Fault::CorruptBloodfx => EngineError::invalid_data("bloodfx.dat в архиве повреждён."),
        }
    }
}

/// Байты как текст; негодные последовательности UTF-8 заменены.
fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn update_archive(root: &Path) -> PathBuf {
    root.join("update").join("update.rpf")
}

/// В каком архиве лежит запись.
#[derive(Clone, Copy)]
enum Home {
    Update,
    Common,
}

impl Home {
    fn archive(self, root: &Path) -> PathBuf {
        match self {
            Home::Update => update_archive(root),
            Home::Common => root.join("common.rpf"),
        }
    }

    /// Архив и путь внутри него по записи вида `update:/…` или `common:/…`.
    fn route(entry: &str) -> (Home, String) {
        match entry.strip_prefix(COMMON_PREFIX) {
            Some(inner) => (Home::Common, inner.to_owned()),
            None => (Home::Update, locator::update_inner(entry)),
        }
    }
}

/// Подключённые игрой вложенные архивы по `content.xml`; нет файла или он не читается — пусто.
fn mounted_in(archive: &Archive) -> HashSet<String> {
    match archive_access::read_entry(archive, "content.xml") {
        Ok(Some(bytes)) => locator::mounted_archives(&lossy(&bytes)),
        _ => HashSet::new(),
    }
}

/// Опись записей `update.rpf`: что в нём лежит, какие вложенные архивы подключает игра и
/// есть ли запись в `common.rpf`. `None` — `update.rpf` не открылся (тогда ниже читаются
/// штатные пути без поиска).
pub fn locate_effect_entries<'a>(
    root: &'a Path,
    keys: &'a Arc<KeySet>,
) -> Option<EntryLocator<'a>> {
    let archive = archive_access::open(&update_archive(root), keys).ok()?;
    // `common.rpf` открывается при каждом вопросе; не открылся — «неизвестно».
    let in_common: CommonHas<'a> = Box::new(move |inner| {
        let common = archive_access::open(&Home::Common.archive(root), keys).ok()?;
        Some(archive_access::has_entry(&common, inner))
    });
    Some(EntryLocator::new(
        archive_access::list_files(&archive),
        mounted_in(&archive),
        in_common,
    ))
}

/// Читает найденную запись из того архива, где она лежит.
pub fn read_located(root: &Path, keys: &Arc<KeySet>, located: &Located) -> Result<Vec<u8>> {
    let (home, inner) = Home::route(&located.entry);
    let archive = archive_access::open(&home.archive(root), keys)?;
    let bytes =
        archive_access::read_entry(&archive, &inner)?.ok_or(Fault::Missing(&located.entry))?;
    Ok(bytes)
}

/// Игра, выбранная параметрами команды: корень и набор ключей.
struct Game {
    root: PathBuf,
    keys: Arc<KeySet>,
}

impl Game {
    fn open(options: &Options) -> Result<Game> {
        let root = game_root(options)?;
        let (keys, _source) = load_keys(&root.to_string_lossy(), options.optional("keys"))?;
        Ok(Game { root, keys })
    }

    fn locate(&self) -> Option<EntryLocator<'_>> {
        locate_effect_entries(&self.root, &self.keys)
    }
}

/// Игра вместе с описью `update.rpf`: читает то, что нужно разделам ответа.
struct Install<'a> {
    game: &'a Game,
    index: Option<&'a EntryLocator<'a>>,
}

impl Install<'_> {
    fn fetch(&self, located: &Located) -> Result<Vec<u8>> {
        read_located(&self.game.root, &self.game.keys, located)
    }

    /// `bloodfx.dat`: текст (негодные байты заменены) и его сводка.
    fn bloodfx(&self) -> Result<(String, BloodFxSummary)> {
        let place = locator::data_read_entry(self.index, BLOODFX_ENTRY)
            .ok_or(Fault::Missing(BLOODFX_ENTRY))?;
        let bytes = self.fetch(&place)?;
        if bytes.len() > BLOODFX_LIMIT {
            return Err(Fault::CorruptBloodfx.into());
        }
        let text = lossy(&bytes);
        let summary = bloodfx::parse(&text)?;
        Ok((text, summary))
    }

    /// Ядро эффектов: в отказе «нет нигде» всегда назван штатный путь.
    fn core(&self) -> Result<(Resource, Core)> {
        let standard = locator::core_entry(locator::CORE_ARCHIVES[0]);
        let place = locator::core_read_entry(self.index).ok_or(Fault::Missing(&standard))?;
        let resource = Resource::parse(&self.fetch(&place)?)?;
        let core = rage_res::ypt::read(&resource)?;
        Ok((resource, core))
    }

    /// Сетки кадров листов; любая неудача даёт пустой словарь.
    fn grids(&self) -> BTreeMap<String, Grid> {
        let bytes = locator::data_read_entry(self.index, PTX_CLIP_REGIONS_ENTRY)
            .and_then(|place| self.fetch(&place).ok());
        bytes
            .as_deref()
            .and_then(clip_regions::parse)
            .unwrap_or_default()
    }

    /// Донорские словари каталога: байты файла или `None`, если не нашёлся или не прочитался.
    fn donors(&self) -> Vec<(&'static str, Option<Vec<u8>>)> {
        impact::DONOR_RULES
            .iter()
            .map(|&(id, _)| {
                let bytes = locator::IMPACT_DONOR_FILES
                    .iter()
                    .find(|file| file.id == id)
                    .and_then(|file| locator::donor_read_entry(self.index, file))
                    .and_then(|place| self.fetch(&place).ok());
                (id, bytes)
            })
            .collect()
    }
}

/// Раздел `clipProblems`: кадровые листы Astral в ядре, которым в таблице сеток не хватает строки.
fn clip_problems(core: &Core, grids: &BTreeMap<String, Grid>) -> Value {
    let names = core.textures.iter().map(|texture| texture.name.as_str());
    Value::from(clip_regions::missing_rows(names, grids))
}

/// Раздел и его строка отказа: значение или `null` и строка или `null`.
fn paired(name: &str, outcome: std::result::Result<Value, String>) -> [(String, Value); 2] {
    let (value, error) = outcome.map_or_else(
        |message| (Value::Null, Value::String(message)),
        |value| (value, Value::Null),
    );
    [(name.to_owned(), value), (format!("{name}Error"), error)]
}

/// Команда `read-ptfx-base`.
pub fn read(options: &Options, _progress: &Progress) -> Result<Value> {
    let game = Game::open(options)?;
    let owner = game.locate();
    let install = Install {
        game: &game,
        index: owner.as_ref(),
    };

    let (blood_text, blood) = install.bloodfx()?;
    let (resource, core) = install.core()?;
    // Свет читается заново и без описи.
    let light_outcome = light::read(&game.root, &game.keys);
    let grids = install.grids();
    let originals = Originals::open(options.optional("originals").map(Path::new));
    let textures = core.textures.as_slice();

    let environment_outcome = environment::section(&environment::Source {
        resource: &resource,
        textures,
        grids: &grids,
        originals: &originals,
    });
    let tracer = scene::tracer_scene(&resource, textures, &grids, &originals);
    let range = scene::range_scene(&resource, textures, &grids, &originals);
    let environment_scene = scene::environment_scene(&resource, textures, &grids, &originals);
    let impact_outcome = impact::read(&resource, textures, &install.donors(), &grids, &originals);

    let entries: Map<String, Value> = [("entry", blood.entry), ("exit", blood.exit)]
        .into_iter()
        .map(|(key, count)| (key.to_owned(), Value::from(count)))
        .collect();
    let head = [
        ("bloodfx", Value::String(blood_text)),
        ("version", Value::String(blood.version)),
        ("entries", Value::Object(entries)),
        ("core", core_inventory::describe(&core)),
        ("clipProblems", clip_problems(&core, &grids)),
    ]
    .map(|(key, value)| (key.to_owned(), value));
    // Порядок разделов в ответе: импакт раньше сцен, хотя считается позже.
    let sections = [
        ("environment", environment_outcome),
        ("impact", impact_outcome),
        ("tracerScene", tracer),
        ("rangeScene", range),
        ("environmentScene", environment_scene),
    ]
    .into_iter()
    .flat_map(|(name, outcome)| paired(name, outcome.map_err(|e| e.to_string())));
    let implemented = IMPLEMENTED.iter().copied().map(Value::from).collect();

    let answer = head
        .into_iter()
        .chain(paired("light", light_outcome))
        .chain(sections)
        .chain(iter::once((
            "implemented".to_owned(),
            Value::Array(implemented),
        )));
    Ok(Value::Object(answer.collect()))
}

#[cfg(test)]
mod tests;
