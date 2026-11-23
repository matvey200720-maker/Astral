//! Команда `settle-rpf-journals`: довести оборванные записи у всех архивов
//! одним вызовом.
//!
//! Решение владельца 14.11.2026: обрыв питания при записи оглавления принимается
//! только с журналом; при старте лаунчера и перед запуском игры журнал доводится
//! сам (оглавление возвращается или дописывается). Эта команда и есть то, что зовут
//! в эти моменты. Она **не зависит от выключателей** дозаписи, слоёв и новых dlc:
//! доводить начатое надо и после того, как выключатель сняли.
//!
//! Запрос: `{ gameRoot, archives?: [относительные пути], scanRoots?: [абсолютные пути],
//! cancelFile? }`. Без `archives` ищутся все архивы под корнем игры (и под
//! `scanRoots`), рядом с которыми лежит журнал (`.astral-journal`), таблица слоёв
//! (`.astral-layers`) или маркер недостроенного dlc-архива (`.astral-building`).
//!
//! Ответ по каждому архиву: `status` и что сделано.
//!
//! | `status` | что нашли | что сделано |
//! | --- | --- | --- |
//! | `clean` | журнала нет или все записи готовы | ничего; архив не открывался |
//! | `rolledBack` | оборванная запись, новой головы целиком не было | прежние байты головы возвращены, длина прежняя |
//! | `finished` | оборванная запись, новая голова целиком на диске | запись доведена до «готово» |
//! | `foreign` | файл не тот, что оставила запись (обновление игры, проверка файлов) | ничего: файл и журнал не тронуты (`ForeignChange`) |
//! | `damaged` | журнал или маркер испорчены | ничего (`JournalDamaged`, `BuildDamaged`) |
//! | `building` | маркер недостроенного нового архива | ничего: сборку продолжает `build-rpf-dlc`, отменяет `cancel-rpf-dlc` |
//! | `refused` | архив занят (`Busy`), у файла второе имя (`Linked`), нет доступа | ничего; остальные архивы доводятся |
//!
//! У `refused`, `foreign` и `damaged` есть `error: { code, message }`. `bytesWritten` —
//! сколько байт файла записало восстановление (прежние байты головы и нули запаса
//! при откате; у `finished` и `clean` ноль). Повторный вызов ничего не меняет.
//!
//! Ключ ответа `points` (есть только когда нашлось что назвать): точки установки,
//! в описи которых названы созданные файлы (`createdFiles`, свой dlc) и нет
//! отпечатка «после» — установку оборвали. Каждая: `id`, `archive`, `record`,
//! `registered` (запись журнала точки сейчас готова) и `created` (`path`, `bytes`,
//! `present`). Команда ничего не убирает: решает приложение, откатывать ли точку
//! (`restore-rpf-point` уберёт и файлы, доказав их нашими) или довести установку.
//! Когда доводить нечего, команда читает только маленькие журналы: ни один архив не
//! читается целиком и без оборванной записи даже не открывается (а значит, не бывает
//! и занят).

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use rage_rpf::{
    activity,
    append::{AppendError, Code, Session, Settled},
    dlc,
    journal::{self, journal_path, Begin, Phase},
    layers::layers_path,
    RpfError,
};
use serde_json::{json, Map, Value};

use super::{
    append::{
        archive_in, engine_error, game_root_of, json_request, reconcile_recipes, tuning,
        EngineHost,
    },
    points, summary,
};
use crate::{
    args::Options,
    disk::WritePacer,
    error::{EngineError, Result},
    progress::Progress,
};

/// Глубина поиска под корнем игры (каталоги внутри каталогов).
const SCAN_DEPTH: usize = 10;

const SIDECARS: [&str; 3] = [".astral-journal", ".astral-layers", ".astral-building"];

/// Результат по одному архиву.
struct Row {
    archive: String,
    status: &'static str,
    journal: bool,
    layers: bool,
    record: Option<u64>,
    bytes_written: u64,
    building: Option<Value>,
    error: Option<(String, String)>,
    archive_missing: bool,
}

