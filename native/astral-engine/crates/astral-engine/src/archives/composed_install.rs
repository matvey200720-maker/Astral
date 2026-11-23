//! Установка собранного архива в игру с точкой отката.
//!
//! Архив берётся готовым файлом (его копируют рядом с живым и сверяют по
//! отпечатку) или собирается из операций (`compose_with`). Несколько архивов
//! идут под одной точкой и одной транзакцией: подменяются все или ни один.
//! Если архива в игре пока нет, точка записывает «до: отсутствовал», и откат
//! такой установки его удаляет.

use std::{
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
    slice,
    sync::{Arc, Mutex, PoisonError},
};

use rage_rpf::{Finalizer, KeySet};

use super::{
    compose::{compose_batched, Install, InstallTarget, Operation, Request, Streaming},
    expect, log,
    points::{self, copy_with_hash, valid_point_id},
    random_hex,
    recipe::Recipe,
    transaction::{self, absent_backup, Backup, Point, Staged},
};
use crate::{
    disk,
    error::{EngineError, Result},
    failpoint, paths,
    progress::Progress,
};

use serde_json::{json, Value};

/// Исправитель собранного архива; без него архив отдаётся как есть.
type MaybeFinalizer<'a> = Option<&'a dyn Finalizer>;

/// Ключи шифрования, общие для всех потоков команды.
type SharedKeys = Arc<KeySet>;

const MODE_NAME: &str = "compose-install";

/// Отказ сборки, чей отпечаток не равен ожидаемому (сборка по рецепту дала другие байты).
pub const RECIPE_MISMATCH: &str =
    "The rebuilt archive does not match the expected sha256: nothing was swapped.";

mod hold;

pub(crate) use hold::{
    start_append_hold, sweep_for_append, write_append_hold, AppendHold, AppendStart, HoldLock,
};
pub use hold::{finish_hold_command, settle_holds, HeldSweep};

/// Устанавливает собранный архив (или несколько) в игру.
pub fn compose_install(
    request: &Request,
    keys: &SharedKeys,
    finalizer: MaybeFinalizer<'_>,
    progress: &Progress,
    points_root: &Path,
) -> Result<Value> {
    // второй шаг удержания ничего не собирает: подмена или отказ от неё
    if request
        .install
        .as_ref()
        .is_some_and(Install::finishes_a_hold)
    {
        return hold::finish(request, Some(keys), progress, points_root);
    }
    let streaming = Streaming::from_env();
    install_streaming(request, keys, finalizer, progress, points_root, streaming)
}

/// Тот же порядок с явным выбором отпечатка по ходу записи (команда читает его
/// из окружения, тесты задают сами).
///
/// Порядок на диске: копия «до» (ссылка, а не байты), сборка рядом с живым
/// файлом, рецепт, запись переустановки, опись, подмена. Отмена проверяется
/// между целями и перед подменой; с первой подмены установка доводится.
pub(crate) fn install_streaming(
    request: &Request,
    keys: &SharedKeys,
    finalizer: MaybeFinalizer<'_>,
    progress: &Progress,
    points_root: &Path,
    streaming: Streaming,
) -> Result<Value> {
    install_with(
        request,
        keys,
        finalizer,
        progress,
        points_root,
        streaming,
        &Extras::default(),
    )
}

/// Проверка готового файла стейджа до подмены: открыть его и сверить с тем, что
/// собирали. Отказ убирает стейдж, игра не тронута.
pub(crate) type StagedCheck<'a> = &'a dyn Fn(&Path, &SharedKeys) -> Result<()>;

/// Что делать с отпечатком собранного файла до подмены (рецепт «Починить»).
pub(crate) type BuiltHook<'a> = &'a dyn Fn(&str) -> Result<()>;

/// Что «Починить» по сводному рецепту добавляет к обычной установке из операций:
/// партии операций, которые применяются до основных, проверка содержимого
/// стейджа и запись рецепта до подмены. По умолчанию пусто — обычная установка.
#[derive(Default)]
pub(crate) struct Extras<'a> {
    /// Прежние партии: применяются к дереву основы по очереди, до операций запроса.
    pub earlier: &'a [Vec<Operation>],
    /// Сверка содержимого собранного файла (до подмены).
    pub verify: Option<StagedCheck<'a>>,
    /// После сборки и проверки, до записи переустановки и подмены: получает
    /// SHA-256 собранного файла. Отказ отменяет установку, игра не тронута.
    pub before_swap: Option<BuiltHook<'a>>,
}

/// Установка с дополнениями `Extras`; без них — `install_streaming`.
pub(crate) fn install_with(
    request: &Request,
    keys: &SharedKeys,
    finalizer: MaybeFinalizer<'_>,
    progress: &Progress,
    points_root: &Path,
    streaming: Streaming,
    extras: &Extras<'_>,
) -> Result<Value> {
    // По рецепту собирается то, что рецепт хранит, а итог обязан дать его отпечаток.
    let recipe = open_recipe(request)?;
    let rebuilt = recipe.as_ref().map(|found| found.apply(request));
    let request = rebuilt.as_ref().unwrap_or(request);
    let (install, id) = open_block(request)?;
    let expected = recipe
        .as_ref()
        .map(|found| found.sha256.clone())
        .or_else(|| install.options.expect_sha256.clone());
    let plans = Plan::all(install)?;
    expect_targets_exist(&plans, install)?;
    // оборванная дозапись доводится до любой копии «до»: иначе «до» снялось бы
    // с архива в середине записи (без журнала рядом это ничего не стоит)
    for plan in &plans {
        super::append::settle_beside(&plan.live, progress)?;
    }
    // подмена убирает журнал дозаписи и таблицу слоёв рядом: что стало со слоями,
    // вызывающий узнаёт из ответа (у архива без слоёв ответ прежний)
    let layers_note = super::layers::dropped_note(
        &plans
            .iter()
            .map(|plan| (plan.live.as_path(), plan.archive.as_str()))
            .collect::<Vec<_>>(),
    );
    refuse_recipe_over_prebuilt(&plans, install)?;
    let aside = install.options.before_aside;
    ensure_space(&plans, &install.game_root, points_root, aside)?;
    // Брошенные «до» рядом убирает только путь, который сам их оставляет:
    // прежняя установка чужих файлов в папке игры не трогает.
    if aside {
        for plan in &plans {
            points::sweep_orphan_asides(&plan.live, points_root);
        }
    }

    // Брошенное удержание (стейдж, «до», точка) прежней установки этих архивов
    // убирается до новой сборки; чужие и свежие удержания остаются.
    hold::sweep_for_install(&plans, install, points_root)?;

    let mut session = if install.options.hold {
        Session::open_with(progress, &plans, points_root, id, aside, |opened| {
            hold::write_building(opened, &plans, install)
        })?
    } else {
        Session::open(progress, &plans, points_root, id, aside)?
    };
    let builder = Builder {
        finalizer,
        request,
        keys,
        progress,
        streaming,
        expected,
        extras,
    };
    let (staged, landed) = session.stage_all(&builder, &plans)?;
    failpoint::hit("install-after-stage");
    // ожидания запроса: что обязан держать собранный архив (до рецепта и подмены)
    let checked = check_expectations(&plans, &staged, install, keys)
        .map_err(|error| session.abort(error, &staged))?;
    session.checkpoint(progress, &staged)?;
    session.save_recipe(install, request, &landed, &staged)?;
    if let (Some(hook), Some(one)) = (extras.before_swap, landed.first()) {
        hook(&one.built.sha256).map_err(|error| session.abort(error, &staged))?;
    }
    session.write_replay(&install.replay, &staged)?;
    session.checkpoint(progress, &staged)?;
    if install.options.hold {
        // первый шаг из двух: стейдж собран и проверен движком, подмены нет
        let mut answer = hold::finish_hold(&mut session, &landed, &staged, install, &checked)?;
        if let Some(note) = layers_note {
            answer["layers"] = note;
        }
        return Ok(answer);
    }
    session.commit(install, staged, progress)?;
    let mut answer = session.report(&landed, install);
    if let Some(note) = layers_note {
        answer["layers"] = note;
    }
    if let Some(note) = checked {
        answer["expected"] = note.to_json();
    }
    Ok(answer)
}

/// Сколько проверено по ожиданиям запроса и за сколько миллисекунд (ключ
/// `expected` ответа есть только у запроса с ожиданиями).
pub(crate) struct ExpectedNote {
    entries: usize,
    dlc_packs: usize,
    ms: u64,
}

impl ExpectedNote {
    pub(crate) fn to_json(&self) -> Value {
        json!({ "entries": self.entries, "dlcPacks": self.dlc_packs, "ms": self.ms })
    }
}

/// Строка `expect` с архивом, которого установка не ставит, — ошибка запроса:
/// отказ до первой записи.
fn expect_targets_exist(plans: &[Plan], install: &Install) -> Result<()> {
    let fold = |text: &str| text.replace('\\', "/").to_lowercase();
    for row in &install.options.expect {
        let Some(named) = &row.archive else { continue };
        if !plans.iter().any(|plan| fold(&plan.archive) == fold(named)) {
            return Err(EngineError::argument(
                "Install expect names an archive that is not installed.",
            ));
        }
    }
    Ok(())
}

