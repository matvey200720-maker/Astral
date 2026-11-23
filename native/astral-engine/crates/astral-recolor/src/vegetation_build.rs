//! Сборка растительности: файлы игры читаются из архивов, собираются несколькими потоками с общей памятью
//! готовых листов мода и пишутся на диск (`vegetation.rs`). Устройство то же, что у `build.rs` («Дороги», «Вода»).

use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Instant;

use sha2::{Digest, Sha256};

use crate::build::Shelf;
use crate::dictionary::Clock;
use crate::vegetation::{process, Game, GameJob, Sandy};
use crate::vegetation_grass::{self, Grass, GrassJob, GrassPlan};

/// Задание сборки: файл игры с листами («Трава по миру») или карта травы.
pub enum VegJob {
    Game(GameJob),
    Grass(GrassJob),
}

impl VegJob {
    pub fn name(&self) -> &str {
        match self {
            Self::Game(job) => &job.name,
            Self::Grass(job) => &job.name,
        }
    }

    fn source(&self) -> (&str, Option<&Path>) {
        match self {
            Self::Game(job) => (&job.at, job.file.as_deref()),
            Self::Grass(job) => (&job.at, job.file.as_deref()),
        }
    }

    fn output(&self) -> &Path {
        match self {
            Self::Game(job) => &job.output,
            Self::Grass(job) => &job.output,
        }
    }
}

/// Итог задания.
pub enum GameDone {
    Built { bytes: usize, sha256: String, kinds: Vec<&'static str>, counts: Vec<(&'static str, u32)> },
    Unchanged,
    /// Файла по этому месту в игре нет.
    Missing,
    /// Файл собирает приложение прежним кодом.
    Fallback(String),
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

/// Пишет файл рядом под временным именем и переименовывает.
fn write_atomic(target: &Path, bytes: &[u8], tag: usize) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut name = target.as_os_str().to_owned();
    name.push(format!(".{}-{tag}.tmp", std::process::id()));
    let scratch = std::path::PathBuf::from(name);
    let written = fs::File::create(&scratch).and_then(|mut file| file.write_all(bytes));
    if let Err(error) = written {
        fs::remove_file(&scratch).ok();
        return Err(error.to_string());
    }
    match fs::rename(&scratch, target) {
        Ok(()) => Ok(()),
        Err(error) => {
            fs::remove_file(&scratch).ok();
            if target.is_file() {
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn build_one(job: &VegJob, index: usize, shelf: &Shelf, sandy: &Sandy, grass: &GrassPlan, clock: &Clock) -> GameDone {
    let read_from = Instant::now();
    let (at, file) = job.source();
    let raw = match file {
        Some(file) => fs::read(file).ok(),
        None => shelf.read(at),
    };
    Clock::add(&clock.read, read_from);
    let Some(raw) = raw else {
        return GameDone::Missing;
    };
    let (bytes, kinds, counts) = match job {
        VegJob::Game(job) => match process(&raw, job, sandy, clock) {
            Game::Fallback(reason) => return GameDone::Fallback(reason),
            Game::Unchanged => return GameDone::Unchanged,
            Game::Built(built) => (built.bytes, built.kinds, built.counts),
        },
        VegJob::Grass(job) => match vegetation_grass::process(&raw, job, grass, clock) {
            Grass::Fallback(reason) => return GameDone::Fallback(reason),
            Grass::Unchanged => return GameDone::Unchanged,
            Grass::Built { bytes, instances } => (bytes, vec!["grass"], vec![("grass", 1), ("instances", instances)]),
        },
    };
    let write_from = Instant::now();
    let done = match write_atomic(job.output(), &bytes, index) {
        Ok(()) => GameDone::Built { bytes: bytes.len(), sha256: hex(&Sha256::digest(&bytes)), kinds, counts },
        Err(reason) => GameDone::Fallback(format!("запись файла: {reason}")),
    };
    Clock::add(&clock.write, write_from);
    done
}

/// `count` заданий `threads` потоками; итоги — в порядке заданий (`None` — поток остановился, не досчитав).
fn run_jobs<T: Send>(count: usize, threads: usize, tick: &(dyn Fn(usize) + Sync), work: &(dyn Fn(usize) -> T + Sync)) -> Vec<Option<T>> {
    let next = AtomicUsize::new(0);
    let finished = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<T>>> = (0..count).map(|_| Mutex::new(None)).collect();
    let lane = || loop {
        let index = next.fetch_add(1, Ordering::Relaxed);
        if index >= count {
            break;
        }
        let done = work(index);
        if let Ok(mut slot) = slots[index].lock() {
            *slot = Some(done);
        }
        tick(finished.fetch_add(1, Ordering::Relaxed) + 1);
    };
    thread::scope(|scope| {
        for _ in 0..threads.clamp(1, count.max(1)) {
            scope.spawn(lane);
        }
    });
    slots.into_iter().map(|slot| slot.into_inner().ok().flatten()).collect()
}

/// Собирает задания `threads` потоками; итоги — в порядке заданий, рядом — время потоков по этапам. `tick` зовётся после каждого
/// задания, `stop` — спросить об отмене: после отмены остальные задания отдаются как `Fallback`.
#[allow(clippy::too_many_arguments)]
pub fn build_games(jobs: &[VegJob], shelf: &Shelf, sandy: &Sandy, grass: &GrassPlan, threads: usize, tick: &(dyn Fn(usize) + Sync), stop: &(dyn Fn() -> bool + Sync)) -> (Vec<GameDone>, Clock) {
    let clock = Clock::default();
    let done = run_jobs(jobs.len(), threads, tick, &|index| {
        if stop() {
            GameDone::Fallback("отменено".to_owned())
        } else {
            build_one(&jobs[index], index, shelf, sandy, grass, &clock)
        }
    })
    .into_iter()
    .map(|done| done.unwrap_or_else(|| GameDone::Fallback("поток сборки остановился".to_owned())))
    .collect();
    (done, clock)
}
