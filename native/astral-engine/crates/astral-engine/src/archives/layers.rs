//! Слои дозаписи в движке: команда `switch-rpf-layers` и сведения для полного пути.
//!
//! Слой из одних добавлений кладёт дозапись с ключом `install.layer` (под
//! выключателем `ASTRAL_ENGINE_LAYERS`, см. `append.rs`). Эта команда включает и
//! выключает такие слои сменой оглавления: запись журнала без хвоста, длина файла
//! не меняется (кроме нового тела реестра). Писатель и формат таблицы слоёв —
//! `rage_rpf::{append::switch, layers}`.
//!
//! Запрос (файл `--request`):
//!
//! ```text
//! { gameRoot, archive,
//!   enable?: [id], disable?: [id], remove?: [id],
//!   registry?: { entry, source },       // общая запись корня и файл с её новым телом
//!   saveRecipe?: <путь сводного рецепта>,
//!   baseSha256?, expectState?,
//!   replay?: { module }, module?, cancelFile? }
//! ```
//!
//! `module` (или `replay.module`) — слово модуля из списка выключателя. Без
//! выключателя команда отказывает `ArgumentException`, файл не тронут.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
    sync::Arc,
};

use rage_rpf::{
    activity,
    append::{
        parse_digest, Ahead, AppendError, Code, RegistryInput, RegistryReport, SwitchAll,
        SwitchReport, Tuning, KEEP_KEY_PAD_MAX,
    },
    journal::{self, journal_path},
    layers::{layers_path, LayerSet, Status},
    Archive, KeySet, RpfError,
};
use serde_json::{json, Map, Value};

use super::{
    append::{
        command_keys, engine_error, layers_enabled_for, open_session, reconcile_recipes,
        settled_value, tuning, EngineHost, RecipeTrack, LAYERS_ENV,
    },
    compose::{Action, Operation},
    points,
    summary::{self, Summary},
};
use crate::{
    args::Options,
    disk::WritePacer,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Файл с новым телом реестра не больше этого (это XML в килобайты).
pub(super) const REGISTRY_MAX: u64 = 64 << 20;

/// Общих записей в одном запросе не больше стольких.
const REGISTRY_ROWS_MAX: usize = 64;

/// Общая запись корня и файл, где лежит её новое содержимое.
struct RegistryRequest {
    entry: String,
    source: PathBuf,
}

/// Запрос `switch-rpf-layers`.
pub(crate) struct SwitchRequest {
    game_root: PathBuf,
    archive: String,
    enable: Vec<String>,
    disable: Vec<String>,
    remove: Vec<String>,
    registry: Vec<RegistryRequest>,
    /// `registry` назван списком: в ответе он тоже список. Прежний вид (один
    /// объект) отвечает объектом, как раньше.
    registry_list: bool,
    save_recipe: Option<PathBuf>,
    base_sha256: Option<[u8; 32]>,
    expect_state: Option<String>,
    /// Ключ `keepKey` (R4): файл растёт до длины с прежним ключом головы, как у
    /// дозаписи с `install.keepKey`. По умолчанию выключен: байты и ответ прежние.
    keep_key: bool,
    /// Ключ `tailPad`: хвост по правилу `rage_rpf::tail` после записи.
    tail_pad: bool,
    replay: Value,
}

/// Одна ли это запись: звенья те же, регистр ASCII не важен.
fn same_entry(left: &str, right: &str) -> bool {
    let parts = |text: &str| -> Vec<String> {
        text.split('/')
            .filter(|part| !part.is_empty())
            .map(str::to_ascii_lowercase)
            .collect()
    };
    parts(left) == parts(right)
}

fn layer_id(text: &str) -> bool {
    (1..=64).contains(&text.len()) && text.is_ascii() && !text.chars().any(|c| c.is_ascii_control())
}

fn id_list(map: &Map<String, Value>, key: &str) -> Result<Vec<String>> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) if items.len() <= 4096 => {
            let mut out: Vec<String> = Vec::new();
            for item in items {
                match item.as_str() {
                    Some(id) if layer_id(id) => {
                        if !out.iter().any(|known| known == id) {
                            out.push(id.to_owned());
                        }
                    }
                    _ => return Err(EngineError::argument("Layer id is invalid.")),
                }
            }
            Ok(out)
        }
        Some(_) => Err(EngineError::argument("Layer list is invalid.")),
    }
}

