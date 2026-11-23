//! Запись корневого архива с SHA-256 файла по ходу записи, без отдельного
//! прохода по готовому файлу.
//!
//! SHA-256 читает файл по порядку, а начало файла (оглавление) доводчик
//! ArchiveFix переписывает уже после записи тел: шифрует оглавление, а у
//! настоящего ArchiveFix ещё и переносит в конец файла первые записи данных
//! (тела остаются на старом месте, их копия ложится за прежним концом файла).
//! Поэтому отпечаток собирается так:
//!
//! 1. Пробная доводка. На отдельном файле того же имени и размера (тела нули,
//!    оглавление то же) доводчик запускается заранее и работает, пока пишутся
//!    тела. Что ArchiveFix сделает с оглавлением, зависит от имени, размера и
//!    самого оглавления, а не от тел. Когда проба кончилась, из её файла
//!    читается голова файла.
//! 2. Запись как раньше: тела по местам, оглавление последним. После каждого
//!    тела писатель двигает отметку записанного, а читатель отпечатка (поток)
//!    идёт за ней: хеширует предсказанную голову, потом записанное с диска
//!    (оно только что записано и лежит в кэше системы). Читатель отстаёт от
//!    писателя и догоняет его, пока тот занят диском и доводчиком.
//! 3. Настоящая доводка готового файла, как раньше; к этому времени пробная уже
//!    кончилась (два запуска ArchiveFix разом на нагруженной машине иногда
//!    оставляют оглавление незашифрованным, поэтому они не пересекаются).
//! 4. Сверка: настоящая голова равна предсказанной, файл не стал короче. Если
//!    он стал длиннее, хвост (копии перенесённых записей) читается с диска и
//!    дописывается в отпечаток. Не сошлось — отпечатка нет, вызывающий читает
//!    готовый файл целиком, как раньше.
//!
//! Файл при этом получается тем же байт в байт, что при записи без отпечатка:
//! настоящий доводчик работает на полном файле так же, как прежде. Не
//! проверяется одно: что доводчик не правит тела на месте; ArchiveFix этого не
//! делает (сверено на настоящих архивах), а выключатель `0` возвращает прежний
//! порядок целиком.

use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::mpsc,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use rage_rpf::{
    absorb_range, activity, FileDigest, Finalizer, Layout, RpfError, TrialRun, Watermark,
};
use sha2::Sha256;

use super::{compose::Streaming, hex_lower, random_hex};
use crate::error::{EngineError, Result};

/// Итог записи.
pub(crate) struct Streamed {
    /// SHA-256 готового файла (строчными), если он собран по ходу записи и
    /// сверен; иначе отдельный проход по файлу нужен вызывающему.
    pub digest: Option<String>,
    /// Сколько писавший поток ждал читателя отпечатка после записи и доводки
    /// (то, что не скрылось за записью).
    pub waited: Duration,
}

/// Идущая проба и её файл.
struct Trial {
    folder: PathBuf,
    file: PathBuf,
    run: Box<dyn TrialRun>,
}

