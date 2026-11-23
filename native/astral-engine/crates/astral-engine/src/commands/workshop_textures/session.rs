//! Общий сеанс чтения игры: открытые архивы и разобранные ресурсы живут между пачками.
//!
//! Так же, как у читателя JS (`share: true`, `acquireSession`): пачки с одной парой «папка игры,
//! папка ключей» делят один читатель архивов и одну таблицу разобранных ресурсов. Пачка берёт
//! сеанс (`lease`) и отдаёт его в конце; когда пачек не осталось, через `idle` (у JS и здесь — 2 с)
//! архивы закрываются, а таблица очищается: простаивающий сеанс не держит `update.rpf` открытым,
//! а открытый архив мешает установке модов.
//!
//! Таблица — по разжатым байтам ресурсов, потолок мягкий (256 МиБ, у JS так же): сверх него уходят
//! давно не использованные, прочитанные до конца записи. Ресурс, что держит идущая пачка, не
//! пропадает: у неё своя ссылка. Ключ записи несёт отпечаток архива — изменившийся архив никогда
//! не отдаёт старый разбор; неудачное чтение и «файла нет» в таблице не остаются.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, OnceLock, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use rage_res::resource::Resource;
use rage_res::texture::TextureRef;
use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind, KeySet};

use super::probe::{Probe, Stage};
use crate::archives::load_keys;
use crate::error::{EngineError, Result};

/// Сколько сеанс живёт без пачек (у JS — `SESSION_IDLE_MS`).
pub const IDLE: Duration = Duration::from_millis(2000);
/// Потолок таблицы по разжатым байтам (у JS — `RESOURCE_BUDGET_BYTES`).
pub const BUDGET_BYTES: usize = 256 * 1024 * 1024;
/// Предохранитель от россыпи мелких записей.
const MAX_ENTRIES: usize = 2048;

pub fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

// ------------------------------------------------------------------ игра: архивы по меткам

/// Архив метки: открывается один раз, неудача открытия — `None`.
type Opened = Arc<OnceLock<Option<Arc<Archive>>>>;

/// Архивы одной папки игры: открываются по требованию и держатся открытыми. Неудача открытия
/// архива (нет файла, битый) тоже запоминается до закрытия сеанса.
pub struct Game {
    root: PathBuf,
    root_text: String,
    keys_dir: Option<String>,
    keyset: Mutex<Option<Arc<KeySet>>>,
    archives: Mutex<HashMap<String, Opened>>,
}

/// Метка → файл архива; `None` — такого архива не бывает (как `fileOfLabel` читателя).
fn label_file(root: &Path, label: &str) -> Option<PathBuf> {
    if label == "update" {
        return Some(root.join("update").join("update.rpf"));
    }
    let bytes = label.as_bytes();
    let base = label == "common.rpf"
        || (bytes.len() == 8
            && label.starts_with("x64")
            && bytes[3].is_ascii_alphabetic()
            && label.ends_with(".rpf"));
    if base {
        return Some(root.join(label));
    }
    let pack = label
        .strip_prefix("update/x64/dlcpacks/")?
        .strip_suffix("/dlc.rpf")?;
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    (!pack.is_empty() && pack.len() <= 40 && pack.chars().all(word)).then(|| {
        root.join("update")
            .join("x64")
            .join("dlcpacks")
            .join(pack)
            .join("dlc.rpf")
    })
}

/// Метка и путь внутри архива: метка — всё до первого двоеточия.
pub fn split_place(place: &str) -> (&str, &str) {
    place.split_once(':').unwrap_or((place, ""))
}

/// Байты записи так, как их отдаёт читатель JS: ресурс — файлом RSC7, прочее — раскрытым.
fn entry_bytes(archive: &Archive, id: EntryId) -> Result<Option<Vec<u8>>> {
    match archive.entry(id).kind {
        EntryKind::Resource(_) => Ok(Some(archive.export(id)?)),
        EntryKind::Binary(_) => Ok(Some(archive.decode(id, EntryCipher::ByArchive)?)),
        EntryKind::Directory { .. } => Ok(None),
    }
}

