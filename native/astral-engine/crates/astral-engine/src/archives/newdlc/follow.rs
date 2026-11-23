//! `build-rpf-dlc` с ключом `follow`: новый dlc-архив пишется, пока сборщик пакета ещё
//! работает.
//!
//! Библиотека — `rage_rpf::dlc::follow` (раскладка, вложенные архивы на месте, маркер,
//! резюме, печать). Здесь запрос, журнал готовности, ожидание, отмена и ответ.
//!
//! Запрос — как у `build-rpf-dlc`, плюс:
//!
//! ```text
//! follow: "<абсолютный путь журнала готовности (JSONL)>"
//! followIdleMs?: 120000      // без новых строк дольше — отказ FollowStalled (часть остаётся)
//! followPollMs?: 50          // пауза опроса журнала, 5..100 мс
//! expectBytes?: N            // сколько байт займёт архив (оценка): место на томе и ход
//! ```
//!
//! Запись списка: `{ path, kind?, size?, words?, unpacked?, sha256?, source? }`. Путь —
//! от корня архива; звено на `.rpf`, не последнее, делает остаток пути записью
//! вложенного архива, который строится на месте (его запись в списке нет). `kind` не
//! назван — вид по первым байтам тела (`RSC7` — ресурс). С `source` тело берётся из
//! файла сразу (размер — длина файла), без него — приходит по журналу.
//!
//! Журнал: по одной строке JSON на строку текста, строка кончается `\n` (недописанная
//! последняя строка не читается, пока не кончится):
//!
//! ```text
//! { "path": "<запись архива>", "file": "<абсолютный путь закрытого файла>", "size": N, "sha256"?: "<64 цифры>" }
//! { "end": true }                  // сборщик кончил; все файлы названы
//! { "abort": "<причина>" }         // сборщик отказался: недостроенное убрано
//! ```

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use rage_rpf::{
    activity,
    append::{AppendError, Code, Host},
    dlc::{
        follow::{self, Follow, FollowKind, FollowSpec, Opened},
        Mode, Sealed, Settings,
    },
    journal::Digest,
    KeySet, RpfError,
};
use serde_json::{json, Map, Value};

use super::{
    argument, digest_of, hex_lower, mode_of, ms, name_of, output_of, settings_of, space, u32_of,
};
use crate::{
    archives::append::engine_error,
    error::{EngineError, Result},
    progress::Progress,
};

/// Сколько без новых строк ждать по умолчанию.
const DEFAULT_IDLE_MS: u64 = 120_000;
/// Пауза опроса журнала: по умолчанию и пределы.
const DEFAULT_POLL_MS: u64 = 50;
const MIN_POLL_MS: u64 = 5;
const MAX_POLL_MS: u64 = 100;
/// Журнал перечитывается и тогда, когда нужное тело уже есть: раз в столько,
/// чтобы заметить `abort` и `end`.
const WATCH_MS: u64 = 200;
/// Столько ожидание длится, прежде чем всё лёгшее сбрасывается на диск и в маркер.
const SETTLE_MS: u64 = 3000;
/// Сброс лёгшего на диск (и кадр в маркер) не чаще: каждый сброс на загруженном диске стоит
/// секунды, а потерянное при обрыве дописывается из файлов сборщика, которые лежат на диске
/// (из кэша системы), поэтому интервал большой. Замер: 32 МиБ — 70 с записи на ГБ, 512 МиБ — 2,4 с.
const CHECKPOINT_FILES: usize = 4096;
const CHECKPOINT_BYTES: u64 = 256 << 20;

/// Одна запись списка.
struct Entry {
    spec: FollowSpec,
    source: Option<PathBuf>,
}

/// Запрос сборки «следом».
pub(super) struct FollowRequest {
    pub(super) output: PathBuf,
    pub(super) name: String,
    entries: Vec<Entry>,
    /// Журнал готовности; `None` — режим `nested: "inplace"`: все тела названы в списке
    /// (размер и источник), ждать некого, вложенные архивы строятся на месте.
    journal: Option<PathBuf>,
    idle_ms: u64,
    poll_ms: u64,
    mode: Mode,
    settings: Settings,
    keep_on_cancel: bool,
    expect_bytes: u64,
}

