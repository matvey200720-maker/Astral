//! Пути из командной строки и из JSON-запросов: полный вид, проверка входного
//! и выходного файла, безопасный относительный путь внутри архива или корня.
//!
//! Разбор имени на префикс, корень и звенья делает стандартная библиотека,
//! поэтому на Windows и на Unix результаты разные. Диск здесь не читают, кроме
//! проверки `is_file` и создания каталога для выходного файла.

use crate::error::{EngineError, Result};
use std::{
    borrow::Cow,
    env, fs,
    path::{Component, Path, PathBuf},
};

/// Звенья, которых не должно быть в относительном пути записи.
const FORBIDDEN_SEGMENTS: [&str; 3] = ["", ".", ".."];

fn is_blank(path: &str) -> bool {
    path.chars().all(char::is_whitespace)
}

/// Латинская буква и сразу двоеточие.
fn starts_with_drive(path: &str) -> bool {
    let mut head = path.bytes();
    matches!((head.next(), head.next()), (Some(letter), Some(b':')) if letter.is_ascii_alphabetic())
}

fn has_forbidden_segment(path: &str) -> bool {
    for segment in path.split('/') {
        if FORBIDDEN_SEGMENTS.contains(&segment) {
            return true;
        }
    }
    false
}

/// Условия, при которых относительный путь (уже с прямыми слэшами и без
/// начальных слэшей) небезопасен.
const UNSAFE_WHEN: [fn(&str) -> bool; 3] = [is_blank, starts_with_drive, has_forbidden_segment];

/// Лексическая свёртка: `.` пропускается, `..` убирает предыдущее звено, но
/// не выше корня или префикса. Звено вида «буква и двоеточие» разбирается как
/// диск без корня и заменяет всё накопленное.
fn collapse(path: &Path) -> PathBuf {
    let mut acc = PathBuf::new();
    for part in path.components() {
        if part == Component::CurDir {
            continue;
        }
        if part == Component::ParentDir {
            acc.pop();
        } else {
            acc.push(part);
        }
    }
    acc
}

/// Расширение последнего звена с точкой (`.rpf`) или пустая строка. Имя, которое
/// только начинается с точки, расширения не имеет; `a.` даёт `.`.
pub fn extension_with_dot(path: &Path) -> String {
    let mut text = String::new();
    if let Some(extension) = path.extension() {
        text.push('.');
        text.push_str(&extension.to_string_lossy());
    }
    text
}

/// Расширение пути обязано быть в списке (без учёта регистра, с точкой);
/// `label` встаёт в текст отказа: `Unsupported <label> extension: <расширение>`.
fn require_extension(path: &Path, allowed: &[&str], label: &str) -> Result<()> {
    let extension = extension_with_dot(path);
    let listed = allowed
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(&extension));
    listed
        .then_some(())
        .ok_or_else(|| EngineError::argument(format!("Unsupported {label} extension: {extension}")))
}

/// Полный путь без обращения к диску: `.` и `..` сворачиваются по тексту,
/// ссылки не раскрываются.
pub fn full_path(value: &str) -> Result<PathBuf> {
    if is_blank(value) {
        return Err(EngineError::argument("The path is empty."));
    }
    let given = Path::new(value);
    let anchored: Cow<'_, Path> = if given.is_absolute() {
        Cow::Borrowed(given)
    } else {
        Cow::Owned(env::current_dir()?.join(given))
    };
    Ok(collapse(&anchored))
}

/// Относительный путь записи с прямыми слэшами, без начального слэша.
/// Отказ: пусто, «диск» в начале (`C:`), пустое звено, `.` или `..`.
pub fn normalize_relative(value: &str) -> Result<String> {
    let forward = value.replace('\\', "/");
    let body = forward.trim_start_matches('/');
    match UNSAFE_WHEN.iter().any(|rule| rule(body)) {
        true => Err(EngineError::invalid_data(format!(
            "Unsafe relative path: {value}"
        ))),
        false => Ok(body.to_owned()),
    }
}

/// Корень плюс относительный путь; итог обязан лежать под корнем.
pub fn inside(root: &str, relative: &str) -> Result<PathBuf> {
    full_path(root).and_then(|base| {
        let target = collapse(&base.join(normalize_relative(relative)?));
        if target.starts_with(&base) {
            Ok(target)
        } else {
            Err(EngineError::invalid_data(format!(
                "Path escapes its allowed directory: {relative}"
            )))
        }
    })
}

/// Выходной файл: расширение обязано быть в списке (пустой список не
/// подходит никому), каталог для файла создаётся. Сам файл не трогается.
pub fn output_file(value: &str, extensions: &[&str]) -> Result<PathBuf> {
    full_path(value).and_then(|path| {
        require_extension(&path, extensions, "output")?;
        path.parent().map(fs::create_dir_all).transpose()?;
        Ok(path)
    })
}

/// Существующий файл (каталог не годится). Пустой список расширений значит
/// «любое»; расширение берётся у полного пути, а не у файла на диске.
pub fn existing_file(value: &str, extensions: &[&str]) -> Result<PathBuf> {
    full_path(value).and_then(|path| match (path.is_file(), extensions.is_empty()) {
        (false, _) => Err(EngineError::file_not_found(format!(
            "File was not found: {}",
            path.display()
        ))),
        (true, true) => Ok(path),
        (true, false) => require_extension(&path, extensions, "file").map(|()| path),
    })
}
