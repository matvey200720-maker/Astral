// Открытый архив RPF7: дерево записей и чтение их содержимого.

use crate::{
    error::{Result, RpfError},
    keys::KeySet,
    source::{ByteSource, FileSource, SliceSource},
    toc::{read_toc, Encryption, RawEntry, RawKind, Toc, BLOCK, NO_DIRECTORIES},
};
use flate2::read::DeflateDecoder;
use std::{
    collections::HashMap,
    io::Read,
    iter,
    path::Path,
    sync::{Arc, Mutex, PoisonError},
};

// Короткие имена для типов из подписей: это те же самые типы.
type Keys = Option<Arc<KeySet>>;
type Shared = Arc<dyn ByteSource>;
type Bytes = Result<Vec<u8>>;
type Unit = Result<()>;
type Extent = Result<(u64, u64)>;
type Ids = Vec<EntryId>;
type Listed<'a> = &'a [EntryId];

// Публичная структура по списку «поле => тип»: все поля открыты.
macro_rules! open_fields {
    (
        $(#[$meta:meta])*
        $name:ident { $($field:ident => $ty:ty;)+ }
    ) => {
        $(#[$meta])*
        pub struct $name {
            $(pub $field: $ty,)+
        }
    };
}

// Структура с закрытыми полями по списку «поле => тип».
macro_rules! fields_struct {
    ($vis:vis $name:ident { $($field:ident => $ty:ty;)+ }) => {
        $vis struct $name {
            $($field: $ty,)+
        }
    };
}

// Перечень производных свойств над описанием типа.
macro_rules! with_derives {
    ([$($derived:ident),+ $(,)?] $item:item) => {
        #[derive($($derived),+)]
        $item
    };
}

// Смещение данных записи от начала источника: номер блока на длину блока.
macro_rules! block_offset {
    ($($holder:ty),+) => {
        $(
            impl $holder {
                pub fn offset(&self) -> u64 {
                    BLOCK * u64::from(self.offset_blocks)
                }
            }
        )+
    };
}

// Чтение одного поля архива без вычислений.
macro_rules! plain_reads {
    ($this:ident; $($name:ident($ret:ty) = $value:expr;)+) => {
        $(
            pub fn $name(&$this) -> $ret {
                $value
            }
        )+
    };
}

pub type EntryId = usize;

with_derives! {
    [Clone, Copy, Debug, PartialEq, Eq]
    pub enum EntryCipher {
        AlwaysNg,
        ByArchive,
    }
}

with_derives! {
    [Clone, Debug]
    pub enum EntryKind {
        Directory { dirs: Ids, files: Ids },
        Binary(BinaryInfo),
        Resource(ResourceInfo),
    }
}

open_fields! {
    #[derive(Clone, Debug)]
    Entry {
        name => String;
        kind => EntryKind;
    }
}

open_fields! {
    #[derive(Clone, Debug, PartialEq, Eq)]
    ResourceInfo {
        stored_size => u32;
        offset_blocks => u32;
        system_flags => u32;
        graphics_flags => u32;
    }
}

open_fields! {
    #[derive(Clone, Debug, PartialEq, Eq)]
    BinaryInfo {
        stored_size => u32;
        offset_blocks => u32;
        uncompressed_size => u32;
        encrypted => bool;
    }
}

block_offset!(BinaryInfo, ResourceInfo);

impl BinaryInfo {
    pub fn stored_len(&self) -> u64 {
        u64::from(if self.stored_size == 0 {
            self.uncompressed_size
        } else {
            self.stored_size
        })
    }

    pub fn is_compressed(&self) -> bool {
        matches!(self.stored_size, 1..)
    }
}

impl ResourceInfo {
    // Старшая половина байта версии — четыре старших бита системных флагов,
    // младшая — четыре старших бита графических.
    pub fn version(&self) -> u32 {
        ((self.system_flags >> 28) << 4) | (self.graphics_flags >> 28)
    }
}

fields_struct! {
    pub Archive {
        name => String;
        source => Shared;
        keys => Keys;
        encryption => Encryption;
        entries => Vec<Entry>;
        root => EntryId;
        // Вложенные архивы, уже разобранные через `open_nested_shared`.
        shared => Mutex<HashMap<EntryId, Arc<Archive>>>;
    }
}

// ---------- сборка дерева: сначала записи, потом связи ----------

// Проход 1: запись по строке оглавления; у каталога пока нет детей.
fn blank_entry(toc: &Toc, raw: &RawEntry) -> Entry {
    let kind = match &raw.kind {
        RawKind::Binary {
            stored_size,
            offset_blocks,
            uncompressed_size,
            encrypted,
        } => EntryKind::Binary(BinaryInfo {
            stored_size: *stored_size,
            offset_blocks: *offset_blocks,
            uncompressed_size: *uncompressed_size,
            encrypted: *encrypted,
        }),
        RawKind::Resource {
            stored_size,
            offset_blocks,
            system_flags,
            graphics_flags,
        } => EntryKind::Resource(ResourceInfo {
            stored_size: *stored_size,
            offset_blocks: *offset_blocks,
            system_flags: *system_flags,
            graphics_flags: *graphics_flags,
        }),
        RawKind::Directory { .. } => EntryKind::Directory {
            dirs: Ids::new(),
            files: Ids::new(),
        },
    };
    Entry {
        kind,
        name: toc.name_at(raw.name_offset),
    }
}

// Размер ресурса в записи 0xffffff — «настоящий размер лежит в данных ресурса».
const HIDDEN_SIZE_MARK: u32 = 0x00ff_ffff;
const RESOURCE_HEADER_LEN: usize = 16;

fn hidden_size_from(head: &[u8]) -> u32 {
    u32::from_le_bytes([head[7], head[14], head[5], head[2]])
}

fn reveal_hidden_sizes(source: &dyn ByteSource, entries: &mut [Entry]) -> Unit {
    let resources = entries
        .iter_mut()
        .filter_map(|entry| match &mut entry.kind {
            EntryKind::Resource(info) => Some(info),
            _ => None,
        });
    for info in resources.filter(|info| info.stored_size == HIDDEN_SIZE_MARK) {
        let head = source.read_vec(info.offset(), RESOURCE_HEADER_LEN)?;
        info.stored_size = hidden_size_from(&head);
    }
    Ok(())
}

#[derive(Default)]
struct Children {
    dirs: Ids,
    files: Ids,
}

// Проход 2: кто чей ребёнок. Каждая запись может принадлежать одному каталогу.
struct Linker<'a> {
    table: &'a [RawEntry],
    archive_name: &'a str,
    owner: Vec<Option<EntryId>>,
}

impl<'a> Linker<'a> {
    fn new(table: &'a [RawEntry], archive_name: &'a str) -> Self {
        Linker {
            owner: iter::repeat_n(None, table.len()).collect(),
            archive_name,
            table,
        }
    }

    fn is_directory(&self, id: EntryId) -> bool {
        matches!(self.table[id].kind, RawKind::Directory { .. })
    }

    fn refuse(&self, what: &str) -> RpfError {
        RpfError::format(format!("{}: {what}", self.archive_name))
    }

    // Записывает `child` за каталогом `dir`; говорит, каталог ли он сам.
    fn claim(&mut self, dir: EntryId, child: EntryId) -> Result<bool> {
        if self.owner[child].replace(dir).is_some() {
            return Err(self.refuse("the directory tree is malformed (an entry is listed twice)"));
        }
        Ok(self.is_directory(child))
    }

    // Принимает под начало `dir` его диапазон записей.
    fn adopt(&mut self, dir: EntryId) -> Result<Children> {
        let RawKind::Directory { first, count } = self.table[dir].kind else {
            return Ok(Children::default());
        };
        let end = u64::from(first) + u64::from(count);
        if end > self.table.len() as u64 {
            return Err(self.refuse("a directory points beyond the table of contents"));
        }

        let mut children = Children::default();
        for child in first as usize..end as usize {
            if self.claim(dir, child)? {
                children.dirs.push(child);
            } else {
                children.files.push(child);
            }
        }
        Ok(children)
    }

    // Обход идёт стеком: подкаталоги кладутся в порядке таблицы, берётся последний.
    fn resolve(mut self) -> Result<(EntryId, Vec<Option<Children>>)> {
        let first_dir = self
            .table
            .iter()
            .position(|raw| matches!(raw.kind, RawKind::Directory { .. }));
        let root = first_dir.ok_or_else(|| RpfError::format(NO_DIRECTORIES))?;
        self.owner[root] = Some(root);

        let mut found = Vec::from_iter((0..self.table.len()).map(|_| None));
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            let children = self.adopt(dir)?;
            stack.extend_from_slice(&children.dirs);
            found[dir] = Some(children);
        }
        Ok((root, found))
    }
}

