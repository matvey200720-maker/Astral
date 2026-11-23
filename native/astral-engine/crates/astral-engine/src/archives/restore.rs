//! Команда `restore-rpf-point`: возвращает архивы игры к копиям из точки отката.
//!
//! В живой архив не пишут «на месте», и между старым и новым файлом нет
//! мгновения, когда архива нет вовсе (кроме ветки без жёстких ссылок).
//! Порядок: сверка отпечатков до первого изменения, подготовка копии точки
//! возле каждого живого архива, подмена переименованием с запасным именем
//! прежнего файла, при отказе возврат уже подменённого, уборка точки. Прерванный
//! откат безопасно запустить снова: архив, совпавший с копией, пропускается.
//!
//! Файлы, которые установка создала (ключ описи `createdFiles`, например свой dlc),
//! сверяются по длине и SHA-256 до первого изменения (чужой — `NotOurs`, ничто не
//! тронуто) и убираются через `release_core` после подмен и отката записей журнала:
//! к тому времени регистрация, ссылавшаяся на файл, уже снята.

use std::{
    fs, io, path,
    thread::{self, Scope, ScopedJoinHandle},
};

use crate::{
    args, disk,
    error::{self, EngineError},
    failpoint, paths, progress,
};

use super as archives;
use super::{
    append::EngineHost,
    newdlc::{self, Verdict},
    points,
};

use rage_rpf::{
    append::{parse_digest, Code},
    journal::Digest,
    read_pace::{self, ReadPace},
};
use serde_json::{json, Map, Value};

const MANIFEST_FILE: &str = "restore.json";

/// Запасное имя прежнего живого файла.
const CURRENT_SUFFIX: &str = "astral-current";

/// Фаза хода для оболочки: сверка и подготовка копий.
const PHASE_PREPARE: &str = "prepare";
/// Фаза хода для оболочки: сама подмена.
const PHASE_COMMIT: &str = "commit";

/// Строки журнала об одном архиве (после имени архива и двоеточия).
enum Note {
    AsInPoint,
    NoLive,
    CreatedRemove,
    CreatedGone,
}

impl Note {
    fn text(self) -> &'static str {
        match self {
            Note::AsInPoint => "уже как в точке, пропускаю",
            Note::NoLive => "живого архива нет, ставлю копию точки",
            Note::CreatedRemove => "архив создала установка, убираю",
            Note::CreatedGone => "архива уже нет, откатывать нечего",
        }
    }
}

// ---------------------------------------------------------------------------
// Записи описи
// ---------------------------------------------------------------------------

/// Судьба архива в этом откате.
enum Fate {
    /// Живой архив уже совпал с копией (прерванный откат): пропускаем.
    /// Так же помечен созданный установкой архив, которого уже нет.
    Keep,
    /// Копию точки ещё нужно поставить.
    Replace,
    /// Архив создала установка («до: отсутствовал»): живой файл убирается.
    Remove,
}

/// Чем стал прежний живой файл на время подмены.
enum Parking {
    /// Живого файла не было, откладывать нечего.
    Empty,
    /// Второе имя `….astral-current` (живой остался на месте).
    Hardlink,
    /// Живой переименован в `….astral-current`; до подмены его на месте нет.
    Renamed,
}

/// Одна запись описи, прошедшая проверку путей.
struct Step {
    installed: Option<String>,
    /// Отпечаток живого архива на момент сверки (`None`, если живого не было).
    live_stamp: Option<points::Stamp>,
    /// До установки архива не было: копии в точке нет, живой файл поставила установка.
    created: bool,
    relative: String,
    live: path::PathBuf,
    fate: Fate,
    before: String,
    copy: path::PathBuf,
    /// «До» лежит не в точке, а рядом с живым архивом (`<архив>.astral-before-<точка>`):
    /// установка с `before: "aside"` на томе, куда из папки точек ссылки нет.
    /// После отката эта ссылка убирается вместе с точкой.
    aside: bool,
}

impl Step {
    /// Пути записи проверяются, копия обязана лежать в точке или рядом с
    /// живым архивом под именем точки; живой архив запоминается отпечатком
    /// «размер + время». Поля `livePath` и `backupPath` описи не читаются
    /// вовсе: место рядом с живым файлом — одно, и имя его выводится из
    /// id точки, а не берётся из описи.
    fn from_entry(
        entry: &points::RestoreEntry,
        roots: [&str; 2],
        point_id: &str,
    ) -> error::Result<Self> {
        let (before, installed) = (entry.sha256_before.clone(), entry.sha256_after.clone());
        let relative: String = points::safe_relative(&entry.relative_path)?;
        let [copy, live] = roots.map(|root| paths::inside(root, &relative));
        let (copy, live) = (copy?, live?);
        let beside = points::aside_path(&live, point_id);
        let (copy, aside) = match (copy.is_file(), beside.is_file()) {
            (false, true) => (beside, true),
            _ => (copy, false),
        };
        // Запись установки «до: отсутствовал»: пустой отпечаток «до», отпечаток
        // «после» есть, копии в точке нет. Без отпечатка «после» убирать нечем
        // подтвердить, и запись разбирается как прежде.
        let created = match (copy.is_file(), before.is_empty(), &installed) {
            (true, ..) => false,
            (false, true, Some(_)) => true,
            (false, ..) => {
                let message = format!("Restore archive is missing: {relative}");
                return Err(EngineError::file_not_found(message));
            }
        };
        Ok(Self {
            installed,
            live_stamp: points::stamp(&live).ok(),
            created,
            relative,
            live,
            fate: Fate::Replace,
            before,
            copy,
            aside,
        })
    }

    fn sibling(&self, suffix: &str) -> path::PathBuf {
        points::sibling_name(&self.live, suffix)
    }

    /// Куда уходит прежний живой файл на время подмены.
    fn parked(&self) -> path::PathBuf {
        self.sibling(CURRENT_SUFFIX)
    }

    /// Живой архив с момента сверки не менялся (если его отпечаток был снят).
    fn untouched(&self) -> bool {
        self.live_stamp
            .is_none_or(|seen| points::stamp(&self.live).ok() == Some(seen))
    }

    fn note(&self, journal: &mut dyn FnMut(String), note: Note) {
        journal(format!("[Restore] {}: {}", self.relative, note.text()));
    }

    /// Отказ: живой архив менялся после установки, откат стёр бы эти изменения.
    fn changed_since_install(&self) -> EngineError {
        let relative = &self.relative;
        EngineError::invalid_operation(format!(
            "{relative} изменился после этой установки: в него ставили другие моды или игра \
             обновилась. Откат вернул бы прежний архив и молча стёр бы эти изменения. \
             Сначала откатите то, что ставили позже, а если обновлялась сама GTA V — \
             проверьте файлы игры в Steam."
        ))
    }

    /// Кладёт возле живого архива копию точки и учитывает принесённые байты.
    fn stage(
        &self,
        progress: &progress::Progress,
        counted: &mut u64,
        volume: u64,
    ) -> error::Result<path::PathBuf> {
        let mut last = 0u64;
        let mut tick = |copied: u64| {
            let fresh = disk::delta(&mut last, copied);
            progress.wrote(fresh);
            *counted += fresh;
            progress.report_bytes(PHASE_PREPARE, *counted, volume);
        };
        points::prepare_sibling(&self.copy, &self.live, &self.before, &mut tick)
    }

    /// Прежний живой файл откладывается под именем `….astral-current`: жёсткой
    /// ссылкой, а если ссылка невозможна, переименованием.
    fn park(&self) -> io::Result<Parking> {
        let current = self.parked();
        drop(fs::remove_file(&current));
        if !self.live.exists() {
            Ok(Parking::Empty)
        } else if fs::hard_link(&self.live, &current).is_ok() {
            Ok(Parking::Hardlink)
        } else {
            points::rename_with_retry(&self.live, &current).map(|()| Parking::Renamed)
        }
    }

    /// Подмена не удалась: отложенная ссылка убирается, переименованный файл
    /// возвращается на место. Ошибка подмены идёт наружу.
    fn undo_parking(&self, parking: Parking, swap_error: io::Error) -> EngineError {
        let current = self.parked();
        let returned = match parking {
            Parking::Empty => Ok(()),
            Parking::Hardlink => {
                drop(fs::remove_file(&current));
                Ok(())
            }
            Parking::Renamed => points::rename_with_retry(&current, &self.live),
        };
        match returned {
            Ok(()) => swap_error.into(),
            Err(back_error) => EngineError::io(format!(
                "{}: {swap_error}. Прежний архив не вернулся на место ({back_error}), \
                 он лежит рядом с суффиксом .{CURRENT_SUFFIX}.",
                self.relative
            )),
        }
    }

    /// Созданный установкой архив убирается из игры переименованием в
    /// `….astral-current`: до конца отката его можно вернуть, потом он удаляется
    /// вместе с остальными `….astral-current`.
    fn take_away(&self) -> error::Result<Parking> {
        let current = self.parked();
        drop(fs::remove_file(&current));
        points::rename_with_retry(&self.live, &current)
            .map(|()| Parking::Renamed)
            .map_err(EngineError::from)
    }

    fn swap(&self) -> error::Result<Parking> {
        let parking = match self.fate {
            Fate::Remove => return self.take_away(),
            _ => self.park()?,
        };
        failpoint::hit("restore-after-link");
        match points::swap_in(&self.sibling("astral-restore"), &self.live) {
            Ok(()) => {
                failpoint::hit("restore-after-swap");
                Ok(parking)
            }
            Err(swap_error) => Err(self.undo_parking(parking, swap_error)),
        }
    }

    /// Уже подменённый архив возвращается на место; ошибка - если не вернулся.
    fn give_back(&self, parking: &Parking) -> io::Result<()> {
        let current = self.parked();
        if matches!(parking, Parking::Empty) || !current.exists() {
            return Ok(());
        }
        points::rename_with_retry(&current, &self.live)
    }
}

/// Записи, которые что-то меняют в игре (ставят копию точки или убирают
/// созданный установкой архив), по порядку описи.
fn acting(steps: &[Step]) -> impl Iterator<Item = &Step> {
    steps.iter().filter(|step| !matches!(step.fate, Fate::Keep))
}

