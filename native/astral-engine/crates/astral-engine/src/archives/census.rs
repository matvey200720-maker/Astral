//! Счёт записей и мёртвого места архива для сборки `compose-rpf` (страховка первой подготовки игры, 23.11.2026).
//!
//! Писатель строит НОВЫЙ архив из оглавления основы: что в оглавлении есть, переезжает, а данные вне оглавления (мёртвое место
//! чужой сборки) в новый файл не попадают. Поэтому размер результата может быть заметно меньше основы и без потери записей, а
//! настоящую потерю записей видно только по счёту: файлов и каталогов в основе, в дереве после операций и в записанном файле.
//! Считаются и вложенные архивы, что открылись (так же, как их разбирает проверка результата).

use std::{
    cmp::Reverse,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use rage_rpf::{toc::BLOCK, Archive, Body, DirNode, EntryKind};

/// Сколько файлов и каталогов в архиве или в дереве (вложенные архивы — внутрь).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Census {
    pub(crate) files: u64,
    pub(crate) dirs: u64,
}

impl Census {
    /// Записей оглавления всего: файлы и каталоги.
    pub(crate) fn entries(self) -> u64 {
        self.files + self.dirs
    }

    fn add(&mut self, other: Census) {
        self.files += other.files;
        self.dirs += other.dirs;
    }
}

/// Один проход по каталогам архива от корня (как строит дерево `DirNode::from_archive`: записи, до которых не дойти от
/// корня, в дерево не попадают и не считаются); открывшиеся вложенные архивы уходят в очередь.
fn count_flat(archive: &Archive, found: &mut Census, nested: &mut Vec<Arc<Archive>>) {
    let mut stack = vec![archive.root()];
    while let Some(dir) = stack.pop() {
        found.dirs += 1;
        stack.extend_from_slice(archive.dirs(dir));
        for &id in archive.files(dir) {
            found.files += 1;
            let entry = archive.entry(id);
            let binary = matches!(entry.kind, EntryKind::Binary(_));
            if binary && Archive::is_nested_archive_name(&entry.name) {
                if let Ok(inner) = archive.open_nested_shared(id) {
                    nested.push(inner);
                }
            }
        }
    }
}

/// Счёт открытого архива, вложенные внутрь. Оглавление вложенного разбирается один раз (кэш `open_nested_shared`).
pub(crate) fn of_archive(archive: &Archive) -> Census {
    let mut found = Census::default();
    let mut pending = Vec::new();
    count_flat(archive, &mut found, &mut pending);
    while let Some(inner) = pending.pop() {
        count_flat(&inner, &mut found, &mut pending);
    }
    found
}

/// Счёт дерева перед записью. Нетронутая запись-архив (`Copy`) раскрывается так же, как у готового файла; дерево
/// вложенного архива, что правили, считается по самому дереву.
pub(crate) fn of_tree(root: &DirNode) -> Census {
    let mut found = Census::default();
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        found.dirs += 1;
        stack.extend(dir.dirs.iter());
        for file in &dir.files {
            found.files += 1;
            match &file.body {
                Body::Nested(tree) => stack.push(tree),
                Body::Copy { archive, id } => {
                    let binary = matches!(archive.entry(*id).kind, EntryKind::Binary(_));
                    if binary && Archive::is_nested_archive_name(&file.name) {
                        if let Ok(inner) = archive.open_nested_shared(*id) {
                            found.add(of_archive(&inner));
                        }
                    }
                }
                Body::Binary { .. } | Body::Resource { .. } => {}
            }
        }
    }
    found
}

/// Сколько записей-файлов исчезает вместе с телом: сама запись и, у вложенного архива, всё его содержимое (n + 1; у
/// пустого вложенного архива — 1).
fn files_of_body(file_name: &str, body: &Body) -> u64 {
    match body {
        Body::Nested(tree) => of_tree(tree).files + 1,
        Body::Copy { archive, id } => {
            let binary = matches!(archive.entry(*id).kind, EntryKind::Binary(_));
            if binary && Archive::is_nested_archive_name(file_name) {
                match archive.open_nested_shared(*id) {
                    Ok(inner) => of_archive(&inner).files + 1,
                    Err(_) => 1,
                }
            } else {
                1
            }
        }
        Body::Binary { .. } | Body::Resource { .. } => 1,
    }
}

/// Что операции запроса заведомо убрали и добавили (по счёту записей): с этим допуском сверяется убыль файлов.
#[derive(Default)]
pub(crate) struct Moves {
    removed: AtomicU64,
    added: AtomicU64,
}

impl Moves {
    /// Файл убран из каталога: вложенный архив уходит со всем содержимым.
    pub(crate) fn removed_file(&self, name: &str, body: &Body) {
        self.removed
            .fetch_add(files_of_body(name, body), Ordering::Relaxed);
    }

    /// Тело файла заменено: сам файл остаётся, а содержимое прежнего вложенного архива исчезает.
    pub(crate) fn replaced_body(&self, name: &str, old: &Body) {
        self.removed
            .fetch_add(files_of_body(name, old).saturating_sub(1), Ordering::Relaxed);
    }

    /// Пустой вложенный архив слоя Astral ушёл из родителя: сама запись-файл.
    pub(crate) fn hollow_removed(&self) {
        self.removed.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn appended(&self) {
        self.added.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn removed(&self) -> u64 {
        self.removed.load(Ordering::Relaxed)
    }

    pub(crate) fn added(&self) -> u64 {
        self.added.load(Ordering::Relaxed)
    }
}

/// Размер файла архива и какая его часть занята телами записей верхнего уровня.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Space {
    /// Размер файла.
    pub(crate) file_bytes: u64,
    /// Сумма сохранённых длин тел по оглавлению.
    pub(crate) useful_bytes: u64,
    /// Данные между телами и после последнего тела, на которые не указывает ни одна запись (с округлением тел до блока).
    pub(crate) dead_bytes: u64,
}

/// Занятость файла архива: полезные байты по оглавлению и мёртвое место. Таблица в начале файла не считается мёртвой:
/// счёт идёт от первого тела.
pub(crate) fn space_of(archive: &Archive) -> Space {
    let file_bytes = archive.source().len();
    let mut useful_bytes = 0u64;
    let mut spans: Vec<(u64, u64)> = Vec::new();
    for entry in archive.entries() {
        let (offset, len) = match &entry.kind {
            EntryKind::Binary(info) => (info.offset(), info.stored_len()),
            EntryKind::Resource(info) => (info.offset(), u64::from(info.stored_size)),
            EntryKind::Directory { .. } => continue,
        };
        useful_bytes += len;
        if len > 0 {
            spans.push((offset, len.div_ceil(BLOCK) * BLOCK));
        }
    }
    spans.sort_unstable_by_key(|&(offset, len)| (offset, Reverse(len)));
    let mut dead_bytes = 0u64;
    if let Some(&(first, _)) = spans.first() {
        let mut cursor = first;
        for (offset, len) in spans {
            dead_bytes += offset.saturating_sub(cursor);
            cursor = cursor.max(offset.saturating_add(len));
        }
        dead_bytes += file_bytes.saturating_sub(cursor);
    }
    Space {
        file_bytes,
        useful_bytes,
        dead_bytes,
    }
}

/// Итог счёта основы для ответа команды и для сверки.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BaseCount {
    pub(crate) census: Census,
    pub(crate) space: Space,
}

impl BaseCount {
    pub(crate) fn of(archive: &Archive) -> BaseCount {
        BaseCount {
            census: of_archive(archive),
            space: space_of(archive),
        }
    }
}
