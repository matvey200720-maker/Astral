//! Установка заплатки в архивы игры целиком.
//!
//! Живой архив нигде не пишется «на месте»: каждый затронутый архив строится
//! заново отдельным файлом в служебной папке рядом, перечитывается и проверяется
//! по действиям заплатки, и только потом (одним переименованием) встаёт на место
//! живого. Общую часть с точкой отката делает `transaction`; здесь сборка и
//! проверка готовых файлов.

use serde_json::{json, Map, Value};
use std::{
    cell::Cell,
    fs::{self, File},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use rage_rpf::{
    archive::{Archive, EntryCipher, EntryId, EntryKind},
    tally::{self, Phase as Span, Tally},
    write::{write_archive_with, Finalizer, WriteContext},
    DirNode, Encryption, KeySet, Layout,
};

use crate::{
    args::Options,
    disk::{self, WritePacer},
    error::{EngineError, Result},
    failpoint, paths,
    progress::Progress,
};

use super::{
    apply::{self, Check, Expect},
    archivefix::NgFinalizer,
    compose::{Recording, Streaming},
    game_root, load_keys,
    patch::{self, Validation},
    points, resolve_root_archive, sha256_file,
    streamed::write_streamed,
    transaction::{self, Backup, Point, Staged},
};
use super::{log, random_hex};

/// Команда `install-rpf-patch`.
pub fn install_rpf_patch(options: &Options, progress: &Progress) -> Result<Value> {
    const FINALIZER_NOTE: &str = "Pinned ArchiveFix + header validation";
    const NATIVE_NOTE: &str = "Native NG sealer + header validation";

    let began = Instant::now();
    let _pacing = progress.pace(WritePacer::from_options(options));
    let game = game_root(options)?;
    progress.report("prepare");

    let validation = options
        .required("patch")
        .and_then(|dir| patch::validate(Path::new(dir), Some(&game)))?;
    let (keys_arg, fixer_arg) = (options.optional("keys"), options.optional("archive-fix"));
    let keyed = load_keys(&game.to_string_lossy(), keys_arg)?;
    let key_source = keyed.1;
    let fixer = NgFinalizer::locate(fixer_arg, keyed.0.clone())?;
    let note = if fixer.is_native() {
        NATIVE_NOTE
    } else {
        FINALIZER_NOTE
    };
    let store = points::restore_points_root_for(options)?;
    // время доводчика считает обёртка: имена и запуски в ответ не идут, только время
    let recording = Recording::new(Some(&fixer));
    let prepare = began.elapsed();
    let mut installed = Install {
        progress,
        keys: &keyed.0,
        fixer: Some(&recording),
        store: &store,
        game: &game,
        patch: &validation,
        clock: Clock::default(),
    }
    .run()?;
    let (fix_time, fix_runs) = recording.busy();
    installed
        .timings
        .insert("prepare".to_owned(), millis(prepare).into());
    installed
        .timings
        .insert("archiveFix".to_owned(), millis(fix_time).into());
    installed
        .timings
        .insert("archiveFixRuns".to_owned(), fix_runs.into());
    installed
        .timings
        .insert("total".to_owned(), millis(began.elapsed()).into());
    let Installed {
        archives,
        id,
        restore_root,
        layers,
        timings,
    } = installed;
    let mut answer = json!({
        "id": id,
        "restoreRoot": restore_root.to_string_lossy(),
        "archives": archives,
        "keySource": key_source,
        "archiveFinalizer": note,
    });
    // ключ есть только у архива, рядом с которым лежала таблица слоёв
    if let Some(note) = layers {
        answer["layers"] = note;
    }
    // времена по этапам (мс, потоки суммой) и байты установки; поле добавлено 14.11.2026
    answer["timings"] = Value::Object(timings);
    Ok(answer)
}

fn millis(span: Duration) -> u64 {
    u64::try_from(span.as_millis()).unwrap_or(u64::MAX)
}

/// Время этапов установки: ячейки, потому что установка идёт в одном потоке.
#[derive(Default)]
struct Clock {
    plan: Cell<Duration>,
    backup: Cell<Duration>,
    read: Cell<Duration>,
    write: Cell<Duration>,
    flush: Cell<Duration>,
    hash: Cell<Duration>,
    verify: Cell<Duration>,
    commit: Cell<Duration>,
}

impl Clock {
    /// Выполняет `work` и прибавляет его время к ячейке.
    fn time<T>(&self, slot: &Cell<Duration>, work: impl FnOnce() -> T) -> T {
        let begun = Instant::now();
        let value = work();
        slot.set(slot.get() + begun.elapsed());
        value
    }
}

/// Итог установки.
pub struct Installed {
    /// Поставленные архивы (относительные пути с «/»).
    pub archives: Vec<String>,
    /// Идентификатор точки отката.
    pub id: String,
    /// Папка точки: `<папка точек>\<id>`.
    pub restore_root: PathBuf,
    /// Что стало со слоями архивов, рядом с которыми лежала таблица слоёв (подмена
    /// файла убирает её): `None`, если таблицы не было.
    pub layers: Option<Value>,
    /// Время этапов (мс) и байты установки; см. `Install::report`.
    pub timings: Map<String, Value>,
}

/// Этап, о котором идут отчёты о ходе: сборка файлов или проверка готовых.
#[derive(Clone, Copy)]
enum Phase {
    Compose,
    Verify,
}

impl Phase {
    fn label(self) -> &'static str {
        match self {
            Phase::Compose => "compose",
            Phase::Verify => "verify",
        }
    }

    fn announce(self, progress: &Progress) {
        progress.report(self.label());
    }

    fn bytes(self, progress: &Progress, done: u64, total: u64) {
        progress.report_bytes(self.label(), done, total);
    }

    /// Последний отчёт этапа: всё сделано.
    fn finish(self, progress: &Progress, total: u64) {
        self.bytes(progress, total, total);
    }
}

/// Установка без разбора параметров: всё нужное передаёт вызывающий.
pub fn install_with(
    game_root: &Path,
    validation: &Validation,
    keys: &Arc<KeySet>,
    finalizer: Option<&dyn Finalizer>,
    points_root: &Path,
    progress: &Progress,
) -> Result<Installed> {
    Install {
        progress,
        store: points_root,
        fixer: finalizer,
        keys,
        patch: validation,
        game: game_root,
        clock: Clock::default(),
    }
    .run()
}

/// Всё, что установка получила от вызывающего и что не меняется от архива к архиву.
struct Install<'a> {
    progress: &'a Progress,
    store: &'a Path,
    fixer: Option<&'a dyn Finalizer>,
    keys: &'a Arc<KeySet>,
    patch: &'a Validation,
    game: &'a Path,
    clock: Clock,
}

