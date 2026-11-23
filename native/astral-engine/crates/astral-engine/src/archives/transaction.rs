//! Транзакция подмены архивов: место на томах, копии «до», опись, подмена
//! по одному переименованием и возврат подменённого при отказе.
//!
//! Сборку готовых файлов делает вызывающий (`Staged`). Здесь только то, что
//! общее у установки патча и установки собранного архива. Порядок на диске
//! всегда один: копии, опись, подмены, уборка. Опись пишется раньше первой
//! подмены, поэтому убитый посередине процесс оставляет точку, по которой
//! откат вернёт всё.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, PoisonError},
    thread::{self, JoinHandle},
};

use super::{
    log,
    points::{self, BackupItem, Stamp},
    sha256_file, space,
};
use crate::{
    disk,
    error::{EngineError, Result},
    failpoint,
    progress::Progress,
};

/// Номера готовых файлов, которые уже подменены.
type Swapped = Vec<usize>;
/// Отказ шага: ошибка и номера готовых файлов, которые уже подменены.
type Failure = (EngineError, Swapped);
type Outcome<T> = std::result::Result<T, Failure>;
/// Цель установки: относительный путь архива и путь живого файла.
type Target = (String, PathBuf);
type Targets = [Target];
type Backups = [Backup];
type Pieces = [Staged];
type Sizes = [u64];
/// Куда пишутся строки журнала.
type Journal<'a> = &'a mut dyn FnMut(String);

/// Один собранный файл, готовый встать на место живого архива.
pub(crate) struct Staged {
    /// Путь живого архива.
    pub(crate) live: PathBuf,
    /// Относительный путь архива с «/» (в опись идёт как `relativePath`).
    pub(crate) relative: String,
    /// Готовый файл внутри служебной папки.
    pub(crate) staged: PathBuf,
    /// Служебная папка сборки `.astral-stage-<32 hex>`; `cleanup` убирает её целиком.
    pub(crate) stage_dir: PathBuf,
    /// Эта папка лежала до установки (имя дал вызывающий): при отказе
    /// `cleanup_refused` убирает из неё только готовый файл.
    pub(crate) preexisting: bool,
    /// Его SHA-256 так, как он должен лечь в опись.
    pub(crate) sha256_after: String,
}

impl Staged {
    /// Запись описи об этом файле и о копии «до» на его месте.
    fn item(&self, backup: &Backup) -> Result<BackupItem> {
        let Self {
            live,
            relative,
            sha256_after,
            ..
        } = self;
        let Backup { path, .. } = backup;
        Ok(BackupItem {
            relative_path: relative.clone(),
            live_path: live.clone(),
            backup_path: path.clone(),
            sha256_after: sha256_after.clone(),
            sha256_before: backup.hash()?,
        })
    }

    /// Служебная папка сборки уходит целиком; ошибки молчат.
    fn erase_folder(&self) {
        let _ = fs::remove_dir_all(&self.stage_dir);
    }

    /// После отказа: своя служебная папка уходит целиком, а папка, которая
    /// лежала до установки, остаётся со всем чужим.
    fn erase_after_refusal(&self) {
        let _ = match self.preexisting {
            true => fs::remove_file(&self.staged),
            false => fs::remove_dir_all(&self.stage_dir),
        };
    }
}

/// Что нужно описи кроме архивов.
pub(crate) struct Point<'a> {
    pub(crate) id: &'a str,
    /// Папка этой точки: `<папка точек>\<id>`.
    pub(crate) root: &'a Path,
    pub(crate) game_root: &'a Path,
    /// Каталог патча или путь `replay.json`.
    pub(crate) patch: &'a Path,
    /// Папки, которые установка создала в игре (от корня игры, с «/», от
    /// внешней к внутренней); пустой список в опись ничего не добавляет.
    pub(crate) created_dirs: &'a [String],
}

impl Point<'_> {
    /// Пишет опись точки со всеми архивами.
    fn record(&self, items: &[BackupItem]) -> Result<()> {
        points::write_manifest_with(
            self.root,
            self.id,
            self.game_root,
            self.patch,
            items,
            self.created_dirs,
        )
    }
}

/// Как станет известен отпечаток копии.
enum Fingerprint {
    Ready(String),
    Pending(JoinHandle<Result<String>>),
}

/// Копия архива «до» установки.
pub(crate) struct Backup {
    pub(crate) path: PathBuf,
    /// Длина и время живого архива на момент снятия копии.
    pub(crate) stamp: Stamp,
    /// До установки такого архива в игре не существовало.
    pub(crate) absent: bool,
    /// Поток, считающий отпечаток копии-ссылки.
    pub(crate) hash: Mutex<Option<JoinHandle<Result<String>>>>,
    /// Уже известный отпечаток (у настоящей копии; у «не было» — пустая строка).
    pub(crate) known: Mutex<Option<String>>,
}

fn locked<T>(cell: &Mutex<T>) -> MutexGuard<'_, T> {
    cell.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Отказ: цель «изменилась, пока шла установка»; `tail` — что именно с ней случилось.
fn drifted(tail: &'static str, relative: &str) -> EngineError {
    EngineError::invalid_operation(format!("{relative} {tail}"))
}

/// Имя файла без папок; пустое, если имени нет.
fn base_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
}

impl Backup {
    fn make(path: PathBuf, stamp: Stamp, absent: bool, fingerprint: Fingerprint) -> Self {
        let (known, worker) = match fingerprint {
            Fingerprint::Ready(digest) => (Some(digest), None),
            Fingerprint::Pending(worker) => (None, Some(worker)),
        };
        Self {
            path,
            stamp,
            absent,
            hash: Mutex::new(worker),
            known: Mutex::new(known),
        }
    }

    /// Отпечаток копии (прописными). Известный отдаётся сразу; иначе ждётся
    /// поток, а его результат запоминается. Забранный поток второй раз не ждут.
    pub(crate) fn hash(&self) -> Result<String> {
        self.settle(locked(&self.known))
    }

    /// То же при уже взятой ячейке `known`: она остаётся под замком до конца ожидания.
    fn settle(&self, mut slot: MutexGuard<'_, Option<String>>) -> Result<String> {
        let fresh = match slot.clone() {
            Some(ready) => return Ok(ready),
            None => {
                let worker = locked(&self.hash)
                    .take()
                    .ok_or_else(|| EngineError::internal("The backup hash is missing."))?;
                worker.join().unwrap_or_else(|_| {
                    Err(EngineError::internal("The backup hash thread failed."))
                })?
            }
        };
        Ok(slot.insert(fresh).clone())
    }

    /// Одна цель за время сборки не менялась: «не было» — и сейчас нет, у остальных
    /// прежние длина и время изменения.
    fn check_untouched(&self, (relative, live): &Target) -> Result<()> {
        match self.absent {
            true if live.exists() => Err(drifted(
                "появился, пока шла установка: его трогал другой процесс. \
                 Ничего не подменено — повторите установку.",
                relative,
            )),
            false if points::stamp(live)? != self.stamp => Err(drifted(
                "изменился, пока шла установка: его трогал другой процесс \
                 (игра, проверка файлов, другой мод). Ничего не подменено — повторите установку.",
                relative,
            )),
            _ => Ok(()),
        }
    }

    /// Ставит копию точки на место живого архива.
    fn restore_onto(&self, (_, live): &Target) -> Result<()> {
        points::put_back(&self.path, live, &self.hash()?)
    }

    /// Возвращает цель в состояние «до» и пишет об этом в журнал; `true`, если вернулось.
    fn undo(&self, target: &Target, journal: Journal<'_>) -> bool {
        let (relative, live) = target;
        if self.absent {
            journal(format!("[Install] Удаление созданного архива: {relative}"));
            return match fs::remove_file(live) {
                Ok(()) => true,
                Err(error) if error.kind() == io::ErrorKind::NotFound => true,
                Err(error) => {
                    journal(format!(
                        "[Install] Созданный архив {relative} не удалён: {error}"
                    ));
                    false
                }
            };
        }
        journal(format!("[Install] Возврат резервной копии: {relative}"));
        match self.restore_onto(target) {
            Ok(()) => true,
            Err(error) => {
                let reason = &error.message;
                journal(format!(
                    "[Install] Резервная копия {relative} не возвращена: {reason}"
                ));
                false
            }
        }
    }
}

