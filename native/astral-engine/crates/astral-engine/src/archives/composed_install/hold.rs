//! Установка в два шага: `install.hold`, `install.commit`, `install.discard`.
//!
//! Приложение обязано перечитать собранный архив своим строгим читателем до
//! подмены. Обычная установка собирает и подменяет одной командой, поэтому
//! между сборкой и подменой для него нет щели. Удержание её делает:
//!
//! 1. `hold`: всё как у обычной установки до подмены (копия «до», сборка в
//!    стейдж рядом с живым файлом, рецепт, запись переустановки), но стейдж
//!    остаётся лежать. Ответ называет путь стейджа, его SHA-256 и id точки.
//! 2. приложение проверяет стейдж своим читателем;
//! 3. `commit`: движок сверяет, что живой архив и стейдж те же, что при
//!    `hold`, и подменяет (опись точки, переименование: всё, что делает
//!    обычная установка после сборки), либо `discard`: стейдж, «до» рядом и
//!    точка убираются, живой архив не тронут.
//!
//! Порядок на диске. Запись удержания `hold.json` лежит в папке точки: она
//! появляется раньше первой копии («собирается»), а когда стейдж готов,
//! переписывается целиком («удержан»); её пишут во временный файл и
//! переименовывают. Описи точки `restore.json` у удержания нет: её пишет
//! `commit` перед первой подменой, как обычная установка, поэтому у брошенного
//! удержания нет точки-призрака, а у оборванной подмены точка полная.
//!
//! Брошенное удержание (приложение умерло между шагами). Его убирает
//! следующая установка того же архива (сразу), установка другого архива и
//! `settle-rpf-journals` (когда запись не менялась дольше срока). Убирая,
//! движок смотрит на живой файл: прежний — стейдж, «до» и точка уходят целиком;
//! живой файл уже другой (подмена дошла) — уходят стейдж и запись удержания,
//! а точка с описью остаётся, откат вернёт «до».
//!
//! Жива ли работа, говорит замок (`lock.rs`), а не время записи: пока сборка,
//! `commit`, `discard` или чужая уборка работают над удержанием, замок занят, и
//! уборка его не трогает, сколько бы запись ни лежала; установка того же архива
//! отказывает `HoldBusy` вместо того, чтобы снести живое. Время решает только
//! для удержания, которое ждёт проверки приложения (движка в это время нет):
//! `HELD_LEASE`. Уборка идёт в таком порядке, что обрыв посреди неё не оставляет
//! `commit` возможным без «до»: сначала запись получает метку «убирается»
//! (`commit` по ней отказывает), потом уходит стейдж, и только если он ушёл,
//! уходят «до» и точка.

use std::{
    fs::File,
    io::Read,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rage_rpf::append::{held_path, HeldHead};
use sha2::{Digest as _, Sha256};

mod lock;

pub(crate) use lock::HoldLock;

use super::*;
use crate::{
    args::Options,
    archives::{compose::StageCheck, hex_upper, sha256_file},
};

/// Имя записи удержания в папке точки.
pub(super) const HOLD_FILE: &str = "hold.json";
const HOLD_TEMP: &str = "hold.json.tmp";
/// Версия записи. Запись первой версии (рецепт ложился на первом шаге, состояний
/// «убирается» не было) читается и убирается, как прежде.
const SCHEMA: u64 = 2;
const SCHEMA_FIRST: u64 = 1;
/// Заготовка рецепта в папке точки: на первом шаге рецепт лежит только здесь.
pub(super) const RECIPE_DRAFT: &str = "recipe.draft.json";
/// Сколько байт начала живого архива входит в его отпечаток головы.
const HEAD_BYTES: u64 = 1 << 20;

/// Через сколько установка другого архива убирает чужое брошенное удержание.
const GRACE_INSTALL: Duration = Duration::from_secs(30 * 60);
/// Через сколько его убирает `settle-rpf-journals` (запуск лаунчера, перед игрой).
/// Только для записей, с которыми не ждут приложение: сборка без живого процесса
/// и `commit`, чья подмена началась.
pub const GRACE_SETTLE: Duration = Duration::from_secs(2 * 60);
/// Сколько удержание ждёт приложение между шагами: проверка стейджа идёт без
/// движка, и признака жизни у неё нет, кроме времени. Приложение обязано
/// вызвать `commit` или `discard` раньше; позже удержание считается брошенным.
pub const HELD_LEASE: Duration = Duration::from_secs(30 * 60);
/// Сколько `commit` и `discard` ждут замок, который держит уборка или чужой шаг.
const LOCK_WAIT: Duration = if cfg!(test) {
    Duration::from_millis(200)
} else {
    Duration::from_secs(5)
};

/// Нет удержания с таким id (его не было, оно уже подменено, убрано или брошено).
pub const HOLD_MISSING: &str = "HoldMissing";
/// Удержание есть, но запрос называет другую игру или другие архивы.
pub const HOLD_MISMATCH: &str = "HoldMismatch";
/// Живой архив изменился с момента `hold`: подмены нет, удержание убрано.
pub const LIVE_CHANGED: &str = "LiveChanged";
/// Стейдж не тот, что снимали при `hold`: подмены нет, удержание убрано.
pub const STAGE_CHANGED: &str = "StageChanged";
/// «До» рядом пропало или запись удержания чужая: подмены нет, удержание убрано.
pub const HOLD_BROKEN: &str = "HoldBroken";
/// С удержанием сейчас работает другой шаг (сборка, `commit`, `discard`, уборка):
/// замок удержания занят.
pub const HOLD_BUSY: &str = "HoldBusy";
/// Подмена прошла, но конец шага (рецепт) не дописался: повторный `commit` доводит.
pub const HOLD_UNFINISHED: &str = "HoldUnfinished";

// ---------------------------------------------------------------------------
// Запись удержания
// ---------------------------------------------------------------------------

/// Время изменения файла как (секунды, наносекунды) от начала эпохи.
type Moment = Option<(u64, u32)>;

fn moment(time: Option<SystemTime>) -> Moment {
    let span = time?.duration_since(UNIX_EPOCH).ok()?;
    Some((span.as_secs(), span.subsec_nanos()))
}

fn from_moment(at: Moment) -> Option<SystemTime> {
    let (seconds, nanos) = at?;
    UNIX_EPOCH.checked_add(Duration::new(seconds, nanos))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    /// Стейдж ещё собирается: записать запись раньше первой копии, чтобы обрыв
    /// сборки оставил по себе то, что можно убрать.
    Building,
    /// Стейдж готов и ждёт `commit` или `discard`.
    Held,
    /// Уборка началась: `commit` невозможен, точка и «до» остаются, пока не
    /// уйдёт стейдж; оборванную уборку доводит следующая.
    Dropping,
}

/// Одна цель удержания.
#[derive(Clone, Debug)]
struct Target {
    archive: String,
    live: PathBuf,
    created: bool,
    stage_dir: PathBuf,
    stage_file: PathBuf,
    /// Служебная папка лежала до установки (имя дал вызывающий): убирается только файл.
    stage_preexisting: bool,
    /// Живой архив при `hold`: длина, время, отпечаток головы.
    live_len: u64,
    live_modified: Moment,
    live_head: String,
    /// Где «до» может лежать рядом с живым файлом (если ключ `before: aside`).
    aside: Option<PathBuf>,
    /// Где «до» лежит на самом деле; пока собирается или у отсутствующего — `None`.
    before: Option<PathBuf>,
    sha256_before: String,
    sha256_after: String,
    stage_len: u64,
    stage_modified: Moment,
    /// Номер файла стейджа на томе (том, индекс): быстрая проверка видит подмену
    /// стейджа другим файлом, а живой файл после подмены сохраняет его. Нет у
    /// записи первой версии и там, где тома номер не отдают.
    stage_key: Option<(u64, u64)>,
}

impl Target {
    /// Живой файл такой, каким был при `hold`: подмена к нему не дошла.
    fn live_is_as_it_was(&self) -> bool {
        if self.created {
            return !self.live.exists();
        }
        match points::stamp(&self.live) {
            Ok(now) => now.len == self.live_len && moment(now.modified) == self.live_modified,
            Err(_) => false,
        }
    }

    /// Живой файл уже и есть удержанная сборка: переименование стейджа на место
    /// живого файла оставляет длину и время изменения стейджа. С `full` ещё и
    /// SHA-256 всего файла (то же чтение, что `commit` делает над стейджем).
    fn live_is_the_build(&self, full: bool) -> bool {
        let Ok(now) = points::stamp(&self.live) else {
            return false;
        };
        if now.len != self.stage_len || moment(now.modified) != self.stage_modified {
            return false;
        }
        // стейдж встал на место переименованием: номер файла тот же
        if let (Some(wanted), Ok(found)) = (self.stage_key, points::file_key(&self.live)) {
            if wanted != found {
                return false;
            }
        }
        !full
            || sha256_file(&self.live)
                .is_ok_and(|found| found.eq_ignore_ascii_case(&self.sha256_after))
    }
}

/// Где живые файлы записи относительно подмены.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Landing {
    /// Все цели такие, какими были при `hold`.
    Untouched,
    /// Опись точки лежит (`commit` дошёл до подмены) и все цели уже равны
    /// удержанной сборке: подмена прошла, не дошла уборка.
    Swapped,
    /// Что-то третье: чужая правка, подмена не по всем целям.
    Foreign,
}

