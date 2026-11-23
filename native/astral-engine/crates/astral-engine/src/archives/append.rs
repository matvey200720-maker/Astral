//! Дозапись в корневой архив: команды `append-rpf`, `rollback-rpf-append`,
//! `recover-rpf-append` и ключ `install.write: "append"` у `compose-rpf`.
//!
//! Писатель лежит в `rage_rpf::append`: здесь запросы, точка отката, ответы и
//! то, что знает только движок (число жёстких ссылок и номер файла, точки
//! обрыва для стендов, ожидание занятого файла).
//!
//! Точка отката установки — запись журнала `<архив>.astral-journal`, а не
//! копия файла. Опись точки (`restore.json`) называет номер записи в ключе
//! `append`; `restore-rpf-point` по нему откатывает записи журнала.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    thread::sleep,
    time::{Duration, Instant},
};

use rage_rpf::{
    activity,
    append::{
        held_path, hex, parse_digest, sha256, Ahead, AppendError, AppendInput, AppendReport, Facts,
        Host, RegistryPlace, Session, Settled, Tuning, KEEP_KEY_PAD_MAX,
    },
    journal::{self, journal_path, Phase, Replay},
    layers::LayerPlace,
    Archive, KeySet, RpfError,
};
use serde_json::{json, Map, Value};

use super::{
    compose::{self, apply_for_append, cancel_file_of, parse_request, Operation, Request},
    expect, load_keys, points,
    summary::{self, Standing, Summary, RECIPE_INCOMPLETE, RECIPE_MISSING},
};
use crate::{
    args::Options,
    disk::{self, WritePacer},
    error::{EngineError, Result},
    failpoint, paths,
    progress::Progress,
};

/// Выключатель дозаписи: слова модулей через запятую (как у
/// `ASTRAL_ENGINE_INSTALL_OPS`); по умолчанию выключен.
pub const APPEND_ENV: &str = "ASTRAL_ENGINE_APPEND";

/// Наименьший размер архива в МиБ, с которого идёт дозапись (умолчание 64).
/// Нужен стендам: настоящий порог для синтетических архивов велик.
pub const MIN_MB_ENV: &str = "ASTRAL_ENGINE_APPEND_MIN_MB";

/// Стенды: оставить дозаписи в два шага (`install.hold`) прежнее поведение. Первый
/// шаг такой дозаписи растит живой архив (тела в хвосте), а головы остаются
/// прежними: ключ шифрования головы зависит от длины файла, и между шагами игра,
/// запущенная мимо лаунчера, может не прочитать архив. Окно длится до `commit`,
/// `discard` или уборки, а не секунды, как у одного шага. Что игра берёт длину с
/// диска, не проверено, поэтому `hold` дозаписи по умолчанию отказывает. Ключ
/// запроса `install.keepKey` (R4) закрывает окно сам: файл растёт до длины с
/// прежним ключом, и `hold` с ним идёт без этого выключателя.
pub const HOLD_GROW_ENV: &str = "ASTRAL_ENGINE_APPEND_HOLD_GROW";

/// Код отказа `hold` у дозаписи без `HOLD_GROW_ENV`: ничего не записано.
pub const HOLD_UNSUPPORTED: &str = "HoldUnsupported";

/// Включено ли оно: только слово `1`.
fn grow_flag(value: Option<&str>) -> bool {
    value == Some("1")
}

fn hold_grow_allowed() -> bool {
    #[cfg(test)]
    if let Some(forced) = hold_grow::forced() {
        return forced;
    }
    grow_flag(env::var(HOLD_GROW_ENV).ok().as_deref())
}

/// В тестах движка выключатель по умолчанию включён (так проверяется сам путь
/// удержания дозаписи), а тест отказа выключает его на своей нити.
#[cfg(test)]
mod hold_grow {
    use std::cell::Cell;

    thread_local! {
        static FORCED: Cell<Option<bool>> = const { Cell::new(Some(true)) };
    }

    pub(super) fn forced() -> Option<bool> {
        FORCED.with(Cell::get)
    }

    /// Выключатель принудительно `on` на этой нити, пока жив возвращённый признак.
    pub(super) struct Forced(Option<bool>);

    pub(super) fn force(on: bool) -> Forced {
        Forced(FORCED.with(|cell| cell.replace(Some(on))))
    }

    impl Drop for Forced {
        fn drop(&mut self) {
            FORCED.with(|cell| cell.set(self.0));
        }
    }
}

/// Слово модуля из записи переигрывания установки.
fn module_of(replay: &Value) -> &str {
    replay.get("module").and_then(Value::as_str).unwrap_or("")
}

/// Включена ли дозапись для модуля: слово модуля есть в списке (регистр и
/// пробелы по краям слов не важны).
pub fn enabled_for(module: &str, list: Option<&str>) -> bool {
    let wanted = module.to_lowercase();
    !wanted.is_empty()
        && list
            .unwrap_or_default()
            .split(',')
            .any(|item| item.trim().to_lowercase() == wanted)
}

/// Порог мёртвых байт в МиБ, после которого пора уплотнять (умолчание 256; 0 —
/// порога нет). Нужен стендам.
pub const DEAD_MB_ENV: &str = "ASTRAL_ENGINE_APPEND_DEAD_MB";

/// Долю архива, которую не должны переходить мёртвые байты, задаёт знаменатель:
/// 8 — одна восьмая (умолчание); 0 — порога нет. Нужен стендам.
pub const DEAD_SHARE_ENV: &str = "ASTRAL_ENGINE_APPEND_DEAD_SHARE";

/// Сколько записей может быть на стопке журнала после новой (умолчание 256; 0 —
/// без предела). Нужен стендам.
pub const MAX_RECORDS_ENV: &str = "ASTRAL_ENGINE_APPEND_MAX_RECORDS";

/// Пороги дозаписи: боевые, кроме тех, что можно изменить окружением для стендов
/// (размер, пороги уплотнения).
pub(super) fn tuning() -> Tuning {
    tuning_from(&|name| env::var(name).ok())
}

/// То же по любому источнику значений (тесты не трогают окружение процесса).
fn tuning_from(get: &dyn Fn(&str) -> Option<String>) -> Tuning {
    let number = |name: &str| get(name).and_then(|text| text.trim().parse::<u64>().ok());
    let mut tuning = Tuning::default();
    if let Some(megabytes) = number(MIN_MB_ENV) {
        tuning.min_archive = megabytes.saturating_mul(1 << 20);
    }
    if let Some(megabytes) = number(DEAD_MB_ENV) {
        tuning.dead_limit = megabytes.saturating_mul(1 << 20);
    }
    if let Some(share) = number(DEAD_SHARE_ENV) {
        tuning.dead_share = share;
    }
    if let Some(records) = number(MAX_RECORDS_ENV) {
        tuning.max_records = usize::try_from(records).unwrap_or(usize::MAX);
    }
    tuning
}

// ---------------------------------------------------------------------------
// Признаки файла и точки обрыва
// ---------------------------------------------------------------------------

/// Хозяин писателя: признаки файла из системы, точки обрыва из `failpoint`.
pub(super) struct EngineHost;

impl Host for EngineHost {
    fn facts(&self, file: &fs::File) -> io::Result<Facts> {
        facts_of(file)
    }

    fn hit(&self, point: &str) {
        failpoint::hit(point);
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn facts_of(file: &fs::File) -> io::Result<Facts> {
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    #[derive(Default)]
    #[allow(dead_code)]
    struct Filetime {
        low: u32,
        high: u32,
    }

    /// BY_HANDLE_FILE_INFORMATION.
    #[repr(C)]
    #[derive(Default)]
    #[allow(dead_code)]
    struct ByHandleInformation {
        attributes: u32,
        created: Filetime,
        accessed: Filetime,
        written: Filetime,
        volume_serial: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }

    extern "system" {
        fn GetFileInformationByHandle(
            file: *mut core::ffi::c_void,
            info: *mut ByHandleInformation,
        ) -> i32;
    }

    let mut info = ByHandleInformation::default();
    // SAFETY: дескриптор принадлежит `file` и жив на время вызова, `info` —
    // структура нужной формы.
    let done = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    if done == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(Facts {
        links: Some(u64::from(info.links)),
        identity: Some((
            u64::from(info.volume_serial),
            u64::from(info.index_high) << 32 | u64::from(info.index_low),
        )),
    })
}

#[cfg(not(windows))]
fn facts_of(file: &fs::File) -> io::Result<Facts> {
    rage_rpf::append::PlainHost.facts(file)
}

// ---------------------------------------------------------------------------
// Отказы и сессия
// ---------------------------------------------------------------------------

/// Отказ дозаписи как отказ команды: код слово из `Code`, у отмены — `Cancelled`.
pub(crate) fn engine_error(error: AppendError) -> EngineError {
    match error {
        AppendError::Refused { code, message } => EngineError::new(code.name(), message),
        AppendError::Cancelled => EngineError::cancelled(),
        AppendError::Other(inner) => EngineError::from(inner),
    }
}

/// Открывает сессию; занятый файл ждётся так же, как при подмене: минуту,
/// доступ закрыт — десять секунд.
pub(super) fn open_session<'h>(
    host: &'h EngineHost,
    live: &Path,
    progress: &Progress,
    tuning: Tuning,
) -> Result<Session<'h>> {
    const STEP: Duration = Duration::from_millis(500);
    let mut waited = Duration::ZERO;
    loop {
        match Session::open(host, live, tuning) {
            Err(AppendError::Other(RpfError::Io(error))) => {
                let patience = match points::trouble(&error) {
                    Some(points::Trouble::Busy) => Duration::from_secs(60),
                    Some(points::Trouble::Denied) => Duration::from_secs(10),
                    None => return Err(EngineError::from(error)),
                };
                if waited >= patience {
                    return Err(EngineError::from(error));
                }
                progress.checkpoint()?;
                sleep(STEP);
                waited += STEP;
            }
            other => return other.map_err(engine_error),
        }
    }
}

/// Слово действия восстановления для ответов.
fn settled_word(settled: Settled) -> &'static str {
    match settled {
        Settled::Clean => "none",
        Settled::Completed(_) => "completed",
        Settled::RolledBack(_) => "rolledBack",
    }
}

pub(super) fn settled_value(settled: Settled) -> Value {
    match settled {
        Settled::Clean => Value::Null,
        Settled::Completed(seq) | Settled::RolledBack(seq) => {
            json!({ "action": settled_word(settled), "record": seq })
        }
    }
}

/// Доводит оборванную запись у архива, рядом с которым лежит журнал. Без
/// журнала не делает ничего. Полный путь (подмена файла) зовёт это до любой
/// копии «до»: иначе «до» снялось бы с архива в середине записи. Испорченный
/// журнал полным путём игнорируется: он уйдёт вместе с прежним файлом. Так же
/// `ForeignChange`: файл после обрыва подменили (обновление игры, проверка
/// файлов), и доводка в него не пишет; файл не трогается, полный путь идёт
/// дальше и после подмены убирает журнал.
pub(crate) fn settle_beside(live: &Path, progress: &Progress) -> Result<Settled> {
    if !journal_path(live).is_file() || !live.is_file() {
        return Ok(Settled::Clean);
    }
    let _lift = points::ReadonlyLift::take_off(live)?;
    let host = EngineHost;
    let _hook = activity::install(Arc::new(progress.clone()));
    let opened = open_session(&host, live, progress, tuning());
    let mut session = match opened {
        Ok(session) => session,
        Err(error) if error.code == rage_rpf::append::Code::JournalDamaged.name() => {
            return Ok(Settled::Clean)
        }
        // у файла есть второе имя (точка оборванной установки, снимок): в нём
        // оборванную запись не доводят. Если все записи журнала готовы (или его нет),
        // доводить нечего, а полный путь файл не правит, а заменяет: чисто. Если
        // есть незаконченная запись, она могла оставить в файле половину головы
        // (вложенного архива): полный путь унёс бы её в новую сборку телом, а подмена
        // убрала бы журнал, так что прежний отказ `Linked` остаётся. Испорченный
        // журнал — как `JournalDamaged` выше.
        Err(error) if error.code == rage_rpf::append::Code::Linked.name() => {
            return match journal::read(&journal_path(live)) {
                Ok(found) if found.as_ref().is_some_and(has_unfinished_record) => Err(error),
                Ok(_) => Ok(Settled::Clean),
                Err(AppendError::Refused {
                    code: rage_rpf::append::Code::JournalDamaged,
                    ..
                }) => Ok(Settled::Clean),
                // журнал не прочитался по другой причине: прежний отказ
                Err(_) => Err(error),
            };
        }
        Err(error) => return Err(error),
    };
    let notes = summary::recipe_notes(session.replay());
    match session.settle() {
        Err(AppendError::Refused {
            code: rage_rpf::append::Code::ForeignChange,
            ..
        }) => Ok(Settled::Clean),
        other => {
            let settled = other.map_err(engine_error)?;
            reconcile_recipes(&notes, session.replay());
            Ok(settled)
        }
    }
}

/// На стопке есть запись, которая не дошла до «готово» (или идёт откат).
fn has_unfinished_record(replay: &Replay) -> bool {
    replay
        .records
        .iter()
        .any(|record| record.phase != Phase::Done)
}

