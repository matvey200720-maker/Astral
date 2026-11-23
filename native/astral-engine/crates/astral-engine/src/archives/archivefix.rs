//! Доводчик ArchiveFix: внешняя программа шифрует оглавление готового архива
//! шифром NG, а движок запускает её и проверяет результат.
//!
//! Программа запускается только если её SHA-256 равна закреплённой. Коду
//! выхода веры нет (в конце программа ждёт нажатия клавиши и без консоли
//! падает уже после записи файла): решает повторное чтение заголовка.

#[cfg(windows)]
use std::os::windows::{fs::OpenOptionsExt, process::CommandExt};
use std::{
    collections::HashMap,
    env,
    fs::{File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex, OnceLock, PoisonError,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime},
};

use sha2::{Digest, Sha256};

use rage_rpf::{
    tally::{self, Phase},
    toc::{read_toc, Encryption, Toc},
    ByteSource, FileSource, Finalizer, Handled, KeySet, Layout, RpfError, TrialRun,
};

use super::{log, points::local_app_data, sha256_file};
use crate::{
    error::{EngineError, Result as EngineResult},
    paths,
};

type RpfResult<T> = rage_rpf::Result<T>;

// ---------------------------------------------------------------------------
// Один запуск программы за раз на процесс
// ---------------------------------------------------------------------------

/// Замок запусков ArchiveFix. Программа не терпит параллельных запусков: ключи она
/// читает из своей папки и открывает их так, что второй экземпляр рядом получает
/// «Error loading crypto keys: IOException (файл занят)», выходит с кодом 0 и не
/// трогает архив — оглавление остаётся незашифрованным, «ArchiveFix did not
/// encrypt the archive header» (опыт 16.11.2026: два-шесть запусков из одной папки
/// — выигрывает один, у остальных заголовок открыт; у каждого своя папка с копией
/// программы — все удались). Резидентный движок ведёт несколько сборок в своих
/// потоках, поэтому внутри процесса запуски идут по очереди; запись тел и всё
/// остальное в сборках идёт параллельно, ждёт только шаг ArchiveFix. Родная
/// доводка (`ASTRAL_ENGINE_NG=native`) программы не запускает и замка не берёт.
///
/// Папка программы общая у всех процессов, поэтому между процессами (два движка,
/// движок и помощник) тот же отказ возможен; замок между процессами — режим
/// `ASTRAL_ENGINE_ARCHIVEFIX_LOCK=system` (см. `LockMode`), по умолчанию он выключен.
///
/// Ожидание в очереди не бесконечное и отменяемое: пока замок занят чужим запуском,
/// ждущий раз в `QUEUE_POLL` спрашивает отмену запроса и через `QUEUE_PATIENCE`
/// отказывает (в резиденте запрос, стоящий за чужим запуском, иначе не отменить).
struct Gate {
    busy: Mutex<bool>,
    freed: Condvar,
}

static GATE: Gate = Gate {
    busy: Mutex::new(false),
    freed: Condvar::new(),
};

/// Выключатель замка запусков (только для стенда и сверки), читается при каждом
/// запуске (в резиденте — из окружения, с которым процесс стартовал):
///
/// * не задан и любое значение, кроме двух ниже — замок внутри процесса, как и был;
/// * `0` — замка нет: запуски идут разом;
/// * `system` — замок внутри процесса и поверх него замок между процессами: файл
///   блокировки в папке временных файлов (по одному на папку программы), открытый
///   без общего доступа; держится, пока идёт запуск, и снимается системой, если
///   процесс умер.
pub const LOCK_ENV: &str = "ASTRAL_ENGINE_ARCHIVEFIX_LOCK";

/// Режим замка запусков ArchiveFix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LockMode {
    Off,
    Process,
    System,
}

fn lock_mode() -> LockMode {
    lock_mode_from(env::var(LOCK_ENV).ok().as_deref())
}

fn lock_mode_from(value: Option<&str>) -> LockMode {
    match value.map(str::trim) {
        Some("0") => LockMode::Off,
        Some(word) if word.eq_ignore_ascii_case("system") => LockMode::System,
        _ => LockMode::Process,
    }
}

/// Опрос отмены в очереди замка.
const QUEUE_POLL: Duration = Duration::from_millis(100);

/// Дольше этого в очереди замка не ждут (пятнадцать минут): запуск держит замок
/// не дольше `ArchiveFix::PATIENCE`, а проба вместе с записью тел идёт на порядок
/// короче; ждущий дольше — застрял за чужой работой, и запрос лучше отказать
/// понятным текстом, чем оставить висеть.
const QUEUE_PATIENCE: Duration = Duration::from_secs(900);

/// Очередь занята, пока жива охрана. Её можно передать другому потоку: проба
/// ArchiveFix живёт в потоке-ждуне. Без замка (`ASTRAL_ENGINE_ARCHIVEFIX_LOCK=0`)
/// охрана пустая.
pub(crate) struct Turn {
    gate: Option<&'static Gate>,
    /// Замок между процессами (режим `system`): снимается раньше очереди процесса.
    system: Option<SystemLock>,
}

impl Turn {
    /// Ждёт своей очереди; ожидание идёт в счётчик запроса отдельной фазой.
    /// Занятый замок ждут не дольше `QUEUE_PATIENCE`, отмена запроса (`activity`)
    /// опрашивается раз в `QUEUE_POLL`: отмена даёт `Cancelled`, срок —
    /// `ArchiveFix queue timed out: <имя>`. Свободный замок берётся сразу,
    /// отмена на этом пути не спрашивается. `program` — путь программы: по её папке
    /// выбирается файл замка между процессами.
    pub(crate) fn take(name: &str, program: &Path) -> RpfResult<Turn> {
        let mode = lock_mode();
        if mode == LockMode::Off {
            return Ok(Turn {
                gate: None,
                system: None,
            });
        }
        let begun = Instant::now();
        let mut turn = GATE.enter(
            name,
            (QUEUE_PATIENCE, QUEUE_POLL),
            &mut rage_rpf::activity::check,
        )?;
        if mode == LockMode::System {
            turn.system = Some(SystemLock::take_at(
                &SystemLock::path_for(program),
                name,
                (QUEUE_PATIENCE.saturating_sub(begun.elapsed()), QUEUE_POLL),
                &mut rage_rpf::activity::check,
            )?);
        }
        Ok(turn)
    }
}

impl Gate {
    /// Берёт очередь; `wait` — срок и шаг опроса отмены, `cancelled` — сам опрос.
    fn enter(
        &'static self,
        name: &str,
        wait: (Duration, Duration),
        cancelled: &mut dyn FnMut() -> RpfResult<()>,
    ) -> RpfResult<Turn> {
        let (patience, poll) = wait;
        let _wait = tally::span(Phase::GateWait);
        let begun = Instant::now();
        let mut busy = self.busy.lock().unwrap_or_else(PoisonError::into_inner);
        loop {
            if !*busy {
                *busy = true;
                return Ok(Turn {
                    gate: Some(self),
                    system: None,
                });
            }
            let (guard, _) = self
                .freed
                .wait_timeout(busy, poll)
                .unwrap_or_else(PoisonError::into_inner);
            busy = guard;
            if !*busy {
                continue;
            }
            // опрос отмены идёт без замка: он может зайти в код запроса
            drop(busy);
            cancelled()?;
            ensure(begun.elapsed() < patience, || {
                RpfError::state(format!("ArchiveFix queue timed out: {name}"))
            })?;
            busy = self.busy.lock().unwrap_or_else(PoisonError::into_inner);
        }
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        // сначала замок между процессами, потом очередь процесса
        self.system.take();
        if let Some(gate) = self.gate {
            *gate.busy.lock().unwrap_or_else(PoisonError::into_inner) = false;
            gate.freed.notify_one();
        }
    }
}

/// Замок между процессами: файл в папке временных файлов, открытый на запись без
/// общего доступа. Пока он открыт, такой же файл у другого процесса не откроется
/// (отказ «файл занят»); процесс умер — система закрыла файл, замок снят. Файл один
/// на папку программы (ключи ArchiveFix лежат в ней и общие у всех запусков из неё).
/// Вне Windows замка между процессами нет.
struct SystemLock {
    _file: Option<File>,
}

impl SystemLock {
    /// Файл замка для программы: имя по SHA-256 её папки без учёта регистра.
    fn path_for(program: &Path) -> PathBuf {
        let folder = program
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .to_string_lossy()
            .to_lowercase()
            .replace('/', "\\");
        let digest = Sha256::digest(folder.as_bytes());
        env::temp_dir().join(format!(
            "astral-archivefix-{}.lock",
            &super::hex_lower(&digest)[..16]
        ))
    }

    /// Берёт замок. `wait` — срок и шаг опроса, `cancelled` — опрос отмены; не
    /// дождались — `ArchiveFix queue timed out: <имя>`, отменили — `Cancelled`.
    #[cfg(windows)]
    fn take_at(
        path: &Path,
        name: &str,
        wait: (Duration, Duration),
        cancelled: &mut dyn FnMut() -> RpfResult<()>,
    ) -> RpfResult<SystemLock> {
        const SHARING_VIOLATION: i32 = 32;
        let (patience, poll) = wait;
        let _wait = tally::span(Phase::GateWait);
        let begun = Instant::now();
        loop {
            match OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(false)
                .share_mode(0)
                .open(path)
            {
                Ok(file) => return Ok(SystemLock { _file: Some(file) }),
                Err(error) if error.raw_os_error() == Some(SHARING_VIOLATION) => {
                    cancelled()?;
                    ensure(begun.elapsed() < patience, || {
                        RpfError::state(format!("ArchiveFix queue timed out: {name}"))
                    })?;
                    thread::sleep(poll);
                }
                Err(error) => {
                    return Err(RpfError::state(format!(
                        "ArchiveFix lock file {}: {error}",
                        path.display()
                    )))
                }
            }
        }
    }

    #[cfg(not(windows))]
    fn take_at(
        _path: &Path,
        _name: &str,
        _wait: (Duration, Duration),
        _cancelled: &mut dyn FnMut() -> RpfResult<()>,
    ) -> RpfResult<SystemLock> {
        Ok(SystemLock { _file: None })
    }
}

/// Способ открыть программу: путь, закреплённая сумма и срок, набор ключей.
type Opener = fn(&str, (&str, Duration), Arc<KeySet>) -> EngineResult<ArchiveFix>;

/// Найденная и сверенная программа вместе с набором ключей.
pub struct ArchiveFix {
    patience: Duration,
    executable: PathBuf,
    keys: Arc<KeySet>,
}

/// Закреплённая SHA-256 программы (строчные).
pub const PINNED_SHA256: &str = "83468b4f222ae516fa288f4cc3701950ef6b6a6af23f15dc676b915773941575";

impl Finalizer for ArchiveFix {
    /// Запускает программу на готовом файле и проверяет заголовок. Файл при
    /// отказе не восстанавливается: служебную папку убирает вызывающий.
    fn finalize(&self, path: &Path, name: &str) -> Result<(), RpfError> {
        self.finalize_journaled(&mut |line| log(line), name, path)
    }

