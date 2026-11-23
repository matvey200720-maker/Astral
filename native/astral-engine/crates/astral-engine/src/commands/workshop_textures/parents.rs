//! Поиск листа у родителей словаря (как `parentLocation` и `folderIndex` читателя JS).
//!
//! Лист, которого нет в своём файле, игра берёт у родителей словаря: у района — словари той же папки
//! (`sp1_10.ytd`, `sp1_10_stadium.ytd`), у города — общий словарь `gtxd`. Оглавление папки — имя
//! листа → файл: словари `.ytd` по порядку имён (без `+hi.ytd` и `+hidr.ytd`), ресурсы больше 64 МиБ
//! пропускаются, первое имя побеждает. Оглавление держится в памяти процесса (не больше 64 папок) и
//! на диске, `<stateDir>/workshop-textures/index-<sha256 32>.json` с отпечатком архива в ключе; файл
//! пишется только полным: оборвавшееся чтение не запоминается, иначе лист стал бы «нет в игре» навсегда.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::Instant;

use rage_res::resource::Resource;
use rage_res::texture;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::probe::{Probe, Stage};
use super::session::{locked, Game};
use crate::error::Result;

/// Общий словарь города: сюда смотрит каждый лист игры после словаря своей папки.
pub const GLOBAL_DICTIONARIES: &str = "x64g.rpf:levels/gta5/generic/gtxd.rpf";
/// Версия файла оглавления (`INDEX_VERSION` читателя).
const INDEX_VERSION: u64 = 1;
/// Ресурсы больше этого размера в оглавление не берутся (`MAX_RESOURCE_BYTES` читателя).
pub const MAX_RESOURCE_BYTES: usize = 64 * 1024 * 1024;
/// В памяти процесса держится не больше столько оглавлений.
const MEMO_LIMIT: usize = 64;

/// Имя листа → файл, в порядке появления.
#[derive(Default)]
pub struct NameIndex {
    pairs: Vec<(String, String)>,
    at: HashMap<String, usize>,
}

impl NameIndex {
    /// Первое имя побеждает.
    fn insert_first(&mut self, name: String, file: &str) {
        if !self.at.contains_key(&name) {
            self.at.insert(name.clone(), self.pairs.len());
            self.pairs.push((name, file.to_owned()));
        }
    }

    /// Как `new Map(pairs)`: позже стоящее значение перекрывает раньше стоящее, порядок — по первому появлению.
    fn from_pairs(pairs: impl IntoIterator<Item = (String, String)>) -> NameIndex {
        let mut index = NameIndex::default();
        for (name, file) in pairs {
            match index.at.get(&name) {
                Some(&slot) => index.pairs[slot].1 = file,
                None => {
                    index.at.insert(name.clone(), index.pairs.len());
                    index.pairs.push((name, file));
                }
            }
        }
        index
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.at.get(name).map(|&slot| self.pairs[slot].1.as_str())
    }

    /// Текст файла оглавления: `{"v":1,"names":[[имя,файл],…]}`.
    fn to_file(&self) -> String {
        let names: Vec<Value> = self
            .pairs
            .iter()
            .map(|(name, file)| Value::from(vec![name.as_str(), file.as_str()]))
            .collect();
        serde_json::json!({ "v": INDEX_VERSION, "names": names }).to_string()
    }

    fn from_file(text: &str) -> Option<NameIndex> {
        let parsed: Value = serde_json::from_str(text).ok()?;
        if parsed.get("v")?.as_u64()? != INDEX_VERSION {
            return None;
        }
        let mut pairs = Vec::new();
        for row in parsed.get("names")?.as_array()? {
            let row = row.as_array()?;
            pairs.push((
                row.first()?.as_str()?.to_owned(),
                row.get(1)?.as_str()?.to_owned(),
            ));
        }
        Some(NameIndex::from_pairs(pairs))
    }
}

type Slot = Arc<Mutex<Option<Arc<NameIndex>>>>;

/// Оглавления папок в памяти процесса: ключ — `<папка игры в нижнем регистре>|<папка>`.
#[derive(Default)]
struct Memo {
    slots: HashMap<String, Slot>,
    order: Vec<String>,
}

static MEMO: LazyLock<Mutex<Memo>> = LazyLock::new(Mutex::default);

/// Для тестов: оглавления папок живут в памяти процесса.
#[cfg(test)]
pub fn forget_memo() {
    *locked(&MEMO) = Memo::default();
}

/// Всё, что нужно для поиска: игра, счётчики, папка файлов и отпечатки архивов.
pub struct Search<'a> {
    pub game: &'a Game,
    pub probe: &'a Probe,
    /// Папка игры в нижнем регистре (часть ключей).
    pub root_key: &'a str,
    /// `<stateDir>/workshop-textures`.
    pub dir: &'a Path,
    /// Отпечаток архива по метке; `None` — архива нет.
    pub stamp_of: &'a (dyn Fn(&str) -> Option<String> + Sync),
    pub threads: usize,
}

fn sha_text(text: &str) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(32);
    for byte in Sha256::digest(text.as_bytes()).iter().take(16) {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    out
}

