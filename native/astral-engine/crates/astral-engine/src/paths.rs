//! Пути из командной строки и из JSON-запросов: полный вид, проверка входного
//! и выходного файла, безопасный относительный путь внутри архива или корня.
//!
//! Относительных проверок две. `normalize_relative` — путь на диске и путь
//! записи, из которого строят имя файла: к общим отказам добавлены имена,
//! которые Windows понимает иначе, чем написано. `normalize_inner` — путь, по
//! которому только ищут узел в дереве архива в памяти: только общие отказы.
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

/// Знак, которого в имени файла Windows быть не может, или знак, который
/// Windows понимает иначе, чем написано: `:` (поток NTFS), управляющие знаки, `<>"|?*`, обратная косая и знаки
/// направления текста (U+061C, U+200E и U+200F, U+202A–U+202E, U+2066–U+2069).
fn is_unsafe_char(symbol: char) -> bool {
    let code = u32::from(symbol);
    code < 0x20
        || code == 0x7f
        || matches!(symbol, ':' | '<' | '>' | '"' | '|' | '?' | '*' | '\\')
        || matches!(code, 0x061c | 0x200e | 0x200f | 0x202a..=0x202e | 0x2066..=0x2069)
}

/// Цифра после COM и LPT: 0–9 и «верхние» ¹ ² ³ (U+00B9, U+00B2, U+00B3).
fn is_device_digit(symbol: char) -> bool {
    symbol.is_ascii_digit() || matches!(u32::from(symbol), 0xb9 | 0xb2 | 0xb3)
}

/// Имя устройства Windows: CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0–COM9,
/// LPT0–LPT9. Регистр не важен, расширение и пробелы перед ним не помогают.
fn is_device_name(segment: &str) -> bool {
    let head = segment
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(' ');
    let lower: Vec<char> = head.to_lowercase().chars().collect();
    let word: String = lower.iter().collect();
    if matches!(
        word.as_str(),
        "con" | "prn" | "aux" | "nul" | "conin$" | "conout$"
    ) {
        return true;
    }
    match lower.as_slice() {
        ['c', 'o', 'm', digit] | ['l', 'p', 't', digit] => is_device_digit(*digit),
        _ => false,
    }
}

/// Звено, которое Windows понимает иначе, чем написано: поток NTFS, хвостовая
/// точка или пробел, имя устройства, знаки направления текста. То же правило,
/// что в `packages/mod-targets/file-names.js`: звено с кириллицей, скобками,
/// `&`, апострофом, `#`, `[`, `]` и запятыми — настоящее имя мода и проходит.
/// Тильда законна: короткие имена 8.3 (`ABCDEF~1.XML`) правилом не закрыты.
fn has_unsafe_name(path: &str) -> bool {
    path.split('/').any(|segment| {
        segment.chars().any(is_unsafe_char)
            || segment.ends_with(['.', ' '])
            || is_device_name(segment)
    })
}

/// Условия, при которых относительный путь (уже с прямыми слэшами и без
/// начальных слэшей) небезопасен где угодно: и на диске, и внутри архива.
const UNSAFE_ANYWHERE: [fn(&str) -> bool; 3] = [is_blank, starts_with_drive, has_forbidden_segment];

/// Где будет жить путь. Имя на диске читает Windows и понимает по-своему
/// (поток NTFS, хвостовая точка, устройство); имя узла в дереве архива RPF
/// читают движок и игра — как написано.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Place {
    Disk,
    Archive,
}

/// Общая часть обеих проверок: прямые слэши, начальные слэши срезаны, отказ
/// называет путь так, как он был задан.
fn relative(value: &str, place: Place) -> Result<String> {
    let forward = value.replace('\\', "/");
    let body = forward.trim_start_matches('/');
    let refused = UNSAFE_ANYWHERE.iter().any(|rule| rule(body))
        || (place == Place::Disk && has_unsafe_name(body));
    if refused {
        Err(EngineError::invalid_data(format!(
            "Unsafe relative path: {value}"
        )))
    } else {
        Ok(body.to_owned())
    }
}

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