/// Удержание дозаписи: что нужно второму шагу, чтобы найти запись журнала и
/// будущие головы рядом с живым архивом.
#[derive(Clone, Debug)]
struct AppendNote {
    archive: String,
    live: PathBuf,
    /// Номер удержанной записи журнала.
    seq: u64,
    /// Файл будущих голов рядом с архивом.
    preview: PathBuf,
    /// SHA-256 файла будущих голов (его читает второй шаг).
    preview_sha256: String,
    fingerprint_before: String,
    fingerprint_after: String,
    chain_base: String,
}

impl AppendNote {
    fn to_json(&self) -> Value {
        json!({
            "archive": self.archive,
            "live": path_text(&self.live),
            "seq": self.seq,
            "preview": path_text(&self.preview),
            "previewSha256": self.preview_sha256,
            "fingerprintBefore": self.fingerprint_before,
            "fingerprintAfter": self.fingerprint_after,
            "chainBase": self.chain_base,
        })
    }

    fn from_json(value: &Value) -> Option<AppendNote> {
        Some(AppendNote {
            archive: text_of(value, "archive")?,
            live: path_of(value, "live")?,
            seq: value.get("seq")?.as_u64()?,
            preview: path_of(value, "preview")?,
            preview_sha256: text_of(value, "previewSha256")?,
            fingerprint_before: text_of(value, "fingerprintBefore")?,
            fingerprint_after: text_of(value, "fingerprintAfter")?,
            chain_base: text_of(value, "chainBase")?,
        })
    }
}

#[derive(Clone)]
struct Record {
    state: State,
    id: String,
    game_root: PathBuf,
    root: PathBuf,
    /// Папку точки создало удержание: убирается целиком.
    owned: bool,
    aside: bool,
    /// `replay.json` написан удержанием.
    replay: bool,
    /// Куда ляжет рецепт на `commit` (путь из запроса).
    recipe: Option<PathBuf>,
    /// Заготовка рецепта в папке точки; `None` — рецепта нет или он ложился сразу (запись первой версии).
    recipe_draft: Option<PathBuf>,
    /// Опись точки `restore.json` на момент `hold`: `Some(None)` — описи не было,
    /// `Some(Some((длина, время)))` — лежала прежняя (точка существовала до установки).
    /// `None` — записи неизвестно (запись без поля, дозапись): опись есть — подмена началась.
    manifest_at_hold: Option<Option<(u64, Moment)>>,
    created_dirs: Vec<String>,
    footprint: Vec<PathBuf>,
    /// Что ответ `commit` берёт у сборки: `operations`, `timings`, `bytes`, `expected`.
    answer: Value,
    targets: Vec<Target>,
    /// Удержание дозаписи; у полного пути `None`, а `targets` не пуст.
    append: Option<AppendNote>,
}

fn path_text(path: &Path) -> Value {
    json!(path.to_string_lossy())
}

fn moment_json(at: Moment) -> Value {
    at.map_or(Value::Null, |(seconds, nanos)| json!([seconds, nanos]))
}

fn text_of(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_owned)
}

fn path_of(value: &Value, key: &str) -> Option<PathBuf> {
    text_of(value, key).map(PathBuf::from)
}

fn moment_of(value: &Value, key: &str) -> Option<Moment> {
    match value.get(key)? {
        Value::Null => Some(None),
        Value::Array(pair) => {
            let seconds = pair.first()?.as_u64()?;
            let nanos = u32::try_from(pair.get(1)?.as_u64()?).ok()?;
            Some(Some((seconds, nanos)))
        }
        _ => None,
    }
}

impl Target {
    fn to_json(&self) -> Value {
        json!({
            "archive": self.archive,
            "live": path_text(&self.live),
            "created": self.created,
            "stageDir": path_text(&self.stage_dir),
            "stageFile": path_text(&self.stage_file),
            "stagePreexisting": self.stage_preexisting,
            "liveLen": self.live_len,
            "liveModified": moment_json(self.live_modified),
            "liveHead": self.live_head,
            "aside": self.aside.as_deref().map_or(Value::Null, path_text),
            "before": self.before.as_deref().map_or(Value::Null, path_text),
            "sha256Before": self.sha256_before,
            "sha256After": self.sha256_after,
            "stageLen": self.stage_len,
            "stageModified": moment_json(self.stage_modified),
            "stageKey": self.stage_key.map_or(Value::Null, |(volume, index)| json!([volume, index])),
        })
    }

    fn from_json(value: &Value) -> Option<Target> {
        let optional_path = |key: &str| match value.get(key)? {
            Value::Null => Some(None),
            Value::String(text) => Some(Some(PathBuf::from(text))),
            _ => None,
        };
        Some(Target {
            archive: text_of(value, "archive")?,
            live: path_of(value, "live")?,
            created: value.get("created")?.as_bool()?,
            stage_dir: path_of(value, "stageDir")?,
            stage_file: path_of(value, "stageFile")?,
            stage_preexisting: value.get("stagePreexisting")?.as_bool()?,
            live_len: value.get("liveLen")?.as_u64()?,
            live_modified: moment_of(value, "liveModified")?,
            live_head: text_of(value, "liveHead")?,
            aside: optional_path("aside")?,
            before: optional_path("before")?,
            sha256_before: text_of(value, "sha256Before")?,
            sha256_after: text_of(value, "sha256After")?,
            stage_len: value.get("stageLen")?.as_u64()?,
            stage_modified: moment_of(value, "stageModified")?,
            stage_key: match value.get("stageKey") {
                None | Some(Value::Null) => None,
                Some(Value::Array(pair)) => Some((pair.first()?.as_u64()?, pair.get(1)?.as_u64()?)),
                Some(_) => return None,
            },
        })
    }
}

impl Record {
    fn to_json(&self) -> Value {
        let mut object = json!({
            "schema": SCHEMA,
            "state": match self.state {
                State::Building => "building",
                State::Held => "held",
                State::Dropping => "dropping",
            },
            "id": self.id,
            "gameRoot": path_text(&self.game_root),
            "root": path_text(&self.root),
            "owned": self.owned,
            "aside": self.aside,
            "replay": self.replay,
            "recipe": self.recipe.as_deref().map_or(Value::Null, path_text),
            "recipeDraft": self.recipe_draft.as_deref().map_or(Value::Null, path_text),
            "createdDirs": self.created_dirs,
            "footprint": self.footprint.iter().map(|dir| path_text(dir)).collect::<Vec<_>>(),
            "answer": self.answer,
            "targets": self.targets.iter().map(Target::to_json).collect::<Vec<_>>(),
            "append": self.append.as_ref().map_or(Value::Null, AppendNote::to_json),
        });
        if let Some(mark) = self.manifest_at_hold {
            object["manifestAtHold"] = mark.map_or(Value::Null, |(len, at)| {
                json!({ "len": len, "modified": moment_json(at) })
            });
        }
        object
    }

    fn from_json(value: &Value) -> Option<Record> {
        if !matches!(value.get("schema")?.as_u64()?, SCHEMA_FIRST | SCHEMA) {
            return None;
        }
        let state = match value.get("state")?.as_str()? {
            "building" => State::Building,
            "held" => State::Held,
            "dropping" => State::Dropping,
            _ => return None,
        };
        let recipe = match value.get("recipe")? {
            Value::Null => None,
            Value::String(text) => Some(PathBuf::from(text)),
            _ => return None,
        };
        let recipe_draft = match value.get("recipeDraft") {
            None | Some(Value::Null) => None,
            Some(Value::String(text)) => Some(PathBuf::from(text)),
            Some(_) => return None,
        };
        let manifest_at_hold = match value.get("manifestAtHold") {
            None => None,
            Some(Value::Null) => Some(None),
            Some(mark) => Some(Some((mark.get("len")?.as_u64()?, moment_of(mark, "modified")?))),
        };
        let created_dirs = value
            .get("createdDirs")?
            .as_array()?
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()?;
        let footprint = value
            .get("footprint")?
            .as_array()?
            .iter()
            .map(|item| item.as_str().map(PathBuf::from))
            .collect::<Option<Vec<_>>>()?;
        let targets = value
            .get("targets")?
            .as_array()?
            .iter()
            .map(Target::from_json)
            .collect::<Option<Vec<_>>>()?;
        let append = match value.get("append")? {
            Value::Null => None,
            note => Some(AppendNote::from_json(note)?),
        };
        Some(Record {
            append,
            state,
            id: text_of(value, "id")?,
            game_root: path_of(value, "gameRoot")?,
            root: path_of(value, "root")?,
            owned: value.get("owned")?.as_bool()?,
            aside: value.get("aside")?.as_bool()?,
            replay: value.get("replay")?.as_bool()?,
            recipe,
            recipe_draft,
            manifest_at_hold,
            created_dirs,
            footprint,
            answer: value.get("answer")?.clone(),
            targets,
        })
    }

