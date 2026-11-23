//! Общее для команд над архивами.

pub mod append;
pub mod apply;
pub mod archivefix;
pub mod cloud;
pub mod compose;
#[cfg(test)]
mod compose_stream_tests;
pub mod composed_install;
pub mod content;
pub mod expect;
pub mod extract;
pub mod flags;
pub mod index;
pub mod install;
pub mod layers;
pub mod listing;
pub mod newdlc;
pub mod patch;
pub mod points;
pub mod probe;
pub mod recipe;
pub mod repair;
pub mod restore;
pub mod search;
pub mod settle;
pub mod space;
pub mod streamed;
pub mod summary;
pub mod tail;
pub mod textures;
pub mod transaction;
pub mod ypt;
pub mod ytd;

use sha2::{Digest, Sha256};
use std::{
    collections::hash_map::RandomState,
    env,
    fs::File,
    hash::BuildHasher,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    args::Options,
    error::{EngineError, Result},
    paths::{full_path, normalize_relative},
};
use rage_rpf::{read_pace::pace_read, KeySet};

/// Каталог установки GTA V из параметра `--game-root`.
pub fn game_root(options: &Options) -> crate::error::Result<PathBuf> {
    let requested = options.required("game-root")?;
    let root = full_path(requested)?;
    has_game_executable(&root, INSTALL_NAMES)
        .then_some(root)
        .ok_or_else(|| {
            EngineError::directory_not_found("The selected directory is not a GTA V installation.")
        })
}

/// Сколько имён списка исполняемых файлов узнаёт установленную игру: все три.
const INSTALL_NAMES: usize = 3;

/// Из них годятся для разговора о ключах только первые два.
const KEYED_NAMES: usize = 2;

/// Лежит ли в каталоге исполняемый файл установленной игры: один из первых
/// `count` имён списка.
fn has_game_executable(dir: &Path, count: usize) -> bool {
    let names = ["GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe"];
    names
        .iter()
        .take(count)
        .any(|name| Path::is_file(&dir.join(name)))
}

/// Единственная метка, с которой `load_keys` возвращает успех.
const KEYS_FROM_DIRECTORY: &str = "configured-key-directory";

/// Переменная окружения с каталогом ключей RPF (то же имя, что у прежнего хоста).
pub const KEYS_ENV: &str = "MODOVIK_GTA_KEYS_PATH";

/// Каталог ключей: параметр, затем переменная окружения; пробелы по краям
/// срезаются, пустой путь не считается. Негодное Unicode в переменной равно
/// её отсутствию.
fn configured_key_dir(parameter: Option<&str>) -> Option<String> {
    std::iter::once(parameter.map(str::to_owned))
        .chain(std::iter::once_with(|| env::var(KEYS_ENV).ok()))
        .flatten()
        .find_map(|raw| {
            let path = raw.trim();
            (!path.is_empty()).then(|| path.to_owned())
        })
}

/// Отказ, когда каталога ключей нет: с игрой рядом — «ключей не нашли», без
/// неё — «нет исполняемого файла».
fn keyless_failure(game_root: &str) -> EngineError {
    if has_game_executable(Path::new(game_root), KEYED_NAMES) {
        EngineError::invalid_operation(
            "Astral could not discover the RPF keys in this GTA V build. \
             Update the native engine or configure MODOVIK_GTA_KEYS_PATH. \
             Keys are never uploaded or committed.",
        )
    } else {
        EngineError::file_not_found("GTA V executable was not found for in-memory key discovery.")
    }
}

