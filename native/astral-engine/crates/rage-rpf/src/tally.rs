// Счётчики запроса: сколько времени потоки провели в каждой фазе сборки архива и
// сколько байт прочитано и записано. Счётчик принадлежит запросу и лежит в потоке,
// который его поставил; рабочие потоки самого запроса берут его через `current` и
// ставят себе через `adopt`, как ленту чтения (`read_pace`). Параллельные запросы
// (режим `serve`) счётчиков друг друга не видят. Без счётчика все вызовы пусты.
//
// Время потоков идёт суммой: два потока по секунде дают две секунды, как у
// `roads-build`. Фазы не обязаны быть непересекающимися: `Nested` охватывает работу
// над вложенными архивами целиком, и в нём лежит часть чтения, сжатия и записи.

use std::{
    cell::RefCell,
    sync::{
        atomic::{AtomicU64, Ordering::Relaxed},
        Arc,
    },
    time::Instant,
};

/// Фаза сборки, время которой считается отдельно.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Чтение источников: тела с диска и из чужих архивов, файлы для сжатия.
    Sources,
    /// Таблица записей, блок имён, раздача мест, голова после доводки.
    Toc,
    /// Сжатие тел.
    Deflate,
    /// Запись тел в выходной файл (вложенные, написанные сразу во внешний, не входят).
    Bodies,
    /// Вложенные архивы целиком: подготовка, временный файл, доводка, запись.
    Nested,
    /// Сброс файла на диск.
    Flush,
    /// Ожидание замка доводчика, пока им занят другой запрос.
    GateWait,
}

const PHASES: usize = 7;

/// Счётчик одного запроса.
#[derive(Default)]
pub struct Tally {
    read: AtomicU64,
    written: AtomicU64,
    nanos: [AtomicU64; PHASES],
    nested_direct: AtomicU64,
    nested_staged: AtomicU64,
    backward_writes: AtomicU64,
}

/// Снимок счётчика.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Totals {
    pub read_bytes: u64,
    pub written_bytes: u64,
    pub nested_direct: u64,
    pub nested_staged: u64,
    /// Записи тел и голов, начатые ниже уже записанного места (не по возрастанию
    /// смещений). У прямой записи вложенных их нет.
    pub backward_writes: u64,
    nanos: [u64; PHASES],
}

impl Totals {
    /// Время фазы в миллисекундах (сумма по потокам).
    pub fn millis(&self, phase: Phase) -> u64 {
        self.nanos[phase as usize] / 1_000_000
    }
}

impl Tally {
    pub fn new() -> Arc<Tally> {
        Arc::default()
    }

    pub fn totals(&self) -> Totals {
        Totals {
            read_bytes: self.read.load(Relaxed),
            written_bytes: self.written.load(Relaxed),
            nested_direct: self.nested_direct.load(Relaxed),
            nested_staged: self.nested_staged.load(Relaxed),
            backward_writes: self.backward_writes.load(Relaxed),
            nanos: std::array::from_fn(|at| self.nanos[at].load(Relaxed)),
        }
    }
}

thread_local! {
    static CURRENT: RefCell<Option<Arc<Tally>>> = const { RefCell::new(None) };
}

/// Охрана: при уничтожении возвращает потоку прежний счётчик.
pub struct Scope {
    previous: Option<Arc<Tally>>,
}

impl Drop for Scope {
    fn drop(&mut self) {
        let previous = self.previous.take();
        let _ = CURRENT.try_with(|slot| *slot.borrow_mut() = previous);
    }
}

/// Делает счётчик текущим для этого потока.
pub fn install(tally: Arc<Tally>) -> Scope {
    let previous = CURRENT.with(|slot| slot.borrow_mut().replace(tally));
    Scope { previous }
}

/// Счётчик запроса этого потока, чтобы передать его рабочему потоку.
pub fn current() -> Option<Arc<Tally>> {
    CURRENT.with(|slot| slot.borrow().clone())
}

/// Ставит рабочему потоку счётчик запроса (`None` — потоку счёт не нужен).
pub fn adopt(tally: Option<Arc<Tally>>) -> Scope {
    let previous = CURRENT.with(|slot| std::mem::replace(&mut *slot.borrow_mut(), tally));
    Scope { previous }
}

fn with(count: impl FnOnce(&Tally)) {
    CURRENT.with(|slot| {
        if let Some(tally) = slot.borrow().as_deref() {
            count(tally);
        }
    });
}

/// Прочитано `bytes` байт (с диска или из чужого источника).
pub fn add_read(bytes: u64) {
    with(|tally| {
        tally.read.fetch_add(bytes, Relaxed);
    });
}

/// Записано `bytes` байт.
pub fn add_written(bytes: u64) {
    with(|tally| {
        tally.written.fetch_add(bytes, Relaxed);
    });
}

/// Вложенный архив записан сразу во внешний (`true`) или через временный файл.
pub fn note_nested(direct: bool) {
    with(|tally| {
        let counter = if direct {
            &tally.nested_direct
        } else {
            &tally.nested_staged
        };
        counter.fetch_add(1, Relaxed);
    });
}

/// Запись началась ниже уже записанного места.
pub fn note_backward() {
    with(|tally| {
        tally.backward_writes.fetch_add(1, Relaxed);
    });
}

fn add_time(phase: Phase, nanos: u64) {
    with(|tally| {
        tally.nanos[phase as usize].fetch_add(nanos, Relaxed);
    });
}

/// Отсчёт фазы: время от создания до уничтожения идёт в счётчик.
pub struct Span {
    phase: Phase,
    begun: Instant,
}

impl Drop for Span {
    fn drop(&mut self) {
        let nanos = u64::try_from(self.begun.elapsed().as_nanos()).unwrap_or(u64::MAX);
        add_time(self.phase, nanos);
    }
}

pub fn span(phase: Phase) -> Span {
    Span {
        phase,
        begun: Instant::now(),
    }
}

/// Выполняет `work` и кладёт его время в фазу.
pub fn timed<T>(phase: Phase, work: impl FnOnce() -> T) -> T {
    let _span = span(phase);
    work()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_counted_without_a_tally_and_each_thread_has_its_own() {
        add_read(5);
        let one = Tally::new();
        let two = Tally::new();
        {
            let _scope = install(Arc::clone(&one));
            add_read(10);
            add_written(7);
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    let _other = install(Arc::clone(&two));
                    add_read(1);
                });
                // рабочий поток запроса берёт счётчик запроса
                let mine = current();
                scope.spawn(move || {
                    let _scope = adopt(mine);
                    add_read(100);
                    timed(Phase::Deflate, || {
                        std::thread::sleep(std::time::Duration::from_millis(3))
                    });
                });
            });
        }
        add_read(1000);
        let (a, b) = (one.totals(), two.totals());
        assert_eq!((a.read_bytes, a.written_bytes), (110, 7));
        assert_eq!(b.read_bytes, 1);
        assert!(a.millis(Phase::Deflate) >= 2, "{a:?}");
        assert_eq!(a.millis(Phase::Bodies), 0);
    }

    #[test]
    fn the_scope_gives_the_previous_tally_back() {
        let outer = Tally::new();
        let inner = Tally::new();
        let _o = install(Arc::clone(&outer));
        {
            let _i = install(Arc::clone(&inner));
            add_read(2);
        }
        add_read(3);
        assert_eq!(inner.totals().read_bytes, 2);
        assert_eq!(outer.totals().read_bytes, 3);
    }
}
