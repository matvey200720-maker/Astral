//! Сборка архива из операций над записями (команда `compose-rpf`).
//!
//! Операции (заменить, добавить, добавить или заменить, удалить) применяются к
//! дереву основы или к пустому дереву, в том числе внутри вложенных `.rpf`.
//! Дерево пишется в служебной папке рядом с выходом, готовый файл
//! перечитывается и сверяется с источниками так, как его прочитает игра, и
//! только потом ложится на место выхода. Любой отказ убирает служебную папку.

use std::{
    collections::BTreeMap,
    env,
    fs::{self, File},
    ops::ControlFlow,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};

use rage_rpf::{activity, write_archive_with, Archive, Finalizer, KeySet, WriteContext};
use rage_rpf::{
    tally::{self, Phase, Tally},
    Handled, Layout, NestedMode, TrialRun,
};

use super::census::{self, BaseCount, Census, Moves};
use super::streamed::{write_streamed, Streamed};
use rage_rpf::{Body, Compress, Data, DirNode, FileNode};
use rage_rpf::{Encryption, EntryCipher, EntryKind};
use serde_json::{json, Map, Value};

use super::{
    apply::is_resource,
    archivefix::{NgFinalizer, PINNED_SHA256},
    composed_install,
    expect::{self, Expectation},
    install::resource_matches,
    load_keys, points, random_hex, sha256_file,
};
use crate::{
    args::Options,
    disk::{self, WritePacer},
    error::{EngineError, Result},
    failpoint, paths,
    progress::Progress,
};

// ---------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------

/// Отказ из-за содержимого запроса или файлов (`InvalidDataException`).
fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

/// Отказ из-за неверного аргумента (`ArgumentException`).
fn argument(message: impl Into<String>) -> EngineError {
    EngineError::argument(message)
}

// ---------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------

/// Предел числа операций в запросе.
pub const MAX_OPERATIONS: usize = 100_000;

/// Вид операции над записью.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Replace,
    Import,
    Upsert,
    Delete,
}

impl Action {
    /// Слово без учёта регистра ASCII и пробелов по краям; нет слова — `Replace`.
    pub fn parse(value: Option<&str>) -> Result<Self> {
        let Some(raw) = value else {
            return Ok(Action::Replace);
        };
        let word = raw.trim().to_ascii_lowercase();
        let action = match word.as_str() {
            "replace" => Action::Replace,
            "import" => Action::Import,
            "upsert" => Action::Upsert,
            "delete" => Action::Delete,
            _ => return Err(invalid(format!("Unsupported RPF action: {word}"))),
        };
        Ok(action)
    }

    /// Операция может добавить запись, которой ещё нет.
    fn adds(self) -> bool {
        self == Action::Import || self == Action::Upsert
    }

    /// Слово операции в запросе и в рецепте.
    pub(super) fn word(self) -> &'static str {
        match self {
            Action::Replace => "replace",
            Action::Import => "import",
            Action::Upsert => "upsert",
            Action::Delete => "delete",
        }
    }
}

/// Отпечаток записывают 64 шестнадцатеричными знаками.
pub(super) fn is_digest(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Одна операция запроса.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Operation {
    pub entry: String,
    pub source: Option<PathBuf>,
    pub sha256: Option<String>,
    pub action: Action,
    pub allow_delete: bool,
    pub allow_missing: bool,
}

impl Operation {
    /// Операция в виде объекта запроса: те же ключи, что разбирает запрос.
    pub(super) fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("entry".to_owned(), json!(self.entry));
        object.insert("action".to_owned(), json!(self.action.word()));
        if let Some(source) = &self.source {
            object.insert("source".to_owned(), json!(source.to_string_lossy()));
        }
        if let Some(digest) = &self.sha256 {
            object.insert("sha256".to_owned(), json!(digest));
        }
        object.insert("allowDelete".to_owned(), json!(self.allow_delete));
        object.insert("allowMissing".to_owned(), json!(self.allow_missing));
        Value::Object(object)
    }

    /// Из объекта запроса или рецепта.
    pub(super) fn from_json(value: &Value) -> Result<Operation> {
        Fields::object(value, "RPF operation is not an object.")?.operation()
    }
}

/// Правка основы или новый архив.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Compose,
    Create,
}

impl Mode {
    /// Слово из запроса; нет слова — правка основы.
    pub(super) fn from_word(word: Option<&str>) -> Result<Mode> {
        match word {
            None | Some("compose") => Ok(Mode::Compose),
            Some("create") => Ok(Mode::Create),
            Some(other) => Err(invalid(format!("Unsupported RPF mode: {other}"))),
        }
    }

    /// Слово режима в запросе и в рецепте.
    pub(super) fn word(self) -> &'static str {
        match self {
            Mode::Compose => "compose",
            Mode::Create => "create",
        }
    }
}

/// Запрос целиком.
#[derive(Clone, Debug)]
pub struct Request {
    pub staging: Option<PathBuf>,
    pub mode: Mode,
    pub base: Option<PathBuf>,
    pub output: PathBuf,
    pub archive_target: String,
    pub edition: Option<String>,
    pub allow_deletes: bool,
    pub operations: Vec<Operation>,
    pub install: Option<Install>,
}

/// Блок установки собранного архива в игру (разбирает `composed_install`).
#[derive(Clone, Debug)]
pub struct Install {
    pub game_root: PathBuf,
    pub archive: String,
    pub replay: Value,
    pub point_id: Option<String>,
    pub stage_name: Option<String>,
    pub prebuilt: Option<String>,
    pub sha256: Option<String>,
    pub create: bool,
    pub targets: Vec<InstallTarget>,
    /// Необязательные возможности «одной записи»; по умолчанию всё выключено.
    pub options: InstallOptions,
}

/// Возможности установки из операций, которых у прежнего пути нет. Каждая
/// включается своим ключом блока `install`; без ключей установка идёт как раньше.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InstallOptions {
    /// Ключ `before: "aside"`. Прежний живой архив, когда жёсткая ссылка в
    /// папку точек невозможна (другой том), остаётся жёсткой ссылкой рядом с
    /// живым файлом, а не копией в папку точек.
    pub before_aside: bool,
    /// Ключ `saveRecipe`: куда движок пишет рецепт сборки (запрос и отпечаток
    /// результата) до подмены.
    pub save_recipe: Option<PathBuf>,
    /// Ключ `useRecipe`: архив собирается по этому рецепту, и результат обязан
    /// дать отпечаток из него («Починить» без копии сборки).
    pub use_recipe: Option<PathBuf>,
    /// Ключ `expectSha256`: ожидаемый отпечаток собранного из операций архива.
    pub expect_sha256: Option<String>,
    /// Ключ `write`: как архив попадает в игру. Умолчание — подмена файла;
    /// `"append"` — дозапись в живой файл (`archives::append`), под
    /// выключателем `ASTRAL_ENGINE_APPEND`.
    pub write: WriteMode,
    /// Ключ `baseSha256`: SHA-256 живого файла до первой дозаписи (у
    /// дозаписи нет полного прохода по файлу ради него).
    pub base_sha256: Option<String>,
    /// Ключ `layer`: дозапись кладёт слой, который потом включается и выключается
    /// сменой оглавления (`archives::layers`), под выключателем
    /// `ASTRAL_ENGINE_LAYERS`. Нужна дозапись (`write: "append"` или `append-rpf`).
    pub layer: Option<LayerSpec>,
    /// Ключи `expectEntries`, `expectDlcList` и `expect`: что обязан держать
    /// собранный архив. Нет хоть одного — отказ до подмены (до смены головы у
    /// дозаписи), архив остаётся прежним.
    pub expect: Vec<Expectation>,
    /// Ключ `hold`: собрать архив в стейдж рядом с живым и не подменять; подмена
    /// отдельным запросом с `commit`, отказ от неё — `discard`.
    pub hold: bool,
    /// Ключ `commit`: id точки, чей удержанный стейдж встаёт на место живого.
    pub commit: Option<String>,
    /// Ключ `discard`: id точки, чей удержанный стейдж убирается.
    pub discard: Option<String>,
    /// Ключ `stageCheck` у `commit`: как проверяется, что стейдж тот, который
    /// сняли при `hold` (по умолчанию полный проход SHA-256).
    pub stage_check: StageCheck,
    /// Ключ `creates`: файлы, которые сборка положила в игру до установки (свой
    /// dlc-архив). Опись точки называет их, откат точки убирает их, если они
    /// доказанно те же. Нужна дозапись; под выключателем `ASTRAL_ENGINE_NEWDLC`.
    pub creates: Vec<points::CreatedFile>,
    /// Папки выше этих файлов (`creates[].dirs`): откат убирает их, если опустеют.
    pub creates_dirs: Vec<String>,
    /// Ключ `keepKey` (R4): дозапись растит файл до длины с прежним ключом
    /// шифрования головы (добавка нулей в конец), `hold` дозаписи с ним разрешён
    /// без выключателя стенда. Нужна дозапись.
    pub keep_key: bool,
    /// Ключ `tailPad`: после записи у файла хвост по правилу `rage_rpf::tail` (запас от начала последней записи до конца, длина
    /// кратна границе, ключ головы прежний при `keepKey`). Съёмка 20.11.2026: маленький вложенный архив последним роняет сюжет.
    pub tail_pad: bool,
}

/// Как `commit` убеждается, что стейдж не менялся с момента `hold`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum StageCheck {
    /// Длина, время, номер файла и SHA-256 всего файла (читается целиком).
    #[default]
    Sha256,
    /// Длина, время и номер файла; без чтения тел.
    Quick,
}

/// Ключ `install.layer`: id слоя и слои, без которых он не включается.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerSpec {
    pub id: String,
    pub requires: Vec<String>,
    /// Ключ `registry`: общие записи корня (`content.xml`, `dlclist.xml`), которые
    /// установка заменяет, но слою не отдаёт: их тело собирает вызывающий из
    /// включённых слоёв, и слои не связаны друг с другом через них.
    pub registry: Vec<RegistrySpec>,
}

/// Общая запись корня у слоя: путь и файл с её новым содержимым.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistrySpec {
    /// Путь записи, как нормализует его сборка: нижний регистр, звенья через `/`.
    pub entry: String,
    pub source: PathBuf,
}

/// Общих записей у слоя не больше стольких.
const MAX_LAYER_REGISTRY: usize = 64;

/// Способ записи собранного архива в игру.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WriteMode {
    /// Архив собирается рядом и подменяет живой файл (путь этапа 1).
    #[default]
    Full,
    /// Новые тела дописываются в живой файл, оглавление пишется заново.
    Append,
}

impl Install {
    /// Собирать из операций нечего подставлять: готовые файлы у всех целей или
    /// сборка идёт по рецепту. Тогда пустой список операций в запросе допустим.
    fn builds_without_operations(&self) -> bool {
        if self.options.use_recipe.is_some() || self.finishes_a_hold() {
            return true;
        }
        // слой, у которого есть только общие записи реестра (редукс целиком в своём
        // dlc): собственных операций нет, замены общих записей добавляет движок
        if self
            .options
            .layer
            .as_ref()
            .is_some_and(|spec| !spec.registry.is_empty())
        {
            return true;
        }
        match self.targets.as_slice() {
            [] => self.prebuilt.is_some(),
            listed => listed.iter().all(|target| target.prebuilt.is_some()),
        }
    }

    /// Запрос второго шага (`commit` или `discard`): сборки в нём нет, всё нужное
    /// лежит в записи удержания.
    pub fn finishes_a_hold(&self) -> bool {
        self.options.commit.is_some() || self.options.discard.is_some()
    }
}

/// Одна цель многоархивной установки.
#[derive(Clone, Debug)]
pub struct InstallTarget {
    pub archive: String,
    pub prebuilt: Option<String>,
    pub sha256: Option<String>,
    pub create: bool,
    pub stage_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Путь записи
// ---------------------------------------------------------------------------

/// Вложенный архив узнаётся по концу имени звена.
const CONTAINER_SUFFIX: &str = ".rpf";

/// Длина пути записи в байтах не больше этого (после приведения к нижнему регистру).
const MAX_ENTRY_BYTES: usize = 1000;

fn names_container(name: &str) -> bool {
    name.ends_with(CONTAINER_SUFFIX)
}

/// Звено пути, с которым запись не принимается: пустое, `.`, `..`, с `:` или NUL.
fn unsafe_part(part: &str) -> bool {
    matches!(part, "" | "." | "..") || part.contains([':', '\0'])
}

/// Почему путь (уже в нижнем регистре, с прямыми косыми) не годится; `None` — годится.
/// Проверки идут по очереди: размер и начало, звенья, вложенный архив в конце.
fn path_fault(lowered: &str, allow_container_leaf: bool) -> Option<&'static str> {
    if !(1..=MAX_ENTRY_BYTES).contains(&lowered.len()) || lowered.starts_with('/') {
        Some("Invalid RPF entry path.")
    } else if lowered.split('/').any(unsafe_part) {
        Some("Unsafe RPF entry path.")
    } else if names_container(lowered) && !allow_container_leaf {
        // Последнее звено оканчивается на `.rpf` тогда и только тогда, когда так
        // оканчивается весь путь.
        Some("RPF entry must point to a file inside the archive.")
    } else {
        None
    }
}

/// Путь записи в звенья: обрезка, прямые косые, нижний регистр по Юникоду.
/// Вложенный архив последним звеном годится только при `allow_container_leaf`.
pub fn normalize_entry(value: &str, allow_container_leaf: bool) -> Result<Vec<String>> {
    let mut lowered = value.trim().to_lowercase();
    lowered = lowered.replace('\\', "/");
    match path_fault(&lowered, allow_container_leaf) {
        Some(refusal) => Err(invalid(refusal)),
        None => Ok(lowered.split('/').map(|part| part.to_owned()).collect()),
    }
}

// ---------------------------------------------------------------------------
// Разбор запроса
// ---------------------------------------------------------------------------

/// Объект JSON и типовые чтения его полей.
#[derive(Clone, Copy)]
struct Fields<'a>(&'a Map<String, Value>);

impl<'a> Fields<'a> {
    /// Значение должно быть объектом; иначе отказ `InvalidData` с этим текстом.
    fn object(item: &'a Value, refusal: &str) -> Result<Fields<'a>> {
        match item {
            Value::Object(map) => Ok(Fields(map)),
            _ => Err(invalid(refusal)),
        }
    }

    fn text(self, key: &str) -> Option<&'a str> {
        self.0.get(key)?.as_str()
    }

    fn owned(self, key: &str) -> Option<String> {
        self.text(key).map(str::to_owned)
    }

    fn path(self, key: &str) -> Option<PathBuf> {
        self.text(key).map(PathBuf::from)
    }

    fn flag(self, key: &str) -> bool {
        matches!(self.0.get(key), Some(Value::Bool(true)))
    }

    fn list(self, key: &str) -> Option<&'a Vec<Value>> {
        match self.0.get(key) {
            Some(Value::Array(items)) => Some(items),
            _ => None,
        }
    }
}

/// Текст запроса без ведущих BOM.
fn strip_bom(text: &str) -> &str {
    text.trim_start_matches('\u{feff}')
}

impl Fields<'_> {
    /// Путь архива в блоке установки: это путь самого архива в папке игры, поэтому
    /// имя на `.rpf` на конце допускается (и требуется), остальные правила пути те же.
    fn archive_path(self) -> Result<String> {
        let Some(given) = self.text("archive") else {
            return Err(argument("Install archive path is required."));
        };
        match normalize_entry(given, true)?.last() {
            Some(leaf) if names_container(leaf) => Ok(given.to_owned()),
            _ => Err(argument("Install archive must be an .rpf file.")),
        }
    }

    /// Одна операция запроса.
    fn operation(self) -> Result<Operation> {
        Ok(Operation {
            action: Action::parse(self.text("action"))?,
            allow_missing: self.flag("allowMissing"),
            entry: self.text("entry").unwrap_or_default().to_owned(),
            sha256: self
                .text("sha256")
                .filter(|digest| digest.chars().any(|c| !c.is_whitespace()))
                .map(str::to_owned),
            allow_delete: self.flag("allowDelete"),
            source: self.path("source"),
        })
    }

    /// Одна цель многоархивной установки.
    fn target(self) -> Result<InstallTarget> {
        Ok(InstallTarget {
            create: self.flag("create"),
            stage_name: self.owned("stageName"),
            archive: self.archive_path()?,
            sha256: self.owned("sha256"),
            prebuilt: self.owned("prebuilt"),
        })
    }

    /// Необязательные ключи блока: каждый включает свою возможность, остальное
    /// прежнее. Незнакомое значение отказывает до любой записи.
    fn install_options(self) -> Result<InstallOptions> {
        let before_aside = match self.0.get("before") {
            None | Some(Value::Null) => false,
            Some(Value::String(word)) if word == "point" => false,
            Some(Value::String(word)) if word == "aside" => true,
            Some(_) => return Err(argument("Install before mode is invalid.")),
        };
        let absolute = |key: &str| -> Result<Option<PathBuf>> {
            match self.0.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(text)) if Path::new(text).is_absolute() => {
                    Ok(Some(PathBuf::from(text)))
                }
                Some(_) => Err(argument("Install recipe path must be absolute.")),
            }
        };
        let expect_sha256 = match self.0.get("expectSha256") {
            None | Some(Value::Null) => None,
            Some(Value::String(text)) if is_digest(text) => Some(text.clone()),
            Some(_) => return Err(argument("Install expected sha256 is invalid.")),
        };
        let write = match self.0.get("write") {
            None | Some(Value::Null) => WriteMode::Full,
            Some(Value::String(word)) if word == "full" => WriteMode::Full,
            Some(Value::String(word)) if word == "append" => WriteMode::Append,
            Some(_) => return Err(argument("Install write mode is invalid.")),
        };
        let base_sha256 = match self.0.get("baseSha256") {
            None | Some(Value::Null) => None,
            Some(Value::String(text)) if is_digest(text) => Some(text.clone()),
            Some(_) => return Err(argument("Install base sha256 is invalid.")),
        };
        let (creates, creates_dirs) = points::created_from_request(self.0.get("creates"))?;
        let options = InstallOptions {
            before_aside,
            save_recipe: absolute("saveRecipe")?,
            use_recipe: absolute("useRecipe")?,
            expect_sha256,
            write,
            base_sha256,
            layer: self.layer_spec()?,
            expect: self.expectations()?,
            hold: self.hold_flag()?,
            commit: self.point_key("commit")?,
            discard: self.point_key("discard")?,
            stage_check: self.stage_check()?,
            creates,
            creates_dirs,
            keep_key: self.keep_key_flag()?,
            tail_pad: self.tail_pad_flag()?,
        };
        let steps = usize::from(options.hold)
            + usize::from(options.commit.is_some())
            + usize::from(options.discard.is_some());
        if steps > 1 {
            return Err(argument(
                "Install hold, commit and discard exclude each other.",
            ));
        }
        Ok(options)
    }

    /// Ключ `keepKey`: `true` или `false`; нет или `null` — нет.
    fn keep_key_flag(self) -> Result<bool> {
        match self.0.get("keepKey") {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(flag)) => Ok(*flag),
            Some(_) => Err(argument("Install keepKey is invalid.")),
        }
    }

    /// Ключ `tailPad`: `true` или `false`; нет или `null` — нет.
    fn tail_pad_flag(self) -> Result<bool> {
        match self.0.get("tailPad") {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(flag)) => Ok(*flag),
            Some(_) => Err(argument("Install tailPad is invalid.")),
        }
    }

    /// Ключ `hold`: `true` или `false`; нет или `null` — нет.
    fn hold_flag(self) -> Result<bool> {
        match self.0.get("hold") {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(flag)) => Ok(*flag),
            Some(_) => Err(argument("Install hold is invalid.")),
        }
    }

    /// Ключи `commit` и `discard`: id точки, как у `pointId`.
    fn point_key(self, key: &str) -> Result<Option<String>> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(id)) if points::valid_point_id(id) => Ok(Some(id.clone())),
            Some(_) => Err(argument(format!("Install {key} point id is invalid."))),
        }
    }

    /// Ключ `stageCheck`: `sha256` (умолчание) или `quick`.
    fn stage_check(self) -> Result<StageCheck> {
        match self.0.get("stageCheck") {
            None | Some(Value::Null) => Ok(StageCheck::default()),
            Some(Value::String(word)) if word == "sha256" => Ok(StageCheck::Sha256),
            Some(Value::String(word)) if word == "quick" => Ok(StageCheck::Quick),
            Some(_) => Err(argument("Install stageCheck is invalid.")),
        }
    }

    /// Ожидания к собранному архиву: ключи блока (для единственной или первой
    /// цели) и список `expect` с названным архивом у каждой строки.
    fn expectations(self) -> Result<Vec<Expectation>> {
        let mut found = Vec::new();
        let block = Expectation {
            archive: None,
            entries: expect::entries_from(self.0.get("expectEntries"))?,
            dlc_list: expect::packs_from(self.0.get("expectDlcList"))?,
        };
        if !block.is_empty() {
            found.push(block);
        }
        match self.0.get("expect") {
            None | Some(Value::Null) => {}
            Some(Value::Array(items)) if items.len() <= 64 => {
                for item in items {
                    let Value::Object(map) = item else {
                        return Err(argument("Install expect row is not an object."));
                    };
                    let row = Fields(map);
                    let archive = row.archive_path()?;
                    let entry = Expectation {
                        archive: Some(archive.replace('\\', "/").to_lowercase()),
                        entries: expect::entries_from(row.0.get("entries"))?,
                        dlc_list: expect::packs_from(row.0.get("dlcList"))?,
                    };
                    if !entry.is_empty() {
                        found.push(entry);
                    }
                }
            }
            Some(_) => return Err(argument("Install expect is invalid.")),
        }
        Ok(found)
    }

    /// Ключ `layer`: `{id, requires?}`; id от 1 до 64 знаков ASCII без управляющих.
    /// Нет или `null` — слоя нет.
    fn layer_spec(self) -> Result<Option<LayerSpec>> {
        let given = match self.0.get("layer") {
            None | Some(Value::Null) => return Ok(None),
            Some(given) => given,
        };
        let spec = match given {
            Value::Object(map) => Fields(map),
            _ => return Err(argument("Install layer is not an object.")),
        };
        let layer_id = |text: &str| {
            (1..=64).contains(&text.len())
                && text.is_ascii()
                && !text.chars().any(|c| c.is_ascii_control())
        };
        let id = match spec.text("id") {
            Some(id) if layer_id(id) => id.to_owned(),
            _ => return Err(argument("Install layer id is invalid.")),
        };
        let mut requires = Vec::new();
        match spec.0.get("requires") {
            None | Some(Value::Null) => {}
            Some(Value::Array(items)) if items.len() <= 64 => {
                for item in items {
                    match item.as_str() {
                        Some(name) if layer_id(name) && name != id => {
                            if !requires.iter().any(|known| known == name) {
                                requires.push(name.to_owned());
                            }
                        }
                        _ => return Err(argument("Install layer requirement is invalid.")),
                    }
                }
            }
            Some(_) => return Err(argument("Install layer requirement is invalid.")),
        }
        let registry = spec.layer_registry()?;
        Ok(Some(LayerSpec {
            id,
            requires,
            registry,
        }))
    }

    /// Ключ `registry` слоя: объект `{entry, source}` или список таких объектов.
    /// Запись — путь обычной записи корня (не вложенный архив), файл — абсолютный
    /// путь; каждая запись названа один раз.
    fn layer_registry(self) -> Result<Vec<RegistrySpec>> {
        let one = |item: &Value| -> Result<RegistrySpec> {
            let bad = || argument("Install layer registry is invalid.");
            let Value::Object(map) = item else {
                return Err(bad());
            };
            let row = Fields(map);
            let (Some(entry), Some(source)) = (row.text("entry"), row.path("source")) else {
                return Err(bad());
            };
            if !source.is_absolute() || !entry.is_ascii() {
                return Err(bad());
            }
            let parts = normalize_entry(entry, false).map_err(|_| bad())?;
            Ok(RegistrySpec {
                entry: parts.join("/"),
                source,
            })
        };
        let rows = match self.0.get("registry") {
            None | Some(Value::Null) => return Ok(Vec::new()),
            Some(item @ Value::Object(_)) => vec![one(item)?],
            Some(Value::Array(items)) if items.len() <= MAX_LAYER_REGISTRY => {
                items.iter().map(one).collect::<Result<Vec<_>>>()?
            }
            Some(_) => return Err(argument("Install layer registry is invalid.")),
        };
        for (at, row) in rows.iter().enumerate() {
            if rows[..at].iter().any(|before| before.entry == row.entry) {
                return Err(argument("Install layer registry entry is named twice."));
            }
        }
        Ok(rows)
    }

    /// Блок установки: корень игры, цели (или один архив), запись для отката.
    fn install(self) -> Result<Install> {
        let Some(game_root) = self.path("gameRoot").filter(|path| path.is_absolute()) else {
            return Err(argument("Install game root must be absolute."));
        };
        let mut targets = Vec::new();
        for item in self.list("targets").into_iter().flatten() {
            let object = Fields::object(item, "Install target is not an object.")?;
            targets.push(object.target()?);
        }
        let archive = match targets.as_slice() {
            [first, ..] => first.archive.clone(),
            [] => self.archive_path()?,
        };
        // второй шаг удержания (`commit`, `discard`) берёт запись переустановки
        // из записи удержания: ключ не обязателен
        let finishing = ["commit", "discard"]
            .iter()
            .any(|key| !matches!(self.0.get(*key), None | Some(Value::Null)));
        let replay = match self.0.get("replay") {
            Some(record) if record.is_object() => record.clone(),
            _ if finishing => json!({}),
            _ => return Err(argument("Install replay record is required.")),
        };
        Ok(Install {
            targets,
            create: self.flag("create"),
            replay,
            archive,
            game_root,
            sha256: self.owned("sha256"),
            point_id: self.owned("pointId"),
            prebuilt: self.owned("prebuilt"),
            stage_name: self.owned("stageName"),
            options: self.install_options()?,
        })
    }

    /// Блок `install` запроса: нет или `null` — обычная сборка.
    fn install_block(self) -> Result<Option<Install>> {
        let block = match self.0.get("install") {
            None | Some(Value::Null) => return Ok(None),
            Some(block) => block,
        };
        Fields::object(block, "RPF install block is not an object.")?
            .install()
            .map(Some)
    }

    /// Операции запроса: непустой список не длиннее предела. Без операций можно,
    /// когда установка берёт готовые файлы или собирает по рецепту (`optional`).
    fn operations(self, optional: bool) -> Result<Vec<Operation>> {
        let Some(items) = self.list("operations").filter(|items| !items.is_empty()) else {
            return if optional {
                Ok(Vec::new())
            } else {
                Err(argument("At least one RPF entry operation is required."))
            };
        };
        if items.len() > MAX_OPERATIONS {
            return Err(invalid("RPF operation limit exceeded."));
        }
        items
            .iter()
            .map(|item| Fields::object(item, "RPF operation is not an object.")?.operation())
            .collect()
    }
}

