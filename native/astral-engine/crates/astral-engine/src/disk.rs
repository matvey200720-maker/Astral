//! Щадящая запись: фоновый режим потока, потолки скорости чтения и записи
//! и сторож голода. Ни один записанный байт модуль не меняет, только время.
//!
//! Потолки идущей команды можно менять на ходу (`LiveLimits`): резидентный
//! режим (`serve`) кладёт их в контекст потока запроса, и пейсер записи с
//! лентой чтения этого запроса подхватывают новые значения. Без контекста
//! (процесс на команду, тесты) всё работает как раньше.

use std::cell::RefCell;
use std::env;
use std::mem;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant};

use rage_rpf::read_pace::ReadPace;

use crate::args::Options;

pub const LIMIT_OPTION: &str = "write-limit-mbps";
pub const READ_LIMIT_OPTION: &str = "read-limit-mbps";
pub const BACKGROUND_ENV: &str = "ASTRAL_ENGINE_BACKGROUND_IO";
/// Выключатель «малые записи без фона» (по умолчанию выключен): поток команды входит в фоновый
/// режим ввода-вывода не сразу, а когда команда записала `SMALL_WRITES_BYTES` (или столько МиБ,
/// сколько названо числом от 2). Короткая команда (дозапись `update.rpf` на килобайты, смена слоя,
/// разбор журналов) целиком идёт в обычном приоритете и не стоит в очереди за чужой записью: у
/// людей с занятым диском фоновый приоритет делает такой шаг секундами и минутами вместо долей секунды.
pub const SMALL_WRITES_ENV: &str = "ASTRAL_ENGINE_SMALL_WRITES_FOREGROUND";
/// Порог «малой записи» по умолчанию, когда выключатель назван словом или единицей.
pub const SMALL_WRITES_BYTES: u64 = 64 * 1024 * 1024;
pub const STARVED_BYTES_PER_SECOND: f64 = 8.0 * 1024.0 * 1024.0;
pub const STARVED_FOR: Duration = Duration::from_secs(15);

const MEGABYTE: u64 = 1024 * 1024;
const SPEED_WINDOW: Duration = Duration::from_secs(1);
const THREAD_MODE_BACKGROUND_BEGIN: i32 = 0x0001_0000;
const THREAD_MODE_BACKGROUND_END: i32 = 0x0002_0000;

/// Потолок из текста опции: ноль и «не число» — без потолка. Слишком большое
/// число упирается в `u64::MAX` (то есть в практически отсутствующий потолок).
pub fn limit_from(value: Option<&str>) -> Option<u64> {
    value
        .and_then(|text| text.trim().parse::<u64>().ok())
        .filter(|&megabytes| megabytes > 0)
        .map(|megabytes| megabytes.saturating_mul(MEGABYTE))
}

/// Приращение накопительного счётчика; `last` всегда становится `total`,
/// даже если счётчик пошёл назад.
pub fn delta(last: &mut u64, total: u64) -> u64 {
    total.saturating_sub(mem::replace(last, total))
}

/// Потолок чтения принадлежит запросу, то есть потоку, который его поставил, а
/// не процессу: параллельные запросы друг друга не тормозят. Внутри `serve`
/// значение, пришедшее по каналу управления раньше разбора параметров, важнее
/// параметра; без контекста потолок просто ставится потоку.
pub fn apply_read_limit(options: &Options) {
    let initial = limit_from(options.optional(READ_LIMIT_OPTION));
    match current_live() {
        Some(live) => live.adopt_read(initial),
        None => rage_rpf::read_pace::set_read_limit(initial),
    }
}

/// Потолок из значения канала управления: мегабайты в секунду, ноль — без потолка.
pub fn limit_from_megabytes(megabytes: u64) -> Option<u64> {
    Some(megabytes.saturating_mul(MEGABYTE)).filter(|&bytes| bytes > 0)
}

/// Строка управления пределами идущей команды в режиме «процесс на команду» (20.11.2026, регулятор диска): `limits write=<МБ/с> read=<МБ/с>`; любой из двух ключей можно
/// опустить, ноль — без потолка. Приложение шлёт её в stdin команды (туда же, куда строку `cancel`): занятость диска меняется посреди команды, а потолки этого процесса
/// до сих пор задавались один раз, при запуске. Прежний движок строки, которые не `cancel`, читает и отбрасывает, поэтому лишняя строка ему не мешает.
pub fn change_from_line(line: &str) -> Option<Change> {
    let mut words = line.split_whitespace();
    if !words.next()?.eq_ignore_ascii_case("limits") {
        return None;
    }
    let mut change = Change::default();
    for word in words {
        let (key, value) = word.split_once('=')?;
        let megabytes: u64 = value.parse().ok()?;
        match key.to_ascii_lowercase().as_str() {
            "write" => change.write = Some(limit_from_megabytes(megabytes)),
            "read" => change.read = Some(limit_from_megabytes(megabytes)),
            _ => return None,
        }
    }
    (change.write.is_some() || change.read.is_some()).then_some(change)
}

/// Смена потолков идущей команды. Внешний `None` — не трогать, внутренний —
/// «без потолка».
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Change {
    pub write: Option<Option<u64>>,
    pub read: Option<Option<u64>>,
}

/// Что пейсер записи узнаёт о живых потолках.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WriteView {
    /// Потолок записи сейчас.
    pub ceiling: Option<u64>,
    /// Потолок снят каналом управления: фоновый приоритет потокам записи не нужен.
    pub unbraked: bool,
    /// Номер состояния: растёт на каждую смену.
    pub epoch: u64,
}

#[derive(Default)]
struct LiveState {
    write: Option<u64>,
    read: Option<u64>,
    /// Значение уже выбрано: параметром команды или каналом управления.
    write_chosen: bool,
    read_chosen: bool,
    /// Канал управления менял потолок записи хотя бы раз.
    write_by_control: bool,
    read_pace: Option<ReadPace>,
    /// Команду отменяют: ждать потолков она больше не должна.
    halted: bool,
}

/// Живые потолки одной команды: их меняет канал управления, читают пейсер
/// записи и лента чтения этой команды.
#[derive(Default)]
pub struct LiveLimits {
    state: Mutex<LiveState>,
    changed: Condvar,
    epoch: AtomicU64,
}

impl LiveLimits {
    pub fn new() -> Arc<Self> {
        Arc::default()
    }