impl Row {
    fn new(archive: String) -> Row {
        Row {
            archive,
            status: "clean",
            journal: false,
            layers: false,
            record: None,
            bytes_written: 0,
            building: None,
            error: None,
            archive_missing: false,
        }
    }

    fn fail(&mut self, status: &'static str, code: &str, message: impl Into<String>) {
        self.status = status;
        self.error = Some((code.to_owned(), message.into()));
    }

    fn json(&self) -> Value {
        let mut row = json!({
            "archive": self.archive,
            "status": self.status,
            "journal": self.journal,
            "layers": self.layers,
            "bytesWritten": self.bytes_written,
        });
        if let Some(record) = self.record {
            row["record"] = json!(record);
        }
        if let Some(building) = &self.building {
            row["building"] = building.clone();
        }
        if self.archive_missing {
            row["archiveMissing"] = json!(true);
        }
        if let Some((code, message)) = &self.error {
            row["error"] = json!({ "code": code, "message": message });
        }
        row
    }
}

fn fold(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// Архивы, рядом с которыми лежат следы записи: журнал, таблица слоёв, маркер.
fn scan(folder: &Path, depth: usize, found: &mut BTreeMap<String, PathBuf>) {
    let Ok(listing) = fs::read_dir(folder) else {
        return;
    };
    for entry in listing.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            if depth < SCAN_DEPTH {
                scan(&path, depth + 1, found);
            }
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        for suffix in SIDECARS {
            if let Some(stem) = name.strip_suffix(suffix) {
                if stem.is_empty() {
                    continue;
                }
                let full = path.to_string_lossy();
                let archive = PathBuf::from(&full[..full.len() - suffix.len()]);
                found.entry(fold(&archive)).or_insert(archive);
            }
        }
    }
}

fn shown(root: &Path, archive: &Path) -> String {
    match archive.strip_prefix(root) {
        Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
        Err(_) => archive.to_string_lossy().replace('\\', "/"),
    }
}

/// Сколько байт файла запишет откат записи: прежние байты областей на месте и нули
/// запаса.
fn rollback_bytes(begin: &Begin) -> u64 {
    let heads: u64 = begin.in_place().map(|region| region.old.len() as u64).sum();
    heads + begin.fills.iter().map(|fill| fill.len).sum::<u64>()
}

/// Команда `settle-rpf-journals`.
pub fn settle_rpf_journals(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let map = json_request(options, progress)?;
    let game_root = game_root_of(&map)?;
    let mut answer = settle_core(&map, &game_root, progress)?;
    // брошенные удержания установки в два шага (стейдж рядом с архивом, «до»,
    // точка): ключ `holds` есть только когда что-то убрано, прочие ответы прежние
    if let Ok(points_root) = points::restore_points_root_for(options) {
        let swept = super::composed_install::settle_holds(&points_root, &game_root);
        if !swept.is_empty() {
            answer["holds"] = Value::Array(swept.iter().map(|one| one.to_json()).collect());
        }
        // точки установки, которые назвали созданные файлы и не дошли до отпечатка
        // «после»: ключ `points` есть только когда такая точка нашлась
        let waiting = unfinished_rows(&points_root, &game_root);
        if !waiting.is_empty() {
            answer["points"] = Value::Array(waiting);
        }
    }
    Ok(answer)
}

