//! `rpf-listing`: оглавления многих архивов игры одним запуском, в несколько потоков.
//!
//! Перепись карты и поиск имён сетевой карты в приложении открывали каждый архив игры читателем
//! JS: 117 архивов, 360 тысяч записей, 6 с на одни оглавления — и так дважды за сборку дорог
//! (замер тестового ПК 14.11.2026: перепись 10 с, имена карты 7,5 с). Здесь архивы открываются
//! разом; разбор списков остаётся у приложения.
//!
//! Список записей повторяет читателя `packages/rpf7` дословно: сначала записи самого архива в
//! порядке оглавления (без корня и недостижимых), затем записи вложенных архивов в порядке их
//! записей, путь вложенной — через путь её архива; у записи — путь, вид (0 каталог, 1 файл,
//! 2 ресурс) и размер хранения. Вложенный архив, сжатый или зашифрованный целиком, не
//! раскрывается, как и у JS. По просьбе к ответу прикладываются байты мелких файлов по имени
//! (`setup2.xml`, `content.xml`, `dlclist.xml`) и отпечатки ресурсов по расширению.

use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
};

use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind, KeySet};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::Command;
use crate::{
    archives::load_keys,
    args::Options,
    error::{EngineError, Result},
    paths::full_path,
    progress::Progress,
};

const COMMAND_NAME: &str = "rpf-listing";
const REQUEST_FORMAT: &str = "astral.rpf-listing";
const MAX_REQUEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ARCHIVES: usize = 2_000;
const MAX_THREADS: usize = 32;
/// Глубже читатель JS вложенные архивы не раскрывает (`MAX_DEPTH`).
const MAX_DEPTH: usize = 8;
/// Файл по имени прикладывается к ответу, только если он не крупнее.
const INLINE_BYTES_CAP: u64 = 8 * 1024 * 1024;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

/// Что приложить к оглавлению архива.
struct Extras {
    /// Имена файлов строчными, чьи байты нужны целиком.
    inline: HashSet<String>,
    /// Расширения записей строчными (без точки), чьи отпечатки нужны.
    hash: HashSet<String>,
    /// Во сколько потоков считать отпечатки одного архива.
    hash_threads: usize,
}

/// Оглавление одного архива.
#[derive(Default)]
struct Listing {
    /// Строки `[путь, вид, размер хранения]`.
    entries: Vec<Value>,
    /// Путь → байты файла в base64.
    inline: Map<String, Value>,
    /// Путь → первые 32 знака SHA-256 байт записи.
    hashes: Map<String, Value>,
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let word = u32::from(chunk[0]) << 16 | u32::from(*chunk.get(1).unwrap_or(&0)) << 8 | u32::from(*chunk.get(2).unwrap_or(&0));
        let pick = |shift: u32| char::from(BASE64[((word >> shift) & 0x3f) as usize]);
        out.push(pick(18));
        out.push(pick(12));
        out.push(if chunk.len() > 1 { pick(6) } else { '=' });
        out.push(if chunk.len() > 2 { pick(0) } else { '=' });
    }
    out
}