impl Fields<'_> {
    /// Запрос целиком; поля читаются по очереди, первый отказ и есть ответ:
    /// режим, блок установки, выход, операции, служебная папка.
    fn request(self) -> Result<Request> {
        let mode = Mode::from_word(self.text("mode"))?;
        let install = self.install_block()?;
        let output = match self.path("outputArchive") {
            Some(path) => path,
            None if install.is_some() => PathBuf::new(),
            None => return Err(argument("RPF output archive is required.")),
        };
        let optional = install
            .as_ref()
            .is_some_and(Install::builds_without_operations);
        let operations = self.operations(optional)?;
        let staging = self.path("stagingDirectory");
        if matches!(&staging, Some(dir) if !dir.is_absolute()) {
            return Err(argument("Staging directory must be absolute."));
        }
        Ok(Request {
            staging,
            mode,
            base: self.path("baseArchive"),
            output,
            archive_target: self.text("archiveTarget").unwrap_or_default().to_owned(),
            edition: self.owned("edition"),
            allow_deletes: self.flag("allowDeletes"),
            operations,
            install,
        })
    }
}

pub(crate) fn parse_request(text: &str) -> Result<Request> {
    let json: Value =
        serde_json::from_str(strip_bom(text)).map_err(|_| invalid("RPF request is not JSON."))?;
    Fields::object(&json, "RPF request is not an object.")?.request()
}

/// Файл отмены читается из запроса ещё раз, BOM срезается так же, как при
/// основном разборе.
pub(super) fn cancel_file_of(text: &str) -> Result<Option<PathBuf>> {
    let parsed = serde_json::from_str::<Value>(strip_bom(text));
    let root = parsed.map_err(|error| invalid(error.to_string()))?;
    Ok(match root.get("cancelFile") {
        Some(Value::String(path)) if !path.is_empty() => Some(PathBuf::from(path)),
        _ => None,
    })
}

/// Ключи игры и доводчик архивов для команды.
pub(super) fn load_tools(options: &Options) -> Result<(Arc<KeySet>, NgFinalizer)> {
    let hint = options.optional("game-root").unwrap_or_default();
    let (keys, _) = load_keys(hint, options.optional("keys"))?;
    let locator = options.optional("archive-fix");
    let fixer = NgFinalizer::locate(locator, Arc::clone(&keys))?;
    Ok((keys, fixer))
}

/// Команда `compose-rpf`.
pub fn compose_rpf(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let request_file = options.required("request")?;
    let text = fs::read_to_string(request_file)?;
    let request = parse_request(&text)?;
    if let Some(flag) = cancel_file_of(&text)? {
        progress.cancel().watch_file(flag);
    }

    // второй шаг удержания (подмена или отказ): путь удержания записан в точке, а не
    // в запросе; ArchiveFix не нужен, выключатели путей не спрашиваются (начатое
    // доводится и после того, как выключатель сняли)
    if request.install.as_ref().is_some_and(Install::finishes_a_hold) {
        return composed_install::finish_hold_command(options, &request, progress);
    }

    // слой кладёт только дозапись: полный путь пересобирает файл и убирает журнал
    if request.install.as_ref().is_some_and(|block| {
        block.options.layer.is_some() && block.options.write != WriteMode::Append
    }) {
        return Err(EngineError::argument(
            "Install layer needs write mode append.",
        ));
    }

    // созданные файлы называет только дозапись: полный путь их в опись не пишет
    if request.install.as_ref().is_some_and(|block| {
        !block.options.creates.is_empty() && block.options.write != WriteMode::Append
    }) {
        return Err(EngineError::argument(
            "Install creates needs write mode append.",
        ));
    }

    // длину файла под ключ головы держит только дозапись: полный путь файл подменяет
    if request.install.as_ref().is_some_and(|block| {
        block.options.keep_key && block.options.write != WriteMode::Append
    }) {
        return Err(EngineError::argument(
            "Install keepKey needs write mode append.",
        ));
    }

    // дозапись ArchiveFix не ищет и не запускает: оглавление шифрует свой код
    if request
        .install
        .as_ref()
        .is_some_and(|block| block.options.write == WriteMode::Append)
    {
        return super::append::compose_append(options, &request, progress);
    }

    let (keys, fixer) = load_tools(options)?;
    let finalizer: Option<&dyn Finalizer> = Some(&fixer);
    if request.install.is_none() {
        return compose_with(&request, &keys, finalizer, progress);
    }
    let points_root = points::restore_points_root_for(options)?;
    composed_install::compose_install(&request, &keys, finalizer, progress, &points_root)
}

// ---------------------------------------------------------------------------
// Подготовка операций
// ---------------------------------------------------------------------------

/// Операция с проверенным путём.
struct Prepared {
    parts: Vec<String>,
    /// Запись с прямыми косыми, регистр и пробелы как заданы.
    shown: String,
    op: Operation,
}

impl Prepared {
    /// Запись `….rpf` как целое (не удаление): она открывается как контейнер.
    fn is_whole_container(&self) -> bool {
        let leaf = self.parts.last().map_or("", String::as_str);
        self.op.action != Action::Delete && names_container(leaf)
    }
}

impl Operation {
    /// Источник операции: абсолютный путь существующего файла.
    fn check_source(&self) -> Result<()> {
        match self.source.as_deref() {
            Some(path) if path.is_absolute() && path.is_file() => Ok(()),
            Some(path) if path.is_absolute() => {
                Err(EngineError::file_not_found("Input file not found."))
            }
            _ => Err(argument("Helper paths must be absolute.")),
        }
    }

    /// Проверки по очереди: (а) право на удаление или (б) источник, затем (в) путь.
    fn prepare(&self, deletes_allowed: bool) -> Result<Prepared> {
        let removal = self.action == Action::Delete;
        if removal && !(deletes_allowed && self.allow_delete) {
            return Err(invalid(format!(
                "RPF delete is not authorized: {}",
                self.entry
            )));
        }
        if !removal {
            self.check_source()?;
        }
        Ok(Prepared {
            parts: normalize_entry(&self.entry, !removal)?,
            shown: self.entry.replace('\\', "/"),
            op: self.clone(),
        })
    }
}

/// Имя файла без папки, как текст.
fn file_name_text(path: impl AsRef<Path>) -> String {
    match path.as_ref().file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        None => String::new(),
    }
}

impl Request {
    /// Операции в порядке обработки: по записи в нижнем регистре «как есть»
    /// (с обратными косыми), устойчиво.
    fn prepare_operations(&self) -> Result<Vec<Prepared>> {
        let mut ordered = self.operations.iter().collect::<Vec<_>>();
        ordered.sort_by_cached_key(|op| op.entry.to_lowercase());
        let mut prepared = Vec::with_capacity(ordered.len());
        for op in ordered {
            prepared.push(op.prepare(self.allow_deletes)?);
        }
        Ok(prepared)
    }

    /// Имя архива для ключей и доводки: последнее звено `archiveTarget`, а если
    /// его нет, имя файла выхода. Оканчиваться оно обязано на `.rpf` (регистр важен).
    /// Под этим именем архив собирается в служебной папке (`workshop.path.join`),
    /// поэтому имя проверяется правилом диска: имя с диском или потоком NTFS увело
    /// бы файл из служебной папки.
    fn archive_name(&self) -> Result<String> {
        // Последнее непустое звено; косые обоих видов равны.
        let name = match self
            .archive_target
            .rsplit(['/', '\\'])
            .find(|segment| !segment.is_empty())
        {
            Some(tail) => tail.to_owned(),
            None => file_name_text(&self.output),
        };
        if !names_container(&name) {
            return Err(invalid("Logical RPF target name is missing."));
        }
        paths::normalize_relative(&name)?;
        Ok(name)
    }

    /// Служебная папка для запроса: заданная `staging` или скрытая рядом с выходом.
    fn open_workshop(&self) -> Result<Workshop> {
        let Some(folder) = self.output.parent() else {
            return Err(invalid("Output archive path has no folder."));
        };
        fs::create_dir_all(folder)?;
        let path = match &self.staging {
            Some(dir) => dir.clone(),
            None => {
                let hidden = format!(".astral-compose-{}", random_hex(32));
                folder.join(hidden)
            }
        };
        let workshop = Workshop { keep: false, path };
        fs::create_dir_all(&workshop.path)?;
        Ok(workshop)
    }

    /// Размер основы и источников: знаменатель хода записи (не меньше 1).
    fn planned_bytes(&self, prepared: &[Prepared]) -> u64 {
        let size_of = |path: &Path| fs::metadata(path).map_or(0, |facts| facts.len());
        let mut total = self.base.as_deref().map_or(0, size_of);
        for prep in prepared {
            if prep.op.action == Action::Delete {
                continue;
            }
            if let Some(source) = prep.op.source.as_deref() {
                total += size_of(source);
            }
        }
        total.max(1)
    }
}

// ---------------------------------------------------------------------------
// Применение операций к дереву
// ---------------------------------------------------------------------------

/// Операция на каком-то уровне вложенности: `rel` — путь записи ниже уже
/// открытых контейнеров.
#[derive(Clone, Copy)]
struct Job<'a> {
    prep: &'a Prepared,
    rel: &'a [String],
}

/// Что делать с операцией на этом уровне.
enum Step<'a> {
    /// Запись лежит прямо здесь.
    Here(Job<'a>),
    /// Путь идёт через вложенный архив; `job` — то, что останется внутри него.
    Inside {
        container: &'a [String],
        job: Job<'a>,
    },
}

/// Что сделать с найденным (или не найденным) файлом каталога.
enum Edit {
    Skip,
    Remove(usize),
    Overwrite(usize),
    Append,
}

impl Edit {
    /// Выбор правки по действию и по тому, есть ли уже такой файл в каталоге.
    fn choose(op: &Operation, existing: Option<usize>, shown: &str) -> Result<Edit> {
        match (op.action, existing) {
            (Action::Delete, Some(at)) => Ok(Edit::Remove(at)),
            (Action::Delete, None) if op.allow_missing => Ok(Edit::Skip),
            (Action::Delete | Action::Replace, None) => Err(EngineError::file_not_found(format!(
                "RPF entry not found: {shown}"
            ))),
            (Action::Import, Some(_)) => Err(invalid(format!(
                "RPF import target already exists: {shown}"
            ))),
            (Action::Replace | Action::Upsert, Some(at)) => Ok(Edit::Overwrite(at)),
            (Action::Import | Action::Upsert, None) => Ok(Edit::Append),
        }
    }
}

impl<'a> Job<'a> {
    fn whole(prep: &'a Prepared) -> Job<'a> {
        Job {
            prep,
            rel: &prep.parts,
        }
    }

    /// Первый вложенный архив в середине пути (последнее звено не считается).
    fn step(self) -> Step<'a> {
        let Some((_, middle)) = self.rel.split_last() else {
            return Step::Here(self);
        };
        match middle.iter().position(|part| names_container(part)) {
            None => Step::Here(self),
            Some(end) => Step::Inside {
                container: &self.rel[..=end],
                job: Job {
                    prep: self.prep,
                    rel: &self.rel[end + 1..],
                },
            },
        }
    }

    /// Операция над одной записью на своём уровне (без вложенных архивов в пути).
    fn apply_to(&self, root: &mut DirNode, moves: &Moves) -> Result<()> {
        let op = &self.prep.op;
        let Some((leaf, parents)) = self.rel.split_last() else {
            return Ok(());
        };
        let deleting = op.action == Action::Delete;
        let dir = match root.descend(op.action.adds(), !deleting, parents)? {
            Reach::Missing(_) if deleting && op.allow_missing => return Ok(()),
            reached => reached.require()?,
        };

        let edit = Edit::choose(op, dir.file_index(leaf), &self.rel.join("/"))?;
        let source = op.source.clone().unwrap_or_default();
        match edit {
            Edit::Skip => {}
            Edit::Remove(at) => {
                let gone = dir.files.remove(at);
                moves.removed_file(&gone.name, &gone.body);
            }
            Edit::Overwrite(at) => {
                let file = &mut dir.files[at];
                moves.replaced_body(&file.name, &file.body);
                file.body = payload_body(source, is_resource_body(&file.body), leaf);
                file.name.clone_from(leaf);
            }
            Edit::Append => {
                let resource = is_resource(&source)?;
                dir.files.push(FileNode {
                    body: payload_body(source, resource, leaf),
                    name: leaf.clone(),
                });
                moves.appended();
            }
        }
        Ok(())
    }
}

/// Операции внутри одного вложенного архива.
struct Group<'a> {
    path: &'a [String],
    jobs: Vec<Job<'a>>,
}

impl Group<'_> {
    /// Хоть одна операция группы что-то добавляет.
    fn creates(&self) -> bool {
        self.jobs.iter().any(|job| job.prep.op.action.adds())
    }
}

/// Вложенные архивы одного уровня; обходятся в порядке пути как текста.
#[derive(Default)]
struct Containers<'a>(BTreeMap<String, Group<'a>>);

impl<'a> Containers<'a> {
    fn group(&mut self, path: &'a [String]) -> &mut Group<'a> {
        self.0.entry(path.join("/")).or_insert_with(|| Group {
            path,
            jobs: Vec::new(),
        })
    }
}

/// Коды, при которых текст отказа не дополняется местом.
const CODE_INVALID_DATA: &str = "InvalidDataException";
const CODE_CANCELLED: &str = "Cancelled";

fn passes_unchanged(error: &EngineError) -> bool {
    matches!(error.code.as_str(), CODE_INVALID_DATA | CODE_CANCELLED)
}

/// Отказ операции на своём уровне: отмена идёт как есть, остальное — с местом.
fn failed_here(error: EngineError, job: &Job<'_>) -> EngineError {
    if error.code == CODE_CANCELLED {
        return error;
    }
    invalid(format!(
        "RPF operation failed at {}: {}",
        job.prep.shown, error.message
    ))
}

/// Режим сжатия новой двоичной записи по имени: вложенные архивы и звук хранятся как есть.
fn compression_for(name: &str) -> Compress {
    let stored = names_container(name) || name.ends_with(".awc");
    if stored {
        Compress::Store
    } else {
        Compress::Always
    }
}

fn is_resource_body(body: &Body) -> bool {
    let (archive, id) = match body {
        Body::Resource { .. } => return true,
        Body::Copy { archive, id } => (archive, *id),
        _ => return false,
    };
    matches!(archive.entry(id).kind, EntryKind::Resource(_))
}

/// Тело записи из файла-источника: ресурс или двоичное.
fn payload_body(source: PathBuf, resource: bool, name: &str) -> Body {
    let data = Data::File(source);
    if resource {
        return Body::Resource { data };
    }
    Body::Binary {
        data,
        compress: compression_for(name),
    }
}

/// Куда привёл спуск по каталогам.
enum Reach<'a> {
    Dir(&'a mut DirNode),
    Missing(String),
}

impl<'a> Reach<'a> {
    /// Каталог обязан быть найден.
    fn require(self) -> Result<&'a mut DirNode> {
        match self {
            Reach::Dir(dir) => Ok(dir),
            Reach::Missing(part) => Err(EngineError::directory_not_found(format!(
                "RPF directory not found: {part}"
            ))),
        }
    }
}

/// Поиск и создание записей внутри каталога дерева.
trait TreeOps {
    /// Номер файла с таким именем без учёта регистра ASCII.
    fn file_index(&self, name: &str) -> Option<usize>;

    /// Спуск по каталогам без учёта регистра ASCII. С `rename` найденные каталоги
    /// получают нижний регистр; с `create` недостающие создаются.
    fn descend<'a>(&'a mut self, create: bool, rename: bool, parts: &[String])
        -> Result<Reach<'a>>;

    /// Номер записи вложенного архива; записи нет — создаётся пустая, но только
    /// если какая-то операция что-то добавляет.
    fn container_slot(&mut self, name: &str, creates: bool) -> Result<usize>;
}

impl TreeOps for DirNode {
    fn file_index(&self, name: &str) -> Option<usize> {
        (0..self.files.len()).find(|&at| self.files[at].name.eq_ignore_ascii_case(name))
    }

    fn descend<'a>(
        &'a mut self,
        create: bool,
        rename: bool,
        parts: &[String],
    ) -> Result<Reach<'a>> {
        let Some((part, rest)) = parts.split_first() else {
            return Ok(Reach::Dir(self));
        };
        let found = (0..self.dirs.len()).find(|&at| self.dirs[at].name.eq_ignore_ascii_case(part));
        let next = match found {
            Some(at) => {
                let sub = &mut self.dirs[at];
                if rename {
                    sub.name.clone_from(part);
                }
                sub
            }
            None if create => self.ensure_dir(part)?,
            None => return Ok(Reach::Missing(part.clone())),
        };
        next.descend(create, rename, rest)
    }

    fn container_slot(&mut self, name: &str, creates: bool) -> Result<usize> {
        match (self.file_index(name), creates) {
            (Some(at), _) => Ok(at),
            (None, false) => Err(EngineError::file_not_found(format!(
                "Nested RPF not found: {name}"
            ))),
            (None, true) => {
                // Корень нового архива — без имени, на нулевом смещении, как у архивов игры и у
                // контейнеров, что уже лежат в основе. Корень, названный по файлу, уходил в блок имён
                // последним, и строгий читатель такой контейнер не раскрывал (RPF_KEY_MISMATCH,
                // 25.10.2026): из-за этого запросы с новым контейнером шли медленному помощнику.
                let body = Body::Nested(Box::new(DirNode::new("")));
                self.files.push(FileNode {
                    body,
                    name: name.to_owned(),
                });
                Ok(self.files.len() - 1)
            }
        }
    }
}

/// Опустевший вложенный архив с таким началом пути исчезает из родителя.
const ASTRAL_LAYER: &str = "x64/astral/";

/// Запись вложенного архива без единого файла и каталога.
fn is_hollow(body: &Body) -> bool {
    match body {
        Body::Nested(tree) => tree.files.is_empty() && tree.dirs.is_empty(),
        _ => false,
    }
}

fn not_binary_entry(shown: &str) -> EngineError {
    invalid(format!("Nested RPF is not a binary entry: {shown}"))
}

/// Ключи для вложенных архивов и ход выполнения; `moves` — сколько записей операции убрали и добавили
/// (допуск для сверки счёта файлов, `census.rs`).
struct Env<'a> {
    keys: &'a Arc<KeySet>,
    progress: &'a Progress,
    moves: Moves,
}

impl<'a> Env<'a> {
    fn new(keys: &'a Arc<KeySet>, progress: &'a Progress) -> Env<'a> {
        Env {
            keys,
            progress,
            moves: Moves::default(),
        }
    }
}

impl Env<'_> {
    fn apply_level(&self, node: &mut DirNode, jobs: Vec<Job<'_>>, prefix: &str) -> Result<()> {
        let mut containers = Containers::default();
        let mut direct = Vec::new();
        for step in jobs.into_iter().map(Job::step) {
            match step {
                Step::Inside { container, job } => containers.group(container).jobs.push(job),
                Step::Here(job) => direct.push(job),
            }
        }

        for job in direct {
            self.progress.checkpoint()?;
            if let Err(error) = job.apply_to(node, &self.moves) {
                return Err(failed_here(error, &job));
            }
            if job.prep.is_whole_container() {
                containers.group(job.rel);
            }
        }

        for group in containers.0.into_values() {
            self.edit_container(node, group, prefix)?;
        }
        Ok(())
    }

    /// Вложенный архив: открыть (или создать), применить его операции, а опустевший
    /// архив слоя Astral убрать из родителя.
    fn edit_container(&self, parent: &mut DirNode, group: Group<'_>, prefix: &str) -> Result<()> {
        let shown = group.path.join("/");
        let Err(error) = self.edit_container_inner(parent, &group, &shown, prefix) else {
            return Ok(());
        };
        // Отказ получает место в тексте, кроме тех, что идут как есть.
        if passes_unchanged(&error) {
            return Err(error);
        }
        let EngineError { code, message } = error;
        Err(EngineError::new(
            code,
            format!("RPF operation failed at {shown}: {message}"),
        ))
    }

    fn edit_container_inner(
        &self,
        parent: &mut DirNode,
        group: &Group<'_>,
        shown: &str,
        prefix: &str,
    ) -> Result<()> {
        let Some((name, folders)) = group.path.split_last() else {
            return Ok(());
        };
        let creates = group.creates();
        let dir = parent.descend(creates, true, folders)?.require()?;
        let at = dir.container_slot(name, creates)?;

        let inner_prefix = format!("{prefix}{shown}");
        let file = &mut dir.files[at];
        file.name.clone_from(name);
        let inner = self.open_container(file, shown)?;
        self.apply_level(inner, group.jobs.clone(), &format!("{inner_prefix}/"))?;

        if is_hollow(&dir.files[at].body) && inner_prefix.starts_with(ASTRAL_LAYER) {
            dir.files.remove(at);
            self.moves.hollow_removed();
        }
        Ok(())
    }

    /// Дерево вложенного архива этой записи. Положенный в этом же запросе
    /// файл-источник раскрывается чтением.
    fn open_container<'f>(&self, file: &'f mut FileNode, shown: &str) -> Result<&'f mut DirNode> {
        if let Body::Binary {
            data: Data::File(path),
            ..
        } = &file.body
        {
            let archive = Archive::open_path(path, Some(Arc::clone(self.keys)))?;
            let tree = DirNode::from_archive(&Arc::new(archive));
            file.body = Body::Nested(Box::new(tree));
        } else if let Body::Copy { archive, id } = &file.body {
            match &archive.entry(*id).kind {
                EntryKind::Binary(info) if info.is_compressed() => {
                    return Err(invalid(format!(
                        "Nested RPF is stored compressed or encrypted: {shown}"
                    )))
                }
                EntryKind::Binary(_) => {}
                _ => return Err(not_binary_entry(shown)),
            }
        } else if !matches!(file.body, Body::Nested(_)) {
            return Err(not_binary_entry(shown));
        }
        Ok(file.nested_root()?)
    }
}

// ---------------------------------------------------------------------------
// Вложенные архивы, которые не открываются
// ---------------------------------------------------------------------------

trait NestedProbe {
    /// Пути вложенных `.rpf` двоичного вида, которые не открываются (в обходе по
    /// каталогам и вложенным архивам). Каталоги идут с конца стека, как они
    /// добавлены; порядок результата важен.
    fn unopenable_nested(&self, prefix: &str) -> Vec<String>;
}

impl NestedProbe for Archive {
    fn unopenable_nested(&self, prefix: &str) -> Vec<String> {
        let mut found = Vec::new();
        let mut stack = vec![(self.root(), prefix.to_owned())];
        while let Some((dir, path)) = stack.pop() {
            for &file in self.files(dir) {
                let entry = self.entry(file);
                if !matches!(entry.kind, EntryKind::Binary(_))
                    || !Archive::is_nested_archive_name(&entry.name)
                {
                    continue;
                }
                let here = format!("{path}{}", entry.name);
                // оглавление вложенного архива разбирается один раз: его же потом
                // берёт правка дерева (`nested_root`) и проверка результата
                match self.open_nested_shared(file) {
                    Ok(inner) => found.extend(inner.unopenable_nested(&format!("{here}/"))),
                    Err(_) => found.push(here),
                }
            }
            for &sub in self.dirs(dir) {
                stack.push((sub, format!("{path}{}/", self.entry(sub).name)));
            }
        }
        found
    }
}

// ---------------------------------------------------------------------------
// Доводчик с памятью и служебная папка
// ---------------------------------------------------------------------------

/// Передаёт вызовы внутреннему доводчику, запоминает имена и считает время
/// работы доводчика.
pub(super) struct Recording<'a> {
    names: Mutex<Vec<String>>,
    inner: Option<&'a dyn Finalizer>,
    /// Сколько времени и сколько запусков отработал внутренний доводчик.
    busy: Arc<Mutex<(Duration, u64)>>,
}