    /// Читает запись из папки точки.
    fn read(file: &Path) -> Option<Record> {
        let text = fs::read_to_string(file).ok()?;
        let parsed: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
        Record::from_json(&parsed)
    }

    /// Запись удержания точки `id`; `HoldMissing`, если её нет или она не читается.
    fn load(points_root: &Path, id: &str) -> Result<Record> {
        let root = points_root.join(id);
        let record = Record::read(&root.join(HOLD_FILE)).ok_or_else(|| missing(id))?;
        if !record.trusted(points_root) {
            return Err(EngineError::new(
                HOLD_BROKEN,
                format!("The hold record of {id} does not describe this install."),
            ));
        }
        Ok(record)
    }

    /// Запись описывает то, что движок мог положить: папка точки на месте, стейдж
    /// и «до» рядом с живым архивом внутри папки игры. Чужое имя в записи — повод
    /// ничего не убирать. Путь с `.` или `..` в звеньях движок не пишет, а
    /// текстовая проверка «внутри» его пропустила бы: такая запись подложена.
    fn trusted(&self, points_root: &Path) -> bool {
        let inside = |path: &Path, base: &Path| {
            if !is_plain(path) || !is_plain(base) {
                return false;
            }
            let (path, base) = (fold(path), fold(base));
            path.len() > base.len() && path.starts_with(&format!("{}/", base.trim_end_matches('/')))
        };
        if !valid_point_id(&self.id) || fold(&self.root) != fold(&points_root.join(&self.id)) {
            return false;
        }
        if !is_plain(&self.root)
            || !is_plain(&self.game_root)
            || !self.recipe.as_deref().is_none_or(is_plain)
        {
            return false;
        }
        if self
            .recipe_draft
            .as_deref()
            .is_some_and(|draft| fold(draft) != fold(&self.root.join(RECIPE_DRAFT)))
        {
            return false;
        }
        if let Some(note) = &self.append {
            // дозапись: живой архив в игре, файл голов рядом с ним под своим именем
            return self.targets.is_empty()
                && self.recipe_draft.is_none()
                && inside(&note.live, &self.game_root)
                && fold(&note.preview) == fold(&rage_rpf::append::held_path(&note.live))
                && self.footprint.iter().all(|dir| inside(dir, &self.root));
        }
        self.targets.iter().all(|target| {
            let stage_name = target
                .stage_dir
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let beside_ok = |path: &Path| {
                is_plain(path)
                    && path.parent().map(fold) == target.live.parent().map(fold)
                    && path.to_string_lossy().contains(".astral-before-")
            };
            inside(&target.live, &self.game_root)
                && inside(&target.stage_dir, &self.game_root)
                && stage_name.starts_with(STAGE_PREFIX)
                && target.stage_file.parent().map(fold) == Some(fold(&target.stage_dir))
                && target.aside.as_deref().is_none_or(beside_ok)
                && target.before.as_deref().is_none_or(|path| {
                    inside(path, &self.root) || beside_ok(path)
                })
        }) && self
            .footprint
            .iter()
            .all(|dir| inside(dir, &self.game_root) || inside(dir, &self.root))
    }

    /// Пути архивов записи как в запросе.
    fn names(&self) -> Vec<String> {
        match &self.append {
            Some(note) => vec![note.archive.clone()],
            None => self
                .targets
                .iter()
                .map(|target| target.archive.clone())
                .collect(),
        }
    }

    /// Живые файлы, которых касается запись.
    fn lives(&self) -> Vec<&Path> {
        match &self.append {
            Some(note) => vec![note.live.as_path()],
            None => self
                .targets
                .iter()
                .map(|target| target.live.as_path())
                .collect(),
        }
    }

    /// Запрос называет ту же игру и те же архивы.
    fn matches(&self, install: &Install) -> Result<()> {
        let named: Vec<String> = match install.targets.as_slice() {
            [] => vec![fold_text(&install.archive)],
            listed => listed.iter().map(|one| fold_text(&one.archive)).collect(),
        };
        let held: Vec<String> = match &self.append {
            Some(note) => vec![fold_text(&note.archive)],
            None => self
                .targets
                .iter()
                .map(|one| fold_text(&one.archive))
                .collect(),
        };
        if fold(&install.game_root) != fold(&self.game_root) || named != held {
            return Err(EngineError::new(
                HOLD_MISMATCH,
                format!(
                    "The held install {} is for other archives than the request names.",
                    self.id
                ),
            ));
        }
        Ok(())
    }

    /// `commit` уже дошёл до подмены: опись точки пишется перед первой подменой,
    /// и она не та, что лежала в точке при `hold` (точка могла существовать раньше,
    /// со своей описью). Запись без отметки о ней (прежняя, дозапись): опись лежит.
    fn swap_began(&self) -> bool {
        let file = self.root.join(MANIFEST_FILE);
        if !file.is_file() {
            return false;
        }
        match (self.manifest_at_hold, points::stamp(&file)) {
            (Some(Some((len, at))), Ok(now)) => now.len != len || moment(now.modified) != at,
            _ => true,
        }
    }

    /// Удержание полного пути ждёт проверки приложения: стейдж готов, `commit` не
    /// начинался, движка в это время нет.
    fn waits_for_the_check(&self) -> bool {
        self.state == State::Held && self.append.is_none() && !self.swap_began()
    }

    /// Пора ли убирать запись, с которой никто не работает (замок свободен).
    /// `age` — сколько она не менялась; `grace` — срок для записей без ожидания
    /// проверки (сборка, чей процесс умер, `commit`, чья подмена началась).
    fn is_due(&self, age: Option<Duration>, grace: Duration) -> bool {
        let waited = |limit: Duration| age.is_some_and(|age| age >= limit);
        match self.state {
            State::Dropping => true,
            State::Held if self.waits_for_the_check() => waited(HELD_LEASE),
            State::Building | State::Held => waited(grace),
        }
    }

    /// Что стало с живыми файлами по сравнению с `hold` (полный путь).
    fn landing(&self, check: StageCheck) -> Landing {
        if self.targets.iter().all(Target::live_is_as_it_was) {
            return Landing::Untouched;
        }
        let full = check == StageCheck::Sha256;
        if self.swap_began() && self.targets.iter().all(|target| target.live_is_the_build(full)) {
            return Landing::Swapped;
        }
        Landing::Foreign
    }
}

/// Путь без звеньев `.` и `..`, как его пишет движок.
fn is_plain(path: &Path) -> bool {
    fold(path)
        .split('/')
        .all(|part| part != ".." && part != ".")
}

fn fold(path: &Path) -> String {
    fold_text(&path.to_string_lossy())
}

fn fold_text(text: &str) -> String {
    text.replace('\\', "/").to_lowercase()
}

/// Запись переименованием: либо прежняя, либо новая целиком.
fn write_record(root: &Path, record: &Record) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(&record.to_json())
        .map_err(|_| EngineError::internal("The hold record is not serializable."))?;
    let temporary = root.join(HOLD_TEMP);
    let written = (|| -> io::Result<()> {
        let mut file = File::create(&temporary)?;
        io::Write::write_all(&mut file, &bytes)?;
        file.sync_all()?;
        drop(file);
        points::rename_with_retry(&temporary, &root.join(HOLD_FILE))
    })();
    written.map_err(|error| {
        let _ = fs::remove_file(&temporary);
        EngineError::from(error)
    })
}

/// SHA-256 первого мебибайта файла (или всего файла, если он короче).
fn head_digest(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut buffer = Vec::new();
    io::Read::by_ref(&mut file)
        .take(HEAD_BYTES)
        .read_to_end(&mut buffer)?;
    Ok(hex_upper(Sha256::digest(&buffer).as_slice()))
}

// ---------------------------------------------------------------------------
// Первый шаг
// ---------------------------------------------------------------------------