impl Backup {
    /// Копия «до», описанная записью удержания (`install.hold`): файл и его
    /// отпечатки известны с первого шага, второй шаг ничего не считает заново.
    pub(crate) fn recorded(path: PathBuf, stamp: Stamp, sha256_before: String) -> Self {
        Self::make(path, stamp, false, Fingerprint::Ready(sha256_before))
    }
}

/// Запись «до: отсутствовал». На диске ничего не создаётся и не ищется;
/// `restore_root` здесь — папка точки.
pub(crate) fn absent_backup(restore_root: &Path, relative: &str) -> Backup {
    let nothing = Stamp {
        modified: None,
        len: 0,
    };
    let path = points::backup_path(restore_root, relative);
    Backup::make(path, nothing, true, Fingerprint::Ready(String::new()))
}

// ---------------------------------------------------------------------------
// Место
// ---------------------------------------------------------------------------

/// Место по заданным размерам: сначала каталог точек, затем папка игры.
pub(crate) fn preflight_sizes(game_root: &Path, sizes: &Sizes, points_root: &Path) -> Result<()> {
    let (need, folders) = (space::required_bytes(sizes), [points_root, game_root]);
    for folder in folders {
        space::check_space(folder, space::free_bytes(folder)?, need)?;
    }
    Ok(())
}

/// Размеры живых архивов целей по порядку; первая ошибка чтения прерывает.
fn live_sizes(targets: &Targets) -> io::Result<Vec<u64>> {
    targets
        .iter()
        .map(|(_, live)| Ok(fs::metadata(live)?.len()))
        .collect()
}

/// Место по размерам живых архивов целей (первая ошибка чтения — до проверки).
pub(crate) fn preflight(game_root: &Path, targets: &Targets, points_root: &Path) -> Result<()> {
    preflight_sizes(game_root, &live_sizes(targets)?, points_root)
}

// ---------------------------------------------------------------------------
// Копии «до»
// ---------------------------------------------------------------------------

/// Поток, который считает отпечаток копии под тем же потолком чтения.
fn hash_in_background(copy: PathBuf) -> JoinHandle<Result<String>> {
    let pace = rage_rpf::read_pace::current();
    thread::spawn(move || -> Result<String> {
        pace.install();
        let digest = sha256_file(&copy);
        digest.map(|mut hex| {
            hex.make_ascii_uppercase();
            hex
        })
    })
}

/// Жёсткая ссылка живого архива в папку точек. В тестах другой том изображается
/// отказом: второго тома на машине нет.
fn link_into_points(live: &Path, slot: &Path) -> io::Result<()> {
    #[cfg(test)]
    if other_volume::simulated() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "другой том (проба)",
        ));
    }
    fs::hard_link(live, slot)
}

/// Изображение «точки на другом томе» для тестов, по потоку.
#[cfg(test)]
pub(crate) mod other_volume {
    use std::cell::Cell;

    thread_local! {
        static SIMULATED: Cell<bool> = const { Cell::new(false) };
    }

    pub(crate) fn simulated() -> bool {
        SIMULATED.with(Cell::get)
    }

    /// Включает или выключает изображение для текущего потока.
    pub(crate) fn simulate(on: bool) {
        SIMULATED.with(|cell| cell.set(on));
    }
}

/// Ход снятия копий: сколько байт уже лежит в точке из скольких.
struct Tally<'a> {
    progress: &'a Progress,
    total: u64,
    done: u64,
    /// Имя точки, если прежний архив при невозможной ссылке в папку точек
    /// остаётся ссылкой рядом с живым файлом, а не копией.
    aside: Option<&'a str>,
}

impl Tally<'_> {
    fn show(&self, bytes: u64) {
        self.progress.report_bytes("backup", bytes, self.total);
    }

    /// Отчёт о копировании одного файла: байты приходят нарастающим итогом.
    fn on_copied(&self) -> impl FnMut(u64) + '_ {
        let mut last = 0;
        move |copied| {
            let fresh = disk::delta(&mut last, copied);
            self.progress.wrote(fresh);
            self.show(self.done + copied);
        }
    }

    /// Одна копия «до»: жёсткая ссылка на живой архив, а если нельзя — проверенная копия.
    /// При заданном имени точки (`aside`) между ними стоит ссылка рядом с живым
    /// файлом (`<архив>.astral-before-<точка>`): тот же том, что у игры, и ни
    /// байта записи.
    fn snapshot(&self, target: &Target, restore_root: &Path) -> Result<Backup> {
        let (relative, live) = target;
        let slot = points::backup_path(restore_root, relative);
        slot.parent().map_or(Ok(()), fs::create_dir_all)?;
        let _ = fs::remove_file(&slot);
        let stamp = points::stamp(live)?;

        if link_into_points(live, &slot).is_ok() {
            let pending = Fingerprint::Pending(hash_in_background(slot.clone()));
            return Ok(Backup::make(slot, stamp, false, pending));
        }
        if let Some(beside) = self.aside.and_then(|id| link_beside(live, id)) {
            // копии в папке точек не будет: пустая папка под неё не нужна
            if let Some(folder) = slot.parent().filter(|folder| *folder != restore_root) {
                drop(fs::remove_dir(folder));
            }
            let pending = Fingerprint::Pending(hash_in_background(beside.clone()));
            return Ok(Backup::make(beside, stamp, false, pending));
        }
        let digest = points::copy_verified(live, &slot, &mut self.on_copied())?;
        Ok(Backup::make(slot, stamp, false, Fingerprint::Ready(digest)))
    }
}

/// Второе имя живого архива рядом с ним; `None`, если том ссылок не даёт.
fn link_beside(live: &Path, point_id: &str) -> Option<PathBuf> {
    let beside = points::aside_path(live, point_id);
    drop(fs::remove_file(&beside));
    fs::hard_link(live, &beside).ok()?;
    failpoint::hit("install-after-aside");
    Some(beside)
}

/// Отказ без подменённого: что бы ни случилось, возвращать нечего.
fn refusal(error: impl Into<EngineError>) -> Failure {
    (error.into(), Swapped::new())
}

/// Снимает копии всех целей; готовые добавляются в `backups` по одной.
/// Ошибка всегда с пустым списком номеров: сделанное остаётся на диске, убирает
/// его вызывающий через `unwind`.
pub(crate) fn make_backups(
    targets: &Targets,
    restore_root: &Path,
    progress: &Progress,
    backups: &mut Vec<Backup>,
) -> Outcome<()> {
    make_backups_with(targets, restore_root, progress, backups, None)
}

