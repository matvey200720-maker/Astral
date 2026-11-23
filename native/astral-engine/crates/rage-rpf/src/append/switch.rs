//! Переключение слоёв: запись журнала без хвоста.
//!
//! Слой из одних добавлений (`layers`) включается и выключается записью одной
//! головы: тела слоя лежат в файле всегда, а оглавление собирается заново из
//! текущего, с записями слоя или без них. Это та же запись журнала, что у
//! дозаписи (`Begin`, прежние байты области головы, секторы после записи), но
//! `old_len == new_len` и тел нет, поэтому откат, `prove_ours`, доведение после
//! обрыва и отпечаток цепочки работают без единой правки.
//!
//! Порядок на диске:
//!
//! 1. журнал: `Begin` и кадр слоёв (`LayerOp`), сброс;
//! 2. тело реестра в хвост, только если такого содержимого ещё не было (файл при
//!    этом растёт, ключ NG меняется вместе с длиной, голова всё равно пишется
//!    целиком); сброс;
//! 3. `Synced`;
//! 4. варианты реестра в таблицу слоёв (только если они появились), крюк
//!    вызывающего (сводный рецепт);
//! 5. голова двумя половинами со сбросом после каждой;
//! 6. проверка записанного, `Done`;
//! 7. подряд идущие готовые переключения на вершине стопки сливаются в одну запись
//!    (журнал переписывается целиком и встаёт на место переименованием): сто
//!    переключений не растят журнал и не дают `CompactionDue` по числу записей.
//!
//! Новая голова строится по текущей (после чужих дозаписей поверх слоя тоже):
//! выключение возвращает у записей слоя слово «до» (замена) или убирает запись
//! (добавление), но только если текущее слово записи — именно «после» этого слоя;
//! иначе сверху лёг другой слой или чужая правка, и отказ `LayerCovered`.

use std::collections::BTreeMap;

use super::*;
use crate::{
    layers::{bare, block_of, body_len, same, Kind, Status, Variant},
    tree::{Compress, Data},
};

// ---------------------------------------------------------------------------
// Вход и итог
// ---------------------------------------------------------------------------

/// Новое тело реестра: запись корня, общая для слоёв, чьё тело JS собирает из
/// включённых слоёв.
pub struct RegistryInput {
    /// Путь записи в корне (`common/data/content.xml`).
    pub entry: String,
    /// Содержимое реестра для нового состояния.
    pub content: Vec<u8>,
}

/// Чем заказано переключение.
pub struct SwitchInput<'a> {
    pub keys: &'a Arc<KeySet>,
    pub enable: Vec<String>,
    pub disable: Vec<String>,
    /// Снять слои: тела перестают быть спящими и становятся мусором (включённый
    /// слой сначала выключается).
    pub remove: Vec<String>,
    pub registry: Option<RegistryInput>,
}

/// Чем заказано переключение со списком общих записей: у редуксов общие
/// `content.xml` и `dlclist.xml`, и тело каждой собирает вызывающий. `SwitchInput`
/// с одной записью остаётся как был и приводится к этому виду.
pub struct SwitchAll<'a> {
    pub keys: &'a Arc<KeySet>,
    pub enable: Vec<String>,
    pub disable: Vec<String>,
    pub remove: Vec<String>,
    /// Общие записи корня: каждая названа один раз (без учёта регистра ASCII).
    pub registry: Vec<RegistryInput>,
}

impl<'a> From<SwitchInput<'a>> for SwitchAll<'a> {
    fn from(input: SwitchInput<'a>) -> SwitchAll<'a> {
        SwitchAll {
            keys: input.keys,
            enable: input.enable,
            disable: input.disable,
            remove: input.remove,
            registry: input.registry.into_iter().collect(),
        }
    }
}

/// Что стало с реестром.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistryReport {
    pub entry: String,
    /// Содержимое уже лежит в файле: тело не писалось (виденное раньше или то, что
    /// уже стоит).
    pub reused: bool,
    /// Запись реестра осталась как была.
    pub unchanged: bool,
    /// Записано байт тела реестра.
    pub bytes_written: u64,
}

/// Итог переключения.
#[derive(Clone, Debug)]
pub struct SwitchReport {
    /// Номер записи журнала (если записи слиты — номер той, что осталась).
    pub seq: u64,
    /// Было ли что-то записано; `false` — всё уже в нужном состоянии.
    pub changed: bool,
    /// Запись слита с предыдущим переключением: (оставшийся номер, ушедший номер).
    pub merged: Option<(u64, u64)>,
    pub fingerprint: String,
    pub fingerprint_before: String,
    pub old_len: u64,
    pub new_len: u64,
    pub bytes_written: u64,
    pub head_len: u64,
    /// Что сделал этот запрос.
    pub enabled: Vec<String>,
    pub disabled: Vec<String>,
    pub removed: Vec<String>,
    /// Все слои и их состояние после запроса, по возрастанию номера установки.
    pub layers: Vec<(String, Status)>,
    pub dead_bytes: u64,
    /// Спящие тела слоёв после запроса.
    pub dormant_bytes: u64,
    /// Первая из общих записей запроса (у запроса с одной записью — она сама).
    pub registry: Option<RegistryReport>,
    /// Все общие записи запроса, в порядке запроса.
    pub registries: Vec<RegistryReport>,
    pub journal_records: usize,
    /// Сколько нулей добавлено в конец файла, чтобы длина держала ключ головы
    /// (`set_keep_key`); `None` — ключ не держался.
    pub key_pad: Option<u64>,
    pub settled: Settled,
    pub timings: Timings,
}

