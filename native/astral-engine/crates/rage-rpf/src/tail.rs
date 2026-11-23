//! Хвост архива верхнего уровня (20.11.2026, `docs/handoff/RPF-NESTED-TAIL.md`).
//!
//! Съёмка в игре: `update.rpf`, у которого последней записью лежит маленький вложенный архив (1067 и 2091 Б) и сразу за ним конец
//! файла, роняет сюжет; тот же файл с нулями в хвосте проходит. Порог игры не найден (штатные архивы его не дают: у них хвост
//! добит до 2048, самая короткая последняя запись — 1536 Б от начала до конца), поэтому берётся запас: от начала последней
//! записи до конца файла не меньше `TAIL_MIN`, длина файла кратна `TAIL_ALIGN`, а ключ шапки NG (он идёт по длине файла)
//! остаётся прежним, так что оглавление не переписывается: к файлу дописываются только нули.

use std::fs::OpenOptions;
use std::path::Path;
use std::sync::Arc;

use crate::append::{AppendError, Code, Host, PlainHost};
use crate::toc::read_toc;
use crate::{Archive, EntryKind, FileSource, KeySet, Result, RpfError};

/// Запас от начала последней записи до конца файла. ВЗЯТ ЗАПАС, ШТАТНЫЕ ДАЮТ ТОЛЬКО КРАТНОСТЬ 2048: порога игры не нашли (съёмка 20.11.2026:
/// 2091 Б падает, 145 КБ проходит, штатные файлы кончаются на границе 2048 и у них от начала последней записи до конца бывает
/// и 1536 Б). После проб «только выравнивание» и «64 КиБ» снижается этой одной строкой (до 0, если хватит одной кратности).
pub const TAIL_MIN: u64 = 256 * 1024;
/// Граница длины файла: сектор, как у штатных архивов (113 из 118 штатных файлов кратны 2048).
pub const TAIL_ALIGN: u64 = 2048;
/// Сколько границ перебирать при подборе длины с прежним ключом: ключ ходит по кругу из 101, так что хватает 101.
const TAIL_STEPS: u64 = 512;

/// Правило хвоста.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TailPolicy {
    /// Не меньше стольких байт от начала последней записи до конца файла.
    pub min: u64,
    /// Длина файла кратна этому.
    pub align: u64,
}

impl TailPolicy {
    pub const STANDARD: TailPolicy = TailPolicy {
        min: TAIL_MIN,
        align: TAIL_ALIGN,
    };
}

impl Default for TailPolicy {
    fn default() -> Self {
        Self::STANDARD
    }
}

/// Что известно о хвосте файла.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TailReport {
    /// Длина файла до правки.
    pub len: u64,
    /// Начало последней записи (по смещению).
    pub last_start: u64,
    /// Конец тела, которое кончается позже всех.
    pub end: u64,
    /// От начала последней записи до конца файла.
    pub distance: u64,
    /// Хвост по правилу.
    pub ok: bool,
    /// Ключ шапки NG, которым открылось оглавление.
    pub key: Option<usize>,
    /// Сколько нулей дописано (у `inspect_tail` — 0).
    pub pad: u64,
    /// Длина файла после правки.
    pub after_len: u64,
}

/// Наименьшая длина файла по правилу: не короче конца последнего тела, от начала последней записи не меньше `policy.min`,
/// кратная `policy.align` и (если ключ надо держать) с ключом `wanted` по `pick`. `None` — за `TAIL_STEPS` границ не нашлась.
pub fn tail_len(
    policy: TailPolicy,
    end: u64,
    last_start: u64,
    wanted: Option<usize>,
    pick: &dyn Fn(u64) -> usize,
) -> Option<u64> {
    let need = end.max(last_start.saturating_add(policy.min));
    let align = policy.align.max(1);
    let first = need.div_ceil(align) * align;
    (0..TAIL_STEPS)
        .map(|step| first + step * align)
        .find(|&len| wanted.is_none_or(|key| pick(len) == key))
}

