//! Кэш сырых блоков листов на диске: те же файлы, что у читателя JS (`workshop-sheet-cache.js`).
//!
//! Файл — контейнер ASB1 ровно с одной записью без бита «из кэша», имя — первые 32 знака sha256 от
//! ключа и `.asb`, папка `bcn1/`. Читатель JS и движок кладут и читают одни и те же файлы: файл
//! проверяется целиком при чтении (`parse_single`), запись атомарна (временный файл и
//! переименование), любая ошибка диска — не ошибка ответа. Потолок папки — 512 МиБ; сверх него
//! уходят давно не использованные (время использования — mtime файла) до 90 %; только что
//! записанный файл не удаляется; временные файлы старше десяти минут при старте удаляются.
//!
//! Это единственный файл команды с прямой записью (свой черновик и `rename`, он в списке сторожа
//! `no_command_writes_its_result_straight_to_the_output`): блоки пишутся потоком, без второй копии.

use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, SystemTime};

use rage_res::sheet_blocks::{
    container_len, parse_single, write_container, Record, ENTRY_BYTES, HEADER_BYTES,
};
use sha2::{Digest, Sha256};

pub const FOLDER: &str = "bcn1";
pub const LIMIT_BYTES: u64 = 512 * 1024 * 1024;
const KEEP_FRACTION: f64 = 0.9;
const STALE_TEMP: Duration = Duration::from_secs(10 * 60);
const EXTENSION: &str = ".asb";
const PAYLOAD_START: usize = HEADER_BYTES + ENTRY_BYTES;

/// Имя файла по ключу: первые 32 знака sha256 (hex, нижний регистр) и `.asb`.
pub fn file_name(key: &str) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut name = String::with_capacity(32 + EXTENSION.len());
    for byte in Sha256::digest(key.as_bytes()).iter().take(16) {
        name.push(char::from(DIGITS[usize::from(byte >> 4)]));
        name.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    name.push_str(EXTENSION);
    name
}

/// Проверенный файл кэша: байты целиком, запись (с битом «из кэша») и длина нагрузки.
pub struct Hit {
    bytes: Vec<u8>,
    pub record: Record,
    payload_len: usize,
}

impl Hit {
    pub fn payload(&self) -> &[u8] {
        &self.bytes[PAYLOAD_START..PAYLOAD_START + self.payload_len]
    }
}

struct Inner {
    /// Имя файла → размер и время использования.
    files: HashMap<String, (u64, SystemTime)>,
    total: u64,
    /// Обход папки закончен: до этого потолок не применяется.
    scanned: bool,
    /// Файлы, чьё время использования уже освежено в этом сеансе.
    touched: HashSet<String>,
}

pub struct SheetCache {
    dir: PathBuf,
    limit: u64,
    inner: Mutex<Inner>,
    sequence: AtomicU64,
}

static CACHES: LazyLock<Mutex<HashMap<PathBuf, Arc<SheetCache>>>> = LazyLock::new(Mutex::default);

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Кэш папки `dir` (`<stateDir>/workshop-textures/bcn1`): один на папку на весь сеанс движка;
/// обход папки идёт один раз в своём потоке.
pub fn open(dir: &Path) -> Arc<SheetCache> {
    open_with_limit(dir, LIMIT_BYTES)
}

pub fn open_with_limit(dir: &Path, limit: u64) -> Arc<SheetCache> {
    let mut caches = locked(&CACHES);
    if let Some(known) = caches.get(dir) {
        return Arc::clone(known);
    }
    let cache = Arc::new(SheetCache {
        dir: dir.to_path_buf(),
        limit,
        inner: Mutex::new(Inner {
            files: HashMap::new(),
            total: 0,
            scanned: false,
            touched: HashSet::new(),
        }),
        sequence: AtomicU64::new(0),
    });
    caches.insert(dir.to_path_buf(), Arc::clone(&cache));
    let scanning = Arc::clone(&cache);
    thread::spawn(move || scanning.scan());
    cache
}

