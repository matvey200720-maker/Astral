//! Счётчики времени пачки (`timings`): имена полей те же, что у читателя JS (`workshop-textures.js`,
//! `createProbe`), плюс `sheets.deferred`, `cache.putsMs`, `wallMs` и `threads`.
//!
//! Время этапов — сумма по потокам, целые миллисекунды (как `Clock` у сборки дорог); `wallMs` —
//! настоящее время пачки от входа до ответа. `webp.*`, `cache.writeMs` и `cache.hitsWebp` у движка
//! всегда нули: он не кодирует WebP.

use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

use serde_json::{json, Value};

#[derive(Default)]
pub struct Probe {
    open: AtomicU64,
    read: AtomicU64,
    parent: AtomicU64,
    blocks: AtomicU64,
    cache_read: AtomicU64,
    puts: AtomicU64,
    pub opens: AtomicU64,
    pub loaded: AtomicU64,
    pub reused: AtomicU64,
    pub bytes: AtomicU64,
    pub hits_blocks: AtomicU64,
    pub puts_blocks: AtomicU64,
    pub sheets_blocks: AtomicU64,
    pub sheets_webp: AtomicU64,
    pub sheets_cached: AtomicU64,
    pub sheets_refused: AtomicU64,
    pub sheets_deferred: AtomicU64,
}

/// Этап, на который прибавляется время.
#[derive(Clone, Copy)]
pub enum Stage {
    Open,
    Read,
    Parent,
    Blocks,
    CacheRead,
    Puts,
}

impl Probe {
    pub fn add(&self, stage: Stage, from: Instant) {
        let cell = match stage {
            Stage::Open => &self.open,
            Stage::Read => &self.read,
            Stage::Parent => &self.parent,
            Stage::Blocks => &self.blocks,
            Stage::CacheRead => &self.cache_read,
            Stage::Puts => &self.puts,
        };
        cell.fetch_add(
            u64::try_from(from.elapsed().as_nanos()).unwrap_or(u64::MAX),
            Relaxed,
        );
    }

    pub fn count(cell: &AtomicU64, by: u64) {
        cell.fetch_add(by, Relaxed);
    }

    /// Объект `timings` в порядке полей читателя.
    pub fn report(&self, share: bool, total: usize, wall_ms: u64, threads: usize) -> Value {
        let ms = |cell: &AtomicU64| cell.load(Relaxed) / 1_000_000;
        let n = |cell: &AtomicU64| cell.load(Relaxed);
        json!({
            "share": share,
            "queueMs": 0,
            "totalMs": wall_ms,
            "openMs": ms(&self.open),
            "opens": n(&self.opens),
            "resources": {
                "loaded": n(&self.loaded),
                "reused": n(&self.reused),
                "bytes": n(&self.bytes),
                "ms": ms(&self.read),
            },
            "parentMs": ms(&self.parent),
            "blocksMs": ms(&self.blocks),
            "webp": { "rendered": 0, "ms": 0 },
            "cache": {
                "readMs": ms(&self.cache_read),
                "hitsBlocks": n(&self.hits_blocks),
                "hitsWebp": 0,
                "writeMs": 0,
                "putsBlocks": n(&self.puts_blocks),
                "putsMs": ms(&self.puts),
            },
            "sheets": {
                "total": total,
                "blocks": n(&self.sheets_blocks),
                "webp": n(&self.sheets_webp),
                "cached": n(&self.sheets_cached),
                "refused": n(&self.sheets_refused),
                "deferred": n(&self.sheets_deferred),
            },
            "wallMs": wall_ms,
            "threads": threads,
        })
    }
}