/// Запись «собирается» раньше первой копии «до»: обрыв сборки оставит то, что
/// можно найти и убрать.
pub(super) fn write_building(
    session: &mut Session,
    plans: &[Plan],
    install: &Install,
) -> Result<()> {
    // замок раньше записи: пока запись видна уборке, сборка идёт под замком
    let lock = take_lock(&session.root, &session.id)?;
    session.claims.hold = true;
    *session
        .lock
        .get_mut()
        .unwrap_or_else(PoisonError::into_inner) = Some(lock);
    let mut targets = Vec::new();
    for plan in plans {
        let (live_len, live_modified, live_head) = if plan.created {
            (0, None, String::new())
        } else {
            let stamp = points::stamp(&plan.live)?;
            (stamp.len, moment(stamp.modified), head_digest(&plan.live)?)
        };
        let stage_dir = plan.stage_dir();
        targets.push(Target {
            archive: plan.archive.clone(),
            live: plan.live.clone(),
            created: plan.created,
            stage_file: stage_dir.join(plan.leaf()),
            stage_preexisting: stage_dir.exists(),
            stage_dir,
            live_len,
            live_modified,
            live_head,
            aside: session
                .aside
                .then(|| points::aside_path(&plan.live, &session.id)),
            before: None,
            sha256_before: String::new(),
            sha256_after: String::new(),
            stage_len: 0,
            stage_modified: None,
            stage_key: None,
        });
    }
    let record = Record {
        state: State::Building,
        id: session.id.clone(),
        game_root: install.game_root.clone(),
        root: session.root.clone(),
        owned: session.claims.root,
        aside: session.aside,
        replay: false,
        recipe: None,
        recipe_draft: None,
        // опись, что лежала в точке до удержания, началом подмены не считается
        manifest_at_hold: Some(
            session
                .claims
                .manifest_before
                .map(|stamp| (stamp.len, moment(stamp.modified))),
        ),
        created_dirs: Vec::new(),
        footprint: Vec::new(),
        answer: Value::Null,
        targets,
        append: None,
    };
    write_record(&session.root, &record)
}

/// Удержания с таким id нет: записи нет или нет папки точки.
fn missing(id: &str) -> EngineError {
    EngineError::new(
        HOLD_MISSING,
        format!("There is no held install with the point id {id}."),
    )
}

fn busy(id: &str) -> EngineError {
    EngineError::new(
        HOLD_BUSY,
        format!("The held install {id} is being worked on by another step."),
    )
}

/// Берёт замок удержания, подождав недолго (`LOCK_WAIT`): его мог держать читатель
/// файла или шаг, что вот-вот кончится. Занят — `HoldBusy`.
fn take_lock(root: &Path, id: &str) -> Result<HoldLock> {
    match HoldLock::take_within(root, LOCK_WAIT) {
        Ok(Some(lock)) => Ok(lock),
        Ok(None) => Err(busy(id)),
        Err(error) => Err(EngineError::from(error)),
    }
}

