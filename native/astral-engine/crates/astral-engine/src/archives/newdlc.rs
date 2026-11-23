//! Новый dlc-архив из потока: команды `layout-rpf-plan`, `build-rpf-dlc`,
//! `seal-rpf-dlc`, `cancel-rpf-dlc`, `verify-rpf-dlc`, `release-rpf-dlc`.
//!
//! Проект этапа 3, раздел 6 (E3-3). Писатель — `rage_rpf::dlc`: тела ложатся в
//! `<архив>.astral-part` по плану размеров, голова пишется последней, рядом маркер
//! `<архив>.astral-building`. Здесь запросы, ответы, коды, место на томе и то, что
//! знает только движок (номер файла, точки обрыва для стендов, ход и отмена).
//!
//! Все команды этого файла — под выключателем `ASTRAL_ENGINE_NEWDLC` (слова модулей
//! через запятую, как у `ASTRAL_ENGINE_APPEND`; слово — `module` или `replay.module`
//! запроса); без него отказывают `ArgumentException`, на диск ничего не ложится.
//!
//! Запись записи (одна строка списка):
//!
//! ```text
//! { path, kind: "resource" | "binary", size,
//!   unpacked?,          // binary: тело лежит сжатым, это длина данных после распаковки
//!   words?: [sys, gfx], // resource: слова RSC7; названы все — голова известна заранее
//!   sha256?,            // SHA-256 тела так, как оно придёт
//!   source? }           // build: файл, откуда берутся байты (абсолютный путь)
//! ```
//!
//! Общие ключи запроса: `output` (абсолютный путь готового `.rpf`), `archiveName`
//! (по умолчанию имя файла `output`: по нему и по длине выбирается ключ шифра
//! оглавления), `entries`, `module`, `cancelFile`; `verify`: `table`, `sample`
//! (по умолчанию) или `full`; `mode`: `auto` (по умолчанию), `fresh`, `resume`;
//! `onCancel`: `keep` (по умолчанию, файл и маркер остаются для резюме) или `remove`;
//! `checkpoint: { files, bytes }`; `maxBytes` (потолок длины архива, по умолчанию
//! 3,3 ГБ, не выше предела формата).

use std::{
    env,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, UNIX_EPOCH},
};

use rage_rpf::{
    activity,
    append::{parse_digest, AppendError, Code, Host},
    dlc::{self, Build, Counts, Mode, Opened, Sealed, Settings, Spec, Verify},
    journal::Digest,
    read_pace,
    toc::{read_toc, Toc},
    write::sized::{SizedFile, SizedKind, SizedPlan},
    Encryption, FileSource, KeySet, RpfError,
};
use serde_json::{json, Map, Value};
use sha2::{Digest as _, Sha256};

mod follow;

use super::{
    append::{command_keys, engine_error, enabled_for, json_request, EngineHost},
    hex_lower, points, space,
};
use crate::{
    args::Options,
    disk::WritePacer,
    error::{EngineError, Result},
    progress::Progress,
};

/// Выключатель новых dlc-архивов: слова модулей через запятую.
pub const NEWDLC_ENV: &str = "ASTRAL_ENGINE_NEWDLC";

/// Записей в списке не больше этого.
const MAX_ENTRIES: usize = 200_000;
/// Предел формата: блок 0x7fffff на 512 байт.
const FORMAT_LIMIT: u64 = 0x7f_ffff * 512;

fn argument(text: impl Into<String>) -> EngineError {
    EngineError::argument(text)
}

