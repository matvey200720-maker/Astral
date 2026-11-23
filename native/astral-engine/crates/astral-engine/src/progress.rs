//! Ход долгой команды и её отмена: строки «шаг, сделано, всего» для окна
//! Astral, флаг отмены (строка на stdin или файл) и пейсер записи.

use std::io::{self, BufRead, Write};
use std::marker::PhantomData;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

use crate::disk::{change_from_line, LiveLimits, WritePacer};
use crate::error::EngineError;

const CANCEL_WORD: &str = "cancel";
/// Строки одного шага выходят не чаще, чем раз в столько миллисекунд.
const LINE_SPACING_MS: u64 = 200;
/// Файл отмены перепроверяется не раньше, чем через этот срок.
const RECHECK_AFTER: Duration = Duration::from_millis(200);

/// Замок, который переживает панику прежнего владельца.
trait Calm<T> {
    fn calm(&self) -> MutexGuard<'_, T>;
}

impl<T> Calm<T> for Mutex<T> {
    fn calm(&self) -> MutexGuard<'_, T> {
        match self.lock() {
            Ok(guard) => guard,
            Err(spoiled) => spoiled.into_inner(),
        }
    }
}

/// Событие, которое Progress принимает из любого пути: из команды, из
/// приёмника записи архива, из точки остановки.
enum Signal<'a> {
    Step {
        phase: &'a str,
        done: u64,
        total: u64,
    },
    Poll,
}

/// Отмена поднята: дальше идти нельзя.
struct Halted;

/// Наблюдение за файлом отмены: путь и момент последнего взгляда на диск.
struct Sentinel {
    path: PathBuf,
    looked_at: Option<Instant>,
}

impl Sentinel {
    fn due(&self, now: Instant) -> bool {
        self.looked_at
            .is_none_or(|at| now.saturating_duration_since(at) >= RECHECK_AFTER)
    }
}

/// Всё состояние отмены: взведённый флаг и необязательный файл-признак.
#[derive(Default)]
struct Tripwire {
    raised: AtomicBool,
    sentinel: Mutex<Option<Sentinel>>,
}

impl Tripwire {
    /// Флаг, а если его нет — файл (не чаще `RECHECK_AFTER`); появившийся
    /// файл взводит флаг насовсем.
    fn check(&self, now: Instant) -> bool {
        if self.raised.load(Ordering::Acquire) {
            return true;
        }
        let appeared = match self.sentinel.calm().as_mut() {
            Some(sentinel) if sentinel.due(now) => {
                sentinel.looked_at = Some(now);
                sentinel.path.exists()
            }
            _ => false,
        };
        if appeared {
            self.raised.store(true, Ordering::Release);
        }
        appeared
    }
}

/// Отмена команды; копии делят и флаг, и файл.
#[derive(Clone, Default)]
pub struct Cancel(Arc<Tripwire>);

impl Cancel {
    pub fn request(&self) {
        self.0.raised.store(true, Ordering::Release);
    }

    /// Новый путь заменяет прежний и проверяется сразу.
    pub fn watch_file(&self, path: PathBuf) {
        *self.0.sentinel.calm() = Some(Sentinel {
            path,
            looked_at: None,
        });
    }

    /// Читает только флаг.
    pub fn requested(&self) -> bool {
        self.0.raised.load(Ordering::Acquire)
    }

    pub fn poll(&self) -> bool {
        self.check_at(Instant::now())
    }

    pub(crate) fn check_at(&self, now: Instant) -> bool {
        self.0.check(now)
    }
}

/// Строка stdin означает отмену, если это слово `cancel` (регистр ASCII не
/// важен), окружённое только пробелами.
pub fn is_cancel_line(line: &str) -> bool {
    line.trim().to_ascii_lowercase() == CANCEL_WORD
}

/// Читает ввод построчно и на первой строке-отмене взводит флаг. Конец ввода и
/// ошибка чтения завершают чтение; строка не в UTF-8 отменой не считается, но и
/// чтение не обрывает.
fn read_until_cancel(input: impl BufRead, cancel: &Cancel) {
    read_until_cancel_with(input, cancel, |_| {});
}