pub(crate) fn parse_request(map: &Map<String, Value>, game_root: PathBuf) -> Result<SwitchRequest> {
    let Some(archive) = map.get("archive").and_then(Value::as_str) else {
        return Err(EngineError::argument("Archive path is required."));
    };
    let absolute = |key: &str| -> Result<Option<PathBuf>> {
        match map.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(text)) if Path::new(text).is_absolute() => {
                Ok(Some(PathBuf::from(text)))
            }
            Some(_) => Err(EngineError::argument(format!(
                "Switch {key} must be absolute."
            ))),
        }
    };
    let row = |object: &Map<String, Value>| -> Result<RegistryRequest> {
        let entry = object.get("entry").and_then(Value::as_str);
        let source = object.get("source").and_then(Value::as_str);
        match (entry, source) {
            (Some(entry), Some(source))
                if !entry.trim().is_empty() && Path::new(source).is_absolute() =>
            {
                Ok(RegistryRequest {
                    entry: entry.trim().replace('\\', "/"),
                    source: PathBuf::from(source),
                })
            }
            _ => Err(EngineError::argument("Switch registry is invalid.")),
        }
    };
    // одна запись (прежний вид, отвечает объектом) или список общих записей
    let (registry, registry_list) = match map.get("registry") {
        None | Some(Value::Null) => (Vec::new(), false),
        Some(Value::Object(object)) => (vec![row(object)?], false),
        Some(Value::Array(items)) if items.len() <= REGISTRY_ROWS_MAX => {
            let mut rows: Vec<RegistryRequest> = Vec::with_capacity(items.len());
            for item in items {
                let Value::Object(object) = item else {
                    return Err(EngineError::argument("Switch registry is invalid."));
                };
                rows.push(row(object)?);
            }
            for (at, one) in rows.iter().enumerate() {
                if rows[..at]
                    .iter()
                    .any(|before| same_entry(&before.entry, &one.entry))
                {
                    return Err(EngineError::argument(
                        "Switch registry entry is named twice.",
                    ));
                }
            }
            (rows, true)
        }
        Some(_) => return Err(EngineError::argument("Switch registry is invalid.")),
    };
    let base_sha256 = match map.get("baseSha256") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(
            parse_digest(text)
                .ok_or_else(|| EngineError::argument("Switch base sha256 is invalid."))?,
        ),
        Some(_) => return Err(EngineError::argument("Switch base sha256 is invalid.")),
    };
    let expect_state = match map.get("expectState") {
        None | Some(Value::Null) => None,
        Some(Value::String(state)) if !state.is_empty() => Some(state.clone()),
        Some(_) => return Err(EngineError::argument("Switch expectState is invalid.")),
    };
    // длина файла держит ключ головы (R4): `true` или `false`; нет или `null` — нет
    let keep_key = match map.get("keepKey") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(on)) => *on,
        Some(_) => return Err(EngineError::argument("Switch keepKey is invalid.")),
    };
    let tail_pad = match map.get("tailPad") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(on)) => *on,
        Some(_) => return Err(EngineError::argument("Switch tailPad is invalid.")),
    };
    // слово модуля — там же, где у установки: в записи переигрывания
    let replay = match (map.get("replay"), map.get("module")) {
        (Some(record), _) if record.is_object() => record.clone(),
        (_, Some(Value::String(module))) => json!({ "module": module }),
        _ => json!({}),
    };
    Ok(SwitchRequest {
        game_root,
        archive: archive.to_owned(),
        enable: id_list(map, "enable")?,
        disable: id_list(map, "disable")?,
        remove: id_list(map, "remove")?,
        registry,
        registry_list,
        save_recipe: absolute("saveRecipe")?,
        base_sha256,
        expect_state,
        keep_key,
        tail_pad,
        replay,
    })
}