fn module_of(map: &Map<String, Value>) -> &str {
    map.get("module")
        .and_then(Value::as_str)
        .or_else(|| {
            map.get("replay")
                .and_then(|replay| replay.get("module"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
}

/// Без выключателя команда отказывает до любого действия.
pub(crate) fn gate(map: &Map<String, Value>, list: Option<&str>) -> Result<()> {
    if enabled_for(module_of(map), list) {
        Ok(())
    } else {
        Err(argument("New dlc archives are not enabled."))
    }
}

fn gate_env(map: &Map<String, Value>) -> Result<()> {
    gate(map, env::var(NEWDLC_ENV).ok().as_deref())
}

// ---------------------------------------------------------------------------
// Разбор запроса
// ---------------------------------------------------------------------------

/// Одна запись списка.
#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub(crate) path: String,
    pub(crate) kind: SizedKind,
    pub(crate) size: u64,
    pub(crate) sha256: Option<Digest>,
    pub(crate) source: Option<PathBuf>,
}

fn digest_of(text: &str) -> Option<Digest> {
    // ровно 64 цифры: форма `a1:…` здесь не годится
    (text.len() == 64).then(|| parse_digest(text)).flatten()
}

fn u32_of(value: &Value, what: &str) -> Result<u32> {
    value
        .as_u64()
        .and_then(|number| u32::try_from(number).ok())
        .ok_or_else(|| argument(format!("{what} must be an unsigned 32-bit number.")))
}

fn parse_entry(value: &Value) -> Result<Entry> {
    let Value::Object(map) = value else {
        return Err(argument("An entry of the list is not an object."));
    };
    let path = map
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| argument("An entry needs a path."))?
        .to_owned();
    let size = map
        .get("size")
        .and_then(Value::as_u64)
        .ok_or_else(|| argument(format!("{path}: the size is required.")))?;
    let kind = match map.get("kind").and_then(Value::as_str) {
        Some("resource") => {
            if map.contains_key("unpacked") {
                return Err(argument(format!("{path}: a resource has no unpacked size.")));
            }
            let words = match map.get("words") {
                None | Some(Value::Null) => None,
                Some(Value::Array(pair)) if pair.len() == 2 => Some((
                    u32_of(&pair[0], "words")?,
                    u32_of(&pair[1], "words")?,
                )),
                Some(_) => return Err(argument(format!("{path}: words are two numbers."))),
            };
            SizedKind::Resource { words }
        }
        Some("binary") => {
            if map.contains_key("words") {
                return Err(argument(format!("{path}: a binary entry has no words.")));
            }
            let unpacked = match map.get("unpacked") {
                None | Some(Value::Null) => None,
                Some(number) => Some(u32_of(number, "unpacked")?),
            };
            SizedKind::Binary { unpacked }
        }
        _ => {
            return Err(argument(format!(
                "{path}: the kind is \"resource\" or \"binary\"."
            )))
        }
    };
    let sha256 = match map.get("sha256") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(
            digest_of(text)
                .ok_or_else(|| argument(format!("{path}: sha256 is 64 hexadecimal digits.")))?,
        ),
        Some(_) => return Err(argument(format!("{path}: sha256 is a string."))),
    };
    let source = match map.get("source") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => {
            let given = PathBuf::from(text);
            if !given.is_absolute() {
                return Err(argument(format!("{path}: the source path must be absolute.")));
            }
            Some(given)
        }
        Some(_) => return Err(argument(format!("{path}: source is a path."))),
    };
    Ok(Entry {
        path,
        kind,
        size,
        sha256,
        source,
    })
}

fn parse_entries(map: &Map<String, Value>) -> Result<Vec<Entry>> {
    let Some(Value::Array(list)) = map.get("entries") else {
        return Err(argument("The list of entries is required."));
    };
    if list.is_empty() || list.len() > MAX_ENTRIES {
        return Err(argument(format!(
            "The list must hold from 1 to {MAX_ENTRIES} entries."
        )));
    }
    list.iter().map(parse_entry).collect()
}

fn specs_of(entries: &[Entry]) -> Vec<Spec> {
    entries
        .iter()
        .map(|entry| Spec {
            file: SizedFile {
                path: entry.path.clone(),
                kind: entry.kind,
                len: entry.size,
            },
            sha256: entry.sha256,
        })
        .collect()
}

/// Запрос сборки и плана.
pub(crate) struct DlcRequest {
    pub(crate) output: PathBuf,
    pub(crate) name: String,
    pub(crate) entries: Vec<Entry>,
    pub(crate) mode: Mode,
    pub(crate) settings: Settings,
    pub(crate) keep_on_cancel: bool,
}

fn output_of(map: &Map<String, Value>) -> Result<PathBuf> {
    let Some(text) = map.get("output").and_then(Value::as_str) else {
        return Err(argument("The output path is required."));
    };
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(argument("The output path must be absolute."));
    }
    let lowered = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !lowered.ends_with(".rpf") {
        return Err(argument("The output file must have the .rpf extension."));
    }
    Ok(path)
}

fn name_of(map: &Map<String, Value>, output: &Path) -> Result<String> {
    let name = match map.get("archiveName") {
        None | Some(Value::Null) => output
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        Some(Value::String(text)) => text.clone(),
        Some(_) => return Err(argument("archiveName is a string.")),
    };
    if name.is_empty() || !name.is_ascii() || !name.to_ascii_lowercase().ends_with(".rpf") {
        return Err(argument("The archive name must be ASCII and end with .rpf."));
    }
    Ok(name)
}

fn settings_of(map: &Map<String, Value>) -> Result<(Settings, bool)> {
    let mut settings = Settings::default();
    if let Some(word) = map.get("verify") {
        settings.verify = word
            .as_str()
            .and_then(Verify::from_word)
            .ok_or_else(|| argument("verify is \"table\", \"sample\" or \"full\"."))?;
    }
    if let Some(Value::Object(point)) = map.get("checkpoint") {
        if let Some(files) = point.get("files").and_then(Value::as_u64) {
            settings.checkpoint_files = usize::try_from(files.max(1)).unwrap_or(usize::MAX);
        }
        if let Some(bytes) = point.get("bytes").and_then(Value::as_u64) {
            settings.checkpoint_bytes = bytes.max(1);
        }
    }
    if let Some(limit) = map.get("maxBytes") {
        let limit = limit
            .as_u64()
            .filter(|&n| n > 0 && n <= FORMAT_LIMIT)
            .ok_or_else(|| argument("maxBytes is a number up to the format limit."))?;
        settings.max_bytes = limit;
    }
    let keep = match map.get("onCancel").and_then(Value::as_str) {
        None | Some("keep") => true,
        Some("remove") => false,
        Some(_) => return Err(argument("onCancel is \"keep\" or \"remove\".")),
    };
    Ok((settings, keep))
}