/// То же, но строки, которые не отмена, отдаются `on_line` (строка управления пределами, `disk::change_from_line`).
fn read_until_cancel_with(mut input: impl BufRead, cancel: &Cancel, mut on_line: impl FnMut(&str)) {
    let mut line = Vec::new();
    loop {
        line.clear();
        match input.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                let text = String::from_utf8_lossy(&line);
                if is_cancel_line(&text) {
                    cancel.request();
                    return;
                }
                on_line(&text);
            }
        }
    }
}

/// Отдельный поток читает stdin построчно и на первой строке-отмене
/// взводит флаг.
pub fn watch_stdin(cancel: Cancel) {
    let reader = move || {
        let stdin = io::stdin();
        read_until_cancel(stdin.lock(), &cancel);
    };
    // Без потока отмена по stdin недоступна, но команде это не мешает.
    let _ = std::thread::Builder::new()
        .name("astral-cancel-stdin".into())
        .spawn(reader);
}

/// То же, что `watch_stdin`, но строки `limits write=… read=…` меняют потолки идущей команды (`live`: живые потолки этого процесса, `LiveLimits::enter` в главном потоке). Отмена
/// и конец ввода — как прежде; непонятная строка не мешает.
pub fn watch_stdin_live(cancel: Cancel, live: Arc<LiveLimits>) {
    let reader = move || {
        let stdin = io::stdin();
        read_until_cancel_with(stdin.lock(), &cancel, |line| {
            if let Some(change) = change_from_line(line) {
                live.apply(change);
            }
        });
    };
    let _ = std::thread::Builder::new()
        .name("astral-limits-stdin".into())
        .spawn(reader);
}

/// Память прореживания: шаг и время последней выданной строки.
#[derive(Default)]
struct Pulse {
    last: Option<(String, u64)>,
}

impl Pulse {
    /// Решает, выдавать ли строку, и сразу запоминает выданную.
    fn allows(&mut self, phase: &str, done: u64, total: u64, at_ms: u64) -> bool {
        let (changed, stale) = self.last.as_ref().map_or((true, true), |(seen, at)| {
            (seen != phase, at_ms.saturating_sub(*at) >= LINE_SPACING_MS)
        });
        let finished = total > 0 && done >= total;
        let open = changed || finished || stale;
        if open {
            self.last = Some((phase.to_owned(), at_ms));
        }
        open
    }
}