    /// Проба идёт тем же запуском программы и той же проверкой заголовка, но молча
    /// (в журнал команды не попадает) и без ожидания: вызывающий пишет тела, пока
    /// программа работает. Программа решает судьбу оглавления по имени, размеру и
    /// самому оглавлению, а не по телам.
    fn begin_trial(&self, path: &Path, name: &str) -> Result<Option<Box<dyn TrialRun>>, RpfError> {
        ensure(
            matches!(path.file_name(), Some(file) if file.eq_ignore_ascii_case(name)),
            || RpfError::format(format!("ArchiveFix filename mismatch: expected {name}.")),
        )?;
        let launch = Launch {
            program: &self.executable,
            target: path,
            patience: self.patience,
        };
        // очередь занята, пока программа работает: до `finish` или до отказа
        let turn = Turn::take(name, &self.executable)?;
        Ok(Some(Box::new(FixTrial {
            running: launch.start()?,
            keys: Arc::clone(&self.keys),
            name: name.to_owned(),
            path: path.to_path_buf(),
            _turn: turn,
        })))
    }

    /// Программа не меняет файл с меткой не «открыто» (сверено опытами, см. записку
    /// об этапе 2), поэтому привезённый архив с верным заголовком кладётся как есть.
    fn leaves_closed_alone(&self) -> bool {
        true
    }
}

/// Идущая пробная доводка: программа работает, пока вызывающий пишет тела.
struct FixTrial {
    running: Running,
    keys: Arc<KeySet>,
    name: String,
    path: PathBuf,
    /// Очередь запусков держится до конца пробы (поле последнее: освобождается
    /// после того, как брошенный запуск снят).
    _turn: Turn,
}

impl TrialRun for FixTrial {
    fn finish(self: Box<Self>) -> Result<(), RpfError> {
        let FixTrial {
            running,
            keys,
            name,
            path,
            _turn,
        } = *self;
        running.wait()?;
        verify_header(&keys, &name, &path)
    }
}

impl ArchiveFix {
    /// Дольше этого программу не ждут (десять минут).
    const PATIENCE: Duration = Duration::from_secs(600);

    /// Сверяет программу по указанному пути: файл `.exe`, имя, SHA-256. С
    /// `ASTRAL_ENGINE_ARCHIVEFIX_PIN=1` отпечаток считается один раз за жизнь
    /// процесса (см. `open_pinned`).
    pub fn open(path: &str, keys: Arc<KeySet>) -> Result<Self, EngineError> {
        let pin = (PINNED_SHA256, Self::PATIENCE);
        if pin_enabled() {
            Self::open_pinned(path, pin, keys)
        } else {
            Self::open_with(path, pin, keys)
        }
    }

    fn open_with(
        path: &str,
        pin: (&str, Duration),
        keys: Arc<KeySet>,
    ) -> Result<Self, EngineError> {
        let (pinned, patience) = pin;
        let executable = named_executable(path)?;
        // Сумма сверяется один раз, здесь: подмена файла после этого не замечается.
        let sum = sha256_file(&executable)?;
        ensure(sum.eq_ignore_ascii_case(pinned), || {
            EngineError::invalid_data("ArchiveFix executable checksum mismatch.")
        })?;
        Ok(Self {
            patience,
            executable,
            keys,
        })
    }

    /// То же, но отпечаток берётся из памяти процесса: полный перехеш только у
    /// первого вызова и когда файл по пути уже не тот. Пока запись держится,
    /// файл открыт без права записи и удаления для всех остальных (общий доступ
    /// только на чтение), поэтому подмена невозможна, пока движок жив: это строже,
    /// чем сверка один раз за команду. Если закрепить файл нельзя (кто-то держит
    /// его на запись), работает прежний путь с перехешем.
    fn open_pinned(
        path: &str,
        pin: (&str, Duration),
        keys: Arc<KeySet>,
    ) -> Result<Self, EngineError> {
        let (pinned, patience) = pin;
        let executable = named_executable(path)?;
        let mut table = pins();
        if let Some(held) = table.get(&executable) {
            if held.sha256.eq_ignore_ascii_case(pinned) && held.is_still_at(&executable) {
                COUNTS.reused.fetch_add(1, Ordering::Relaxed);
                return Ok(Self {
                    patience,
                    executable,
                    keys,
                });
            }
        }
        table.remove(&executable);
        let Ok(held) = Held::grab(&executable) else {
            drop(table);
            return Self::open_with(path, pin, keys);
        };
        ensure(held.sha256.eq_ignore_ascii_case(pinned), || {
            EngineError::invalid_data("ArchiveFix executable checksum mismatch.")
        })?;
        table.insert(executable.clone(), held);
        Ok(Self {
            patience,
            executable,
            keys,
        })
    }

    /// Находит программу: параметр, переменная окружения, запасное место.
    pub fn locate(option: Option<&str>, keys: Arc<KeySet>) -> Result<Self, EngineError> {
        let pin = (PINNED_SHA256, Self::PATIENCE);
        let open = if pin_enabled() {
            Self::open_pinned
        } else {
            Self::open_with
        };
        Self::locate_using(
            open,
            keys,
            pin,
            env::var(PATH_ENV).ok(),
            option,
            &fallback_path(),
        )
    }

    #[cfg(test)]
    fn locate_with(
        keys: Arc<KeySet>,
        pin: (&str, Duration),
        from_env: Option<String>,
        option: Option<&str>,
        fallback: &Path,
    ) -> EngineResult<Self> {
        Self::locate_using(Self::open_with, keys, pin, from_env, option, fallback)
    }

    /// Поиск по правилам `locate`; программа открывается переданным способом.
    fn locate_using(
        open: Opener,
        keys: Arc<KeySet>,
        pin: (&str, Duration),
        from_env: Option<String>,
        option: Option<&str>,
        fallback: &Path,
    ) -> EngineResult<Self> {
        let path = chosen_path(from_env, option)
            .or_else(|| {
                fallback
                    .is_file()
                    .then(|| fallback.to_string_lossy().into_owned())
            })
            .ok_or_else(|| EngineError::invalid_operation("Verified ArchiveFix is required."))?;
        open(&path, pin, keys)
    }

    fn finalize_journaled(
        &self,
        journal: &mut dyn FnMut(String),
        name: &str,
        path: &Path,
    ) -> Result<(), RpfError> {
        ensure(
            matches!(path.file_name(), Some(file) if file.eq_ignore_ascii_case(name)),
            || RpfError::format(format!("ArchiveFix filename mismatch: expected {name}.")),
        )?;
        // запуски программы идут по очереди; тела других сборок пишутся рядом
        let _turn = Turn::take(name, &self.executable)?;
        journal(format!("[ArchiveFix] Запуск исправления хешей: {name}"));
        let launch = Launch {
            program: &self.executable,
            target: path,
            patience: self.patience,
        };
        let took = launch.run()?;
        journal(format!(
            "[ArchiveFix] Завершён за {:.1} с",
            took.as_secs_f64()
        ));
        verify_header(&self.keys, name, path)?;
        journal(String::from(
            "[ArchiveFinalize] Заголовок RPF зашифрован и повторно прочитан успешно.",
        ));
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Доводка своим кодом
// ---------------------------------------------------------------------------

/// Выключатель доводчика (по умолчанию выключен): `native` — оглавление
/// шифруется нашим кодом (`rage_rpf::seal`), без запуска ArchiveFix; любое другое
/// значение или его отсутствие — ArchiveFix, как раньше.
pub const NG_ENV: &str = "ASTRAL_ENGINE_NG";

/// Включена ли доводка своим кодом.
pub fn native_requested() -> bool {
    matches!(env::var(NG_ENV), Ok(text) if text.trim().eq_ignore_ascii_case("native"))
}

/// Доводчик без внешней программы: то же, что делает ArchiveFix, нашим кодом.
/// Набор ключей сверяется по SHA-256 при первом шифровании; не сошёлся —
/// отказ, файл не тронут.
pub struct NativeFixer {
    keys: Arc<KeySet>,
}

impl NativeFixer {
    pub fn new(keys: Arc<KeySet>) -> Self {
        NativeFixer { keys }
    }

    fn finalize_journaled(
        &self,
        journal: &mut dyn FnMut(String),
        name: &str,
        path: &Path,
    ) -> Result<(), RpfError> {
        ensure(
            matches!(path.file_name(), Some(file) if file.eq_ignore_ascii_case(name)),
            || RpfError::format(format!("ArchiveFix filename mismatch: expected {name}.")),
        )?;
        let took = Instant::now();
        journal(format!("[NgSeal] Доводка оглавления своим кодом: {name}"));
        // файл с двумя именами — отказ `Linked` до записи (сборка Astral создаёт файл заново, так что на живых файлах это страховка)
        let plan = rage_rpf::seal::seal_file_with(path, name, &self.keys, &super::append::EngineHost).map_err(|error| match error {
            rage_rpf::append::AppendError::Other(inner) => inner,
            other => RpfError::state(other.to_string()),
        })?;
        let moved: u64 = plan
            .iter()
            .flat_map(|plan| &plan.moves)
            .map(|m| m.len)
            .sum();
        journal(format!(
            "[NgSeal] Завершено за {:.3} с, перенесено тел: {} ({moved} Б)",
            took.elapsed().as_secs_f64(),
            plan.as_ref().map_or(0, |plan| plan.moves.len())
        ));
        verify_header(&self.keys, name, path)?;
        journal(String::from(
            "[ArchiveFinalize] Заголовок RPF зашифрован и повторно прочитан успешно.",
        ));
        Ok(())
    }
}

impl Finalizer for NativeFixer {
    fn finalize(&self, path: &Path, name: &str) -> Result<(), RpfError> {
        self.finalize_journaled(&mut |line| log(line), name, path)
    }

    /// Программы нет, поэтому и суммы её нет.
    fn executable_sha256(&self) -> Option<&str> {
        Some("")
    }

    /// Голова известна до записи тел: пробный запуск не нужен.
    fn predict_head(&self, layout: &Layout<'_>, name: &str) -> Result<Option<Vec<u8>>, RpfError> {
        layout.sealed_head(name, &self.keys).map(Some)
    }

    /// Оглавление шифруется в памяти: вложенный архив можно писать сразу во внешний.
    fn memory_keys(&self) -> Option<&KeySet> {
        Some(&self.keys)
    }

    /// Вложенный архив доведён без файла: в журнал идут те же строки, что при
    /// доводке файла.
    fn note_handled(&self, name: &str, how: Handled) {
        log(format!("[NgSeal] Доводка оглавления своим кодом: {name}"));
        if let Handled::Sealed { took, moves, moved } = how {
            log(format!(
                "[NgSeal] Завершено за {:.3} с, перенесено тел: {moves} ({moved} Б)",
                took.as_secs_f64(),
            ));
        }
        log(String::from(
            "[ArchiveFinalize] Заголовок RPF зашифрован и повторно прочитан успешно.",
        ));
    }
}

/// Выбранный доводчик: ArchiveFix или родной.
pub enum NgFinalizer {
    ArchiveFix(ArchiveFix),
    Native(NativeFixer),
}

impl NgFinalizer {
    /// Выбирает по `ASTRAL_ENGINE_NG`. С `native` программу не ищут.
    pub fn locate(option: Option<&str>, keys: Arc<KeySet>) -> Result<Self, EngineError> {
        if native_requested() {
            return Ok(NgFinalizer::Native(NativeFixer::new(keys)));
        }
        ArchiveFix::locate(option, keys).map(NgFinalizer::ArchiveFix)
    }

    /// Родной ли это доводчик.
    pub fn is_native(&self) -> bool {
        matches!(self, NgFinalizer::Native(_))
    }

    fn inner(&self) -> &dyn Finalizer {
        match self {
            NgFinalizer::ArchiveFix(fix) => fix,
            NgFinalizer::Native(native) => native,
        }
    }
}

impl Finalizer for NgFinalizer {
    fn finalize(&self, path: &Path, name: &str) -> Result<(), RpfError> {
        self.inner().finalize(path, name)
    }

    fn begin_trial(&self, path: &Path, name: &str) -> Result<Option<Box<dyn TrialRun>>, RpfError> {
        self.inner().begin_trial(path, name)
    }

    fn executable_sha256(&self) -> Option<&str> {
        self.inner().executable_sha256()
    }

    fn predict_head(&self, layout: &Layout<'_>, name: &str) -> Result<Option<Vec<u8>>, RpfError> {
        self.inner().predict_head(layout, name)
    }

    fn memory_keys(&self) -> Option<&KeySet> {
        self.inner().memory_keys()
    }

    fn leaves_closed_alone(&self) -> bool {
        self.inner().leaves_closed_alone()
    }

    fn note_handled(&self, name: &str, how: Handled) {
        self.inner().note_handled(name, how);
    }
}

fn ensure<E>(holds: bool, otherwise: impl FnOnce() -> E) -> Result<(), E> {
    if holds {
        Ok(())
    } else {
        Err(otherwise())
    }
}

/// Файл `.exe` по пути с нужным именем.
fn named_executable(path: &str) -> Result<PathBuf, EngineError> {
    let executable = paths::existing_file(path, &[".exe"])?;
    let named = executable.file_name();
    ensure(
        matches!(named, Some(file) if file.eq_ignore_ascii_case(EXECUTABLE_NAME)),
        || EngineError::invalid_data("ArchiveFix executable name is invalid."),
    )?;
    Ok(executable)
}

// ---------------------------------------------------------------------------
// Отпечаток программы: один раз за жизнь процесса
// ---------------------------------------------------------------------------

/// Выключатель закрепления программы (по умолчанию выключен): `1` — отпечаток
/// считается один раз за жизнь процесса, а сам файл держится открытым без
/// права записи и удаления для остальных.
pub const PIN_ENV: &str = "ASTRAL_ENGINE_ARCHIVEFIX_PIN";

fn pin_enabled() -> bool {
    matches!(env::var(PIN_ENV), Ok(text) if text.trim() == "1")
}

/// Сколько раз закреплённая программа хешировалась целиком и сколько раз отпечаток
/// взяли из памяти процесса (для проверок и замеров). Обычный путь (без
/// закрепления) не считается.
struct Counts {
    hashed: AtomicU64,
    reused: AtomicU64,
}

static COUNTS: Counts = Counts {
    hashed: AtomicU64::new(0),
    reused: AtomicU64::new(0),
};

/// Полных хешей программы с начала жизни процесса: у закрепления — один на
/// программу, пока файл не менялся.
pub fn fingerprints_computed() -> u64 {
    COUNTS.hashed.load(Ordering::Relaxed)
}

/// Сколько раз отпечаток взят из памяти без чтения файла.
pub fn fingerprints_reused() -> u64 {
    COUNTS.reused.load(Ordering::Relaxed)
}

/// Что выдаёт система о файле: по этим признакам узнают тот же самый файл.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity {
    size: u64,
    modified: Option<SystemTime>,
    /// Том и номер файла на нём.
    place: Option<(u64, u64)>,
}

impl Identity {
    fn of(file: &File) -> io::Result<Identity> {
        let facts = file.metadata()?;
        Ok(Identity {
            size: facts.len(),
            modified: facts.modified().ok(),
            place: native::place_of(file),
        })
    }
}

/// Закреплённая программа: отпечаток и открытый файл, который мешает его
/// подменить.
struct Held {
    sha256: String,
    identity: Identity,
    _hold: File,
}

impl Held {
    /// Открывает файл без общего доступа на запись и удаление, хеширует его по
    /// этому же дескриптору и запоминает признаки файла.
    fn grab(executable: &Path) -> io::Result<Held> {
        let mut file = native::open_held(executable)?;
        COUNTS.hashed.fetch_add(1, Ordering::Relaxed);
        let mut digest = Sha256::new();
        let mut chunk = vec![0u8; 1 << 20];
        loop {
            let got = file.read(&mut chunk)?;
            if got == 0 {
                break;
            }
            digest.update(&chunk[..got]);
        }
        Ok(Held {
            sha256: super::hex_lower(&digest.finalize()),
            identity: Identity::of(&file)?,
            _hold: file,
        })
    }