fn mode_of(map: &Map<String, Value>) -> Result<Mode> {
    match map.get("mode").and_then(Value::as_str) {
        None | Some("auto") => Ok(Mode::Auto),
        Some("fresh") => Ok(Mode::Fresh),
        Some("resume") => Ok(Mode::ResumeOnly),
        Some(_) => Err(argument("mode is \"auto\", \"fresh\" or \"resume\".")),
    }
}

pub(crate) fn parse_request(map: &Map<String, Value>) -> Result<DlcRequest> {
    let output = output_of(map)?;
    let (settings, keep_on_cancel) = settings_of(map)?;
    Ok(DlcRequest {
        name: name_of(map, &output)?,
        output,
        entries: parse_entries(map)?,
        mode: mode_of(map)?,
        settings,
        keep_on_cancel,
    })
}

// ---------------------------------------------------------------------------
// Место на томе
// ---------------------------------------------------------------------------

/// Для новой сборки на томе должно хватить длины файла и запаса.
fn check_room(output: &Path, plan: &SizedPlan) -> std::result::Result<(), AppendError> {
    let folder = output.parent().unwrap_or(output);
    let need = space::required_bytes(&[plan.size()]);
    let free = space::free_bytes(folder).map_err(|error| AppendError::Other(RpfError::state(error.message)))?;
    space::check_space(folder, free, need)
        .map_err(|error| AppendError::Other(RpfError::state(error.message)))
}

fn ms(since: Instant) -> u64 {
    u64::try_from(since.elapsed().as_millis()).unwrap_or(u64::MAX)
}

// ---------------------------------------------------------------------------
// layout-rpf-plan
// ---------------------------------------------------------------------------

/// Команда `layout-rpf-plan`: раскладка нового архива по размерам, без единого
/// байта на диск. С `output` отвечает ещё про место на томе и про оставленную
/// сборку (`building`).
///
/// Запрос: `{ entries, archiveName?, output?, places?: bool, maxBytes?, module }`.
pub fn layout_rpf_plan(options: &Options, progress: &Progress) -> Result<Value> {
    let map = json_request(options, progress)?;
    gate_env(&map)?;
    plan_core(&map)
}

/// Про место назначения: хватает ли на томе (`space`), есть ли оставленная сборка (`building`) и лежит ли
/// уже файл (`outputExists`). Нехватка места при отсутствии оставленной сборки — отказ до первого байта.
pub(crate) fn add_output_facts(answer: &mut Value, output: &Path, size: u64) -> Result<()> {
    let building = dlc::found(output).map_err(engine_error)?;
    let resumable = building.as_ref().is_some_and(|found| found.files > 0);
    let folder = output.parent().unwrap_or(output);
    let free = space::free_bytes(folder).ok();
    let needed = if resumable {
        0
    } else {
        space::required_bytes(&[size])
    };
    answer["space"] = json!({
        "needed": needed,
        "free": free,
        "enough": free.is_none_or(|free| free >= needed),
    });
    if free.is_some_and(|free| free < needed) && !resumable {
        space::check_space(folder, free.unwrap_or(0), needed)?;
    }
    answer["building"] = match building {
        Some(found) => json!({
            "laid": found.laid,
            "files": found.files,
            "partBytes": found.part_len,
            "partPresent": found.part_present,
            "sealing": found.sealing,
            "sealed": found.sealed,
        }),
        None => Value::Null,
    };
    answer["outputExists"] = json!(output.exists());
    Ok(())
}

pub(crate) fn plan_core(map: &Map<String, Value>) -> Result<Value> {
    if map.contains_key("follow") {
        // записи без размеров: порядок тел и головы по именам
        return follow::plan_follow(map);
    }
    if follow::is_inplace(map)? {
        // вложенные архивы на месте: размеры и источники названы, длины считаются заранее
        return follow::plan_inplace(map);
    }
    let began = Instant::now();
    let entries = parse_entries(map)?;
    let output = match map.get("output") {
        None | Some(Value::Null) => None,
        Some(_) => Some(output_of(map)?),
    };
    let name = match &output {
        Some(path) => name_of(map, path)?,
        None => name_of(map, Path::new("dlc.rpf"))?,
    };
    let (settings, _) = settings_of(map)?;
    let specs = specs_of(&entries);
    let plan = SizedPlan::prepare(specs.iter().map(|spec| spec.file.clone()).collect())
        .map_err(engine_error)?;
    if plan.size() > settings.max_bytes {
        return Err(EngineError::new(
            Code::ArchiveTooLarge.name(),
            format!(
                "The archive would be {} bytes; the limit is {} bytes.",
                plan.size(),
                settings.max_bytes
            ),
        ));
    }
    let bodies: u64 = (0..plan.files().len()).map(|input| plan.place(input).span).sum();
    let mut answer = json!({
        "status": "ready",
        "mode": "layout-plan",
        "archiveName": name,
        "bytes": plan.size(),
        "headBytes": plan.head_len(),
        "bodyBytes": bodies,
        "files": plan.files().len(),
        "entries": plan.entries(),
        "wordsKnown": plan.words_known(),
        "planHash": hex_lower(&dlc::plan_hash(&name, &specs)),
    });
    if let Some(output) = &output {
        add_output_facts(&mut answer, output, plan.size())?;
    }
    if map.get("places").and_then(Value::as_bool) == Some(true) {
        let places: Vec<Value> = plan
            .order()
            .iter()
            .enumerate()
            .map(|(order, &input)| {
                let place = plan.place(input);
                json!({
                    "index": input,
                    "path": plan.files()[input].path,
                    "order": order,
                    "offset": place.offset,
                    "length": place.len,
                    "span": place.span,
                })
            })
            .collect();
        answer["places"] = Value::Array(places);
    }
    answer["timings"] = json!({ "plan": ms(began) });
    Ok(answer)
}

