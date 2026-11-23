//! Полка ответов в памяти канала данных: готовые байты команды лежат здесь, пока их не заберут
//! `GET /a/<sha256>`, и в файл хранилища не пишутся.
//!
//! Зачем. Контейнер пачки `read-workshop-textures` — несколько мегабайт, которые окно или главный
//! процесс читают сразу после ответа. Через файл их читали по 77 мс на файл (проверка нового файла
//! защитником Windows), через память канала — по сокету петли без записи на диск.
//!
//! Правила полки:
//! - ответ кладётся, только когда канал данных поднят (`Shelf::port`): без канала, у разового
//!   запуска, класть некуда, и вызывающий пишет файл;
//! - ответ отдан целиком (`GET` без `Range`, код 200) — запись освобождена; `HEAD` и куски
//!   (206) её не освобождают;
//! - не забран за `ttl` (по умолчанию 30 с) — освобождён своим потоком, даже если никто не приходит;
//! - неотданные ответы вместе не больше `ceiling` байт (по умолчанию 256 МиБ); что не лезет, на
//!   полку не кладётся (вызывающий пишет файл), старые ответы не вытесняются;
//! - одинаковые байты, положенные несколько раз (параллельные пачки с одним содержимым), лежат
//!   одной записью со счётчиком: каждый вызов забирает свою долю, запись уходит с последней.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::error::Result;
use crate::http::{self, fingerprint};

/// Сколько ответ ждёт, пока его заберут.
pub const TTL: Duration = Duration::from_secs(30);
/// Сколько байт неотданных ответов держит полка.
pub const CEILING: usize = 256 * 1024 * 1024;

struct Held {
    bytes: Arc<Vec<u8>>,
    /// Сколько раз ответ положили и ещё не забрали.
    owed: usize,
    since: Instant,
}

#[derive(Default)]
struct State {
    held: HashMap<String, Held>,
    bytes: usize,
    sweeper: bool,
}

/// Положенный на полку ответ: отпечаток (он же имя в `GET /a/<sha256>`) и полный адрес.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lent {
    pub sha256: String,
    pub url: String,
}

pub struct Shelf {
    state: Mutex<State>,
    /// Порт канала данных; 0 — канал не поднят.
    port: AtomicU16,
    ttl: Duration,
    ceiling: usize,
}

impl Shelf {
    pub fn new() -> Arc<Shelf> {
        Shelf::with(TTL, CEILING)
    }

