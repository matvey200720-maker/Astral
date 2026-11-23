//! Параллельное отображение среза обычными потоками.
//!
//! Потоков не больше половины ядер: кодирование текстур не должно занимать весь
//! компьютер человека.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

fn worker_count(items: usize) -> usize {
    let cores = thread::available_parallelism().map_or(1, |n| n.get());
    (cores / 2).max(1).min(items.max(1))
}

/// Результаты идут в порядке входа; каждый элемент обрабатывается один раз.
pub(crate) fn parallel_map<T: Sync, R: Send>(items: &[T], work: impl Fn(&T) -> R + Sync) -> Vec<R> {
    parallel_map_with(worker_count(items.len()), items, work)
}

/// То же с заданным числом потоков (не больше числа элементов).
pub(crate) fn parallel_map_with<T: Sync, R: Send>(threads: usize, items: &[T], work: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let threads = threads.max(1).min(items.len().max(1));
    let next = AtomicUsize::new(0);
    let mut slots: Vec<Option<R>> = items.iter().map(|_| None).collect();

    thread::scope(|scope| {
        let pull = || {
            let mut done = Vec::new();
            loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(item) = items.get(index) else {
                    break done;
                };
                done.push((index, work(item)));
            }
        };
        let handles: Vec<_> = (0..threads)
            .map(|_| scope.spawn(pull))
            .collect();
        let mut panicked = false;
        for handle in handles {
            match handle.join() {
                Ok(done) => {
                    for (index, value) in done {
                        slots[index] = Some(value);
                    }
                }
                Err(_) => panicked = true,
            }
        }
        if panicked {
            panic!("a scoped thread panicked");
        }
    });

    slots.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::{Condvar, Mutex};
    use std::time::Duration;

    fn pause(micros: u64) {
        thread::sleep(Duration::from_micros(micros));
    }

    #[test]
    fn small_inputs_keep_order() {
        let empty: [u32; 0] = [];
        assert!(parallel_map(&empty, |x| *x).is_empty());
        assert_eq!(parallel_map(&[7], |x| x + 1), vec![8]);
        assert_eq!(parallel_map(&["a", "bb"], |s| s.len()), vec![1, 2]);
    }

    #[test]
    fn thousand_items_once_each_and_in_order() {
        let items: Vec<u32> = (0..1000).collect();
        let cores = thread::available_parallelism().map_or(1, |n| n.get());
        let cap = (cores / 2).clamp(1, 1000);
        let calls = AtomicUsize::new(0);
        let threads = Mutex::new(HashSet::new());
        // Первые `cap` элементов ждут друг друга: пока все рабочие потоки не вышли на работу,
        // никто не идёт дальше. Так число потоков проверяется точно и без гонки за очередь:
        // на занятом процессоре ранние потоки иначе успевают разобрать всё до поздних.
        let gate = (Mutex::new(0usize), Condvar::new());
        let out = parallel_map(&items, |x| {
            calls.fetch_add(1, Ordering::Relaxed);
            threads.lock().unwrap().insert(thread::current().id());
            if (*x as usize) < cap {
                let (arrived, wake) = &gate;
                *arrived.lock().unwrap() += 1;
                wake.notify_all();
                let waited = wake
                    .wait_timeout_while(arrived.lock().unwrap(), Duration::from_secs(60), |n| *n < cap)
                    .unwrap()
                    .1;
                assert!(!waited.timed_out(), "не все рабочие потоки вышли на работу");
            }
            pause(200);
            x * 2
        });
        assert_eq!(out, (0..1000).map(|x| x * 2).collect::<Vec<u32>>());
        assert_eq!(calls.load(Ordering::Relaxed), 1000);
        // Потоков ровно столько, сколько положено, и не больше предела.
        assert_eq!(threads.lock().unwrap().len(), cap);
    }

    #[test]
    fn uneven_load_does_not_reorder() {
        let items = [30u64, 1, 1, 1, 1, 1, 1, 1];
        let out = parallel_map(&items, |ms| {
            thread::sleep(Duration::from_millis(*ms));
            *ms
        });
        assert_eq!(out, items.to_vec());
    }

    #[test]
    fn worker_count_follows_half_of_cores() {
        let cores = thread::available_parallelism().map_or(1, |n| n.get());
        let half = (cores / 2).max(1);
        for (items, expected) in [
            (0, 1),
            (1, 1),
            (2, half.min(2)),
            (3, half.min(3)),
            (8, half.min(8)),
            (100, half),
        ] {
            assert_eq!(worker_count(items), expected, "{items}");
        }
    }

    #[test]
    fn option_results_stay_in_place() {
        let items = [1u32, 2, 3, 4];
        let out = parallel_map(&items, |x| (x % 2 == 0).then_some(*x));
        assert_eq!(out, vec![None, Some(2), None, Some(4)]);
    }

    #[test]
    fn panic_in_work_propagates() {
        let outcome = std::panic::catch_unwind(|| {
            parallel_map(&[1, 2, 3], |x| {
                assert_ne!(*x, 2, "boom");
                *x
            })
        });
        assert!(outcome.is_err());
    }
}