// ---------------------------------------------------------------------------
// build-rpf-dlc и seal-rpf-dlc
// ---------------------------------------------------------------------------

/// Что делает вызов сборки.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    /// Положить тела из источников; печатать, если `seal`.
    Build { seal: bool },
    /// Только печать: все тела уже легли.
    Seal,
}

/// Команда `build-rpf-dlc`: тела из файлов-источников ложатся в новый архив по
/// плану, голова последней; оставленная сборка продолжается с границы последнего
/// сброшенного файла. С `seal: false` вызов только кладёт тела.
pub fn build_rpf_dlc(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let map = json_request(options, progress)?;
    gate_env(&map)?;
    if map.contains_key("follow") || follow::is_inplace(&map)? {
        // новый архив пишется следом за сборщиком пакета (размеры приходят по журналу) или с вложенными
        // архивами на месте (`nested: "inplace"`: всё названо в списке, журнала нет)
        let request = follow::parse_request(&map)?;
        let hint = options.optional("game-root").unwrap_or_default();
        let keys = command_keys(options, hint)?;
        return follow::build_follow(&request, Some(keys), progress, &EngineHost);
    }
    let request = parse_request(&map)?;
    let seal = map.get("seal").and_then(Value::as_bool).unwrap_or(true);
    let hint = options.optional("game-root").unwrap_or_default();
    let keys = command_keys(options, hint)?;
    build_core(
        &request,
        Some(keys),
        progress,
        &EngineHost,
        Action::Build { seal },
    )
}

/// Команда `seal-rpf-dlc`: печать архива, у которого все тела уже легли (после
/// `build-rpf-dlc` с `seal: false` или после обрыва во время печати).
pub fn seal_rpf_dlc(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let map = json_request(options, progress)?;
    gate_env(&map)?;
    let mut request = parse_request(&map)?;
    request.mode = Mode::ResumeOnly;
    let hint = options.optional("game-root").unwrap_or_default();
    let keys = command_keys(options, hint)?;
    build_core(&request, Some(keys), progress, &EngineHost, Action::Seal)
}

/// Ядро: открыть сборку, положить недостающие тела, напечатать.
pub(crate) fn build_core(
    request: &DlcRequest,
    keys: Option<Arc<KeySet>>,
    progress: &Progress,
    host: &dyn Host,
    action: Action,
) -> Result<Value> {
    let began = Instant::now();
    let _hook = activity::install(Arc::new(progress.clone()));
    // отмена до начала: ни файла, ни маркера не создаётся
    progress.checkpoint()?;
    progress.report("plan");
    let specs = specs_of(&request.entries);
    let mut room = |plan: &SizedPlan| check_room(&request.output, plan);
    let opened = Build::open_checked(
        host,
        &request.output,
        &request.name,
        specs,
        request.settings,
        keys,
        request.mode,
        &mut room,
    )
    .map_err(engine_error)?;
    let plan_ms = ms(began);
    let mut build = match opened {
        Opened::Finished(done) => {
            let mut answer = sealed_answer(request, &done, None, plan_ms, 0);
            stamp_answer(&mut answer, &request.output, host);
            return Ok(answer);
        }
        Opened::Build(build) => build,
    };
    let counts_at_open = build.counts();
    let total = counts_at_open.total;
    let mut laid_bytes = counts_at_open.bytes_laid;

    let laying = Instant::now();
    let outcome = (|| -> std::result::Result<(), AppendError> {
        if action == Action::Seal {
            return Ok(());
        }
        while let Some(index) = build.next() {
            progress.checkpoint().map_err(|_| AppendError::Cancelled)?;
            let entry = &request.entries[index];
            let Some(source) = &entry.source else {
                return Err(AppendError::Other(RpfError::argument(format!(
                    "The source of {} is not given.",
                    entry.path
                ))));
            };
            let mut file = File::open(source)?;
            let len = file.metadata()?.len();
            if len != entry.size {
                return Err(AppendError::refused(
                    Code::SizeMismatch,
                    format!(
                        "The source of {} has {len} bytes; the list names {}.",
                        entry.path, entry.size
                    ),
                ));
            }
            build.put(index, &mut file, &mut |taken| {
                progress.wrote(taken);
                laid_bytes += taken;
                progress.report_bytes("dlc", laid_bytes, total);
            })?;
        }
        Ok(())
    })();
    let write_ms = ms(laying);

    if let Err(error) = outcome {
        return match error {
            AppendError::Cancelled if !request.keep_on_cancel => {
                // уборка: недостроенный файл и маркер уходят
                let _ = build.discard();
                Err(EngineError::cancelled())
            }
            other => {
                // всё лёгшее сбрасывается и попадает в маркер: резюме продолжит отсюда
                let _ = build.pause();
                Err(engine_error(other))
            }
        };
    }
    let counts = build.counts();
    if matches!(action, Action::Build { seal: false }) {
        build.pause().map_err(engine_error)?;
        return Ok(laid_answer(request, &counts, plan_ms, write_ms));
    }
    progress.report("seal");
    match build.seal() {
        Ok(sealed) => {
            let mut answer = sealed_answer(request, &sealed, Some(counts), plan_ms, write_ms);
            stamp_answer(&mut answer, &request.output, host);
            Ok(answer)
        }
        Err(error) => Err(engine_error(error)),
    }
}