/// Соседи `….astral-restore`, которые не дошли до подмены, уходят при любом
/// выходе (кроме убитого процесса: тогда их подбирает повторный откат).
#[derive(Default)]
struct Leftovers(Vec<path::PathBuf>);

impl Drop for Leftovers {
    fn drop(&mut self) {
        for sibling in &self.0 {
            drop(fs::remove_file(sibling));
        }
    }
}

// ---------------------------------------------------------------------------
// Команда и ядро
// ---------------------------------------------------------------------------

/// Ядро: откат точки `point_id` из папки точек `points_root`.
pub fn restore_in(
    point_id: &str,
    points_root: &path::Path,
    progress: &progress::Progress,
) -> error::Result<Value> {
    restore_journaled(point_id, points_root, progress, &mut |line: String| {
        archives::log(line)
    })
}

/// Команда `restore-rpf-point`.
pub fn restore_rpf_point(
    options: &args::Options,
    progress: &progress::Progress,
) -> error::Result<Value> {
    let pacer = disk::WritePacer::from_options(options);
    let _pacing = progress.pace(pacer);
    options.required("restore-point").and_then(|id| {
        let root = points::restore_points_root_for(options)?;
        restore_in(id, &root, progress)
    })
}

/// Найденная точка: её каталог и прочитанная опись.
fn locate_point(
    points_root: &path::Path,
    point_id: &str,
) -> error::Result<(path::PathBuf, points::RestoreManifest)> {
    let point_dir = match points::valid_point_id(point_id) {
        true => paths::inside(&points_root.to_string_lossy(), point_id)?,
        false => return Err(EngineError::argument("Invalid restore point identifier.")),
    };
    let manifest_file = paths::inside(&point_dir.display().to_string(), MANIFEST_FILE)?;
    match manifest_file.is_file() {
        true => Ok((point_dir, points::read_manifest(&manifest_file)?)),
        false => Err(EngineError::file_not_found(
            "Restore point manifest was not found.",
        )),
    }
}

fn existing_game_root(manifest: &points::RestoreManifest) -> error::Result<path::PathBuf> {
    Some(paths::full_path(&manifest.game_root)?)
        .filter(|root| root.is_dir())
        .ok_or_else(|| {
            EngineError::directory_not_found("The original GTA V directory was not found.")
        })
}

fn restore_journaled(
    point_id: &str,
    points_root: impl AsRef<path::Path>,
    progress: &progress::Progress,
    journal: &mut dyn FnMut(String),
) -> error::Result<Value> {
    let (point_dir, manifest) = locate_point(points_root.as_ref(), point_id)?;
    let game_root = existing_game_root(&manifest)?;

    // Опись без архивов (заплатка только на setup2.xml) откатывается без отказа:
    // возвращать нечего, точка убирается, ответ с пустым списком.
    progress.report(PHASE_PREPARE);
    let (mut steps, folders, made) = (
        inspect(&game_root, &point_dir, &manifest, point_id)?,
        created_folders(&game_root, &manifest)?,
        created_files(&game_root, &manifest)?,
    );
    // файл, который не доказан нашим, останавливает откат раньше первого изменения
    confirm_made(&made, progress)?;
    for step in &steps {
        archives::append::settle_beside(&step.live, progress)?;
    }
    verify_fingerprints(&mut steps, journal)?;
    // копия «до» старше слоёв: подмена убирает журнал и таблицу слоёв рядом, и что
    // стало со слоями, вызывающий узнаёт из ответа (у архива без таблицы ключа нет)
    let layers_note = archives::layers::dropped_note(
        &steps
            .iter()
            .map(|step| (step.live.as_path(), step.relative.as_str()))
            .collect::<Vec<_>>(),
    );
    // точка дозаписи: копии нет, откатывается запись журнала рядом с архивом
    let rolled = roll_back_appended(&game_root, &manifest, progress)?;

    let mut leftovers = Leftovers::default();
    stage_copies(&steps, progress, &mut leftovers)?;
    swap_in_all(&steps, progress)?;

    for step in &steps {
        drop(fs::remove_file(step.parked()));
        // «До» рядом с живым архивом уходит вместе с точкой: байты уже вернулись
        if step.aside {
            drop(fs::remove_file(&step.copy));
        }
    }
    // созданные файлы уходят, когда записи, что на них ссылались, уже сняты
    let released = remove_made(&made, progress, journal)?;
    remove_created_folders(&folders, journal);
    // Откат уже случился: ошибка уборки точки его не отменяет.
    drop(fs::remove_dir_all(&point_dir));

    let mut answer = Map::new();
    answer.insert("id".to_owned(), json!(point_id));
    answer.insert(
        "gameRoot".to_owned(),
        json!(game_root.display().to_string()),
    );
    answer.insert(
        "archives".to_owned(),
        json!(steps
            .iter()
            .map(|step| &step.relative)
            .chain(rolled.iter())
            .collect::<Vec<_>>()),
    );
    if let Some(note) = layers_note {
        answer.insert("layers".to_owned(), note);
    }
    // ключ есть, только когда опись называла созданные файлы: прочие ответы прежние
    if !released.is_empty() {
        answer.insert("createdFiles".to_owned(), Value::Array(released));
    }
    Ok(Value::Object(answer))
}

/// Файл, который создала установка (ключ `createdFiles` описи).
struct Made {
    relative: String,
    full: path::PathBuf,
    bytes: u64,
    sha256: Digest,
}

/// Созданные файлы описи с проверенными путями: плохой путь отказывает до первого
/// изменения, как путь архива. Записи, которым не верит читатель описи, сюда не попадают.
fn created_files(
    game_root: &path::Path,
    manifest: &points::RestoreManifest,
) -> error::Result<Vec<Made>> {
    let game_text = game_root.to_string_lossy();
    // архивы самой точки откатываются, а не убираются: опись, назвавшая один из них
    // созданным файлом, негодна (иначе откат убрал бы архив игры)
    let archives_of_point: Vec<String> = manifest
        .archives
        .iter()
        .filter_map(|entry| points::safe_relative(&entry.relative_path).ok())
        .map(|relative| relative.to_lowercase())
        .collect();
    let mut found = Vec::with_capacity(manifest.created_files.len());
    for file in &manifest.created_files {
        let relative = points::safe_relative(&file.path)?;
        if archives_of_point.contains(&relative.to_lowercase()) {
            return Err(EngineError::invalid_data(
                "Restore point manifest is invalid.",
            ));
        }
        let full = paths::inside(&game_text, &relative)?;
        let sha256 = parse_digest(&file.sha256)
            .ok_or_else(|| EngineError::invalid_data("Restore point manifest is invalid."))?;
        found.push(Made {
            relative,
            full,
            bytes: file.bytes,
            sha256,
        });
    }
    Ok(found)
}