/// Пишет `layout` в `staged` и доводит файл (если есть `finalizer`); `scratch` —
/// служебная папка для пробного файла. Ход записи идёт в `progress`. Доводчик,
/// который не берётся за пробу (`Finalizer::begin_trial`), доводит файл как
/// раньше, а отпечаток по ходу записи не собирается.
pub(crate) fn write_streamed(
    layout: &Layout<'_>,
    staged: &Path,
    name: &str,
    scratch: &Path,
    finalizer: Option<&dyn Finalizer>,
    streaming: Streaming,
    progress: &mut dyn FnMut(u64),
) -> Result<Streamed> {
    // Доводчик, который называет голову сам (родной), пробного запуска не
    // просит: голова известна по оглавлению, размеру и имени ещё до записи тел.
    let known = match finalizer {
        Some(finalizer) => match finalizer.predict_head(layout, name) {
            Ok(head) => head,
            Err(RpfError::Cancelled) => return Err(RpfError::Cancelled.into()),
            // не вышло предсказать: настоящая доводка скажет своё слово
            Err(_) => None,
        },
        None => None,
    };
    let trial = match finalizer {
        Some(finalizer) if known.is_none() && layout.size() >= streaming.trial_from => {
            begin_trial(layout, name, scratch, finalizer)?
        }
        // малый архив: проход по готовому файлу дешевле пробного запуска
        _ => None,
    };
    // читатель отпечатка нужен, если голову файла есть откуда взять
    let wanted = finalizer.is_none() || trial.is_some() || known.is_some();
    let mark = Watermark::new();
    let (lane, head_to) = match wanted
        .then(|| {
            FileDigest::start(
                staged.to_path_buf(),
                layout.head_len(),
                layout.size(),
                mark.clone(),
            )
            .ok()
        })
        .flatten()
    {
        Some((lane, head_to)) => (Some(lane), Some(head_to)),
        None => (None, None),
    };

    let mut plain = None;
    let mut waiter: Option<JoinHandle<Option<Vec<u8>>>> = None;
    match (trial, head_to) {
        (Some(trial), Some(head_to)) => {
            let want = layout.head_len() as usize;
            waiter = thread::Builder::new()
                .name("rpf-trial".to_owned())
                .spawn(move || finish_trial(trial, want, head_to))
                .ok();
        }
        (None, Some(head_to)) => {
            // доводчика нет (голова файла — оглавление как есть) или он назвал голову
            let head = known.unwrap_or_else(|| layout.plain_head());
            let _ = head_to.send(head.clone());
            plain = Some(head);
        }
        // читателя нет (не завёлся): пробу некому принять, её запуск бросается
        (_, None) => {}
    }

    // запись; что бы ни случилось, потоки сводятся ниже
    let written = (|| -> Result<()> {
        let mut output = File::create(staged)?;
        layout.write_all(&mut output, progress, lane.as_ref().map(|_| &*mark))?;
        Ok(())
    })();
    // отметку закрывает и сама запись; здесь страховка на случай, когда до неё не дошло
    mark.close();

    // Пробный и настоящий запуск ArchiveFix не идут одновременно: два запуска
    // разом на нагруженной машине иногда оставляют оглавление незашифрованным.
    // Пробный к этому времени обычно давно кончился (он шёл всю запись).
    let predicted = match waiter {
        Some(waiter) => waiter.join().ok().flatten(),
        None => plain,
    };
    let sealed = written.and_then(|()| match finalizer {
        Some(finalizer) => finalizer.finalize(staged, name).map_err(EngineError::from),
        None => Ok(()),
    });
    let waiting = Instant::now();
    let state = lane.map(FileDigest::finish);
    sealed?;
    let waited = waiting.elapsed();

    let (Some(head), Some(Ok(mut state))) = (predicted, state) else {
        return Ok(Streamed {
            digest: None,
            waited,
        });
    };
    if !settle(staged, &head, layout.size(), &mut state)? {
        return Ok(Streamed {
            digest: None,
            waited,
        });
    }
    Ok(Streamed {
        digest: Some(hex_lower(&sha2::Digest::finalize(state))),
        waited,
    })
}

/// Файл с пустыми телами для пробы и её запуск. `None`, если проба не
/// получилась или доводчик на неё не согласен: тогда отпечатка по ходу записи
/// не будет, а настоящая доводка скажет своё слово.
fn begin_trial(
    layout: &Layout<'_>,
    name: &str,
    scratch: &Path,
    finalizer: &dyn Finalizer,
) -> Result<Option<Trial>> {
    activity::check()?;
    let folder = scratch.join(format!("trial-{}", random_hex(12)));
    let file = folder.join(name);
    let prepared = fs::create_dir_all(&folder)
        .and_then(|()| File::create(&file))
        .map_err(RpfError::from)
        .and_then(|mut side| {
            // пробный файл растянут до размера архива, но ничего на диске не занимает
            sparse::mark(&side);
            layout.write_head(&mut side)
        });
    let started = match prepared {
        Ok(()) => finalizer.begin_trial(&file, name),
        Err(error) => Err(error),
    };
    match started {
        Ok(Some(run)) => Ok(Some(Trial { folder, file, run })),
        Ok(None) => {
            let _ = fs::remove_dir_all(&folder);
            Ok(None)
        }
        Err(RpfError::Cancelled) => {
            let _ = fs::remove_dir_all(&folder);
            Err(RpfError::Cancelled.into())
        }
        Err(_) => {
            let _ = fs::remove_dir_all(&folder);
            Ok(None)
        }
    }
}