/// Недоделанные точки со своими файлами, в ответ `settle-rpf-journals`. Только
/// чтение: ничего не убирается и не откатывается (откат точки зовёт приложение,
/// когда решит, что установку не продолжать). `registered` — запись журнала точки
/// сейчас стоит готовой (после доводки выше); `present` — файл лежит названной
/// длины (хэш не читается).
fn unfinished_rows(points_root: &Path, game_root: &Path) -> Vec<Value> {
    points::unfinished_points(points_root, game_root)
        .into_iter()
        .map(|point| {
            let live = archive_in(game_root, &point.archive).ok();
            let registered = live.as_deref().is_some_and(|live| {
                matches!(
                    journal::read(&journal_path(live)),
                    Ok(Some(replay)) if replay.records.iter().any(|one| {
                        one.begin.seq == point.record && one.phase == Phase::Done
                    })
                )
            });
            let created: Vec<Value> = point
                .created
                .iter()
                .map(|file| {
                    let present = archive_in(game_root, &file.path)
                        .ok()
                        .and_then(|full| fs::metadata(full).ok())
                        .is_some_and(|facts| facts.is_file() && facts.len() == file.bytes);
                    json!({ "path": file.path, "bytes": file.bytes, "present": present })
                })
                .collect();
            json!({
                "id": point.id,
                "archive": point.archive,
                "record": point.record,
                "registered": registered,
                "created": created,
            })
        })
        .collect()
}

pub(crate) fn settle_core(
    map: &Map<String, Value>,
    game_root: &Path,
    progress: &Progress,
) -> Result<Value> {
    let began = Instant::now();
    let _hook = activity::install(Arc::new(progress.clone()));
    progress.report("settle");

    // кого смотреть: названных или всех найденных по следам
    let mut targets: Vec<(String, PathBuf)> = Vec::new();
    match map.get("archives") {
        None | Some(Value::Null) => {
            let mut found: BTreeMap<String, PathBuf> = BTreeMap::new();
            scan(game_root, 0, &mut found);
            if let Some(Value::Array(roots)) = map.get("scanRoots") {
                for root in roots {
                    let Some(text) = root.as_str() else {
                        return Err(EngineError::argument("scanRoots holds paths."));
                    };
                    let path = PathBuf::from(text);
                    if !path.is_absolute() {
                        return Err(EngineError::argument("scanRoots holds absolute paths."));
                    }
                    scan(&path, 0, &mut found);
                }
            }
            for archive in found.into_values() {
                targets.push((shown(game_root, &archive), archive));
            }
        }
        Some(Value::Array(list)) => {
            let mut seen = std::collections::BTreeSet::new();
            for item in list {
                let Some(relative) = item.as_str() else {
                    return Err(EngineError::argument("archives holds relative paths."));
                };
                let live = archive_in(game_root, relative)?;
                if seen.insert(fold(&live)) {
                    targets.push((relative.replace('\\', "/"), live));
                }
            }
        }
        Some(_) => return Err(EngineError::argument("archives is a list of paths.")),
    }
    let scanned = began.elapsed();

    let settling = Instant::now();
    let mut rows = Vec::with_capacity(targets.len());
    for (name, archive) in targets {
        progress.checkpoint()?;
        rows.push(settle_one(name, &archive)?);
    }
    let mut counts: BTreeMap<&str, u64> = BTreeMap::new();
    for key in [
        "clean",
        "rolledBack",
        "finished",
        "foreign",
        "damaged",
        "building",
        "refused",
    ] {
        counts.insert(key, 0);
    }
    for row in &rows {
        *counts.entry(row.status).or_default() += 1;
    }
    let changed = rows
        .iter()
        .any(|row| matches!(row.status, "rolledBack" | "finished"));
    Ok(json!({
        "status": "ready",
        "mode": "settle-journals",
        "scanned": rows.len(),
        "changed": changed,
        "counts": counts,
        "archives": rows.iter().map(Row::json).collect::<Vec<_>>(),
        "timings": {
            "scan": u64::try_from(scanned.as_millis()).unwrap_or(u64::MAX),
            "settle": u64::try_from(settling.elapsed().as_millis()).unwrap_or(u64::MAX),
        },
    }))
}

