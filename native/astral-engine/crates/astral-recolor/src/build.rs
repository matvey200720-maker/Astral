//! Сборка набора: словари читаются из архивов игры, собираются несколькими потоками с общей
//! памятью готовых листов и пишутся на диск.
//!
//! Место словаря — как у читателя приложения (`apps/desktop/src/game-archive-reader.js`):
//! `метка:путь`, где метка — `update`, `x64?.rpf`, `common.rpf` или
//! `update/x64/dlcpacks/<пакет>/dlc.rpf`, а путь идёт по папкам и вложенным архивам.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind, KeySet};
use sha2::{Digest, Sha256};

use crate::dictionary::{process, Clock, Family, Outcome, SheetMemo, Stats};
use crate::roads::Look;
use crate::water::{process_tile, Fog, Rect, Tile};

/// Наибольшая длина имени пакета дополнений в метке.
const MAX_PACK_NAME: usize = 40;

/// Одно задание: словарь `name` лежит в игре по месту `at` (или файлом `file` на диске — стенды и
/// тесты без игры), готовый файл нужен в `output`.
pub struct Job {
    pub name: String,
    pub at: String,
    pub file: Option<PathBuf>,
    pub output: PathBuf,
}

/// Итог задания.
pub enum Done {
    Built { bytes: usize, sha256: String, textures: Vec<String>, stats: Stats },
    Unchanged(Stats),
    /// Словаря по этому месту в игре нет.
    Missing,
    /// Файл собирает приложение прежним кодом.
    Fallback(String),
}

/// Файл архива по метке; `None` — такого архива не бывает.
fn file_of_label(root: &Path, label: &str) -> Option<PathBuf> {
    if label == "update" {
        return Some(root.join("update").join("update.rpf"));
    }
    let base = label.len() == 8 && label.starts_with("x64") && label.ends_with(".rpf") && label.as_bytes()[3].is_ascii_lowercase();
    if base || label == "common.rpf" {
        return Some(root.join(label));
    }
    let pack = label.strip_prefix("update/x64/dlcpacks/")?.strip_suffix("/dlc.rpf")?;
    let word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    if pack.is_empty() || pack.len() > MAX_PACK_NAME || !pack.bytes().all(word) {
        return None;
    }
    Some(root.join("update").join("x64").join("dlcpacks").join(pack).join("dlc.rpf"))
}

/// Место обхода: архив (основной или раскрытый из него) и каталог в нём.
#[derive(Clone)]
struct Place {
    archive: Arc<Archive>,
    dir: EntryId,
}

/// Открытые архивы одной папки игры. Архив и каждое пройденное звено пути открываются один раз на сборку.
pub struct Shelf {
    root: PathBuf,
    keys: Option<Arc<KeySet>>,
    /// Архивы по своей метке вне раскладки игры (чистая основа `update.rpf` из кэша Astral).
    extra: HashMap<String, PathBuf>,
    archives: Mutex<HashMap<String, Option<Arc<Archive>>>>,
    places: Mutex<HashMap<String, Place>>,
}

impl Shelf {
    pub fn new(root: PathBuf, keys: Option<Arc<KeySet>>) -> Self {
        Self::with_archives(root, keys, HashMap::new())
    }

    /// Полка с архивами по своим меткам: метка из `extra` читается из названного файла, остальные — по раскладке игры.
    pub fn with_archives(root: PathBuf, keys: Option<Arc<KeySet>>, extra: HashMap<String, PathBuf>) -> Self {
        Self { root, keys, extra, archives: Mutex::new(HashMap::new()), places: Mutex::new(HashMap::new()) }
    }