// ---------------------------------------------------------------------------
// Дерево оглавления корня
// ---------------------------------------------------------------------------

struct TFile {
    name: Vec<u16>,
    word: Word,
}

struct TDir {
    name: Vec<u16>,
    dirs: Vec<TDir>,
    files: Vec<TFile>,
}

impl TDir {
    fn new(name: Vec<u16>) -> TDir {
        TDir {
            name,
            dirs: Vec::new(),
            files: Vec::new(),
        }
    }
}

/// Звенья совпадают без учёта регистра ASCII (как поиск в дереве писателя).
fn is_named(units: &[u16], name: &str) -> bool {
    units.len() == name.len()
        && units
            .iter()
            .zip(name.bytes())
            .all(|(&unit, byte)| unit < 128 && (unit as u8).eq_ignore_ascii_case(&byte))
}

fn units_of(name: &str) -> Vec<u16> {
    name.encode_utf16().collect()
}

/// Одна ли это запись: звенья пути те же, регистр ASCII не важен, лишние косые тоже.
pub(super) fn same_entry(left: &str, right: &str) -> bool {
    let (left, right) = (parts_of(left), parts_of(right));
    left.len() == right.len()
        && left
            .iter()
            .zip(&right)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

const MAX_DEPTH: usize = 64;

fn build_dir(
    nodes: &[Node],
    at: usize,
    depth: usize,
    seen: &mut [bool],
) -> std::result::Result<TDir, AppendError> {
    if depth > MAX_DEPTH {
        return Err(format_error(
            "The directory tree of the archive is too deep.",
        ));
    }
    let RawKind::Directory { first, count } = nodes[at].kind else {
        return Err(format_error("A directory entry is not a directory."));
    };
    let (first, count) = (first as usize, count as usize);
    if first.checked_add(count).is_none_or(|end| end > nodes.len()) {
        return Err(format_error(
            "A directory points beyond the table of contents.",
        ));
    }
    let mut dir = TDir::new(nodes[at].name.clone());
    for child in first..first + count {
        if std::mem::replace(&mut seen[child], true) {
            return Err(format_error(
                "The directory tree is malformed (an entry is listed twice).",
            ));
        }
        if nodes[child].is_dir() {
            dir.dirs.push(build_dir(nodes, child, depth + 1, seen)?);
        } else {
            dir.files.push(TFile {
                name: nodes[child].name.clone(),
                word: bare(&nodes[child].raw),
            });
        }
    }
    Ok(dir)
}

/// Дерево по записям таблицы: дети каждого каталога — в порядке таблицы.
fn tree_of(nodes: &[Node]) -> std::result::Result<TDir, AppendError> {
    if !nodes.first().is_some_and(Node::is_dir) {
        return Err(format_error("The archive root is not a directory."));
    }
    let mut seen = vec![false; nodes.len()];
    seen[0] = true;
    build_dir(nodes, 0, 0, &mut seen)
}

/// Дети каждого каталога идут по имени (порядок кодовых единиц UTF-16): голова
/// зависит только от набора записей, как у установки слоя (`sorted_tree`).
fn sort_tree(dir: &mut TDir) {
    dir.dirs.sort_by(|left, right| left.name.cmp(&right.name));
    dir.files.sort_by(|left, right| left.name.cmp(&right.name));
    for sub in &mut dir.dirs {
        sort_tree(sub);
    }
}

/// Записи таблицы по дереву: сначала подкаталоги, потом файлы, каталоги в
/// ширину, как раскладывает дозапись (дальше `relayout` сортирует детей).
fn flatten(root: &TDir) -> Vec<Node> {
    let mut nodes = vec![dir_node(Vec::new())];
    let mut queue: std::collections::VecDeque<(&TDir, usize)> = std::collections::VecDeque::new();
    queue.push_back((root, 0));
    while let Some((dir, at)) = queue.pop_front() {
        let first = nodes.len();
        let mut below: Vec<(&TDir, usize)> = Vec::new();
        for sub in &dir.dirs {
            below.push((sub, nodes.len()));
            nodes.push(dir_node(sub.name.clone()));
        }
        for file in &dir.files {
            nodes.push(Node {
                raw: file.word,
                kind: parse_entry(&file.word).kind,
                name: file.name.clone(),
            });
        }
        let kind = RawKind::Directory {
            first: first as u32,
            count: (dir.dirs.len() + dir.files.len()) as u32,
        };
        nodes[at].raw = encode_entry(&RawEntry {
            name_offset: 0,
            kind: kind.clone(),
        });
        nodes[at].kind = kind;
        queue.extend(below);
    }
    nodes
}

fn parts_of(path: &str) -> Vec<&str> {
    path.split('/').filter(|part| !part.is_empty()).collect()
}

/// Каталог по звеньям пути; нет — `None`.
fn dir_at<'a>(root: &'a mut TDir, parts: &[&str]) -> Option<&'a mut TDir> {
    let mut at = root;
    for part in parts {
        at = at.dirs.iter_mut().find(|dir| is_named(&dir.name, part))?;
    }
    Some(at)
}