/// Стейдж собран, проверен движком и лежит рядом с живым файлом. Запись
/// удержания переписывается как «удержан», ответ называет стейдж.
pub(super) fn finish_hold(
    session: &mut Session,
    landed: &[Landed<'_>],
    staged: &[Staged],
    install: &Install,
    checked: &Option<ExpectedNote>,
) -> Result<Value> {
    let sealed = seal_record(session, landed, staged, install, checked);
    let record = sealed.map_err(|error| session.abort(error, staged))?;
    write_record(&session.root, &record).map_err(|error| session.abort(error, staged))?;
    failpoint::hit("hold-after-record");
    let mut answer = session.report(landed, install);
    answer["status"] = json!("held");
    answer["pointId"] = json!(session.id);
    if let Some(first) = record.targets.first() {
        answer["stage"] = path_text(&first.stage_file);
        answer["stageSha256"] = json!(first.sha256_after.to_ascii_lowercase());
    }
    if let Some(rows) = answer.get_mut("archives").and_then(Value::as_array_mut) {
        for (row, target) in rows.iter_mut().zip(&record.targets) {
            row["stage"] = path_text(&target.stage_file);
        }
    }
    if let Some(note) = checked {
        answer["expected"] = note.to_json();
    }
    Ok(answer)
}

/// Дописывает запись «собирается» тем, что стало известно после сборки.
fn seal_record(
    session: &Session,
    landed: &[Landed<'_>],
    staged: &[Staged],
    install: &Install,
    checked: &Option<ExpectedNote>,
) -> Result<Record> {
    let mut record = Record::read(&session.root.join(HOLD_FILE))
        .ok_or_else(|| EngineError::internal("The hold record was lost while building."))?;
    for ((target, backup), piece) in record.targets.iter_mut().zip(&session.backups).zip(staged) {
        target.sha256_after.clone_from(&piece.sha256_after);
        let stage = points::stamp(&piece.staged)?;
        target.stage_len = stage.len;
        target.stage_modified = moment(stage.modified);
        target.stage_key = points::file_key(&piece.staged).ok();
        if !backup.absent {
            target.before = Some(backup.path.clone());
            target.sha256_before = backup.hash()?;
            // отпечаток живого файла на момент копии «до»: с ним сверяется `commit`
            target.live_len = backup.stamp.len;
            target.live_modified = moment(backup.stamp.modified);
        }
    }
    record.state = State::Held;
    record.created_dirs.clone_from(&session.footprint.game_dirs);
    record.footprint.clone_from(&session.footprint.dirs);
    record.replay = session.claims.replay;
    if let [one] = landed {
        if one.plan.prebuilt.is_none() {
            record.recipe.clone_from(&install.options.save_recipe);
            // рецепт первого шага лежит заготовкой в точке; на место он встаёт на `commit`
            record.recipe_draft = record
                .recipe
                .as_ref()
                .map(|_| session.root.join(RECIPE_DRAFT));
        }
    }
    let head = landed.first();
    record.answer = json!({
        "operations": head.map_or(Value::Null, |one| one.built.operations.clone()),
        "timings": head.map_or(Value::Null, |one| one.built.timings.clone()),
        "bytes": head.map_or(0, |one| one.built.bytes),
        "expected": checked.as_ref().map_or(Value::Null, ExpectedNote::to_json),
    });
    Ok(record)
}

// ---------------------------------------------------------------------------
// Второй шаг
// ---------------------------------------------------------------------------

/// Вход команды `compose-rpf` для `commit` и `discard`: папка точек и ключи берутся
/// из параметров команды (ArchiveFix не нужен).
pub fn finish_hold_command(
    options: &Options,
    request: &Request,
    progress: &Progress,
) -> Result<Value> {
    let install = request
        .install
        .as_ref()
        .ok_or_else(|| EngineError::internal(super::NO_INSTALL_BLOCK))?;
    let points_root = points::restore_points_root_for(options)?;
    // дозапись открывает записанный архив ключами игры, у полного пути они нужны
    // только ожиданиям запроса
    let appended = install.options.commit.as_deref().is_some_and(|id| {
        Record::load(&points_root, id).is_ok_and(|record| record.append.is_some())
    });
    let needs_keys =
        install.options.commit.is_some() && (appended || !install.options.expect.is_empty());
    let keys = if needs_keys {
        let game = install.game_root.to_string_lossy().into_owned();
        let hint = options.optional("game-root").unwrap_or(&game);
        Some(super::super::append::command_keys(options, hint)?)
    } else {
        None
    };
    finish(request, keys.as_ref(), progress, &points_root)
}

/// Второй шаг по запросу с `commit` или `discard`.
pub(super) fn finish(
    request: &Request,
    keys: Option<&SharedKeys>,
    progress: &Progress,
    points_root: &Path,
) -> Result<Value> {
    let install = request
        .install
        .as_ref()
        .ok_or_else(|| EngineError::internal(super::NO_INSTALL_BLOCK))?;
    match (&install.options.commit, &install.options.discard) {
        (Some(id), None) => commit(install, id, keys, progress, points_root),
        (None, Some(id)) => discard(install, id, progress, points_root),
        _ => Err(EngineError::internal(
            "A hold step was asked for without commit or discard.",
        )),
    }
}

/// Собирает из записи ту же сессию, что была при `hold`.
fn revive(record: &Record, lock: HoldLock) -> (Session, Vec<Plan>, Vec<Staged>) {
    let root = record.root.clone();
    let backups = record
        .targets
        .iter()
        .map(|target| match (&target.before, target.created) {
            (_, true) => absent_backup(&root, &target.archive),
            (before, false) => Backup::recorded(
                before
                    .clone()
                    .unwrap_or_else(|| points::backup_path(&root, &target.archive)),
                points::Stamp {
                    len: target.live_len,
                    modified: from_moment(target.live_modified),
                },
                target.sha256_before.clone(),
            ),
        })
        .collect();
    let session = Session {
        claims: Claims {
            manifest_before: points::stamp(&root.join(MANIFEST_FILE)).ok(),
            root: record.owned,
            replay: record.replay,
            hold: true,
        },
        targets: record
            .targets
            .iter()
            .map(|target| (target.archive.clone(), target.live.clone()))
            .collect(),
        backups,
        footprint: Footprint {
            dirs: record.footprint.clone(),
            game_dirs: record.created_dirs.clone(),
        },
        id: record.id.clone(),
        aside: record.aside,
        root,
        lock: Mutex::new(Some(lock)),
    };
    let plans = record
        .targets
        .iter()
        .map(|target| Plan {
            archive: target.archive.clone(),
            live: target.live.clone(),
            prebuilt: None,
            created: target.created,
            stage_name: target
                .stage_dir
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
        })
        .collect();
    let staged = record
        .targets
        .iter()
        .map(|target| Staged {
            live: target.live.clone(),
            relative: target.archive.clone(),
            staged: target.stage_file.clone(),
            stage_dir: target.stage_dir.clone(),
            preexisting: target.stage_preexisting,
            sha256_after: target.sha256_after.clone(),
        })
        .collect();
    (session, plans, staged)
}

fn refuse(code: &'static str, message: String) -> EngineError {
    EngineError::new(code, message)
}

/// Живой архив и стейдж те же, что при `hold`; «до» рядом на месте.
fn verify(
    record: &Record,
    install: &Install,
    check: StageCheck,
    progress: &Progress,
) -> Result<()> {
    for target in &record.targets {
        let name = &target.archive;
        if target.created {
            if target.live.exists() {
                return Err(refuse(
                    LIVE_CHANGED,
                    format!("{name} appeared after the hold: nothing was swapped."),
                ));
            }
        } else {
            let changed = |what: &str| {
                refuse(
                    LIVE_CHANGED,
                    format!("{name} {what} after the hold: nothing was swapped."),
                )
            };
            let now = points::stamp(&target.live).map_err(|_| changed("is gone"))?;
            if now.len != target.live_len || moment(now.modified) != target.live_modified {
                return Err(changed("changed"));
            }
            let head = head_digest(&target.live).map_err(|_| changed("does not read"))?;
            if head != target.live_head {
                return Err(changed("has another head"));
            }
            let kept = target
                .before
                .as_deref()
                .and_then(|path| fs::metadata(path).ok())
                .map(|facts| facts.len());
            if kept != Some(target.live_len) {
                return Err(refuse(
                    HOLD_BROKEN,
                    format!("The copy of {name} from before the hold is gone: nothing was swapped."),
                ));
            }
        }
        let gone = || {
            refuse(
                STAGE_CHANGED,
                format!("The held archive of {name} is gone: nothing was swapped."),
            )
        };
        let stage = points::stamp(&target.stage_file).map_err(|_| gone())?;
        if stage.len != target.stage_len || moment(stage.modified) != target.stage_modified {
            return Err(refuse(
                STAGE_CHANGED,
                format!("The held archive of {name} changed after the hold: nothing was swapped."),
            ));
        }
        // другой файл под тем же именем, той же длины и с тем же временем
        let other_file = target
            .stage_key
            .zip(points::file_key(&target.stage_file).ok())
            .is_some_and(|(wanted, found)| wanted != found);
        if other_file {
            return Err(refuse(
                STAGE_CHANGED,
                format!("The held archive of {name} is another file than at the hold: nothing was swapped."),
            ));
        }
    }
    // отпечаток, который приложение проверило: стейдж обязан быть тем самым
    let wanted = install
        .targets
        .iter()
        .filter_map(|one| one.sha256.as_deref().map(|sha| (fold_text(&one.archive), sha)))
        .chain(
            install
                .options
                .expect_sha256
                .as_deref()
                .zip(record.targets.first())
                .map(|(sha, first)| (fold_text(&first.archive), sha)),
        );
    for (archive, sha) in wanted {
        let held = record
            .targets
            .iter()
            .find(|target| fold_text(&target.archive) == archive);
        if held.is_some_and(|target| !target.sha256_after.eq_ignore_ascii_case(sha)) {
            return Err(refuse(
                STAGE_CHANGED,
                format!("The held archive of {archive} is not the one the caller checked."),
            ));
        }
    }
    progress.checkpoint()?;
    if check == StageCheck::Sha256 {
        progress.report("verify");
        for target in &record.targets {
            let found = sha256_file(&target.stage_file)?;
            if !found.eq_ignore_ascii_case(&target.sha256_after) {
                return Err(refuse(
                    STAGE_CHANGED,
                    format!(
                        "The held archive of {} has another sha256 than at the hold: nothing was swapped.",
                        target.archive
                    ),
                ));
            }
            progress.checkpoint()?;
        }
    }
    Ok(())
}

fn commit(
    install: &Install,
    id: &str,
    keys: Option<&SharedKeys>,
    progress: &Progress,
    points_root: &Path,
) -> Result<Value> {
    let (record, lock) = lock_record(points_root, id, install)?;
    match record.state {
        State::Held => {}
        State::Building => {
            return Err(EngineError::new(
                HOLD_MISSING,
                format!("The install {id} was not held: its build did not end."),
            ));
        }
        State::Dropping => {
            return Err(EngineError::new(
                HOLD_MISSING,
                format!("The held install {id} is being removed."),
            ));
        }
    }
    if record.append.is_some() {
        return commit_append(install, &record, keys, progress, lock);
    }
    // Подмена могла пройти раньше (процесс убит до уборки, приложение повторяет
    // `commit`): живой файл тогда уже новый, и это не чужая правка. Точку отката
    // такой повтор не трогает.
    match record.landing(install.options.stage_check) {
        Landing::Swapped => {
            let (session, plans, _) = revive(&record, lock);
            return finish_swapped(&record, &session, &plans, install);
        }
        Landing::Foreign if record.swap_began() => return Err(foreign_after_swap(&record, lock)),
        Landing::Untouched | Landing::Foreign => {}
    }
    let (session, plans, staged) = revive(&record, lock);
    let verified = verify(&record, install, install.options.stage_check, progress);
    verified.map_err(|error| session.abort(error, &staged))?;
    // ожидания запроса к стейджу (правила приложения проверили его раньше; то,
    // что названо здесь, движок сверяет ещё раз перед самой подменой)
    let checked = match keys {
        Some(keys) => check_expectations(&plans, &staged, install, keys),
        None if install.options.expect.is_empty() => Ok(None),
        None => Err(EngineError::argument(
            "Install expectations need the game keys.",
        )),
    }
    .map_err(|error| session.abort(error, &staged))?;
    // отмена до подмены: удержание уходит, живой архив не тронут
    session.checkpoint(progress, &staged)?;
    failpoint::hit("commit-after-check");
    let effective = effective_of(&record, install);
    let landed = landed_of(&plans, &record);
    session.commit(&effective, staged, progress)?;
    failpoint::hit("commit-after-swap");
    install_recipe(&record)?;
    let mut answer = session.report(&landed, &effective);
    answer["held"] = json!(true);
    seal_answer(&mut answer, &record, &session);
    if let Some(note) = checked {
        answer["expected"] = note.to_json();
    }
    Ok(answer)
}

/// Запрос второго шага с тем, что помнит запись.
fn effective_of(record: &Record, install: &Install) -> Install {
    let mut effective = install.clone();
    effective.options.before_aside = record.aside;
    effective.options.save_recipe.clone_from(&record.recipe);
    effective
}

/// Собранные цели по записи удержания: то, что ответ обычной установки берёт у сборки.
fn landed_of<'p>(plans: &'p [Plan], record: &Record) -> Vec<Landed<'p>> {
    plans
        .iter()
        .zip(&record.targets)
        .enumerate()
        .map(|(index, (plan, target))| Landed {
            plan,
            built: Built {
                sha256: target.sha256_after.to_ascii_lowercase(),
                operations: if index == 0 {
                    record.answer["operations"].clone()
                } else {
                    Value::Null
                },
                timings: if index == 0 {
                    record.answer["timings"].clone()
                } else {
                    Value::Null
                },
                bytes: if index == 0 {
                    record.answer["bytes"].as_u64().unwrap_or(0)
                } else {
                    0
                },
            },
        })
        .collect()
}

/// Рецепт вступает в силу: заготовка из точки ложится на место рецепта целиком
/// (временный файл рядом, сброс на диск, переименование поверх), потом уходит.
/// Повторный вызов безвреден: заготовки уже нет — рецепт на месте. Отказ — после
/// подмены, поэтому он называется отдельным кодом: повторный `commit` доводит.
fn install_recipe(record: &Record) -> Result<()> {
    let (Some(draft), Some(target)) = (&record.recipe_draft, &record.recipe) else {
        return Ok(());
    };
    let unfinished = |what: &str, error: &dyn std::fmt::Display| {
        refuse(
            HOLD_UNFINISHED,
            format!(
                "The swap of {} is done, but {what}: {error}. Commit again to finish it.",
                record.id
            ),
        )
    };
    let bytes = match fs::read(draft) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return if target.is_file() {
                Ok(())
            } else {
                Err(unfinished("the draft of the recipe is gone", &error))
            };
        }
        Err(error) => return Err(unfinished("the draft of the recipe does not read", &error)),
    };
    let temporary = points::sibling_name(target, "tmp");
    let written = (|| -> io::Result<()> {
        if let Some(folder) = target.parent() {
            fs::create_dir_all(folder)?;
        }
        fs::write(&temporary, &bytes)?;
        points::flush_to_disk(&temporary)?;
        points::rename_with_retry(&temporary, target)
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(unfinished("the recipe was not written", &error));
    }
    let _ = fs::remove_file(draft);
    Ok(())
}