/// Дожидается пробы в своём потоке, читает голову файла и отдаёт её читателю
/// отпечатка. Папку пробы убирает. Не вышло — читатель остаётся без головы.
fn finish_trial(trial: Trial, want: usize, head_to: mpsc::Sender<Vec<u8>>) -> Option<Vec<u8>> {
    let Trial { folder, file, run } = trial;
    let head = run.finish().ok().and_then(|()| {
        let mut head = vec![0u8; want];
        File::open(&file)
            .and_then(|mut side| side.read_exact(&mut head))
            .ok()
            .map(|()| head)
    });
    let _ = fs::remove_dir_all(&folder);
    if let Some(head) = &head {
        let _ = head_to.send(head.clone());
    }
    head
}

/// Сверяет готовый файл с предсказанием и дописывает хвост в отпечаток.
/// `false` — предсказание не подтвердилось.
fn settle(staged: &Path, head: &[u8], total: u64, state: &mut Sha256) -> Result<bool> {
    let mut file = File::open(staged)?;
    let len = file.metadata()?.len();
    if len < total {
        return Ok(false);
    }
    let mut actual = vec![0u8; head.len()];
    file.read_exact(&mut actual)?;
    if actual != head {
        return Ok(false);
    }
    if len > total {
        absorb_range(state, &mut file, total, len)?;
    }
    Ok(true)
}

/// Файл без выделенных кластеров: растянутый до размера архива пробный файл не
/// съедает место на диске. Только NTFS; где не вышло, файл просто обычный.
#[cfg(windows)]
#[allow(unsafe_code)]
mod sparse {
    use std::{fs::File, os::windows::io::AsRawHandle, ptr};

    extern "system" {
        fn DeviceIoControl(
            device: *mut core::ffi::c_void,
            code: u32,
            input: *const core::ffi::c_void,
            input_len: u32,
            output: *mut core::ffi::c_void,
            output_len: u32,
            returned: *mut u32,
            overlapped: *mut core::ffi::c_void,
        ) -> i32;
    }

    /// FSCTL_SET_SPARSE.
    const SET_SPARSE: u32 = 0x0009_00C4;

    pub fn mark(file: &File) -> bool {
        let mut returned = 0u32;
        // SAFETY: дескриптор файла жив, буферов у вызова нет, число байт пишется
        // в переменную на стеке.
        let done = unsafe {
            DeviceIoControl(
                file.as_raw_handle(),
                SET_SPARSE,
                ptr::null(),
                0,
                ptr::null_mut(),
                0,
                &mut returned,
                ptr::null_mut(),
            )
        };
        done != 0
    }
}

#[cfg(not(windows))]
mod sparse {
    pub fn mark(_file: &std::fs::File) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_rpf::fixtures::{noise, text};
    use rage_rpf::{Body, Compress, Data, DirNode, FileNode, WriteContext};
    use std::{
        io::{Seek, SeekFrom, Write},
        sync::{Arc, Mutex},
    };
    use tempfile::{tempdir, TempDir};

    use crate::archives::sha256_file;