// ---------- чтение содержимого: конвейер шагов ----------

// Шаг обработки сохранённых байт записи.
enum Stage {
    // Снять шифр: AES или NG по имени записи и её несжатому размеру.
    Unseal {
        aes: bool,
        name: String,
        plain_size: u32,
    },
    Inflate {
        expected: usize,
    },
    // Пересобрать заголовок ресурса: RSC7, версия, два слова флагов.
    Rewrap {
        name: String,
        words: [u32; 3],
    },
}

fn rewrap_stage(entry: &Entry, info: &ResourceInfo) -> Stage {
    Stage::Rewrap {
        words: [info.version(), info.system_flags, info.graphics_flags],
        name: entry.name.clone(),
    }
}

// Где лежат сохранённые байты записи: смещение и длина.
fn extent(entry: &Entry) -> Extent {
    match &entry.kind {
        EntryKind::Binary(info) => Ok((info.offset(), info.stored_len())),
        EntryKind::Resource(info) => Ok((info.offset(), u64::from(info.stored_size))),
        EntryKind::Directory { .. } => Err(RpfError::argument(format!(
            "{} is a directory, not a file.",
            entry.name
        ))),
    }
}

impl Archive {
    // Какие шаги проходит запись, чтобы стать тем, что видит игра.
    fn plan(&self, id: EntryId, cipher: EntryCipher) -> Vec<Stage> {
        let entry = &self.entries[id];
        match &entry.kind {
            EntryKind::Directory { .. } => Vec::new(),
            EntryKind::Resource(info) => vec![rewrap_stage(entry, info)],
            EntryKind::Binary(info) => [
                info.encrypted.then(|| Stage::Unseal {
                    aes: cipher == EntryCipher::ByArchive && self.encryption == Encryption::Aes,
                    name: entry.name.clone(),
                    plain_size: info.uncompressed_size,
                }),
                info.is_compressed().then_some(Stage::Inflate {
                    expected: info.uncompressed_size as usize,
                }),
            ]
            .into_iter()
            .flatten()
            .collect(),
        }
    }