/// Рецепты, которые называли записи журнала до восстановления или отката,
/// приводятся к журналу после него: запись, которой в журнале больше нет, уходит и
/// из рецепта (рецепт не бывает впереди архива). Отказ записи рецепта не важен: он
/// сверится при следующем чтении.
pub(super) fn reconcile_recipes(notes: &[PathBuf], replay: &Replay) {
    for path in notes {
        summary::reconcile_file(path, replay);
    }
}

/// Архив и есть то, что оставил журнал, и рецепт описывает именно это состояние:
/// чинить нечего. Любая неясность (нет журнала, чужой файл, нет доступа) — `false`.
pub(crate) fn is_intact(live: &Path, state: &str, progress: &Progress) -> bool {
    if !journal_path(live).is_file() || !live.is_file() {
        return false;
    }
    let Ok(_lift) = points::ReadonlyLift::take_off(live) else {
        return false;
    };
    let host = EngineHost;
    let _hook = activity::install(Arc::new(progress.clone()));
    let Ok(mut session) = open_session(&host, live, progress, tuning()) else {
        return false;
    };
    session.fingerprint().ok().flatten().is_some_and(|now| {
        parse_digest(&now).is_some() && parse_digest(&now) == parse_digest(state)
    })
}

/// Откат записи журнала для `restore-rpf-point`: точка помнит номер записи и
/// отпечаток, с которого она началась. Записи в журнале нет — откат уже был,
/// если архив в том состоянии, которое помнит точка.
pub(crate) fn rollback_point(
    live: &Path,
    relative: &str,
    mark: &points::AppendMark,
    progress: &Progress,
) -> Result<()> {
    if !live.is_file() {
        return Err(EngineError::file_not_found(format!(
            "Target RPF does not exist: {relative}"
        )));
    }
    let _lift = points::ReadonlyLift::take_off(live)?;
    let host = EngineHost;
    let _hook = activity::install(Arc::new(progress.clone()));
    let mut session = open_session(&host, live, progress, tuning())?;
    let before = mark.fingerprint_before.as_deref().and_then(parse_digest);
    // цепочка, которой принадлежала запись точки, кончилась (полный путь убрал
    // журнал и начал новую): откатывать нечего, а записи новой цепочки с тем же
    // номером точке не принадлежат
    if let (Some(wanted), Some(base)) = (&mark.chain_base, &session.replay().base) {
        if !wanted.eq_ignore_ascii_case(&hex(&base.digest)) {
            return Err(point_compacted(relative));
        }
    }
    let notes = summary::recipe_notes(session.replay());
    let report = session
        .rollback(mark.record, before.as_ref())
        .map_err(engine_error)?;
    reconcile_recipes(&notes, session.replay());
    if !report.missing {
        return Ok(());
    }
    let state = session.fingerprint().map_err(engine_error)?;
    let confirmed = match (&mark.fingerprint_before, state.as_deref()) {
        (Some(wanted), Some(now)) => parse_digest(wanted) == parse_digest(now),
        // точка не дожила до отпечатка: дозапись не закончилась, откатывать нечего
        (None, _) => true,
        (Some(_), None) => false,
    };
    if confirmed {
        return Ok(());
    }
    if chain_is_gone(&session, mark) {
        return Err(point_compacted(relative));
    }
    Err(EngineError::invalid_operation(format!(
        "{relative}: the journal does not know the install record and the archive is not in \
         the state before it; nothing was rolled back."
    )))
}

/// Точка отката старше уплотнения: цепочка журнала, которой принадлежала её
/// запись, кончилась (полный путь убрал журнал и начал новую). Записи, снятые
/// откатом более старой точки той же цепочки, под это не подпадают.
fn chain_is_gone(session: &Session<'_>, mark: &points::AppendMark) -> bool {
    let replay = session.replay();
    match (&mark.chain_base, &replay.base) {
        (Some(wanted), Some(base)) => !wanted.eq_ignore_ascii_case(&hex(&base.digest)),
        (Some(_), None) | (None, None) => true,
        // точка без отпечатка цепочки (старая опись): новая цепочка начинает номера с нуля
        (None, Some(_)) => replay.next_seq <= mark.record,
    }
}

/// Откат точки, чья запись исчезла вместе с журналом при уплотнении, отказывает
/// этим кодом: вызывающий откатывает пересборкой.
pub const POINT_COMPACTED: &str = "PointCompacted";

fn point_compacted(relative: &str) -> EngineError {
    EngineError::new(
        POINT_COMPACTED,
        format!(
            "{relative}: the restore point was made before the archive was compacted: the \
             journal that held its record is gone, and the archive is not in the state before \
             it. Nothing was rolled back; rebuild the archive from the recipe."
        ),
    )
}

// ---------------------------------------------------------------------------
// Установка дозаписью
// ---------------------------------------------------------------------------

/// Ключи блока `install`, с которыми дозапись не живёт: отказ до любой записи.
fn refuse_unsuitable(install: &compose::Install) -> Result<()> {
    let options = &install.options;
    let refusals = [
        (
            install.targets.len() > 1,
            "Append writes one archive per install.",
        ),
        (
            install.prebuilt.is_some()
                || install
                    .targets
                    .iter()
                    .any(|target| target.prebuilt.is_some()),
            "A prebuilt archive is not appended.",
        ),
        (
            install.create || install.targets.iter().any(|target| target.create),
            "A missing archive cannot be appended to.",
        ),
        // `saveRecipe` у дозаписи — путь сводного рецепта (его обновляет каждая
        // запись); сборка по рецепту дозаписи не нужна, её делает `repair-rpf`
        (
            options.use_recipe.is_some(),
            "A build recipe does not go with append; use repair-rpf.",
        ),
        (
            options.expect_sha256.is_some(),
            "expectSha256 does not go with append; use baseSha256.",
        ),
        (
            options.before_aside,
            "before aside does not go with append.",
        ),
        // удержанная дозапись при уборке снесла бы точку, не убрав названные файлы
        (
            options.hold && !options.creates.is_empty(),
            "Install creates does not go with hold.",
        ),
    ];
    match refusals.into_iter().find(|(broken, _)| *broken) {
        Some((_, text)) => Err(EngineError::argument(text)),
        None => Ok(()),
    }
}

/// Запрос с общими записями слоя, разложенными по операциям, и их названия для
/// сессии (путь и SHA-256 содержимого). Нет общих записей — `None`: запрос идёт как
/// был. Отказ до любой записи: запись названа и операцией тоже (тело ждёт одно),
/// файла нет, он велик.
fn registry_request(request: &Request) -> Result<Option<(Request, Vec<RegistryPlace>)>> {
    let Some(spec) = request
        .install
        .as_ref()
        .and_then(|block| block.options.layer.as_ref())
        .filter(|spec| !spec.registry.is_empty())
    else {
        return Ok(None);
    };
    let taken: Vec<String> = request
        .operations
        .iter()
        .filter_map(|op| compose::normalize_entry(&op.entry, true).ok())
        .map(|parts| parts.join("/"))
        .collect();
    let mut next = request.clone();
    let mut places = Vec::with_capacity(spec.registry.len());
    for shared in &spec.registry {
        let nested =
            |other: &str, inner: &str| other == inner || other.starts_with(&format!("{inner}/"));
        if taken
            .iter()
            .any(|entry| nested(entry, &shared.entry) || nested(&shared.entry, entry))
        {
            return Err(EngineError::argument(
                "Install layer registry entry is also an operation.",
            ));
        }
        let length = fs::metadata(&shared.source)
            .map_err(|_| EngineError::file_not_found("Install layer registry source not found."))?
            .len();
        if !shared.source.is_file() || length > super::layers::REGISTRY_MAX {
            return Err(EngineError::argument(
                "Install layer registry source is invalid.",
            ));
        }
        let content = fs::read(&shared.source)?;
        next.operations.push(Operation {
            entry: shared.entry.clone(),
            source: Some(shared.source.clone()),
            sha256: Some(super::sha256_hex(&content)),
            action: compose::Action::Replace,
            allow_delete: false,
            allow_missing: false,
        });
        places.push(RegistryPlace {
            entry: shared.entry.clone(),
            sha: sha256(&content),
        });
    }
    Ok(Some((next, places)))
}

/// Одно путь — один файл: сравнение без учёта регистра и вида косых.
fn same_path(left: &Path, right: &Path) -> bool {
    let fold = |path: &Path| path.to_string_lossy().replace('\\', "/").to_lowercase();
    fold(left) == fold(right)
}

/// Что установка положила в папку точки сама (для уборки при отказе).
struct Claims {
    root: PathBuf,
    /// Папку точки создала эта установка: при отказе она уходит целиком.
    owned: bool,
    replay: bool,
    /// Замок удержания (`hold`): держится, пока идёт запись тел, закрывается раньше уборки точки.
    lock: std::cell::RefCell<Option<super::composed_install::HoldLock>>,
}

impl Claims {
    fn replay_path(&self) -> PathBuf {
        self.root.join("replay.json")
    }

    fn clean_up(&self) {
        // открытый замок мешает убрать папку: закрывается первым
        drop(self.lock.borrow_mut().take());
        if self.owned {
            let _ = fs::remove_dir_all(&self.root);
            return;
        }
        if self.replay {
            let _ = fs::remove_file(self.replay_path());
        }
        let _ = fs::remove_file(self.root.join("restore.json"));
        // запись удержания (установка в два шага), если она успела лечь
        let _ = fs::remove_file(self.root.join("hold.json"));
    }
}

fn ms(span: Duration) -> u64 {
    u64::try_from(span.as_millis()).unwrap_or(u64::MAX)
}

/// Сводный рецепт, который обновляет эта дозапись (ключ `saveRecipe`).
pub(super) struct RecipeTrack {
    pub(super) path: PathBuf,
    archive: String,
    /// Рецепт, каким он был до записи, сведённый с журналом.
    existing: Option<Summary>,
}

impl RecipeTrack {
    /// Читает рецепт и сводит его с журналом (рецепт не бывает впереди). Рецепт
    /// другого архива и файл, который не рецепт, отказывают, а не затираются.
    /// Если журнал уже хранит записи, рецепт обязан знать каждую из них: иначе
    /// починить по нему нельзя, и дозапись отказывает (`RecipeIncomplete`) — цепочку
    /// начнёт полный путь.
    pub(super) fn open(path: &Path, archive: &str, replay: &Replay) -> Result<RecipeTrack> {
        let existing = match Summary::load(path) {
            Ok(mut found) => {
                if !same_path(Path::new(&found.archive), Path::new(archive)) {
                    return Err(EngineError::argument(
                        "Summary recipe is for another archive.",
                    ));
                }
                let (standing, changed) = found.reconcile(replay);
                if changed {
                    found.save(path)?;
                }
                Some((found, standing))
            }
            Err(error) if error.code == RECIPE_MISSING => None,
            Err(error) => return Err(error),
        };
        if !replay.records.is_empty() {
            let covered = matches!(
                &existing,
                Some((found, Standing::Same)) if found.covers(replay)
            );
            if !covered {
                return Err(EngineError::new(
                    RECIPE_INCOMPLETE,
                    "The summary recipe does not know every record the journal holds, so the \
                     archive could not be repaired from it; the full path starts a new chain.",
                ));
            }
        }
        Ok(RecipeTrack {
            path: path.to_path_buf(),
            archive: archive.to_owned(),
            existing: existing.map(|(found, _)| found),
        })
    }

    /// Рецепт с новой партией: записью, которую писатель вот-вот сделает. Цепочка
    /// другая (журнал начат заново) — рецепт начинается с её файла-основы.
    fn extended(
        &self,
        ahead: &Ahead,
        operations: &[Operation],
        allow_deletes: bool,
        layer: Option<&str>,
    ) -> Summary {
        let chain = hex(&ahead.chain_base);
        let mut summary = match &self.existing {
            Some(found) if found.chain_base == chain => found.clone(),
            _ => Summary::start(&self.archive, &chain, ahead.chain_base_len),
        };
        summary.allow_deletes |= allow_deletes;
        summary.batches.push(summary::Batch {
            layer: layer.map(str::to_owned),
            ..summary::Batch::plain(
                Some(ahead.seq),
                Some(ahead.fingerprint_before.clone()),
                Some(ahead.fingerprint_after.clone()),
                operations.to_vec(),
            )
        });
        summary
    }

    /// Рецепт с партией переключения слоёв: отпечаток идёт за архивом. Операций нет,
    /// кроме замен общих записей, если переключение их ставило: они нужны, чтобы
    /// «Починить» собрало общие записи под тот набор слоёв, что остался.
    pub(super) fn toggled(&self, ahead: &Ahead, shared: &[Operation]) -> Summary {
        let mut summary = self.extended(ahead, shared, false, None);
        if let Some(last) = summary.batches.last_mut() {
            last.toggle = true;
        }
        summary
    }