    fn archive(&self, label: &str) -> Option<Arc<Archive>> {
        if let Some(known) = self.archives.lock().ok()?.get(label) {
            return known.clone();
        }
        /* Открытие — вне замка: оглавление большого архива читается долго, остальным потокам ждать незачем. */
        let opened = self
            .extra
            .get(label)
            .cloned()
            .or_else(|| file_of_label(&self.root, label))
            .filter(|file| file.is_file())
            .and_then(|file| Archive::open_path(&file, self.keys.clone()).ok())
            .map(Arc::new);
        let mut archives = self.archives.lock().ok()?;
        archives.entry(label.to_owned()).or_insert(opened).clone()
    }

    /// Запись каталога по имени без учёта регистра ASCII; при повторе — первая.
    fn find(archive: &Archive, pool: &[EntryId], name: &str) -> Option<EntryId> {
        pool.iter().copied().find(|&id| archive.entry(id).name.eq_ignore_ascii_case(name))
    }

    /// Шаг по звену пути: в подкаталог, а если его нет — во вложенный архив с таким именем.
    fn enter(&self, here: &Place, link: &str) -> Option<Place> {
        if let Some(dir) = Self::find(&here.archive, here.archive.dirs(here.dir), link) {
            return Some(Place { archive: Arc::clone(&here.archive), dir });
        }
        let nested = Self::find(&here.archive, here.archive.files(here.dir), link).filter(|_| Archive::is_nested_archive_name(link))?;
        let inner = Arc::new(here.archive.open_nested(nested).ok()?);
        Some(Place { dir: inner.root(), archive: inner })
    }

