//! Точки отката: где они лежат, как называются, как пишется и читается опись
//! `restore.json` и как копия архива встаёт на место живого файла.
//!
//! Модуль пишет в папку игры и в каталог точек, поэтому всё, что остаётся на
//! диске при отказе, здесь продумано: живой архив меняется только одним
//! переименованием, опись появляется целиком или не появляется.

use std::{
    env, ffi, fs,
    io::{Error as IoError, ErrorKind, Read, Result as IoResult, Write},
    path::{self, MAIN_SEPARATOR_STR},
    thread::sleep,
    time,
};

use serde_json::{self, json, Map, Value};

use crate::{
    args, clock,
    error::{self, EngineError},
    paths, response,
};

use super as archives;
use sha2::{Digest as _, Sha256};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

/// Переменная окружения, которая переносит точки в другой каталог (стенды).
pub const ROOT_ENV: &str = "ASTRAL_ENGINE_RESTORE_ROOT";
/// Параметр командной строки (без двух дефисов) с папкой точек.
pub const ROOT_OPTION: &str = "restore-points-root";

/// Получатель накопленного числа скопированных байт.
type Tick<'a> = &'a mut dyn FnMut(u64);

// ---------------------------------------------------------------------------
// Повторы, пока файл занят
// ---------------------------------------------------------------------------

/// Чем отказала система.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trouble {
    /// Файл занят другим процессом (коды Windows 32 и 33).
    Busy,
    /// Доступ закрыт (код 5).
    Denied,
}

impl Trouble {
    /// Сколько ждать этой причине и как назвать её в журнале.
    fn terms(self) -> (time::Duration, &'static str) {
        match self {
            Trouble::Busy => (time::Duration::from_secs(60), "файл занят другим процессом"),
            Trouble::Denied => (time::Duration::from_secs(10), "доступ закрыт"),
        }
    }
}

/// Коды Windows «процесс не может получить доступ к файлу»: занят и часть
/// заблокирована.
const SHARING_VIOLATION: i32 = 32;
const LOCK_VIOLATION: i32 = 33;

/// Временная ли ошибка. Коды 32 и 33 «заняты» только на Windows.
pub fn trouble(error: &IoError) -> Option<Trouble> {
    match (
        cfg!(windows).then(|| error.raw_os_error()).flatten(),
        error.kind(),
    ) {
        (Some(SHARING_VIOLATION | LOCK_VIOLATION), _) => Some(Trouble::Busy),
        (_, ErrorKind::PermissionDenied) => Some(Trouble::Denied),
        _ => None,
    }
}

/// Ядро повторов. Ожидание копится из пауз, и терпение берётся по текущей
/// причине: накопленное при смене причины не сбрасывается. Строка журнала
/// одна, при первом ожидании.
fn retry_core<T, Op, Class, Pause, Say>(
    what: &str,
    mut operation: Op,
    classify: Class,
    mut pause: Pause,
    mut announce: Say,
) -> IoResult<T>
where
    Op: FnMut() -> IoResult<T>,
    Class: Fn(&IoError) -> Option<Trouble>,
    Pause: FnMut(time::Duration),
    Say: FnMut(&str),
{
    /// Одна пауза между повторами.
    const STEP: time::Duration = time::Duration::from_millis(500);
    let mut spent = time::Duration::ZERO;
    let mut told = false;
    let mut outcome = operation();
    while let Err(failure) = &outcome {
        let (patience, reason) = match classify(failure) {
            Some(cause) if spent < cause.terms().0 => cause.terms(),
            _ => break,
        };
        if !std::mem::replace(&mut told, true) {
            let limit = patience.as_secs();
            announce(&format!("[Install] {what}: {reason}, жду до {limit} с…"));
        }
        pause(STEP);
        spent += STEP;
        outcome = operation();
    }
    outcome
}

/// Выполняет действие заново, пока отказ временный и запас ожидания не исчерпан.
/// Ожидание копится из переданных пауз (по 500 мс), а не из часов; строка
/// журнала пишется одна, по первой причине.
pub fn retry_while_busy<T>(
    what: &str,
    operation: impl FnMut() -> IoResult<T>,
    classify: impl Fn(&IoError) -> Option<Trouble>,
    pause: impl FnMut(time::Duration),
) -> IoResult<T> {
    retry_core(what, operation, classify, pause, |line: &str| {
        archives::log(line)
    })
}

/// Переименование поверх с повторами и настоящими паузами.
pub fn rename_with_retry(from: &path::Path, to: &path::Path) -> IoResult<()> {
    let what = format!(
        "подмена {}",
        path::Path::file_name(to)
            .unwrap_or_default()
            .to_string_lossy()
    );
    let attempt = || fs::rename(from, to);
    retry_while_busy(&what, attempt, trouble, sleep)
}

// ---------------------------------------------------------------------------
// Отпечаток файла и флаг «только чтение»
// ---------------------------------------------------------------------------

/// Длина файла и момент его последнего изменения.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    pub len: u64,
    pub modified: Option<time::SystemTime>,
}

/// Снимает отпечаток «размер + время»; каталог тоже годится.
pub fn stamp(path: &path::Path) -> IoResult<Stamp> {
    let (len, modified) = fs::metadata(path).map(|facts| (facts.len(), facts.modified().ok()))?;
    Ok(Stamp { modified, len })
}

/// Те же права с выставленным или снятым запретом записи владельцу.
fn with_readonly(mut permissions: fs::Permissions, readonly: bool) -> fs::Permissions {
    #[cfg(unix)]
    {
        if !readonly {
            permissions.set_mode(permissions.mode() | 0o200);
            return permissions;
        }
    }
    permissions.set_readonly(readonly);
    permissions
}

/// Снимает «только чтение»; `true`, если оно стояло. Нет файла — `false`.
pub fn clear_readonly(path: &path::Path) -> IoResult<bool> {
    match permissions_of(path)? {
        Some(current) if current.readonly() => {
            fs::set_permissions(path, with_readonly(current, false)).map(|()| true)
        }
        _ => Ok(false),
    }
}

/// Права файла; `None`, если файла нет.
fn permissions_of(path: &path::Path) -> IoResult<Option<fs::Permissions>> {
    fs::metadata(path)
        .map(|facts| Some(facts.permissions()))
        .or_else(|error| match error.kind() {
            ErrorKind::NotFound => Ok(None),
            _ => Err(error),
        })
}

/// Ставит «только чтение»; остальные атрибуты не трогает.
pub fn mark_readonly(path: &path::Path) -> IoResult<()> {
    fs::set_permissions(path, with_readonly(fs::metadata(path)?.permissions(), true))
}

/// «Только чтение», снятое на время подмены: при выходе возвращается на тот же
/// путь, и на успех, и на отказ; ошибка возврата молчит. Путь хранится, только
/// если флаг действительно стоял.
pub(crate) struct ReadonlyLift<'a>(Option<&'a path::Path>);

impl<'a> ReadonlyLift<'a> {
    pub(crate) fn take_off(path: &'a path::Path) -> IoResult<Self> {
        let was_set = clear_readonly(path)?;
        Ok(Self(was_set.then_some(path)))
    }
}

impl Drop for ReadonlyLift<'_> {
    fn drop(&mut self) {
        if let Some(path) = self.0 {
            let _ = mark_readonly(path);
        }
    }
}

// ---------------------------------------------------------------------------
// Где лежат точки
// ---------------------------------------------------------------------------

type Lookup<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Путь папки точек по умолчанию внутри каталога данных пользователя.
const DEFAULT_ROOT_PARTS: [&str; 5] =
    ["Astral", "cache", "backups", "native-rpf", "restore-points"];

fn local_app_data_from(lookup: Lookup<'_>) -> path::PathBuf {
    // Пустая переменная - как не заданная; строка из пробела не пуста.
    let chosen = ["LOCALAPPDATA", "XDG_DATA_HOME"]
        .into_iter()
        .find_map(|name| lookup(name).and_then(|value| (!value.is_empty()).then_some(value)));
    match (chosen, lookup("HOME")) {
        (Some(dir), _) => path::PathBuf::from(dir),
        // Пустая HOME не отбрасывается: выходит относительный `.local\share`.
        (None, Some(home)) => path::PathBuf::from(home).join(".local").join("share"),
        (None, None) => path::PathBuf::from("."),
    }
}

/// Каталог локальных данных пользователя.
pub fn local_app_data() -> path::PathBuf {
    local_app_data_from(&|name| env::var(name).ok())
}

fn restore_points_root_from(lookup: Lookup<'_>) -> path::PathBuf {
    match lookup(ROOT_ENV) {
        Some(custom) if !custom.is_empty() => path::PathBuf::from(custom),
        _ => DEFAULT_ROOT_PARTS
            .iter()
            .fold(local_app_data_from(lookup), |dir, part| dir.join(part)),
    }
}

/// Папка точек по умолчанию: переменная стенда или каталог в кэше Astral.
pub fn restore_points_root() -> path::PathBuf {
    restore_points_root_from(&|name| env::var(name).ok())
}

fn restore_points_root_for_from(
    options: &args::Options,
    lookup: Lookup<'_>,
) -> error::Result<path::PathBuf> {
    // Полный путь: диск и корень, UNC или verbatim; `\points` и `D:points` не годятся.
    match options.optional(ROOT_OPTION).map(str::trim) {
        None | Some("") => Ok(restore_points_root_from(lookup)),
        Some(given) => {
            let full = path::PathBuf::from(given);
            if full.is_absolute() {
                return Ok(full);
            }
            let message = format!("--{ROOT_OPTION} must be an absolute path.");
            Err(EngineError::argument(message))
        }
    }
}

/// Какую папку точек взять команде: путь из параметра (только полный) или умолчание.
pub fn restore_points_root_for(options: &args::Options) -> error::Result<path::PathBuf> {
    restore_points_root_for_from(options, &|name| env::var(name).ok())
}

// ---------------------------------------------------------------------------
// Идентификатор точки и путь копии
// ---------------------------------------------------------------------------

/// Новый идентификатор: `rpf-ГГГГММДД-ЧЧММСС-` и 18 случайных знаков (всего 38).
pub fn new_point_id() -> String {
    format!(
        "rpf-{}-{}",
        clock::Utc::now().compact(),
        archives::random_hex(18)
    )
}

/// Годится ли строка как имя папки точки: 1–80 байт из ASCII-букв, цифр, `-` и `_`.
pub fn valid_point_id(id: &str) -> bool {
    if !(1..=80).contains(&id.len()) {
        return false;
    }
    for ch in id.chars() {
        if !ch.is_ascii_alphanumeric() && !"-_".contains(ch) {
            return false;
        }
    }
    true
}

/// Проверка относительного пути архива.
pub fn safe_relative(value: &str) -> error::Result<String> {
    paths::normalize_relative(value)
}

/// Путь копии архива внутри папки точки: корень, разделитель ОС, путь без правок.
pub fn backup_path(restore_root: &path::Path, relative: &str) -> path::PathBuf {
    let parts = [
        restore_root.as_os_str(),
        ffi::OsStr::new(MAIN_SEPARATOR_STR),
        ffi::OsStr::new(relative),
    ];
    path::PathBuf::from(ffi::OsString::from_iter(parts))
}

/// Имя соседнего файла: последнее звено, точка и суффикс. У корня, `..` и
/// пустого пути звена-имени нет, и `.суффикс` дописывается к самому пути.
pub fn sibling_name(path: &path::Path, suffix: &str) -> path::PathBuf {
    let tail = format!(".{suffix}");
    match path.file_name() {
        None => path.join(tail),
        Some(name) => {
            let mut longer = name.to_os_string();
            longer.push(&tail);
            path.with_file_name(longer)
        }
    }
}

/// Приставка имени «до», оставленного рядом с живым архивом.
const ASIDE_MARK: &str = "astral-before-";

/// Второе имя прежнего живого архива рядом с ним: `<имя>.astral-before-<точка>`.
/// Так «до» хранится, когда копии в папке точек нет (другой том): ссылка живёт
/// на томе игры, байт при установке не пишется.
pub fn aside_path(live: &path::Path, point_id: &str) -> path::PathBuf {
    sibling_name(live, &format!("{ASIDE_MARK}{point_id}"))
}

/// Убирает «до» рядом с архивами `live`, чьи точки уже убраны (или брошены
/// недописанными дольше шести часов). Живая точка свою ссылку сохраняет.
/// Ошибки молчат: уборка не должна мешать установке.
pub fn sweep_orphan_asides(live: &path::Path, points_root: &path::Path) {
    let (Some(folder), Some(name)) = (live.parent(), live.file_name()) else {
        return;
    };
    let head = format!("{}.{ASIDE_MARK}", name.to_string_lossy());
    let now = time::SystemTime::now();
    for entry in fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = file_name.strip_prefix(&head) else {
            continue;
        };
        if !valid_point_id(id) {
            continue;
        }
        let point = points_root.join(id);
        let orphan = match fs::metadata(&point) {
            Err(_) => true,
            Ok(facts) => {
                !point.join("restore.json").is_file()
                    && facts
                        .modified()
                        .ok()
                        .and_then(|moment| now.duration_since(moment).ok())
                        .is_some_and(|age| age > STALE_AGE)
            }
        };
        if orphan {
            drop(fs::remove_file(entry.path()));
        }
    }
}

// ---------------------------------------------------------------------------
// Копирование
// ---------------------------------------------------------------------------

/// Опознавательный знак открытого файла: том и номер внутри тома. У двух имён
/// одного файла (жёсткая ссылка) он один.
#[derive(PartialEq, Eq)]
struct FileKey {
    volume: u64,
    index: u64,
}

#[allow(unsafe_code)]
impl FileKey {
    fn of(file: &fs::File) -> IoResult<Self> {
        #[cfg(unix)]
        {
            let facts = file.metadata()?;
            let (volume, index) = (facts.dev(), facts.ino());
            Ok(Self { volume, index })
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            };

            // SAFETY: структура - набор чисел, нулевое значение допустимо.
            let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            // SAFETY: дескриптор живого файла, структура живая до конца вызова.
            if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
                return Err(IoError::last_os_error());
            }
            let [high, low] = [info.nFileIndexHigh, info.nFileIndexLow].map(u64::from);
            Ok(Self {
                volume: u64::from(info.dwVolumeSerialNumber),
                index: (high << 32) | low,
            })
        }
    }
}

/// Тот ли это файл, что уже открыт как `source`. Назначение, которое не
/// открывается на чтение или не существует, тем же файлом не считается.
fn is_same_file(source: &fs::File, destination: &path::Path) -> bool {
    let ours = FileKey::of(source).ok();
    let theirs = match fs::File::open(destination) {
        Ok(other) => FileKey::of(&other).ok(),
        Err(_) => None,
    };
    ours.is_some() && ours == theirs
}

/// Источник копирования: открытый файл, его свойства и получатель счёта байт.
struct Transfer<'a> {
    input: fs::File,
    facts: fs::Metadata,
    report: Tick<'a>,
}