/// Конец подмены: запись удержания убирается, и отказ убрать виден в ответе
/// (`holdRecord: "kept"`), а не теряется. Подмена к этому времени прошла, точка
/// цела; повторный `commit` или уборка доберут запись.
fn seal_answer(answer: &mut Value, record: &Record, session: &Session) {
    let gone = remove_record(&record.root);
    if !gone {
        answer["holdRecord"] = json!("kept");
    }
    // замок уходит последним: пока запись лежит, уборка идёт за замком
    if let Some(lock) = session.take_lock() {
        if gone {
            lock.release();
        } else {
            lock.close();
        }
    }
    let remembered = &record.answer["expected"];
    if !remembered.is_null() {
        answer["expected"] = remembered.clone();
    }
}

/// Сколько раз и с какой паузой убирается запись удержания: её может держать
/// открытой сканер файлов.
const RECORD_TRIES: u32 = 5;
const RECORD_PAUSE: Duration = Duration::from_millis(100);

/// Убирает `hold.json`; `false`, если не удалось (занят) — это попадает в журнал.
fn remove_record(root: &Path) -> bool {
    let file = root.join(HOLD_FILE);
    for attempt in 1..=RECORD_TRIES {
        match fs::remove_file(&file) {
            Ok(()) => return true,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return true,
            Err(error) if attempt == RECORD_TRIES => {
                log(format!(
                    "[Install] Запись удержания {} не убрана: {error}",
                    file.display()
                ));
            }
            Err(_) => std::thread::sleep(RECORD_PAUSE),
        }
    }
    false
}

/// Повторный `commit` по подмене, что уже прошла: ничего не меняется, запись
/// удержания доводится, ответ тот же, что дал бы первый `commit`, с признаком
/// `repeated`. Точка с описью и «до» не трогаются.
fn finish_swapped(
    record: &Record,
    session: &Session,
    plans: &[Plan],
    install: &Install,
) -> Result<Value> {
    // стейдж ушёл вместе с подменой; пустая служебная папка и остатки добираются
    for target in &record.targets {
        let _ = if target.stage_preexisting {
            fs::remove_file(&target.stage_file)
        } else {
            fs::remove_dir_all(&target.stage_dir)
        };
    }
    install_recipe(record)?;
    let effective = effective_of(record, install);
    let landed = landed_of(plans, record);
    let mut answer = session.report(&landed, &effective);
    answer["held"] = json!(true);
    answer["repeated"] = json!(true);
    seal_answer(&mut answer, record, session);
    Ok(answer)
}

/// Чужая правка живого файла после того, как `commit` начал подмену: подмена
/// наша могла быть, и точка с описью остаётся откату. Стейдж и запись уходят.
fn foreign_after_swap(record: &Record, lock: HoldLock) -> EngineError {
    abandon(record, lock, false);
    refuse(
        LIVE_CHANGED,
        format!(
            "{} is not the archive of the hold any more, and the swap had begun: the restore point {} is kept.",
            record.names().join(", "),
            record.id
        ),
    )
}

fn discard(install: &Install, id: &str, progress: &Progress, points_root: &Path) -> Result<Value> {
    // отмена до начала: удержание остаётся, его уберёт следующая установка или settle
    progress.checkpoint()?;
    let (record, lock) = lock_record(points_root, id, install)?;
    let gone = abandon(&record, lock, false);
    let archives: Vec<Value> = match &record.append {
        Some(note) => vec![json!({ "archive": note.archive, "created": false })],
        None => record
            .targets
            .iter()
            .map(|target| json!({ "archive": target.archive, "created": target.created }))
            .collect(),
    };
    Ok(json!({
        "status": "discarded",
        "mode": MODE_NAME,
        "id": record.id,
        "pointId": record.id,
        "restoreRoot": path_text(&record.root),
        "archive": record.names().first().cloned(),
        "archives": archives,
        "point": match gone {
            Gone::Whole => "removed",
            Gone::KeptPoint => "kept",
            // стейдж занят: удержание уже не подменить, остальное доберёт уборка
            Gone::Stuck => "pending",
        },
    }))
}

/// Запись удержания под замком шага (`commit`, `discard`). Замок ждётся недолго:
/// его держит уборка или чужой шаг. Запись читается дважды: до замка (чтобы не
/// создавать замок там, где удержания нет) и под замком (её могли убрать или
/// переписать, пока замок был чужим).
fn lock_record(points_root: &Path, id: &str, install: &Install) -> Result<(Record, HoldLock)> {
    let first = Record::load(points_root, id)?;
    first.matches(install)?;
    failpoint::hit("commit-before-lock");
    let lock = match HoldLock::take_within(&first.root, LOCK_WAIT) {
        Ok(Some(lock)) => lock,
        Ok(None) => return Err(busy(id)),
        // пока шла очередь за замком, уборка унесла папку точки: удержания нет
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(missing(id)),
        Err(error) => return Err(EngineError::from(error)),
    };
    match Record::load(points_root, id).and_then(|record| record.matches(install).map(|()| record)) {
        Ok(record) => Ok((record, lock)),
        Err(error) => {
            if error.code == HOLD_MISSING {
                lock.release();
            }
            Err(error)
        }
    }
}

// ---------------------------------------------------------------------------
// Дозапись в два шага
// ---------------------------------------------------------------------------

/// Что `append_core` отдаёт, когда дозапись удержана: по этому пишется запись
/// удержания рядом с файлом будущих голов.
pub(crate) struct AppendHold<'a> {
    pub id: &'a str,
    pub game_root: &'a Path,
    pub root: &'a Path,
    /// Папку точки создала эта дозапись.
    pub owned: bool,
    pub replay_written: bool,
    pub archive: &'a str,
    pub live: &'a Path,
    pub seq: u64,
    pub fingerprint_before: &'a str,
    pub fingerprint_after: &'a str,
    pub chain_base: &'a str,
    pub recipe: Option<&'a Path>,
    pub held: &'a HeldHead,
    /// Ответ дозаписи, каким его вернёт второй шаг.
    pub answer: &'a Value,
}

/// Запись «собирается» удержанной дозаписи: ложится сразу за описью точки, раньше
/// первых тел. Оборванная дозапись оставляет по себе запись, которую можно найти
/// и убрать (откат записи журнала, файл голов, точка). Замок удержания берётся
/// раньше записи и возвращается вызывающему: он держит его, пока идёт запись тел.
pub(crate) fn start_append_hold(hold: &AppendStart<'_>) -> Result<HoldLock> {
    let lock = take_lock(hold.root, hold.id)?;
    let record = Record {
        state: State::Building,
        id: hold.id.to_owned(),
        game_root: hold.game_root.to_path_buf(),
        root: hold.root.to_path_buf(),
        owned: hold.owned,
        aside: false,
        replay: hold.replay_written,
        recipe: None,
        recipe_draft: None,
        manifest_at_hold: None,
        created_dirs: Vec::new(),
        footprint: Vec::new(),
        answer: Value::Null,
        targets: Vec::new(),
        append: Some(AppendNote {
            archive: hold.archive.to_owned(),
            live: hold.live.to_path_buf(),
            seq: hold.seq,
            preview: held_path(hold.live),
            preview_sha256: String::new(),
            fingerprint_before: String::new(),
            fingerprint_after: String::new(),
            chain_base: String::new(),
        }),
    };
    write_record(hold.root, &record)?;
    Ok(lock)
}

/// Что известно о дозаписи до первых тел.
pub(crate) struct AppendStart<'a> {
    pub id: &'a str,
    pub game_root: &'a Path,
    pub root: &'a Path,
    pub owned: bool,
    pub replay_written: bool,
    pub archive: &'a str,
    pub live: &'a Path,
    pub seq: u64,
}