    fn lock(&self) -> MutexGuard<'_, LiveState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn view(&self, state: &LiveState) -> WriteView {
        WriteView {
            ceiling: state.write,
            unbraked: state.write_by_control && state.write.is_none(),
            epoch: self.epoch.load(Ordering::Acquire),
        }
    }

    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    /// Лента чтения, потолок которой ведёт эта команда.
    pub fn bind_read(&self, pace: ReadPace) {
        self.lock().read_pace = Some(pace);
    }

    fn unbind_read(&self) {
        self.lock().read_pace = None;
    }

    /// Применяет смену: пейсер записи видит её на следующей записи или сразу,
    /// если спит; лента чтения меняется тут же.
    pub fn apply(&self, change: Change) {
        let mut state = self.lock();
        let mut touched = false;
        if let Some(write) = change.write {
            state.write = write.filter(|&bytes| bytes > 0);
            state.write_chosen = true;
            state.write_by_control = true;
            touched = true;
        }
        if let Some(read) = change.read {
            state.read = read.filter(|&bytes| bytes > 0);
            state.read_chosen = true;
            if let (Some(pace), false) = (&state.read_pace, state.halted) {
                pace.set_limit(read);
            }
            touched = true;
        }
        if touched {
            self.epoch.fetch_add(1, Ordering::Release);
        }
        drop(state);
        self.changed.notify_all();
    }

    /// Команду отменяют: ни запись, ни чтение больше не ждут потолков, чтобы
    /// она быстро дошла до ближайшей точки остановки. Спящие просыпаются сразу.
    pub fn halt(&self) {
        let mut state = self.lock();
        state.halted = true;
        if let Some(pace) = &state.read_pace {
            pace.set_limit(None);
        }
        self.epoch.fetch_add(1, Ordering::Release);
        drop(state);
        self.changed.notify_all();
    }

    pub fn halted(&self) -> bool {
        self.lock().halted
    }

    /// Потолок записи из параметров команды, если его ещё не выбрали иначе.
    pub fn adopt_write(&self, initial: Option<u64>) -> WriteView {
        let mut state = self.lock();
        if !state.write_chosen {
            state.write = initial;
            state.write_chosen = true;
        }
        self.view(&state)
    }

    /// Потолок чтения из параметров команды, если его ещё не выбрали иначе.
    pub fn adopt_read(&self, initial: Option<u64>) {
        let mut state = self.lock();
        if !state.read_chosen {
            state.read = initial;
            state.read_chosen = true;
        }
        if let (Some(pace), false) = (&state.read_pace, state.halted) {
            pace.set_limit(state.read);
        }
    }

    pub fn write_view(&self) -> WriteView {
        let state = self.lock();
        self.view(&state)
    }

    /// Потолок чтения, как его видит команда сейчас.
    pub fn read_ceiling(&self) -> Option<u64> {
        self.lock().read
    }

    /// Спит не дольше `span`; `true`, если проснулся из-за смены после
    /// состояния `seen`.
    fn nap(&self, span: Duration, seen: u64) -> bool {
        let state = self.lock();
        let (_state, outcome) = self
            .changed
            .wait_timeout_while(state, span, |_| self.epoch.load(Ordering::Acquire) == seen)
            .unwrap_or_else(PoisonError::into_inner);
        !outcome.timed_out()
    }

    /// Ставит эти потолки текущими для потока запроса: чтение ведёт потолок
    /// ленты этого потока, пейсеры записи берут потолки у контекста. Охрана
    /// возвращает прежний контекст.
    pub fn enter(self: &Arc<Self>) -> LiveScope {
        rage_rpf::read_pace::set_read_limit(None);
        self.bind_read(rage_rpf::read_pace::current());
        let previous = CONTEXT.with(|slot| slot.borrow_mut().replace(Arc::clone(self)));
        LiveScope {
            live: Arc::clone(self),
            previous,
        }
    }
}

thread_local! {
    static CONTEXT: RefCell<Option<Arc<LiveLimits>>> = const { RefCell::new(None) };
}

/// Живые потолки запроса, который идёт в этом потоке.
pub fn current_live() -> Option<Arc<LiveLimits>> {
    CONTEXT.with(|slot| slot.borrow().clone())
}

/// Контекст запроса в потоке; уничтожается вместе с запросом.
pub struct LiveScope {
    live: Arc<LiveLimits>,
    previous: Option<Arc<LiveLimits>>,
}

impl Drop for LiveScope {
    fn drop(&mut self) {
        self.live.unbind_read();
        let previous = self.previous.take();
        CONTEXT.with(|slot| *slot.borrow_mut() = previous);
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
extern "system" {
    fn GetCurrentThread() -> isize;
    fn SetThreadPriority(thread: isize, priority: i32) -> i32;
}

/// Вход в фоновый режим или выход из него в текущем потоке; `true`, если
/// система приняла вызов.
#[cfg(windows)]
#[allow(unsafe_code)]
fn set_thread_mode(mode: i32) -> bool {
    // SAFETY: псевдодескриптор текущего потока закрывать не нужно, остальные
    // аргументы — числа.
    let status = unsafe { SetThreadPriority(GetCurrentThread(), mode) };
    std::num::NonZeroI32::new(status).is_some()
}

#[cfg(not(windows))]
fn set_thread_mode(_mode: i32) -> bool {
    false
}

/// Режим запрещает только значение `0` (после обрезки пробелов).
fn background_permitted() -> bool {
    permits(env::var(BACKGROUND_ENV))
}

fn permits(value: Result<String, env::VarError>) -> bool {
    !matches!(value, Ok(text) if text.trim() == "0")
}

/// Порог «малой записи» из выключателя: нет переменной, пусто, «0» и любое слово, кроме
/// `1`/`on`/`true`/`yes` (без учёта регистра), — выключено; слово или `1` — порог по умолчанию;
/// число от 2 — столько МиБ.
fn small_writes_from(value: Result<String, env::VarError>) -> Option<u64> {
    let text = value.ok()?;
    let text = text.trim();
    if let Ok(megabytes) = text.parse::<u64>() {
        return match megabytes {
            0 => None,
            1 => Some(SMALL_WRITES_BYTES),
            more => Some(more.saturating_mul(MEGABYTE)),
        };
    }
    ["on", "true", "yes"]
        .iter()
        .any(|word| text.eq_ignore_ascii_case(word))
        .then_some(SMALL_WRITES_BYTES)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Off,
    On,
}

/// Фоновый режим ввода-вывода и памяти текущего потока (только Windows).
/// Выход из режима действует на тот поток, который его вызвал. Режим можно
/// приостановить и вернуть (`suspend`, `resume`), но только в потоке, который
/// его начал: система не даёт менять режим чужого потока.
pub struct BackgroundIo {
    mode: Mode,
    /// Режим допустим: вход удался и его не кончали насовсем.
    allowed: bool,
    owner: ThreadId,
}

impl BackgroundIo {
    pub fn begin() -> Self {
        let entered = background_permitted() && set_thread_mode(THREAD_MODE_BACKGROUND_BEGIN);
        Self {
            mode: if entered { Mode::On } else { Mode::Off },
            allowed: entered,
            owner: thread::current().id(),
        }
    }

    /// Вход отложен: поток пока в обычном приоритете, а режим включит `resume` в том же потоке
    /// (малые записи без фона, `SMALL_WRITES_ENV`). Разрешён он при тех же условиях, что и `begin`.
    pub fn deferred() -> Self {
        Self {
            mode: Mode::Off,
            allowed: background_permitted(),
            owner: thread::current().id(),
        }
    }

    pub fn is_active(&self) -> bool {
        self.mode == Mode::On
    }

    /// Насовсем: вернуть режим уже нельзя.
    pub fn end(&mut self) {
        self.allowed = false;
        if mem::replace(&mut self.mode, Mode::Off) == Mode::On {
            set_thread_mode(THREAD_MODE_BACKGROUND_END);
        }
    }

    fn on_owner_thread(&self) -> bool {
        thread::current().id() == self.owner
    }

    /// Снимает режим с потока, который его начал, но оставляет право вернуть.
    /// `true`, если режим снят.
    pub fn suspend(&mut self) -> bool {
        if self.mode != Mode::On || !self.on_owner_thread() {
            return false;
        }
        self.mode = Mode::Off;
        set_thread_mode(THREAD_MODE_BACKGROUND_END);
        true
    }

    /// Возвращает снятый режим, если его не кончали насовсем (сторож голода)
    /// и вызов идёт в том же потоке. `true`, если режим снова включён.
    pub fn resume(&mut self) -> bool {
        if !self.allowed || self.mode != Mode::Off || !self.on_owner_thread() {
            return false;
        }
        if set_thread_mode(THREAD_MODE_BACKGROUND_BEGIN) {
            self.mode = Mode::On;
        }
        self.mode == Mode::On
    }
}

impl Drop for BackgroundIo {
    fn drop(&mut self) {
        self.end();
    }
}

/// За чем следит спящий пейсер: живые потолки и номер состояния, при котором он лёг спать.
pub(crate) type Watch<'a> = Option<(&'a LiveLimits, u64)>;

/// Часы и сон пейсера. В поставке настоящие, в проверках подменяются.
pub(crate) trait TimeSource {
    fn moment(&mut self) -> Instant;
    /// Спит `pause`. С `watch` просыпается раньше, когда живые потолки
    /// сменились; `true` — проснулся из-за смены.
    fn wait(&mut self, pause: Duration, watch: Watch<'_>) -> bool;
}

struct RealTime;

impl TimeSource for RealTime {
    fn moment(&mut self) -> Instant {
        Instant::now()
    }