impl Transfer<'_> {
    /// Переливает источник в открытое на запись назначение порциями по 4 МиБ
    /// и считает SHA-256 (ПРОПИСНЫМИ). Время изменения источника переносится.
    fn pour_into(mut self, mut output: fs::File) -> error::Result<String> {
        const PORTION: u64 = 4 << 20;
        let size = self.facts.len();
        let capacity = PORTION.min(size);
        let modified = self.facts.modified().ok();
        output.set_len(size)?;

        let mut block: Vec<u8> = Vec::with_capacity(capacity as usize);
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        loop {
            // Порция заполнена целиком, пока файл не кончится.
            block.clear();
            (&mut self.input).take(capacity).read_to_end(&mut block)?;
            if block.is_empty() {
                break;
            }
            output.write_all(&block)?;
            hasher.update(&block);
            total += block.len() as u64;
            (self.report)(total);
        }

        output.set_len(total)?;
        carry_modified(&output, modified);
        output.flush()?;
        let digest = hasher.finalize();
        Ok(archives::hex_upper(digest.as_slice()))
    }
}

/// Переносит на копию время изменения источника; сбой переноса молчит.
fn carry_modified(copy: &fs::File, modified: Option<time::SystemTime>) {
    let Some(moment) = modified else {
        return;
    };
    drop(copy.set_times(fs::FileTimes::new().set_modified(moment)));
}

/// Копирует файл, считая SHA-256 прочитанного (ПРОПИСНЫМИ).
///
/// Назначение создаётся (существующее усекается) и сразу растягивается до
/// полной длины. Отказ после этого убирает назначение: обломка нет. Отказ
/// раньше (источник или назначение не открылись) ничего не трогает; то же с
/// копированием файла на самого себя, оно отказывает до всякой записи.
/// `copied` получает накопленное число байт после каждой порции.
pub fn copy_with_hash(
    source: &path::Path,
    destination: &path::Path,
    copied: Tick<'_>,
) -> error::Result<String> {
    let input = fs::File::open(source)?;
    let job = Transfer {
        facts: input.metadata()?,
        input,
        report: copied,
    };
    if is_same_file(&job.input, destination) {
        let message = format!(
            "Source and destination are the same file: {}",
            destination.display()
        );
        return Err(EngineError::argument(message));
    }
    let output = fs::File::create(destination)?;
    job.pour_into(output).inspect_err(|_| discard(destination))
}

/// Сбрасывает существующий файл на диск (открывает на запись без усечения).
pub fn flush_to_disk(path: &path::Path) -> IoResult<()> {
    let mut opening = fs::OpenOptions::new();
    opening.write(true).create(false).truncate(false);
    opening.open(path)?.sync_all()
}

/// Копия, сброшенная на диск и перечитанная. Отказ убирает только то, что эта
/// операция сама записала: назначение, которое не открылось на запись, остаётся
/// как было (за это отвечает `copy_with_hash`), а записанное и не прошедшее
/// проверку удаляется.
pub fn copy_verified(
    source: &path::Path,
    destination: &path::Path,
    copied: Tick<'_>,
) -> error::Result<String> {
    copy_with_hash(source, destination, copied).and_then(|digest| {
        let failure = match reread_matches(destination, &digest) {
            Ok(true) => return Ok(digest),
            Ok(false) => EngineError::io(format!(
                "Копия {} не совпала с источником после записи на диск.",
                destination.display()
            )),
            Err(error) => error,
        };
        discard(destination);
        Err(failure)
    })
}

/// Сброс на диск и перечитывание записанной копии: совпал ли её отпечаток.
fn reread_matches(destination: &path::Path, digest: &str) -> error::Result<bool> {
    flush_to_disk(destination)?;
    archives::sha256_file(destination).map(|again| again.eq_ignore_ascii_case(digest))
}

/// Убирает файл; ошибка убирания молчит.
fn discard(path: &path::Path) {
    drop(fs::remove_file(path));
}

// ---------------------------------------------------------------------------
// Опись restore.json
// ---------------------------------------------------------------------------

/// Одна запись описи при записи.
pub struct BackupItem {
    pub live_path: path::PathBuf,
    pub relative_path: String,
    pub sha256_before: String,
    pub backup_path: path::PathBuf,
    pub sha256_after: String,
}

/// Одна запись описи о дозаписи: архив не копировался, точка — запись журнала
/// рядом с ним.
pub struct AppendItem {
    pub live_path: path::PathBuf,
    pub relative_path: String,
    /// Номер записи журнала, которую откатывает эта точка.
    pub record: u64,
    /// Отпечатки архива до и после дозаписи (пусто, пока дозапись не закончилась).
    pub fingerprint_before: String,
    pub fingerprint_after: String,
    /// SHA-256 файла, с которого началась цепочка журнала этой записи (пусто, пока
    /// дозапись не закончилась): по нему откат узнаёт точку, пережившую уплотнение.
    pub chain_base: String,
}

/// Файл, который установка создала в игре (например, свой dlc-архив): откат
/// убирает его, только если он доказанно тот же (длина и SHA-256).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreatedFile {
    /// Путь от корня игры, прямые косые.
    pub path: String,
    pub bytes: u64,
    /// SHA-256 прописными, 64 знака.
    pub sha256: String,
}

/// Всё, что попадает в `restore.json`: носитель вместо длинного списка параметров.
struct Draft<'a> {
    id: &'a str,
    game_root: &'a path::Path,
    patch: &'a path::Path,
    items: &'a [BackupItem],
    appended: &'a [AppendItem],
    created_dirs: &'a [String],
    created_files: &'a [CreatedFile],
}

impl Draft<'_> {
    fn archive(item: &BackupItem) -> Value {
        let lossy = |path: &path::Path| path.to_string_lossy().into_owned();
        let fields = [
            ("relativePath", item.relative_path.clone()),
            ("livePath", lossy(&item.live_path)),
            ("backupPath", lossy(&item.backup_path)),
            ("sha256Before", item.sha256_before.clone()),
            ("sha256After", item.sha256_after.clone()),
        ];
        let mut object = Map::new();
        for (key, text) in fields {
            object.insert(key.to_owned(), Value::String(text));
        }
        Value::Object(object)
    }

    /// Запись о дозаписи: копии нет, откатывает запись журнала `append.record`.
    /// Отпечатки идут и в привычные поля `sha256Before` и `sha256After`.
    fn appended(item: &AppendItem) -> Value {
        let lossy = |path: &path::Path| path.to_string_lossy().into_owned();
        let mut object = Map::new();
        for (key, text) in [
            ("relativePath", item.relative_path.clone()),
            ("livePath", lossy(&item.live_path)),
            ("backupPath", String::new()),
            ("sha256Before", item.fingerprint_before.clone()),
            ("sha256After", item.fingerprint_after.clone()),
        ] {
            object.insert(key.to_owned(), Value::String(text));
        }
        let mut mark =
            json!({ "record": item.record, "fingerprintBefore": item.fingerprint_before });
        // ключ есть, когда дозапись закончена: у недописанной точки цепочки ещё нет
        if !item.chain_base.is_empty() {
            mark["chainBase"] = json!(item.chain_base);
        }
        object.insert("append".to_owned(), mark);
        Value::Object(object)
    }

    fn text(&self) -> error::Result<String> {
        const SCHEMA_VERSION: u32 = 2;
        /// Необязательный ключ: папки, созданные установкой в игре.
        const CREATED_DIRS_KEY: &str = "createdDirectories";
        /// Необязательный ключ: файлы, созданные установкой в игре (свой dlc).
        const CREATED_FILES_KEY: &str = "createdFiles";
        let mut document = Map::new();
        let listed: Vec<Value> = self
            .items
            .iter()
            .map(Self::archive)
            .chain(self.appended.iter().map(Self::appended))
            .collect();
        let head = [
            ("schemaVersion", json!(SCHEMA_VERSION)),
            ("id", json!(self.id)),
            ("createdAt", json!(clock::Utc::now().iso_offset())),
            ("gameRoot", json!(self.game_root.to_string_lossy())),
            ("patch", json!(self.patch.to_string_lossy())),
            ("archives", Value::Array(listed)),
        ];
        document.extend(head.map(|(key, value)| (key.to_owned(), value)));
        // Ключ есть только у описи, где установка что-то создала: прежние описи
        // остаются такими же байт в байт.
        if !self.created_dirs.is_empty() {
            document.insert(CREATED_DIRS_KEY.to_owned(), json!(self.created_dirs));
        }
        if !self.created_files.is_empty() {
            let listed = self.created_files.iter().map(
                |file| json!({ "path": file.path, "bytes": file.bytes, "sha256": file.sha256 }),
            );
            document.insert(CREATED_FILES_KEY.to_owned(), Value::Array(listed.collect()));
        }
        // Файл целиком ASCII: всё выше U+007F уходит как `\uXXXX`.
        match serde_json::to_string_pretty(&document) {
            Ok(pretty) => Ok(response::ascii_escape(&pretty)),
            Err(failure) => Err(EngineError::internal(failure.to_string())),
        }
    }
}

/// Пишет байты в новый файл и сбрасывает их на диск; дескриптор закрывается
/// при выходе.
fn write_durably(path: &path::Path, bytes: &[u8]) -> IoResult<()> {
    fs::File::create(path).and_then(|mut file| {
        file.write_all(bytes)?;
        file.sync_all()
    })
}

/// Записывает `restore.json` в каталог точки (он обязан существовать) целиком
/// или не записывает: сначала `restore.json.tmp`, потом переименование поверх.
pub fn write_manifest(
    restore_root: &path::Path,
    id: &str,
    game_root: &path::Path,
    patch: &path::Path,
    items: &[BackupItem],
) -> error::Result<()> {
    let draft = Draft {
        id,
        game_root,
        patch,
        items,
        appended: &[],
        created_dirs: &[],
        created_files: &[],
    };
    publish_draft(restore_root, &draft)
}

/// Опись точки дозаписи: один архив, откатываемый записью журнала. Пишется
/// так же целиком или не пишется.
pub fn write_append_manifest(
    restore_root: &path::Path,
    id: &str,
    game_root: &path::Path,
    patch: &path::Path,
    item: &AppendItem,
) -> error::Result<()> {
    write_append_manifest_with(restore_root, id, game_root, patch, item, &[], &[])
}

/// То же, с файлами и папками, которые установка создала в игре (ключи
/// `createdFiles` и `createdDirectories`). Пустые списки ключей не пишут: опись
/// тогда байт в байт прежняя.
pub fn write_append_manifest_with(
    restore_root: &path::Path,
    id: &str,
    game_root: &path::Path,
    patch: &path::Path,
    item: &AppendItem,
    created_files: &[CreatedFile],
    created_dirs: &[String],
) -> error::Result<()> {
    let draft = Draft {
        id,
        game_root,
        patch,
        items: &[],
        appended: std::slice::from_ref(item),
        created_dirs,
        created_files,
    };
    publish_draft(restore_root, &draft)
}

/// То же, с папками, которые установка создала в игре: пути от корня игры с
/// прямыми косыми, от внешней к внутренней. Пустой список ключ не пишет.
pub fn write_manifest_with(
    restore_root: &path::Path,
    id: &str,
    game_root: &path::Path,
    patch: &path::Path,
    items: &[BackupItem],
    created_dirs: &[String],
) -> error::Result<()> {
    let draft = Draft {
        created_dirs,
        created_files: &[],
        items,
        appended: &[],
        patch,
        game_root,
        id,
    };
    publish_draft(restore_root, &draft)
}

/// Опись пишется во временный файл рядом и встаёт на место одним переименованием.
fn publish_draft(restore_root: &path::Path, draft: &Draft<'_>) -> error::Result<()> {
    let text = draft.text()?;
    let temporary = restore_root.join("restore.json.tmp");
    let target = restore_root.join("restore.json");
    write_durably(&temporary, text.as_bytes())
        .and_then(|()| rename_with_retry(&temporary, &target))
        .inspect_err(|_| discard(&temporary))
        .map_err(EngineError::from)
}

/// Запись описи точки дозаписи: какую запись журнала откатывать.
pub struct AppendMark {
    pub record: u64,
    /// Отпечаток архива до дозаписи, каким его помнит точка.
    pub fingerprint_before: Option<String>,
    /// SHA-256 файла, с которого началась цепочка журнала записи; у описей,
    /// написанных до этого ключа, и у недописанных точек его нет.
    pub chain_base: Option<String>,
}

/// Одна запись описи при чтении.
pub struct RestoreEntry {
    pub sha256_after: Option<String>,
    pub sha256_before: String,
    pub relative_path: String,
    /// Есть у записи точки дозаписи; у прочих `None`.
    pub append: Option<AppendMark>,
}

/// Прочитанная опись: из неё берутся корень игры, три поля записей и папки,
/// которые создала установка (у старых описей их нет).
pub struct RestoreManifest {
    pub created_directories: Vec<String>,
    /// Файлы, которые создала установка (ключ `createdFiles`); у старых описей их нет.
    pub created_files: Vec<CreatedFile>,
    pub archives: Vec<RestoreEntry>,
    pub game_root: String,
}

/// Поле объекта по имени без учёта регистра ASCII; первое по порядку в файле.
fn field<'a>(object: &'a Map<String, Value>, name: &str) -> Option<&'a Value> {
    for (key, value) in object {
        if key.eq_ignore_ascii_case(name) {
            return Some(value);
        }
    }
    None
}

fn text_field(object: &Map<String, Value>, name: &str) -> String {
    match field(object, name) {
        Some(Value::String(text)) => text.clone(),
        _ => String::new(),
    }
}

fn entry_of(object: &Map<String, Value>) -> RestoreEntry {
    let installed = match field(object, "sha256After") {
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.clone()),
        _ => None,
    };
    // Ключ `append` есть только у точки дозаписи; без номера записи он не считается.
    let append = field(object, "append")
        .and_then(Value::as_object)
        .and_then(|mark| {
            let record = field(mark, "record")?.as_u64()?;
            let before = match field(mark, "fingerprintBefore") {
                Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
                _ => None,
            };
            let chain = match field(mark, "chainBase") {
                Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
                _ => None,
            };
            Some(AppendMark {
                record,
                fingerprint_before: before,
                chain_base: chain,
            })
        });
    RestoreEntry {
        relative_path: text_field(object, "relativePath"),
        sha256_after: installed,
        sha256_before: text_field(object, "sha256Before"),
        append,
    }
}