fn hex32(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(32);
    for &byte in digest.iter().take(16) {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

/// Байты записи, как их отдаёт читатель JS: ресурс — файлом RSC7, прочее — раскрытым.
fn entry_bytes(archive: &Archive, id: EntryId) -> Option<Vec<u8>> {
    match archive.entry(id).kind {
        EntryKind::Resource(_) => archive.export(id).ok(),
        EntryKind::Binary(_) => archive.decode(id, EntryCipher::ByArchive).ok(),
        EntryKind::Directory { .. } => None,
    }
}

/// Отпечатки записей архива в несколько потоков: чтение и раскрытие записи — почти всё время
/// команды (у `update.rpf` 6 тысяч записей: 2,5 с в один поток против 0,15 с на оглавление).
fn hash_entries(archive: &Archive, wanted: &[(EntryId, String)], threads: usize, out: &mut Map<String, Value>) {
    if wanted.is_empty() {
        return;
    }
    let next = AtomicUsize::new(0);
    let found: Mutex<Vec<(usize, String)>> = Mutex::new(Vec::with_capacity(wanted.len()));
    let work = || {
        let mut mine = Vec::new();
        loop {
            let index = next.fetch_add(1, Ordering::Relaxed);
            let Some((id, _)) = wanted.get(index) else { break };
            if let Some(bytes) = entry_bytes(archive, *id) {
                mine.push((index, hex32(&bytes)));
            }
        }
        if let Ok(mut all) = found.lock() {
            all.extend(mine);
        }
    };
    let count = threads.clamp(1, wanted.len());
    if count == 1 {
        work();
    } else {
        thread::scope(|scope| {
            for _ in 0..count {
                scope.spawn(work);
            }
        });
    }
    for (index, hash) in found.into_inner().unwrap_or_default() {
        out.insert(wanted[index].1.clone(), hash.into());
    }
}

/// Пути записей архива от его корня; недостижимая запись остаётся без пути.
fn lay_out_paths(archive: &Archive) -> Vec<Option<String>> {
    let mut paths: Vec<Option<String>> = vec![None; archive.len()];
    let root = archive.root();
    if root >= paths.len() {
        return paths;
    }
    paths[root] = Some(String::new());
    let mut queue = VecDeque::from([root]);
    while let Some(dir) = queue.pop_front() {
        let base = paths[dir].clone().unwrap_or_default();
        for &child in archive.dirs(dir).iter().chain(archive.files(dir)) {
            if child >= paths.len() || paths[child].is_some() {
                continue;
            }
            let entry = archive.entry(child);
            paths[child] = Some(if base.is_empty() { entry.name.clone() } else { format!("{base}/{}", entry.name) });
            if matches!(entry.kind, EntryKind::Directory { .. }) {
                queue.push_back(child);
            }
        }
    }
    paths
}

fn extension_of(name: &str) -> Option<String> {
    name.rsplit_once('.').map(|(_, extension)| extension.to_ascii_lowercase())
}

/// Записи архива и его вложенных архивов в порядке читателя JS.
fn list_archive(archive: &Archive, prefix: &str, depth: usize, extras: &Extras, out: &mut Listing) {
    let paths = lay_out_paths(archive);
    let root = archive.root();
    let mut nested: Vec<(EntryId, String)> = Vec::new();
    let mut to_hash: Vec<(EntryId, String)> = Vec::new();
    for (id, path) in paths.iter().enumerate() {
        let Some(path) = path.as_ref().filter(|_| id != root) else {
            continue;
        };
        let full = if prefix.is_empty() { path.clone() } else { format!("{prefix}/{path}") };
        let entry = archive.entry(id);
        let (kind, stored) = match &entry.kind {
            EntryKind::Directory { .. } => (0u8, 0u64),
            EntryKind::Binary(info) => {
                /* Сжатый или зашифрованный целиком архив игра не читает — и читатель JS его не раскрывает. */
                if Archive::is_nested_archive_name(&entry.name) && !info.is_compressed() && !info.encrypted {
                    nested.push((id, full.clone()));
                }
                (1, info.stored_len())
            }
            EntryKind::Resource(info) => (2, u64::from(info.stored_size)),
        };
        if kind != 0 {
            let lower = entry.name.to_ascii_lowercase();
            if extras.inline.contains(&lower) && archive.listing_size(id) <= INLINE_BYTES_CAP {
                if let Some(bytes) = entry_bytes(archive, id) {
                    out.inline.insert(full.clone(), base64(&bytes).into());
                }
            }
            if extension_of(&lower).is_some_and(|extension| extras.hash.contains(&extension)) {
                to_hash.push((id, full.clone()));
            }
        }
        out.entries.push(json!([full, kind, stored]));
    }
    hash_entries(archive, &to_hash, extras.hash_threads, &mut out.hashes);
    if depth + 1 > MAX_DEPTH {
        return;
    }
    for (id, full) in nested {
        if let Ok(inner) = archive.open_nested(id) {
            list_archive(&inner, &full, depth + 1, extras, out);
        }
    }
}

struct Wanted {
    label: String,
    file: PathBuf,
    /// Считать ли отпечатки ресурсов этого архива (`hash` запроса).
    hash: bool,
}

fn names(value: Option<&Value>, what: &str) -> Result<HashSet<String>> {
    let Some(value) = value else {
        return Ok(HashSet::new());
    };
    let items = value.as_array().ok_or_else(|| bad(format!("Поле {what} — не список.")))?;
    items
        .iter()
        .map(|item| item.as_str().map(str::to_ascii_lowercase).ok_or_else(|| bad(format!("Поле {what} — не список строк."))))
        .collect()
}

fn rpf_listing(options: &Options, progress: &Progress) -> Result<Value> {
    let request_path = full_path(options.required("request")?)?;
    if fs::metadata(&request_path).map_err(EngineError::from)?.len() > MAX_REQUEST_BYTES {
        return Err(bad("Запрос rpf-listing слишком велик."));
    }
    let raw = fs::read_to_string(&request_path).map_err(EngineError::from)?;
    let body: Value = raw.trim_start_matches('\u{feff}').parse().map_err(|_| bad("Запрос rpf-listing — не JSON."))?;
    if body.get("format").and_then(Value::as_str) != Some(REQUEST_FORMAT) || body.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(bad("Запрос rpf-listing другого формата или версии."));
    }
    let listed = body.get("archives").and_then(Value::as_array).filter(|rows| rows.len() <= MAX_ARCHIVES).ok_or_else(|| bad("Архивы — не список или их слишком много."))?;
    let mut wanted = Vec::with_capacity(listed.len());
    for row in listed {
        let label = row.get("label").and_then(Value::as_str).ok_or_else(|| bad("У архива нет метки."))?;
        let file = full_path(row.get("file").and_then(Value::as_str).ok_or_else(|| bad("У архива нет файла."))?)?;
        if !file.is_absolute() {
            return Err(EngineError::argument("Helper paths must be absolute."));
        }
        wanted.push(Wanted { label: label.to_owned(), file, hash: row.get("hash").and_then(Value::as_bool).unwrap_or(false) });
    }
    let inline = names(body.get("inline"), "inline")?;
    let hash = names(body.get("hashExtensions"), "hashExtensions")?;
    let threads = body.get("threads").and_then(Value::as_u64).map_or(4, |count| count as usize).clamp(1, MAX_THREADS);
    let game_root = body.get("gameRoot").and_then(Value::as_str).unwrap_or_default();
    /* Без ключей открываются только архивы с открытым оглавлением (правленные OpenIV); остальные вернутся
       отказом, и приложение прочтёт их прежним читателем. */
    let keys: Option<Arc<KeySet>> = load_keys(game_root, options.optional("keys")).ok().map(|loaded| loaded.0);

    let total = wanted.len() as u64;
    progress.report_bytes("listing", 0, total);
    let next = AtomicUsize::new(0);
    let finished = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<Value>>> = wanted.iter().map(|_| Mutex::new(None)).collect();
    let no_hash = HashSet::new();
    let work = || loop {
        let index = next.fetch_add(1, Ordering::Relaxed);
        let Some(item) = wanted.get(index) else { break };
        let row = if progress.cancel().requested() {
            json!({ "label": item.label, "ok": false, "reason": "отменено" })
        } else {
            match Archive::open_path(&item.file, keys.clone()) {
                Err(error) => json!({ "label": item.label, "ok": false, "reason": error.to_string() }),
                Ok(archive) => {
                    let extras = Extras { inline: inline.clone(), hash: if item.hash { hash.clone() } else { no_hash.clone() }, hash_threads: threads };
                    let mut listing = Listing::default();
                    list_archive(&archive, "", 0, &extras, &mut listing);
                    json!({ "label": item.label, "ok": true, "entries": listing.entries, "inline": listing.inline, "hashes": listing.hashes })
                }
            }
        };
        if let Ok(mut slot) = slots[index].lock() {
            *slot = Some(row);
        }
        progress.report_bytes("listing", finished.fetch_add(1, Ordering::Relaxed) as u64 + 1, total);
    };
    thread::scope(|scope| {
        for _ in 0..threads.min(wanted.len().max(1)) {
            scope.spawn(work);
        }
    });
    progress.checkpoint()?;
    let archives: Vec<Value> = slots
        .into_iter()
        .zip(&wanted)
        .map(|(slot, item)| slot.into_inner().ok().flatten().unwrap_or_else(|| json!({ "label": item.label, "ok": false, "reason": "поток остановился" })))
        .collect();
    Ok(json!({ "status": "ready", "mode": "read-only", "archives": archives }))
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, rpf_listing)];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_pads_like_the_standard_alphabet() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
    }

    #[test]
    fn the_entry_hash_is_the_first_half_of_sha256_in_lower_hex() {
        assert_eq!(hex32(b""), "e3b0c44298fc1c149afbf4c8996fb924");
        assert_eq!(hex32(b"abc"), "ba7816bf8f01cfea414140de5dae2223");
    }

    #[test]
    fn extensions_are_taken_after_the_last_dot_in_lower_case() {
        assert_eq!(extension_of("Road.YTD").as_deref(), Some("ytd"));
        assert_eq!(extension_of("a.b.ydr").as_deref(), Some("ydr"));
        assert_eq!(extension_of("noext"), None);
    }
}
