//! Замок удержания: файл `hold.lock` в папке точки.
//!
//! Признак «идёт работа» для уборки брошенных удержаний. Движок держит замок
//! открытым всё время, пока он работает над удержанием: сборка первого шага,
//! `commit`, `discard` и сама уборка. Время изменения `hold.json` о жизни
//! ничего не говорит: сборка и проверка идут дольше любых часов, а процесс,
//! умерший посреди шага, оставляет свежую запись. Замок снимает сама система,
//! когда процесс умирает, поэтому занятый замок означает живой шаг, а свободный
//! — что шага сейчас нет.
//!
//! На Windows замок — это открытый файл, который не делит запись: второй
//! `open` с записью получает отказ «файл занят» (код 32), в том числе из того
//! же процесса. Право удаления файл делит, чтобы свою папку точки движок мог
//! убрать, не закрывая замок раньше времени. На остальных системах — `flock`.

use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

/// Имя файла замка в папке точки.
pub(crate) const LOCK_FILE: &str = "hold.lock";

/// Пауза между попытками взять занятый замок.
const POLL: Duration = Duration::from_millis(25);

/// Замок удержания; закрывается, когда значение выбрасывают (и когда умирает процесс).
#[derive(Debug)]
pub(crate) struct HoldLock {
    /// Закрывается раньше, чем файл замка убирается.
    file: Option<File>,
    path: PathBuf,
}

impl HoldLock {
    /// Путь файла замка точки `root`.
    pub(crate) fn path_in(root: &Path) -> PathBuf {
        root.join(LOCK_FILE)
    }

    /// Берёт замок, если он свободен: `Ok(None)` — занят. Нет файла замка —
    /// создаётся (папка точки должна быть).
    pub(crate) fn try_take(root: &Path) -> io::Result<Option<HoldLock>> {
        let path = Self::path_in(root);
        Ok(open_exclusive(&path)?.map(|file| HoldLock {
            file: Some(file),
            path,
        }))
    }

    /// То же, но ждёт до `wait`, пока замок освободится.
    pub(crate) fn take_within(root: &Path, wait: Duration) -> io::Result<Option<HoldLock>> {
        let until = Instant::now() + wait;
        loop {
            if let Some(lock) = Self::try_take(root)? {
                return Ok(Some(lock));
            }
            if Instant::now() >= until {
                return Ok(None);
            }
            thread::sleep(POLL);
        }
    }

    /// Закрывает замок. Файл остаётся: удержание ждёт следующего шага.
    pub(crate) fn close(self) {
        drop(self);
    }

    /// Закрывает замок и убирает его файл. Звать, когда записи удержания уже
    /// нет: пока она лежит, чужая уборка идёт за замком по тому же пути.
    pub(crate) fn release(mut self) {
        drop(self.file.take());
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(windows)]
fn open_exclusive(path: &Path) -> io::Result<Option<File>> {
    use std::os::windows::fs::OpenOptionsExt;
    /// Чтение и удаление общие, запись нет: читатель (сканер файлов, который открывает
    /// файл после закрытия) замку не мешает и замок читателю тоже, а второй замок,
    /// что просит запись, получает отказ.
    const SHARE_READ_DELETE: u32 = 1 | 4;
    // коды Windows: 32 — файл занят, 33 — часть заблокирована, 5 — доступ закрыт
    // (так выглядит файл, который уже удалён, но ещё открыт у соседа)
    const BUSY: [i32; 3] = [32, 33, 5];
    match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .share_mode(SHARE_READ_DELETE)
        .open(path)
    {
        Ok(file) => Ok(Some(file)),
        Err(error)
            if error
                .raw_os_error()
                .is_some_and(|code| BUSY.contains(&code)) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
#[allow(unsafe_code)]
fn open_exclusive(path: &Path) -> io::Result<Option<File>> {
    use std::os::fd::AsRawFd;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(path)?;
    // SAFETY: дескриптор открытого файла живёт до конца вызова.
    let taken = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if taken == 0 {
        return Ok(Some(file));
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::WouldBlock {
        Ok(None)
    } else {
        Err(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn a_taken_lock_is_busy_for_everybody_until_it_is_closed() {
        let dir = tempdir().unwrap();
        let first = HoldLock::try_take(dir.path()).unwrap().expect("свободен");
        // тот же процесс, другая нить, другой открывающий: занято
        assert!(HoldLock::try_take(dir.path()).unwrap().is_none());
        let root = dir.path().to_path_buf();
        let other = thread::spawn(move || HoldLock::try_take(&root).unwrap().is_none());
        assert!(other.join().unwrap());
        first.close();
        assert!(HoldLock::try_take(dir.path()).unwrap().is_some());
    }

    #[test]
    fn waiting_gets_the_lock_when_it_frees_and_gives_up_when_it_does_not() {
        let dir = tempdir().unwrap();
        let held = HoldLock::try_take(dir.path()).unwrap().unwrap();
        let begun = Instant::now();
        assert!(
            HoldLock::take_within(dir.path(), Duration::from_millis(120))
                .unwrap()
                .is_none()
        );
        assert!(begun.elapsed() >= Duration::from_millis(120));

        let root = dir.path().to_path_buf();
        let waiter =
            thread::spawn(move || HoldLock::take_within(&root, Duration::from_secs(10)).unwrap());
        thread::sleep(Duration::from_millis(80));
        held.close();
        assert!(waiter.join().unwrap().is_some());
    }

    #[test]
    fn releasing_removes_the_file_and_closing_keeps_it() {
        let dir = tempdir().unwrap();
        let file = HoldLock::path_in(dir.path());
        HoldLock::try_take(dir.path()).unwrap().unwrap().close();
        assert!(file.is_file());
        HoldLock::try_take(dir.path()).unwrap().unwrap().release();
        assert!(!file.exists());
        // и после уборки замок снова берётся
        assert!(HoldLock::try_take(dir.path()).unwrap().is_some());
    }

    /// Читатель (сканер файлов открывает файл после закрытия) замку не мешает, и
    /// замок читателю не мешает; второй замок по-прежнему получает отказ.
    #[test]
    fn a_plain_reader_and_the_lock_do_not_disturb_each_other() {
        use std::io::Read;
        let dir = tempdir().unwrap();
        HoldLock::try_take(dir.path()).unwrap().unwrap().close();
        let file = HoldLock::path_in(dir.path());

        // читатель открыт раньше замка
        let reader = File::open(&file).unwrap();
        let lock = HoldLock::try_take(dir.path())
            .unwrap()
            .expect("читатель не должен мешать замку");
        assert!(HoldLock::try_take(dir.path()).unwrap().is_none());
        drop(reader);

        // читатель открывается при занятом замке
        let mut reader = File::open(&file).expect("замок не должен мешать читателю");
        let mut text = String::new();
        reader.read_to_string(&mut text).unwrap();
        assert!(
            HoldLock::try_take(dir.path()).unwrap().is_none(),
            "замок всё ещё занят"
        );
        drop(reader);
        lock.close();
        assert!(HoldLock::try_take(dir.path()).unwrap().is_some());
    }

    #[test]
    fn the_lock_does_not_stop_the_owner_from_removing_its_folder() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("point");
        fs::create_dir(&root).unwrap();
        let held = HoldLock::try_take(&root).unwrap().unwrap();
        held.close();
        fs::remove_dir_all(&root).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn a_lock_in_a_missing_folder_is_an_error_not_a_busy_answer() {
        let dir = tempdir().unwrap();
        let error = HoldLock::try_take(&dir.path().join("nothing")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
    }
}