/// Разбирает опись: BOM, регистр имён и пропущенные поля прощаются.
pub fn read_manifest(file: &path::Path) -> error::Result<RestoreManifest> {
    fn malformed() -> EngineError {
        EngineError::invalid_data("Restore point manifest is invalid.")
    }
    let parsed = fs::read_to_string(file)
        .map(|text| serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')))?;
    let Ok(Value::Object(root)) = parsed else {
        return Err(malformed());
    };
    let items: &[Value] = match field(&root, "archives") {
        Some(Value::Array(items)) => items,
        _ => &[],
    };
    let mut archives = Vec::with_capacity(items.len());
    for item in items {
        archives.push(item.as_object().map(entry_of).ok_or_else(malformed)?);
    }
    // Не список или не строки внутри: этих папок как будто нет.
    let mut created_directories = Vec::new();
    if let Some(Value::Array(names)) = field(&root, "createdDirectories") {
        for name in names {
            if let Value::String(text) = name {
                created_directories.push(text.clone());
            }
        }
    }
    Ok(RestoreManifest {
        game_root: text_field(&root, "gameRoot"),
        created_directories,
        created_files: created_files_of(&root),
        archives,
    })
}

// ---------------------------------------------------------------------------
// Созданные файлы
// ---------------------------------------------------------------------------

/// Сколько файлов может назвать одна установка.
const MAX_CREATED_FILES: usize = 64;

/// Имя архива: оканчивается на `.rpf` (регистр не важен). Откат убирает только такие файлы.
fn names_archive(text: &str) -> bool {
    text.len() > ".rpf".len() && text.to_ascii_lowercase().ends_with(".rpf")
}

/// Ровно 64 шестнадцатеричных знака.
fn is_sha256_text(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Ключ `createdFiles` описи. Запись, которой нельзя верить (нет пути, длины или
/// хэша, это не `.rpf`), пропускается: файл, который нечем доказать, не убирается.
fn created_files_of(root: &Map<String, Value>) -> Vec<CreatedFile> {
    let Some(Value::Array(items)) = field(root, "createdFiles") else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let path = match field(object, "path") {
                Some(Value::String(text)) if names_archive(text) => text.clone(),
                _ => return None,
            };
            let bytes = field(object, "bytes")?.as_u64()?;
            let sha256 = match field(object, "sha256") {
                Some(Value::String(text)) if is_sha256_text(text) => text.to_ascii_uppercase(),
                _ => return None,
            };
            Some(CreatedFile {
                path,
                bytes,
                sha256,
            })
        })
        .collect()
}

/// Ключ `install.creates` запроса: что создала сборка до установки и что откат
/// обязан убрать. Каждая запись: `path` (от корня игры, `.rpf`), `bytes`, `sha256`
/// и необязательный `dirs` (папки выше файла, которые откат уберёт, если опустеют).
/// Нет ключа или `null` — ничего не создано. Возвращает файлы и папки для описи;
/// отказ случается раньше любой записи.
pub fn created_from_request(
    value: Option<&Value>,
) -> error::Result<(Vec<CreatedFile>, Vec<String>)> {
    let items = match value {
        None | Some(Value::Null) => return Ok((Vec::new(), Vec::new())),
        Some(Value::Array(items)) => items,
        Some(_) => return Err(EngineError::argument("Install creates is not a list.")),
    };
    if items.len() > MAX_CREATED_FILES {
        let message = format!("Install creates names more than {MAX_CREATED_FILES} files.");
        return Err(EngineError::argument(message));
    }
    let dirs_fault =
        || EngineError::argument("Install creates dirs must be folders above the file.");
    let mut files: Vec<CreatedFile> = Vec::with_capacity(items.len());
    let mut dirs: Vec<String> = Vec::new();
    for item in items {
        let Value::Object(object) = item else {
            return Err(EngineError::argument(
                "Install creates entry is not an object.",
            ));
        };
        let given = object
            .get("path")
            .and_then(Value::as_str)
            .filter(|text| names_archive(text))
            .ok_or_else(|| EngineError::argument("Install creates path must be an .rpf file."))?;
        let path = safe_relative(given)?;
        let bytes = object
            .get("bytes")
            .and_then(Value::as_u64)
            .filter(|&bytes| bytes > 0)
            .ok_or_else(|| {
                EngineError::argument("Install creates bytes must be a positive number.")
            })?;
        let sha256 = object
            .get("sha256")
            .and_then(Value::as_str)
            .filter(|text| is_sha256_text(text))
            .map(str::to_ascii_uppercase)
            .ok_or_else(|| {
                EngineError::argument("Install creates sha256 must be 64 hexadecimal digits.")
            })?;
        let lowered = path.to_lowercase();
        if files
            .iter()
            .any(|known| known.path.to_lowercase() == lowered)
        {
            return Err(EngineError::argument("Install creates names a file twice."));
        }
        match object.get("dirs") {
            None | Some(Value::Null) => {}
            Some(Value::Array(listed)) => {
                for name in listed {
                    let text = name.as_str().ok_or_else(dirs_fault)?;
                    let dir = safe_relative(text)?;
                    if !lowered.starts_with(&format!("{}/", dir.to_lowercase())) {
                        return Err(dirs_fault());
                    }
                    if !dirs.iter().any(|known| known.eq_ignore_ascii_case(&dir)) {
                        dirs.push(dir);
                    }
                }
            }
            Some(_) => return Err(dirs_fault()),
        }
        files.push(CreatedFile {
            path,
            bytes,
            sha256,
        });
    }
    // от внешней папки к внутренней, как у `createdDirectories` прежних описей
    dirs.sort_by_key(|dir| dir.matches('/').count());
    Ok((files, dirs))
}

/// Точка, у которой названы созданные файлы, а дозапись не дошла до отпечатка
/// «после»: установку оборвали или опись не дописалась.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnfinishedPoint {
    pub id: String,
    /// Архив точки дозаписи (путь от корня игры).
    pub archive: String,
    /// Номер записи журнала, которую откатывает точка.
    pub record: u64,
    pub created: Vec<CreatedFile>,
}