/// Спуск по каталогам и вложенным `.rpf` (как папкам); вложенный архив разбирается один раз
/// за жизнь внешнего (`open_nested_shared`). Нет такого пути или вложенный архив не открылся — `None`.
fn descend(archive: &Arc<Archive>, parts: &[&str]) -> Option<(Arc<Archive>, EntryId)> {
    let mut holder = Arc::clone(archive);
    let mut dir = holder.root();
    for part in parts {
        if let Some(sub) = holder.find_dir(dir, part) {
            dir = sub;
            continue;
        }
        let pack = Some(*part)
            .filter(|name| Archive::is_nested_archive_name(name))
            .and_then(|name| holder.find_file(dir, name))
            .filter(|&id| matches!(holder.entry(id).kind, EntryKind::Binary(_)))?;
        let nested = holder.open_nested_shared(pack).ok()?;
        dir = nested.root();
        holder = nested;
    }
    Some((holder, dir))
}

fn path_parts(inner: &str) -> Vec<&str> {
    inner.split('/').filter(|part| !part.is_empty()).collect()
}

impl Game {
    /// `preset` — готовый набор ключей (проверки без папки ключей); в работе его нет.
    pub fn new(
        root: &Path,
        root_text: &str,
        keys_dir: Option<String>,
        preset: Option<Arc<KeySet>>,
    ) -> Game {
        Game {
            root: root.to_path_buf(),
            root_text: root_text.to_owned(),
            keys_dir,
            keyset: Mutex::new(preset),
            archives: Mutex::new(HashMap::new()),
        }
    }

    /// Ключи архивов: читаются один раз за сеанс; отказ не запоминается (следующий вызов читает заново).
    fn keyset(&self, probe: &Probe) -> Result<Arc<KeySet>> {
        let mut held = locked(&self.keyset);
        if let Some(keys) = held.as_ref() {
            return Ok(Arc::clone(keys));
        }
        let began = Instant::now();
        let (keys, _) = load_keys(&self.root_text, self.keys_dir.as_deref())?;
        Probe::count(&probe.opens, 1);
        probe.add(Stage::Open, began);
        *held = Some(Arc::clone(&keys));
        Ok(keys)
    }

    /// Архив по метке; `Ok(None)` — файла нет или он не открылся. Отказ — только у ключей.
    fn archive(&self, label: &str, probe: &Probe) -> Result<Option<Arc<Archive>>> {
        let keys = self.keyset(probe)?;
        let Some(file) = label_file(&self.root, label) else {
            return Ok(None);
        };
        let slot = {
            let mut table = locked(&self.archives);
            Arc::clone(table.entry(label.to_owned()).or_default())
        };
        Ok(slot
            .get_or_init(|| Archive::open_path(&file, Some(keys)).ok().map(Arc::new))
            .clone())
    }

    /// Байты файла по месту `метка:путь`; `Ok(None)` — файла нет (в том числе архив не открылся).
    pub fn read(&self, place: &str, probe: &Probe) -> Result<Option<Vec<u8>>> {
        let (label, inner) = split_place(place);
        let Some(archive) = self.archive(label, probe)? else {
            return Ok(None);
        };
        let parts = path_parts(inner);
        let Some((name, folders)) = parts.split_last() else {
            return Ok(None);
        };
        let Some((holder, dir)) = descend(&archive, folders) else {
            return Ok(None);
        };
        let Some(id) = holder.find_file(dir, name) else {
            return Ok(None);
        };
        entry_bytes(&holder, id)
    }

    /// Файлы папки (без вложенных папок) как `метка:путь` в нижнем регистре; нет архива или папки — пусто.
    pub fn list(&self, folder: &str, probe: &Probe) -> Result<Vec<String>> {
        let (label, inner) = split_place(folder);
        let Some(archive) = self.archive(label, probe)? else {
            return Ok(Vec::new());
        };
        let parts = path_parts(inner);
        let Some((holder, dir)) = descend(&archive, &parts) else {
            return Ok(Vec::new());
        };
        let prefix = parts.join("/").to_lowercase();
        Ok(holder
            .files(dir)
            .iter()
            .map(|&id| format!("{label}:{prefix}/{}", holder.entry(id).name.to_lowercase()))
            .collect())
    }
}