    fn rewrap(name: &str, words: [u32; 3], data: &[u8]) -> Bytes {
        if data.len() < RESOURCE_HEADER_LEN {
            return Err(RpfError::format(format!(
                "{name}: the resource is shorter than its header."
            )));
        }
        let [first, second, third] = words;
        Ok([
            RESOURCE_MAGIC.as_slice(),
            &first.to_le_bytes(),
            &second.to_le_bytes(),
            &third.to_le_bytes(),
            &data[RESOURCE_HEADER_LEN..],
        ]
        .concat())
    }

    fn unseal(&self, aes: bool, name: &str, plain_size: u32, mut data: Vec<u8>) -> Bytes {
        match (self.keys.as_deref(), aes) {
            (Some(keys), true) => keys.decrypt_aes(&mut data),
            (Some(keys), false) => keys.decrypt_ng_by_name(name, u64::from(plain_size), &mut data),
            (None, _) => {
                return Err(RpfError::keys(format!(
                    "{}-encrypted entry requires the GTA V key set.",
                    if aes { "AES" } else { "NG" }
                )))
            }
        }
        Ok(data)
    }

    fn run_stage(&self, stage: Stage, data: Vec<u8>) -> Bytes {
        match stage {
            Stage::Rewrap { name, words } => Self::rewrap(&name, words, &data),
            Stage::Unseal {
                aes,
                name,
                plain_size,
            } => self.unseal(aes, &name, plain_size, data),
            Stage::Inflate { expected } => inflate(&data, expected),
        }
    }

