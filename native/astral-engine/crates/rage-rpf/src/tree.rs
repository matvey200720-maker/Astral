//! Изменяемое дерево каталогов и файлов, из которого писатель строит новый RPF7.
//!
//! Модуль только хранит: байты он не читает и не кодирует. Имена ищутся без учёта
//! регистра только у ASCII, из нескольких совпадений берётся первое в векторе.

use crate::{
    archive::{Archive, EntryId, EntryKind},
    error::{Result, RpfError},
};
use std::{path::PathBuf, sync::Arc};

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

// Перечень производных свойств над описанием типа.
macro_rules! with_derives {
    ([$($derived:ident),+ $(,)?] $item:item) => {
        #[derive($($derived),+)]
        $item
    };
}

// Пары поиска по имени в каталоге: чтение и изменение для каждого из двух списков.
macro_rules! finders {
    ($($read:ident, $write:ident => $list:ident: $item:ty, $shelf:expr;)+) => {
        $(
            pub fn $read(&self, name: &str) -> Option<&$item> {
                let at = self.locate($shelf, name)?;
                self.$list.get(at)
            }

            pub fn $write(&mut self, name: &str) -> Option<&mut $item> {
                let at = self.locate($shelf, name)?;
                self.$list.get_mut(at)
            }
        )+
    };
}

with_derives! {
    [Clone, Debug]
    /// Откуда писатель возьмёт байты файла.
    pub enum Data {
        Memory(Arc<[u8]>),
        File(PathBuf),
    }
}

with_derives! {
    [Clone, Copy, Debug, PartialEq, Eq]
    /// Как поступать со сжатием двоичной записи.
    pub enum Compress {
        /// Сжать, только если вышло строго короче.
        Auto,
        /// Сжать при любом результате (в пределах 24 бит размера).
        Always,
        /// Не сжимать.
        Store,
    }
}

with_derives! {
    [Clone]
    /// Тело файла в будущем архиве.
    pub enum Body {
        /// Запись открытого архива, которую переносят как есть.
        Copy {
            archive: Arc<Archive>,
            id: EntryId,
        },
        Binary {
            data: Data,
            compress: Compress,
        },
        Resource {
            data: Data,
        },
        /// Вложенный архив, собираемый из своего дерева.
        Nested(Box<DirNode>),
    }
}

open_fields! {
    #[derive(Clone)]
    FileNode {
        name => String;
        body => Body;
    }
}

open_fields! {
    #[derive(Clone, Default)]
    DirNode {
        name => String;
        dirs => Vec<DirNode>;
        files => Vec<FileNode>;
    }
}

/// Какой из двух списков каталога имеется в виду.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shelf {
    Dirs,
    Files,
}

/// Кадр обхода архива: собираемый каталог и очередь его подкаталогов.
struct Frame {
    node: DirNode,
    pending: std::vec::IntoIter<EntryId>,
}

fn not_nested(name: &str) -> RpfError {
    RpfError::argument(format!("{name} is not a nested archive."))
}

impl Data {
    pub fn memory(bytes: Vec<u8>) -> Data {
        Data::Memory(bytes.into())
    }
}

impl Frame {
    fn open(archive: &Arc<Archive>, id: EntryId) -> Frame {
        let listed = archive.files(id);
        let mut files = Vec::with_capacity(listed.len());
        files.extend(listed.iter().map(|&f| FileNode {
            name: archive.entry(f).name.clone(),
            body: Body::Copy {
                archive: Arc::clone(archive),
                id: f,
            },
        }));
        let node = DirNode {
            name: archive.entry(id).name.clone(),
            dirs: Vec::new(),
            files,
        };
        let pending = archive.dirs(id).to_vec().into_iter();
        Frame { node, pending }
    }
}

impl DirNode {
    pub fn new(name: impl Into<String>) -> DirNode {
        DirNode {
            name: name.into(),
            dirs: Vec::new(),
            files: Vec::new(),
        }
    }

    finders! {
        find_dir, find_dir_mut => dirs: DirNode, Shelf::Dirs;
        find_file, find_file_mut => files: FileNode, Shelf::Files;
    }