    fn bin(name: &str, bytes: Vec<u8>, compress: Compress) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Binary {
                data: Data::memory(bytes),
                compress,
            },
        }
    }

    fn tree() -> DirNode {
        let mut root = DirNode::new("");
        root.files
            .push(bin("first.dat", noise(900, 1), Compress::Store));
        root.files
            .push(bin("second.dat", noise(13_000, 2), Compress::Store));
        root.files
            .push(bin("text.xml", text(70_000, "t"), Compress::Always));
        root.files
            .push(bin("last.bin", noise(5_000_000, 3), Compress::Store));
        let mut dir = DirNode::new("sub");
        dir.files
            .push(bin("a.txt", text(300, "a"), Compress::Always));
        root.dirs.push(dir);
        root
    }

    /// Проба уже кончилась к моменту вызова: ждать нечего.
    struct Ready;

    impl TrialRun for Ready {
        fn finish(self: Box<Self>) -> rage_rpf::Result<()> {
            Ok(())
        }
    }

    /// Журнал событий для проверки порядка пробы и настоящей доводки.
    struct Ordered(Arc<Mutex<Vec<&'static str>>>);

    struct SlowLogged(Arc<Mutex<Vec<&'static str>>>);

    impl TrialRun for SlowLogged {
        fn finish(self: Box<Self>) -> rage_rpf::Result<()> {
            thread::sleep(Duration::from_millis(250));
            self.0.lock().unwrap().push("trial-end");
            Ok(())
        }
    }

    impl Finalizer for Ordered {
        fn finalize(&self, _path: &Path, _name: &str) -> rage_rpf::Result<()> {
            self.0.lock().unwrap().push("real");
            Ok(())
        }

        fn begin_trial(
            &self,
            _path: &Path,
            _name: &str,
        ) -> rage_rpf::Result<Option<Box<dyn TrialRun>>> {
            self.0.lock().unwrap().push("trial-begin");
            Ok(Some(Box::new(SlowLogged(Arc::clone(&self.0)))))
        }
    }

    #[test]
    fn the_real_run_waits_for_the_trial_so_two_runs_never_overlap() {
        let rig = Rig::new();
        let log = Arc::new(Mutex::new(Vec::new()));
        let (streamed, _, _) = rig.run(Some(&Ordered(Arc::clone(&log)))).unwrap();
        // запись крошечная и кончается раньше пробы: настоящий запуск обязан ждать её конец
        assert_eq!(*log.lock().unwrap(), ["trial-begin", "trial-end", "real"]);
        // голову Ordered не меняет, предсказание сходится: отпечаток собран
        assert!(streamed.digest.is_some());
    }

    /// Проба, которая «работает» ещё немного, когда её дожидаются.
    struct Slow(Duration);

    impl TrialRun for Slow {
        fn finish(self: Box<Self>) -> rage_rpf::Result<()> {
            thread::sleep(self.0);
            Ok(())
        }
    }

    /// Проба такого доводчика — тот же запуск на пробном файле, сразу при вызове.
    macro_rules! trial_by_finalize {
        () => {
            fn begin_trial(
                &self,
                path: &Path,
                name: &str,
            ) -> rage_rpf::Result<Option<Box<dyn TrialRun>>> {
                self.finalize(path, name)?;
                Ok(Some(Box::new(Ready)))
            }
        };
    }

    struct Rig {
        dir: TempDir,
    }

    impl Rig {
        fn new() -> Rig {
            Rig {
                dir: tempdir().unwrap(),
            }
        }

        fn run(&self, finalizer: Option<&dyn Finalizer>) -> Result<(Streamed, PathBuf, u64)> {
            let tree = tree();
            let mut ctx = WriteContext {
                staging: self.dir.path(),
                keys: None,
                finalizer: None,
            };
            let layout = Layout::prepare(&tree, &mut ctx)?;
            let staged = self.dir.path().join("out").join("mod.rpf");
            fs::create_dir_all(staged.parent().unwrap())?;
            let streamed = write_streamed(
                &layout,
                &staged,
                "mod.rpf",
                self.dir.path(),
                finalizer,
                Streaming::always(),
                &mut |_| {},
            )?;
            Ok((streamed, staged, layout.size()))
        }
    }

    /// Доводчик как ArchiveFix в малом: правит голову по имени и размеру файла, а
    /// первые данные переносит в конец (`relocate` байт копией после прежнего конца).
    struct Mimic {
        relocate: u64,
        calls: Mutex<Vec<(u64, bool)>>,
    }

    impl Mimic {
        fn new(relocate: u64) -> Mimic {
            Mimic {
                relocate,
                calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl Finalizer for Mimic {
        trial_by_finalize!();

        fn finalize(&self, path: &Path, _name: &str) -> rage_rpf::Result<()> {
            let mut file = fs::OpenOptions::new().read(true).write(true).open(path)?;
            let size = file.metadata()?.len();
            // голова: метка и узор, зависящий от размера (как ключ шифра)
            file.seek(SeekFrom::Start(12))?;
            file.write_all(&0x0fef_ffffu32.to_le_bytes())?;
            file.seek(SeekFrom::Start(20))?;
            file.write_all(&size.to_le_bytes())?;
            let mut first = vec![0u8; self.relocate as usize];
            file.seek(SeekFrom::Start(512 * 3))?;
            let _ = file.read(&mut first)?;
            self.calls
                .lock()
                .unwrap()
                .push((size, first.iter().any(|b| *b != 0)));
            if self.relocate > 0 {
                file.seek(SeekFrom::Start(size))?;
                file.write_all(&first)?;
            }
            Ok(())
        }
    }

    #[test]
    fn without_a_finalizer_the_streamed_digest_is_the_digest_of_the_file() {
        let rig = Rig::new();
        let (streamed, staged, size) = rig.run(None).unwrap();
        assert_eq!(fs::metadata(&staged).unwrap().len(), size);
        assert_eq!(streamed.digest.unwrap(), sha256_file(&staged).unwrap());
    }

    #[test]
    fn a_finalizer_that_changes_the_head_and_appends_a_tail_is_followed() {
        let rig = Rig::new();
        let mimic = Mimic::new(2000);
        let (streamed, staged, size) = rig.run(Some(&mimic)).unwrap();
        let calls = mimic.calls.lock().unwrap().clone();
        // пробный запуск (тела нули) и настоящий (тела есть)
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0], (size, false), "{calls:?}");
        assert!(calls[1].1);
        assert_eq!(fs::metadata(&staged).unwrap().len(), size + 2000);
        assert_eq!(streamed.digest.unwrap(), sha256_file(&staged).unwrap());
    }

    #[test]
    fn the_file_is_the_same_with_and_without_the_trial() {
        // порядок записи не меняется: настоящий доводчик работает на полном файле
        let with = Rig::new();
        let mimic = Mimic::new(1500);
        let (_, staged_with, _) = with.run(Some(&mimic)).unwrap();

        let without = Rig::new();
        let mimic = Mimic::new(1500);
        let tree = tree();
        let mut ctx = WriteContext {
            staging: without.dir.path(),
            keys: None,
            finalizer: None,
        };
        let layout = Layout::prepare(&tree, &mut ctx).unwrap();
        let staged_plain = without.dir.path().join("plain.rpf");
        let mut out = File::create(&staged_plain).unwrap();
        layout.write_all(&mut out, &mut |_| {}, None).unwrap();
        drop(out);
        mimic.finalize(&staged_plain, "mod.rpf").unwrap();
        assert_eq!(
            fs::read(&staged_with).unwrap(),
            fs::read(&staged_plain).unwrap()
        );
    }

    /// Проба кончается не сразу: читатель ждёт голову, а запись уже закончена.
    struct Lagging(Mimic, Duration);

    impl Finalizer for Lagging {
        fn finalize(&self, path: &Path, name: &str) -> rage_rpf::Result<()> {
            self.0.finalize(path, name)
        }

        fn begin_trial(
            &self,
            path: &Path,
            name: &str,
        ) -> rage_rpf::Result<Option<Box<dyn TrialRun>>> {
            self.0.finalize(path, name)?;
            Ok(Some(Box::new(Slow(self.1))))
        }
    }

    #[test]
    fn a_trial_that_ends_after_the_writing_still_gives_the_right_digest() {
        let rig = Rig::new();
        let lagging = Lagging(Mimic::new(700), Duration::from_millis(300));
        let (streamed, staged, _) = rig.run(Some(&lagging)).unwrap();
        assert_eq!(streamed.digest.unwrap(), sha256_file(&staged).unwrap());
    }

    /// Доводчик, который каждый раз пишет другую голову: предсказание не сбывается.
    struct Fickle(Mutex<u8>);

    impl Finalizer for Fickle {
        trial_by_finalize!();

        fn finalize(&self, path: &Path, _name: &str) -> rage_rpf::Result<()> {
            let mut turn = self.0.lock().unwrap();
            *turn += 1;
            let mut file = fs::OpenOptions::new().write(true).open(path)?;
            file.seek(SeekFrom::Start(30))?;
            file.write_all(&[*turn; 8])?;
            Ok(())
        }
    }

    #[test]
    fn a_head_that_differs_from_the_prediction_gives_no_digest_and_the_file_is_still_written() {
        let rig = Rig::new();
        let fickle = Fickle(Mutex::new(0));
        let (streamed, staged, size) = rig.run(Some(&fickle)).unwrap();
        assert!(streamed.digest.is_none());
        assert_eq!(fs::metadata(&staged).unwrap().len(), size);
        // файл настоящий: голова второго запуска
        let bytes = fs::read(&staged).unwrap();
        assert_eq!(&bytes[30..38], &[2u8; 8]);
    }

    /// Доводчик, который укорачивает файл.
    struct Shrinker;

    impl Finalizer for Shrinker {
        trial_by_finalize!();

        fn finalize(&self, path: &Path, _name: &str) -> rage_rpf::Result<()> {
            let file = fs::OpenOptions::new().write(true).open(path)?;
            let size = file.metadata()?.len();
            file.set_len(size - 512)?;
            Ok(())
        }
    }

    #[test]
    fn a_finalizer_that_shortens_the_file_is_not_followed() {
        // и пробный, и настоящий укорачивают одинаково: голова та же, но файл короче
        let rig = Rig::new();
        let (streamed, _, _) = rig.run(Some(&Shrinker)).unwrap();
        assert!(streamed.digest.is_none());
    }

    /// Доводчик, который отказывает только в первый раз (пробный запуск).
    struct FailsFirst(Mutex<bool>);

    impl Finalizer for FailsFirst {
        trial_by_finalize!();

        fn finalize(&self, _path: &Path, _name: &str) -> rage_rpf::Result<()> {
            let mut seen = self.0.lock().unwrap();
            if !*seen {
                *seen = true;
                return Err(RpfError::state("trial refused"));
            }
            Ok(())
        }
    }

    #[test]
    fn a_failed_trial_only_costs_the_streamed_digest() {
        let rig = Rig::new();
        let finalizer = FailsFirst(Mutex::new(false));
        let (streamed, staged, _) = rig.run(Some(&finalizer)).unwrap();
        assert!(streamed.digest.is_none());
        assert!(staged.is_file());
        // пробная папка убрана
        let leftovers: Vec<_> = fs::read_dir(rig.dir.path())
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("trial-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    /// Доводчик, который на пробу не соглашается, как любой без `begin_trial`.
    struct Plain(Mutex<u32>);

    impl Finalizer for Plain {
        fn finalize(&self, _path: &Path, _name: &str) -> rage_rpf::Result<()> {
            *self.0.lock().unwrap() += 1;
            Ok(())
        }
    }

    #[test]
    fn a_finalizer_without_trial_support_is_called_once_and_nothing_is_streamed() {
        let rig = Rig::new();
        let plain = Plain(Mutex::new(0));
        let (streamed, staged, size) = rig.run(Some(&plain)).unwrap();
        assert_eq!(*plain.0.lock().unwrap(), 1);
        assert!(streamed.digest.is_none());
        assert_eq!(fs::metadata(&staged).unwrap().len(), size);
    }

    struct Refuses;

    impl Finalizer for Refuses {
        fn finalize(&self, _path: &Path, _name: &str) -> rage_rpf::Result<()> {
            Err(RpfError::state("always refused"))
        }
    }

    #[test]
    fn a_refusal_of_the_real_finalizer_is_the_answer() {
        let rig = Rig::new();
        let error = rig.run(Some(&Refuses)).err().unwrap();
        assert!(
            error.message.contains("always refused"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_small_archive_skips_the_trial() {
        let rig = Rig::new();
        let mimic = Mimic::new(100);
        let tree = tree();
        let mut ctx = WriteContext {
            staging: rig.dir.path(),
            keys: None,
            finalizer: None,
        };
        let layout = Layout::prepare(&tree, &mut ctx).unwrap();
        let staged = rig.dir.path().join("small.rpf");
        let streaming = Streaming {
            enabled: true,
            trial_from: layout.size() + 1,
            nested: rage_rpf::NestedMode::Staged,
        };
        let streamed = write_streamed(
            &layout,
            &staged,
            "mod.rpf",
            rig.dir.path(),
            Some(&mimic),
            streaming,
            &mut |_| {},
        )
        .unwrap();
        assert!(streamed.digest.is_none());
        assert_eq!(
            mimic.calls.lock().unwrap().len(),
            1,
            "только настоящий запуск"
        );
    }

    #[test]
    fn the_trial_file_has_the_final_name_and_size_and_empty_bodies() {
        struct Peek(Mutex<Vec<(String, u64, bool, String)>>);
        impl Finalizer for Peek {
            trial_by_finalize!();

            fn finalize(&self, path: &Path, name: &str) -> rage_rpf::Result<()> {
                let bytes = fs::read(path)?;
                let last = bytes.len() - 512;
                let folder = path
                    .parent()
                    .and_then(Path::file_name)
                    .map(|part| part.to_string_lossy().into_owned())
                    .unwrap_or_default();
                self.0.lock().unwrap().push((
                    name.to_owned(),
                    bytes.len() as u64,
                    bytes[last..].iter().all(|b| *b == 0),
                    folder,
                ));
                Ok(())
            }
        }
        let rig = Rig::new();
        let peek = Peek(Mutex::new(Vec::new()));
        let (_, _, size) = rig.run(Some(&peek)).unwrap();
        let seen = peek.0.lock().unwrap().clone();
        assert_eq!(seen.len(), 2);
        assert_eq!(
            (seen[0].0.as_str(), seen[0].1, seen[0].2),
            ("mod.rpf", size, true)
        );
        assert!(seen[0].3.starts_with("trial-"), "{}", seen[0].3);
        assert_eq!(
            (seen[1].0.as_str(), seen[1].1, seen[1].2),
            ("mod.rpf", size, false)
        );
        assert_eq!(seen[1].3, "out");
    }
}