fn laid_answer(request: &DlcRequest, counts: &Counts, plan_ms: u64, write_ms: u64) -> Value {
    json!({
        "status": "laid",
        "mode": "build-dlc",
        "output": request.output.to_string_lossy(),
        "archiveName": request.name,
        "sealed": false,
        "files": counts.files,
        "laid": counts.laid,
        "resumedFiles": counts.resumed_files,
        "resumedBytes": counts.resumed_bytes,
        "bytes": counts.total,
        "timings": { "plan": plan_ms, "write": write_ms },
    })
}

fn sealed_answer(
    request: &DlcRequest,
    sealed: &Sealed,
    counts: Option<Counts>,
    plan_ms: u64,
    write_ms: u64,
) -> Value {
    json!({
        "status": "ready",
        "mode": "build-dlc",
        "output": request.output.to_string_lossy(),
        "archiveName": request.name,
        "sealed": true,
        "files": sealed.files,
        "entries": sealed.entries,
        "resumedFiles": counts.map_or(0, |c| c.resumed_files),
        "resumedBytes": sealed.bytes_resumed,
        "bytes": sealed.bytes,
        "bytesWritten": sealed.bytes_written,
        "headBytes": sealed.head_len,
        "sha256": hex_lower(&sealed.sha256),
        "hashStreamed": sealed.hash_streamed,
        "verified": sealed.verified.word(),
        "alreadyInPlace": sealed.already_in_place,
        "timings": {
            "plan": plan_ms,
            "write": write_ms,
            "seal": sealed.seal_ms,
            "verify": sealed.verify_ms,
        },
    })
}

// ---------------------------------------------------------------------------
// cancel-rpf-dlc
// ---------------------------------------------------------------------------

/// Команда `cancel-rpf-dlc`: недостроенный файл и маркер убираются, если файл
/// доказан нашим (длина, номер файла, начало). Чужой файл на его месте не
/// трогается: `BuildForeign`. Повтор безопасен.
///
/// Запрос: `{ output, module }`.
pub fn cancel_rpf_dlc(options: &Options, progress: &Progress) -> Result<Value> {
    let map = json_request(options, progress)?;
    gate_env(&map)?;
    cancel_core(&map, &EngineHost)
}

pub(crate) fn cancel_core(map: &Map<String, Value>, host: &dyn Host) -> Result<Value> {
    let output = output_of(map)?;
    let done = dlc::cancel_unfinished(host, &output).map_err(engine_error)?;
    Ok(json!({
        "status": "ready",
        "mode": "cancel-dlc",
        "output": output.to_string_lossy(),
        "partRemoved": done.part_removed,
        "markerRemoved": done.marker_removed,
        "freedBytes": done.freed,
    }))
}

// ---------------------------------------------------------------------------
// verify-rpf-dlc и release-rpf-dlc
// ---------------------------------------------------------------------------

/// SHA-256 файла с ходом и отменой: куски по 4 МиБ под потолком чтения.
fn hash_file(path: &Path, progress: &Progress) -> Result<(Digest, u64)> {
    let mut file = File::open(path)?;
    let total = file.metadata()?.len();
    let mut sum = Sha256::new();
    let mut buffer = vec![0u8; 4 << 20];
    let mut done = 0u64;
    loop {
        progress.checkpoint()?;
        let got = file.read(&mut buffer)?;
        if got == 0 {
            break;
        }
        read_pace::pace_read(got as u64);
        sum.update(&buffer[..got]);
        done += got as u64;
        progress.report_bytes("verify", done, total);
    }
    Ok((sum.finalize().into(), total))
}

/// Что сверка узнала о файле.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    Intact { bytes: u64 },
    Damaged { bytes: Option<u64>, reason: &'static str },
    Missing,
}

/// Сверка по ожидаемым длине и SHA-256; ничего не меняет. Длина сверяется первой:
/// файл другой длины не читается.
pub(crate) fn check_file(
    path: &Path,
    bytes: u64,
    sha256: &Digest,
    progress: &Progress,
) -> Result<Verdict> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Verdict::Missing),
        Err(error) => return Err(error.into()),
    };
    if !meta.is_file() {
        return Ok(Verdict::Damaged {
            bytes: None,
            reason: "notAFile",
        });
    }
    if meta.len() != bytes {
        return Ok(Verdict::Damaged {
            bytes: Some(meta.len()),
            reason: "length",
        });
    }
    let (digest, len) = hash_file(path, progress)?;
    if &digest != sha256 {
        return Ok(Verdict::Damaged {
            bytes: Some(len),
            reason: "sha256",
        });
    }
    Ok(Verdict::Intact { bytes: len })
}