// ------------------------------------------------------------------ таблица разобранных ресурсов

/// Разобранный ресурс: описания листов и байты, на которые они ссылаются. Ресурс без листов
/// (пустой, не разобрался, слишком большой) байтов не держит.
pub struct Parsed {
    pub resource: Option<Resource>,
    pub refs: Vec<TextureRef>,
}

impl Parsed {
    pub fn empty() -> Parsed {
        Parsed {
            resource: None,
            refs: Vec::new(),
        }
    }

    fn size(&self) -> usize {
        self.resource.as_ref().map_or(0, Resource::len)
    }
}

/// Итог чтения ресурса.
#[derive(Clone)]
pub enum Loaded {
    Found(Arc<Parsed>),
    /// Файла нет: в таблице не остаётся (архив мог не открыться).
    Missing,
}

struct Entry {
    base: String,
    cell: OnceLock<std::result::Result<Loaded, String>>,
    used: AtomicU64,
    size: AtomicUsize,
    counted: AtomicBool,
}

#[derive(Default)]
struct Table {
    map: HashMap<String, Arc<Entry>>,
    bytes: usize,
    tick: u64,
}

impl Table {
    fn remove(&mut self, key: &str) {
        if let Some(entry) = self.map.remove(key) {
            if entry.counted.swap(false, Relaxed) {
                self.bytes = self.bytes.saturating_sub(entry.size.load(Relaxed));
            }
        }
    }

    /// Потолок по байтам и по числу записей: уходят давно не использованные, прочитанные до конца.
    fn enforce(&mut self, budget: usize) {
        while self.bytes > budget || self.map.len() > MAX_ENTRIES {
            let victim = self
                .map
                .iter()
                .filter(|(_, entry)| entry.cell.get().is_some())
                .min_by_key(|(_, entry)| entry.used.load(Relaxed))
                .map(|(key, _)| key.clone());
            match victim {
                Some(key) => self.remove(&key),
                None => return,
            }
        }
    }
}

#[derive(Default)]
struct State {
    users: usize,
    generation: u64,
    table: Table,
    game: Option<Arc<Game>>,
}

/// Сеанс: игра и таблица ресурсов на пару «папка игры, папка ключей».
pub struct Session {
    key: String,
    shared: bool,
    state: Mutex<State>,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Arc<Session>>>> = LazyLock::new(Mutex::default);

/// Сеанс на время пачки. `shared: false` — сеанс только этой пачки, закрывается сразу.
pub struct Lease {
    session: Arc<Session>,
    idle: Duration,
}

pub fn lease(key: &str, shared: bool, idle: Duration) -> Lease {
    let session = if shared {
        let mut registry = locked(&SESSIONS);
        let session = Arc::clone(registry.entry(key.to_owned()).or_insert_with(|| {
            Arc::new(Session {
                key: key.to_owned(),
                shared: true,
                state: Mutex::default(),
            })
        }));
        // Счёт пользователей растёт под замком реестра: закрытие по простою не уведёт сеанс из-под пачки.
        let mut state = locked(&session.state);
        state.users += 1;
        state.generation += 1;
        drop(state);
        session
    } else {
        let session = Arc::new(Session {
            key: key.to_owned(),
            shared: false,
            state: Mutex::default(),
        });
        locked(&session.state).users = 1;
        session
    };
    Lease { session, idle }
}

impl Lease {
    /// Читатель игры сеанса: создаётся при первой просьбе (ключи читаются позже, при первом чтении архива).
    pub fn game(
        &self,
        root: &Path,
        root_text: &str,
        keys_dir: Option<&str>,
        preset: Option<Arc<KeySet>>,
    ) -> Arc<Game> {
        let mut state = locked(&self.session.state);
        Arc::clone(state.game.get_or_insert_with(|| {
            Arc::new(Game::new(
                root,
                root_text,
                keys_dir.map(str::to_owned),
                preset,
            ))
        }))
    }

