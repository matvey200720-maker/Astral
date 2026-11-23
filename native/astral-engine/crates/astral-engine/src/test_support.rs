//! Пути к образцам для тестов: репозиторный корень можно подменить окружением.
//!
//! Тест-бинарь, собранный на одной машине и запущенный на другой, читает
//! то, что лежит рядом с ним, а не путь сборки.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

/// Один замок на все тесты, которые меняют переменные окружения процесса
/// (`MODOVIK_GTA_KEYS_PATH`, `ASTRAL_ENGINE_RESTORE_ROOT`, `LOCALAPPDATA` и
/// другие): окружение общее, и два замка на одни и те же переменные дают гонку,
/// при которой один тест видит значения другого. Держать до конца теста.
pub fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

/// Сколько ждать, пока удалённая папка исчезнет совсем.
const GONE_WITHIN: Duration = Duration::from_secs(10);

/// Удаляет папку целиком и ждёт, пока её нет совсем. На Windows удаление
/// бывает отложенным (папку ещё держит чей-то открытый дескриптор, например
/// антивирус): пока оно не завершилось, запись внутрь папки отказывает
/// «в доступе», а не «путь не найден», и тест, ждущий второго, мигает.
pub fn remove_dir_and_wait(path: &Path) {
    fs::remove_dir_all(path).unwrap();
    let deadline = Instant::now() + GONE_WITHIN;
    loop {
        match fs::symlink_metadata(path) {
            Err(error) if error.kind() == ErrorKind::NotFound => return,
            _ if Instant::now() >= deadline => {
                panic!("папка {} не исчезла за {:?}", path.display(), GONE_WITHIN)
            }
            _ => thread::sleep(Duration::from_millis(5)),
        }
    }
}

/// Куда подняться от каталога пакета до `launcher_app` и до `native/astral-engine`.
const TO_LAUNCHER: &str = "../../../..";
const TO_ENGINE: &str = "../..";

/// Один из двух корней: переменная окружения (значение берётся как есть,
/// пустое тоже) либо каталог пакета при сборке плюс подъём.
struct Anchor {
    var: &'static str,
    climb: &'static str,
}

const LAUNCHER: Anchor = Anchor {
    var: "ASTRAL_TEST_LAUNCHER",
    climb: TO_LAUNCHER,
};

const ENGINE: Anchor = Anchor {
    var: "ASTRAL_TEST_ENGINE",
    climb: TO_ENGINE,
};

impl Anchor {
    fn root(&self, lookup: &dyn Fn(&str) -> Option<OsString>) -> PathBuf {
        match lookup(self.var) {
            Some(custom) => PathBuf::from(custom),
            None => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(self.climb),
        }
    }

    fn resolve(&self, relative: &str, lookup: &dyn Fn(&str) -> Option<OsString>) -> PathBuf {
        self.root(lookup).join(relative)
    }
}

/// Путь под папкой `launcher_app`.
pub fn launcher(relative: &str) -> PathBuf {
    LAUNCHER.resolve(relative, &|name| env::var_os(name))
}

/// Путь под папкой `native/astral-engine`.
pub fn engine(relative: &str) -> PathBuf {
    ENGINE.resolve(relative, &|name| env::var_os(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::Path;

    fn lookup_in<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        let table: HashMap<&str, &str> = vars.iter().copied().collect();
        move |name: &str| table.get(name).map(OsString::from)
    }

    fn package_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn default_roots_keep_the_parent_links() {
        // Тп1 – Тп3, Тп7
        let none = lookup_in(&[]);
        let beer = LAUNCHER.resolve(
            "resources/optimization/shelf-goods/prop_bar_beerfridge_01.ydr",
            &none,
        );
        let expected = package_dir()
            .join("../../../..")
            .join("resources/optimization/shelf-goods/prop_bar_beerfridge_01.ydr");
        assert_eq!(beer, expected);
        assert!(beer.to_string_lossy().contains("../../../.."));
        let parity = ENGINE.resolve("parity/host-port/ytd/edit", &none);
        assert_eq!(
            parity,
            package_dir()
                .join("../..")
                .join("parity/host-port/ytd/edit")
        );
        let bare = LAUNCHER.resolve("", &none);
        assert_eq!(bare, package_dir().join("../../../..").join(""));
        assert!(bare.to_string_lossy().ends_with(std::path::MAIN_SEPARATOR));
        let only_launcher = lookup_in(&[("ASTRAL_TEST_LAUNCHER", "elsewhere")]);
        assert_eq!(
            ENGINE.resolve("parity", &only_launcher),
            package_dir().join("../..").join("parity")
        );
    }

    #[test]
    fn variables_replace_the_root_as_they_are() {
        // Тп4 – Тп6, Тп8, Тп10
        let custom = lookup_in(&[("ASTRAL_TEST_LAUNCHER", "mac-build/launcher_app")]);
        assert_eq!(
            LAUNCHER.resolve("resources", &custom),
            Path::new("mac-build/launcher_app").join("resources")
        );
        let empty = lookup_in(&[("ASTRAL_TEST_LAUNCHER", "")]);
        assert_eq!(
            LAUNCHER.resolve("resources", &empty),
            PathBuf::from("resources")
        );
        let spaces = lookup_in(&[("ASTRAL_TEST_LAUNCHER", "   ")]);
        assert_eq!(
            LAUNCHER.resolve("resources", &spaces),
            Path::new("   ").join("resources")
        );
        let engine_root = lookup_in(&[("ASTRAL_TEST_ENGINE", "eng")]);
        assert_eq!(
            ENGINE.resolve("parity", &engine_root),
            Path::new("eng").join("parity")
        );
        let slashed = lookup_in(&[("ASTRAL_TEST_LAUNCHER", "mac-build/launcher_app/")]);
        let joined = LAUNCHER.resolve("resources", &slashed);
        assert_eq!(
            joined,
            Path::new("mac-build/launcher_app/").join("resources")
        );
        assert!(!joined.to_string_lossy().contains("//"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_forms_of_the_documented_examples() {
        let custom = lookup_in(&[("ASTRAL_TEST_LAUNCHER", r"D:\mac-build\launcher_app")]);
        assert_eq!(
            LAUNCHER.resolve("resources", &custom).to_str().unwrap(),
            r"D:\mac-build\launcher_app\resources"
        );
        let spaces = lookup_in(&[("ASTRAL_TEST_LAUNCHER", "   ")]);
        assert_eq!(
            LAUNCHER.resolve("resources", &spaces).to_str().unwrap(),
            "   \\resources"
        );
        let slashed = lookup_in(&[("ASTRAL_TEST_LAUNCHER", r"D:\mac-build\launcher_app\")]);
        assert_eq!(
            LAUNCHER.resolve("resources", &slashed).to_str().unwrap(),
            r"D:\mac-build\launcher_app\resources"
        );
        let rooted = lookup_in(&[("ASTRAL_TEST_ENGINE", r"E:\eng")]);
        assert_eq!(
            ENGINE.resolve(r"C:\abs\x", &rooted).to_str().unwrap(),
            r"C:\abs\x"
        );
        assert_eq!(
            ENGINE.resolve("parity", &rooted).to_str().unwrap(),
            r"E:\eng\parity"
        );
    }

    #[test]
    fn public_functions_follow_the_process_environment() {
        // Окружение процесса не меняем: сверяем с теми же правилами.
        let live = |name: &str| env::var_os(name);
        assert_eq!(launcher("resources"), LAUNCHER.resolve("resources", &live));
        assert_eq!(engine("parity"), ENGINE.resolve("parity", &live));
    }
}