    fn wait(&mut self, pause: Duration, watch: Watch<'_>) -> bool {
        match watch {
            Some((live, seen)) => live.nap(pause, seen),
            None => {
                thread::sleep(pause);
                false
            }
        }
    }
}

/// Окно, в котором сторож меряет скорость записи.
struct Sample {
    opened: Instant,
    bytes: u64,
}

impl Sample {
    /// Если окно живёт не меньше секунды, закрывает его и отдаёт среднюю
    /// скорость в байтах в секунду; новое окно начинается с `now`.
    fn settle(&mut self, now: Instant) -> Option<f64> {
        let lived = now.saturating_duration_since(self.opened);
        if lived < SPEED_WINDOW {
            return None;
        }
        let bytes = mem::take(&mut self.bytes);
        self.opened = now;
        Some(bytes as f64 / lived.as_secs_f64())
    }
}

/// Состояние сторожа: голод отсчитывается от конца первого медленного окна,
/// снятие фона необратимо.
#[derive(Clone, Copy)]
enum Appetite {
    Fed,
    Starving { since: Instant },
    Released,
}

impl Appetite {
    fn after(self, speed: f64, threshold: f64, at: Instant) -> Self {
        let slow = speed < threshold;
        match (self, slow) {
            (Appetite::Released, _) => Appetite::Released,
            (_, false) => Appetite::Fed,
            (Appetite::Fed, true) => Appetite::Starving { since: at },
            (Appetite::Starving { since }, true)
                if at.saturating_duration_since(since) >= STARVED_FOR =>
            {
                Appetite::Released
            }
            (still, true) => still,
        }
    }
}

/// Сколько ещё спать, чтобы средняя скорость с начала записи не превысила
/// потолок. Потолок «ноль» и срок, не помещающийся в `Duration`, дают панику
/// стандартной библиотеки: так и задумано.
fn pause_owed(written: u64, ceiling: u64, elapsed: Duration, napped: Duration) -> Duration {
    let due = Duration::from_secs(1).mul_f64(written as f64 / ceiling as f64);
    due.saturating_sub(elapsed.max(napped))
}

/// Потолок средней скорости записи и сторож голода фонового режима.
pub struct WritePacer {
    ceiling: Option<u64>,
    background: BackgroundIo,
    origin: Instant,
    /// Всё записанное командой.
    total: u64,
    /// Записанное с начала текущего отсчёта потолка: по нему считается долг.
    paced: u64,
    napped: Duration,
    sample: Sample,
    appetite: Appetite,
    /// Живые потолки запроса (только внутри `serve`) и номер их состояния,
    /// с которым пейсер сверился в последний раз.
    live: Option<Arc<LiveLimits>>,
    seen_epoch: u64,
    /// Малые записи без фона: фон ещё не начат и начнётся, когда записано столько байт
    /// (`None` — не откладывается: вход в фон уже был или выключатель не стоит).
    defer_background: Option<u64>,
    /// Потолок снят каналом управления: фон не нужен (последнее, что видел пейсер).
    unbraked: bool,
}

impl WritePacer {
    /// Потолок из параметров команды. Внутри `serve` его уже мог поменять канал
    /// управления: тогда выбирает он, а пейсер дальше сам следит за сменами.
    pub fn from_options(options: &Options) -> Self {
        let initial = limit_from(options.optional(LIMIT_OPTION));
        let live = current_live();
        let view = live.as_ref().map(|live| live.adopt_write(initial));
        let ceiling = view.map_or(initial, |view| view.ceiling);
        let defer = small_writes_from(env::var(SMALL_WRITES_ENV));
        let background = if defer.is_some() {
            BackgroundIo::deferred()
        } else {
            BackgroundIo::begin()
        };
        let mut pacer = Self::started_at(ceiling, background, Instant::now());
        pacer.defer_background = defer;
        if let (Some(live), Some(view)) = (live, view) {
            pacer.seen_epoch = view.epoch;
            pacer.live = Some(live);
            pacer.sync_background(view.unbraked);
        }
        pacer
    }

    pub fn new(limit_bytes_per_second: Option<u64>, background: BackgroundIo) -> Self {
        Self::started_at(limit_bytes_per_second, background, Instant::now())
    }

    pub(crate) fn started_at(
        ceiling: Option<u64>,
        background: BackgroundIo,
        origin: Instant,
    ) -> Self {
        Self {
            // Ноль - не «пиши нулём байт в секунду», а «потолка нет», как в опции.
            ceiling: ceiling.filter(|&bytes_per_second| bytes_per_second > 0),
            background,
            origin,
            total: 0,
            paced: 0,
            napped: Duration::ZERO,
            sample: Sample {
                opened: origin,
                bytes: 0,
            },
            appetite: Appetite::Fed,
            live: None,
            seen_epoch: 0,
            defer_background: None,
            unbraked: false,
        }
    }

    /// Малые записи без фона: пока команда записала меньше `bytes`, поток остаётся в обычном
    /// приоритете; потом входит в фон, как обычно. Фон должен быть создан через
    /// `BackgroundIo::deferred`.
    pub fn defer_background_until(&mut self, bytes: u64) {
        self.defer_background = Some(bytes);
    }

    /// Вход в фон ещё не начат: команда пишет в обычном приоритете, пока не записала порог.
    pub fn defers_background(&self) -> bool {
        self.defer_background.is_some()
    }

    /// Учитывает записанный кусок и возвращается после всех ожиданий потолка.
    pub fn wrote(&mut self, bytes: u64) {
        self.account(bytes, &mut RealTime);
    }

    pub fn released(&self) -> bool {
        matches!(self.appetite, Appetite::Released)
    }

    pub fn written(&self) -> u64 {
        self.total
    }

    /// Потолок записи сейчас.
    pub fn ceiling(&self) -> Option<u64> {
        self.ceiling
    }