    /// Убирает ровно один файл, первый с таким именем; порядок остальных прежний.
    pub fn remove_file(&mut self, name: &str) -> bool {
        match self.locate(Shelf::Files, name) {
            Some(at) => {
                self.files.remove(at);
                true
            }
            None => false,
        }
    }

    /// `Ok(true)` — тело одноимённого файла заменено, `Ok(false)` — файл добавлен.
    pub fn put_file(&mut self, name: &str, body: Body) -> Result<bool> {
        self.forbid(
            Shelf::Dirs,
            name,
            "is a directory, but a file is needed here.",
        )?;
        match self.locate(Shelf::Files, name) {
            Some(at) => {
                self.files[at].body = body;
                Ok(true)
            }
            None => {
                self.files.push(FileNode {
                    name: name.to_owned(),
                    body,
                });
                Ok(false)
            }
        }
    }

    /// Подкаталог с таким именем; нет — создаётся в конце `dirs`.
    pub fn ensure_dir(&mut self, name: &str) -> Result<&mut DirNode> {
        self.forbid(
            Shelf::Files,
            name,
            "is a file, but a directory is needed here.",
        )?;
        let at = match self.locate(Shelf::Dirs, name) {
            Some(at) => at,
            None => {
                self.dirs.push(DirNode::new(name));
                self.dirs.len() - 1
            }
        };
        Ok(&mut self.dirs[at])
    }

    /// Номер первого одноимённого в выбранном списке.
    fn locate(&self, shelf: Shelf, name: &str) -> Option<usize> {
        match shelf {
            Shelf::Dirs => self
                .dirs
                .iter()
                .position(|d| d.name.eq_ignore_ascii_case(name)),
            Shelf::Files => self
                .files
                .iter()
                .position(|f| f.name.eq_ignore_ascii_case(name)),
        }
    }

    /// Отказ `Argument`, если в выбранном списке уже есть такое имя.
    fn forbid(&self, shelf: Shelf, name: &str, why: &str) -> Result<()> {
        match self.locate(shelf, name) {
            Some(_) => Err(RpfError::argument(format!("{name} {why}"))),
            None => Ok(()),
        }
    }

    /// Дерево открытого архива: каждый файл — ссылка на исходную запись.
    /// Обход без рекурсии, на явном стеке кадров.
    pub fn from_archive(archive: &Arc<Archive>) -> DirNode {
        let mut stack = vec![Frame::open(archive, archive.root())];
        let mut finished = DirNode::default();
        loop {
            let next = stack.last_mut().and_then(|top| top.pending.next());
            if let Some(child) = next {
                stack.push(Frame::open(archive, child));
                continue;
            }
            let Some(done) = stack.pop() else { break };
            if let Some(parent) = stack.last_mut() {
                parent.node.dirs.push(done.node);
            } else {
                finished = done.node;
            }
        }
        finished
    }
}

impl FileNode {
    /// Нетронутый файл-архив разворачивается в дерево (один раз).
    fn unpack(name: &str, archive: &Arc<Archive>, id: EntryId) -> Result<DirNode> {
        let binary = matches!(archive.entry(id).kind, EntryKind::Binary(_));
        if !binary || !Archive::is_nested_archive_name(name) {
            return Err(not_nested(name));
        }
        // Оглавление, разобранное раньше (проверка основы), второй раз не читается.
        let inner = archive.open_nested_shared(id)?;
        Ok(DirNode::from_archive(&inner))
    }

    /// Дерево вложенного архива этого файла. После первого вызова тело — `Nested`,
    /// источник больше не читается, правки сохраняются.
    pub fn nested_root(&mut self) -> Result<&mut DirNode> {
        if let Body::Copy { archive, id } = &self.body {
            let tree = Self::unpack(&self.name, archive, *id)?;
            self.body = Body::Nested(Box::new(tree));
        }
        match &mut self.body {
            Body::Nested(root) => Ok(root),
            _ => Err(not_nested(&self.name)),
        }
    }
}

/// Дерево разбирается на явном стеке: порченый архив может вложить каталоги на
/// сотни тысяч уровней, и обычный рекурсивный сброс полей положил бы стек потока.
impl Drop for DirNode {
    fn drop(&mut self) {
        let mut pending = std::mem::take(&mut self.dirs);
        while let Some(mut dir) = pending.pop() {
            pending.append(&mut dir.dirs);
        }
    }
}