/// Сверяет собранные файлы с ожиданиями запроса; нет ожиданий — `None`.
fn check_expectations(
    plans: &[Plan],
    staged: &[Staged],
    install: &Install,
    keys: &SharedKeys,
) -> Result<Option<ExpectedNote>> {
    if install.options.expect.is_empty() {
        return Ok(None);
    }
    let begun = std::time::Instant::now();
    let mut note = ExpectedNote {
        entries: 0,
        dlc_packs: 0,
        ms: 0,
    };
    for (index, (plan, piece)) in plans.iter().zip(staged).enumerate() {
        let wanted = expect::Wanted::of(&install.options.expect, &plan.archive, index == 0);
        if wanted.is_empty() {
            continue;
        }
        let done = expect::check_file(&piece.staged, keys, &wanted)?;
        note.entries += done.entries;
        note.dlc_packs += done.dlc_packs;
    }
    note.ms = u64::try_from(begun.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(Some(note))
}

/// Рецепт, по которому собирается архив, если блок его называет.
fn open_recipe(request: &Request) -> Result<Option<Recipe>> {
    let Some(path) = request
        .install
        .as_ref()
        .and_then(|block| block.options.use_recipe.as_deref())
    else {
        return Ok(None);
    };
    let recipe = Recipe::load(path)?;
    let archive = request.install.as_ref().map(|block| first_archive(block));
    let fold = |text: &str| text.replace('\\', "/").to_lowercase();
    match archive {
        Some(given) if fold(&given) != fold(&recipe.archive) => Err(EngineError::argument(
            "Build recipe is for another archive.",
        )),
        _ => Ok(Some(recipe)),
    }
}

/// Путь первого архива блока (его же отдаёт ответ).
fn first_archive(install: &Install) -> String {
    install
        .targets
        .first()
        .map_or_else(|| install.archive.clone(), |target| target.archive.clone())
}

/// Рецепт заменяет сборку, а не готовый файл: вместе они ничего не значат.
fn refuse_recipe_over_prebuilt(plans: &[Plan], install: &Install) -> Result<()> {
    let mixed =
        install.options.use_recipe.is_some() && plans.iter().any(|plan| plan.prebuilt.is_some());
    if mixed {
        return Err(EngineError::argument(
            "A build recipe cannot be combined with a prebuilt archive.",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Проверки до первой записи
// ---------------------------------------------------------------------------

/// Заданное имя, если оно годится; без имени — новое; негодное — отказ с этим текстом.
fn given_or(
    given: Option<&str>,
    valid: impl Fn(&str) -> bool,
    refusal: &str,
    fresh: impl FnOnce() -> String,
) -> Result<String> {
    match given {
        None => Ok(fresh()),
        Some(name) if valid(name) => Ok(name.to_owned()),
        Some(_) => Err(EngineError::argument(refusal)),
    }
}

const NO_INSTALL_BLOCK: &str = "compose install mode without an install block";

/// Блок установки и идентификатор точки: заданный, если он годится, иначе новый.
fn open_block(request: &Request) -> Result<(&Install, String)> {
    let install = match &request.install {
        Some(block) => block,
        None => return Err(EngineError::internal(NO_INSTALL_BLOCK)),
    };
    let id = given_or(
        install.point_id.as_deref(),
        valid_point_id,
        "Install point id is invalid.",
        points::new_point_id,
    )?;
    Ok((install, id))
}

/// Места хватает и в папке точек, и в папке игры. С «до» рядом с живым
/// файлом (`aside`) в папку точек байты не пишутся: хватит места в папке игры.
fn ensure_space(plans: &[Plan], game_root: &Path, points_root: &Path, aside: bool) -> Result<()> {
    let sizes = plans.iter().map(Plan::space_needed).collect::<Vec<_>>();
    let roots = if aside { game_root } else { points_root };
    transaction::preflight_sizes(game_root, &sizes, roots)
}

const STAGE_PREFIX: &str = ".astral-stage-";

/// Готовый архив, который вместо сборки копируется в стейдж, и его отпечаток.
struct Prebuilt {
    path: String,
    sha256: String,
}

impl Prebuilt {
    /// Отпечаток записывают 64 шестнадцатеричными знаками.
    fn is_digest(text: &str) -> bool {
        let Ok(digits) = <[u8; 64]>::try_from(text.as_bytes()) else {
            return false;
        };
        digits.iter().all(u8::is_ascii_hexdigit)
    }

    fn path(&self) -> &Path {
        Path::new(&self.path)
    }
}

/// Одна цель, прошедшая проверки до первой записи.
struct Plan {
    /// Путь архива как задан (идёт в ответ, в опись и в путь копии).
    archive: String,
    live: PathBuf,
    prebuilt: Option<Prebuilt>,
    /// Архива в игре сейчас нет: установка его создаст.
    created: bool,
    stage_name: String,
}

impl Plan {
    /// Все цели блока: каждая сама по себе, затем друг с другом.
    fn all(install: &Install) -> Result<Vec<Self>> {
        match install.targets.as_slice() {
            [] => {
                let Install {
                    archive,
                    prebuilt,
                    sha256,
                    create,
                    stage_name,
                    ..
                } = install.clone();
                let single = InstallTarget {
                    archive,
                    prebuilt,
                    sha256,
                    create,
                    stage_name,
                };
                let root_text = install.game_root.to_string_lossy();
                Self::check(&root_text, false, &single).map(|plan| vec![plan])
            }
            listed => Self::check_listed(&install.game_root.to_string_lossy(), listed),
        }
    }

    fn check_listed(root_text: &str, listed: &[InstallTarget]) -> Result<Vec<Self>> {
        let several = listed.len() > 1;
        let mut plans = Vec::new();
        for target in listed {
            plans.push(Self::check(root_text, several, target)?);
        }
        reject_collisions(&plans)?;
        Ok(plans)
    }

    /// Проверки одной цели в том порядке, в каком отказывают: путь, наличие,
    /// готовый файл и его отпечаток, имя стейджа, имя файла.
    fn check(root_text: &str, several: bool, target: &InstallTarget) -> Result<Self> {
        let live = paths::inside(root_text, &target.archive)?;
        let exists = live.exists();
        let has_prebuilt = target.prebuilt.is_some();
        let usable = if exists {
            live.is_file()
        } else {
            target.create
        };
        let digest_ok = matches!(target.sha256.as_deref(), Some(text) if Prebuilt::is_digest(text));
        let rules = [
            (
                !usable,
                EngineError::file_not_found(
                    ["Target RPF does not exist: ", &target.archive].concat(),
                ),
            ),
            (
                !exists && !has_prebuilt,
                EngineError::argument(
                    "A missing archive can only be created from a prebuilt file.",
                ),
            ),
            (
                several && !has_prebuilt,
                EngineError::argument(
                    "Several archives in one point are installed only from prebuilt files.",
                ),
            ),
            (
                has_prebuilt && !digest_ok,
                EngineError::argument("Install prebuilt archive needs its sha256."),
            ),
        ];
        rules
            .into_iter()
            .find_map(|(broken, refusal)| broken.then_some(refusal))
            .map_or(Ok(()), Err)?;
        let stage_ok = |name: &str| {
            const STAGE_MAX_BYTES: usize = 96;
            let allowed = |byte: u8| byte.is_ascii_alphanumeric() || b"._-".contains(&byte);
            let room = 1..=STAGE_MAX_BYTES - STAGE_PREFIX.len();
            name.strip_prefix(STAGE_PREFIX)
                .is_some_and(|tail| room.contains(&tail.len()) && tail.bytes().all(allowed))
        };
        let stage_name = given_or(
            target.stage_name.as_deref(),
            stage_ok,
            "Install stage name is invalid.",
            || format!("{STAGE_PREFIX}{}", random_hex(32)),
        )?;
        // у живого пути должно быть имя файла: стейдж кладёт готовый файл под ним
        live.file_name().ok_or(EngineError::invalid_data(
            "Install archive path has no file name.",
        ))?;
        let prebuilt = match (&target.prebuilt, &target.sha256) {
            (Some(path), Some(sha256)) => Some(Prebuilt {
                path: path.clone(),
                sha256: sha256.clone(),
            }),
            _ => None,
        };
        let archive = target.archive.clone();
        Ok(Self {
            archive,
            prebuilt,
            created: !exists,
            stage_name,
            live,
        })
    }

    /// Служебная папка стейджа рядом с живым архивом.
    fn stage_dir(&self) -> PathBuf {
        self.live.with_file_name(&self.stage_name)
    }

    fn leaf(&self) -> &OsStr {
        self.live.file_name().unwrap_or_default()
    }

    fn pair(&self) -> (String, PathBuf) {
        (self.archive.clone(), self.live.clone())
    }

    /// Размер для проверки места: готовый файл, иначе живой архив, иначе ноль.
    fn space_needed(&self) -> u64 {
        let ready = self.prebuilt.as_ref().map(Prebuilt::path);
        [ready, Some(self.live.as_path())]
            .into_iter()
            .flatten()
            .find_map(|path| fs::metadata(path).ok())
            .as_ref()
            .map_or(0, fs::Metadata::len)
    }

    /// Причина, по которой две цели нельзя ставить вместе: тот же живой путь
    /// (без учёта регистра) или одинаковое имя стейджа в одной папке.
    fn clash_with(&self, other: &Self) -> Option<EngineError> {
        let folded = |plan: &Self| plan.live.to_string_lossy().to_lowercase();
        let same_file = folded(self) == folded(other);
        let same_stage =
            (&self.stage_name, self.live.parent()) == (&other.stage_name, other.live.parent());
        match (same_file, same_stage) {
            (true, _) => Some(EngineError::argument("The same archive is listed twice.")),
            (false, true) => Some(EngineError::argument(
                "Install stage names collide in one folder.",
            )),
            (false, false) => None,
        }
    }
}

/// Пары целей по порядку: первая же несовместимая отказывает всей установке.
fn reject_collisions(plans: &[Plan]) -> Result<()> {
    let clash = (0..plans.len())
        .flat_map(|at| plans[at + 1..].iter().map(move |later| (&plans[at], later)))
        .find_map(|(earlier, later)| earlier.clash_with(later));
    clash.map_or(Ok(()), Err)
}

// ---------------------------------------------------------------------------
// Готовый файл рядом с живым
// ---------------------------------------------------------------------------

/// Всё, что сборке архива нужно кроме самой цели.
struct Builder<'a> {
    finalizer: MaybeFinalizer<'a>,
    request: &'a Request,
    keys: &'a SharedKeys,
    progress: &'a Progress,
    /// Отпечаток по ходу записи или прежний порядок (из окружения команды).
    streaming: Streaming,
    /// Отпечаток, который обязан дать собранный из операций архив.
    expected: Option<String>,
    /// Сборка по сводному рецепту: прежние партии и проверка содержимого.
    extras: &'a Extras<'a>,
}

/// Итог сборки одной цели: отпечаток (строчными) и разбор операций.
struct Built {
    sha256: String,
    operations: Value,
    /// Времена сборки (`timings` ответа `compose_with`); у готового файла — `null`.
    timings: Value,
    /// Размер собранного архива; у готового файла — ноль.
    bytes: u64,
}

/// Что ответ знает о собранной цели.
struct Landed<'p> {
    plan: &'p Plan,
    built: Built,
}

impl Landed<'_> {
    fn entry(&self) -> Value {
        json!({
            "archive": self.plan.archive,
            "created": self.plan.created,
            "sha256": self.built.sha256,
        })
    }
}

impl Builder<'_> {
    /// Кладёт готовый файл в стейдж; при отказе стейдж убирается.
    fn stage<'p>(&self, plan: &'p Plan, footprint: &mut Footprint) -> Result<(Staged, Landed<'p>)> {
        let stage_dir = plan.stage_dir();
        let preexisting = stage_dir.exists();
        if let Some(folder) = plan.live.parent() {
            footprint.note_missing_game_dirs(&plan.archive, folder);
        }
        footprint.create_all(&stage_dir)?;
        let (relative, live) = plan.pair();
        let mut staged = Staged {
            staged: stage_dir.join(plan.leaf()),
            sha256_after: String::new(),
            preexisting,
            stage_dir,
            relative,
            live,
        };
        let outcome = if let Some(piece) = &plan.prebuilt {
            self.copy_prebuilt(piece, &staged.staged)
        } else {
            self.compose(plan, &staged.staged)
        };
        match outcome {
            Ok(built) => {
                // в опись отпечаток идёт прописными, как у `sha256Before`; ответ
                // команды остаётся строчным
                staged.sha256_after = built.sha256.to_ascii_uppercase();
                Ok((staged, Landed { plan, built }))
            }
            Err(error) => {
                transaction::cleanup_refused(slice::from_ref(&staged));
                Err(error)
            }
        }
    }

    /// Копия готового файла с хеш-сверкой. Отмена проверяется до копии: пока
    /// байты не легли рядом с живым файлом, отказаться дёшево.
    fn copy_prebuilt(&self, piece: &Prebuilt, staged_file: &Path) -> Result<Built> {
        if piece.path().is_absolute() && piece.path().is_file() {
            self.progress.checkpoint()?;
            return self.copy_checked(piece, staged_file);
        }
        Err(EngineError::file_not_found(
            ["Prebuilt archive does not exist: ", &piece.path].concat(),
        ))
    }

    /// Копирует файл и сверяет отпечаток копии с обещанным.
    fn copy_checked(&self, piece: &Prebuilt, staged_file: &Path) -> Result<Built> {
        let mut seen = 0;
        let mut report = |copied: u64| self.progress.wrote(disk::delta(&mut seen, copied));
        let copy = copy_with_hash(piece.path(), staged_file, &mut report)?;
        let sha256 = copy.to_ascii_lowercase();
        sha256
            .eq_ignore_ascii_case(&piece.sha256)
            .then_some(Built {
                sha256,
                operations: Value::Null,
                timings: Value::Null,
                bytes: 0,
            })
            .ok_or_else(|| {
                EngineError::invalid_operation(
                    "Собранный архив не совпал со своим отпечатком при копировании — установка отменена.",
                )
            })
    }

    /// Сборка из операций: основа запроса, а без неё — живой архив; выход — файл стейджа.
    fn compose(&self, plan: &Plan, staged_file: &Path) -> Result<Built> {
        let own = Request {
            base: self.request.base.clone().or(Some(plan.live.clone())),
            output: staged_file.to_path_buf(),
            staging: None,
            install: None,
            ..self.request.clone()
        };
        let answer = compose_batched(
            &own,
            self.extras.earlier,
            self.keys,
            self.finalizer,
            self.progress,
            self.streaming,
        )?;
        let sha256 = answer["sha256"].as_str().unwrap_or_default().to_owned();
        self.hold_to_expected(&sha256)?;
        if let Some(check) = self.extras.verify {
            check(staged_file, self.keys)?;
        }
        Ok(Built {
            sha256,
            operations: answer["operations"].clone(),
            timings: answer["timings"].clone(),
            bytes: answer["bytes"].as_u64().unwrap_or(0),
        })
    }

    /// Собранный из операций архив обязан дать заранее названный отпечаток (сборка
    /// по рецепту): иначе подменять нечем, игра не тронута.
    fn hold_to_expected(&self, sha256: &str) -> Result<()> {
        match &self.expected {
            Some(wanted) if !wanted.eq_ignore_ascii_case(sha256) => {
                Err(EngineError::invalid_operation(RECIPE_MISMATCH))
            }
            _ => Ok(()),
        }
    }
}

// ---------------------------------------------------------------------------
// Точка отката
// ---------------------------------------------------------------------------

/// Звенья пути, которых ещё нет на диске: от самого пути вверх до первой
/// существующей папки.
fn absent_chain(path: &Path) -> impl Iterator<Item = &Path> {
    path.ancestors()
        .take_while(|dir| !dir.as_os_str().is_empty() && !dir.exists())
}

/// Папки, которые установка создала сама. После отказа они убираются, если
/// пусты: существовавшие раньше и непустые остаются.
#[derive(Default)]
struct Footprint {
    /// В порядке создания: внешние раньше внутренних.
    dirs: Vec<PathBuf>,
    /// Из них те, что лежат в папке игры (кроме служебной папки стейджа): пути
    /// от корня игры с прямыми косыми, в порядке создания. Они идут в опись.
    game_dirs: Vec<String>,
}

impl Footprint {
    /// Запоминает недостающие папки пути архива (`archive` — путь как задан,
    /// `folder` — папка живого архива): так их назовёт опись.
    fn note_missing_game_dirs(&mut self, archive: &str, folder: &Path) {
        let Ok(relative) = paths::normalize_relative(archive) else {
            return;
        };
        let Some((above, _file)) = relative.rsplit_once('/') else {
            return;
        };
        let names: Vec<&str> = above.split('/').collect();
        // самая внутренняя недостающая папка лежит на глубине `names.len()`
        let created = absent_chain(folder).count().min(names.len());
        let first_new = names.len() - created + 1;
        let fresh = (first_new..=names.len()).map(|level| names[..level].join("/"));
        self.game_dirs.extend(fresh);
    }

    /// Запоминает недостающие звенья пути.
    fn note_missing(&mut self, path: &Path) {
        let mut chain: Vec<&Path> = absent_chain(path).collect();
        chain.reverse();
        self.dirs.extend(chain.into_iter().map(Path::to_path_buf));
    }

    /// Запоминает недостающие звенья пути и только потом создаёт их.
    fn create_all(&mut self, path: &Path) -> io::Result<()> {
        self.note_missing(path);
        fs::create_dir_all(path)
    }

    /// Убирает записанное, глубокие папки первыми; непустая молча остаётся.
    fn sweep(&self) {
        for folder in self.dirs.iter().rev() {
            let _ = fs::remove_dir(folder);
        }
    }
}

const REPLAY_FILE: &str = "replay.json";
const MANIFEST_FILE: &str = "restore.json";

/// Что установка сделала в папке точки сама.
struct Claims {
    /// Опись, лежавшая в папке точки до установки (чужая, если она не менялась).
    manifest_before: Option<points::Stamp>,
    /// Папку точки создала эта установка: при отказе она уходит целиком, а
    /// существовавшая раньше остаётся со всем чужим.
    root: bool,
    /// Запись переустановки написана этой установкой.
    replay: bool,
    /// В папке точки лежит запись удержания `hold.json` (установка в два шага).
    hold: bool,
}

struct Session {
    claims: Claims,
    targets: Vec<(String, PathBuf)>,
    root: PathBuf,
    backups: Vec<Backup>,
    id: String,
    footprint: Footprint,
    /// «До» может остаться ссылкой рядом с живым архивом (`before: "aside"`).
    aside: bool,
    /// Замок удержания, пока этот шаг работает над ним (`install.hold`, `commit`).
    lock: Mutex<Option<hold::HoldLock>>,
}

impl Session {
    /// Папка точки и копии «до» (у отсутствующего архива вместо копии пометка).
    fn open(
        progress: &Progress,
        plans: &[Plan],
        points_root: &Path,
        id: String,
        aside: bool,
    ) -> Result<Self> {
        Self::open_with(progress, plans, points_root, id, aside, |_| Ok(()))
    }

    /// То же; `first` выполняется, когда папка точки уже есть, а копий «до» ещё
    /// нет (удержание кладёт сюда запись о том, что собирается). Отказ `first`
    /// откатывает точку, как отказ копии.
    fn open_with(
        progress: &Progress,
        plans: &[Plan],
        points_root: &Path,
        id: String,
        aside: bool,
        first: impl FnOnce(&mut Self) -> Result<()>,
    ) -> Result<Self> {
        let root = Path::join(points_root, &id);
        let owned = !root.exists();
        fs::create_dir_all(&root)?;
        let manifest_before = points::stamp(&root.join(MANIFEST_FILE)).ok();
        let mut session = Self {
            claims: Claims {
                manifest_before,
                root: owned,
                replay: false,
                hold: false,
            },
            targets: plans.iter().map(Plan::pair).collect::<Vec<_>>(),
            backups: Vec::new(),
            footprint: Footprint::default(),
            root,
            id,
            aside,
            lock: Mutex::new(None),
        };
        first(&mut session).map_err(|error| session.give_up(error, Vec::new()))?;
        for plan in plans {
            session.back_up(plan, progress)?;
        }
        Ok(session)
    }

    /// Копия «до» одной цели; при отказе установка уже откатана.
    fn back_up(&mut self, plan: &Plan, progress: &Progress) -> Result<()> {
        if plan.created {
            self.backups.push(absent_backup(&self.root, &plan.archive));
            return Ok(());
        }
        // папки под копию «до» внутри точки: их делает `make_backups`
        if let Some(folder) = points::backup_path(&self.root, &plan.archive).parent() {
            self.footprint.note_missing(folder);
        }
        let aside = self.aside.then_some(self.id.as_str());
        let made = transaction::make_backups_with(
            &[plan.pair()],
            &self.root,
            progress,
            &mut self.backups,
            aside,
        );
        made.map_err(|(error, _)| self.give_up(error, Vec::new()))
    }

    /// Точка отмены: пока подмена не началась, отказаться можно, и тогда
    /// готовые стейджи убираются, а игра остаётся такой, какой была.
    fn checkpoint(&self, progress: &Progress, staged: &[Staged]) -> Result<()> {
        progress
            .checkpoint()
            .map_err(|error| self.abort(error, staged))
    }