/// Набор ключей и метка его источника.
type LoadedKeys = (Arc<KeySet>, &'static str);

/// Набор ключей и метка источника. Каждый вызов читает диск заново.
pub fn load_keys(game_root: &str, keys: Option<&str>) -> Result<LoadedKeys> {
    match configured_key_dir(keys) {
        Some(directory) => {
            let keyset = KeySet::load_dir(&full_path(&directory)?)?;
            Ok((Arc::new(keyset), KEYS_FROM_DIRECTORY))
        }
        None => Err(keyless_failure(game_root)),
    }
}

/// Корневой архив по префиксу пути записи; `None` — архива у пути нет.
pub fn resolve_root_archive(value: &str) -> crate::error::Result<Option<String>> {
    let update_archive = || Ok(Some("update/update.rpf".to_owned()));
    let entry = unified_entry(value);
    if matches!(
        entry.to_ascii_lowercase().as_str(),
        "setup2.xml" | "assembly.xml"
    ) {
        return Ok(None);
    }
    match entry.split_once(':') {
        Some((head, rest)) if !head.is_empty() => match head.to_ascii_lowercase().as_str() {
            "common" if rest.starts_with('/') => Ok(Some("common.rpf".to_owned())),
            "update" => update_archive(),
            _ => {
                let archive = format!("{head}.rpf");
                normalize_relative(&archive).map(Some)
            }
        },
        _ => update_archive(),
    }
}

/// Что остаётся от пути записи после первого двоеточия.
pub fn strip_archive_prefix(value: &str) -> String {
    after_colon(unified_entry(value))
}

/// Часть записи после первого двоеточия; без двоеточия запись остаётся целой.
fn after_colon(entry: String) -> String {
    match entry.split_once(':') {
        Some((_, rest)) => rest.to_owned(),
        None => entry,
    }
}

/// Путь записи с прямыми чертами и без пробельных знаков по краям.
fn unified_entry(value: &str) -> String {
    String::from(value.replace('\\', "/").trim())
}

/// Строка журнала в stdout одной записью; ошибки записи не важны.
pub fn log(line: impl AsRef<str>) {
    let record = format!("{}\n", line.as_ref());
    let _ = std::io::stdout().lock().write_all(record.as_bytes());
}

/// Источник случайных блоков: зерно процесса и число уже выданных блоков.
struct BlockSource {
    seed: [u8; 32],
    issued: AtomicU64,
}

static SHARED_SOURCE: OnceLock<BlockSource> = OnceLock::new();

/// Строка случайных шестнадцатеричных цифр заданной длины.
pub fn random_hex(len: usize) -> String {
    SHARED_SOURCE.get_or_init(BlockSource::start).hex(len)
}

impl BlockSource {
    /// Новый источник: счёт блоков с нуля, зерно собрано из случайных ключей
    /// хешера стандартной библиотеки, времени, номера процесса и адреса в стеке.
    fn start() -> BlockSource {
        let keyed = (0u8..4).fold(Sha256::new(), |digest, round| {
            digest.chain_update(RandomState::new().hash_one(round).to_le_bytes())
        });
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_nanos())
            .unwrap_or_default();
        let marker = 0u8;
        let seed = keyed
            .chain_update(nanos.to_le_bytes())
            .chain_update(std::process::id().to_le_bytes())
            .chain_update((std::ptr::addr_of!(marker) as usize).to_le_bytes())
            .finalize();
        BlockSource {
            issued: AtomicU64::new(0),
            seed: seed.into(),
        }
    }

    /// Следующий блок: 64 шестнадцатеричные цифры хеша зерна и номера блока.
    fn next_block(&self) -> String {
        let digest = Sha256::new()
            .chain_update(self.seed)
            .chain_update(self.issued.fetch_add(1, Ordering::Relaxed).to_le_bytes())
            .finalize();
        hex_lower(&digest)
    }

    /// `len` цифр: блоки берутся по мере надобности, лишнее отбрасывается.
    fn hex(&self, len: usize) -> String {
        std::iter::repeat_with(|| self.next_block())
            .flat_map(String::into_bytes)
            .take(len)
            .map(char::from)
            .collect()
    }
}

pub fn hex_lower(mut bytes: &[u8]) -> String {
    let mut text: String = String::new();
    while let [byte, rest @ ..] = bytes {
        for nibble in [byte >> 4, byte & 0x0f] {
            text.push(char::from(b"0123456789abcdef"[usize::from(nibble)]));
        }
        bytes = rest;
    }
    text
}

pub fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    hex_lower(&digest)
}

pub fn hex_upper(bytes: &[u8]) -> String {
    let lower = hex_lower(bytes);
    lower.to_ascii_uppercase()
}