/// Начало последней записи и конец самого дальнего тела; `None` — у архива нет ни одного тела.
fn extent(archive: &Archive) -> Option<(u64, u64)> {
    let mut last_start = None::<u64>;
    let mut end = 0u64;
    for id in 0..archive.len() {
        let (start, stop) = match &archive.entry(id).kind {
            EntryKind::Binary(info) if info.stored_len() > 0 => {
                (info.offset(), info.offset() + info.stored_len())
            }
            EntryKind::Resource(info) if info.stored_size > 0 => {
                (info.offset(), info.offset() + u64::from(info.stored_size))
            }
            _ => continue,
        };
        end = end.max(stop);
        last_start = Some(last_start.map_or(start, |seen| seen.max(start)));
    }
    last_start.map(|start| (start, end))
}

fn examine(path: &Path, name: &str, keys: &Arc<KeySet>, policy: TailPolicy) -> Result<TailReport> {
    let len = std::fs::metadata(path)?.len();
    let archive = Archive::open_path(path, Some(Arc::clone(keys)))?;
    let source = FileSource::open(path).map_err(RpfError::from)?;
    let key = read_toc(&source, name, Some(keys))?.ng_key_index;
    let (last_start, end) = extent(&archive).unwrap_or((0, 0));
    let distance = len.saturating_sub(last_start);
    // без тел хвост не нужен
    let bodiless = extent(&archive).is_none();
    let ok = bodiless || (distance >= policy.min && len % policy.align.max(1) == 0);
    Ok(TailReport {
        len,
        last_start,
        end,
        distance,
        ok,
        key,
        pad: 0,
        after_len: len,
    })
}

/// Читает хвост файла и говорит, по правилу ли он. Файл не меняется.
pub fn inspect_tail(
    path: &Path,
    name: &str,
    keys: &Arc<KeySet>,
    policy: TailPolicy,
) -> Result<TailReport> {
    examine(path, name, keys, policy)
}

/// Доводит хвост файла до правила: дописывает нули в конец до наименьшей длины, при которой запас, граница и ключ шапки
/// сходятся. Тела и оглавление не трогаются; хвост по правилу — ничего не пишет. Нужен файл в покое (игра закрыта, файл не
/// открыт другими). Число имён файла хозяин `host` называет сам (у крейта на Windows своего вызова нет): файл с двумя именами
/// («защищённый оригинал», снимок) — отказ `Linked` ДО записи, как у дозаписи: нули на месте изменили бы оба имени.
pub fn ensure_tail_with(
    path: &Path,
    name: &str,
    keys: &Arc<KeySet>,
    policy: TailPolicy,
    host: &dyn Host,
) -> std::result::Result<TailReport, AppendError> {
    let mut report = examine(path, name, keys, policy)?;
    if report.ok {
        return Ok(report);
    }
    let pick = |len: u64| keys.ng_key_index(name, len);
    let target = tail_len(policy, report.end, report.last_start, report.key, &pick).ok_or_else(|| {
        RpfError::state(format!(
            "No file length within {TAIL_STEPS} steps keeps the head key {:?} for {name}.",
            report.key
        ))
    })?;
    let file = OpenOptions::new().write(true).open(path)?;
    let facts = host.facts(&file)?;
    if facts.links.is_some_and(|links| links > 1) {
        return Err(AppendError::refused(
            Code::Linked,
            "The archive has more than one hard link; it is not written in place.",
        ));
    }
    file.set_len(target)?;
    file.sync_all()?;
    drop(file);
    let after = examine(path, name, keys, policy)?;
    if after.key != report.key || !after.ok {
        return Err(RpfError::state(format!(
            "The tail of {name} did not settle: key {:?} -> {:?}, ok {}.",
            report.key, after.key, after.ok
        ))
        .into());
    }
    report.pad = target - report.len;
    report.after_len = target;
    report.ok = true;
    Ok(report)
}

/// То же с хозяином по умолчанию (`PlainHost`: число имён знает только на Unix). Боевой вызов — `ensure_tail_with` с хозяином движка.
pub fn ensure_tail(
    path: &Path,
    name: &str,
    keys: &Arc<KeySet>,
    policy: TailPolicy,
) -> Result<TailReport> {
    ensure_tail_with(path, name, keys, policy, &PlainHost).map_err(|error| match error {
        AppendError::Other(inner) => inner,
        other => RpfError::state(other.to_string()),
    })
}