    /// Байты записи по месту `метка:путь`; `None` — записи нет (или архив не открылся).
    pub fn read(&self, at: &str) -> Option<Vec<u8>> {
        let cut = at.find(':')?;
        let (label, inner) = (&at[..cut], &at[cut + 1..]);
        let links: Vec<&str> = inner.split('/').filter(|link| !link.is_empty()).collect();
        let (leaf, route) = links.split_last()?;
        let top = self.archive(label)?;
        let mut here = Place { dir: top.root(), archive: top };
        let mut key = label.to_ascii_lowercase();
        for link in route {
            key.push('/');
            key.push_str(&link.to_ascii_lowercase());
            let known = self.places.lock().ok()?.get(&key).cloned();
            here = match known {
                Some(place) => place,
                None => {
                    let next = self.enter(&here, link)?;
                    self.places.lock().ok()?.entry(key.clone()).or_insert(next).clone()
                }
            };
        }
        let id = Self::find(&here.archive, here.archive.files(here.dir), leaf)?;
        match here.archive.entry(id).kind {
            EntryKind::Resource(_) => here.archive.export(id).ok(),
            _ => here.archive.decode(id, EntryCipher::ByArchive).ok(),
        }
    }
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

/// Пишет файл рядом под временным именем и переименовывает; занятое имя с тем же ключом — тот же файл.
fn write_atomic(target: &Path, bytes: &[u8], tag: usize) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut name = target.as_os_str().to_owned();
    name.push(format!(".{}-{tag}.tmp", std::process::id()));
    let scratch = PathBuf::from(name);
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

fn build_one(job: &Job, index: usize, shelf: &Shelf, look: &Look, families: &HashMap<String, Family>, memo: &SheetMemo, clock: &Clock) -> Done {
    let read_from = Instant::now();
    let raw = match &job.file {
        Some(file) => fs::read(file).ok(),
        None => shelf.read(&job.at),
    };
    Clock::add(&clock.read, read_from);
    let Some(raw) = raw else {
        return Done::Missing;
    };
    match process(&raw, &job.name, look, families, memo, clock) {
        Outcome::Fallback(reason) => Done::Fallback(reason),
        Outcome::Unchanged(stats) => Done::Unchanged(stats),
        Outcome::Built(built) => {
            let write_from = Instant::now();
            let written = write_atomic(&job.output, &built.bytes, index);
            let done = match written {
                Ok(()) => Done::Built {
                    bytes: built.bytes.len(),
                    sha256: hex(&Sha256::digest(&built.bytes)),
                    textures: built.textures,
                    stats: built.stats,
                },
                Err(reason) => Done::Fallback(format!("запись файла: {reason}")),
            };
            Clock::add(&clock.write, write_from);
            done
        }
    }
}

/// Собирает задания `threads` потоками; итоги — в порядке заданий, рядом — время потоков по этапам.
/// `tick` зовётся после каждого задания, `stop` — спросить об отмене: после отмены остальные задания
/// отдаются как `Fallback`.
#[allow(clippy::too_many_arguments)]
pub fn build(
    jobs: &[Job],
    shelf: &Shelf,
    look: &Look,
    families: &HashMap<String, Family>,
    threads: usize,
    memo_limit: usize,
    tick: &(dyn Fn(usize) + Sync),
    stop: &(dyn Fn() -> bool + Sync),
) -> (Vec<Done>, Clock) {
    let memo = SheetMemo::new(memo_limit);
    let clock = Clock::default();
    let done = run_jobs(jobs.len(), threads, tick, &|index| {
        if stop() {
            Done::Fallback("отменено".to_owned())
        } else {
            build_one(&jobs[index], index, shelf, look, families, &memo, &clock)
        }
    })
    .into_iter()
    .map(|done| done.unwrap_or_else(|| Done::Fallback("поток сборки остановился".to_owned())))
    .collect();
    (done, clock)
}

/// `count` заданий `threads` потоками; итоги — в порядке заданий (`None` — поток остановился, не досчитав).
/// `tick` зовётся после каждого задания с числом готовых.
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

/// Задание воды: плитка тумана `name` лежит по месту `at` (или файлом `file`), её мировой
/// прямоугольник — `rect`, готовый файл нужен в `output`.
pub struct TileJob {
    pub name: String,
    pub at: String,
    pub file: Option<PathBuf>,
    pub rect: Rect,
    pub output: PathBuf,
}

/// Итог плитки.
pub enum TileDone {
    Built { bytes: usize, sha256: String },
    /// Правка плитку не меняет.
    Unchanged,
    /// Плитки по этому месту нет.
    Missing,
    /// Плитку собирает приложение прежним кодом.
    Fallback(String),
}

fn build_tile(job: &TileJob, index: usize, shelf: &Shelf, fog: &Fog, clock: &Clock) -> TileDone {
    let read_from = Instant::now();
    let raw = match &job.file {
        Some(file) => fs::read(file).ok(),
        None => shelf.read(&job.at),
    };
    Clock::add(&clock.read, read_from);
    let Some(raw) = raw else {
        return TileDone::Missing;
    };
    match process_tile(&raw, &job.name, &job.rect, fog, clock) {
        Tile::Fallback(reason) => TileDone::Fallback(reason),
        Tile::Unchanged => TileDone::Unchanged,
        Tile::Built(bytes) => {
            let write_from = Instant::now();
            let done = match write_atomic(&job.output, &bytes, index) {
                Ok(()) => TileDone::Built { bytes: bytes.len(), sha256: hex(&Sha256::digest(&bytes)) },
                Err(reason) => TileDone::Fallback(format!("запись файла: {reason}")),
            };
            Clock::add(&clock.write, write_from);
            done
        }
    }
}

/// Плитки тумана воды `threads` потоками; итоги — в порядке заданий, рядом — время потоков по этапам.
pub fn build_tiles(jobs: &[TileJob], shelf: &Shelf, fog: &Fog, threads: usize, tick: &(dyn Fn(usize) + Sync), stop: &(dyn Fn() -> bool + Sync)) -> (Vec<TileDone>, Clock) {
    let clock = Clock::default();
    let done = run_jobs(jobs.len(), threads, tick, &|index| {
        if stop() {
            TileDone::Fallback("отменено".to_owned())
        } else {
            build_tile(&jobs[index], index, shelf, fog, &clock)
        }
    })
    .into_iter()
    .map(|done| done.unwrap_or_else(|| TileDone::Fallback("поток сборки остановился".to_owned())))
    .collect();
    (done, clock)
}