/// Команда `switch-rpf-layers`: слои включаются и выключаются сменой оглавления.
///
/// Ответ: `{ status, mode: "switch-layers", archive, changed, record, merged,
/// fingerprint, fingerprintBefore, bytes, bytesWritten, headBytes, switched: {
/// enabled, disabled, removed }, layers: [{id, state}], deadBytes, dormantBytes,
/// journalRecords, registry, recovered, recipe?, timings }`.
///
/// Отказы до любой записи (`error.code`): `ArgumentException` (запрос, выключатель),
/// `LayerUnknown`, `LayerLinked` (слой правил существующий вложенный архив),
/// `LayerCovered` (запись слоя перекрыта чужой правкой), `LayerRequires`,
/// `LayerConflict`, `HeadBeyondMax`, `LayersDamaged`, `RegistryInvalid`,
/// `ForeignChange`, `Linked`, `JournalDamaged`, `RecipeIncomplete`, `Cancelled`.
pub fn switch_rpf_layers(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let map = super::append::json_request(options, progress)?;
    let game_root = super::append::game_root_of(&map)?;
    let request = parse_request(&map, game_root)?;
    if !layers_enabled_for(&request.replay, env::var(LAYERS_ENV).ok().as_deref()) {
        return Err(EngineError::argument("Switching layers is not enabled."));
    }
    let hint = options.optional("game-root").map_or_else(
        || request.game_root.to_string_lossy().into_owned(),
        str::to_owned,
    );
    let keys = command_keys(options, &hint)?;
    switch_core(&request, &keys, progress, tuning())
}