    pub fn with(ttl: Duration, ceiling: usize) -> Arc<Shelf> {
        Arc::new(Shelf {
            state: Mutex::new(State::default()),
            port: AtomicU16::new(0),
            ttl,
            ceiling,
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Порт канала, который отдаёт эту полку; `None` — канала нет.
    pub fn port(&self) -> Option<u16> {
        Some(self.port.load(Ordering::Acquire)).filter(|port| *port != 0)
    }

    pub(crate) fn open(&self, port: u16) {
        self.port.store(port, Ordering::Release);
    }

    pub fn url_of(&self, sha256: &str) -> Option<String> {
        self.port()
            .map(|port| format!("http://127.0.0.1:{port}/a/{sha256}"))
    }

    /// Кладёт ответ на полку. Нет канала, ответ не лезет под потолок или не завёлся поток уборки —
    /// байты возвращаются целыми, чтобы вызывающий записал их в файл.
    pub fn hold(self: &Arc<Self>, bytes: Vec<u8>) -> std::result::Result<Lent, Vec<u8>> {
        let Some(port) = self.port() else {
            return Err(bytes);
        };
        let sha256 = fingerprint(&bytes);
        let mut state = self.lock();
        let now = Instant::now();
        if let Some(held) = state.held.get_mut(&sha256) {
            held.owed += 1;
            held.since = now;
        } else {
            if bytes.len() > self.ceiling.saturating_sub(state.bytes) {
                return Err(bytes);
            }
            state.bytes += bytes.len();
            state.held.insert(
                sha256.clone(),
                Held {
                    bytes: Arc::new(bytes),
                    owed: 1,
                    since: now,
                },
            );
        }
        self.ensure_sweeper(&mut state);
        let url = format!("http://127.0.0.1:{port}/a/{sha256}");
        Ok(Lent { sha256, url })
    }

    /// Байты, пока они лежат на полке и срок не вышел. Ничего не освобождает.
    pub fn lookup(&self, sha256: &str) -> Option<Arc<Vec<u8>>> {
        let state = self.lock();
        let held = state.held.get(sha256)?;
        (held.since.elapsed() < self.ttl).then(|| Arc::clone(&held.bytes))
    }

    /// Ответ отдан целиком: одна доля снята, с последней запись уходит.
    pub fn settle(&self, sha256: &str) {
        let mut state = self.lock();
        let Some(held) = state.held.get_mut(sha256) else {
            return;
        };
        held.owed = held.owed.saturating_sub(1);
        if held.owed == 0 {
            if let Some(gone) = state.held.remove(sha256) {
                state.bytes = state.bytes.saturating_sub(gone.bytes.len());
            }
        }
    }

    /// Сколько байт и записей лежит сейчас (для проверок и `timings`).
    pub fn load(&self) -> (usize, usize) {
        let state = self.lock();
        (state.bytes, state.held.len())
    }

    fn ensure_sweeper(self: &Arc<Self>, state: &mut State) {
        if state.sweeper {
            return;
        }
        state.sweeper = true;
        let shelf = Arc::clone(self);
        let started = thread::Builder::new()
            .name(String::from("astral-data-shelf"))
            .spawn(move || shelf.sweep());
        if started.is_err() {
            state.sweeper = false;
        }
    }

    /// Убирает записи с вышедшим сроком; уходит, когда полка опустела.
    fn sweep(&self) {
        let tick = (self.ttl / 4).clamp(Duration::from_millis(5), Duration::from_secs(1));
        loop {
            thread::sleep(tick);
            let mut state = self.lock();
            let ttl = self.ttl;
            let mut freed = 0;
            state.held.retain(|_, held| {
                let alive = held.since.elapsed() < ttl;
                if !alive {
                    freed += held.bytes.len();
                }
                alive
            });
            state.bytes = state.bytes.saturating_sub(freed);
            if state.held.is_empty() {
                state.sweeper = false;
                return;
            }
        }
    }
}

/// Куда лёг готовый ответ команды и как его забрать (поле `container` ответа).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    pub sha256: String,
    pub bytes: usize,
    /// `memory` — на полке канала данных, `file` — в хранилище-папке.
    pub store: &'static str,
    /// Полный адрес `GET` на канале данных; без поднятого канала (разовый запуск) его нет.
    pub url: Option<String>,
}

impl Delivery {
    pub fn json(&self) -> Value {
        let mut found = json!({ "sha256": self.sha256, "bytes": self.bytes, "store": self.store });
        if let Some(url) = &self.url {
            found["url"] = json!(url);
        }
        found
    }
}

/// Ответ уходит на полку в памяти канала; без канала, по просьбе (`store: "file"`) и когда на полке
/// нет места — в файл хранилища, как раньше. Канал, если поднят, отдаёт и файл.
pub fn deliver(
    bytes: Vec<u8>,
    to_file: bool,
    shelf: Option<&Arc<Shelf>>,
    assets: &Path,
) -> Result<Delivery> {
    let length = bytes.len();
    let mut bytes = bytes;
    if !to_file {
        if let Some(shelf) = shelf {
            match shelf.hold(bytes) {
                Ok(lent) => {
                    return Ok(Delivery {
                        sha256: lent.sha256,
                        bytes: length,
                        store: "memory",
                        url: Some(lent.url),
                    });
                }
                Err(back) => bytes = back,
            }
        }
    }
    let sha256 = http::store(assets, &bytes)?;
    let url = shelf.and_then(|shelf| shelf.url_of(&sha256));
    Ok(Delivery {
        sha256,
        bytes: length,
        store: "file",
        url,
    })
}

/// Полка процесса: её заводит `http::start` боевого канала; в проверках не заводится — те ставят свою.
static PRODUCTION: Mutex<Option<Arc<Shelf>>> = Mutex::new(None);

pub fn production() -> Option<Arc<Shelf>> {
    PRODUCTION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[cfg(not(test))]
pub(crate) fn adopt(shelf: &Arc<Shelf>) {
    *PRODUCTION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Arc::clone(shelf));
}

#[cfg(test)]
pub(crate) mod tests;