/// Каталог по звеньям пути; недостающие создаются.
fn dir_made<'a>(root: &'a mut TDir, parts: &[&str]) -> &'a mut TDir {
    let mut at = root;
    for part in parts {
        let found = at.dirs.iter().position(|dir| is_named(&dir.name, part));
        let index = match found {
            Some(index) => index,
            None => {
                at.dirs.push(TDir::new(units_of(part)));
                at.dirs.len() - 1
            }
        };
        at = &mut at.dirs[index];
    }
    at
}

fn file_at<'a>(root: &'a mut TDir, path: &str) -> Option<&'a mut TFile> {
    let parts = parts_of(path);
    let (name, dirs) = parts.split_last()?;
    dir_at(root, dirs)?
        .files
        .iter_mut()
        .find(|file| is_named(&file.name, name))
}

/// Все файлы дерева: путь и слово.
fn files_of(root: &TDir) -> Vec<(String, Word)> {
    fn walk(dir: &TDir, prefix: &str, out: &mut Vec<(String, Word)>) {
        for file in &dir.files {
            let name: String = String::from_utf16_lossy(&file.name);
            out.push((format!("{prefix}{name}"), file.word));
        }
        for sub in &dir.dirs {
            let name = String::from_utf16_lossy(&sub.name);
            walk(sub, &format!("{prefix}{name}/"), out);
        }
    }
    let mut out = Vec::new();
    walk(root, "", &mut out);
    out
}

fn covered(path: &str, why: &str) -> AppendError {
    AppendError::refused(
        Code::LayerCovered,
        format!("The entry {path} is not as the layer left it ({why}); the layer is not switched."),
    )
}

/// Выключение слоя: записи слоя возвращаются или уходят, пустые созданные каталоги
/// уходят.
fn layer_off(root: &mut TDir, row: &layers::Row) -> std::result::Result<(), AppendError> {
    for change in row.changes.iter().rev() {
        let parts = parts_of(&change.path);
        let Some(file) = file_at(root, &change.path) else {
            return Err(covered(&change.path, "it is gone"));
        };
        if !same(&file.word, &change.after) {
            return Err(covered(&change.path, "another change lies over it"));
        }
        match (change.kind, change.before) {
            (Kind::Replace, Some(before)) => file.word = before,
            _ => {
                if let Some((name, dirs)) = parts.split_last() {
                    if let Some(dir) = dir_at(root, dirs) {
                        dir.files.retain(|known| !is_named(&known.name, name));
                    }
                }
            }
        }
    }
    for path in row.dirs.iter().rev() {
        let parts = parts_of(path);
        let Some((name, above)) = parts.split_last() else {
            continue;
        };
        if let Some(parent) = dir_at(root, above) {
            parent.dirs.retain(|dir| {
                !(is_named(&dir.name, name) && dir.dirs.is_empty() && dir.files.is_empty())
            });
        }
    }
    Ok(())
}