    /// Рецепт сборки ложится рядом до подмены: если он не записался, архив
    /// нечем будет пересобрать, и установка не начинается. Только у сборки
    /// из операций с названным путём рецепта.
    fn save_recipe(
        &self,
        install: &Install,
        request: &Request,
        landed: &[Landed<'_>],
        staged: &[Staged],
    ) -> Result<()> {
        let (Some(path), [one]) = (install.options.save_recipe.as_deref(), landed) else {
            return Ok(());
        };
        // первый шаг из двух: рецепт ложится заготовкой в папку точки и вступает в
        // силу на `commit` (отказ от удержания прежний рецепт не меняет)
        let draft = self.root.join(hold::RECIPE_DRAFT);
        let path = if install.options.hold { draft.as_path() } else { path };
        if one.plan.prebuilt.is_some() {
            return Ok(());
        }
        let recipe = Recipe::of(
            request,
            &one.plan.archive,
            &one.built.sha256,
            one.built.bytes,
        );
        recipe.save(path).map_err(|error| self.abort(error, staged))
    }

    fn replay_path(&self) -> PathBuf {
        self.root.join(REPLAY_FILE)
    }

    /// Собирает цели по очереди; при первой неудаче готовые стейджи убираются.
    fn stage_all<'p>(
        &mut self,
        builder: &Builder<'_>,
        plans: &'p [Plan],
    ) -> Result<(Vec<Staged>, Vec<Landed<'p>>)> {
        let footprint = &mut self.footprint;
        match plans.iter().try_fold(Vec::new(), |mut done, plan| {
            // отмену перед каждой целью ловит копия готового файла (между
            // целями) или сама сборка (она опрашивает отмену по ходу)
            match builder.stage(plan, footprint) {
                Ok(pair) => {
                    done.push(pair);
                    Ok(done)
                }
                Err(error) => Err((error, done)),
            }
        }) {
            Ok(done) => Ok(done.into_iter().unzip()),
            Err((error, done)) => {
                let (staged, _): (Vec<Staged>, Vec<Landed<'p>>) = done.into_iter().unzip();
                Err(self.abort(error, &staged))
            }
        }
    }

    /// Пишет запись переустановки; при отказе стейджи убираются, установка откатывается.
    fn write_replay(&mut self, replay: &Value, staged: &[Staged]) -> Result<()> {
        let written = match serde_json::to_vec_pretty(replay) {
            Ok(bytes) => fs::write(self.replay_path(), bytes).map_err(EngineError::from),
            Err(_) => Err(EngineError::invalid_data(
                "Install replay record is not serializable.",
            )),
        };
        written
            .map(|()| self.claims.replay = true)
            .map_err(|error| self.abort(error, staged))
    }

    fn commit(&self, install: &Install, staged: Vec<Staged>, progress: &Progress) -> Result<()> {
        let (id, root) = (&self.id, &self.root);
        let patch = self.replay_path();
        let created = &self.footprint.game_dirs;
        let point = Point {
            id,
            root,
            patch: &patch,
            game_root: &install.game_root,
            created_dirs: created,
        };
        transaction::commit(staged, progress, &self.targets, &self.backups, &point)
            .map_err(|(error, committed)| self.give_up(error, committed))
    }

    fn report(&self, landed: &[Landed<'_>], install: &Install) -> Value {
        let head = landed.first();
        let mut entries: Vec<Value> = landed.iter().map(Landed::entry).collect();
        let options = &install.options;
        // Новые ключи появляются только у запросов, что их включили: прочие
        // ответы остаются такими же байт в байт.
        if options.before_aside {
            for (entry, backup) in entries.iter_mut().zip(&self.backups) {
                entry["before"] = json!(self.before_word(backup));
            }
        }
        let mut answer = json!({
            "status": "ready",
            "mode": MODE_NAME,
            "id": self.id,
            "restoreRoot": self.root.to_string_lossy(),
            "archive": head.map(|one| one.plan.archive.as_str()),
            "created": head.is_some_and(|one| one.plan.created),
            "archives": entries,
            "sha256": head.map(|one| one.built.sha256.as_str()),
            "operations": head.map_or(Value::Null, |one| one.built.operations.clone()),
            "timings": head.map_or(Value::Null, |one| one.built.timings.clone()),
        });
        if let (Some(path), Some(one)) = (&options.save_recipe, head) {
            if one.plan.prebuilt.is_none() {
                answer["recipe"] = json!(path.to_string_lossy());
            }
        }
        answer
    }

    /// Копия «до» лежит рядом с живым архивом, а не в папке точки.
    fn is_aside(&self, backup: &Backup) -> bool {
        !backup.absent && !backup.path.starts_with(&self.root)
    }

    /// Где лежит «до» этой цели: `absent` (архива не было), `point` (в папке
    /// точек: ссылка или копия) или `aside` (ссылка рядом с живым файлом).
    fn before_word(&self, backup: &Backup) -> &'static str {
        match (backup.absent, backup.path.starts_with(&self.root)) {
            (true, _) => "absent",
            (false, true) => "point",
            (false, false) => "aside",
        }
    }

    /// Отказ до подмены: готовые стейджи убираются, всё остальное откатывается.
    fn abort(&self, error: EngineError, staged: &[Staged]) -> EngineError {
        transaction::cleanup_refused(staged);
        self.give_up(error, Vec::new())
    }

    /// Возвращает подменённое, убирает то, что создала установка (точку, если
    /// все подмены вернулись), и отдаёт ошибку дальше. Созданные ради стейджа
    /// пустые папки в игре тоже убираются.
    fn give_up(&self, error: EngineError, committed: Vec<usize>) -> EngineError {
        let mut journal = |line: String| log(line);
        let restored =
            transaction::restore_committed(&self.targets, &self.backups, committed, &mut journal);
        if restored {
            if let Err(failure) = self.remove_point() {
                log(format!("[Install] Точка {} не убрана: {failure}", self.id));
            }
        }
        self.footprint.sweep();
        error
    }

    /// Файлы точки, которые положила эта установка: копии «до», запись
    /// переустановки и опись (если она менялась).
    fn own_files(&self) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = self
            .backups
            .iter()
            .filter(|&copy| !copy.absent)
            .map(|copy| copy.path.clone())
            .collect();
        files.extend(self.claims.replay.then(|| self.replay_path()));
        files.extend(self.claims.hold.then(|| self.root.join(hold::HOLD_FILE)));
        files.extend(self.claims.hold.then(|| self.root.join(hold::RECIPE_DRAFT)));
        files.extend(self.claims.hold.then(|| hold::HoldLock::path_in(&self.root)));
        files.extend(
            self.manifest_is_ours()
                .then(|| self.root.join(MANIFEST_FILE)),
        );
        files
    }

    /// Забирает замок удержания у шага.
    fn take_lock(&self) -> Option<hold::HoldLock> {
        self.lock
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }

    /// Закрывает замок удержания (файл остаётся).
    fn close_lock(&self) {
        drop(self.take_lock());
    }

    /// Точка, созданная установкой, уходит целиком; в точке, которая лежала
    /// раньше, убирается только то, что положила установка.
    fn remove_point(&self) -> io::Result<()> {
        // открытый замок мешает убрать папку: его закрывают раньше
        self.close_lock();
        // «до» рядом с живым архивом принадлежит точке и уходит вместе с ней
        for backup in self.backups.iter().filter(|copy| self.is_aside(copy)) {
            drop(fs::remove_file(&backup.path));
        }
        if self.claims.root {
            return fs::remove_dir_all(&self.root);
        }
        let mut first_failure = None;
        for outcome in self.own_files().iter().map(fs::remove_file) {
            let Err(error) = outcome else { continue };
            if error.kind() != io::ErrorKind::NotFound {
                first_failure.get_or_insert(error);
            }
        }
        first_failure.map_or(Ok(()), Err)
    }

    /// Опись в точке есть и написана не раньше установки: или её не было, или
    /// она изменилась.
    fn manifest_is_ours(&self) -> bool {
        points::stamp(&self.root.join(MANIFEST_FILE))
            .is_ok_and(|now| self.claims.manifest_before != Some(now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::compose::tests::{
        delete, import, phase_of, quiet_keys, recorded, replace, tree_lines, write_tree, Lab, Op,
        Spy,
    };
    use crate::archives::compose::Mode;
    use crate::archives::sha256_file;
    use rage_rpf::fixtures::replacement_tree;
    use rage_rpf::Archive;
    use std::process::Stdio;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    const UPDATE: &str = "update/update.rpf";
    const COMMON: &str = "common.rpf";
    const DLC: &str = "update/x64/dlcpacks/astral_test/dlc.rpf";
    const ID: &str = "rpf-probe-0001";
    const STAGE: &str = ".astral-stage-probe-0001";
    const REPLAY_TEXT: &str =
        "{\n  \"module\": \"sky-rainbow\",\n  \"workId\": \"w-1\",\n  \"version\": 1,\n  \"note\": \"Проба: кириллица\"\n}";
    const ZERO_SHA: &str = "0000000000000000000000000000000000000000000000000000000000000000";

    // ----- стенд: игра, точки, готовый архив -----

    struct Game {
        kit: Lab,
        game: PathBuf,
        points: PathBuf,
    }

    impl Game {
        fn new() -> Game {
            let kit = Lab::new();
            let game = kit.dir.path().join("game");
            fs::create_dir_all(game.join("update")).unwrap();
            fs::write(game.join("GTA5.exe"), b"").unwrap();
            fs::copy(kit.base("b1"), game.join(UPDATE)).unwrap();
            fs::copy(kit.source("nested2.rpf"), game.join(COMMON)).unwrap();
            write_tree(&replacement_tree(), &kit.source("prebuilt.rpf"));
            Game {
                points: kit.dir.path().join("points"),
                game,
                kit,
            }
        }

        fn live(&self, relative: &str) -> PathBuf {
            self.game.join(relative)
        }

        fn prebuilt_path(&self) -> String {
            self.kit
                .source("prebuilt.rpf")
                .to_string_lossy()
                .into_owned()
        }

        fn prebuilt_sha(&self) -> String {
            sha256_file(&self.kit.source("prebuilt.rpf")).unwrap()
        }

        /// Блок установки одного архива из операций, с заданными id и стейджем.
        fn block(&self) -> Install {
            Install {
                game_root: self.game.clone(),
                archive: UPDATE.to_owned(),
                replay: serde_json::from_str(REPLAY_TEXT).unwrap(),
                point_id: Some(ID.to_owned()),
                stage_name: Some(STAGE.to_owned()),
                prebuilt: None,
                sha256: None,
                create: false,
                targets: Vec::new(),
                options: Default::default(),
            }
        }

        /// Цель с готовым архивом (отпечаток настоящий).
        fn target(&self, archive: &str, create: bool, stage: Option<&str>) -> InstallTarget {
            InstallTarget {
                archive: archive.to_owned(),
                prebuilt: Some(self.prebuilt_path()),
                sha256: Some(self.prebuilt_sha()),
                create,
                stage_name: stage.map(str::to_owned),
            }
        }

        /// Блок с одной готовой целью `archive` (поля самого блока).
        fn prebuilt_block(&self, archive: &str) -> Install {
            let mut block = self.block();
            block.archive = archive.to_owned();
            block.prebuilt = Some(self.prebuilt_path());
            block.sha256 = Some(self.prebuilt_sha());
            block
        }

        fn request(&self, ops: &[Op], install: Install) -> Request {
            let mut request = self.kit.request(None, ops, Path::new(""));
            request.install = Some(install);
            request
        }

        fn replace_a() -> Vec<Op> {
            vec![replace("x64/a/a.ydd", "new.ydd")]
        }

        fn go(&self, request: &Request) -> Result<Value> {
            self.go_with(request, None, &Progress::silent())
        }

        fn go_with(
            &self,
            request: &Request,
            finalizer: Option<&dyn Finalizer>,
            progress: &Progress,
        ) -> Result<Value> {
            compose_install(request, &quiet_keys(), finalizer, progress, &self.points)
        }

        fn game_listing(&self) -> Vec<String> {
            listing(&self.game)
        }

        fn points_listing(&self) -> Vec<String> {
            listing(&self.points)
        }
    }

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
                    out.push(format!(
                        "{relative} ({} Б)",
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

    fn sha_of(path: &Path) -> String {
        sha256_file(path).unwrap()
    }

    fn failure<T>(outcome: Result<T>) -> (String, String) {
        match outcome {
            Ok(_) => panic!("ожидался отказ"),
            Err(error) => (error.code, error.message),
        }
    }

    fn same(outcome: Result<Value>, code: &str, message: &str) {
        let (found_code, found_message) = failure(outcome);
        assert_eq!(
            (found_code.as_str(), found_message.as_str()),
            (code, message)
        );
    }

    /// Стадии хода без повторов подряд.
    fn stages(lines: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        let mut found: Vec<String> = lines
            .lock()
            .unwrap()
            .iter()
            .map(|line| phase_of(line))
            .collect();
        found.dedup();
        found
    }

    // ----- установка из операций (ops_basic и родня) -----

    #[test]
    fn operations_are_installed_with_a_point_a_replay_record_and_a_manifest() {
        let game = Game::new();
        let original = sha_of(&game.live(UPDATE));
        let before = tree_lines(&game.live(UPDATE));
        let (progress, lines) = recorded();
        let request = game.request(&Game::replace_a(), game.block());
        let answer = game.go_with(&request, None, &progress).unwrap();

        // ответ: значения и порядок ключей; времена каждый раз другие, их ключи проверяются отдельно
        let after = sha_of(&game.live(UPDATE));
        assert_ne!(after, original);
        let mut shown = answer.clone();
        let timings = shown.as_object_mut().unwrap().remove("timings").unwrap();
        // `hash` — миллисекунды отдельного прохода по готовому файлу. У малого файла это
        // 0–несколько мс и зависит от нагрузки машины (под нагрузкой приходило 2), так
        // что значение не проверяется. Постоянен только случай, когда отдельного прохода
        // не было: отпечаток собран по ходу записи (`hashStreamed` 1), тогда `hash` 0.
        assert!(timings["hash"].is_u64());
        let streamed = timings["hashStreamed"].as_u64().unwrap();
        assert!(streamed <= 1);
        if streamed == 1 {
            assert_eq!(timings["hash"], 0, "отдельного прохода не было");
        }
        assert!(timings["tocParses"].as_u64().unwrap() >= 2);
        assert_eq!(
            shown,
            json!({
                "status": "ready",
                "mode": "compose-install",
                "id": ID,
                "restoreRoot": game.points.join(ID).to_string_lossy(),
                "archive": UPDATE,
                "created": false,
                "archives": [{ "archive": UPDATE, "created": false, "sha256": after }],
                "sha256": after,
                "operations": 1,
            })
        );
        let keys: Vec<&String> = answer.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "id",
                "restoreRoot",
                "archive",
                "created",
                "archives",
                "sha256",
                "operations",
                "timings"
            ]
        );

        // игра: запись заменена, стейджей нет
        let now = tree_lines(&game.live(UPDATE));
        assert!(before.contains(&"x64/a/a.ydd  bin cmp=1 enc=0 unc=2500 sha=*".to_owned()));
        assert!(now.contains(&"x64/a/a.ydd  bin cmp=1 enc=0 unc=1234 sha=*".to_owned()));
        assert!(game
            .game_listing()
            .iter()
            .all(|entry| !entry.contains("astral-stage")));

        // точка: копия «до», запись переустановки, опись
        let point = game.points.join(ID);
        assert_eq!(sha_of(&point.join(UPDATE)), original);
        assert_eq!(
            fs::read_to_string(point.join("replay.json")).unwrap(),
            REPLAY_TEXT
        );
        assert_eq!(fs::metadata(point.join("replay.json")).unwrap().len(), 108);
        let text = fs::read_to_string(point.join("restore.json")).unwrap();
        assert!(text.is_ascii() && text.starts_with("{\n  \"schemaVersion\": 2,\n  \"id\": \"rpf-probe-0001\",\n  \"createdAt\": \""));
        assert!(text.ends_with("\n}") && !text.contains('\r'));
        let manifest: Value = serde_json::from_str(&text).unwrap();
        let keys: Vec<&String> = manifest.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "schemaVersion",
                "id",
                "createdAt",
                "gameRoot",
                "patch",
                "archives"
            ]
        );
        let created = manifest["createdAt"].as_str().unwrap();
        assert_eq!(created.len(), "2026-11-04T04:21:45.9106649+00:00".len());
        assert!(created.ends_with("+00:00") && created.as_bytes()[10] == b'T');
        assert_eq!(manifest["gameRoot"], json!(game.game.to_string_lossy()));
        assert_eq!(
            manifest["patch"],
            json!(point.join("replay.json").to_string_lossy())
        );
        let entry = &manifest["archives"][0];
        let keys: Vec<&String> = entry.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "relativePath",
                "livePath",
                "backupPath",
                "sha256Before",
                "sha256After"
            ]
        );
        assert_eq!(entry["relativePath"], UPDATE);
        assert_eq!(
            entry["livePath"],
            json!(game
                .game
                .join("update")
                .join("update.rpf")
                .to_string_lossy())
        );
        // разделители в пути копии смешанные: `\` до id, потом `/` из относительного пути
        assert_eq!(
            entry["backupPath"],
            json!(format!(
                "{}{}{UPDATE}",
                game.points.join(ID).display(),
                std::path::MAIN_SEPARATOR
            ))
        );
        // оба отпечатка в описи прописными, в ответе команды строчные как были
        assert_eq!(entry["sha256Before"], json!(original.to_uppercase()));
        assert_eq!(entry["sha256After"], json!(after.to_uppercase()));