/// Записей в списке не больше этого.
const MAX_ENTRIES: usize = 200_000;

fn parse_entry(value: &Value) -> Result<Entry> {
    let Value::Object(map) = value else {
        return Err(argument("An entry of the list is not an object."));
    };
    let path = map
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| argument("An entry needs a path."))?
        .to_owned();
    let len = match map.get("size") {
        None | Some(Value::Null) => None,
        Some(number) => Some(
            number
                .as_u64()
                .ok_or_else(|| argument(format!("{path}: the size is an unsigned number.")))?,
        ),
    };
    let kind = match map.get("kind") {
        None | Some(Value::Null) => {
            if map.contains_key("words") || map.contains_key("unpacked") {
                return Err(argument(format!("{path}: words and unpacked need a kind.")));
            }
            FollowKind::Auto
        }
        Some(Value::String(word)) if word == "resource" => {
            if map.contains_key("unpacked") {
                return Err(argument(format!("{path}: a resource has no unpacked size.")));
            }
            let words = match map.get("words") {
                None | Some(Value::Null) => None,
                Some(Value::Array(pair)) if pair.len() == 2 => {
                    Some((u32_of(&pair[0], "words")?, u32_of(&pair[1], "words")?))
                }
                Some(_) => return Err(argument(format!("{path}: words are two numbers."))),
            };
            FollowKind::Resource { words }
        }
        Some(Value::String(word)) if word == "binary" => {
            if map.contains_key("words") {
                return Err(argument(format!("{path}: a binary entry has no words.")));
            }
            let unpacked = match map.get("unpacked") {
                None | Some(Value::Null) => None,
                Some(number) => Some(u32_of(number, "unpacked")?),
            };
            FollowKind::Binary { unpacked }
        }
        Some(_) => {
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
        spec: FollowSpec {
            path,
            kind,
            len,
            sha256,
        },
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

/// Длина архива не выше потолка запроса и не выше предела режима.
fn check_limit(total: u64, max_bytes: u64) -> Result<()> {
    let limit = max_bytes.min(follow::FOLLOW_LIMIT);
    if total > limit {
        return Err(EngineError::new(
            Code::ArchiveTooLarge.name(),
            format!("The archive would be {total} bytes; the limit is {limit} bytes."),
        ));
    }
    Ok(())
}

fn journal_of(map: &Map<String, Value>) -> Result<PathBuf> {
    let Some(Value::String(text)) = map.get("follow") else {
        return Err(argument("follow is the absolute path of the readiness journal."));
    };
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(argument("The journal path must be absolute."));
    }
    Ok(path)
}

fn number_of(map: &Map<String, Value>, key: &str, default: u64, low: u64, high: u64) -> Result<u64> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(value) => value
            .as_u64()
            .filter(|number| (low..=high).contains(number))
            .ok_or_else(|| argument(format!("{key} is a number from {low} to {high}."))),
    }
}

/// Ключ `nested`: `"inplace"` — вложенные архивы строятся на месте внутри корня из записей
/// с путём через `<имя>.rpf/…`, размеры и источники названы заранее, журнала нет; `"staged"`
/// и отсутствие ключа — прежнее поведение (вложенные отдельными файлами, корень берёт их
/// готовыми).
pub(super) fn is_inplace(map: &Map<String, Value>) -> Result<bool> {
    match map.get("nested") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::String(word)) if word == "inplace" => Ok(true),
        Some(Value::String(word)) if word == "staged" => Ok(false),
        Some(_) => Err(argument("nested is \"inplace\" or \"staged\".")),
    }
}