impl<'a> Recording<'a> {
    pub(super) fn new(inner: Option<&'a dyn Finalizer>) -> Self {
        Recording {
            names: Mutex::new(Vec::new()),
            inner,
            busy: Arc::new(Mutex::new((Duration::ZERO, 0))),
        }
    }

    fn ledger(&self) -> MutexGuard<'_, Vec<String>> {
        self.names.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn heard(&self) -> Vec<String> {
        self.ledger().clone()
    }

    /// Суммарное время доводчика и число его запусков.
    pub(super) fn busy(&self) -> (Duration, u64) {
        *self.busy.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn account(busy: &Mutex<(Duration, u64)>, begun: Instant) {
        let mut busy = busy.lock().unwrap_or_else(PoisonError::into_inner);
        busy.0 += begun.elapsed();
        busy.1 += 1;
    }
}

impl Finalizer for Recording<'_> {
    fn finalize(&self, path: &Path, name: &str) -> rage_rpf::Result<()> {
        self.ledger().push(name.to_owned());
        let Some(inner) = self.inner else {
            return Ok(());
        };
        let begun = Instant::now();
        let outcome = inner.finalize(path, name);
        Recording::account(&self.busy, begun);
        outcome
    }

    /// Пробный запуск идёт без ожидания: время считается от начала запуска до
    /// конца ожидания, а имя в `archiveFix.sequence` не попадает.
    fn begin_trial(&self, path: &Path, name: &str) -> rage_rpf::Result<Option<Box<dyn TrialRun>>> {
        let Some(inner) = self.inner else {
            return Ok(None);
        };
        let begun = Instant::now();
        Ok(inner.begin_trial(path, name)?.map(|run| {
            Box::new(Counted {
                run,
                busy: Arc::clone(&self.busy),
                begun,
            }) as Box<dyn TrialRun>
        }))
    }

    fn executable_sha256(&self) -> Option<&str> {
        self.inner.and_then(|inner| inner.executable_sha256())
    }

    /// Голова после доводки без пробного запуска: время считается как работа
    /// доводчика, но запуском не числится.
    fn predict_head(&self, layout: &Layout<'_>, name: &str) -> rage_rpf::Result<Option<Vec<u8>>> {
        let Some(inner) = self.inner else {
            return Ok(None);
        };
        let begun = Instant::now();
        let head = inner.predict_head(layout, name);
        self.busy.lock().unwrap_or_else(PoisonError::into_inner).0 += begun.elapsed();
        head
    }

    fn memory_keys(&self) -> Option<&KeySet> {
        self.inner.and_then(|inner| inner.memory_keys())
    }

    fn leaves_closed_alone(&self) -> bool {
        self.inner.is_some_and(|inner| inner.leaves_closed_alone())
    }

    /// Вложенный архив обработан без файла: имя идёт в ход вызовов, расчёт в
    /// оглавлении — в работу доводчика и в число запусков (как доводка файла).
    fn note_handled(&self, name: &str, how: Handled) {
        self.ledger().push(name.to_owned());
        if let Some(inner) = self.inner {
            inner.note_handled(name, how);
        }
        if let Handled::Sealed { took, .. } = how {
            let mut busy = self.busy.lock().unwrap_or_else(PoisonError::into_inner);
            busy.0 += took;
            busy.1 += 1;
        }
    }
}

/// Пробный запуск со счётом времени.
struct Counted {
    run: Box<dyn TrialRun>,
    busy: Arc<Mutex<(Duration, u64)>>,
    begun: Instant,
}

impl TrialRun for Counted {
    fn finish(self: Box<Self>) -> rage_rpf::Result<()> {
        let Counted { run, busy, begun } = *self;
        let outcome = run.finish();
        Recording::account(&busy, begun);
        outcome
    }
}

/// Служебная папка: убирается целиком при любом выходе, если её не оставили.
struct Workshop {
    keep: bool,
    path: PathBuf,
}

impl Drop for Workshop {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

// ---------------------------------------------------------------------------
// Сборка и проверка
// ---------------------------------------------------------------------------

/// Секундомер стадии.
struct Stage(Instant);

impl Stage {
    fn begin() -> Stage {
        Stage(Instant::now())
    }

    fn millis(&self) -> u64 {
        u64::try_from(self.0.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

/// Итог подготовки: имя, операции, основа и то, что в основе уже не открывалось.
struct Plan {
    name: String,
    prepared: Vec<Prepared>,
    base: Option<Arc<Archive>>,
    broken_before: Option<Vec<String>>,
    /// Счёт записей и занятого места основы (`None`, если основы не было).
    counted: Option<BaseCount>,
    total: u64,
}

impl Env<'_> {
    fn plan(&self, request: &Request) -> Result<Plan> {
        self.progress.report("prepare");
        let name = request.archive_name()?;
        if request.mode == Mode::Create {
            let output_name = file_name_text(&request.output).to_lowercase();
            if !names_container(&output_name) {
                return Err(invalid("Created archive must use the .rpf extension."));
            }
        }
        let prepared = request.prepare_operations()?;
        let mut base = None;
        if let Some(path) = request.base.as_deref() {
            base = Some(Arc::new(Archive::open_path(
                path,
                Some(Arc::clone(self.keys)),
            )?));
        }

        // Без основы читать нечего: стадия `read` не сообщается вовсе.
        let mut broken_before = None;
        let mut counted = None;
        if let Some(opened) = &base {
            self.progress.report("read");
            broken_before = Some(opened.unopenable_nested(""));
            // после разбора вложенных: их оглавления уже в кэше архива
            counted = Some(BaseCount::of(opened));
        }
        let total = request.planned_bytes(&prepared);
        Ok(Plan {
            name,
            prepared,
            base,
            broken_before,
            counted,
            total,
        })
    }

    /// Сверка счёта записей: нигде не пропало больше, чем убрали сами операции. `base` — основа (если была), `tree` — дерево
    /// после операций, `result` — записанный файл (`None`, пока файла ещё нет).
    fn check_census(
        &self,
        base: Option<&BaseCount>,
        tree: Census,
        result: Option<Census>,
    ) -> Result<()> {
        if let Some(base) = base {
            let (removed, added) = (self.moves.removed(), self.moves.added());
            if tree.files + removed < base.census.files + added {
                return Err(invalid(format!(
                    "RPF compose lost entries of the base archive: {} files in the base, {} after the operations, {} removed and {} added by them.",
                    base.census.files, tree.files, removed, added
                )));
            }
        }
        if let Some(result) = result {
            if result.files < tree.files {
                return Err(invalid(format!(
                    "RPF compose lost entries while writing: {} files planned, {} in the written archive.",
                    tree.files, result.files
                )));
            }
        }
        Ok(())
    }

    /// Готовый архив открывается, запечатан, если нужно, содержит всё заказанное, а
    /// вложенные архивы основы не стали хуже (`broken_before` — что было сломано в
    /// основе; `None`, если основы не было).
    fn check_result(
        &self,
        staged: &Path,
        prepared: &[Prepared],
        broken_before: Option<&[String]>,
        sealed: bool,
        name: &str,
        planned: Option<Census>,
    ) -> Result<Option<Census>> {
        let result = match Archive::open_path(staged, Some(Arc::clone(self.keys))) {
            Ok(opened) => opened,
            Err(error) => {
                return Err(invalid(format!(
                    "The rebuilt archive does not open: {error}"
                )))
            }
        };
        if sealed && result.encryption() != Encryption::Ng {
            return Err(invalid(format!("RPF finalization failed: {name}")));
        }
        for prep in prepared {
            prep.verify_in(&result, &prep.parts)?;
        }

        // Сравнивать не с чем, если основы не было.
        if let Some(before) = broken_before {
            self.progress.report("read");
            let damaged = result
                .unopenable_nested("")
                .into_iter()
                .find(|path| !before.contains(path));
            if let Some(path) = damaged {
                return Err(invalid(format!(
                    "RPF compose damaged nested archives: {path}"
                )));
            }
        }
        // Записанный файл не беднее дерева, из которого его писали. Без основы счёта нет: вложенные архивы результата при
        // проверке не раскрывались, и счёт добавил бы разбор их оглавлений (`compose_stream_tests`: «разбирается только готовый файл»).
        let Some(planned) = planned else {
            return Ok(None);
        };
        let written = census::of_archive(&result);
        self.check_census(None, planned, Some(written))?;
        Ok(Some(written))
    }
}

/// Ход записи: сколько байт уже записано и сколько всего ожидается.
struct WriteMeter<'a> {
    progress: &'a Progress,
    total: u64,
    last: u64,
}

impl WriteMeter<'_> {
    fn advance(&mut self, written: u64) {
        let first = self.last == 0 && written > 0;
        let step = disk::delta(&mut self.last, written);
        self.progress.wrote(step);
        self.progress
            .report_bytes("compose", written.min(self.total), self.total);
        if first {
            // стенды: убить процесс посреди записи (вложенный архив может быть недописан)
            failpoint::hit("compose-mid-write");
        }
    }
}

/// Пишет дерево в `staged` и возвращает размер файла; к возврату файл закрыт.
fn write_staged(
    tree: &DirNode,
    staged: &Path,
    context: &mut WriteContext<'_>,
    meter: &mut WriteMeter<'_>,
    nested: NestedMode,
) -> Result<u64> {
    let mut output = File::create(staged)?;
    let report = write_archive_with(
        tree,
        &mut output,
        context,
        &mut |written| meter.advance(written),
        nested,
    )?;
    Ok(report.size)
}

/// Выключатель отпечатка по ходу записи: включается значением `1`. Без него —
/// прежний порядок (запись тел, доводка, отдельное чтение готового файла ради
/// SHA-256): новый путь выключен, пока его не принял замер на копии игры.
pub const STREAM_SHA_ENV: &str = "ASTRAL_ENGINE_STREAM_SHA";

/// Размер архива в МиБ, с которого корневой архив идёт с пробной доводкой.
pub const STREAM_SHA_MIN_ENV: &str = "ASTRAL_ENGINE_STREAM_SHA_MIN_MB";

/// Стенд разбора (по умолчанию выключен): `1` — собранный файл, не прошедший
/// проверку, остаётся в служебной папке, а текст отказа называет его путь
/// (`[kept: …]`). Нужен тяжёлому циклу `tests/nested_direct.rs`, чтобы разобрать
/// испорченный результат; в поставке не задаётся.
pub const KEEP_REFUSED_ENV: &str = "ASTRAL_ENGINE_KEEP_REFUSED";

/// Выключатель вложенных архивов сразу во внешний (по умолчанию выключен): `1` —
/// вложенный архив пишется на своё место во внешнем файле, без временного файла и
/// второй записи, когда доводчик шифрует в памяти (`ASTRAL_ENGINE_NG=native`) или
/// его нет; с ArchiveFix вложенные идут прежним путём. Байты те же.
pub const NESTED_DIRECT_ENV: &str = "ASTRAL_ENGINE_NESTED_DIRECT";

/// Сколько МиБ сжатых тел вложенных архивов можно держать в памяти до записи (по
/// умолчанию 1024); что не поместилось, идёт прежним путём.
pub const NESTED_DIRECT_RAM_ENV: &str = "ASTRAL_ENGINE_NESTED_DIRECT_RAM_MB";

/// Порядок записи корневого архива и отпечатка файла.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Streaming {
    /// Отпечаток собирается по ходу записи; иначе прежний порядок.
    pub enabled: bool,
    /// Пробная доводка корня стоит запуска доводчика, а окупается тем, что
    /// отдельного прохода по готовому файлу не будет. У малого архива проход
    /// дешевле запуска: такой архив идёт прежним порядком. Здесь — наименьший
    /// размер архива, с которого пробная доводка нужна.
    pub trial_from: u64,
    /// Как пишутся вложенные архивы: через временный файл или сразу во внешний.
    pub nested: NestedMode,
}

impl Streaming {
    /// Умолчание выключено; у включённого проба идёт с 256 МиБ.
    const DEFAULT_TRIAL_FROM: u64 = 256 << 20;

    /// По переменным окружения.
    pub fn from_env() -> Streaming {
        let mode = env::var(STREAM_SHA_ENV).unwrap_or_default();
        let trial_from = env::var(STREAM_SHA_MIN_ENV)
            .ok()
            .and_then(|text| text.trim().parse::<u64>().ok())
            .map_or(Self::DEFAULT_TRIAL_FROM, |megabytes| {
                megabytes.saturating_mul(1 << 20)
            });
        let direct = env::var(NESTED_DIRECT_ENV).is_ok_and(|text| text.trim() == "1");
        let nested = if direct {
            let ram_cap = env::var(NESTED_DIRECT_RAM_ENV)
                .ok()
                .and_then(|text| text.trim().parse::<u64>().ok())
                .map_or(NestedMode::DEFAULT_RAM_CAP, |megabytes| {
                    megabytes.saturating_mul(1 << 20)
                });
            NestedMode::Direct { ram_cap }
        } else {
            NestedMode::Staged
        };
        Streaming {
            enabled: mode.trim() == "1",
            trial_from,
            nested,
        }
    }

    /// По ходу записи с пробой от размера по умолчанию: то, что включает `1`.
    pub const fn on() -> Streaming {
        Streaming {
            enabled: true,
            trial_from: Self::DEFAULT_TRIAL_FROM,
            nested: NestedMode::Staged,
        }
    }

    /// Всегда по ходу записи, с пробной доводкой любого архива.
    pub const fn always() -> Streaming {
        Streaming {
            enabled: true,
            trial_from: 0,
            nested: NestedMode::Staged,
        }
    }

    /// Прежний порядок.
    pub const fn off() -> Streaming {
        Streaming {
            enabled: false,
            trial_from: 0,
            nested: NestedMode::Staged,
        }
    }

    /// То же с другим порядком записи вложенных архивов.
    pub const fn with_nested(self, nested: NestedMode) -> Streaming {
        Streaming { nested, ..self }
    }
}

/// Готовый файл ложится на место выхода: переименованием, а если не вышло, копией.
fn deliver(staged: &Path, output: &Path, workshop: &mut Workshop) -> Result<()> {
    if fs::rename(staged, output).is_ok() {
        return Ok(());
    }
    if let Err(error) = fs::copy(staged, output) {
        workshop.keep = true;
        return Err(EngineError::from(error));
    }
    let _ = fs::remove_file(staged);
    Ok(())
}

/// Собирает и проверяет архив без команды: основа, операции, запись, проверка,
/// выход, ответ.
pub fn compose_with(
    request: &Request,
    keys: &Arc<KeySet>,
    finalizer: Option<&dyn Finalizer>,
    progress: &Progress,
) -> Result<Value> {
    compose_streaming(request, keys, finalizer, progress, Streaming::from_env())
}

/// `compose_with` с явным выбором порядка записи и отпечатка.
pub fn compose_streaming(
    request: &Request,
    keys: &Arc<KeySet>,
    finalizer: Option<&dyn Finalizer>,
    progress: &Progress,
    streaming: Streaming,
) -> Result<Value> {
    compose_batched(request, &[], keys, finalizer, progress, streaming)
}

/// Сборка, у которой операции приходят партиями: `earlier` применяются к дереву
/// основы по очереди (каждая партия как отдельный запрос, со своим порядком), и
/// только потом операции самого запроса. Так «Починить» повторяет историю
/// дозаписей: партия, снявшая вложенный архив, и следующая, создавшая его заново,
/// не сливаются в одну сортировку. Ответ, проверка и подмена — как у обычной сборки
/// (проверяются операции самого запроса).
pub fn compose_batched(
    request: &Request,
    earlier: &[Vec<Operation>],
    keys: &Arc<KeySet>,
    finalizer: Option<&dyn Finalizer>,
    progress: &Progress,
    streaming: Streaming,
) -> Result<Value> {
    let stream = streaming.enabled;
    let parses_before = rage_rpf::toc::parse_count();
    let env = Env::new(keys, progress);
    let sealed = finalizer.is_some();
    let observer = Arc::new(progress.clone());
    let _hook = activity::install(observer);
    // фазы, байты и счёт вложенных архивов этого запроса (рабочие потоки берут его же)
    let tally = Tally::new();
    let _tally = tally::install(Arc::clone(&tally));

    let prepare_clock = Stage::begin();
    let plan = env.plan(request)?;
    let prepare_ms = prepare_clock.millis();

    progress.report("compose");
    let apply_clock = Stage::begin();
    let mut tree = plan
        .base
        .as_ref()
        .map(DirNode::from_archive)
        .unwrap_or_default();
    for batch in earlier {
        let step = Request {
            operations: batch.clone(),
            ..request.clone()
        };
        let before = step.prepare_operations()?;
        let jobs: Vec<Job<'_>> = before.iter().map(Job::whole).collect();
        env.apply_level(&mut tree, jobs, "")?;
    }
    let jobs: Vec<Job<'_>> = plan.prepared.iter().map(Job::whole).collect();
    env.apply_level(&mut tree, jobs, "")?;
    #[cfg(test)]
    tests::simulate_loss(&mut tree);
    let apply_ms = apply_clock.millis();
    // Счёт записей до записи: если дерево стало беднее основы больше, чем убрали сами операции, два гигабайта не пишутся.
    // Без основы считать нечего (и разбирать вложенные архивы ради счёта незачем).
    let planned = plan.counted.as_ref().map(|_| census::of_tree(&tree));
    if let Some(planned) = planned {
        env.check_census(plan.counted.as_ref(), planned, None)?;
    }

    let write_clock = Stage::begin();
    let mut workshop = request.open_workshop()?;
    let staged = workshop.path.join(&plan.name);
    let recording = Recording::new(finalizer);
    let mut context = WriteContext {
        staging: &workshop.path,
        keys: Some(keys.as_ref()),
        finalizer: finalizer.map(|_| &recording as &dyn Finalizer),
    };
    let mut meter = WriteMeter {
        progress,
        total: plan.total,
        last: 0,
    };
    let (size, streamed) = if stream {
        let layout = Layout::prepare_with(&tree, &mut context, streaming.nested)?;
        let streamed = write_streamed(
            &layout,
            &staged,
            &plan.name,
            &workshop.path,
            sealed.then_some(&recording as &dyn Finalizer),
            streaming,
            &mut |written| meter.advance(written),
        )?;
        (layout.size(), Some(streamed))
    } else {
        let size = write_staged(&tree, &staged, &mut context, &mut meter, streaming.nested)?;
        if sealed {
            recording.finalize(&staged, &plan.name)?;
        }
        (size, None)
    };
    drop(tree);
    let Plan {
        name,
        prepared,
        base,
        broken_before,
        counted: base_count,
        ..
    } = plan;
    drop(base);
    let write_ms = write_clock.millis();
    // стенды: убить процесс, когда собранный файл лежит только в служебной папке
    failpoint::hit("compose-after-write");

    let verify_clock = Stage::begin();
    progress.report("verify");
    let broken = broken_before.as_deref();
    let written = match env.check_result(&staged, &prepared, broken, sealed, &name, planned) {
        Ok(written) => written,
        Err(error) => {
            // стенд разбора: отказ проверки оставляет собранный файл и называет его путь
            if env::var(KEEP_REFUSED_ENV).is_ok_and(|text| text.trim() == "1") {
                workshop.keep = true;
                return Err(EngineError::new(
                    error.code,
                    format!("{} [kept: {}]", error.message, staged.display()),
                ));
            }
            return Err(error);
        }
    };
    let validate_ms = verify_clock.millis();

    deliver(&staged, &request.output, &mut workshop)?;
    drop(workshop);

    // Отдельный проход по готовому файлу нужен, только когда отпечаток не
    // собирался по ходу записи.
    let hash_clock = Stage::begin();
    let (digest, hashing, hash_streamed) = match streamed {
        Some(Streamed {
            digest: Some(digest),
            waited,
        }) => (digest, waited, true),
        Some(Streamed { waited, .. }) => (sha256_file(&request.output)?, waited, false),
        None => (sha256_file(&request.output)?, Duration::ZERO, false),
    };
    let hash_ms = if hash_streamed {
        0
    } else {
        hash_clock.millis()
    };
    let (fix_time, fix_runs) = recording.busy();
    let millis = |span: Duration| u64::try_from(span.as_millis()).unwrap_or(u64::MAX);

    let mut shown: Vec<&str> = prepared.iter().map(|prep| prep.shown.as_str()).collect();
    shown.sort_by_cached_key(|entry| entry.to_lowercase());
    let executable = match finalizer {
        Some(sealer) => sealer.executable_sha256().unwrap_or(PINNED_SHA256),
        None => "",
    };
    let fix = [
        ("executableSha256", json!(executable)),
        ("sequence", json!(recording.heard())),
    ];
    // `write` включает и доводчик (корневой и вложенные запуски); `archiveFix` —
    // его доля отдельно. `hash` — отдельный проход по готовому файлу (при отпечатке
    // по ходу записи ноль), `hashWait` — сколько писавший поток ждал читателя отпечатка
    // после записи и доводки (то, что не скрылось за записью).
    //
    // Ниже `tocParses` идут фазы по времени потоков суммой (как у `roads-build`) и
    // байты запроса по счётчикам движка (чтение и запись самого движка; внутри
    // ArchiveFix не считаются). `nested` охватывает вложенные архивы целиком и
    // пересекается с чтением, сжатием и записью.
    let counted = tally.totals();
    let timings = [
        ("prepare", prepare_ms),
        ("apply", apply_ms),
        ("write", write_ms),
        ("validate", validate_ms),
        ("hash", hash_ms),
        ("archiveFix", millis(fix_time)),
        ("archiveFixRuns", fix_runs),
        ("hashWait", millis(hashing)),
        ("hashStreamed", u64::from(hash_streamed)),
        ("tocParses", rage_rpf::toc::parse_count() - parses_before),
        ("readSources", counted.millis(Phase::Sources)),
        ("buildToc", counted.millis(Phase::Toc)),
        ("deflate", counted.millis(Phase::Deflate)),
        ("writeBodies", counted.millis(Phase::Bodies)),
        ("nested", counted.millis(Phase::Nested)),
        ("flush", counted.millis(Phase::Flush)),
        ("lockWait", counted.millis(Phase::GateWait)),
        ("nestedDirect", counted.nested_direct),
        ("nestedStaged", counted.nested_staged),
        ("readBytes", counted.read_bytes),
        ("writtenBytes", counted.written_bytes),
    ];
    // Порядок ключей ответа — порядок строк таблицы.
    let answer = [
        ("status", json!("ready")),
        ("archive", json!(request.archive_target)),
        ("edition", json!(request.edition)),
        ("operations", json!(prepared.len())),
        ("entries", json!(shown)),
        ("bytes", json!(size)),
        ("sha256", json!(digest)),
        ("archiveFix", Value::Object(object_of(fix))),
        (
            "timings",
            Value::Object(object_of(timings.map(|(stage, ms)| (stage, json!(ms))))),
        ),
    ];
    let mut object = object_of(answer);
    // Счёт записей (файлы и каталоги, вложенные архивы внутрь) и мёртвое место основы: журнал подготовки пишет их строкой
    // (`apps/desktop/src/prepare-log.js`). Без основы считать «до» нечего.
    if let Some(base) = &base_count {
        object.insert("entriesBefore".to_owned(), json!(base.census.entries()));
    }
    if let Some(written) = written {
        object.insert("entriesAfter".to_owned(), json!(written.entries()));
    }
    if let Some(base) = &base_count {
        object.insert("usefulBytesBefore".to_owned(), json!(base.space.useful_bytes));
        object.insert("fileBytesBefore".to_owned(), json!(base.space.file_bytes));
        object.insert("deadBytesBefore".to_owned(), json!(base.space.dead_bytes));
    }
    Ok(Value::Object(object))
}

// ---------------------------------------------------------------------------
// Дозапись: операции над деревом живого архива
// ---------------------------------------------------------------------------

/// Операции запроса, уже применённые к дереву живого архива: их проверка на
/// записанном файле и сводка для ответа.
pub(super) struct AppliedOps {
    prepared: Vec<Prepared>,
    planned: u64,
}

impl AppliedOps {
    pub(super) fn count(&self) -> usize {
        self.prepared.len()
    }

    /// Размер источников операций: знаменатель хода записи (не меньше 1).
    pub(super) fn planned_bytes(&self) -> u64 {
        self.planned.max(1)
    }

    /// Записи операций, как они названы в запросе, по возрастанию без учёта регистра.
    pub(super) fn shown(&self) -> Vec<String> {
        let mut shown: Vec<String> = self
            .prepared
            .iter()
            .map(|prep| prep.shown.clone())
            .collect();
        shown.sort_by_cached_key(|entry| entry.to_lowercase());
        shown
    }

    /// Каждая операция на записанном архиве, как его прочитает игра: запись
    /// есть и равна источнику (или её нет, если её удаляли).
    pub(super) fn verify(&self, archive: &Archive) -> Result<()> {
        for prep in &self.prepared {
            prep.verify_in(archive, &prep.parts)?;
        }
        Ok(())
    }
}