/// Чтение файла кусками до 4 МиБ для отпечатка: кусок идёт в хеш, потом его
/// длину получает лента потолка чтения.
struct ChunkedHash {
    source: File,
    hasher: Sha256,
    buffer: Vec<u8>,
}

impl ChunkedHash {
    fn open(path: &Path) -> std::io::Result<ChunkedHash> {
        Ok(ChunkedHash {
            source: File::open(path)?,
            hasher: Sha256::new(),
            buffer: Vec::new(),
        })
    }

    /// Берёт следующий кусок; `false`, когда файл кончился.
    fn absorb_next(&mut self) -> std::io::Result<bool> {
        self.buffer.clear();
        let got = Read::take(&mut self.source, 4 * 1024 * 1024).read_to_end(&mut self.buffer)?;
        if got > 0 {
            self.hasher.update(&self.buffer);
            pace_read(got as u64);
        }
        Ok(got > 0)
    }
}

/// SHA-256 файла: чтение кусками до 4 МиБ, после каждого куска лента
/// потолка чтения получает его длину.
pub fn sha256_file(path: &Path) -> crate::error::Result<String> {
    let mut chunks = ChunkedHash::open(path)?;
    while chunks.absorb_next()? {}
    Ok(hex_lower(&chunks.hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use std::time::Instant;
    use tempfile::{tempdir, TempDir};

    fn options(args: &[&str]) -> Options {
        let owned: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        Options::parse(&owned).unwrap()
    }

    fn failure<T>(result: Result<T>) -> (String, String) {
        match result {
            Err(error) => (error.code, error.message),
            Ok(_) => panic!("ожидался отказ"),
        }
    }

    // ----- resolve_root_archive, strip_archive_prefix -----

    #[test]
    fn root_archive_table() {
        let rows: &[(&str, Option<&str>)] = &[
            ("update:/x64/data/a.xml", Some("update/update.rpf")),
            ("UPDATE:/a", Some("update/update.rpf")),
            ("Update:\\x64\\a", Some("update/update.rpf")),
            ("update:", Some("update/update.rpf")),
            ("update:x", Some("update/update.rpf")),
            ("common:/data/a", Some("common.rpf")),
            ("COMMON:/DATA", Some("common.rpf")),
            ("common:data", Some("common.rpf")),
            ("x64a:/a/b", Some("x64a.rpf")),
            ("X64A:/a/b", Some("X64A.rpf")),
            ("x64b:", Some("x64b.rpf")),
            ("dlcpacks:/mine/dlc.rpf", Some("dlcpacks.rpf")),
            ("x64/data/a.xml", Some("update/update.rpf")),
            ("/x64/data/a.xml", Some("update/update.rpf")),
            ("", Some("update/update.rpf")),
            ("   ", Some("update/update.rpf")),
            ("  update:/x  ", Some("update/update.rpf")),
            ("  common:/x  ", Some("common.rpf")),
            ("setup2.xml", None),
            ("SETUP2.XML", None),
            (" setup2.xml ", None),
            ("assembly.xml", None),
            ("ASSEMBLY.XML", None),
            ("setup2.xml/a", Some("update/update.rpf")),
            ("dir/setup2.xml", Some("update/update.rpf")),
            (":/x", Some("update/update.rpf")),
            (":", Some("update/update.rpf")),
            ("a:b:c", Some("a.rpf")),
            ("..:/x", Some("...rpf")),
            (".:/x", Some("..rpf")),
            ("x/y:/z", Some("x/y.rpf")),
            ("x\\y:\\z", Some("x/y.rpf")),
            ("a b:/z", Some("a b.rpf")),
            ("C:/Games/GTA/update/update.rpf", Some("C.rpf")),
            ("c:\\x", Some("c.rpf")),
            ("x64a.rpf:/a", Some("x64a.rpf.rpf")),
            ("ΑΒΓ:/x", Some("ΑΒΓ.rpf")),
            ("über:/x", Some("über.rpf")),
            ("mods:/a", Some("mods.rpf")),
            ("update/update.rpf", Some("update/update.rpf")),
            ("update.rpf:/x", Some("update.rpf.rpf")),
            ("..", Some("update/update.rpf")),
            ("update:/../x", Some("update/update.rpf")),
        ];
        for (input, expected) in rows {
            let got = resolve_root_archive(input).unwrap();
            assert_eq!(got.as_deref(), *expected, "вход {input:?}");
        }
        let (code, message) = failure(resolve_root_archive("a/../b:/x"));
        assert_eq!(code, "InvalidDataException");
        assert_eq!(message, "Unsafe relative path: a/../b.rpf");
    }

    #[test]
    fn prefix_stripping_table() {
        let rows = [
            ("update:/x64/data/b.xml", "/x64/data/b.xml"),
            (" update:\\x64\\a.xml ", "/x64/a.xml"),
            ("x64/a.xml", "x64/a.xml"),
            ("x64\\a.xml", "x64/a.xml"),
            ("", ""),
            ("   ", ""),
            (":", ""),
            (":/", "/"),
            ("a:b:c", "b:c"),
            ("common:/data/a", "/data/a"),
            ("C:\\dir\\f", "/dir/f"),
            ("update:", ""),
            ("  update:/ x ", "/ x"),
            ("über:/ü", "/ü"),
            ("a/b:c/d", "c/d"),
            ("no colon here ", "no colon here"),
            ("\tupdate:/x\n", "/x"),
            ("x64a:/a\\b\\c", "/a/b/c"),
        ];
        for (input, expected) in rows {
            assert_eq!(strip_archive_prefix(input), expected, "вход {input:?}");
        }
    }

    // ----- hex, sha256 -----

    #[test]
    fn hex_tables() {
        let ramp: Vec<u8> = (0..=20).collect();
        let rows: [(&[u8], &str, &str); 6] = [
            (&[], "", ""),
            (&[0], "00", "00"),
            (&[171], "ab", "AB"),
            (&[0, 171, 255], "00abff", "00ABFF"),
            (&[15, 240], "0ff0", "0FF0"),
            (
                &ramp,
                "000102030405060708090a0b0c0d0e0f1011121314",
                "000102030405060708090A0B0C0D0E0F1011121314",
            ),
        ];
        for (bytes, lower, upper) in rows {
            assert_eq!(hex_lower(bytes), lower);
            assert_eq!(hex_upper(bytes), upper);
        }
    }

    #[test]
    fn sha256_known_digests() {
        let cases: [(&[u8], &str); 5] = [
            (
                b"",
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                b"a",
                "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
            ),
            (
                &[0u8; 64],
                "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b",
            ),
            (
                "Привет".as_bytes(),
                "dd679c0b9fd408a04148aa7d30c9df393f67b7227f65693fffe0ed6d0f0ade59",
            ),
        ];
        for (data, digest) in cases {
            assert_eq!(sha256_hex(data), digest);
        }
        let million = vec![0x61u8; 1_000_000];
        assert_eq!(
            sha256_hex(&million),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
        assert_eq!(
            sha256_hex(&million),
            format!("{:x}", Sha256::digest(&million))
        );
    }

    // ----- random_hex -----

    #[test]
    fn random_hex_shape_and_uniqueness() {
        for len in [0usize, 1, 2, 7, 8, 15, 16, 17, 31, 32, 33, 64, 100] {
            let value = random_hex(len);
            assert_eq!(value.len(), len);
            assert!(value.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        }
        let mut seen = std::collections::HashSet::new();
        for _ in 0..20_000 {
            assert!(seen.insert(random_hex(16)), "повтор");
        }
        assert_ne!(random_hex(64), random_hex(64));
        let singles: std::collections::HashSet<String> = (0..1000).map(|_| random_hex(1)).collect();
        assert_eq!(singles.len(), 16);
        let halves: Vec<String> = (0..2000).map(|_| random_hex(32)).collect();
        let firsts: std::collections::HashSet<&str> = halves.iter().map(|h| &h[..16]).collect();
        let lasts: std::collections::HashSet<&str> = halves.iter().map(|h| &h[16..]).collect();
        assert_eq!((firsts.len(), lasts.len()), (2000, 2000));
    }

    #[test]
    fn random_hex_is_unique_across_threads() {
        let workers: Vec<_> = (0..8)
            .map(|_| std::thread::spawn(|| (0..5000).map(|_| random_hex(16)).collect::<Vec<_>>()))
            .collect();
        let all: std::collections::HashSet<String> = workers
            .into_iter()
            .flat_map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(all.len(), 40_000);
    }

    // ----- game_root -----

    struct GameLab {
        dir: TempDir,
    }

    impl GameLab {
        fn new() -> Self {
            let dir = tempdir().unwrap();
            let gr = dir.path().join("gr");
            for (name, exe) in [
                ("with-gta5", Some("GTA5.exe")),
                ("with-enhanced", Some("GTA5_Enhanced.exe")),
                ("with-play", Some("PlayGTAV.exe")),
                ("lower-case-exe", Some("gta5.EXE")),
                ("empty", None),
            ] {
                fs::create_dir_all(gr.join(name)).unwrap();
                if let Some(exe) = exe {
                    fs::write(gr.join(name).join(exe), b"").unwrap();
                }
            }
            fs::create_dir_all(gr.join("exe-is-dir").join("GTA5.exe")).unwrap();
            fs::write(gr.join("plainfile.txt"), b"x").unwrap();
            GameLab { dir }
        }

        fn at(&self, tail: &str) -> String {
            self.dir.path().join("gr").join(tail).display().to_string()
        }
    }

    #[test]
    fn game_root_table() {
        let lab = GameLab::new();
        let not_install = (
            "DirectoryNotFoundException".to_owned(),
            "The selected directory is not a GTA V installation.".to_owned(),
        );
        for tail in ["with-gta5", "with-enhanced", "with-play", "lower-case-exe"] {
            let given = lab.at(tail);
            let got = game_root(&options(&["--game-root", &given])).unwrap();
            assert_eq!(got, PathBuf::from(&given));
        }
        let trailing = format!("{}\\", lab.at("with-gta5"));
        assert_eq!(
            game_root(&options(&["--game-root", &trailing])).unwrap(),
            PathBuf::from(lab.at("with-gta5"))
        );
        let dotted = format!("{}\\..\\with-enhanced", lab.at("with-gta5"));
        assert_eq!(
            game_root(&options(&["--game-root", &dotted])).unwrap(),
            PathBuf::from(lab.at("with-enhanced"))
        );
        for tail in [
            "exe-is-dir",
            "empty",
            "plainfile.txt",
            "with-gta5/GTA5.exe",
            "missing",
        ] {
            let given = lab.at(tail);
            assert_eq!(
                failure(game_root(&options(&["--game-root", &given]))),
                not_install
            );
        }
        assert_eq!(
            failure(game_root(&options(&[]))),
            (
                "ArgumentException".into(),
                "--game-root is required.".into()
            )
        );
        for blank in ["", "   "] {
            assert_eq!(
                failure(game_root(&options(&["--game-root", blank]))),
                ("ArgumentException".into(), "The path is empty.".into())
            );
        }
        let (a, b) = (lab.at("empty"), lab.at("with-gta5"));
        assert!(game_root(&options(&["--game-root", &a, "--game-root", &b])).is_ok());
        assert!(game_root(&options(&["--game-root", &b, "--game-root", &a])).is_err());
        assert!(game_root(&options(&["--GAME-ROOT", &b])).is_ok());
    }

    // ----- load_keys -----

    fn write_key_set(dir: &Path, aes_len: usize) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("gtav_aes_key.dat"), vec![7u8; aes_len]).unwrap();
        fs::write(dir.join("gtav_ng_key.dat"), vec![1u8; 101 * 68 * 4]).unwrap();
        fs::write(
            dir.join("gtav_ng_decrypt_tables.dat"),
            vec![2u8; 17 * 4096 * 4],
        )
        .unwrap();
        fs::write(dir.join("gtav_hash_lut.dat"), vec![3u8; 256]).unwrap();
    }

    struct KeyLab {
        dir: TempDir,
        keys: String,
    }

    impl KeyLab {
        fn new() -> Self {
            let dir = tempdir().unwrap();
            let keys = dir.path().join("world").join("keys");
            write_key_set(&keys, 32);
            let lk = dir.path().join("lk");
            write_key_set(&lk.join("short-aes"), 31);
            write_key_set(&lk.join("no-aes"), 32);
            fs::remove_file(lk.join("no-aes").join("gtav_aes_key.dat")).unwrap();
            write_key_set(&lk.join("no-tables"), 32);
            fs::remove_file(lk.join("no-tables").join("gtav_ng_decrypt_tables.dat")).unwrap();
            for (name, exe) in [
                ("game-exe", Some("GTA5.exe")),
                ("game-enhanced", Some("GTA5_Enhanced.exe")),
                ("game-play-only", Some("PlayGTAV.exe")),
                ("game-none", None),
            ] {
                fs::create_dir_all(lk.join(name)).unwrap();
                if let Some(exe) = exe {
                    fs::write(lk.join(name).join(exe), b"").unwrap();
                }
            }
            fs::write(lk.join("keys-is-file.dat"), b"x").unwrap();
            let keys = keys.display().to_string();
            KeyLab { dir, keys }
        }

        fn lk(&self, tail: &str) -> String {
            self.dir.path().join("lk").join(tail).display().to_string()
        }
    }

    /// Ставит или снимает переменную на время одного вызова, под общим замком.
    fn with_env<T>(value: Option<&str>, body: impl FnOnce() -> T) -> T {
        let _guard = crate::test_support::env_lock();
        let before = env::var_os(KEYS_ENV);
        match value {
            Some(text) => env::set_var(KEYS_ENV, text),
            None => env::remove_var(KEYS_ENV),
        }
        let out = body();
        match before {
            Some(text) => env::set_var(KEYS_ENV, text),
            None => env::remove_var(KEYS_ENV),
        }
        out
    }

    fn label(result: Result<(Arc<KeySet>, &'static str)>) -> &'static str {
        result.map(|(_, label)| label).unwrap()
    }

    #[test]
    fn load_keys_prefers_parameter_then_variable() {
        let lab = KeyLab::new();
        let keys = lab.keys.clone();
        let ok = "configured-key-directory";
        assert_eq!(with_env(None, || label(load_keys("", Some(&keys)))), ok);
        assert_eq!(
            with_env(Some(&keys), || label(load_keys("", Some(&keys)))),
            ok
        );
        assert_eq!(
            with_env(Some("Z:\\no\\such"), || label(load_keys("", Some(&keys)))),
            ok
        );
        for blank in ["", "   ", "\t\n"] {
            assert_eq!(
                with_env(Some(&keys), || label(load_keys("", Some(blank)))),
                ok
            );
        }
        assert_eq!(with_env(Some(&keys), || label(load_keys("", None))), ok);
        let (code, message) = with_env(Some("Z:\\no\\such"), || failure(load_keys("", Some(""))));
        assert_eq!(code, "InvalidOperationException");
        assert!(message.starts_with(
            "The GTA V RPF key file gtav_aes_key.dat could not be read from Z:\\no\\such: "
        ));
        assert!(message.ends_with("(os error 3)"));
        let dotted = format!("{}\\..\\keys", lab.keys);
        assert_eq!(with_env(None, || label(load_keys("", Some(&dotted)))), ok);
        let game_none = lab.lk("game-none");
        assert_eq!(
            with_env(None, || label(load_keys(&game_none, Some(&keys)))),
            ok
        );
    }

    #[test]
    fn load_keys_without_directory_checks_the_game_text() {
        let lab = KeyLab::new();
        let no_exe = (
            "FileNotFoundException".to_owned(),
            "GTA V executable was not found for in-memory key discovery.".to_owned(),
        );
        let undiscovered = (
            "InvalidOperationException".to_owned(),
            "Astral could not discover the RPF keys in this GTA V build. Update the native engine \
or configure MODOVIK_GTA_KEYS_PATH. Keys are never uploaded or committed."
                .to_owned(),
        );
        assert_eq!(with_env(Some(""), || failure(load_keys("", None))), no_exe);
        assert_eq!(
            with_env(Some("  "), || failure(load_keys("", None))),
            no_exe
        );
        for (game, expected) in [
            (lab.lk("game-none"), &no_exe),
            (String::new(), &no_exe),
            (lab.lk("game-exe"), &undiscovered),
            (lab.lk("game-enhanced"), &undiscovered),
            (lab.lk("game-play-only"), &no_exe),
            ("Z:\\no\\such".to_owned(), &no_exe),
        ] {
            assert_eq!(
                &with_env(None, || failure(load_keys(&game, None))),
                expected
            );
        }
    }

    #[test]
    fn load_keys_reports_broken_sets_as_they_are() {
        let lab = KeyLab::new();
        let game = lab.lk("game-exe");
        let broken = |tail: &str| lab.lk(tail);
        let (code, message) = with_env(None, || failure(load_keys(&game, Some("Z:\\no\\such"))));
        assert_eq!(code, "InvalidOperationException");
        assert!(message.ends_with("(os error 3)"));
        let (_, message) = with_env(None, || failure(load_keys(&game, Some(&broken("no-aes")))));
        assert!(message.starts_with(&format!(
            "The GTA V RPF key file gtav_aes_key.dat could not be read from {}: ",
            broken("no-aes")
        )));
        assert!(message.ends_with("(os error 2)"));
        let (_, message) = with_env(None, || {
            failure(load_keys(&game, Some(&broken("no-tables"))))
        });
        assert!(message.contains("gtav_ng_decrypt_tables.dat could not be read"));
        let (code, message) = with_env(None, || {
            failure(load_keys(&game, Some(&broken("short-aes"))))
        });
        assert_eq!(
            (code.as_str(), message.as_str()),
            (
                "InvalidOperationException",
                "The GTA V RPF key set is incomplete."
            )
        );
        let (_, message) = with_env(None, || {
            failure(load_keys(&game, Some(&broken("keys-is-file.dat"))))
        });
        assert!(message.contains("gtav_aes_key.dat could not be read from"));
    }

    #[test]
    fn load_keys_trims_the_path_of_the_parameter_and_of_the_variable() {
        let lab = KeyLab::new();
        let ok = "configured-key-directory";
        for padded in [
            format!("  {}  ", lab.keys),
            format!("\t{}\n", lab.keys),
            format!("\u{a0}{}\u{3000}", lab.keys),
        ] {
            assert_eq!(
                with_env(None, || label(load_keys("", Some(&padded)))),
                ok,
                "{padded:?}"
            );
            assert_eq!(
                with_env(Some(&padded), || label(load_keys("", None))),
                ok,
                "{padded:?}"
            );
        }
        // путь без пробелов по краям прежний, внутренние пробелы целы
        assert!(with_env(None, || load_keys("", Some(&lab.keys))).is_ok());
        let (_, message) = with_env(None, || {
            failure(load_keys("", Some("  Z:\\no such\\keys  ")))
        });
        assert!(
            message.contains("could not be read from Z:\\no such\\keys: "),
            "{message}"
        );
    }

    // ----- log -----

    #[test]
    fn log_child_process_writes_the_exact_bytes() {
        if env::var_os("ASTRAL_LOG_CHILD").is_some() {
            log("первая строка");
            log(String::from("вторая, из String"));
            log("");
            log("с\nпереводом");
            log("end");
            return;
        }
        let exe = env::current_exe().unwrap();
        let out = Command::new(exe)
            .args([
                "--exact",
                "archives::tests::log_child_process_writes_the_exact_bytes",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("ASTRAL_LOG_CHILD", "1")
            .output()
            .unwrap();
        let expected = "первая строка\nвторая, из String\n\nс\nпереводом\nend\n";
        assert_eq!(expected.len(), 79);
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains(expected), "stdout: {text:?}");
    }

    // ----- sha256_file -----

    fn temp_file(bytes: &[u8]) -> (TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.bin");
        fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn sha256_file_matches_memory_digest_and_known_values() {
        let (_keep, path) = temp_file(b"");
        assert_eq!(
            sha256_file(&path).unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        let (_keep, path) = temp_file(b"abc");
        assert_eq!(
            sha256_file(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        for len in [4_194_304usize, 4_194_305, 9_449_529] {
            let bytes = rage_rpf::fixtures::noise(len, 99);
            let (_keep, path) = temp_file(&bytes);
            assert_eq!(
                sha256_file(&path).unwrap(),
                sha256_hex(&bytes),
                "размер {len}"
            );
        }
    }

    #[test]
    fn sha256_file_refusals() {
        let dir = tempdir().unwrap();
        let missing = failure(sha256_file(&dir.path().join("nothere.bin")));
        assert_eq!(missing.0, "FileNotFoundException");
        assert!(missing.1.ends_with("(os error 2)"));
        let folder = failure(sha256_file(dir.path()));
        assert_eq!(folder.0, "UnauthorizedAccessException");
        assert!(folder.1.ends_with("(os error 5)"));
        let blank = failure(sha256_file(Path::new("")));
        assert_eq!(blank.0, "FileNotFoundException");
        assert!(blank.1.ends_with("(os error 3)"));
    }

    fn timed_hash(path: &Path, limit_mib: Option<u64>) -> f64 {
        let path = path.to_owned();
        std::thread::spawn(move || {
            rage_rpf::read_pace::set_read_limit(limit_mib.map(|mib| mib * 1024 * 1024));
            let start = Instant::now();
            sha256_file(&path).unwrap();
            start.elapsed().as_secs_f64()
        })
        .join()
        .unwrap()
    }

    #[test]
    fn sha256_file_obeys_the_read_ceiling_of_its_thread() {
        let (_keep, path) = temp_file(&rage_rpf::fixtures::noise(6 * 1024 * 1024, 5));
        // Время зависит от загрузки машины: до восьми попыток, хватает одной, где
        // свободное чтение вдвое быстрее чтения под потолком 12 МиБ/с, а потолок
        // держит не меньше 0,3 с (6 МиБ при 12 МиБ/с); верхней границы нет,
        // нагруженная машина растягивает любое чтение.
        let mut last = (0.0, 0.0);
        let held = (0..8).any(|_| {
            let free = timed_hash(&path, None);
            let paced = timed_hash(&path, Some(12));
            last = (free, paced);
            free * 2.0 < paced && paced > 0.3
        });
        assert!(held, "без потолка и при 12 МиБ/с: {last:?}");
        let (_tiny, small) = temp_file(b"abc");
        assert!(timed_hash(&small, Some(2)) < 0.5);
        let (_zero, none) = temp_file(b"");
        assert!(timed_hash(&none, Some(2)) < 0.5);
    }

    #[test]
    fn read_ceiling_needs_the_ribbon_of_the_owner() {
        let (_keep, source) = temp_file(&rage_rpf::fixtures::noise(6 * 1024 * 1024, 6));
        // Время зависит от загрузки машины: без ленты хеш не медленнее половины
        // времени с лентой (а не короче абсолютных 0,3 с), попыток до восьми.
        let attempt = || {
            let path = source.clone();
            std::thread::spawn(move || {
                rage_rpf::read_pace::set_read_limit(Some(12 * 1024 * 1024));
                let owner = rage_rpf::read_pace::current();
                let bare = {
                    let path = path.clone();
                    std::thread::spawn(move || {
                        let t = Instant::now();
                        sha256_file(&path).unwrap();
                        t.elapsed().as_secs_f64()
                    })
                    .join()
                    .unwrap()
                };
                let shared = std::thread::spawn(move || {
                    owner.install();
                    let t = Instant::now();
                    sha256_file(&path).unwrap();
                    t.elapsed().as_secs_f64()
                })
                .join()
                .unwrap();
                (bare, shared)
            })
            .join()
            .unwrap()
        };
        let mut last = (0.0, 0.0);
        let held = (0..8).any(|_| {
            last = attempt();
            last.0 * 2.0 < last.1 && last.1 > 0.3
        });
        assert!(held, "без ленты и с лентой хозяина: {last:?}");
    }
}