/// Относительный путь НА ДИСКЕ (архив в папке игры, файл нагрузки в папке
/// заплатки, копия в точке возврата) с прямыми слэшами, без начального слэша.
/// Отказ: пусто, «диск» в начале (`C:`), пустое звено, `.` или `..`, а также
/// звено, которое Windows понимает иначе, чем написано (`has_unsafe_name`).
pub fn normalize_relative(value: &str) -> Result<String> {
    relative(value, Place::Disk)
}

/// Путь ВНУТРИ дерева архива RPF (то, что осталось после `update:`), с прямыми
/// слэшами, без начального слэша. Отказ: пусто, «диск» в начале, пустое звено,
/// `.` или `..`. Правила имён Windows здесь нет: годится только там, где по
/// звеньям ИЩУТ узел дерева архива в памяти и ничего не кладут (цель удаления
/// в `archives/apply.rs`). Имя записи, которую кладут в архив, читают в файл
/// или выкладывают в папку, потом становится именем файла на диске — для него
/// нужна строгая проверка: `normalize_relative`, `inside`.
pub fn normalize_inner(value: &str) -> Result<String> {
    relative(value, Place::Archive)
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

#[cfg(test)]
mod tests {
    //! Имена звеньев пути (разбор безопасности 23.11.2026, находка H3-03): те же
    //! примеры, что в `launcher_app/tests/install-path-names.test.js`. Особые
    //! знаки собираются из кодов, а не пишутся в тексте.
    use super::*;

    fn refused(value: &str) -> bool {
        normalize_relative(value).is_err()
    }

    fn with_code(before: &str, code: u32, after: &str) -> String {
        let symbol = char::from_u32(code).expect("код знака");
        format!("{before}{symbol}{after}")
    }

    #[test]
    fn stream_names_are_refused() {
        for value in [
            "dinput8.dll::$DATA",
            "mods/x.dll::$DATA",
            "mods/x.exe::$DATA",
            "mods/x.dll:payload",
            "mods/x.txt:stream",
            "scripts/x.asi::$DATA",
            "mods/a:b.txt",
            "mods/ab:cd/x.txt",
            "update:/x64/a.rpf",
        ] {
            assert!(refused(value), "должен быть отказ: {value}");
        }
    }

    #[test]
    fn trailing_dot_and_space_are_refused() {
        for value in [
            "mods/x.exe.",
            "mods/x.dll.",
            "mods/dir./x.txt",
            "mods/dir /x.txt",
            "mods/x.txt.",
            "mods/x.exe...",
            "mods/x.txt ",
        ] {
            assert!(refused(value), "должен быть отказ: {value}");
        }
    }

    #[test]
    fn device_names_are_refused_in_any_case_and_with_any_extension() {
        for value in [
            "mods/CON",
            "mods/con",
            "mods/Con.txt",
            "mods/PRN.dds",
            "mods/aux",
            "mods/AUX.ytd",
            "mods/NUL",
            "mods/nul.txt",
            "mods/nul.tar.gz",
            "mods/COM1",
            "mods/com1.txt",
            "mods/COM9.ytd",
            "mods/LPT1",
            "mods/lpt9.txt",
            "mods/CON /x.txt",
            "mods/nul /x",
            "mods/CON/x.txt",
            "mods/CONIN$",
            "mods/conout$.txt",
        ] {
            assert!(refused(value), "должен быть отказ: {value}");
        }
        assert!(refused(&with_code("mods/com", 0xb9, ".txt")));
        assert!(refused(&with_code("mods/LPT", 0xb2, "")));
    }

    #[test]
    fn control_and_reserved_characters_are_refused() {
        for value in [
            "mods/a<b.txt",
            "mods/a>b.txt",
            "mods/a\"b.txt",
            "mods/a|b.txt",
            "mods/a?b.txt",
            "mods/a*b.txt",
        ] {
            assert!(refused(value), "должен быть отказ: {value}");
        }
        for code in [0x01, 0x1f, 0x7f] {
            assert!(
                refused(&with_code("mods/a", code, "b.txt")),
                "код {code:#x}"
            );
        }
    }

    #[test]
    fn text_direction_controls_are_refused() {
        for code in [
            0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068,
            0x2069,
        ] {
            assert!(
                refused(&with_code("mods/x", code, "exe.txt")),
                "код {code:#x}"
            );
            assert!(refused(&with_code("mods/", code, "x.txt")), "код {code:#x}");
        }
    }

    #[test]
    fn real_mod_names_pass_unchanged() {
        for value in [
            "mods/update/update.rpf",
            "x64/levels/gta5/astral_mp.rpf",
            "mods/x64/audio/sfx/RESIDENT.rpf/weapons.awc",
            "common/data/effects/ptxclipregions.dat",
            "mods/Моды/Сборка 1/файл (копия).ytd",
            "mods/a&b/it's.xml",
            "mods/Tom & Jerry's/pack #1 [new] (v2)/a,b.meta",
            "mods/ä ö ü/ß.txt",
            "mods/ok-1_2+3/w_ar_assaultrifle+hidr.ydr",
            "mods/hi@shelter.ybn",
            "mods/_manifest.ymf",
            "mods/~backup/x.txt",
            "mods/PROGRA~1/readme.txt",
            "mods/.gitkeep",
            "mods/a.b.c.ydr",
            "mods/ leading space/x.txt",
            "mods/my file.ytd",
            "Grand Theft Auto V/update/x64/dlcpacks/my pack/dlc.rpf",
            "mods/a . b/x.txt",
            "mods/con_sole.txt",
            "mods/Console/x.ydr",
            "mods/nulls.txt",
            "mods/auxiliary/x.xml",
            "mods/com10.txt",
            "mods/comp1.txt",
            "mods/lpt.txt",
            "mods/prn1.txt",
            "mods/accon.txt",
        ] {
            assert_eq!(
                normalize_relative(value).as_deref().ok(),
                Some(value),
                "должно пройти: {value}"
            );
        }
    }

    #[test]
    fn earlier_refusals_stay() {
        for value in [
            "../a", "a/../b", "C:/x", "C:x", "", "   ", "a//b", "a/./b", "mods/",
        ] {
            assert!(refused(value), "должен быть отказ: {value:?}");
        }
        assert_eq!(
            normalize_relative("\\mods\\update\\a.dat").unwrap(),
            "mods/update/a.dat"
        );
    }

    /// Узел в дереве архива — не имя файла Windows: для него остаются только
    /// общие отказы.
    #[test]
    fn a_node_in_the_archive_tree_is_not_a_windows_name() {
        for value in [
            "common/data:old.xml",
            "x64/a.ytd::$DATA",
            "common/data./a.xml",
            "common/data /a.xml",
            "common/a.xml.",
            "common/nul",
            "common/COM1.xml",
            "common/a?b*c.xml",
            "a/ /b",
            "1:/x",
        ] {
            assert_eq!(
                normalize_inner(value).as_deref().ok(),
                Some(value),
                "должно пройти: {value}"
            );
            assert!(refused(value), "на диске должен быть отказ: {value}");
        }
        assert_eq!(
            normalize_inner("\\common\\data\\a.xml").unwrap(),
            "common/data/a.xml"
        );
        for value in [
            "../a", "a/../b", "C:/x", "C:x", "", "   ", "a//b", "a/./b", "common/",
        ] {
            let error = normalize_inner(value).expect_err(value);
            assert_eq!(error.code, "InvalidDataException");
            assert_eq!(error.message, format!("Unsafe relative path: {value}"));
        }
    }

    /// Что проходит строгую проверку, проходит и мягкую, с тем же итогом.
    #[test]
    fn the_disk_rule_only_adds_refusals_to_the_entry_rule() {
        for value in [
            "update/update.rpf",
            "/update/x",
            "mods/my file.ytd",
            "mods/Моды/файл (копия).ytd",
            "a\\b/c",
        ] {
            assert_eq!(normalize_relative(value), normalize_inner(value), "{value}");
            assert!(normalize_relative(value).is_ok(), "{value}");
        }
    }

    #[test]
    fn inside_refuses_unsafe_names_before_touching_the_disk() {
        let root = env::temp_dir();
        let root = root.to_string_lossy();
        for relative in ["mods/x.dll::$DATA", "mods/CON", "mods/x.exe.", "mods/a:b"] {
            assert!(
                inside(&root, relative).is_err(),
                "должен быть отказ: {relative}"
            );
        }
        let inside_root = inside(&root, "mods/Моды/файл (копия).ytd").unwrap();
        assert!(inside_root.starts_with(Path::new(&*root)));
    }
}