/// Применяет операции запроса к дереву архива `base` и отдаёт дерево для
/// дозаписи. Операция внутри вложенного `.rpf` (или над самим вложенным
/// архивом) правит дерево вложенного (`Body::Nested`, как у полного пути):
/// писатель положит правку в запас вложенного или переместит его в конец с
/// новым запасом. Вложенный во вложенном и прочее, чего писатель не берёт,
/// отказывает его кодом (`NestedTooDeep`, `NestedTooLarge`, `NotNg`,
/// `NestedNotSupported`) до любой правки файла.
pub(super) fn apply_for_append(
    request: &Request,
    base: &Arc<Archive>,
    keys: &Arc<KeySet>,
    progress: &Progress,
) -> Result<(DirNode, AppliedOps)> {
    let prepared = request.prepare_operations()?;
    let size_of = |path: &Path| fs::metadata(path).map_or(0, |facts| facts.len());
    let planned = prepared
        .iter()
        .filter(|prep| prep.op.action != Action::Delete)
        .filter_map(|prep| prep.op.source.as_deref())
        .map(size_of)
        .sum();
    let env = Env::new(keys, progress);
    let mut tree = DirNode::from_archive(base);
    {
        let jobs: Vec<Job<'_>> = prepared.iter().map(Job::whole).collect();
        env.apply_level(&mut tree, jobs, "")?;
    }
    Ok((tree, AppliedOps { prepared, planned }))
}

/// Готовый архив по операциям, как его прочитает игра: у каждой записи из
/// операций (на всех уровнях вложенности) данные равны источнику, снятых записей
/// нет, а у вложенного архива, положенного целиком, равно всё его дерево. Так
/// «Починить» сверяет то, что собрала по сводному рецепту. Возвращает, сколько
/// операций проверено.
pub(super) fn verify_operations(
    archive: &Archive,
    operations: &[Operation],
    allow_deletes: bool,
    keys: &Arc<KeySet>,
) -> Result<usize> {
    for op in operations {
        let prep = op.prepare(allow_deletes)?;
        prep.verify_in(archive, &prep.parts)?;
        if prep.is_whole_container() {
            // правки внутри него, которые легли позже, сверяются своими операциями
            let inside = paths_inside(operations, &prep.parts);
            verify_container_tree(archive, &prep, keys, &inside)?;
        }
    }
    Ok(operations.len())
}

/// Пути действующих операций внутри вложенного архива `container` (его путь —
/// звенья в нижнем регистре): от корня вложенного, звенья через `/`.
fn paths_inside(operations: &[Operation], container: &[String]) -> Vec<String> {
    operations
        .iter()
        .filter_map(|op| normalize_entry(&op.entry, op.action != Action::Delete).ok())
        .filter(|parts| parts.len() > container.len() && parts.starts_with(container))
        .map(|parts| parts[container.len()..].join("/"))
        .collect()
}