/// То же; с именем точки в `aside` прежний архив, если ссылка в папку точек
/// невозможна (другой том), остаётся ссылкой рядом с живым файлом, а не
/// копией в папку точек.
pub(crate) fn make_backups_with(
    targets: &Targets,
    restore_root: &Path,
    progress: &Progress,
    backups: &mut Vec<Backup>,
    aside: Option<&str>,
) -> Outcome<()> {
    let mut tally = Tally {
        progress,
        total: live_sizes(targets).map_err(refusal)?.iter().sum(),
        done: 0,
        aside,
    };
    tally.show(0);

    for target in targets {
        let backup = tally.snapshot(target, restore_root).map_err(refusal)?;
        tally.done += fs::metadata(&backup.path).map_err(refusal)?.len();
        backups.push(backup);
        tally.show(tally.done);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Фиксация и откат
// ---------------------------------------------------------------------------

/// Одна установка в работе: цели с копиями «до» (i-я копия снята с i-й цели) и журнал.
struct Run<'a> {
    targets: &'a Targets,
    backups: &'a Backups,
    journal: Journal<'a>,
}

impl Run<'_> {
    /// Первая же несовпавшая цель решает.
    fn ensure_untouched(&self) -> Result<()> {
        for (target, backup) in self.targets.iter().zip(self.backups) {
            backup.check_untouched(target)?;
        }
        Ok(())
    }

    /// Записи описи для готовых файлов и копий на их местах.
    fn items(&self, staged: &Pieces) -> Result<Vec<BackupItem>> {
        let pairs = staged.iter().zip(self.backups);
        pairs.map(|(piece, backup)| piece.item(backup)).collect()
    }

    /// Подмены по одной, в порядке `pieces`: сколько файлов встало на место и чем кончилось.
    fn swap_all(&mut self, pieces: &Pieces) -> (usize, io::Result<()>) {
        let mut done = 0;
        for piece in pieces {
            let Staged { staged, live, .. } = piece;
            let name = base_name(live);
            (self.journal)(format!("[Injector] Подмена архива: {name}"));
            match points::swap_in(staged, live) {
                Ok(()) => done += 1,
                Err(error) => return (done, Err(error)),
            }
            // Имя говорит о первой подмене, но точка стоит после каждой.
            failpoint::hit("install-after-first-swap");
        }
        (done, Ok(()))
    }

    /// Сверка, опись, подмена, уборка. В ошибке — номера готовых файлов, которые
    /// уже подменены; откат делает вызывающий.
    fn commit(
        &mut self,
        progress: &Progress,
        point: &Point<'_>,
        staged: Vec<Staged>,
    ) -> Outcome<()> {
        // Сверка целей и опись точки: отказ здесь случается до первой подмены.
        self.ensure_untouched()
            .and_then(|()| point.record(&self.items(&staged)?))
            .map_err(|error| {
                cleanup_refused(&staged);
                refusal(error)
            })?;
        failpoint::hit("install-after-manifest");

        progress.report("commit");
        let (done, outcome) = self.swap_all(&staged);
        match outcome {
            Ok(()) => {
                cleanup(&staged);
                Ok(())
            }
            Err(error) => {
                cleanup_refused(&staged);
                Err((error.into(), (0..done).collect()))
            }
        }
    }

    /// Возвращает подменённое, в том порядке, как дано; `true`, если вернулось всё.
    fn restore(&mut self, committed: Swapped) -> bool {
        let mut all_back = true;
        for index in committed {
            let back = self.backups[index].undo(&self.targets[index], &mut *self.journal);
            all_back &= back;
        }
        all_back
    }

    /// Откат: если что-то не вернулось, точка остаётся с описью, других копий нет.
    fn unwind(&mut self, committed: Swapped, restore_root: &Path, id: &str) {
        if !self.restore(committed) {
            return;
        }
        fs::remove_dir_all(restore_root).unwrap_or_else(|error| {
            (self.journal)(format!("[Install] Точка {id} не убрана: {error}"));
        });
    }
}

/// Сверка, опись, подмена, уборка. В ошибке — номера готовых файлов, которые
/// уже подменены; откат делает вызывающий.
pub(crate) fn commit(
    staged: Vec<Staged>,
    progress: &Progress,
    targets: &Targets,
    backups: &Backups,
    point: &Point<'_>,
) -> Outcome<()> {
    let mut to_log = |line: String| log(line);
    let mut run = Run {
        targets,
        backups,
        journal: &mut to_log,
    };
    run.commit(progress, point, staged)
}

/// Убирает служебные папки готовых файлов; ошибки молчат, повтор безвреден.
pub(crate) fn cleanup(staged: &Pieces) {
    staged.iter().for_each(Staged::erase_folder);
}

/// То же после отказа: своя служебная папка уходит целиком, а папка, которая
/// лежала до установки, остаётся со всем чужим, из неё убирается только готовый
/// файл.
pub(crate) fn cleanup_refused(staged: &Pieces) {
    staged.iter().for_each(Staged::erase_after_refusal);
}

/// Откат после отказа: подменённое возвращается в том порядке, как дано, и
/// только если всё вернулось, точка убирается. Ничего не возвращает: неудача
/// возврата не подменяет первопричину, она видна лишь в журнале.
pub(crate) fn unwind(
    id: &str,
    restore_root: &Path,
    targets: &Targets,
    backups: &Backups,
    committed: Swapped,
) {
    let mut to_log = |line: String| log(line);
    let mut run = Run {
        targets,
        backups,
        journal: &mut to_log,
    };
    run.unwind(committed, restore_root, id);
}