    fn run_plan(&self, plan: Vec<Stage>, stored: Vec<u8>) -> Bytes {
        let mut data = stored;
        plan.into_iter().try_for_each(|stage| {
            data = self.run_stage(stage, std::mem::take(&mut data))?;
            Ok::<(), RpfError>(())
        })?;
        Ok(data)
    }

    pub fn read_stored(&self, id: EntryId) -> Bytes {
        let (offset, len) = extent(&self.entries[id])?;
        match usize::try_from(len) {
            Ok(len) => Ok(self.source.read_vec(offset, len)?),
            Err(_) => Err(RpfError::format("The archive entry is too large to read.")),
        }
    }

    pub fn export(&self, id: EntryId) -> Bytes {
        let stored = self.read_stored(id)?;
        let entry = &self.entries[id];
        let EntryKind::Resource(info) = &entry.kind else {
            return Ok(stored);
        };
        self.run_stage(rewrap_stage(entry, info), stored)
    }

    pub fn decode(&self, id: EntryId, cipher: EntryCipher) -> Bytes {
        self.read_stored(id)
            .and_then(|stored| self.run_plan(self.plan(id, cipher), stored))
    }
}

const RESOURCE_MAGIC: &[u8; 4] = b"RSC7";
const INFLATE_RESERVE_CAP: usize = 1 << 30;
const UNSUPPORTED_COMPRESSION: &str =
    "The archive entry was compressed using an unsupported compression method.";

const SIZE_MISMATCH: &str =
    "The archive entry did not decompress to the size recorded in the table of contents.";

// Распаковка сверяется с размером из оглавления: и короткий, и длинный результат
// отказ. Читается не больше `expected + 1` байт, поэтому поток, раздувающийся
// сверх заявленного, не съедает память.
pub fn inflate(data: &[u8], expected: usize) -> Bytes {
    let reserve = expected.min(INFLATE_RESERVE_CAP);
    let mut out = Vec::<u8>::with_capacity(reserve);
    let budget = (expected as u64).saturating_add(1);
    let read = DeflateDecoder::new(data).take(budget).read_to_end(&mut out);
    match (read, out.len() == expected) {
        (Err(_), _) => Err(RpfError::format(UNSUPPORTED_COMPRESSION)),
        (Ok(_), true) => Ok(out),
        (Ok(_), false) => Err(RpfError::format(SIZE_MISMATCH)),
    }
}

// ---------- открытие и доступ ----------

impl Archive {
    pub fn open(source: Shared, name: &str, keys: Keys) -> Result<Self> {
        let toc = read_toc(&*source, name, keys.as_deref())?;
        let mut entries = Vec::from_iter(toc.entries.iter().map(|raw| blank_entry(&toc, raw)));
        reveal_hidden_sizes(&*source, &mut entries)?;

        let (root, found) = Linker::new(&toc.entries, name).resolve()?;
        for (entry, children) in entries.iter_mut().zip(found) {
            if let Some(kids) = children {
                entry.kind = EntryKind::Directory {
                    dirs: kids.dirs,
                    files: kids.files,
                };
            }
        }

        Ok(Archive {
            encryption: toc.encryption,
            name: name.to_owned(),
            entries,
            source,
            keys,
            root,
            shared: Mutex::new(HashMap::new()),
        })
    }