/// Файл будущих голов (целиком, на диск, переименованием) и запись удержания.
/// Возвращает путь файла и его SHA-256. Отказ оставляет то, что успело лечь:
/// убирает вызывающий (откат записи журнала и `claims.clean_up`).
pub(crate) fn write_append_hold(hold: &AppendHold<'_>) -> Result<(PathBuf, String)> {
    let preview = held_path(hold.live);
    let bytes = hold.held.to_bytes();
    let sha256 = hex_upper(Sha256::digest(&bytes).as_slice());
    let temporary = PathBuf::from(format!("{}.tmp", preview.to_string_lossy()));
    let written = (|| -> io::Result<()> {
        let mut file = File::create(&temporary)?;
        io::Write::write_all(&mut file, &bytes)?;
        file.sync_all()?;
        drop(file);
        points::rename_with_retry(&temporary, &preview)
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(EngineError::from(error));
    }
    let record = Record {
        state: State::Held,
        id: hold.id.to_owned(),
        game_root: hold.game_root.to_path_buf(),
        root: hold.root.to_path_buf(),
        owned: hold.owned,
        aside: false,
        replay: hold.replay_written,
        recipe: hold.recipe.map(Path::to_path_buf),
        recipe_draft: None,
        manifest_at_hold: None,
        created_dirs: Vec::new(),
        footprint: Vec::new(),
        answer: hold.answer.clone(),
        targets: Vec::new(),
        append: Some(AppendNote {
            archive: hold.archive.to_owned(),
            live: hold.live.to_path_buf(),
            seq: hold.seq,
            preview: preview.clone(),
            preview_sha256: sha256.clone(),
            fingerprint_before: hold.fingerprint_before.to_owned(),
            fingerprint_after: hold.fingerprint_after.to_owned(),
            chain_base: hold.chain_base.to_owned(),
        }),
    };
    write_record(hold.root, &record)?;
    failpoint::hit("hold-after-record");
    Ok((preview, sha256))
}

/// Второй шаг удержанной дозаписи: головы ложатся, запись доводится до «готово».
fn commit_append(
    install: &Install,
    record: &Record,
    keys: Option<&SharedKeys>,
    progress: &Progress,
    lock: HoldLock,
) -> Result<Value> {
    let Some(note) = &record.append else {
        return Err(EngineError::internal("Not an appended hold."));
    };
    let Some(keys) = keys else {
        return Err(EngineError::argument(
            "Committing an appended install needs the game keys.",
        ));
    };
    // отмена до первой записи голов: удержание уходит, архив прежний
    if let Err(error) = progress.checkpoint() {
        abandon(record, lock, false);
        return Err(error);
    }
    let gone = |what: &str| {
        refuse(
            HOLD_BROKEN,
            format!(
                "The file of the held heads of {} {what}: nothing was written.",
                note.archive
            ),
        )
    };
    let held = fs::read(&note.preview)
        .map_err(|_| gone("is gone"))
        .and_then(|bytes| {
            if hex_upper(Sha256::digest(&bytes).as_slice()) != note.preview_sha256 {
                return Err(refuse(
                    STAGE_CHANGED,
                    format!(
                        "The file of the held heads of {} changed after the hold.",
                        note.archive
                    ),
                ));
            }
            HeldHead::from_bytes(&bytes).map_err(append_error)
        });
    let held = match held {
        Ok(held) => held,
        Err(error) => {
            abandon(record, lock, false);
            return Err(error);
        }
    };
    let wanted = expect::Wanted::of(&install.options.expect, &note.archive, true);
    let mut checked: Option<expect::Checked> = None;
    let mut verify = |opened: &rage_rpf::Archive| -> std::result::Result<(), String> {
        if wanted.is_empty() {
            return Ok(());
        }
        let done = expect::check_archive(opened, &wanted).map_err(|error| error.message)?;
        checked = Some(done);
        Ok(())
    };
    let began = std::time::Instant::now();
    let committed = {
        let _hook = rage_rpf::activity::install(std::sync::Arc::new(progress.clone()));
        let host = super::super::append::EngineHost;
        let lifted = points::ReadonlyLift::take_off(&note.live).map_err(EngineError::from);
        let opened = lifted.and_then(|lift| {
            open_append_session(&host, &note.live, progress).map(|session| (lift, session))
        });
        match opened {
            Ok((_lift, mut session)) => session
                .commit_held(
                    &held,
                    keys,
                    install.options.stage_check == StageCheck::Sha256,
                    &mut verify,
                )
                .map_err(append_error),
            Err(error) => Err(error),
        }
    };
    let report = match committed {
        Ok(report) => report,
        Err(error) => return fail_append(record, lock, error),
    };
    // опись точки: отпечатки после записи те же, что назвало удержание
    let item = points::AppendItem {
        live_path: note.live.clone(),
        relative_path: note.archive.clone(),
        record: note.seq,
        fingerprint_before: note.fingerprint_before.clone(),
        fingerprint_after: report.fingerprint.clone(),
        chain_base: note.chain_base.clone(),
    };
    let written = points::write_append_manifest(
        &record.root,
        &record.id,
        &record.game_root,
        &record.root.join(REPLAY_FILE),
        &item,
    );
    if let Err(error) = written {
        // опись не переписалась: ответ «готово» верен, только если опись первого
        // шага уже называет те же запись и отпечатки; иначе откат точки не знает,
        // чему верить
        if !manifest_names(&record.root, &item) {
            let _ = fs::remove_file(&note.preview);
            lock.close();
            return Err(refuse(
                HOLD_UNFINISHED,
                format!(
                    "The heads of {} are written, but the restore point record was not updated: {}",
                    note.archive, error.message
                ),
            ));
        }
        log(format!(
            "[Install] Опись точки {} не переписана ({}): опись первого шага названа верно",
            record.id, error.message
        ));
    }
    let _ = fs::remove_file(&note.preview);
    if remove_record(&record.root) {
        lock.release();
    } else {
        lock.close();
    }
    let mut answer = record.answer.clone();
    answer["status"] = json!("ready");
    answer["held"] = json!(true);
    if let Some(timings) = answer.get_mut("timings").and_then(Value::as_object_mut) {
        timings.insert(
            "commit".to_owned(),
            json!(u64::try_from(began.elapsed().as_millis()).unwrap_or(u64::MAX)),
        );
        timings.insert("head".to_owned(), json!(report.timings.head));
    }
    if let Some(done) = checked {
        answer["expected"] = json!({ "entries": done.entries, "dlcPacks": done.dlc_packs });
    }
    Ok(answer)
}

/// Опись точки на диске называет эту запись журнала и эти отпечатки.
fn manifest_names(root: &Path, item: &points::AppendItem) -> bool {
    let Ok(read) = points::read_manifest(&root.join(MANIFEST_FILE)) else {
        return false;
    };
    let same = |found: Option<&str>, wanted: &str| found.is_some_and(|text| text.eq_ignore_ascii_case(wanted));
    read.archives.iter().any(|entry| {
        entry.append.as_ref().is_some_and(|mark| {
            mark.record == item.record && same(mark.chain_base.as_deref(), &item.chain_base)
        }) && same(entry.sha256_after.as_deref(), &item.fingerprint_after)
    })
}

/// Отказ второго шага дозаписи: удержание убирается (запись откатывается), ошибка идёт дальше.
fn fail_append(record: &Record, lock: HoldLock, error: EngineError) -> Result<Value> {
    abandon(record, lock, false);
    Err(error)
}

fn append_error(error: rage_rpf::append::AppendError) -> EngineError {
    super::super::append::engine_error(error)
}

fn open_append_session<'h>(
    host: &'h super::super::append::EngineHost,
    live: &Path,
    progress: &Progress,
) -> std::result::Result<rage_rpf::append::Session<'h>, EngineError> {
    super::super::append::open_session(host, live, progress, super::super::append::tuning())
}

/// Убирает удержание дозаписи: запись журнала откатывается (`settle`), файл
/// будущих голов и точка уходят. Запись, что успела дойти до «готово», остаётся:
/// уходит только запись удержания, а точка откатит её. Файл занят или не
/// открывается — ничего не убирается (`Stuck`), повторит следующая уборка.
fn abandon_append(record: &Record, lock: HoldLock) -> Gone {
    let Some(note) = &record.append else {
        return Gone::Stuck;
    };
    let mut finished = false;
    if note.live.is_file() && rage_rpf::journal::journal_path(&note.live).is_file() {
        let host = super::super::append::EngineHost;
        let opened =
            rage_rpf::append::Session::open(&host, &note.live, super::super::append::tuning());
        let _lift = points::ReadonlyLift::take_off(&note.live);
        match opened {
            Ok(mut session) => {
                let notes = super::super::summary::recipe_notes(session.replay());
                match session.settle() {
                    Ok(rage_rpf::append::Settled::Completed(_)) => finished = true,
                    Ok(_) => {}
                    // файл подменили: доводить нечего, откатывать не во что
                    Err(rage_rpf::append::AppendError::Refused { .. }) => {}
                    // занят или не читается: оставить всё на следующую уборку
                    Err(_) => return Gone::Stuck,
                }
                finished |= session.replay().records.iter().any(|one| {
                    one.begin.seq == note.seq && one.phase == rage_rpf::journal::Phase::Done
                });
                super::super::append::reconcile_recipes(&notes, session.replay());
            }
            Err(rage_rpf::append::AppendError::Refused { .. }) => {}
            Err(_) => return Gone::Stuck,
        }
    }
    let _ = fs::remove_file(&note.preview);
    if finished {
        // запись дошла до «готово»: точка с описью откатит её
        let _ = fs::remove_file(record.root.join(HOLD_FILE));
        lock.release();
        return Gone::KeptPoint;
    }
    if record.owned {
        lock.close();
        let _ = fs::remove_dir_all(&record.root);
    } else {
        if record.replay {
            let _ = fs::remove_file(record.root.join(REPLAY_FILE));
        }
        let _ = fs::remove_file(record.root.join(MANIFEST_FILE));
        let _ = fs::remove_file(record.root.join(HOLD_FILE));
        lock.release();
    }
    if record.root.exists() {
        Gone::KeptPoint
    } else {
        Gone::Whole
    }
}

// ---------------------------------------------------------------------------
// Уборка
// ---------------------------------------------------------------------------