    /// После отказа: запись, которой в журнале больше нет, уходит из рецепта, а
    /// источники, закреплённые зря, из папки.
    pub(super) fn forget_leftovers(&self, replay: &Replay) {
        summary::reconcile_file(&self.path, replay);
        match Summary::load(&self.path) {
            Ok(found) => found.collect_garbage(&self.path),
            Err(error) if error.code == RECIPE_MISSING => {
                drop(fs::remove_dir_all(summary::sources_folder(&self.path)));
            }
            Err(_) => {}
        }
    }
}

/// Ядро: операции запроса дописываются в живой архив, точка отката — запись
/// журнала.
pub(crate) fn append_core(
    request: &Request,
    keys: &Arc<KeySet>,
    progress: &Progress,
    points_root: &Path,
    tuning: Tuning,
) -> Result<Value> {
    let install = request
        .install
        .as_ref()
        .ok_or_else(|| EngineError::argument("Append needs an install block."))?;
    refuse_unsuitable(install)?;
    // общие записи слоя (`install.layer.registry`) идут обычными операциями замены:
    // так их читает, сверяет и закрепляет в рецепте всё прежнее; слою они не отдаются
    let with_registry = registry_request(request)?;
    let (request, shared) = match &with_registry {
        Some((next, places)) => (next, places.clone()),
        None => (request, Vec::new()),
    };
    let install = request
        .install
        .as_ref()
        .ok_or_else(|| EngineError::argument("Append needs an install block."))?;
    // удержание дозаписи растит живой архив на первом шаге: без ключа длины (`keepKey`,
    // длина файла держит ключ головы) и без стенда отказ до любой записи
    if install.options.hold && !install.options.keep_key && !hold_grow_allowed() {
        return Err(EngineError::new(
            HOLD_UNSUPPORTED,
            "A held append grows the live archive at the first step and is not supported.",
        ));
    }
    let archive = install.archive.as_str();
    let game_text = install.game_root.to_string_lossy().into_owned();
    let live = paths::inside(&game_text, archive)?;
    if !live.is_file() {
        return Err(EngineError::file_not_found(format!(
            "Target RPF does not exist: {archive}"
        )));
    }
    check_created(install, &game_text)?;
    if request
        .base
        .as_deref()
        .is_some_and(|base| !same_path(base, &live))
    {
        return Err(EngineError::argument(
            "Append base archive must be the live archive.",
        ));
    }
    let id = match install.point_id.as_deref() {
        None => points::new_point_id(),
        Some(given) if points::valid_point_id(given) => given.to_owned(),
        Some(_) => return Err(EngineError::argument("Install point id is invalid.")),
    };
    let base_sha = match install.options.base_sha256.as_deref() {
        Some(text) => Some(
            parse_digest(text)
                .ok_or_else(|| EngineError::argument("Install base sha256 is invalid."))?,
        ),
        None => None,
    };

    // ожидания запроса: строка с архивом, которого здесь нет, — ошибка запроса
    let wanted = expect::Wanted::of(&install.options.expect, archive, true);
    for row in &install.options.expect {
        let other = row.archive.as_deref().is_some_and(|named| {
            named.replace('\\', "/").to_lowercase() != archive.replace('\\', "/").to_lowercase()
        });
        if other {
            return Err(EngineError::argument(
                "Install expect names an archive that is not installed.",
            ));
        }
    }
    // брошенное удержание этого архива (стейдж или удержанная дозапись) уходит
    // раньше, чем архив открывается на запись
    super::composed_install::sweep_for_append(&live, &install.game_root, points_root)?;

    let _hook = activity::install(Arc::new(progress.clone()));
    let begun = Instant::now();
    progress.report("prepare");
    let _lift = points::ReadonlyLift::take_off(&live)?;
    let host = EngineHost;
    let mut session = open_session(&host, &live, progress, tuning)?;
    // слой: запись журнала помечается им, порог головы считается по всем слоям
    session.set_layer(install.options.layer.as_ref().map(|spec| LayerPlace {
        id: spec.id.clone(),
        requires: spec.requires.clone(),
    }));
    session.set_layer_registry(shared);
    // длина файла держит ключ головы: добавка нулей в конец (R4)
    session.set_keep_key(install.options.keep_key.then_some(KEEP_KEY_PAD_MAX));
    // хвост после последней записи (`tailPad`): запас от начала последней записи до конца файла, длина кратна границе
    session.set_tail(install.options.tail_pad.then_some(rage_rpf::tail::TailPolicy::STANDARD));
    // архив «как будет» проверяется до записи голов: нет названного — запись
    // снимается, файл прежний (тела в хвосте до смены головы игре не видны)
    let preview_note: Arc<Mutex<Option<(expect::Checked, u64)>>> = Arc::new(Mutex::new(None));
    if !wanted.is_empty() {
        let note = Arc::clone(&preview_note);
        session.set_preview_check(Some(Box::new(move |opened: &Archive| {
            let checking = Instant::now();
            match expect::check_archive(opened, &wanted) {
                Ok(done) => {
                    let mut slot = note.lock().unwrap_or_else(PoisonError::into_inner);
                    *slot = Some((done, ms(checking.elapsed())));
                    Ok(())
                }
                Err(error) => Err(AppendError::refused(
                    rage_rpf::append::Code::ExpectationFailed,
                    error.message,
                )),
            }
        })));
    }
    let notes = summary::recipe_notes(session.replay());
    let settled = session.settle().map_err(engine_error)?;
    reconcile_recipes(&notes, session.replay());
    // чужая правка видна раньше, чем архив прочитан: тот, что изменили, мог
    // стать нечитаемым, и отказ должен называть причину
    session.fingerprint().map_err(engine_error)?;
    // сводный рецепт: читается и сводится с журналом до первой записи
    let track = match install.options.save_recipe.as_deref() {
        Some(path) => Some(RecipeTrack::open(path, archive, session.replay())?),
        None => None,
    };
    progress.report("read");
    let base = Arc::new(Archive::open_path(&live, Some(Arc::clone(keys)))?);
    progress.report("compose");
    let (tree, applied) = apply_for_append(request, &base, keys, progress)?;
    // отказаться можно, пока точка не создана
    progress.checkpoint()?;
    // источники закрепляются рядом с рецептом (ссылка, на другом томе — копия):
    // сами они живут, пока жив мод
    let pinned = match &track {
        Some(held) => {
            summary::pin_operations(&request.operations, &summary::sources_folder(&held.path))
                .inspect_err(|_| held.forget_leftovers(session.replay()))?
        }
        None => Vec::new(),
    };
    if let Some(held) = &track {
        // отмена во время копии на другой том: закреплённое убирается
        progress
            .checkpoint()
            .inspect_err(|_| held.forget_leftovers(session.replay()))?;
        session.set_note(held.path.to_string_lossy().as_bytes());
    }

    // точка: папка, запись переустановки, опись с номером записи журнала
    let root = points_root.join(&id);
    let mut claims = Claims {
        owned: !root.exists(),
        root,
        replay: false,
        lock: std::cell::RefCell::new(None),
    };
    fs::create_dir_all(&claims.root)?;
    let wrote = serde_json::to_vec_pretty(&install.replay)
        .map_err(|_| EngineError::invalid_data("Install replay record is not serializable."))
        .and_then(|bytes| fs::write(claims.replay_path(), bytes).map_err(EngineError::from));
    if let Err(error) = wrote {
        claims.clean_up();
        return Err(error);
    }
    claims.replay = true;
    let record = session.replay().next_seq;
    let mut item = points::AppendItem {
        live_path: live.clone(),
        relative_path: archive.to_owned(),
        record,
        fingerprint_before: String::new(),
        fingerprint_after: String::new(),
        chain_base: String::new(),
    };
    let manifest = |item: &points::AppendItem| {
        points::write_append_manifest_with(
            &claims.root,
            &id,
            &install.game_root,
            &claims.replay_path(),
            item,
            &install.options.creates,
            &install.options.creates_dirs,
        )
    };
    if let Err(error) = manifest(&item) {
        claims.clean_up();
        return Err(error);
    }
    // удержание: запись «собирается» раньше тел, чтобы оборванный первый шаг
    // оставил по себе то, что можно найти и убрать
    if install.options.hold {
        let started =
            super::composed_install::start_append_hold(&super::composed_install::AppendStart {
                id: &id,
                game_root: &install.game_root,
                root: &claims.root,
                owned: claims.owned,
                replay_written: claims.replay,
                archive,
                live: &live,
                seq: record,
            });
        match started {
            Ok(lock) => *claims.lock.borrow_mut() = Some(lock),
            Err(error) => {
                claims.clean_up();
                return Err(error);
            }
        }
    }
    failpoint::hit("append-after-manifest");
    let prepare_ms = ms(begun.elapsed());

    // запись
    let total = applied.planned_bytes();
    let mut last = 0u64;
    let mut meter = |written: u64| {
        progress.wrote(disk::delta(&mut last, written));
        progress.report_bytes("compose", written.min(total), total);
    };
    let mut verify = |opened: &Archive| applied.verify(opened).map_err(|error| error.message);
    // перед головами (тела и журнал уже на диске): сводный рецепт с этой записью
    let layer_id = install.options.layer.as_ref().map(|spec| spec.id.as_str());
    let mut before_head = |ahead: &Ahead| -> std::result::Result<(), AppendError> {
        let Some(held) = &track else { return Ok(()) };
        let next = held.extended(ahead, &pinned, request.allow_deletes, layer_id);
        next.save(&held.path)
            .map_err(|error| AppendError::Other(RpfError::Io(io::Error::other(error.message))))
    };
    let input = AppendInput {
        keys,
        base: &base,
        tree: &tree,
        base_sha256: base_sha,
    };
    // удержание: первый шаг из двух, головы остаются прежними
    let outcome = if install.options.hold {
        session
            .append_held(input, &mut meter, &mut verify, &mut before_head)
            .map(|(report, held)| (report, Some(held)))
    } else {
        session
            .append_with(input, &mut meter, &mut verify, &mut before_head)
            .map(|report| (report, None))
    };
    drop(tree);
    drop(base);
    let (report, held_head) = match outcome {
        Ok(pair) => pair,
        Err(error) => {
            if let Some(held) = &track {
                // запись снята — рецепт тоже
                held.forget_leftovers(session.replay());
            }
            claims.clean_up();
            return Err(engine_error(error));
        }
    };
    item.fingerprint_before = report.fingerprint_before.clone();
    item.fingerprint_after = report.fingerprint.clone();
    item.chain_base = hex(&report.chain_base);
    if let Err(error) = manifest(&item) {
        // запись журнала готова, а опись нет: точка без отпечатков откатится по номеру
        let _ = error;
    }
    let recipe = track
        .as_ref()
        .map(|held| (held.path.clone(), report.fingerprint.clone()));
    let mut done = answer(
        &report,
        &claims,
        &id,
        archive,
        &applied,
        settled,
        prepare_ms,
        recipe.as_ref(),
    );
    // ключ есть только у запроса с `keepKey`: прочие ответы прежние
    if let Some(pad) = report.key_pad {
        done["keyPadBytes"] = json!(pad);
    }
    // ключ есть только у запроса с `creates`: прочие ответы прежние
    if !install.options.creates.is_empty() {
        done["createdFiles"] = json!(install
            .options
            .creates
            .iter()
            .map(|file| json!({ "path": file.path, "bytes": file.bytes }))
            .collect::<Vec<_>>());
    }
    let checked = preview_note
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    if let Some((counted, millis)) = checked {
        done["expected"] = json!({
            "entries": counted.entries,
            "dlcPacks": counted.dlc_packs,
            "ms": millis,
        });
    }
    let Some(head) = held_head else {
        return Ok(done);
    };

    // первый шаг из двух: будущие головы ложатся файлом рядом с архивом, запись
    // удержания — в папку точки. Отказ записи снимает удержанную запись журнала.
    let replay_path = claims.replay_path();
    let recipe_path = track.as_ref().map(|held| held.path.clone());
    let sealed = super::composed_install::write_append_hold(&super::composed_install::AppendHold {
        id: &id,
        game_root: &install.game_root,
        root: &claims.root,
        owned: claims.owned,
        replay_written: replay_path.is_file(),
        archive,
        live: &live,
        seq: report.seq,
        fingerprint_before: &report.fingerprint_before,
        fingerprint_after: &report.fingerprint,
        chain_base: &hex(&report.chain_base),
        recipe: recipe_path.as_deref(),
        held: &head,
        answer: &done,
    });
    let (preview, preview_sha) = match sealed {
        Ok(pair) => pair,
        Err(error) => {
            let _ = session.settle();
            let _ = fs::remove_file(held_path(&live));
            if let Some(held) = &track {
                held.forget_leftovers(session.replay());
            }
            claims.clean_up();
            return Err(error);
        }
    };
    done["status"] = json!("held");
    done["pointId"] = json!(id);
    done["headPreview"] = json!({
        "path": preview.to_string_lossy(),
        "sha256": preview_sha.to_ascii_lowercase(),
        "newLength": head.new_len,
        "patches": head
            .patches
            .iter()
            .map(|(at, bytes)| json!({ "offset": at, "length": bytes.len() }))
            .collect::<Vec<_>>(),
    });
    Ok(done)
}