impl Install<'_> {
    fn run(&self) -> Result<Installed> {
        // фазы и байты этой установки (рабочие потоки записи берут счётчик же)
        let tally = Tally::new();
        let _tally = tally::install(Arc::clone(&tally));
        let began = Instant::now();
        let parses_before = rage_rpf::toc::parse_count();
        let clock = &self.clock;
        let planning = Instant::now();
        let targets = self.existing_targets()?;
        for target in &targets {
            super::append::settle_beside(&target.1, self.progress)?;
        }
        // подмена убирает журнал дозаписи и таблицу слоёв рядом: что стало со
        // слоями, вызывающий узнаёт из ответа
        let layers = super::layers::dropped_note(
            &targets
                .iter()
                .map(|target| (target.1.as_path(), target.0.as_str()))
                .collect::<Vec<_>>(),
        );
        for target in &targets {
            let folder = target.1.parent();
            folder.into_iter().for_each(points::sweep_stale_stages);
        }
        transaction::preflight(self.game, &targets, self.store)?;
        clock.plan.set(planning.elapsed());

        let mut staged = Vec::new();
        let session = clock.time(&clock.backup, || self.open_session(targets))?;
        let built = self.stage_all(&session.targets, &mut staged);
        if built.is_err() {
            transaction::cleanup(&staged);
        }
        built.map_err(|error| session.give_up((error, Vec::new())))?;

        let point = Point {
            created_dirs: &[],
            id: &session.id,
            root: &session.root,
            game_root: self.game,
            patch: &self.patch.patch_directory,
        };
        clock
            .time(&clock.commit, || {
                transaction::commit(
                    staged,
                    self.progress,
                    &session.targets,
                    &session.backups,
                    &point,
                )
            })
            .map_err(|failure| session.give_up(failure))?;

        Ok(Installed {
            archives: self.patch.archives.clone(),
            restore_root: session.root,
            id: session.id,
            layers,
            timings: self.report(&tally, began, parses_before),
        })
    }

    /// Времена этапов (мс) и байты установки. Время потоков идёт суммой, как у
    /// `compose-rpf`; ключи названы так же, где этап тот же. `plan` — проверки до
    /// копий, `backup` — точка отката, `read` — разбор живого архива и применение
    /// заплатки, `write` — сборка файла (с доводчиком и вложенными), `verify` —
    /// проверка собранного, `flush` — сброс на диск, `hash` — отдельный проход
    /// SHA-256, `commit` — подмена. Дальше фазы записи (`readSources`, `buildToc`,
    /// `deflate`, `writeBodies`, `nested`, `lockWait`) и байты движка.
    fn report(&self, tally: &Tally, began: Instant, parses_before: u64) -> Map<String, Value> {
        let clock = &self.clock;
        let counted = tally.totals();
        let rows: [(&str, u64); 21] = [
            ("plan", millis(clock.plan.get())),
            ("backup", millis(clock.backup.get())),
            ("read", millis(clock.read.get())),
            ("write", millis(clock.write.get())),
            ("verify", millis(clock.verify.get())),
            ("flush", millis(clock.flush.get())),
            ("hash", millis(clock.hash.get())),
            ("commit", millis(clock.commit.get())),
            ("run", millis(began.elapsed())),
            ("readSources", counted.millis(Span::Sources)),
            ("buildToc", counted.millis(Span::Toc)),
            ("deflate", counted.millis(Span::Deflate)),
            ("writeBodies", counted.millis(Span::Bodies)),
            ("nested", counted.millis(Span::Nested)),
            ("lockWait", counted.millis(Span::GateWait)),
            ("nestedDirect", counted.nested_direct),
            ("nestedStaged", counted.nested_staged),
            ("readBytes", counted.read_bytes),
            ("writtenBytes", counted.written_bytes),
            ("tocParses", rage_rpf::toc::parse_count() - parses_before),
            ("archives", self.patch.archives.len() as u64),
        ];
        rows.into_iter()
            .map(|(key, value)| (key.to_owned(), Value::from(value)))
            .collect()
    }

    /// Живые архивы, которые заплатка затронет. Все проверяются раньше любой копии.
    fn existing_targets(&self) -> Result<Vec<(String, PathBuf)>> {
        let game_text = self.game.to_string_lossy();
        let mut found = Vec::with_capacity(self.patch.archives.len());
        for relative in &self.patch.archives {
            match paths::inside(&game_text, relative)? {
                live if live.is_file() => found.push((String::from(relative), live)),
                _ => {
                    return Err(EngineError::file_not_found(format!(
                        "Target RPF does not exist: {relative}"
                    )))
                }
            }
        }
        Ok(found)
    }

    /// Открывает точку отката: её папка и копии «до» всех целей.
    fn open_session(&self, targets: Vec<(String, PathBuf)>) -> Result<Session> {
        let backups = Vec::with_capacity(targets.len());
        let id = points::new_point_id();
        let root = Path::join(self.store, &id);
        fs::DirBuilder::new().recursive(true).create(&root)?;

        let mut session = Session {
            backups,
            targets,
            root,
            id,
        };
        transaction::make_backups(
            &session.targets,
            &session.root,
            self.progress,
            &mut session.backups,
        )
        .map_err(|failure| session.give_up((failure.0, Vec::new())))?;
        Ok(session)
    }

    /// Собирает и проверяет все цели по очереди; готовые кладёт в `staged`,
    /// чтобы при отказе вызывающий убрал и их.
    fn stage_all(&self, targets: &[(String, PathBuf)], staged: &mut Vec<Staged>) -> Result<()> {
        let total = targets
            .iter()
            .fold(0, |sum, target| sum + file_len(&target.1));
        let mut ledger = Ledger::start(self.progress, total);
        for target in targets {
            // Точка отмены: до того, как живой архив тронут.
            self.progress.checkpoint()?;
            let piece = self.rebuild(&mut ledger, target)?;
            staged.push(piece);
        }
        // Последняя точка отмены до подмены: дальше установка идёт до конца.
        self.progress.checkpoint()
    }

    fn rebuild(&self, ledger: &mut Ledger<'_>, target: &(String, PathBuf)) -> Result<Staged> {
        let (relative, live) = target;
        let slot = Slot::plan(relative, live);
        let shown = relative.replace('/', "\\");
        log(format!("[Injector] >>> Запуск Smart Rebuild для: {shown}"));

        let outcome = self.build_and_verify(&slot, ledger);
        if outcome.is_err() {
            let _ = fs::remove_dir_all(&slot.stage_dir);
        }
        let streamed = outcome?;

        // Отказ сброса или подсчёта здесь служебную папку не убирает.
        let clock = &self.clock;
        clock.time(&clock.flush, || {
            let _flush = tally::span(Span::Flush);
            points::flush_to_disk(&slot.staged_file)
        })?;
        // Отпечаток, собранный по ходу записи, избавляет от чтения готового файла.
        let sha256_after = match streamed {
            Some(digest) => digest.to_ascii_uppercase(),
            None => clock
                .time(&clock.hash, || sha256_file(&slot.staged_file))?
                .to_ascii_uppercase(),
        };
        Ok(Staged {
            relative: relative.clone(),
            preexisting: false,
            staged: slot.staged_file,
            sha256_after,
            stage_dir: slot.stage_dir,
            live: live.clone(),
        })
    }

    /// Собирает и проверяет файл; отдаёт его SHA-256 (строчными), если он был
    /// собран по ходу записи.
    fn build_and_verify(&self, slot: &Slot<'_>, ledger: &mut Ledger<'_>) -> Result<Option<String>> {
        let built = match self.build_into(slot, ledger) {
            Ok(built) => built,
            // Отмена остаётся отменой: ответ с кодом `Cancelled`, а не общий отказ сборки.
            Err(error) if error.code == "Cancelled" => return Err(error),
            Err(error) => {
                let shown = slot.live.display();
                return Err(EngineError::invalid_operation(format!(
                    "Ошибка Rebuild '{shown}': {error}"
                )));
            }
        };
        ledger.done += built.size;
        ledger.show(0);
        let digest = built.digest.clone();
        let clock = &self.clock;
        clock.time(&clock.verify, || {
            self.verify_staged(built, &slot.staged_file)
        })?;
        Ok(digest)
    }

    fn build_into(&self, slot: &Slot<'_>, ledger: &Ledger<'_>) -> Result<Built> {
        let clock = &self.clock;
        let (tree, checks) = clock.time(&clock.read, || self.patched_tree(slot))?;
        let (size, digest) = clock.time(&clock.write, || self.write_out(slot, ledger, tree))?;
        Ok(Built {
            checks,
            size,
            digest,
        })
    }

    /// Читает живой архив в дерево.
    fn open_tree(&self, slot: &Slot<'_>) -> Result<DirNode> {
        let archive = Archive::open_path(slot.live, Some(self.keys.clone()))?;
        // Эта строка появляется, только когда живой архив прочитался.
        log("[Injector] Правка архива...");
        Ok(DirNode::from_archive(&Arc::new(archive)))
    }

    /// Дерево живого архива с применёнными к нему действиями заплатки.
    fn patched_tree(&self, slot: &Slot<'_>) -> Result<(DirNode, Vec<Check>)> {
        let mut tree = self.open_tree(slot)?;

        let mut mine = Vec::new();
        for action in &self.patch.manifest.actions {
            if let Ok(Some(root)) = resolve_root_archive(&action.target_path) {
                if root.eq_ignore_ascii_case(slot.relative) {
                    mine.push(action);
                }
            }
        }
        let patch_dir = &self.patch.patch_directory;
        let checks = apply::apply(&mut tree, &mine, patch_dir, &mut |line| log(line))?;
        Ok((tree, checks))
    }

    /// Пишет дерево в файл служебной папки, при закреплённом доводчике доводит
    /// заголовок; возвращает размер записанного и, если отпечаток собирался по
    /// ходу записи, SHA-256 файла (строчными).
    fn write_out(
        &self,
        slot: &Slot<'_>,
        ledger: &Ledger,
        tree: DirNode,
    ) -> Result<(u64, Option<String>)> {
        fs::DirBuilder::new()
            .recursive(true)
            .create(&slot.stage_dir)?;
        let mut context = WriteContext {
            finalizer: self.fixer,
            keys: Some(self.keys.as_ref()),
            staging: &slot.stage_dir,
        };
        let mut last = 0;
        let mut on_written = |written: u64| {
            let first = last == 0 && written > 0;
            let fresh = disk::delta(&mut last, written);
            self.progress.wrote(fresh);
            ledger.show(written);
            if first {
                // стенды: убить процесс посреди записи, когда готовый файл ещё не цел
                failpoint::hit("install-mid-write");
            }
        };
        let streaming = Streaming::from_env();
        if !streaming.enabled {
            let report = {
                let output = &mut File::create(&slot.staged_file)?;
                write_archive_with(
                    &tree,
                    output,
                    &mut context,
                    &mut on_written,
                    streaming.nested,
                )?
            };
            if let Some(fixer) = self.fixer {
                fixer.finalize(&slot.staged_file, &slot.file_name)?;
            }
            return Ok((report.size, None));
        }

        // Отпечаток собирается по ходу записи; доводчик работает как раньше, на
        // готовом файле (см. `streamed`).
        let layout = Layout::prepare_with(&tree, &mut context, streaming.nested)?;
        let streamed = write_streamed(
            &layout,
            &slot.staged_file,
            &slot.file_name,
            &slot.stage_dir,
            self.fixer,
            streaming,
            &mut on_written,
        )?;
        Ok((layout.size(), streamed.digest))
    }

    fn verify_staged(&self, built: Built, staged_file: &Path) -> Result<()> {
        Phase::Verify.announce(self.progress);
        let archive = open_sealed(self.keys, staged_file, self.fixer.is_some())?;

        let mut weighed = Vec::with_capacity(built.checks.len());
        for check in &built.checks {
            weighed.push((check, payload_weight(check)));
        }
        let total: u64 = weighed.iter().map(|&(_, weight)| weight).sum();
        weighed
            .iter()
            .try_fold(0, |done, &(check, weight)| -> Result<u64> {
                Probe::new(check, self.keys).run(&archive)?;
                if weight > 0 {
                    Phase::Verify.bytes(self.progress, done + weight, total);
                }
                Ok(done + weight)
            })?;
        Phase::Verify.finish(self.progress, total);
        Ok(())
    }
}

/// Открывает готовый файл; когда его обработал доводчик, заголовок обязан
/// оказаться зашифрованным NG.
fn open_sealed(keys: &Arc<KeySet>, path: &Path, must_be_sealed: bool) -> Result<Archive> {
    let archive = match Archive::open_path(path, Some(keys.clone())) {
        Ok(archive) => archive,
        Err(error) => {
            return Err(EngineError::invalid_data(format!(
                "The rebuilt archive does not open: {error}"
            )))
        }
    };
    let header_ok = !must_be_sealed || archive.encryption() == Encryption::Ng;
    header_ok
        .then_some(archive)
        .ok_or_else(|| EngineError::invalid_data("The rebuilt archive header is not encrypted."))
}

/// Открытая точка: папка, копии «до» и список целей. Отказ любого шага
/// возвращает игру в прежнее состояние через `give_up`.
struct Session {
    backups: Vec<Backup>,
    targets: Vec<(String, PathBuf)>,
    root: PathBuf,
    id: String,
}

impl Session {
    /// Возвращает подменённое из точки, убирает точку и отдаёт ошибку дальше.
    fn give_up(&self, (error, committed): (EngineError, Vec<usize>)) -> EngineError {
        transaction::unwind(
            &self.id,
            &self.root,
            &self.targets,
            &self.backups,
            committed,
        );
        error
    }
}

/// Места одной пересборки: служебная папка рядом с живым архивом и файл в ней.
struct Slot<'a> {
    relative: &'a str,
    live: &'a Path,
    stage_dir: PathBuf,
    staged_file: PathBuf,
    file_name: String,
}

impl<'a> Slot<'a> {
    const STAGE_PREFIX: &'static str = ".astral-stage-";

    fn fresh_name() -> String {
        format!("{}{}", Self::STAGE_PREFIX, random_hex(32))
    }

    fn plan(relative: &'a str, live: &'a Path) -> Self {
        let stage_dir = live
            .parent()
            .unwrap_or(Path::new(""))
            .join(Self::fresh_name());
        let file_name = base_name(live);
        Slot {
            relative,
            live,
            staged_file: stage_dir.join(&file_name),
            stage_dir,
            file_name,
        }
    }
}

/// Сколько байт уже собрано из общего объёма (по размерам живых архивов).
struct Ledger<'a> {
    progress: &'a Progress,
    done: u64,
    total: u64,
}