/// Каждый названный файл либо лежит с той же длиной и тем же SHA-256, либо его
/// нет вовсе. Иное (чужой файл, папка, другая длина) — отказ `NotOurs`: откат
/// не начат, ничто не тронуто.
fn confirm_made(made: &[Made], progress: &progress::Progress) -> error::Result<()> {
    for file in made {
        match newdlc::check_file(&file.full, file.bytes, &file.sha256, progress)? {
            Verdict::Intact { .. } | Verdict::Missing => {}
            Verdict::Damaged { reason, .. } => {
                return Err(EngineError::new(
                    Code::NotOurs.name(),
                    format!(
                        "{} is not the archive that the install created ({reason} differs); \
                         the restore point was not applied and nothing was changed.",
                        file.relative
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Убирает созданные файлы через `release_core` (он доказывает «наш» ещё раз, пока
/// файл не удалён). Нет файла — не ошибка: так выглядит повтор прерванного отката.
fn remove_made(
    made: &[Made],
    progress: &progress::Progress,
    journal: &mut dyn FnMut(String),
) -> error::Result<Vec<Value>> {
    let mut rows = Vec::with_capacity(made.len());
    for file in made {
        let answer = newdlc::release_core(
            &file.full,
            &[],
            file.bytes,
            &file.sha256,
            progress,
            &EngineHost,
        )?;
        let released = answer["released"].as_bool().unwrap_or(false);
        if released {
            journal(format!(
                "[Restore] {}: файл создала установка, убираю",
                file.relative
            ));
        }
        rows.push(json!({
            "path": file.relative,
            "released": released,
            "freedBytes": answer["freedBytes"].as_u64().unwrap_or(0),
        }));
        failpoint::hit("restore-after-created-file");
    }
    Ok(rows)
}

/// Откатывает записи журнала для записей описи с ключом `append`; идут по
/// порядку описи, первая же ошибка прекращает откат. Названия откатанных
/// архивов — в ответ.
fn roll_back_appended(
    game_root: &path::Path,
    manifest: &points::RestoreManifest,
    progress: &progress::Progress,
) -> error::Result<Vec<String>> {
    let root = game_root.to_string_lossy();
    let mut rolled = Vec::new();
    for entry in &manifest.archives {
        let Some(mark) = &entry.append else { continue };
        let relative = points::safe_relative(&entry.relative_path)?;
        let live = paths::inside(&root, &relative)?;
        archives::append::rollback_point(&live, &relative, mark, progress)?;
        rolled.push(relative);
    }
    Ok(rolled)
}

/// Все записи описи по порядку; первая же ошибка прекращает разбор. Записи
/// точки дозаписи копий не имеют и здесь пропускаются.
fn inspect(
    game_root: &path::Path,
    point_dir: &path::Path,
    manifest: &points::RestoreManifest,
    point_id: &str,
) -> error::Result<Vec<Step>> {
    let roots = [point_dir, game_root].map(|dir| dir.to_string_lossy().into_owned());
    let mut steps = Vec::with_capacity(manifest.archives.len());
    for entry in manifest
        .archives
        .iter()
        .filter(|entry| entry.append.is_none())
    {
        steps.push(Step::from_entry(entry, [&roots[0], &roots[1]], point_id)?);
    }
    Ok(steps)
}

/// Папки, которые установка создала в игре (ключ `createdDirectories` описи;
/// у старых описей его нет). Пути проходят ту же проверку, что и пути архивов,
/// плохой путь отказывает до первого изменения. Порядок: от самой глубокой к
/// верхней.
fn created_folders(
    game_root: &path::Path,
    manifest: &points::RestoreManifest,
) -> error::Result<Vec<(String, path::PathBuf)>> {
    let game_text = game_root.to_string_lossy();
    let mut folders = Vec::with_capacity(manifest.created_directories.len());
    for given in &manifest.created_directories {
        folders.push(points::safe_relative(given).and_then(|relative| {
            paths::inside(&game_text, &relative).map(|full| (relative, full))
        })?);
    }
    folders.sort_by_key(|(relative, _)| std::cmp::Reverse(relative.matches('/').count()));
    Ok(folders)
}

/// Убирает записанные папки, пока они пусты; непустая, отсутствующая или уже
/// не папка остаются без отказа и без строки в журнале.
fn remove_created_folders(folders: &[(String, path::PathBuf)], journal: &mut dyn FnMut(String)) {
    for (relative, full) in folders {
        if fs::remove_dir(full).is_ok() {
            journal(format!(
                "[Restore] {relative}: пустая папка, созданная установкой, убрана"
            ));
        }
    }
}

// ---------------------------------------------------------------------------
// Отпечатки
// ---------------------------------------------------------------------------

type HashJob<'scope> = ScopedJoinHandle<'scope, error::Result<String>>;

/// Фоновые подсчёты одной записи: копия точки (у созданного установкой архива
/// её нет) и живой архив - только если в описи есть чем его сверить и он есть.
type HashJobs<'scope> = (Option<HashJob<'scope>>, Option<HashJob<'scope>>);

fn launch_hashes<'scope>(
    scope: &'scope Scope<'scope, '_>,
    pace: &ReadPace,
    step: &Step,
) -> HashJobs<'scope> {
    let start = |file: &path::Path| -> HashJob<'scope> {
        let (pace, file) = (pace.clone(), file.to_path_buf());
        scope.spawn(move || {
            pace.install();
            archives::sha256_file(&file)
        })
    };
    let copy = (!step.created).then_some(step.copy.as_path()).map(start);
    let live = match (&step.installed, step.live.exists()) {
        (Some(_), true) => Some(start(&step.live)),
        _ => None,
    };
    (copy, live)
}

fn finished(job: HashJob<'_>) -> error::Result<String> {
    job.join()
        .map_err(|_| EngineError::internal("The hash thread failed."))?
}

/// Сверка созданного установкой архива: убирается только тот файл, который
/// поставила установка (отпечаток совпал с `sha256After`); нет файла — запись
/// уже откатана; иное — отказ «чужие изменения».
fn confirm_created(
    step: &mut Step,
    live_job: Option<HashJob<'_>>,
    journal: &mut dyn FnMut(String),
) -> error::Result<()> {
    if !step.live.exists() {
        step.note(journal, Note::CreatedGone);
        step.fate = Fate::Keep;
        return Ok(());
    }
    let live_hash = live_job.map(finished).transpose()?;
    let ours = step
        .installed
        .as_deref()
        .zip(live_hash.as_deref())
        .is_some_and(|(installed, hash)| hash.eq_ignore_ascii_case(installed));
    if !ours {
        return Err(step.changed_since_install());
    }
    step.note(journal, Note::CreatedRemove);
    step.fate = Fate::Remove;
    Ok(())
}

/// Сверка одной записи: сначала копия точки, затем живой архив.
fn check_step(
    step: &mut Step,
    (copy_job, live_job): HashJobs<'_>,
    journal: &mut dyn FnMut(String),
) -> error::Result<()> {
    if let Some(job) = copy_job {
        let relative = &step.relative;
        finished(job)?
            .eq_ignore_ascii_case(&step.before)
            .then_some(())
            .ok_or_else(|| {
                EngineError::invalid_data(format!("Restore archive checksum mismatch: {relative}"))
            })?;
    }
    if step.created {
        return confirm_created(step, live_job, journal);
    }
    // Нет `sha256After` - живой не проверяется вообще и будет затёрт.
    let Some(installed) = step.installed.as_deref() else {
        return Ok(());
    };
    let live_hash = live_job.map(finished).transpose()?;
    match live_hash.as_deref() {
        None => step.note(journal, Note::NoLive),
        Some(hash) if hash.eq_ignore_ascii_case(&step.before) => {
            step.note(journal, Note::AsInPoint);
            step.fate = Fate::Keep;
        }
        Some(hash) if hash.eq_ignore_ascii_case(installed) => {}
        Some(_) => return Err(step.changed_since_install()),
    }
    Ok(())
}

/// Отпечатки считаются параллельно (потоки наследуют потолок чтения), затем
/// записи сверяются по порядку описи.
fn verify_fingerprints(steps: &mut [Step], journal: &mut dyn FnMut(String)) -> error::Result<()> {
    let pace = read_pace::current();
    thread::scope(|scope| {
        let mut jobs = Vec::with_capacity(steps.len());
        for step in steps.iter() {
            jobs.push(launch_hashes(scope, &pace, step));
        }
        for (step, pair) in steps.iter_mut().zip(jobs) {
            check_step(step, pair, journal)?;
        }
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Подготовка и подмена
// ---------------------------------------------------------------------------

/// Рядом с каждым неготовым живым архивом появляется `….astral-restore`.
/// Затем сверка «размер + время»: живой за это время не должен измениться.
fn stage_copies(
    steps: &[Step],
    progress: &progress::Progress,
    leftovers: &mut Leftovers,
) -> error::Result<()> {
    let pending: Vec<&Step> = steps
        .iter()
        .filter(|step| matches!(step.fate, Fate::Replace))
        .collect();
    let volume = pending
        .iter()
        .try_fold(0u64, |sum, step| {
            Ok::<_, io::Error>(sum + fs::metadata(&step.copy)?.len())
        })?
        .max(1);
    progress.report_bytes(PHASE_PREPARE, 0, volume);

    let mut counted = 0u64;
    for step in pending {
        leftovers
            .0
            .push(step.stage(progress, &mut counted, volume)?);
    }

    match acting(steps).find(|step| !step.untouched()) {
        None => Ok(()),
        Some(Step { relative, .. }) => Err(EngineError::invalid_operation(format!(
            "{relative} изменился, пока готовился откат: его трогал другой процесс. \
             Ничего не подменено — повторите откат."
        ))),
    }
}

/// Уже подменённые архивы возвращаются переименованием `….astral-current`
/// обратно; те, что вернуть не удалось, перечисляются в сообщении ошибки.
fn roll_back(swapped: &[(&Step, Parking)], mut error: EngineError) -> EngineError {
    let stuck = swapped
        .iter()
        .filter_map(|(step, parking)| {
            let cause = step.give_back(parking).err()?;
            let relative = &step.relative;
            Some(format!("{relative}: {cause}"))
        })
        .collect::<Vec<_>>();
    if !stuck.is_empty() {
        error.message.push_str(&format!(
            " Прежние архивы не вернулись на место, они лежат рядом с суффиксом .{CURRENT_SUFFIX}: {}",
            stuck.join("; ")
        ));
    }
    error
}

/// Копии точки встают на место живых архивов по одной, в порядке описи;
/// созданные установкой архивы убираются в том же порядке.
fn swap_in_all(steps: &[Step], progress: &progress::Progress) -> error::Result<()> {
    progress.report(PHASE_COMMIT);
    let mut swapped = Vec::new();
    for step in acting(steps) {
        match step.swap() {
            Err(error) => return Err(roll_back(&swapped, error)),
            Ok(parking) => swapped.push((step, parking)),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{archives::sha256_hex, args::Options, error::Result, progress::Progress};
    use points::BackupItem;
    use std::{
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };
    use tempfile::{tempdir, TempDir};

    const ID: &str = "rpf-20261104-120000-aaaaaaaaaaaaaaaaaa";
    const UPDATE: &str = "update/update.rpf";
    const COMMON: &str = "common.rpf";

    // ----- стенд -----

    fn original(relative: &str) -> String {
        format!("BEFORE {relative}")
    }

    fn installed(relative: &str) -> String {
        format!("AFTER {relative}")
    }

    fn sha_upper(text: &str) -> String {
        sha256_hex(text.as_bytes()).to_uppercase()
    }

    fn put(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// Игра после установки и точка с копиями «до» и описью.
    struct Scene {
        _dir: TempDir,
        game: PathBuf,
        points: PathBuf,
        point: PathBuf,
    }

    impl Scene {
        fn new(relatives: &[&str]) -> Scene {
            let dir = tempdir().unwrap();
            let game = dir.path().join("game");
            let points = dir.path().join("points");
            let point = points.join(ID);
            put(&game.join("GTA5.exe"), "");
            let mut items = Vec::new();
            for relative in relatives {
                let live = game.join(relative);
                put(&live, &installed(relative));
                let copy = points::backup_path(&point, relative);
                put(&copy, &original(relative));
                items.push(BackupItem {
                    relative_path: (*relative).to_owned(),
                    live_path: live,
                    backup_path: copy,
                    sha256_before: sha_upper(&original(relative)),
                    sha256_after: sha_upper(&installed(relative)),
                });
            }
            fs::create_dir_all(&point).unwrap();
            points::write_manifest(&point, ID, &game, Path::new("C:\\patch"), &items).unwrap();
            Scene {
                _dir: dir,
                game,
                points,
                point,
            }
        }

        fn live(&self, relative: &str) -> PathBuf {
            self.game.join(relative)
        }

        fn copy(&self, relative: &str) -> PathBuf {
            points::backup_path(&self.point, relative)
        }

        /// Правка описи точки как JSON-документа.
        fn edit(&self, change: impl FnOnce(&mut Value)) {
            let file = self.point.join(MANIFEST_FILE);
            let mut document: Value =
                serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
            change(&mut document);
            fs::write(&file, serde_json::to_string_pretty(&document).unwrap()).unwrap();
        }

        /// Опись заменена текстом целиком.
        fn raw_manifest(&self, text: &str) {
            fs::create_dir_all(&self.point).unwrap();
            fs::write(self.point.join(MANIFEST_FILE), text).unwrap();
        }

        fn content_of(&self, relative: &str) -> String {
            fs::read_to_string(self.live(relative)).unwrap_or_else(|_| "<нет>".to_owned())
        }

        /// Файлы возле живых архивов с `.astral-` в имени.
        fn leftovers(&self) -> Vec<String> {
            fn visit(base: &Path, dir: &Path, found: &mut Vec<String>) {
                for entry in fs::read_dir(dir).unwrap().flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        visit(base, &path, found);
                    } else if path.to_string_lossy().contains(".astral-") {
                        let relative = path.strip_prefix(base).unwrap();
                        found.push(relative.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
            let mut found = Vec::new();
            visit(&self.game, &self.game, &mut found);
            found.sort();
            found
        }

        fn run(&self) -> Run {
            let ledger: Arc<Mutex<Vec<String>>> = Arc::default();
            let sink = Arc::clone(&ledger);
            let progress =
                Progress::with_sink(move |line| sink.lock().unwrap().push(line.to_owned()));
            let mut journal = Vec::new();
            let outcome =
                restore_journaled(ID, &self.points, &progress, &mut |line| journal.push(line));
            let progress = ledger.lock().unwrap().clone();
            Run {
                outcome,
                progress,
                journal,
            }
        }
    }

    struct Run {
        outcome: Result<Value>,
        progress: Vec<String>,
        journal: Vec<String>,
    }

    impl Run {
        fn answer(&self) -> String {
            match &self.outcome {
                Ok(value) => value.to_string(),
                Err(error) => panic!("откат не вышел: {error}"),
            }
        }

        fn refusal(&self) -> (&str, &str) {
            match &self.outcome {
                Ok(value) => panic!("ожидался отказ, пришло {value}"),
                Err(error) => (error.code.as_str(), error.message.as_str()),
            }
        }
    }

    fn phase(name: &str, done: u64, total: u64) -> String {
        format!(r#"{{"progress":{{"phase":"{name}","copiedBytes":{done},"totalBytes":{total}}}}}"#)
    }

    /// Ход успешного отката: `prepare 0/0` первой и `commit 0/0` последней,
    /// между ними только строки стадии `prepare` (прореживание зависит от часов).
    fn assert_usual_progress(lines: &[String]) {
        assert_eq!(lines.first().unwrap(), &phase("prepare", 0, 0));
        assert_eq!(lines.last().unwrap(), &phase("commit", 0, 0));
        assert!(lines[1..lines.len() - 1]
            .iter()
            .all(|line| line.contains(r#""phase":"prepare""#)));
    }

    fn answer_text(scene: &Scene, archives: &[&str]) -> String {
        json!({
            "id": ID,
            "gameRoot": scene.game.to_string_lossy(),
            "archives": archives,
        })
        .to_string()
    }

    fn options(args: &[&str]) -> Options {
        let owned: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        Options::parse(&owned).unwrap()
    }

    // ----- успех, повтор (Отк1-Отк4) -----

    #[test]
    fn a_restore_puts_the_archives_back_and_removes_the_point() {
        let scene = Scene::new(&[UPDATE]);
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[UPDATE]));
        assert_usual_progress(&run.progress);
        assert!(run.journal.is_empty());
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(scene.leftovers().is_empty());
        assert!(!scene.point.exists());

        // Отк2: точка убрана - второй раз откатить нельзя
        let again = scene.run();
        assert_eq!(
            again.refusal(),
            (
                "FileNotFoundException",
                "Restore point manifest was not found."
            )
        );
    }

    #[test]
    fn two_archives_come_back_in_the_order_of_the_manifest() {
        // Отк3: в ответе порядок описи
        let scene = Scene::new(&[COMMON, UPDATE]);
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[COMMON, UPDATE]));
        for relative in [COMMON, UPDATE] {
            assert_eq!(scene.content_of(relative), original(relative));
        }
        assert!(scene.leftovers().is_empty() && !scene.point.exists());
    }

    // ----- аргументы и идентификатор (Отк5-Отк15, Отк59-Отк61) -----

    #[test]
    fn a_bad_identifier_is_refused_before_the_disk_is_read() {
        let scene = Scene::new(&[UPDATE]);
        let long = "a".repeat(81);
        for bad in ["../x", "", "a b", long.as_str(), "a/b", "a.b"] {
            let outcome = restore_in(bad, &scene.points, &Progress::silent());
            let error = outcome.unwrap_err();
            assert_eq!(
                (error.code.as_str(), error.message.as_str()),
                ("ArgumentException", "Invalid restore point identifier."),
                "{bad:?}"
            );
        }
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
    }

    #[test]
    fn the_command_checks_its_arguments_in_the_documented_order() {
        let scene = Scene::new(&[UPDATE]);
        let command = |args: &[&str]| {
            let error = restore_rpf_point(&options(args), &Progress::silent()).unwrap_err();
            (error.code, error.message)
        };
        let argument = |message: &str| ("ArgumentException".to_owned(), message.to_owned());
        let root = scene.points.to_string_lossy().into_owned();

        // Отк11: нет --restore-point
        assert_eq!(
            command(&["--restore-points-root", &root]),
            argument("--restore-point is required.")
        );
        // Отк12: относительный корень при годном идентификаторе
        assert_eq!(
            command(&[
                "--restore-point",
                ID,
                "--restore-points-root",
                "relative\\points"
            ]),
            argument("--restore-points-root must be an absolute path.")
        );
        // Отк13: нет --restore-point и корень относительный: побеждает отсутствие параметра
        assert_eq!(
            command(&["--restore-points-root", "relative\\points"]),
            argument("--restore-point is required.")
        );
        // Отк14: плохой идентификатор и относительный корень: побеждает отказ корня
        assert_eq!(
            command(&[
                "--restore-point",
                "../x",
                "--restore-points-root",
                "relative\\points"
            ]),
            argument("--restore-points-root must be an absolute path.")
        );
        // Отк5: плохой идентификатор при годном корне
        assert_eq!(
            command(&["--restore-point", "../x", "--restore-points-root", &root]),
            argument("Invalid restore point identifier.")
        );
    }

    #[test]
    fn the_command_restores_from_the_folder_it_is_given_and_from_the_stand_variable() {
        // Отк1 и Отк59 через команду
        let scene = Scene::new(&[UPDATE]);
        let root = scene.points.to_string_lossy().into_owned();
        let answer = restore_rpf_point(
            &options(&["--restore-point", ID, "--restore-points-root", &root]),
            &Progress::silent(),
        )
        .unwrap();
        assert_eq!(answer.to_string(), answer_text(&scene, &[UPDATE]));
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));

        // Отк15 и Отк61: без параметра корень берётся из переменной стенда
        let scene = Scene::new(&[UPDATE]);
        let _locked = crate::test_support::env_lock();
        let before = std::env::var_os(points::ROOT_ENV);
        std::env::set_var(points::ROOT_ENV, &scene.points);
        let by_variable =
            restore_rpf_point(&options(&["--restore-point", ID]), &Progress::silent());
        let unknown = restore_rpf_point(&options(&["--restore-point", "x"]), &Progress::silent());
        match before {
            Some(value) => std::env::set_var(points::ROOT_ENV, value),
            None => std::env::remove_var(points::ROOT_ENV),
        }
        assert_eq!(
            by_variable.unwrap().to_string(),
            answer_text(&scene, &[UPDATE])
        );
        assert_eq!(
            unknown.unwrap_err().message,
            "Restore point manifest was not found."
        );
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
    }

    // ----- опись (Отк16-Отк28) -----

    #[test]
    fn a_missing_or_broken_manifest_is_refused() {
        let scene = Scene::new(&[UPDATE]);
        // Отк16: точки с таким именем нет
        let missing = restore_in("rpf-other", &scene.points, &Progress::silent());
        assert_eq!(
            missing.unwrap_err().message,
            "Restore point manifest was not found."
        );
        // Отк17: restore.json - каталог
        fs::remove_file(scene.point.join(MANIFEST_FILE)).unwrap();
        fs::create_dir(scene.point.join(MANIFEST_FILE)).unwrap();
        assert_eq!(
            scene.run().refusal(),
            (
                "FileNotFoundException",
                "Restore point manifest was not found."
            )
        );
        fs::remove_dir(scene.point.join(MANIFEST_FILE)).unwrap();
        // Отк18-Отк19
        for broken in ["{oops", "[]"] {
            scene.raw_manifest(broken);
            assert_eq!(
                scene.run().refusal(),
                ("InvalidDataException", "Restore point manifest is invalid.")
            );
        }
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
    }

    #[test]
    fn the_game_folder_and_the_archive_list_of_the_manifest_are_checked() {
        let scene = Scene::new(&[UPDATE]);
        let game = scene.game.to_string_lossy().replace('\\', "\\\\");
        // Отк20: gameRoot нет - пустой путь
        scene.raw_manifest(r#"{"archives":[]}"#);
        assert_eq!(
            scene.run().refusal(),
            ("ArgumentException", "The path is empty.")
        );
        // Отк21: папки игры нет
        scene.raw_manifest(r#"{"gameRoot":"C:\\definitely\\not\\here","archives":[]}"#);
        let run = scene.run();
        assert_eq!(
            run.refusal(),
            (
                "DirectoryNotFoundException",
                "The original GTA V directory was not found."
            )
        );
        // Отк26: gameRoot - файл
        scene.raw_manifest(&format!(
            r#"{{"gameRoot":"{game}\\GTA5.exe","archives":[]}}"#
        ));
        assert_eq!(scene.run().refusal().0, "DirectoryNotFoundException");
        // Отк28: относительный gameRoot читается от рабочего каталога процесса
        scene.raw_manifest(r#"{"gameRoot":".","archives":[]}"#);
        let run = scene.run();
        assert_eq!(
            run.answer(),
            json!({
                "id": ID,
                "gameRoot": paths::full_path(".").unwrap().to_string_lossy(),
                "archives": Vec::<&str>::new(),
            })
            .to_string()
        );
    }

    #[test]
    fn a_point_without_archives_is_restored_by_removing_it() {
        // Отк22-Отк23: в описи нет ни одного архива (пустой список или нет ключа):
        // откат проходит, игра не тронута, точка убрана
        let scene = Scene::new(&[UPDATE]);
        let game = scene.game.to_string_lossy().replace('\\', "\\\\");
        for body in [r#""archives":[]"#, r#""x":1"#] {
            scene.raw_manifest(&format!(r#"{{"gameRoot":"{game}",{body}}}"#));
            let run = scene.run();
            assert_eq!(run.answer(), answer_text(&scene, &[]), "{body}");
            assert!(run.journal.is_empty());
            assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
            assert!(scene.leftovers().is_empty());
            assert!(!scene.point.exists(), "{body}");
        }
    }

    #[test]
    fn unsafe_paths_and_missing_copies_are_found_before_any_change() {
        let scene = Scene::new(&[COMMON, UPDATE]);
        let game = scene.game.to_string_lossy().replace('\\', "\\\\");
        // Отк24-Отк25
        for (entry, text) in [
            (r#"{"relativePath":"../x"}"#, "Unsafe relative path: ../x"),
            ("{}", "Unsafe relative path: "),
        ] {
            scene.raw_manifest(&format!(r#"{{"gameRoot":"{game}","archives":[{entry}]}}"#));
            let run = scene.run();
            assert_eq!(run.refusal(), ("InvalidDataException", text));
            assert_eq!(run.progress, [phase("prepare", 0, 0)]);
        }
        // Отк27: записи есть, копии в точке нет
        scene.raw_manifest(&format!(
            r#"{{"gameRoot":"{game}","archives":[{{"relativePath":"ghost.rpf"}}]}}"#
        ));
        let run = scene.run();
        assert_eq!(
            run.refusal(),
            (
                "FileNotFoundException",
                "Restore archive is missing: ghost.rpf"
            )
        );
        assert_eq!(run.progress, [phase("prepare", 0, 0)]);
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
    }

    // ----- отпечатки (Отк29-Отк34) -----

    #[test]
    fn a_copy_that_does_not_match_the_manifest_is_refused_and_nothing_changes() {
        let mismatch = (
            "InvalidDataException",
            "Restore archive checksum mismatch: update/update.rpf",
        );
        // Отк29: копия точки изменена
        let scene = Scene::new(&[COMMON, UPDATE]);
        fs::write(scene.copy(UPDATE), "TAMPERED").unwrap();
        let run = scene.run();
        assert_eq!(run.refusal(), mismatch);
        assert_eq!(run.progress, [phase("prepare", 0, 0)]);
        for relative in [COMMON, UPDATE] {
            assert_eq!(scene.content_of(relative), installed(relative));
        }
        assert!(scene.point.exists() && scene.leftovers().is_empty());

        // Отк30: sha256Before в описи неверный
        let scene = Scene::new(&[UPDATE]);
        scene.edit(|document| document["archives"][0]["sha256Before"] = json!("ABCDEF"));
        assert_eq!(scene.run().refusal(), mismatch);
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));

        // Отк31: хэши строчными буквами
        let scene = Scene::new(&[UPDATE]);
        scene.edit(|document| {
            for key in ["sha256Before", "sha256After"] {
                let lower = document["archives"][0][key]
                    .as_str()
                    .unwrap()
                    .to_lowercase();
                document["archives"][0][key] = json!(lower);
            }
        });
        scene.run().answer();
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
    }

    #[test]
    fn a_live_archive_changed_after_the_install_is_never_overwritten() {
        // Отк32
        let scene = Scene::new(&[UPDATE]);
        fs::remove_file(scene.live(UPDATE)).unwrap();
        put(&scene.live(UPDATE), "ANOTHER MOD");
        let run = scene.run();
        assert_eq!(
            run.refusal(),
            (
                "InvalidOperationException",
                "update/update.rpf изменился после этой установки: в него ставили другие моды или игра обновилась. Откат вернул бы прежний архив и молча стёр бы эти изменения. Сначала откатите то, что ставили позже, а если обновлялась сама GTA V — проверьте файлы игры в Steam."
            )
        );
        assert_eq!(run.progress, [phase("prepare", 0, 0)]);
        assert_eq!(scene.content_of(UPDATE), "ANOTHER MOD");
        assert!(scene.point.exists() && scene.leftovers().is_empty());
    }

    #[test]
    fn without_the_installed_hash_the_live_archive_is_not_looked_at() {
        // Отк33-Отк34: нет sha256After или он из пробелов - чужие изменения затираются молча
        for removed in [true, false] {
            let scene = Scene::new(&[UPDATE]);
            fs::remove_file(scene.live(UPDATE)).unwrap();
            put(&scene.live(UPDATE), "ANOTHER MOD");
            scene.edit(|document| {
                let entry = document["archives"][0].as_object_mut().unwrap();
                if removed {
                    entry.remove("sha256After");
                } else {
                    entry.insert("sha256After".to_owned(), json!("   "));
                }
            });
            let run = scene.run();
            run.answer();
            assert!(run.journal.is_empty());
            assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        }
    }

    // ----- прерванный откат, чужие остатки (Отк35-Отк40) -----

    #[test]
    fn an_archive_that_already_equals_its_copy_is_skipped_but_still_listed() {
        // Отк35
        let scene = Scene::new(&[COMMON, UPDATE]);
        fs::remove_file(scene.live(COMMON)).unwrap();
        put(&scene.live(COMMON), &original(COMMON));
        // второе имя того же файла: по нему видно, тронули ли живой файл
        let alias = scene.game.join("alias-of-common");
        fs::hard_link(scene.live(COMMON), &alias).unwrap();
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[COMMON, UPDATE]));
        assert_eq!(
            run.journal,
            ["[Restore] common.rpf: уже как в точке, пропускаю"]
        );
        assert_usual_progress(&run.progress);
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(scene.leftovers().is_empty() && !scene.point.exists());
        // пропущенный архив остался тем же файлом: запись через второе имя видна в нём
        fs::write(&alias, "MARK").unwrap();
        assert_eq!(scene.content_of(COMMON), "MARK");

        // Отк36: оба уже как в точке - копирования нет, точка убирается
        let scene = Scene::new(&[COMMON, UPDATE]);
        for relative in [COMMON, UPDATE] {
            fs::remove_file(scene.live(relative)).unwrap();
            put(&scene.live(relative), &original(relative));
        }
        let run = scene.run();
        run.answer();
        assert_eq!(
            run.journal,
            [
                "[Restore] common.rpf: уже как в точке, пропускаю",
                "[Restore] update/update.rpf: уже как в точке, пропускаю"
            ]
        );
        assert!(!scene.point.exists());
    }

    #[test]
    fn a_missing_live_archive_gets_the_point_copy() {
        // Отк37
        let scene = Scene::new(&[UPDATE]);
        fs::remove_file(scene.live(UPDATE)).unwrap();
        let run = scene.run();
        run.answer();
        assert_eq!(
            run.journal,
            ["[Restore] update/update.rpf: живого архива нет, ставлю копию точки"]
        );
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(scene.leftovers().is_empty() && !scene.point.exists());
    }

    #[test]
    fn only_the_game_root_and_three_fields_of_each_entry_are_read() {
        // Отк38
        let scene = Scene::new(&[UPDATE]);
        scene.edit(|document| {
            document["schemaVersion"] = json!("broken");
            document["patch"] = json!(7);
            let entry = &mut document["archives"][0];
            entry["livePath"] = json!("Z:\\nowhere");
            entry["backupPath"] = json!(["not", "a", "path"]);
        });
        scene.run().answer();
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
    }

    #[test]
    fn old_leftovers_next_to_the_archive_are_overwritten_and_removed() {
        // Отк39
        let scene = Scene::new(&[UPDATE]);
        put(
            &scene.live("update/update.rpf.astral-restore"),
            "OLD RESTORE",
        );
        put(
            &scene.live("update/update.rpf.astral-current"),
            "OLD CURRENT",
        );
        scene.run().answer();
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(scene.leftovers().is_empty());
        assert!(!scene.point.exists());
    }

    #[test]
    fn a_readonly_live_archive_does_not_stop_the_restore_and_the_flag_stays() {
        // Отк40
        let scene = Scene::new(&[UPDATE]);
        points::mark_readonly(&scene.live(UPDATE)).unwrap();
        scene.run().answer();
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(fs::metadata(scene.live(UPDATE))
            .unwrap()
            .permissions()
            .readonly());
        points::clear_readonly(&scene.live(UPDATE)).unwrap();
    }

    // ----- точки с «созданным» архивом (Отк41, Отк57-Отк58) -----

    const DLC: &str = "dlc/dlc.rpf";
    const FOREIGN_TEXT: &str = "dlc/dlc.rpf изменился после этой установки: в него ставили другие моды или игра обновилась. Откат вернул бы прежний архив и молча стёр бы эти изменения. Сначала откатите то, что ставили позже, а если обновлялась сама GTA V — проверьте файлы игры в Steam.";

    /// Запись описи об архиве, которого до установки не было (sha256Before пустой, копии нет).
    fn created_entry(relative: &str, installed_text: Option<&str>) -> Value {
        let mut entry = json!({
            "relativePath": relative,
            "livePath": "x",
            "backupPath": "y",
            "sha256Before": "",
        });
        if let Some(text) = installed_text {
            entry["sha256After"] = json!(sha_upper(text));
        }
        entry
    }

    #[test]
    fn a_point_with_an_archive_created_by_the_install_removes_that_archive() {
        // Отк41: опись «до: отсутствовал» - откат убирает созданный установкой архив,
        // остальные записи откатываются как обычно
        let scene = Scene::new(&[UPDATE]);
        put(&scene.live(DLC), "CREATED");
        scene.edit(|document| {
            let created = created_entry(DLC, Some("CREATED"));
            document["archives"].as_array_mut().unwrap().push(created);
        });
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[UPDATE, DLC]));
        assert_usual_progress(&run.progress);
        assert_eq!(
            run.journal,
            ["[Restore] dlc/dlc.rpf: архив создала установка, убираю"]
        );
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(!scene.live(DLC).exists());
        assert!(scene.leftovers().is_empty());
        assert!(!scene.point.exists());
    }

    #[test]
    fn a_point_of_one_created_archive_is_restored_by_removing_it() {
        let scene = Scene::new(&[UPDATE]);
        scene.edit(|document| {
            document["archives"] = json!([created_entry(DLC, Some("CREATED"))]);
        });
        put(&scene.live(DLC), "CREATED");
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[DLC]));
        assert!(!scene.live(DLC).exists());
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
        assert!(scene.leftovers().is_empty() && !scene.point.exists());
    }

    #[test]
    fn a_created_archive_that_is_already_gone_counts_as_restored() {
        let scene = Scene::new(&[UPDATE]);
        scene.edit(|document| {
            let created = created_entry(DLC, Some("CREATED"));
            document["archives"].as_array_mut().unwrap().push(created);
        });
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[UPDATE, DLC]));
        assert_eq!(
            run.journal,
            ["[Restore] dlc/dlc.rpf: архива уже нет, откатывать нечего"]
        );
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(!scene.live(DLC).exists());
        assert!(scene.leftovers().is_empty() && !scene.point.exists());
    }

    #[test]
    fn a_created_archive_changed_after_the_install_is_refused_and_nothing_moves() {
        let scene = Scene::new(&[UPDATE]);
        put(&scene.live(DLC), "ANOTHER MOD");
        scene.edit(|document| {
            let created = created_entry(DLC, Some("CREATED"));
            document["archives"].as_array_mut().unwrap().push(created);
        });
        let run = scene.run();
        assert_eq!(run.refusal(), ("InvalidOperationException", FOREIGN_TEXT));
        assert_eq!(run.progress, [phase("prepare", 0, 0)]);
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
        assert_eq!(scene.content_of(DLC), "ANOTHER MOD");
        assert!(scene.point.exists() && scene.leftovers().is_empty());
    }

    #[test]
    fn an_entry_without_any_hash_is_not_taken_for_a_created_archive() {
        // нечем подтвердить, что файл поставила установка: запись разбирается
        // как прежде (копии нет), файл не трогается
        let scene = Scene::new(&[UPDATE]);
        put(&scene.live(DLC), "CREATED");
        scene.edit(|document| {
            let created = created_entry(DLC, None);
            document["archives"].as_array_mut().unwrap().push(created);
        });
        let run = scene.run();
        assert_eq!(
            run.refusal(),
            (
                "FileNotFoundException",
                "Restore archive is missing: dlc/dlc.rpf"
            )
        );
        assert_eq!(scene.content_of(DLC), "CREATED");
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
        assert!(scene.point.exists());

        // пустой отпечаток «до» при настоящей копии в точке - тоже не «созданный»
        let scene = Scene::new(&[UPDATE]);
        scene.edit(|document| document["archives"][0]["sha256Before"] = json!(""));
        let run = scene.run();
        assert_eq!(
            run.refusal(),
            (
                "InvalidDataException",
                "Restore archive checksum mismatch: update/update.rpf"
            )
        );
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
    }

    #[cfg(windows)]
    #[test]
    fn a_failed_swap_brings_the_removed_created_archive_back_and_keeps_the_point() {
        use std::os::windows::fs::OpenOptionsExt;
        // созданный архив идёт первым и уже убран, когда подмена второго отказывает
        let scene = Scene::new(&[UPDATE]);
        put(&scene.live(DLC), "CREATED");
        scene.edit(|document| {
            let created = created_entry(DLC, Some("CREATED"));
            document["archives"]
                .as_array_mut()
                .unwrap()
                .insert(0, created);
        });
        let hold = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(scene.live(UPDATE))
            .unwrap();
        let run = scene.run();
        drop(hold);
        let (code, message) = run.refusal();
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"), "{message}");
        assert_eq!(scene.content_of(DLC), "CREATED");
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
        assert!(scene.leftovers().is_empty());
        assert!(scene.point.join(MANIFEST_FILE).is_file());
    }

    // ----- папки, созданные установкой (createdDirectories) -----

    const GONE_LINE: &str = "пустая папка, созданная установкой, убрана";

    fn with_created_dirs(scene: &Scene, dirs: &[&str]) {
        scene.edit(|document| document["createdDirectories"] = json!(dirs));
    }

    #[test]
    fn empty_folders_the_install_created_are_removed_after_the_archives_deepest_first() {
        let scene = Scene::new(&[UPDATE]);
        let pack = "dlc/pack/dlc.rpf";
        put(&scene.live(pack), "CREATED");
        fs::create_dir_all(scene.live("dlc/pack/inner")).unwrap();
        fs::create_dir_all(scene.live("kept")).unwrap();
        scene.edit(|document| {
            let created = created_entry(pack, Some("CREATED"));
            document["archives"].as_array_mut().unwrap().push(created);
        });
        // записано от внешней к внутренней; «kept» в опись не попала
        with_created_dirs(&scene, &["dlc", "dlc/pack", "dlc/pack/inner"]);
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[UPDATE, pack]));
        assert_eq!(
            run.journal,
            [
                "[Restore] dlc/pack/dlc.rpf: архив создала установка, убираю".to_owned(),
                format!("[Restore] dlc/pack/inner: {GONE_LINE}"),
                format!("[Restore] dlc/pack: {GONE_LINE}"),
                format!("[Restore] dlc: {GONE_LINE}"),
            ]
        );
        assert!(!scene.live("dlc").exists());
        assert!(scene.live("kept").is_dir());
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(scene.leftovers().is_empty() && !scene.point.exists());
    }

    #[test]
    fn a_folder_with_something_in_it_a_missing_one_and_a_listed_game_folder_are_left_alone() {
        let scene = Scene::new(&[UPDATE]);
        fs::create_dir_all(scene.live("dlc/pack")).unwrap();
        put(&scene.live("dlc/pack/other.txt"), "mine");
        // порядок в описи не важен: убирается от глубокой к верхней; «update» (папка
        // с архивом) непуста и остаётся, «ghost» уже нет
        with_created_dirs(&scene, &["dlc", "ghost", "update", "dlc/pack"]);
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[UPDATE]));
        assert!(run.journal.is_empty(), "{:?}", run.journal);
        assert_eq!(
            fs::read_to_string(scene.live("dlc/pack/other.txt")).unwrap(),
            "mine"
        );
        assert!(scene.live("update").is_dir());
        assert!(!scene.point.exists());
    }

    #[test]
    fn a_created_folder_with_a_foreign_file_keeps_its_empty_parents_too() {
        let scene = Scene::new(&[UPDATE]);
        fs::create_dir_all(scene.live("dlc/pack/inner")).unwrap();
        put(&scene.live("dlc/pack/inner/other.txt"), "mine");
        with_created_dirs(&scene, &["dlc", "dlc/pack", "dlc/pack/inner"]);
        let run = scene.run();
        run.answer();
        assert!(run.journal.is_empty());
        assert!(scene.live("dlc/pack/inner/other.txt").is_file());
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
    }

    #[test]
    fn an_unsafe_created_folder_path_is_refused_before_any_change_like_an_archive_path() {
        for bad in ["../x", "C:\\x", "", "a/../b"] {
            let scene = Scene::new(&[UPDATE]);
            with_created_dirs(&scene, &["dlc", bad]);
            fs::create_dir_all(scene.live("dlc")).unwrap();
            let run = scene.run();
            assert_eq!(
                run.refusal(),
                (
                    "InvalidDataException",
                    format!("Unsafe relative path: {bad}").as_str()
                ),
                "{bad:?}"
            );
            assert_eq!(run.progress, [phase("prepare", 0, 0)]);
            assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
            assert!(scene.live("dlc").is_dir() && scene.point.exists());
        }
    }

    #[test]
    fn a_manifest_without_the_key_or_with_a_wrong_value_restores_as_before() {
        for value in [
            json!(null),
            json!("dlc"),
            json!({ "a": 1 }),
            json!([5, null, true]),
        ] {
            let scene = Scene::new(&[UPDATE]);
            fs::create_dir_all(scene.live("dlc")).unwrap();
            scene.edit(|document| document["createdDirectories"] = value.clone());
            let run = scene.run();
            assert_eq!(run.answer(), answer_text(&scene, &[UPDATE]), "{value}");
            assert!(run.journal.is_empty());
            assert!(scene.live("dlc").is_dir());
        }
    }

    // ----- файлы, созданные установкой (createdFiles, проект редуксов R1) -----

    const DLC_FILE: &str = "update/x64/dlcpacks/astral_redux_ab12cd34/dlc.rpf";
    const DLC_FOLDER: &str = "update/x64/dlcpacks/astral_redux_ab12cd34";
    const DLC_BODY: &str = "redux dlc body 0123456789";
    const OTHER_FILE: &str = "update/x64/dlcpacks/astral_redux_ef56ab78/dlc.rpf";
    const OTHER_BODY: &str = "second redux dlc body";

    fn created_file_row(path: &str, body: &str) -> Value {
        json!({ "path": path, "bytes": body.len(), "sha256": sha_upper(body) })
    }

    /// Файлы лежат в игре, опись точки называет их созданными.
    fn with_created_files(scene: &Scene, files: &[(&str, &str)]) {
        for (path, body) in files {
            put(&scene.live(path), body);
        }
        scene.edit(|document| {
            let listed = files
                .iter()
                .map(|(path, body)| created_file_row(path, body));
            document["createdFiles"] = Value::Array(listed.collect());
        });
    }

    fn answer_of(run: &Run) -> Value {
        match &run.outcome {
            Ok(value) => value.clone(),
            Err(error) => panic!("откат не вышел: {error}"),
        }
    }

    #[test]
    fn a_created_file_goes_away_with_the_point_after_the_archives_are_back() {
        let scene = Scene::new(&[UPDATE]);
        with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
        scene.edit(|document| document["createdDirectories"] = json!([DLC_FOLDER]));
        let run = scene.run();
        let answer = answer_of(&run);
        assert_eq!(answer["archives"], json!([UPDATE]));
        assert_eq!(
            answer["createdFiles"],
            json!([{ "path": DLC_FILE, "released": true, "freedBytes": DLC_BODY.len() }])
        );
        assert!(!scene.live(DLC_FILE).exists());
        // пустая папка, которую создала сборка, уходит следом
        assert!(!scene.live(DLC_FOLDER).exists());
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(scene.leftovers().is_empty() && !scene.point.exists());
        assert!(run.journal.contains(&format!(
            "[Restore] {DLC_FILE}: файл создала установка, убираю"
        )));
        // повтор: точки нет
        assert_eq!(
            scene.run().refusal(),
            (
                "FileNotFoundException",
                "Restore point manifest was not found."
            )
        );
    }

    #[test]
    fn a_manifest_without_the_key_restores_as_before_and_leaves_the_file_alone() {
        let scene = Scene::new(&[UPDATE]);
        put(&scene.live(DLC_FILE), DLC_BODY);
        let run = scene.run();
        assert_eq!(run.answer(), answer_text(&scene, &[UPDATE]));
        assert!(run.journal.is_empty());
        assert_eq!(scene.content_of(DLC_FILE), DLC_BODY);
    }

    #[test]
    fn two_created_files_are_both_removed() {
        let scene = Scene::new(&[UPDATE]);
        with_created_files(&scene, &[(DLC_FILE, DLC_BODY), (OTHER_FILE, OTHER_BODY)]);
        let answer = answer_of(&scene.run());
        let rows = answer["createdFiles"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row["released"] == json!(true)));
        assert!(!scene.live(DLC_FILE).exists() && !scene.live(OTHER_FILE).exists());
        assert!(!scene.point.exists());
    }

    /// Всё осталось как после установки: архив, файлы, точка.
    fn assert_untouched(scene: &Scene, files: &[(&str, &str)]) {
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
        for (path, body) in files {
            assert_eq!(scene.content_of(path), *body, "{path}");
        }
        assert!(scene.leftovers().is_empty());
        assert!(scene.point.join(MANIFEST_FILE).is_file());
    }

    #[test]
    fn a_foreign_file_in_place_of_the_dlc_is_refused_and_nothing_is_touched() {
        for foreign in [
            // та же длина, другое содержимое
            "redux dlc body 9876543210",
            // другая длина
            "short",
            "",
        ] {
            let scene = Scene::new(&[UPDATE]);
            with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
            put(&scene.live(DLC_FILE), foreign);
            let run = scene.run();
            let (code, message) = run.refusal();
            assert_eq!(code, "NotOurs", "{foreign:?}");
            assert!(message.contains(DLC_FILE), "{message}");
            // отказ раньше первого изменения: ни архив, ни файл, ни точка, ни следов
            assert!(!run.progress.iter().any(|line| line.contains("commit")));
            assert_untouched(&scene, &[(DLC_FILE, foreign)]);
        }
    }

    #[test]
    fn a_folder_in_place_of_the_dlc_is_refused_too() {
        let scene = Scene::new(&[UPDATE]);
        with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
        fs::remove_file(scene.live(DLC_FILE)).unwrap();
        fs::create_dir_all(scene.live(DLC_FILE)).unwrap();
        let run = scene.run();
        assert_eq!(run.refusal().0, "NotOurs");
        assert!(scene.live(DLC_FILE).is_dir());
        assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
        assert!(scene.point.exists());
    }

    #[test]
    fn one_foreign_file_keeps_the_good_one_in_place_too() {
        let scene = Scene::new(&[UPDATE]);
        with_created_files(&scene, &[(DLC_FILE, DLC_BODY), (OTHER_FILE, OTHER_BODY)]);
        put(&scene.live(OTHER_FILE), "someone else's file");
        let run = scene.run();
        assert_eq!(run.refusal().0, "NotOurs");
        assert_untouched(
            &scene,
            &[(DLC_FILE, DLC_BODY), (OTHER_FILE, "someone else's file")],
        );
    }

    #[test]
    fn a_file_that_is_already_gone_is_not_an_error() {
        let scene = Scene::new(&[UPDATE]);
        with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
        fs::remove_file(scene.live(DLC_FILE)).unwrap();
        let run = scene.run();
        let answer = answer_of(&run);
        assert_eq!(
            answer["createdFiles"],
            json!([{ "path": DLC_FILE, "released": false, "freedBytes": 0 }])
        );
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(!scene.point.exists());
    }

    #[test]
    fn an_unsafe_created_path_is_refused_before_any_change() {
        for bad in ["../x.rpf", "a/../b.rpf", "C:\\x.rpf", "a//b.rpf"] {
            let scene = Scene::new(&[UPDATE]);
            with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
            scene.edit(|document| {
                let listed = document["createdFiles"].as_array_mut().unwrap();
                listed.push(created_file_row(bad, "x"));
            });
            let run = scene.run();
            assert_eq!(
                run.refusal(),
                (
                    "InvalidDataException",
                    format!("Unsafe relative path: {bad}").as_str()
                ),
                "{bad:?}"
            );
            assert_untouched(&scene, &[(DLC_FILE, DLC_BODY)]);
        }
    }

    #[test]
    fn entries_the_reader_does_not_trust_are_never_removed() {
        let scene = Scene::new(&[UPDATE]);
        // файл не архив, у записи нет хэша, длина не число
        put(&scene.live("update/GTA5.exe"), "exe");
        put(&scene.live("keep1.rpf"), "one");
        put(&scene.live("keep2.rpf"), "two");
        scene.edit(|document| {
            document["createdFiles"] = json!([
                created_file_row("update/GTA5.exe", "exe"),
                { "path": "keep1.rpf", "bytes": 3 },
                { "path": "keep2.rpf", "bytes": "3", "sha256": sha_upper("two") },
            ]);
        });
        let run = scene.run();
        // ни одной записи, которой можно верить: ответ прежний
        assert_eq!(run.answer(), answer_text(&scene, &[UPDATE]));
        for kept in ["update/GTA5.exe", "keep1.rpf", "keep2.rpf"] {
            assert!(scene.live(kept).is_file(), "{kept}");
        }
    }

    #[test]
    fn a_created_file_that_is_an_archive_of_the_point_is_refused_before_any_change() {
        // откат не убирает архив, который сам откатывает: опись с таким названием негодна
        for named in [UPDATE, "UPDATE/Update.RPF"] {
            let scene = Scene::new(&[UPDATE]);
            scene.edit(|document| {
                document["createdFiles"] = json!([created_file_row(named, &installed(UPDATE))]);
            });
            let run = scene.run();
            assert_eq!(
                run.refusal(),
                ("InvalidDataException", "Restore point manifest is invalid."),
                "{named}"
            );
            assert_untouched(&scene, &[]);
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_dlc_held_by_another_process_stops_the_restore_before_any_change() {
        use std::os::windows::fs::OpenOptionsExt;
        let scene = Scene::new(&[UPDATE]);
        with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
        let hold = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(scene.live(DLC_FILE))
            .unwrap();
        let run = scene.run();
        drop(hold);
        assert!(run.outcome.is_err());
        assert_untouched(&scene, &[(DLC_FILE, DLC_BODY)]);
    }

    // ----- подготовка и подмена: отказы с откатом -----

    #[test]
    fn a_preparation_failure_removes_every_sibling_made_so_far() {
        // Р-8: второй архив не готовится (каталога его живого файла нет)
        let scene = Scene::new(&[COMMON, UPDATE]);
        put(&scene.copy("gone/deep/x.rpf"), "COPY");
        scene.edit(|document| {
            let entry = json!({
                "relativePath": "gone/deep/x.rpf",
                "sha256Before": sha_upper("COPY"),
                "sha256After": sha_upper("X"),
            });
            document["archives"].as_array_mut().unwrap().push(entry);
        });
        let run = scene.run();
        let (code, message) = run.refusal();
        assert_eq!(code, "FileNotFoundException");
        assert!(message.ends_with("(os error 3)"), "{message}");
        for relative in [COMMON, UPDATE] {
            assert_eq!(scene.content_of(relative), installed(relative));
        }
        assert!(scene.leftovers().is_empty());
        assert!(scene.point.exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_failed_swap_puts_the_swapped_archives_back_and_keeps_the_point() {
        use std::os::windows::fs::OpenOptionsExt;
        // Второй архив держит программа без разрешения на удаление: подмена
        // поверх него отказывает кодом 5 (10 с ожидания), первый возвращается.
        let scene = Scene::new(&[COMMON, UPDATE]);
        scene.edit(|document| {
            document["archives"][1]
                .as_object_mut()
                .unwrap()
                .remove("sha256After");
        });
        let hold = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(scene.live(UPDATE))
            .unwrap();
        let run = scene.run();
        drop(hold);
        let (code, message) = run.refusal();
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"), "{message}");
        for relative in [COMMON, UPDATE] {
            assert_eq!(scene.content_of(relative), installed(relative));
        }
        assert!(scene.leftovers().is_empty());
        assert!(scene.point.join(MANIFEST_FILE).is_file());
    }

    #[cfg(windows)]
    #[test]
    fn without_hard_links_the_old_file_is_moved_aside_and_the_restore_still_succeeds() {
        // Отк42: у живого файла исчерпан предел жёстких ссылок
        let scene = Scene::new(&[UPDATE]);
        let live = scene.live(UPDATE);
        let crowd = scene.game.join("crowd");
        fs::create_dir_all(&crowd).unwrap();
        let mut made = 0;
        while fs::hard_link(&live, crowd.join(format!("l{made}"))).is_ok() {
            made += 1;
        }
        assert!(made > 1000);
        let run = scene.run();
        run.answer();
        assert_eq!(scene.content_of(UPDATE), original(UPDATE));
        assert!(!scene.point.exists());
        // сами ссылки остались ссылками на установленный файл
        assert_eq!(
            fs::read_to_string(crowd.join("l0")).unwrap(),
            installed(UPDATE)
        );
        fs::remove_dir_all(&crowd).unwrap();
        assert!(scene.leftovers().is_empty());
    }

    #[test]
    fn the_stage_names_of_progress_are_prepare_and_commit() {
        let scene = Scene::new(&[COMMON, UPDATE]);
        let run = scene.run();
        run.answer();
        assert!(run.progress.len() >= 2);
        assert_eq!(run.progress[0], phase("prepare", 0, 0));
        assert_eq!(run.progress[run.progress.len() - 1], phase("commit", 0, 0));
    }

    /// Обрывы и паузы в точках остановки. Ребёнок - этот же тестовый бинарник,
    /// запущенный на одном тесте: переменные точек обрыва стоят только у него.
    /// Собирается и идёт с признаком `failpoints`.
    #[cfg(feature = "failpoints")]
    mod failpoint_runs {
        use super::*;
        use std::process::{Child, Command, Stdio};
        use std::time::{Duration, Instant};

        const CHILD_DIR: &str = "ASTRAL_TEST_RESTORE_CHILD_DIR";

        /// Сценарий ребёнка: откат точки из каталога, названного переменной.
        /// В обычном прогоне, без переменной, не делает ничего.
        #[test]
        fn child_restore() {
            let Some(root) = std::env::var_os(CHILD_DIR) else {
                return;
            };
            let root = PathBuf::from(root);
            let text = match restore_in(ID, &root.join("points"), &Progress::silent()) {
                Ok(_) => "ok".to_owned(),
                Err(error) => format!("{}|{}", error.code, error.message),
            };
            fs::write(root.join("child-result.txt"), text).unwrap();
        }

        fn start_child(scene: &Scene, extra: &[(&str, &str)]) -> Child {
            let root = scene.points.parent().unwrap();
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "archives::restore::tests::failpoint_runs::child_restore",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(CHILD_DIR, root)
                .envs(extra.iter().copied())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap()
        }

        fn wait_for(limit: Duration, condition: impl Fn() -> bool) -> bool {
            let begun = Instant::now();
            while begun.elapsed() < limit {
                if condition() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            false
        }

        /// Ребёнок убит в точке: код 137 и строка в stderr.
        fn killed_at(scene: &Scene, point: &str) {
            let child = start_child(scene, &[("ASTRAL_ENGINE_FAILPOINT", point)]);
            let output = child.wait_with_output().unwrap();
            assert_eq!(output.status.code(), Some(137));
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            assert!(stderr.contains(&format!("[failpoint] {point}")), "{stderr}");
        }

        fn child_result(scene: &Scene) -> String {
            let file = scene.points.parent().unwrap().join("child-result.txt");
            fs::read_to_string(file).unwrap_or_default()
        }

        #[test]
        fn a_restore_killed_after_the_link_leaves_everything_for_a_repeat() {
            // Отк43-Отк44
            let scene = Scene::new(&[COMMON, UPDATE]);
            killed_at(&scene, "restore-after-link");
            for relative in [COMMON, UPDATE] {
                assert_eq!(scene.content_of(relative), installed(relative));
            }
            assert_eq!(
                scene.leftovers(),
                [
                    "common.rpf.astral-current",
                    "common.rpf.astral-restore",
                    "update/update.rpf.astral-restore"
                ]
            );
            assert!(scene.point.exists());

            let run = scene.run();
            run.answer();
            for relative in [COMMON, UPDATE] {
                assert_eq!(scene.content_of(relative), original(relative));
            }
            assert!(scene.leftovers().is_empty() && !scene.point.exists());
        }

        #[test]
        fn a_restore_killed_after_the_first_swap_is_finished_by_a_repeat() {
            // Отк45-Отк46
            let scene = Scene::new(&[COMMON, UPDATE]);
            killed_at(&scene, "restore-after-swap");
            assert_eq!(scene.content_of(COMMON), original(COMMON));
            assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
            assert_eq!(
                scene.leftovers(),
                [
                    "common.rpf.astral-current",
                    "update/update.rpf.astral-restore"
                ]
            );

            let run = scene.run();
            run.answer();
            assert_eq!(
                run.journal,
                ["[Restore] common.rpf: уже как в точке, пропускаю"]
            );
            for relative in [COMMON, UPDATE] {
                assert_eq!(scene.content_of(relative), original(relative));
            }
            assert!(scene.leftovers().is_empty() && !scene.point.exists());
        }

        #[cfg(windows)]
        #[test]
        fn without_links_a_kill_leaves_no_live_archive_and_the_repeat_puts_the_copy_in() {
            // Отк47-Отк48: у живого файла исчерпан предел жёстких ссылок
            let scene = Scene::new(&[UPDATE]);
            let crowd = scene.game.join("crowd");
            fs::create_dir_all(&crowd).unwrap();
            let mut made = 0;
            while fs::hard_link(scene.live(UPDATE), crowd.join(format!("l{made}"))).is_ok() {
                made += 1;
            }
            killed_at(&scene, "restore-after-link");
            assert_eq!(scene.content_of(UPDATE), "<нет>");
            assert_eq!(
                scene.leftovers(),
                [
                    "update/update.rpf.astral-current",
                    "update/update.rpf.astral-restore"
                ]
            );
            let run = scene.run();
            run.answer();
            assert_eq!(
                run.journal,
                ["[Restore] update/update.rpf: живого архива нет, ставлю копию точки"]
            );
            assert_eq!(scene.content_of(UPDATE), original(UPDATE));
            assert!(scene.leftovers().is_empty() && !scene.point.exists());
        }

        #[test]
        fn during_a_pause_the_live_file_its_aside_copy_and_the_point_copy_all_exist() {
            // Отк49
            let scene = Scene::new(&[UPDATE]);
            let mut child = start_child(
                &scene,
                &[("ASTRAL_ENGINE_FAILPOINT_SLEEP", "restore-after-link=2500")],
            );
            let aside = scene.live("update/update.rpf.astral-current");
            assert!(wait_for(Duration::from_secs(60), || aside.exists()));
            assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
            assert_eq!(
                scene.leftovers(),
                [
                    "update/update.rpf.astral-current",
                    "update/update.rpf.astral-restore"
                ]
            );
            assert!(scene.point.exists());
            assert!(child.wait().unwrap().success());
            assert_eq!(child_result(&scene), "ok");
            assert_eq!(scene.content_of(UPDATE), original(UPDATE));
            assert!(scene.leftovers().is_empty() && !scene.point.exists());
        }

        #[test]
        fn a_second_archive_that_fails_to_swap_sends_the_first_back() {
            // Отк50: во время паузы после первой подмены готовая копия второго удалена
            let scene = Scene::new(&[COMMON, UPDATE]);
            let mut child = start_child(
                &scene,
                &[("ASTRAL_ENGINE_FAILPOINT_SLEEP", "restore-after-swap=2500")],
            );
            // первый архив подменён, ребёнок стоит в паузе после подмены
            let swapped = || scene.content_of(COMMON) == original(COMMON);
            assert!(wait_for(Duration::from_secs(60), swapped));
            assert_eq!(scene.content_of(COMMON), original(COMMON));
            fs::remove_file(scene.live("update/update.rpf.astral-restore")).unwrap();
            assert!(child.wait().unwrap().success());

            let result = child_result(&scene);
            assert!(result.starts_with("FileNotFoundException|"), "{result}");
            assert!(result.ends_with("(os error 2)"), "{result}");
            for relative in [COMMON, UPDATE] {
                assert_eq!(scene.content_of(relative), installed(relative));
            }
            assert!(scene.leftovers().is_empty());
            assert!(scene.point.join(MANIFEST_FILE).is_file());
        }

        #[cfg(windows)]
        #[test]
        fn when_the_return_fails_too_the_message_names_the_files_left_aside() {
            use std::os::windows::fs::OpenOptionsExt;
            // Отк51: первый архив (уже прежний) занят другим процессом, вернуть установленный не удаётся
            let scene = Scene::new(&[COMMON, UPDATE]);
            let mut child = start_child(
                &scene,
                &[("ASTRAL_ENGINE_FAILPOINT_SLEEP", "restore-after-swap=2500")],
            );
            let swapped = || scene.content_of(COMMON) == original(COMMON);
            assert!(wait_for(Duration::from_secs(60), swapped));
            let hold = fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(scene.live(COMMON))
                .unwrap();
            fs::remove_file(scene.live("update/update.rpf.astral-restore")).unwrap();
            assert!(child.wait().unwrap().success());
            drop(hold);

            let result = child_result(&scene);
            assert!(result.starts_with("FileNotFoundException|"), "{result}");
            let (_, message) = result.split_once('|').unwrap();
            let tail = " Прежние архивы не вернулись на место, они лежат рядом с суффиксом .astral-current: common.rpf: ";
            assert!(message.contains(tail), "{message}");
            assert!(message.ends_with("(os error 5)"), "{message}");
            assert_eq!(scene.content_of(COMMON), original(COMMON));
            assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
            assert_eq!(scene.leftovers(), ["common.rpf.astral-current"]);
            assert!(scene.point.exists());
        }

        #[test]
        fn a_restore_killed_before_the_created_file_goes_leaves_it_for_the_repeat() {
            // файл убирается после всех подмен: слой с его регистрацией к тому времени снят
            let scene = Scene::new(&[COMMON, UPDATE]);
            with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
            killed_at(&scene, "restore-after-swap");
            assert_eq!(scene.content_of(COMMON), original(COMMON));
            assert_eq!(scene.content_of(UPDATE), installed(UPDATE));
            assert_eq!(scene.content_of(DLC_FILE), DLC_BODY);
            assert!(scene.point.exists());

            let answer = answer_of(&scene.run());
            assert_eq!(answer["createdFiles"][0]["released"], json!(true));
            assert!(!scene.live(DLC_FILE).exists());
            for relative in [COMMON, UPDATE] {
                assert_eq!(scene.content_of(relative), original(relative));
            }
            assert!(scene.leftovers().is_empty() && !scene.point.exists());
        }

        #[test]
        fn a_restore_killed_after_the_created_file_is_gone_is_finished_by_a_repeat() {
            let scene = Scene::new(&[UPDATE]);
            with_created_files(&scene, &[(DLC_FILE, DLC_BODY)]);
            scene.edit(|document| document["createdDirectories"] = json!([DLC_FOLDER]));
            killed_at(&scene, "restore-after-created-file");
            assert!(!scene.live(DLC_FILE).exists());
            assert!(scene.live(DLC_FOLDER).is_dir());
            assert_eq!(scene.content_of(UPDATE), original(UPDATE));
            assert!(scene.point.join(MANIFEST_FILE).is_file());

            let answer = answer_of(&scene.run());
            assert_eq!(
                answer["createdFiles"],
                json!([{ "path": DLC_FILE, "released": false, "freedBytes": 0 }])
            );
            assert!(!scene.live(DLC_FOLDER).exists());
            assert!(scene.leftovers().is_empty() && !scene.point.exists());
        }

        #[test]
        fn a_restore_killed_between_two_created_files_removes_the_second_on_the_repeat() {
            let scene = Scene::new(&[UPDATE]);
            with_created_files(&scene, &[(DLC_FILE, DLC_BODY), (OTHER_FILE, OTHER_BODY)]);
            killed_at(&scene, "restore-after-created-file");
            assert!(!scene.live(DLC_FILE).exists());
            assert_eq!(scene.content_of(OTHER_FILE), OTHER_BODY);

            let answer = answer_of(&scene.run());
            assert_eq!(answer["createdFiles"][0]["released"], json!(false));
            assert_eq!(answer["createdFiles"][1]["released"], json!(true));
            assert!(!scene.live(OTHER_FILE).exists() && !scene.point.exists());
        }
    }
}