/// Возвращает подменённое, в том порядке, как дано; `true`, если вернулось всё.
pub(crate) fn restore_committed(
    targets: &Targets,
    backups: &Backups,
    committed: Swapped,
    journal: Journal<'_>,
) -> bool {
    let mut run = Run {
        targets,
        backups,
        journal,
    };
    run.restore(committed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::sha256_hex;
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::{tempdir, TempDir};

    const ID: &str = "rpf-20261104-120000-aaaaaaaaaaaaaaaaaa";
    const UPDATE: &str = "update/update.rpf";
    const COMMON: &str = "common.rpf";

    // ----- стенд -----

    /// Игра с тремя файлами и пустая папка точек.
    struct Lab {
        _dir: Option<TempDir>,
        game: PathBuf,
        points: PathBuf,
        point: PathBuf,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempdir().unwrap();
            let game = dir.path().join("game");
            let points = dir.path().join("points");
            put(&game.join("GTA5.exe"), "");
            put(&game.join(COMMON), "LIVE-COMMON");
            put(&game.join(UPDATE), "LIVE-UPDATE");
            fs::create_dir_all(&points).unwrap();
            let point = points.join(ID);
            Lab {
                _dir: Some(dir),
                game,
                points,
                point,
            }
        }

        /// Стенд, уже лежащий в папке `root` (его создал другой процесс).
        #[cfg(feature = "failpoints")]
        fn at(root: &Path) -> Lab {
            let points = root.join("points");
            Lab {
                _dir: None,
                game: root.join("game"),
                point: points.join(ID),
                points,
            }
        }

        #[cfg(feature = "failpoints")]
        fn root(&self) -> PathBuf {
            self.game.parent().unwrap().to_owned()
        }

        fn with_point() -> Lab {
            let lab = Lab::new();
            fs::create_dir_all(&lab.point).unwrap();
            lab
        }

        fn live(&self, relative: &str) -> PathBuf {
            self.game.join(relative)
        }

        fn targets(&self) -> Vec<(String, PathBuf)> {
            [UPDATE, COMMON]
                .iter()
                .map(|relative| ((*relative).to_owned(), self.live(relative)))
                .collect()
        }

        fn stage(&self, relative: &str, content: &str, tag: &str) -> Staged {
            let live = self.live(relative);
            let stage_dir = live.parent().unwrap().join(format!(".astral-stage-{tag}"));
            let staged = stage_dir.join(live.file_name().unwrap());
            put(&staged, content);
            Staged {
                relative: relative.to_owned(),
                live,
                stage_dir,
                preexisting: false,
                staged,
                sha256_after: sha_upper(content),
            }
        }

        fn point_info(&self) -> Point<'_> {
            Point {
                id: ID,
                root: &self.point,
                game_root: &self.game,
                patch: Path::new("C:\\patches\\my patch"),
                created_dirs: &[],
            }
        }

        /// Копии обоих архивов (жёсткие ссылки) и готовые файлы с новым содержимым.
        fn prepared(&self) -> (Vec<(String, PathBuf)>, Vec<Backup>, Vec<Staged>) {
            let targets = self.targets();
            let mut backups = Vec::new();
            make_backups(&targets, &self.point, &Progress::silent(), &mut backups).unwrap();
            let staged = vec![
                self.stage(UPDATE, "NEW-UPDATE", "t0"),
                self.stage(COMMON, "NEW-COMMON", "t1"),
            ];
            (targets, backups, staged)
        }
    }

    fn put(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn text(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    fn sha_upper(content: &str) -> String {
        sha256_hex(content.as_bytes()).to_uppercase()
    }

    /// Дерево каталога одной строкой на запись: `путь/`, `путь=«текст»` или `путь (N Б)`.
    fn listing(root: &Path) -> Vec<String> {
        fn visit(base: &Path, dir: &Path, out: &mut Vec<String>) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let relative = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                if path.is_dir() {
                    out.push(format!("{relative}/"));
                    visit(base, &path, out);
                } else {
                    let bytes = fs::read(&path).unwrap_or_default();
                    if relative.ends_with("restore.json") {
                        out.push(relative);
                    } else if bytes.len() <= 40 {
                        out.push(format!("{relative}=«{}»", String::from_utf8_lossy(&bytes)));
                    } else {
                        out.push(format!("{relative} ({} Б)", bytes.len()));
                    }
                }
            }
        }
        let mut out = Vec::new();
        visit(root, root, &mut out);
        out.sort();
        out
    }

    fn silent() -> Progress {
        Progress::silent()
    }

    /// Ход, собранный в список строк.
    fn recorded() -> (Progress, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);
        let progress = Progress::with_sink(move |line| sink.lock().unwrap().push(line.to_owned()));
        (progress, lines)
    }

    fn lines_of(lines: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        lines.lock().unwrap().clone()
    }

    fn phase(name: &str, done: u64, total: u64) -> String {
        format!(r#"{{"progress":{{"phase":"{name}","copiedBytes":{done},"totalBytes":{total}}}}}"#)
    }

    /// Прогон `commit` с подставным журналом: итог, журнал, строки хода.
    fn run_commit(
        lab: &Lab,
        staged: Vec<Staged>,
        targets: &[(String, PathBuf)],
        backups: &[Backup],
    ) -> (std::result::Result<(), Failure>, Vec<String>, Vec<String>) {
        let (progress, ledger) = recorded();
        let mut journal = Vec::new();
        let outcome = Run {
            targets,
            backups,
            journal: &mut |line| journal.push(line),
        }
        .commit(&progress, &lab.point_info(), staged);
        (outcome, journal, lines_of(&ledger))
    }

    fn run_unwind(
        lab: &Lab,
        targets: &[(String, PathBuf)],
        backups: &[Backup],
        committed: Vec<usize>,
    ) -> Vec<String> {
        let mut journal = Vec::new();
        Run {
            targets,
            backups,
            journal: &mut |line| journal.push(line),
        }
        .unwind(committed, &lab.point, ID);
        journal
    }

    fn refusal(outcome: std::result::Result<(), Failure>) -> (String, String, Vec<usize>) {
        match outcome {
            Ok(()) => panic!("ожидался отказ"),
            Err((error, committed)) => (error.code, error.message, committed),
        }
    }

    fn failure_of<T>(outcome: Result<T>) -> EngineError {
        match outcome {
            Ok(_) => panic!("ожидался отказ"),
            Err(error) => error,
        }
    }

    #[cfg(windows)]
    fn hold_exclusively(path: &Path) -> fs::File {
        use std::os::windows::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(path)
            .unwrap()
    }

    // ----- копия «до» и отпечаток (Тр1-Тр7) -----

    #[test]
    fn an_absent_backup_creates_nothing_and_knows_its_empty_hash() {
        let backup = absent_backup(Path::new("points-root"), "dlc/dlc.rpf");
        assert_eq!(
            backup.path,
            points::backup_path(Path::new("points-root"), "dlc/dlc.rpf")
        );
        assert_eq!(
            backup.stamp,
            Stamp {
                len: 0,
                modified: None
            }
        );
        assert!(backup.absent);
        assert_eq!(*locked(&backup.known), Some(String::new()));
        assert!(locked(&backup.hash).is_none());
        assert_eq!(backup.hash().unwrap(), "");
        assert!(!backup.path.exists());
    }

    #[test]
    fn the_hash_of_a_link_copy_is_waited_for_once_and_remembered() {
        let lab = Lab::with_point();
        let mut backups = Vec::new();
        make_backups(&lab.targets(), &lab.point, &silent(), &mut backups).unwrap();
        let backup = &backups[0];
        assert!(locked(&backup.hash).is_some() && locked(&backup.known).is_none());
        let first = backup.hash().unwrap();
        assert_eq!(first, sha_upper("LIVE-UPDATE"));
        assert_eq!(backup.hash().unwrap(), first);
        assert!(locked(&backup.hash).is_none());
        assert_eq!(*locked(&backup.known), Some(first));
    }

    fn bare(worker: Option<JoinHandle<Result<String>>>, known: Option<&str>) -> Backup {
        Backup {
            path: PathBuf::from("x"),
            stamp: Stamp {
                len: 0,
                modified: None,
            },
            hash: Mutex::new(worker),
            known: Mutex::new(known.map(str::to_owned)),
            absent: false,
        }
    }

    #[test]
    fn a_hash_without_thread_or_value_is_an_internal_error() {
        // Тр4
        let error = failure_of(bare(None, None).hash());
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("InternalError", "The backup hash is missing.")
        );
        // Тр5: ошибка потока проходит как есть, поток уже забран
        let backup = bare(
            Some(thread::spawn(|| {
                Err(EngineError::io("thread failed on purpose"))
            })),
            None,
        );
        let first = failure_of(backup.hash());
        assert_eq!(
            (first.code.as_str(), first.message.as_str()),
            ("IOException", "thread failed on purpose")
        );
        let second = failure_of(backup.hash());
        assert_eq!(second.message, "The backup hash is missing.");
        // Тр6: паника потока
        let panicking = bare(
            Some(thread::spawn(|| -> Result<String> { panic!("boom") })),
            None,
        );
        let error = failure_of(panicking.hash());
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("InternalError", "The backup hash thread failed.")
        );
        // Тр7: известное значение побеждает, поток не трогается
        let known = bare(
            Some(thread::spawn(|| Ok("OTHER".to_owned()))),
            Some("KNOWN"),
        );
        assert_eq!(known.hash().unwrap(), "KNOWN");
        assert!(locked(&known.hash).is_some());
    }

    // ----- снятие копий (Тр8-Тр18) -----

    #[test]
    fn make_backups_links_the_live_archives_into_the_point() {
        let lab = Lab::with_point();
        let (progress, ledger) = recorded();
        let mut backups = Vec::new();
        make_backups(&lab.targets(), &lab.point, &progress, &mut backups).unwrap();

        assert_eq!(
            listing(&lab.point),
            [
                "common.rpf=«LIVE-COMMON»",
                "update/",
                "update/update.rpf=«LIVE-UPDATE»"
            ]
        );
        assert_eq!(backups.len(), 2);
        assert!(backups.iter().all(|backup| !backup.absent));
        assert_eq!(
            backups[0].path,
            points::backup_path(&lab.point, "update/update.rpf")
        );
        assert_eq!(backups[0].stamp, points::stamp(&lab.live(UPDATE)).unwrap());
        assert_eq!(backups[0].hash().unwrap(), sha_upper("LIVE-UPDATE"));
        assert_eq!(backups[1].hash().unwrap(), sha_upper("LIVE-COMMON"));
        assert_eq!(
            lines_of(&ledger),
            [phase("backup", 0, 22), phase("backup", 22, 22)]
        );

        // Тр9: запись в живой файл «на месте» видна и в копии
        fs::write(lab.live(UPDATE), "CHANGED-IN-PLACE").unwrap();
        assert_eq!(text(&backups[0].path), "CHANGED-IN-PLACE");
    }

    #[test]
    fn make_backups_with_nothing_still_announces_the_stage() {
        let lab = Lab::new();
        let (progress, ledger) = recorded();
        let mut backups = Vec::new();
        make_backups(&[], &lab.point, &progress, &mut backups).unwrap();
        assert!(backups.is_empty());
        assert!(!lab.point.exists());
        assert_eq!(lines_of(&ledger), [phase("backup", 0, 0)]);
    }

    #[test]
    fn a_missing_live_archive_stops_make_backups_before_any_write() {
        for order in [[UPDATE, "ghost.rpf"], ["ghost.rpf", UPDATE]] {
            let lab = Lab::with_point();
            let targets: Vec<(String, PathBuf)> = order
                .iter()
                .map(|relative| ((*relative).to_owned(), lab.live(relative)))
                .collect();
            let (progress, ledger) = recorded();
            let mut backups = Vec::new();
            let (error, committed) =
                make_backups(&targets, &lab.point, &progress, &mut backups).unwrap_err();
            assert_eq!(error.code, "FileNotFoundException");
            assert!(error.message.ends_with("(os error 2)"));
            assert!(committed.is_empty() && backups.is_empty());
            assert!(listing(&lab.point).is_empty());
            assert!(lines_of(&ledger).is_empty());
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_in_place_of_a_live_archive_fails_the_copy_and_keeps_the_made_folders() {
        // Тр13
        let lab = Lab::with_point();
        fs::create_dir_all(lab.live("sub")).unwrap();
        let targets = vec![("sub".to_owned(), lab.live("sub"))];
        let (progress, ledger) = recorded();
        let mut backups = Vec::new();
        let (error, committed) =
            make_backups(&targets, &lab.point, &progress, &mut backups).unwrap_err();
        assert_eq!(error.code, "UnauthorizedAccessException");
        assert!(committed.is_empty() && backups.is_empty());
        assert_eq!(lines_of(&ledger), [phase("backup", 0, 0)]);
    }

    #[test]
    fn an_old_copy_is_replaced_and_new_copies_join_the_existing_vector() {
        let lab = Lab::with_point();
        // Тр14: старая копия только для чтения с чужими байтами
        let old = points::backup_path(&lab.point, UPDATE);
        put(&old, "FOREIGN");
        points::mark_readonly(&old).unwrap();
        // Тр15: вектор уже непустой
        let mut backups = vec![absent_backup(&lab.point, "dlc/dlc.rpf")];
        make_backups(&lab.targets()[..1], &lab.point, &silent(), &mut backups).unwrap();
        assert_eq!(backups.len(), 2);
        assert_eq!(
            backups
                .iter()
                .map(|backup| backup.absent)
                .collect::<Vec<_>>(),
            [true, false]
        );
        assert_eq!(text(&old), "LIVE-UPDATE");
    }

    #[test]
    fn relative_paths_are_not_checked_and_folders_are_made_on_demand() {
        let lab = Lab::with_point();
        // Тр16: «..» выводит копию из каталога точки
        let mut backups = Vec::new();
        make_backups(
            &[("../escaped.rpf".to_owned(), lab.live(UPDATE))],
            &lab.point,
            &silent(),
            &mut backups,
        )
        .unwrap();
        assert_eq!(text(&lab.points.join("escaped.rpf")), "LIVE-UPDATE");
        // Тр17: родительские каталоги создаются
        let other = Lab::with_point();
        let mut backups = Vec::new();
        make_backups(
            &[("a/b/c.rpf".to_owned(), other.live(UPDATE))],
            &other.point,
            &silent(),
            &mut backups,
        )
        .unwrap();
        assert_eq!(
            listing(&other.point),
            ["a/", "a/b/", "a/b/c.rpf=«LIVE-UPDATE»"]
        );
    }

    #[cfg(windows)]
    #[test]
    fn when_the_link_limit_is_reached_a_real_copy_is_made() {
        // Тр18: у NTFS не больше 1023 имён у одного файла
        let lab = Lab::with_point();
        let live = lab.live(UPDATE);
        let crowd = lab.game.join("crowd");
        fs::create_dir_all(&crowd).unwrap();
        let mut made = 0;
        while fs::hard_link(&live, crowd.join(format!("l{made}"))).is_ok() {
            made += 1;
        }
        assert_eq!(made, 1023, "ссылок до отказа должно выйти 1023");

        let (progress, ledger) = recorded();
        let mut backups = Vec::new();
        make_backups(&lab.targets()[..1], &lab.point, &progress, &mut backups).unwrap();
        let backup = &backups[0];
        assert_eq!(*locked(&backup.known), Some(sha_upper("LIVE-UPDATE")));
        assert!(locked(&backup.hash).is_none());
        // копия независима от живого файла
        fs::write(&live, "CHANGED").unwrap();
        assert_eq!(text(&backup.path), "LIVE-UPDATE");
        assert_eq!(
            lines_of(&ledger),
            [
                phase("backup", 0, 11),
                phase("backup", 11, 11),
                phase("backup", 11, 11)
            ]
        );
    }

    // ----- проверка места (Тр19-Тр30) -----

    const MIB: u64 = 1 << 20;

    #[test]
    fn preflight_sizes_asks_the_points_folder_first() {
        let lab = Lab::new();
        // Тр19-Тр20: хватает суммы с запасом, пустой список - один запас
        preflight_sizes(&lab.game, &[3 * MIB, 5 * MIB], &lab.points).unwrap();
        preflight_sizes(&lab.game, &[], &lab.points).unwrap();

        // Тр21: нужно 2^30 МиБ и запас 256 МиБ; путь печатается как передан
        let error = failure_of(preflight_sizes(&lab.game, &[1 << 50], &lab.points));
        assert_eq!(error.code, "InvalidOperationException");
        assert!(
            error.message.starts_with(&format!(
                "Not enough disk space on {}: need 1073742080 MiB, free ",
                lab.points.display()
            )),
            "{}",
            error.message
        );
        // Тр22: при одном томе обе проверки одинаковы - но печатается первая папка
        let error = failure_of(preflight_sizes(&lab.game, &[1 << 50], &lab.game));
        assert!(error.message.contains(&lab.game.display().to_string()));

        // Тр25: папка точек ещё не создана - место по ближайшему существующему родителю
        preflight_sizes(&lab.game, &[], &lab.points.join("not").join("yet")).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn preflight_reports_a_missing_volume_and_a_file_in_place_of_a_folder() {
        let lab = Lab::new();
        if Path::new("Z:\\").exists() {
            return; // диск Z: на этой машине есть, примеры про его отсутствие неприменимы
        }
        // Тр23: каталог точек проверяется первым
        let error = failure_of(preflight_sizes(
            &lab.game,
            &[],
            Path::new("Z:\\nope\\points"),
        ));
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            (
                "FileNotFoundException",
                "No existing folder above Z:\\nope\\points"
            )
        );
        // Тр24: до игры доходит только когда с точками всё в порядке
        let error = failure_of(preflight_sizes(Path::new("Z:\\game"), &[], &lab.points));
        assert_eq!(error.message, "No existing folder above Z:\\game");
        // Тр26: путь файла вместо папки - отказ системы
        let error = failure_of(preflight_sizes(&lab.live(COMMON), &[], &lab.points));
        assert_eq!(error.code, "IOException");
        assert!(
            error.message.ends_with("(os error 267)"),
            "{}",
            error.message
        );
    }

    #[test]
    fn preflight_takes_the_sizes_from_the_live_archives() {
        let lab = Lab::new();
        // Тр27, Тр29
        preflight(&lab.game, &lab.targets(), &lab.points).unwrap();
        preflight(&lab.game, &[], &lab.points).unwrap();
        // Тр28: размеры читаются до проверки места
        let mut targets = lab.targets();
        targets.push(("ghost.rpf".to_owned(), lab.live("ghost.rpf")));
        let error = failure_of(preflight(&lab.game, &targets, &lab.points));
        assert_eq!(error.code, "FileNotFoundException");
        assert!(error.message.ends_with("(os error 2)"));
        // Тр30: каталог вместо файла - размер берётся как есть
        fs::create_dir_all(lab.live("folder")).unwrap();
        preflight(
            &lab.game,
            &[("folder".to_owned(), lab.live("folder"))],
            &lab.points,
        )
        .unwrap();
    }

    // ----- фиксация (Тр31-Тр42) -----

    #[test]
    fn commit_writes_the_manifest_before_the_first_swap_and_keeps_the_point() {
        let lab = Lab::with_point();
        let (targets, backups, staged) = lab.prepared();
        let (outcome, journal, ledger) = run_commit(&lab, staged, &targets, &backups);
        outcome.unwrap();

        assert_eq!(
            listing(&lab.game),
            [
                "GTA5.exe=«»",
                "common.rpf=«NEW-COMMON»",
                "update/",
                "update/update.rpf=«NEW-UPDATE»"
            ]
        );
        assert_eq!(
            listing(&lab.point),
            [
                "common.rpf=«LIVE-COMMON»",
                "restore.json",
                "update/",
                "update/update.rpf=«LIVE-UPDATE»"
            ]
        );
        assert_eq!(ledger, [phase("commit", 0, 0)]);
        assert_eq!(
            journal,
            [
                "[Injector] Подмена архива: update.rpf",
                "[Injector] Подмена архива: common.rpf"
            ]
        );

        let manifest = points::read_manifest(&lab.point.join("restore.json")).unwrap();
        assert_eq!(manifest.game_root, lab.game.to_string_lossy());
        let described: Vec<(String, String, Option<String>)> = manifest
            .archives
            .iter()
            .map(|entry| {
                (
                    entry.relative_path.clone(),
                    entry.sha256_before.clone(),
                    entry.sha256_after.clone(),
                )
            })
            .collect();
        assert_eq!(
            described,
            [
                (
                    UPDATE.to_owned(),
                    sha_upper("LIVE-UPDATE"),
                    Some(sha_upper("NEW-UPDATE"))
                ),
                (
                    COMMON.to_owned(),
                    sha_upper("LIVE-COMMON"),
                    Some(sha_upper("NEW-COMMON"))
                ),
            ]
        );
        let raw = text(&lab.point.join("restore.json"));
        assert!(raw.contains("\"patch\": \"C:\\\\patches\\\\my patch\""));
        assert!(raw.contains(&format!(
            "\"livePath\": \"{}\"",
            lab.live(UPDATE).to_string_lossy().replace('\\', "\\\\")
        )));
    }

    #[test]
    fn a_live_archive_that_changed_stops_the_commit_before_any_swap() {
        let changed = |relative: &str| {
            format!(
                "{relative} изменился, пока шла установка: его трогал другой процесс \
                 (игра, проверка файлов, другой мод). Ничего не подменено — повторите установку."
            )
        };
        // Тр32: второй живой файл успели дополнить после снятия копии
        let lab = Lab::with_point();
        let (targets, backups, staged) = lab.prepared();
        {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .append(true)
                .open(lab.live(COMMON))
                .unwrap();
            file.write_all(b"+LATER").unwrap();
        }
        let (outcome, journal, ledger) = run_commit(&lab, staged, &targets, &backups);
        assert_eq!(
            refusal(outcome),
            (
                "InvalidOperationException".to_owned(),
                changed(COMMON),
                Vec::new()
            )
        );
        assert!(journal.is_empty() && ledger.is_empty());
        assert_eq!(
            listing(&lab.game),
            [
                "GTA5.exe=«»",
                "common.rpf=«LIVE-COMMON+LATER»",
                "update/",
                "update/update.rpf=«LIVE-UPDATE»"
            ]
        );
        // описи нет, служебные папки убраны, копии точки остались
        assert!(!lab.point.join("restore.json").exists());
        assert_eq!(
            listing(&lab.point),
            [
                "common.rpf=«LIVE-COMMON+LATER»",
                "update/",
                "update/update.rpf=«LIVE-UPDATE»"
            ]
        );

        // Тр33: поменялось только время изменения (+60 с)
        let lab = Lab::with_point();
        let (targets, backups, staged) = lab.prepared();
        let before = points::stamp(&lab.live(UPDATE)).unwrap();
        let handle = fs::OpenOptions::new()
            .write(true)
            .open(lab.live(UPDATE))
            .unwrap();
        handle
            .set_modified(before.modified.unwrap() + Duration::from_secs(60))
            .unwrap();
        drop(handle);
        let (outcome, _, _) = run_commit(&lab, staged, &targets, &backups);
        assert_eq!(
            refusal(outcome),
            (
                "InvalidOperationException".to_owned(),
                changed(UPDATE),
                Vec::new()
            )
        );
    }

    #[test]
    fn replaced_bytes_with_the_same_length_and_time_are_not_noticed() {
        // Тр34
        let lab = Lab::with_point();
        let (targets, backups, staged) = lab.prepared();
        let before = points::stamp(&lab.live(UPDATE)).unwrap();
        let handle = fs::OpenOptions::new()
            .write(true)
            .open(lab.live(UPDATE))
            .unwrap();
        {
            use std::io::Write;
            (&handle).write_all(b"XXXX-UPDATE").unwrap();
        }
        handle.set_modified(before.modified.unwrap()).unwrap();
        drop(handle);
        assert_eq!(points::stamp(&lab.live(UPDATE)).unwrap(), before);
        let (outcome, journal, _) = run_commit(&lab, staged, &targets, &backups);
        outcome.unwrap();
        assert_eq!(text(&lab.live(UPDATE)), "NEW-UPDATE");
        assert_eq!(journal[0], "[Injector] Подмена архива: update.rpf");
    }

    #[test]
    fn a_target_marked_absent_must_still_be_absent() {
        // Тр35: цель «не было», а файл есть
        let lab = Lab::with_point();
        let targets = lab.targets()[..1].to_vec();
        let backups = vec![absent_backup(&lab.point, UPDATE)];
        let staged = vec![lab.stage(UPDATE, "NEW-UPDATE", "t0")];
        let (outcome, _, _) = run_commit(&lab, staged, &targets, &backups);
        assert_eq!(
            refusal(outcome),
            (
                "InvalidOperationException".to_owned(),
                "update/update.rpf появился, пока шла установка: его трогал другой процесс. \
                 Ничего не подменено — повторите установку."
                    .to_owned(),
                Vec::new()
            )
        );
        assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
        assert!(listing(&lab.point).is_empty());
        assert!(!lab.live("update/.astral-stage-t0").exists());
    }

    #[test]
    fn an_archive_the_install_creates_appears_by_a_rename_and_is_recorded_as_absent() {
        // Тр36
        let lab = Lab::with_point();
        fs::remove_file(lab.live(UPDATE)).unwrap();
        let targets = lab.targets()[..1].to_vec();
        let backups = vec![absent_backup(&lab.point, UPDATE)];
        let staged = vec![lab.stage(UPDATE, "NEW-UPDATE", "t0")];
        let (outcome, journal, ledger) = run_commit(&lab, staged, &targets, &backups);
        outcome.unwrap();
        assert_eq!(text(&lab.live(UPDATE)), "NEW-UPDATE");
        assert_eq!(listing(&lab.point), ["restore.json"]);
        let manifest = points::read_manifest(&lab.point.join("restore.json")).unwrap();
        assert_eq!(manifest.archives[0].sha256_before, "");
        assert!(!points::backup_path(&lab.point, UPDATE).exists());
        assert_eq!(ledger, [phase("commit", 0, 0)]);
        assert_eq!(journal, ["[Injector] Подмена архива: update.rpf"]);
    }

    #[test]
    fn without_a_point_folder_the_manifest_cannot_be_written_and_nothing_is_swapped() {
        // Тр37
        let lab = Lab::new();
        let targets = lab.targets()[..1].to_vec();
        let mut backups = Vec::new();
        fs::create_dir_all(&lab.point).unwrap();
        make_backups(&targets, &lab.point, &silent(), &mut backups).unwrap();
        // отпечатки копий считают потоки: пока один читает копию, удаление папки
        // даёт ему то «нет файла», то «отказано в доступе», и тест мигал
        for backup in &backups {
            backup.hash().unwrap();
        }
        crate::test_support::remove_dir_and_wait(&lab.point);
        let staged = vec![lab.stage(UPDATE, "NEW-UPDATE", "t0")];
        let (outcome, journal, ledger) = run_commit(&lab, staged, &targets, &backups);
        let (code, _, committed) = refusal(outcome);
        assert_eq!(code, "FileNotFoundException");
        assert!(committed.is_empty() && journal.is_empty() && ledger.is_empty());
        assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
        assert!(!lab.live("update/.astral-stage-t0").exists());

        // Тр38: у копии нет ни потока отпечатка, ни значения
        let lab = Lab::with_point();
        let targets = lab.targets()[..1].to_vec();
        let backups = vec![Backup {
            path: points::backup_path(&lab.point, UPDATE),
            stamp: points::stamp(&lab.live(UPDATE)).unwrap(),
            hash: Mutex::new(None),
            known: Mutex::new(None),
            absent: false,
        }];
        let staged = vec![lab.stage(UPDATE, "NEW-UPDATE", "t0")];
        let (outcome, _, _) = run_commit(&lab, staged, &targets, &backups);
        assert_eq!(
            refusal(outcome),
            (
                "InternalError".to_owned(),
                "The backup hash is missing.".to_owned(),
                Vec::new()
            )
        );
        assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
        assert!(!lab.live("update/.astral-stage-t0").exists());
    }

    #[test]
    fn a_failed_swap_reports_what_is_already_swapped_and_cleans_every_stage_folder() {
        // Тр39: готовый файл второго архива пропал перед его подменой
        let lab = Lab::with_point();
        let (targets, backups, staged) = lab.prepared();
        fs::remove_file(&staged[1].staged).unwrap();
        let (outcome, journal, ledger) = run_commit(&lab, staged, &targets, &backups);
        let (code, message, committed) = refusal(outcome);
        assert_eq!(code, "FileNotFoundException");
        assert!(message.ends_with("(os error 2)"));
        assert_eq!(committed, [0]);
        assert_eq!(
            listing(&lab.game),
            [
                "GTA5.exe=«»",
                "common.rpf=«LIVE-COMMON»",
                "update/",
                "update/update.rpf=«NEW-UPDATE»"
            ]
        );
        assert!(lab.point.join("restore.json").is_file());
        assert_eq!(ledger, [phase("commit", 0, 0)]);
        assert_eq!(
            journal,
            [
                "[Injector] Подмена архива: update.rpf",
                "[Injector] Подмена архива: common.rpf"
            ]
        );
    }

    #[test]
    fn lists_of_different_length_are_walked_by_their_common_part_but_every_staged_file_is_swapped()
    {
        // Тр40: готовых файлов 2, копий 1
        let lab = Lab::with_point();
        let (targets, mut backups, staged) = lab.prepared();
        backups.truncate(1);
        let (outcome, journal, _) = run_commit(&lab, staged, &targets, &backups);
        outcome.unwrap();
        assert_eq!(text(&lab.live(COMMON)), "NEW-COMMON");
        assert_eq!(text(&lab.live(UPDATE)), "NEW-UPDATE");
        let manifest = points::read_manifest(&lab.point.join("restore.json")).unwrap();
        assert_eq!(manifest.archives.len(), 1);
        assert_eq!(journal.len(), 2);

        // Тр41: готовых файлов нет - успешная фиксация с пустой описью
        let lab = Lab::with_point();
        let (outcome, journal, ledger) = run_commit(&lab, Vec::new(), &[], &[]);
        outcome.unwrap();
        assert!(journal.is_empty());
        assert_eq!(ledger, [phase("commit", 0, 0)]);
        let manifest = points::read_manifest(&lab.point.join("restore.json")).unwrap();
        assert!(manifest.archives.is_empty());
    }

    #[test]
    fn the_readonly_flag_of_a_live_archive_moves_to_the_new_file() {
        // Тр42
        let lab = Lab::with_point();
        let (targets, backups, staged) = lab.prepared();
        let live = lab.live(UPDATE);
        points::mark_readonly(&live).unwrap();
        let (outcome, _, _) = run_commit(&lab, staged, &targets, &backups);
        outcome.unwrap();
        assert_eq!(text(&live), "NEW-UPDATE");
        assert!(fs::metadata(&live).unwrap().permissions().readonly());
        points::clear_readonly(&live).unwrap();
        points::clear_readonly(&backups[0].path).unwrap();
    }

    // ----- уборка и откат (Тр43-Тр56) -----

    #[test]
    fn cleanup_removes_the_stage_folders_only() {
        let lab = Lab::with_point();
        let (_, _, staged) = lab.prepared();
        assert!(staged.iter().all(|piece| piece.stage_dir.is_dir()));
        cleanup(&staged);
        assert_eq!(
            listing(&lab.game),
            [
                "GTA5.exe=«»",
                "common.rpf=«LIVE-COMMON»",
                "update/",
                "update/update.rpf=«LIVE-UPDATE»"
            ]
        );
        assert!(lab.point.is_dir());
        // Тр44: повтор безвреден
        cleanup(&staged);
    }

    #[cfg(windows)]
    #[test]
    fn a_stage_folder_with_a_busy_file_stays_and_the_other_one_goes() {
        // Тр45
        let lab = Lab::with_point();
        let (_, _, staged) = lab.prepared();
        let hold = hold_exclusively(&staged[0].staged);
        cleanup(&staged);
        drop(hold);
        assert!(staged[0].stage_dir.exists());
        assert!(!staged[1].stage_dir.exists());
    }

    /// Установленное состояние: копии сняты, оба файла подменены.
    fn installed(lab: &Lab) -> (Vec<(String, PathBuf)>, Vec<Backup>, Vec<usize>) {
        let (targets, backups, staged) = lab.prepared();
        let (outcome, _, _) = run_commit(lab, staged, &targets, &backups);
        outcome.unwrap();
        (targets, backups, vec![0, 1])
    }

    #[test]
    fn unwinding_nothing_removes_the_whole_point_and_leaves_the_live_files() {
        // Тр46
        let lab = Lab::with_point();
        let (targets, backups, _) = lab.prepared();
        let journal = run_unwind(&lab, &targets, &backups, Vec::new());
        assert!(journal.is_empty());
        assert!(!lab.point.exists());
        assert!(lab.points.is_dir());
        assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
    }

    #[test]
    fn unwinding_puts_the_copies_back_in_the_given_order_and_removes_the_point() {
        // Тр47: список committed намеренно неполный - второй остаётся новым
        let lab = Lab::with_point();
        let (targets, backups, _) = installed(&lab);
        let journal = run_unwind(&lab, &targets, &backups, vec![0]);
        assert_eq!(
            journal,
            ["[Install] Возврат резервной копии: update/update.rpf"]
        );
        assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
        assert_eq!(text(&lab.live(COMMON)), "NEW-COMMON");
        assert!(!lab.point.exists());

        // Тр48: порядок возврата - как в списке, не обратный
        let lab = Lab::with_point();
        let (targets, backups, _) = installed(&lab);
        let journal = run_unwind(&lab, &targets, &backups, vec![1, 0]);
        assert_eq!(
            journal,
            [
                "[Install] Возврат резервной копии: common.rpf",
                "[Install] Возврат резервной копии: update/update.rpf"
            ]
        );
        assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
        assert_eq!(text(&lab.live(COMMON)), "LIVE-COMMON");
        assert!(!lab.point.exists());
    }

    fn created_by_install(lab: &Lab) -> (Vec<(String, PathBuf)>, Vec<Backup>) {
        fs::remove_file(lab.live(UPDATE)).unwrap();
        let targets = lab.targets()[..1].to_vec();
        let backups = vec![absent_backup(&lab.point, UPDATE)];
        let staged = vec![lab.stage(UPDATE, "NEW-UPDATE", "t0")];
        let (outcome, _, _) = run_commit(lab, staged, &targets, &backups);
        outcome.unwrap();
        (targets, backups)
    }

    #[test]
    fn an_archive_created_by_the_install_is_deleted_on_unwind() {
        // Тр49
        let lab = Lab::with_point();
        let (targets, backups) = created_by_install(&lab);
        let journal = run_unwind(&lab, &targets, &backups, vec![0]);
        assert_eq!(
            journal,
            ["[Install] Удаление созданного архива: update/update.rpf"]
        );
        assert!(!lab.live(UPDATE).exists());
        assert!(!lab.point.exists());

        // Тр50: созданного архива уже нет на диске - это не ошибка
        let lab = Lab::with_point();
        let (targets, backups) = created_by_install(&lab);
        fs::remove_file(lab.live(UPDATE)).unwrap();
        let journal = run_unwind(&lab, &targets, &backups, vec![0]);
        assert_eq!(
            journal,
            ["[Install] Удаление созданного архива: update/update.rpf"]
        );
        assert!(!lab.point.exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_busy_created_archive_keeps_the_point_with_its_manifest() {
        // Тр51
        let lab = Lab::with_point();
        let (targets, backups) = created_by_install(&lab);
        let hold = hold_exclusively(&lab.live(UPDATE));
        let journal = run_unwind(&lab, &targets, &backups, vec![0]);
        drop(hold);
        assert_eq!(journal.len(), 2);
        assert_eq!(
            journal[0],
            "[Install] Удаление созданного архива: update/update.rpf"
        );
        assert!(journal[1].starts_with("[Install] Созданный архив update/update.rpf не удалён: "));
        assert!(journal[1].ends_with("(os error 32)"), "{}", journal[1]);
        assert!(lab.live(UPDATE).exists());
        assert!(lab.point.join("restore.json").is_file());
    }

    #[test]
    fn a_failed_return_does_not_stop_the_loop_and_keeps_the_point() {
        // Тр52: копия первого архива пропала
        let lab = Lab::with_point();
        let (targets, backups, _) = installed(&lab);
        fs::remove_file(&backups[0].path).unwrap();
        let journal = run_unwind(&lab, &targets, &backups, vec![0, 1]);
        assert_eq!(journal.len(), 3);
        assert_eq!(
            journal[0],
            "[Install] Возврат резервной копии: update/update.rpf"
        );
        assert!(
            journal[1].starts_with("[Install] Резервная копия update/update.rpf не возвращена: ")
        );
        assert!(journal[1].ends_with("(os error 2)"));
        assert_eq!(journal[2], "[Install] Возврат резервной копии: common.rpf");
        assert_eq!(text(&lab.live(UPDATE)), "NEW-UPDATE");
        assert_eq!(text(&lab.live(COMMON)), "LIVE-COMMON");
        assert!(lab.point.join("restore.json").is_file());

        // Тр53: у копии нет отпечатка
        let lab = Lab::with_point();
        let (targets, mut backups, _) = installed(&lab);
        backups[0] = Backup {
            path: backups[0].path.clone(),
            stamp: backups[0].stamp,
            hash: Mutex::new(None),
            known: Mutex::new(None),
            absent: false,
        };
        let journal = run_unwind(&lab, &targets, &backups, vec![0]);
        assert_eq!(
            journal,
            [
                "[Install] Возврат резервной копии: update/update.rpf",
                "[Install] Резервная копия update/update.rpf не возвращена: The backup hash is missing."
            ]
        );
        assert!(lab.point.is_dir());
    }

    #[cfg(windows)]
    #[test]
    fn a_point_that_cannot_be_removed_is_reported() {
        // Тр54: файл в точке занят другим процессом
        let lab = Lab::with_point();
        let mut backups = Vec::new();
        make_backups(&lab.targets()[..1], &lab.point, &silent(), &mut backups).unwrap();
        backups[0].hash().unwrap();
        let hold = hold_exclusively(&backups[0].path);
        let journal = run_unwind(&lab, &lab.targets(), &backups, Vec::new());
        drop(hold);
        assert_eq!(journal.len(), 1);
        assert!(journal[0].starts_with(&format!("[Install] Точка {ID} не убрана: ")));
        assert!(journal[0].ends_with("(os error 32)"), "{}", journal[0]);
        assert!(backups[0].path.exists());
    }

    #[test]
    fn a_missing_point_folder_is_a_not_removed_line_too() {
        // Тр55
        let lab = Lab::new();
        let journal = run_unwind(&lab, &lab.targets(), &[], Vec::new());
        assert_eq!(journal.len(), 1);
        assert!(journal[0].starts_with(&format!("[Install] Точка {ID} не убрана: ")));
        assert!(journal[0].ends_with("(os error 2)"));
    }

    #[test]
    fn a_vanished_live_archive_is_replaced_by_the_point_copy() {
        // Тр56
        let lab = Lab::with_point();
        let (targets, backups, _) = lab.prepared();
        fs::remove_file(lab.live(UPDATE)).unwrap();
        let journal = run_unwind(&lab, &targets, &backups, vec![0]);
        assert_eq!(
            journal,
            ["[Install] Возврат резервной копии: update/update.rpf"]
        );
        assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
    }

    /// Обрывы в точках `install-after-manifest` и `install-after-first-swap`.
    /// Ребёнок - этот же тестовый бинарник, запущенный на одном тесте.
    /// Собирается и идёт с признаком `failpoints`.
    #[cfg(feature = "failpoints")]
    mod failpoint_runs {
        use super::*;
        use std::process::{Command, Stdio};

        const CHILD_DIR: &str = "ASTRAL_TEST_TX_CHILD_DIR";

        /// Сценарий ребёнка: копии, готовые файлы и фиксация в уже созданной папке.
        #[test]
        fn child_commit() {
            let Some(root) = std::env::var_os(CHILD_DIR) else {
                return;
            };
            let lab = Lab::at(Path::new(&root));
            let (targets, backups, staged) = lab.prepared();
            let _ = Run {
                targets: &targets,
                backups: &backups,
                journal: &mut |_| {},
            }
            .commit(&Progress::silent(), &lab.point_info(), staged);
        }

        fn killed_at(lab: &Lab, point: &str) {
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "archives::transaction::tests::failpoint_runs::child_commit",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(CHILD_DIR, lab.root())
                .env("ASTRAL_ENGINE_FAILPOINT", point)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .unwrap();
            assert_eq!(output.status.code(), Some(137));
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            assert!(stderr.contains(&format!("[failpoint] {point}")), "{stderr}");
        }

        fn rolled_back_by_the_point(lab: &Lab) {
            let restored = super::super::super::restore::restore_in(ID, &lab.points, &silent());
            restored.unwrap();
            assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
            assert_eq!(text(&lab.live(COMMON)), "LIVE-COMMON");
            assert!(!lab.point.exists());
        }

        #[test]
        fn killed_after_the_manifest_the_game_is_untouched_and_the_point_is_usable() {
            let lab = Lab::with_point();
            killed_at(&lab, "install-after-manifest");
            assert_eq!(text(&lab.live(UPDATE)), "LIVE-UPDATE");
            assert_eq!(text(&lab.live(COMMON)), "LIVE-COMMON");
            assert!(lab.point.join("restore.json").is_file());
            // служебные папки остаются: убрать их некому
            assert!(lab.live("update/.astral-stage-t0").is_dir());
            assert!(lab.live(".astral-stage-t1").is_dir());
            rolled_back_by_the_point(&lab);
        }

        #[test]
        fn killed_between_two_swaps_the_point_rolls_back_the_first_archive() {
            let lab = Lab::with_point();
            killed_at(&lab, "install-after-first-swap");
            assert_eq!(text(&lab.live(UPDATE)), "NEW-UPDATE");
            assert_eq!(text(&lab.live(COMMON)), "LIVE-COMMON");
            assert!(lab.point.join("restore.json").is_file());
            rolled_back_by_the_point(&lab);
        }
    }
}
