//! Команда `repair-rpf`: «Починить» дозаписанный архив по сводному рецепту.
//!
//! У дозаписанного архива нет копии сборки (тела лежат в конце живого файла).
//! Когда лаунчер Rockstar вернул оригинальный `update.rpf`, моды ставятся заново
//! без игрока: живой файл служит основой, сводный рецепт (`summary.rs`) называет
//! всё, что на него надо наложить. Сборка идёт ПОЛНЫМ путём рядом с живым
//! файлом (операции партиями по порядку, архив пишется целиком и без дыр,
//! доводится так же, как у `compose-rpf`), как у обычной полной установки;
//! содержимое сверяется ДО подмены: у каждой действующей операции данные записи
//! равны источнику, на всех уровнях вложенности. Подмена убирает журнал дозаписи,
//! цепочка начинается заново. Точка отката — как у полной установки.
//!
//! Отказы до любой записи в игру (файл остаётся прежним):
//!
//! | Код | Когда |
//! | --- | --- |
//! | `RecipeMissing` | файла рецепта нет |
//! | `RecipeDamaged` | файл не сводный рецепт |
//! | `RecipeStale` | рецепт другой цепочки или ждёт другое состояние (`expectState`) |
//! | `NothingToRepair` | восстанавливать нечего: рецепт пуст или архив цел |
//! | `SourceMissing`, `SourceChanged` | закреплённого источника нет на диске или он изменился |
//! | `BaseMismatch` | живой файл не основа рецепта (SHA-256 не тот) |
//! | `ContentMismatch` | собранный файл не равен рецепту по содержимому |
//! | `JournalDamaged` | журнал испорчен, а рецепт держится на нём |

