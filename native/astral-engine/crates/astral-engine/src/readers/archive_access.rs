//! Доступ читателей к архивам игры: открыть архив, получить опись файлов со
//! вложенными `.rpf`, прочитать запись по пути «каталог/каталог/файл» и узнать,
//! есть ли она. Вложенный архив `.rpf` в пути раскрывается как папка.

use crate::error::{EngineError, Result};
use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind, KeySet};
use std::{path::Path, sync::Arc};

/// Самая крупная двоичная запись, которую читатели берут целиком (256 МиБ).
pub const READ_LIMIT: u64 = 256 * 1024 * 1024;

/// Открывает архив по пути; ключи берутся на хранение у самого архива.
pub fn open(path: &Path, keys: &Arc<KeySet>) -> Result<Archive> {
    Archive::open_path(path, Some(keys.clone())).map_err(EngineError::from)
}

// ---------- опись ----------

/// Список файлов вложенного архива, если запись — открывающийся `.rpf`; иначе пусто.
fn nested_listing(archive: &Archive, id: EntryId, path: &str) -> Vec<String> {
    let entry = archive.entry(id);
    let is_pack = Archive::is_nested_archive_name(&entry.name);
    let is_binary = matches!(entry.kind, EntryKind::Binary(_));
    if !(is_pack && is_binary) {
        return Vec::new();
    }
    // Не открылся — это просто файл без детей.
    archive
        .open_nested(id)
        .ok()
        .map(|inner| walk(&inner, inner.root(), &format!("{path}/")))
        .unwrap_or_default()
}

/// Обход каталога: файлы по порядку (после архива сразу его содержимое), затем подкаталоги.
fn walk(archive: &Archive, dir: EntryId, prefix: &str) -> Vec<String> {
    let files = archive.files(dir).iter().flat_map(|&id| {
        let path = format!("{prefix}{}", archive.entry(id).name);
        let inside = nested_listing(archive, id, &path);
        std::iter::once(path.to_lowercase()).chain(inside)
    });
    let folders = archive.dirs(dir).iter().flat_map(|&id| {
        let deeper = format!("{prefix}{}/", archive.entry(id).name);
        walk(archive, id, &deeper)
    });
    files.chain(folders).collect()
}

/// Пути всех файлов архива (и вложенных `.rpf`) в нижнем регистре.
pub fn list_files(archive: &Archive) -> Vec<String> {
    walk(archive, archive.root(), "")
}

// ---------- поиск записи по пути ----------

/// Архив, в котором найден файл: сам исходный либо вложенный, открытый по пути.
enum Holder<'a> {
    Outer(&'a Archive),
    Inner(Archive),
}

impl Holder<'_> {
    fn archive(&self) -> &Archive {
        match self {
            Holder::Outer(archive) => archive,
            Holder::Inner(archive) => archive,
        }
    }
}

/// Найденный файл: где лежит и под каким номером.
struct Hit<'a> {
    holder: Holder<'a>,
    id: EntryId,
}

/// Положение спуска: архив и каталог в нём.
struct Cursor<'a> {
    holder: Holder<'a>,
    dir: EntryId,
}

impl<'a> Cursor<'a> {
    fn at_root(archive: &'a Archive) -> Self {
        Cursor {
            holder: Holder::Outer(archive),
            dir: archive.root(),
        }
    }

    /// Шаг в подкаталог или во вложенный архив; `false` — тупик, `Err` — архив не открылся.
    fn descend(&mut self, name: &str) -> Result<bool> {
        let here = self.holder.archive();
        if let Some(sub) = here.find_dir(self.dir, name) {
            self.dir = sub;
            return Ok(true);
        }
        let pack = Some(name)
            .filter(|candidate| Archive::is_nested_archive_name(candidate))
            .and_then(|candidate| here.find_file(self.dir, candidate))
            .filter(|&id| matches!(here.entry(id).kind, EntryKind::Binary(_)));
        match pack {
            None => Ok(false),
            Some(id) => {
                let nested = here.open_nested(id)?;
                self.dir = nested.root();
                self.holder = Holder::Inner(nested);
                Ok(true)
            }
        }
    }

    /// Файл с таким именем в текущем каталоге.
    fn into_hit(self, name: &str) -> Option<Hit<'a>> {
        let id = self.holder.archive().find_file(self.dir, name)?;
        Some(Hit {
            holder: self.holder,
            id,
        })
    }
}

/// Спускается по частям пути. Нет такой записи — `Ok(None)`, вложенный архив
/// не открылся — ошибка открытия.
fn resolve<'a>(archive: &'a Archive, inner: &str) -> Result<Option<Hit<'a>>> {
    let mut cursor = Cursor::at_root(archive);
    // Последняя часть ждёт в запасе: она — файл, а не каталог.
    let mut pending: Option<&str> = None;
    for part in inner.split('/').filter(|part| !part.is_empty()) {
        if let Some(folder) = pending.replace(part) {
            if !cursor.descend(folder)? {
                return Ok(None);
            }
        }
    }
    Ok(pending.and_then(|name| cursor.into_hit(name)))
}

/// Объявленный размер: предел знает только двоичная запись, ресурс считается за ноль.
fn declared_size(archive: &Archive, id: EntryId) -> u64 {
    if let EntryKind::Binary(info) = &archive.entry(id).kind {
        u64::from(info.uncompressed_size)
    } else {
        0
    }
}

/// Байты записи по пути. `None` — такой записи нет.
pub fn read_entry(archive: &Archive, inner: &str) -> Result<Option<Vec<u8>>> {
    resolve(archive, inner)?
        .map(|hit| {
            let source = hit.holder.archive();
            if declared_size(source, hit.id) > READ_LIMIT {
                let text = format!("Archive entry is too large to read: {inner}");
                return Err(EngineError::invalid_data(text));
            }
            source
                .decode(hit.id, EntryCipher::ByArchive)
                .map_err(EngineError::from)
        })
        .transpose()
}

/// Есть ли запись по пути; байты не снимаются, любой сбой вложенного архива — «нет».
pub fn has_entry(archive: &Archive, inner: &str) -> bool {
    resolve(archive, inner).ok().flatten().is_some()
}

#[cfg(test)]
mod tests;
