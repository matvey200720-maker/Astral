// Текстовое описание дерева архива: по строке на запись, с отпечатком содержимого.
// Формат строк сверяют с файлами прежнего хоста, поэтому он дословный.

use std::rc::Rc;

use sha2::{Digest, Sha256};

use crate::archive::{Archive, BinaryInfo, EntryCipher, EntryId, EntryKind, ResourceInfo};
use crate::toc::Encryption;

pub fn describe(archive: &Archive) -> Vec<String> {
    Descent::new(archive, Flavor::Plain).collect()
}

pub fn describe_flags(archive: &Archive) -> Vec<String> {
    let header = format!("header={}", header_word(archive.encryption()));
    std::iter::once(header)
        .chain(Descent::new(archive, Flavor::WithFlags))
        .collect()
}

#[derive(Clone, Copy)]
enum Flavor {
    Plain,
    WithFlags,
}

fn header_word(mode: Encryption) -> &'static str {
    match mode {
        Encryption::Ng => "ng",
        Encryption::Aes => "aes",
        Encryption::None => "open",
    }
}

// Первые шесть байт SHA-256 от содержимого в том виде, в каком его получает игра:
// двенадцать строчных шестнадцатеричных цифр.
fn fingerprint(archive: &Archive, id: EntryId) -> String {
    match archive.decode(id, EntryCipher::AlwaysNg) {
        Ok(bytes) => {
            let head = Sha256::digest(&bytes)
                .iter()
                .take(6)
                .fold(0u64, |acc, &byte| (acc << 8) | u64::from(byte));
            format!("{head:012x}")
        }
        Err(_) => String::from("unreadable"),
    }
}

// Дети каталога: подкаталоги и файлы по имени в нижнем регистре; при равенстве файл
// раньше каталога, дальше порядок оглавления (сортировка устойчивая).
fn children_in_order(archive: &Archive, dir: EntryId) -> Vec<EntryId> {
    let named = |id: EntryId, is_dir: bool| (archive.entry(id).name.to_lowercase(), is_dir, id);
    let mut keyed: Vec<(String, bool, EntryId)> = archive
        .dirs(dir)
        .iter()
        .map(|&id| named(id, true))
        .chain(archive.files(dir).iter().map(|&id| named(id, false)))
        .collect();
    keyed.sort_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));
    keyed.into_iter().map(|(_, _, id)| id).collect()
}

// Чей это каталог: архив верхнего уровня или открытый по ходу обхода вложенный.
#[derive(Clone)]
enum Holder<'a> {
    Top(&'a Archive),
    Nested(Rc<Archive>),
}

impl Holder<'_> {
    fn archive(&self) -> &Archive {
        match self {
            Holder::Top(archive) => archive,
            Holder::Nested(archive) => archive,
        }
    }
}

// Сколько архивов может лежать друг в друге при описании. У игры их единицы;
// порченый архив, у которого окно вложенного содержит самого себя, иначе
// раскручивался бы без конца.
const MAX_NESTING: usize = 16;

struct Frame<'a> {
    holder: Holder<'a>,
    queue: std::vec::IntoIter<EntryId>,
    depth: usize,
    // Сколько вложенных архивов уже открыто на пути сюда (у верхнего - 0).
    nesting: usize,
}

impl<'a> Frame<'a> {
    fn over(holder: Holder<'a>, dir: EntryId, depth: usize, nesting: usize) -> Self {
        let queue = children_in_order(holder.archive(), dir).into_iter();
        Frame {
            holder,
            queue,
            depth,
            nesting,
        }
    }
}

// Обход как ленивая последовательность строк. Глубина каталогов не ограничена,
// вложенность архивов - `MAX_NESTING`: кадры лежат в векторе, а не в стеке вызовов.
struct Descent<'a> {
    frames: Vec<Frame<'a>>,
    flavor: Flavor,
}

impl<'a> Descent<'a> {
    fn new(top: &'a Archive, flavor: Flavor) -> Self {
        Descent {
            frames: vec![Frame::over(Holder::Top(top), top.root(), 0, 0)],
            flavor,
        }
    }

    fn describe_entry(
        &mut self,
        holder: &Holder<'a>,
        id: EntryId,
        depth: usize,
        nesting: usize,
    ) -> String {
        let archive = holder.archive();
        let entry = archive.entry(id);
        let pad = "  ".repeat(depth);
        let name = &entry.name;

        match &entry.kind {
            EntryKind::Directory { .. } => {
                self.frames
                    .push(Frame::over(holder.clone(), id, depth + 1, nesting));
                format!("{pad}{name}/")
            }
            EntryKind::Resource(info) => resource_line(&pad, name, info, fingerprint(archive, id)),
            EntryKind::Binary(info) => {
                // Глубже предела вложенный архив не открывается: запись описывается
                // как обычный файл.
                let inner = (nesting < MAX_NESTING && Archive::is_nested_archive_name(name))
                    .then(|| archive.open_nested(id).ok())
                    .flatten();
                match inner {
                    Some(inner) => {
                        let inner = Rc::new(inner);
                        let line = self.archive_line(&pad, name, info, &inner);
                        let root = inner.root();
                        self.frames.push(Frame::over(
                            Holder::Nested(inner),
                            root,
                            depth + 1,
                            nesting + 1,
                        ));
                        line
                    }
                    None => binary_line(&pad, name, info, fingerprint(archive, id)),
                }
            }
        }
    }

    fn archive_line(&self, pad: &str, name: &str, info: &BinaryInfo, inner: &Archive) -> String {
        let entries = inner.len();
        match self.flavor {
            Flavor::Plain => format!("{pad}{name}  archive entries={entries}"),
            Flavor::WithFlags => format!(
                "{pad}{name}  archive cmp={} enc={} header={} entries={entries}",
                u8::from(info.is_compressed()),
                u8::from(info.encrypted),
                header_word(inner.encryption())
            ),
        }
    }
}

impl Iterator for Descent<'_> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        loop {
            let frame = self.frames.last_mut()?;
            let Some(id) = frame.queue.next() else {
                self.frames.pop();
                continue;
            };
            let (holder, depth, nesting) = (frame.holder.clone(), frame.depth, frame.nesting);
            return Some(self.describe_entry(&holder, id, depth, nesting));
        }
    }
}

fn resource_line(pad: &str, name: &str, info: &ResourceInfo, sha: String) -> String {
    format!(
        "{pad}{name}  res sys={:#x} gfx={:#x} stored={} sha={sha}",
        info.system_flags, info.graphics_flags, info.stored_size
    )
}

fn binary_line(pad: &str, name: &str, info: &BinaryInfo, sha: String) -> String {
    format!(
        "{pad}{name}  bin cmp={} enc={} unc={} sha={sha}",
        u8::from(info.is_compressed()),
        u8::from(info.encrypted),
        info.uncompressed_size
    )
}