use std::{
    cell::Cell,
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use rage_rpf::{
    append::AppendError,
    journal,
    layers::{self, Status},
    Archive, Finalizer, KeySet,
};
use serde_json::{json, Map, Value};

use super::{
    append::{self, engine_error},
    compose::{self, Install, InstallOptions, Mode, Operation, Request, Streaming},
    composed_install::{self, Extras},
    points, sha256_file,
    summary::{Standing, Summary, RECIPE_STALE},
};
use crate::{
    args::Options,
    disk::WritePacer,
    error::{EngineError, Result},
    failpoint, paths,
    progress::Progress,
};

/// Живой файл не основа рецепта.
pub const BASE_MISMATCH: &str = "BaseMismatch";
/// Собранный файл не равен рецепту по содержимому.
pub const CONTENT_MISMATCH: &str = "ContentMismatch";
/// Восстанавливать нечего.
pub const NOTHING_TO_REPAIR: &str = "NothingToRepair";

/// Запрос `repair-rpf` (файл `--request`).
pub(crate) struct RepairRequest {
    pub game_root: PathBuf,
    pub archive: String,
    /// Сводный рецепт, который писала дозапись (`saveRecipe`).
    pub recipe: PathBuf,
    /// Точка отката: заданная или новая.
    pub point_id: Option<String>,
    /// Запись переустановки для папки точки.
    pub replay: Value,
    /// Состояние, которое помнит вызывающий (`fingerprint` последней дозаписи или
    /// SHA-256 после прошлой починки): рецепт другого состояния отказывает.
    pub expect_state: Option<String>,
}

fn fold(text: &str) -> String {
    text.replace('\\', "/").to_lowercase()
}

fn refuse(code: &str, message: impl Into<String>) -> EngineError {
    EngineError::new(code, message)
}

fn parse_request(options: &Options, progress: &Progress) -> Result<RepairRequest> {
    let map = append::json_request(options, progress)?;
    let game_root = append::game_root_of(&map)?;
    let text = |key: &str| map.get(key).and_then(Value::as_str);
    let Some(archive) = text("archive") else {
        return Err(EngineError::argument("Archive path is required."));
    };
    let recipe = match text("recipe").map(PathBuf::from) {
        Some(path) if path.is_absolute() => path,
        _ => {
            return Err(EngineError::argument(
                "Summary recipe path must be absolute.",
            ))
        }
    };
    let point_id = match text("pointId") {
        None => None,
        Some(given) if points::valid_point_id(given) => Some(given.to_owned()),
        Some(_) => return Err(EngineError::argument("Install point id is invalid.")),
    };
    let replay = match map.get("replay") {
        None | Some(Value::Null) => json!({ "module": "repair-rpf" }),
        Some(record) if record.is_object() => record.clone(),
        Some(_) => return Err(EngineError::argument("Install replay record is required.")),
    };
    let expect_state = match map.get("expectState") {
        None | Some(Value::Null) => None,
        Some(Value::String(state)) if !state.is_empty() => Some(state.clone()),
        Some(_) => return Err(EngineError::argument("Repair expectState is invalid.")),
    };
    Ok(RepairRequest {
        game_root,
        archive: archive.to_owned(),
        recipe,
        point_id,
        replay,
        expect_state,
    })
}

/// Команда `repair-rpf`.
///
/// Запрос: `{gameRoot, archive, recipe, pointId?, replay?, expectState?, cancelFile?}`.
/// Ответ — как у полной установки (`id`, `restoreRoot`, `sha256` и `bytes`
/// собранного файла, `timings`) и поле `repair`: `{recipe, state, origin,
/// batches, operations, verified}`; `state` — SHA-256 нового файла, с которого
/// начинается новая цепочка (его же стоит отдать `baseSha256` следующей дозаписи).
pub fn repair_rpf(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let request = parse_request(options, progress)?;
    let (keys, fixer) = compose::load_tools(options)?;
    let finalizer: Option<&dyn Finalizer> = Some(&fixer);
    let points_root = points::restore_points_root_for(options)?;
    repair_core(
        &request,
        &keys,
        finalizer,
        progress,
        &points_root,
        Streaming::from_env(),
    )
}

/// Ядро: те же шаги без поиска ключей и доводчика (их берёт вызывающий).
pub(crate) fn repair_core(
    request: &RepairRequest,
    keys: &Arc<KeySet>,
    finalizer: Option<&dyn Finalizer>,
    progress: &Progress,
    points_root: &Path,
    streaming: Streaming,
) -> Result<Value> {
    let game_text = request.game_root.to_string_lossy().into_owned();
    let live = paths::inside(&game_text, &request.archive)?;
    if !live.is_file() {
        return Err(EngineError::file_not_found(format!(
            "Target RPF does not exist: {}",
            request.archive
        )));
    }
    progress.report("prepare");
    let mut summary = Summary::load(&request.recipe)?;
    if fold(&summary.archive) != fold(&request.archive) {
        return Err(EngineError::argument(
            "Summary recipe is for another archive.",
        ));
    }
    if let Some(wanted) = &request.expect_state {
        if !same_state(wanted, &summary.state()) {
            return Err(refuse(
                RECIPE_STALE,
                "The summary recipe describes another state of the archive than the one the \
                 caller remembers.",
            ));
        }
    }
    let states = follow_the_journal(&mut summary, &live)?;
    if summary.is_empty() {
        return Err(refuse(
            NOTHING_TO_REPAIR,
            "The summary recipe has no operations; there is nothing to rebuild.",
        ));
    }
    if append::is_intact(&live, &summary.state(), progress) {
        return Err(refuse(
            NOTHING_TO_REPAIR,
            "The archive is the one the journal left; it needs no repair.",
        ));
    }
    progress.checkpoint()?;

    // слои: ставятся только включённые; выключенные и снятые пропали вместе с телами
    // в файле, который вернул Rockstar, и вернуть их может только загрузка. Включённые
    // войдут в собранный файл записями (переключать их после этого нельзя: таблица
    // слоёв уходит вместе с журналом)
    let (layers_lost, layers_baked): (Vec<String>, Vec<String>) = summary
        .layer_ids()
        .into_iter()
        .partition(|id| matches!(states.get(id), Some(Status::Disabled | Status::Removed)));
    let had_layers = !layers_lost.is_empty() || !layers_baked.is_empty();
    let summary = summary.without_layers(&layers_lost);

    // основа: длина дёшево, источники дёшево, SHA-256 всего файла дорого, и он последний
    let length = fs::metadata(&live)?.len();
    if length != summary.origin_bytes {
        return Err(base_mismatch());
    }
    summary.check_sources()?;
    progress.checkpoint()?;
    if !sha256_file(&live)?.eq_ignore_ascii_case(&summary.origin_sha256) {
        return Err(base_mismatch());
    }
    progress.checkpoint()?;

    // сборка: прежние партии, потом последняя; проверка содержимого до подмены
    let batches: Vec<Vec<Operation>> = summary
        .batches
        .iter()
        .map(|batch| batch.operations.clone())
        .filter(|operations| !operations.is_empty())
        .collect();
    let Some((last, earlier)) = batches.split_last() else {
        return Err(refuse(
            NOTHING_TO_REPAIR,
            "The summary recipe has no operations; there is nothing to rebuild.",
        ));
    };
    let effective = summary.effective();
    let allow_deletes = summary.allow_deletes;
    let verified = Cell::new(0usize);
    let verify = |staged: &Path, keys: &Arc<KeySet>| -> Result<()> {
        let opened = Archive::open_path(staged, Some(Arc::clone(keys)))
            .map_err(|error| content_mismatch(EngineError::from(error)))?;
        let done = compose::verify_operations(&opened, &effective, allow_deletes, keys)
            .map_err(content_mismatch)?;
        verified.set(done);
        Ok(())
    };
    let rebased_to = Cell::new(String::new());
    let before_swap = |built: &str| -> Result<()> {
        // рецепт новой цепочки ложится ДО подмены: после неё он уже нужен, а обрыв
        // между ними оставляет рецепт, который по-прежнему годится для основы
        summary.rebased(built).save(&request.recipe)?;
        rebased_to.set(built.to_ascii_lowercase());
        failpoint::hit("repair-after-recipe");
        Ok(())
    };
    let install = Install {
        game_root: request.game_root.clone(),
        archive: request.archive.clone(),
        replay: request.replay.clone(),
        point_id: request.point_id.clone(),
        stage_name: None,
        prebuilt: None,
        sha256: None,
        create: false,
        targets: Vec::new(),
        options: InstallOptions::default(),
    };
    let build = Request {
        staging: None,
        mode: Mode::Compose,
        base: Some(live.clone()),
        output: PathBuf::new(),
        archive_target: summary.archive.clone(),
        edition: None,
        allow_deletes,
        operations: last.clone(),
        install: Some(install),
    };
    progress.report("compose");
    let extras = Extras {
        earlier,
        verify: Some(&verify),
        before_swap: Some(&before_swap),
    };
    let mut answer = composed_install::install_with(
        &build,
        keys,
        finalizer,
        progress,
        points_root,
        streaming,
        &extras,
    )?;
    let state = rebased_to.take();
    let mut report = Map::new();
    for (key, value) in [
        ("recipe", json!(request.recipe.to_string_lossy())),
        ("state", json!(state)),
        ("origin", json!(summary.origin_sha256)),
        ("batches", json!(batches.len())),
        ("operations", json!(summary.operations().count())),
        ("verified", json!(verified.get())),
    ] {
        report.insert(key.to_owned(), value);
    }
    // ключ есть только у рецепта со слоями: прочие ответы прежние
    if had_layers {
        report.insert(
            "layers".to_owned(),
            json!({ "baked": layers_baked, "lost": layers_lost }),
        );
    }
    answer["mode"] = json!("repair-install");
    answer["repair"] = Value::Object(report);
    Ok(answer)
}

fn base_mismatch() -> EngineError {
    refuse(
        BASE_MISMATCH,
        "The live archive is not the base of the summary recipe (its length or SHA-256 differs); \
         nothing was rebuilt.",
    )
}

/// Отказ сверки содержимого получает свой код; прочее (чтение, отмена) идёт как есть.
fn content_mismatch(error: EngineError) -> EngineError {
    match error.code.as_str() {
        "InvalidDataException" | "FileNotFoundException" => refuse(
            CONTENT_MISMATCH,
            format!(
                "The rebuilt archive does not match the recipe: {}",
                error.message
            ),
        ),
        _ => error,
    }
}

/// Одно и то же состояние: SHA-256 без регистра или `a1:` и 64 цифры.
fn same_state(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

/// Записи рецепта сверяются с журналом рядом с живым файлом: гадать, какие записи
/// дошли до конца, можно только по нему. Без записей-в-журнале рецепт (партии
/// основы после прошлой починки) от журнала не зависит. Журнала нет, он другой
/// цепочки или испорчен при записях рецепта — отказ.
///
/// Возвращает состояния слоёв по журналу (пусто, когда журнал не нужен).
fn follow_the_journal(summary: &mut Summary, live: &Path) -> Result<BTreeMap<String, Status>> {
    if summary.batches.iter().all(|batch| batch.record.is_none()) {
        return Ok(BTreeMap::new());
    }
    let replay = match journal::read(&journal::journal_path(live)) {
        Ok(found) => found.unwrap_or_default(),
        Err(AppendError::Refused { code, message }) => {
            return Err(engine_error(AppendError::Refused { code, message }))
        }
        Err(other) => return Err(engine_error(other)),
    };
    match summary.reconcile(&replay).0 {
        Standing::Same => Ok(layers::statuses(&replay)),
        Standing::NoJournal => Err(refuse(
            RECIPE_STALE,
            "The journal of the chain the recipe belongs to is gone: which records reached the \
             archive is not known.",
        )),
        Standing::Other => Err(refuse(
            RECIPE_STALE,
            "The recipe belongs to another chain of records than the journal beside the archive.",
        )),
    }
}