/// Один архив. `Err` — только отмена: остальные отказы остаются в строке архива, и
/// остальные архивы доводятся.
fn settle_one(name: String, archive: &Path) -> Result<Row> {
    let mut row = Row::new(name);
    let journal_file = journal_path(archive);
    row.journal = journal_file.is_file();
    row.layers = layers_path(archive).is_file();

    match dlc::found(archive) {
        Ok(Some(found)) => {
            row.status = "building";
            row.building = Some(json!({
                "files": found.files,
                "laid": found.laid,
                "bytes": found.total,
                "partPresent": found.part_present,
                "partBytes": found.part_len,
                "sealing": found.sealing,
                "sealed": found.sealed,
            }));
        }
        Ok(None) => {}
        Err(error) => {
            let error = engine_error(error);
            row.fail("damaged", &error.code, error.message);
            return Ok(row);
        }
    }
    if !row.journal {
        return Ok(row);
    }

    // журнал читается без архива: нечего доводить — архив не открывается вовсе
    let replay = match journal::read(&journal_file) {
        Ok(Some(replay)) => replay,
        Ok(None) => return Ok(row),
        Err(AppendError::Refused {
            code: Code::JournalDamaged,
            message,
        }) => {
            row.fail("damaged", Code::JournalDamaged.name(), message);
            return Ok(row);
        }
        Err(other) => {
            let error = engine_error(other);
            if error.code == "Cancelled" {
                return Err(error);
            }
            row.fail("refused", &error.code, error.message);
            return Ok(row);
        }
    };
    let Some(top) = replay.records.last().filter(|top| top.phase != Phase::Done) else {
        return Ok(row);
    };
    let (seq, begin) = (top.begin.seq, top.begin.clone());
    if !archive.is_file() {
        row.archive_missing = true;
        return Ok(row);
    }
    row.building = None;
    row.status = "clean";

    let lift = match points::ReadonlyLift::take_off(archive) {
        Ok(lift) => lift,
        Err(error) => {
            refuse_io(&mut row, &error);
            return Ok(row);
        }
    };
    let host = EngineHost;
    let mut session = match Session::open(&host, archive, tuning()) {
        Ok(session) => session,
        Err(AppendError::Other(RpfError::Io(error))) => {
            refuse_io(&mut row, &error);
            return Ok(row);
        }
        Err(AppendError::Refused {
            code: Code::JournalDamaged,
            message,
        }) => {
            row.fail("damaged", Code::JournalDamaged.name(), message);
            return Ok(row);
        }
        Err(other) => {
            let error = engine_error(other);
            row.fail("refused", &error.code, error.message);
            return Ok(row);
        }
    };
    let notes = summary::recipe_notes(session.replay());
    match session.settle() {
        Ok(Settled::Clean) => {}
        Ok(Settled::Completed(done)) => {
            row.status = "finished";
            row.record = Some(done);
            reconcile_recipes(&notes, session.replay());
            // удержанная дозапись (два шага): файл будущих голов больше не нужен
            let _ = fs::remove_file(rage_rpf::append::held_path(archive));
        }
        Ok(Settled::RolledBack(done)) => {
            row.status = "rolledBack";
            row.record = Some(done);
            row.bytes_written = rollback_bytes(&begin);
            reconcile_recipes(&notes, session.replay());
            let _ = fs::remove_file(rage_rpf::append::held_path(archive));
        }
        Err(AppendError::Cancelled) => return Err(EngineError::cancelled()),
        Err(AppendError::Refused {
            code: Code::ForeignChange,
            message,
        }) => {
            row.record = Some(seq);
            row.fail("foreign", Code::ForeignChange.name(), message);
        }
        Err(AppendError::Refused {
            code: Code::JournalDamaged,
            message,
        }) => row.fail("damaged", Code::JournalDamaged.name(), message),
        Err(other) => {
            let error = engine_error(other);
            row.fail("refused", &error.code, error.message);
        }
    }
    drop(session);
    drop(lift);
    Ok(row)
}

/// Файл занят или недоступен: отказ по этому архиву с кодом `Busy` и своим текстом.
fn refuse_io(row: &mut Row, error: &std::io::Error) {
    match points::trouble(error) {
        Some(points::Trouble::Busy) => row.fail(
            "refused",
            Code::Busy.name(),
            "The archive is open in another process that does not let it be written.",
        ),
        _ => {
            let engine = EngineError::from(std::io::Error::new(error.kind(), error.to_string()));
            row.fail("refused", &engine.code, engine.message);
        }
    }
}