    pub fn open_path(path: &Path, keys: Keys) -> Result<Self> {
        if !path.is_file() {
            return Err(RpfError::not_found(format!(
                "File was not found: {}",
                path.display()
            )));
        }
        let name = path
            .file_name()
            .map_or_else(String::new, |last| last.to_string_lossy().into_owned());
        let source = FileSource::open(path).map_err(RpfError::from)?;
        Self::open(Arc::new(source), &name, keys)
    }

    // Окно внутри источника: байты вложенного двоичного файла.
    fn window_of(&self, id: EntryId) -> Result<SliceSource> {
        let entry = &self.entries[id];
        match &entry.kind {
            EntryKind::Binary(info) => {
                let whole = Arc::clone(&self.source);
                Ok(SliceSource::new(whole, info.offset(), info.stored_len())?)
            }
            _ => Err(RpfError::argument(format!(
                "{} is not a binary file.",
                entry.name
            ))),
        }
    }

    pub fn open_nested(&self, id: EntryId) -> Result<Archive> {
        let window = self.window_of(id)?;
        Archive::open(Arc::new(window), &self.entries[id].name, self.keys.clone())
    }

    // Тот же вложенный архив, но оглавление разбирается один раз за жизнь
    // внешнего архива: повторный вызов отдаёт уже разобранный. Отказ не
    // запоминается (следующий вызов разбирает заново).
    pub fn open_nested_shared(&self, id: EntryId) -> Result<Arc<Archive>> {
        let remembered = |cache: &Mutex<HashMap<EntryId, Arc<Archive>>>| {
            let held = cache.lock().unwrap_or_else(PoisonError::into_inner);
            held.get(&id).map(Arc::clone)
        };
        if let Some(known) = remembered(&self.shared) {
            return Ok(known);
        }
        // Разбор идёт без замка: вложенный архив сам берёт замок своих вложенных.
        let fresh = Arc::new(self.open_nested(id)?);
        let mut held = self.shared.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(Arc::clone(held.entry(id).or_insert(fresh)))
    }

    pub fn is_nested_archive_name(name: &str) -> bool {
        name.as_bytes()
            .rchunks(4)
            .next()
            .is_some_and(|tail| tail.eq_ignore_ascii_case(b".rpf"))
    }

    pub fn listing_size(&self, id: EntryId) -> u64 {
        match &self.entries[id].kind {
            EntryKind::Binary(info) => info.stored_len(),
            EntryKind::Resource(info) => u64::from(info.stored_size),
            _ => 0,
        }
    }

    plain_reads! {
        self;
        name(&str) = &self.name;
        encryption(Encryption) = self.encryption;
        source(&Shared) = &self.source;
        keys(Option<&Arc<KeySet>>) = self.keys.as_ref();
        root(EntryId) = self.root;
        len(usize) = self.entries.len();
        is_empty(bool) = self.entries.is_empty();
        entries(&[Entry]) = &self.entries;
    }

    pub fn entry(&self, id: EntryId) -> &Entry {
        &self.entries[id]
    }

    // Списки детей каталога; у обычной записи оба пусты.
    fn kids(&self, directory: EntryId) -> (Listed<'_>, Listed<'_>) {
        match &self.entries[directory].kind {
            EntryKind::Directory { dirs, files } => (dirs, files),
            _ => (&[], &[]),
        }
    }

    pub fn dirs(&self, directory: EntryId) -> Listed<'_> {
        self.kids(directory).0
    }

    pub fn files(&self, directory: EntryId) -> Listed<'_> {
        self.kids(directory).1
    }

    fn named_in(&self, ids: &[EntryId], name: &str) -> Option<EntryId> {
        let at = ids
            .iter()
            .position(|&id| self.entries[id].name.eq_ignore_ascii_case(name))?;
        Some(ids[at])
    }

    pub fn find_dir(&self, directory: EntryId, name: &str) -> Option<EntryId> {
        self.named_in(self.dirs(directory), name)
    }

    pub fn find_file(&self, directory: EntryId, name: &str) -> Option<EntryId> {
        self.named_in(self.files(directory), name)
    }
}