/// Строка хода: объект с ключом `progress`, внутри `phase`, `copiedBytes`,
/// `totalBytes` (порядок вставки).
fn render(phase: &str, done: u64, total: u64) -> String {
    let counters: Map<String, Value> = [
        ("phase", Value::from(phase)),
        ("copiedBytes", Value::from(done)),
        ("totalBytes", Value::from(total)),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect();
    let mut outer = Map::new();
    outer.insert("progress".to_owned(), Value::Object(counters));
    Value::Object(outer).to_string()
}

/// Место пейсера в ходе: один пейсер или пусто.
#[derive(Default)]
struct PacerSlot(Mutex<Option<WritePacer>>);

impl PacerSlot {
    /// Прежний пейсер, если был, уничтожается сразу.
    fn install(&self, pacer: WritePacer) {
        let previous = self.0.calm().replace(pacer);
        drop(previous);
    }

    fn release(&self) {
        let taken = self.0.calm().take();
        drop(taken);
    }

    /// Замок держится на всё время сна пейсера.
    fn feed(&self, bytes: u64) {
        if let Some(pacer) = self.0.calm().as_mut() {
            pacer.wrote(bytes);
        }
    }

    fn released(&self) -> bool {
        self.0.calm().as_ref().is_some_and(WritePacer::released)
    }
}

/// Ход команды: приёмник строк, прореживание, отмена и пейсер записи.
/// Копии делят всё состояние.
#[derive(Clone)]
pub struct Progress {
    sink: Arc<dyn Fn(&str) + Send + Sync>,
    pulse: Arc<Mutex<Pulse>>,
    born: Instant,
    cancel: Cancel,
    slot: Arc<PacerSlot>,
}

impl Progress {
    fn assemble(sink: Arc<dyn Fn(&str) + Send + Sync>) -> Self {
        Self {
            sink,
            pulse: Arc::default(),
            born: Instant::now(),
            cancel: Cancel::default(),
            slot: Arc::default(),
        }
    }

    /// Строки идут в stderr в UTF-8, каждая заканчивается одним LF.
    pub fn stderr() -> Self {
        Self::assemble(Arc::new(|line: &str| {
            let mut text = String::with_capacity(line.len() + 1);
            text.push_str(line);
            text.push('\n');
            // Закрытый stderr ход не останавливает.
            let _ = io::stderr().lock().write_all(text.as_bytes());
        }))
    }

    /// Приёмник получает строку без перевода строки и вызывается при
    /// удержанной блокировке прореживания: трогать этот же `Progress` из него
    /// нельзя.
    pub fn with_sink(sink: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self::assemble(Arc::new(sink))
    }

    pub fn silent() -> Self {
        Self::assemble(Arc::new(|_: &str| {}))
    }

    pub fn cancel(&self) -> &Cancel {
        &self.cancel
    }

    pub fn checkpoint(&self) -> Result<(), EngineError> {
        self.dispatch(Signal::Poll)
            .map_err(|Halted| EngineError::cancelled())
    }

    pub fn report(&self, phase: &str) {
        self.report_bytes(phase, 0, 0);
    }

    pub fn report_bytes(&self, phase: &str, done: u64, total: u64) {
        let _ = self.dispatch(Signal::Step { phase, done, total });
    }

    /// Единственный вход для хода и отмены.
    fn dispatch(&self, signal: Signal<'_>) -> Result<(), Halted> {
        match signal {
            Signal::Step { phase, done, total } => {
                let age = u64::try_from(self.born.elapsed().as_millis()).unwrap_or(u64::MAX);
                self.announce_at(phase, done, total, age);
                Ok(())
            }
            Signal::Poll if self.cancel.poll() => Err(Halted),
            Signal::Poll => Ok(()),
        }
    }

    pub(crate) fn announce_at(&self, phase: &str, done: u64, total: u64, at_ms: u64) {
        let mut pulse = self.pulse.calm();
        if pulse.allows(phase, done, total, at_ms) {
            (self.sink)(&render(phase, done, total));
        }
    }

    /// Кладёт пейсер в ход; пока жив `Pacing`, все записи команды идут через
    /// него.
    pub fn pace(&self, pacer: WritePacer) -> Pacing<'_> {
        self.slot.install(pacer);
        Pacing {
            slot: Arc::clone(&self.slot),
            _progress: PhantomData,
        }
    }

    pub fn wrote(&self, bytes: u64) {
        self.slot.feed(bytes);
    }

    pub fn background_released(&self) -> bool {
        self.slot.released()
    }
}

/// Пока жив, пейсер стоит в ходе; при снятии пейсер уничтожается.
pub struct Pacing<'a> {
    slot: Arc<PacerSlot>,
    _progress: PhantomData<&'a Progress>,
}

impl Drop for Pacing<'_> {
    fn drop(&mut self) {
        self.slot.release();
    }
}

impl rage_rpf::activity::Activity for Progress {
    fn step(&self, phase: &str, done: u64, total: u64) {
        let _ = self.dispatch(Signal::Step { phase, done, total });
    }

    fn check(&self) -> rage_rpf::Result<()> {
        self.dispatch(Signal::Poll)
            .map_err(|Halted| rage_rpf::RpfError::Cancelled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disk::BackgroundIo;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::atomic::AtomicUsize;

    type Lines = Arc<Mutex<Vec<String>>>;

    fn recording() -> (Progress, Lines) {
        let lines: Lines = Arc::default();
        let sink = Arc::clone(&lines);
        let progress = Progress::with_sink(move |line| sink.lock().unwrap().push(line.to_owned()));
        (progress, lines)
    }

    /// Выданные строки в виде `шаг:сделано/всего`.
    fn shown(lines: &Lines) -> Vec<String> {
        lines
            .lock()
            .unwrap()
            .iter()
            .map(|line| {
                let value: Value = serde_json::from_str(line).unwrap();
                let step = &value["progress"];
                format!(
                    "{}:{}/{}",
                    step["phase"].as_str().unwrap(),
                    step["copiedBytes"],
                    step["totalBytes"]
                )
            })
            .collect()
    }

    fn scratch_path(tag: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let number = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "astral-progress-{}-{number}-{tag}",
            std::process::id()
        ))
    }

