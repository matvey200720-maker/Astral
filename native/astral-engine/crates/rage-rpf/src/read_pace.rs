// Потолок скорости чтения принадлежит запросу: он лежит в потоке, который его
// поставил. Параллельные запросы (режим `serve`) не видят потолков друг друга.
// Рабочие потоки самого запроса берут потолок и ленту у запроса через `current`
// и ставят себе через `ReadPace::install`: лента у них общая.
//
// Лента — позиция в наносекундах от начала отсчёта: до какого момента уже
// «занято» чтениями. Каждое чтение сдвигает ленту на свою стоимость и ждёт,
// только если лента убежала дальше «сейчас + запас». Начало отсчёта одно на
// процесс (первый вызов, дошедший до расчёта).
//
// Потолок идущего запроса меняется на ходу (`ReadPace::set_limit`): новое
// значение видят все потоки запроса, лента начинается заново, а спящее
// чтение просыпается сразу, а не по концу своего срока.

use std::cell::RefCell;
use std::sync::atomic::{
    AtomicU64,
    Ordering::{Acquire, Relaxed, Release},
};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

const SLACK_NS: u64 = 100_000_000;
const COST_CAP_NS: u128 = (u64::MAX / 2) as u128;

// Итог постановки на ленту: где лента теперь кончается и когда это случилось.
pub(crate) struct Booking {
    pub(crate) end_ns: u64,
    now_ns: u64,
}

impl Booking {
    // Ждать нужно, только если лента ушла дальше «сейчас + запас».
    pub(crate) fn wait_ns(&self) -> u64 {
        self.end_ns.saturating_sub(self.now_ns + SLACK_NS)
    }
}

// Потолок одного запроса и его лента.
pub(crate) struct Ribbon {
    ceiling: AtomicU64,
    tape_end: AtomicU64,
    // Счётчик смен потолка и место, где спящее чтение ждёт смены.
    changes: AtomicU64,
    gate: Mutex<()>,
    woken: Condvar,
}

static ORIGIN: OnceLock<Instant> = OnceLock::new();

impl Ribbon {
    pub(crate) const fn new() -> Self {
        Ribbon {
            ceiling: AtomicU64::new(0),
            tape_end: AtomicU64::new(0),
            changes: AtomicU64::new(0),
            gate: Mutex::new(()),
            woken: Condvar::new(),
        }
    }

    fn gate(&self) -> MutexGuard<'_, ()> {
        self.gate.lock().unwrap_or_else(PoisonError::into_inner)
    }

    // Новый потолок на ходу: лента начинается заново, спящие просыпаются.
    // Прежнее значение повторно не будит никого.
    fn retune(&self, bytes_per_second: Option<u64>) {
        let fresh = bytes_per_second.unwrap_or(0);
        let held = self.gate();
        if self.ceiling.load(Relaxed) == fresh {
            return;
        }
        self.ceiling.store(fresh, Relaxed);
        self.tape_end.store(0, Relaxed);
        self.changes.fetch_add(1, Release);
        drop(held);
        self.woken.notify_all();
    }

    // Спит не дольше `span`; выходит раньше, если потолок сменился после
    // того, как чтение узнало счётчик `seen`.
    fn nap(&self, span: Duration, seen: u64) {
        let deadline = Instant::now() + span;
        let mut held = self.gate();
        while self.changes.load(Acquire) == seen {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return;
            }
            held = self
                .woken
                .wait_timeout(held, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    fn limited(bytes_per_second: Option<u64>) -> Self {
        let ribbon = Ribbon::new();
        ribbon.ceiling.store(bytes_per_second.unwrap_or(0), Relaxed);
        ribbon
    }

    // Время чтения в наносекундах при потолке `ceiling` (остаток отбрасывается).
    fn cost_ns(bytes: u64, ceiling: u64) -> u64 {
        let exact = u128::from(bytes) * 1_000_000_000 / u128::from(ceiling);
        exact.min(COST_CAP_NS) as u64
    }

    // Ставит чтение на ленту. Часы приходят снаружи, чтобы расчёт проверялся без сна.
    pub(crate) fn reserve(&self, ceiling: u64, bytes: u64, now_ns: u64) -> Booking {
        let cost = Self::cost_ns(bytes, ceiling);
        let floor = now_ns.saturating_sub(SLACK_NS);

        let mut seen = self.tape_end.load(Relaxed);
        loop {
            let end_ns = seen.max(floor) + cost;
            match self
                .tape_end
                .compare_exchange_weak(seen, end_ns, Relaxed, Relaxed)
            {
                Ok(_) => return Booking { end_ns, now_ns },
                Err(actual) => seen = actual,
            }
        }
    }

    fn pace(&self, bytes: u64) {
        // Счётчик смен читается до потолка: смена между чтениями не потеряется.
        let seen = self.changes.load(Acquire);
        let ceiling = self.ceiling.load(Relaxed);
        if ceiling == 0 || bytes == 0 {
            return;
        }
        // Начало отсчёта — первый вызов, дошедший досюда.
        let now_ns = ORIGIN.get_or_init(Instant::now).elapsed().as_nanos() as u64;
        let wait_ns = self.reserve(ceiling, bytes, now_ns).wait_ns();
        if wait_ns > 0 {
            self.nap(Duration::from_nanos(wait_ns), seen);
        }
    }
}

thread_local! {
    static CURRENT: RefCell<Arc<Ribbon>> = RefCell::new(Arc::new(Ribbon::new()));
}

/// Потолок и лента запроса, которые можно передать рабочему потоку.
#[derive(Clone)]
pub struct ReadPace {
    ribbon: Arc<Ribbon>,
}

impl ReadPace {
    /// Делает потолок и ленту потоком текущими для этого потока: чтения в нём
    /// идут по той же ленте, что и у потока-источника.
    pub fn install(&self) {
        CURRENT.with(|slot| *slot.borrow_mut() = Arc::clone(&self.ribbon));
    }

    /// Меняет потолок идущего запроса из любого потока: его видят все потоки,
    /// что делят эту ленту. Лента начинается заново, спящее чтение
    /// просыпается сразу. `None` и ноль — без потолка.
    pub fn set_limit(&self, bytes_per_second: Option<u64>) {
        self.ribbon.retune(bytes_per_second);
    }

    /// Потолок сейчас: `None`, если его нет.
    pub fn limit(&self) -> Option<u64> {
        Some(self.ribbon.ceiling.load(Relaxed)).filter(|&ceiling| ceiling > 0)
    }
}

/// Потолок и лента текущего потока.
pub fn current() -> ReadPace {
    ReadPace {
        ribbon: CURRENT.with(|slot| Arc::clone(&slot.borrow())),
    }
}

pub fn pace_read(bytes: u64) {
    // каждое чтение, которое идёт через ленту, попадает и в счёт байт запроса
    crate::tally::add_read(bytes);
    CURRENT.with(|slot| slot.borrow().pace(bytes));
}

/// Ставит потолок текущему потоку (запросу); лента начинается заново.
pub fn set_read_limit(bytes_per_second: Option<u64>) {
    let fresh = Arc::new(Ribbon::limited(bytes_per_second));
    CURRENT.with(|slot| *slot.borrow_mut() = fresh);
}