/// Путь внутри вложенного лежит под одной из операций (сам или глубже).
fn covered_by(operations_inside: &[String], path: &str) -> bool {
    operations_inside.iter().any(|rel| {
        path == rel
            || path
                .strip_prefix(rel.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// Все файлы архива на всех уровнях: путь (нижний регистр, вложенные архивы
/// раскрыты, самих их среди путей нет) и SHA-256 распакованных данных.
fn file_digests(archive: &Archive, prefix: &str, out: &mut BTreeMap<String, String>) -> Option<()> {
    let mut stack = vec![(archive.root(), prefix.to_owned())];
    while let Some((dir, path)) = stack.pop() {
        for &id in archive.files(dir) {
            let name = &archive.entry(id).name;
            let here = format!("{path}{}", name.to_lowercase());
            if Archive::is_nested_archive_name(name) {
                let inner = archive.open_nested_shared(id).ok()?;
                file_digests(&inner, &format!("{here}/"), out)?;
                continue;
            }
            let data = archive.decode(id, EntryCipher::AlwaysNg).ok()?;
            out.insert(here, super::sha256_hex(&data));
        }
        for &sub in archive.dirs(dir) {
            stack.push((
                sub,
                format!("{path}{}/", archive.entry(sub).name.to_lowercase()),
            ));
        }
    }
    Some(())
}

/// Вложенный архив этого пути в готовом архиве: каталоги и вложенные архивы по
/// звеньям, имена без учёта регистра.
fn container_at(archive: &Archive, parts: &[String]) -> Option<Arc<Archive>> {
    let mut current: Option<Arc<Archive>> = None;
    let mut dir = archive.root();
    for (at, part) in parts.iter().enumerate() {
        let here: &Archive = current.as_deref().unwrap_or(archive);
        if at + 1 < parts.len() {
            if let Some(sub) = here.find_dir(dir, part) {
                dir = sub;
                continue;
            }
        }
        let id = here.find_file(dir, part)?;
        let inner = here.open_nested_shared(id).ok()?;
        dir = inner.root();
        current = Some(inner);
    }
    current
}

/// Деревья двух архивов одинаковы: те же каталоги и файлы, у файлов те же
/// распакованные данные, вложенные архивы сравниваются так же глубоко.
fn same_tree(left: &Archive, ldir: usize, right: &Archive, rdir: usize) -> Option<()> {
    if left.files(ldir).len() != right.files(rdir).len()
        || left.dirs(ldir).len() != right.dirs(rdir).len()
    {
        return None;
    }
    for &id in left.files(ldir) {
        let name = &left.entry(id).name;
        let twin = right.find_file(rdir, name)?;
        if Archive::is_nested_archive_name(name) {
            let (one, two) = (
                left.open_nested_shared(id).ok()?,
                right.open_nested_shared(twin).ok()?,
            );
            same_tree(&one, one.root(), &two, two.root())?;
            continue;
        }
        let same = left.decode(id, EntryCipher::AlwaysNg).ok()?
            == right.decode(twin, EntryCipher::AlwaysNg).ok()?;
        same.then_some(())?;
    }
    for &sub in left.dirs(ldir) {
        let twin = right.find_dir(rdir, &left.entry(sub).name)?;
        same_tree(left, sub, right, twin)?;
    }
    Some(())
}

/// Вложенный архив, положенный из файла целиком, равен дереву источника. Если позже
/// внутри него что-то правили (`inside` — пути действующих операций от его корня),
/// эти пути сверяются своими операциями (запись равна своему источнику, снятой нет),
/// а всё остальное обязано быть равно донору файл в файл, и лишних файлов нет.
fn verify_container_tree(
    result: &Archive,
    prep: &Prepared,
    keys: &Arc<KeySet>,
    inside: &[String],
) -> Result<()> {
    let source = prep.op.source.as_deref().unwrap_or(Path::new(""));
    let donor = Archive::open_path(source, Some(Arc::clone(keys)))?;
    let differs = || {
        invalid(format!(
            "Patch verification failed (the nested archive differs from its source): {}",
            prep.shown
        ))
    };
    let placed = container_at(result, &prep.parts).ok_or_else(differs)?;
    if inside.is_empty() {
        return same_tree(&donor, donor.root(), &placed, placed.root()).ok_or_else(differs);
    }
    let (mut wanted, mut found) = (BTreeMap::new(), BTreeMap::new());
    file_digests(&donor, "", &mut wanted).ok_or_else(differs)?;
    file_digests(&placed, "", &mut found).ok_or_else(differs)?;
    let untouched_equal = wanted
        .iter()
        .filter(|(path, _)| !covered_by(inside, path))
        .all(|(path, digest)| found.get(path) == Some(digest));
    let nothing_extra = found
        .keys()
        .all(|path| wanted.contains_key(path) || covered_by(inside, path));
    (untouched_equal && nothing_extra)
        .then_some(())
        .ok_or_else(differs)
}

/// Объект JSON из таблицы «ключ, значение»; ключи идут в порядке таблицы.
fn object_of<const N: usize>(rows: [(&str, Value); N]) -> Map<String, Value> {
    rows.into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

/// Чем закончился спуск по каталогам готового архива, не дойдя до конца пути.
enum Landing {
    Container { id: usize, depth: usize },
    Absent,
}

impl Prepared {
    fn staged_failed(&self) -> EngineError {
        invalid(format!("RPF staged validation failed: {}", self.op.entry))
    }

    fn not_lowercase(&self) -> EngineError {
        invalid(format!(
            "GTA V would not find {}: an archive name on its path is not lowercase.",
            self.shown
        ))
    }

    /// Ищет запись операции в готовом архиве (каталоги без учёта регистра, имена
    /// файлов точно) и сверяет её с источником. `parts` — путь ниже уже
    /// раскрытых вложенных архивов.
    fn verify_in(&self, archive: &Archive, parts: &[String]) -> Result<()> {
        let Some((leaf, parents)) = parts.split_last() else {
            return Ok(());
        };
        let deleting = self.op.action == Action::Delete;

        let walked = parents
            .iter()
            .enumerate()
            .try_fold(archive.root(), |dir, (depth, part)| {
                if let Some(sub) = archive.find_dir(dir, part) {
                    return ControlFlow::Continue(sub);
                }
                ControlFlow::Break(match archive.find_file(dir, part) {
                    Some(id) => Landing::Container { id, depth },
                    None => Landing::Absent,
                })
            });
        let dir = match walked {
            ControlFlow::Continue(dir) => dir,
            ControlFlow::Break(Landing::Absent) => {
                return if deleting {
                    Ok(())
                } else {
                    Err(self.staged_failed())
                }
            }
            ControlFlow::Break(Landing::Container { id, depth }) => {
                if archive.entry(id).name != parents[depth] {
                    return Err(self.not_lowercase());
                }
                return match archive.open_nested_shared(id) {
                    Ok(inner) => self.verify_in(&inner, &parts[depth + 1..]),
                    Err(_) => Err(self.staged_failed()),
                };
            }
        };

        let id = match (archive.find_file(dir, leaf), deleting) {
            (None, true) => return Ok(()),
            (Some(id), false) => id,
            _ => return Err(self.staged_failed()),
        };
        if archive.entry(id).name != *leaf {
            return Err(self.not_lowercase());
        }
        self.check_payload(archive, id, leaf)
    }

    /// Содержимое найденной записи против источника: отпечаток, затем байты.
    fn check_payload(&self, archive: &Archive, id: usize, leaf: &str) -> Result<()> {
        let source = self.op.source.as_deref().unwrap_or(Path::new(""));
        let mismatch = || invalid(format!("Payload checksum mismatch: {}", self.shown));
        // Вложенный архив пишется заново из дерева: его байты с файлом не совпадут,
        // сверяется только отпечаток самого файла-источника.
        if names_container(leaf) {
            if let Some(expected) = &self.op.sha256 {
                if !sha256_file(source)?.eq_ignore_ascii_case(expected) {
                    return Err(mismatch());
                }
            }
            return Ok(());
        }
        // Источник читается один раз: по тем же байтам считается и отпечаток, и
        // идёт сверка с записанным (раньше его читали дважды подряд).
        let wanted = fs::read(source)?;
        tally::add_read(wanted.len() as u64);
        if let Some(expected) = &self.op.sha256 {
            if !super::sha256_hex(&wanted).eq_ignore_ascii_case(expected) {
                return Err(mismatch());
            }
        }
        let same = if let EntryKind::Resource(_) = archive.entry(id).kind {
            resource_matches(archive, id, &wanted)?
        } else {
            archive.decode(id, EntryCipher::AlwaysNg)? == wanted
        };
        if same {
            return Ok(());
        }
        Err(invalid(format!(
            "Patch verification failed (content differs): {}",
            self.shown
        )))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use rage_rpf::describe::describe;
    use rage_rpf::fixtures::{noise, replacement_tree, resource, text};
    use rage_rpf::{write_archive, RpfError};
    use std::ffi::{OsStr, OsString};
    use std::sync::MutexGuard;
    use tempfile::{tempdir, TempDir};

    // ----- общий стенд (его берёт и composed_install) -----

    pub(crate) fn quiet_keys() -> Arc<KeySet> {
        Arc::new(
            KeySet::from_parts(
                &[0; 32],
                &vec![0u8; 101 * 68 * 4],
                &vec![0u8; 17 * 4096 * 4],
                &[0; 256],
            )
            .unwrap(),
        )
    }

    pub(crate) fn write_tree(tree: &DirNode, path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        let mut context = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
    }

    fn bin(name: &str, bytes: Vec<u8>, compress: Compress) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Binary {
                data: Data::memory(bytes),
                compress,
            },
        }
    }

    fn ytd(name: &str, body: usize, seed: u64) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Resource {
                data: Data::memory(resource(0x6000_0001, 0x9000_0002, &noise(body, seed))),
            },
        }
    }

    fn dir(name: &str, dirs: Vec<DirNode>, files: Vec<FileNode>) -> DirNode {
        let mut node = DirNode::new(name);
        node.dirs = dirs;
        node.files = files;
        node
    }

    fn pack(name: &str, tree: DirNode) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Nested(Box::new(tree)),
        }
    }

    fn packed(name: &str, text_len: usize, inner: &str) -> FileNode {
        pack(
            name,
            dir(
                "",
                vec![],
                vec![bin(inner, text(text_len, inner), Compress::Always)],
            ),
        )
    }

    /// Основа `b1`: корневые файлы, каталоги с разным регистром, ресурс и
    /// вложенные архивы (слой Astral и чужой каталог).
    pub(crate) fn tree_b1() -> DirNode {
        use Compress::{Always, Store};
        let astral = vec![
            pack(
                "c.rpf",
                dir(
                    "",
                    vec![],
                    vec![
                        bin("one.ydd", text(3000, "one"), Always),
                        bin("two.ydd", text(900, "two"), Always),
                    ],
                ),
            ),
            packed("d.rpf", 200, "solo.ydd"),
            pack(
                "deep.rpf",
                dir(
                    "",
                    vec![dir(
                        "dir1",
                        vec![],
                        vec![bin("leaf.txt", text(90, "leaf"), Always)],
                    )],
                    vec![],
                ),
            ),
            packed("keep.rpf", 150, "keep.txt"),
        ];
        dir(
            "",
            vec![
                dir(
                    "Models",
                    vec![],
                    vec![bin("Hero.YDD", text(800, "hero"), Always)],
                ),
                dir(
                    "x64",
                    vec![
                        dir(
                            "a",
                            vec![],
                            vec![
                                bin("a.ydd", text(2500, "a"), Always),
                                bin("raw.bin", text(900, "raw"), Store),
                                ytd("res.ytd", 300, 4),
                            ],
                        ),
                        dir("astral", vec![], astral),
                        dir("other", vec![], vec![packed("e.rpf", 100, "only.txt")]),
                    ],
                    vec![],
                ),
            ],
            vec![bin("b.txt", text(700, "b"), Store)],
        )
    }

    /// Основа `b2`: две записи, различающиеся только регистром.
    fn tree_b2() -> DirNode {
        dir(
            "",
            vec![],
            vec![
                bin("DUP.txt", text(110, "DUP"), Compress::Always),
                bin("dup.txt", text(100, "dup"), Compress::Always),
                bin("ok.txt", text(120, "ok"), Compress::Always),
            ],
        )
    }

    /// Основа `b3`: битый `bad.rpf`, ресурс с именем `res.rpf`, исправный `good.rpf`.
    fn tree_b3() -> DirNode {
        let mut resource_named_rpf = ytd("res.rpf", 100, 8);
        resource_named_rpf.name = "res.rpf".to_owned();
        dir(
            "",
            vec![],
            vec![
                bin("bad.rpf", noise(2000, 2), Compress::Store),
                packed("good.rpf", 60, "x.txt"),
                resource_named_rpf,
            ],
        )
    }

    /// Основа `b4`: `pack.rpf` хранится сжатым. Писатель кладёт записи `.rpf`
    /// как есть, поэтому запись пишется под другим именем того же размера,
    /// а имя в оглавлении потом правится в файле.
    fn write_b4(path: &Path) {
        let tree = dir(
            "",
            vec![],
            vec![bin("pack.xyz", text(3000, "pack"), Compress::Always)],
        );
        write_tree(&tree, path);
        let mut bytes = fs::read(path).unwrap();
        let at = bytes
            .windows(8)
            .position(|window| window == b"pack.xyz")
            .expect("имя записи в оглавлении");
        bytes[at..at + 8].copy_from_slice(b"pack.rpf");
        fs::write(path, bytes).unwrap();
    }

    /// Файлы-источники операций и четыре основы в папке стенда.
    pub(crate) struct Lab {
        pub(crate) dir: TempDir,
        pub(crate) src: PathBuf,
    }

    impl Lab {
        pub(crate) fn new() -> Lab {
            let dir = tempdir().unwrap();
            let src = dir.path().join("src");
            fs::create_dir_all(&src).unwrap();
            let nested2 = dir_nested2();
            let sources: Vec<(&str, Vec<u8>)> = vec![
                ("new.ydd", text(1234, "new")),
                ("new2.ydd", text(321, "new2")),
                ("small.txt", text(50, "small")),
                ("model.ydd", text(4000, "model")),
                (
                    "res1.ytd",
                    resource(0x6000_0001, 0x9000_0002, &noise(400, 6)),
                ),
                (
                    "res2.ytd",
                    resource(0x6000_0001, 0x9000_0002, &noise(250, 7)),
                ),
                ("bank.awc", noise(4000, 13)),
                ("empty.bin", Vec::new()),
                ("rsc4.bin", b"RSC7".to_vec()),
                ("bad.rpf", noise(1500, 17)),
            ];
            for (name, bytes) in sources {
                fs::write(src.join(name), bytes).unwrap();
            }
            write_tree(&replacement_tree(), &src.join("nested.rpf"));
            write_tree(&nested2, &src.join("nested2.rpf"));
            let bases = dir.path().join("bases");
            for (name, tree) in [("b1", tree_b1()), ("b2", tree_b2()), ("b3", tree_b3())] {
                write_tree(&tree, &bases.join(format!("{name}.rpf")));
            }
            write_b4(&bases.join("b4.rpf"));
            Lab { dir, src }
        }

        pub(crate) fn base(&self, name: &str) -> PathBuf {
            self.dir.path().join("bases").join(format!("{name}.rpf"))
        }

        pub(crate) fn source(&self, name: &str) -> PathBuf {
            self.src.join(name)
        }

        pub(crate) fn out(&self, label: &str) -> PathBuf {
            self.dir.path().join("out").join(label).join("mod.rpf")
        }
    }

    fn dir_nested2() -> DirNode {
        dir(
            "",
            vec![dir(
                "sub",
                vec![],
                vec![bin("q.txt", text(120, "q"), Compress::Always)],
            )],
            vec![bin("top.txt", text(80, "top"), Compress::Always)],
        )
    }

    /// Источник операции в тесте.
    #[derive(Clone)]
    pub(crate) enum Src {
        Missing,
        Named(&'static str),
        Raw(PathBuf),
    }

    #[derive(Clone)]
    pub(crate) struct Op {
        pub(crate) action: Action,
        pub(crate) entry: String,
        pub(crate) source: Src,
        pub(crate) allow_delete: bool,
        pub(crate) allow_missing: bool,
        pub(crate) sha256: Option<String>,
    }

    fn op(action: Action, entry: &str, source: Src) -> Op {
        Op {
            action,
            entry: entry.to_owned(),
            source,
            allow_delete: false,
            allow_missing: false,
            sha256: None,
        }
    }

    pub(crate) fn replace(entry: &str, source: &'static str) -> Op {
        op(Action::Replace, entry, Src::Named(source))
    }

    pub(crate) fn import(entry: &str, source: &'static str) -> Op {
        op(Action::Import, entry, Src::Named(source))
    }

    pub(crate) fn upsert(entry: &str, source: &'static str) -> Op {
        op(Action::Upsert, entry, Src::Named(source))
    }

    /// Удаление с разрешением операции.
    pub(crate) fn delete(entry: &str) -> Op {
        let mut deletion = op(Action::Delete, entry, Src::Missing);
        deletion.allow_delete = true;
        deletion
    }

    impl Op {
        fn denied(mut self) -> Op {
            self.allow_delete = false;
            self
        }

        fn missing_ok(mut self) -> Op {
            self.allow_missing = true;
            self
        }

        fn sha(mut self, digest: &str) -> Op {
            self.sha256 = Some(digest.to_owned());
            self
        }

        fn from(mut self, source: Src) -> Op {
            self.source = source;
            self
        }
    }

    impl Lab {
        pub(crate) fn operation(&self, wanted: &Op) -> Operation {
            Operation {
                entry: wanted.entry.clone(),
                source: match &wanted.source {
                    Src::Missing => None,
                    Src::Named(name) => Some(self.source(name)),
                    Src::Raw(path) => Some(path.clone()),
                },
                sha256: wanted.sha256.clone(),
                action: wanted.action,
                allow_delete: wanted.allow_delete,
                allow_missing: wanted.allow_missing,
            }
        }

        pub(crate) fn request(&self, base: Option<&str>, ops: &[Op], out: &Path) -> Request {
            Request {
                staging: None,
                mode: Mode::Compose,
                base: base.map(|name| self.base(name)),
                output: out.to_path_buf(),
                archive_target: "update:/x64/astral/mod.rpf".to_owned(),
                edition: Some("Legacy".to_owned()),
                allow_deletes: true,
                operations: ops.iter().map(|wanted| self.operation(wanted)).collect(),
                install: None,
            }
        }
    }

    /// Ход, собранный в список строк.
    pub(crate) fn recorded() -> (Progress, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);
        let progress = Progress::with_sink(move |line| sink.lock().unwrap().push(line.to_owned()));
        (progress, lines)
    }

    pub(crate) fn phase_of(line: &str) -> String {
        let value: Value = serde_json::from_str(line).unwrap();
        value["progress"]["phase"].as_str().unwrap().to_owned()
    }

    // ----- сравнение деревьев архивов -----

    /// Строки описания с полными путями: `путь  вид…`, у каталогов `путь/`.
    fn with_paths(lines: &[String]) -> Vec<String> {
        let mut stack: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for line in lines {
            let body = line.trim_start();
            let depth = (line.len() - body.len()) / 2;
            stack.truncate(depth);
            let joined = |name: &str| {
                stack
                    .iter()
                    .map(String::as_str)
                    .chain([name])
                    .collect::<Vec<_>>()
                    .join("/")
            };
            if let Some(name) = body.strip_suffix('/') {
                out.push(format!("{}/", joined(name)));
                stack.push(name.to_owned());
            } else {
                let (name, rest) = body.split_once("  ").unwrap_or((body, ""));
                out.push(format!("{}  {rest}", joined(name)));
                if rest.starts_with("archive") {
                    stack.push(name.to_owned());
                }
            }
        }
        out
    }

    fn masked(line: &str) -> String {
        match line.find("sha=") {
            Some(at) => format!("{}sha=*", &line[..at]),
            None => line.to_owned(),
        }
    }

    pub(crate) fn tree_lines(path: &Path) -> Vec<String> {
        let archive = Archive::open_path(path, None).unwrap();
        with_paths(&describe(&archive))
            .iter()
            .map(|line| masked(line))
            .collect()
    }

    /// Что исчезло (`-`) и что появилось (`+`), по порядку путей.
    fn difference(before: &[String], after: &[String]) -> Vec<String> {
        let missing_from = |left: &[String], right: &[String]| {
            let mut rest = right.to_vec();
            left.iter()
                .filter(|line| match rest.iter().position(|other| other == *line) {
                    Some(at) => {
                        rest.remove(at);
                        false
                    }
                    None => true,
                })
                .cloned()
                .collect::<Vec<_>>()
        };
        let mut changes: Vec<(String, u8, String)> = Vec::new();
        for (sign, order, lines) in [
            ('-', 0u8, missing_from(before, after)),
            ('+', 1u8, missing_from(after, before)),
        ] {
            for line in lines {
                let path = line.split("  ").next().unwrap_or_default().to_owned();
                changes.push((path, order, format!("{sign} {line}")));
            }
        }
        changes.sort();
        changes.into_iter().map(|(_, _, line)| line).collect()
    }

    // ----- строки ожидаемых различий (отпечатки затёрты) -----

    fn b(path: &str, cmp: u8, unc: u32) -> String {
        format!("{path}  bin cmp={cmp} enc=0 unc={unc} sha=*")
    }

    fn r(path: &str, stored: u32) -> String {
        format!("{path}  res sys=0x60000001 gfx=0x90000002 stored={stored} sha=*")
    }

    fn a(path: &str, entries: u32) -> String {
        format!("{path}  archive entries={entries}")
    }

    fn d(path: &str) -> String {
        format!("{path}/")
    }

    fn m(line: String) -> String {
        format!("- {line}")
    }

    fn p(line: String) -> String {
        format!("+ {line}")
    }

    pub(crate) enum Expect {
        Done {
            entries: Vec<String>,
            diff: Vec<String>,
        },
        Failed {
            code: String,
            message: String,
        },
    }

    fn done(entries: &[&str], diff: Vec<String>) -> Expect {
        Expect::Done {
            entries: entries.iter().map(|entry| (*entry).to_owned()).collect(),
            diff,
        }
    }

    fn failed(code: &str, message: &str) -> Expect {
        Expect::Failed {
            code: code.to_owned(),
            message: message.to_owned(),
        }
    }

    fn no_workshop_left(out: &Path) {
        if let Ok(entries) = fs::read_dir(out.parent().unwrap()) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                assert!(
                    !name.starts_with(".astral-compose-"),
                    "осталась служебная папка {name}"
                );
            }
        }
    }

    impl Lab {
        pub(crate) fn run(&self, request: &Request) -> (Result<Value>, Vec<String>) {
            let (progress, lines) = recorded();
            let outcome = compose_with(request, &quiet_keys(), None, &progress);
            let seen = lines.lock().unwrap().clone();
            (outcome, seen)
        }

        /// Один случай: запрос, ответ и различия деревьев либо отказ. Возвращает выход.
        fn case_with(
            &self,
            label: &str,
            base: Option<&str>,
            ops: Vec<Op>,
            tweak: impl FnOnce(&mut Request),
            expect: Expect,
        ) -> PathBuf {
            let out = self.out(label);
            let mut request = self.request(base, &ops, &out);
            tweak(&mut request);
            let (outcome, _) = self.run(&request);
            match (outcome, expect) {
                (Ok(answer), Expect::Done { entries, diff }) => {
                    assert_eq!(answer["status"], "ready", "{label}");
                    assert_eq!(answer["operations"], entries.len(), "{label}");
                    assert_eq!(answer["entries"], json!(entries), "{label}");
                    assert_eq!(answer["archive"], json!(request.archive_target), "{label}");
                    assert_eq!(
                        answer["bytes"],
                        fs::metadata(&out).unwrap().len(),
                        "{label}"
                    );
                    assert_eq!(
                        answer["sha256"],
                        json!(sha256_file(&out).unwrap()),
                        "{label}"
                    );
                    assert_eq!(
                        answer["archiveFix"],
                        json!({ "executableSha256": "", "sequence": [] }),
                        "{label}"
                    );
                    let timings = answer["timings"].as_object().unwrap();
                    let keys: Vec<&String> = timings.keys().collect();
                    // прежние ключи первыми и в том же порядке, потом новые фазы и байты
                    assert_eq!(
                        keys,
                        [
                            "prepare",
                            "apply",
                            "write",
                            "validate",
                            "hash",
                            "archiveFix",
                            "archiveFixRuns",
                            "hashWait",
                            "hashStreamed",
                            "tocParses",
                            "readSources",
                            "buildToc",
                            "deflate",
                            "writeBodies",
                            "nested",
                            "flush",
                            "lockWait",
                            "nestedDirect",
                            "nestedStaged",
                            "readBytes",
                            "writtenBytes"
                        ],
                        "{label}"
                    );
                    let before = base
                        .map(|name| tree_lines(&self.base(name)))
                        .unwrap_or_default();
                    assert_eq!(difference(&before, &tree_lines(&out)), diff, "{label}");
                    no_workshop_left(&out);
                }
                (Err(error), Expect::Failed { code, message }) => {
                    assert_eq!((error.code, error.message), (code, message), "{label}");
                    assert!(!out.exists(), "{label}: выход не должен появиться");
                    no_workshop_left(&out);
                }
                (Ok(answer), Expect::Failed { code, message }) => {
                    panic!("{label}: ждали отказ {code}: {message}, а вышло {answer}")
                }
                (Err(error), Expect::Done { .. }) => panic!("{label}: отказ {error}"),
            }
            out
        }

        fn case(&self, label: &str, base: Option<&str>, ops: Vec<Op>, expect: Expect) -> PathBuf {
            self.case_with(label, base, ops, |_| {}, expect)
        }
    }

    // ----- путь записи (Н1-Н67) -----

    fn parts(items: &[&str]) -> Result<Vec<String>> {
        Ok(items.iter().map(|item| (*item).to_owned()).collect())
    }

    fn path_err(message: &str) -> Result<Vec<String>> {
        Err(EngineError::invalid_data(message))
    }

    const INVALID: &str = "Invalid RPF entry path.";
    const UNSAFE: &str = "Unsafe RPF entry path.";
    const NOT_A_FILE: &str = "RPF entry must point to a file inside the archive.";

    #[test]
    fn entry_paths_are_lowercased_split_and_checked() {
        let table: Vec<(String, bool, Result<Vec<String>>)> = vec![
            ("x64/a/a.ydd".into(), false, parts(&["x64", "a", "a.ydd"])),
            ("x64/a/a.ydd".into(), true, parts(&["x64", "a", "a.ydd"])),
            (
                "X64\\Astral/Dlc.RPF/Data.ydd".into(),
                true,
                parts(&["x64", "astral", "dlc.rpf", "data.ydd"]),
            ),
            (
                "X64\\Astral/Dlc.RPF/Data.ydd".into(),
                false,
                parts(&["x64", "astral", "dlc.rpf", "data.ydd"]),
            ),
            ("x64/a/b.RPF".into(), false, path_err(NOT_A_FILE)),
            ("x64/a/b.RPF".into(), true, parts(&["x64", "a", "b.rpf"])),
            ("b.rpf".into(), true, parts(&["b.rpf"])),
            (".rpf".into(), false, path_err(NOT_A_FILE)),
            (".rpf".into(), true, parts(&[".rpf"])),
            ("a.rpf.rpf".into(), true, parts(&["a.rpf.rpf"])),
            ("a.rpf/b.rpf".into(), false, path_err(NOT_A_FILE)),
            ("a.rpf/b.rpf".into(), true, parts(&["a.rpf", "b.rpf"])),
            ("x.rpf/".into(), true, path_err(UNSAFE)),
            ("x.rpf ".into(), true, parts(&["x.rpf"])),
            ("rpf".into(), false, parts(&["rpf"])),
            ("  x64/a.ydd  ".into(), true, parts(&["x64", "a.ydd"])),
            ("\tx64/a.ydd\r\n".into(), true, parts(&["x64", "a.ydd"])),
            (
                "\u{a0}x64/a.ydd\u{a0}".into(),
                true,
                parts(&["x64", "a.ydd"]),
            ),
            (
                "\u{3000}x64/a.ydd\u{3000}".into(),
                true,
                parts(&["x64", "a.ydd"]),
            ),
            ("x64/ a.ydd".into(), true, parts(&["x64", " a.ydd"])),
            ("x64/a .ydd".into(), true, parts(&["x64", "a .ydd"])),
            (String::new(), true, path_err(INVALID)),
            ("   ".into(), true, path_err(INVALID)),
            ("/".into(), true, path_err(INVALID)),
            ("/x".into(), true, path_err(INVALID)),
            ("\\x".into(), true, path_err(INVALID)),
            (" /x".into(), true, path_err(INVALID)),
            ("x/".into(), true, path_err(UNSAFE)),
            ("x\\".into(), true, path_err(UNSAFE)),
            ("x//y".into(), true, path_err(UNSAFE)),
            ("x\\\\y".into(), true, path_err(UNSAFE)),
            ("./x".into(), true, path_err(UNSAFE)),
            ("x/./y".into(), true, path_err(UNSAFE)),
            ("../x".into(), true, path_err(UNSAFE)),
            ("x/..".into(), true, path_err(UNSAFE)),
            ("x/../y".into(), true, path_err(UNSAFE)),
            ("x/..y".into(), true, parts(&["x", "..y"])),
            ("x/.y".into(), true, parts(&["x", ".y"])),
            ("x/y.".into(), true, parts(&["x", "y."])),
            ("x/a:b".into(), true, path_err(UNSAFE)),
            ("c:/x".into(), true, path_err(UNSAFE)),
            ("C:x".into(), true, path_err(UNSAFE)),
            (":".into(), true, path_err(UNSAFE)),
            ("x/a\0b".into(), true, path_err(UNSAFE)),
            ("x/\u{1}".into(), true, parts(&["x", "\u{1}"])),
            ("x/*?<>|\"".into(), true, parts(&["x", "*?<>|\""])),
            ("x/con".into(), true, parts(&["x", "con"])),
            (
                "x/a b/c d.ydd".into(),
                true,
                parts(&["x", "a b", "c d.ydd"]),
            ),
            ("X64/ÄÖ.YDD".into(), true, parts(&["x64", "äö.ydd"])),
            ("Ж/я.ydd".into(), true, parts(&["ж", "я.ydd"])),
            ("İ.ydd".into(), true, parts(&["i\u{307}.ydd"])),
            ("ΑΣ.ydd".into(), true, parts(&["ασ.ydd"])),
            ("ΑΣ Σ.ydd".into(), true, parts(&["ας σ.ydd"])),
            ("ß.ydd".into(), true, parts(&["ß.ydd"])),
            ("ǅ.ydd".into(), true, parts(&["ǆ.ydd"])),
            ("a".repeat(1000), true, parts(&[&"a".repeat(1000)])),
            ("a".repeat(1001), true, path_err(INVALID)),
            ("я".repeat(500), true, parts(&[&"я".repeat(500)])),
            ("я".repeat(501), true, path_err(INVALID)),
            ("İ".repeat(400), true, path_err(INVALID)),
            (
                format!("  {}  ", "a".repeat(1000)),
                true,
                parts(&[&"a".repeat(1000)]),
            ),
            ("/x.rpf".into(), false, path_err(INVALID)),
            ("a//b.rpf".into(), false, path_err(UNSAFE)),
            ("a/../b.rpf".into(), false, path_err(UNSAFE)),
            ("a:/b.rpf".into(), false, path_err(UNSAFE)),
            ("..\\x.rpf".into(), true, path_err(UNSAFE)),
            ("x64/../x.ydd".into(), false, path_err(UNSAFE)),
        ];
        assert_eq!(table.len(), 67);
        for (input, container_ok, expected) in table {
            let shown: String = input.chars().take(40).collect();
            assert_eq!(
                normalize_entry(&input, container_ok),
                expected,
                "{shown:?}, контейнер {container_ok}"
            );
        }
    }

    // ----- виды операций (Д1-Д16) -----

    #[test]
    fn action_words_are_trimmed_and_lowercased_in_ascii_only() {
        let word = |text: &str, action: Action| (Some(text.to_owned()), Ok(action));
        let bad = |text: &str, shown: &str| {
            (
                Some(text.to_owned()),
                Err(EngineError::invalid_data(format!(
                    "Unsupported RPF action: {shown}"
                ))),
            )
        };
        let table = vec![
            (None, Ok(Action::Replace)),
            word("replace", Action::Replace),
            word("import", Action::Import),
            word("upsert", Action::Upsert),
            word("delete", Action::Delete),
            word("Replace", Action::Replace),
            word(" UPSERT ", Action::Upsert),
            word("\tDelete\n", Action::Delete),
            bad("", ""),
            bad("   ", ""),
            bad("move", "move"),
            bad("replace2", "replace2"),
            bad("İmport", "İmport"),
            bad("ＲＥＰＬＡＣＥ", "ＲＥＰＬＡＣＥ"),
            word("\u{a0}replace\u{a0}", Action::Replace),
            bad("REPLACE\0", "replace\0"),
        ];
        for (input, expected) in table {
            assert_eq!(Action::parse(input.as_deref()), expected, "{input:?}");
        }
    }

    // ----- замена, добавление, upsert (К1-К22, К86-К89) -----

    #[test]
    fn replace_changes_one_entry_and_the_build_is_reproducible() {
        let lab = Lab::new();
        // К1
        let first = lab.case(
            "k1",
            Some("b1"),
            vec![replace("x64/a/a.ydd", "new.ydd")],
            done(
                &["x64/a/a.ydd"],
                vec![m(b("x64/a/a.ydd", 1, 2500)), p(b("x64/a/a.ydd", 1, 1234))],
            ),
        );
        // К2: те же входы дают те же байты
        let second = lab.case(
            "k2",
            Some("b1"),
            vec![replace("x64/a/a.ydd", "new.ydd")],
            done(
                &["x64/a/a.ydd"],
                vec![m(b("x64/a/a.ydd", 1, 2500)), p(b("x64/a/a.ydd", 1, 1234))],
            ),
        );
        assert_eq!(fs::read(first).unwrap(), fs::read(second).unwrap());
        // К3: сжатость задаёт имя, а не прежняя запись
        lab.case(
            "k3",
            Some("b1"),
            vec![replace("x64/a/raw.bin", "model.ydd")],
            done(
                &["x64/a/raw.bin"],
                vec![
                    m(b("x64/a/raw.bin", 0, 900)),
                    p(b("x64/a/raw.bin", 1, 4000)),
                ],
            ),
        );
        // К4: пустой файл тоже сжимается
        lab.case(
            "k4",
            Some("b1"),
            vec![replace("x64/a/a.ydd", "empty.bin")],
            done(
                &["x64/a/a.ydd"],
                vec![m(b("x64/a/a.ydd", 1, 2500)), p(b("x64/a/a.ydd", 1, 0))],
            ),
        );
        // К5: ресурс остаётся ресурсом
        lab.case(
            "k5",
            Some("b1"),
            vec![replace("x64/a/res.ytd", "res2.ytd")],
            done(
                &["x64/a/res.ytd"],
                vec![m(r("x64/a/res.ytd", 316)), p(r("x64/a/res.ytd", 266))],
            ),
        );
        // К6
        lab.case(
            "k6",
            Some("b1"),
            vec![replace("x64/a/res.ytd", "model.ydd")],
            failed(
                "InvalidDataException",
                "res.ytd: this is not a resource file (RSC7).",
            ),
        );
        // К7: двоичная запись остаётся двоичной, даже если источник — ресурс
        lab.case(
            "k7",
            Some("b1"),
            vec![replace("x64/a/a.ydd", "res1.ytd")],
            done(
                &["x64/a/a.ydd"],
                vec![m(b("x64/a/a.ydd", 1, 2500)), p(b("x64/a/a.ydd", 1, 416))],
            ),
        );
        // К8, К9
        lab.case(
            "k8",
            Some("b1"),
            vec![replace("x64/a/none.ydd", "new.ydd")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/a/none.ydd: RPF entry not found: x64/a/none.ydd",
            ),
        );
        lab.case(
            "k9",
            Some("b1"),
            vec![replace("x64/zzz/none.ydd", "new.ydd")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/zzz/none.ydd: RPF directory not found: zzz",
            ),
        );
        // К10: каталог и файл получают нижний регистр
        lab.case(
            "k10",
            Some("b1"),
            vec![replace("MODELS\\hero.ydd", "new.ydd")],
            done(
                &["MODELS/hero.ydd"],
                vec![
                    m(d("Models")),
                    m(b("Models/Hero.YDD", 1, 800)),
                    p(d("models")),
                    p(b("models/hero.ydd", 1, 1234)),
                ],
            ),
        );
    }

    #[test]
    fn import_and_upsert_add_entries_and_directories() {
        let lab = Lab::new();
        // К11-К14
        lab.case(
            "k11",
            Some("b1"),
            vec![import("x64/a/model.ydd", "model.ydd")],
            done(&["x64/a/model.ydd"], vec![p(b("x64/a/model.ydd", 1, 4000))]),
        );
        lab.case(
            "k12",
            Some("b1"),
            vec![import("x64/a/new.ytd", "res1.ytd")],
            done(&["x64/a/new.ytd"], vec![p(r("x64/a/new.ytd", 416))]),
        );
        lab.case(
            "k13",
            Some("b1"),
            vec![import("x64/a/bank.awc", "bank.awc")],
            done(&["x64/a/bank.awc"], vec![p(b("x64/a/bank.awc", 0, 4000))]),
        );
        lab.case(
            "k14",
            Some("b1"),
            vec![import("x64/a/empty.bin", "empty.bin")],
            done(&["x64/a/empty.bin"], vec![p(b("x64/a/empty.bin", 1, 0))]),
        );
        // К15
        lab.case(
            "k15",
            Some("b1"),
            vec![import("x64/a/magic.bin", "rsc4.bin")],
            failed(
                "InvalidDataException",
                "magic.bin: the resource is shorter than its header.",
            ),
        );
        // К16, К17
        lab.case(
            "k16",
            Some("b1"),
            vec![import("b.txt", "new.ydd")],
            failed(
                "InvalidDataException",
                "RPF operation failed at b.txt: RPF import target already exists: b.txt",
            ),
        );
        lab.case(
            "k17",
            Some("b1"),
            vec![import("X64/A/A.YDD", "new.ydd")],
            failed(
                "InvalidDataException",
                "RPF operation failed at X64/A/A.YDD: RPF import target already exists: x64/a/a.ydd",
            ),
        );
        // К18-К22
        lab.case(
            "k18",
            Some("b1"),
            vec![upsert("x64/new/dir/fresh.ydd", "small.txt")],
            done(
                &["x64/new/dir/fresh.ydd"],
                vec![
                    p(d("x64/new")),
                    p(d("x64/new/dir")),
                    p(b("x64/new/dir/fresh.ydd", 1, 50)),
                ],
            ),
        );
        lab.case(
            "k19",
            Some("b1"),
            vec![upsert("b.txt", "small.txt")],
            done(
                &["b.txt"],
                vec![m(b("b.txt", 0, 700)), p(b("b.txt", 1, 50))],
            ),
        );
        lab.case(
            "k20",
            Some("b1"),
            vec![upsert("x64/a/res.ytd", "small.txt")],
            failed(
                "InvalidDataException",
                "res.ytd: this is not a resource file (RSC7).",
            ),
        );
        lab.case(
            "k21",
            Some("b1"),
            vec![upsert("x64/a", "small.txt")],
            done(&["x64/a"], vec![p(b("x64/a", 1, 50))]),
        );
        lab.case(
            "k22",
            Some("b1"),
            vec![import("b.txt/inside.txt", "small.txt")],
            failed(
                "InvalidDataException",
                "RPF operation failed at b.txt/inside.txt: b.txt is a file, but a directory is needed here.",
            ),
        );
    }

    #[test]
    fn entries_are_handled_in_raw_order_and_reported_as_given() {
        let lab = Lab::new();
        // К86: «x640.ydd» раньше «x64\b.ydd» (обратная косая тяжелее нуля)
        lab.case(
            "k86",
            Some("b1"),
            vec![
                replace("x64\\b.ydd", "small.txt"),
                replace("x640.ydd", "small.txt"),
            ],
            failed(
                "InvalidDataException",
                "RPF operation failed at x640.ydd: RPF entry not found: x640.ydd",
            ),
        );
        // К87: в ответе прямые косые и порядок по нижнему регистру
        lab.case(
            "k87",
            Some("b1"),
            vec![
                import("x64\\Zed.ydd", "small.txt"),
                import("X64/a/Alpha.ydd", "small.txt"),
                import("x640.ydd", "small.txt"),
            ],
            done(
                &["X64/a/Alpha.ydd", "x64/Zed.ydd", "x640.ydd"],
                vec![
                    p(b("x64/a/alpha.ydd", 1, 50)),
                    p(b("x64/zed.ydd", 1, 50)),
                    p(b("x640.ydd", 1, 50)),
                ],
            ),
        );
        // К88: пробелы по краям остаются в ответе
        lab.case(
            "k88",
            Some("b1"),
            vec![import(" x64\\a\\q.txt ", "small.txt")],
            done(&[" x64/a/q.txt "], vec![p(b("x64/a/q.txt", 1, 50))]),
        );
        // К89
        lab.case(
            "k89",
            Some("b1"),
            vec![replace("X64\\A\\None.ydd", "small.txt")],
            failed(
                "InvalidDataException",
                "RPF operation failed at X64/A/None.ydd: RPF entry not found: x64/a/none.ydd",
            ),
        );
    }

    // ----- удаление (К23-К33, К105-К107) -----

    #[test]
    fn deleting_needs_both_permissions_and_allow_missing_skips_absent_entries() {
        let lab = Lab::new();
        let base_sha = sha256_file(&lab.base("b1")).unwrap();
        // К23: нет права в запросе
        lab.case_with(
            "k23",
            Some("b1"),
            vec![delete("b.txt")],
            |request| request.allow_deletes = false,
            failed(
                "InvalidDataException",
                "RPF delete is not authorized: b.txt",
            ),
        );
        // К24: нет права у операции
        lab.case(
            "k24",
            Some("b1"),
            vec![delete("b.txt").denied()],
            failed(
                "InvalidDataException",
                "RPF delete is not authorized: b.txt",
            ),
        );
        // К25, К28, К32, К33
        let gone = || done(&["b.txt"], vec![m(b("b.txt", 0, 700))]);
        let plain = lab.case("k25", Some("b1"), vec![delete("b.txt")], gone());
        lab.case(
            "k28",
            Some("b1"),
            vec![delete("b.txt").missing_ok()],
            gone(),
        );
        lab.case(
            "k32",
            Some("b1"),
            vec![delete("b.txt").from(Src::Raw(PathBuf::from("relative-garbage")))],
            gone(),
        );
        let with_sha = lab.case("k33", Some("b1"), vec![delete("b.txt").sha("00")], gone());
        assert_eq!(fs::read(&plain).unwrap(), fs::read(&with_sha).unwrap());
        // К26, К30, К31
        lab.case(
            "k26",
            Some("b1"),
            vec![delete("x64/a/gone.ydd")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/a/gone.ydd: RPF entry not found: x64/a/gone.ydd",
            ),
        );
        lab.case(
            "k30",
            Some("b1"),
            vec![delete("x64/a")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/a: RPF entry not found: x64/a",
            ),
        );
        lab.case(
            "k31",
            Some("b1"),
            vec![delete("x64/other/e.rpf")],
            failed("InvalidDataException", NOT_A_FILE),
        );
        // К27, К29, К107: пропуск; архив собирается заново и совпадает с основой
        for (label, entry) in [
            ("k27", "x64/a/gone.ydd"),
            ("k29", "x64/zzz/gone.ydd"),
            ("k107", "zzz.txt"),
        ] {
            let out = lab.case(
                label,
                Some("b1"),
                vec![delete(entry).missing_ok()],
                done(&[entry], vec![]),
            );
            assert_eq!(sha256_file(&out).unwrap(), base_sha, "{label}");
        }
    }

    #[test]
    fn a_replaced_entry_that_is_deleted_or_a_duplicate_name_fails_validation() {
        let lab = Lab::new();
        // К105
        lab.case(
            "k105",
            Some("b1"),
            vec![replace("x64/a/a.ydd", "new.ydd"), delete("x64/a/a.ydd")],
            failed(
                "InvalidDataException",
                "RPF staged validation failed: x64/a/a.ydd",
            ),
        );
        // К106: удалилась одна из двух записей, различавшихся регистром
        lab.case(
            "k106",
            Some("b2"),
            vec![delete("dup.txt")],
            failed(
                "InvalidDataException",
                "RPF staged validation failed: dup.txt",
            ),
        );
        // К101-К104
        let twice = vec![
            replace("x64/a/a.ydd", "new.ydd"),
            replace("x64/a/a.ydd", "new.ydd"),
        ];
        lab.case(
            "k101",
            Some("b1"),
            twice,
            done(
                &["x64/a/a.ydd", "x64/a/a.ydd"],
                vec![m(b("x64/a/a.ydd", 1, 2500)), p(b("x64/a/a.ydd", 1, 1234))],
            ),
        );
        lab.case(
            "k102",
            Some("b1"),
            vec![
                replace("x64/a/a.ydd", "new.ydd"),
                replace("x64/a/a.ydd", "new2.ydd"),
            ],
            failed(
                "InvalidDataException",
                "Patch verification failed (content differs): x64/a/a.ydd",
            ),
        );
        lab.case(
            "k103",
            Some("b1"),
            vec![import("x64/a/q.txt", "small.txt"), import("X64/A/Q.TXT", "small.txt")],
            failed(
                "InvalidDataException",
                "RPF operation failed at X64/A/Q.TXT: RPF import target already exists: x64/a/q.txt",
            ),
        );
        lab.case(
            "k104",
            Some("b1"),
            vec![
                import("x64/a/q.txt", "small.txt"),
                replace("x64/a/q.txt", "new2.ydd"),
            ],
            failed(
                "InvalidDataException",
                "Patch verification failed (content differs): x64/a/q.txt",
            ),
        );
    }

    // ----- вложенные архивы (К34-К63) -----

    #[test]
    fn edits_inside_nested_archives() {
        let lab = Lab::new();
        let c = "x64/astral/c.rpf";
        // К34
        lab.case(
            "k34",
            Some("b1"),
            vec![replace("x64/astral/c.rpf/two.ydd", "new2.ydd")],
            done(
                &["x64/astral/c.rpf/two.ydd"],
                vec![
                    m(b("x64/astral/c.rpf/two.ydd", 1, 900)),
                    p(b("x64/astral/c.rpf/two.ydd", 1, 321)),
                ],
            ),
        );
        // К35-К37
        lab.case(
            "k35",
            Some("b1"),
            vec![replace("x64/astral/c.rpf/none.ydd", "new2.ydd")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/astral/c.rpf/none.ydd: RPF entry not found: none.ydd",
            ),
        );
        lab.case(
            "k36",
            Some("b1"),
            vec![replace("x64/astral/c.rpf/nodir/none.ydd", "new2.ydd")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/astral/c.rpf/nodir/none.ydd: RPF directory not found: nodir",
            ),
        );
        lab.case(
            "k37",
            Some("b1"),
            vec![replace("x64/astral/nope.rpf/none.ydd", "new2.ydd")],
            failed(
                "FileNotFoundException",
                "RPF operation failed at x64/astral/nope.rpf: Nested RPF not found: nope.rpf",
            ),
        );
        // К38-К42: вложенные архивы и каталоги создаются
        lab.case(
            "k38",
            Some("b1"),
            vec![import("x64/astral/fresh.rpf/x.ydd", "small.txt")],
            done(
                &["x64/astral/fresh.rpf/x.ydd"],
                vec![
                    p(a("x64/astral/fresh.rpf", 2)),
                    p(b("x64/astral/fresh.rpf/x.ydd", 1, 50)),
                ],
            ),
        );
        lab.case(
            "k39",
            Some("b1"),
            vec![upsert(
                "x64/astral/outer.rpf/inner.rpf/deep/x.txt",
                "small.txt",
            )],
            done(
                &["x64/astral/outer.rpf/inner.rpf/deep/x.txt"],
                vec![
                    p(a("x64/astral/outer.rpf", 2)),
                    p(a("x64/astral/outer.rpf/inner.rpf", 3)),
                    p(d("x64/astral/outer.rpf/inner.rpf/deep")),
                    p(b("x64/astral/outer.rpf/inner.rpf/deep/x.txt", 1, 50)),
                ],
            ),
        );
        lab.case(
            "k40",
            Some("b1"),
            vec![upsert("x64/other/e.rpf/more.txt", "small.txt")],
            done(
                &["x64/other/e.rpf/more.txt"],
                vec![
                    m(a("x64/other/e.rpf", 2)),
                    p(a("x64/other/e.rpf", 3)),
                    p(b("x64/other/e.rpf/more.txt", 1, 50)),
                ],
            ),
        );
        lab.case(
            "k41",
            Some("b1"),
            vec![import("x64/freshdir/n.rpf/x.ydd", "small.txt")],
            done(
                &["x64/freshdir/n.rpf/x.ydd"],
                vec![
                    p(d("x64/freshdir")),
                    p(a("x64/freshdir/n.rpf", 2)),
                    p(b("x64/freshdir/n.rpf/x.ydd", 1, 50)),
                ],
            ),
        );
        lab.case(
            "k42",
            Some("b1"),
            vec![replace("x64/freshdir/n.rpf/x.ydd", "small.txt")],
            failed(
                "DirectoryNotFoundException",
                "RPF operation failed at x64/freshdir/n.rpf: RPF directory not found: freshdir",
            ),
        );
        // К43-К47: опустевший архив слоя Astral уходит, чужой остаётся
        lab.case(
            "k43",
            Some("b1"),
            vec![
                delete("x64/astral/c.rpf/one.ydd"),
                delete("x64/astral/c.rpf/two.ydd"),
            ],
            done(
                &["x64/astral/c.rpf/one.ydd", "x64/astral/c.rpf/two.ydd"],
                vec![
                    m(a(c, 3)),
                    m(b("x64/astral/c.rpf/one.ydd", 1, 3000)),
                    m(b("x64/astral/c.rpf/two.ydd", 1, 900)),
                ],
            ),
        );
        lab.case(
            "k44",
            Some("b1"),
            vec![delete("x64/other/e.rpf/only.txt")],
            done(
                &["x64/other/e.rpf/only.txt"],
                vec![
                    m(a("x64/other/e.rpf", 2)),
                    p(a("x64/other/e.rpf", 1)),
                    m(b("x64/other/e.rpf/only.txt", 1, 100)),
                ],
            ),
        );
        lab.case(
            "k45",
            Some("b1"),
            vec![delete("x64/astral/deep.rpf/dir1/leaf.txt")],
            done(
                &["x64/astral/deep.rpf/dir1/leaf.txt"],
                vec![
                    m(a("x64/astral/deep.rpf", 3)),
                    p(a("x64/astral/deep.rpf", 2)),
                    m(b("x64/astral/deep.rpf/dir1/leaf.txt", 1, 90)),
                ],
            ),
        );
        lab.case(
            "k46",
            Some("b1"),
            vec![
                delete("x64/astral/d.rpf/solo.ydd"),
                import("x64/astral/keep.rpf/more.txt", "small.txt"),
            ],
            done(
                &["x64/astral/d.rpf/solo.ydd", "x64/astral/keep.rpf/more.txt"],
                vec![
                    m(a("x64/astral/d.rpf", 2)),
                    m(b("x64/astral/d.rpf/solo.ydd", 1, 200)),
                    m(a("x64/astral/keep.rpf", 2)),
                    p(a("x64/astral/keep.rpf", 3)),
                    p(b("x64/astral/keep.rpf/more.txt", 1, 50)),
                ],
            ),
        );
        lab.case(
            "k47",
            Some("b1"),
            vec![
                delete("x64/astral/d.rpf/solo.ydd"),
                import("x64/astral/d.rpf/new.txt", "small.txt"),
            ],
            done(
                &["x64/astral/d.rpf/new.txt", "x64/astral/d.rpf/solo.ydd"],
                vec![
                    p(b("x64/astral/d.rpf/new.txt", 1, 50)),
                    m(b("x64/astral/d.rpf/solo.ydd", 1, 200)),
                ],
            ),
        );
    }

    #[test]
    fn whole_nested_archives_are_unpacked_and_edited_in_the_same_request() {
        let lab = Lab::new();
        // К48
        lab.case(
            "k48",
            Some("b1"),
            vec![replace("x64/other/e.rpf", "nested.rpf")],
            done(
                &["x64/other/e.rpf"],
                vec![
                    p(b("x64/other/e.rpf/new_inside.xml", 1, 333)),
                    m(b("x64/other/e.rpf/only.txt", 1, 100)),
                ],
            ),
        );
        // К49, К50, К58
        let whole = |extra: bool| {
            let mut diff = vec![
                p(a("x64/astral/whole.rpf", if extra { 5 } else { 4 })),
                p(d("x64/astral/whole.rpf/sub")),
            ];
            if extra {
                diff.push(p(b("x64/astral/whole.rpf/sub/extra.txt", 1, 50)));
            }
            diff.push(p(b("x64/astral/whole.rpf/sub/q.txt", 1, 120)));
            diff.push(p(b("x64/astral/whole.rpf/top.txt", 1, 80)));
            diff
        };
        let k49 = lab.case(
            "k49",
            Some("b1"),
            vec![import("x64/astral/whole.rpf", "nested2.rpf")],
            done(&["x64/astral/whole.rpf"], whole(false)),
        );
        lab.case(
            "k50",
            Some("b1"),
            vec![
                import("x64/astral/whole.rpf", "nested2.rpf"),
                import("x64/astral/whole.rpf/sub/extra.txt", "small.txt"),
            ],
            done(
                &["x64/astral/whole.rpf", "x64/astral/whole.rpf/sub/extra.txt"],
                whole(true),
            ),
        );
        // К58: отпечаток целого вложенного архива сверяется, как у любого файла
        let nested2 = sha256_file(&lab.source("nested2.rpf")).unwrap();
        let k58 = lab.case(
            "k58",
            Some("b1"),
            vec![import("x64/astral/whole.rpf", "nested2.rpf").sha(&nested2.to_uppercase())],
            done(&["x64/astral/whole.rpf"], whole(false)),
        );
        assert_eq!(fs::read(k49).unwrap(), fs::read(k58).unwrap());
        for (label, wrong) in [
            (
                "k58-import",
                import("x64/astral/whole.rpf", "nested2.rpf").sha("00"),
            ),
            (
                "k58-replace",
                replace("x64/other/e.rpf", "nested.rpf").sha("00"),
            ),
            (
                "k58-upsert",
                upsert("x64/astral/c.rpf", "nested.rpf").sha(&nested2),
            ),
        ] {
            let shown = wrong.entry.clone();
            lab.case(
                label,
                Some("b1"),
                vec![wrong],
                failed(
                    "InvalidDataException",
                    &format!("Payload checksum mismatch: {shown}"),
                ),
            );
        }
        // К51-К53
        lab.case(
            "k51",
            Some("b1"),
            vec![replace("x64/astral/nope.rpf", "nested.rpf")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/astral/nope.rpf: RPF entry not found: x64/astral/nope.rpf",
            ),
        );
        lab.case(
            "k52",
            Some("b1"),
            vec![upsert("x64/astral/c.rpf", "nested.rpf")],
            done(
                &["x64/astral/c.rpf"],
                vec![
                    m(a("x64/astral/c.rpf", 3)),
                    p(a("x64/astral/c.rpf", 2)),
                    p(b("x64/astral/c.rpf/new_inside.xml", 1, 333)),
                    m(b("x64/astral/c.rpf/one.ydd", 1, 3000)),
                    m(b("x64/astral/c.rpf/two.ydd", 1, 900)),
                ],
            ),
        );
        lab.case(
            "k53",
            Some("b1"),
            vec![import("x64/astral/c.rpf", "nested.rpf")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/astral/c.rpf: RPF import target already exists: x64/astral/c.rpf",
            ),
        );
        // К57: источник не архив
        let scratch = tempdir().unwrap();
        let noise_file = scratch.path().join("bad.rpf");
        fs::copy(lab.source("bad.rpf"), &noise_file).unwrap();
        let reading = Archive::open_path(&noise_file, None)
            .err()
            .unwrap()
            .to_string();
        lab.case(
            "k57",
            Some("b1"),
            vec![import("x64/astral/whole.rpf", "bad.rpf")],
            failed("InvalidDataException", &reading),
        );
    }

    #[test]
    fn allow_missing_inside_nested_archives_and_broken_containers() {
        let lab = Lab::new();
        // К54: вложенного архива нет — allowMissing не спасает
        lab.case(
            "k54",
            Some("b1"),
            vec![delete("x64/astral/nope.rpf/a.txt").missing_ok()],
            failed(
                "FileNotFoundException",
                "RPF operation failed at x64/astral/nope.rpf: Nested RPF not found: nope.rpf",
            ),
        );
        // К55, К56: пропуск внутри существующего архива; контейнер пишется заново
        let nodir = lab.case(
            "k55",
            Some("b1"),
            vec![delete("x64/astral/c.rpf/nodir/a.txt").missing_ok()],
            done(&["x64/astral/c.rpf/nodir/a.txt"], vec![]),
        );
        let nothing = lab.case(
            "k56",
            Some("b1"),
            vec![delete("x64/astral/c.rpf/none.txt").missing_ok()],
            done(&["x64/astral/c.rpf/none.txt"], vec![]),
        );
        assert_eq!(fs::read(&nodir).unwrap(), fs::read(nothing).unwrap());
        // контейнер переписан деревом, поэтому байты не равны основе
        assert_ne!(fs::read(nodir).unwrap(), fs::read(lab.base("b1")).unwrap());
        // К59: битый вложенный архив в основе, запись внутрь
        let b3 = Archive::open_path(&lab.base("b3"), None).unwrap();
        let bad = b3.find_file(b3.root(), "bad.rpf").unwrap();
        let reading = b3.open_nested(bad).err().unwrap().to_string();
        lab.case(
            "k59",
            Some("b3"),
            vec![import("bad.rpf/x.txt", "small.txt")],
            failed("InvalidDataException", &reading),
        );
        // К60: операции его не касаются
        lab.case(
            "k60",
            Some("b3"),
            vec![import("a.txt", "small.txt")],
            done(&["a.txt"], vec![p(b("a.txt", 1, 50))]),
        );
        // К61, К62
        lab.case(
            "k61",
            Some("b3"),
            vec![import("res.rpf/x.txt", "small.txt")],
            failed(
                "InvalidDataException",
                "Nested RPF is not a binary entry: res.rpf",
            ),
        );
        lab.case(
            "k62",
            Some("b4"),
            vec![import("pack.rpf/x.txt", "small.txt")],
            failed(
                "InvalidDataException",
                "Nested RPF is stored compressed or encrypted: pack.rpf",
            ),
        );
        // К63: на месте каталога файл
        lab.case(
            "k63",
            Some("b1"),
            vec![import("b.txt/x.rpf/y.txt", "small.txt")],
            failed(
                "ArgumentException",
                "RPF operation failed at b.txt/x.rpf: b.txt is a file, but a directory is needed here.",
            ),
        );
    }

    // ----- новый архив (К64-К71) -----

    #[test]
    fn create_mode_starts_from_an_empty_tree() {
        let lab = Lab::new();
        let create = |request: &mut Request| request.mode = Mode::Create;
        // К64
        lab.case_with(
            "k64",
            None,
            vec![import("x64/new/a.ydd", "small.txt")],
            create,
            done(
                &["x64/new/a.ydd"],
                vec![p(d("x64")), p(d("x64/new")), p(b("x64/new/a.ydd", 1, 50))],
            ),
        );
        // К65, К66: заменять и удалять нечего
        lab.case_with(
            "k65",
            None,
            vec![replace("a.ydd", "small.txt")],
            create,
            failed(
                "InvalidDataException",
                "RPF operation failed at a.ydd: RPF entry not found: a.ydd",
            ),
        );
        lab.case_with(
            "k66",
            None,
            vec![delete("a.ydd")],
            create,
            failed(
                "InvalidDataException",
                "RPF operation failed at a.ydd: RPF entry not found: a.ydd",
            ),
        );
        // К67
        lab.case_with(
            "k67",
            None,
            vec![
                upsert("pack.rpf/inner/x.txt", "small.txt"),
                upsert("top.txt", "small.txt"),
            ],
            create,
            done(
                &["pack.rpf/inner/x.txt", "top.txt"],
                vec![
                    p(a("pack.rpf", 3)),
                    p(d("pack.rpf/inner")),
                    p(b("pack.rpf/inner/x.txt", 1, 50)),
                    p(b("top.txt", 1, 50)),
                ],
            ),
        );
        // К68-К70: имя выхода
        let named = |file: &str, base: Option<&str>, mode: Mode| {
            let out = lab.out("k68").with_file_name(file);
            let mut request = lab.request(base, &[import("a.ydd", "small.txt")], &out);
            request.mode = mode;
            (lab.run(&request).0, out)
        };
        let (outcome, out) = named("mod.bin", None, Mode::Create);
        let error = outcome.err().unwrap();
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            (
                "InvalidDataException",
                "Created archive must use the .rpf extension."
            )
        );
        assert!(!out.exists());
        let (outcome, out) = named("mod.RPF", None, Mode::Create);
        assert!(outcome.is_ok() && out.is_file(), "К69");
        let (outcome, out) = named("mod.bin", Some("b1"), Mode::Compose);
        assert!(outcome.is_ok() && out.is_file(), "К70");
        // К71: режим create с основой
        lab.case_with(
            "k71",
            Some("b1"),
            vec![import("x64/a/z.txt", "small.txt")],
            create,
            done(&["x64/a/z.txt"], vec![p(b("x64/a/z.txt", 1, 50))]),
        );
    }

    // ----- доводчик-пустышка -----

    /// Помнит вызовы (имя, папка, размер файла) и ничего не делает с файлом.
    pub(crate) struct Spy {
        pub(crate) calls: Mutex<Vec<(String, String, u64)>>,
        refuse: Option<(&'static str, bool)>,
    }

    impl Spy {
        pub(crate) fn new() -> Spy {
            Spy {
                calls: Mutex::new(Vec::new()),
                refuse: None,
            }
        }

        /// Отказывает на имени: `true` — ошибкой формата, `false` — состояния.
        fn refusing(name: &'static str, format_error: bool) -> Spy {
            Spy {
                calls: Mutex::new(Vec::new()),
                refuse: Some((name, format_error)),
            }
        }

        pub(crate) fn names(&self) -> Vec<String> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .map(|(name, _, _)| name.clone())
                .collect()
        }
    }

    impl Finalizer for Spy {
        fn finalize(&self, path: &Path, name: &str) -> rage_rpf::Result<()> {
            assert_eq!(path.file_name().unwrap().to_string_lossy(), name);
            let folder = path
                .parent()
                .and_then(Path::file_name)
                .map(|folder| folder.to_string_lossy().into_owned())
                .unwrap_or_default();
            let kind = if folder.starts_with("nested-") {
                "nested"
            } else if folder.starts_with(".astral-compose-") {
                "staging"
            } else {
                "other"
            };
            let size = fs::metadata(path).map_or(0, |facts| facts.len());
            self.calls
                .lock()
                .unwrap()
                .push((name.to_owned(), kind.to_owned(), size));
            match self.refuse {
                Some((refused, true)) if refused == name => {
                    Err(RpfError::format(format!("finalizer refused {name}")))
                }
                Some((refused, false)) if refused == name => {
                    Err(RpfError::state(format!("last refused {name}")))
                }
                _ => Ok(()),
            }
        }
    }

    impl Lab {
        fn run_with(&self, request: &Request, finalizer: &Spy) -> Result<Value> {
            compose_with(request, &quiet_keys(), Some(finalizer), &Progress::silent())
        }
    }

    // ----- имя архива (К72-К81) -----

    #[test]
    fn the_archive_name_comes_from_the_last_part_of_the_target() {
        let lab = Lab::new();
        let cases: [(&str, Option<&str>); 9] = [
            ("update:/x64/astral/mod.rpf", Some("mod.rpf")),
            ("", Some("mod.rpf")),
            ("dlc.rpf", Some("dlc.rpf")),
            ("a\\b\\dlc.rpf", Some("dlc.rpf")),
            ("x/dlc.rpf/", Some("dlc.rpf")),
            ("//", Some("mod.rpf")),
            ("dlc", None),
            ("DLC.RPF", None),
            ("x.rpf.bak", None),
        ];
        for (target, expected) in cases {
            let spy = Spy::new();
            let out = lab.out("names");
            let mut request = lab.request(Some("b1"), &[import("x64/a/z.txt", "small.txt")], &out);
            request.archive_target = target.to_owned();
            let error = lab.run_with(&request, &spy).err().unwrap();
            let message = match expected {
                Some(name) => format!("RPF finalization failed: {name}"),
                None => "Logical RPF target name is missing.".to_owned(),
            };
            assert_eq!(
                (error.code.as_str(), error.message.as_str()),
                ("InvalidDataException", message.as_str()),
                "цель {target:?}"
            );
            assert_eq!(
                spy.names(),
                expected.map(str::to_owned).into_iter().collect::<Vec<_>>()
            );
            assert!(!out.exists());
        }
    }

    /// Имя архива становится именем файла в служебной папке. Имя, которое Windows
    /// понимает иначе, чем написано (диск, поток NTFS, устройство, точка на конце),
    /// отвергается до записи: доводчик не вызван, выхода нет (разбор безопасности
    /// 23.11.2026, H3-03).
    #[test]
    fn an_archive_name_that_windows_reads_differently_is_refused_before_the_write() {
        let lab = Lab::new();
        // первым идёт имя, которое без проверки остаётся внутри служебной папки
        for (target, name) in [
            ("update:/x64/a:b.rpf", "a:b.rpf"),
            ("update:/x64/C:evil.rpf", "C:evil.rpf"),
            ("x64/nul.rpf", "nul.rpf"),
            ("x64/COM1.rpf", "COM1.rpf"),
            ("x64/a?b.rpf", "a?b.rpf"),
        ] {
            let spy = Spy::new();
            let out = lab.out("unsafe-names");
            let mut request = lab.request(Some("b1"), &[import("x64/a/z.txt", "small.txt")], &out);
            request.archive_target = target.to_owned();
            let error = lab.run_with(&request, &spy).err().unwrap();
            assert_eq!(
                (error.code.as_str(), error.message.as_str()),
                (
                    "InvalidDataException",
                    format!("Unsafe relative path: {name}").as_str()
                ),
                "цель {target:?}"
            );
            assert_eq!(spy.names(), Vec::<String>::new(), "цель {target:?}");
            assert!(!out.exists());
        }
    }

    #[test]
    fn edition_and_archive_are_echoed_as_given() {
        let lab = Lab::new();
        let ops = [import("x64/a/z.txt", "small.txt")];
        // К81
        let mut request = lab.request(Some("b1"), &ops, &lab.out("k81"));
        request.edition = None;
        let answer = lab.run(&request).0.unwrap();
        assert_eq!(answer["edition"], Value::Null);
        assert_eq!(answer["archive"], "update:/x64/astral/mod.rpf");
        let mut request = lab.request(Some("b1"), &ops, &lab.out("k81b"));
        request.edition = Some("Enhanced".to_owned());
        assert_eq!(lab.run(&request).0.unwrap()["edition"], "Enhanced");
    }

    // ----- выход и служебная папка (К82-К85) -----

    #[test]
    fn an_existing_output_is_replaced_and_the_staging_folder_named_by_the_caller_goes() {
        let lab = Lab::new();
        let ops = [import("x64/a/z.txt", "small.txt")];
        // К82
        let out = lab.out("k82");
        fs::create_dir_all(out.parent().unwrap()).unwrap();
        fs::write(&out, b"OLD OUTPUT").unwrap();
        assert!(lab.run(&lab.request(Some("b1"), &ops, &out)).0.is_ok());
        assert_ne!(fs::read(&out).unwrap(), b"OLD OUTPUT");
        assert!(Archive::open_path(&out, None).is_ok());
        // К83: заданная вызывающим папка не пуста — убирается целиком
        let out = lab.out("k83");
        let staging = lab.dir.path().join("my-staging");
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join("leftover.bin"), b"x").unwrap();
        let mut request = lab.request(Some("b1"), &ops, &out);
        request.staging = Some(staging.clone());
        assert!(lab.run(&request).0.is_ok());
        assert!(!staging.exists());
        // К84: и при отказе записи
        let out = lab.out("k84");
        fs::create_dir_all(&staging).unwrap();
        let mut request = lab.request(Some("b1"), &[replace("x64/a/res.ytd", "small.txt")], &out);
        request.staging = Some(staging.clone());
        assert!(lab.run(&request).0.is_err());
        assert!(!staging.exists());
        assert!(!out.exists());
    }

    #[test]
    fn a_cancel_before_the_start_leaves_no_output_and_no_staging_folder() {
        let lab = Lab::new();
        let ops = [import("x64/a/z.txt", "small.txt")];
        // К85: флаг
        let out = lab.out("k85");
        let progress = Progress::silent();
        progress.cancel().request();
        let error = compose_with(
            &lab.request(Some("b1"), &ops, &out),
            &quiet_keys(),
            None,
            &progress,
        )
        .err()
        .unwrap();
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("Cancelled", "Отменено.")
        );
        assert!(!out.exists());
        assert!(!out.parent().unwrap().exists());
        // файл отмены, существовавший до начала
        let out = lab.out("k85-file");
        let progress = Progress::silent();
        progress.cancel().watch_file(lab.source("small.txt"));
        let error = compose_with(
            &lab.request(Some("b1"), &ops, &out),
            &quiet_keys(),
            None,
            &progress,
        )
        .err()
        .unwrap();
        assert_eq!(error.code, "Cancelled");
        assert!(!out.exists());
    }

    // ----- источники, пути, отпечатки (К90-К100) -----

    #[test]
    fn sources_are_checked_before_paths_and_fingerprints_after_the_write() {
        let lab = Lab::new();
        let helper = "Helper paths must be absolute.";
        // К90
        lab.case(
            "k90",
            Some("b1"),
            vec![delete("X64\\A\\a.ydd").denied()],
            failed(
                "InvalidDataException",
                "RPF delete is not authorized: X64\\A\\a.ydd",
            ),
        );
        // К91-К94
        lab.case(
            "k91",
            Some("b1"),
            vec![import("x64/a/q.txt", "small.txt").from(Src::Missing)],
            failed("ArgumentException", helper),
        );
        lab.case(
            "k92",
            Some("b1"),
            vec![import("x64/a/q.txt", "small.txt").from(Src::Raw(PathBuf::from("small.txt")))],
            failed("ArgumentException", helper),
        );
        let not_found = failed("FileNotFoundException", "Input file not found.");
        lab.case(
            "k93",
            Some("b1"),
            vec![import("x64/a/q.txt", "small.txt").from(Src::Named("absent.txt"))],
            not_found,
        );
        lab.case(
            "k94",
            Some("b1"),
            vec![import("x64/a/q.txt", "small.txt").from(Src::Raw(lab.src.clone()))],
            failed("FileNotFoundException", "Input file not found."),
        );
        // К95, К96: источник проверяется раньше пути
        lab.case(
            "k95",
            Some("b1"),
            vec![import("../evil", "small.txt").from(Src::Named("absent.txt"))],
            failed("FileNotFoundException", "Input file not found."),
        );
        lab.case(
            "k96",
            Some("b1"),
            vec![import("../evil", "small.txt")],
            failed("InvalidDataException", UNSAFE),
        );
        // К97
        lab.case(
            "k97",
            Some("b1"),
            vec![replace("x64/a/a.rpf", "small.txt")],
            failed(
                "InvalidDataException",
                "RPF operation failed at x64/a/a.rpf: RPF entry not found: x64/a/a.rpf",
            ),
        );
        // К98-К100
        let small = sha256_file(&lab.source("small.txt")).unwrap();
        let added = || done(&["x64/a/q.txt"], vec![p(b("x64/a/q.txt", 1, 50))]);
        lab.case(
            "k98",
            Some("b1"),
            vec![import("x64/a/q.txt", "small.txt").sha(&small.to_uppercase())],
            added(),
        );
        for (label, digest) in [("k99", "00"), ("k100", "   ")] {
            lab.case(
                label,
                Some("b1"),
                vec![import("x64/a/q.txt", "small.txt").sha(digest)],
                failed(
                    "InvalidDataException",
                    "Payload checksum mismatch: x64/a/q.txt",
                ),
            );
        }
    }

    // ----- выход и основа (К-в1-К-в8) -----

    #[test]
    fn output_and_base_problems_are_reported_without_changing_the_output() {
        let lab = Lab::new();
        let ops = [import("x64/a/z.txt", "small.txt")];
        let refused = |request: &Request| lab.run(request).0.err().unwrap();
        let nowhere = "Output archive path has no folder.";
        // К-в1, К-в2
        let error = refused(&lab.request(Some("b1"), &ops, Path::new("")));
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("InvalidDataException", nowhere)
        );
        #[cfg(windows)]
        {
            let error = refused(&lab.request(Some("b1"), &ops, Path::new("C:\\")));
            assert_eq!(error.message, nowhere);
        }
        // К-в3: на месте папки файл
        let blocker = lab.dir.path().join("blocker");
        fs::write(&blocker, b"file").unwrap();
        let error = refused(&lab.request(Some("b1"), &ops, &blocker.join("mod.rpf")));
        assert_eq!(error.code, "IOException");
        assert!(
            error.message.ends_with("(os error 183)"),
            "{}",
            error.message
        );
        // К-в4: выход — существующая папка; собранный файл остаётся в служебной папке
        let out = lab.out("k-v4");
        fs::create_dir_all(&out).unwrap();
        let error = refused(&lab.request(Some("b1"), &ops, &out));
        assert_eq!(error.code, "UnauthorizedAccessException");
        assert!(error.message.ends_with("(os error 5)"), "{}", error.message);
        let left: Vec<PathBuf> = fs::read_dir(out.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".astral-compose-")
            })
            .collect();
        assert_eq!(left.len(), 1);
        assert!(left[0].join("mod.rpf").is_file());
        // К-в5, К-в6: основы нет или это папка
        let missing = lab.dir.path().join("no-such.rpf");
        let mut request = lab.request(Some("b1"), &ops, &lab.out("k-v5"));
        request.base = Some(missing.clone());
        let error = refused(&request);
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            (
                "FileNotFoundException",
                format!("File was not found: {}", missing.display()).as_str()
            )
        );
        request.base = Some(lab.dir.path().to_path_buf());
        let error = refused(&request);
        assert_eq!(
            error.message,
            format!("File was not found: {}", lab.dir.path().display())
        );
        // К-в7: основа — не архив
        let scratch = tempdir().unwrap();
        let noise_file = scratch.path().join("bad.rpf");
        fs::copy(lab.source("bad.rpf"), &noise_file).unwrap();
        let reading = Archive::open_path(&noise_file, None)
            .err()
            .unwrap()
            .to_string();
        request.base = Some(noise_file);
        let error = refused(&request);
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("InvalidDataException", reading.as_str())
        );
    }

    #[test]
    fn a_relative_output_path_is_taken_from_the_current_folder() {
        // К-в8: выход не приводится к полному пути
        let lab = Lab::new();
        let folder = format!("astral-compose-test-{}", random_hex(12));
        let out = Path::new(&folder).join("mod.rpf");
        let request = lab.request(Some("b1"), &[import("x64/a/z.txt", "small.txt")], &out);
        let outcome = lab.run(&request).0;
        let made = out.is_file();
        let _ = fs::remove_dir_all(&folder);
        assert!(outcome.is_ok() && made);
    }

    // ----- корень созданного вложенного архива и стадия read без основы -----

    /// Корневая запись вложенного архива по его сырым байтам: имя, длина блока
    /// имён, смещение имени, первый ребёнок, число детей и сам блок имён.
    struct NestedRoot {
        name: String,
        names_len: u32,
        name_offset: u32,
        first: u32,
        count: u32,
        names: Vec<u8>,
    }

    fn nested_root(bytes: &[u8]) -> NestedRoot {
        let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        let (entries, names_len) = (word(4) as usize, word(8) as usize);
        let names_at = 16 + entries * 16;
        let names = bytes[names_at..names_at + names_len].to_vec();
        let name_offset = word(16);
        let tail = &names[name_offset as usize..];
        NestedRoot {
            name: String::from_utf8(tail.iter().copied().take_while(|&byte| byte != 0).collect())
                .unwrap(),
            names_len: names_len as u32,
            name_offset,
            first: word(24),
            count: word(28),
            names,
        }
    }

    /// Сырые байты записи по пути из звеньев (каталоги, затем файл).
    fn stored_at(archive: &Archive, path: &[&str]) -> Vec<u8> {
        let (leaf, folders) = path.split_last().unwrap();
        let dir = folders.iter().fold(archive.root(), |dir, name| {
            archive.find_dir(dir, name).unwrap()
        });
        archive
            .read_stored(archive.find_file(dir, leaf).unwrap())
            .unwrap()
    }

    #[test]
    fn a_created_nested_archive_keeps_its_root_unnamed_like_the_game() {
        let lab = Lab::new();
        let out = lab.out("brandnew");
        let request = lab.request(
            Some("b1"),
            &[
                import("x64/data/cdimages/brandnew.rpf/a.txt", "small.txt"),
                upsert("x64/astral/outer.rpf/inner.rpf/deep/x.txt", "small.txt"),
                import("x64/astral/whole.rpf", "nested2.rpf"),
                upsert("x64/astral/c.rpf/three.ydd", "small.txt"),
            ],
            &out,
        );
        lab.run(&request).0.unwrap();
        let top = Archive::open_path(&out, None).unwrap();

        // контейнер создан: корень без имени на нулевом смещении, в блоке имён — только записи
        let brandnew = nested_root(&stored_at(
            &top,
            &["x64", "data", "cdimages", "brandnew.rpf"],
        ));
        assert_eq!(brandnew.name, "");
        assert_eq!(brandnew.names_len, 0x10);
        assert_eq!(brandnew.name_offset, 0);
        assert_eq!((brandnew.first, brandnew.count), (1, 1));
        let mut expected = b"\0a.txt\0".to_vec();
        expected.resize(16, 0);
        assert_eq!(brandnew.names, expected);

        // вложенный в создаваемый: у каждого корень тоже без имени
        let outer_bytes = stored_at(&top, &["x64", "astral", "outer.rpf"]);
        assert_eq!(
            (nested_root(&outer_bytes).name.as_str(), nested_root(&outer_bytes).name_offset),
            ("", 0)
        );
        let outer = Archive::open(
            Arc::new(rage_rpf::MemSource(outer_bytes)),
            "outer.rpf",
            None,
        )
        .unwrap();
        let inner = nested_root(&stored_at(&outer, &["inner.rpf"]));
        assert_eq!((inner.name.as_str(), inner.name_offset), ("", 0));

        // уже лежавший в основе и пришедший файлом — такие же: созданный от них не отличается
        let existing = nested_root(&stored_at(&top, &["x64", "astral", "c.rpf"]));
        let from_file = nested_root(&stored_at(&top, &["x64", "astral", "whole.rpf"]));
        assert_eq!((existing.name.as_str(), existing.name_offset), ("", 0));
        assert_eq!((from_file.name.as_str(), from_file.name_offset), ("", 0));
    }

    #[test]
    fn the_read_stage_is_reported_only_when_there_is_a_base() {
        let lab = Lab::new();
        let ops = [import("x64/new/a.ydd", "small.txt")];
        let phases = |base: Option<&str>, mode: Mode, label: &str| {
            let mut request = lab.request(base, &ops, &lab.out(label));
            request.mode = mode;
            let (outcome, lines) = lab.run(&request);
            outcome.unwrap();
            let mut found: Vec<String> = lines.iter().map(|line| phase_of(line)).collect();
            found.dedup();
            found
        };
        assert_eq!(
            phases(None, Mode::Create, "no-base"),
            ["prepare", "compose", "prepare", "compose", "verify"]
        );
        assert_eq!(
            phases(None, Mode::Compose, "no-base-compose"),
            ["prepare", "compose", "prepare", "compose", "verify"]
        );
        assert_eq!(
            phases(Some("b1"), Mode::Compose, "with-base"),
            ["prepare", "read", "compose", "prepare", "compose", "verify", "read"]
        );
    }

    // ----- ход и содержимое папки выхода посреди работы -----

    #[test]
    fn the_stages_are_reported_in_order_and_the_ready_file_waits_in_the_staging_folder() {
        let lab = Lab::new();
        let out = lab.out("progress");
        let request = lab.request(Some("b1"), &[replace("x64/a/a.ydd", "new.ydd")], &out);
        let lines: Arc<Mutex<Vec<String>>> = Arc::default();
        let watched = out.parent().unwrap().to_path_buf();
        let found: Arc<Mutex<Vec<String>>> = Arc::default();
        let (record, hook_lines) = (Arc::clone(&found), Arc::clone(&lines));
        let seen_phase = Mutex::new(String::new());
        let tracing = Progress::with_sink(move |line| {
            let phase = phase_of(line);
            let mut last = seen_phase.lock().unwrap();
            if *last != phase {
                last.clone_from(&phase);
                if phase == "verify" {
                    let mut now: Vec<String> = fs::read_dir(&watched)
                        .unwrap()
                        .flatten()
                        .map(|entry| entry.file_name().to_string_lossy().into_owned())
                        .collect();
                    now.sort();
                    record.lock().unwrap().extend(now);
                }
            }
            hook_lines.lock().unwrap().push(line.to_owned());
        });
        let answer = compose_with(&request, &quiet_keys(), None, &tracing).unwrap();
        let lines = lines.lock().unwrap().clone();
        let mut phases: Vec<String> = lines.iter().map(|line| phase_of(line)).collect();
        phases.dedup();
        assert_eq!(
            phases,
            ["prepare", "read", "compose", "prepare", "compose", "verify", "read"]
        );
        let total = fs::metadata(lab.base("b1")).unwrap().len() + 1234;
        let compose_line = lines
            .iter()
            .find(|line| {
                line.contains(r#""phase":"compose""#) && !line.contains("\"copiedBytes\":0,")
            })
            .unwrap();
        assert!(
            compose_line.ends_with(&format!("\"totalBytes\":{total}}}}}")),
            "{compose_line}"
        );
        assert_eq!(
            lines[0],
            r#"{"progress":{"phase":"prepare","copiedBytes":0,"totalBytes":0}}"#
        );
        assert_eq!(answer["status"], "ready");

        // посреди проверки в папке выхода лежит только служебная папка
        let during = found.lock().unwrap().clone();
        assert_eq!(during.len(), 1, "{during:?}");
        assert!(
            during[0].starts_with(".astral-compose-")
                && during[0].len() == ".astral-compose-".len() + 32
        );
        let after: Vec<String> = fs::read_dir(out.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(after, ["mod.rpf"]);
    }

    // ----- доводчик (проба с подставным доводчиком) -----

    fn busy_ops() -> Vec<Op> {
        vec![
            replace("x64/astral/c.rpf/two.ydd", "new2.ydd"),
            import("x64/astral/fresh.rpf/x.ydd", "small.txt"),
            import("x64/astral/whole.rpf", "nested2.rpf"),
            upsert("x64/other/e.rpf/more.txt", "small.txt"),
        ]
    }

    #[test]
    fn the_finalizer_is_called_for_each_changed_nested_archive_and_last_for_the_archive() {
        let lab = Lab::new();
        let out = lab.out("spy");
        let spy = Spy::new();
        let error = lab
            .run_with(&lab.request(Some("b1"), &busy_ops(), &out), &spy)
            .err()
            .unwrap();
        // пустышка не шифрует оглавление
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("InvalidDataException", "RPF finalization failed: mod.rpf")
        );
        assert!(!out.exists());
        no_workshop_left(&out);
        assert_eq!(
            spy.names(),
            ["c.rpf", "fresh.rpf", "whole.rpf", "e.rpf", "mod.rpf"]
        );
        let kinds: Vec<String> = spy
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|(_, kind, _)| kind.clone())
            .collect();
        assert_eq!(kinds, ["nested", "nested", "nested", "nested", "staging"]);
        // вложенные собраны, сам архив записан целиком (размер кратен 512)
        let sizes: Vec<u64> = spy
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|(_, _, size)| *size)
            .collect();
        assert!(
            sizes.iter().all(|size| size % 512 == 0 && *size > 0),
            "{sizes:?}"
        );
    }

    #[test]
    fn a_refusing_finalizer_stops_the_build_and_its_own_error_is_kept() {
        let lab = Lab::new();
        let out = lab.out("spy-refuse");
        let request = lab.request(Some("b1"), &busy_ops(), &out);
        let spy = Spy::refusing("c.rpf", true);
        let error = lab.run_with(&request, &spy).err().unwrap();
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("InvalidDataException", "finalizer refused c.rpf")
        );
        assert_eq!(spy.names(), ["c.rpf"]);
        assert!(!out.exists());
        no_workshop_left(&out);
        // отказ на самом архиве
        let spy = Spy::refusing("mod.rpf", false);
        let error = lab.run_with(&request, &spy).err().unwrap();
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("InvalidOperationException", "last refused mod.rpf")
        );
        assert_eq!(spy.names().last().map(String::as_str), Some("mod.rpf"));
        assert!(!out.exists());
        no_workshop_left(&out);
    }

    // ----- разбор запроса и команда `compose-rpf` (Q1-Q87) -----

    #[test]
    fn a_full_request_is_read_field_by_field() {
        let lab = Lab::new();
        let staging = lab.dir.path().join("stage");
        let source = lab.source("small.txt");
        let text = json!({
            "mode": "create",
            "baseArchive": "relative\\base.rpf",
            "outputArchive": "out\\mod.rpf",
            "archiveTarget": "update:/x64/astral/mod.rpf",
            "edition": "Enhanced",
            "allowDeletes": true,
            "stagingDirectory": staging,
            "cancelFile": "",
            "operations": [
                { "entry": "a/b.ydd", "source": source, "sha256": "  ", "action": " UpSert " },
                { "entry": "c.ydd", "source": 5, "sha256": "AbC ", "allowDelete": "yes", "allowMissing": true },
                { "action": "delete", "allowDelete": true },
            ],
        })
        .to_string();
        let request = parse_request(&format!("\u{feff}\u{feff}{text}")).unwrap();
        assert_eq!(request.mode, Mode::Create);
        assert_eq!(request.base, Some(PathBuf::from("relative\\base.rpf")));
        assert_eq!(request.output, PathBuf::from("out\\mod.rpf"));
        assert_eq!(request.archive_target, "update:/x64/astral/mod.rpf");
        assert_eq!(request.edition.as_deref(), Some("Enhanced"));
        assert!(request.allow_deletes && request.install.is_none());
        assert_eq!(request.staging, Some(staging));
        let ops = &request.operations;
        assert_eq!(ops.len(), 3);
        assert_eq!(
            (ops[0].action, ops[0].entry.as_str()),
            (Action::Upsert, "a/b.ydd")
        );
        assert_eq!(ops[0].source.as_deref(), Some(source.as_path()));
        assert_eq!(ops[0].sha256, None);
        assert_eq!(
            (ops[1].action, ops[1].source.clone()),
            (Action::Replace, None)
        );
        assert_eq!(ops[1].sha256.as_deref(), Some("AbC "));
        assert!(!ops[1].allow_delete && ops[1].allow_missing);
        assert_eq!((ops[2].action, ops[2].entry.as_str()), (Action::Delete, ""));
        assert!(ops[2].allow_delete);
    }

    const OPERATIONS: &str = r#"[{"entry":"x64/a/a.ydd","source":"C:\\no\\small.txt"}]"#;
    const REQUIRED: &str = "InvalidOperationException: Verified ArchiveFix is required.";

    fn request_with(extra: &str) -> String {
        format!(r#"{{"outputArchive":"o.rpf","operations":{OPERATIONS}{extra}}}"#)
    }

    /// Окружение, в котором команда ищет ключи, ArchiveFix и точки; прежние
    /// значения возвращаются, а пока стенд жив, остальные ждут очереди.
    pub(crate) struct TestEnv {
        _lock: MutexGuard<'static, ()>,
        saved: Vec<(&'static str, Option<OsString>)>,
    }

    impl TestEnv {
        pub(crate) fn clean(local_app_data: &Path) -> TestEnv {
            let mut env = TestEnv {
                _lock: crate::test_support::env_lock(),
                saved: Vec::new(),
            };
            for name in [
                "MODOVIK_GTA_KEYS_PATH",
                "MODOVIK_ARCHIVE_FIX_PATH",
                "ASTRAL_ENGINE_RESTORE_ROOT",
                "XDG_DATA_HOME",
            ] {
                env.set(name, None);
            }
            env.set("LOCALAPPDATA", Some(local_app_data.as_os_str()));
            env
        }

        pub(crate) fn set(&mut self, name: &'static str, value: Option<&OsStr>) {
            self.saved.push((name, std::env::var_os(name)));
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            for (name, value) in self.saved.drain(..).rev() {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }

    #[test]
    fn the_nested_switch_is_off_by_default_and_read_from_the_environment() {
        let scratch = tempdir().unwrap();
        let mut env = TestEnv::clean(scratch.path());
        env.set(NESTED_DIRECT_ENV, None);
        env.set(NESTED_DIRECT_RAM_ENV, None);
        env.set(STREAM_SHA_ENV, None);
        env.set(STREAM_SHA_MIN_ENV, None);
        assert_eq!(Streaming::from_env().nested, NestedMode::Staged);
        // любое значение, кроме `1`, оставляет прежний путь
        for other in ["0", "true", "", "yes"] {
            env.set(NESTED_DIRECT_ENV, Some(OsStr::new(other)));
            assert_eq!(
                Streaming::from_env().nested,
                NestedMode::Staged,
                "{other:?}"
            );
        }
        env.set(NESTED_DIRECT_ENV, Some(OsStr::new(" 1 ")));
        assert_eq!(Streaming::from_env().nested, NestedMode::direct());
        env.set(NESTED_DIRECT_RAM_ENV, Some(OsStr::new("64")));
        assert_eq!(
            Streaming::from_env().nested,
            NestedMode::Direct { ram_cap: 64 << 20 }
        );
        // бюджет без выключателя ничего не включает, а мусор вместо числа — умолчание
        env.set(NESTED_DIRECT_ENV, None);
        assert_eq!(Streaming::from_env().nested, NestedMode::Staged);
        env.set(NESTED_DIRECT_ENV, Some(OsStr::new("1")));
        env.set(NESTED_DIRECT_RAM_ENV, Some(OsStr::new("many")));
        assert_eq!(Streaming::from_env().nested, NestedMode::direct());
        // остальные режимы записи не меняются выключателем
        let on = Streaming::from_env();
        assert_eq!((on.enabled, on.trial_from), (false, 0x1000_0000));
        assert_eq!(Streaming::always().nested, NestedMode::Staged);
        assert_eq!(Streaming::off().nested, NestedMode::Staged);
        assert_eq!(
            Streaming::always().with_nested(NestedMode::direct()).nested,
            NestedMode::direct()
        );
    }

    pub(crate) fn key_dir(path: &Path) -> PathBuf {
        fs::create_dir_all(path).unwrap();
        for (name, size) in [
            ("gtav_aes_key.dat", 32),
            ("gtav_ng_key.dat", 101 * 68 * 4),
            ("gtav_ng_decrypt_tables.dat", 17 * 4096 * 4),
            ("gtav_hash_lut.dat", 256),
        ] {
            fs::write(path.join(name), vec![7u8; size]).unwrap();
        }
        path.to_path_buf()
    }

    pub(crate) fn fake_tool(dir: &Path, name: &str) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, b"NOT THE REAL ARCHIVEFIX").unwrap();
        path
    }

    /// Команда `compose-rpf` с чистым окружением и каталогом ключей.
    struct Cli {
        lab: Lab,
        keys: PathBuf,
        appdata: PathBuf,
        env: TestEnv,
    }

    impl Cli {
        fn new() -> Cli {
            let lab = Lab::new();
            let appdata = lab.dir.path().join("localappdata");
            fs::create_dir_all(&appdata).unwrap();
            let keys = key_dir(&lab.dir.path().join("keys"));
            Cli {
                env: TestEnv::clean(&appdata),
                lab,
                keys,
                appdata,
            }
        }

        fn text(path: &Path) -> String {
            path.to_string_lossy().into_owned()
        }

        /// Отказ команды как «код: текст»; успех — `ok`.
        fn answer(&self, args: &[&str]) -> String {
            let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            let options = Options::parse(&args).unwrap();
            match compose_rpf(&options, &Progress::silent()) {
                Ok(_) => "ok".to_owned(),
                Err(error) => error.to_string(),
            }
        }

        /// Запрос кладётся файлом; ключи — из стенда, если не сказано иное.
        fn ask(&self, request: &str, extra: &[&str]) -> String {
            let file = self.lab.dir.path().join("request.json");
            fs::write(&file, request).unwrap();
            let file = Self::text(&file);
            let keys = Self::text(&self.keys);
            let mut args = vec!["--request", file.as_str()];
            if !extra.contains(&"--keys") {
                args.extend(["--keys", keys.as_str()]);
            }
            args.extend_from_slice(extra);
            self.answer(&args)
        }
    }

    #[test]
    fn the_request_file_is_read_and_checked_in_order() {
        let cli = Cli::new();
        // Q1-Q3: сам файл
        assert_eq!(cli.answer(&[]), "ArgumentException: --request is required.");
        let missing = Cli::text(&cli.lab.dir.path().join("no-request.json"));
        let answer = cli.answer(&["--request", &missing]);
        assert!(
            answer.starts_with("FileNotFoundException: ") && answer.ends_with("(os error 2)"),
            "{answer}"
        );
        let folder = Cli::text(cli.lab.dir.path());
        let answer = cli.answer(&["--request", &folder]);
        assert!(
            answer.starts_with("UnauthorizedAccessException: ") && answer.ends_with("(os error 5)"),
            "{answer}"
        );

        let not_json = "InvalidDataException: RPF request is not JSON.";
        let no_output = "ArgumentException: RPF output archive is required.";
        let no_operations = "ArgumentException: At least one RPF entry operation is required.";
        let operation_in =
            |operation: &str| format!(r#"{{"outputArchive":"o.rpf","operations":[{operation}]}}"#);
        let huge = |count: usize| {
            let items = vec![r#"{"entry":"a","source":"C:\\s"}"#; count].join(",");
            format!(r#"{{"outputArchive":"o.rpf","operations":[{items}]}}"#)
        };
        let table: Vec<(String, String)> = vec![
            // Q4-Q7
            (String::new(), not_json.into()),
            ("this is not json".into(), not_json.into()),
            (
                "[]".into(),
                "InvalidDataException: RPF request is not an object.".into(),
            ),
            ("{}".into(), no_output.into()),
            // Q8-Q12
            (r#"{"outputArchive":"o.rpf"}"#.into(), no_operations.into()),
            (
                r#"{"outputArchive":"o.rpf","operations":[]}"#.into(),
                no_operations.into(),
            ),
            (
                r#"{"outputArchive":"o.rpf","operations":"x"}"#.into(),
                no_operations.into(),
            ),
            (
                r#"{"outputArchive":"o.rpf","operations":null}"#.into(),
                no_operations.into(),
            ),
            (
                r#"{"outputArchive":"o.rpf","operations":{}}"#.into(),
                no_operations.into(),
            ),
            // Q13-Q17
            (
                request_with(r#","mode":"Compose""#),
                "InvalidDataException: Unsupported RPF mode: Compose".into(),
            ),
            (request_with(r#","mode":"create""#), REQUIRED.into()),
            (request_with(r#","mode":5"#), REQUIRED.into()),
            (
                request_with(r#","mode":"""#),
                "InvalidDataException: Unsupported RPF mode: ".into(),
            ),
            (request_with(r#","mode":null"#), REQUIRED.into()),
            // Q18-Q19
            (
                format!(r#"{{"outputArchive":5,"operations":{OPERATIONS}}}"#),
                no_output.into(),
            ),
            (
                format!(r#"{{"outputArchive":"","operations":{OPERATIONS}}}"#),
                REQUIRED.into(),
            ),
            // Q20-Q26
            (
                operation_in("5"),
                "InvalidDataException: RPF operation is not an object.".into(),
            ),
            (
                operation_in("null"),
                "InvalidDataException: RPF operation is not an object.".into(),
            ),
            (
                operation_in(r#"{"entry":"a","action":"move"}"#),
                "InvalidDataException: Unsupported RPF action: move".into(),
            ),
            (
                operation_in(r#"{"entry":"a","source":"C:\\s","action":5}"#),
                REQUIRED.into(),
            ),
            (
                operation_in(r#"{"entry":"a","source":"C:\\s","action":" UPSERT "}"#),
                REQUIRED.into(),
            ),
            (operation_in(r#"{"source":"C:\\s"}"#), REQUIRED.into()),
            (
                operation_in(r#"{"entry":"a","source":5,"sha256":5,"allowDelete":"yes"}"#),
                REQUIRED.into(),
            ),
            // Q27-Q29
            (
                request_with(r#","stagingDirectory":"relative\\stage""#),
                "ArgumentException: Staging directory must be absolute.".into(),
            ),
            (request_with(r#","stagingDirectory":5"#), REQUIRED.into()),
            (
                request_with(r#","stagingDirectory":"""#),
                "ArgumentException: Staging directory must be absolute.".into(),
            ),
            // Q30-Q32: оба разбора (запрос и файл отмены) срезают BOM
            (format!("\u{feff}{}", request_with("")), REQUIRED.into()),
            (
                format!("\u{feff}\u{feff}{}", request_with("")),
                REQUIRED.into(),
            ),
            (
                format!(
                    "\u{feff}{}",
                    request_with(r#","cancelFile":"C:\\no\\cancel.flag""#)
                ),
                REQUIRED.into(),
            ),
            (format!("{} garbage", request_with("")), not_json.into()),
            // Q33-Q35
            (
                format!(r#"{{"OutputArchive":"o.rpf","Operations":{OPERATIONS}}}"#),
                no_output.into(),
            ),
            (request_with(r#","unknown":[1,2,3]"#), REQUIRED.into()),
            (request_with(""), REQUIRED.into()),
            // Q36-Q37: предел числа операций
            (huge(100_000), REQUIRED.into()),
            (
                huge(100_001),
                "InvalidDataException: RPF operation limit exceeded.".into(),
            ),
            // Q86
            (
                request_with(r#","cancelFile":"C:\\no\\cancel.flag""#),
                REQUIRED.into(),
            ),
        ];
        for (request, expected) in &table {
            let shown: String = request.chars().take(80).collect();
            assert_eq!(&cli.ask(request, &[]), expected, "{shown}");
        }
        // Q87: потолки записи и чтения не отказывают
        assert_eq!(
            cli.ask(
                &request_with(""),
                &["--write-limit-mbps", "5", "--read-limit-mbps", "7"]
            ),
            REQUIRED
        );
    }

    #[test]
    fn keys_are_looked_for_after_the_request_and_before_archivefix() {
        let mut cli = Cli::new();
        let request = request_with("");
        let discovery =
            "FileNotFoundException: GTA V executable was not found for in-memory key discovery.";
        let no_keys = "InvalidOperationException: Astral could not discover the RPF keys in this GTA V build. Update the native engine or configure MODOVIK_GTA_KEYS_PATH. Keys are never uploaded or committed.";
        let no_game = Cli::text(&cli.lab.dir.path().join("no-game"));
        fs::create_dir_all(&no_game).unwrap();
        let game = Cli::text(&cli.lab.dir.path().join("game"));
        fs::create_dir_all(&game).unwrap();
        fs::write(Path::new(&game).join("GTA5.exe"), b"").unwrap();
        let keys = Cli::text(&cli.keys);
        // Q38-Q40
        assert_eq!(cli.ask(&request, &["--keys", ""]), discovery);
        assert_eq!(
            cli.ask(&request, &["--keys", "", "--game-root", &no_game]),
            discovery
        );
        assert_eq!(
            cli.ask(&request, &["--keys", "", "--game-root", &game]),
            no_keys
        );
        // Q41
        let missing = cli.lab.dir.path().join("no-keys");
        let answer = cli.ask(&request, &["--keys", &Cli::text(&missing)]);
        assert!(
            answer.starts_with(&format!(
                "InvalidOperationException: The GTA V RPF key file gtav_aes_key.dat could not be read from {}: ",
                missing.display()
            )) && answer.ends_with("(os error 3)"),
            "{answer}"
        );
        // Q42-Q44: пустой --keys не считается, окружение считается
        assert_eq!(
            cli.ask(&request, &["--keys", "", "--game-root", &no_game]),
            discovery
        );
        cli.env
            .set("MODOVIK_GTA_KEYS_PATH", Some(OsStr::new(&keys)));
        assert_eq!(cli.ask(&request, &["--keys", ""]), REQUIRED);
        assert_eq!(cli.ask(&request, &["--keys", "   "]), REQUIRED);
    }

    #[test]
    fn archivefix_is_required_found_and_checked_before_the_build() {
        let mut cli = Cli::new();
        let request = request_with("");
        let tools = cli.lab.dir.path().join("tools");
        let mismatch = "InvalidDataException: ArchiveFix executable checksum mismatch.";
        let absent = |path: &Path| {
            format!(
                "FileNotFoundException: File was not found: {}",
                path.display()
            )
        };
        // Q45
        assert_eq!(cli.ask(&request, &[]), REQUIRED);
        // Q46, Q47
        let none = tools.join("none").join("ArchiveFix.exe");
        assert_eq!(
            cli.ask(&request, &["--archive-fix", &Cli::text(&none)]),
            absent(&none)
        );
        let dir_named = tools.join("dir").join("ArchiveFix.exe");
        fs::create_dir_all(&dir_named).unwrap();
        assert_eq!(
            cli.ask(&request, &["--archive-fix", &Cli::text(&dir_named)]),
            absent(&dir_named)
        );
        // Q48-Q51
        let cmd = fake_tool(&tools.join("a"), "ArchiveFix.cmd");
        assert_eq!(
            cli.ask(&request, &["--archive-fix", &Cli::text(&cmd)]),
            "ArgumentException: Unsupported file extension: .cmd"
        );
        let other = fake_tool(&tools.join("b"), "other.exe");
        assert_eq!(
            cli.ask(&request, &["--archive-fix", &Cli::text(&other)]),
            "InvalidDataException: ArchiveFix executable name is invalid."
        );
        let fake = fake_tool(&tools.join("c"), "ArchiveFix.exe");
        assert_eq!(
            cli.ask(&request, &["--archive-fix", &Cli::text(&fake)]),
            mismatch
        );
        let loud = fake_tool(&tools.join("d"), "ARCHIVEFIX.EXE");
        assert_eq!(
            cli.ask(&request, &["--archive-fix", &Cli::text(&loud)]),
            mismatch
        );
        // Q52, Q53: путь в переменной
        cli.env
            .set("MODOVIK_ARCHIVE_FIX_PATH", Some(fake.as_os_str()));
        assert_eq!(cli.ask(&request, &[]), mismatch);
        // Q54, Q55: пустая опция считается отсутствующей, непустая побеждает переменную
        assert_eq!(cli.ask(&request, &["--archive-fix", ""]), mismatch);
        assert_eq!(cli.ask(&request, &["--archive-fix", "   "]), mismatch);
        assert_eq!(
            cli.ask(&request, &["--archive-fix", &Cli::text(&none)]),
            absent(&none)
        );
        cli.env
            .set("MODOVIK_ARCHIVE_FIX_PATH", Some(none.as_os_str()));
        assert_eq!(cli.ask(&request, &[]), absent(&none));
        // Q56: запасное место
        cli.env.set("MODOVIK_ARCHIVE_FIX_PATH", None);
        fake_tool(
            &cli.appdata.join("Astral").join("tools").join("ArchiveFix"),
            "ArchiveFix.exe",
        );
        assert_eq!(cli.ask(&request, &[]), mismatch);
    }

    #[test]
    fn the_install_block_is_read_before_the_output_and_its_archive_path_may_end_in_rpf() {
        let cli = Cli::new();
        let game = Cli::text(cli.lab.dir.path());
        let install = |fields: Value| -> String {
            let mut block = json!({ "gameRoot": game, "replay": {} });
            if let (Value::Object(base), Value::Object(more)) = (&mut block, fields) {
                base.extend(more);
            }
            format!(r#"{{"install":{block},"operations":{OPERATIONS}}}"#)
        };
        let archive = |path: &str| install(json!({ "archive": path }));
        // блок разобран, команда дошла до поиска ArchiveFix
        let reached = REQUIRED;
        let no_replay = "ArgumentException: Install replay record is required.";
        let no_operations = "ArgumentException: At least one RPF entry operation is required.";
        let no_archive = "ArgumentException: Install archive path is required.";
        let not_rpf = "ArgumentException: Install archive must be an .rpf file.";
        let table: Vec<(String, &str)> = vec![
            // Q58-Q59
            (
                request_with(r#","install":5"#),
                "InvalidDataException: RPF install block is not an object.",
            ),
            (
                format!(r#"{{"install":null,"operations":{OPERATIONS}}}"#),
                "ArgumentException: RPF output archive is required.",
            ),
            // Q60-Q62
            (
                format!(
                    r#"{{"install":{{"archive":"u.rpf","replay":{{}}}},"operations":{OPERATIONS}}}"#
                ),
                "ArgumentException: Install game root must be absolute.",
            ),
            (
                format!(
                    r#"{{"install":{{"gameRoot":"rel","archive":"u.rpf","replay":{{}}}},"operations":{OPERATIONS}}}"#
                ),
                "ArgumentException: Install game root must be absolute.",
            ),
            (
                format!(
                    r#"{{"install":{{"gameRoot":5,"archive":"u.rpf","replay":{{}}}},"operations":{OPERATIONS}}}"#
                ),
                "ArgumentException: Install game root must be absolute.",
            ),
            // Q63-Q68
            (install(json!({})), no_archive),
            (archive("update/update.bin"), not_rpf),
            (
                archive("update/../update.rpf"),
                "InvalidDataException: Unsafe RPF entry path.",
            ),
            (
                archive("/update/update.rpf"),
                "InvalidDataException: Invalid RPF entry path.",
            ),
            // имя на `.rpf` на конце пути архива допускается (это путь самого архива)
            (archive("UPDATE\\Update.RPF"), reached),
            (
                archive("c:/update.rpf"),
                "InvalidDataException: Unsafe RPF entry path.",
            ),
            // Q69-Q73: replay разбирается после архива и должен быть объектом
            (
                install(json!({ "archive": "update/update.rpf", "replay": null })),
                no_replay,
            ),
            (
                install(json!({ "archive": "update/update.rpf", "replay": [] })),
                no_replay,
            ),
            (
                install(json!({ "archive": "update/update.rpf", "replay": "text" })),
                no_replay,
            ),
            (
                install(json!({ "archive": "update/update.rpf", "replay": {} })),
                reached,
            ),
            // Q74-Q79: цели
            (install(json!({ "targets": "x" })), no_archive),
            (
                install(json!({ "targets": [], "archive": "update/update.rpf" })),
                reached,
            ),
            (
                install(json!({ "targets": [5] })),
                "InvalidDataException: Install target is not an object.",
            ),
            (install(json!({ "targets": [{}] })), no_archive),
            (
                install(json!({ "targets": [{ "archive": "x.bin" }] })),
                not_rpf,
            ),
            (
                install(json!({ "targets": [{ "archive": "a.rpf" }, { "archive": "b.bin" }, 5] })),
                not_rpf,
            ),
            (
                install(
                    json!({ "targets": [{ "archive": "a.rpf" }, { "archive": "../b.rpf" }, 5] }),
                ),
                "InvalidDataException: Unsafe RPF entry path.",
            ),
            (
                install(json!({ "targets": [{ "archive": "a.rpf" }, { "archive": "b.rpf" }] })),
                reached,
            ),
            // Q80-Q84
            (install(json!({ "archive": "update/update.rpf" })), reached),
            (
                format!(
                    r#"{{"install":{{"gameRoot":{game:?},"archive":"u.rpf","replay":{{}}}},"outputArchive":"o.rpf","operations":{OPERATIONS}}}"#
                ),
                reached,
            ),
            (
                r#"{"install":5,"operations":[]}"#.to_owned(),
                "InvalidDataException: RPF install block is not an object.",
            ),
            (
                format!(
                    r#"{{"install":{{"gameRoot":{game:?},"archive":"u.rpf","replay":{{}}}},"operations":[]}}"#
                ),
                no_operations,
            ),
            (
                format!(r#"{{"install":{{"gameRoot":{game:?},"archive":"u.rpf","replay":{{}}}}}}"#),
                no_operations,
            ),
        ];
        for (request, expected) in &table {
            let shown: String = request.chars().take(100).collect();
            assert_eq!(&cli.ask(request, &[]), expected, "{shown}");
        }
        // Q85: корень точек проверяется только после ArchiveFix, а блок разбирается раньше
        assert_eq!(
            cli.ask(
                &archive("update/update.rpf"),
                &["--restore-points-root", "relative\\points"]
            ),
            reached
        );
    }

    #[test]
    fn the_cancel_file_is_read_from_a_request_that_starts_with_a_bom() {
        let body = r#"{"cancelFile":"C:\\flag","outputArchive":"o.rpf"}"#;
        for lead in ["", "\u{feff}", "\u{feff}\u{feff}"] {
            let flag = cancel_file_of(&format!("{lead}{body}")).unwrap();
            assert_eq!(flag, Some(PathBuf::from("C:\\flag")), "{lead:?}");
        }
        assert_eq!(cancel_file_of("\u{feff}{}").unwrap(), None);
        assert!(cancel_file_of("\u{feff}not json").is_err());
    }

    #[test]
    fn a_request_text_with_an_install_block_reaches_the_install_and_makes_a_point() {
        // Q63-Q81 наоборот: блок установки с настоящим путём архива проходит разбор,
        // и установка (без настоящего ArchiveFix: сборка идёт без доводчика) делает точку
        let lab = Lab::new();
        let game = lab.dir.path().join("game");
        fs::create_dir_all(game.join("update")).unwrap();
        fs::write(game.join("GTA5.exe"), b"").unwrap();
        fs::copy(lab.base("b1"), game.join("update/update.rpf")).unwrap();
        let live = game.join("update/update.rpf");
        let original = sha256_file(&live).unwrap();
        let points = lab.dir.path().join("points");
        let source = lab.source("new.ydd");
        let text = json!({
            "install": {
                "gameRoot": game.to_string_lossy(),
                "archive": "update/update.rpf",
                "replay": { "module": "sky-rainbow" },
                "pointId": "rpf-text-0001",
                "stageName": ".astral-stage-text-0001",
            },
            "operations": [{ "entry": "x64/a/a.ydd", "source": source.to_string_lossy() }],
        })
        .to_string();
        let request = parse_request(&text).unwrap();
        let install = request.install.as_ref().unwrap();
        assert_eq!(install.archive, "update/update.rpf");
        let answer = composed_install::compose_install(
            &request,
            &quiet_keys(),
            None,
            &Progress::silent(),
            &points,
        )
        .unwrap();
        assert_eq!(answer["status"], "ready");
        assert_eq!(answer["archive"], "update/update.rpf");
        assert_eq!(answer["id"], "rpf-text-0001");
        assert_ne!(sha256_file(&live).unwrap(), original);
        let point = points.join("rpf-text-0001");
        assert_eq!(
            sha256_file(&point.join("update/update.rpf")).unwrap(),
            original
        );
        assert!(point.join("restore.json").is_file() && point.join("replay.json").is_file());

        // несколько целей: у каждой путь архива на `.rpf`
        let game = lab.dir.path().join("game2");
        fs::create_dir_all(game.join("update")).unwrap();
        fs::write(game.join("GTA5.exe"), b"").unwrap();
        fs::copy(lab.base("b1"), game.join("update/update.rpf")).unwrap();
        let prebuilt = lab.source("nested.rpf");
        let sha = sha256_file(&prebuilt).unwrap();
        let text = json!({
            "install": {
                "gameRoot": game.to_string_lossy(),
                "replay": {},
                "pointId": "rpf-text-0002",
                "targets": [
                    { "archive": "update/update.rpf", "prebuilt": prebuilt.to_string_lossy(),
                      "sha256": sha, "stageName": ".astral-stage-text-0002" },
                    { "archive": "update/x64/dlcpacks/astral_test/dlc.rpf", "create": true,
                      "prebuilt": prebuilt.to_string_lossy(), "sha256": sha,
                      "stageName": ".astral-stage-text-0003" },
                ],
            },
            "operations": [{ "entry": "x64/a/a.ydd", "source": source.to_string_lossy() }],
        })
        .to_string();
        let request = parse_request(&text).unwrap();
        let answer = composed_install::compose_install(
            &request,
            &quiet_keys(),
            None,
            &Progress::silent(),
            &points,
        )
        .unwrap();
        assert_eq!(answer["archives"][1]["created"], true);
        assert!(game
            .join("update/x64/dlcpacks/astral_test/dlc.rpf")
            .is_file());
        assert!(points.join("rpf-text-0002/restore.json").is_file());

        // без `.rpf` на конце путь архива отказывает прежним текстом
        for archive in ["update/update.bin", "update/update.rpf.bak"] {
            let text = json!({
                "install": { "gameRoot": game.to_string_lossy(), "archive": archive, "replay": {} },
                "operations": [{ "entry": "x64/a/a.ydd", "source": source.to_string_lossy() }],
            })
            .to_string();
            let error = parse_request(&text).unwrap_err();
            assert_eq!(
                error.to_string(),
                "ArgumentException: Install archive must be an .rpf file."
            );
        }
    }

    // ----- счёт записей и мёртвое место основы (страховка первой подготовки, 23.11.2026) -----

    thread_local! {
        /// Сколько файлов тест «теряет» из дерева сразу после операций (как если бы их потерял сам движок).
        pub(super) static SIMULATED_LOSS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }

    /// Только для тестов: убирает файлы из дерева после операций, не сообщая об этом допуску.
    pub(super) fn simulate_loss(tree: &mut DirNode) {
        let mut left = SIMULATED_LOSS.with(std::cell::Cell::get);
        let mut stack = vec![tree];
        while left > 0 {
            let Some(dir) = stack.pop() else { break };
            while left > 0 && !dir.files.is_empty() {
                dir.files.remove(0);
                left -= 1;
            }
            stack.extend(dir.dirs.iter_mut());
        }
    }

    fn compose_plain(lab: &Lab, label: &str, base: &str, ops: &[Op]) -> Result<Value> {
        let request = lab.request(Some(base), ops, &lab.out(label));
        compose_with(&request, &quiet_keys(), None, &Progress::silent())
    }

    #[test]
    fn the_answer_counts_the_entries_and_a_base_with_dead_space_still_passes() {
        let lab = Lab::new();
        let ops = [replace("x64/a/a.ydd", "new.ydd")];
        let tight = compose_plain(&lab, "tight", "b1", &ops).unwrap();
        let before = tight["entriesBefore"].as_u64().unwrap();
        assert!(before > 5, "{tight}");
        assert_eq!(tight["entriesAfter"].as_u64().unwrap(), before);
        let file_len = fs::metadata(lab.base("b1")).unwrap().len();
        assert_eq!(tight["fileBytesBefore"], file_len);
        let useful = tight["usefulBytesBefore"].as_u64().unwrap();
        assert!(useful > 0 && useful <= file_len, "{tight}");
        assert!(
            tight["deadBytesBefore"].as_u64().unwrap() < 512,
            "в плотно записанной основе мёртвого места нет: {tight}"
        );

        // та же основа и три мегабайта данных вне оглавления: счёт тот же, мёртвое место названо, подмена проходит, архив меньше
        let dead = lab.base("dead");
        fs::copy(lab.base("b1"), &dead).unwrap();
        let junk = 3 * 1024 * 1024;
        let mut handle = fs::OpenOptions::new().append(true).open(&dead).unwrap();
        std::io::Write::write_all(&mut handle, &vec![0u8; junk]).unwrap();
        drop(handle);
        let answer = compose_plain(&lab, "dead", "dead", &ops).unwrap();
        assert_eq!(answer["status"], "ready");
        assert_eq!(answer["entriesBefore"], tight["entriesBefore"]);
        assert_eq!(answer["entriesAfter"], tight["entriesAfter"]);
        assert_eq!(answer["usefulBytesBefore"], tight["usefulBytesBefore"]);
        assert_eq!(answer["fileBytesBefore"], file_len + junk as u64);
        assert_eq!(
            answer["deadBytesBefore"].as_u64().unwrap(),
            tight["deadBytesBefore"].as_u64().unwrap() + junk as u64
        );
        assert!(answer["bytes"].as_u64().unwrap() < file_len + junk as u64);
    }

    #[test]
    fn deleting_entries_is_not_a_loss_and_a_hollowed_astral_container_goes_with_its_content() {
        let lab = Lab::new();
        let base = compose_plain(&lab, "none", "b1", &[replace("x64/a/a.ydd", "new.ydd")]).unwrap();
        let one = compose_plain(&lab, "one", "b1", &[delete("x64/a/a.ydd")]).unwrap();
        assert_eq!(one["status"], "ready");
        assert_eq!(
            one["entriesAfter"].as_u64().unwrap(),
            base["entriesBefore"].as_u64().unwrap() - 1
        );
        // опустевший вложенный архив слоя Astral уходит из родителя: два файла, сама запись и корень архива — отказа нет
        let hollow = compose_plain(
            &lab,
            "hollow",
            "b1",
            &[delete("x64/astral/c.rpf/one.ydd"), delete("x64/astral/c.rpf/two.ydd")],
        )
        .unwrap();
        assert_eq!(hollow["status"], "ready");
        assert_eq!(
            hollow["entriesAfter"].as_u64().unwrap() + 4,
            base["entriesBefore"].as_u64().unwrap()
        );
    }

    /// Цена счёта на настоящем архиве: три прохода по оглавлению (основа, дерево, результат), три прогона. Запуск:
    /// `ASTRAL_CENSUS_COST_FILE=<update.rpf> ASTRAL_CENSUS_COST_KEYS=<папка ключей> cargo test --release -p astral-engine --lib census_cost -- --ignored --nocapture`.
    /// Разбор оглавления и вложенных (он идёт в любом случае) в цену не входит: каждый прогон открывает архив и прогревает вложенные заранее.
    #[test]
    #[ignore = "нужен настоящий update.rpf и ключи"]
    fn census_cost_on_a_real_archive() {
        let (Some(file), Some(keys)) = (
            std::env::var_os("ASTRAL_CENSUS_COST_FILE"),
            std::env::var_os("ASTRAL_CENSUS_COST_KEYS"),
        ) else {
            eprintln!("пропущен: нет ASTRAL_CENSUS_COST_FILE и ASTRAL_CENSUS_COST_KEYS");
            return;
        };
        let keys = Arc::new(KeySet::load_dir(Path::new(&keys)).unwrap());
        for run in 1..=3 {
            let open = Instant::now();
            let base = Arc::new(Archive::open_path(Path::new(&file), Some(Arc::clone(&keys))).unwrap());
            let opened = open.elapsed();
            let warm = Instant::now();
            let broken = base.unopenable_nested("").len();
            let warmed = warm.elapsed();
            let first = Instant::now();
            let counted = BaseCount::of(&base);
            let pass1 = first.elapsed();
            let build = Instant::now();
            let tree = DirNode::from_archive(&base);
            let built = build.elapsed();
            let second = Instant::now();
            let planned = census::of_tree(&tree);
            let pass2 = second.elapsed();
            let again = Archive::open_path(Path::new(&file), Some(Arc::clone(&keys))).unwrap();
            let _ = again.unopenable_nested("");
            let third = Instant::now();
            let written = census::of_archive(&again);
            let pass3 = third.elapsed();
            eprintln!(
                "прогон {run}: открытие {opened:?}, разбор вложенных {warmed:?} (неоткрывшихся {broken}), дерево {built:?}; СЧЁТ: основа {pass1:?} + дерево {pass2:?} + результат {pass3:?} = {:?}; записей {} файлов {} мёртвого {} Б",
                pass1 + pass2 + pass3,
                counted.census.entries(),
                planned.files.max(written.files),
                counted.space.dead_bytes
            );
        }
    }

    #[test]
    fn replacing_a_nested_archive_with_an_empty_one_is_not_a_loss() {
        let lab = Lab::new();
        write_tree(&dir("", vec![], vec![]), &lab.src.join("empty.rpf"));
        let kept = compose_plain(&lab, "kept", "b1", &[replace("x64/other/e.rpf", "nested2.rpf")]).unwrap();
        assert_eq!(kept["status"], "ready");
        let emptied = compose_plain(&lab, "emptied", "b1", &[replace("x64/other/e.rpf", "empty.rpf")]).unwrap();
        assert_eq!(emptied["status"], "ready", "подмена проходит: содержимое вложенного ушло вместе с ним");
        assert!(emptied["entriesAfter"].as_u64().unwrap() < emptied["entriesBefore"].as_u64().unwrap());
    }

    #[test]
    fn a_nested_archive_that_does_not_open_counts_as_one_file_and_the_base_passes() {
        let lab = Lab::new();
        // основа b4: единственная запись `pack.rpf` — не архив (чужое шифрование для проверки то же: не открывается)
        let base = Archive::open_path(&lab.base("b4"), Some(quiet_keys())).unwrap();
        let counted = census::of_archive(&base);
        assert_eq!(counted.files, 1, "неоткрывшийся вложенный — один файл");
        assert_eq!(counted, census::of_tree(&DirNode::from_archive(&Arc::new(base))));
        let answer = compose_plain(&lab, "b4", "b4", &[import("a/extra.ydd", "new.ydd")]).unwrap();
        assert_eq!(answer["status"], "ready");
        assert_eq!(answer["entriesBefore"].as_u64().unwrap(), counted.entries());
        assert_eq!(answer["entriesAfter"].as_u64().unwrap(), counted.entries() + 2, "добавлены файл и каталог");
    }

    #[test]
    fn a_loss_beyond_what_the_operations_removed_refuses_before_anything_is_written() {
        let lab = Lab::new();
        let ops = [replace("x64/a/a.ydd", "new.ydd")];
        SIMULATED_LOSS.with(|loss| loss.set(2));
        let out = lab.out("lost");
        let refused = compose_plain(&lab, "lost", "b1", &ops);
        SIMULATED_LOSS.with(|loss| loss.set(0));
        let error = refused.unwrap_err();
        assert_eq!(error.code, "InvalidDataException");
        assert!(
            error
                .message
                .starts_with("RPF compose lost entries of the base archive:"),
            "{}",
            error.message
        );
        assert!(!out.exists(), "выход не должен появиться");
        no_workshop_left(&out);
        // без потери та же сборка проходит
        assert!(compose_plain(&lab, "kept", "b1", &ops).is_ok());
    }

    #[test]
    fn the_census_check_weighs_what_was_removed_and_added_and_what_was_written() {
        let keys = quiet_keys();
        let progress = Progress::silent();
        let env = Env::new(&keys, &progress);
        let base = BaseCount {
            census: Census { files: 10, dirs: 2 },
            space: census::Space::default(),
        };
        let tree = |files| Census { files, dirs: 2 };
        assert!(env.check_census(Some(&base), tree(10), None).is_ok());
        let lost = env.check_census(Some(&base), tree(8), None).unwrap_err();
        assert!(lost.message.contains("lost entries of the base archive"));
        let plain = Body::Binary {
            data: Data::memory(Vec::new()),
            compress: Compress::Auto,
        };
        env.moves.removed_file("x.bin", &plain);
        env.moves.removed_file("y.bin", &plain);
        assert!(env.check_census(Some(&base), tree(8), None).is_ok());
        env.moves.appended();
        assert!(env.check_census(Some(&base), tree(8), None).is_err());
        assert!(env.check_census(Some(&base), tree(9), None).is_ok());
        let short = env
            .check_census(None, tree(9), Some(Census { files: 8, dirs: 2 }))
            .unwrap_err();
        assert!(short.message.contains("lost entries while writing"));
        assert!(env
            .check_census(None, tree(9), Some(Census { files: 12, dirs: 5 }))
            .is_ok());
    }
}