/// Режим `nested: "inplace"`: у каждой записи названы вид, размер и источник (всё, что
/// нужно, чтобы положить тело без ожидания и посчитать длину файла до первого байта).
fn check_inplace(map: &Map<String, Value>, entries: &[Entry]) -> Result<()> {
    if map.contains_key("follow") {
        return Err(argument("nested inplace has no readiness journal: follow cannot be named with it."));
    }
    for entry in entries {
        let path = &entry.spec.path;
        if entry.spec.kind == FollowKind::Auto {
            return Err(argument(format!("{path}: nested inplace needs the kind (\"resource\" or \"binary\").")));
        }
        if entry.spec.len.is_none() {
            return Err(argument(format!("{path}: nested inplace needs the size.")));
        }
        if entry.source.is_none() {
            return Err(argument(format!("{path}: nested inplace needs the source.")));
        }
    }
    Ok(())
}

pub(super) fn parse_request(map: &Map<String, Value>) -> Result<FollowRequest> {
    if map.get("seal").and_then(Value::as_bool) == Some(false) {
        return Err(argument("A following build is always sealed: seal false is not supported."));
    }
    let inplace = is_inplace(map)?;
    let output = output_of(map)?;
    let (mut settings, keep_on_cancel) = settings_of(map)?;
    let point = map.get("checkpoint").and_then(Value::as_object);
    if point.is_none_or(|point| !point.contains_key("files")) {
        settings.checkpoint_files = CHECKPOINT_FILES;
    }
    if point.is_none_or(|point| !point.contains_key("bytes")) {
        settings.checkpoint_bytes = CHECKPOINT_BYTES;
    }
    let name = name_of(map, &output)?;
    let entries = parse_entries(map)?;
    let mut expect_bytes = number_of(map, "expectBytes", 0, 0, u64::MAX)?;
    let journal = if inplace {
        check_inplace(map, &entries)?;
        // длина файла известна до первого байта: отказ по потолку и нехватке места — до записи, а файл
        // занимается сразу итоговой длиной, как у обычной сборки
        let specs: Vec<FollowSpec> = entries.iter().map(|entry| entry.spec.clone()).collect();
        let total = follow::sized_totals(&name, &specs).map_err(engine_error)?[0];
        check_limit(total, settings.max_bytes)?;
        if expect_bytes == 0 {
            expect_bytes = total;
        }
        None
    } else {
        Some(journal_of(map)?)
    };
    Ok(FollowRequest {
        name,
        output,
        entries,
        journal,
        idle_ms: number_of(map, "followIdleMs", DEFAULT_IDLE_MS, 1, u64::MAX)?,
        poll_ms: number_of(map, "followPollMs", DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS)?,
        mode: mode_of(map)?,
        settings,
        keep_on_cancel,
        expect_bytes,
    })
}

// ---------------------------------------------------------------------------
// layout-rpf-plan с ключом follow
// ---------------------------------------------------------------------------

/// Раскладка плана по именам: порядок, в котором сборщику выгодно отдавать файлы
/// (в нём тела и ложатся), длины голов, вложенные архивы.
pub(super) fn plan_follow(map: &Map<String, Value>) -> Result<Value> {
    let began = Instant::now();
    let entries = parse_entries(map)?;
    let name = match map.get("output") {
        None | Some(Value::Null) => name_of(map, Path::new("dlc.rpf"))?,
        Some(_) => name_of(map, &output_of(map)?)?,
    };
    let specs: Vec<FollowSpec> = entries.iter().map(|entry| entry.spec.clone()).collect();
    let described = follow::describe(&name, &specs).map_err(engine_error)?;
    let order: Vec<Value> = described
        .order
        .iter()
        .enumerate()
        .map(|(at, &index)| json!({ "order": at, "index": index, "path": specs[index].path }))
        .collect();
    let archives: Vec<Value> = described
        .archives
        .iter()
        .map(|archive| {
            json!({
                "path": archive.path,
                "name": archive.name,
                "headBytes": archive.head_len,
                "entries": archive.entries,
                "rows": archive.rows,
            })
        })
        .collect();
    Ok(json!({
        "status": "ready",
        "mode": "layout-plan",
        "follow": true,
        "archiveName": name,
        "files": specs.len(),
        "headBytes": described.archives[0].head_len,
        "archives": archives,
        "planHash": hex_lower(&follow::follow_plan_hash(&name, &specs)),
        "order": order,
        "timings": { "plan": ms(began) },
    }))
}