/// Номер файла и время изменения готового архива, как они были при печати.
/// Приложение хранит отметку строкой `fileId` (`<том>:<номер>:<время>`: два числа
/// шестнадцатеричных и время в наносекундах от начала эпохи) и отдаёт её быстрой
/// проверке. Подмена файла меняет номер на томе, правка на месте — время.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FileStamp {
    pub(crate) volume: u64,
    pub(crate) index: u64,
    pub(crate) modified: u128,
}

fn all_of(text: &str, digit: fn(&u8) -> bool) -> bool {
    !text.is_empty() && text.bytes().all(|byte| digit(&byte))
}

impl FileStamp {
    /// Отметка открытого файла. `None`, если система не называет номер файла
    /// или время изменения не читается.
    fn of(file: &File, host: &dyn Host) -> std::io::Result<Option<FileStamp>> {
        let Some((volume, index)) = host.facts(file)?.identity else {
            return Ok(None);
        };
        let modified = file
            .metadata()?
            .modified()
            .ok()
            .and_then(|moment| moment.duration_since(UNIX_EPOCH).ok())
            .map(|since| since.as_nanos());
        Ok(modified.map(|modified| FileStamp {
            volume,
            index,
            modified,
        }))
    }

    fn text(&self) -> String {
        format!("{:x}:{:x}:{}", self.volume, self.index, self.modified)
    }

    /// Разбор строки `fileId`; негодная форма — `None`.
    pub(crate) fn parse(text: &str) -> Option<FileStamp> {
        let mut parts = text.split(':');
        let (volume, index, modified) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some()
            || !all_of(volume, u8::is_ascii_hexdigit)
            || !all_of(index, u8::is_ascii_hexdigit)
            || !all_of(modified, u8::is_ascii_digit)
        {
            return None;
        }
        Some(FileStamp {
            volume: u64::from_str_radix(volume, 16).ok()?,
            index: u64::from_str_radix(index, 16).ok()?,
            modified: modified.parse().ok()?,
        })
    }
}

/// Кладёт в ответ сборки ключ `fileId` готового файла (`null`, если номер файла
/// или время узнать нельзя: тогда быстрой проверки нет, остаётся полная).
pub(crate) fn stamp_answer(answer: &mut Value, path: &Path, host: &dyn Host) {
    let stamp = File::open(path)
        .ok()
        .and_then(|file| FileStamp::of(&file, host).ok().flatten());
    answer["fileId"] = stamp.map_or(Value::Null, |stamp| json!(stamp.text()));
}

/// Файл занят другим процессом — отказ `Busy`, прочие ошибки как есть.
fn read_refusal(path: &Path, error: std::io::Error) -> EngineError {
    match points::trouble(&error) {
        Some(points::Trouble::Busy) => EngineError::new(
            Code::Busy.name(),
            format!("{} is in use by another process.", path.display()),
        ),
        _ => EngineError::from(error),
    }
}

/// Быстрая проверка готового dlc, без чтения тел: длина, номер файла и время
/// изменения те же, что при печати, а голова читается строгим читателем (NG, ключ
/// по имени и длине файла: «открылось перебором ключей» не годится). Порча в телах
/// при тех же длине, номере и времени ею не видна: это полная сверка по хэшу.
pub(crate) fn check_stat(
    path: &Path,
    bytes: u64,
    stamp: &FileStamp,
    name: &str,
    keys: &KeySet,
    host: &dyn Host,
) -> Result<Verdict> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Verdict::Missing),
        Err(error) => return Err(error.into()),
    };
    if !meta.is_file() {
        return Ok(Verdict::Damaged {
            bytes: None,
            reason: "notAFile",
        });
    }
    let damaged = |reason: &'static str| {
        Ok(Verdict::Damaged {
            bytes: Some(meta.len()),
            reason,
        })
    };
    if meta.len() != bytes {
        return damaged("length");
    }
    let file = File::open(path).map_err(|error| read_refusal(path, error))?;
    match FileStamp::of(&file, host).map_err(|error| read_refusal(path, error))? {
        Some(now) if now.volume == stamp.volume && now.index == stamp.index => {
            if now.modified != stamp.modified {
                return damaged("modified");
            }
        }
        _ => return damaged("fileId"),
    }
    let source = FileSource::from_file(file).map_err(|error| read_refusal(path, error))?;
    match read_toc(&source, name, Some(keys)) {
        Ok(Toc {
            encryption: Encryption::Ng,
            ng_key_index: Some(found),
            ..
        }) if found == keys.ng_key_index(name, bytes) => Ok(Verdict::Intact { bytes }),
        Err(RpfError::Io(error)) => Err(read_refusal(path, error)),
        _ => damaged("head"),
    }
}