impl<'a> Ledger<'a> {
    fn start(progress: &'a Progress, total: u64) -> Self {
        let ledger = Ledger {
            progress,
            done: 0,
            total,
        };
        ledger.show(0);
        ledger
    }

    fn show(&self, extra: u64) {
        let now = self.done.saturating_add(extra).min(self.total);
        Phase::Compose.bytes(self.progress, now, self.total);
    }
}

/// Результат работы над деревом: проверки и размер записанного файла.
struct Built {
    checks: Vec<Check>,
    size: u64,
    /// SHA-256 файла (строчными), собранный по ходу записи.
    digest: Option<String>,
}

/// Имя файла без папки; нечитаемые знаки заменяются, у пути без имени — пустая строка.
fn base_name(path: &Path) -> String {
    String::from(path.file_name().unwrap_or_default().to_string_lossy())
}

/// Размер файла на диске; нечитаемый файл считается пустым.
fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map_or(0, |facts| facts.len())
}

/// Сколько байт файла заплатки читает проверка (у удаления ничего).
fn payload_weight(check: &Check) -> u64 {
    match &check.expect {
        Expect::Absent => 0,
        Expect::Binary { source } => file_len(source),
        Expect::Resource { source } => file_len(source),
        Expect::Archive { source } => file_len(source),
    }
}

/// Одна проверка: где искать и что должно найтись.
struct Probe<'a> {
    check: &'a Check,
    keys: &'a Arc<KeySet>,
    shown: String,
}

impl<'a> Probe<'a> {
    fn new(check: &'a Check, keys: &'a Arc<KeySet>) -> Self {
        Probe {
            shown: check.segments.join("/"),
            check,
            keys,
        }
    }

    fn fail(&self, what: &str) -> EngineError {
        let shown = &self.shown;
        EngineError::invalid_data(format!("Patch verification failed ({what}): {shown}"))
    }

    /// Там, где записи и не должно быть, её отсутствие не отказ.
    fn absent_or(&self, what: &str) -> Result<()> {
        match self.check.expect {
            Expect::Absent => Ok(()),
            _ => Err(self.fail(what)),
        }
    }

    fn unopened(&self) -> EngineError {
        self.fail("the nested archive does not open")
    }

    fn open_inner(&self, archive: &Archive, id: EntryId) -> Result<Arc<Archive>> {
        archive.open_nested_shared(id).map_err(|_| self.unopened())
    }

    fn run(&self, archive: &Archive) -> Result<()> {
        self.descend(&self.check.segments, archive, archive.root())
    }

    /// Спускается по звеньям; звено-файл открывается как вложенный архив.
    fn descend(&self, segments: &[String], archive: &Archive, start: EntryId) -> Result<()> {
        let mut dir = start;
        let mut rest = segments;
        while let [name, tail @ ..] = rest {
            if tail.is_empty() {
                return self.judge(archive, archive.find_file(dir, name));
            }
            match archive.find_dir(dir, name) {
                Some(inner_dir) => {
                    dir = inner_dir;
                    rest = tail;
                }
                None => return self.cross_or_miss(archive, (dir, name), tail),
            }
        }
        Ok(())
    }

    /// Звена-каталога нет: это либо файл-контейнер (спуск в него), либо пропажа.
    fn cross_or_miss(
        &self,
        archive: &Archive,
        (dir, name): (EntryId, &str),
        tail: &[String],
    ) -> Result<()> {
        match archive.find_file(dir, name) {
            Some(container) => {
                let inner = self.open_inner(archive, container)?;
                self.descend(tail, &inner, inner.root())
            }
            None => self.absent_or("missing directory"),
        }
    }

    fn judge(&self, archive: &Archive, found: Option<EntryId>) -> Result<()> {
        let Some(id) = found else {
            return self.absent_or("entry missing");
        };
        let by_decoding: Comparer =
            |archive, id, wanted| Ok(archive.decode(id, EntryCipher::AlwaysNg)? == wanted);
        let (source, same_as) = match &self.check.expect {
            Expect::Absent => return Err(self.fail("entry still present")),
            Expect::Archive { source } => {
                let installed = self.open_inner(archive, id)?;
                return self.same_layout(source, installed);
            }
            Expect::Binary { source } => (source, by_decoding),
            Expect::Resource { source } => (source, resource_matches as Comparer),
        };
        let wanted = fs::read(source)?;
        same_as(archive, id, &wanted)?
            .then_some(())
            .ok_or_else(|| self.fail("content differs"))
    }

    fn same_layout(&self, source: &Path, installed: Arc<Archive>) -> Result<()> {
        let wanted =
            Archive::open_path(source, Some(self.keys.clone())).map_err(|_| self.unopened())?;
        (layout_of(&installed) == layout_of(&wanted))
            .then_some(())
            .ok_or_else(|| self.fail("archive layout differs"))
    }
}

/// Сравнение содержимого записи архива с байтами файла заплатки.
type Comparer = fn(&Archive, EntryId, &[u8]) -> Result<bool>;

/// Состав архива: пути файлов в нижнем регистре и несжатые размеры, по порядку путей.
fn layout_of(archive: &Archive) -> Vec<(String, u64)> {
    let mut found = Vec::new();
    let mut pending = vec![(archive.root(), String::new())];
    while let Some((dir, prefix)) = pending.pop() {
        found.extend(archive.files(dir).iter().map(|&file| {
            let entry = archive.entry(file);
            let size = if let EntryKind::Binary(ref info) = entry.kind {
                u64::from(info.uncompressed_size)
            } else {
                archive.listing_size(file)
            };
            (format!("{prefix}{}", entry.name).to_lowercase(), size)
        }));
        pending.extend(archive.dirs(dir).iter().map(|&sub| {
            let name = &archive.entry(sub).name;
            (sub, format!("{prefix}{name}/"))
        }));
    }
    found.sort();
    found
}