/// `layout-rpf-plan` с `nested: "inplace"`: то же, что у `follow`, плюс длины (все размеры названы):
/// `bytes` — длина готового файла, `archives[].bytes` — длина каждого архива дерева; с `output` — ещё место
/// на томе, оставленная сборка (`building`) и `outputExists`, как у обычного плана.
pub(super) fn plan_inplace(map: &Map<String, Value>) -> Result<Value> {
    let began = Instant::now();
    let entries = parse_entries(map)?;
    check_inplace(map, &entries)?;
    let output = match map.get("output") {
        None | Some(Value::Null) => None,
        Some(_) => Some(output_of(map)?),
    };
    let name = match &output {
        Some(path) => name_of(map, path)?,
        None => name_of(map, Path::new("dlc.rpf"))?,
    };
    let (settings, _) = settings_of(map)?;
    let specs: Vec<FollowSpec> = entries.iter().map(|entry| entry.spec.clone()).collect();
    let described = follow::describe(&name, &specs).map_err(engine_error)?;
    let totals = follow::sized_totals(&name, &specs).map_err(engine_error)?;
    check_limit(totals[0], settings.max_bytes)?;
    let order: Vec<Value> = described
        .order
        .iter()
        .enumerate()
        .map(|(at, &index)| json!({ "order": at, "index": index, "path": specs[index].path }))
        .collect();
    let archives: Vec<Value> = described
        .archives
        .iter()
        .zip(&totals)
        .map(|(archive, total)| {
            json!({
                "path": archive.path,
                "name": archive.name,
                "headBytes": archive.head_len,
                "bytes": total,
                "entries": archive.entries,
                "rows": archive.rows,
            })
        })
        .collect();
    let mut answer = json!({
        "status": "ready",
        "mode": "layout-plan",
        "nested": "inplace",
        "archiveName": name,
        "bytes": totals[0],
        "headBytes": described.archives[0].head_len,
        "bodyBytes": totals[0] - described.archives[0].head_len,
        "files": specs.len(),
        "archives": archives,
        "planHash": hex_lower(&follow::follow_plan_hash(&name, &specs)),
        "order": order,
    });
    if let Some(output) = &output {
        super::add_output_facts(&mut answer, output, totals[0])?;
    }
    answer["timings"] = json!({ "plan": ms(began) });
    Ok(answer)
}

// ---------------------------------------------------------------------------
// Журнал готовности
// ---------------------------------------------------------------------------

/// Файл, который сборщик объявил готовым.
struct Ready {
    file: PathBuf,
    size: Option<u64>,
    sha: Option<Digest>,
}

#[derive(Default)]
struct Journal {
    path: PathBuf,
    offset: u64,
    carry: Vec<u8>,
    lines: u64,
    ended: bool,
    aborted: Option<String>,
    /// Строка, которую разобрать не вышло: отказ ждёт, пока сборка дойдёт до неё. Всё,
    /// что названо раньше, успевает лечь (резюме с исправленным журналом идёт дальше).
    broken: Option<(Code, String)>,
}

fn bad(code: Code, text: impl Into<String>) -> AppendError {
    AppendError::refused(code, text)
}

impl Journal {
    fn new(path: PathBuf) -> Journal {
        Journal {
            path,
            ..Journal::default()
        }
    }