/// Режим сверки `verify-rpf-dlc`: `true` — быстрая (`mode: "stat"`). Нет ключа,
/// `null` и `"full"` — прежняя полная сверка по хэшу.
fn quick_mode(map: &Map<String, Value>) -> Result<bool> {
    match map.get("mode") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::String(word)) if word == "full" => Ok(false),
        Some(Value::String(word)) if word == "stat" => Ok(true),
        Some(_) => Err(argument("mode is \"full\" or \"stat\".")),
    }
}

/// Запрос быстрой сверки: путь, длина, отметка `fileId` и имя архива (по нему и
/// по длине выбран ключ головы). Хэш не нужен, но названный обязан быть годным.
fn quick_expectation(map: &Map<String, Value>) -> Result<(PathBuf, u64, FileStamp, String)> {
    let Some(text) = map.get("path").and_then(Value::as_str) else {
        return Err(argument("The path is required."));
    };
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(argument("The path must be absolute."));
    }
    let bytes = map
        .get("bytes")
        .and_then(Value::as_u64)
        .ok_or_else(|| argument("The expected length (bytes) is required."))?;
    match map.get("sha256") {
        None | Some(Value::Null) => {}
        Some(Value::String(text)) if digest_of(text).is_some() => {}
        Some(_) => return Err(argument("The expected sha256 is 64 hexadecimal digits.")),
    }
    let stamp = map
        .get("fileId")
        .and_then(Value::as_str)
        .and_then(FileStamp::parse)
        .ok_or_else(|| {
            argument("fileId is \"<volume>:<index>:<time>\", as the build answer gave it.")
        })?;
    let name = name_of(map, &path)?;
    Ok((path, bytes, stamp, name))
}

fn expectation(map: &Map<String, Value>) -> Result<(PathBuf, u64, Digest)> {
    let Some(text) = map.get("path").and_then(Value::as_str) else {
        return Err(argument("The path is required."));
    };
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(argument("The path must be absolute."));
    }
    let bytes = map
        .get("bytes")
        .and_then(Value::as_u64)
        .ok_or_else(|| argument("The expected length (bytes) is required."))?;
    let sha256 = map
        .get("sha256")
        .and_then(Value::as_str)
        .and_then(digest_of)
        .ok_or_else(|| argument("The expected sha256 is 64 hexadecimal digits."))?;
    Ok((path, bytes, sha256))
}

fn partial_bytes(path: &Path) -> Option<u64> {
    fs::metadata(dlc::part_path(path)).map(|meta| meta.len()).ok()
}

/// Команда `verify-rpf-dlc`: цел ли готовый dlc-архив. По пути, ожидаемой длине и
/// SHA-256 отвечает `intact`, `damaged` или `missing`, ничего не меняя. Годится
/// для «Починить»: цел — не трогать, иначе качать заново. `bytes` в ответе — сколько
/// файл занимает на диске, `partialBytes` — сколько занимает недостроенный файл
/// рядом (если есть).
///
/// Запрос: `{ path, bytes, sha256, module }`.
///
/// С `mode: "stat"` сверка быстрая, без чтения тел: `{ path, bytes, fileId,
/// archiveName?, sha256?, module }` — длина, номер файла и время изменения те же,
/// что при печати (`fileId` из ответа `build-rpf-dlc`), и голова читается строгим
/// читателем. В ответе ключ `check: "stat"`; причины порчи: `notAFile`, `length`,
/// `fileId`, `modified`, `head`. Занятый файл — отказ `Busy`. Это быстрый вопрос
/// «тот ли файл», а не доказательство тел: для него остаётся полная сверка по хэшу
/// (`mode` не задан или `"full"`), её ответы прежние.
pub fn verify_rpf_dlc(options: &Options, progress: &Progress) -> Result<Value> {
    let map = json_request(options, progress)?;
    gate_env(&map)?;
    if quick_mode(&map)? {
        let (path, bytes, stamp, name) = quick_expectation(&map)?;
        let hint = options.optional("game-root").unwrap_or_default();
        let keys = command_keys(options, hint)?;
        return verify_stat_core(&path, bytes, &stamp, &name, &keys, progress, &EngineHost);
    }
    let (path, bytes, sha256) = expectation(&map)?;
    verify_core(&path, bytes, &sha256, progress)
}

/// Ответ сверки: что нашлось на месте файла.
fn verdict_answer(path: &Path, verdict: Verdict) -> Value {
    let mut answer = json!({
        "status": "ready",
        "mode": "verify-dlc",
        "path": path.to_string_lossy(),
        "partialBytes": partial_bytes(path),
    });
    match verdict {
        Verdict::Intact { bytes } => {
            answer["verdict"] = json!("intact");
            answer["bytes"] = json!(bytes);
        }
        Verdict::Damaged { bytes, reason } => {
            answer["verdict"] = json!("damaged");
            answer["reason"] = json!(reason);
            answer["bytes"] = json!(bytes);
        }
        Verdict::Missing => {
            answer["verdict"] = json!("missing");
            answer["bytes"] = Value::Null;
        }
    }
    answer
}