/// Имена листов одного словаря в нижнем регистре; чужой или битый словарь — `None`.
fn dictionary_names(bytes: &[u8]) -> Option<Vec<String>> {
    let resource = Resource::parse(bytes).ok()?;
    let refs = texture::read_dictionary(&resource).ok()?;
    Some(
        refs.into_iter()
            .map(|reference| reference.name.to_lowercase())
            .collect(),
    )
}

/// Чем кончилось чтение одного словаря папки.
enum Read {
    /// Не прочитался (нет файла, ошибка архива): оглавление неполное.
    Failed,
    /// Слишком большой или чужой: пропущен без ущерба для полноты.
    Skipped,
    Names(Vec<String>),
}

fn build(search: &Search<'_>, folder: &str) -> Result<(NameIndex, bool)> {
    let mut files: Vec<String> = search
        .game
        .list(folder, search.probe)?
        .into_iter()
        // HD-копии (`+hi`, `+hidr`) — те же листы крупнее, кадру не нужны.
        .filter(|file| {
            file.ends_with(".ytd") && !file.ends_with("+hi.ytd") && !file.ends_with("+hidr.ytd")
        })
        .collect();
    files.sort();
    let next = AtomicUsize::new(0);
    let reads: Vec<Mutex<Option<Read>>> = files.iter().map(|_| Mutex::new(None)).collect();
    let work = || loop {
        let index = next.fetch_add(1, Relaxed);
        let Some(file) = files.get(index) else { break };
        let outcome = match search.game.read(file, search.probe) {
            Ok(Some(bytes)) if bytes.len() > MAX_RESOURCE_BYTES => Read::Skipped,
            Ok(Some(bytes)) => dictionary_names(&bytes).map_or(Read::Skipped, Read::Names),
            Ok(None) | Err(_) => Read::Failed,
        };
        *locked(&reads[index]) = Some(outcome);
    };
    let workers = search.threads.clamp(1, files.len().max(1));
    if workers == 1 {
        work();
    } else {
        thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(work);
            }
        });
    }
    let mut index = NameIndex::default();
    let mut complete = true;
    for (file, read) in files.iter().zip(reads) {
        match locked(&read).take() {
            Some(Read::Names(names)) => names
                .into_iter()
                .for_each(|name| index.insert_first(name, file)),
            Some(Read::Failed) | None => complete = false,
            Some(Read::Skipped) => {}
        }
    }
    Ok((index, complete))
}

/// Оглавление папки `folder` (`<архив>:<путь>`): из памяти, с диска или собранное чтением словарей.
/// Отказ чтения (ключи) отдаётся вызывающему и не запоминается.
pub fn folder_index(search: &Search<'_>, folder: &str) -> Result<Arc<NameIndex>> {
    let key = format!("{}|{folder}", search.root_key);
    let slot = {
        let mut memo = locked(&MEMO);
        if !memo.slots.contains_key(&key) {
            if memo.order.len() >= MEMO_LIMIT {
                let oldest = memo.order.remove(0);
                memo.slots.remove(&oldest);
            }
            memo.order.push(key.clone());
            memo.slots.insert(key.clone(), Slot::default());
        }
        Arc::clone(&memo.slots[&key])
    };
    // Параллельные просьбы об одной папке ждут одной сборки.
    let mut held = locked(&slot);
    if let Some(known) = held.as_ref() {
        return Ok(Arc::clone(known));
    }
    let archive = folder.split_once(':').map_or(folder, |(label, _)| label);
    let stamp = (search.stamp_of)(archive);
    let file = stamp.as_ref().map(|stamp| {
        search.dir.join(format!(
            "index-{}.json",
            sha_text(&format!("{key}|{stamp}"))
        ))
    });
    if let Some(stored) = file
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| NameIndex::from_file(&text))
    {
        let stored = Arc::new(stored);
        *held = Some(Arc::clone(&stored));
        return Ok(stored);
    }
    let (names, complete) = build(search, folder)?;
    if let (Some(path), true) = (&file, complete) {
        // Файл пишется через соседний черновик: читатель JS не увидит обрезанного оглавления.
        let _ = fs::create_dir_all(search.dir);
        let _ = crate::commands::shop::write_atomic(path, names.to_file().as_bytes());
    }
    let names = Arc::new(names);
    *held = Some(Arc::clone(&names));
    Ok(names)
}

/// Файл-родитель листа `name` для записи `location`: словарь папки или общий словарь города.
pub fn parent_location(search: &Search<'_>, location: &str, name: &str) -> Result<Option<String>> {
    let began = Instant::now();
    let folder = location
        .rsplit_once('/')
        .map_or(location, |(folder, _)| folder);
    let mut found = None;
    for place in [folder, GLOBAL_DICTIONARIES] {
        let index = match folder_index(search, place) {
            Ok(index) => index,
            Err(error) => {
                search.probe.add(Stage::Parent, began);
                return Err(error);
            }
        };
        if let Some(file) = index.get(name).filter(|file| *file != location) {
            found = Some(file.to_owned());
            break;
        }
    }
    search.probe.add(Stage::Parent, began);
    Ok(found)
}
