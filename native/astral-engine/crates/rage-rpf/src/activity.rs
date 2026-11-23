// Переходник между записью архива и командой: ход работы и отмена.
// Приёмник один на поток; стека нет.

use crate::error::Result;
use std::{cell::Cell, sync::Arc};

// Контракт приёмника ставится одним описанием: так видно, что у него ровно два входа.
macro_rules! receiver_contract {
    ($($method:item)+) => {
        pub trait Activity: Send + Sync {
            $($method)+
        }
    };
}

receiver_contract! {
    fn check(&self) -> Result<()>;

    fn step(&self, phase: &str, done: u64, total: u64);
}

type Receiver = Arc<dyn Activity>;

// Ячейка потока. Приёмник лежит в ней только пока никто его не вызывает:
// на время вызова наружу уходит копия, поэтому приёмник может заходить обратно.
struct Slot(Cell<Option<Receiver>>);

impl Slot {
    // Кладёт приёмник, прежний (если был) отдаёт вызывающему.
    fn put(&self, receiver: Receiver) -> Option<Receiver> {
        self.0.replace(Some(receiver))
    }

    fn peek(&self) -> Option<Receiver> {
        let held = self.0.take();
        let copy = held.clone();
        self.0.set(held);
        copy
    }

    fn take(&self) -> Option<Receiver> {
        self.0.take()
    }

    const fn empty() -> Self {
        Slot(Cell::new(None))
    }
}

thread_local! {
    static SLOT: Slot = const { Slot::empty() };
}

// Охрана очищает ячейку того потока, где её отпускают.
pub struct Guard;

impl Drop for Guard {
    fn drop(&mut self) {
        let _ = SLOT.try_with(Slot::take);
    }
}

pub fn step(phase: &str, done: u64, total: u64) {
    SLOT.with(Slot::peek)
        .into_iter()
        .for_each(|receiver| receiver.step(phase, done, total));
}

pub fn check() -> Result<()> {
    SLOT.with(Slot::peek)
        .map_or(Ok(()), |receiver| receiver.check())
}

pub fn install(activity: Arc<dyn Activity>) -> Guard {
    // Вытесненный приёмник отпускается уже за пределами ячейки.
    drop(SLOT.with(|slot| slot.put(activity)));
    Guard
}