pub(crate) fn verify_core(
    path: &Path,
    bytes: u64,
    sha256: &Digest,
    progress: &Progress,
) -> Result<Value> {
    let began = Instant::now();
    progress.report("verify");
    let verdict = check_file(path, bytes, sha256, progress)?;
    let mut answer = verdict_answer(path, verdict);
    answer["timings"] = json!({ "verify": ms(began) });
    Ok(answer)
}

/// Быстрая сверка (`mode: "stat"`): ответ как у полной с ключом `check`.
pub(crate) fn verify_stat_core(
    path: &Path,
    bytes: u64,
    stamp: &FileStamp,
    name: &str,
    keys: &KeySet,
    progress: &Progress,
    host: &dyn Host,
) -> Result<Value> {
    let began = Instant::now();
    progress.report("verify");
    let verdict = check_stat(path, bytes, stamp, name, keys, host)?;
    let mut answer = verdict_answer(path, verdict);
    answer["check"] = json!("stat");
    answer["timings"] = json!({ "verify": ms(began) });
    Ok(answer)
}

/// Команда `release-rpf-dlc` («освободить место»): удаляет свой dlc-архив, только
/// если он доказанно наш: длина и SHA-256 равны ожидаемым. Чужой или испорченный
/// файл не удаляется: `NotOurs`. Нет файла — нечего освобождать (`released: false`).
/// Другие имена того же файла (`also`, например жёсткая ссылка в `dlcpacks`) убираются
/// вместе с ним; ссылка на тот же файл (тот же номер файла) считается нашей без
/// второго чтения.
///
/// Запрос: `{ path, bytes, sha256, also?: [путь], module }`.
pub fn release_rpf_dlc(options: &Options, progress: &Progress) -> Result<Value> {
    let map = json_request(options, progress)?;
    gate_env(&map)?;
    let (path, bytes, sha256) = expectation(&map)?;
    let mut also = Vec::new();
    if let Some(Value::Array(items)) = map.get("also") {
        for item in items {
            let text = item
                .as_str()
                .ok_or_else(|| argument("also holds paths."))?;
            let given = PathBuf::from(text);
            if !given.is_absolute() {
                return Err(argument("also holds absolute paths."));
            }
            also.push(given);
        }
    }
    release_core(&path, &also, bytes, &sha256, progress, &EngineHost)
}

fn identity_of(path: &Path, host: &dyn Host) -> Option<((u64, u64), Option<u64>)> {
    let file = File::open(path).ok()?;
    let facts = host.facts(&file).ok()?;
    facts.identity.map(|identity| (identity, facts.links))
}

pub(crate) fn release_core(
    path: &Path,
    also: &[PathBuf],
    bytes: u64,
    sha256: &Digest,
    progress: &Progress,
    host: &dyn Host,
) -> Result<Value> {
    let began = Instant::now();
    progress.report("verify");
    let main = match check_file(path, bytes, sha256, progress)? {
        Verdict::Missing => {
            return Ok(json!({
                "status": "ready",
                "mode": "release-dlc",
                "path": path.to_string_lossy(),
                "released": false,
                "verdict": "missing",
                "freedBytes": 0,
                "timings": { "verify": ms(began) },
            }));
        }
        Verdict::Damaged { reason, .. } => {
            return Err(EngineError::new(
                Code::NotOurs.name(),
                format!(
                    "The file is not the archive that was built ({reason} differs); it is left alone."
                ),
            ));
        }
        Verdict::Intact { bytes } => bytes,
    };
    let main_identity = identity_of(path, host);
    // другие имена: тот же файл по номеру или такие же длина и SHA-256
    let mut names = vec![path.to_path_buf()];
    for other in also {
        if !other.exists() {
            continue;
        }
        let same_file = main_identity.is_some()
            && identity_of(other, host).map(|(id, _)| id) == main_identity.map(|(id, _)| id);
        if !same_file {
            match check_file(other, bytes, sha256, progress)? {
                Verdict::Intact { .. } => {}
                _ => {
                    return Err(EngineError::new(
                        Code::NotOurs.name(),
                        format!(
                            "{} is not the archive that was built; nothing was removed.",
                            other.display()
                        ),
                    ))
                }
            }
        }
        names.push(other.clone());
    }
    let verified = ms(began);
    // сколько имён у файла осталось бы после уборки названных
    let other_names = main_identity
        .and_then(|(_, links)| links)
        .is_some_and(|links| links > names.len() as u64);
    for name in &names {
        let _lift = points::ReadonlyLift::take_off(name)?;
        if let Err(error) = fs::remove_file(name) {
            return Err(match points::trouble(&error) {
                Some(points::Trouble::Busy) => EngineError::new(
                    Code::Busy.name(),
                    format!("{} is in use by another process.", name.display()),
                ),
                _ => EngineError::from(error),
            });
        }
    }
    Ok(json!({
        "status": "ready",
        "mode": "release-dlc",
        "path": path.to_string_lossy(),
        "released": true,
        "verdict": "intact",
        "removedNames": names.len(),
        "freedBytes": if other_names { 0 } else { main },
        "otherNames": other_names,
        "timings": { "verify": verified, "total": ms(began) },
    }))
}