    /// Сверка с живыми потолками: смена потолка начинает отсчёт заново (долг
    /// прежнего потолка не переносится), фоновый режим следует за ним.
    fn refresh(&mut self, now: Instant) {
        let Some(live) = self.live.as_ref() else {
            return;
        };
        if live.epoch() == self.seen_epoch {
            return;
        }
        let view = live.write_view();
        self.seen_epoch = view.epoch;
        if view.ceiling != self.ceiling {
            self.ceiling = view.ceiling;
            self.origin = now;
            self.paced = 0;
            self.napped = Duration::ZERO;
            self.sample = Sample {
                opened: now,
                bytes: 0,
            };
            self.appetite = Appetite::Fed;
        }
        self.sync_background(view.unbraked);
    }

    /// Без тормоза фоновый приоритет потоку записи не нужен; с потолком он
    /// возвращается (если сторож голода не снял его насовсем).
    fn sync_background(&mut self, unbraked: bool) {
        self.unbraked = unbraked;
        if unbraked {
            self.background.suspend();
        } else if self.defer_background.is_none() {
            self.background.resume();
        }
    }

    pub(crate) fn account(&mut self, bytes: u64, time: &mut impl TimeSource) {
        let mut now = time.moment();
        self.refresh(now);
        self.total += bytes;
        self.paced += bytes;
        self.sample.bytes += bytes;
        // малые записи без фона кончились: теперь команда не короткая, поток входит в фон (если это
        // допустимо: сторож голода не отпускал его, канал управления не снял потолок)
        if self.defer_background.is_some_and(|limit| self.total >= limit) {
            self.defer_background = None;
            if !self.unbraked {
                self.background.resume();
            }
        }
        if let Some(speed) = self.sample.settle(now) {
            self.judge(speed, now);
        }
        while let Some(ceiling) = self.ceiling {
            let elapsed = now.saturating_duration_since(self.origin);
            let pause = pause_owed(self.paced, ceiling, elapsed, self.napped);
            // Отменяемая команда потолка не ждёт: ей дорога до точки остановки.
            if pause.is_zero() || self.live.as_deref().is_some_and(LiveLimits::halted) {
                return;
            }
            let watch = self.live.as_deref().map(|live| (live, self.seen_epoch));
            if !time.wait(pause, watch) {
                self.napped += pause;
                return;
            }
            // Потолок сменился во сне: спим заново по новому или не спим вовсе.
            now = time.moment();
            self.refresh(now);
        }
    }

    /// Сторож: ниже порога дольше `STARVED_FOR` фон снимается насовсем.
    fn judge(&mut self, speed: f64, now: Instant) {
        if !self.background.is_active() {
            return;
        }
        self.appetite = self.appetite.after(speed, self.starvation_floor(), now);
        if self.released() {
            self.background.end();
        }
    }