    /// Читает новые целые строки; каждая готовая запись попадает в `ready`. Возвращает
    /// число разобранных строк. После `end` и `abort` журнал не читается.
    fn pull(
        &mut self,
        index_of: &HashMap<String, usize>,
        seen: &mut HashSet<String>,
        ready: &mut HashMap<String, Ready>,
    ) -> std::result::Result<usize, AppendError> {
        if self.ended || self.aborted.is_some() || self.broken.is_some() || self.path.as_os_str().is_empty() {
            return Ok(0);
        }
        let mut file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error.into()),
        };
        let len = file.metadata()?.len();
        if len < self.offset {
            return Err(bad(
                Code::FollowBadLine,
                "The journal became shorter than it was read.",
            ));
        }
        if len == self.offset {
            return Ok(0);
        }
        file.seek(SeekFrom::Start(self.offset))?;
        let mut fresh = Vec::with_capacity((len - self.offset).min(1 << 24) as usize);
        file.take(len - self.offset).read_to_end(&mut fresh)?;
        self.offset += fresh.len() as u64;
        self.carry.extend_from_slice(&fresh);
        let mut taken = 0usize;
        let mut parsed = 0usize;
        while let Some(end) = self.carry[taken..].iter().position(|&byte| byte == b'\n') {
            let line = self.carry[taken..taken + end].to_vec();
            taken += end + 1;
            if line.iter().all(|byte| byte.is_ascii_whitespace()) {
                continue;
            }
            self.lines += 1;
            parsed += 1;
            match self.line(&line, index_of, seen, ready) {
                Ok(()) => {}
                Err(AppendError::Refused { code, message }) => {
                    self.broken = Some((code, message));
                    break;
                }
                Err(other) => return Err(other),
            }
            if self.ended || self.aborted.is_some() {
                break;
            }
        }
        self.carry.drain(..taken);
        Ok(parsed)
    }

    fn line(
        &mut self,
        line: &[u8],
        index_of: &HashMap<String, usize>,
        seen: &mut HashSet<String>,
        ready: &mut HashMap<String, Ready>,
    ) -> std::result::Result<(), AppendError> {
        let number = self.lines;
        let broken = |what: &str| {
            bad(
                Code::FollowBadLine,
                format!("Line {number} of the journal is not valid: {what}."),
            )
        };
        let text = std::str::from_utf8(line).map_err(|_| broken("not UTF-8"))?;
        let value: Value =
            serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| broken("not JSON"))?;
        let Value::Object(map) = value else {
            return Err(broken("not an object"));
        };
        if let Some(reason) = map.get("abort") {
            self.aborted = Some(match reason {
                Value::String(text) if !text.is_empty() => text.clone(),
                _ => "aborted".to_owned(),
            });
            return Ok(());
        }
        if let Some(end) = map.get("end") {
            if end.as_bool() != Some(true) {
                return Err(broken("end is true"));
            }
            self.ended = true;
            return Ok(());
        }
        let path = map
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| broken("no path"))?;
        let file = map
            .get("file")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .filter(|file| file.is_absolute())
            .ok_or_else(|| broken("no absolute file"))?;
        let size = map
            .get("size")
            .and_then(Value::as_u64)
            .ok_or_else(|| broken("no size"))?;
        let sha = match map.get("sha256") {
            None | Some(Value::Null) => None,
            Some(Value::String(text)) => Some(digest_of(text).ok_or_else(|| broken("sha256"))?),
            Some(_) => return Err(broken("sha256")),
        };
        if !index_of.contains_key(path) {
            return Err(bad(
                Code::FollowUnknown,
                format!("The journal names {path:?}, which is not in the plan (line {number})."),
            ));
        }
        if !seen.insert(path.to_owned()) {
            return Err(bad(
                Code::FollowDuplicate,
                format!("The journal names {path:?} twice (line {number})."),
            ));
        }
        ready.insert(
            path.to_owned(),
            Ready {
                file,
                size: Some(size),
                sha,
            },
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------

fn room(output: &Path, bytes: u64) -> std::result::Result<(), AppendError> {
    let folder = output.parent().unwrap_or(output);
    let need = space::required_bytes(&[bytes]);
    let free =
        space::free_bytes(folder).map_err(|error| AppendError::Other(RpfError::state(error.message)))?;
    space::check_space(folder, free, need)
        .map_err(|error| AppendError::Other(RpfError::state(error.message)))
}

/// Что ждёт цикл.
struct Waiting {
    began: Instant,
    settled: bool,
}

/// Ядро: открыть сборку, класть тела по мере их готовности, напечатать.
pub(super) fn build_follow(
    request: &FollowRequest,
    keys: Option<Arc<KeySet>>,
    progress: &Progress,
    host: &dyn Host,
) -> Result<Value> {
    let began = Instant::now();
    let _hook = activity::install(Arc::new(progress.clone()));
    progress.checkpoint()?;
    progress.report("plan");
    let specs: Vec<FollowSpec> = request.entries.iter().map(|entry| entry.spec.clone()).collect();
    let index_of: HashMap<String, usize> = specs
        .iter()
        .enumerate()
        .map(|(at, spec)| (spec.path.clone(), at))
        .collect();
    let mut room_check = |floor: u64| room(&request.output, floor.max(request.expect_bytes));
    let opened = Follow::open(
        host,
        &request.output,
        &request.name,
        specs.clone(),
        request.settings,
        keys,
        request.mode,
        request.expect_bytes,
        &mut room_check,
    )
    .map_err(engine_error)?;
    let plan_ms = ms(began);
    let mut build = match opened {
        Opened::Finished(done) => {
            let mut answer = sealed_answer(request, &done, None, plan_ms, 0, 0, None);
            super::stamp_answer(&mut answer, &request.output, host);
            return Ok(answer);
        }
        Opened::Build(build) => build,
    };
    let at_open = build.counts();
    let mut laid_bytes = at_open.bytes_laid;
    let mut read_bytes = 0u64;

    // что сборщик уже отдал: файлы из списка с `source` готовы сразу
    let mut seen: HashSet<String> = HashSet::new();
    let mut ready: HashMap<String, Ready> = HashMap::new();
    for entry in &request.entries {
        if let Some(source) = &entry.source {
            seen.insert(entry.spec.path.clone());
            ready.insert(
                entry.spec.path.clone(),
                Ready {
                    file: source.clone(),
                    size: entry.spec.len,
                    sha: None,
                },
            );
        }
    }
    let mut journal = Journal::new(request.journal.clone().unwrap_or_default());

    let laying_began = Instant::now();
    let mut waited = Duration::ZERO;
    let outcome = (|| -> std::result::Result<(), AppendError> {
        let mut last_motion = Instant::now();
        let mut last_pull = Instant::now();
        let mut wait: Option<Waiting> = None;
        let mut step = 0u32;
        while let Some(want) = build.want() {
            progress.checkpoint().map_err(|_| AppendError::Cancelled)?;
            // журнал читается, когда нужного тела нет, и время от времени, чтобы
            // заметить `abort`
            let have = ready.contains_key(&want.path);
            if !have || last_pull.elapsed() >= Duration::from_millis(WATCH_MS) {
                let lines = journal.pull(&index_of, &mut seen, &mut ready)?;
                last_pull = Instant::now();
                if lines > 0 {
                    last_motion = Instant::now();
                }
                if let Some(reason) = &journal.aborted {
                    return Err(bad(
                        Code::FollowAborted,
                        format!("The builder gave up: {reason}."),
                    ));
                }
            }
            if let Some(item) = ready.remove(&want.path) {
                if let Some(waiting) = wait.take() {
                    waited += waiting.began.elapsed();
                }
                step = 0;
                let mut file = File::open(&item.file).map_err(|error| {
                    bad(
                        Code::FollowBadLine,
                        format!("The file named for {} cannot be opened: {error}.", want.path),
                    )
                })?;
                let len = file.metadata()?.len();
                if item.size.is_some_and(|size| size != len) {
                    return Err(bad(
                        Code::SizeMismatch,
                        format!(
                            "The file of {} has {len} bytes; the journal names {}.",
                            want.path,
                            item.size.unwrap_or(0)
                        ),
                    ));
                }
                build.lay_checked(len, item.sha, &mut file, &mut |taken| {
                    progress.wrote(taken);
                    laid_bytes += taken;
                    read_bytes += taken;
                    progress.report_bytes(
                        "dlc",
                        laid_bytes,
                        request.expect_bytes.max(laid_bytes + 1),
                    );
                })?;
                last_motion = Instant::now();
                continue;
            }
            // без журнала (`nested: "inplace"`) каждое тело названо в списке: ждать некого
            if request.journal.is_none() {
                return Err(bad(
                    Code::FollowIncomplete,
                    format!("The body of {} has no source and there is no journal to wait for.", want.path),
                ));
            }
            // тела нет: журнал кончился, испорчен или сборщик ещё работает
            if let Some((code, text)) = journal.broken.clone() {
                return Err(bad(code, text));
            }
            if journal.ended {
                return Err(bad(
                    Code::FollowIncomplete,
                    format!(
                        "The journal ended, but {} was never announced ({} of {} bodies are laid).",
                        want.path,
                        build.counts().laid,
                        build.counts().files
                    ),
                ));
            }
            let waiting = wait.get_or_insert_with(|| Waiting {
                began: Instant::now(),
                settled: false,
            });
            if !waiting.settled && waiting.began.elapsed() >= Duration::from_millis(SETTLE_MS) {
                // долго ждём: всё лёгшее сбрасывается, чтобы обрыв его не потерял
                build.checkpoint()?;
                waiting.settled = true;
            }
            if last_motion.elapsed() >= Duration::from_millis(request.idle_ms) {
                return Err(bad(
                    Code::FollowStalled,
                    format!(
                        "The journal has no news for {} ms; waiting for {} ({} of {} bodies are laid).",
                        request.idle_ms,
                        want.path,
                        build.counts().laid,
                        build.counts().files
                    ),
                ));
            }
            let pause = (MIN_POLL_MS << step.min(4)).min(request.poll_ms);
            step += 1;
            thread::sleep(Duration::from_millis(pause));
        }
        Ok(())
    })();
    let write_ms = ms(laying_began);
    let wait_ms = u64::try_from(waited.as_millis()).unwrap_or(u64::MAX);

    if let Err(error) = outcome {
        let aborted = matches!(&error, AppendError::Refused { code, .. } if *code == Code::FollowAborted);
        return match error {
            // сборщик отказался или отмена с уборкой: недостроенное убирается
            AppendError::Cancelled if !request.keep_on_cancel => {
                let _ = build.discard();
                Err(EngineError::cancelled())
            }
            other if aborted => {
                let _ = build.discard();
                Err(engine_error(other))
            }
            other => {
                // всё лёгшее сбрасывается и попадает в маркер: резюме продолжит отсюда
                let _ = build.pause();
                Err(engine_error(other))
            }
        };
    }
    let counts = build.counts();
    progress.report("seal");
    match build.seal() {
        Ok(sealed) => {
            let mut answer = sealed_answer(
                request,
                &sealed,
                Some((counts.resumed_files, counts.archives)),
                plan_ms,
                write_ms.saturating_sub(wait_ms),
                wait_ms,
                Some((journal.lines, read_bytes)),
            );
            super::stamp_answer(&mut answer, &request.output, host);
            Ok(answer)
        }
        Err(error) => Err(engine_error(error)),
    }
}

fn sealed_answer(
    request: &FollowRequest,
    sealed: &Sealed,
    counts: Option<(usize, usize)>,
    plan_ms: u64,
    write_ms: u64,
    wait_ms: u64,
    journal: Option<(u64, u64)>,
) -> Value {
    let mut answer = json!({
        "status": "ready",
        "mode": "build-dlc",
        "follow": request.journal.is_some(),
        "output": request.output.to_string_lossy(),
        "archiveName": request.name,
        "sealed": true,
        "files": sealed.files,
        "archives": counts.map_or(0, |c| c.1),
        "entries": sealed.entries,
        "resumedFiles": counts.map_or(0, |c| c.0),
        "resumedBytes": sealed.bytes_resumed,
        "bytes": sealed.bytes,
        "bytesWritten": sealed.bytes_written,
        "bytesRead": journal.map_or(0, |j| j.1),
        "journalLines": journal.map_or(0, |j| j.0),
        "headBytes": sealed.head_len,
        "sha256": hex_lower(&sealed.sha256),
        "hashStreamed": sealed.hash_streamed,
        "verified": sealed.verified.word(),
        "alreadyInPlace": sealed.already_in_place,
        "timings": {
            "plan": plan_ms,
            "write": write_ms,
            "wait": wait_ms,
            "seal": sealed.seal_ms,
            "verify": sealed.verify_ms,
        },
    });
    if request.journal.is_none() {
        answer["nested"] = json!("inplace");
    }
    answer
}

#[cfg(test)]
mod tests;