/// Ядро: те же шаги без поиска ключей и без выключателя.
pub(crate) fn switch_core(
    request: &SwitchRequest,
    keys: &Arc<KeySet>,
    progress: &Progress,
    tuning: Tuning,
) -> Result<Value> {
    if request.enable.is_empty()
        && request.disable.is_empty()
        && request.remove.is_empty()
        && request.registry.is_empty()
    {
        return Err(EngineError::argument("Nothing to switch."));
    }
    let game_text = request.game_root.to_string_lossy().into_owned();
    let live = paths::inside(&game_text, &request.archive)?;
    if !live.is_file() {
        return Err(EngineError::file_not_found(format!(
            "Target RPF does not exist: {}",
            request.archive
        )));
    }
    // содержимое реестра читается до любой записи
    let mut registry: Vec<RegistryInput> = Vec::with_capacity(request.registry.len());
    for wanted in &request.registry {
        let length = fs::metadata(&wanted.source)
            .map_err(|_| EngineError::file_not_found("Registry source not found."))?
            .len();
        if !wanted.source.is_file() || length > REGISTRY_MAX {
            return Err(EngineError::argument("Switch registry source is invalid."));
        }
        registry.push(RegistryInput {
            entry: wanted.entry.clone(),
            content: fs::read(&wanted.source)?,
        });
    }
    // замены общих записей для сводного рецепта: «Починить» берёт содержимое оттуда
    let shared_ops: Vec<Operation> = request
        .registry
        .iter()
        .zip(&registry)
        .map(|(wanted, input)| Operation {
            entry: wanted.entry.clone(),
            source: Some(wanted.source.clone()),
            sha256: Some(super::sha256_hex(&input.content)),
            action: Action::Replace,
            allow_delete: false,
            allow_missing: false,
        })
        .collect();

    let _hook = activity::install(Arc::new(progress.clone()));
    progress.report("switch");
    let _lift = points::ReadonlyLift::take_off(&live)?;
    let host = EngineHost;
    let mut session = open_session(&host, &live, progress, tuning)?;
    // новое тело реестра растит файл: с `keepKey` длина держит ключ прежней головы (R4)
    session.set_keep_key(request.keep_key.then_some(KEEP_KEY_PAD_MAX));
    session.set_tail(request.tail_pad.then_some(rage_rpf::tail::TailPolicy::STANDARD));
    let notes = summary::recipe_notes(session.replay());
    let settled = session.settle().map_err(engine_error)?;
    reconcile_recipes(&notes, session.replay());
    // чужая правка видна раньше: отказ называет причину, архив не тронут
    let state = session.fingerprint().map_err(engine_error)?;
    if let Some(wanted) = &request.expect_state {
        let same = state.as_deref().is_some_and(|now| {
            parse_digest(now).is_some() && parse_digest(now) == parse_digest(wanted)
        });
        if !same {
            return Err(engine_error(AppendError::refused(
                Code::ForeignChange,
                "The archive is not in the state the caller remembers.",
            )));
        }
    }
    if let (Some(wanted), Some(base)) = (request.base_sha256, &session.replay().base) {
        if wanted != base.digest {
            return Err(engine_error(AppendError::refused(
                Code::ForeignChange,
                "The chain of the archive did not begin with the file the caller remembers.",
            )));
        }
    }
    let track = match &request.save_recipe {
        Some(path) => Some(RecipeTrack::open(path, &request.archive, session.replay())?),
        None => None,
    };
    if let Some(held) = &track {
        session.set_note(held.path.to_string_lossy().as_bytes());
    }
    // источники общих записей закрепляются рядом с рецептом до записи; отказ — уборка
    let pinned = match &track {
        Some(held) if !shared_ops.is_empty() => {
            summary::pin_operations(&shared_ops, &summary::sources_folder(&held.path))
                .inspect_err(|_| held.forget_leftovers(session.replay()))?
        }
        _ => Vec::new(),
    };

    let mut before_head = |ahead: &Ahead| -> std::result::Result<(), AppendError> {
        let Some(held) = &track else { return Ok(()) };
        held.toggled(ahead, &pinned)
            .save(&held.path)
            .map_err(|error| AppendError::Other(RpfError::Io(io::Error::other(error.message))))
    };
    let mut verify = |_: &Archive| Ok(());
    let outcome = session.switch_all(
        SwitchAll {
            keys,
            enable: request.enable.clone(),
            disable: request.disable.clone(),
            remove: request.remove.clone(),
            registry,
        },
        &mut verify,
        &mut before_head,
    );
    let report = match outcome {
        Ok(report) => report,
        Err(error) => {
            if let Some(held) = &track {
                // запись снята — рецепт тоже
                held.forget_leftovers(session.replay());
            }
            return Err(engine_error(error));
        }
    };
    // два переключения слились в одну запись журнала: рецепт идёт за ним (отказ
    // записи не важен, рецепт сверится с журналом при следующем чтении)
    if let (Some(held), Some((kept, gone))) = (&track, report.merged) {
        if let Ok(mut summary) = Summary::load(&held.path) {
            summary.merge_toggles(kept, gone, &report.fingerprint);
            let saved = summary.save(&held.path);
            if saved.is_ok() && !pinned.is_empty() {
                // слитая партия забрала замены общих записей: прежние источники не нужны
                summary.collect_garbage(&held.path);
            }
        }
    }
    // ничего не записано: закреплённое зря уходит
    if let (Some(held), false) = (&track, report.changed) {
        if !pinned.is_empty() {
            held.forget_leftovers(session.replay());
        }
    }
    let recipe = track
        .as_ref()
        .map(|held| (held.path.clone(), report.fingerprint.clone()));
    Ok(answer(
        &report,
        &request.archive,
        request.registry_list,
        settled,
        recipe.as_ref(),
    ))
}