        // ход: копии, сборка, фиксация
        assert_eq!(
            stages(&lines),
            [
                "backup", "prepare", "read", "compose", "prepare", "compose", "verify", "read",
                "commit"
            ]
        );
    }

    #[test]
    fn new_ids_are_made_when_none_are_given_and_the_variants_of_a_build_install() {
        let game = Game::new();
        // ops_random_ids
        let mut block = game.block();
        block.point_id = None;
        block.stage_name = None;
        let answer = game.go(&game.request(&Game::replace_a(), block)).unwrap();
        let id = answer["id"].as_str().unwrap();
        assert_eq!(id.len(), 38);
        assert!(id.starts_with("rpf-") && game.points.join(id).is_dir());
        assert_eq!(
            answer["restoreRoot"],
            json!(game.points.join(id).to_string_lossy())
        );

        // ops_base_from_request: основа названа запросом, в игре стоит другая сборка
        let game = Game::new();
        write_tree(&replacement_tree(), &game.live(UPDATE));
        let mut request = game.request(&[import("x64/a/z.txt", "small.txt")], game.block());
        request.base = Some(game.kit.base("b1"));
        game.go(&request).unwrap();
        let lines = tree_lines(&game.live(UPDATE));
        assert!(lines.contains(&"x64/a/z.txt  bin cmp=1 enc=0 unc=50 sha=*".to_owned()));
        assert!(lines.contains(&"b.txt  bin cmp=0 enc=0 unc=700 sha=*".to_owned()));
        assert!(!lines.iter().any(|line| line.starts_with("new_inside.xml")));

        // ops_no_operations: пустой список — архив собирается заново и равен прежнему
        let game = Game::new();
        let original = sha_of(&game.live(UPDATE));
        let answer = game.go(&game.request(&[], game.block())).unwrap();
        assert_eq!(answer["operations"], 0);
        assert_eq!(answer["sha256"], json!(original));
        assert_eq!(sha_of(&game.live(UPDATE)), original);

        // ops_create_mode, ops_target_name
        let game = Game::new();
        let mut request = game.request(&Game::replace_a(), game.block());
        request.mode = Mode::Create;
        assert_eq!(game.go(&request).unwrap()["created"], false);
        let game = Game::new();
        let mut request = game.request(&Game::replace_a(), game.block());
        request.archive_target = "update:/x64/astral/other.rpf".to_owned();
        assert!(game.go(&request).is_ok());
        assert!(Archive::open_path(&game.live(UPDATE), None).is_ok());

        // ops_delete: удаление и импорт, число записей — две
        let game = Game::new();
        let answer = game
            .go(&game.request(
                &[delete("b.txt"), import("x64/a/z.txt", "small.txt")],
                game.block(),
            ))
            .unwrap();
        assert_eq!(answer["operations"], 2);
        let lines = tree_lines(&game.live(UPDATE));
        assert!(!lines.iter().any(|line| line.starts_with("b.txt")));
        assert!(lines.iter().any(|line| line.starts_with("x64/a/z.txt")));

        // ops_entries_raw: пробелы и обратные косые в записи
        let game = Game::new();
        let answer = game
            .go(&game.request(&[replace(" x64\\a\\a.ydd ", "new.ydd")], game.block()))
            .unwrap();
        assert_eq!(answer["operations"], 1);
    }

    #[test]
    fn an_archive_in_a_subfolder_of_the_game_is_installed_by_its_relative_path() {
        // ops_in_subfolder_game
        let game = Game::new();
        let dlc = game.live("update/x64/dlcpacks/mine/dlc.rpf");
        fs::create_dir_all(dlc.parent().unwrap()).unwrap();
        fs::copy(game.kit.base("b1"), &dlc).unwrap();
        let mut block = game.block();
        block.archive = "update/x64/dlcpacks/mine/dlc.rpf".to_owned();
        let answer = game.go(&game.request(&Game::replace_a(), block)).unwrap();
        assert_eq!(answer["archive"], "update/x64/dlcpacks/mine/dlc.rpf");
        assert!(game
            .points
            .join(ID)
            .join("update/x64/dlcpacks/mine/dlc.rpf")
            .is_file());
    }

    // ----- готовые архивы -----

    #[test]
    fn a_prebuilt_archive_is_copied_next_to_the_live_one_and_swapped_in() {
        // prebuilt_single
        let game = Game::new();
        let original = sha_of(&game.live(UPDATE));
        let (progress, lines) = recorded();
        let answer = game
            .go_with(
                &game.request(&[], game.prebuilt_block(UPDATE)),
                None,
                &progress,
            )
            .unwrap();
        let sha = game.prebuilt_sha();
        assert_eq!(
            answer,
            json!({
                "status": "ready",
                "mode": "compose-install",
                "id": ID,
                "restoreRoot": game.points.join(ID).to_string_lossy(),
                "archive": UPDATE,
                "created": false,
                "archives": [{ "archive": UPDATE, "created": false, "sha256": sha }],
                "sha256": sha,
                "operations": null,
                "timings": null,
            })
        );
        assert_eq!(sha_of(&game.live(UPDATE)), sha);
        assert_eq!(sha_of(&game.points.join(ID).join(UPDATE)), original);
        // файл остался, а время изменения живого архива — время готового файла
        let source = game.kit.source("prebuilt.rpf");
        assert!(source.is_file());
        assert_eq!(
            fs::metadata(&source).unwrap().modified().unwrap(),
            fs::metadata(game.live(UPDATE)).unwrap().modified().unwrap()
        );
        assert_eq!(stages(&lines), ["backup", "commit"]);
        assert!(game
            .game_listing()
            .iter()
            .all(|entry| !entry.contains("astral-stage")));
    }

    #[test]
    fn a_missing_archive_is_created_and_the_point_records_it_as_absent() {
        // prebuilt_create
        let game = Game::new();
        let mut block = game.prebuilt_block(DLC);
        block.create = true;
        let answer = game.go(&game.request(&[], block)).unwrap();
        assert_eq!(answer["created"], true);
        assert_eq!(answer["archives"][0]["created"], true);
        assert_eq!(sha_of(&game.live(DLC)), game.prebuilt_sha());
        // копии «до» нет, в описи пустой отпечаток «до»
        assert!(!game.points.join(ID).join(DLC).exists());
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(game.points.join(ID).join("restore.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["archives"][0]["sha256Before"], "");
        assert_eq!(
            manifest["archives"][0]["sha256After"],
            json!(game.prebuilt_sha().to_uppercase())
        );
        assert_eq!(answer["archives"][0]["sha256"], json!(game.prebuilt_sha()));
        // откат такой точки удаляет созданный архив только при отказе установки
        assert_eq!(
            listing(&game.points),
            [
                format!("{ID}/"),
                format!("{ID}/replay.json ({} Б)", REPLAY_TEXT.len()),
                format!(
                    "{ID}/restore.json ({} Б)",
                    fs::metadata(game.points.join(ID).join("restore.json"))
                        .unwrap()
                        .len()
                )
            ]
        );
    }

    #[test]
    fn several_prebuilt_archives_share_one_point_and_one_swap() {
        // prebuilt_multi: живой и создаваемый
        let game = Game::new();
        let original = sha_of(&game.live(UPDATE));
        let mut block = game.block();
        block.targets = vec![
            game.target(UPDATE, false, Some(".astral-stage-probe-0001")),
            game.target(DLC, true, Some(".astral-stage-probe-0002")),
        ];
        let (progress, lines) = recorded();
        let answer = game
            .go_with(&game.request(&[], block), None, &progress)
            .unwrap();
        let sha = game.prebuilt_sha();
        assert_eq!(answer["archive"], UPDATE);
        assert_eq!(answer["created"], false);
        assert_eq!(
            answer["archives"],
            json!([
                { "archive": UPDATE, "created": false, "sha256": sha },
                { "archive": DLC, "created": true, "sha256": sha },
            ])
        );
        assert_eq!(answer["sha256"], json!(sha));
        assert_eq!(answer["operations"], Value::Null);
        assert_eq!(sha_of(&game.points.join(ID).join(UPDATE)), original);
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(game.points.join(ID).join("restore.json")).unwrap(),
        )
        .unwrap();
        let described: Vec<&str> = manifest["archives"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["relativePath"].as_str().unwrap())
            .collect();
        assert_eq!(described, [UPDATE, DLC]);
        assert_eq!(manifest["archives"][1]["sha256Before"], "");
        assert_eq!(stages(&lines), ["backup", "commit"]);

        // prebuilt_multi_existing: два живых архива
        let game = Game::new();
        let common_original = sha_of(&game.live(COMMON));
        let mut block = game.block();
        block.targets = vec![
            game.target(UPDATE, false, None),
            game.target(COMMON, false, None),
        ];
        game.go(&game.request(&[], block)).unwrap();
        assert_eq!(sha_of(&game.live(COMMON)), game.prebuilt_sha());
        assert_eq!(sha_of(&game.points.join(ID).join(COMMON)), common_original);
    }

    #[test]
    fn a_game_folder_with_cyrillic_and_a_space_is_written_into_the_manifest_escaped() {
        // unicode_paths
        let game = Game::new();
        let moved = game.kit.dir.path().join("Игры").join("GTA V");
        fs::create_dir_all(moved.parent().unwrap()).unwrap();
        fs::rename(&game.game, &moved).unwrap();
        let mut block = game.prebuilt_block(UPDATE);
        block.game_root = moved.clone();
        game.go(&game.request(&[], block)).unwrap();
        let text = fs::read_to_string(game.points.join(ID).join("restore.json")).unwrap();
        assert!(text.is_ascii());
        assert!(
            text.contains("\\\\\\u0418\\u0433\\u0440\\u044B\\\\GTA V"),
            "{text}"
        );
        assert_eq!(sha_of(&moved.join(UPDATE)), game.prebuilt_sha());
    }

    // ----- проверки до первой записи -----

    #[test]
    fn the_point_id_is_checked_by_its_pattern() {
        // check_ids
        let game = Game::new();
        let long = "a".repeat(80);
        let table: Vec<(String, bool)> = vec![
            (String::new(), false),
            ("../x".into(), false),
            ("a b".into(), false),
            ("a/b".into(), false),
            ("ÿ".into(), false),
            ("id.with.dot".into(), false),
            (long, true),
            ("a".repeat(81), false),
            ("ok_id-1".into(), true),
        ];
        for (id, good) in table {
            let mut block = game.block();
            block.point_id = Some(id.clone());
            block.stage_name = None;
            let outcome = game.go(&game.request(&Game::replace_a(), block));
            if good {
                assert_eq!(outcome.unwrap()["id"], json!(id));
            } else {
                same(outcome, "ArgumentException", "Install point id is invalid.");
            }
        }
    }

    #[test]
    fn the_stage_name_is_checked_by_its_pattern() {
        // check_stages
        let game = Game::new();
        let table: Vec<(String, bool)> = vec![
            (String::new(), false),
            ("plain".into(), false),
            (".astral-stage-".into(), false),
            (".astral-stage-a/b".into(), false),
            (".astral-stage-é".into(), false),
            (".astral-stage-a b".into(), false),
            ("../.astral-stage-x".into(), false),
            (".astral-stage-ok.1_2-3".into(), true),
            (".ASTRAL-STAGE-x".into(), false),
            (format!(".astral-stage-{}", "a".repeat(96 - 14)), true),
            (format!(".astral-stage-{}", "a".repeat(97 - 14)), false),
        ];
        for (name, good) in table {
            let mut block = game.block();
            block.point_id = None;
            block.stage_name = Some(name.clone());
            let outcome = game.go(&game.request(&Game::replace_a(), block));
            if good {
                assert!(outcome.is_ok(), "{name}");
            } else {
                same(
                    outcome,
                    "ArgumentException",
                    "Install stage name is invalid.",
                );
            }
        }
    }

    /// Что должна ответить установка на настройку блока.
    enum Verdict {
        Installed { archives: usize },
        Refused(&'static str, String),
    }

    fn refused(code: &'static str, message: &str) -> Verdict {
        Verdict::Refused(code, message.to_owned())
    }

    #[test]
    fn targets_are_checked_before_anything_is_written() {
        // check_targets
        type Setup = Box<dyn Fn(&Game) -> Install>;
        let ops_block = |archive: &'static str| -> Setup {
            Box::new(move |game: &Game| {
                let mut block = game.block();
                block.archive = archive.to_owned();
                block
            })
        };
        let prebuilt_block = |tweak: fn(&mut Install, &Game)| -> Setup {
            Box::new(move |game: &Game| {
                let mut block = game.prebuilt_block(UPDATE);
                tweak(&mut block, game);
                block
            })
        };
        let missing = "Target RPF does not exist: update/none.rpf";
        let needs_sha = "Install prebuilt archive needs its sha256.";
        let cases: Vec<(&str, Setup, Verdict)> = vec![
            (
                "архива нет",
                ops_block("update/none.rpf"),
                refused("FileNotFoundException", missing),
            ),
            (
                "архива нет, create, нет готового файла",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.archive = "update/none.rpf".to_owned();
                    block.create = true;
                    block
                }),
                refused(
                    "ArgumentException",
                    "A missing archive can only be created from a prebuilt file.",
                ),
            ),
            (
                "на месте архива каталог",
                ops_block("update"),
                refused("FileNotFoundException", "Target RPF does not exist: update"),
            ),
            (
                "под файлом архива",
                ops_block("update/update.rpf/sub.rpf"),
                refused(
                    "FileNotFoundException",
                    "Target RPF does not exist: update/update.rpf/sub.rpf",
                ),
            ),
            (
                "выход за папку игры",
                ops_block("../evil.rpf"),
                refused("InvalidDataException", "Unsafe relative path: ../evil.rpf"),
            ),
            (
                "ведущая косая срезается",
                ops_block("/update/update.rpf"),
                Verdict::Installed { archives: 1 },
            ),
            (
                "диск в середине пути",
                ops_block("a/C:/b.rpf"),
                refused(
                    "InvalidDataException",
                    "Path escapes its allowed directory: a/C:/b.rpf",
                ),
            ),
            (
                "пустой путь",
                ops_block(""),
                refused("InvalidDataException", "Unsafe relative path: "),
            ),
            (
                "обратные косые годятся",
                ops_block("update\\update.rpf"),
                Verdict::Installed { archives: 1 },
            ),
            (
                "папка игры относительная",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.game_root = PathBuf::from("relative-game-folder");
                    block
                }),
                refused(
                    "FileNotFoundException",
                    "Target RPF does not exist: update/update.rpf",
                ),
            ),
            (
                "папки игры нет",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.game_root = game.game.join("nope");
                    block
                }),
                refused(
                    "FileNotFoundException",
                    "Target RPF does not exist: update/update.rpf",
                ),
            ),
            (
                "папка игры пустая",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.game_root = PathBuf::new();
                    block
                }),
                refused("ArgumentException", "The path is empty."),
            ),
            (
                "отпечатка нет",
                prebuilt_block(|block, _| block.sha256 = None),
                refused("ArgumentException", needs_sha),
            ),
            (
                "63 знака",
                prebuilt_block(|block, _| block.sha256 = Some("a".repeat(63))),
                refused("ArgumentException", needs_sha),
            ),
            (
                "65 знаков",
                prebuilt_block(|block, _| block.sha256 = Some("a".repeat(65))),
                refused("ArgumentException", needs_sha),
            ),
            (
                "не шестнадцатеричные",
                prebuilt_block(|block, _| block.sha256 = Some("g".repeat(64))),
                refused("ArgumentException", needs_sha),
            ),
            (
                "пробел на конце",
                prebuilt_block(|block, game| {
                    block.sha256 = Some(format!("{} ", &game.prebuilt_sha()[..63]))
                }),
                refused("ArgumentException", needs_sha),
            ),
            (
                "пустой отпечаток",
                prebuilt_block(|block, _| block.sha256 = Some(String::new())),
                refused("ArgumentException", needs_sha),
            ),
            (
                "отпечаток есть, готового файла нет: сборка из живого",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.sha256 = Some(game.prebuilt_sha());
                    block
                }),
                Verdict::Installed { archives: 1 },
            ),
            (
                "один архив дважды",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.targets = vec![
                        game.target(UPDATE, false, Some(".astral-stage-one")),
                        game.target(UPDATE, false, Some(".astral-stage-two")),
                    ];
                    block
                }),
                refused("ArgumentException", "The same archive is listed twice."),
            ),
            (
                "одинаковые имена стейджей в одной папке",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    let second = "update/other.rpf";
                    fs::copy(game.live(UPDATE), game.live(second)).unwrap();
                    block.targets = vec![
                        game.target(UPDATE, false, Some(".astral-stage-same")),
                        game.target(second, false, Some(".astral-stage-same")),
                    ];
                    block
                }),
                refused(
                    "ArgumentException",
                    "Install stage names collide in one folder.",
                ),
            ),
            (
                "одинаковые имена стейджей в разных папках",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.targets = vec![
                        game.target(UPDATE, false, Some(".astral-stage-same")),
                        game.target(COMMON, false, Some(".astral-stage-same")),
                    ];
                    block
                }),
                Verdict::Installed { archives: 2 },
            ),
            (
                "несколько архивов без готовых файлов",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    let mut bare = game.target(COMMON, false, None);
                    bare.prebuilt = None;
                    block.targets = vec![game.target(UPDATE, false, None), bare];
                    block
                }),
                refused(
                    "ArgumentException",
                    "Several archives in one point are installed only from prebuilt files.",
                ),
            ),
            (
                "несколько архивов, второго нет",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.targets = vec![
                        game.target(UPDATE, false, None),
                        game.target("update/none.rpf", false, None),
                    ];
                    block
                }),
                refused("FileNotFoundException", missing),
            ),
            (
                "и archive, и targets: берутся targets",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.archive = "update/ignored.rpf".to_owned();
                    block.targets = vec![game.target(UPDATE, false, None)];
                    block
                }),
                Verdict::Installed { archives: 1 },
            ),
            (
                "плохое имя стейджа в цели",
                Box::new(|game: &Game| {
                    let mut block = game.block();
                    block.targets = vec![game.target(UPDATE, false, Some("bad-name"))];
                    block
                }),
                refused("ArgumentException", "Install stage name is invalid."),
            ),
        ];
        for (label, setup, verdict) in cases {
            let game = Game::new();
            let block = setup(&game);
            let before = game.game_listing();
            let outcome = game.go(&game.request(&Game::replace_a(), block));
            match verdict {
                Verdict::Installed { archives } => {
                    let answer = outcome.unwrap_or_else(|error| panic!("{label}: {error}"));
                    assert_eq!(answer["created"], false, "{label}");
                    assert_eq!(
                        answer["archives"].as_array().unwrap().len(),
                        archives,
                        "{label}"
                    );
                }
                Verdict::Refused(code, message) => {
                    let (found_code, found_message) = failure(outcome);
                    assert_eq!(
                        (found_code.as_str(), found_message.as_str()),
                        (code, message.as_str()),
                        "{label}"
                    );
                    assert!(
                        !game.points.exists(),
                        "{label}: каталог точек не должен появиться"
                    );
                    assert_eq!(game.game_listing(), before, "{label}");
                }
            }
        }
    }

    #[test]
    fn a_request_without_an_install_block_is_an_internal_error() {
        // no_install_block
        let game = Game::new();
        let request = game.kit.request(None, &Game::replace_a(), Path::new(""));
        same(
            game.go(&request),
            "InternalError",
            "compose install mode without an install block",
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_same_archive_in_another_case_is_refused_like_a_plain_repeat() {
        // dup_case: на файловой системе Windows это один файл, и до первой
        // записи он считается повтором независимо от регистра и разделителей
        for second in [
            "UPDATE/update.rpf",
            "update/UPDATE.RPF",
            "Update\\Update.rpf",
            "update\\update.rpf",
        ] {
            let game = Game::new();
            let before = game.game_listing();
            let mut block = game.block();
            block.targets = vec![
                game.target(UPDATE, false, None),
                game.target(second, false, None),
            ];
            same(
                game.go(&game.request(&[], block)),
                "ArgumentException",
                "The same archive is listed twice.",
            );
            assert!(!game.points.exists(), "{second}");
            assert_eq!(game.game_listing(), before, "{second}");
        }
    }

    // ----- отказы после создания точки: игра остаётся прежней -----

    /// Игра до установки и после отказа: список файлов, живые архивы, точки.
    fn untouched(game: &Game, before: &[String], live_sha: &str) {
        assert_eq!(game.game_listing(), before);
        assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
        assert_eq!(game.points_listing(), Vec::<String>::new());
    }

    #[test]
    fn a_prebuilt_file_that_is_missing_or_wrong_stops_the_install_and_removes_the_point() {
        let game = Game::new();
        let before = game.game_listing();
        let live_sha = sha_of(&game.live(UPDATE));
        // prebuilt_missing: нет файла, относительный путь, каталог
        let absent = game
            .kit
            .dir
            .path()
            .join("absent.rpf")
            .to_string_lossy()
            .into_owned();
        let folder = game.kit.src.to_string_lossy().into_owned();
        for path in [absent, "relative/composed.rpf".to_owned(), folder] {
            let mut block = game.prebuilt_block(UPDATE);
            block.prebuilt = Some(path.clone());
            let (progress, lines) = recorded();
            let outcome = game.go_with(&game.request(&[], block), None, &progress);
            same(
                outcome,
                "FileNotFoundException",
                &format!("Prebuilt archive does not exist: {path}"),
            );
            assert_eq!(stages(&lines), ["backup"]);
            untouched(&game, &before, &live_sha);
        }
        // prebuilt_bad_hash
        let mut block = game.prebuilt_block(UPDATE);
        block.sha256 = Some(ZERO_SHA.to_owned());
        same(
            game.go(&game.request(&[], block)),
            "InvalidOperationException",
            "Собранный архив не совпал со своим отпечатком при копировании — установка отменена.",
        );
        untouched(&game, &before, &live_sha);
    }

    #[test]
    fn a_failed_build_from_operations_removes_the_point_and_the_stage() {
        let game = Game::new();
        let before = game.game_listing();
        let live_sha = sha_of(&game.live(UPDATE));
        // ops_failure
        let (progress, lines) = recorded();
        let request = game.request(&[replace("x64/a/none.ydd", "new.ydd")], game.block());
        same(
            game.go_with(&request, None, &progress),
            "InvalidDataException",
            "RPF operation failed at x64/a/none.ydd: RPF entry not found: x64/a/none.ydd",
        );
        assert_eq!(stages(&lines), ["backup", "prepare", "read", "compose"]);
        untouched(&game, &before, &live_sha);
        // ops_write_failure
        let (progress, lines) = recorded();
        let request = game.request(&[replace("x64/a/res.ytd", "small.txt")], game.block());
        same(
            game.go_with(&request, None, &progress),
            "InvalidDataException",
            "res.ytd: this is not a resource file (RSC7).",
        );
        assert_eq!(
            stages(&lines),
            ["backup", "prepare", "read", "compose", "prepare"]
        );
        untouched(&game, &before, &live_sha);
        // finalizer_noop: доводчик-пустышка не шифрует оглавление
        let (progress, lines) = recorded();
        let spy = Spy::new();
        let mut request = game.request(&Game::replace_a(), game.block());
        // без archiveTarget имя берётся у файла стейджа, то есть у живого архива
        request.archive_target = String::new();
        same(
            game.go_with(&request, Some(&spy), &progress),
            "InvalidDataException",
            "RPF finalization failed: update.rpf",
        );
        assert_eq!(spy.names(), ["update.rpf"]);
        assert_eq!(
            stages(&lines),
            ["backup", "prepare", "read", "compose", "prepare", "compose", "verify"]
        );
        untouched(&game, &before, &live_sha);
    }

    #[test]
    fn cancel_stops_a_build_from_operations_and_a_prebuilt_copy_before_the_swap() {
        // cancel_ops
        let game = Game::new();
        let before = game.game_listing();
        let live_sha = sha_of(&game.live(UPDATE));
        let (progress, lines) = recorded();
        progress.cancel().request();
        same(
            game.go_with(
                &game.request(&Game::replace_a(), game.block()),
                None,
                &progress,
            ),
            "Cancelled",
            "Отменено.",
        );
        assert_eq!(stages(&lines), ["backup", "prepare", "read", "compose"]);
        untouched(&game, &before, &live_sha);
        // cancel_prebuilt: раньше отмена здесь не проверялась и установка шла
        // целиком; теперь она проверяется до копии и до подмены, игра остаётся
        // такой, какой была, а без отмены та же установка проходит целиком
        let progress = Progress::silent();
        progress.cancel().request();
        let request = game.request(&[], game.prebuilt_block(UPDATE));
        same(
            game.go_with(&request, None, &progress),
            "Cancelled",
            "Отменено.",
        );
        untouched(&game, &before, &live_sha);
        let request = game.request(&[], game.prebuilt_block(UPDATE));
        assert!(game.go(&request).is_ok());
        assert_eq!(sha_of(&game.live(UPDATE)), game.prebuilt_sha());
    }

    #[test]
    fn a_created_archive_whose_fingerprint_is_wrong_leaves_no_empty_folders() {
        // prebuilt_create_fail, multi_fail_second: папки DLC, созданные ради
        // стейджа, после отказа убираются
        for with_live_first in [false, true] {
            let game = Game::new();
            let live_sha = sha_of(&game.live(UPDATE));
            let mut dlc = game.target(DLC, true, None);
            dlc.sha256 = Some(ZERO_SHA.to_owned());
            let mut block = game.block();
            block.targets = if with_live_first {
                vec![
                    game.target(UPDATE, false, Some(".astral-stage-probe-0001")),
                    dlc,
                ]
            } else {
                vec![dlc]
            };
            same(
                game.go(&game.request(&[], block)),
                "InvalidOperationException",
                "Собранный архив не совпал со своим отпечатком при копировании — установка отменена.",
            );
            assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
            assert_eq!(game.points_listing(), Vec::<String>::new());
            let left: Vec<String> = game
                .game_listing()
                .into_iter()
                .filter(|entry| entry.starts_with("update/x64") || entry.contains("astral-stage"))
                .collect();
            assert_eq!(left, Vec::<String>::new());
        }
    }

    #[test]
    fn a_refusal_removes_only_the_dlc_folders_it_created() {
        // существовавшая папка и папка с чужим файлом остаются, созданные уходят
        let game = Game::new();
        let packs = game.live("update/x64/dlcpacks");
        fs::create_dir_all(&packs).unwrap();
        fs::write(packs.join("keep.txt"), b"keep").unwrap();
        let mut dlc = game.target(DLC, true, None);
        dlc.sha256 = Some(ZERO_SHA.to_owned());
        let mut block = game.block();
        block.targets = vec![dlc];
        failure(game.go(&game.request(&[], block)));
        let left: Vec<String> = game
            .game_listing()
            .into_iter()
            .filter(|entry| entry.starts_with("update/x64"))
            .collect();
        assert_eq!(
            left,
            [
                "update/x64/",
                "update/x64/dlcpacks/",
                "update/x64/dlcpacks/keep.txt (4 Б)"
            ]
        );

        // существующая пустая папка тоже остаётся: её создала не установка
        let game = Game::new();
        fs::create_dir_all(game.live("update/x64")).unwrap();
        let mut dlc = game.target(DLC, true, None);
        dlc.sha256 = Some(ZERO_SHA.to_owned());
        let mut block = game.block();
        block.targets = vec![dlc];
        failure(game.go(&game.request(&[], block)));
        let left: Vec<String> = game
            .game_listing()
            .into_iter()
            .filter(|entry| entry.starts_with("update/x64"))
            .collect();
        assert_eq!(left, ["update/x64/"]);
    }

    #[test]
    fn a_blocked_copy_or_replay_file_leaves_the_foreign_things_in_the_point_alone() {
        // backup_fails: на месте каталога копии лежит чужой файл, он остаётся
        let game = Game::new();
        let before = game.game_listing();
        let live_sha = sha_of(&game.live(UPDATE));
        fs::create_dir_all(game.points.join(ID)).unwrap();
        fs::write(game.points.join(ID).join("update"), b"in the way").unwrap();
        let (progress, lines) = recorded();
        let (code, message) = failure(game.go_with(
            &game.request(&Game::replace_a(), game.block()),
            None,
            &progress,
        ));
        assert_eq!(code, "IOException");
        assert!(message.ends_with("(os error 183)"), "{message}");
        assert_eq!(stages(&lines), ["backup"]);
        assert_eq!(game.game_listing(), before);
        assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
        assert_eq!(
            game.points_listing(),
            [format!("{ID}/"), format!("{ID}/update (10 Б)")]
        );
        // replay_fails: на месте replay.json каталог, он тоже остаётся, а копия
        // «до» и пустая папка под неё, которые сделала установка, уходят
        fs::remove_file(game.points.join(ID).join("update")).unwrap();
        fs::create_dir_all(game.points.join(ID).join("replay.json")).unwrap();
        let (code, message) = failure(game.go(&game.request(&Game::replace_a(), game.block())));
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"), "{message}");
        assert_eq!(game.game_listing(), before);
        assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
        assert_eq!(
            game.points_listing(),
            [format!("{ID}/"), format!("{ID}/replay.json/")]
        );
    }

    #[test]
    fn a_live_archive_that_changes_after_the_copy_stops_the_install_before_the_swap() {
        // live_changed: сразу после копии «до» в живой архив дописывают байты
        let game = Game::new();
        let live = game.live(UPDATE);
        let grown = fs::metadata(&live).unwrap().len() + 5;
        let target = live.clone();
        let done = std::sync::atomic::AtomicBool::new(false);
        let progress = Progress::with_sink(move |line| {
            let value: Value = serde_json::from_str(line).unwrap();
            let step = &value["progress"];
            let finished = step["phase"] == "backup"
                && step["copiedBytes"] == step["totalBytes"]
                && step["totalBytes"] != 0;
            if finished && !done.swap(true, std::sync::atomic::Ordering::SeqCst) {
                let mut file = fs::OpenOptions::new().append(true).open(&target).unwrap();
                std::io::Write::write_all(&mut file, b"+LATE").unwrap();
            }
        });
        same(
            game.go_with(&game.request(&[], game.prebuilt_block(UPDATE)), None, &progress),
            "InvalidOperationException",
            "update/update.rpf изменился, пока шла установка: его трогал другой процесс (игра, проверка файлов, другой мод). Ничего не подменено — повторите установку.",
        );
        assert_eq!(fs::metadata(&live).unwrap().len(), grown);
        assert_eq!(game.points_listing(), Vec::<String>::new());
        assert!(game
            .game_listing()
            .iter()
            .all(|entry| !entry.contains("astral-stage")));
    }

    #[test]
    fn a_refusal_before_the_swap_keeps_a_foreign_file_in_a_stage_that_was_there() {
        // отказ на сверке перед подменой (тот же приём, что в live_changed)
        let game = Game::new();
        let stage = game.live("update").join(STAGE);
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("foreign.txt"), b"foreign").unwrap();
        let live = game.live(UPDATE);
        let done = std::sync::atomic::AtomicBool::new(false);
        let progress = Progress::with_sink(move |line| {
            let value: Value = serde_json::from_str(line).unwrap();
            let step = &value["progress"];
            let finished = step["phase"] == "backup"
                && step["copiedBytes"] == step["totalBytes"]
                && step["totalBytes"] != 0;
            if finished && !done.swap(true, std::sync::atomic::Ordering::SeqCst) {
                let mut file = fs::OpenOptions::new().append(true).open(&live).unwrap();
                std::io::Write::write_all(&mut file, b"+LATE").unwrap();
            }
        });
        let (code, _) = failure(game.go_with(
            &game.request(&[], game.prebuilt_block(UPDATE)),
            None,
            &progress,
        ));
        assert_eq!(code, "InvalidOperationException");
        let kept: Vec<String> = fs::read_dir(&stage)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(kept, ["foreign.txt"]);
        assert_eq!(game.points_listing(), Vec::<String>::new());
    }

    #[test]
    fn a_manifest_that_cannot_be_written_waits_ten_seconds_and_swaps_nothing() {
        // manifest_fails: имя restore.json занято каталогом (чужим, он остаётся)
        let game = Game::new();
        let before = game.game_listing();
        let live_sha = sha_of(&game.live(UPDATE));
        fs::create_dir_all(game.points.join(ID).join("restore.json")).unwrap();
        let started = Instant::now();
        let (code, message) = failure(game.go(&game.request(&[], game.prebuilt_block(UPDATE))));
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"), "{message}");
        assert!(started.elapsed() >= Duration::from_secs(9));
        assert_eq!(game.game_listing(), before);
        assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
        assert_eq!(
            game.points_listing(),
            [format!("{ID}/"), format!("{ID}/restore.json/")]
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_busy_second_archive_puts_the_first_one_back() {
        // swap_fails_second: common.rpf открыт с долей «только чтение»
        use std::os::windows::fs::OpenOptionsExt;
        let game = Game::new();
        let live_sha = sha_of(&game.live(UPDATE));
        let common_sha = sha_of(&game.live(COMMON));
        let hold = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(game.live(COMMON))
            .unwrap();
        // в папке точки лежит чужой файл: он переживёт откат, а опись, запись
        // переустановки и копии «до» с их папками уйдут
        fs::create_dir_all(game.points.join(ID)).unwrap();
        fs::write(game.points.join(ID).join("note.txt"), b"my note").unwrap();
        let mut block = game.block();
        block.targets = vec![
            game.target(UPDATE, false, None),
            game.target(COMMON, false, None),
        ];
        let started = Instant::now();
        let (code, message) = failure(game.go(&game.request(&[], block)));
        drop(hold);
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"), "{message}");
        assert!(started.elapsed() >= Duration::from_secs(9));
        assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
        assert_eq!(sha_of(&game.live(COMMON)), common_sha);
        assert_eq!(
            game.points_listing(),
            [format!("{ID}/"), format!("{ID}/note.txt (7 Б)")]
        );
        assert!(game
            .game_listing()
            .iter()
            .all(|entry| !entry.contains("astral-stage")));
    }

    // ----- место на диске (space_short) -----

    #[test]
    fn a_prebuilt_file_larger_than_the_free_space_stops_the_install_before_any_write() {
        let game = Game::new();
        let giant = game.kit.dir.path().join("giant.rpf");
        // 15 ТиБ; на NTFS файл сначала помечается разреженным, а если файловая
        // система такой длины не даёт, проверять нечего
        let length: u64 = 16_492_674_416_640;
        let file = fs::File::create(&giant).unwrap();
        #[cfg(windows)]
        let _ = std::process::Command::new("fsutil")
            .args(["sparse", "setflag"])
            .arg(&giant)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let made = file.set_len(length);
        drop(file);
        if made.is_err() {
            let _ = fs::remove_file(&giant);
            return;
        }
        let mut block = game.prebuilt_block(UPDATE);
        block.prebuilt = Some(giant.to_string_lossy().into_owned());
        let before = game.game_listing();
        let outcome = game.go(&game.request(&[], block));
        let _ = fs::remove_file(&giant);
        let (code, message) = failure(outcome);
        assert_eq!(code, "InvalidOperationException");
        assert!(
            message.starts_with(&format!(
                "Not enough disk space on {}: need 15728896 MiB, free ",
                game.points.display()
            )),
            "{message}"
        );
        assert!(
            message.ends_with("Free some space and try again."),
            "{message}"
        );
        assert!(!game.points.exists());
        assert_eq!(
            game.game_listing()
                .into_iter()
                .filter(|entry| !entry.starts_with("giant"))
                .collect::<Vec<_>>(),
            before
        );
    }

    // ----- каталог точек и чужие файлы на месте -----

    #[test]
    fn the_points_folder_may_be_missing_with_all_its_parents_but_not_lie_under_a_file() {
        // points_in_missing_parent
        let mut game = Game::new();
        game.points = game.kit.dir.path().join("not").join("yet").join("points");
        let answer = game
            .go(&game.request(&[], game.prebuilt_block(UPDATE)))
            .unwrap();
        assert_eq!(
            answer["restoreRoot"],
            json!(game.points.join(ID).to_string_lossy())
        );
        assert!(game.points.is_dir());
        // points_under_file
        let game = Game::new();
        let file = game.kit.dir.path().join("a-file");
        fs::write(&file, b"x").unwrap();
        let mut game = game;
        game.points = file.join("points");
        let before = game.game_listing();
        let (code, message) = failure(game.go(&game.request(&[], game.prebuilt_block(UPDATE))));
        assert_eq!(code, "IOException");
        assert!(message.ends_with("(os error 267)"), "{message}");
        assert_eq!(game.game_listing(), before);
    }

    #[test]
    fn foreign_files_in_the_stage_and_in_the_point_survive_a_rollback() {
        // stage_exists: на успехе чужое содержимое стейджа уходит вместе с ним
        let game = Game::new();
        let stage = game.live("update").join(STAGE);
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("foreign.txt"), b"foreign").unwrap();
        assert!(game
            .go(&game.request(&[], game.prebuilt_block(UPDATE)))
            .is_ok());
        assert!(!stage.exists());
        // point_exists: чужой файл в папке точки уцелел
        let game = Game::new();
        fs::create_dir_all(game.points.join(ID)).unwrap();
        fs::write(game.points.join(ID).join("note.txt"), b"my note").unwrap();
        assert!(game
            .go(&game.request(&[], game.prebuilt_block(UPDATE)))
            .is_ok());
        assert_eq!(
            fs::read(game.points.join(ID).join("note.txt")).unwrap(),
            b"my note"
        );
        // point_exists_fail: откат убирает только то, что положила установка;
        // чужие файлы в папке точки остаются, в том числе с именами описи и
        // записи переустановки, раз до отказа установка их не писала
        let game = Game::new();
        fs::create_dir_all(game.points.join(ID)).unwrap();
        fs::write(game.points.join(ID).join("note.txt"), b"my note").unwrap();
        fs::write(game.points.join(ID).join("restore.json"), b"older").unwrap();
        fs::write(game.points.join(ID).join("replay.json"), b"older!").unwrap();
        let mut block = game.prebuilt_block(UPDATE);
        block.sha256 = Some(ZERO_SHA.to_owned());
        assert!(game.go(&game.request(&[], block)).is_err());
        assert_eq!(
            game.points_listing(),
            [
                format!("{ID}/"),
                format!("{ID}/note.txt (7 Б)"),
                format!("{ID}/replay.json (6 Б)"),
                format!("{ID}/restore.json (5 Б)"),
            ]
        );
        // а точка, которую установка создала сама, уходит целиком
        let game = Game::new();
        let mut block = game.prebuilt_block(UPDATE);
        block.sha256 = Some(ZERO_SHA.to_owned());
        assert!(game.go(&game.request(&[], block)).is_err());
        assert!(!game.points.join(ID).exists());
        // stage_exists_fail: в стейдже, который лежал до установки, остаётся
        // чужое, а готовый файл установки уходит
        let game = Game::new();
        let stage = game.live("update").join(STAGE);
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("foreign.txt"), b"foreign").unwrap();
        let mut block = game.prebuilt_block(UPDATE);
        block.sha256 = Some(ZERO_SHA.to_owned());
        assert!(game.go(&game.request(&[], block)).is_err());
        assert_eq!(
            fs::read_dir(&stage)
                .unwrap()
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            ["foreign.txt"]
        );
        // свой стейдж при отказе убирается целиком
        let game = Game::new();
        let mut block = game.prebuilt_block(UPDATE);
        block.sha256 = Some(ZERO_SHA.to_owned());
        assert!(game.go(&game.request(&[], block)).is_err());
        assert!(!game.live("update").join(STAGE).exists());
        // stage_is_file: на месте стейджа лежит файл, он остаётся
        let game = Game::new();
        let blocker = game.live("update").join(STAGE);
        fs::write(&blocker, b"a file").unwrap();
        let (code, message) = failure(game.go(&game.request(&[], game.prebuilt_block(UPDATE))));
        assert_eq!(code, "IOException");
        assert!(message.ends_with("(os error 183)"), "{message}");
        assert_eq!(fs::read(&blocker).unwrap(), b"a file");
        assert_eq!(game.points_listing(), Vec::<String>::new());
    }

    #[test]
    fn a_read_only_live_archive_is_swapped_and_the_flag_moves_to_the_new_file() {
        // readonly_ok
        let game = Game::new();
        let live = game.live(UPDATE);
        crate::archives::points::mark_readonly(&live).unwrap();
        assert!(game
            .go(&game.request(&[], game.prebuilt_block(UPDATE)))
            .is_ok());
        assert_eq!(sha_of(&live), game.prebuilt_sha());
        assert!(fs::metadata(&live).unwrap().permissions().readonly());
        crate::archives::points::clear_readonly(&live).unwrap();
        crate::archives::points::clear_readonly(&game.points.join(ID).join(UPDATE)).unwrap();
        // readonly_fail: отказ не снимает флаг
        let game = Game::new();
        let live = game.live(UPDATE);
        crate::archives::points::mark_readonly(&live).unwrap();
        let mut block = game.prebuilt_block(UPDATE);
        block.sha256 = Some(ZERO_SHA.to_owned());
        assert!(game.go(&game.request(&[], block)).is_err());
        assert!(fs::metadata(&live).unwrap().permissions().readonly());
        assert_eq!(game.points_listing(), Vec::<String>::new());
        crate::archives::points::clear_readonly(&live).unwrap();
    }

    #[test]
    fn the_point_of_a_created_archive_is_restored_by_removing_the_archive() {
        // точка из двух записей: живой архив и созданный установкой; откат
        // возвращает первый и убирает второй
        let game = Game::new();
        let original = sha_of(&game.live(UPDATE));
        let before = game.game_listing();
        let mut block = game.block();
        block.targets = vec![
            game.target(UPDATE, false, Some(".astral-stage-probe-0001")),
            game.target(DLC, true, Some(".astral-stage-probe-0002")),
        ];
        game.go(&game.request(&[], block)).unwrap();
        let manifest =
            crate::archives::points::read_manifest(&game.points.join(ID).join("restore.json"))
                .unwrap();
        assert_eq!(manifest.archives.len(), 2);
        assert_eq!(manifest.archives[1].relative_path, DLC);
        assert_eq!(manifest.archives[1].sha256_before, "");
        assert!(game.live(DLC).is_file());

        let answer =
            crate::archives::restore::restore_in(ID, &game.points, &Progress::silent()).unwrap();
        assert_eq!(answer["archives"], json!([UPDATE, DLC]));
        assert_eq!(sha_of(&game.live(UPDATE)), original);
        assert!(!game.live(DLC).exists());
        assert_eq!(game.points_listing(), Vec::<String>::new());
        // игра как до установки: пустые папки DLC тоже убраны
        assert_eq!(game.game_listing(), before);
    }

    fn manifest_of(game: &Game) -> Value {
        let text = fs::read_to_string(game.points.join(ID).join("restore.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn restore_the_point(game: &Game) {
        crate::archives::restore::restore_in(ID, &game.points, &Progress::silent()).unwrap();
    }

    #[test]
    fn the_folders_an_install_created_are_recorded_and_the_restore_removes_them() {
        let game = Game::new();
        let before = game.game_listing();
        let mut block = game.prebuilt_block(DLC);
        block.create = true;
        game.go(&game.request(&[], block)).unwrap();
        let manifest = manifest_of(&game);
        let keys: Vec<&String> = manifest.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "schemaVersion",
                "id",
                "createdAt",
                "gameRoot",
                "patch",
                "archives",
                "createdDirectories"
            ]
        );
        // от внешней к внутренней, с прямыми косыми, без служебной папки стейджа
        assert_eq!(
            manifest["createdDirectories"],
            json!([
                "update/x64",
                "update/x64/dlcpacks",
                "update/x64/dlcpacks/astral_test"
            ])
        );
        restore_the_point(&game);
        assert!(!game.live(DLC).exists());
        assert_eq!(game.game_listing(), before);
        assert_eq!(game.points_listing(), Vec::<String>::new());
    }

    #[test]
    fn a_created_folder_that_got_a_foreign_file_stays_with_its_parents() {
        let game = Game::new();
        let mut block = game.prebuilt_block(DLC);
        block.create = true;
        game.go(&game.request(&[], block)).unwrap();
        assert_eq!(
            manifest_of(&game)["createdDirectories"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        let folder = game.live("update/x64/dlcpacks/astral_test");
        fs::write(folder.join("other.txt"), b"mine").unwrap();
        restore_the_point(&game);
        // архив убран, откат успешен, папка с чужим файлом и пустые над ней остались
        assert!(!game.live(DLC).exists());
        assert_eq!(fs::read(folder.join("other.txt")).unwrap(), b"mine");
        assert!(game.live("update/x64/dlcpacks").is_dir());
        assert!(game.live("update/x64").is_dir());
        assert_eq!(game.points_listing(), Vec::<String>::new());
    }

    #[test]
    fn a_folder_that_was_there_before_the_install_is_not_recorded_and_stays() {
        let game = Game::new();
        fs::create_dir_all(game.live("update/x64")).unwrap();
        let mut block = game.prebuilt_block(DLC);
        block.create = true;
        game.go(&game.request(&[], block)).unwrap();
        assert_eq!(
            manifest_of(&game)["createdDirectories"],
            json!(["update/x64/dlcpacks", "update/x64/dlcpacks/astral_test"])
        );
        restore_the_point(&game);
        assert!(game.live("update/x64").is_dir());
        assert!(!game.live("update/x64/dlcpacks").exists());
    }

    #[test]
    fn an_install_that_created_no_folder_leaves_the_key_out_of_the_manifest() {
        let game = Game::new();
        game.go(&game.request(&[], game.prebuilt_block(UPDATE)))
            .unwrap();
        let manifest = manifest_of(&game);
        assert!(manifest.get("createdDirectories").is_none());
        let keys: Vec<&String> = manifest.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "schemaVersion",
                "id",
                "createdAt",
                "gameRoot",
                "patch",
                "archives"
            ]
        );
    }

    // ----- одна запись вместо двух: «до» рядом с живым файлом, рецепт, отмена -----

    mod one_write {
        use super::*;
        use crate::archives::compose::{parse_request, Streaming};
        use crate::archives::recipe::Recipe;
        use crate::archives::restore::restore_in;
        use crate::archives::transaction::other_volume;

        /// Точки на другом томе, пока жив охранник (по потоку).
        struct Elsewhere;

        impl Elsewhere {
            fn on() -> Elsewhere {
                other_volume::simulate(true);
                Elsewhere
            }
        }

        impl Drop for Elsewhere {
            fn drop(&mut self) {
                other_volume::simulate(false);
            }
        }

        fn aside_of(game: &Game) -> PathBuf {
            points::aside_path(&game.live(UPDATE), ID)
        }

        fn aside_block(game: &Game) -> Install {
            let mut block = game.block();
            block.options.before_aside = true;
            block
        }

        /// Запрос установки из операций поверх явной основы (нужна рецепту).
        fn over_base(game: &Game, install: Install) -> Request {
            let mut request = game.request(&Game::replace_a(), install);
            request.base = Some(game.kit.base("b1"));
            request
        }

        fn manifest(game: &Game) -> Value {
            let text = fs::read_to_string(game.points.join(ID).join("restore.json")).unwrap();
            serde_json::from_str(&text).unwrap()
        }

        fn recipe_place(game: &Game, name: &str) -> PathBuf {
            game.kit.dir.path().join("recipes").join(name)
        }

        #[test]
        fn the_before_stays_beside_the_live_archive_when_the_points_are_on_another_volume() {
            let game = Game::new();
            let original = sha_of(&game.live(UPDATE));
            let _volume = Elsewhere::on();
            let request = game.request(&Game::replace_a(), aside_block(&game));
            let answer = game.go(&request).unwrap();

            // «до» — второе имя прежнего файла рядом с живым; копии в точке нет
            assert_eq!(sha_of(&aside_of(&game)), original);
            let after = sha_of(&game.live(UPDATE));
            assert_ne!(after, original);
            assert_eq!(answer["archives"][0]["before"], "aside");
            assert_eq!(
                game.points_listing().len(),
                3,
                "{:?}: папка точки, replay.json, restore.json",
                game.points_listing()
            );
            assert!(!game.points.join(ID).join("update").exists());
            let manifest = manifest(&game);
            let entry = &manifest["archives"][0];
            assert_eq!(
                entry["backupPath"],
                json!(aside_of(&game).to_string_lossy())
            );
            assert_eq!(entry["sha256Before"], json!(original.to_uppercase()));
            assert!(game
                .game_listing()
                .iter()
                .all(|name| !name.contains("astral-stage")));

            // откат берёт «до» рядом и убирает его вместе с точкой: байт в байт
            restore_in(ID, &game.points, &Progress::silent()).unwrap();
            assert_eq!(sha_of(&game.live(UPDATE)), original);
            assert!(!aside_of(&game).exists());
            assert!(!game.points.join(ID).exists());
        }

        #[test]
        fn without_the_switch_an_install_on_another_volume_still_copies_into_the_point() {
            let game = Game::new();
            let original = sha_of(&game.live(UPDATE));
            let _volume = Elsewhere::on();
            let request = game.request(&Game::replace_a(), game.block());
            let answer = game.go(&request).unwrap();
            // прежний путь: копия в точке, ни рядом ничего, ни нового ключа в ответе
            assert_eq!(sha_of(&game.points.join(ID).join(UPDATE)), original);
            assert!(!aside_of(&game).exists());
            assert!(answer["archives"][0].get("before").is_none());
            assert!(answer.get("recipe").is_none());
        }

        #[test]
        fn on_one_volume_the_switch_still_links_into_the_point() {
            let game = Game::new();
            let original = sha_of(&game.live(UPDATE));
            let request = game.request(&Game::replace_a(), aside_block(&game));
            let answer = game.go(&request).unwrap();
            assert_eq!(answer["archives"][0]["before"], "point");
            assert_eq!(sha_of(&game.points.join(ID).join(UPDATE)), original);
            assert!(!aside_of(&game).exists());
        }

        #[test]
        fn a_refused_build_removes_the_link_beside_with_the_point() {
            let game = Game::new();
            let before = game.game_listing();
            let live_sha = sha_of(&game.live(UPDATE));
            let _volume = Elsewhere::on();
            let request = game.request(&[replace("x64/a/none.ydd", "new.ydd")], aside_block(&game));
            let (code, _) = failure(game.go(&request));
            assert_eq!(code, "InvalidDataException");
            untouched(&game, &before, &live_sha);
            assert!(!aside_of(&game).exists());
        }

        #[test]
        fn a_busy_second_archive_puts_the_first_one_back_from_the_link_beside() {
            // подмена второго падает: common.rpf открыт с долей «только чтение»
            use std::os::windows::fs::OpenOptionsExt;
            let game = Game::new();
            let update = sha_of(&game.live(UPDATE));
            let common = sha_of(&game.live(COMMON));
            let _volume = Elsewhere::on();
            let hold = fs::OpenOptions::new()
                .read(true)
                .share_mode(1)
                .open(game.live(COMMON))
                .unwrap();
            let mut block = game.block();
            block.options.before_aside = true;
            block.targets = vec![
                game.target(UPDATE, false, None),
                game.target(COMMON, false, None),
            ];
            let (code, _) = failure(game.go(&game.request(&[], block)));
            drop(hold);
            assert_eq!(code, "UnauthorizedAccessException");
            // первая цель встала на место из «до» рядом, ссылки и точка убраны
            assert_eq!(sha_of(&game.live(UPDATE)), update);
            assert_eq!(sha_of(&game.live(COMMON)), common);
            assert!(!aside_of(&game).exists());
            assert!(!points::aside_path(&game.live(COMMON), ID).exists());
            assert_eq!(game.points_listing(), Vec::<String>::new());
            assert!(game
                .game_listing()
                .iter()
                .all(|name| !name.contains("astral-")));
        }

        #[test]
        fn a_cancel_before_the_swap_leaves_the_game_byte_for_byte_and_no_leftovers() {
            // отмена приходит в двух местах: посреди записи сборки и когда сборка
            // уже проверяется (дальше только подмена, перед ней свой опрос)
            for phase in ["\"compose\"", "\"verify\""] {
                let game = Game::new();
                let before = game.game_listing();
                let live_sha = sha_of(&game.live(UPDATE));
                let _volume = Elsewhere::on();
                let slot = Arc::new(Mutex::new(None::<Progress>));
                let handle = Arc::clone(&slot);
                let progress = Progress::with_sink(move |line| {
                    if line.contains(phase) {
                        if let Some(progress) = handle.lock().unwrap().as_ref() {
                            progress.cancel().request();
                        }
                    }
                });
                *slot.lock().unwrap() = Some(progress.clone());
                let request = game.request(&Game::replace_a(), aside_block(&game));
                same(
                    game.go_with(&request, None, &progress),
                    "Cancelled",
                    "Отменено.",
                );
                untouched(&game, &before, &live_sha);
                assert!(!aside_of(&game).exists(), "{phase}");
            }
        }

        #[test]
        fn a_cancel_before_the_copy_of_a_prebuilt_archive_leaves_the_game_alone() {
            let game = Game::new();
            let before = game.game_listing();
            let live_sha = sha_of(&game.live(UPDATE));
            let progress = Progress::silent();
            progress.cancel().request();
            let request = game.request(&[], game.prebuilt_block(UPDATE));
            same(
                game.go_with(&request, None, &progress),
                "Cancelled",
                "Отменено.",
            );
            untouched(&game, &before, &live_sha);
        }

        #[test]
        fn a_cancel_stops_a_prebuilt_install_of_several_targets_before_any_lands() {
            let game = Game::new();
            let before = game.game_listing();
            let update = sha_of(&game.live(UPDATE));
            let progress = Progress::silent();
            progress.cancel().request();
            let mut block = game.block();
            block.targets = vec![
                game.target(UPDATE, false, Some(".astral-stage-probe-0001")),
                game.target(COMMON, false, Some(".astral-stage-probe-0002")),
            ];
            let request = game.request(&[], block);
            same(
                game.go_with(&request, None, &progress),
                "Cancelled",
                "Отменено.",
            );
            untouched(&game, &before, &update);
        }

        #[test]
        fn the_stream_fingerprint_works_on_the_install_from_operations() {
            let streamed_game = Game::new();
            let plain_game = Game::new();
            let run = |game: &Game, streaming: Streaming| {
                install_streaming(
                    &game.request(&Game::replace_a(), game.block()),
                    &quiet_keys(),
                    None,
                    &Progress::silent(),
                    &game.points,
                    streaming,
                )
                .unwrap()
            };
            let streamed = run(&streamed_game, Streaming::always());
            let plain = run(&plain_game, Streaming::off());
            // отпечаток собран по ходу записи, отдельного прохода нет; нуль у `hash` здесь
            // не замер, а значение, которое при `hashStreamed` 1 ставит сам код
            // (`compose_batched`: `hash_ms`), так что от нагрузки не зависит
            assert_eq!(streamed["timings"]["hashStreamed"], 1);
            assert_eq!(streamed["timings"]["hash"], 0);
            assert_eq!(plain["timings"]["hashStreamed"], 0);
            // и он тот, что у файла в игре; итоги обоих порядков равны байт в байт
            let live = sha_of(&streamed_game.live(UPDATE));
            assert_eq!(streamed["sha256"], json!(live));
            assert_eq!(plain["sha256"], json!(live));
            assert_eq!(
                fs::read(streamed_game.live(UPDATE)).unwrap(),
                fs::read(plain_game.live(UPDATE)).unwrap()
            );
        }

        #[test]
        fn a_recipe_is_saved_before_the_swap_and_rebuilds_the_same_bytes() {
            let game = Game::new();
            let original = fs::read(game.live(UPDATE)).unwrap();
            let recipe_file = recipe_place(&game, "update.recipe.json");
            let mut block = game.block();
            block.options.save_recipe = Some(recipe_file.clone());
            let answer = game.go(&over_base(&game, block)).unwrap();
            assert_eq!(answer["recipe"], json!(recipe_file.to_string_lossy()));
            let built = fs::read(game.live(UPDATE)).unwrap();
            let recipe = Recipe::load(&recipe_file).unwrap();
            assert_eq!(recipe.sha256, sha_of(&game.live(UPDATE)));
            assert_eq!(recipe.archive, UPDATE);
            assert_eq!(recipe.base, Some(game.kit.base("b1")));

            // лаунчер Rockstar вернул прежний архив: «Починить» собирает по рецепту
            restore_in(ID, &game.points, &Progress::silent()).unwrap();
            fs::write(game.live(UPDATE), &original).unwrap();
            let mut again = game.block();
            again.options.use_recipe = Some(recipe_file);
            let answer = game.go(&game.request(&[], again)).unwrap();
            assert_eq!(fs::read(game.live(UPDATE)).unwrap(), built, "те же байты");
            assert_eq!(answer["sha256"], json!(recipe.sha256));
        }

        #[test]
        fn a_rebuild_that_gives_other_bytes_swaps_nothing() {
            let game = Game::new();
            let recipe_file = recipe_place(&game, "update.recipe.json");
            let mut block = game.block();
            block.options.save_recipe = Some(recipe_file.clone());
            game.go(&over_base(&game, block)).unwrap();
            restore_in(ID, &game.points, &Progress::silent()).unwrap();
            let before = game.game_listing();
            let live_sha = sha_of(&game.live(UPDATE));

            // рецепт обещает не тот отпечаток
            let mut recipe = Recipe::load(&recipe_file).unwrap();
            recipe.sha256 = "0".repeat(64);
            recipe.save(&recipe_file).unwrap();
            let mut again = game.block();
            again.options.use_recipe = Some(recipe_file);
            same(
                game.go(&game.request(&[], again)),
                "InvalidOperationException",
                RECIPE_MISMATCH,
            );
            untouched(&game, &before, &live_sha);
        }

        #[test]
        fn a_source_that_changed_after_the_recipe_was_made_is_refused_before_the_swap() {
            let game = Game::new();
            let recipe_file = recipe_place(&game, "update.recipe.json");
            let source = game.kit.source("new.ydd");
            let mut op = replace("x64/a/a.ydd", "new.ydd");
            op.sha256 = Some(sha_of(&source));
            let mut block = game.block();
            block.options.save_recipe = Some(recipe_file.clone());
            let mut request = game.request(&[op], block);
            request.base = Some(game.kit.base("b1"));
            game.go(&request).unwrap();
            restore_in(ID, &game.points, &Progress::silent()).unwrap();
            let before = game.game_listing();
            let live_sha = sha_of(&game.live(UPDATE));

            fs::write(&source, b"changed after the build").unwrap();
            let mut again = game.block();
            again.options.use_recipe = Some(recipe_file);
            let (code, message) = failure(game.go(&game.request(&[], again)));
            assert_eq!(code, "InvalidDataException", "{message}");
            assert!(message.contains("checksum mismatch"), "{message}");
            untouched(&game, &before, &live_sha);
        }

        #[test]
        fn a_recipe_for_another_archive_or_a_missing_one_is_refused() {
            let game = Game::new();
            let recipe_file = recipe_place(&game, "update.recipe.json");
            let mut block = game.block();
            block.options.save_recipe = Some(recipe_file.clone());
            game.go(&over_base(&game, block)).unwrap();
            restore_in(ID, &game.points, &Progress::silent()).unwrap();
            let before = game.game_listing();
            let live_sha = sha_of(&game.live(UPDATE));

            let mut other = game.block();
            other.archive = COMMON.to_owned();
            other.options.use_recipe = Some(recipe_file.clone());
            same(
                game.go(&game.request(&[], other)),
                "ArgumentException",
                "Build recipe is for another archive.",
            );
            let mut missing = game.block();
            missing.options.use_recipe = Some(recipe_place(&game, "none.recipe.json"));
            let (code, _) = failure(game.go(&game.request(&[], missing)));
            assert_eq!(code, "FileNotFoundException");
            // рецепт и готовый файл вместе ничего не значат
            let mut both = game.prebuilt_block(UPDATE);
            both.options.use_recipe = Some(recipe_file);
            same(
                game.go(&game.request(&[], both)),
                "ArgumentException",
                "A build recipe cannot be combined with a prebuilt archive.",
            );
            untouched(&game, &before, &live_sha);
        }

        #[test]
        fn the_recipe_of_a_prebuilt_archive_is_not_written() {
            let game = Game::new();
            let recipe_file = recipe_place(&game, "p.recipe.json");
            let mut block = game.prebuilt_block(UPDATE);
            block.options.save_recipe = Some(recipe_file.clone());
            let answer = game.go(&game.request(&[], block)).unwrap();
            assert!(!recipe_file.exists());
            assert!(answer.get("recipe").is_none());
        }

        #[test]
        fn orphan_links_beside_are_swept_and_the_living_ones_stay() {
            let game = Game::new();
            let live = game.live(UPDATE);
            let (alive, fresh, gone) = ("rpf-alive-0001", "rpf-fresh-0001", "rpf-gone-0001");
            for id in [alive, fresh, gone] {
                fs::hard_link(&live, points::aside_path(&live, id)).unwrap();
            }
            // живая точка с описью и свежая недописанная остаются, брошенная уходит
            fs::create_dir_all(game.points.join(alive)).unwrap();
            fs::write(game.points.join(alive).join("restore.json"), b"{}").unwrap();
            fs::create_dir_all(game.points.join(fresh)).unwrap();
            // чужое имя рядом не трогается
            let foreign = live.with_file_name("update.rpf.astral-before-no spaces allowed");
            fs::write(&foreign, b"x").unwrap();
            points::sweep_orphan_asides(&live, &game.points);
            assert!(points::aside_path(&live, alive).exists());
            assert!(points::aside_path(&live, fresh).exists());
            assert!(!points::aside_path(&live, gone).exists());
            assert!(foreign.exists());
        }

        #[test]
        fn an_install_sweeps_the_orphans_of_earlier_installs_beside_its_archive() {
            // Прежний путь чужую ссылку рядом не трогает…
            let plain = Game::new();
            let kept = points::aside_path(&plain.live(UPDATE), "rpf-dead-0001");
            fs::hard_link(plain.live(UPDATE), &kept).unwrap();
            plain
                .go(&plain.request(&Game::replace_a(), plain.block()))
                .unwrap();
            assert!(kept.exists());
            // …а путь с «до» рядом убирает брошенную.
            let game = Game::new();
            let orphan = points::aside_path(&game.live(UPDATE), "rpf-dead-0001");
            fs::hard_link(game.live(UPDATE), &orphan).unwrap();
            game.go(&game.request(&Game::replace_a(), aside_block(&game)))
                .unwrap();
            assert!(!orphan.exists());
        }

        #[test]
        fn operations_may_be_left_out_only_with_prebuilt_files_or_a_recipe() {
            let game = Game::new();
            let root = game.game.to_string_lossy().replace('\\', "\\\\");
            let parse = |install: &str| {
                parse_request(&format!(
                    r#"{{"install":{{"gameRoot":"{root}","replay":{{}},{install}}},"operations":[]}}"#
                ))
            };
            let archive = r#""archive":"update/update.rpf""#;
            assert!(parse(&format!(r#"{archive},"prebuilt":"C:\\p.rpf","sha256":"x""#)).is_ok());
            let refused = parse(archive).unwrap_err();
            assert_eq!(
                refused.message,
                "At least one RPF entry operation is required."
            );
            let recipe = parse(&format!(r#"{archive},"useRecipe":"C:\\r.json""#)).unwrap();
            assert!(recipe.operations.is_empty());

            let digest = "ab".repeat(32);
            let options = parse(&format!(
                r#"{archive},"before":"aside","saveRecipe":"C:\\r.json","expectSha256":"{digest}","prebuilt":"C:\\p","sha256":"{digest}""#
            ))
            .unwrap()
            .install
            .unwrap()
            .options;
            assert!(options.before_aside);
            assert_eq!(options.save_recipe, Some(PathBuf::from("C:\\r.json")));
            assert_eq!(options.expect_sha256.as_deref(), Some(digest.as_str()));
            let short = parse(&format!(r#"{archive},"expectSha256":"AB""#)).unwrap_err();
            assert_eq!(short.message, "Install expected sha256 is invalid.");
            for bad in [
                r#""before":"rename""#,
                r#""before":5"#,
                r#""saveRecipe":"rel.json""#,
                r#""useRecipe":5"#,
            ] {
                let error = parse(&format!("{archive},{bad}")).unwrap_err();
                assert_eq!(error.code, "ArgumentException", "{bad}");
            }
        }
    }

    // ----- процесс убит посреди установки (kill_after_manifest, kill_after_first_swap) -----

    /// Ребёнок — этот же тестовый бинарник на одном тесте; идёт с признаком
    /// `failpoints`. Родитель готовит игру и описание целей, ребёнка убивает
    /// точка останова, родитель смотрит, что лежит на диске, и откатывает точку.
    #[cfg(feature = "failpoints")]
    mod failpoint_runs {
        use super::*;
        use crate::archives::restore;
        use std::process::{Command, Stdio};

        const CHILD_ENV: &str = "ASTRAL_COMPOSED_TEST_CHILD_DIR";

        #[test]
        fn child_install() {
            let Some(root) = std::env::var_os(CHILD_ENV) else {
                return;
            };
            let root = PathBuf::from(root);
            let plan: Value =
                serde_json::from_str(&fs::read_to_string(root.join("plan.json")).unwrap()).unwrap();
            let prebuilt = plan["prebuilt"].as_str().unwrap().to_owned();
            let sha = plan["sha256"].as_str().unwrap().to_owned();
            let targets: Vec<InstallTarget> = plan["archives"]
                .as_array()
                .unwrap()
                .iter()
                .zip(1..)
                .map(|(archive, number)| InstallTarget {
                    archive: archive.as_str().unwrap().to_owned(),
                    prebuilt: Some(prebuilt.clone()),
                    sha256: Some(sha.clone()),
                    create: false,
                    stage_name: Some(format!(".astral-stage-probe-000{number}")),
                })
                .collect();
            let install = Install {
                game_root: root.join("game"),
                archive: String::new(),
                replay: json!({ "module": "sky-rainbow" }),
                point_id: Some(ID.to_owned()),
                stage_name: None,
                prebuilt: None,
                sha256: None,
                create: false,
                targets,
                options: Default::default(),
            };
            let kit = Lab::new();
            let mut request = kit.request(None, &[], Path::new(""));
            request.install = Some(install);
            let _ = compose_install(
                &request,
                &quiet_keys(),
                None,
                &Progress::silent(),
                &root.join("points"),
            );
        }

        fn killed_at(game: &Game, archives: &[&str], point: &str) {
            let plan = json!({
                "archives": archives,
                "prebuilt": game.prebuilt_path(),
                "sha256": game.prebuilt_sha(),
            });
            let root = game.kit.dir.path();
            fs::write(root.join("plan.json"), plan.to_string()).unwrap();
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "archives::composed_install::tests::failpoint_runs::child_install",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(CHILD_ENV, root)
                .env("ASTRAL_ENGINE_FAILPOINT", point)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .unwrap();
            assert_eq!(output.status.code(), Some(137));
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            assert!(stderr.contains(&format!("[failpoint] {point}")), "{stderr}");
        }

        #[test]
        fn killed_after_the_manifest_the_game_is_untouched_and_the_point_is_complete() {
            let game = Game::new();
            let live_sha = sha_of(&game.live(UPDATE));
            killed_at(&game, &[UPDATE], "install-after-manifest");
            // живой прежний, готовый файл лежит в стейдже, точка полная
            assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
            let stage_file = game
                .live("update")
                .join(".astral-stage-probe-0001")
                .join("update.rpf");
            assert_eq!(sha_of(&stage_file), game.prebuilt_sha());
            let point = game.points.join(ID);
            assert_eq!(sha_of(&point.join(UPDATE)), live_sha);
            assert_eq!(
                fs::read_to_string(point.join("replay.json")).unwrap(),
                "{\n  \"module\": \"sky-rainbow\"\n}"
            );
            assert!(point.join("restore.json").is_file());
            // откат точки узнаёт «ничего не делать» и убирает её
            restore::restore_in(ID, &game.points, &Progress::silent()).unwrap();
            assert_eq!(sha_of(&game.live(UPDATE)), live_sha);
            assert!(!point.exists());
        }

        // ----- установка из операций с «до» рядом: убит в каждой точке -----

        const OPS_CHILD_ENV: &str = "ASTRAL_COMPOSED_OPS_CHILD_DIR";

        /// Ребёнок: установка из операций, точки на «другом томе», «до» рядом, рецепт.
        #[test]
        fn child_install_ops() {
            use crate::archives::compose::{Action, Mode, Operation};
            let Some(root) = std::env::var_os(OPS_CHILD_ENV) else {
                return;
            };
            let root = PathBuf::from(root);
            let plan: Value =
                serde_json::from_str(&fs::read_to_string(root.join("plan.json")).unwrap()).unwrap();
            crate::archives::transaction::other_volume::simulate(true);
            let mut install = Install {
                game_root: root.join("game"),
                archive: UPDATE.to_owned(),
                replay: json!({ "module": "sky-rainbow" }),
                point_id: Some(ID.to_owned()),
                stage_name: Some(STAGE.to_owned()),
                prebuilt: None,
                sha256: None,
                create: false,
                targets: Vec::new(),
                options: Default::default(),
            };
            install.options.before_aside = true;
            install.options.save_recipe = Some(PathBuf::from(plan["recipe"].as_str().unwrap()));
            let request = Request {
                staging: None,
                mode: Mode::Compose,
                base: Some(PathBuf::from(plan["base"].as_str().unwrap())),
                output: PathBuf::new(),
                archive_target: "update:/x64/astral/mod.rpf".to_owned(),
                edition: Some("Legacy".to_owned()),
                allow_deletes: true,
                operations: vec![Operation {
                    entry: "x64/a/a.ydd".to_owned(),
                    source: Some(PathBuf::from(plan["source"].as_str().unwrap())),
                    sha256: None,
                    action: Action::Replace,
                    allow_delete: false,
                    allow_missing: false,
                }],
                install: Some(install),
            };
            let _ = compose_install(
                &request,
                &quiet_keys(),
                None,
                &Progress::silent(),
                &root.join("points"),
            );
        }

        fn killed_ops_at(game: &Game, point: &str) -> PathBuf {
            let recipe = game
                .kit
                .dir
                .path()
                .join("recipes")
                .join("update.recipe.json");
            let plan = json!({
                "recipe": recipe.to_string_lossy(),
                "base": game.kit.base("b1").to_string_lossy(),
                "source": game.kit.source("new.ydd").to_string_lossy(),
            });
            let root = game.kit.dir.path();
            fs::write(root.join("plan.json"), plan.to_string()).unwrap();
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "archives::composed_install::tests::failpoint_runs::child_install_ops",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(OPS_CHILD_ENV, root)
                .env("ASTRAL_ENGINE_FAILPOINT", point)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .unwrap();
            assert_eq!(output.status.code(), Some(137), "{point}");
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            assert!(stderr.contains(&format!("[failpoint] {point}")), "{stderr}");
            recipe
        }

        /// Живой архив открывается так, как его откроет игра.
        fn readable(path: &Path) {
            rage_rpf::Archive::open_path(path, Some(quiet_keys())).expect("архив читается");
        }

        #[test]
        fn killed_before_the_manifest_the_game_is_untouched_and_the_leftovers_are_swept() {
            for point in [
                "install-after-aside",
                "compose-after-write",
                "install-after-stage",
            ] {
                let game = Game::new();
                let original = fs::read(game.live(UPDATE)).unwrap();
                killed_ops_at(&game, point);
                // живой прежний и читается; описи нет, а «до» рядом уже лежит
                assert_eq!(fs::read(game.live(UPDATE)).unwrap(), original, "{point}");
                readable(&game.live(UPDATE));
                let aside = points::aside_path(&game.live(UPDATE), ID);
                assert_eq!(fs::read(&aside).unwrap(), original, "{point}");
                assert!(
                    !game.points.join(ID).join("restore.json").exists(),
                    "{point}"
                );
                // откатывать нечего: откат такой точки отказывает
                assert!(restore::restore_in(ID, &game.points, &Progress::silent()).is_err());
                // остатки убирает вызвавший (журнал транзакции): точка и стейдж
                fs::remove_dir_all(game.points.join(ID)).unwrap();
                fs::remove_dir_all(game.live("update").join(STAGE)).ok();
                points::sweep_orphan_asides(&game.live(UPDATE), &game.points);
                assert!(!aside.exists(), "{point}");
                assert_eq!(fs::read(game.live(UPDATE)).unwrap(), original);
            }
        }

        #[test]
        fn killed_after_the_manifest_the_restore_gives_the_bytes_back_from_beside() {
            let game = Game::new();
            let original = fs::read(game.live(UPDATE)).unwrap();
            let recipe = killed_ops_at(&game, "install-after-manifest");
            // подмены не было; готовый файл в стейдже, рецепт лёг до подмены
            assert_eq!(fs::read(game.live(UPDATE)).unwrap(), original);
            readable(&game.live(UPDATE));
            let stage_file = game.live("update").join(STAGE).join("update.rpf");
            assert_eq!(
                crate::archives::recipe::Recipe::load(&recipe)
                    .unwrap()
                    .sha256,
                sha_of(&stage_file),
                "рецепт назвал то, что лежит в стейдже"
            );
            restore::restore_in(ID, &game.points, &Progress::silent()).unwrap();
            assert_eq!(fs::read(game.live(UPDATE)).unwrap(), original);
            assert!(!points::aside_path(&game.live(UPDATE), ID).exists());
            assert!(!game.points.join(ID).exists());
        }

        #[test]
        fn killed_after_the_swap_the_new_archive_is_readable_and_the_restore_is_byte_for_byte() {
            let game = Game::new();
            let original = fs::read(game.live(UPDATE)).unwrap();
            let recipe = killed_ops_at(&game, "install-after-first-swap");
            let built = sha_of(&game.live(UPDATE));
            assert_ne!(fs::read(game.live(UPDATE)).unwrap(), original);
            readable(&game.live(UPDATE));
            assert_eq!(
                crate::archives::recipe::Recipe::load(&recipe)
                    .unwrap()
                    .sha256,
                built
            );
            // копии в точке нет: «до» лежит рядом, и откат берёт его оттуда
            assert!(!game.points.join(ID).join(UPDATE).exists());
            assert_eq!(
                fs::read(points::aside_path(&game.live(UPDATE), ID)).unwrap(),
                original
            );
            restore::restore_in(ID, &game.points, &Progress::silent()).unwrap();
            assert_eq!(fs::read(game.live(UPDATE)).unwrap(), original);
            // повтор после уже сделанного отката: точки нет, отказ без правок
            assert!(restore::restore_in(ID, &game.points, &Progress::silent()).is_err());
            assert_eq!(fs::read(game.live(UPDATE)).unwrap(), original);
            assert!(!points::aside_path(&game.live(UPDATE), ID).exists());
        }

        #[test]
        fn killed_after_the_first_swap_the_point_brings_the_first_archive_back() {
            let game = Game::new();
            let (update_sha, common_sha) = (sha_of(&game.live(UPDATE)), sha_of(&game.live(COMMON)));
            killed_at(&game, &[UPDATE, COMMON], "install-after-first-swap");
            // первая цель уже новая, вторая прежняя, у второй готовый файл в стейдже
            assert_eq!(sha_of(&game.live(UPDATE)), game.prebuilt_sha());
            assert_eq!(sha_of(&game.live(COMMON)), common_sha);
            assert!(game
                .game
                .join(".astral-stage-probe-0002")
                .join("common.rpf")
                .is_file());
            restore::restore_in(ID, &game.points, &Progress::silent()).unwrap();
            assert_eq!(sha_of(&game.live(UPDATE)), update_sha);
            assert_eq!(sha_of(&game.live(COMMON)), common_sha);
            assert!(!game.points.join(ID).exists());
        }
    }
}