    /// Под своим потолком «медленно» не значит «голодно»: порог не выше
    /// половины потолка.
    fn starvation_floor(&self) -> f64 {
        self.ceiling.map_or(STARVED_BYTES_PER_SECOND, |ceiling| {
            (ceiling as f64 / 2.0).min(STARVED_BYTES_PER_SECOND)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    const MIB: u64 = 1024 * 1024;

    /// Подставные часы: сон двигает время ровно на просьбу. Расписанные смены
    /// живых потолков наступают в свой момент, в том числе посреди сна.
    struct FakeTime {
        origin: Instant,
        now: Duration,
        sleeps: Vec<Duration>,
        changes: Vec<(Duration, Change)>,
        live: Option<Arc<LiveLimits>>,
    }

    impl FakeTime {
        fn new() -> Self {
            Self {
                origin: Instant::now(),
                now: Duration::ZERO,
                sleeps: Vec::new(),
                changes: Vec::new(),
                live: None,
            }
        }

        /// Смена потолков в момент `seconds` (по часам теста).
        fn change_at(&mut self, seconds: f64, change: Change) {
            self.changes
                .push((Duration::from_secs_f64(seconds), change));
            self.changes.sort_by_key(|(at, _)| *at);
        }

        /// Применяет смены, которым пришёл срок.
        fn due_changes(&mut self) {
            while let Some((at, change)) = self.changes.first().copied() {
                if at > self.now {
                    break;
                }
                self.changes.remove(0);
                self.live.as_ref().expect("живые потолки").apply(change);
            }
        }

        /// Часы не идут назад: ждём наступления момента `seconds`.
        fn at(&mut self, seconds: f64) {
            self.now = self.now.max(Duration::from_secs_f64(seconds));
        }

        fn slept(&self) -> f64 {
            self.sleeps.iter().map(Duration::as_secs_f64).sum()
        }
    }

    impl TimeSource for FakeTime {
        fn moment(&mut self) -> Instant {
            self.due_changes();
            self.origin + self.now
        }

        fn wait(&mut self, pause: Duration, watch: Watch<'_>) -> bool {
            let wake = self.now + pause;
            let interrupt = self
                .changes
                .first()
                .map(|(at, _)| *at)
                .filter(|&at| watch.is_some() && at < wake);
            match interrupt {
                Some(at) => {
                    let slept = at.saturating_sub(self.now);
                    self.sleeps.push(slept);
                    self.now = self.now.max(at);
                    self.due_changes();
                    true
                }
                None => {
                    self.sleeps.push(pause);
                    self.now = wake;
                    false
                }
            }
        }
    }

    /// Фон не активен: вход и сразу выход.
    fn idle_io() -> BackgroundIo {
        let mut io = BackgroundIo::begin();
        io.end();
        io
    }

    fn write_all(limit: Option<u64>, writes: &[(f64, u64)]) -> (FakeTime, WritePacer) {
        let mut time = FakeTime::new();
        let mut pacer = WritePacer::started_at(limit, idle_io(), time.origin);
        for &(at, bytes) in writes {
            time.at(at);
            pacer.account(bytes, &mut time);
        }
        (time, pacer)
    }

    #[test]
    fn limit_reads_megabytes_and_treats_zero_and_garbage_as_none() {
        assert_eq!(limit_from(None), None);
        assert_eq!(limit_from(Some("50")), Some(52_428_800));
        assert_eq!(limit_from(Some(" 25 ")), Some(26_214_400));
        assert_eq!(limit_from(Some("25\n")), Some(26_214_400));
        assert_eq!(limit_from(Some("\u{a0}7\u{a0}")), Some(7_340_032));
        assert_eq!(limit_from(Some("+5")), Some(5_242_880));
        assert_eq!(limit_from(Some("007")), Some(7_340_032));
        assert_eq!(limit_from(Some("4398046511104")), Some(1 << 62));
        for garbage in [
            "",
            " ",
            "0",
            "00",
            "-1",
            "-0",
            "5.5",
            "1e3",
            "0x10",
            "1_000",
            "NaN",
            "быстро",
            "18446744073709551616",
        ] {
            assert_eq!(limit_from(Some(garbage)), None, "{garbage:?}");
        }
    }

    #[test]
    fn a_huge_limit_saturates_instead_of_overflowing() {
        // 2^44 - 1 МБ ещё помещается в u64.
        assert_eq!(
            limit_from(Some("17592186044415")),
            Some(18_446_744_073_708_503_040)
        );
        // Дальше потолок упирается в u64::MAX: ни паники, ни нуля по кругу
        // (ноль в WritePacer раньше ронял первую запись).
        for megabytes in ["17592186044416", "17592186044417", "18446744073709551615"] {
            assert_eq!(limit_from(Some(megabytes)), Some(u64::MAX), "{megabytes}");
        }
    }

    #[test]
    fn delta_follows_a_growing_counter_and_a_step_back() {
        let mut last = 0;
        let steps: Vec<u64> = [10, 25, 25, 5, 8]
            .into_iter()
            .map(|total| delta(&mut last, total))
            .collect();
        assert_eq!(steps, [10, 15, 0, 0, 3]);
        assert_eq!(last, 8);

        let mut last = u64::MAX;
        assert_eq!(delta(&mut last, 0), 0);
        assert_eq!(delta(&mut last, 1), 1);
    }

    #[test]
    fn pause_is_the_debt_against_the_average_rate() {
        let second = Duration::from_secs(1);
        let zero = Duration::ZERO;
        assert_eq!(pause_owed(30 * MIB, 10 * MIB, zero, zero), 3 * second);
        assert_eq!(pause_owed(MIB, MIB, second / 2, zero), second / 2);
        // простой копит запас: за 100 с при 10 МБ/с можно сразу записать 1000 МБ
        let idle = 100 * second;
        assert_eq!(pause_owed(100 * MIB, 10 * MIB, idle, zero), zero);
        assert_eq!(pause_owed(1100 * MIB, 10 * MIB, idle, zero), 10 * second);
        // уже проспанное тоже считается прошедшим
        assert_eq!(pause_owed(MIB, MIB, zero, second), zero);
        assert_eq!(pause_owed(0, MIB, zero, zero), zero);
    }

    #[test]
    fn ceiling_makes_the_write_wait_for_the_average_rate() {
        let writes = vec![(0.0, MIB); 30];
        let (time, pacer) = write_all(Some(10 * MIB), &writes);
        assert!((time.slept() - 3.0).abs() < 1e-6, "{}", time.slept());
        assert_eq!(time.sleeps.len(), 30);
        assert_eq!(pacer.written(), 30 * MIB);

        // 1 МБ/с, записи по 512 КБ вдвое быстрее потолка: спим недостающее
        let fast = [
            (0.25, MIB / 2),
            (0.5, MIB / 2),
            (0.75, MIB / 2),
            (1.0, MIB / 2),
        ];
        let (time, _) = write_all(Some(MIB), &fast);
        let seconds: Vec<f64> = time.sleeps.iter().map(Duration::as_secs_f64).collect();
        assert_eq!(seconds, [0.25, 0.5, 0.5, 0.5]);
    }

    #[test]
    fn without_ceiling_nothing_waits() {
        let writes = vec![(0.0, 8 * MIB); 1000];
        let (time, pacer) = write_all(None, &writes);
        assert!(time.sleeps.is_empty());
        assert_eq!(pacer.written(), 8000 * MIB);
        assert!(!pacer.released());
    }

    #[test]
    fn a_zero_ceiling_is_no_ceiling() {
        // Так же, как «0» в самой опции: потолка нет, запись не спит и не падает.
        for bytes in [0, 1, 8 * MIB] {
            let (time, pacer) = write_all(Some(0), &[(0.0, bytes), (1.0, bytes)]);
            assert!(
                time.sleeps.is_empty(),
                "wrote({bytes}) при потолке «ноль байт»"
            );
            assert_eq!(pacer.written(), 2 * bytes);
        }
    }

    /// Расписание «момент, байт»; отдаёт момент, на котором сторож отпустил фон.
    #[cfg(windows)]
    fn released_at(limit: Option<u64>, schedule: &[(f64, u64)]) -> Option<f64> {
        let mut time = FakeTime::new();
        let io = BackgroundIo::begin();
        assert!(io.is_active(), "фон должен быть разрешён");
        let mut pacer = WritePacer::started_at(limit, io, time.origin);
        for &(at, bytes) in schedule {
            time.at(at);
            pacer.account(bytes, &mut time);
            if pacer.released() {
                return Some(at);
            }
        }
        None
    }

    #[cfg(windows)]
    fn every_second(from: u32, to: u32, bytes: u64) -> Vec<(f64, u64)> {
        (from..=to).map(|t| (f64::from(t), bytes)).collect()
    }

    #[cfg(windows)]
    #[test]
    fn watchdog_releases_background_after_starving_long_enough() {
        // голод считается от конца первого медленного окна (10-я секунда)
        assert_eq!(released_at(None, &[(10.0, 1024), (24.999, 1024)]), None);
        assert_eq!(released_at(None, &[(10.0, 1024), (25.0, 1024)]), Some(25.0));
        // при записи раз в секунду отпускает на записи в 16-й секунде
        assert_eq!(released_at(None, &every_second(1, 20, 1024)), Some(16.0));
        assert_eq!(released_at(None, &every_second(1, 15, 1024)), None);
        // ровно на пороге (8 МБ/с) голода нет, на байт ниже есть
        assert_eq!(released_at(None, &every_second(1, 20, 8 * MIB)), None);
        assert_eq!(
            released_at(None, &every_second(1, 20, 8 * MIB - 1)),
            Some(16.0)
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_fast_window_resets_the_watchdog() {
        let mut schedule = every_second(1, 10, 1024);
        schedule.push((11.0, 100 * MIB));
        schedule.extend(every_second(12, 40, 1024));
        // отсчёт начался заново с 12-й секунды
        assert_eq!(released_at(None, &schedule), Some(27.0));
    }

    #[cfg(windows)]
    #[test]
    fn slow_under_own_ceiling_is_not_starving() {
        // порог под потолком — меньшее из половины потолка и 8 МБ/с
        assert_eq!(released_at(Some(2 * MIB), &every_second(1, 20, MIB)), None);
        assert_eq!(
            released_at(Some(2 * MIB), &every_second(1, 20, MIB - 1)),
            Some(16.0)
        );
        assert_eq!(
            released_at(Some(20 * MIB), &every_second(1, 20, 9 * MIB)),
            None
        );
        assert_eq!(
            released_at(Some(20 * MIB), &every_second(1, 20, 7 * MIB)),
            Some(16.0)
        );
    }

    #[test]
    fn without_background_the_watchdog_has_nothing_to_release() {
        let schedule: Vec<(f64, u64)> = (1..=20).map(|t| (f64::from(t), 1024)).collect();
        let (_, pacer) = write_all(None, &schedule);
        assert!(!pacer.released());
    }

    #[test]
    fn only_a_zero_in_the_variable_forbids_the_background_mode() {
        let text = |value: &str| Ok(value.to_owned());
        for forbidden in ["0", " 0 ", "0\n", "\u{a0}0"] {
            assert!(!permits(text(forbidden)), "{forbidden:?}");
        }
        for allowed in [
            "", "00", "-0", "0.0", "00 ", "1", "true", "false", "off", "no",
        ] {
            assert!(permits(text(allowed)), "{allowed:?}");
        }
        assert!(permits(Err(env::VarError::NotPresent)));
        assert!(permits(Err(env::VarError::NotUnicode(OsString::from("0")))));
    }

    #[test]
    fn the_small_writes_switch_reads_a_word_a_one_or_a_number_of_megabytes() {
        let text = |value: &str| Ok(value.to_owned());
        for off in ["", " ", "0", " 0 ", "off", "no", "false", "-1", "2x", "1.5", "оn"] {
            assert_eq!(small_writes_from(text(off)), None, "{off:?}");
        }
        for default in ["1", " 1 ", "on", "ON", "true", "True", "yes"] {
            assert_eq!(small_writes_from(text(default)), Some(SMALL_WRITES_BYTES), "{default:?}");
        }
        assert_eq!(small_writes_from(text("2")), Some(2 * MIB));
        assert_eq!(small_writes_from(text("128")), Some(128 * MIB));
        assert_eq!(small_writes_from(text("18446744073709551615")), Some(u64::MAX));
        assert_eq!(small_writes_from(Err(env::VarError::NotPresent)), None);
        assert_eq!(small_writes_from(Err(env::VarError::NotUnicode(OsString::from("1")))), None);
    }

    #[test]
    fn without_the_switch_the_pacer_enters_the_background_at_once_as_before() {
        let turn = crate::test_support::env_lock();
        env::remove_var(SMALL_WRITES_ENV);
        let pacer = WritePacer::from_options(&options(&[]));
        assert!(!pacer.defers_background());
        drop(pacer);
        // с выключателем: поток в обычном приоритете, пока команда не записала порог
        env::set_var(SMALL_WRITES_ENV, "3");
        let mut deferred = WritePacer::from_options(&options(&[]));
        env::remove_var(SMALL_WRITES_ENV);
        drop(turn);
        assert!(deferred.defers_background());
        let mut time = FakeTime::new();
        deferred.account(3 * MIB - 1, &mut time);
        assert!(deferred.defers_background(), "на байт меньше порога: запись всё ещё малая");
        deferred.account(1, &mut time);
        assert!(!deferred.defers_background());
        assert_eq!(deferred.written(), 3 * MIB);
    }

    #[test]
    fn a_deferred_background_waits_for_the_threshold_and_does_not_come_back_before_it() {
        let mut time = FakeTime::new();
        let mut pacer = WritePacer::started_at(None, BackgroundIo::deferred(), time.origin);
        pacer.defer_background_until(10 * MIB);
        assert!(pacer.defers_background());
        assert!(!pacer.background.is_active());
        // смена потолков каналом управления до порога фон не включает
        pacer.sync_background(false);
        assert!(!pacer.background.is_active(), "возврат фона не обгоняет порог");
        pacer.account(4 * MIB, &mut time);
        pacer.account(5 * MIB, &mut time);
        assert!(pacer.defers_background() && !pacer.background.is_active(), "9 МиБ из 10: ещё малая запись");
        pacer.account(MIB, &mut time);
        assert!(!pacer.defers_background());
        #[cfg(windows)]
        assert_eq!(pacer.background.is_active(), background_permitted());
        // порог при снятом потолке: фон не нужен и не включается
        let mut free = WritePacer::started_at(None, BackgroundIo::deferred(), time.origin);
        free.defer_background_until(MIB);
        free.sync_background(true);
        free.account(2 * MIB, &mut time);
        assert!(!free.defers_background() && !free.background.is_active());
    }

    #[cfg(windows)]
    #[test]
    fn a_short_command_keeps_the_normal_io_priority_and_a_long_one_goes_to_the_background() {
        std::thread::spawn(|| {
            let mut time = FakeTime::new();
            let mut pacer = WritePacer::started_at(None, BackgroundIo::deferred(), time.origin);
            pacer.defer_background_until(10 * MIB);
            assert_eq!(thread_priority(), 0);
            pacer.account(79_053, &mut time);
            assert_eq!(thread_priority(), 0, "дозапись на килобайты идёт в обычном приоритете");
            pacer.account(10 * MIB, &mut time);
            if background_permitted() {
                assert_eq!(thread_priority(), -4, "длинная запись ушла в фон");
            }
            drop(pacer);
            assert_eq!(thread_priority(), 0);
        })
        .join()
        .unwrap();
    }

    #[cfg(windows)]
    #[allow(unsafe_code)]
    fn thread_priority() -> i32 {
        extern "system" {
            fn GetThreadPriority(thread: isize) -> i32;
        }
        // SAFETY: псевдодескриптор текущего потока.
        unsafe { GetThreadPriority(GetCurrentThread()) }
    }

    #[cfg(windows)]
    #[test]
    fn windows_really_puts_the_thread_into_background_mode() {
        std::thread::spawn(|| {
            assert_eq!(thread_priority(), 0);
            let mut first = BackgroundIo::begin();
            if !first.is_active() {
                return; // окружение запретило фон
            }
            assert_eq!(thread_priority(), -4);
            let second = BackgroundIo::begin();
            assert!(
                !second.is_active(),
                "второй вход в том же потоке отказывает"
            );
            drop(second);
            assert_eq!(thread_priority(), -4);
            first.end();
            first.end();
            assert_eq!(thread_priority(), 0);
            let again = BackgroundIo::begin();
            assert!(again.is_active());
            drop(again);
            assert_eq!(thread_priority(), 0);
        })
        .join()
        .unwrap();
    }

    // ----- живые потолки -----

    fn options(parts: &[&str]) -> Options {
        let words: Vec<String> = parts.iter().map(|part| (*part).to_owned()).collect();
        Options::parse(&words).unwrap()
    }

    const WRITE_NONE: Change = Change {
        write: Some(None),
        read: None,
    };

    fn write_to(megabytes: u64) -> Change {
        Change {
            write: Some(limit_from_megabytes(megabytes)),
            read: None,
        }
    }

    fn read_to(megabytes: u64) -> Change {
        Change {
            write: None,
            read: Some(limit_from_megabytes(megabytes)),
        }
    }

    /// Пейсер с живыми потолками: начальный потолок берёт у них, как команда.
    fn live_pacer(limit: Option<u64>, time: &mut FakeTime) -> (WritePacer, Arc<LiveLimits>) {
        let live = LiveLimits::new();
        let view = live.adopt_write(limit);
        time.live = Some(Arc::clone(&live));
        let mut pacer = WritePacer::started_at(view.ceiling, idle_io(), time.origin);
        pacer.live = Some(Arc::clone(&live));
        pacer.seen_epoch = view.epoch;
        (pacer, live)
    }

    #[test]
    fn megabytes_of_the_control_line_become_bytes() {
        assert_eq!(limit_from_megabytes(0), None);
        assert_eq!(limit_from_megabytes(250), Some(250 * MIB));
        assert_eq!(limit_from_megabytes(u64::MAX), Some(u64::MAX));
    }

    #[test]
    fn a_zero_in_a_change_is_no_ceiling_not_a_division_by_zero() {
        let mut time = FakeTime::new();
        let (mut pacer, live) = live_pacer(Some(MIB), &mut time);
        live.apply(Change {
            write: Some(Some(0)),
            read: Some(Some(0)),
        });
        pacer.account(10 * MIB, &mut time);
        assert_eq!(pacer.ceiling(), None);
        assert!(time.sleeps.is_empty());
        let view = live.write_view();
        assert_eq!(view.ceiling, None);
        assert!(view.unbraked);
        assert_eq!(live.read_ceiling(), None);
    }

    #[test]
    fn a_lifted_ceiling_wakes_a_sleeping_pacer_at_once() {
        let mut time = FakeTime::new();
        let (mut pacer, _live) = live_pacer(Some(MIB), &mut time);
        time.change_at(2.0, WRITE_NONE);
        // 30 МиБ при 1 МиБ/с — полминуты сна, но через две секунды потолок снят.
        pacer.account(30 * MIB, &mut time);
        assert!((time.slept() - 2.0).abs() < 1e-6, "{}", time.slept());
        assert_eq!(pacer.ceiling(), None);
        // Дальше запись идёт без ожиданий.
        pacer.account(500 * MIB, &mut time);
        assert!((time.slept() - 2.0).abs() < 1e-6, "{}", time.slept());
        assert_eq!(pacer.written(), 530 * MIB);
    }

    #[test]
    fn a_new_ceiling_counts_from_the_moment_of_the_change() {
        let mut time = FakeTime::new();
        let (mut pacer, _live) = live_pacer(None, &mut time);
        time.at(10.0);
        pacer.account(500 * MIB, &mut time);
        assert!(time.sleeps.is_empty());
        // Потолок вернули: прошлые 500 МиБ в долг не идут, следующий МиБ стоит секунду.
        time.change_at(10.0, write_to(1));
        pacer.account(MIB, &mut time);
        assert_eq!(pacer.ceiling(), Some(MIB));
        assert!((time.slept() - 1.0).abs() < 1e-6, "{}", time.slept());
    }

    #[test]
    fn a_lowered_ceiling_in_the_middle_of_a_sleep_drops_the_old_debt() {
        let mut time = FakeTime::new();
        let (mut pacer, _live) = live_pacer(Some(2 * MIB), &mut time);
        time.change_at(1.0, write_to(1));
        // 10 МиБ при 2 МиБ/с — пять секунд; на первой секунде потолок стал 1 МиБ/с.
        pacer.account(10 * MIB, &mut time);
        assert!((time.slept() - 1.0).abs() < 1e-6, "{}", time.slept());
        assert_eq!(pacer.ceiling(), Some(MIB));
        pacer.account(2 * MIB, &mut time);
        assert!((time.slept() - 3.0).abs() < 1e-6, "{}", time.slept());
    }

    #[test]
    fn a_change_of_the_other_ceiling_keeps_the_debt_of_this_one() {
        let mut time = FakeTime::new();
        let (mut pacer, _live) = live_pacer(Some(MIB), &mut time);
        time.change_at(0.5, read_to(40));
        pacer.account(4 * MIB, &mut time);
        // Проснулись на полсекунде из-за чужой смены и доспали остальное: всего четыре секунды.
        assert!((time.slept() - 4.0).abs() < 1e-6, "{}", time.slept());
        assert_eq!(time.sleeps.len(), 2);
        assert_eq!(pacer.ceiling(), Some(MIB));
    }

    #[test]
    fn a_control_before_the_command_beats_the_option_and_stays() {
        let live = LiveLimits::new();
        live.apply(write_to(2));
        let view = live.adopt_write(limit_from_megabytes(9));
        assert_eq!(view.ceiling, Some(2 * MIB));
        assert!(!view.unbraked);

        let live = LiveLimits::new();
        live.apply(WRITE_NONE);
        let view = live.adopt_write(limit_from_megabytes(5));
        assert_eq!(view.ceiling, None);
        assert!(view.unbraked, "ноль по каналу — без тормоза и без фона");
    }

    #[test]
    fn an_option_alone_never_counts_as_unbraked() {
        let live = LiveLimits::new();
        let view = live.adopt_write(None);
        assert_eq!(view.ceiling, None);
        assert!(!view.unbraked, "без команды управления поведение прежнее");
        assert_eq!(view.epoch, 0);
        // Второй выбор из параметров первый не перебивает.
        let again = live.adopt_write(limit_from_megabytes(3));
        assert_eq!(again.ceiling, None);
    }

    #[test]
    fn a_pacer_built_inside_a_scope_follows_the_context() {
        std::thread::spawn(|| {
            let live = LiveLimits::new();
            let _scope = live.enter();
            live.apply(WRITE_NONE);
            let pacer = WritePacer::from_options(&options(&["--write-limit-mbps", "4"]));
            assert_eq!(pacer.ceiling(), None, "канал управления важнее параметра");
        })
        .join()
        .unwrap();
        std::thread::spawn(|| {
            let live = LiveLimits::new();
            let _scope = live.enter();
            let mut pacer = WritePacer::from_options(&options(&["--write-limit-mbps", "4"]));
            assert_eq!(pacer.ceiling(), Some(4 * MIB));
            live.apply(write_to(8));
            pacer.wrote(1);
            assert_eq!(pacer.ceiling(), Some(8 * MIB));
        })
        .join()
        .unwrap();
    }

    #[test]
    fn without_a_scope_the_pacer_ignores_live_limits() {
        std::thread::spawn(|| {
            assert!(current_live().is_none());
            let pacer = WritePacer::from_options(&options(&["--write-limit-mbps", "4"]));
            assert_eq!(pacer.ceiling(), Some(4 * MIB));
            assert!(pacer.live.is_none());
        })
        .join()
        .unwrap();
    }

    #[test]
    fn a_real_sleeper_wakes_within_a_second_of_a_change() {
        let live = LiveLimits::new();
        let worker = {
            let live = Arc::clone(&live);
            std::thread::spawn(move || {
                let view = live.adopt_write(limit_from_megabytes(1));
                let mut pacer = WritePacer::started_at(view.ceiling, idle_io(), Instant::now());
                pacer.live = Some(Arc::clone(&live));
                pacer.seen_epoch = view.epoch;
                let started = Instant::now();
                pacer.wrote(8 * MIB);
                started.elapsed()
            })
        };
        std::thread::sleep(Duration::from_millis(300));
        let lifted = Instant::now();
        live.apply(WRITE_NONE);
        let slept = worker.join().unwrap();
        assert!(
            lifted.elapsed() < Duration::from_secs(1),
            "после смены потолка пейсер спал ещё {:?}",
            lifted.elapsed()
        );
        assert!(slept < Duration::from_secs(3), "{slept:?}");
    }

    #[test]
    fn a_read_ceiling_set_by_control_reaches_the_ribbon_of_the_request() {
        std::thread::spawn(|| {
            let live = LiveLimits::new();
            let _scope = live.enter();
            let pace = rage_rpf::read_pace::current();
            assert_eq!(pace.limit(), None);
            // Параметр команды ложится на ленту этого же запроса.
            apply_read_limit(&options(&["--read-limit-mbps", "3"]));
            assert_eq!(pace.limit(), Some(3 * MIB));
            live.apply(read_to(5));
            assert_eq!(pace.limit(), Some(5 * MIB));
            live.apply(Change {
                write: None,
                read: Some(None),
            });
            assert_eq!(pace.limit(), None);
            // Параметр не перебивает то, что уже решил канал управления.
            apply_read_limit(&options(&["--read-limit-mbps", "9"]));
            assert_eq!(pace.limit(), None);
            assert_eq!(live.read_ceiling(), None);
        })
        .join()
        .unwrap();
    }

    #[test]
    fn a_read_control_before_the_options_wins_and_the_scope_cleans_up() {
        std::thread::spawn(|| {
            let live = LiveLimits::new();
            {
                let _scope = live.enter();
                assert!(current_live().is_some());
                live.apply(read_to(7));
                apply_read_limit(&options(&["--read-limit-mbps", "2"]));
                assert_eq!(rage_rpf::read_pace::current().limit(), Some(7 * MIB));
            }
            assert!(current_live().is_none());
            // Вне контекста смена канала ленту потока уже не трогает.
            live.apply(read_to(1));
            assert_eq!(rage_rpf::read_pace::current().limit(), Some(7 * MIB));
            // Без контекста параметр ставится потоку, как раньше.
            apply_read_limit(&options(&["--read-limit-mbps", "3"]));
            assert_eq!(rage_rpf::read_pace::current().limit(), Some(3 * MIB));
        })
        .join()
        .unwrap();
    }

    #[test]
    fn two_scopes_in_two_threads_keep_separate_ceilings() {
        let first = LiveLimits::new();
        let second = LiveLimits::new();
        let (a, b) = (Arc::clone(&first), Arc::clone(&second));
        let one = std::thread::spawn(move || {
            let _scope = a.enter();
            apply_read_limit(&options(&["--read-limit-mbps", "1"]));
            std::thread::sleep(Duration::from_millis(200));
            rage_rpf::read_pace::current().limit()
        });
        let two = std::thread::spawn(move || {
            let _scope = b.enter();
            apply_read_limit(&options(&["--read-limit-mbps", "6"]));
            std::thread::sleep(Duration::from_millis(200));
            rage_rpf::read_pace::current().limit()
        });
        assert_eq!(one.join().unwrap(), Some(MIB));
        assert_eq!(two.join().unwrap(), Some(6 * MIB));
    }

    #[cfg(windows)]
    #[test]
    fn background_priority_follows_the_ceiling_and_returns_with_it() {
        std::thread::spawn(|| {
            let mut time = FakeTime::new();
            let live = LiveLimits::new();
            let io = BackgroundIo::begin();
            assert!(io.is_active(), "фон должен быть разрешён");
            let view = live.adopt_write(limit_from_megabytes(20));
            time.live = Some(Arc::clone(&live));
            let mut pacer = WritePacer::started_at(view.ceiling, io, time.origin);
            pacer.live = Some(Arc::clone(&live));
            pacer.seen_epoch = view.epoch;
            assert_eq!(thread_priority(), -4);

            live.apply(WRITE_NONE);
            pacer.account(1, &mut time);
            assert_eq!(thread_priority(), 0, "без тормоза фон снят");

            live.apply(write_to(20));
            pacer.account(1, &mut time);
            assert_eq!(thread_priority(), -4, "потолок вернулся — фон вернулся");

            // Повторный ноль и повторный потолок идемпотентны.
            live.apply(WRITE_NONE);
            live.apply(WRITE_NONE);
            pacer.account(1, &mut time);
            pacer.account(1, &mut time);
            assert_eq!(thread_priority(), 0);
            live.apply(write_to(20));
            pacer.account(1, &mut time);
            pacer.account(1, &mut time);
            assert_eq!(thread_priority(), -4);
            drop(pacer);
            assert_eq!(thread_priority(), 0);
        })
        .join()
        .unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn background_mode_is_not_changed_from_a_foreign_thread() {
        let owner = std::thread::spawn(|| {
            let io = BackgroundIo::begin();
            (io.is_active(), io)
        })
        .join()
        .unwrap();
        let (active, mut io) = owner;
        assert!(active, "фон должен быть разрешён");
        std::thread::spawn(move || {
            assert!(!io.suspend(), "чужой поток режим не снимает");
            assert!(io.is_active());
            // Режим снят, но вернуть его из чужого потока нельзя.
            io.mode = Mode::Off;
            assert!(!io.resume(), "чужой поток режим не включает");
        })
        .join()
        .unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_released_background_never_comes_back() {
        std::thread::spawn(|| {
            let mut io = BackgroundIo::begin();
            assert!(io.is_active(), "фон должен быть разрешён");
            io.end();
            assert_eq!(thread_priority(), 0);
            assert!(!io.resume(), "сторож голода снял фон насовсем");
            assert_eq!(thread_priority(), 0);
        })
        .join()
        .unwrap();
    }

    #[test]
    fn a_halted_command_does_not_wait_for_its_write_ceiling() {
        let mut time = FakeTime::new();
        let (mut pacer, live) = live_pacer(Some(MIB), &mut time);
        live.halt();
        pacer.account(30 * MIB, &mut time);
        assert!(time.sleeps.is_empty(), "{:?}", time.sleeps);
        assert_eq!(pacer.written(), 30 * MIB);
    }

    #[test]
    fn halting_wakes_a_real_sleeper_and_frees_the_read_ribbon() {
        let live = LiveLimits::new();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let worker = {
            let live = Arc::clone(&live);
            std::thread::spawn(move || {
                let _scope = live.enter();
                live.adopt_read(limit_from_megabytes(1));
                let view = live.adopt_write(limit_from_megabytes(1));
                let mut pacer = WritePacer::started_at(view.ceiling, idle_io(), Instant::now());
                pacer.live = Some(Arc::clone(&live));
                pacer.seen_epoch = view.epoch;
                ready_tx.send(()).unwrap();
                let started = Instant::now();
                pacer.wrote(8 * MIB);
                rage_rpf::read_pace::pace_read(8 * MIB);
                started.elapsed()
            })
        };
        ready_rx.recv().unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let halted = Instant::now();
        live.halt();
        let slept = worker.join().unwrap();
        assert!(
            halted.elapsed() < Duration::from_secs(1),
            "после отмены ждали ещё {:?}",
            halted.elapsed()
        );
        assert!(slept < Duration::from_secs(2), "{slept:?}");
        // Позднее значение канала отменённую команду не тормозит.
        live.apply(read_to(1));
        assert!(live.halted());
    }

    #[test]
    fn a_limits_line_changes_only_the_named_ceilings() {
        assert_eq!(
            change_from_line("limits write=40 read=120"),
            Some(Change { write: Some(limit_from_megabytes(40)), read: Some(limit_from_megabytes(120)) })
        );
        assert_eq!(change_from_line("  LIMITS   read=0 "), Some(Change { write: None, read: Some(None) }));
        assert_eq!(change_from_line("limits write=0"), Some(Change { write: Some(None), read: None }));
    }

    #[test]
    fn anything_else_is_not_a_limits_line() {
        for line in ["", "cancel", "limits", "limits write", "limits write=", "limits write=-3", "limits speed=5", "limits write=5 read=x", "hello limits write=5"] {
            assert_eq!(change_from_line(line), None, "{line:?}");
        }
    }

    #[test]
    fn a_suspended_mode_can_be_resumed_only_on_its_thread() {
        std::thread::spawn(|| {
            let mut io = BackgroundIo::begin();
            let was_active = io.is_active();
            assert_eq!(io.suspend(), was_active);
            assert!(!io.is_active());
            assert_eq!(io.resume(), was_active);
            assert_eq!(io.is_active(), was_active);
        })
        .join()
        .unwrap();
    }
}