    fn after(base: Instant, millis: u64) -> Instant {
        base + Duration::from_millis(millis)
    }

    fn idle_io() -> BackgroundIo {
        let mut io = BackgroundIo::begin();
        io.end();
        io
    }

    #[test]
    fn the_line_has_the_shape_the_bridge_reads() {
        let (progress, lines) = recording();
        progress.report_bytes("backup", 512, 2048);
        progress.report("prepare");
        progress.report_bytes("x", u64::MAX, u64::MAX);
        progress.report_bytes("a\"b\\\n\t\u{1b}/\u{7f}фаза😀", 7, 5);

        let lines = lines.lock().unwrap();
        assert_eq!(
            lines[0],
            r#"{"progress":{"phase":"backup","copiedBytes":512,"totalBytes":2048}}"#
        );
        assert_eq!(
            lines[1],
            r#"{"progress":{"phase":"prepare","copiedBytes":0,"totalBytes":0}}"#
        );
        assert_eq!(
            lines[2],
            r#"{"progress":{"phase":"x","copiedBytes":18446744073709551615,"totalBytes":18446744073709551615}}"#
        );
        assert_eq!(
            lines[3],
            "{\"progress\":{\"phase\":\"a\\\"b\\\\\\n\\t\\u001b/\u{7f}фаза😀\",\"copiedBytes\":7,\"totalBytes\":5}}"
        );
        // ровно три поля, отметки «фон снят» нет
        let value: Value = serde_json::from_str(&lines[0]).unwrap();
        let keys: Vec<&String> = value["progress"].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["phase", "copiedBytes", "totalBytes"]);
        assert!(!Progress::silent().background_released());
    }

    #[test]
    fn a_burst_inside_one_phase_is_thinned_but_a_new_phase_and_the_end_pass() {
        let (progress, lines) = recording();
        let sent = |phase: &str, done: u64, total: u64, at_ms: u64| {
            let before = lines.lock().unwrap().len();
            progress.announce_at(phase, done, total, at_ms);
            lines.lock().unwrap().len() > before
        };
        assert!(sent("a", 0, 100, 0));
        for at in [50, 100, 150, 199] {
            assert!(!sent("a", 1, 100, at), "t={at}");
        }
        assert!(sent("a", 4, 100, 200), "граница 200 мс");
        // отсчёт идёт от последней выданной строки, а не от последнего вызова
        assert!(!sent("a", 5, 100, 399));
        assert!(sent("a", 6, 100, 400));
        // смена шага и конец шага интервала не ждут; конец дважды — дважды
        assert!(sent("b", 0, 0, 401));
        assert!(sent("a", 7, 100, 402));
        assert!(sent("a", 100, 100, 403));
        assert!(sent("a", 100, 100, 404));
        assert!(sent("a", 150, 100, 405), "done больше total — тоже конец");
        // total ноль конца не даёт, пустое имя — тоже шаг
        assert!(sent("", 1, 2, 500));
        assert!(!sent("", 1000, 0, 510));
        assert!(sent("", 1000, 0, 700));
    }

    #[test]
    fn copies_share_the_state_and_the_sink() {
        let (original, lines) = recording();
        let copy = original.clone();
        original.report_bytes("a", 1, 100);
        copy.report_bytes("a", 100, 100);
        copy.report_bytes("b", 0, 0);
        original.report_bytes("b", 1, 0);
        assert_eq!(shown(&lines), ["a:1/100", "a:100/100", "b:0/0"]);
    }

    #[test]
    fn only_the_cancel_word_on_stdin_is_a_cancel() {
        for yes in [
            "cancel",
            "CANCEL",
            "CaNcEl",
            "  cancel  ",
            "cancel\r\n",
            "\tcancel\t",
            "\u{a0}cancel\u{a0}",
            "\u{2003}cancel",
        ] {
            assert!(is_cancel_line(yes), "{yes:?}");
        }
        for no in [
            "",
            " ",
            "cancelled",
            "cancel now",
            "cancel1",
            "ca ncel",
            "\u{feff}cancel",
            "cancel\0",
            "СANCEL",
            "ＣＡＮＣＥＬ",
            "{\"cancel\":true}",
            "отмена",
        ] {
            assert!(!is_cancel_line(no), "{no:?}");
        }
    }

    #[test]
    fn a_line_that_is_not_utf8_does_not_hide_a_later_cancel() {
        let cancel = Cancel::default();
        let mut input = b"progress ok\n".to_vec();
        input.extend_from_slice(&[0xff, 0xfe, 0xfd, b'\n']);
        input.extend_from_slice(b"  Cancel \n");
        read_until_cancel(io::Cursor::new(input), &cancel);
        assert!(cancel.requested());

        // Без строки-отмены ввод просто кончается.
        let quiet = Cancel::default();
        read_until_cancel(io::Cursor::new(b"hello\n\xff\xff\nbye".to_vec()), &quiet);
        assert!(!quiet.requested());
    }

    #[test]
    fn limits_lines_before_a_cancel_reach_the_handler_and_the_cancel_still_wins() {
        let cancel = Cancel::default();
        let mut seen = Vec::new();
        let input = b"limits write=40\nnot a control line\nlimits read=0\ncancel\nlimits write=9\n".to_vec();
        read_until_cancel_with(io::Cursor::new(input), &cancel, |line| seen.push(line.trim().to_owned()));
        assert!(cancel.requested());
        assert_eq!(seen, ["limits write=40", "not a control line", "limits read=0"], "после отмены чтение кончается");
    }

    #[test]
    fn a_cancel_file_counts_once_it_appears() {
        let flag = scratch_path("appears.flag");
        let base = Instant::now();
        let cancel = Cancel::default();
        cancel.watch_file(flag.clone());
        assert!(!cancel.check_at(base), "первая проверка ничего не ждёт");
        std::fs::write(&flag, b"x").unwrap();
        assert!(!cancel.check_at(after(base, 100)));
        assert!(!cancel.check_at(after(base, 199)));
        assert!(!cancel.requested(), "requested() файла не смотрит");
        assert!(cancel.check_at(after(base, 200)));
        std::fs::remove_file(&flag).unwrap();
        assert!(cancel.check_at(after(base, 5000)), "флаг остаётся");
        assert!(cancel.requested());
    }

    #[test]
    fn a_new_watched_path_is_checked_at_once() {
        let early = scratch_path("early.flag");
        std::fs::write(&early, b"x").unwrap();
        let base = Instant::now();

        let cancel = Cancel::default();
        cancel.watch_file(early.clone());
        assert!(cancel.check_at(base), "файл уже есть до watch_file");

        let cancel = Cancel::default();
        cancel.watch_file(scratch_path("missing.flag"));
        assert!(!cancel.check_at(after(base, 2000)));
        assert!(!cancel.check_at(after(base, 2100)));
        cancel.watch_file(early.clone());
        assert!(
            cancel.check_at(after(base, 2100)),
            "новый путь сбрасывает отсчёт"
        );

        // каталог считается появившимся файлом, пустой и несуществующий путь — нет
        let cancel = Cancel::default();
        cancel.watch_file(std::env::temp_dir());
        assert!(cancel.check_at(base));
        let cancel = Cancel::default();
        cancel.watch_file(PathBuf::new());
        assert!(!cancel.check_at(base));
        cancel.watch_file(scratch_path("no-dir").join("x.flag"));
        assert!(!cancel.check_at(base));
        std::fs::remove_file(&early).unwrap();
    }

    #[test]
    fn a_requested_cancel_stops_the_next_checkpoint_for_good() {
        let (progress, _) = recording();
        assert!(progress.checkpoint().is_ok());
        let copy = progress.clone();
        copy.cancel().request();
        for _ in 0..2 {
            let error = progress.checkpoint().unwrap_err();
            assert_eq!(error.code, "Cancelled");
            assert_eq!(error.message, "Отменено.");
            assert_eq!(error.to_string(), "Cancelled: Отменено.");
        }
        assert!(progress.cancel().requested());
    }

    #[test]
    fn the_writer_hook_passes_steps_and_sees_the_cancel() {
        use rage_rpf::activity;

        let (progress, lines) = recording();
        let guard = activity::install(Arc::new(progress.clone()));
        activity::step("prepare", 3, 9);
        assert_eq!(
            *lines.lock().unwrap(),
            [r#"{"progress":{"phase":"prepare","copiedBytes":3,"totalBytes":9}}"#]
        );
        assert!(activity::check().is_ok());

        progress.cancel().request();
        let error = activity::check().unwrap_err();
        assert_eq!(error.to_string(), "Отменено.");
        assert_eq!(EngineError::from(error), EngineError::cancelled());

        drop(guard);
        assert!(
            activity::check().is_ok(),
            "приёмник живёт, пока жива охрана"
        );
    }

    #[test]
    fn silent_progress_prints_nothing_but_keeps_the_cancel() {
        let progress = Progress::silent();
        progress.report_bytes("a", 1, 2);
        progress.report("b");
        progress.cancel().request();
        assert_eq!(progress.checkpoint().unwrap_err().code, "Cancelled");
    }

    #[test]
    fn a_panicking_sink_leaves_the_progress_usable() {
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&calls);
        let progress = Progress::with_sink(move |_| {
            if counter.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("приёмник упал");
            }
        });
        assert!(catch_unwind(AssertUnwindSafe(|| progress.report_bytes("a", 1, 100))).is_err());
        // шаг и время уже записаны: тот же шаг сразу после падения пропускается
        progress.report_bytes("a", 2, 100);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        progress.report_bytes("b", 0, 0);
        progress.report_bytes("a", 100, 100);
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn a_second_pace_drops_the_first_pacer_and_dropping_the_pacing_releases_it() {
        let progress = Progress::silent();
        let quick = |progress: &Progress| {
            let started = Instant::now();
            // при потолке 1 байт/с эта запись спала бы 2 секунды
            progress.wrote(2);
            started.elapsed() < Duration::from_millis(1000)
        };

        let first = progress.pace(WritePacer::new(Some(1), idle_io()));
        let second = progress.pace(WritePacer::new(None, idle_io()));
        assert!(quick(&progress), "прежний пейсер должен быть уничтожен");
        assert!(!progress.background_released());
        drop(first);
        drop(second);

        let pacing = progress.pace(WritePacer::new(Some(1), idle_io()));
        drop(pacing);
        assert!(quick(&progress), "после снятия записи идут без пейсера");
    }

    #[test]
    fn a_panic_inside_the_pacer_does_not_poison_the_progress() {
        let progress = Progress::silent();
        // Потолок 1 байт/с и запись на u64::MAX: нужная пауза не помещается в
        // `Duration`, расчёт паузы падает паникой внутри пейсера.
        let pacing = progress.pace(WritePacer::new(Some(1), idle_io()));
        assert!(catch_unwind(AssertUnwindSafe(|| progress.wrote(u64::MAX))).is_err());
        assert!(!progress.background_released());
        drop(pacing);
        progress.wrote(1);
    }

    #[cfg(windows)]
    #[allow(unsafe_code)]
    fn thread_priority() -> i32 {
        extern "system" {
            fn GetCurrentThread() -> isize;
            fn GetThreadPriority(thread: isize) -> i32;
        }
        // SAFETY: псевдодескриптор текущего потока.
        unsafe { GetThreadPriority(GetCurrentThread()) }
    }

    #[cfg(windows)]
    #[test]
    fn a_second_pace_ends_the_background_mode_of_the_first_pacer() {
        std::thread::spawn(|| {
            let progress = Progress::silent();
            let first = progress.pace(WritePacer::new(None, BackgroundIo::begin()));
            if thread_priority() == 0 {
                return; // окружение запретило фон
            }
            assert_eq!(thread_priority(), -4);
            // второй пейсер вход в фон не получил: поток уже в фоне
            let second = progress.pace(WritePacer::new(None, BackgroundIo::begin()));
            assert_eq!(thread_priority(), 0, "прежний пейсер уничтожен сразу");
            drop((first, second));
            assert_eq!(thread_priority(), 0);
        })
        .join()
        .unwrap();
    }
}