    /// По пути лежит тот же файл, что держится открытым.
    fn is_still_at(&self, executable: &Path) -> bool {
        File::open(executable)
            .and_then(|file| Identity::of(&file))
            .is_ok_and(|now| now == self.identity)
    }
}

fn pins() -> std::sync::MutexGuard<'static, HashMap<PathBuf, Held>> {
    static TABLE: OnceLock<Mutex<HashMap<PathBuf, Held>>> = OnceLock::new();
    TABLE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

/// Снимает закрепление всех программ: файлы перестают держаться открытыми
/// (например, перед обновлением набора ArchiveFix на диске).
pub fn release_pins() {
    pins().clear();
}

/// Переменная окружения с путём к программе (то же имя было у прежнего хоста).
pub const PATH_ENV: &str = "MODOVIK_ARCHIVE_FIX_PATH";

/// Путь, который выбирают параметр или переменная окружения. Непустой параметр
/// побеждает переменную; пустой (или из пробелов) параметр и пустая переменная
/// считаются отсутствующими.
fn chosen_path(from_env: Option<String>, option: Option<&str>) -> Option<String> {
    option
        .map(str::to_owned)
        .into_iter()
        .chain(from_env)
        .find(|path| !is_blank(path))
}

fn is_blank(text: &str) -> bool {
    text.chars().all(char::is_whitespace)
}

/// Имя исполняемого файла (сравнивается без учёта регистра).
pub const EXECUTABLE_NAME: &str = "ArchiveFix.exe";

fn fallback_path() -> PathBuf {
    let mut place = local_app_data();
    place.extend(["Astral", "tools", "ArchiveFix", EXECUTABLE_NAME]);
    place
}

/// Один запуск программы на целевом файле: тихо, без окна, ниже обычного
/// приоритета, текущий каталог — каталог программы. Код выхода не смотрится.
struct Launch<'a> {
    program: &'a Path,
    target: &'a Path,
    patience: Duration,
}

impl Launch<'_> {
    const POLL_EVERY: Duration = Duration::from_millis(40);
    /// Нажатие клавиши, которого программа ждёт в конце.
    const KEYSTROKE: &'static [u8] = b"\r\n";

    fn spawn(&self) -> RpfResult<Child> {
        let piped = Stdio::piped;
        let mut command = Command::new(self.program);
        command
            .stdin(piped())
            .stdout(piped())
            .stderr(piped())
            .current_dir(self.program.parent().unwrap_or(Path::new(".")))
            .arg(self.target);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
        match command.spawn() {
            Ok(child) => Ok(child),
            Err(error) => Err(RpfError::state(format!(
                "ArchiveFix process did not start: {error}"
            ))),
        }
    }

    /// Ждёт конца программы; если за `patience` она не закончилась, убивает её
    /// и возвращает `false`. Ожидание — вызов системы на дескрипторе процесса:
    /// возврат в тот же миг, когда программа закончилась, без сна-опроса.
    #[cfg(test)]
    fn wait_or_kill(&self, child: &mut Child) -> io::Result<bool> {
        wait_or_kill(child, self.patience)
    }

    /// Прежнее ожидание опросом раз в 40 мс (`ASTRAL_ENGINE_ARCHIVEFIX_POLL=1`).
    #[cfg(test)]
    fn poll_or_kill(&self, child: &mut Child) -> io::Result<bool> {
        poll_or_kill(child, self.patience)
    }

    /// Возвращает, сколько прошло от начала запуска до конца работы программы.
    fn run(&self) -> RpfResult<Duration> {
        self.start()?.wait()
    }

    /// Запускает программу и не ждёт её конца.
    fn start(&self) -> RpfResult<Running> {
        let started = Instant::now();
        silence_child_crash_dialogs();
        let mut child = self.spawn()?;

        // Программа читает «нажатие» и затем видит конец ввода.
        child.stdin.take().into_iter().for_each(|mut input| {
            let _ = input.write_all(Self::KEYSTROKE);
        });
        let readers: Vec<JoinHandle<()>> = child
            .stdout
            .take()
            .map(drain)
            .into_iter()
            .chain(child.stderr.take().map(drain))
            .collect();

        Ok(Running {
            child,
            readers,
            started,
            patience: self.patience,
            file: self.target.file_name().unwrap_or_default().to_owned(),
        })
    }
}

/// Идущий запуск: процесс программы и читатели его вывода.
struct Running {
    child: Child,
    readers: Vec<JoinHandle<()>>,
    started: Instant,
    patience: Duration,
    /// Имя целевого файла для сообщения о сроке.
    file: std::ffi::OsString,
}

impl Running {
    /// Ждёт конца программы (не дольше `patience` от начала запуска) и возвращает,
    /// сколько прошло от начала запуска.
    fn wait(mut self) -> RpfResult<Duration> {
        let left = self.patience.saturating_sub(self.started.elapsed());
        let finished = wait_or_kill(&mut self.child, left)?;
        ensure(finished, || {
            RpfError::state(format!(
                "ArchiveFix timed out: {}",
                self.file.to_string_lossy()
            ))
        })?;
        std::mem::take(&mut self.readers)
            .into_iter()
            .for_each(|reader| {
                let _ = reader.join();
            });
        Ok(self.started.elapsed())
    }
}

impl Drop for Running {
    /// Брошенный запуск не оставляет процесса, который пишет в файл.
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            self.child.kill().ok();
            self.child.wait().ok();
        }
    }
}

/// Ждёт конца программы не дольше `patience`; не закончилась — убивает и
/// возвращает `false`. Ожидание — вызов системы на дескрипторе процесса.
fn wait_or_kill(child: &mut Child, patience: Duration) -> io::Result<bool> {
    if polling_forced() {
        return poll_or_kill(child, patience);
    }
    let begun = Instant::now();
    loop {
        native::wait_for_exit(child, patience.saturating_sub(begun.elapsed()));
        if child.try_wait()?.is_some() {
            return Ok(true);
        }
        if begun.elapsed() >= patience {
            child.kill().ok();
            child.wait().ok();
            return Ok(false);
        }
    }
}

/// Прежнее ожидание опросом раз в 40 мс.
fn poll_or_kill(child: &mut Child, patience: Duration) -> io::Result<bool> {
    let begun = Instant::now();
    while child.try_wait()?.is_none() {
        if begun.elapsed() > patience {
            child.kill().ok();
            child.wait().ok();
            return Ok(false);
        }
        thread::sleep(Launch::POLL_EVERY);
    }
    Ok(true)
}

/// Выключатель ожидания без опроса: `1` возвращает опрос раз в 40 мс.
pub const POLL_ENV: &str = "ASTRAL_ENGINE_ARCHIVEFIX_POLL";

fn polling_forced() -> bool {
    matches!(env::var(POLL_ENV), Ok(text) if text.trim() == "1")
}

/// Вывод программы читается до конца и выбрасывается, чтобы полная труба
/// её не остановила.
fn drain(mut stream: impl Read + Send + 'static) -> JoinHandle<()> {
    thread::spawn(move || {
        let _ = io::copy(&mut stream, &mut io::sink());
    })
}