#[allow(clippy::too_many_arguments)]
fn answer(
    report: &AppendReport,
    claims: &Claims,
    id: &str,
    archive: &str,
    applied: &compose::AppliedOps,
    settled: Settled,
    prepare_ms: u64,
    recipe: Option<&(PathBuf, String)>,
) -> Value {
    let timings = &report.timings;
    let mut out = Map::new();
    let rows = [
        ("status", json!("ready")),
        ("mode", json!("append-install")),
        ("write", json!("append")),
        ("id", json!(id)),
        ("restoreRoot", json!(claims.root.to_string_lossy())),
        ("archive", json!(archive)),
        ("created", json!(false)),
        (
            "archives",
            json!([{
                "archive": archive,
                "created": false,
                "sha256": null,
                "fingerprint": report.fingerprint,
            }]),
        ),
        ("record", json!(report.seq)),
        ("sha256", Value::Null),
        ("fingerprint", json!(report.fingerprint)),
        ("fingerprintBefore", json!(report.fingerprint_before)),
        ("bytes", json!(report.new_len)),
        ("bytesWritten", json!(report.bytes_written)),
        ("bytesMoved", json!(report.bytes_moved)),
        ("deadBytes", json!(report.dead_bytes)),
        // запас вложенных не мусор: его нет в счёте порога уплотнения
        ("reserveBytes", json!(report.reserve_bytes)),
        ("garbageBytes", json!(report.garbage_bytes)),
        (
            "untilCompaction",
            json!({
                "deadBytes": report.remaining.dead_bytes,
                "deadShareBytes": report.remaining.dead_share,
                "bodyStartBytes": report.remaining.body_start,
                "records": report.remaining.records,
            }),
        ),
        ("movedBodies", json!(report.moved_bodies)),
        ("newBodies", json!(report.new_bodies)),
        ("nestedMoved", json!(report.nested_moved)),
        ("nestedInReserve", json!(report.nested_in_reserve)),
        ("nestedCreated", json!(report.nested_created)),
        ("journalRecords", json!(report.journal_records)),
        ("recovered", settled_value(settled)),
        ("operations", json!(applied.count())),
        ("entries", json!(applied.shown())),
        (
            "timings",
            json!({
                "plan": timings.plan + prepare_ms,
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
    // ключи слоёв есть только у запроса со слоем и у архива, где слои стоят
    if report.layer.is_some() || report.dormant_bytes > 0 {
        out.insert("dormantBytes".to_owned(), json!(report.dormant_bytes));
    }
    if let Some(layer) = &report.layer {
        let mut shown = json!({
            "id": layer.id,
            "state": "enabled",
            "linked": layer.linked,
            "requires": layer.requires,
            "added": layer.added,
            "replaced": layer.replaced,
            "dormantBytes": layer.dormant_bytes,
        });
        // общие записи слоя (`install.layer.registry`): что записано в тело каждой
        if !layer.registry.is_empty() {
            shown["registry"] = Value::Array(
                layer
                    .registry
                    .iter()
                    .map(|(entry, bytes)| json!({ "entry": entry, "bytesWritten": bytes }))
                    .collect(),
            );
        }
        out.insert("layer".to_owned(), shown);
    }
    // ключ есть только у запросов с `saveRecipe`: прочие ответы прежние
    if let Some((path, state)) = recipe {
        out.insert(
            "recipe".to_owned(),
            json!({ "path": path.to_string_lossy(), "state": state }),
        );
    }
    Value::Object(out)
}

/// Ключи команды: набор из каталога `--keys` или окружения (в тестах — подставной).
pub(super) fn command_keys(options: &Options, hint: &str) -> Result<Arc<KeySet>> {
    #[cfg(test)]
    if let Some(keys) = tests::injected_keys() {
        return Ok(keys);
    }
    Ok(load_keys(hint, options.optional("keys"))?.0)
}

/// Ключи и папка точек для команды; игра для разговора о ключах — из запроса.
fn append_with_options(options: &Options, request: &Request, progress: &Progress) -> Result<Value> {
    let from_request = request
        .install
        .as_ref()
        .map(|block| block.game_root.to_string_lossy().into_owned())
        .unwrap_or_default();
    let hint = options.optional("game-root").unwrap_or(&from_request);
    let keys = command_keys(options, hint)?;
    let points_root = points::restore_points_root_for(options)?;
    append_core(request, &keys, progress, &points_root, tuning())
}

/// Запрос читается из файла `--request` так же, как у `compose-rpf`.
fn read_request(options: &Options, progress: &Progress) -> Result<Request> {
    let text = fs::read_to_string(options.required("request")?)?;
    let request = parse_request(&text)?;
    if let Some(flag) = cancel_file_of(&text)? {
        progress.cancel().watch_file(flag);
    }
    Ok(request)
}

/// Вход `compose-rpf` с `install.write: "append"`: только под выключателем.
pub(super) fn compose_append(
    options: &Options,
    request: &Request,
    progress: &Progress,
) -> Result<Value> {
    let module = request
        .install
        .as_ref()
        .map_or("", |block| module_of(&block.replay));
    if !enabled_for(module, env::var(APPEND_ENV).ok().as_deref()) {
        return Err(EngineError::argument(
            "Install write mode append is not enabled.",
        ));
    }
    gate_layers(request, env::var(LAYERS_ENV).ok().as_deref())?;
    gate_creates(request, env::var(super::newdlc::NEWDLC_ENV).ok().as_deref())?;
    append_with_options(options, request, progress)
}

/// Выключатель слоёв (этап 3, часть E3-2): слова модулей через запятую, как у
/// `ASTRAL_ENGINE_APPEND`; по умолчанию выключен. Без него ключ `install.layer` и
/// команда `switch-rpf-layers` отказывают `ArgumentException`.
pub const LAYERS_ENV: &str = "ASTRAL_ENGINE_LAYERS";

/// Слои включены для модуля из записи переигрывания.
pub(crate) fn layers_enabled_for(replay: &Value, list: Option<&str>) -> bool {
    enabled_for(module_of(replay), list)
}

/// Ключ `install.layer` без выключателя — отказ разбора до любой записи.
fn gate_layers(request: &Request, list: Option<&str>) -> Result<()> {
    let wants = request
        .install
        .as_ref()
        .is_some_and(|block| block.options.layer.is_some());
    let allowed = request
        .install
        .as_ref()
        .is_some_and(|block| layers_enabled_for(&block.replay, list));
    if wants && !allowed {
        return Err(EngineError::argument("Install layer is not enabled."));
    }
    Ok(())
}

/// Ключ `install.creates` без выключателя новых dlc-архивов (`ASTRAL_ENGINE_NEWDLC`)
/// — отказ разбора до любой записи.
pub(crate) fn gate_creates(request: &Request, list: Option<&str>) -> Result<()> {
    let wants = request
        .install
        .as_ref()
        .is_some_and(|block| !block.options.creates.is_empty());
    let allowed = request
        .install
        .as_ref()
        .is_some_and(|block| enabled_for(module_of(&block.replay), list));
    if wants && !allowed {
        return Err(EngineError::argument("Install creates is not enabled."));
    }
    Ok(())
}

/// Файлы, названные ключом `creates`, лежат в игре и той длины, что названа: иначе
/// отказ до любой записи (хэш здесь не читается, его доказывает откат).
fn check_created(install: &compose::Install, game_text: &str) -> Result<()> {
    // сам архив, в который дописывают, созданным назвать нельзя: откат убрал бы архив игры
    let target = install
        .archive
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_lowercase();
    if install
        .options
        .creates
        .iter()
        .any(|file| file.path.to_lowercase() == target)
    {
        return Err(EngineError::argument(
            "Install creates names the archive that is installed to.",
        ));
    }
    for file in &install.options.creates {
        let full = paths::inside(game_text, &file.path)?;
        match fs::metadata(&full) {
            Ok(facts) if facts.is_file() && facts.len() == file.bytes => {}
            Ok(_) => {
                return Err(EngineError::new(
                    rage_rpf::append::Code::NotOurs.name(),
                    format!(
                        "{} is not the archive that was built (its length differs); nothing was written.",
                        file.path
                    ),
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(EngineError::file_not_found(format!(
                    "Created file does not exist: {}",
                    file.path
                )));
            }
            Err(error) => return Err(EngineError::from(error)),
        }
    }
    Ok(())
}

/// Команда `append-rpf`: операции запроса дописываются в живой архив. Запрос
/// как у `compose-rpf` с блоком `install`; ключ `write` не нужен.
pub fn append_rpf(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let request = read_request(options, progress)?;
    gate_layers(&request, env::var(LAYERS_ENV).ok().as_deref())?;
    gate_creates(
        &request,
        env::var(super::newdlc::NEWDLC_ENV).ok().as_deref(),
    )?;
    append_with_options(options, &request, progress)
}

// ---------------------------------------------------------------------------
// Откат и восстановление
// ---------------------------------------------------------------------------

/// Тело запроса `rollback-rpf-append`, `recover-rpf-append` и `repair-rpf`.
pub(super) fn json_request(options: &Options, progress: &Progress) -> Result<Map<String, Value>> {
    let text = fs::read_to_string(options.required("request")?)?;
    let parsed: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| EngineError::invalid_data("RPF request is not JSON."))?;
    let Value::Object(map) = parsed else {
        return Err(EngineError::invalid_data("RPF request is not an object."));
    };
    if let Some(Value::String(flag)) = map.get("cancelFile").filter(|value| value.is_string()) {
        if !flag.is_empty() {
            progress.cancel().watch_file(PathBuf::from(flag));
        }
    }
    Ok(map)
}

pub(super) fn game_root_of(map: &Map<String, Value>) -> Result<PathBuf> {
    match map
        .get("gameRoot")
        .and_then(Value::as_str)
        .map(PathBuf::from)
    {
        Some(root) if root.is_absolute() => Ok(root),
        _ => Err(EngineError::argument("Install game root must be absolute.")),
    }
}

pub(super) fn archive_in(game_root: &Path, relative: &str) -> Result<PathBuf> {
    paths::inside(&game_root.to_string_lossy(), relative)
}

/// Команда `rollback-rpf-append`: записи журнала снимаются с вершины до
/// названной включительно, архив возвращается байт в байт. Повтор после обрыва
/// безопасен.
///
/// Запрос: `{gameRoot, archive, record, expectBefore?, cancelFile?}`.
pub fn rollback_rpf_append(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let map = json_request(options, progress)?;
    let game_root = game_root_of(&map)?;
    let Some(relative) = map.get("archive").and_then(Value::as_str) else {
        return Err(EngineError::argument("Archive path is required."));
    };
    let Some(record) = map.get("record").and_then(Value::as_u64) else {
        return Err(EngineError::argument("Rollback record is required."));
    };
    let expect = match map.get("expectBefore") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(
            parse_digest(text)
                .ok_or_else(|| EngineError::argument("Rollback expectBefore is invalid."))?,
        ),
        Some(_) => return Err(EngineError::argument("Rollback expectBefore is invalid.")),
    };
    let live = archive_in(&game_root, relative)?;
    if !live.is_file() {
        return Err(EngineError::file_not_found(format!(
            "Target RPF does not exist: {relative}"
        )));
    }
    let _hook = activity::install(Arc::new(progress.clone()));
    progress.report("rollback");
    let _lift = points::ReadonlyLift::take_off(&live)?;
    let host = EngineHost;
    let mut session = open_session(&host, &live, progress, tuning())?;
    let notes = summary::recipe_notes(session.replay());
    let report = session
        .rollback(record, expect.as_ref())
        .map_err(engine_error)?;
    reconcile_recipes(&notes, session.replay());
    let timings = &report.timings;
    Ok(json!({
        "status": "ready",
        "archive": relative,
        "rolledBack": report.rolled_back,
        "missing": report.missing,
        "recovered": settled_value(report.settled),
        "journalRecords": report.journal_records,
        "fingerprint": report.fingerprint,
        "timings": {
            "plan": timings.plan,
            "write": timings.write,
            "sync": timings.sync,
            "head": timings.head,
            "journal": timings.journal,
        },
    }))
}

/// Команда `recover-rpf-append`: оборванная дозапись доводится (новая голова
/// целиком на диске — запись готова, иначе архив возвращается к прежнему).
/// Без журнала ничего не делает. Зовут при запуске Astral, перед каждой
/// установкой и перед запуском игры из Astral.
///
/// Запрос: `{gameRoot, archive | archives: [..], cancelFile?}`.
pub fn recover_rpf_append(options: &Options, progress: &Progress) -> Result<Value> {
    let pacer = WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    let map = json_request(options, progress)?;
    let game_root = game_root_of(&map)?;
    let listed: Vec<&str> = match (map.get("archives"), map.get("archive")) {
        (Some(Value::Array(items)), _) => items.iter().filter_map(Value::as_str).collect(),
        (_, Some(Value::String(one))) => vec![one.as_str()],
        _ => return Err(EngineError::argument("Archive path is required.")),
    };
    if listed.is_empty() {
        return Err(EngineError::argument("Archive path is required."));
    }
    let _hook = activity::install(Arc::new(progress.clone()));
    progress.report("recover");
    let mut rows = Vec::with_capacity(listed.len());
    let mut any = false;
    for relative in listed {
        let live = archive_in(&game_root, relative)?;
        let journal = journal_path(&live);
        if !journal.is_file() {
            rows.push(json!({ "archive": relative, "journal": false, "action": "none" }));
            continue;
        }
        if !live.is_file() {
            rows.push(json!({
                "archive": relative,
                "journal": true,
                "archiveMissing": true,
                "action": "none",
            }));
            continue;
        }
        let _lift = points::ReadonlyLift::take_off(&live)?;
        let host = EngineHost;
        let mut session = open_session(&host, &live, progress, tuning())?;
        let notes = summary::recipe_notes(session.replay());
        let settled = session.settle().map_err(engine_error)?;
        reconcile_recipes(&notes, session.replay());
        any |= settled != Settled::Clean;
        let mut row = json!({
            "archive": relative,
            "journal": true,
            "action": settled_word(settled),
            "records": session.replay().records.len(),
        });
        if let Settled::Completed(seq) | Settled::RolledBack(seq) = settled {
            row["record"] = json!(seq);
        }
        rows.push(row);
    }
    Ok(json!({ "status": "ready", "recovered": any, "archives": rows }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::archives::restore::restore_in;
    use crate::archives::sha256_file;
    use rage_rpf::fixtures::update_tree;
    use rage_rpf::journal;
    use rage_rpf::seal::seal_file;
    use rage_rpf::test_keys::nonlinear_set;
    use rage_rpf::{write_archive, DirNode, EntryCipher, WriteContext};
    use std::cell::RefCell;
    use std::collections::BTreeMap;
    use std::process::{Command, Stdio};
    use std::sync::OnceLock;
    use tempfile::TempDir;

    const SEED: u64 = 0x5ea1;
    const ID: &str = "rpf-20261104-120000-aaaaaaaaaaaaaaaaaa";
    const ID2: &str = "rpf-20261104-120001-bbbbbbbbbbbbbbbbbb";
    const ID3: &str = "rpf-20261104-120002-cccccccccccccccccc";
    const ID4: &str = "rpf-20261104-120003-dddddddddddddddddd";
    const UPDATE: &str = "update/update.rpf";
    const CHILD_ENV: &str = "ASTRAL_APPEND_CHILD_DIR";

    fn keys() -> Arc<KeySet> {
        static KEYS: OnceLock<Arc<KeySet>> = OnceLock::new();
        Arc::clone(KEYS.get_or_init(|| Arc::new(nonlinear_set(SEED))))
    }

    thread_local! {
        static INJECTED: RefCell<Option<Arc<KeySet>>> = const { RefCell::new(None) };
    }

    /// Ключи, которые команды этого потока берут вместо каталога `--keys`.
    pub(crate) fn injected_keys() -> Option<Arc<KeySet>> {
        INJECTED.with(|slot| slot.borrow().clone())
    }

    struct Injected;

    impl Injected {
        fn on() -> Injected {
            INJECTED.with(|slot| *slot.borrow_mut() = Some(keys()));
            Injected
        }
    }

    impl Drop for Injected {
        fn drop(&mut self) {
            INJECTED.with(|slot| *slot.borrow_mut() = None);
        }
    }

    /// Малые архивы сцены и длинные цепочки правок: порога размера и порогов
    /// уплотнения нет (тесты уплотнения задают пороги сами).
    fn small() -> Tuning {
        Tuning {
            min_archive: 0,
            ..Tuning::default()
        }
        .without_compaction()
    }

    /// Синтетическая игра: `GTA5.exe`, `update/update.rpf` в виде NG, папка точек.
    struct Scene {
        dir: TempDir,
        game: PathBuf,
        points: PathBuf,
    }

    fn write_open(tree: &DirNode, path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut out = fs::File::create(path).unwrap();
        let mut context = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut out, &mut context, &mut |_| {}).unwrap();
    }

    impl Scene {
        fn new() -> Scene {
            let dir = tempfile::tempdir().unwrap();
            let game = dir.path().join("game");
            let points = dir.path().join("points");
            fs::create_dir_all(game.join("update")).unwrap();
            fs::create_dir_all(&points).unwrap();
            fs::write(game.join("GTA5.exe"), b"").unwrap();
            let live = game.join(UPDATE);
            write_open(&update_tree(None), &live);
            seal_file(&live, "update.rpf", &keys()).unwrap().unwrap();
            Scene { dir, game, points }
        }

        fn live(&self) -> PathBuf {
            self.game.join(UPDATE)
        }

        fn bytes(&self) -> Vec<u8> {
            fs::read(self.live()).unwrap()
        }

        fn journal(&self) -> PathBuf {
            journal_path(&self.live())
        }

        fn source(&self, name: &str, len: usize) -> PathBuf {
            let path = self.dir.path().join("sources").join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let body: Vec<u8> = format!("<{name}/>\n").bytes().cycle().take(len).collect();
            fs::write(&path, body).unwrap();
            path
        }

        fn ops(&self) -> Value {
            json!([
                { "entry": "common/data/new1.xml", "action": "import",
                  "source": self.source("new1.xml", 3000) },
                { "entry": "common/data/a.xml", "action": "replace",
                  "source": self.source("a.xml", 5000) },
                { "entry": "common/data/old.xml", "action": "delete", "allowDelete": true },
            ])
        }

        fn request_json(&self, ops: Value, install: Value, point: &str) -> Value {
            let mut block = json!({
                "gameRoot": self.game,
                "archive": UPDATE,
                "replay": { "module": "sky-rainbow", "workId": "w1" },
                "pointId": point,
                "write": "append",
            });
            for (key, value) in install.as_object().cloned().unwrap_or_default() {
                block[key] = value;
            }
            json!({
                "mode": "compose",
                "archiveTarget": UPDATE,
                "allowDeletes": true,
                "operations": ops,
                "install": block,
            })
        }

        fn request(&self, ops: Value, install: Value, point: &str) -> Request {
            parse_request(&self.request_json(ops, install, point).to_string()).unwrap()
        }

        fn append(&self, ops: Value, point: &str) -> Result<Value> {
            let request = self.request(ops, json!({}), point);
            append_core(
                &request,
                &keys(),
                &Progress::silent(),
                &self.points,
                small(),
            )
        }

        fn restore(&self, point: &str) -> Result<Value> {
            restore_in(point, &self.points, &Progress::silent())
        }
    }

    fn snapshot(path: &Path) -> BTreeMap<String, Vec<u8>> {
        let archive = Archive::open_path(path, Some(keys())).unwrap();
        let mut out = BTreeMap::new();
        let mut stack = vec![(archive.root(), String::new())];
        while let Some((dir, prefix)) = stack.pop() {
            for &id in archive.files(dir) {
                let name = format!("{prefix}{}", archive.entry(id).name);
                out.insert(name, archive.decode(id, EntryCipher::AlwaysNg).unwrap());
            }
            for &sub in archive.dirs(dir) {
                stack.push((sub, format!("{prefix}{}/", archive.entry(sub).name)));
            }
        }
        out
    }

    fn sha_text(bytes: &[u8]) -> String {
        rage_rpf::append::hex(&rage_rpf::append::sha256(bytes))
    }

    // ----- установка, ответ, точка -----

    #[test]
    fn an_append_installs_through_a_point_and_the_point_restores_the_archive() {
        let scene = Scene::new();
        let before = scene.bytes();
        let answer = scene.append(scene.ops(), ID).unwrap();

        assert_eq!(answer["status"], "ready");
        assert_eq!(answer["write"], "append");
        assert_eq!(answer["id"], ID);
        assert_eq!(answer["sha256"], Value::Null);
        assert_eq!(answer["archive"], UPDATE);
        assert_eq!(answer["created"], false);
        assert_eq!(answer["record"], 0);
        assert_eq!(answer["operations"], 3);
        assert_eq!(
            answer["entries"],
            json!([
                "common/data/a.xml",
                "common/data/new1.xml",
                "common/data/old.xml"
            ])
        );
        let fingerprint = answer["fingerprint"].as_str().unwrap();
        assert!(fingerprint.starts_with("a1:"), "{fingerprint}");
        assert_eq!(answer["fingerprintBefore"], sha_text(&before));
        for key in [
            "bytesWritten",
            "bytesMoved",
            "deadBytes",
            "movedBodies",
            "newBodies",
            "journalRecords",
            "bytes",
        ] {
            assert!(answer[key].is_u64(), "{key}");
        }
        assert!(answer["bytesWritten"].as_u64().unwrap() > 0);
        for stage in ["plan", "write", "sync", "head", "journal"] {
            assert!(answer["timings"][stage].is_u64(), "timings.{stage}");
        }
        assert_eq!(answer["archives"][0]["fingerprint"], fingerprint);

        // содержимое: правки на месте, остальное цело
        let after = snapshot(&scene.live());
        assert_eq!(after["common/data/a.xml"].len(), 5000);
        assert_eq!(after["common/data/new1.xml"].len(), 3000);
        assert!(!after.contains_key("common/data/old.xml"));
        assert!(after.contains_key("x64/data/cdimages/scaleform_generic.rpf"));

        // точка: запись переигрывания и опись с номером записи журнала
        let point = scene.points.join(ID);
        assert_eq!(
            fs::read_to_string(point.join("replay.json")).unwrap(),
            "{\n  \"module\": \"sky-rainbow\",\n  \"workId\": \"w1\"\n}"
        );
        let manifest: Value =
            serde_json::from_str(&fs::read_to_string(point.join("restore.json")).unwrap()).unwrap();
        let entry = &manifest["archives"][0];
        assert_eq!(entry["relativePath"], UPDATE);
        assert_eq!(entry["append"]["record"], 0);
        assert_eq!(entry["sha256Before"], sha_text(&before));
        assert_eq!(entry["sha256After"], fingerprint);
        assert_eq!(entry["backupPath"], "");
        assert!(scene.journal().is_file());
        assert!(!point.join("update").exists(), "копии «до» нет");

        // откат точки возвращает архив байт в байт и убирает точку
        let restored = scene.restore(ID).unwrap();
        assert_eq!(restored["archives"], json!([UPDATE]));
        assert!(scene.bytes() == before);
        assert!(!point.exists());
        let replay = journal::read(&scene.journal()).unwrap().unwrap();
        assert!(replay.records.is_empty());
        // повторный откат той же точки: точки уже нет
        assert!(scene.restore(ID).is_err());
    }

    #[test]
    fn two_installs_roll_back_in_reverse_order_and_the_older_point_takes_the_newer_with_it() {
        let scene = Scene::new();
        let original = scene.bytes();
        scene.append(scene.ops(), ID).unwrap();
        let first = scene.bytes();
        let more = json!([{ "entry": "common/data/b.dat", "action": "replace",
                            "source": scene.source("b.dat", 4000) }]);
        scene.append(more.clone(), ID2).unwrap();
        // новую точку первой: возвращается состояние после первой установки
        scene.restore(ID2).unwrap();
        assert!(scene.bytes() == first);
        scene.restore(ID).unwrap();
        assert!(scene.bytes() == original);

        // старую точку первой: она снимает и более новую запись
        scene.append(scene.ops(), ID).unwrap();
        scene.append(more, ID2).unwrap();
        scene.restore(ID).unwrap();
        assert!(scene.bytes() == original);
        // у новой точки записи в журнале уже нет, и архив не в её начале
        let refused = scene.restore(ID2).unwrap_err();
        assert_eq!(refused.code, "InvalidOperationException");
        assert!(scene.bytes() == original, "отказ ничего не тронул");
    }

    // ----- отказы -----

    #[test]
    fn an_operation_inside_an_open_nested_archive_is_refused_as_not_ng_and_nothing_is_left() {
        // вложенные архивы этой сцены записаны открытыми (метка не NG): дозапись их
        // не правит. С меткой NG — тесты ниже (`Scene::sealed`).
        let scene = Scene::new();
        let before = scene.bytes();
        let ops = json!([{ "entry": "x64/data/cdimages/scaleform_other.rpf/more.xml",
                           "action": "import", "source": scene.source("more.xml", 100) }]);
        let error = scene.append(ops, ID).unwrap_err();
        assert_eq!(error.code, "NotNg");
        assert!(scene.bytes() == before);
        assert!(!scene.points.join(ID).exists());
        assert!(!scene.journal().exists());
        // вложенный архив как запись, а источник не архив: отказ при его разборе
        let whole = json!([{ "entry": "x64/data/cdimages/fresh.rpf", "action": "import",
                             "source": scene.source("fresh.rpf", 100) }]);
        let error = scene.append(whole, ID).unwrap_err();
        assert_eq!(error.code, "InvalidDataException");
        assert!(scene.bytes() == before);
        assert!(!scene.points.join(ID).exists());
        assert!(!scene.journal().exists());
    }

    #[test]
    fn options_that_do_not_go_with_append_are_refused_before_any_write() {
        let scene = Scene::new();
        let before = scene.bytes();
        let sha = "ab".repeat(32);
        // `saveRecipe` отсюда убран: у дозаписи это путь сводного рецепта, и он
        // принимается (тесты `a_summary_recipe_…`); сборка по рецепту дозаписи
        // по-прежнему не нужна
        let cases = [
            json!({ "before": "aside" }),
            json!({ "useRecipe": scene.dir.path().join("r.json") }),
            json!({ "expectSha256": sha }),
            json!({ "prebuilt": scene.dir.path().join("p.rpf"), "sha256": sha }),
            json!({ "create": true }),
            json!({ "write": "sideways" }),
            json!({ "baseSha256": "nope" }),
        ];
        for install in cases {
            let text = scene
                .request_json(scene.ops(), install.clone(), ID)
                .to_string();
            let outcome = parse_request(&text).and_then(|request| {
                append_core(
                    &request,
                    &keys(),
                    &Progress::silent(),
                    &scene.points,
                    small(),
                )
            });
            let error = outcome.unwrap_err();
            assert_eq!(error.code, "ArgumentException", "{install}");
            assert!(scene.bytes() == before, "{install}");
            assert!(!scene.points.join(ID).exists(), "{install}");
        }
    }

    #[test]
    fn a_base_archive_that_is_not_the_live_one_is_refused() {
        let scene = Scene::new();
        let mut request = scene.request(scene.ops(), json!({}), ID);
        request.base = Some(scene.dir.path().join("elsewhere.rpf"));
        let error = append_core(
            &request,
            &keys(),
            &Progress::silent(),
            &scene.points,
            small(),
        )
        .unwrap_err();
        assert_eq!(error.code, "ArgumentException");
        // свой же файл основой назвать можно
        request.base = Some(scene.live());
        append_core(
            &request,
            &keys(),
            &Progress::silent(),
            &scene.points,
            small(),
        )
        .unwrap();
    }

    #[test]
    fn a_missing_archive_and_a_bad_point_id_are_refused() {
        let scene = Scene::new();
        fs::remove_file(scene.live()).unwrap();
        let error = scene.append(scene.ops(), ID).unwrap_err();
        assert_eq!(error.code, "FileNotFoundException");
        let scene = Scene::new();
        let error = scene.append(scene.ops(), "bad id!").unwrap_err();
        assert_eq!(error.code, "ArgumentException");
    }

    #[test]
    fn an_archive_with_a_second_name_is_refused_with_linked_and_the_point_is_not_left() {
        let scene = Scene::new();
        let before = scene.bytes();
        let beside = scene.game.join("update").join("update.rpf.astral-before-x");
        fs::hard_link(scene.live(), &beside).unwrap();
        let error = scene.append(scene.ops(), ID).unwrap_err();
        assert_eq!(error.code, "Linked");
        assert!(scene.bytes() == before);
        assert!(!scene.points.join(ID).exists());
        fs::remove_file(&beside).unwrap();
        scene.append(scene.ops(), ID).unwrap();
    }

    #[test]
    fn a_small_archive_is_refused_by_the_default_threshold() {
        let scene = Scene::new();
        let request = scene.request(scene.ops(), json!({}), ID);
        let error = append_core(
            &request,
            &keys(),
            &Progress::silent(),
            &scene.points,
            Tuning::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, "ArchiveTooSmall");
        assert!(!scene.points.join(ID).exists());
    }

    #[test]
    fn a_foreign_change_after_an_install_is_refused_by_the_next_one() {
        let scene = Scene::new();
        scene.append(scene.ops(), ID).unwrap();
        let mut bytes = scene.bytes();
        bytes.extend_from_slice(b"someone was here");
        fs::write(scene.live(), &bytes).unwrap();
        let error = scene.append(scene.ops(), ID2).unwrap_err();
        assert_eq!(error.code, "ForeignChange");
        assert!(scene.bytes() == bytes);
        assert!(!scene.points.join(ID2).exists());
    }

    // ----- потолок записи и отмена -----

    fn random_source(scene: &Scene, name: &str, len: usize) -> PathBuf {
        let path = scene.dir.path().join("sources").join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut state = 0x9e37_79b9_7f4a_7c15u64;
        let body: Vec<u8> = (0..len)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state >> 24) as u8
            })
            .collect();
        fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn the_write_ceiling_of_the_request_paces_the_bodies() {
        let scene = Scene::new();
        let source = random_source(&scene, "big.bin", 3 << 19);
        let ops = json!([{ "entry": "common/data/big.bin", "action": "import", "source": source }]);
        let request = scene.request(ops, json!({}), ID);
        let progress = Progress::silent();
        let limit = Options::parse(&["--write-limit-mbps".to_owned(), "1".to_owned()]).unwrap();
        let _pacing = progress.pace(WritePacer::from_options(&limit));
        let started = Instant::now();
        let answer = append_core(&request, &keys(), &progress, &scene.points, small()).unwrap();
        let written = answer["bytesWritten"].as_u64().unwrap();
        assert!(written >= 3 << 19, "{written}");
        // 1,5 МиБ при потолке 1 МиБ/с не быстрее полутора секунд
        assert!(
            started.elapsed() >= Duration::from_millis(1300),
            "потолок записи не держится: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_cancel_before_the_write_leaves_the_archive_the_point_and_the_journal_alone() {
        let scene = Scene::new();
        let before = scene.bytes();
        let progress = Progress::silent();
        let flag = scene.dir.path().join("cancel.flag");
        progress.cancel().watch_file(flag.clone());
        fs::write(&flag, b"").unwrap();
        let request = scene.request(scene.ops(), json!({}), ID);
        let error = append_core(&request, &keys(), &progress, &scene.points, small()).unwrap_err();
        assert_eq!(error.code, "Cancelled");
        assert!(scene.bytes() == before);
        assert!(!scene.points.join(ID).exists());
        assert!(!scene.journal().exists());
    }

    // ----- команды -----

    fn options_for(request: &Path, extra: &[&str]) -> Options {
        let mut words = vec![
            "--request".to_owned(),
            request.to_string_lossy().into_owned(),
        ];
        words.extend(extra.iter().map(|text| (*text).to_owned()));
        Options::parse(&words).unwrap()
    }

    #[test]
    fn the_append_command_reads_its_request_and_applies_the_default_threshold() {
        let _keys = Injected::on();
        let scene = Scene::new();
        let before = scene.bytes();
        let mut json = scene.request_json(scene.ops(), json!({}), ID);
        // у самой команды ключ `write` не нужен
        json["install"].as_object_mut().unwrap().remove("write");
        let file = scene.dir.path().join("request.json");
        fs::write(&file, json.to_string()).unwrap();
        let options = options_for(
            &file,
            &["--restore-points-root", &scene.points.to_string_lossy()],
        );
        // порог размера у команды боевой, а стендовый архив мал
        match append_rpf(&options, &Progress::silent()) {
            Err(error) => assert_eq!(error.code, "ArchiveTooSmall"),
            Ok(_) => panic!("порог не сработал"),
        }
        assert!(scene.bytes() == before);
    }

    #[test]
    fn the_rollback_command_undoes_records_down_to_the_named_one() {
        let scene = Scene::new();
        let original = scene.bytes();
        scene.append(scene.ops(), ID).unwrap();
        let first = scene.bytes();
        scene
            .append(
                json!([{ "entry": "common/data/b.dat", "action": "replace",
                         "source": scene.source("b.dat", 4000) }]),
                ID2,
            )
            .unwrap();

        let ask = |record: u64| {
            let body = json!({ "gameRoot": scene.game, "archive": UPDATE, "record": record });
            let file = scene.dir.path().join("rollback.json");
            fs::write(&file, body.to_string()).unwrap();
            rollback_rpf_append(&options_for(&file, &[]), &Progress::silent())
        };
        let answer = ask(1).unwrap();
        assert_eq!(answer["rolledBack"], json!([1]));
        assert_eq!(answer["missing"], false);
        assert_eq!(answer["journalRecords"], 1);
        assert!(scene.bytes() == first);
        // повтор: записи уже нет
        let again = ask(1).unwrap();
        assert_eq!(again["rolledBack"], json!([]));
        assert_eq!(again["missing"], true);
        assert!(scene.bytes() == first);
        let answer = ask(0).unwrap();
        assert_eq!(answer["rolledBack"], json!([0]));
        assert_eq!(answer["fingerprint"], sha_text(&original));
        assert!(scene.bytes() == original);
        for timing in ["plan", "write", "sync", "head", "journal"] {
            assert!(answer["timings"][timing].is_u64());
        }
    }

    #[test]
    fn the_rollback_command_refuses_a_state_the_point_does_not_remember() {
        let scene = Scene::new();
        scene.append(scene.ops(), ID).unwrap();
        let after = scene.bytes();
        let body = json!({ "gameRoot": scene.game, "archive": UPDATE, "record": 0,
                           "expectBefore": "cd".repeat(32) });
        let file = scene.dir.path().join("rollback.json");
        fs::write(&file, body.to_string()).unwrap();
        let error = rollback_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap_err();
        assert_eq!(error.code, "ForeignChange");
        assert!(scene.bytes() == after);
        for body in [
            json!({ "archive": UPDATE, "record": 0 }),
            json!({ "gameRoot": scene.game, "record": 0 }),
            json!({ "gameRoot": scene.game, "archive": UPDATE }),
            json!({ "gameRoot": scene.game, "archive": UPDATE, "record": 0, "expectBefore": 5 }),
        ] {
            fs::write(&file, body.to_string()).unwrap();
            let error =
                rollback_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap_err();
            assert_eq!(error.code, "ArgumentException", "{body}");
        }
    }

    #[test]
    fn the_recover_command_does_nothing_without_a_journal() {
        let scene = Scene::new();
        let before = scene.bytes();
        let body = json!({ "gameRoot": scene.game, "archive": UPDATE });
        let file = scene.dir.path().join("recover.json");
        fs::write(&file, body.to_string()).unwrap();
        let answer = recover_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap();
        assert_eq!(answer["recovered"], false);
        assert_eq!(answer["archives"][0]["journal"], false);
        assert_eq!(answer["archives"][0]["action"], "none");
        assert!(scene.bytes() == before);
        // список
        let body = json!({ "gameRoot": scene.game, "archives": [UPDATE, "common.rpf"] });
        fs::write(&file, body.to_string()).unwrap();
        let answer = recover_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap();
        assert_eq!(answer["archives"].as_array().unwrap().len(), 2);
        fs::write(&file, json!({ "gameRoot": scene.game }).to_string()).unwrap();
        assert!(recover_rpf_append(&options_for(&file, &[]), &Progress::silent()).is_err());
    }

    // ----- ключ install.write у compose-rpf -----

    #[test]
    fn the_write_key_is_parsed_and_the_default_is_the_full_path() {
        let scene = Scene::new();
        let mut json = scene.request_json(scene.ops(), json!({}), ID);
        let parsed = |json: &Value| parse_request(&json.to_string()).unwrap();
        assert_eq!(
            parsed(&json).install.unwrap().options.write,
            compose::WriteMode::Append
        );
        json["install"]["write"] = json!("full");
        assert_eq!(
            parsed(&json).install.unwrap().options.write,
            compose::WriteMode::Full
        );
        json["install"].as_object_mut().unwrap().remove("write");
        let install = parsed(&json).install.unwrap();
        assert_eq!(install.options.write, compose::WriteMode::Full);
        assert_eq!(install.options.base_sha256, None);
        json["install"]["baseSha256"] = json!("EF".repeat(32));
        assert_eq!(
            parsed(&json).install.unwrap().options.base_sha256,
            Some("EF".repeat(32))
        );
    }

    #[test]
    fn compose_with_write_append_is_refused_without_the_switch() {
        let scene = Scene::new();
        let before = scene.bytes();
        let file = scene.dir.path().join("request.json");
        let json = scene.request_json(scene.ops(), json!({}), ID);
        fs::write(&file, json.to_string()).unwrap();
        let options = options_for(
            &file,
            &["--restore-points-root", &scene.points.to_string_lossy()],
        );
        let _keys = Injected::on();
        // выключатель в окружении процесса теста не стоит
        let error = compose::compose_rpf(&options, &Progress::silent()).unwrap_err();
        assert_eq!(error.code, "ArgumentException");
        assert_eq!(error.message, "Install write mode append is not enabled.");
        assert!(scene.bytes() == before);
        assert!(!scene.points.join(ID).exists());
    }

    // ----- полный путь рядом с журналом -----

    fn full_install(scene: &Scene, prebuilt: &Path, point: &str) -> Result<Value> {
        let sha = sha256_file(prebuilt).unwrap();
        let mut request = scene.request(
            json!([]),
            json!({ "write": "full", "prebuilt": prebuilt, "sha256": sha, "pointId": point }),
            point,
        );
        request.install.as_mut().unwrap().options.write = compose::WriteMode::Full;
        crate::archives::composed_install::compose_install(
            &request,
            &keys(),
            None,
            &Progress::silent(),
            &scene.points,
        )
    }

    #[test]
    fn the_full_path_removes_the_journal_after_the_swap() {
        let scene = Scene::new();
        scene.append(scene.ops(), ID).unwrap();
        assert!(scene.journal().is_file());
        let other = scene.dir.path().join("other.rpf");
        fs::write(&other, b"a whole new archive").unwrap();
        full_install(&scene, &other, ID2).unwrap();
        assert_eq!(fs::read(scene.live()).unwrap(), b"a whole new archive");
        assert!(!scene.journal().exists(), "журнал прежнего файла остался");
    }

    #[test]
    fn a_damaged_journal_stops_the_append_but_not_the_full_path() {
        let scene = Scene::new();
        scene.append(scene.ops(), ID).unwrap();
        scene
            .append(
                json!([{ "entry": "common/data/b.dat", "action": "replace",
                         "source": scene.source("b.dat", 4000) }]),
                ID2,
            )
            .unwrap();
        let mut whole = fs::read(scene.journal()).unwrap();
        let spot = whole.len() / 3;
        whole[spot] ^= 0x40;
        fs::write(scene.journal(), &whole).unwrap();
        let archive = scene.bytes();
        let error = scene
            .append(scene.ops(), "rpf-20261104-120002-cccccccccccccccccc")
            .unwrap_err();
        assert_eq!(error.code, "JournalDamaged");
        assert!(scene.bytes() == archive);
        // откат и восстановление тоже отказывают, не гадая
        let body = json!({ "gameRoot": scene.game, "archive": UPDATE, "record": 0 });
        let file = scene.dir.path().join("rollback.json");
        fs::write(&file, body.to_string()).unwrap();
        let error = rollback_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap_err();
        assert_eq!(error.code, "JournalDamaged");
        // полный путь журнал игнорирует и убирает вместе с прежним файлом
        let other = scene.dir.path().join("other.rpf");
        fs::write(&other, b"a whole new archive").unwrap();
        full_install(&scene, &other, "rpf-20261104-120003-dddddddddddddddddd").unwrap();
        assert_eq!(fs::read(scene.live()).unwrap(), b"a whole new archive");
        assert!(!scene.journal().exists());
    }

    #[test]
    fn an_archive_marked_read_only_is_appended_and_restored_and_stays_read_only() {
        let scene = Scene::new();
        let before = scene.bytes();
        let mut permissions = fs::metadata(scene.live()).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(scene.live(), permissions).unwrap();
        scene.append(scene.ops(), ID).unwrap();
        assert!(fs::metadata(scene.live()).unwrap().permissions().readonly());
        scene.restore(ID).unwrap();
        assert!(fs::metadata(scene.live()).unwrap().permissions().readonly());
        assert!(scene.bytes() == before);
        let mut permissions = fs::metadata(scene.live()).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(scene.live(), permissions).unwrap();
    }

    #[test]
    fn a_swap_removes_the_journal_of_the_replaced_file() {
        let scene = Scene::new();
        fs::write(scene.journal(), b"stale").unwrap();
        let fresh = scene.live().with_file_name("update.rpf.fresh");
        fs::write(&fresh, b"fresh").unwrap();
        points::swap_in(&fresh, &scene.live()).unwrap();
        assert_eq!(fs::read(scene.live()).unwrap(), b"fresh");
        assert!(!scene.journal().exists());
    }

    // ----- убитый процесс -----

    /// Ребёнок: дозапись по запросу из папки сцены. Без переменной — пустой тест.
    #[test]
    fn child_append() {
        let Some(root) = std::env::var_os(CHILD_ENV) else {
            return;
        };
        let root = PathBuf::from(root);
        let text = fs::read_to_string(root.join("request.json")).unwrap();
        let request = parse_request(&text).unwrap();
        let _ = append_core(
            &request,
            &keys(),
            &Progress::silent(),
            &root.join("points"),
            small(),
        );
    }

    fn killed_at(scene: &Scene, point: &str, point_id: &str) {
        killed_with(scene, point, point_id, scene.ops());
    }

    /// Ребёнок с заданными операциями умирает в названной точке.
    fn killed_with(scene: &Scene, point: &str, point_id: &str, ops: Value) {
        let body = scene.request_json(ops, json!({}), point_id);
        fs::write(scene.dir.path().join("request.json"), body.to_string()).unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "archives::append::tests::child_append",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD_ENV, scene.dir.path())
            .env("ASTRAL_ENGINE_FAILPOINT", point)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(137), "{point}");
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        assert!(stderr.contains(&format!("[failpoint] {point}")), "{stderr}");
    }

    const KILL_POINTS: [&str; 8] = [
        "append-after-manifest",
        "append-after-journal",
        "append-in-data",
        "append-after-data",
        "append-after-synced",
        "append-mid-head",
        "append-after-head",
        "append-after-done",
    ];

    #[test]
    fn a_killed_process_at_every_point_is_settled_and_the_point_restores_the_archive() {
        let reference = {
            let scene = Scene::new();
            scene.append(scene.ops(), ID).unwrap();
            scene.bytes()
        };
        for point in KILL_POINTS {
            let scene = Scene::new();
            let before = scene.bytes();
            killed_at(&scene, point, ID);

            // восстановление доводит или возвращает
            let settled = settle_beside(&scene.live(), &Progress::silent()).unwrap();
            let bytes = scene.bytes();
            match point {
                "append-after-head" => {
                    assert!(matches!(settled, Settled::Completed(0)), "{point}");
                    assert!(bytes == reference, "{point}");
                }
                "append-after-done" => {
                    assert_eq!(settled, Settled::Clean, "{point}");
                    assert!(bytes == reference, "{point}");
                }
                "append-after-manifest" => {
                    assert_eq!(settled, Settled::Clean, "{point}");
                    assert!(bytes == before, "{point}");
                }
                _ => {
                    assert!(
                        matches!(settled, Settled::RolledBack(0)),
                        "{point}: {settled:?}"
                    );
                    assert!(bytes == before, "{point}");
                }
            }

            // точка, оставленная убитой установкой, откатывает всё к прежнему
            scene.restore(ID).unwrap();
            assert!(scene.bytes() == before, "{point}: точка не вернула архив");
            assert!(!scene.points.join(ID).exists(), "{point}");
        }
    }

    #[test]
    fn a_killed_process_is_recovered_by_the_command_and_by_the_point_alone() {
        for point in ["append-in-data", "append-mid-head", "append-after-head"] {
            let scene = Scene::new();
            let before = scene.bytes();
            killed_at(&scene, point, ID);
            let body = json!({ "gameRoot": scene.game, "archive": UPDATE });
            let file = scene.dir.path().join("recover.json");
            fs::write(&file, body.to_string()).unwrap();
            let answer = recover_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap();
            assert_eq!(answer["recovered"], true, "{point}");
            let row = &answer["archives"][0];
            let action = if point == "append-after-head" {
                "completed"
            } else {
                "rolledBack"
            };
            assert_eq!(row["action"], action, "{point}");
            assert_eq!(row["record"], 0, "{point}");
            // повтор: чисто
            let again = recover_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap();
            assert_eq!(again["recovered"], false, "{point}");
            // без восстановления: точка сама приводит архив к прежнему
            let other = Scene::new();
            killed_at(&other, point, ID);
            other.restore(ID).unwrap();
            assert!(other.bytes() == before, "{point}");
        }
    }

    #[test]
    fn the_full_path_after_a_kill_takes_the_before_copy_of_the_settled_archive() {
        let scene = Scene::new();
        let before = scene.bytes();
        killed_at(&scene, "append-mid-head", ID);
        let other = scene.dir.path().join("other.rpf");
        fs::write(&other, b"a whole new archive").unwrap();
        full_install(&scene, &other, ID2).unwrap();
        assert_eq!(fs::read(scene.live()).unwrap(), b"a whole new archive");
        assert!(!scene.journal().exists());
        // «до» точки полного пути — прежний, доведённый архив
        let backup = scene.points.join(ID2).join(UPDATE);
        assert!(fs::read(&backup).unwrap() == before);
    }

    /// Чужие байты четырёх видов (как в тестах `rage-rpf`): другой архив той же
    /// длины, длиннее новой длины, короче прежней и сам оригинал игры.
    fn stranger_bytes(scene: &Scene, kind: usize, before: &[u8]) -> Vec<u8> {
        let path = scene.dir.path().join("other-archive").join("update.rpf");
        write_open(&update_tree(Some(b"<other/>".to_vec())), &path);
        seal_file(&path, "update.rpf", &keys()).unwrap().unwrap();
        let mut other = fs::read(&path).unwrap();
        match kind {
            0 => other.resize(before.len(), 0),
            1 => other.resize(before.len() + (1 << 20), 0),
            2 => other.truncate(before.len() / 2),
            _ => return before.to_vec(),
        }
        other
    }

    /// Файл подменяют так, как это делает лаунчер: новый файл рядом и
    /// переименование поверх (другой номер файла).
    fn swap_live(scene: &Scene, bytes: &[u8]) {
        let fresh = scene.game.join("update").join("update.rpf.fresh");
        fs::write(&fresh, bytes).unwrap();
        fs::rename(&fresh, scene.live()).unwrap();
    }

    #[test]
    fn a_file_replaced_after_a_kill_is_left_alone_by_every_command_and_the_full_path_replaces_it() {
        for point in ["append-in-data", "append-mid-head", "append-after-head"] {
            for kind in 0..4 {
                let scene = Scene::new();
                let before = scene.bytes();
                killed_at(&scene, point, ID);
                let journal_before = fs::read(scene.journal()).unwrap();
                let other = stranger_bytes(&scene, kind, &before);
                swap_live(&scene, &other);
                let label = format!("{point}, вид {kind}");

                // восстановление, дозапись и откат точки отдают ForeignChange и не пишут
                let body = json!({ "gameRoot": scene.game, "archive": UPDATE });
                let file = scene.dir.path().join("recover.json");
                fs::write(&file, body.to_string()).unwrap();
                let error =
                    recover_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap_err();
                assert_eq!(error.code, "ForeignChange", "{label}");
                let error = scene.append(scene.ops(), ID2).unwrap_err();
                assert_eq!(error.code, "ForeignChange", "{label}");
                assert!(!scene.points.join(ID2).exists(), "{label}");
                let error = scene.restore(ID).unwrap_err();
                assert_eq!(error.code, "ForeignChange", "{label}");
                assert!(scene.bytes() == other, "{label}: чужой файл изменён");
                assert!(
                    fs::read(scene.journal()).unwrap() == journal_before,
                    "{label}: журнал тронут"
                );

                // полный путь проходит: файл не трогал, «до» — чужой файл, журнал убран
                let whole = scene.dir.path().join("other.rpf");
                fs::write(&whole, b"a whole new archive").unwrap();
                full_install(&scene, &whole, ID2).unwrap();
                assert_eq!(fs::read(scene.live()).unwrap(), b"a whole new archive");
                assert!(!scene.journal().exists(), "{label}: журнал остался");
                assert!(
                    fs::read(scene.points.join(ID2).join(UPDATE)).unwrap() == other,
                    "{label}: «до» не равно чужому файлу"
                );
            }
        }
    }

    #[test]
    fn the_settle_beside_a_foreign_file_is_clean_and_writes_nothing() {
        let scene = Scene::new();
        let before = scene.bytes();
        killed_at(&scene, "append-mid-head", ID);
        let other = stranger_bytes(&scene, 0, &before);
        swap_live(&scene, &other);
        let journal_before = fs::read(scene.journal()).unwrap();
        let settled = settle_beside(&scene.live(), &Progress::silent()).unwrap();
        assert_eq!(settled, Settled::Clean);
        assert!(scene.bytes() == other);
        assert!(fs::read(scene.journal()).unwrap() == journal_before);
    }

    #[test]
    fn the_switch_names_modules_like_the_install_ops_switch() {
        assert!(!enabled_for("sky-rainbow", None));
        assert!(!enabled_for("sky-rainbow", Some("")));
        assert!(!enabled_for("", Some("sky-rainbow")));
        assert!(enabled_for("sky-rainbow", Some("sky-rainbow")));
        assert!(enabled_for("Sky-Rainbow", Some(" lamp , SKY-RAINBOW ")));
        assert!(!enabled_for("sky", Some("sky-rainbow")));
        assert!(!enabled_for("lamp-lights", Some("lamp-lights-package")));
    }

    // ----- вложенные архивы (часть 4) -----

    /// Доводчик вложенных архивов: родная доводка NG по имени записи.
    struct NestedSealer(Arc<KeySet>);

    impl rage_rpf::Finalizer for NestedSealer {
        fn finalize(&self, path: &Path, name: &str) -> rage_rpf::Result<()> {
            seal_file(path, name, &self.0)?;
            Ok(())
        }
    }

    impl Scene {
        /// Игра, у которой и корень, и вложенные архивы доведены до NG (как у
        /// настоящего `update.rpf`).
        fn sealed() -> Scene {
            Scene::sealed_from(&update_tree(None))
        }

        fn sealed_from(tree: &DirNode) -> Scene {
            let dir = tempfile::tempdir().unwrap();
            let game = dir.path().join("game");
            let points = dir.path().join("points");
            fs::create_dir_all(game.join("update")).unwrap();
            fs::create_dir_all(&points).unwrap();
            fs::write(game.join("GTA5.exe"), b"").unwrap();
            let live = game.join(UPDATE);
            let sealer = NestedSealer(keys());
            let mut out = fs::File::create(&live).unwrap();
            let mut context = WriteContext {
                staging: dir.path(),
                keys: None,
                finalizer: Some(&sealer),
            };
            write_archive(tree, &mut out, &mut context, &mut |_| {}).unwrap();
            drop(out);
            seal_file(&live, "update.rpf", &keys()).unwrap().unwrap();
            Scene { dir, game, points }
        }

        /// Правки внутри вложенного архива и в корне одной установкой.
        fn nested_ops(&self) -> Value {
            json!([
                { "entry": "x64/data/cdimages/scaleform_generic.rpf/new_inside.xml",
                  "action": "import", "source": self.source("new_inside.xml", 3000) },
                { "entry": "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml",
                  "action": "replace", "source": self.source("deep.xml", 4000) },
                { "entry": "x64/data/cdimages/scaleform_generic.rpf/hud.gfx",
                  "action": "delete", "allowDelete": true },
                { "entry": "common/data/new1.xml", "action": "import",
                  "source": self.source("new1.xml", 3000) },
            ])
        }

        /// Ещё одна правка того же вложенного архива.
        fn more_nested_ops(&self) -> Value {
            json!([
                { "entry": "x64/data/cdimages/scaleform_generic.rpf/second.xml",
                  "action": "import", "source": self.source("second.xml", 2500) },
                { "entry": "x64/data/cdimages/scaleform_generic.rpf/mini.gfx",
                  "action": "replace", "source": self.source("mini.gfx", 1800) },
            ])
        }
    }

    /// Содержимое на всех уровнях: вложенные архивы раскрываются.
    fn deep_snapshot(path: &Path) -> BTreeMap<String, Vec<u8>> {
        fn walk(archive: &Archive, prefix: &str, out: &mut BTreeMap<String, Vec<u8>>) {
            let mut stack = vec![(archive.root(), prefix.to_owned())];
            while let Some((dir, path)) = stack.pop() {
                for &id in archive.files(dir) {
                    let entry = archive.entry(id);
                    let name = format!("{path}{}", entry.name);
                    if Archive::is_nested_archive_name(&entry.name) {
                        let inner = archive.open_nested(id).unwrap();
                        walk(&inner, &format!("{name}/"), out);
                    } else {
                        out.insert(name, archive.decode(id, EntryCipher::AlwaysNg).unwrap());
                    }
                }
                for &sub in archive.dirs(dir) {
                    stack.push((sub, format!("{path}{}/", archive.entry(sub).name)));
                }
            }
        }
        let archive = Archive::open_path(path, Some(keys())).unwrap();
        let mut out = BTreeMap::new();
        walk(&archive, "", &mut out);
        out
    }

    const NESTED: &str = "x64/data/cdimages/scaleform_generic.rpf";

    #[test]
    fn a_nested_install_moves_the_archive_then_lands_in_its_reserve_and_the_points_restore_it() {
        let scene = Scene::sealed();
        let original = scene.bytes();
        let before = deep_snapshot(&scene.live());

        // первая установка: вложенный переезжает
        let first = scene.append(scene.nested_ops(), ID).unwrap();
        assert_eq!(first["nestedMoved"], 1);
        assert_eq!(first["nestedInReserve"], 0);
        assert_eq!(first["nestedCreated"], 0);
        assert!(first["bytesMoved"].as_u64().unwrap() > 0);
        assert!(
            first["deadBytes"].as_u64().unwrap() > 0,
            "старая копия мёртвая"
        );
        assert!(first["timings"]["plan"].is_u64());
        let after_first = scene.bytes();
        let snapshot = deep_snapshot(&scene.live());
        assert_eq!(snapshot[&format!("{NESTED}/new_inside.xml")].len(), 3000);
        assert_eq!(snapshot[&format!("{NESTED}/inner/deep.xml")].len(), 4000);
        assert!(!snapshot.contains_key(&format!("{NESTED}/hud.gfx")));
        assert_eq!(snapshot["common/data/new1.xml"].len(), 3000);
        for (name, bytes) in &before {
            let touched = [
                format!("{NESTED}/inner/deep.xml"),
                format!("{NESTED}/hud.gfx"),
            ];
            if !touched.contains(name) {
                assert!(snapshot[name] == *bytes, "{name} изменился");
            }
        }

        // вторая установка в тот же вложенный: в запас, файл не растёт
        let second = scene.append(scene.more_nested_ops(), ID2).unwrap();
        assert_eq!(second["nestedMoved"], 0);
        assert_eq!(second["nestedInReserve"], 1);
        assert_eq!(second["bytes"].as_u64().unwrap(), after_first.len() as u64);
        assert_eq!(second["bytesMoved"], 0);
        let snapshot = deep_snapshot(&scene.live());
        assert_eq!(snapshot[&format!("{NESTED}/second.xml")].len(), 2500);
        assert_eq!(snapshot[&format!("{NESTED}/mini.gfx")].len(), 1800);

        // откат точек в обратном порядке возвращает файл байт в байт
        scene.restore(ID2).unwrap();
        assert!(scene.bytes() == after_first);
        scene.restore(ID).unwrap();
        assert!(scene.bytes() == original);
        // и старая точка первой снимает обе записи
        scene.append(scene.nested_ops(), ID).unwrap();
        scene.append(scene.more_nested_ops(), ID2).unwrap();
        scene.restore(ID).unwrap();
        assert!(scene.bytes() == original);
    }

    #[test]
    fn a_whole_nested_archive_as_an_entry_is_replaced_or_created_through_the_tree() {
        let scene = Scene::sealed();
        let donor = scene.dir.path().join("donor.rpf");
        write_open(&rage_rpf::fixtures::replacement_tree(), &donor);
        let ops = json!([
            { "entry": "x64/data/cdimages/scaleform_other.rpf", "action": "replace",
              "source": donor },
            { "entry": "x64/data/cdimages/brand_new.rpf", "action": "import",
              "source": donor },
        ]);
        let original = scene.bytes();
        let answer = scene.append(ops, ID).unwrap();
        assert_eq!(answer["nestedMoved"], 1);
        assert_eq!(answer["nestedCreated"], 1);
        let snapshot = deep_snapshot(&scene.live());
        let inside = "x64/data/cdimages/scaleform_other.rpf/new_inside.xml";
        assert_eq!(snapshot[inside].len(), 333);
        assert!(!snapshot.contains_key("x64/data/cdimages/scaleform_other.rpf/keep.xml"));
        assert_eq!(
            snapshot["x64/data/cdimages/brand_new.rpf/new_inside.xml"].len(),
            333
        );
        scene.restore(ID).unwrap();
        assert!(scene.bytes() == original);
    }

    #[test]
    fn a_nested_archive_inside_a_nested_archive_is_refused_with_its_code_and_nothing_is_left() {
        let mut leaf = DirNode::new("");
        leaf.files.push(rage_rpf::FileNode {
            name: "deep.xml".into(),
            body: rage_rpf::Body::Binary {
                data: rage_rpf::Data::memory(b"<deep/>".to_vec()),
                compress: rage_rpf::Compress::Store,
            },
        });
        let mut middle = DirNode::new("");
        middle.files.push(rage_rpf::FileNode {
            name: "leaf.rpf".into(),
            body: rage_rpf::Body::Nested(Box::new(leaf)),
        });
        let mut x64 = DirNode::new("x64");
        x64.files.push(rage_rpf::FileNode {
            name: "outer.rpf".into(),
            body: rage_rpf::Body::Nested(Box::new(middle)),
        });
        let mut root = DirNode::new("");
        root.dirs.push(x64);
        let scene = Scene::sealed_from(&root);
        let before = scene.bytes();
        let ops = json!([{ "entry": "x64/outer.rpf/leaf.rpf/more.xml",
                           "action": "import", "source": scene.source("more.xml", 100) }]);
        let error = scene.append(ops, ID).unwrap_err();
        assert_eq!(error.code, "NestedTooDeep");
        assert!(scene.bytes() == before);
        assert!(!scene.points.join(ID).exists());
        assert!(!scene.journal().exists());
        // правка самого вложенного идёт, вложенный листа переезжает вместе с ним
        let middle_op = json!([{ "entry": "x64/outer.rpf/added.xml",
                                 "action": "import", "source": scene.source("added.xml", 100) }]);
        let answer = scene.append(middle_op, ID).unwrap();
        assert_eq!(answer["nestedMoved"], 1);
        let snapshot = deep_snapshot(&scene.live());
        assert_eq!(snapshot["x64/outer.rpf/leaf.rpf/deep.xml"], b"<deep/>");
    }

    #[test]
    fn a_killed_process_in_a_reserve_edit_is_settled_at_every_point_between_the_heads_too() {
        const POINTS: [&str; 10] = [
            "append-after-manifest",
            "append-after-journal",
            "append-in-data",
            "append-after-data",
            "append-after-synced",
            "append-mid-nested-head",
            "append-after-nested-head",
            "append-mid-head",
            "append-after-head",
            "append-after-done",
        ];
        // второй установке нужны и корень, и вложенный: между головами есть что терять
        let ops = |scene: &Scene| {
            let mut all = scene.more_nested_ops().as_array().cloned().unwrap();
            all.push(json!({ "entry": "common/data/late.xml", "action": "import",
                             "source": scene.source("late.xml", 4000) }));
            Value::Array(all)
        };
        let reference = {
            let scene = Scene::sealed();
            scene.append(scene.nested_ops(), ID).unwrap();
            scene.append(ops(&scene), ID2).unwrap();
            scene.bytes()
        };
        for point in POINTS {
            let scene = Scene::sealed();
            let original = scene.bytes();
            scene.append(scene.nested_ops(), ID).unwrap();
            let after_first = scene.bytes();
            killed_with(&scene, point, ID2, ops(&scene));

            let settled = settle_beside(&scene.live(), &Progress::silent()).unwrap();
            let bytes = scene.bytes();
            match point {
                "append-after-head" => {
                    assert!(
                        matches!(settled, Settled::Completed(1)),
                        "{point}: {settled:?}"
                    );
                    assert!(bytes == reference, "{point}");
                }
                "append-after-done" => {
                    assert_eq!(settled, Settled::Clean, "{point}");
                    assert!(bytes == reference, "{point}");
                }
                "append-after-manifest" => {
                    assert_eq!(settled, Settled::Clean, "{point}");
                    assert!(bytes == after_first, "{point}");
                }
                _ => {
                    assert!(
                        matches!(settled, Settled::RolledBack(1)),
                        "{point}: {settled:?}"
                    );
                    assert!(bytes == after_first, "{point}");
                }
            }
            // точка убитой установки возвращает файл к состоянию до неё, потом до первой
            scene.restore(ID2).unwrap();
            assert!(scene.bytes() == after_first, "{point}: вторая точка");
            scene.restore(ID).unwrap();
            assert!(scene.bytes() == original, "{point}: первая точка");
        }
    }

    #[test]
    fn a_file_replaced_after_a_kill_between_the_heads_is_left_alone_by_every_command() {
        for kind in 0..3 {
            let scene = Scene::sealed();
            scene.append(scene.nested_ops(), ID).unwrap();
            let before = scene.bytes();
            killed_with(
                &scene,
                "append-after-nested-head",
                ID2,
                scene.more_nested_ops(),
            );
            let journal_before = fs::read(scene.journal()).unwrap();
            let other = stranger_bytes(&scene, kind, &before);
            swap_live(&scene, &other);
            let label = format!("вид {kind}");
            let body = json!({ "gameRoot": scene.game, "archive": UPDATE });
            let file = scene.dir.path().join("recover.json");
            fs::write(&file, body.to_string()).unwrap();
            let error =
                recover_rpf_append(&options_for(&file, &[]), &Progress::silent()).unwrap_err();
            assert_eq!(error.code, "ForeignChange", "{label}");
            let error = scene
                .append(
                    scene.more_nested_ops(),
                    "rpf-20261104-120002-cccccccccccccccccc",
                )
                .unwrap_err();
            assert_eq!(error.code, "ForeignChange", "{label}");
            let error = scene.restore(ID2).unwrap_err();
            assert_eq!(error.code, "ForeignChange", "{label}");
            assert!(scene.bytes() == other, "{label}: чужой файл изменён");
            assert!(
                fs::read(scene.journal()).unwrap() == journal_before,
                "{label}: журнал тронут"
            );
        }
    }

    #[test]
    fn the_answer_of_a_nested_install_carries_the_new_counters_as_numbers() {
        let scene = Scene::sealed();
        let answer = scene.append(scene.nested_ops(), ID).unwrap();
        for key in [
            "nestedMoved",
            "nestedInReserve",
            "nestedCreated",
            "deadBytes",
            "bytesMoved",
        ] {
            assert!(answer[key].is_u64(), "{key}");
        }
        // на корневой правке без вложенных счётчики нули
        let plain = Scene::sealed();
        let answer = plain.append(plain.ops(), ID).unwrap();
        assert_eq!(answer["nestedMoved"], 0);
        assert_eq!(answer["nestedInReserve"], 0);
        assert_eq!(answer["nestedCreated"], 0);
    }

    // ----- сводный рецепт, «Починить», уплотнение (этап 2, части 5 и 6) -----

    mod compaction;
    mod creates;
    mod hold;
    mod keep_key;
    mod layers;
    mod linked;
    mod newdlc;
    mod recipes;
    mod registry;
    mod repair;
    mod second_link;
    mod settle;
    mod switch_key;
    mod seal_link;
}