/// Включение слоя: записи слоя ложатся в оглавление.
fn layer_on(root: &mut TDir, row: &layers::Row) -> std::result::Result<(), AppendError> {
    for path in &row.dirs {
        dir_made(root, &parts_of(path));
    }
    for change in &row.changes {
        let parts = parts_of(&change.path);
        match (change.kind, change.before) {
            (Kind::Replace, Some(before)) => {
                let Some(file) = file_at(root, &change.path) else {
                    return Err(covered(&change.path, "it is gone"));
                };
                if !same(&file.word, &before) {
                    return Err(covered(
                        &change.path,
                        "it is not the one the layer replaced",
                    ));
                }
                file.word = change.after;
            }
            _ => {
                let Some((name, dirs)) = parts.split_last() else {
                    return Err(covered(&change.path, "the path is empty"));
                };
                let dir = dir_made(root, dirs);
                if dir.files.iter().any(|known| is_named(&known.name, name))
                    || dir.dirs.iter().any(|known| is_named(&known.name, name))
                {
                    return Err(covered(&change.path, "an entry of that name exists"));
                }
                dir.files.push(TFile {
                    name: units_of(name),
                    word: change.after,
                });
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Переключение
// ---------------------------------------------------------------------------

fn unknown(id: &str) -> AppendError {
    AppendError::refused(
        Code::LayerUnknown,
        format!("The layer {id} is not installed."),
    )
}

/// Тело варианта реестра на месте и не изменилось.
fn intact(file: &mut File, len: u64, variant: &Variant) -> bool {
    let at = block_of(&variant.word) * BLOCK;
    if variant.stored_len != body_len(&variant.word)
        || at
            .checked_add(variant.stored_len)
            .is_none_or(|end| end > len)
    {
        return false;
    }
    let mut bytes = vec![0u8; variant.stored_len as usize];
    file.seek(SeekFrom::Start(at)).is_ok()
        && file.read_exact(&mut bytes).is_ok()
        && sha256(&bytes) == variant.stored_sha
}

impl Session<'_> {
    /// Переключение слоёв. Перед ним доводится оборванная запись; новая голова
    /// строится по текущей. `verify` зовётся на записанном архиве до «готово»;
    /// `before_head` — после `Synced`, до голов (сводный рецепт).
    pub fn switch(
        &mut self,
        input: SwitchInput<'_>,
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
        before_head: BeforeHead<'_>,
    ) -> std::result::Result<SwitchReport, AppendError> {
        self.switch_all(input.into(), verify, before_head)
    }

    /// То же со списком общих записей корня: тело каждой собирает вызывающий из
    /// включённых слоёв. Содержимое, которое уже видели (по SHA-256 распакованных
    /// данных, у каждой записи свои варианты), тела не пишет; новые тела ложатся
    /// в хвост по порядку списка одной записью журнала. Одна запись в списке даёт
    /// те же байты, что `switch` с одной записью.
    pub fn switch_all(
        &mut self,
        input: SwitchAll<'_>,
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
        before_head: BeforeHead<'_>,
    ) -> std::result::Result<SwitchReport, AppendError> {
        let started = self.clock_start();
        let settled = self.settle()?;
        let plan_clock = Instant::now();
        activity::check()?;
        let (old_head_all, head, old_len) = self.head_now()?;
        self.require_appendable(&head, old_len)?;
        let Some(tip) = self.chain_now()? else {
            // без журнала слоёв нет, а цепочку переключение не начинает
            return match input
                .enable
                .iter()
                .chain(&input.disable)
                .chain(&input.remove)
                .next()
            {
                Some(id) => Err(unknown(id)),
                None if !input.registry.is_empty() => Err(AppendError::refused(
                    Code::LayerUnknown,
                    "The archive has no journal beside it, so it has no layers; a registry is \
                     switched together with them.",
                )),
                None => Ok(self.unchanged_report(settled, started)),
            };
        };
        let layers = LayerSet::load(&self.path, &self.replay)?;
        if !layers.lost.is_empty() {
            return Err(AppendError::refused(
                Code::LayersDamaged,
                "The journal knows layers the table beside the archive does not describe.",
            ));
        }

        // что просят: каждый слой назван один раз, существует, не связан
        let mut named: BTreeMap<&str, u8> = BTreeMap::new();
        for (words, mark) in [
            (&input.enable, 1u8),
            (&input.disable, 2),
            (&input.remove, 3),
        ] {
            for id in words {
                if named
                    .insert(id.as_str(), mark)
                    .is_some_and(|before| before != mark)
                {
                    return Err(AppendError::refused(
                        Code::LayerConflict,
                        format!("The layer {id} is named twice in one switch."),
                    ));
                }
            }
        }
        for id in named.keys() {
            let row = layers
                .live_rows()
                .find(|row| row.id == *id)
                .ok_or_else(|| unknown(id))?;
            if row.linked {
                return Err(AppendError::refused(
                    Code::LayerLinked,
                    format!(
                        "The layer {id} edited an existing nested archive; it is not switched, \
                         only rolled back or rebuilt by the full path."
                    ),
                ));
            }
        }

        // итоговое состояние всех слоёв и что для него надо сделать
        let before_states: BTreeMap<String, Status> = layers
            .live_rows()
            .filter_map(|row| {
                layers
                    .state_of(&row.id)
                    .map(|state| (row.id.clone(), state))
            })
            .collect();
        let mut after_states = before_states.clone();
        let (mut to_enable, mut to_disable, mut removed): (Vec<&str>, Vec<&str>, Vec<&str>) =
            (Vec::new(), Vec::new(), Vec::new());
        for (id, mark) in &named {
            let state = before_states[*id];
            match mark {
                1 if state == Status::Disabled => to_enable.push(id),
                2 if state == Status::Enabled => to_disable.push(id),
                3 => {
                    if state == Status::Enabled {
                        to_disable.push(id);
                    }
                    removed.push(id);
                }
                _ => {}
            }
            after_states.insert(
                (*id).to_owned(),
                match mark {
                    1 => Status::Enabled,
                    2 => Status::Disabled,
                    _ => Status::Removed,
                },
            );
        }
        for row in layers.live_rows() {
            let state = after_states[&row.id];
            for needed in &row.requires {
                let needed_state = after_states.get(needed).copied().unwrap_or(Status::Removed);
                let broken = match state {
                    Status::Enabled => needed_state != Status::Enabled,
                    Status::Disabled => needed_state == Status::Removed,
                    Status::Removed => false,
                };
                if broken {
                    return Err(AppendError::refused(
                        Code::LayerRequires,
                        format!(
                            "The layer {} needs {needed}, which would be {}.",
                            row.id,
                            needed_state.word()
                        ),
                    ));
                }
            }
        }

        // голова по текущей
        let keys = input.keys.as_ref();
        let source = FileSource::open(&self.path)?;
        let toc = read_toc(&source, &self.name, Some(keys))?;
        let key = toc
            .ng_key_index
            .ok_or_else(|| format_error("The table of contents is not NG-encrypted."))?;
        drop(source);
        let records_end = HEADER_SIZE + head.count as usize * ENTRY_SIZE;
        let mut records = old_head_all[HEADER_SIZE..records_end].to_vec();
        keys.decrypt_ng(key, &mut records);
        let nodes = seal::read_nodes(&records, &toc.names);
        let mut tree = tree_of(&nodes)?;

        // слои: выключаются сверху вниз, включаются снизу вверх
        let seq_of = |id: &str| layers.row(id).map_or(0, |row| row.seq);
        to_disable.sort_by_key(|id| std::cmp::Reverse(seq_of(id)));
        to_enable.sort_by_key(|id| seq_of(id));
        for id in &to_disable {
            if let Some(row) = layers.row(id) {
                layer_off(&mut tree, row)?;
            }
        }
        for id in &to_enable {
            if let Some(row) = layers.row(id) {
                layer_on(&mut tree, row)?;
            }
        }

        // реестр: уже виденное содержимое тела не пишет. Общих записей может быть
        // несколько (у редуксов `content.xml` и `dlclist.xml`): новые тела ложатся в
        // хвост подряд, по порядку списка, каждое от границы блока
        let mut registry_reports: Vec<RegistryReport> = Vec::new();
        let mut bodies: Vec<(Fresh<'_>, u64)> = Vec::new();
        let mut pending: Vec<(String, Word, Digest)> = Vec::new();
        let mut context = WriteContext {
            staging: Path::new("."),
            keys: Some(keys),
            finalizer: None,
        };
        let mut cursor = old_len;
        for (at, registry) in input.registry.iter().enumerate() {
            let entry = registry.entry.as_str();
            // запись названа один раз: два тела на одно место легли бы друг на друга
            if input.registry[..at]
                .iter()
                .any(|before| same_entry(&before.entry, entry))
            {
                return Err(AppendError::refused(
                    Code::RegistryInvalid,
                    format!("The registry entry {entry} is named twice in one switch."),
                ));
            }
            let current = file_at(&mut tree, entry)
                .map(|file| file.word)
                .ok_or_else(|| {
                    AppendError::refused(
                        Code::RegistryInvalid,
                        format!("The registry entry {entry} is not in the archive."),
                    )
                })?;
            let RawKind::Binary { stored_size, .. } = parse_entry(&current).kind else {
                return Err(AppendError::refused(
                    Code::RegistryInvalid,
                    format!("The registry entry {entry} is not a plain file."),
                ));
            };
            let wanted = sha256(&registry.content);
            let mut found: Option<Word> = None;
            for variant in &layers.variants {
                if variant.entry.eq_ignore_ascii_case(entry)
                    && variant.sha == wanted
                    && intact(&mut self.file, old_len, variant)
                {
                    found = Some(variant.word);
                    break;
                }
            }
            let mut report = RegistryReport {
                entry: entry.to_owned(),
                reused: false,
                unchanged: false,
                bytes_written: 0,
            };
            if let Some(word) = found {
                report.reused = true;
                report.unchanged = same(&word, &current);
                if let Some(file) = file_at(&mut tree, entry) {
                    file.word = word;
                }
            } else {
                let content_now = self.content_sha(input.keys, entry)?;
                if content_now == wanted {
                    // то, что стоит, и есть нужное: запомнить его слово на будущее
                    report.reused = true;
                    report.unchanged = true;
                    pending.push((entry.to_owned(), current, content_now));
                } else {
                    let node = FileNode {
                        name: entry.rsplit('/').next().unwrap_or(entry).to_owned(),
                        body: Body::Binary {
                            data: Data::memory(registry.content.clone()),
                            compress: if stored_size == 0 {
                                Compress::Store
                            } else {
                                Compress::Auto
                            },
                        },
                    };
                    let fresh = prepare_fresh(&node, &mut context)?;
                    let to = ceil_block(cursor);
                    let ceiling = self.tuning.body_start_ceiling;
                    if to > ceiling || to / BLOCK > LAST_BLOCK || !fresh.fits_at(to / BLOCK) {
                        return Err(AppendError::refused(
                            Code::BodyStartTooHigh,
                            format!(
                                "The registry body would start at {to}, above the appending \
                                 ceiling of {ceiling} bytes."
                            ),
                        ));
                    }
                    let word = bare(&encode_entry(&fresh.raw_entry(0, (to / BLOCK) as u32)));
                    report.bytes_written = fresh.len();
                    pending.push((entry.to_owned(), current, content_now));
                    pending.push((entry.to_owned(), word, wanted));
                    if let Some(file) = file_at(&mut tree, entry) {
                        file.word = word;
                    }
                    cursor = to + fresh.len();
                    bodies.push((fresh, to));
                }
            }
            registry_reports.push(report);
        }

        // ничего не изменилось: ни записи, ни байта
        let nothing = to_enable.is_empty()
            && to_disable.is_empty()
            && removed.is_empty()
            && bodies.is_empty()
            && registry_reports.iter().all(|report| report.unchanged);
        if nothing {
            let mut report = self.unchanged_report(settled, started);
            report.fingerprint = self.text_of(&tip);
            report.fingerprint_before = report.fingerprint.clone();
            report.layers = layer_list(&layers, &after_states);
            report.dormant_bytes = layers.dormant_bytes();
            report.registry = registry_reports.first().cloned();
            report.registries = registry_reports;
            report.journal_records = self.replay.records.len();
            report.old_len = old_len;
            report.new_len = old_len;
            return Ok(report);
        }
        // варианты реестра попадут в таблицу и без записи слоёв: только если они новые
        let end = match bodies.last() {
            Some((fresh, to)) => to + fresh.len(),
            None => old_len,
        };
        // с ключом головы (R4) в конец добавляются нули: длина файла держит ключ
        let last_start = bodies.last().map_or(0, |(_, to)| *to);
        let (new_len, key_pad) = self.kept_len(keys, key, old_len, end, last_start)?;

        // оглавление
        sort_tree(&mut tree);
        let new_nodes = flatten(&tree);
        let layout = seal::relayout(&new_nodes)?;
        if new_nodes
            .iter()
            .enumerate()
            .any(|(at, node)| !node.is_dir() && layout.name_at[at] > FILE_NAME_AT_MAX)
        {
            return Err(AppendError::refused(
                Code::NameOffsetTooHigh,
                "The archive has too many file names for the RPF7 table of contents.",
            ));
        }
        let table = seal::encode_records(&new_nodes, &layout, &HashMap::new())?;
        let names = seal::pad_names(layout.block);
        let key_index = keys.ng_key_index(&self.name, new_len);
        let mut sealed = table;
        sealed.extend_from_slice(&names);
        keys.encrypt_ng(key_index, &mut sealed)?;
        let mut new_head = Vec::with_capacity(HEADER_SIZE + sealed.len());
        for value in [
            MAGIC,
            new_nodes.len() as u32,
            names.len() as u32,
            ENCRYPTION_NG,
        ] {
            new_head.extend_from_slice(&value.to_le_bytes());
        }
        new_head.extend_from_slice(&sealed);

        // голова не должна дорасти до первого тела: живого или спящего
        let files = files_of(&tree);
        let first_body = files
            .iter()
            .filter(|(_, word)| body_len(word) > 0)
            .map(|(_, word)| block_of(word) * BLOCK)
            .min();
        let mut after_set = layers.clone();
        after_set.status = after_states
            .iter()
            .map(|(id, state)| (id.clone(), *state))
            .collect();
        let floor = [first_body, after_set.owned_floor()]
            .into_iter()
            .flatten()
            .min();
        if floor.is_some_and(|floor| new_head.len() as u64 > floor)
            || new_head.len() as u64 > old_len
        {
            return Err(AppendError::refused(
                Code::HeadBeyondMax,
                format!(
                    "The table of contents after the switch ({} bytes) does not fit before the \
                     first body (at {}); the layers were installed under a smaller head \
                     threshold.",
                    new_head.len(),
                    floor.unwrap_or(old_len)
                ),
            ));
        }

        // область головы, откуда запись откатывается и где файл узнаётся как наш
        let region = new_head.len().max(head.span);
        let old_head = if region <= old_head_all.len() {
            old_head_all[..region].to_vec()
        } else {
            self.read_vec(0, region)?
        };
        let mut new_image = old_head.clone();
        new_image[..new_head.len()].copy_from_slice(&new_head);
        let new_sectors: Vec<Digest> = new_image.chunks(SECTOR).map(sha256).collect();
        let identity = self.host.facts(&self.file)?.identity;
        let areas = vec![(0u64, region as u64)];
        if areas.last().is_some_and(|&(_, to)| to > old_len) {
            return Err(format_error(
                "The head region of a switch goes beyond the end of the file.",
            ));
        }
        let anchors = self.anchors_outside(&areas, old_len)?;

        // подряд идущие переключения делят отпечаток: каждое считается от того, что
        // было до первого из них
        let under = self
            .replay
            .top()
            .filter(|top| {
                top.phase == Phase::Done
                    && self
                        .replay
                        .layer_op(top.begin.seq)
                        .is_some_and(LayerOp::is_toggle)
            })
            .map(|top| top.begin.clone());
        let prev = under.as_ref().map_or(tip, |begin| begin.prev);
        let after = chain_digest(new_len, &sha256(&new_head), &prev);
        let live: u64 = files
            .iter()
            .map(|(_, word)| ceil_block(body_len(word)))
            .sum();
        let dead_after = new_len
            .saturating_sub(ceil_block(new_head.len() as u64))
            .saturating_sub(live);
        let plan_time = plan_clock.elapsed();

        let op = LayerOp {
            place: None,
            enable: to_enable.iter().map(|id| (*id).to_owned()).collect(),
            disable: to_disable
                .iter()
                .filter(|id| !removed.contains(id))
                .map(|id| (*id).to_owned())
                .collect(),
            remove: removed.iter().map(|id| (*id).to_owned()).collect(),
        };
        let seq = self.replay.next_seq;
        let body_bytes: u64 = bodies.iter().map(|(fresh, _)| fresh.len()).sum();
        let begin = Begin {
            seq,
            old_len,
            new_len,
            prev,
            after,
            dead_after,
            bytes_written: body_bytes + new_head.len() as u64,
            bytes_moved: 0,
            moves: Vec::new(),
            identity,
            anchors,
            old_head,
            new_sectors,
            regions: Vec::new(),
            fills: Vec::new(),
            note: self.note.clone(),
        };

        // шаг 1: журнал
        self.log(vec![
            Entry::Begin(begin.clone()),
            Entry::Layers(seq, op.clone()),
        ])?;
        self.host.hit("switch-after-journal");

        // шаг 2: тела реестра в хвост, по порядку списка; сброс один, после всех
        if !bodies.is_empty() {
            let wrote = (|| -> std::result::Result<(), AppendError> {
                if new_len > self.len()? {
                    self.file.set_len(new_len)?;
                }
                let mut meter = |_: u64| {};
                let mut sink = Sink::for_append(&mut meter, 0);
                for (fresh, to) in &bodies {
                    fresh.put(&mut self.file, *to, &mut sink)?;
                    self.host.hit("switch-in-data");
                }
                self.sync()?;
                Ok(())
            })();
            if let Err(error) = wrote {
                self.abort_before_head(seq);
                return Err(error);
            }
        }
        self.host.hit("switch-after-data");

        // шаг 3: отметка
        if let Err(error) = self.log(vec![Entry::Synced(seq)]) {
            self.abort_before_head(seq);
            return Err(error);
        }
        self.host.hit("switch-after-synced");

        // шаг 4: варианты реестра, потом крюк вызывающего
        if !pending.is_empty() {
            let outcome = self.remember_variants(&layers, &pending);
            if let Err(error) = outcome {
                self.abort_before_head(seq);
                return Err(error);
            }
        }
        let chain_base = self
            .replay
            .base
            .clone()
            .ok_or_else(|| format_error("The journal has no chain base."));
        let announced = chain_base.and_then(|base| {
            before_head(&Ahead {
                seq,
                fingerprint_before: self.text_of(&tip),
                fingerprint_after: self.text_of(&after),
                chain_base: base.digest,
                chain_base_len: base.len,
                new_chain: false,
            })
        });
        if let Err(error) = announced {
            self.abort_before_head(seq);
            return Err(error);
        }
        self.host.hit("switch-after-recipe");

        // шаг 5: голова
        let head_clock = Instant::now();
        if let Err(error) = self.write_halves(0, &new_head, "switch-mid-head") {
            let _ = self.undo_top(false);
            return Err(error);
        }
        let head_time = head_clock.elapsed();
        self.host.hit("switch-after-head");

        // шаг 6: проверка записанного и «готово»
        let checked = Archive::open_path(&self.path, Some(Arc::clone(input.keys)))
            .map_err(AppendError::from)
            .and_then(|opened| {
                expect_files(&opened, &files)?;
                verify(&opened).map_err(format_error)
            });
        if let Err(error) = checked {
            let _ = self.undo_top(false);
            return Err(error);
        }
        let stamp = self.stamp_now()?;
        self.log(vec![Entry::Done(seq, stamp)])?;
        self.host.hit("switch-after-done");

        // шаг 7: слияние с предыдущим переключением
        let mut merged = None;
        if let Some(under) = under {
            let merge = self.merge_into(&under, &begin, &op);
            if merge.is_ok() {
                merged = Some((under.seq, seq));
            }
            self.host.hit("switch-after-merge");
        }

        let enabled_now = layer_list(&layers, &after_states);
        Ok(SwitchReport {
            seq: merged.map_or(seq, |(kept, _)| kept),
            changed: true,
            merged,
            fingerprint: self.text_of(&after),
            fingerprint_before: self.text_of(&tip),
            old_len,
            new_len,
            bytes_written: begin.bytes_written,
            head_len: new_head.len() as u64,
            enabled: op.enable.clone(),
            disabled: op.disable.clone(),
            removed: op.remove.clone(),
            layers: enabled_now,
            dead_bytes: dead_after,
            dormant_bytes: after_set.dormant_bytes(),
            registry: registry_reports.first().cloned(),
            registries: registry_reports,
            journal_records: self.replay.records.len(),
            key_pad,
            settled,
            timings: self.timings(started, plan_time, head_time),
        })
    }

    /// Отчёт о переключении, которое ничего не записало.
    fn unchanged_report(&mut self, settled: Settled, started: Instant) -> SwitchReport {
        SwitchReport {
            seq: self.replay.top().map_or(0, |top| top.begin.seq),
            changed: false,
            merged: None,
            fingerprint: String::new(),
            fingerprint_before: String::new(),
            old_len: 0,
            new_len: 0,
            bytes_written: 0,
            head_len: 0,
            enabled: Vec::new(),
            disabled: Vec::new(),
            removed: Vec::new(),
            layers: Vec::new(),
            dead_bytes: 0,
            dormant_bytes: 0,
            registry: None,
            registries: Vec::new(),
            journal_records: self.replay.records.len(),
            key_pad: None,
            settled,
            timings: self.timings(started, Duration::ZERO, Duration::ZERO),
        }
    }

    /// SHA-256 распакованного содержимого записи корня.
    fn content_sha(
        &self,
        keys: &Arc<KeySet>,
        entry: &str,
    ) -> std::result::Result<Digest, AppendError> {
        let archive = Archive::open_path(&self.path, Some(Arc::clone(keys)))?;
        let parts = parts_of(entry);
        let (name, dirs) = parts
            .split_last()
            .ok_or_else(|| format_error("The registry path is empty."))?;
        let mut at = archive.root();
        for part in dirs {
            at = archive
                .find_dir(at, part)
                .ok_or_else(|| format_error("The registry directory is not in the archive."))?;
        }
        let id = archive
            .find_file(at, name)
            .ok_or_else(|| format_error("The registry entry is not in the archive."))?;
        let data = archive.decode(id, crate::archive::EntryCipher::AlwaysNg)?;
        Ok(sha256(&data))
    }

    /// Варианты реестра ложатся в таблицу (тела уже на диске): по ним позже тот же
    /// набор включается без записи тела. Строка с тем же содержимым заменяется.
    fn remember_variants(
        &mut self,
        layers: &LayerSet,
        pending: &[(String, Word, Digest)],
    ) -> std::result::Result<(), AppendError> {
        let variants = self.merged_variants(&layers.variants, pending)?;
        self.save_table(layers.rows.clone(), variants)
    }

    /// Прежние варианты и новые: (запись, слово, SHA-256 содержимого). Тело читается с
    /// диска и запоминается своим SHA-256; строка с тем же содержимым той же записи
    /// заменяется, новая встаёт в конец.
    pub(super) fn merged_variants(
        &mut self,
        known: &[Variant],
        pending: &[(String, Word, Digest)],
    ) -> std::result::Result<Vec<Variant>, AppendError> {
        let mut variants: Vec<Variant> = known.to_vec();
        for (entry, word, sha) in pending {
            let at = block_of(word) * BLOCK;
            let len = body_len(word);
            let stored = self.read_vec(at, len as usize)?;
            variants
                .retain(|known| !(known.entry.eq_ignore_ascii_case(entry) && known.sha == *sha));
            variants.push(Variant {
                entry: entry.clone(),
                sha: *sha,
                word: *word,
                stored_sha: sha256(&stored),
                stored_len: len,
            });
        }
        Ok(variants)
    }

    /// Это переключение и предыдущее — одна запись журнала: прежние байты головы
    /// самого раннего, отпечаток и секторы последнего.
    fn merge_into(
        &mut self,
        under: &Begin,
        last: &Begin,
        op: &LayerOp,
    ) -> std::result::Result<(), AppendError> {
        let region = under.old_head.len().max(last.old_head.len());
        let mut old_head = under.old_head.clone();
        if last.old_head.len() > old_head.len() {
            // за областью раннего переключения файл до него тот же, что после него
            old_head.extend_from_slice(&last.old_head[under.old_head.len()..]);
        }
        let image = self.read_vec(0, region)?;
        let new_sectors: Vec<Digest> = image.chunks(SECTOR).map(sha256).collect();
        let earlier = self.replay.layer_op(under.seq).cloned().unwrap_or_default();
        let merged = Begin {
            seq: under.seq,
            old_len: under.old_len,
            new_len: last.new_len,
            prev: under.prev,
            after: last.after,
            dead_after: last.dead_after,
            bytes_written: last.bytes_written,
            bytes_moved: 0,
            moves: Vec::new(),
            identity: under.identity,
            // окна прежних тел, которых голова не касается
            anchors: under
                .anchors
                .iter()
                .filter(|anchor| anchor.from >= region as u64)
                .copied()
                .collect(),
            old_head,
            new_sectors,
            regions: Vec::new(),
            fills: Vec::new(),
            note: under.note.clone(),
        };
        let host = self.host;
        let started = Instant::now();
        let outcome = journal::merge_top_two(
            &self.journal,
            &mut self.replay,
            merged,
            earlier.then(op),
            &|point| host.hit(point),
        );
        self.clock.journal += started.elapsed();
        outcome
    }
}

/// Слои по возрастанию номера установки и их состояние.
fn layer_list(layers: &LayerSet, states: &BTreeMap<String, Status>) -> Vec<(String, Status)> {
    let mut rows: Vec<&layers::Row> = layers.live_rows().collect();
    rows.sort_by_key(|row| row.seq);
    rows.into_iter()
        .filter_map(|row| states.get(&row.id).map(|state| (row.id.clone(), *state)))
        .collect()
}

/// Записанный архив читается как оглавление, которое мы собрали: те же файлы с
/// теми же местами и размерами.
fn expect_files(
    opened: &Archive,
    files: &[(String, Word)],
) -> std::result::Result<(), AppendError> {
    let present = opened
        .entries()
        .iter()
        .filter(|entry| !matches!(entry.kind, EntryKind::Directory { .. }))
        .count();
    if present != files.len() {
        return Err(format_error(
            "The archive after the switch has another number of entries than expected.",
        ));
    }
    for (path, word) in files {
        let parts = parts_of(path);
        let Some((name, dirs)) = parts.split_last() else {
            continue;
        };
        let mut at = opened.root();
        for part in dirs {
            at = opened.find_dir(at, part).ok_or_else(|| {
                format_error("An expected directory is missing after the switch.")
            })?;
        }
        let id = opened
            .find_file(at, name)
            .ok_or_else(|| format_error("An expected entry is missing after the switch."))?;
        let ok = match old_extent(opened, id) {
            Some((offset, len)) => {
                let want = (block_of(word) * BLOCK, body_len(word));
                // у тела нулевой длины место не важно
                (offset == want.0 && len == want.1) || (len == 0 && want.1 == 0)
            }
            None => false,
        };
        if !ok {
            return Err(format_error(
                "An entry after the switch is not where the table of contents says.",
            ));
        }
    }
    Ok(())
}