/// Корень игры для сравнения: косые, регистр и хвостовой разделитель не важны.
fn fold_root(text: &str) -> String {
    text.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Недоделанные точки этой игры из папки точек. Только чтение: ни один файл не
/// меняется, разбитые описи и чужие папки пропускаются. По порядку имён (то есть
/// по времени создания).
pub fn unfinished_points(points_root: &path::Path, game_root: &path::Path) -> Vec<UnfinishedPoint> {
    let wanted = fold_root(&game_root.to_string_lossy());
    let mut found = Vec::new();
    for entry in fs::read_dir(points_root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        if !matches!(entry.file_type(), Ok(kind) if kind.is_dir()) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_point_id(&id) {
            continue;
        }
        let Ok(manifest) = read_manifest(&entry.path().join("restore.json")) else {
            continue;
        };
        if manifest.created_files.is_empty() || fold_root(&manifest.game_root) != wanted {
            continue;
        }
        let waiting = manifest.archives.iter().find_map(|archive| {
            let mark = archive.append.as_ref()?;
            archive
                .sha256_after
                .is_none()
                .then(|| (archive.relative_path.clone(), mark.record))
        });
        if let Some((archive, record)) = waiting {
            found.push(UnfinishedPoint {
                id,
                archive,
                record,
                created: manifest.created_files,
            });
        }
    }
    found.sort_by(|left, right| left.id.cmp(&right.id));
    found
}

// ---------------------------------------------------------------------------
// Соседний файл и подмена
// ---------------------------------------------------------------------------

/// То же с переключателем: при `allow_link == false` жёсткая ссылка не пробуется.
pub fn prepare_sibling_with(
    backup: &path::Path,
    live: &path::Path,
    expected: &str,
    copied: Tick<'_>,
    allow_link: bool,
) -> error::Result<path::PathBuf> {
    let place = sibling_name(live, "astral-restore");
    discard(&place);
    // Ссылка хэш не сверяет: это второе имя файла самой точки.
    let linked = matches!(
        allow_link.then(|| fs::hard_link(backup, &place)),
        Some(Ok(()))
    );
    if linked || copy_verified(backup, &place, copied)?.eq_ignore_ascii_case(expected) {
        return Ok(place);
    }
    discard(&place);
    let message = format!(
        "Резервная копия {} не совпала с описью точки.",
        backup.display()
    );
    Err(EngineError::invalid_data(message))
}

/// Кладёт возле живого архива готовую копию точки (`….astral-restore`).
pub fn prepare_sibling(
    backup: &path::Path,
    live: &path::Path,
    expected: &str,
    copied: Tick<'_>,
) -> error::Result<path::PathBuf> {
    prepare_sibling_with(backup, live, expected, copied, true)
}

/// Подменяет живой файл готовым одним переименованием. «Только чтение»
/// снимается на время подмены и возвращается на путь `live`.
pub fn swap_in(from: &path::Path, live: &path::Path) -> IoResult<()> {
    ReadonlyLift::take_off(live).and_then(|lift| {
        let renamed = rename_with_retry(from, live);
        drop(lift);
        if renamed.is_ok() {
            // журнал дозаписи говорит о прежнем файле: новому он только вредит
            drop(rage_rpf::journal::remove(&rage_rpf::journal::journal_path(
                live,
            )));
            // таблица слоёв описывает слои этого журнала и их спящие тела: у нового
            // файла их нет (включённые слои вошли в него записями, выключенные
            // пропали), и таблица чужой цепочки не действует и без удаления, но
            // лежать ей незачем
            drop(rage_rpf::layers::remove(&rage_rpf::layers::layers_path(
                live,
            )));
        }
        renamed
    })
}

/// Номер файла на томе (том и индекс внутри него). Переименование файла его не
/// меняет, а подмена другим файлом меняет, даже если длина и время те же.
pub(crate) fn file_key(path: &path::Path) -> IoResult<(u64, u64)> {
    let file = fs::File::open(path)?;
    FileKey::of(&file).map(|key| (key.volume, key.index))
}

/// Заменяет живой архив копией из точки; копия точки остаётся на месте.
pub fn put_back(backup: &path::Path, live: &path::Path, expected: &str) -> error::Result<()> {
    match prepare_sibling(backup, live, expected, &mut |_: u64| ()) {
        Err(error) => Err(error),
        Ok(sibling) => swap_in(&sibling, live).map_err(|error| {
            discard(&sibling);
            EngineError::from(error)
        }),
    }
}

// ---------------------------------------------------------------------------
// Уборка
// ---------------------------------------------------------------------------

/// Сколько прошло с последнего изменения записи каталога (`None`, если время
/// не прочиталось или стоит в будущем).
fn modified_ago(entry: &fs::DirEntry, now: time::SystemTime) -> Option<time::Duration> {
    let modified = match entry.metadata() {
        Ok(facts) => facts.modified().ok()?,
        Err(_) => return None,
    };
    now.duration_since(modified).ok()
}

/// Старше какого возраста служебная папка сборки считается забытой.
const STALE_AGE: time::Duration = time::Duration::from_secs(6 * 60 * 60);

/// Забытая ли это служебная папка сборки: каталог с именем на `.astral-stage-`,
/// чьё собственное время изменения старше шести часов.
fn is_abandoned_stage(entry: &fs::DirEntry, now: time::SystemTime) -> bool {
    let name = entry.file_name();
    if !name.to_string_lossy().starts_with(".astral-stage-") {
        return false;
    }
    if !matches!(entry.file_type(), Ok(kind) if kind.is_dir()) {
        return false;
    }
    matches!(modified_ago(entry, now), Some(age) if age > STALE_AGE)
}

/// Убирает забытые служебные папки сборки: прямые потомки-каталоги с именем на
/// `.astral-stage-`, чьё собственное время изменения старше шести часов.
pub fn sweep_stale_stages(directory: &path::Path) {
    let now = time::SystemTime::now();
    for entry in fs::read_dir(directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        if is_abandoned_stage(&entry, now) {
            drop(fs::remove_dir_all(entry.path()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{archives::sha256_file, args::Options, clock::Utc, error::Result};
    use std::cell::{Cell, RefCell};
    use std::io::ErrorKind;
    use std::{
        fs::{File, OpenOptions},
        io,
        path::{Path, PathBuf},
        time::{Duration, SystemTime},
    };
    use tempfile::{tempdir, TempDir};

    // ----- помощники -----

    fn refused<T>(outcome: Result<T>, code: &str, message: &str) {
        match outcome {
            Ok(_) => panic!("ожидался отказ {code}: {message}"),
            Err(error) => {
                assert_eq!(error.code, code);
                assert_eq!(error.message, message);
            }
        }
    }

    /// Отказ с данным кодом; возвращает текст отказа.
    fn refused_code<T>(outcome: Result<T>, code: &str) -> String {
        match outcome {
            Ok(_) => panic!("ожидался отказ {code}"),
            Err(error) => {
                assert_eq!(error.code, code);
                error.message
            }
        }
    }

    fn fake_env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    fn options(args: &[&str]) -> Options {
        let owned: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        Options::parse(&owned).unwrap()
    }

    fn write(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    /// Новый файл вместо старого: запись «в то же имя» задела бы жёсткие ссылки.
    fn replace(path: &Path, bytes: &[u8]) {
        let _ = fs::remove_file(path);
        write(path, bytes);
    }

    fn read(path: &Path) -> String {
        String::from_utf8(fs::read(path).unwrap()).unwrap()
    }

    fn sandbox() -> TempDir {
        tempdir().unwrap()
    }

    fn sha_text(text: &str) -> String {
        super::super::sha256_hex(text.as_bytes()).to_uppercase()
    }

    #[cfg(windows)]
    fn attributes(path: &Path) -> u32 {
        use std::os::windows::fs::MetadataExt;
        fs::metadata(path).unwrap().file_attributes()
    }

    /// Файл, открытый без разделения: другие процессы его не откроют.
    #[cfg(windows)]
    fn hold_exclusively(path: &Path) -> File {
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(path)
            .unwrap()
    }

    const HELLO_SHA: &str = "B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9";
    const POINT_COPY: &str = "point copy";

    // ----- папка точек и переменные (Пт1-Пт27) -----

    #[test]
    fn local_app_data_follows_the_variables() {
        let pick = |pairs: &[(&str, &str)]| local_app_data_from(&fake_env(pairs));
        let local = r"C:\Users\x\AppData\Local";
        assert_eq!(pick(&[("LOCALAPPDATA", local)]), PathBuf::from(local));
        // XDG не читается, пока задана LOCALAPPDATA
        assert_eq!(
            pick(&[("LOCALAPPDATA", local), ("XDG_DATA_HOME", r"D:\xdg")]),
            PathBuf::from(local)
        );
        // пустая LOCALAPPDATA - как не заданная, пробел - не пуст
        assert_eq!(
            pick(&[("LOCALAPPDATA", ""), ("XDG_DATA_HOME", r"D:\xdg")]),
            PathBuf::from(r"D:\xdg")
        );
        assert_eq!(pick(&[("LOCALAPPDATA", " ")]), PathBuf::from(" "));
        assert_eq!(
            pick(&[("XDG_DATA_HOME", r"D:\xdg")]),
            PathBuf::from(r"D:\xdg")
        );
        assert_eq!(
            pick(&[("XDG_DATA_HOME", ""), ("HOME", "h")]),
            ["h", ".local", "share"].iter().collect::<PathBuf>()
        );
        // пустая HOME не отбрасывается
        assert_eq!(
            pick(&[("HOME", "")]),
            [".local", "share"].iter().collect::<PathBuf>()
        );
        assert_eq!(pick(&[]), PathBuf::from("."));
        #[cfg(windows)]
        {
            assert_eq!(
                pick(&[("HOME", r"C:\h")]),
                PathBuf::from(r"C:\h\.local\share")
            );
            assert_eq!(pick(&[("HOME", "")]).to_string_lossy(), r".local\share");
        }
    }

    #[test]
    fn the_points_root_is_the_stand_variable_or_a_folder_in_the_cache() {
        let pick = |pairs: &[(&str, &str)]| restore_points_root_from(&fake_env(pairs));
        let local = r"C:\Users\x\AppData\Local";
        let by_default = DEFAULT_ROOT_PARTS
            .iter()
            .fold(PathBuf::from(local), |dir, part| dir.join(part));
        assert_eq!(pick(&[("LOCALAPPDATA", local)]), by_default);
        #[cfg(windows)]
        assert_eq!(
            by_default.to_string_lossy(),
            r"C:\Users\x\AppData\Local\Astral\cache\backups\native-rpf\restore-points"
        );
        assert_eq!(
            pick(&[("LOCALAPPDATA", local), (ROOT_ENV, r"E:\stand\points")]),
            PathBuf::from(r"E:\stand\points")
        );
        // относительный и пробельный путь здесь не проверяются
        assert_eq!(
            pick(&[(ROOT_ENV, r"rel\points")]),
            PathBuf::from(r"rel\points")
        );
        assert_eq!(pick(&[(ROOT_ENV, "   ")]), PathBuf::from("   "));
        // пустая переменная - как не заданная
        assert_eq!(pick(&[("LOCALAPPDATA", local), (ROOT_ENV, "")]), by_default);
    }

    #[test]
    fn the_command_option_beats_the_variable_and_must_be_absolute() {
        let env = [(ROOT_ENV, r"E:\stand\points")];
        let ask = |args: &[&str]| restore_points_root_for_from(&options(args), &fake_env(&env));
        let stand = PathBuf::from(r"E:\stand\points");

        // нет опции, пустая или из пробелов - как будто опции нет
        assert_eq!(ask(&[]).unwrap(), stand);
        assert_eq!(ask(&["--restore-points-root", "   "]).unwrap(), stand);
        assert_eq!(ask(&["--restore-points-root", ""]).unwrap(), stand);

        #[cfg(windows)]
        {
            let given = |value: &str| ask(&["--restore-points-root", value]).unwrap();
            assert_eq!(given(r"D:\cache\points"), PathBuf::from(r"D:\cache\points"));
            assert_eq!(
                given(r"  D:\cache\points  "),
                PathBuf::from(r"D:\cache\points")
            );
            assert_eq!(given(r"\\srv\share\pts"), PathBuf::from(r"\\srv\share\pts"));
            assert_eq!(given(r"\\?\D:\pts"), PathBuf::from(r"\\?\D:\pts"));
            // точки, слэши и хвостовой слэш не правятся
            assert_eq!(given(r"D:\a\..\b\"), PathBuf::from(r"D:\a\..\b\"));
            assert_eq!(given("D:/cache/points"), PathBuf::from("D:/cache/points"));
            for relative in [r"rel\points", r"\points", "D:points"] {
                refused(
                    ask(&["--restore-points-root", relative]),
                    "ArgumentException",
                    "--restore-points-root must be an absolute path.",
                );
            }
            // повтор - последнее значение; имя без учёта регистра
            let twice = ask(&[
                "--restore-points-root",
                r"D:\one",
                "--restore-points-root",
                r"D:\two",
            ]);
            assert_eq!(twice.unwrap(), PathBuf::from(r"D:\two"));
            assert_eq!(
                ask(&["--RESTORE-POINTS-ROOT", r"D:\up"]).unwrap(),
                PathBuf::from(r"D:\up")
            );
        }
    }

    // ----- идентификатор и путь копии (Пт28-Пт63) -----

    #[test]
    fn new_ids_have_the_old_shape_and_do_not_repeat() {
        let before = Utc::now().compact();
        let ids: Vec<String> = (0..2000).map(|_| new_point_id()).collect();
        let after = Utc::now().compact();
        let mut seen = std::collections::HashSet::new();
        for id in &ids {
            assert_eq!(id.len(), 38, "{id}");
            assert!(id.starts_with("rpf-"));
            let stamp = &id[4..19];
            assert!(stamp.bytes().enumerate().all(|(at, byte)| if at == 8 {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }));
            assert_eq!(id.as_bytes()[19], b'-');
            assert!(id[20..]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
            assert!(valid_point_id(id));
            assert!(stamp >= before.as_str() && stamp <= after.as_str());
            seen.insert(id.clone());
        }
        assert_eq!(seen.len(), 2000);
    }

    #[test]
    fn point_id_validity_table() {
        let long_ok = "a".repeat(80);
        let long_bad = "a".repeat(81);
        let cyrillic = "ё".repeat(40);
        let cases: [(&str, bool); 16] = [
            ("rpf-20261018-050640-0123456789abcdef01", true),
            ("a", true),
            ("A_b-9", true),
            ("", false),
            (long_ok.as_str(), true),
            (long_bad.as_str(), false),
            ("../x", false),
            ("a b", false),
            ("a.b", false),
            ("a/b", false),
            (r"a\b", false),
            ("rpf-x\n", false),
            (cyrillic.as_str(), false),
            ("RPF-ABC", true),
            ("-", true),
            ("a\0b", false),
        ];
        for (id, verdict) in cases {
            assert_eq!(valid_point_id(id), verdict, "{id:?}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn backup_path_glues_the_text_as_it_is() {
        let glue = |root: &str, relative: &str| {
            backup_path(Path::new(root), relative)
                .to_string_lossy()
                .into_owned()
        };
        assert_eq!(
            glue(r"C:\p\id", "update/update.rpf"),
            r"C:\p\id\update/update.rpf"
        );
        assert_eq!(
            glue("C:\\p\\id\\", "update/update.rpf"),
            r"C:\p\id\\update/update.rpf"
        );
        assert_eq!(glue(r"C:\p\id", ""), "C:\\p\\id\\");
        assert_eq!(glue(r"C:\p\id", "/x"), r"C:\p\id\/x");
        assert_eq!(glue(r"C:\p\id", r"a\b.rpf"), r"C:\p\id\a\b.rpf");
        assert_eq!(glue("", "x.rpf"), r"\x.rpf");
        assert_eq!(glue(r"C:\Игры\id", "ё/ж.rpf"), r"C:\Игры\id\ё/ж.rpf");
    }

    #[cfg(windows)]
    #[test]
    fn sibling_names_follow_the_last_component() {
        let name = |path: &str, suffix: &str| {
            sibling_name(Path::new(path), suffix)
                .to_string_lossy()
                .into_owned()
        };
        assert_eq!(
            name(r"G:\g\update\update.rpf", "astral-restore"),
            r"G:\g\update\update.rpf.astral-restore"
        );
        assert_eq!(name(r"G:\g\GTA5", "x"), r"G:\g\GTA5.x");
        assert_eq!(name(r"G:\g\a.", "x"), r"G:\g\a..x");
        assert_eq!(name(r"G:\g\a.rpf", ""), r"G:\g\a.rpf.");
        assert_eq!(name(r"G:\", "x"), r"G:\.x");
        assert_eq!(name("", "x"), ".x");
        assert_eq!(name(r"G:\g\..", "x"), r"G:\g\..\.x");
        assert_eq!(
            name("update.rpf", "astral-current"),
            "update.rpf.astral-current"
        );
        assert_eq!(name("G:\\g\\update\\", "x"), r"G:\g\update.x");
        assert_eq!(name(r"G:\g\ёж.rpf", "x"), r"G:\g\ёж.rpf.x");
    }

    #[test]
    fn safe_relative_is_the_path_check_of_the_neighbour() {
        let ok: [(&str, &str); 6] = [
            ("update/update.rpf", "update/update.rpf"),
            (r"update\update.rpf", "update/update.rpf"),
            ("/x/y", "x/y"),
            ("a/ /b", "a/ /b"),
            ("Ё/x", "Ё/x"),
            ("1:/x", "1:/x"),
        ];
        for (given, expected) in ok {
            assert_eq!(safe_relative(given).unwrap(), expected);
        }
        assert_eq!(safe_relative(r"\\srv\share").unwrap(), "srv/share");
        for bad in [
            "", "a/../b", "C:x", "a//b", ".", " ", "a/b/", "a/./b", "..", "c:/x", "x:",
        ] {
            refused(
                safe_relative(bad),
                "InvalidDataException",
                &format!("Unsafe relative path: {bad}"),
            );
        }
    }

    // ----- ошибки системы и повторы (Пт82-Пт114) -----

    #[test]
    fn trouble_tells_busy_from_denied_from_the_rest() {
        #[cfg(windows)]
        {
            let raw = |code: i32| trouble(&io::Error::from_raw_os_error(code));
            assert_eq!(raw(32), Some(Trouble::Busy));
            assert_eq!(raw(33), Some(Trouble::Busy));
            assert_eq!(raw(5), Some(Trouble::Denied));
            for quiet in [2, 3, 1224, 0, 31, 34, 80, 145, 112, 123, 19] {
                assert_eq!(raw(quiet), None, "код {quiet}");
            }
        }
        let by_kind = |kind: ErrorKind| trouble(&io::Error::from(kind));
        assert_eq!(by_kind(ErrorKind::PermissionDenied), Some(Trouble::Denied));
        assert_eq!(by_kind(ErrorKind::NotFound), None);
        assert_eq!(by_kind(ErrorKind::WouldBlock), None);
        assert_eq!(by_kind(ErrorKind::Other), None);
        assert_eq!(
            trouble(&io::Error::new(ErrorKind::PermissionDenied, "custom")),
            Some(Trouble::Denied)
        );
        // Пт101: Clone, Copy, Debug, PartialEq, Eq
        let (busy, denied) = (Trouble::Busy, Trouble::Denied);
        let copied = busy;
        assert_eq!(copied, busy);
        assert_ne!(busy, denied);
        assert!(format!("{busy:?}{denied:?}").contains("BusyDenied"));
    }

    /// Итог прогона `retry_core` с подставными паузами.
    struct Run<T> {
        outcome: io::Result<T>,
        attempts: u32,
        paused_ms: u128,
        pauses: Vec<Duration>,
        lines: Vec<String>,
    }

    fn run_script<T>(
        what: &str,
        mut script: impl FnMut(u32) -> io::Result<T>,
        classify: impl Fn(&io::Error) -> Option<Trouble>,
    ) -> Run<T> {
        let attempts = Cell::new(0u32);
        let pauses = RefCell::new(Vec::new());
        let lines = RefCell::new(Vec::new());
        let outcome = retry_core(
            what,
            || {
                attempts.set(attempts.get() + 1);
                script(attempts.get())
            },
            classify,
            |pause| pauses.borrow_mut().push(pause),
            |line| lines.borrow_mut().push(line.to_owned()),
        );
        let pauses = pauses.into_inner();
        Run {
            outcome,
            attempts: attempts.get(),
            paused_ms: pauses.iter().map(Duration::as_millis).sum(),
            pauses,
            lines: lines.into_inner(),
        }
    }

    fn busy_error() -> io::Error {
        io::Error::new(ErrorKind::WouldBlock, "busy")
    }

    fn denied_error() -> io::Error {
        io::Error::from(ErrorKind::PermissionDenied)
    }

    fn missing_error() -> io::Error {
        io::Error::from(ErrorKind::NotFound)
    }

    /// Тип отказа задаётся видом ошибки: WouldBlock - «занят».
    fn by_test_kind(error: &io::Error) -> Option<Trouble> {
        match error.kind() {
            ErrorKind::WouldBlock => Some(Trouble::Busy),
            ErrorKind::PermissionDenied => Some(Trouble::Denied),
            _ => None,
        }
    }

    const BUSY_LINE: &str = "[Install] что: файл занят другим процессом, жду до 60 с…";
    const DENIED_LINE: &str = "[Install] что: доступ закрыт, жду до 10 с…";

    #[test]
    fn retries_follow_the_patience_of_the_reason() {
        // Пт102: удаётся сразу
        let run = run_script("что", |_| Ok(1), by_test_kind);
        assert_eq!(run.outcome.unwrap(), 1);
        assert_eq!((run.attempts, run.paused_ms), (1, 0));
        assert!(run.lines.is_empty());

        // Пт103: занято трижды, затем успех
        let run = run_script(
            "что",
            |n| if n <= 3 { Err(busy_error()) } else { Ok(n) },
            by_test_kind,
        );
        assert_eq!(run.outcome.unwrap(), 4);
        assert_eq!((run.attempts, run.paused_ms), (4, 1500));
        assert_eq!(run.lines, [BUSY_LINE]);

        // Пт104: доступ закрыт дважды, затем успех
        let run = run_script(
            "что",
            |n| if n <= 2 { Err(denied_error()) } else { Ok(n) },
            by_test_kind,
        );
        assert_eq!(run.outcome.unwrap(), 3);
        assert_eq!((run.attempts, run.paused_ms), (3, 1000));
        assert_eq!(run.lines, [DENIED_LINE]);

        // Пт105: «не найдено» не временная
        let run = run_script::<()>("что", |_| Err(missing_error()), by_test_kind);
        assert_eq!(run.outcome.unwrap_err().kind(), ErrorKind::NotFound);
        assert_eq!((run.attempts, run.paused_ms), (1, 0));
        assert!(run.lines.is_empty());

        // Пт106: доступ закрыт всегда - 10 с
        let run = run_script::<()>("что", |_| Err(denied_error()), by_test_kind);
        assert_eq!(run.outcome.unwrap_err().kind(), ErrorKind::PermissionDenied);
        assert_eq!((run.attempts, run.paused_ms), (21, 10_000));
        assert_eq!(run.lines, [DENIED_LINE]);

        // Пт107: занято всегда - 60 с
        let run = run_script::<()>("что", |_| Err(busy_error()), by_test_kind);
        assert_eq!(run.outcome.unwrap_err().kind(), ErrorKind::WouldBlock);
        assert_eq!((run.attempts, run.paused_ms), (121, 60_000));
        assert_eq!(run.lines, [BUSY_LINE]);

        // Пт108: занято трижды, дальше доступ закрыт всегда: предел сменился на 10 с
        let run = run_script::<()>(
            "что",
            |n| Err(if n <= 3 { busy_error() } else { denied_error() }),
            by_test_kind,
        );
        assert_eq!(run.outcome.unwrap_err().kind(), ErrorKind::PermissionDenied);
        assert_eq!((run.attempts, run.paused_ms), (21, 10_000));
        assert_eq!(run.lines, [BUSY_LINE]);

        // Пт109: доступ закрыт дважды, дальше занято всегда: ждёт всё равно до 60 с
        let run = run_script::<()>(
            "что",
            |n| Err(if n <= 2 { denied_error() } else { busy_error() }),
            by_test_kind,
        );
        assert_eq!(run.outcome.unwrap_err().kind(), ErrorKind::WouldBlock);
        assert_eq!((run.attempts, run.paused_ms), (121, 60_000));
        assert_eq!(run.lines, [DENIED_LINE]);

        // Пт110: занято 30 раз (15 с), затем доступ закрыт: сдаётся сразу
        let run = run_script::<()>(
            "что",
            |n| {
                Err(if n <= 30 {
                    busy_error()
                } else {
                    denied_error()
                })
            },
            by_test_kind,
        );
        assert_eq!(run.outcome.unwrap_err().kind(), ErrorKind::PermissionDenied);
        assert_eq!((run.attempts, run.paused_ms), (31, 15_000));
        assert_eq!(run.lines, [BUSY_LINE]);

        // Пт111: занято дважды, затем «не найдено»
        let run = run_script::<()>(
            "что",
            |n| {
                Err(if n <= 2 {
                    busy_error()
                } else {
                    missing_error()
                })
            },
            by_test_kind,
        );
        assert_eq!(run.outcome.unwrap_err().kind(), ErrorKind::NotFound);
        assert_eq!((run.attempts, run.paused_ms), (3, 1000));
        assert_eq!(run.lines, [BUSY_LINE]);

        // Пт114: паузе передаётся ровно 500 мс
        let run = run_script::<()>("что", |_| Err(denied_error()), by_test_kind);
        assert_eq!(run.pauses.len(), 20);
        assert!(run
            .pauses
            .iter()
            .all(|pause| *pause == Duration::from_millis(500)));
    }

    #[test]
    fn the_public_retry_takes_the_classifier_and_the_pause_from_the_caller() {
        // Пт112: свой классификатор и своя пауза; настоящее ожидание не нужно
        let slept = Cell::new(0u128);
        let tries = Cell::new(0u32);
        let outcome: io::Result<()> = retry_while_busy(
            "своя проверка",
            || {
                tries.set(tries.get() + 1);
                Err(busy_error())
            },
            by_test_kind,
            |pause| slept.set(slept.get() + pause.as_millis()),
        );
        assert!(outcome.is_err());
        assert_eq!((tries.get(), slept.get()), (121, 60_000));

        // Пт113: «[Install] {что}: {причина}, жду до {N} с…», в конце один знак U+2026
        let run = run_script(
            "подмена x.rpf",
            |n| if n == 1 { Err(denied_error()) } else { Ok(()) },
            by_test_kind,
        );
        assert!(run.outcome.is_ok());
        assert_eq!(
            run.lines,
            ["[Install] подмена x.rpf: доступ закрыт, жду до 10 с…"]
        );
        assert!(run.lines[0].ends_with('\u{2026}'));
    }

    // ----- копирование (Пт115-Пт133) -----

    #[test]
    fn copy_with_hash_copies_bytes_hash_and_time() {
        let dir = sandbox();
        let (source, copy) = (dir.path().join("a.bin"), dir.path().join("b.bin"));
        write(&source, b"hello world");
        let mut calls = Vec::new();
        let hash = copy_with_hash(&source, &copy, &mut |done| calls.push(done)).unwrap();
        assert_eq!(hash, HELLO_SHA);
        assert_eq!(calls, [11]);
        assert_eq!(fs::read(&copy).unwrap(), b"hello world");
        assert_eq!(
            fs::metadata(&source).unwrap().modified().unwrap(),
            fs::metadata(&copy).unwrap().modified().unwrap()
        );

        // Пт119: назначение обрезается и перезаписывается
        write(&copy, &[b'x'; 100]);
        copy_with_hash(&source, &copy, &mut |_| {}).unwrap();
        assert_eq!(read(&copy), "hello world");

        // Пт117: пустой файл - copied не вызывается, хэш пустой строки
        let empty = dir.path().join("empty.bin");
        write(&empty, b"");
        let mut calls = Vec::new();
        let hash = copy_with_hash(&empty, &dir.path().join("e2.bin"), &mut |done| {
            calls.push(done)
        })
        .unwrap();
        assert_eq!(
            hash,
            "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"
        );
        assert!(calls.is_empty());
    }

    #[test]
    fn copy_with_hash_works_in_four_mebibyte_blocks() {
        let dir = sandbox();
        let (source, copy) = (dir.path().join("big.bin"), dir.path().join("big.copy"));
        let bytes: Vec<u8> = (0..9 * 1024 * 1024u32).map(|at| (at % 251) as u8).collect();
        write(&source, &bytes);
        let mut calls = Vec::new();
        let mut lengths = Vec::new();
        let hash = copy_with_hash(&source, &copy, &mut |done| {
            calls.push(done);
            lengths.push(fs::metadata(&copy).unwrap().len());
        })
        .unwrap();
        assert_eq!(calls, [4_194_304, 8_388_608, 9_437_184]);
        // место под всю копию занято до первого байта
        assert_eq!(lengths, [9_437_184; 3]);
        assert_eq!(fs::read(&copy).unwrap(), bytes);
        assert_eq!(hash, sha256_file(&source).unwrap().to_uppercase());
    }

    #[cfg(windows)]
    #[test]
    fn copy_with_hash_leaves_the_destination_as_the_failure_found_it() {
        let dir = sandbox();
        let (source, copy) = (dir.path().join("a.bin"), dir.path().join("b.bin"));
        write(&source, b"hello world");

        // Пт120: «только чтение» не переносится
        mark_readonly(&source).unwrap();
        assert_eq!(attributes(&source), 0x21);
        copy_with_hash(&source, &copy, &mut |_| {}).unwrap();
        assert_eq!(attributes(&copy), 0x20);
        clear_readonly(&source).unwrap();

        // Пт121-Пт122: источника нет, источник - каталог; назначение не создаётся
        let made = dir.path().join("made.bin");
        let message = refused_code(
            copy_with_hash(&dir.path().join("none"), &made, &mut |_| {}),
            "FileNotFoundException",
        );
        assert!(message.ends_with("(os error 2)"), "{message}");
        let message = refused_code(
            copy_with_hash(dir.path(), &made, &mut |_| {}),
            "UnauthorizedAccessException",
        );
        assert!(message.ends_with("(os error 5)"), "{message}");
        assert!(!made.exists());

        // Пт123: каталогов назначения не создаёт
        let message = refused_code(
            copy_with_hash(&source, &dir.path().join("no-dir").join("x"), &mut |_| {}),
            "FileNotFoundException",
        );
        assert!(message.ends_with("(os error 3)"), "{message}");

        // Пт124: назначение - каталог
        let message = refused_code(
            copy_with_hash(&source, dir.path(), &mut |_| {}),
            "UnauthorizedAccessException",
        );
        assert!(message.ends_with("(os error 5)"), "{message}");

        // Пт125: назначение только для чтения остаётся целым
        let kept = dir.path().join("kept.bin");
        write(&kept, b"keep");
        mark_readonly(&kept).unwrap();
        refused_code(
            copy_with_hash(&source, &kept, &mut |_| {}),
            "UnauthorizedAccessException",
        );
        assert_eq!(read(&kept), "keep");

        // Пт126: источник открыт без разделения - код 32, назначения нет
        let busy = dir.path().join("busy.bin");
        write(&busy, b"busy");
        let target = dir.path().join("from-busy");
        let hold = hold_exclusively(&busy);
        let message = refused_code(copy_with_hash(&busy, &target, &mut |_| {}), "IOException");
        drop(hold);
        assert!(message.ends_with("(os error 32)"), "{message}");
        assert!(!target.exists());
    }

    #[cfg(windows)]
    #[test]
    #[allow(unsafe_code)]
    fn a_failure_in_the_middle_leaves_no_stub_behind() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::LockFile;

        let dir = sandbox();
        let (source, copy) = (dir.path().join("locked.bin"), dir.path().join("stub.bin"));
        write(&source, &[7u8; 100]);
        let holder = File::open(&source).unwrap();
        // SAFETY: дескриптор живого файла, диапазон внутри файла.
        let locked = unsafe { LockFile(holder.as_raw_handle(), 0, 0, 100, 0) };
        assert_ne!(locked, 0, "блокировка диапазона не вышла");

        // Пт127: чтение даёт код 33, назначение уже создано и растянуто; после
        // отказа обломка нет
        let message = refused_code(copy_with_hash(&source, &copy, &mut |_| {}), "IOException");
        assert!(message.ends_with("(os error 33)"), "{message}");
        assert!(!copy.exists());

        // Назначение, которое было до вызова и уже усечено: его содержимое
        // потеряно ещё до отказа, обломок под его именем не остаётся
        write(&copy, b"older copy");
        refused_code(copy_with_hash(&source, &copy, &mut |_| {}), "IOException");
        assert!(!copy.exists());
        drop(holder);
    }

    #[test]
    fn copying_a_file_onto_itself_is_refused_before_any_write() {
        let dir = sandbox();
        let file = dir.path().join("f");
        write(&file, b"0123456789abcd");
        let mut calls = 0;
        let message = refused_code(
            copy_with_hash(&file, &file, &mut |_| calls += 1),
            "ArgumentException",
        );
        assert_eq!(
            message,
            format!(
                "Source and destination are the same file: {}",
                file.display()
            )
        );
        assert_eq!(calls, 0);
        assert_eq!(read(&file), "0123456789abcd");

        // другое написание того же пути
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let spelled = sub.join("..").join("f");
        refused_code(
            copy_with_hash(&file, &spelled, &mut |_| {}),
            "ArgumentException",
        );
        assert_eq!(read(&file), "0123456789abcd");

        // второе имя того же файла (жёсткая ссылка)
        let linked = dir.path().join("linked");
        fs::hard_link(&file, &linked).unwrap();
        refused_code(
            copy_with_hash(&file, &linked, &mut |_| {}),
            "ArgumentException",
        );
        assert_eq!(read(&file), "0123456789abcd");
        assert_eq!(read(&linked), "0123456789abcd");

        // с проверкой перечитыванием отказ тот же, файл остаётся
        refused_code(
            copy_verified(&file, &linked, &mut |_| {}),
            "ArgumentException",
        );
        assert_eq!(read(&file), "0123456789abcd");
        assert_eq!(read(&linked), "0123456789abcd");

        // два разных файла с тем же содержимым копируются как обычно
        let other = dir.path().join("other");
        write(&other, b"0123456789abcd");
        copy_with_hash(&file, &other, &mut |_| {}).unwrap();
        assert_eq!(read(&other), "0123456789abcd");
    }

    #[test]
    fn copy_verified_rereads_and_cleans_up_after_any_failure() {
        let dir = sandbox();
        let (source, copy) = (dir.path().join("a.bin"), dir.path().join("cv.bin"));
        write(&source, b"hello world");

        // Пт129
        let mut calls = Vec::new();
        let hash = copy_verified(&source, &copy, &mut |done| calls.push(done)).unwrap();
        assert_eq!(hash, HELLO_SHA);
        assert_eq!(calls, [11]);
        assert!(copy.exists());

        // Пт130: источника нет - обломка нет
        let other = dir.path().join("c.bin");
        refused_code(
            copy_verified(&dir.path().join("none"), &other, &mut |_| {}),
            "FileNotFoundException",
        );
        assert!(!other.exists());

        // Пт131: кто-то меняет первый байт копии во время копирования
        let tampered = dir.path().join("tamper.bin");
        let target = tampered.clone();
        let message = refused_code(
            copy_verified(&source, &tampered, &mut |_| {
                let mut file = OpenOptions::new().write(true).open(&target).unwrap();
                file.write_all(b"X").unwrap();
            }),
            "IOException",
        );
        assert_eq!(
            message,
            format!(
                "Копия {} не совпала с источником после записи на диск.",
                tampered.display()
            )
        );
        assert!(!tampered.exists());
    }

    #[cfg(windows)]
    #[test]
    fn copy_verified_keeps_a_destination_it_could_not_open_for_writing() {
        let dir = sandbox();
        let source = dir.path().join("a.bin");
        write(&source, b"hello world");

        // Пт132: назначение только для чтения не открылось для записи - оно
        // остаётся как было, с прежним содержимым и признаком
        let locked = dir.path().join("ro.bin");
        write(&locked, b"foreign");
        mark_readonly(&locked).unwrap();
        refused_code(
            copy_verified(&source, &locked, &mut |_| {}),
            "UnauthorizedAccessException",
        );
        assert_eq!(read(&locked), "foreign");
        assert_eq!(attributes(&locked), 0x21);

        // занятое назначение (код 32) тоже остаётся
        let busy = dir.path().join("busy.bin");
        write(&busy, b"busy");
        let hold = hold_exclusively(&busy);
        let message = refused_code(copy_verified(&source, &busy, &mut |_| {}), "IOException");
        drop(hold);
        assert!(message.ends_with("(os error 32)"), "{message}");
        assert_eq!(read(&busy), "busy");

        // Пт133: назначение - каталог; удаление через remove_file молчит
        let folder = dir.path().join("folder");
        fs::create_dir(&folder).unwrap();
        refused_code(
            copy_verified(&source, &folder, &mut |_| {}),
            "UnauthorizedAccessException",
        );
        assert!(folder.is_dir());
    }

    #[test]
    fn flush_to_disk_keeps_the_file_and_refuses_what_it_cannot_open_for_writing() {
        let dir = sandbox();
        let file = dir.path().join("x");
        write(&file, b"x");
        flush_to_disk(&file).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"x");
        assert_eq!(
            flush_to_disk(&dir.path().join("none")).unwrap_err().kind(),
            ErrorKind::NotFound
        );
        mark_readonly(&file).unwrap();
        assert_eq!(
            flush_to_disk(&file).unwrap_err().kind(),
            ErrorKind::PermissionDenied
        );
        clear_readonly(&file).unwrap();
        #[cfg(windows)]
        assert_eq!(
            flush_to_disk(dir.path()).unwrap_err().kind(),
            ErrorKind::PermissionDenied
        );
    }

    // ----- отпечаток и «только чтение» (Пт139-Пт152) -----

    #[test]
    fn a_stamp_notices_a_changed_length_or_time() {
        let dir = sandbox();
        let file = dir.path().join("s");
        write(&file, b"abc");
        let first = stamp(&file).unwrap();
        assert_eq!(first.len, 3);
        assert!(first.modified.is_some());
        assert_eq!(stamp(&file).unwrap(), first);

        // та же длина, время изменения +5 с
        let handle = OpenOptions::new().write(true).open(&file).unwrap();
        handle
            .set_modified(first.modified.unwrap() + Duration::from_secs(5))
            .unwrap();
        drop(handle);
        let later = stamp(&file).unwrap();
        assert_eq!(later.len, 3);
        assert_ne!(later, first);

        write(&file, b"abcd");
        assert_ne!(stamp(&file).unwrap().len, 3);

        assert_eq!(
            stamp(&dir.path().join("none")).unwrap_err().kind(),
            ErrorKind::NotFound
        );
        assert_eq!(stamp(dir.path()).unwrap().len, 0);

        // Пт144: Clone, Copy, Debug, PartialEq, Eq
        let value = Stamp {
            len: 1,
            modified: None,
        };
        let copied = value;
        assert_eq!(value, copied);
        assert!(format!("{value:?}").contains("len: 1"));
    }

    #[test]
    fn readonly_flag_is_set_and_cleared_alone() {
        let dir = sandbox();
        let file = dir.path().join("r");
        write(&file, b"r");
        assert!(!clear_readonly(&file).unwrap());
        mark_readonly(&file).unwrap();
        mark_readonly(&file).unwrap();
        assert!(fs::metadata(&file).unwrap().permissions().readonly());
        assert!(clear_readonly(&file).unwrap());
        assert!(!fs::metadata(&file).unwrap().permissions().readonly());
        // нет файла: clear - Ok(false), mark - ошибка; у каталога бита нет
        assert!(!clear_readonly(&dir.path().join("none")).unwrap());
        assert_eq!(
            mark_readonly(&dir.path().join("none")).unwrap_err().kind(),
            ErrorKind::NotFound
        );
        assert!(!clear_readonly(dir.path()).unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn other_attributes_survive_the_readonly_flag() {
        use std::os::windows::process::CommandExt;
        let dir = sandbox();
        let file = dir.path().join("plain");
        write(&file, b"p");
        assert_eq!(attributes(&file), 0x20);
        mark_readonly(&file).unwrap();
        assert_eq!(attributes(&file), 0x21);
        clear_readonly(&file).unwrap();
        // скрытый файл: 0x22 -> 0x23 -> 0x22
        let hidden = dir.path().join("hidden");
        write(&hidden, b"h");
        let status = std::process::Command::new("attrib")
            .arg("+h")
            .arg(&hidden)
            .creation_flags(0x0800_0000)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(attributes(&hidden), 0x22);
        mark_readonly(&hidden).unwrap();
        assert_eq!(attributes(&hidden), 0x23);
        clear_readonly(&hidden).unwrap();
        assert_eq!(attributes(&hidden), 0x22);
    }

    // ----- соседний файл, подмена, возврат (Пт153-Пт187) -----

    struct Pair {
        dir: TempDir,
        backup: PathBuf,
        live: PathBuf,
    }

    fn pair() -> Pair {
        let dir = sandbox();
        let backup = dir.path().join("backup.rpf");
        let live = dir.path().join("live.rpf");
        write(&backup, POINT_COPY.as_bytes());
        write(&live, b"live");
        Pair { dir, backup, live }
    }

    #[test]
    fn a_hard_link_is_taken_without_checking_the_hash() {
        let pair = pair();
        let good = sha_text(POINT_COPY);
        let mut copied = Vec::new();
        let sibling = prepare_sibling(&pair.backup, &pair.live, &good, &mut |done| {
            copied.push(done)
        })
        .unwrap();
        assert_eq!(sibling, pair.dir.path().join("live.rpf.astral-restore"));
        assert!(copied.is_empty());
        assert_eq!(read(&sibling), "point copy");
        assert_eq!(read(&pair.live), "live");
        // Пт154: запись в соседа видна в копии точки - это одна и та же ссылка
        write(&sibling, b"X");
        assert_eq!(read(&pair.backup), "X");
        write(&pair.backup, b"point copy");
        // Пт155: заведомо неверный хэш при ссылке не сверяется
        let again = prepare_sibling(&pair.backup, &pair.live, "00", &mut |_| {}).unwrap();
        assert_eq!(again, sibling);
        // Пт161-Пт162: старый сосед (в том числе только для чтения) убирается заранее
        replace(&sibling, b"stale");
        mark_readonly(&sibling).unwrap();
        prepare_sibling(&pair.backup, &pair.live, &good, &mut |_| {}).unwrap();
        assert_eq!(read(&sibling), "point copy");
    }

    #[test]
    fn without_the_link_the_copy_is_checked_against_the_manifest_hash() {
        let pair = pair();
        let good = sha_text(POINT_COPY);
        let sibling_path = pair.dir.path().join("live.rpf.astral-restore");

        // Пт156-Пт157: копирование с проверкой перечитыванием, копия независима
        let mut copied = Vec::new();
        let sibling = prepare_sibling_with(
            &pair.backup,
            &pair.live,
            &good,
            &mut |done| copied.push(done),
            false,
        )
        .unwrap();
        assert_eq!(sibling, sibling_path);
        assert_eq!(copied, [10]);
        write(&sibling, b"X");
        assert_eq!(read(&pair.backup), "point copy");

        // Пт158: хэш строчными
        prepare_sibling_with(
            &pair.backup,
            &pair.live,
            &good.to_lowercase(),
            &mut |_| {},
            false,
        )
        .unwrap();

        // Пт159-Пт160: неверный и пустой хэш; сосед удаляется, живой цел
        for wrong in ["AB", ""] {
            refused(
                prepare_sibling_with(&pair.backup, &pair.live, wrong, &mut |_| {}, false),
                "InvalidDataException",
                &format!(
                    "Резервная копия {} не совпала с описью точки.",
                    pair.backup.display()
                ),
            );
            assert!(!sibling_path.exists());
            assert_eq!(read(&pair.live), "live");
        }
    }

    #[test]
    fn the_sibling_needs_a_copy_and_a_folder_but_no_live_file() {
        let pair = pair();
        let good = sha_text(POINT_COPY);
        // Пт163: копии точки нет
        let missing = pair.dir.path().join("none.rpf");
        refused_code(
            prepare_sibling(&missing, &pair.live, &good, &mut |_| {}),
            "FileNotFoundException",
        );
        assert!(!pair.dir.path().join("live.rpf.astral-restore").exists());
        // Пт164: нет каталога живого файла
        refused_code(
            prepare_sibling(
                &pair.backup,
                &pair.dir.path().join("no-dir").join("live.rpf"),
                &good,
                &mut |_| {},
            ),
            "FileNotFoundException",
        );
        // Пт165: живого файла нет, каталог есть
        let fresh = pair.dir.path().join("fresh.rpf");
        let sibling = prepare_sibling(&pair.backup, &fresh, &good, &mut |_| {}).unwrap();
        assert_eq!(sibling, pair.dir.path().join("fresh.rpf.astral-restore"));
        assert_eq!(read(&sibling), "point copy");
    }

    #[test]
    fn swap_in_replaces_in_one_rename_and_keeps_the_readonly_flag() {
        let dir = sandbox();
        let (fresh, live) = (dir.path().join("fresh.rpf"), dir.path().join("live.rpf"));
        write(&fresh, b"new");
        write(&live, b"old");
        // Пт166
        swap_in(&fresh, &live).unwrap();
        assert_eq!(read(&live), "new");
        assert!(!fresh.exists());
        assert_eq!(fs::metadata(&live).unwrap().len(), 3);

        // Пт167: флаг снимается на время подмены и ставится на новый файл
        write(&fresh, b"new2");
        mark_readonly(&live).unwrap();
        swap_in(&fresh, &live).unwrap();
        assert_eq!(read(&live), "new2");
        assert!(fs::metadata(&live).unwrap().permissions().readonly());
        clear_readonly(&live).unwrap();

        // Пт168: живого файла нет
        let gone = dir.path().join("gone.rpf");
        write(&fresh, b"x");
        swap_in(&fresh, &gone).unwrap();
        assert_eq!(read(&gone), "x");
        assert!(!fs::metadata(&gone).unwrap().permissions().readonly());

        // Пт169-Пт170: источника нет; NotFound не повторяется, флаг возвращается
        let none = dir.path().join("none.rpf");
        assert_eq!(
            swap_in(&none, &live).unwrap_err().kind(),
            ErrorKind::NotFound
        );
        assert_eq!(read(&live), "new2");
        mark_readonly(&live).unwrap();
        assert_eq!(
            swap_in(&none, &live).unwrap_err().kind(),
            ErrorKind::NotFound
        );
        assert!(fs::metadata(&live).unwrap().permissions().readonly());
    }

    #[cfg(windows)]
    #[test]
    fn rename_with_retry_waits_for_a_busy_file() {
        use std::sync::mpsc;
        use std::time::Instant;

        let dir = sandbox();

        // Пт173-Пт175
        let (from, to) = (dir.path().join("from"), dir.path().join("to"));
        write(&from, b"new");
        write(&to, b"old");
        rename_with_retry(&from, &to).unwrap();
        assert_eq!(read(&to), "new");
        assert!(!from.exists());
        assert_eq!(
            rename_with_retry(&from, &to).unwrap_err().kind(),
            ErrorKind::NotFound
        );
        write(&from, b"again");
        let no_folder = dir.path().join("no-folder").join("x");
        let error = rename_with_retry(&from, &no_folder).unwrap_err();
        assert_eq!(
            (error.kind(), error.raw_os_error()),
            (ErrorKind::NotFound, Some(3))
        );

        // Пт178, Пт182: назначение занято чуть больше секунды - код 5, ждём и успеваем
        let target = dir.path().join("ёж.bin");
        write(&target, b"old");
        let (ready, started) = mpsc::channel();
        let holder = {
            let target = target.clone();
            std::thread::spawn(move || {
                let hold = hold_exclusively(&target);
                ready.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(1200));
                drop(hold);
            })
        };
        started.recv().unwrap();
        let begun = Instant::now();
        write(&from, b"fresh");
        rename_with_retry(&from, &target).unwrap();
        let took = begun.elapsed();
        holder.join().unwrap();
        assert_eq!(read(&target), "fresh");
        assert!(
            took >= Duration::from_millis(900) && took < Duration::from_secs(5),
            "{took:?}"
        );

        // Пт181: занят источник (код 32) - ждём так же
        let source = dir.path().join("src.bin");
        write(&source, b"payload");
        let (ready, started) = mpsc::channel();
        let holder = {
            let source = source.clone();
            std::thread::spawn(move || {
                let hold = hold_exclusively(&source);
                ready.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(1000));
                drop(hold);
            })
        };
        started.recv().unwrap();
        let destination = dir.path().join("dst.bin");
        rename_with_retry(&source, &destination).unwrap();
        holder.join().unwrap();
        assert_eq!(read(&destination), "payload");
    }

    #[cfg(windows)]
    #[test]
    fn swap_in_gives_up_on_a_folder_in_place_of_the_live_file_after_ten_seconds() {
        use std::time::Instant;
        // Пт171: код 5 повторяется 10 с, затем отказ; источник остаётся
        let pair = pair();
        let folder = pair.dir.path().join("subd");
        fs::create_dir(&folder).unwrap();
        let fresh = pair.dir.path().join("fresh");
        write(&fresh, b"x");
        let begun = Instant::now();
        let error = swap_in(&fresh, &folder).unwrap_err();
        assert_eq!(
            (error.kind(), error.raw_os_error()),
            (ErrorKind::PermissionDenied, Some(5))
        );
        assert!(begun.elapsed() >= Duration::from_secs(9));
        assert!(fresh.exists());
    }

    #[cfg(windows)]
    #[test]
    fn put_back_removes_its_sibling_when_the_swap_is_refused() {
        use std::time::Instant;
        // Пт187: на месте живого файла каталог - отказ после 10 с, сосед убран
        let pair = pair();
        let folder = pair.dir.path().join("sub5");
        fs::create_dir(&folder).unwrap();
        let begun = Instant::now();
        refused_code(
            put_back(&pair.backup, &folder, &sha_text(POINT_COPY)),
            "UnauthorizedAccessException",
        );
        assert!(begun.elapsed() >= Duration::from_secs(9));
        assert!(!pair.dir.path().join("sub5.astral-restore").exists());
        assert_eq!(read(&pair.backup), "point copy");
    }

    #[test]
    fn put_back_gives_the_live_file_the_point_copy_and_keeps_the_copy() {
        let pair = pair();
        let good = sha_text(POINT_COPY);
        // Пт183
        put_back(&pair.backup, &pair.live, &good).unwrap();
        assert_eq!(read(&pair.live), "point copy");
        assert_eq!(read(&pair.backup), "point copy");
        assert!(!pair.dir.path().join("live.rpf.astral-restore").exists());
        // Пт184: хэш при ссылке не сверяется
        replace(&pair.live, b"again");
        put_back(&pair.backup, &pair.live, "00").unwrap();
        assert_eq!(read(&pair.live), "point copy");
        // Пт185: флаг переходит на новый файл
        replace(&pair.live, b"ro");
        mark_readonly(&pair.live).unwrap();
        put_back(&pair.backup, &pair.live, &good).unwrap();
        assert!(fs::metadata(&pair.live).unwrap().permissions().readonly());
        assert_eq!(read(&pair.live), "point copy");
        clear_readonly(&pair.live).unwrap();
        // Пт186: копии точки нет
        replace(&pair.live, b"keep");
        refused_code(
            put_back(&pair.dir.path().join("none"), &pair.live, &good),
            "FileNotFoundException",
        );
        assert_eq!(read(&pair.live), "keep");
    }

    // ----- запись описи (Пт188-Пт199) -----

    fn item(relative: &str, live: &str, backup: &str, before: &str, after: &str) -> BackupItem {
        BackupItem {
            relative_path: relative.to_owned(),
            live_path: PathBuf::from(live),
            backup_path: PathBuf::from(backup),
            sha256_before: before.to_owned(),
            sha256_after: after.to_owned(),
        }
    }

    /// Пишет опись `(id, корень игры, патч)` и отдаёт её текст, как он лёг на диск.
    fn manifest_of(
        dir: &Path,
        (id, game, patch): (&str, &str, &str),
        items: &[BackupItem],
    ) -> String {
        write_manifest(dir, id, Path::new(game), Path::new(patch), items).unwrap();
        read(&dir.join("restore.json"))
    }

    fn is_iso_offset(text: &str) -> bool {
        let bytes = text.as_bytes();
        bytes.len() == 33
            && text.ends_with("+00:00")
            && bytes[10] == b'T'
            && bytes[19] == b'.'
            && bytes[20..27].iter().all(u8::is_ascii_digit)
    }

    /// Текст описи, в котором `createdAt` заменён пометкой; форма времени проверена.
    fn with_time_masked(text: &str) -> String {
        let marked: Vec<String> = text
            .split('\n')
            .map(|line| {
                if let Some(rest) = line.strip_prefix("  \"createdAt\": \"") {
                    let time = rest.strip_suffix("\",").expect("запятая после createdAt");
                    assert!(is_iso_offset(time), "{time}");
                    "  \"createdAt\": \"<time>\",".to_owned()
                } else {
                    line.to_owned()
                }
            })
            .collect();
        marked.join("\n")
    }

    #[cfg(windows)]
    #[test]
    fn the_manifest_text_is_the_documented_one_byte_for_byte() {
        let dir = sandbox();
        let id = "rpf-20261017-130509-0123456789abcdef01";
        let a = "A".repeat(64);
        let b = "B".repeat(64);
        let items = [item(
            "update/update.rpf",
            r"C:\Games\GTA V\update\update.rpf",
            &format!(r"C:\cache\points\{id}\update/update.rpf"),
            &a,
            &b,
        )];
        write_manifest(
            dir.path(),
            id,
            Path::new(r"C:\Games\GTA V"),
            Path::new(r"C:\patches\my patch"),
            &items,
        )
        .unwrap();
        let bytes = fs::read(dir.path().join("restore.json")).unwrap();
        assert_eq!(bytes.len(), 608);
        assert_eq!(
            &bytes[..40],
            &[
                0x7B, 0x0A, 0x20, 0x20, 0x22, 0x73, 0x63, 0x68, 0x65, 0x6D, 0x61, 0x56, 0x65, 0x72,
                0x73, 0x69, 0x6F, 0x6E, 0x22, 0x3A, 0x20, 0x32, 0x2C, 0x0A, 0x20, 0x20, 0x22, 0x69,
                0x64, 0x22, 0x3A, 0x20, 0x22, 0x72, 0x70, 0x66, 0x2D, 0x32, 0x30, 0x32
            ]
        );
        assert_eq!(
            &bytes[bytes.len() - 12..],
            &[0x0A, 0x20, 0x20, 0x20, 0x20, 0x7D, 0x0A, 0x20, 0x20, 0x5D, 0x0A, 0x7D]
        );
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains('\r') && !text.ends_with('\n') && text.is_ascii());
        let expected = format!(
            r#"{{
  "schemaVersion": 2,
  "id": "{id}",
  "createdAt": "<time>",
  "gameRoot": "C:\\Games\\GTA V",
  "patch": "C:\\patches\\my patch",
  "archives": [
    {{
      "relativePath": "update/update.rpf",
      "livePath": "C:\\Games\\GTA V\\update\\update.rpf",
      "backupPath": "C:\\cache\\points\\{id}\\update/update.rpf",
      "sha256Before": "{a}",
      "sha256After": "{b}"
    }}
  ]
}}"#
        );
        assert_eq!(with_time_masked(&text), expected);
        assert!(!dir.path().join("restore.json.tmp").exists());
    }

    #[test]
    fn non_ascii_quotes_and_control_characters_are_escaped_like_the_host_does() {
        let dir = sandbox();
        let live = format!("C:\\Игры\\GTA V\\update\\{}tab\there.rpf", '\u{1f}');
        let items = [item(
            "update/ёж😀.rpf",
            &live,
            "C:\\p\\\"quoted\"\\x.rpf",
            "",
            "cc",
        )];
        let text = manifest_of(dir.path(), ("rpf-ё", r"C:\Игры\GTA V", r"C:\патч"), &items);
        assert!(text.is_ascii());
        let expected = r##"{
  "schemaVersion": 2,
  "id": "rpf-\u0451",
  "createdAt": "<time>",
  "gameRoot": "C:\\\u0418\u0433\u0440\u044B\\GTA V",
  "patch": "C:\\\u043F\u0430\u0442\u0447",
  "archives": [
    {
      "relativePath": "update/\u0451\u0436\uD83D\uDE00.rpf",
      "livePath": "C:\\\u0418\u0433\u0440\u044B\\GTA V\\update\\\u001ftab\there.rpf",
      "backupPath": "C:\\p\\\"quoted\"\\x.rpf",
      "sha256Before": "",
      "sha256After": "cc"
    }
  ]
}"##;
        assert_eq!(with_time_masked(&text), expected);
        // DEL (0x7F) - ASCII и остаётся байтом
        write_manifest(dir.path(), "x", Path::new("/g\u{7f}"), Path::new("/p"), &[]).unwrap();
        assert!(fs::read(dir.path().join("restore.json"))
            .unwrap()
            .contains(&0x7f));
    }

    #[test]
    fn empty_lists_and_the_order_of_items_are_kept() {
        let dir = sandbox();
        let text = manifest_of(dir.path(), ("rpf-x", "/g", "/p"), &[]);
        assert_eq!(
            with_time_masked(&text),
            "{\n  \"schemaVersion\": 2,\n  \"id\": \"rpf-x\",\n  \"createdAt\": \"<time>\",\n  \"gameRoot\": \"/g\",\n  \"patch\": \"/p\",\n  \"archives\": []\n}"
        );

        let two = [
            item("common.rpf", "/g/common.rpf", "/p/common.rpf", "", "BB"),
            item(
                "update/update.rpf",
                "/g/update/update.rpf",
                "/p/update/update.rpf",
                "AA",
                "",
            ),
        ];
        let text = manifest_of(dir.path(), ("rpf-two", "/g", "/patch"), &two);
        let first = text.find("\"relativePath\": \"common.rpf\",").unwrap();
        let second = text
            .find("\"relativePath\": \"update/update.rpf\",")
            .unwrap();
        assert!(first < second);
        assert!(text.contains("\"sha256Before\": \"\",\n      \"sha256After\": \"BB\""));
        assert!(text.contains("\"sha256Before\": \"AA\",\n      \"sha256After\": \"\""));
        assert!(!dir.path().join("restore.json.tmp").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_lone_surrogate_in_a_path_becomes_the_replacement_character() {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        let dir = sandbox();
        let wide: Vec<u16> = "C:\\"
            .encode_utf16()
            .chain([0xD800])
            .chain("x".encode_utf16())
            .collect();
        let root = PathBuf::from(OsString::from_wide(&wide));
        write_manifest(dir.path(), "x", &root, Path::new("/p"), &[]).unwrap();
        let text = read(&dir.path().join("restore.json"));
        assert!(text.contains("\"gameRoot\": \"C:\\\\\\uFFFDx\","), "{text}");
    }

    #[test]
    fn a_new_manifest_replaces_the_old_one_and_a_missing_folder_is_not_created() {
        let dir = sandbox();
        // Пт195
        write(&dir.path().join("restore.json"), &[b'o'; 148]);
        write(&dir.path().join("restore.json.tmp"), &[b't'; 300]);
        write_manifest(dir.path(), "rpf-x", Path::new("/g"), Path::new("/p"), &[]).unwrap();
        assert!(read(&dir.path().join("restore.json")).starts_with('{'));
        assert!(!dir.path().join("restore.json.tmp").exists());
        // Пт196
        let missing = dir.path().join("no-point");
        refused_code(
            write_manifest(&missing, "x", Path::new("/g"), Path::new("/p"), &[]),
            "FileNotFoundException",
        );
        assert!(!missing.exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_temporary_name_taken_by_a_folder_refuses_at_once_and_the_folder_stays() {
        use std::time::Instant;
        let dir = sandbox();
        fs::create_dir(dir.path().join("restore.json.tmp")).unwrap();
        let begun = Instant::now();
        let message = refused_code(
            write_manifest(dir.path(), "x", Path::new("/g"), Path::new("/p"), &[]),
            "UnauthorizedAccessException",
        );
        assert!(message.ends_with("(os error 5)"));
        assert!(begun.elapsed() < Duration::from_secs(2));
        assert!(dir.path().join("restore.json.tmp").is_dir());
        assert!(!dir.path().join("restore.json").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_manifest_name_taken_by_a_folder_is_waited_for_ten_seconds() {
        use std::time::Instant;
        // Пт198: restore.json - каталог; tmp убирается
        let dir = sandbox();
        fs::create_dir(dir.path().join("restore.json")).unwrap();
        let begun = Instant::now();
        refused_code(
            write_manifest(dir.path(), "x", Path::new("/g"), Path::new("/p"), &[]),
            "UnauthorizedAccessException",
        );
        assert!(begun.elapsed() >= Duration::from_secs(9));
        assert!(dir.path().join("restore.json").is_dir());
        assert!(!dir.path().join("restore.json.tmp").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_readonly_manifest_is_not_overwritten_and_the_old_text_survives() {
        use std::time::Instant;
        // Пт199: флаг не снимается: 10 с ожидания и отказ, старая опись цела
        let dir = sandbox();
        let old = dir.path().join("restore.json");
        write(&old, b"OLD-RO");
        mark_readonly(&old).unwrap();
        let begun = Instant::now();
        refused_code(
            write_manifest(dir.path(), "x", Path::new("/g"), Path::new("/p"), &[]),
            "UnauthorizedAccessException",
        );
        assert!(begun.elapsed() >= Duration::from_secs(9));
        assert_eq!(read(&old), "OLD-RO");
        assert!(!dir.path().join("restore.json.tmp").exists());
        clear_readonly(&old).unwrap();
    }

    // ----- чтение описи (Пт200-Пт231) -----

    const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

    fn manifest_file(dir: &TempDir, content: &[u8]) -> PathBuf {
        let file = dir.path().join("restore.json");
        write(&file, content);
        file
    }

    /// Описание прочитанной описи: корень игры и записи «путь|до|после».
    fn digest(manifest: &RestoreManifest) -> String {
        let archives: Vec<String> = manifest
            .archives
            .iter()
            .map(|entry| {
                format!(
                    "{}|{}|{:?}",
                    entry.relative_path, entry.sha256_before, entry.sha256_after
                )
            })
            .collect();
        format!("{}#{}", manifest.game_root, archives.join(";"))
    }

    fn parsed(content: &str) -> String {
        let dir = sandbox();
        digest(&read_manifest(&manifest_file(&dir, content.as_bytes())).unwrap())
    }

    fn broken(content: &[u8]) -> (String, String) {
        let dir = sandbox();
        match read_manifest(&manifest_file(&dir, content)) {
            Ok(_) => panic!("ожидался отказ"),
            Err(error) => (error.code, error.message),
        }
    }

    #[test]
    fn a_written_manifest_reads_back() {
        let dir = sandbox();
        let items = [item(
            "update/update.rpf",
            r"C:\Games\GTA V\update\update.rpf",
            "x",
            &"A".repeat(64),
            &"B".repeat(64),
        )];
        write_manifest(
            dir.path(),
            "rpf-x",
            Path::new(r"C:\Games\GTA V"),
            Path::new("p"),
            &items,
        )
        .unwrap();
        let manifest = read_manifest(&dir.path().join("restore.json")).unwrap();
        assert_eq!(
            digest(&manifest),
            format!(
                "C:\\Games\\GTA V#update/update.rpf|{}|Some(\"{}\")",
                "A".repeat(64),
                "B".repeat(64)
            )
        );
    }

    #[test]
    fn the_reader_is_forgiving_about_case_bom_and_missing_fields() {
        assert_eq!(parsed("{}"), "#");
        assert_eq!(
            parsed(
                r#"{"GAMEROOT":"C:\\g","ARCHIVES":[{"RELATIVEPATH":"u.rpf","SHA256BEFORE":"AA","SHA256AFTER":"BB"}]}"#
            ),
            "C:\\g#u.rpf|AA|Some(\"BB\")"
        );
        // Пт203-Пт204: срезаются все ведущие BOM
        let dir = sandbox();
        for bom_count in [1, 2] {
            let mut content = BOM.repeat(bom_count);
            content.extend_from_slice(br#"{"gameRoot":"x"}"#);
            let file = manifest_file(&dir, &content);
            assert_eq!(digest(&read_manifest(&file).unwrap()), "x#");
        }
        assert_eq!(parsed(r#"{"gameRoot":"g","archives":5}"#), "g#");
        assert_eq!(parsed(r#"{"gameRoot":"g","archives":null}"#), "g#");
        assert_eq!(parsed(r#"{"gameRoot":5}"#), "#");
        assert_eq!(
            parsed(r#"{"schemaVersion":99,"id":5,"createdAt":null}"#),
            "#"
        );
        // Пт222-Пт223: первое по порядку при разном регистре, последнее при одинаковом
        assert_eq!(
            parsed(r#"{"gameRoot":"first","GAMEROOT":"second"}"#),
            "first#"
        );
        assert_eq!(
            parsed(r#"{"gameRoot":"first","gameRoot":"second"}"#),
            "second#"
        );
        // Пт224-Пт225: escape-последовательности JSON и UTF-8
        assert_eq!(
            parsed(
                r#"{"gameRoot":"C:\\\u0418\u0433\u0440\u044b","archives":[{"relativePath":"\ud83d\ude00.rpf"}]}"#
            ),
            "C:\\Игры#😀.rpf||None"
        );
        assert_eq!(parsed("{\"gameRoot\":\"C:\\\\Игры\"}"), "C:\\Игры#");
    }

    #[test]
    fn entries_default_to_empty_strings_and_a_blank_after_hash_is_none() {
        assert_eq!(parsed(r#"{"archives":[{}]}"#), "#||None");
        for after in [r#""   ""#, r#""""#, "null", "7"] {
            assert_eq!(
                parsed(&format!(r#"{{"archives":[{{"sha256After":{after}}}]}}"#)),
                "#||None",
                "{after}"
            );
        }
        // значение не обрезается
        assert_eq!(
            parsed(r#"{"archives":[{"sha256After":" ab "}]}"#),
            "#||Some(\" ab \")"
        );
        assert_eq!(
            parsed(r#"{"archives":[{"sha256Before":7,"relativePath":false}]}"#),
            "#||None"
        );
    }

    #[test]
    fn the_created_folders_key_is_written_last_and_only_when_there_are_folders() {
        let dir = sandbox();
        let folders = ["update/x64".to_owned(), "update/x64/\u{0451}".to_owned()];
        write_manifest_with(
            dir.path(),
            "rpf-x",
            Path::new("/g"),
            Path::new("/p"),
            &[],
            &folders,
        )
        .unwrap();
        let text = read(&dir.path().join("restore.json"));
        assert!(text.is_ascii() && !text.ends_with('\n'));
        assert!(
            text.ends_with(
                "  \"archives\": [],\n  \"createdDirectories\": [\n    \"update/x64\",\n    \"update/x64/\\u0451\"\n  ]\n}"
            ),
            "{text}"
        );
        // назад читается так, как записано, и без учёта регистра имени ключа
        let manifest = read_manifest(&dir.path().join("restore.json")).unwrap();
        assert_eq!(manifest.created_directories, folders);
        let file = manifest_file(&dir, br#"{"CREATEDDIRECTORIES":["a","b/c"]}"#);
        assert_eq!(
            read_manifest(&file).unwrap().created_directories,
            ["a", "b/c"]
        );

        // ничего не создано: ключа нет совсем, опись та же, что у `write_manifest`
        let plain = sandbox();
        let items = [item("u.rpf", "/g/u.rpf", "/p/u.rpf", "AA", "BB")];
        write_manifest(
            plain.path(),
            "rpf-x",
            Path::new("/g"),
            Path::new("/p"),
            &items,
        )
        .unwrap();
        let first = read(&plain.path().join("restore.json"));
        write_manifest_with(
            plain.path(),
            "rpf-x",
            Path::new("/g"),
            Path::new("/p"),
            &items,
            &[],
        )
        .unwrap();
        let second = read(&plain.path().join("restore.json"));
        assert!(!first.contains("createdDirectories"));
        assert_eq!(with_time_masked(&first), with_time_masked(&second));
        assert!(read_manifest(&plain.path().join("restore.json"))
            .unwrap()
            .created_directories
            .is_empty());

        // не список или не строки внутри: папок как будто нет
        for wrong in [
            r#"{"createdDirectories":null}"#,
            r#"{"createdDirectories":"a"}"#,
            r#"{"createdDirectories":{"a":1}}"#,
        ] {
            let file = manifest_file(&dir, wrong.as_bytes());
            assert!(read_manifest(&file).unwrap().created_directories.is_empty());
        }
        let file = manifest_file(&dir, br#"{"createdDirectories":[5,"a",null,true]}"#);
        assert_eq!(read_manifest(&file).unwrap().created_directories, ["a"]);
    }

    // ----- созданные файлы (createdFiles, проект редуксов R1) -----

    const DLC_PATH: &str = "update/x64/dlcpacks/astral_redux_ab12cd34/dlc.rpf";
    const DLC_DIR: &str = "update/x64/dlcpacks/astral_redux_ab12cd34";

    fn append_item(record: u64) -> AppendItem {
        AppendItem {
            live_path: PathBuf::from("/g/update/update.rpf"),
            relative_path: "update/update.rpf".to_owned(),
            record,
            fingerprint_before: String::new(),
            fingerprint_after: String::new(),
            chain_base: String::new(),
        }
    }

    fn dlc(path: &str, bytes: u64, fill: char) -> CreatedFile {
        CreatedFile {
            path: path.to_owned(),
            bytes,
            sha256: fill.to_string().repeat(64),
        }
    }

    #[test]
    fn the_created_files_key_is_written_after_the_folders_and_reads_back() {
        let dir = sandbox();
        let files = [dlc(DLC_PATH, 1234, 'A')];
        let folders = [DLC_DIR.to_owned()];
        write_append_manifest_with(
            dir.path(),
            "rpf-x",
            Path::new("/g"),
            Path::new("/p"),
            &append_item(7),
            &files,
            &folders,
        )
        .unwrap();
        let text = read(&dir.path().join("restore.json"));
        assert!(text.is_ascii() && !text.ends_with('\n'));
        let tail = format!(
            "    }}\n  ],\n  \"createdDirectories\": [\n    \"{DLC_DIR}\"\n  ],\n  \"createdFiles\": [\n    {{\n      \"path\": \"{DLC_PATH}\",\n      \"bytes\": 1234,\n      \"sha256\": \"{}\"\n    }}\n  ]\n}}",
            "A".repeat(64)
        );
        assert!(text.ends_with(&tail), "{text}");
        // назад читается так, как записано, и точка дозаписи на месте
        let manifest = read_manifest(&dir.path().join("restore.json")).unwrap();
        assert_eq!(manifest.created_files, files);
        assert_eq!(manifest.created_directories, folders);
        assert_eq!(manifest.archives.len(), 1);
        assert_eq!(manifest.archives[0].append.as_ref().unwrap().record, 7);

        // без учёта регистра имени ключа
        let file = manifest_file(
            &dir,
            format!(
                r#"{{"CREATEDFILES":[{{"PATH":"{DLC_PATH}","BYTES":5,"SHA256":"{}"}}]}}"#,
                "b".repeat(64)
            )
            .as_bytes(),
        );
        assert_eq!(
            read_manifest(&file).unwrap().created_files,
            [dlc(DLC_PATH, 5, 'B')]
        );
    }

    #[test]
    fn without_created_files_the_append_manifest_is_the_old_one_byte_for_byte() {
        let dir = sandbox();
        write_append_manifest(
            dir.path(),
            "rpf-x",
            Path::new("/g"),
            Path::new("/p"),
            &append_item(7),
        )
        .unwrap();
        let old = read(&dir.path().join("restore.json"));
        assert_eq!(
            with_time_masked(&old),
            "{\n  \"schemaVersion\": 2,\n  \"id\": \"rpf-x\",\n  \"createdAt\": \"<time>\",\n  \"gameRoot\": \"/g\",\n  \"patch\": \"/p\",\n  \"archives\": [\n    {\n      \"relativePath\": \"update/update.rpf\",\n      \"livePath\": \"/g/update/update.rpf\",\n      \"backupPath\": \"\",\n      \"sha256Before\": \"\",\n      \"sha256After\": \"\",\n      \"append\": {\n        \"record\": 7,\n        \"fingerprintBefore\": \"\"\n      }\n    }\n  ]\n}"
        );
        // пустые списки: тот же текст и нет ни одного нового ключа
        write_append_manifest_with(
            dir.path(),
            "rpf-x",
            Path::new("/g"),
            Path::new("/p"),
            &append_item(7),
            &[],
            &[],
        )
        .unwrap();
        let same = read(&dir.path().join("restore.json"));
        assert_eq!(with_time_masked(&old), with_time_masked(&same));
        assert!(!same.contains("createdFiles") && !same.contains("createdDirectories"));
        let manifest = read_manifest(&dir.path().join("restore.json")).unwrap();
        assert!(manifest.created_files.is_empty());
    }

    #[test]
    fn the_reader_takes_only_created_entries_it_can_trust() {
        let dir = sandbox();
        let good = "c".repeat(64);
        let entries = [
            // годная: хэш приводится к прописным
            format!(r#"{{"path":"a.rpf","bytes":10,"sha256":"{good}"}}"#),
            // нет хэша, короткий хэш, не шестнадцатеричный, не строка
            r#"{"path":"b.rpf","bytes":10}"#.to_owned(),
            // не архив: такой файл откат не убирает никогда
            format!(r#"{{"path":"update/GTA5.exe","bytes":10,"sha256":"{good}"}}"#),
            format!(
                r#"{{"path":"c.rpf","bytes":10,"sha256":"{}"}}"#,
                "c".repeat(63)
            ),
            format!(
                r#"{{"path":"d.rpf","bytes":10,"sha256":"{}"}}"#,
                "g".repeat(64)
            ),
            r#"{"path":"e.rpf","bytes":10,"sha256":5}"#.to_owned(),
            // длина не число, отрицательная, дробная
            format!(r#"{{"path":"f.rpf","bytes":"10","sha256":"{good}"}}"#),
            format!(r#"{{"path":"g.rpf","bytes":-1,"sha256":"{good}"}}"#),
            format!(r#"{{"path":"h.rpf","bytes":1.5,"sha256":"{good}"}}"#),
            // нет пути, путь не строка, пустой путь
            format!(r#"{{"bytes":10,"sha256":"{good}"}}"#),
            format!(r#"{{"path":7,"bytes":10,"sha256":"{good}"}}"#),
            format!(r#"{{"path":"","bytes":10,"sha256":"{good}"}}"#),
            // не объект
            "5".to_owned(),
            "null".to_owned(),
            // вторая годная
            format!(r#"{{"path":"i.rpf","bytes":0,"sha256":"{good}"}}"#),
        ];
        let body = format!(r#"{{"createdFiles":[{}]}}"#, entries.join(","));
        let file = manifest_file(&dir, body.as_bytes());
        let found = read_manifest(&file).unwrap().created_files;
        assert_eq!(found, [dlc("a.rpf", 10, 'C'), dlc("i.rpf", 0, 'C'),]);
        // не список: файлов как будто нет
        for wrong in [
            r#"{"createdFiles":null}"#,
            r#"{"createdFiles":"a.rpf"}"#,
            r#"{"createdFiles":{"path":"a.rpf"}}"#,
            r#"{"createdFiles":[]}"#,
        ] {
            let file = manifest_file(&dir, wrong.as_bytes());
            assert!(read_manifest(&file).unwrap().created_files.is_empty());
        }
    }

    fn creates_refusal(value: Value) -> (String, String) {
        match created_from_request(Some(&value)) {
            Ok(done) => panic!("ожидался отказ, пришло {done:?}"),
            Err(error) => (error.code, error.message),
        }
    }

    #[test]
    fn the_install_creates_key_is_checked_before_anything_is_written() {
        // нет ключа или null: ничего не создано
        assert_eq!(created_from_request(None).unwrap(), (vec![], vec![]));
        assert_eq!(
            created_from_request(Some(&Value::Null)).unwrap(),
            (vec![], vec![])
        );
        assert_eq!(
            created_from_request(Some(&json!([]))).unwrap(),
            (vec![], vec![])
        );

        // годное: косые приводятся к прямым, хэш к прописным, папки без повторов
        let given = json!([
            {
                "path": "\\update\\x64\\dlcpacks\\astral_redux_ab12cd34\\DLC.RPF",
                "bytes": 6_912_212_992u64,
                "sha256": "ab".repeat(32),
                "dirs": [DLC_DIR, "update\\x64\\dlcpacks\\ASTRAL_REDUX_AB12CD34"],
            },
            {
                "path": "update/x64/dlcpacks/astral_redux_ab12cd34/dlc2.rpf",
                "bytes": 9,
                "sha256": "CD".repeat(32),
            },
        ]);
        let (files, dirs) = created_from_request(Some(&given)).unwrap();
        assert_eq!(
            files,
            [
                CreatedFile {
                    path: "update/x64/dlcpacks/astral_redux_ab12cd34/DLC.RPF".to_owned(),
                    bytes: 6_912_212_992,
                    sha256: "AB".repeat(32),
                },
                CreatedFile {
                    path: "update/x64/dlcpacks/astral_redux_ab12cd34/dlc2.rpf".to_owned(),
                    bytes: 9,
                    sha256: "CD".repeat(32),
                },
            ]
        );
        assert_eq!(dirs, [DLC_DIR]);

        let hash = "ab".repeat(32);
        let entry = |path: &str, bytes: Value, sha: Value| json!([{ "path": path, "bytes": bytes, "sha256": sha }]);
        let argument = |text: &str| ("ArgumentException".to_owned(), text.to_owned());
        assert_eq!(
            creates_refusal(json!({ "path": "a.rpf" })),
            argument("Install creates is not a list.")
        );
        assert_eq!(
            creates_refusal(Value::Array(vec![json!({}); 65])),
            argument("Install creates names more than 64 files.")
        );
        assert_eq!(
            creates_refusal(json!([5])),
            argument("Install creates entry is not an object.")
        );
        // путь: только .rpf, только внутри игры
        for bad in ["dlc.bin", "dlc.rpf.part", "a/", ""] {
            assert_eq!(
                creates_refusal(entry(bad, json!(5), json!(hash))),
                argument("Install creates path must be an .rpf file."),
                "{bad:?}"
            );
        }
        for unsafe_path in ["../x.rpf", "a/../b.rpf", "C:x.rpf", "a//b.rpf"] {
            assert_eq!(
                creates_refusal(entry(unsafe_path, json!(5), json!(hash))),
                (
                    "InvalidDataException".to_owned(),
                    format!("Unsafe relative path: {unsafe_path}")
                ),
                "{unsafe_path:?}"
            );
        }
        assert_eq!(
            creates_refusal(json!([{ "bytes": 5, "sha256": hash }])),
            argument("Install creates path must be an .rpf file.")
        );
        // длина: положительное число
        for bad in [json!(0), json!(-3), json!("5"), json!(1.5), Value::Null] {
            assert_eq!(
                creates_refusal(entry("a.rpf", bad.clone(), json!(hash))),
                argument("Install creates bytes must be a positive number."),
                "{bad}"
            );
        }
        // хэш: ровно 64 шестнадцатеричных знака
        for bad in [
            json!("ab"),
            json!("g".repeat(64)),
            json!(format!("a1:{hash}")),
            json!(5),
            Value::Null,
        ] {
            assert_eq!(
                creates_refusal(entry("a.rpf", json!(5), bad.clone())),
                argument("Install creates sha256 must be 64 hexadecimal digits."),
                "{bad}"
            );
        }
        // один файл дважды (регистр и вид косых не важны)
        assert_eq!(
            creates_refusal(json!([
                { "path": "a/b.rpf", "bytes": 5, "sha256": hash },
                { "path": "A\\B.RPF", "bytes": 5, "sha256": hash },
            ])),
            argument("Install creates names a file twice.")
        );
        // папки: список путей, каждая выше файла
        for bad_dirs in [
            json!("a"),
            json!([5]),
            json!(["other"]),
            json!(["a/b.rpf"]),
            json!(["a/b"]),
        ] {
            let listed =
                json!([{ "path": "a/b.rpf", "bytes": 5, "sha256": hash, "dirs": bad_dirs }]);
            assert_eq!(
                creates_refusal(listed),
                argument("Install creates dirs must be folders above the file."),
                "{bad_dirs}"
            );
        }
        for unsafe_dir in ["../a", "", "a/"] {
            let listed =
                json!([{ "path": "a/b.rpf", "bytes": 5, "sha256": hash, "dirs": [unsafe_dir] }]);
            assert_eq!(
                creates_refusal(listed),
                (
                    "InvalidDataException".to_owned(),
                    format!("Unsafe relative path: {unsafe_dir}")
                ),
                "{unsafe_dir:?}"
            );
        }
    }

    #[test]
    fn unfinished_points_are_the_ones_with_created_files_and_no_after_fingerprint() {
        let root = sandbox();
        let game = Path::new("/Games/GTA V");
        let make = |id: &str, game: &str, item: &AppendItem, files: &[CreatedFile]| {
            let folder = root.path().join(id);
            fs::create_dir_all(&folder).unwrap();
            write_append_manifest_with(
                &folder,
                id,
                Path::new(game),
                Path::new("/p"),
                item,
                files,
                &[],
            )
            .unwrap();
        };
        let files = [dlc(DLC_PATH, 100, 'A')];
        // 1: недоделана, файлы названы
        make("rpf-a", "/Games/GTA V", &append_item(3), &files);
        // 2: доделана (отпечаток «после» и цепочка записаны)
        let mut finished = append_item(4);
        finished.fingerprint_before = "aa".repeat(32);
        finished.fingerprint_after = "bb".repeat(32);
        finished.chain_base = "cc".repeat(32);
        make("rpf-b", "/Games/GTA V", &finished, &files);
        // 3: недоделана, но файлов нет
        make("rpf-c", "/Games/GTA V", &append_item(5), &[]);
        // 4: чужая игра
        make("rpf-d", "/Other/GTA V", &append_item(6), &files);
        // 5: тот же корень другим написанием
        make("rpf-e", "/games/gta v/", &append_item(8), &files);
        // не точки: битая опись, файл вместо папки, имя не годится как id
        fs::create_dir_all(root.path().join("rpf-f")).unwrap();
        fs::write(root.path().join("rpf-f").join("restore.json"), b"{oops").unwrap();
        fs::write(root.path().join("rpf-g"), b"file").unwrap();
        fs::create_dir_all(root.path().join("bad name")).unwrap();
        make("bad name", "/Games/GTA V", &append_item(9), &files);

        let found = unfinished_points(root.path(), game);
        let ids: Vec<&str> = found.iter().map(|point| point.id.as_str()).collect();
        assert_eq!(ids, ["rpf-a", "rpf-e"], "{found:?}");
        assert_eq!(found[0].archive, "update/update.rpf");
        assert_eq!(found[0].record, 3);
        assert_eq!(found[0].created, files);
        // нет папки точек: пусто
        assert!(unfinished_points(&root.path().join("none"), game).is_empty());
    }

    #[test]
    fn broken_manifests_are_refused_with_the_known_words() {
        let invalid = (
            "InvalidDataException".to_owned(),
            "Restore point manifest is invalid.".to_owned(),
        );
        for content in [
            r#"{"archives":[1]}"#,
            r#"{"archives":[null]}"#,
            r#"{"archives":[[]]}"#,
            "[]",
            r#""x""#,
            "{oops",
            "",
            r#"{"gameRoot":"x"} мусор"#,
        ] {
            assert_eq!(broken(content.as_bytes()), invalid, "{content:?}");
        }
        // Пт226-Пт227: не UTF-8 (и UTF-16) - ошибка чтения текста
        let utf16: Vec<u8> = [0xFF, 0xFE]
            .into_iter()
            .chain("{}".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        for content in [&[b'{', 0xFF, 0xFE, b'}'][..], &utf16[..]] {
            assert_eq!(
                broken(content),
                (
                    "IOException".to_owned(),
                    "stream did not contain valid UTF-8".to_owned()
                )
            );
        }
        // Пт230-Пт231
        let dir = sandbox();
        let message = refused_code(
            read_manifest(&dir.path().join("none.json")),
            "FileNotFoundException",
        );
        assert!(message.ends_with("(os error 2)"));
        #[cfg(windows)]
        {
            let message = refused_code(read_manifest(dir.path()), "UnauthorizedAccessException");
            assert!(message.ends_with("(os error 5)"));
        }
    }

    // ----- уборка служебных папок (Пт232-Пт234) -----

    #[cfg(windows)]
    fn age_directory(path: &Path, secs_ago: i64) {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_BACKUP_SEMANTICS позволяет открыть каталог
        let handle = OpenOptions::new()
            .write(true)
            .custom_flags(0x0200_0000)
            .open(path)
            .unwrap();
        let now = SystemTime::now();
        let moment = if secs_ago >= 0 {
            now - Duration::from_secs(secs_ago as u64)
        } else {
            now + Duration::from_secs(secs_ago.unsigned_abs())
        };
        handle.set_modified(moment).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn only_old_stage_directories_are_swept() {
        let dir = sandbox();
        let root = dir.path();
        let hour = 3600;
        let make = |name: &str, age_secs: i64| {
            let folder = root.join(name);
            write(&folder.join("big.rpf"), b"0123456789abc");
            age_directory(&folder, age_secs);
            folder
        };
        let old = make(".astral-stage-old7h", 7 * hour);
        let ro = make(".astral-stage-ro", 7 * hour);
        mark_readonly(&ro.join("big.rpf")).unwrap();
        let just_over = make(".astral-stage-just-over", 6 * hour + 120);
        let just_under = make(".astral-stage-just-under", 6 * hour - 120);
        let fresh = make(".astral-stage-new", 60);
        let future = make(".astral-stage-future", -(2 * hour));
        let upper = make(".ASTRAL-STAGE-upper", 7 * hour);
        let nodot = make("astral-stage-nodot", 7 * hour);
        let other = make(".astral-compose-old", 7 * hour);
        write(&root.join(".astral-stage-file"), b"data");
        let bare = root.join(".astral-stage-");
        fs::create_dir(&bare).unwrap();
        age_directory(&bare, 7 * hour);
        // каталог со своим файлом, занятым другим процессом, остаётся
        let locked = make(".astral-stage-locked", 7 * hour);
        let hold = hold_exclusively(&locked.join("big.rpf"));

        sweep_stale_stages(root);
        drop(hold);

        for gone in [&old, &ro, &just_over, &bare] {
            assert!(!gone.exists(), "{gone:?}");
        }
        for kept in [
            &just_under,
            &fresh,
            &future,
            &upper,
            &nodot,
            &other,
            &locked,
        ] {
            assert!(kept.exists(), "{kept:?}");
        }
        assert!(root.join(".astral-stage-file").is_file());
        // Пт233-Пт234: нет папки или это файл - молча
        sweep_stale_stages(&root.join("none"));
        sweep_stale_stages(&root.join(".astral-stage-file"));
    }
}