    /// Разобранный ресурс по `base` (источник и путь) и отпечатку `stamp`: из таблицы или прочитанный
    /// `load`. Параллельные просьбы об одном ресурсе ждут одного чтения. Второе значение — взят ли
    /// уже существующий (прочитанный или читаемый другим потоком).
    pub fn resource(
        &self,
        base: &str,
        stamp: &str,
        budget: usize,
        load: impl FnOnce() -> Result<Loaded>,
    ) -> Result<(Loaded, bool)> {
        let key = format!("{base}|{stamp}");
        let (entry, reused) = {
            let mut state = locked(&self.session.state);
            state.table.tick += 1;
            let tick = state.table.tick;
            let known = state.table.map.get(&key).map(Arc::clone);
            let reused = known.is_some();
            let entry = known.unwrap_or_else(|| {
                // Старые разборы того же ресурса (другой отпечаток архива) не нужны.
                let stale: Vec<String> = state
                    .table
                    .map
                    .iter()
                    .filter(|(_, other)| other.base == base && other.cell.get().is_some())
                    .map(|(other_key, _)| other_key.clone())
                    .collect();
                for other in stale {
                    state.table.remove(&other);
                }
                let entry = Arc::new(Entry {
                    base: base.to_owned(),
                    cell: OnceLock::new(),
                    used: AtomicU64::new(tick),
                    size: AtomicUsize::new(0),
                    counted: AtomicBool::new(false),
                });
                state.table.map.insert(key.clone(), Arc::clone(&entry));
                entry
            });
            entry.used.store(tick, Relaxed);
            (entry, reused)
        };
        let outcome = entry.cell.get_or_init(|| {
            let outcome = load().map_err(|error| error.to_string());
            let mut state = locked(&self.session.state);
            let current = state
                .table
                .map
                .get(&key)
                .is_some_and(|held| Arc::ptr_eq(held, &entry));
            match &outcome {
                Ok(Loaded::Found(parsed)) if current => {
                    entry.size.store(parsed.size(), Relaxed);
                    entry.counted.store(true, Relaxed);
                    state.table.bytes += parsed.size();
                    state.table.enforce(budget);
                }
                // Нет файла и отказ в таблице не остаются.
                _ if current => state.table.remove(&key),
                _ => {}
            }
            outcome
        });
        match outcome {
            Ok(loaded) => Ok((loaded.clone(), reused)),
            Err(message) => Err(EngineError::io(message.clone())),
        }
    }
}

impl Session {
    fn clear(&self) {
        let mut state = locked(&self.state);
        state.table = Table::default();
        state.game = None;
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        let session = Arc::clone(&self.session);
        let generation = {
            let mut state = locked(&session.state);
            state.users -= 1;
            if state.users > 0 {
                return;
            }
            state.generation += 1;
            state.generation
        };
        if !session.shared {
            session.clear();
            return;
        }
        let idle = self.idle;
        // Таймер не держит процесс: поток отсоединён, ему нечего освобождать, кроме сеанса.
        thread::spawn(move || {
            thread::sleep(idle);
            let mut registry = locked(&SESSIONS);
            let mut state = locked(&session.state);
            if state.users == 0 && state.generation == generation {
                state.table = Table::default();
                state.game = None;
                if registry
                    .get(&session.key)
                    .is_some_and(|held| Arc::ptr_eq(held, &session))
                {
                    registry.remove(&session.key);
                }
            }
        });
    }
}

/// Сколько записей и байт в таблице сеанса (для проверок); `None` — сеанса нет.
#[cfg(test)]
pub fn table_stats(key: &str) -> Option<(usize, usize, bool)> {
    let session = locked(&SESSIONS).get(key).map(Arc::clone)?;
    let state = locked(&session.state);
    Some((
        state.table.map.len(),
        state.table.bytes,
        state.game.is_some(),
    ))
}