/// Заголовок обязан читаться как зашифрованный NG, причём ключом, который
/// выбирается по имени и размеру файла.
fn verify_header(keys: &KeySet, name: &str, path: impl AsRef<Path>) -> Result<(), RpfError> {
    let source = FileSource::open(path.as_ref())?;
    match read_toc(&source, name, Some(keys))? {
        Toc {
            encryption: Encryption::Ng,
            ng_key_index: Some(found),
            ..
        } if found == keys.ng_key_index(name, source.len()) => Ok(()),
        _ => Err(RpfError::format(format!(
            "ArchiveFix did not encrypt the archive header: {name}"
        ))),
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

/// SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX.
#[cfg(windows)]
pub const CRASH_DIALOGS_OFF: u32 = 0x0001 | 0x0002 | 0x8000;

#[cfg(windows)]
static DIALOGS_SILENCED: OnceLock<()> = OnceLock::new();

/// При первом вызове в процессе добавляет к режиму ошибок биты
/// `CRASH_DIALOGS_OFF` (дети наследуют режим), дальше ничего не делает.
pub fn silence_child_crash_dialogs() {
    #[cfg(windows)]
    DIALOGS_SILENCED.get_or_init(|| mode::replace(mode::current() | CRASH_DIALOGS_OFF));
}

/// Режим ошибок процесса: единственное место с вызовами Win32.
#[cfg(windows)]
#[allow(unsafe_code)]
mod mode {
    extern "system" {
        fn GetErrorMode() -> u32;
        fn SetErrorMode(mode: u32) -> u32;
    }

    pub fn current() -> u32 {
        // SAFETY: вызов без указателей, только читает режим процесса.
        unsafe { GetErrorMode() }
    }

    pub fn replace(mode: u32) {
        // SAFETY: вызов без указателей; прежний режим не нужен.
        unsafe {
            SetErrorMode(mode);
        }
    }
}

/// Текущий режим ошибок процесса.
#[cfg(windows)]
pub use mode::current as error_mode;

/// Вызовы системы для ожидания процесса и признаков файла.
#[cfg(windows)]
#[allow(unsafe_code)]
mod native {
    use super::*;
    use std::os::windows::io::AsRawHandle;

    /// Дескриптор системы.
    type Handle = *mut core::ffi::c_void;

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
        fn WaitForSingleObject(handle: Handle, millis: u32) -> u32;
        fn GetFileInformationByHandle(file: Handle, info: *mut ByHandleInformation) -> i32;
    }

    /// FILE_SHARE_READ: остальным можно только читать.
    const SHARE_READ: u32 = 0x0000_0001;

    /// Ждёт конца процесса не дольше `within`; возврат — конец, срок или сбой
    /// ожидания, итог читает вызывающий.
    pub fn wait_for_exit(child: &Child, within: Duration) {
        // 0xFFFF_FFFF значит «бесконечно»: срок обрезается до него и ниже.
        let millis = within.as_millis().min(u128::from(u32::MAX - 1)) as u32;
        // SAFETY: дескриптор процесса принадлежит `child` и живёт, пока он занят.
        unsafe {
            WaitForSingleObject(child.as_raw_handle(), millis);
        }
    }

    /// Том и номер файла на нём.
    pub fn place_of(file: &File) -> Option<(u64, u64)> {
        let mut info = ByHandleInformation::default();
        // SAFETY: дескриптор файла жив, `info` — структура нужной формы.
        let done = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
        (done != 0).then(|| {
            (
                u64::from(info.volume_serial),
                u64::from(info.index_high) << 32 | u64::from(info.index_low),
            )
        })
    }

    /// Файл на чтение, остальным — только чтение (ни запись, ни удаление).
    pub fn open_held(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .read(true)
            .share_mode(SHARE_READ)
            .open(path)
    }
}

/// Без Windows ожидание — короткий сон, а признаки файла берутся у файловой системы.
#[cfg(not(windows))]
mod native {
    use super::*;

    pub fn wait_for_exit(_child: &Child, within: Duration) {
        thread::sleep(within.min(Launch::POLL_EVERY));
    }

    pub fn place_of(file: &File) -> Option<(u64, u64)> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            file.metadata().ok().map(|facts| (facts.dev(), facts.ino()))
        }
        #[cfg(not(unix))]
        {
            let _ = file;
            None
        }
    }

    pub fn open_held(path: &Path) -> io::Result<File> {
        OpenOptions::new().read(true).open(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::sha256_hex;
    use rage_rpf::{write_archive, Body, DirNode, FileNode, WriteContext};
    use std::fs::{self, File};
    use std::sync::OnceLock;
    use tempfile::{tempdir, TempDir};

    // ----- ключи и файлы, которых не бывает в игре -----

    const KEY_COUNT: usize = 101;
    const KEY_WORDS: usize = 17 * 4;

    /// Набор ключей: нулевые таблицы, в каждом ключе из `loud` последний раунд
    /// задаёт блок «запись каталога», поэтому любой блок им «расшифровывается» в каталог.
    fn keys_with(loud: impl Fn(usize) -> bool) -> KeySet {
        let mut ng_keys = vec![0u8; KEY_COUNT * KEY_WORDS * 4];
        for key in (0..KEY_COUNT).filter(|&key| loud(key)) {
            let at = (key * KEY_WORDS + 64 + 1) * 4;
            ng_keys[at..at + 4].copy_from_slice(&0x7FFF_FF00u32.to_le_bytes());
        }
        KeySet::from_parts(&[0; 32], &ng_keys, &vec![0u8; 17 * 4096 * 4], &[0; 256]).unwrap()
    }

    fn loud_keys() -> Arc<KeySet> {
        Arc::new(keys_with(|_| true))
    }

    fn quiet_keys() -> Arc<KeySet> {
        Arc::new(keys_with(|_| false))
    }

    /// Открытый (нешифрованный) архив из двух записей.
    fn open_archive_bytes() -> Vec<u8> {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.rpf");
        let mut file = File::create(&path).unwrap();
        let mut ctx = WriteContext {
            staging: dir.path(),
            keys: None,
            finalizer: None,
        };
        let tree = rage_rpf::fixtures::replacement_tree();
        write_archive(&tree, &mut file, &mut ctx, &mut |_| {}).unwrap();
        drop(file);
        fs::read(&path).unwrap()
    }

    /// Файл, который читается как зашифрованный NG при `loud_keys`: заголовок
    /// с меткой NG, одна запись, 16 байт имён и дополнение до `size`.
    fn sealed_bytes(size: usize) -> Vec<u8> {
        let mut bytes = vec![0u8; size];
        let header = [0x5250_4637u32, 1, 16, 0x0fef_ffff];
        for (word, value) in header.iter().enumerate() {
            bytes[word * 4..word * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    fn describe(error: &RpfError) -> String {
        let kind = match error {
            RpfError::Io(_) => "Io",
            RpfError::Format(_) => "Format",
            RpfError::Keys(_) => "Keys",
            RpfError::NotFound(_) => "NotFound",
            RpfError::Argument(_) => "Argument",
            RpfError::State(_) => "State",
            RpfError::Cancelled => "Cancelled",
        };
        format!("{kind}: {error}")
    }

    fn pinned(bytes: &[u8]) -> String {
        sha256_hex(bytes)
    }

    fn fake_program(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::create_dir_all(dir).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }

    fn failure_of(outcome: EngineResult<ArchiveFix>) -> EngineError {
        match outcome {
            Ok(_) => panic!("ожидался отказ"),
            Err(error) => error,
        }
    }

    const PATIENT: Duration = Duration::from_secs(60);

    // ----- константы и режим ошибок (Аф1-Аф3) -----

    #[test]
    fn the_constants_are_the_pinned_ones() {
        assert_eq!(EXECUTABLE_NAME, "ArchiveFix.exe");
        assert_eq!(PATH_ENV, "MODOVIK_ARCHIVE_FIX_PATH");
        assert_eq!(
            PINNED_SHA256,
            "83468b4f222ae516fa288f4cc3701950ef6b6a6af23f15dc676b915773941575"
        );
        assert_eq!(PINNED_SHA256.len(), 64);
        #[cfg(windows)]
        assert_eq!(CRASH_DIALOGS_OFF, 0x8003);
    }

    #[cfg(windows)]
    #[test]
    fn child_crash_dialogs_are_switched_off_once_and_stay_off() {
        silence_child_crash_dialogs();
        assert_eq!(error_mode() & CRASH_DIALOGS_OFF, CRASH_DIALOGS_OFF);
        silence_child_crash_dialogs();
        assert_eq!(error_mode() & CRASH_DIALOGS_OFF, CRASH_DIALOGS_OFF);
    }

    // ----- поиск и сверка (Аф4-Аф20) -----

    #[test]
    fn a_filled_option_shadows_the_variable_and_an_empty_one_does_not() {
        let env = || Some("from-env".to_owned());
        assert_eq!(chosen_path(env(), Some("opt")).as_deref(), Some("opt"));
        assert_eq!(chosen_path(env(), None).as_deref(), Some("from-env"));
        // Аф8-Аф9: пустая или пробельная опция считается отсутствующей, берётся переменная
        assert_eq!(chosen_path(env(), Some("")).as_deref(), Some("from-env"));
        assert_eq!(chosen_path(env(), Some("   ")).as_deref(), Some("from-env"));
        assert_eq!(chosen_path(None, Some("")), None);
        assert_eq!(chosen_path(Some(" ".to_owned()), Some("  ")), None);
        // Аф11: пустая переменная ничего не значит
        assert_eq!(chosen_path(Some("  ".to_owned()), None), None);
        assert_eq!(
            chosen_path(Some("  ".to_owned()), Some("opt")).as_deref(),
            Some("opt")
        );
        assert_eq!(chosen_path(None, None), None);
    }

    #[test]
    fn locate_follows_option_variable_and_the_fallback_place() {
        let dir = tempdir().unwrap();
        let bytes = b"NOT A REAL PROGRAM";
        let sum = pinned(bytes);
        let exe = fake_program(&dir.path().join("tool"), "ArchiveFix.exe", bytes);
        let exe_text = exe.to_string_lossy().into_owned();
        let none = dir.path().join("no-fallback.exe");
        let locate = |option: Option<&str>, env: Option<&str>, fallback: &Path| {
            ArchiveFix::locate_with(
                loud_keys(),
                (sum.as_str(), PATIENT),
                env.map(str::to_owned),
                option,
                fallback,
            )
        };

        // Аф5: ничего нет
        let error = failure_of(locate(None, None, &none));
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            (
                "InvalidOperationException",
                "Verified ArchiveFix is required."
            )
        );
        // Аф6-Аф7
        assert_eq!(
            locate(Some(&exe_text), None, &none)
                .ok()
                .unwrap()
                .executable,
            exe
        );
        assert_eq!(
            locate(None, Some(&exe_text), &none)
                .ok()
                .unwrap()
                .executable,
            exe
        );
        // Аф8-Аф9: пустая опция считается отсутствующей, берётся верная переменная
        for option in [Some(""), Some("   ")] {
            assert_eq!(
                locate(option, Some(exe_text.as_str()), &none)
                    .ok()
                    .unwrap()
                    .executable,
                exe
            );
        }
        // Аф11: пустое значение отбрасывается, запасного пути нет
        for (option, env) in [
            (Some(""), Some("  ")),
            (Some("   "), None),
            (None, Some("  ")),
        ] {
            let error = failure_of(locate(option, env, &none));
            assert_eq!(error.message, "Verified ArchiveFix is required.");
        }
        // Аф10: неверная опция побеждает переменную, запасной путь не пробуется
        #[cfg(windows)]
        {
            let missing = Some("C:\\no\\ArchiveFix.exe");
            let error = failure_of(locate(missing, Some(exe_text.as_str()), &exe));
            assert_eq!(
                (error.code.as_str(), error.message.as_str()),
                (
                    "FileNotFoundException",
                    "File was not found: C:\\no\\ArchiveFix.exe"
                )
            );
        }
        // Аф12: запасной путь, если ни опции, ни переменной
        assert_eq!(locate(None, None, &exe).ok().unwrap().executable, exe);
        // пустая опция без переменной тоже ведёт к запасному пути, а с переменной
        // берётся переменная (и запасной путь не пробуется)
        assert_eq!(locate(Some(""), None, &exe).ok().unwrap().executable, exe);
        let error = failure_of(locate(Some(""), Some("zzz"), &exe));
        assert_eq!(error.code, "FileNotFoundException");
    }

    #[test]
    fn the_fallback_place_is_inside_the_astral_tools_folder() {
        let place = fallback_path();
        let tail: Vec<_> = place
            .components()
            .rev()
            .take(4)
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect();
        assert_eq!(tail, ["ArchiveFix.exe", "ArchiveFix", "tools", "Astral"]);
    }

    #[test]
    fn open_checks_the_extension_the_name_and_the_checksum_in_that_order() {
        let dir = tempdir().unwrap();
        let bytes = b"FAKE";
        let sum = pinned(bytes);
        let open = |path: &Path| {
            ArchiveFix::open_with(&path.to_string_lossy(), (&sum, PATIENT), loud_keys())
        };

        // Аф4
        let exe = fake_program(&dir.path().join("a"), "ArchiveFix.exe", bytes);
        assert_eq!(open(&exe).ok().unwrap().executable, exe);
        // Аф20: сумма сравнивается без учёта регистра
        let upper = sum.to_uppercase();
        assert!(
            ArchiveFix::open_with(&exe.to_string_lossy(), (&upper, PATIENT), loud_keys()).is_ok()
        );
        // Аф14: «..» сворачиваются по тексту
        let roundabout = dir
            .path()
            .join("a")
            .join("..")
            .join("a")
            .join("ArchiveFix.exe");
        assert_eq!(open(&roundabout).ok().unwrap().executable, exe);
        // Аф15: каталог
        let error = failure_of(open(&dir.path().join("a")));
        assert_eq!(error.code, "FileNotFoundException");
        assert_eq!(
            error.message,
            format!("File was not found: {}", dir.path().join("a").display())
        );
        // Аф16: регистр имени не важен
        let shouting = fake_program(&dir.path().join("b"), "ARCHIVEFIX.EXE", bytes);
        assert!(open(&shouting).is_ok());
        // Аф17: расширение проверяется раньше имени
        let bak = fake_program(&dir.path().join("c"), "ArchiveFix.bak", bytes);
        let error = failure_of(open(&bak));
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("ArgumentException", "Unsupported file extension: .bak")
        );
        // Аф18: чужое имя
        let other = fake_program(&dir.path().join("d"), "Other.exe", bytes);
        let error = failure_of(open(&other));
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            (
                "InvalidDataException",
                "ArchiveFix executable name is invalid."
            )
        );
        // Аф19: одна лишняя
        let tampered = fake_program(&dir.path().join("e"), "ArchiveFix.exe", b"FAKE+");
        let error = failure_of(open(&tampered));
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            (
                "InvalidDataException",
                "ArchiveFix executable checksum mismatch."
            )
        );
        // настоящая закреплённая сумма подделке не по зубам
        let error = failure_of(ArchiveFix::open(&exe.to_string_lossy(), loud_keys()));
        assert_eq!(error.message, "ArchiveFix executable checksum mismatch.");
    }

    // ----- проверка заголовка (Аф24-Аф26, Аф31-Аф36) -----

    fn header_check(bytes: &[u8], name: &str, keys: &KeySet) -> RpfResult<()> {
        let dir = tempdir().unwrap();
        let path = dir.path().join(name);
        fs::write(&path, bytes).unwrap();
        verify_header(keys, name, &path)
    }

    #[test]
    fn only_a_header_readable_as_ng_with_the_key_of_the_name_and_size_passes() {
        let sealed = sealed_bytes(4096);
        // Аф31, Аф34: читается как NG тем же ключом по имени и размеру
        header_check(&sealed, "update.rpf", &keys_with(|_| true)).unwrap();

        // заголовок остался открытым - ничего не зашифровано
        let open = open_archive_bytes();
        let error = header_check(&open, "update.rpf", &keys_with(|_| true)).unwrap_err();
        assert_eq!(
            describe(&error),
            "Format: ArchiveFix did not encrypt the archive header: update.rpf"
        );

        // подошёл другой ключ, не тот, что выбирают имя и размер
        let expected = keys_with(|_| false).ng_key_index("update.rpf", 4096);
        let other = (expected + 1) % KEY_COUNT;
        let error =
            header_check(&sealed, "update.rpf", &keys_with(|key| key == other)).unwrap_err();
        assert_eq!(
            describe(&error),
            "Format: ArchiveFix did not encrypt the archive header: update.rpf"
        );
        // а нужный ключ - проходит
        header_check(&sealed, "update.rpf", &keys_with(|key| key == expected)).unwrap();

        // Аф33: ключи без нужных таблиц - расшифровка не даёт каталога
        let error = header_check(&sealed, "update.rpf", &quiet_keys()).unwrap_err();
        assert_eq!(
            describe(&error),
            "Format: RPF7 has no directory entries \u{2014} file is malformed or uses an unsupported format."
        );
        // Аф24, Аф26: мусор и обрезка - ошибки чтения заголовка как есть
        let error = header_check(&[0xDA; 4096], "update.rpf", &loud_keys()).unwrap_err();
        assert_eq!(
            describe(&error),
            "Format: update.rpf: The identifier DADADADA did not match the expected value of 0x52504637"
        );
        let error = header_check(&[1; 8], "update.rpf", &loud_keys()).unwrap_err();
        assert_eq!(
            describe(&error),
            "Format: update.rpf: the file is too short to be an RPF7 archive"
        );
        // Аф25: файла нет
        let dir = tempdir().unwrap();
        let error =
            verify_header(&loud_keys(), "ghost.rpf", dir.path().join("ghost.rpf")).unwrap_err();
        assert!(describe(&error).starts_with("Io: "));
        assert!(
            matches!(error, RpfError::Io(ref cause) if cause.kind() == io::ErrorKind::NotFound)
        );
    }

    // ----- заглушка: настоящий процесс (Аф21-Аф42) -----

    const STUB: &str = r#"
use std::io::{Read, Write};
use std::time::Duration;

extern "system" {
    fn GetErrorMode() -> u32;
    fn GetCurrentProcess() -> isize;
    fn GetPriorityClass(process: isize) -> u32;
    fn GetConsoleWindow() -> isize;
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut typed = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut typed);
    let mode = std::fs::read_to_string("mode.txt").unwrap_or_default();
    let target = args.get(1).cloned().unwrap_or_default();
    let (errors, priority, console) =
        unsafe { (GetErrorMode(), GetPriorityClass(GetCurrentProcess()), GetConsoleWindow()) };
    let report = format!(
        "argc={}\nargv={:?}\ncwd={}\nstdin={:?}\nerror_mode={:#x}\npriority={:#x}\nconsole_window_null={}\nprobe_env={:?}\n---\n",
        args.len(),
        args,
        std::env::current_dir().unwrap().display(),
        typed,
        errors,
        priority,
        console == 0,
        std::env::var("PROBE_MARK").ok(),
    );
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open("report.txt") {
        let _ = file.write_all(report.as_bytes());
    }
    match mode.trim() {
        "exit3" => {
            eprintln!("boom");
            std::process::exit(3)
        }
        "fail" => std::process::exit(0xE0434352u32 as i32),
        "hang" => {
            let mut beat = 0u64;
            loop {
                beat += 1;
                let _ = std::fs::write("beat.txt", beat.to_string());
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        "garbage" => {
            let _ = std::fs::write(&target, vec![0xDAu8; 4096]);
        }
        "delete" => {
            let _ = std::fs::remove_file(&target);
        }
        "shrink" => {
            if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&target) {
                let _ = file.set_len(8);
            }
        }
        "chatty" => {
            let block = vec![b'x'; 1 << 20];
            let (mut out, mut err) = (std::io::stdout(), std::io::stderr());
            for _ in 0..5 {
                let _ = out.write_all(&block);
                let _ = err.write_all(&block);
            }
        }
        "sealed" => {
            if let Ok(bytes) = std::fs::read("sealed.bin") {
                let _ = std::fs::write(&target, bytes);
            }
        }
        "nap" => {
            // отрезок работы (миллисекунды от начала эпохи): по ним видно, пересекались ли запуски
            let now = || {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|since| since.as_millis())
                    .unwrap_or(0)
            };
            let began = now();
            std::thread::sleep(Duration::from_millis(400));
            let line = format!("{began} {}\n", now());
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open("spans.txt") {
                let _ = file.write_all(line.as_bytes());
            }
        }
        _ => {}
    }
}
"#;

    /// Скомпилированная заглушка (один раз на процесс); `None`, если `rustc` не нашёлся.
    fn stub_bytes() -> Option<&'static [u8]> {
        static BYTES: OnceLock<Option<Vec<u8>>> = OnceLock::new();
        BYTES
            .get_or_init(|| {
                let dir = tempdir().ok()?;
                let source = dir.path().join("stub.rs");
                fs::write(&source, STUB).ok()?;
                let output = dir.path().join("stub.exe");
                let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
                let status = Command::new(rustc)
                    .args(["--edition", "2021", "-O", "-o"])
                    .arg(&output)
                    .arg(&source)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .ok()?;
                if !status.success() {
                    return None;
                }
                fs::read(&output).ok()
            })
            .as_deref()
    }

    /// Папка с заглушкой под именем `ArchiveFix.exe` и целевым файлом в другой папке.
    struct Lab {
        dir: TempDir,
        exe: PathBuf,
        target: PathBuf,
    }

    impl Lab {
        fn new(mode: &str) -> Option<Lab> {
            let Some(bytes) = stub_bytes() else {
                eprintln!("пропуск: rustc недоступен, заглушку ArchiveFix не собрать");
                return None;
            };
            let dir = tempdir().unwrap();
            let exe = fake_program(dir.path(), "ArchiveFix.exe", bytes);
            fs::write(dir.path().join("mode.txt"), mode).unwrap();
            let target = dir.path().join("с пробелом и ё").join("update.rpf");
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(&target, open_archive_bytes()).unwrap();
            Some(Lab { dir, exe, target })
        }

        fn fix(&self, keys: Arc<KeySet>, patience: Duration) -> ArchiveFix {
            let sum = pinned(stub_bytes().unwrap());
            ArchiveFix::open_with(&self.exe.to_string_lossy(), (&sum, patience), keys).unwrap()
        }

        fn report(&self) -> String {
            fs::read_to_string(self.dir.path().join("report.txt")).unwrap_or_default()
        }
    }

    fn finalize(fix: &ArchiveFix, path: &Path, name: &str) -> (RpfResult<()>, Vec<String>) {
        let mut journal = Vec::new();
        let outcome = fix.finalize_journaled(&mut |line| journal.push(line), name, path);
        (outcome, journal)
    }

    const START_LINE: &str = "[ArchiveFix] Запуск исправления хешей: update.rpf";

    fn assert_finished_line(line: &str) {
        let rest = line
            .strip_prefix("[ArchiveFix] Завершён за ")
            .and_then(|rest| rest.strip_suffix(" с"))
            .unwrap_or_else(|| panic!("{line}"));
        let (whole, tenth) = rest.split_once('.').expect("одна цифра после точки");
        assert!(whole.bytes().all(|b| b.is_ascii_digit()));
        assert_eq!(tenth.len(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn a_program_that_does_nothing_leaves_the_header_open_and_that_is_the_verdict() {
        // Аф21, Аф22, Аф23: код выхода никакой роли не играет
        for mode in ["noop", "fail", "exit3"] {
            let Some(lab) = Lab::new(mode) else { return };
            let before = fs::read(&lab.target).unwrap();
            let fix = lab.fix(loud_keys(), PATIENT);
            let (outcome, journal) = finalize(&fix, &lab.target, "update.rpf");
            assert_eq!(
                describe(&outcome.unwrap_err()),
                "Format: ArchiveFix did not encrypt the archive header: update.rpf",
                "{mode}"
            );
            assert_eq!(journal.len(), 2, "{journal:?}");
            assert_eq!(journal[0], START_LINE);
            assert_finished_line(&journal[1]);
            assert_eq!(fs::read(&lab.target).unwrap(), before);
        }
    }

    #[cfg(windows)]
    #[test]
    fn the_program_is_started_quietly_in_its_own_folder_with_the_keystroke() {
        let Some(lab) = Lab::new("noop") else { return };
        let fix = lab.fix(loud_keys(), PATIENT);
        {
            // Окружение процесса общее: метка живёт только под замком этого теста.
            static PROBE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
            let _guard = PROBE_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            std::env::set_var("PROBE_MARK", "inherited");
            let _ = finalize(&fix, &lab.target, "update.rpf");
            std::env::remove_var("PROBE_MARK");
        }
        let report = lab.report();
        let line = |key: &str| {
            report
                .lines()
                .find(|line| line.starts_with(&format!("{key}=")))
                .unwrap_or_else(|| panic!("нет {key}: {report}"))
                .to_owned()
        };
        assert_eq!(line("argc"), "argc=2");
        assert_eq!(
            line("argv"),
            format!(
                "argv={:?}",
                [lab.exe.to_string_lossy(), lab.target.to_string_lossy()]
            )
        );
        // текущий каталог процесса - каталог программы, а не целевого файла
        assert_eq!(line("cwd"), format!("cwd={}", lab.dir.path().display()));
        assert_eq!(line("stdin"), "stdin=[13, 10]");
        let mode = u32::from_str_radix(line("error_mode").trim_start_matches("error_mode=0x"), 16)
            .unwrap();
        assert_eq!(mode & CRASH_DIALOGS_OFF, CRASH_DIALOGS_OFF);
        assert_eq!(line("priority"), "priority=0x4000");
        assert_eq!(line("console_window_null"), "console_window_null=true");
        // окружение наследуется целиком
        assert_eq!(line("probe_env"), "probe_env=Some(\"inherited\")");
    }

    #[cfg(windows)]
    #[test]
    fn a_program_that_spoils_or_deletes_the_file_is_reported_by_the_header_check() {
        let cases: [(&str, &str); 3] = [
            (
                "garbage",
                "Format: update.rpf: The identifier DADADADA did not match the expected value of 0x52504637",
            ),
            ("shrink", "Format: update.rpf: the file is too short to be an RPF7 archive"),
            ("delete", "Io: "),
        ];
        for (mode, expected) in cases {
            let Some(lab) = Lab::new(mode) else { return };
            let fix = lab.fix(loud_keys(), PATIENT);
            let (outcome, journal) = finalize(&fix, &lab.target, "update.rpf");
            let described = describe(&outcome.unwrap_err());
            assert!(described.starts_with(expected), "{mode}: {described}");
            assert_eq!(journal.len(), 2);
        }
        let Some(lab) = Lab::new("garbage") else {
            return;
        };
        let fix = lab.fix(loud_keys(), PATIENT);
        finalize(&fix, &lab.target, "update.rpf").0.unwrap_err();
        assert_eq!(fs::metadata(&lab.target).unwrap().len(), 4096);
        let Some(lab) = Lab::new("delete") else {
            return;
        };
        let fix = lab.fix(loud_keys(), PATIENT);
        let (outcome, _) = finalize(&fix, &lab.target, "update.rpf");
        let error = outcome.unwrap_err();
        assert!(matches!(&error, RpfError::Io(cause) if cause.kind() == io::ErrorKind::NotFound));
        assert!(!lab.target.exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_sealed_header_is_the_only_way_to_success() {
        // Аф31-Аф32, Аф34: заглушка кладёт заголовок с меткой NG, размер 4096
        let Some(lab) = Lab::new("sealed") else {
            return;
        };
        fs::write(lab.dir.path().join("sealed.bin"), sealed_bytes(4096)).unwrap();
        let fix = lab.fix(loud_keys(), PATIENT);
        let (outcome, journal) = finalize(&fix, &lab.target, "update.rpf");
        outcome.unwrap();
        assert_eq!(journal.len(), 3);
        assert_eq!(journal[0], START_LINE);
        assert_finished_line(&journal[1]);
        assert_eq!(
            journal[2],
            "[ArchiveFinalize] Заголовок RPF зашифрован и повторно прочитан успешно."
        );
        assert_eq!(fs::metadata(&lab.target).unwrap().len(), 4096);

        // Аф33: те же байты, но ключи обычные - оглавление не расшифровалось
        let Some(lab) = Lab::new("sealed") else {
            return;
        };
        fs::write(lab.dir.path().join("sealed.bin"), sealed_bytes(4096)).unwrap();
        let fix = lab.fix(quiet_keys(), PATIENT);
        let (outcome, _) = finalize(&fix, &lab.target, "update.rpf");
        assert_eq!(
            describe(&outcome.unwrap_err()),
            "Format: RPF7 has no directory entries \u{2014} file is malformed or uses an unsupported format."
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_program_that_hangs_is_killed_when_the_time_is_up() {
        // Аф27-Аф28
        let Some(lab) = Lab::new("hang") else { return };
        let fix = lab.fix(loud_keys(), Duration::from_millis(1200));
        let begun = std::time::Instant::now();
        let (outcome, journal) = finalize(&fix, &lab.target, "update.rpf");
        let took = begun.elapsed();
        assert_eq!(
            describe(&outcome.unwrap_err()),
            "State: ArchiveFix timed out: update.rpf"
        );
        assert_eq!(journal, [START_LINE]);
        assert!(
            took >= Duration::from_millis(1200) && took < Duration::from_secs(20),
            "{took:?}"
        );
        // после возврата процесса нет: сердцебиение не идёт
        // файла может ещё не быть (программу убили до первого удара): это пустая строка
        let beat = || fs::read_to_string(lab.dir.path().join("beat.txt")).unwrap_or_default();
        let seen = beat();
        thread::sleep(Duration::from_millis(600));
        assert_eq!(beat(), seen);
    }

    #[cfg(windows)]
    #[test]
    fn a_chatty_program_cannot_stop_on_a_full_pipe() {
        // Аф29-Аф30: по 5 МиБ в stdout и stderr
        let Some(lab) = Lab::new("chatty") else {
            return;
        };
        // Срок большой: на загруженной машине запуск заглушки и перекачка 10 МиБ
        // занимают десятки секунд, а тест проверяет, что молчаливая труба не
        // останавливает программу (иначе сработал бы срок и ответ был бы другим).
        let patience = Duration::from_secs(120);
        let fix = lab.fix(loud_keys(), patience);
        let begun = std::time::Instant::now();
        let (outcome, _) = finalize(&fix, &lab.target, "update.rpf");
        assert_eq!(
            describe(&outcome.unwrap_err()),
            "Format: ArchiveFix did not encrypt the archive header: update.rpf"
        );
        assert!(begun.elapsed() < patience - Duration::from_secs(5));
    }

    #[cfg(windows)]
    #[test]
    fn the_name_must_match_the_file_and_is_what_the_messages_and_the_key_are_built_from() {
        let Some(lab) = Lab::new("noop") else { return };
        let fix = lab.fix(loud_keys(), PATIENT);
        // Аф37: другое имя - ни журнала, ни запуска
        let (outcome, journal) = finalize(&fix, &lab.target, "Other.rpf");
        assert_eq!(
            describe(&outcome.unwrap_err()),
            "Format: ArchiveFix filename mismatch: expected Other.rpf."
        );
        assert!(journal.is_empty());
        assert!(lab.report().is_empty());
        // Аф39: у пустого пути нет имени файла
        let (outcome, _) = finalize(&fix, Path::new(""), "update.rpf");
        assert_eq!(
            describe(&outcome.unwrap_err()),
            "Format: ArchiveFix filename mismatch: expected update.rpf."
        );
        // Аф38: регистр не важен, name идёт в журнал и сообщения как передано
        let (outcome, journal) = finalize(&fix, &lab.target, "UPDATE.RPF");
        assert_eq!(
            describe(&outcome.unwrap_err()),
            "Format: ArchiveFix did not encrypt the archive header: UPDATE.RPF"
        );
        assert_eq!(
            journal[0],
            "[ArchiveFix] Запуск исправления хешей: UPDATE.RPF"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_program_that_vanished_or_was_swapped_after_open_does_not_start() {
        // Аф40
        let Some(lab) = Lab::new("noop") else { return };
        let fix = lab.fix(loud_keys(), PATIENT);
        fs::remove_file(&lab.exe).unwrap();
        let (outcome, journal) = finalize(&fix, &lab.target, "update.rpf");
        let described = describe(&outcome.unwrap_err());
        assert!(
            described.starts_with("State: ArchiveFix process did not start: "),
            "{described}"
        );
        assert_eq!(journal, [START_LINE]);
        // Аф41: сумма проверяется один раз, в open; не исполняемый файл не запустится
        let Some(lab) = Lab::new("noop") else { return };
        let fix = lab.fix(loud_keys(), PATIENT);
        fs::write(&lab.exe, b"definitely not an executable").unwrap();
        let (outcome, _) = finalize(&fix, &lab.target, "update.rpf");
        let described = describe(&outcome.unwrap_err());
        assert!(
            described.starts_with("State: ArchiveFix process did not start: "),
            "{described}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_target_busy_for_everybody_fails_the_header_check_not_the_run() {
        // Аф42: код 32 при чтении заголовка
        use std::os::windows::fs::OpenOptionsExt;
        let Some(lab) = Lab::new("noop") else { return };
        let fix = lab.fix(loud_keys(), PATIENT);
        let hold = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&lab.target)
            .unwrap();
        let (outcome, journal) = finalize(&fix, &lab.target, "update.rpf");
        drop(hold);
        let error = outcome.unwrap_err();
        assert!(
            matches!(&error, RpfError::Io(cause) if cause.raw_os_error() == Some(32)),
            "{}",
            describe(&error)
        );
        assert_eq!(journal.len(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn the_writer_calls_the_finalizer_for_every_nested_archive_in_order() {
        fn nested_tree() -> DirNode {
            let mut root = DirNode::new("");
            for name in ["one.rpf", "two.rpf"] {
                root.files.push(FileNode {
                    name: name.to_owned(),
                    body: Body::Nested(Box::new(rage_rpf::fixtures::replacement_tree())),
                });
            }
            root
        }
        let write = |fix: &ArchiveFix| {
            let scratch = tempdir().unwrap();
            let out = scratch.path().join("top.rpf");
            let mut file = File::create(&out).unwrap();
            let mut ctx = WriteContext {
                staging: scratch.path(),
                keys: None,
                finalizer: Some(fix),
            };
            write_archive(&nested_tree(), &mut file, &mut ctx, &mut |_| {})
        };
        let invoked = |lab: &Lab| -> Vec<String> {
            lab.report()
                .lines()
                .filter(|line| line.starts_with("argv="))
                .map(|line| {
                    let end = line.rfind('\\').map_or(0, |at| at + 1);
                    line[end..].trim_end_matches("\"]").to_owned()
                })
                .collect()
        };

        // Аф43: заглушка ничего не делает - отказ на первом же вложенном
        let Some(lab) = Lab::new("noop") else { return };
        let fix = lab.fix(loud_keys(), PATIENT);
        let error = write(&fix).unwrap_err();
        assert_eq!(
            describe(&error),
            "Format: ArchiveFix did not encrypt the archive header: one.rpf"
        );
        assert_eq!(invoked(&lab), ["one.rpf"]);

        // Аф44: оба вложенных доведены, вызовы по порядку записей
        let Some(lab) = Lab::new("sealed") else {
            return;
        };
        fs::write(lab.dir.path().join("sealed.bin"), sealed_bytes(4096)).unwrap();
        let fix = lab.fix(loud_keys(), PATIENT);
        write(&fix).unwrap();
        assert_eq!(invoked(&lab), ["one.rpf", "two.rpf"]);
    }

    // ----- очередь запусков внутри процесса -----

    /// Охрану очереди можно передать другому потоку: проба живёт в потоке-ждуне.
    #[test]
    fn the_turn_can_move_to_another_thread() {
        fn is_send<T: Send>() {}
        is_send::<Turn>();
        is_send::<FixTrial>();
    }

    #[test]
    fn a_second_turn_waits_for_the_first_and_the_wait_is_counted() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let _locked = lock_is_on();
        let first = Turn::take("update.rpf", Path::new("ArchiveFix.exe")).unwrap();
        let released = Arc::new(AtomicBool::new(false));
        let tally = rage_rpf::tally::Tally::new();
        let waiter = {
            let (released, tally) = (Arc::clone(&released), Arc::clone(&tally));
            thread::spawn(move || {
                let _scope = rage_rpf::tally::install(tally);
                let _turn = Turn::take("update.rpf", Path::new("ArchiveFix.exe")).unwrap();
                released.load(Ordering::SeqCst)
            })
        };
        thread::sleep(Duration::from_millis(250));
        assert!(
            !waiter.is_finished(),
            "второй не должен пройти, пока занято"
        );
        released.store(true, Ordering::SeqCst);
        drop(first);
        assert!(waiter.join().unwrap(), "второй дождался первого");
        assert!(
            tally.totals().millis(Phase::GateWait) >= 150,
            "ожидание очереди не посчитано: {:?}",
            tally.totals()
        );
        // очередь свободна: берётся сразу
        drop(Turn::take("update.rpf", Path::new("ArchiveFix.exe")).unwrap());
    }

    /// Два запуска настоящей программы из двух потоков не пересекаются во времени:
    /// заглушка спит 400 мс и пишет свой отрезок.
    #[cfg(windows)]
    #[test]
    fn two_launches_from_two_threads_do_not_overlap() {
        let _locked = lock_is_on();
        let Some(spans) = two_parallel_launches() else {
            return;
        };
        assert!(spans[1].0 >= spans[0].1, "запуски пересеклись: {spans:?}");
    }

    /// Два параллельных запуска заглушки над двумя копиями одного архива: отрезки
    /// работы по времени начала. `None`, если заглушку не собрать.
    #[cfg(windows)]
    fn two_parallel_launches() -> Option<Vec<(u128, u128)>> {
        let lab = Lab::new("nap")?;
        let keys = quiet_keys();
        let fix = Arc::new(lab.fix(keys, Duration::from_secs(30)));
        let other = lab.dir.path().join("второй").join("update.rpf");
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::write(&other, open_archive_bytes()).unwrap();
        let threads: Vec<_> = [lab.target.clone(), other]
            .into_iter()
            .map(|path| {
                let fix = Arc::clone(&fix);
                thread::spawn(move || {
                    // заголовок после заглушки остаётся открытым: отказ проверки здесь не важен
                    let _ = finalize(&fix, &path, "update.rpf");
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let spans = fs::read_to_string(lab.dir.path().join("spans.txt")).unwrap();
        let mut spans: Vec<(u128, u128)> = spans
            .lines()
            .map(|line| {
                let (began, ended) = line.split_once(' ').unwrap();
                (began.parse().unwrap(), ended.parse().unwrap())
            })
            .collect();
        assert_eq!(spans.len(), 2, "{spans:?}");
        spans.sort();
        Some(spans)
    }

    // ----- выключатель замка, срок и отмена ожидания в очереди -----

    /// Выключатель замка читается из окружения процесса, а оно общее: проверки,
    /// что опираются на замок, держат чтение, проверка выключателя — запись.
    static LOCK_SWITCH: std::sync::RwLock<()> = std::sync::RwLock::new(());

    /// Замок обязан быть включён (переменной нет), пока держится охрана.
    fn lock_is_on() -> std::sync::RwLockReadGuard<'static, ()> {
        let guard = LOCK_SWITCH.read().unwrap_or_else(PoisonError::into_inner);
        assert!(
            env::var_os(LOCK_ENV).is_none(),
            "{LOCK_ENV} задана снаружи теста"
        );
        guard
    }

    /// Выключатель замка задан на время жизни охраны; остальные проверки ждут.
    struct SwitchSet(#[allow(dead_code)] std::sync::RwLockWriteGuard<'static, ()>);

    fn switch_lock(value: &str) -> SwitchSet {
        let guard = LOCK_SWITCH.write().unwrap_or_else(PoisonError::into_inner);
        env::set_var(LOCK_ENV, value);
        SwitchSet(guard)
    }

    impl Drop for SwitchSet {
        fn drop(&mut self) {
            env::remove_var(LOCK_ENV);
        }
    }

    /// Свой замок проверки: общий замок процесса другие тесты берут сами.
    fn spare_gate() -> &'static Gate {
        Box::leak(Box::new(Gate {
            busy: Mutex::new(false),
            freed: Condvar::new(),
        }))
    }

    #[test]
    fn only_a_zero_switches_the_lock_off_and_only_system_adds_the_process_lock() {
        assert_eq!(lock_mode_from(None), LockMode::Process);
        for kept in ["1", "", " ", "off", "false", "no", "00", "yes", "systems"] {
            assert_eq!(lock_mode_from(Some(kept)), LockMode::Process, "{kept:?}");
        }
        for off in ["0", " 0 ", "0\n"] {
            assert_eq!(lock_mode_from(Some(off)), LockMode::Off, "{off:?}");
        }
        for system in ["system", " System ", "SYSTEM\n"] {
            assert_eq!(lock_mode_from(Some(system)), LockMode::System, "{system:?}");
        }
    }

    #[test]
    fn the_switch_is_read_from_the_environment_and_takes_the_lock_away() {
        {
            let _locked = lock_is_on();
            assert_eq!(lock_mode(), LockMode::Process);
            let first = Turn::take("update.rpf", Path::new("ArchiveFix.exe")).unwrap();
            assert!(first.gate.is_some(), "по умолчанию замок есть");
            assert!(
                first.system.is_none(),
                "по умолчанию замка между процессами нет"
            );
        }
        let _off = switch_lock("0");
        assert_eq!(lock_mode(), LockMode::Off);
        // без замка охрана пустая, и вторая берётся, пока первая жива
        let first = Turn::take("update.rpf", Path::new("ArchiveFix.exe")).unwrap();
        let second = Turn::take("update.rpf", Path::new("ArchiveFix.exe")).unwrap();
        assert!(first.gate.is_none() && second.gate.is_none());
        drop((first, second));
    }

    #[cfg(windows)]
    #[test]
    fn the_system_mode_holds_a_lock_between_processes_until_the_turn_is_dropped() {
        let dir = tempdir().unwrap();
        let program = dir.path().join("ArchiveFix.exe");
        let held = SystemLock::path_for(&program);
        let _off = switch_lock("system");
        assert_eq!(lock_mode(), LockMode::System);
        let first = Turn::take("update.rpf", &program).unwrap();
        assert!(first.gate.is_some() && first.system.is_some());
        // другой процесс (здесь второй дескриптор) файл замка не откроет, пока охрана жива
        let busy = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .share_mode(0)
            .open(&held);
        assert_eq!(busy.err().and_then(|error| error.raw_os_error()), Some(32));
        drop(first);
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .share_mode(0)
            .open(&held)
            .expect("охрана снята: замок свободен");
    }

    #[test]
    fn the_lock_file_is_one_per_program_folder_whatever_the_case_of_its_path() {
        let a = SystemLock::path_for(Path::new(r"C:\Tools\ArchiveFix\ArchiveFix.exe"));
        let b = SystemLock::path_for(Path::new(r"c:\tools\archivefix\ARCHIVEFIX.EXE"));
        let c = SystemLock::path_for(Path::new(r"C:\Tools\Other\ArchiveFix.exe"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.parent(), Some(env::temp_dir().as_path()));
        let name = a.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with("astral-archivefix-") && name.ends_with(".lock"),
            "{name}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_system_waiter_polls_the_cancel_gives_up_after_its_patience_and_wakes_on_release() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("held.lock");
        let first =
            SystemLock::take_at(&path, "a.rpf", (QUEUE_PATIENCE, QUEUE_POLL), &mut || Ok(()))
                .unwrap();
        // отмена
        let mut asked = 0u32;
        let outcome = SystemLock::take_at(
            &path,
            "b.rpf",
            (Duration::from_secs(60), Duration::from_millis(10)),
            &mut || {
                asked += 1;
                if asked == 3 {
                    Err(RpfError::Cancelled)
                } else {
                    Ok(())
                }
            },
        );
        assert!(matches!(outcome, Err(RpfError::Cancelled)));
        assert_eq!(asked, 3);
        // срок
        let begun = Instant::now();
        let outcome = SystemLock::take_at(
            &path,
            "update.rpf",
            (Duration::from_millis(300), Duration::from_millis(20)),
            &mut || Ok(()),
        );
        assert_eq!(
            describe(&outcome.err().expect("срок вышел")),
            "State: ArchiveFix queue timed out: update.rpf"
        );
        assert!(begun.elapsed() >= Duration::from_millis(300));
        // освобождение будит ждущего
        let waiter = {
            let path = path.clone();
            thread::spawn(move || {
                SystemLock::take_at(
                    &path,
                    "c.rpf",
                    (Duration::from_secs(60), Duration::from_millis(20)),
                    &mut || Ok(()),
                )
                .is_ok()
            })
        };
        thread::sleep(Duration::from_millis(150));
        assert!(!waiter.is_finished());
        drop(first);
        assert!(
            waiter.join().unwrap(),
            "ждущий взял замок, когда его отпустили"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_lock_file_that_cannot_be_created_is_a_refusal_with_its_path() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("no-such-folder").join("held.lock");
        let outcome = SystemLock::take_at(
            &path,
            "update.rpf",
            (Duration::from_millis(100), Duration::from_millis(10)),
            &mut || Ok(()),
        );
        let text = describe(&outcome.err().expect("файл замка не создать"));
        assert!(
            text.starts_with("State: ArchiveFix lock file ") && text.contains("held.lock"),
            "{text}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_stub_launches_overlap_with_the_switch_and_do_not_without_it() {
        // с замком запуски идут по очереди
        {
            let _locked = lock_is_on();
            let Some(spans) = two_parallel_launches() else {
                return;
            };
            assert!(spans[1].0 >= spans[0].1, "с замком пересеклись: {spans:?}");
        }
        // с `ASTRAL_ENGINE_ARCHIVEFIX_LOCK=0` оба идут разом: отрезки пересекаются
        let _off = switch_lock("0");
        let Some(spans) = two_parallel_launches() else {
            return;
        };
        assert!(
            spans[1].0 < spans[0].1,
            "без замка запуски не пересеклись: {spans:?}"
        );
    }

    #[test]
    fn a_waiter_polls_the_cancel_and_leaves_the_queue_untouched() {
        let gate = spare_gate();
        let wait = (QUEUE_PATIENCE, QUEUE_POLL);
        let first = gate.enter("a.rpf", wait, &mut || Ok(())).unwrap();
        let mut asked = 0u32;
        let begun = Instant::now();
        let outcome = gate.enter(
            "b.rpf",
            (Duration::from_secs(60), Duration::from_millis(10)),
            &mut || {
                asked += 1;
                if asked == 3 {
                    Err(RpfError::Cancelled)
                } else {
                    Ok(())
                }
            },
        );
        assert!(
            matches!(outcome, Err(RpfError::Cancelled)),
            "{:?}",
            outcome.err()
        );
        assert_eq!(asked, 3);
        assert!(begun.elapsed() < Duration::from_secs(5));
        // отменённый очередь не занял: первый отпускает, следующий берёт сразу
        drop(first);
        let next = gate.enter("c.rpf", wait, &mut || {
            panic!("замок свободен: отмену не спрашивают")
        });
        assert!(next.is_ok());
    }

    #[test]
    fn a_waiter_gives_up_after_its_patience_with_a_plain_refusal() {
        let gate = spare_gate();
        let _first = gate
            .enter("a.rpf", (QUEUE_PATIENCE, QUEUE_POLL), &mut || Ok(()))
            .unwrap();
        let begun = Instant::now();
        let outcome = gate.enter(
            "update.rpf",
            (Duration::from_millis(300), Duration::from_millis(20)),
            &mut || Ok(()),
        );
        let took = begun.elapsed();
        assert_eq!(
            describe(&outcome.err().expect("срок вышел")),
            "State: ArchiveFix queue timed out: update.rpf"
        );
        assert!(
            took >= Duration::from_millis(300) && took < Duration::from_secs(20),
            "{took:?}"
        );
    }

    #[test]
    fn a_waiter_wakes_when_the_holder_lets_go_before_its_patience() {
        let gate = spare_gate();
        let first = gate
            .enter("a.rpf", (QUEUE_PATIENCE, QUEUE_POLL), &mut || Ok(()))
            .unwrap();
        let waiter = thread::spawn(move || {
            gate.enter(
                "b.rpf",
                (Duration::from_secs(60), Duration::from_millis(500)),
                &mut || Ok(()),
            )
            .is_ok()
        });
        thread::sleep(Duration::from_millis(150));
        assert!(!waiter.is_finished());
        drop(first);
        assert!(
            waiter.join().unwrap(),
            "ждущий вошёл, когда замок освободили"
        );
    }

    #[test]
    fn the_queue_limits_are_the_documented_ones() {
        assert_eq!(QUEUE_PATIENCE, Duration::from_secs(15 * 60));
        assert!(QUEUE_PATIENCE > ArchiveFix::PATIENCE);
        assert!(QUEUE_POLL <= Duration::from_millis(250));
    }

    // ----- отпечаток один раз за жизнь процесса и ожидание без опроса -----

    /// Счётчики и таблица закреплений общие на процесс: проверки закрепления идут по одной.
    static PIN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn pin_gate() -> std::sync::MutexGuard<'static, ()> {
        let guard = PIN_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        release_pins();
        guard
    }

    #[test]
    fn a_pinned_program_is_hashed_once_and_the_print_is_reused() {
        let _gate = pin_gate();
        let dir = tempdir().unwrap();
        let bytes = b"PROGRAM FOR THE PIN CACHE";
        let sum = pinned(bytes);
        let exe = fake_program(dir.path(), "ArchiveFix.exe", bytes);
        let path = exe.to_string_lossy().into_owned();
        let (hashed, reused) = (fingerprints_computed(), fingerprints_reused());
        for _ in 0..4 {
            let fix = ArchiveFix::open_pinned(&path, (&sum, PATIENT), loud_keys()).unwrap();
            assert_eq!(fix.executable, exe);
        }
        assert_eq!(fingerprints_computed() - hashed, 1);
        assert_eq!(fingerprints_reused() - reused, 3);
        release_pins();
    }

    #[test]
    fn a_pinned_print_is_still_compared_with_the_pin_on_every_open() {
        let _gate = pin_gate();
        let dir = tempdir().unwrap();
        let bytes = b"PROGRAM WITH THE WRONG PIN";
        let exe = fake_program(dir.path(), "ArchiveFix.exe", bytes);
        let path = exe.to_string_lossy().into_owned();
        let right = pinned(bytes);
        ArchiveFix::open_pinned(&path, (&right, PATIENT), loud_keys()).unwrap();
        // та же программа в памяти, но закреплённая сумма другая: отказ, как у обычного пути
        let wrong = pinned(b"SOMETHING ELSE");
        let error = failure_of(ArchiveFix::open_pinned(
            &path,
            (&wrong, PATIENT),
            loud_keys(),
        ));
        assert_eq!(error.message, "ArchiveFix executable checksum mismatch.");
        release_pins();
    }

    #[test]
    fn the_pinned_open_keeps_the_refusals_of_the_plain_one() {
        let _gate = pin_gate();
        let dir = tempdir().unwrap();
        let bytes = b"PROGRAM FOR REFUSALS";
        let sum = pinned(bytes);
        let wrong_name = fake_program(dir.path(), "Other.exe", bytes);
        let error = failure_of(ArchiveFix::open_pinned(
            &wrong_name.to_string_lossy(),
            (&sum, PATIENT),
            loud_keys(),
        ));
        assert_eq!(error.message, "ArchiveFix executable name is invalid.");
        let exe = fake_program(&dir.path().join("t"), "ArchiveFix.exe", b"DIFFERENT BYTES");
        let error = failure_of(ArchiveFix::open_pinned(
            &exe.to_string_lossy(),
            (&sum, PATIENT),
            loud_keys(),
        ));
        assert_eq!(error.message, "ArchiveFix executable checksum mismatch.");
        // отказ ничего не запоминает: файл не закреплён и его можно менять
        fs::write(&exe, b"STILL FREE").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_pinned_program_cannot_be_overwritten_or_deleted_until_the_pin_is_released() {
        let _gate = pin_gate();
        let dir = tempdir().unwrap();
        let bytes = b"PROGRAM THAT MUST NOT BE SWAPPED";
        let sum = pinned(bytes);
        let exe = fake_program(dir.path(), "ArchiveFix.exe", bytes);
        let path = exe.to_string_lossy().into_owned();
        ArchiveFix::open_pinned(&path, (&sum, PATIENT), loud_keys()).unwrap();

        assert!(fs::write(&exe, b"SWAPPED").is_err());
        assert!(fs::remove_file(&exe).is_err());
        assert!(fs::rename(&exe, dir.path().join("moved.exe")).is_err());
        // читать можно всем: в том числе запускать и хешировать снаружи
        assert_eq!(fs::read(&exe).unwrap(), bytes);

        release_pins();
        fs::write(&exe, b"SWAPPED").unwrap();
        // подмена после снятия: перехеш и отказ
        let error = failure_of(ArchiveFix::open_pinned(&path, (&sum, PATIENT), loud_keys()));
        assert_eq!(error.message, "ArchiveFix executable checksum mismatch.");
        fs::remove_file(&exe).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_program_open_for_writing_is_not_pinned_and_opens_the_plain_way() {
        let _gate = pin_gate();
        let dir = tempdir().unwrap();
        let bytes = b"PROGRAM HELD BY A WRITER";
        let sum = pinned(bytes);
        let exe = fake_program(dir.path(), "ArchiveFix.exe", bytes);
        let path = exe.to_string_lossy().into_owned();
        let writer = fs::OpenOptions::new().write(true).open(&exe).unwrap();
        let reused = fingerprints_reused();
        let fix = ArchiveFix::open_pinned(&path, (&sum, PATIENT), loud_keys()).unwrap();
        assert_eq!(fix.executable, exe);
        assert_eq!(fingerprints_reused(), reused);
        // закрепления нет: сверка прежняя, за каждый открытый заново
        ArchiveFix::open_pinned(&path, (&sum, PATIENT), loud_keys()).unwrap();
        assert_eq!(fingerprints_reused(), reused);
        drop(writer);
        release_pins();
    }

    #[test]
    fn the_identity_of_a_pinned_program_is_the_identity_of_the_file_at_its_path() {
        let _gate = pin_gate();
        let dir = tempdir().unwrap();
        let bytes = b"PROGRAM THAT IS REPLACED";
        let sum = pinned(bytes);
        let exe = fake_program(dir.path(), "ArchiveFix.exe", bytes);
        let path = exe.to_string_lossy().into_owned();
        ArchiveFix::open_pinned(&path, (&sum, PATIENT), loud_keys()).unwrap();
        let held = pins().get(&exe).map(|held| held.identity.clone()).unwrap();
        // другой файл с теми же байтами по тому же пути: признаки другие или равные,
        // но решение принимает сверка признаков, а не вера в путь
        let again = Held::grab(&exe).unwrap();
        assert_eq!(again.identity.size, held.size);
        assert_eq!(again.sha256, sum);
        assert!(pins().get(&exe).unwrap().is_still_at(&exe));
        release_pins();
    }

    #[cfg(windows)]
    #[test]
    fn the_polling_wait_still_kills_a_hung_program_and_sees_a_quick_exit() {
        // прежний способ (`ASTRAL_ENGINE_ARCHIVEFIX_POLL=1`) остаётся рабочим
        let Some(lab) = Lab::new("hang") else { return };
        let launch = Launch {
            program: &lab.exe,
            target: &lab.target,
            patience: Duration::from_millis(1200),
        };
        let mut child = launch.spawn().unwrap();
        child.stdin.take();
        let begun = Instant::now();
        assert!(!launch.poll_or_kill(&mut child).unwrap());
        assert!(begun.elapsed() >= Duration::from_millis(1200));
        assert!(child.try_wait().unwrap().is_some());

        let Some(lab) = Lab::new("noop") else { return };
        let launch = Launch {
            program: &lab.exe,
            target: &lab.target,
            patience: PATIENT,
        };
        let mut child = launch.spawn().unwrap();
        child.stdin.take();
        assert!(launch.poll_or_kill(&mut child).unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn the_waiting_wait_returns_when_the_program_ends_not_on_a_poll_tick() {
        let Some(lab) = Lab::new("noop") else { return };
        let launch = Launch {
            program: &lab.exe,
            target: &lab.target,
            patience: PATIENT,
        };
        // к нулевому сроку программа уже заведомо идёт: ожидание обязано вернуть «не вышла»
        // сразу, не засыпая на тик опроса, и убить её
        let mut child = launch.spawn().unwrap();
        let quick = Launch {
            patience: Duration::ZERO,
            ..launch
        };
        let begun = Instant::now();
        let ended = quick.wait_or_kill(&mut child).unwrap();
        assert!(begun.elapsed() < Duration::from_secs(2));
        assert!(!ended || child.try_wait().unwrap().is_some());

        // и обычный конец программы замечается
        let mut child = launch.spawn().unwrap();
        child.stdin.take();
        assert!(launch.wait_or_kill(&mut child).unwrap());
    }
}