/// Равен ли ресурс из архива файлу заплатки с точки зрения чтения в игре.
///
/// Первые 16 байт хранимых данных не сравниваются: игра собирает заголовок
/// заново из флагов оглавления, а ArchiveFix их переписывает. Значение имеют
/// длина, тело и два слова флагов файла заплатки (байты 8–11 и 12–15).
pub(crate) fn resource_matches(archive: &Archive, id: EntryId, wanted: &[u8]) -> Result<bool> {
    const HEADER: usize = 16;
    match &archive.entry(id).kind {
        EntryKind::Resource(info) => {
            let stored = archive.read_stored(id)?;
            let (Some(flag_bytes), Some(body)) = (wanted.get(8..HEADER), wanted.get(HEADER..))
            else {
                return Ok(false);
            };
            let mut words = flag_bytes
                .chunks_exact(4)
                .map(|quad| u32::from_le_bytes([quad[0], quad[1], quad[2], quad[3]]));
            let flags_agree = words.next() == Some(info.system_flags)
                && words.next() == Some(info.graphics_flags);
            Ok(stored.len() == wanted.len() && flags_agree && stored[HEADER..] == *body)
        }
        _ => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::compose::tests::{fake_tool, key_dir, TestEnv};
    use crate::archives::restore;
    use crate::args::Options;
    use rage_rpf::fixtures::{common_tree, noise, replacement_tree, text, update_tree};
    use rage_rpf::write::write_archive;
    use rage_rpf::{Body, Compress, Data, FileNode, RpfError};
    use std::process::{Command, Stdio};
    use std::sync::Mutex;
    use std::time::{Duration, SystemTime};
    use tempfile::{tempdir, TempDir};

    const UPDATE: &str = "update/update.rpf";
    const COMMON: &str = "common.rpf";
    const SCENARIO_ENV: &str = "ASTRAL_INSTALL_TEST_SCENARIO";

    // ----- стенд -----

    fn quiet_keys() -> Arc<KeySet> {
        Arc::new(
            KeySet::from_parts(
                &[0; 32],
                &vec![0u8; 101 * 68 * 4],
                &vec![0u8; 17 * 4096 * 4],
                &[0; 256],
            )
            .unwrap(),
        )
    }

    fn write_tree(tree: &DirNode, path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        let mut context = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
    }

    /// Синтетическая игра, пустая папка заплатки и место под точки.
    struct Lab {
        dir: TempDir,
        game: PathBuf,
        points: PathBuf,
        patch: PathBuf,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempdir().unwrap();
            let game = dir.path().join("game");
            let patch = dir.path().join("patch");
            fs::create_dir_all(&game).unwrap();
            fs::create_dir_all(&patch).unwrap();
            fs::write(game.join("GTA5.exe"), b"").unwrap();
            write_tree(&update_tree(None), &game.join(UPDATE));
            write_tree(&common_tree(), &game.join(COMMON));
            Lab {
                points: dir.path().join("points"),
                game,
                patch,
                dir,
            }
        }

        fn live(&self, relative: &str) -> PathBuf {
            self.game.join(relative)
        }

        /// Заплатка из действий «вид, цель, имя файла» и файлов нагрузки.
        fn patch_with(
            &self,
            actions: &[(&str, &str, &str)],
            payloads: &[(&str, Vec<u8>)],
        ) -> Validation {
            for (name, bytes) in payloads {
                let path = self.patch.join("payload").join(name);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, bytes).unwrap();
            }
            let items: Vec<Value> = actions
                .iter()
                .map(|(kind, target, source)| {
                    if source.is_empty() {
                        json!({ "Type": kind, "TargetPath": target })
                    } else {
                        json!({ "Type": kind, "TargetPath": target, "SourcePath": format!("payload/{source}") })
                    }
                })
                .collect();
            fs::write(
                self.patch.join("manifest.json"),
                json!({ "Actions": items }).to_string(),
            )
            .unwrap();
            patch::validate(&self.patch, Some(&self.game)).unwrap()
        }

        /// Заменить `common/data/a.xml` в update.rpf тридцатью байтами.
        fn patch_update(&self) -> Validation {
            self.patch_with(
                &[("Replace", "update:/common/data/a.xml", "a.xml")],
                &[("a.xml", text(30, "<a2/>"))],
            )
        }

        /// То же и `data/g.xml` в common.rpf.
        fn patch_both(&self) -> Validation {
            self.patch_with(
                &[
                    ("Replace", "update:/common/data/a.xml", "a.xml"),
                    ("Replace", "common:/data/g.xml", "g.xml"),
                ],
                &[("a.xml", text(30, "<a2/>")), ("g.xml", text(150, "<g2/>"))],
            )
        }

        fn go(
            &self,
            validation: &Validation,
            finalizer: Option<&dyn Finalizer>,
            progress: &Progress,
        ) -> Result<Installed> {
            install_with(
                &self.game,
                validation,
                &quiet_keys(),
                finalizer,
                &self.points,
                progress,
            )
        }

        fn scrub(&self, text: &str) -> String {
            text.replace(&*self.dir.path().to_string_lossy(), "<W>")
        }

        fn game_listing(&self) -> Vec<String> {
            listing(&self.game)
        }

        fn points_listing(&self) -> Vec<String> {
            listing(&self.points)
        }
    }

    fn is_hex(text: &str) -> bool {
        text.bytes().all(|byte| byte.is_ascii_hexdigit())
    }

    /// Случайные части имён заменяются: `<hex>` у служебной папки, `<id>` у точки.
    fn mask_segment(segment: &str) -> String {
        if let Some(tail) = segment.strip_prefix(".astral-stage-") {
            if tail.len() == 32 && is_hex(tail) {
                return ".astral-stage-<hex>".to_owned();
            }
        }
        let parts: Vec<&str> = segment.split('-').collect();
        let looks_like_id = parts.len() == 4
            && parts[0] == "rpf"
            && parts[1].len() == 8
            && parts[2].len() == 6
            && parts[3].len() == 18
            && is_hex(parts[3]);
        if looks_like_id {
            "<id>".to_owned()
        } else {
            segment.to_owned()
        }
    }

    /// Дерево каталога по строке на запись: `путь/` или `путь (N Б)`.
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
                let masked: Vec<String> = relative.split('/').map(mask_segment).collect();
                let masked = masked.join("/");
                if path.is_dir() {
                    out.push(format!("{masked}/"));
                    visit(base, &path, out);
                } else {
                    out.push(format!(
                        "{masked} ({} Б)",
                        fs::metadata(&path).unwrap().len()
                    ));
                }
            }
        }
        let mut out = Vec::new();
        visit(root, root, &mut out);
        out.sort();
        out
    }

    /// Стадия хода, список файлов игры и список файлов точек в этот момент.
    type Snapshot = (String, Vec<String>, Vec<String>);

    fn size_of(path: &Path) -> u64 {
        fs::metadata(path).unwrap().len()
    }

    fn sha_of(path: &Path) -> String {
        sha256_file(path).unwrap()
    }

    fn phase_of(line: &str) -> String {
        let value: Value = serde_json::from_str(line).unwrap();
        value["progress"]["phase"].as_str().unwrap().to_owned()
    }

    /// Ход, собранный в список строк.
    fn recorded() -> (Progress, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);
        let progress = Progress::with_sink(move |line| sink.lock().unwrap().push(line.to_owned()));
        (progress, lines)
    }

    /// Ход с действием на n-м начале стадии `phase`: первая строка стадии
    /// выходит всегда, а действие делает то, что в бою портит случай.
    fn hook(
        phase: &'static str,
        nth: usize,
        action: impl Fn() + Send + Sync + 'static,
    ) -> Progress {
        let state = Mutex::new((String::new(), 0usize));
        Progress::with_sink(move |line| {
            let name = phase_of(line);
            let mut seen = state.lock().unwrap();
            if seen.0 == name {
                return;
            }
            seen.0.clone_from(&name);
            if name == phase {
                seen.1 += 1;
                if seen.1 == nth {
                    drop(seen);
                    action();
                }
            }
        })
    }

    fn refusal<T>(outcome: Result<T>) -> (String, String) {
        match outcome {
            Ok(_) => panic!("ожидался отказ"),
            Err(error) => (error.code, error.message),
        }
    }

    #[cfg(windows)]
    fn age_directory(path: &Path, secs_ago: u64) {
        use std::os::windows::fs::OpenOptionsExt;
        let handle = fs::OpenOptions::new()
            .write(true)
            .custom_flags(0x0200_0000)
            .open(path)
            .unwrap();
        handle
            .set_modified(SystemTime::now() - Duration::from_secs(secs_ago))
            .unwrap();
    }

    // ----- установка одного архива: состояния диска (Уст1-Уст8) -----

    #[test]
    fn one_archive_install_walks_the_documented_disk_states() {
        let lab = Lab::new();
        let validation = lab.patch_update();
        let before = lab.game_listing();
        let live_sha = sha_of(&lab.live(UPDATE));
        let live_size = size_of(&lab.live(UPDATE));
        assert_eq!(lab.points_listing(), Vec::<String>::new());
        assert!(!lab.points.exists());

        let snapshots: Arc<Mutex<Vec<Snapshot>>> = Arc::default();
        let (game, points) = (lab.game.clone(), lab.points.clone());
        let log = Arc::clone(&snapshots);
        let seen = Mutex::new(String::new());
        let progress = Progress::with_sink(move |line| {
            let name = phase_of(line);
            let mut last = seen.lock().unwrap();
            if *last != name {
                last.clone_from(&name);
                log.lock()
                    .unwrap()
                    .push((name, listing(&game), listing(&points)));
            }
        });
        let installed = lab.go(&validation, None, &progress).unwrap();

        // Уст1: итог
        assert_eq!(installed.archives, [UPDATE]);
        assert_eq!(installed.restore_root, lab.points.join(&installed.id));
        assert_eq!(mask_segment(&installed.id), "<id>");

        let snapshots = snapshots.lock().unwrap();
        let phases: Vec<&str> = snapshots.iter().map(|(name, _, _)| name.as_str()).collect();
        assert_eq!(phases, ["backup", "compose", "verify", "commit"]);
        let copy = format!("<id>/update/update.rpf ({live_size} Б)");

        // Уст3: папка точки создана и пуста
        assert_eq!(snapshots[0].1, before);
        assert_eq!(snapshots[0].2, ["<id>/"]);
        // Уст4: копия лежит, готового файла ещё нет
        assert_eq!(snapshots[1].1, before);
        assert_eq!(snapshots[1].2, ["<id>/", "<id>/update/", copy.as_str()]);
        // Уст5: готовый файл рядом с живым, живой прежний
        let game_staged: Vec<&String> = snapshots[2]
            .1
            .iter()
            .filter(|e| e.contains("astral-stage"))
            .collect();
        assert_eq!(game_staged.len(), 2);
        assert_eq!(game_staged[0], "update/.astral-stage-<hex>/");
        assert!(game_staged[1].starts_with("update/.astral-stage-<hex>/update.rpf ("));
        assert!(snapshots[2]
            .1
            .contains(&format!("update/update.rpf ({live_size} Б)")));
        assert_eq!(snapshots[2].2, snapshots[1].2);
        // Уст6: опись записана, подмены ещё нет
        assert_eq!(snapshots[3].1, snapshots[2].1);
        assert_eq!(snapshots[3].2.len(), 4);
        assert!(snapshots[3]
            .2
            .iter()
            .any(|e| e.starts_with("<id>/restore.json (")));

        // Уст7: итог на диске
        let after = lab.game_listing();
        assert!(after.iter().all(|entry| !entry.contains("astral-stage")));
        assert_eq!(after.len(), before.len());
        assert_ne!(sha_of(&lab.live(UPDATE)), live_sha);
        let point = lab.points.join(&installed.id);
        assert_eq!(sha_of(&point.join(UPDATE)), live_sha);
        assert_eq!(lab.points_listing().len(), 4);

        // Уст8: опись
        let manifest = points::read_manifest(&point.join("restore.json")).unwrap();
        assert_eq!(manifest.archives.len(), 1);
        let entry = &manifest.archives[0];
        assert_eq!(entry.relative_path, UPDATE);
        assert_eq!(entry.sha256_before, live_sha.to_ascii_uppercase());
        assert_eq!(
            entry.sha256_after.as_deref(),
            Some(sha_of(&lab.live(UPDATE)).to_ascii_uppercase().as_str())
        );
    }

    // ----- ход установки двух архивов (Уст10) -----

    #[test]
    fn two_archives_report_the_stages_in_the_documented_order() {
        let lab = Lab::new();
        let validation = lab.patch_both();
        let total = size_of(&lab.live(COMMON)) + size_of(&lab.live(UPDATE));
        let (progress, lines) = recorded();
        lab.go(&validation, None, &progress).unwrap();

        let lines = lines.lock().unwrap().clone();
        let mut order: Vec<String> = lines.iter().map(|line| phase_of(line)).collect();
        order.dedup();
        assert_eq!(
            order,
            ["backup", "compose", "verify", "compose", "verify", "commit"]
        );
        let phase = |name: &str, done: u64, all: u64| {
            format!(
                r#"{{"progress":{{"phase":"{name}","copiedBytes":{done},"totalBytes":{all}}}}}"#
            )
        };
        // между границами стадии могут встать промежуточные строки хода (они
        // выходят по времени), поэтому сверяются первая и последняя строки стадий
        let of_phase = |name: &str| -> Vec<&String> {
            lines.iter().filter(|line| phase_of(line) == name).collect()
        };
        let (backup, compose, verify) =
            (of_phase("backup"), of_phase("compose"), of_phase("verify"));
        assert_eq!(lines[0], phase("backup", 0, total));
        assert_eq!(*backup.first().unwrap(), &phase("backup", 0, total));
        assert_eq!(*backup.last().unwrap(), &phase("backup", total, total));
        assert_eq!(*compose.first().unwrap(), &phase("compose", 0, total));
        assert_eq!(*verify.first().unwrap(), &phase("verify", 0, 0));
        assert_eq!(lines.last().unwrap(), &phase("commit", 0, 0));
        // каждая проверка заканчивается строкой «всё прочитано»: N/N
        let verified: Vec<&String> = lines
            .iter()
            .filter(|line| line.contains(r#""phase":"verify""#))
            .collect();
        assert!(verified
            .iter()
            .any(|line| line.contains("150,\"totalBytes\":150")));
        assert!(verified
            .iter()
            .any(|line| line.contains("30,\"totalBytes\":30")));
        assert!(lines
            .iter()
            .any(|line| **line == phase("compose", total, total)));
    }

    // ----- цели и уборка (Уст11-Уст16) -----

    #[test]
    fn a_missing_target_is_refused_before_the_point_and_before_the_sweep() {
        let lab = Lab::new();
        let validation = lab.patch_with(
            &[("Replace", "x64z:/a.xml", "a.xml")],
            &[("a.xml", text(30, "<a/>"))],
        );
        let stale = lab.live("update/.astral-stage-0000stale");
        fs::create_dir_all(&stale).unwrap();
        let (code, message) = refusal(lab.go(&validation, None, &Progress::silent()));
        assert_eq!(
            (code.as_str(), message.as_str()),
            (
                "FileNotFoundException",
                "Target RPF does not exist: x64z.rpf"
            )
        );
        assert!(stale.is_dir());
        assert!(!lab.points.exists());
    }

    #[cfg(windows)]
    #[test]
    fn stale_stage_folders_go_and_fresh_ones_stay() {
        let lab = Lab::new();
        let validation = lab.patch_update();
        let (old, fresh) = (
            lab.live("update/.astral-stage-0000stale"),
            lab.live("update/.astral-stage-0000fresh"),
        );
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&fresh).unwrap();
        fs::write(fresh.join("junk.bin"), b"junk").unwrap();
        age_directory(&old, 7 * 3600);
        lab.go(&validation, None, &Progress::silent()).unwrap();
        assert!(!old.exists());
        assert_eq!(fs::read(fresh.join("junk.bin")).unwrap(), b"junk");
    }

    #[test]
    fn a_missing_points_folder_and_its_parents_are_created() {
        let mut lab = Lab::new();
        lab.points = lab.dir.path().join("a").join("b").join("points");
        let validation = lab.patch_update();
        let installed = lab.go(&validation, None, &Progress::silent()).unwrap();
        assert_eq!(installed.restore_root, lab.points.join(&installed.id));
        let listing = lab.points_listing();
        assert_eq!(listing.len(), 4);
        assert_eq!(listing[0], "<id>/");
        assert!(lab.dir.path().join("a").join("b").is_dir());
    }

    #[cfg(windows)]
    #[test]
    fn a_points_folder_on_a_missing_volume_stops_before_any_write() {
        if Path::new("Z:\\").exists() {
            return;
        }
        let mut lab = Lab::new();
        lab.points = PathBuf::from("Z:\\points");
        let validation = lab.patch_update();
        let before = lab.game_listing();
        let (code, message) = refusal(lab.go(&validation, None, &Progress::silent()));
        assert_eq!(
            (code.as_str(), message.as_str()),
            (
                "FileNotFoundException",
                "No existing folder above Z:\\points"
            )
        );
        assert_eq!(lab.game_listing(), before);
    }

    #[test]
    fn a_patch_for_setup2_only_installs_nothing_and_leaves_a_point_that_rolls_back() {
        let lab = Lab::new();
        let validation = lab.patch_with(
            &[("Replace", "setup2.xml", "s.xml")],
            &[("s.xml", text(30, "<s/>"))],
        );
        let before = lab.game_listing();
        let installed = lab.go(&validation, None, &Progress::silent()).unwrap();
        // Уст15
        assert!(installed.archives.is_empty());
        assert_eq!(lab.game_listing(), before);
        let listing = lab.points_listing();
        assert_eq!(listing.len(), 2);
        assert_eq!(listing[0], "<id>/");
        assert!(listing[1].starts_with("<id>/restore.json ("));
        // Уст16: откат такой точки проходит, архивов в ответе нет, точка убрана
        let answer = restore::restore_in(&installed.id, &lab.points, &Progress::silent()).unwrap();
        assert_eq!(answer["id"], json!(installed.id));
        assert_eq!(answer["archives"], json!([]));
        assert_eq!(lab.game_listing(), before);
        assert_eq!(lab.points_listing(), Vec::<String>::new());
    }

    // ----- повторная установка и откат старой точки (Уст83-Уст85) -----

    #[test]
    fn the_same_patch_twice_makes_two_points_and_the_old_one_still_rolls_back() {
        let lab = Lab::new();
        let validation = lab.patch_update();
        let original = sha_of(&lab.live(UPDATE));
        let first = lab.go(&validation, None, &Progress::silent()).unwrap();
        let after_first = sha_of(&lab.live(UPDATE));
        let second = lab.go(&validation, None, &Progress::silent()).unwrap();
        // Уст83
        assert_ne!(first.id, second.id);
        assert!(lab.points.join(&first.id).is_dir() && lab.points.join(&second.id).is_dir());
        assert_ne!(after_first, original);
        assert_eq!(sha_of(&lab.live(UPDATE)), after_first);
        // Уст84
        let read = |id: &str| {
            points::read_manifest(&lab.points.join(id).join("restore.json"))
                .unwrap()
                .archives
                .remove(0)
        };
        let (one, two) = (read(&first.id), read(&second.id));
        assert_eq!(two.sha256_before, one.sha256_after.clone().unwrap());
        assert_eq!(two.sha256_after.unwrap(), two.sha256_before);
        // Уст85
        restore::restore_in(&first.id, &lab.points, &Progress::silent()).unwrap();
        assert_eq!(sha_of(&lab.live(UPDATE)), original);
        assert!(!lab.points.join(&first.id).exists());
        assert!(lab.points.join(&second.id).is_dir());
    }

    // ----- доводчик-пустышка -----

    /// Помнит вызовы и ничего не делает с файлом; на нужном имени отказывает.
    struct Spy {
        calls: Mutex<Vec<String>>,
        refuse: Option<&'static str>,
    }

    impl Spy {
        fn new(refuse: Option<&'static str>) -> Spy {
            Spy {
                calls: Mutex::new(Vec::new()),
                refuse,
            }
        }

        fn heard(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl Finalizer for Spy {
        fn finalize(&self, path: &Path, name: &str) -> rage_rpf::Result<()> {
            let file = path.file_name().unwrap().to_string_lossy().into_owned();
            let folder = path
                .parent()
                .and_then(Path::file_name)
                .map(|folder| folder.to_string_lossy().into_owned())
                .unwrap_or_default();
            let folder = if folder.starts_with("nested-") {
                "nested-<pid>-<n>".to_owned()
            } else {
                mask_segment(&folder)
            };
            self.calls
                .lock()
                .unwrap()
                .push(format!("{name} (файл {file}, каталог {folder})"));
            if self.refuse == Some(name) {
                return Err(RpfError::state("spy refuses"));
            }
            Ok(())
        }
    }

    // ----- проверка готового файла (Уст29-Уст35) -----

    fn staged_update(game: &Path) -> PathBuf {
        let folder = fs::read_dir(game.join("update"))
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| {
                path.is_dir()
                    && path
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(".astral-stage-")
            })
            .expect("служебная папка update.rpf");
        folder.join("update.rpf")
    }

    /// Установка, в которой на первой строке стадии `verify` готовый update.rpf
    /// подменяют; итог: отказ и проверка, что игра и точки как до установки.
    fn tampered(
        actions: &[(&str, &str, &str)],
        payloads: &[(&str, Vec<u8>)],
        replace: impl Fn(&Path, &Path) + Send + Sync + 'static,
    ) -> (String, String) {
        let lab = Lab::new();
        let validation = lab.patch_with(actions, payloads);
        let before = lab.game_listing();
        let live_sha = sha_of(&lab.live(UPDATE));
        let game = lab.game.clone();
        let progress = hook("verify", 1, move || {
            replace(&game, &staged_update(&game));
        });
        let outcome = refusal(lab.go(&validation, None, &progress));
        assert_eq!(lab.game_listing(), before);
        assert_eq!(sha_of(&lab.live(UPDATE)), live_sha);
        assert_eq!(lab.points_listing(), Vec::<String>::new());
        outcome
    }

    type Action3 = (&'static str, &'static str, &'static str);
    type Payload = (&'static str, Vec<u8>);

    fn replace_a() -> ([Action3; 1], [Payload; 1]) {
        (
            [("Replace", "update:/common/data/a.xml", "a.xml")],
            [("a.xml", text(30, "<a2/>"))],
        )
    }

    fn expect_failure(outcome: (String, String), code: &str, message: &str) {
        assert_eq!((outcome.0.as_str(), outcome.1.as_str()), (code, message));
    }

    #[test]
    fn a_ready_file_that_is_the_old_archive_has_the_wrong_content() {
        // Уст29
        let (actions, payloads) = replace_a();
        let outcome = tampered(&actions, &payloads, |game, staged| {
            fs::copy(game.join(UPDATE), staged).unwrap();
        });
        expect_failure(
            outcome,
            "InvalidDataException",
            "Patch verification failed (content differs): common/data/a.xml",
        );
    }

    #[test]
    fn a_ready_file_without_the_entry_or_the_directory_is_refused() {
        let (actions, payloads) = replace_a();
        // Уст30: каталог есть, записи нет
        let outcome = tampered(&actions, &payloads, |_, staged| {
            let mut tree = update_tree(None);
            let data = tree
                .find_dir_mut("common")
                .and_then(|common| common.find_dir_mut("data"))
                .unwrap();
            assert!(data.remove_file("a.xml"));
            write_tree(&tree, staged);
        });
        expect_failure(
            outcome,
            "InvalidDataException",
            "Patch verification failed (entry missing): common/data/a.xml",
        );
        // Уст31: нет каталога
        let outcome = tampered(&actions, &payloads, |_, staged| {
            let mut tree = update_tree(None);
            tree.dirs.retain(|dir| dir.name != "common");
            write_tree(&tree, staged);
        });
        expect_failure(
            outcome,
            "InvalidDataException",
            "Patch verification failed (missing directory): common/data/a.xml",
        );
    }

    #[test]
    fn a_deleted_entry_that_is_still_there_is_refused() {
        // Уст32
        let outcome = tampered(
            &[("Delete", "update:/common/data/old.xml", "")],
            &[],
            |game, staged| {
                fs::copy(game.join(UPDATE), staged).unwrap();
            },
        );
        expect_failure(
            outcome,
            "InvalidDataException",
            "Patch verification failed (entry still present): common/data/old.xml",
        );
    }

    #[test]
    fn a_ready_file_that_is_noise_does_not_open() {
        // Уст33
        let (actions, payloads) = replace_a();
        let garbage = noise(2000, 3);
        let scratch = tempdir().unwrap();
        let sample = scratch.path().join("update.rpf");
        fs::write(&sample, &garbage).unwrap();
        let reading = Archive::open_path(&sample, None).err().unwrap().to_string();
        let outcome = tampered(&actions, &payloads, move |_, staged| {
            fs::write(staged, &garbage).unwrap();
        });
        expect_failure(
            outcome,
            "InvalidDataException",
            &format!("The rebuilt archive does not open: {reading}"),
        );
    }

    fn nested_payload() -> Vec<u8> {
        let scratch = tempdir().unwrap();
        let path = scratch.path().join("nested.rpf");
        write_tree(&replacement_tree(), &path);
        fs::read(path).unwrap()
    }

    const OTHER: &str = "x64/data/cdimages/scaleform_other.rpf";

    #[test]
    fn a_whole_nested_archive_is_checked_by_its_layout() {
        let actions = [(
            "Replace",
            "update:/x64/data/cdimages/scaleform_other.rpf",
            "nested.rpf",
        )];
        let payloads = [("nested.rpf", nested_payload())];
        // Уст34: внутри прежний состав
        let outcome = tampered(&actions, &payloads, |game, staged| {
            fs::copy(game.join(UPDATE), staged).unwrap();
        });
        expect_failure(
            outcome,
            "InvalidDataException",
            &format!("Patch verification failed (archive layout differs): {OTHER}"),
        );
        // Уст35: вложенный архив — мусор
        let outcome = tampered(&actions, &payloads, |_, staged| {
            let mut tree = update_tree(None);
            let cdimages = tree
                .find_dir_mut("x64")
                .and_then(|dir| dir.find_dir_mut("data"))
                .and_then(|dir| dir.find_dir_mut("cdimages"))
                .unwrap();
            let other = cdimages.find_file_mut("scaleform_other.rpf").unwrap();
            *other = FileNode {
                name: "scaleform_other.rpf".to_owned(),
                body: Body::Binary {
                    data: Data::memory(noise(1500, 17)),
                    compress: Compress::Store,
                },
            };
            write_tree(&tree, staged);
        });
        expect_failure(
            outcome,
            "InvalidDataException",
            &format!("Patch verification failed (the nested archive does not open): {OTHER}"),
        );
    }

    #[test]
    fn a_whole_nested_archive_replaced_by_the_patch_passes_its_own_check() {
        let lab = Lab::new();
        let validation = lab.patch_with(
            &[(
                "Replace",
                "update:/x64/data/cdimages/scaleform_other.rpf",
                "nested.rpf",
            )],
            &[("nested.rpf", nested_payload())],
        );
        lab.go(&validation, None, &Progress::silent()).unwrap();
        let archive = Archive::open_path(&lab.live(UPDATE), None).unwrap();
        let cdimages = ["x64", "data", "cdimages"]
            .iter()
            .fold(archive.root(), |dir, name| {
                archive.find_dir(dir, name).unwrap()
            });
        let other = archive.find_file(cdimages, "scaleform_other.rpf").unwrap();
        let inner = archive.open_nested(other).unwrap();
        assert!(inner.find_file(inner.root(), "new_inside.xml").is_some());
    }

    // ----- ресурс как его читает игра (Уст94-Уст107) -----

    #[test]
    fn a_resource_matches_by_length_body_and_the_two_flag_words() {
        let lab = Lab::new();
        let top = Archive::open_path(&lab.live(UPDATE), None).unwrap();
        let cdimages = ["x64", "data", "cdimages"]
            .iter()
            .fold(top.root(), |dir, name| top.find_dir(dir, name).unwrap());
        let generic = top
            .open_nested(top.find_file(cdimages, "scaleform_generic.rpf").unwrap())
            .unwrap();
        let tex = generic.find_file(generic.root(), "tex.ytd").unwrap();
        let hud = generic.find_file(generic.root(), "hud.gfx").unwrap();

        // Уст94
        let stored = generic.read_stored(tex).unwrap();
        assert_eq!(stored.len(), 916);
        assert_eq!(
            stored[..16],
            [0x52, 0x53, 0x43, 0x37, 0x44, 0, 0, 0, 0x01, 0, 0, 0x60, 0x02, 0, 0, 0x90]
        );
        let check = |wanted: &[u8]| resource_matches(&generic, tex, wanted).unwrap();
        let changed = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut wanted = stored.clone();
            edit(&mut wanted);
            check(&wanted)
        };
        // Уст95
        assert!(check(&stored));
        // Уст96: магия и версия (байты 0, 1, 3, 4) не сравниваются
        assert!(changed(&|w| [0, 1, 3, 4].iter().for_each(|&i| w[i] = 0)));
        // Уст97-Уст99, Уст103: слова флагов
        assert!(!changed(&|w| w[8..16].fill(0)));
        assert!(!changed(&|w| w[8] ^= 1));
        assert!(!changed(&|w| w[12] ^= 1));
        assert!(!changed(&|w| w[14] ^= 1));
        // Уст100: тело
        assert!(!changed(&|w| w[500] ^= 1));
        // Уст101-Уст102
        assert!(changed(&|w| w[4] ^= 7));
        assert!(changed(&|w| [2, 5, 7].iter().for_each(|&i| w[i] ^= 0x55)));
        // Уст104-Уст106: длина обязана совпасть
        assert!(!check(&stored[..10]));
        assert!(!changed(&|w| w.push(0)));
        assert!(!check(&[]));
        // Уст107: не ресурс
        assert!(!resource_matches(&generic, hud, &generic.read_stored(hud).unwrap()).unwrap());
    }

    // ----- сценарии в дочернем процессе: журнал stdout (Уст9, Уст17-Уст24) -----

    const JOURNAL_MARKS: [&str; 4] = ["[Injector]", "[Install]", "[ArchiveFix]", "  ->"];

    /// Прогоняет сценарий отдельным процессом и возвращает строки журнала stdout.
    fn journal_of(name: &str) -> Vec<String> {
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "archives::install::tests::scenario_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(SCENARIO_ENV, name)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        assert!(
            output.status.success(),
            "сценарий {name} упал:\n{stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        // Первая строка журнала дописывается к строке «test … ... » самого прогона.
        stdout
            .lines()
            .map(|line| match line.strip_prefix("test ") {
                Some(rest) => rest.split_once(" ... ").map_or("", |(_, tail)| tail),
                None => line,
            })
            .filter(|line| JOURNAL_MARKS.iter().any(|mark| line.starts_with(mark)))
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn scenario_child() {
        let Ok(name) = std::env::var(SCENARIO_ENV) else {
            return;
        };
        match name.as_str() {
            "two" => scenario_two(),
            "broken_second" => scenario_broken_second(),
            "spy_noop" => scenario_spy_noop(),
            "spy_nested" => scenario_spy_nested(),
            "spy_refuses" => scenario_spy_refuses(),
            "changed_during" => scenario_changed_during(),
            "manifest_busy" => scenario_manifest_busy(),
            "swap_vanishes" => scenario_swap_vanishes(),
            "readonly" => scenario_readonly(),
            other => panic!("нет сценария {other}"),
        }
    }

    fn scenario_two() {
        let lab = Lab::new();
        let validation = lab.patch_both();
        let (common_sha, update_sha) = (sha_of(&lab.live(COMMON)), sha_of(&lab.live(UPDATE)));
        let installed = lab.go(&validation, None, &Progress::silent()).unwrap();
        // Уст9: архивы по алфавиту, в точке обе копии и опись, служебных папок нет
        assert_eq!(installed.archives, [COMMON, UPDATE]);
        assert_eq!(
            sha_of(&lab.points.join(&installed.id).join(COMMON)),
            common_sha
        );
        assert_eq!(
            sha_of(&lab.points.join(&installed.id).join(UPDATE)),
            update_sha
        );
        assert_ne!(sha_of(&lab.live(COMMON)), common_sha);
        assert_ne!(sha_of(&lab.live(UPDATE)), update_sha);
        assert!(lab
            .game_listing()
            .iter()
            .all(|entry| !entry.contains("astral-stage")));
        let manifest =
            points::read_manifest(&lab.points.join(&installed.id).join("restore.json")).unwrap();
        let described: Vec<&str> = manifest
            .archives
            .iter()
            .map(|a| a.relative_path.as_str())
            .collect();
        assert_eq!(described, [COMMON, UPDATE]);
    }

    fn scenario_broken_second() {
        let lab = Lab::new();
        let validation = lab.patch_both();
        fs::write(lab.live(UPDATE), noise(2048, 9)).unwrap();
        let before = lab.game_listing();
        let reading = Archive::open_path(&lab.live(UPDATE), None)
            .err()
            .unwrap()
            .to_string();
        let (code, message) = refusal(lab.go(&validation, None, &Progress::silent()));
        // Уст17
        assert_eq!(code, "InvalidOperationException");
        assert_eq!(
            lab.scrub(&message),
            format!(
                "Ошибка Rebuild '<W>\\game\\update\\update.rpf': InvalidDataException: {reading}"
            )
        );
        assert_eq!(lab.game_listing(), before);
        assert_eq!(lab.points_listing(), Vec::<String>::new());
    }

    fn scenario_spy_noop() {
        let lab = Lab::new();
        let validation = lab.patch_both();
        let before = lab.game_listing();
        let spy = Spy::new(None);
        let outcome = refusal(lab.go(&validation, Some(&spy), &Progress::silent()));
        // Уст18
        expect_failure(
            outcome,
            "InvalidDataException",
            "The rebuilt archive header is not encrypted.",
        );
        assert_eq!(
            spy.heard(),
            ["common.rpf (файл common.rpf, каталог .astral-stage-<hex>)"]
        );
        assert_eq!(lab.game_listing(), before);
        assert_eq!(lab.points_listing(), Vec::<String>::new());
    }

    fn scenario_spy_nested() {
        let lab = Lab::new();
        let validation = lab.patch_with(
            &[(
                "Replace",
                "update:/x64/data/cdimages/scaleform_generic.rpf/hud.gfx",
                "hud.gfx",
            )],
            &[("hud.gfx", text(300, "hud2"))],
        );
        let before = lab.game_listing();
        let spy = Spy::new(None);
        let outcome = refusal(lab.go(&validation, Some(&spy), &Progress::silent()));
        // Уст19: сначала вложенный архив, потом сам update.rpf
        expect_failure(
            outcome,
            "InvalidDataException",
            "The rebuilt archive header is not encrypted.",
        );
        assert_eq!(
            spy.heard(),
            [
                "scaleform_generic.rpf (файл scaleform_generic.rpf, каталог nested-<pid>-<n>)",
                "update.rpf (файл update.rpf, каталог .astral-stage-<hex>)"
            ]
        );
        assert_eq!(lab.game_listing(), before);
    }

    fn scenario_spy_refuses() {
        let lab = Lab::new();
        let validation = lab.patch_update();
        let before = lab.game_listing();
        let spy = Spy::new(Some("update.rpf"));
        let (code, message) = refusal(lab.go(&validation, Some(&spy), &Progress::silent()));
        // Уст20
        assert_eq!(code, "InvalidOperationException");
        assert_eq!(
            lab.scrub(&message),
            "Ошибка Rebuild '<W>\\game\\update\\update.rpf': InvalidOperationException: spy refuses"
        );
        assert_eq!(lab.game_listing(), before);
        assert_eq!(lab.points_listing(), Vec::<String>::new());
    }

    fn scenario_changed_during() {
        let lab = Lab::new();
        let validation = lab.patch_both();
        let common = lab.live(COMMON);
        let grown = size_of(&common) + 5;
        let target = common.clone();
        // на втором начале стадии verify собирается update.rpf
        let progress = hook("verify", 2, move || {
            let mut file = fs::OpenOptions::new().append(true).open(&target).unwrap();
            std::io::Write::write_all(&mut file, b"+LATE").unwrap();
        });
        let outcome = refusal(lab.go(&validation, None, &progress));
        // Уст21
        expect_failure(
            outcome,
            "InvalidOperationException",
            "common.rpf изменился, пока шла установка: его трогал другой процесс (игра, проверка файлов, другой мод). Ничего не подменено — повторите установку.",
        );
        assert_eq!(size_of(&common), grown);
        assert!(lab
            .game_listing()
            .iter()
            .all(|entry| !entry.contains("astral-stage")));
        assert_eq!(lab.points_listing(), Vec::<String>::new());
    }

    fn scenario_manifest_busy() {
        let lab = Lab::new();
        let validation = lab.patch_both();
        let before = lab.game_listing();
        let points = lab.points.clone();
        // имя restore.json занято каталогом
        let progress = hook("compose", 1, move || {
            let point = fs::read_dir(&points)
                .unwrap()
                .flatten()
                .next()
                .unwrap()
                .path();
            fs::create_dir(point.join("restore.json")).unwrap();
        });
        let started = std::time::Instant::now();
        let outcome = refusal(lab.go(&validation, None, &progress));
        // Уст22
        expect_failure(
            outcome,
            "UnauthorizedAccessException",
            "Отказано в доступе. (os error 5)",
        );
        assert!(started.elapsed() >= Duration::from_secs(9));
        assert_eq!(lab.game_listing(), before);
        assert_eq!(lab.points_listing(), Vec::<String>::new());
    }

    fn scenario_swap_vanishes() {
        let lab = Lab::new();
        let validation = lab.patch_both();
        let (common_sha, update_sha) = (sha_of(&lab.live(COMMON)), sha_of(&lab.live(UPDATE)));
        let game = lab.game.clone();
        // перед подменой пропадает всё, что приготовлено для update.rpf
        let progress = hook("commit", 1, move || {
            crate::test_support::remove_dir_and_wait(staged_update(&game).parent().unwrap());
        });
        let (code, message) = refusal(lab.go(&validation, None, &progress));
        // Уст23
        assert_eq!(code, "FileNotFoundException");
        assert!(message.ends_with("(os error 3)"), "{message}");
        assert_eq!(sha_of(&lab.live(COMMON)), common_sha);
        assert_eq!(sha_of(&lab.live(UPDATE)), update_sha);
        assert_eq!(lab.points_listing(), Vec::<String>::new());
    }

    fn scenario_readonly() {
        let lab = Lab::new();
        let validation = lab.patch_update();
        let live = lab.live(UPDATE);
        let before = sha_of(&live);
        points::mark_readonly(&live).unwrap();
        let installed = lab.go(&validation, None, &Progress::silent()).unwrap();
        // Уст24
        assert_ne!(sha_of(&live), before);
        assert!(fs::metadata(&live).unwrap().permissions().readonly());
        points::clear_readonly(&live).unwrap();
        points::clear_readonly(&lab.points.join(&installed.id).join(UPDATE)).unwrap();
    }

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    const BUILD_COMMON: [&str; 3] = [
        "[Injector] >>> Запуск Smart Rebuild для: common.rpf",
        "[Injector] Правка архива...",
        "  -> Заменен (Binary): g.xml",
    ];
    const BUILD_UPDATE: [&str; 3] = [
        "[Injector] >>> Запуск Smart Rebuild для: update\\update.rpf",
        "[Injector] Правка архива...",
        "  -> Заменен (Binary): a.xml",
    ];

    fn both_builds() -> Vec<&'static str> {
        BUILD_COMMON.iter().chain(&BUILD_UPDATE).copied().collect()
    }

    #[test]
    fn the_journal_of_two_archives_builds_both_then_swaps_in_order() {
        let mut expected = both_builds();
        expected.extend([
            "[Injector] Подмена архива: common.rpf",
            "[Injector] Подмена архива: update.rpf",
        ]);
        assert_eq!(journal_of("two"), lines(&expected));
    }

    #[test]
    fn the_journal_stops_at_the_archive_that_cannot_be_read() {
        let mut expected = Vec::from(BUILD_COMMON);
        expected.push(BUILD_UPDATE[0]);
        assert_eq!(journal_of("broken_second"), lines(&expected));
    }

    #[test]
    fn the_finalizer_is_asked_nested_archives_first_and_the_archive_itself_last() {
        assert_eq!(
            journal_of("spy_noop"),
            lines(&[BUILD_COMMON[0], BUILD_COMMON[1], BUILD_COMMON[2]])
        );
        assert_eq!(
            journal_of("spy_nested"),
            lines(&[
                BUILD_UPDATE[0],
                BUILD_UPDATE[1],
                "  -> Заменен (Binary): hud.gfx"
            ])
        );
        assert_eq!(journal_of("spy_refuses"), lines(&BUILD_UPDATE));
    }

    #[test]
    fn a_live_archive_that_grows_during_the_build_stops_the_install_before_any_swap() {
        assert_eq!(journal_of("changed_during"), lines(&both_builds()));
    }

    #[test]
    fn a_manifest_name_taken_by_a_folder_waits_ten_seconds_and_swaps_nothing() {
        let mut expected = both_builds();
        expected.push("[Install] подмена restore.json: доступ закрыт, жду до 10 с…");
        assert_eq!(journal_of("manifest_busy"), lines(&expected));
    }

    #[test]
    fn a_vanished_ready_file_puts_the_first_archive_back() {
        let mut expected = both_builds();
        expected.extend([
            "[Injector] Подмена архива: common.rpf",
            "[Injector] Подмена архива: update.rpf",
            "[Install] Возврат резервной копии: common.rpf",
        ]);
        assert_eq!(journal_of("swap_vanishes"), lines(&expected));
    }

    #[test]
    fn a_read_only_live_archive_does_not_stop_the_install() {
        let mut expected = Vec::from(BUILD_UPDATE);
        expected.push("[Injector] Подмена архива: update.rpf");
        assert_eq!(journal_of("readonly"), lines(&expected));
    }

    // ----- команда `install-rpf-patch`: отказы до ArchiveFix (Уст36-Уст67) -----

    /// Команда со своим окружением: игра с патчем, ключи, пустой LOCALAPPDATA.
    struct Cli {
        lab: Lab,
        keys: PathBuf,
        appdata: PathBuf,
        _env: TestEnv,
    }

    impl Cli {
        fn new() -> Cli {
            let lab = Lab::new();
            let appdata = lab.dir.path().join("localappdata");
            fs::create_dir_all(&appdata).unwrap();
            let keys = key_dir(&lab.dir.path().join("keys"));
            lab.patch_update();
            Cli {
                _env: TestEnv::clean(&appdata),
                lab,
                keys,
                appdata,
            }
        }

        fn arg(path: &Path) -> String {
            path.to_string_lossy().into_owned()
        }

        /// Параметры с игрой и заплаткой; остальное добавляет вызывающий.
        fn base(&self) -> Vec<String> {
            vec![
                "--game-root".into(),
                Self::arg(&self.lab.game),
                "--patch".into(),
                Self::arg(&self.lab.patch),
            ]
        }

        fn with_keys(&self) -> Vec<String> {
            let mut args = self.base();
            args.extend(["--keys".into(), Self::arg(&self.keys)]);
            args
        }

        fn run(&self, args: Vec<String>) -> (Result<Value>, Vec<String>) {
            let options = Options::parse(&args).unwrap();
            let (progress, lines) = recorded();
            let outcome = install_rpf_patch(&options, &progress);
            let seen = lines.lock().unwrap().clone();
            (outcome, seen)
        }

        fn refused(&self, args: Vec<String>) -> (String, String) {
            refusal(self.run(args).0)
        }
    }

    fn extend(mut args: Vec<String>, more: &[&str]) -> Vec<String> {
        args.extend(more.iter().map(|item| (*item).to_owned()));
        args
    }

    fn same(outcome: (String, String), code: &str, message: &str) {
        assert_eq!((outcome.0.as_str(), outcome.1.as_str()), (code, message));
    }

    #[test]
    fn the_game_folder_is_checked_first_and_nothing_else_is_read() {
        let cli = Cli::new();
        // Уст36
        same(
            cli.refused(Vec::new()),
            "ArgumentException",
            "--game-root is required.",
        );
        // Уст37
        let empty = cli.lab.dir.path().join("empty");
        fs::create_dir_all(&empty).unwrap();
        let not_a_game = "The selected directory is not a GTA V installation.";
        same(
            cli.refused(vec!["--game-root".into(), Cli::arg(&empty)]),
            "DirectoryNotFoundException",
            not_a_game,
        );
        // Уст38: файл, а не папка
        same(
            cli.refused(vec![
                "--game-root".into(),
                Cli::arg(&cli.lab.live("GTA5.exe")),
            ]),
            "DirectoryNotFoundException",
            not_a_game,
        );
        // Уст64: побеждает папка игры
        same(
            cli.refused(vec![
                "--game-root".into(),
                Cli::arg(&empty),
                "--patch".into(),
                Cli::arg(&cli.lab.dir.path().join("none")),
            ]),
            "DirectoryNotFoundException",
            not_a_game,
        );
    }

    #[test]
    fn the_patch_is_checked_after_the_prepare_line() {
        let cli = Cli::new();
        let game = vec!["--game-root".to_owned(), Cli::arg(&cli.lab.game)];
        // Уст39: перед отказом уже выдана стадия prepare
        let (outcome, lines) = cli.run(game.clone());
        same(
            refusal(outcome),
            "ArgumentException",
            "--patch is required.",
        );
        assert_eq!(lines.len(), 1);
        assert_eq!(phase_of(&lines[0]), "prepare");
        // Уст40
        same(
            cli.refused(extend(game.clone(), &["--patch", ""])),
            "ArgumentException",
            "The path is empty.",
        );
        // Уст41
        let none = Cli::arg(&cli.lab.dir.path().join("no-such-patch"));
        same(
            cli.refused(extend(game.clone(), &["--patch", &none])),
            "FileNotFoundException",
            "RPF patch manifest.json was not found.",
        );

        // Уст42-Уст47: опись и нагрузка
        let manifests = [
            (
                "{oops",
                "InvalidDataException",
                "RPF patch manifest is invalid.",
            ),
            (
                r#"{"Actions":[]}"#,
                "InvalidDataException",
                "RPF patch has no actions.",
            ),
            (
                r#"{"Actions":[{"Type":"Replace","TargetPath":"update:/a","SourcePath":"payload/a"}]}"#,
                "FileNotFoundException",
                "Patch payload is missing: payload/a",
            ),
            (
                r#"{"Actions":[{"Type":"Replace","TargetPath":"update:/a","SourcePath":"../a"}]}"#,
                "InvalidDataException",
                "Unsafe relative path: ../a",
            ),
            (
                r#"{"Actions":[{"Type":"Delete","TargetPath":"a/../b:/x"}]}"#,
                "InvalidDataException",
                "Unsafe relative path: a/../b.rpf",
            ),
            (
                r#"{"Actions":[{"Type":"Teleport","TargetPath":"update:/a"}]}"#,
                "InvalidDataException",
                "RPF patch has an unsupported action type: teleport",
            ),
        ];
        for (index, (manifest, code, message)) in manifests.iter().enumerate() {
            let folder = cli.lab.dir.path().join(format!("patch-{index}"));
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join("manifest.json"), manifest).unwrap();
            let folder = Cli::arg(&folder);
            same(
                cli.refused(extend(game.clone(), &["--patch", &folder])),
                code,
                message,
            );
        }

        // Уст65: побеждает патч, ключи ещё не читались
        let broken = cli.lab.dir.path().join("patch-0");
        let broken = Cli::arg(&broken);
        same(
            cli.refused(extend(game, &["--patch", &broken, "--keys", "nowhere"])),
            "InvalidDataException",
            "RPF patch manifest is invalid.",
        );
    }

    #[test]
    fn keys_come_from_the_option_or_the_variable_and_are_checked_before_archivefix() {
        let cli = Cli::new();
        // Уст48
        same(
            cli.refused(cli.base()),
            "InvalidOperationException",
            "Astral could not discover the RPF keys in this GTA V build. Update the native engine or configure MODOVIK_GTA_KEYS_PATH. Keys are never uploaded or committed.",
        );
        // Уст49
        let missing = cli.lab.dir.path().join("nokeys");
        let (code, message) = cli.refused(extend(cli.base(), &["--keys", &Cli::arg(&missing)]));
        assert_eq!(code, "InvalidOperationException");
        assert!(message.starts_with(&format!(
            "The GTA V RPF key file gtav_aes_key.dat could not be read from {}: ",
            missing.display()
        )));
        assert!(message.ends_with("(os error 3)"), "{message}");
        // Уст50: файл ключа слишком короткий
        let short = key_dir(&cli.lab.dir.path().join("short-keys"));
        fs::write(short.join("gtav_aes_key.dat"), [1u8; 5]).unwrap();
        same(
            cli.refused(extend(cli.base(), &["--keys", &Cli::arg(&short)])),
            "InvalidOperationException",
            "The GTA V RPF key set is incomplete.",
        );
        // Уст51: PlayGTAV.exe годится для папки, но не для поиска ключей
        fs::remove_file(cli.lab.live("GTA5.exe")).unwrap();
        fs::write(cli.lab.live("PlayGTAV.exe"), b"").unwrap();
        same(
            cli.refused(cli.base()),
            "FileNotFoundException",
            "GTA V executable was not found for in-memory key discovery.",
        );
        fs::write(cli.lab.live("GTA5.exe"), b"").unwrap();
        // Уст66: побеждают ключи
        let wrong_tool = Cli::arg(&cli.appdata.join("nope.exe"));
        same(
            cli.refused(extend(
                cli.base(),
                &["--keys", &Cli::arg(&short), "--archive-fix", &wrong_tool],
            )),
            "InvalidOperationException",
            "The GTA V RPF key set is incomplete.",
        );
    }

    #[test]
    fn archivefix_is_required_found_and_checked_by_its_checksum() {
        let mut cli = Cli::new();
        let refused = |cli: &Cli, extra: &[&str]| cli.refused(extend(cli.with_keys(), extra));
        let required = (
            "InvalidOperationException",
            "Verified ArchiveFix is required.",
        );
        let mismatch = (
            "InvalidDataException",
            "ArchiveFix executable checksum mismatch.",
        );
        let tools = cli.lab.dir.path().join("tools");

        // Уст52
        same(refused(&cli, &[]), required.0, required.1);
        // Уст53: пробельный --keys не считается, каталог берётся из окружения
        cli._env
            .set("MODOVIK_GTA_KEYS_PATH", Some(cli.keys.as_os_str()));
        same(
            cli.refused(extend(cli.base(), &["--keys", "  "])),
            required.0,
            required.1,
        );
        // Уст54
        let nope = tools.join("nope.exe");
        same(
            refused(&cli, &["--archive-fix", &Cli::arg(&nope)]),
            "FileNotFoundException",
            &format!("File was not found: {}", nope.display()),
        );
        // Уст55-Уст58
        let cmd = fake_tool(&tools.join("a"), "ArchiveFix.cmd");
        same(
            refused(&cli, &["--archive-fix", &Cli::arg(&cmd)]),
            "ArgumentException",
            "Unsupported file extension: .cmd",
        );
        let other = fake_tool(&tools.join("b"), "other.exe");
        same(
            refused(&cli, &["--archive-fix", &Cli::arg(&other)]),
            "InvalidDataException",
            "ArchiveFix executable name is invalid.",
        );
        let fake = fake_tool(&tools.join("c"), "ArchiveFix.exe");
        same(
            refused(&cli, &["--archive-fix", &Cli::arg(&fake)]),
            mismatch.0,
            mismatch.1,
        );
        let shouting = fake_tool(&tools.join("d"), "archivefix.EXE");
        same(
            refused(&cli, &["--archive-fix", &Cli::arg(&shouting)]),
            mismatch.0,
            mismatch.1,
        );
        // Уст59: путь только в переменной
        cli._env
            .set("MODOVIK_ARCHIVE_FIX_PATH", Some(fake.as_os_str()));
        same(refused(&cli, &[]), mismatch.0, mismatch.1);
        // Уст60: пустая опция считается отсутствующей, берётся переменная
        same(
            refused(&cli, &["--archive-fix", ""]),
            mismatch.0,
            mismatch.1,
        );
        same(
            refused(&cli, &["--archive-fix", "   "]),
            mismatch.0,
            mismatch.1,
        );
        // Уст61: опция побеждает переменную
        same(
            refused(&cli, &["--archive-fix", &Cli::arg(&nope)]),
            "FileNotFoundException",
            &format!("File was not found: {}", nope.display()),
        );
        // Уст62: пробельная переменная — как не заданная
        cli._env.set(
            "MODOVIK_ARCHIVE_FIX_PATH",
            Some(std::ffi::OsStr::new("   ")),
        );
        same(refused(&cli, &[]), required.0, required.1);
        // Уст63: запасное место в LOCALAPPDATA
        fake_tool(
            &cli.appdata.join("Astral").join("tools").join("ArchiveFix"),
            "ArchiveFix.exe",
        );
        same(refused(&cli, &[]), mismatch.0, mismatch.1);
        // Уст67: побеждает ArchiveFix, корень точек проверяется после него
        same(
            refused(
                &cli,
                &[
                    "--archive-fix",
                    &Cli::arg(&nope),
                    "--restore-points-root",
                    "relative\\points",
                ],
            ),
            "FileNotFoundException",
            &format!("File was not found: {}", nope.display()),
        );
    }

    // ----- процесс убит посреди установки (Уст25-Уст28) -----

    /// Обрывы в точках `install-after-manifest` и `install-after-first-swap`.
    /// Ребёнок — этот же тестовый бинарник на одном тесте; идёт с признаком
    /// `failpoints`.
    #[cfg(feature = "failpoints")]
    mod failpoint_runs {
        use super::*;

        const CHILD_ENV: &str = "ASTRAL_INSTALL_TEST_CHILD_DIR";

        /// Сценарий ребёнка: установка двух архивов в уже готовой игре.
        #[test]
        fn child_install() {
            let Some(root) = std::env::var_os(CHILD_ENV) else {
                return;
            };
            let root = PathBuf::from(root);
            let game = root.join("game");
            let validation = patch::validate(&root.join("patch"), Some(&game)).unwrap();
            let _ = install_with(
                &game,
                &validation,
                &quiet_keys(),
                None,
                &root.join("points"),
                &Progress::silent(),
            );
        }

        fn killed_at(lab: &Lab, point: &str) {
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "archives::install::tests::failpoint_runs::child_install",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(CHILD_ENV, lab.dir.path())
                .env("ASTRAL_ENGINE_FAILPOINT", point)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .unwrap();
            assert_eq!(output.status.code(), Some(137));
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            assert!(stderr.contains(&format!("[failpoint] {point}")), "{stderr}");
        }

        fn only_point(lab: &Lab) -> String {
            let found: Vec<String> = fs::read_dir(&lab.points)
                .unwrap()
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect();
            assert_eq!(found.len(), 1, "{found:?}");
            found.into_iter().next().unwrap()
        }

        #[test]
        fn killed_after_the_manifest_the_game_is_untouched_and_the_point_is_usable() {
            let lab = Lab::new();
            lab.patch_both();
            let (common_sha, update_sha) = (sha_of(&lab.live(COMMON)), sha_of(&lab.live(UPDATE)));
            killed_at(&lab, "install-after-manifest");

            // Уст25
            assert_eq!(sha_of(&lab.live(COMMON)), common_sha);
            assert_eq!(sha_of(&lab.live(UPDATE)), update_sha);
            let game = lab.game_listing();
            assert!(game.contains(&".astral-stage-<hex>/".to_owned()));
            assert!(game.contains(&"update/.astral-stage-<hex>/".to_owned()));
            assert!(game
                .iter()
                .any(|e| e.starts_with(".astral-stage-<hex>/common.rpf (")));
            assert!(game
                .iter()
                .any(|e| e.starts_with("update/.astral-stage-<hex>/update.rpf (")));
            let id = only_point(&lab);
            assert!(lab.points.join(&id).join("restore.json").is_file());

            // Уст26: откат узнаёт «ничего не делать»; служебные папки остаются
            restore::restore_in(&id, &lab.points, &Progress::silent()).unwrap();
            assert_eq!(sha_of(&lab.live(UPDATE)), update_sha);
            assert!(!lab.points.join(&id).exists());
            assert!(lab
                .game_listing()
                .iter()
                .any(|e| e.contains("astral-stage")));
        }

        #[test]
        fn killed_between_two_swaps_the_point_rolls_back_the_first_archive() {
            let lab = Lab::new();
            lab.patch_both();
            let (common_sha, update_sha) = (sha_of(&lab.live(COMMON)), sha_of(&lab.live(UPDATE)));
            killed_at(&lab, "install-after-first-swap");

            // Уст27
            assert_ne!(sha_of(&lab.live(COMMON)), common_sha);
            assert_eq!(sha_of(&lab.live(UPDATE)), update_sha);
            let id = only_point(&lab);

            // Уст28
            restore::restore_in(&id, &lab.points, &Progress::silent()).unwrap();
            assert_eq!(sha_of(&lab.live(COMMON)), common_sha);
            assert_eq!(sha_of(&lab.live(UPDATE)), update_sha);
            assert!(!lab.points.join(&id).exists());
        }
    }
}