impl SheetCache {
    /// Один обход папки: размеры и времена файлов, остатки временных файлов.
    fn scan(&self) {
        let mut found = Vec::new();
        if let Ok(names) = fs::read_dir(&self.dir) {
            for entry in names.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_file() {
                    continue;
                }
                let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                if name.ends_with(EXTENSION) {
                    found.push((name, meta.len(), modified));
                } else if name.ends_with(".tmp")
                    && SystemTime::now()
                        .duration_since(modified)
                        .is_ok_and(|age| age > STALE_TEMP)
                {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        {
            let mut guard = locked(&self.inner);
            let inner = &mut *guard;
            for (name, size, used) in found {
                // Файл, который уже записал или прочитал этот же процесс, не пересчитывается.
                if let Entry::Vacant(slot) = inner.files.entry(name) {
                    slot.insert((size, used));
                    inner.total += size;
                }
            }
            inner.scanned = true;
        }
        self.evict(None);
    }

    /// Сверх потолка уходят давно не использованные до 90 % потолка; `keep` не трогается.
    fn evict(&self, keep: Option<&str>) {
        let mut inner = locked(&self.inner);
        if !inner.scanned || inner.total <= self.limit {
            return;
        }
        let target = (self.limit as f64 * KEEP_FRACTION) as u64;
        let mut order: Vec<(String, u64, SystemTime)> = inner
            .files
            .iter()
            .filter(|(name, _)| Some(name.as_str()) != keep)
            .map(|(name, (size, used))| (name.clone(), *size, *used))
            .collect();
        order.sort_by(|a, b| a.2.cmp(&b.2).then_with(|| a.0.cmp(&b.0)));
        for (name, size, _) in order {
            if inner.total <= target {
                break;
            }
            inner.files.remove(&name);
            inner.touched.remove(&name);
            inner.total = inner.total.saturating_sub(size);
            let _ = fs::remove_file(self.dir.join(&name));
        }
    }

    fn forget(&self, name: &str) {
        let mut inner = locked(&self.inner);
        if let Some((size, _)) = inner.files.remove(name) {
            inner.total = inner.total.saturating_sub(size);
        }
        inner.touched.remove(name);
    }

    /// Файл ключа: `None` — файла нет, он не прошёл проверку (тогда он удаляется) или диск не читается.
    /// Попадание освежает время использования файла: в памяти сразу, на диске раз за сеанс.
    pub fn get(&self, key: &str) -> Option<Hit> {
        let name = file_name(key);
        let path = self.dir.join(&name);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                if error.kind() == ErrorKind::NotFound {
                    self.forget(&name);
                }
                return None;
            }
        };
        let Some(single) = parse_single(&bytes) else {
            self.forget(&name);
            let _ = fs::remove_file(&path);
            return None;
        };
        let (record, payload_len) = (single.record, single.payload.len());
        let now = SystemTime::now();
        let first_touch = {
            let mut inner = locked(&self.inner);
            let known = inner.files.get(&name).map_or(0, |(size, _)| *size);
            inner.total = (inner.total + bytes.len() as u64).saturating_sub(known);
            inner.files.insert(name.clone(), (bytes.len() as u64, now));
            inner.touched.insert(name)
        };
        if first_touch {
            if let Ok(file) = OpenOptions::new().write(true).open(&path) {
                let _ = file.set_modified(now);
            }
        }
        Some(Hit {
            bytes,
            record,
            payload_len,
        })
    }

    /// Кладёт файл с одной записью под ключ. `true` — лежит на диске; `false` — не записан (диск,
    /// файл больше потолка). Нагрузка пишется потоком, без второй копии в памяти.
    pub fn put(&self, key: &str, record: &Record, payload: &[u8]) -> bool {
        let name = file_name(key);
        let size = container_len([payload.len()]) as u64;
        if size > self.limit || payload.is_empty() {
            return false;
        }
        let file = self.dir.join(&name);
        let temporary = self.dir.join(format!(
            "{name}.{}.{}.tmp",
            std::process::id(),
            self.sequence.fetch_add(1, Relaxed) + 1
        ));
        let written = fs::create_dir_all(&self.dir)
            .and_then(|()| File::create(&temporary))
            .and_then(|handle| {
                let mut out = BufWriter::with_capacity(64 * 1024, handle);
                write_container(&mut out, &[(record.uncached(), payload)])?;
                out.flush()
            })
            .and_then(|()| fs::rename(&temporary, &file));
        if written.is_err() {
            let _ = fs::remove_file(&temporary);
            return locked(&self.inner).files.contains_key(&name);
        }
        {
            let mut inner = locked(&self.inner);
            let known = inner.files.get(&name).map_or(0, |(old, _)| *old);
            inner.total = (inner.total + size).saturating_sub(known);
            inner.files.insert(name.clone(), (size, SystemTime::now()));
            inner.touched.insert(name.clone());
        }
        self.evict(Some(&name));
        true
    }

    /// Сколько файлов и байт знает кэш (для проверок).
    #[cfg(test)]
    pub fn stats(&self) -> (usize, u64) {
        let inner = locked(&self.inner);
        (inner.files.len(), inner.total)
    }

    /// Дождаться конца обхода папки (для тестов).
    #[cfg(test)]
    pub fn wait_scanned(&self) {
        for _ in 0..2000 {
            if locked(&self.inner).scanned {
                return;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("обход папки кэша не закончился");
    }
}

/// Дописывает строку в журнал (`timings.jsonl`): без ожидания и без падения на ошибке диска.
pub fn append_line(path: &Path, line: &str) {
    let written = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| OpenOptions::new().create(true).append(true).open(path))
        .and_then(|mut file| writeln!(file, "{line}"));
    let _ = written;
}