fn answer(
    report: &SwitchReport,
    archive: &str,
    registry_list: bool,
    settled: rage_rpf::append::Settled,
    recipe: Option<&(PathBuf, String)>,
) -> Value {
    let timings = &report.timings;
    let layers: Vec<Value> = report
        .layers
        .iter()
        .map(|(id, state)| json!({ "id": id, "state": state.word() }))
        .collect();
    let mut out = Map::new();
    let rows = [
        ("status", json!("ready")),
        ("mode", json!("switch-layers")),
        ("archive", json!(archive)),
        ("changed", json!(report.changed)),
        ("record", json!(report.seq)),
        (
            "merged",
            report.merged.map_or(
                Value::Null,
                |(kept, gone)| json!({ "into": kept, "from": gone }),
            ),
        ),
        ("fingerprint", json!(report.fingerprint)),
        ("fingerprintBefore", json!(report.fingerprint_before)),
        ("bytes", json!(report.new_len)),
        ("bytesWritten", json!(report.bytes_written)),
        ("headBytes", json!(report.head_len)),
        (
            "switched",
            json!({
                "enabled": report.enabled,
                "disabled": report.disabled,
                "removed": report.removed,
            }),
        ),
        ("layers", Value::Array(layers)),
        ("deadBytes", json!(report.dead_bytes)),
        ("dormantBytes", json!(report.dormant_bytes)),
        ("journalRecords", json!(report.journal_records)),
        (
            "registry",
            // прежний вид запроса (одна запись) отвечает объектом, список — списком
            if registry_list {
                Value::Array(report.registries.iter().map(registry_row).collect())
            } else {
                report.registry.as_ref().map_or(Value::Null, registry_row)
            },
        ),
        ("recovered", settled_value(settled)),
        (
            "timings",
            json!({
                "plan": timings.plan,
                "write": timings.write,
                "sync": timings.sync,
                "head": timings.head,
                "journal": timings.journal,
            }),
        ),
    ];
    for (key, value) in rows {
        out.insert(key.to_owned(), value);
    }
    if let Some((path, state)) = recipe {
        out.insert(
            "recipe".to_owned(),
            json!({ "path": path.to_string_lossy(), "state": state }),
        );
    }
    // ключ есть только у запроса с `keepKey`: прочие ответы прежние
    if let Some(pad) = report.key_pad {
        out.insert("keyPadBytes".to_owned(), json!(pad));
    }
    Value::Object(out)
}

/// Что стало с одной общей записью, как ответ.
fn registry_row(registry: &RegistryReport) -> Value {
    json!({
        "entry": registry.entry,
        "reused": registry.reused,
        "unchanged": registry.unchanged,
        "bytesWritten": registry.bytes_written,
    })
}

// ---------------------------------------------------------------------------
// Полный путь и слои
// ---------------------------------------------------------------------------

/// Что полный путь сделает со слоями архива, у которого рядом таблица слоёв:
/// подмена файла убирает журнал и таблицу. Включённые слои вошли в собранный
/// файл записями (`baked`: они остаются, но переключать их больше нельзя),
/// выключенные пропали вместе с телами (`lost`: включить такой слой можно только
/// загрузкой заново). Не повторять молча: вызывающий получает это в ответе.
/// `None` — таблицы нет (прежние ответы остаются прежними).
pub(crate) fn dropped_by_full_path(live: &Path, archive: &str) -> Option<Value> {
    if !layers_path(live).is_file() {
        return None;
    }
    let replay = match journal::read(&journal_path(live)) {
        Ok(found) => found.unwrap_or_default(),
        Err(_) => return Some(json!({ "archive": archive, "damaged": true })),
    };
    let Ok(set) = LayerSet::load(live, &replay) else {
        return Some(json!({ "archive": archive, "damaged": true }));
    };
    let mut rows: Vec<_> = set.live_rows().collect();
    rows.sort_by_key(|row| row.seq);
    let (mut baked, mut lost) = (Vec::new(), Vec::new());
    for row in rows {
        match set.state_of(&row.id) {
            Some(Status::Enabled) => baked.push(row.id.clone()),
            Some(Status::Disabled) => lost.push(row.id.clone()),
            _ => {}
        }
    }
    let unknown: Vec<&String> = set.lost.iter().collect();
    (!baked.is_empty() || !lost.is_empty() || !unknown.is_empty()).then(|| {
        json!({
            "archive": archive,
            "baked": baked,
            "lost": lost,
            "unknown": unknown,
        })
    })
}

/// Сведения о слоях для ответа полного пути: по записи на архив с таблицей.
pub(crate) fn dropped_note(targets: &[(&Path, &str)]) -> Option<Value> {
    let rows: Vec<Value> = targets
        .iter()
        .filter_map(|(live, archive)| dropped_by_full_path(live, archive))
        .collect();
    (!rows.is_empty()).then_some(Value::Array(rows))
}