/// Чем кончилась уборка удержания.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Gone {
    /// Папка точки ушла вместе с удержанием.
    Whole,
    /// Удержание ушло, точка осталась: подмена дошла (откат вернёт «до») или
    /// папка точки лежала до установки.
    KeptPoint,
    /// Дальше идти нельзя: стейдж или архив заняты. Запись помечена «убирается»,
    /// `commit` по ней отказывает, «до» и точка на месте; доведёт следующая уборка.
    Stuck,
}

/// Убирает удержание под замком, который передаётся сюда: замок закрывается
/// там, где этого требует порядок (папку точки нельзя убрать с открытым замком).
///
/// Порядок. (1) Запись переписывается с меткой «убирается»: с этой минуты
/// `commit` по ней отказывает, а обрыв оставляет то, что можно довести. (2) Стейдж.
/// Он не ушёл — идти дальше нельзя: «до» и точка остаются, пока `commit` мог бы
/// подменить архив. (3) Созданное рядом с живым файлом, потом сама папка точки
/// вместе с записью. Живой файл уже другой и опись точки лежит — подмена дошла:
/// уходят стейдж, заготовка рецепта и запись, точка с описью остаётся откату.
///
/// `finish_recipe` — уборка брошенного удержания (`sweep`): если подмена прошла
/// целиком (то же, что `Landing::Swapped`) и заготовка рецепта ещё лежит, рецепт
/// доводится, а не стирается: у одношаговой установки рецепт ложится до подмены, у
/// подменённого архива он есть всегда. Не вышло записать — ничего не убирается
/// (`Stuck`: запись и заготовка остаются до следующей уборки). Чужая правка после
/// подмены, `discard` приложения и отказы шага рецепт не доводят: заготовка уходит.
fn abandon(record: &Record, lock: HoldLock, finish_recipe: bool) -> Gone {
    if record.append.is_some() {
        return abandon_append(record, lock);
    }
    let pending = record.recipe_draft.as_deref().is_some_and(Path::is_file);
    if finish_recipe
        && pending
        && record.swap_began()
        && record.landing(StageCheck::Quick) == Landing::Swapped
    {
        if let Err(error) = install_recipe(record) {
            log(format!(
                "[Install] Рецепт удержания {} не лёг при уборке: {}",
                record.id, error.message
            ));
            return Gone::Stuck;
        }
    }
    if record.state != State::Dropping {
        let mut marked = record.clone();
        marked.state = State::Dropping;
        if write_record(&record.root, &marked).is_err() {
            return Gone::Stuck;
        }
    }
    let mut stuck = false;
    for target in &record.targets {
        let (path, removed) = if target.stage_preexisting {
            (&target.stage_file, fs::remove_file(&target.stage_file))
        } else {
            (&target.stage_dir, fs::remove_dir_all(&target.stage_dir))
        };
        stuck |= removed.is_err() && path.exists();
    }
    if stuck {
        return Gone::Stuck;
    }
    let unchanged = record.targets.iter().all(Target::live_is_as_it_was);
    if !unchanged && record.swap_began() {
        // подмена дошла (или живой файл меняли): точка с описью остаётся откату,
        // а рецепт, что не вступил в силу, уходит: он описывает не то, что откатят
        remove_draft(record);
        let _ = fs::remove_file(record.root.join(HOLD_FILE));
        lock.release();
        return Gone::KeptPoint;
    }
    for target in &record.targets {
        for beside in [target.aside.as_ref(), target.before.as_ref()]
            .into_iter()
            .flatten()
            .filter(|path| !path.starts_with(&record.root))
        {
            let _ = fs::remove_file(beside);
        }
    }
    // папка точки лежала до установки: убирается только своё. Копии «до» уходят
    // раньше созданных папок, иначе папка под копией не пуста и остаётся.
    if !record.owned {
        for target in &record.targets {
            if let Some(copy) = target.before.as_ref().filter(|path| path.starts_with(&record.root)) {
                let _ = fs::remove_file(copy);
            }
        }
    }
    for dir in record.footprint.iter().rev() {
        let _ = fs::remove_dir(dir);
    }
    if record.owned {
        lock.close();
        let _ = fs::remove_dir_all(&record.root);
    } else {
        if record.replay {
            let _ = fs::remove_file(record.root.join(REPLAY_FILE));
        }
        remove_draft(record);
        let _ = fs::remove_file(record.root.join(HOLD_FILE));
        lock.release();
    }
    if record.root.exists() {
        Gone::KeptPoint
    } else {
        Gone::Whole
    }
}

/// Заготовка рецепта уходит с удержанием; рецепт по запросу не тронут.
fn remove_draft(record: &Record) {
    if let Some(draft) = &record.recipe_draft {
        let _ = fs::remove_file(draft);
    }
}

/// Что убрала уборка брошенных удержаний.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldSweep {
    pub id: String,
    pub archives: Vec<String>,
    /// Папка точки ушла (живой архив не менялся); иначе осталась точка с описью.
    pub point_removed: bool,
}

impl HeldSweep {
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "archives": self.archives,
            "point": if self.point_removed { "removed" } else { "kept" },
        })
    }
}

/// Запись удержания, которой уборка вправе заняться: читается, ей можно верить,
/// игра та же.
fn readable(hold_file: &Path, points_root: &Path, game_root: Option<&Path>) -> Option<Record> {
    let record = Record::read(hold_file).filter(|record| record.trusted(points_root))?;
    let other_game = game_root.is_some_and(|root| fold(root) != fold(&record.game_root));
    (!other_game).then_some(record)
}

/// Сколько запись не менялась.
fn age_of(hold_file: &Path) -> Option<Duration> {
    let modified = fs::metadata(hold_file).ok()?.modified().ok()?;
    SystemTime::now().duration_since(modified).ok()
}

/// Уборка. Удержание берётся под замок: занятый замок — живая работа, её не
/// трогают. Установка того же архива (`same`) не сносит живое, а отказывает
/// `HoldBusy`; остальные занятые просто пропускаются.
fn sweep(
    points_root: &Path,
    game_root: Option<&Path>,
    same: &[&Path],
    grace: Duration,
) -> Result<Vec<HeldSweep>> {
    let Ok(listing) = fs::read_dir(points_root) else {
        return Ok(Vec::new());
    };
    let mut swept = Vec::new();
    for entry in listing.flatten() {
        let hold_file = entry.path().join(HOLD_FILE);
        let Some(record) = readable(&hold_file, points_root, game_root) else {
            continue;
        };
        let superseded = |record: &Record| {
            record
                .lives()
                .iter()
                .any(|live| same.iter().any(|path| fold(path) == fold(live)))
        };
        if !superseded(&record) && !record.is_due(age_of(&hold_file), grace) {
            continue;
        }
        // установка того же архива ждёт замок недолго (его мог держать читатель
        // файла или шаг, что вот-вот кончится), прочая уборка берёт только свободный
        let taken = if superseded(&record) {
            HoldLock::take_within(&record.root, LOCK_WAIT)
        } else {
            HoldLock::try_take(&record.root)
        };
        let lock = match taken {
            Ok(Some(lock)) => lock,
            Ok(None) if superseded(&record) => return Err(busy(&record.id)),
            Ok(None) | Err(_) => continue,
        };
        // пока замок был чужим, запись могли довести, убрать или переписать
        let Some(record) = readable(&hold_file, points_root, game_root) else {
            lock.release();
            continue;
        };
        if !superseded(&record) && !record.is_due(age_of(&hold_file), grace) {
            lock.close();
            continue;
        }
        let (id, archives) = (record.id.clone(), record.names());
        match abandon(&record, lock, true) {
            Gone::Stuck => {}
            gone => swept.push(HeldSweep {
                id,
                archives,
                point_removed: gone == Gone::Whole,
            }),
        }
    }
    Ok(swept)
}

/// Установка убирает брошенные удержания тех же архивов (сразу) и чужие, что
/// лежат давно. Живое удержание того же архива — отказ `HoldBusy`.
pub(super) fn sweep_for_install(
    plans: &[Plan],
    install: &Install,
    points_root: &Path,
) -> Result<()> {
    let live: Vec<&Path> = plans.iter().map(|plan| plan.live.as_path()).collect();
    sweep(points_root, Some(&install.game_root), &live, GRACE_INSTALL).map(drop)
}

/// То же для дозаписи в `live`: она убирает брошенные удержания этого архива до
/// того, как откроет его на запись (удержанная запись журнала откатывается).
pub(crate) fn sweep_for_append(live: &Path, game_root: &Path, points_root: &Path) -> Result<()> {
    sweep(points_root, Some(game_root), &[live], GRACE_INSTALL).map(drop)
}

/// Уборка для `settle-rpf-journals`: удержания этой игры, с которыми никто не
/// работает и которые не ждут приложение дольше срока (`GRACE_SETTLE`, а для
/// ожидающих проверки — `HELD_LEASE`).
pub fn settle_holds(points_root: &Path, game_root: &Path) -> Vec<HeldSweep> {
    sweep(points_root, Some(game_root), &[], GRACE_SETTLE).unwrap_or_default()
}

#[cfg(test)]
mod tests;
