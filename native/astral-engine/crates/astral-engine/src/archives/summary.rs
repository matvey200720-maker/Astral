//! Сводный рецепт дозаписанного архива.
//!
//! У дозаписанного архива нет копии сборки: тела легли в конец живого файла.
//! Лаунчер Rockstar может вернуть оригинальный `update.rpf`, и тогда моды надо
//! поставить заново без участия игрока (`repair-rpf`). Для этого при каждой
//! дозаписи (ключ `saveRecipe` у `append-rpf`) обновляется сводный рецепт: чем
//! начиналась цепочка записей (основа — оригинал игры, по SHA-256 всего файла),
//! все действующие операции по порядку, партиями (одна партия — одна запись
//! журнала), и их источники, закреплённые рядом с рецептом.
//!
//! Рецепт — не рецепт этапа 1 (`recipe.rs`): у того форма `schema: 1` и
//! отпечаток результата, у этого `schema: 2` и вместо отпечатка результата —
//! записи, а проверка идёт по содержимому. Ключи `baseArchive` и
//! `operations[].source` названы так же, как у рецепта этапа 1, чтобы прежние
//! инструменты (перенос кэша, уборка) читали их одинаково.
//!
//! Порядок на диске (почему рецепт не бывает впереди архива):
//!
//! 1. журнал (`Begin`, `Synced`) и тела на диске;
//! 2. рецепт: временный файл, сброс, переименование — ДО записи голов;
//! 3. головы, «готово».
//!
//! Обрыв до шага 2 оставляет рецепт прежним, а запись откатывается. Обрыв
//! после шага 2 до голов оставляет рецепт на одну запись впереди: восстановление
//! откатывает запись, а рецепт приводится к журналу (журнал хранит истину):
//! запись рецепта без записи «готово» в журнале уходит. Это делает сам
//! восстановление по пометке в записи журнала (`Begin::note` — путь рецепта) и,
//! как запас, любое чтение рецепта (`Summary::reconcile`).

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use rage_rpf::{
    append::{fingerprint, hex},
    journal::{Phase, Replay},
};
use serde_json::{json, Map, Value};

use super::{
    compose::{is_digest, normalize_entry, Action, Operation},
    points, random_hex, sha256_file,
};
use crate::{
    error::{EngineError, Result},
    failpoint, response,
};

/// Версия формы сводного рецепта.
pub const SUMMARY_SCHEMA: u64 = 2;

/// Рецепта по этому пути нет.
pub const RECIPE_MISSING: &str = "RecipeMissing";
/// Файл по пути рецепта не сводный рецепт или испорчен.
pub const RECIPE_DAMAGED: &str = "RecipeDamaged";
/// Рецепт принадлежит другой цепочке записей или ждёт другое состояние архива.
pub const RECIPE_STALE: &str = "RecipeStale";
/// Рецепт не покрывает все записи журнала (его потеряли или включили посреди
/// цепочки): дозапись отказывает, цепочку начинает полный путь.
pub const RECIPE_INCOMPLETE: &str = "RecipeIncomplete";
/// Источника операции нет на диске.
pub const SOURCE_MISSING: &str = "SourceMissing";
/// Источник операции изменился после закрепления.
pub const SOURCE_CHANGED: &str = "SourceChanged";

/// Папка закреплённых источников рецепта: рядом с ним, своя у каждого рецепта
/// (уборка рецептов этапа 1 в папке `sources` чужих файлов не трогает).
pub fn sources_folder(recipe: &Path) -> PathBuf {
    points::sibling_name(recipe, "sources")
}

fn fold(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn damaged(what: &str) -> EngineError {
    EngineError::new(
        RECIPE_DAMAGED,
        format!("Summary recipe is invalid: {what}."),
    )
}

/// Одна партия: операции одной записи журнала. Партии основы (после починки)
/// записи не имеют: они вошли в файл, с которого началась цепочка.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Batch {
    /// Номер записи журнала; `None` — партия уже внутри файла начала цепочки.
    pub record: Option<u64>,
    /// Отпечатки состояния до и после записи (`a1:…` или 64 цифры).
    pub before: Option<String>,
    pub after: Option<String>,
    pub operations: Vec<Operation>,
    /// Слой, который положила партия (`install.layer`): включён ли он сейчас,
    /// знает журнал, и «Починить» собирает только партии включённых слоёв.
    pub layer: Option<String>,
    /// Партия — запись переключения слоёв: операций нет, а отпечаток после неё
    /// нужен, чтобы состояние рецепта шло за архивом. Такая партия сверяется с
    /// журналом по номеру записи: слитые переключения меняют отпечаток записи.
    pub toggle: bool,
}

impl Batch {
    /// Партия обычной записи.
    pub fn plain(
        record: Option<u64>,
        before: Option<String>,
        after: Option<String>,
        operations: Vec<Operation>,
    ) -> Batch {
        Batch {
            record,
            before,
            after,
            operations,
            layer: None,
            toggle: false,
        }
    }
}

/// Что журнал говорит о цепочке рецепта.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Standing {
    /// Журнал той же цепочки: записи рецепта сверены с ним.
    Same,
    /// Журнала нет: записей, которые за ним следят, нет тоже.
    NoJournal,
    /// Журнал другой цепочки (файл подменяли полным путём): рецепт ей не принадлежит.
    Other,
}

/// Сводный рецепт.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Summary {
    /// Путь архива в игре (`update/update.rpf`).
    pub archive: String,
    /// Основа: SHA-256 и длина файла, к которому применяются все партии. У
    /// цепочки, начатой на оригинале игры, это оригинал.
    pub origin_sha256: String,
    pub origin_bytes: u64,
    /// SHA-256 файла, с которого начинается нынешняя цепочка журнала: у первой
    /// цепочки он равен основе, после починки — это собранный файл.
    pub chain_base: String,
    /// Разрешено ли снимать записи (у операций снятия свой ключ `allowDelete`).
    pub allow_deletes: bool,
    pub batches: Vec<Batch>,
}

impl Summary {
    /// Рецепт новой цепочки: основа — файл, с которого она начинается.
    pub fn start(archive: &str, base_sha256: &str, base_bytes: u64) -> Summary {
        Summary {
            archive: archive.to_owned(),
            origin_sha256: base_sha256.to_owned(),
            origin_bytes: base_bytes,
            chain_base: base_sha256.to_owned(),
            allow_deletes: false,
            batches: Vec::new(),
        }
    }

    /// Состояние архива, которое описывает рецепт: отпечаток последней записи, а
    /// без записей — SHA-256 файла начала цепочки.
    pub fn state(&self) -> String {
        self.batches
            .iter()
            .rev()
            .find_map(|batch| batch.after.clone())
            .unwrap_or_else(|| self.chain_base.clone())
    }

    /// Номера записей журнала, которые рецепт знает, по порядку.
    pub fn records(&self) -> Vec<u64> {
        self.batches
            .iter()
            .filter_map(|batch| batch.record)
            .collect()
    }

    /// Рецепт без партий: восстанавливать нечего.
    pub fn is_empty(&self) -> bool {
        self.batches.is_empty()
    }

    /// Два подряд идущих переключения слились в одну запись журнала: партия ушедшей
    /// записи уходит, у оставшейся отпечаток после — итоговый.
    pub fn merge_toggles(&mut self, kept: u64, gone: u64, after: &str) {
        // замены общих записей у ушедшей партии — позднее состояние: они встают поверх
        // замен оставшейся (у каждой записи последняя)
        let carried: Vec<Operation> = self
            .batches
            .iter()
            .find(|batch| batch.record == Some(gone) && batch.toggle)
            .map(|batch| batch.operations.clone())
            .unwrap_or_default();
        self.batches.retain(|batch| batch.record != Some(gone));
        for batch in &mut self.batches {
            if batch.record == Some(kept) && batch.toggle {
                batch.after = Some(after.to_owned());
                for next in &carried {
                    batch
                        .operations
                        .retain(|own| !own.entry.eq_ignore_ascii_case(&next.entry));
                    batch.operations.push(next.clone());
                }
            }
        }
    }

    /// Слои, партии которых лежат в рецепте, по порядку, без повторов.
    pub fn layer_ids(&self) -> Vec<String> {
        let mut seen: Vec<String> = Vec::new();
        for id in self.batches.iter().filter_map(|batch| batch.layer.as_ref()) {
            if !seen.contains(id) {
                seen.push(id.clone());
            }
        }
        seen
    }

    /// Рецепт без партий слоёв из списка (они выключены или сняты: их тел в
    /// файле, который вернул Rockstar, нет, и ставить их заново должна загрузка).
    pub fn without_layers(&self, lost: &[String]) -> Summary {
        let mut next = self.clone();
        next.batches
            .retain(|batch| batch.layer.as_ref().is_none_or(|id| !lost.contains(id)));
        next
    }

    /// Все операции по порядку: партия за партией.
    pub fn operations(&self) -> impl Iterator<Item = &Operation> {
        self.batches
            .iter()
            .flat_map(|batch| batch.operations.iter())
    }

    /// Рецепт после починки: все партии вошли в собранный файл, цепочка начинается
    /// с него. Основа та же.
    pub fn rebased(&self, built_sha256: &str) -> Summary {
        let mut next = self.clone();
        next.chain_base = built_sha256.to_ascii_lowercase();
        // записи переключений слоёв в собранный файл не входят: операций у них нет.
        // Переключение, которое ставило общие записи (замены `content.xml` и
        // `dlclist.xml` под набор слоёв), операции имеет: они вошли в файл и остаются
        // обычной партией основы, иначе вторая починка собрала бы общие записи по
        // установке слоя, а не по тому набору, что остался
        next.batches
            .retain(|batch| !batch.toggle || !batch.operations.is_empty());
        for batch in &mut next.batches {
            batch.record = None;
            batch.before = None;
            batch.after = None;
            batch.toggle = false;
        }
        next
    }

    // ----- сверка с журналом -----

    /// Приводит рецепт к журналу, который хранит истину: запись рецепта, которой
    /// нет в журнале (откат, обрыв до голов, не законченная запись), уходит. У
    /// журнала другой цепочки ничего не меняется, а без журнала записи уходят все.
    /// Второе число — менялся ли рецепт.
    pub fn reconcile(&mut self, replay: &Replay) -> (Standing, bool) {
        let before = self.batches.len();
        let mut retouched = false;
        let standing = match &replay.base {
            None => {
                self.batches.retain(|batch| batch.record.is_none());
                Standing::NoJournal
            }
            Some(base) if hex(&base.digest) != self.chain_base => Standing::Other,
            Some(_) => {
                self.batches.retain(|batch| match batch.record {
                    None => true,
                    Some(seq) => replay.records.iter().any(|record| {
                        record.begin.seq == seq
                            && record.phase == Phase::Done
                            && (batch.toggle
                                || batch.after.as_deref()
                                    == Some(fingerprint(&record.begin.after).as_str()))
                    }),
                });
                // партия переключения идёт за отпечатком записи, как его знает журнал
                // (слитая запись носит отпечаток последнего переключения)
                for batch in self.batches.iter_mut().filter(|batch| batch.toggle) {
                    let known = batch.record.and_then(|seq| {
                        replay
                            .records
                            .iter()
                            .find(|record| record.begin.seq == seq && record.phase == Phase::Done)
                    });
                    if let Some(record) = known {
                        let word = fingerprint(&record.begin.after);
                        if batch.after.as_deref() != Some(word.as_str()) {
                            batch.after = Some(word);
                            retouched = true;
                        }
                    }
                }
                Standing::Same
            }
        };
        (standing, retouched || self.batches.len() != before)
    }

    /// Рецепт знает каждую готовую запись журнала и ничего лишнего: по нему архив
    /// восстановится целиком.
    pub fn covers(&self, replay: &Replay) -> bool {
        let live: Vec<u64> = replay
            .records
            .iter()
            .filter(|record| record.phase == Phase::Done)
            .map(|record| record.begin.seq)
            .collect();
        replay.records.len() == live.len() && self.records() == live
    }

    // ----- действующие операции -----

    /// Операции, которые определяют итог: у каждой записи последняя. Операция
    /// снятия требует, чтобы записи не было; операция над вложенным архивом целиком
    /// отменяет всё, что раньше правило его внутри; снятый вложенный архив,
    /// заведённый заново, снова есть. Партии идут по порядку, внутри партии — как
    /// их сортирует сборка (по записи без учёта регистра, устойчиво).
    pub fn effective(&self) -> Vec<Operation> {
        let mut standing: BTreeMap<String, Option<Operation>> = BTreeMap::new();
        for batch in &self.batches {
            let mut ordered: Vec<&Operation> = batch.operations.iter().collect();
            ordered.sort_by_cached_key(|op| op.entry.to_lowercase());
            for op in ordered {
                let removal = op.action == Action::Delete;
                let Ok(parts) = normalize_entry(&op.entry, !removal) else {
                    continue;
                };
                let key = parts.join("/");
                let inside = format!("{key}/");
                standing.retain(|other, _| !other.starts_with(&inside));
                if removal {
                    standing.insert(key, None);
                    continue;
                }
                // создана запись внутри снятого вложенного архива: он снова есть
                for depth in 1..parts.len() {
                    let ancestor = parts[..depth].join("/");
                    if matches!(standing.get(&ancestor), Some(None)) {
                        standing.remove(&ancestor);
                    }
                }
                standing.insert(key, Some(op.clone()));
            }
        }
        standing
            .into_iter()
            .map(|(key, held)| match held {
                Some(op) => op,
                None => Operation {
                    entry: key,
                    source: None,
                    sha256: None,
                    action: Action::Delete,
                    allow_delete: true,
                    allow_missing: true,
                },
            })
            .collect()
    }

    // ----- источники -----

    /// Закреплённые источники, на которые ссылается рецепт.
    pub fn sources(&self) -> BTreeSet<String> {
        self.operations()
            .filter_map(|op| op.source.as_deref())
            .map(fold)
            .collect()
    }

    /// Источники на месте и не изменились: у каждой операции файл есть, а его
    /// SHA-256 равен записанному. Первый же изъян — отказ с кодом (`SourceMissing`,
    /// `SourceChanged`), до любой записи.
    pub fn check_sources(&self) -> Result<()> {
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for op in self.operations() {
            if op.action == Action::Delete {
                continue;
            }
            let Some(source) = op.source.as_deref() else {
                continue;
            };
            if !seen.insert(fold(source)) {
                continue;
            }
            if !source.is_file() {
                return Err(EngineError::new(
                    SOURCE_MISSING,
                    format!(
                        "The source of {} is not on the disk: {}",
                        op.entry,
                        source.display()
                    ),
                ));
            }
            if let Some(wanted) = &op.sha256 {
                if !sha256_file(source)?.eq_ignore_ascii_case(wanted) {
                    return Err(EngineError::new(
                        SOURCE_CHANGED,
                        format!(
                            "The source of {} has changed: {}",
                            op.entry,
                            source.display()
                        ),
                    ));
                }
            }
        }
        Ok(())
    }

    // ----- текст и файл -----

    /// Текст рецепта: ASCII, ключи в порядке записи.
    pub fn text(&self) -> Result<String> {
        let mut batches = Vec::with_capacity(self.batches.len());
        let mut operations = Vec::new();
        for (at, batch) in self.batches.iter().enumerate() {
            let mut item = json!({
                "batch": at,
                "record": batch.record,
                "before": batch.before,
                "after": batch.after,
            });
            // ключи слоёв есть только у партий слоёв: прочие рецепты прежние
            if let Some(layer) = &batch.layer {
                item["layer"] = json!(layer);
            }
            if batch.toggle {
                item["toggle"] = json!(true);
            }
            batches.push(item);
            for op in &batch.operations {
                let mut item = op.to_json();
                item["batch"] = json!(at);
                operations.push(item);
            }
        }
        let rows = [
            ("schema", json!(SUMMARY_SCHEMA)),
            ("kind", json!("append")),
            ("archive", json!(self.archive)),
            (
                "origin",
                json!({ "sha256": self.origin_sha256, "bytes": self.origin_bytes }),
            ),
            ("chainBase", json!(self.chain_base)),
            ("baseArchive", Value::Null),
            ("allowDeletes", json!(self.allow_deletes)),
            ("state", json!(self.state())),
            ("batches", Value::Array(batches)),
            ("operations", Value::Array(operations)),
        ];
        let mut document = Map::new();
        document.extend(rows.map(|(key, value)| (key.to_owned(), value)));
        serde_json::to_string_pretty(&Value::Object(document))
            .map(|pretty| response::ascii_escape(&pretty))
            .map_err(|failure| EngineError::internal(failure.to_string()))
    }

    /// Разбор текста; чужая или испорченная форма — `RecipeDamaged`.
    pub fn parse(text: &str) -> Result<Summary> {
        let parsed: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| damaged("not JSON"))?;
        let Value::Object(root) = parsed else {
            return Err(damaged("not an object"));
        };
        if root.get("schema").and_then(Value::as_u64) != Some(SUMMARY_SCHEMA) {
            return Err(damaged("not a summary recipe (unknown schema)"));
        }
        if root.get("kind").and_then(Value::as_str) != Some("append") {
            return Err(damaged("not a summary recipe (unknown kind)"));
        }
        let text_of = |key: &str| root.get(key).and_then(Value::as_str);
        let digest_of = |value: Option<&str>, what: &str| -> Result<String> {
            value
                .filter(|digest| is_digest(digest))
                .map(str::to_ascii_lowercase)
                .ok_or_else(|| damaged(what))
        };
        let origin = root
            .get("origin")
            .and_then(Value::as_object)
            .ok_or_else(|| damaged("no origin"))?;
        let archive = text_of("archive")
            .ok_or_else(|| damaged("no archive"))?
            .to_owned();
        let listed = match root.get("batches") {
            Some(Value::Array(items)) => items,
            _ => return Err(damaged("no batches")),
        };
        let mut batches = Vec::with_capacity(listed.len());
        for (at, item) in listed.iter().enumerate() {
            let Some(object) = item.as_object() else {
                return Err(damaged("a batch is not an object"));
            };
            if object.get("batch").and_then(Value::as_u64) != Some(at as u64) {
                return Err(damaged("batches are out of order"));
            }
            let text_key = |key: &str| object.get(key).and_then(Value::as_str).map(str::to_owned);
            batches.push(Batch {
                record: object.get("record").and_then(Value::as_u64),
                before: text_key("before"),
                after: text_key("after"),
                operations: Vec::new(),
                layer: text_key("layer"),
                toggle: matches!(object.get("toggle"), Some(Value::Bool(true))),
            });
        }
        let operations = match root.get("operations") {
            Some(Value::Array(items)) => items,
            _ => return Err(damaged("no operations")),
        };
        for item in operations {
            let at = item
                .get("batch")
                .and_then(Value::as_u64)
                .and_then(|at| usize::try_from(at).ok())
                .filter(|&at| at < batches.len())
                .ok_or_else(|| damaged("an operation names no batch"))?;
            let operation = Operation::from_json(item)
                .map_err(|failure| damaged(failure.message.trim_end_matches('.')))?;
            batches[at].operations.push(operation);
        }
        Ok(Summary {
            archive,
            origin_sha256: digest_of(
                origin.get("sha256").and_then(Value::as_str),
                "no origin sha256",
            )?,
            origin_bytes: origin.get("bytes").and_then(Value::as_u64).unwrap_or(0),
            chain_base: digest_of(text_of("chainBase"), "no chain base")?,
            allow_deletes: matches!(root.get("allowDeletes"), Some(Value::Bool(true))),
            batches,
        })
    }

    /// Читает рецепт из файла: нет файла — `RecipeMissing`, чужая форма — `RecipeDamaged`.
    pub fn load(path: &Path) -> Result<Summary> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(EngineError::new(
                    RECIPE_MISSING,
                    format!("Summary recipe does not exist: {}", path.display()),
                ))
            }
            Err(error) => return Err(error.into()),
        };
        Summary::parse(&String::from_utf8_lossy(&bytes))
    }

    /// Кладёт рецепт целиком или не кладёт: временный файл рядом, сброс на диск,
    /// переименование поверх. Закреплённые источники, на которые рецепт больше
    /// не ссылается, убираются (уборка не отказывает).
    pub fn save(&self, path: &Path) -> Result<()> {
        let text = self.text()?;
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder)?;
        }
        let temporary = points::sibling_name(path, "tmp");
        let written = fs::write(&temporary, text.as_bytes())
            .and_then(|()| points::flush_to_disk(&temporary))
            .inspect(|()| failpoint::hit("summary-after-temp"))
            .and_then(|()| points::rename_with_retry(&temporary, path));
        written.inspect_err(|_| drop(fs::remove_file(&temporary)))?;
        self.collect_garbage(path);
        Ok(())
    }

    /// Убирает из папки источников файлы, на которые рецепт не ссылается.
    pub fn collect_garbage(&self, recipe: &Path) {
        let keep = self.sources();
        let Ok(listing) = fs::read_dir(sources_folder(recipe)) else {
            return;
        };
        for entry in listing.flatten() {
            let place = entry.path();
            let is_file = entry.file_type().is_ok_and(|kind| kind.is_file());
            if is_file && !keep.contains(&fold(&place)) {
                drop(fs::remove_file(&place));
            }
        }
    }
}

/// Сводит рецепт в файле с журналом и переписывает, если запись ушла. Нет файла,
/// чужая форма, цепочка другая — не трогает. Отказ записи не важен: рецепт
/// сверится при следующем чтении.
pub fn reconcile_file(path: &Path, replay: &Replay) -> bool {
    let Ok(mut summary) = Summary::load(path) else {
        return false;
    };
    let (standing, changed) = summary.reconcile(replay);
    if standing == Standing::Other || !changed {
        return false;
    }
    summary.save(path).is_ok()
}

/// Пути рецептов, названные в записях журнала (пометка записи), без повторов.
pub fn recipe_notes(replay: &Replay) -> Vec<PathBuf> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut found = Vec::new();
    for record in &replay.records {
        let Ok(text) = std::str::from_utf8(&record.begin.note) else {
            continue;
        };
        let path = PathBuf::from(text);
        if !text.is_empty() && path.is_absolute() && seen.insert(fold(&path)) {
            found.push(path);
        }
    }
    found
}

// ---------------------------------------------------------------------------
// Закрепление источников
// ---------------------------------------------------------------------------

fn pin_one(source: &Path, folder: &Path, digest: &str) -> Result<PathBuf> {
    let extension = source
        .extension()
        .map(|text| format!(".{}", text.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    let place = folder.join(format!("{digest}{extension}"));
    if fold(&place) == fold(source) || place.is_file() {
        return Ok(place);
    }
    fs::create_dir_all(folder)?;
    let temporary = folder.join(format!("{digest}.{}.pin", random_hex(12)));
    // та же ссылка, что у закрепления в хранилище этапа 1: на другом томе — копия.
    // Ссылка делит байты с источником, сбрасывать на диск нечего (и открывать на
    // запись источник «только для чтения» незачем); копия сбрасывается.
    let linked = fs::hard_link(source, &temporary).is_ok();
    let copied = if linked {
        Ok(())
    } else {
        fs::copy(source, &temporary)
            .map(drop)
            .and_then(|()| points::flush_to_disk(&temporary))
    };
    let placed = copied.and_then(|()| points::rename_with_retry(&temporary, &place));
    if let Err(error) = placed {
        drop(fs::remove_file(&temporary));
        // рядом успел лечь такой же файл: он тот же по имени-отпечатку
        if place.is_file() {
            return Ok(place);
        }
        return Err(error.into());
    }
    Ok(place)
}

/// Операции, у которых источники закреплены в `folder` (жёсткая ссылка, на другом
/// томе — копия) под именем из их SHA-256, а отпечаток записан. Источник уже в
/// этой папке остаётся как есть.
pub fn pin_operations(operations: &[Operation], folder: &Path) -> Result<Vec<Operation>> {
    let mut pinned = Vec::with_capacity(operations.len());
    for op in operations {
        let mut next = op.clone();
        if op.action != Action::Delete {
            if let Some(source) = op.source.as_deref() {
                let digest = match &op.sha256 {
                    Some(given) if is_digest(given) => given.to_ascii_lowercase(),
                    _ => sha256_file(source)?,
                };
                next.source = Some(pin_one(source, folder, &digest)?);
                next.sha256 = Some(digest);
            }
        }
        pinned.push(next);
    }
    Ok(pinned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_rpf::journal::{Base, Begin, Record, Replay, Stamp};
    use tempfile::tempdir;

    fn op(entry: &str, action: Action, source: Option<&str>) -> Operation {
        Operation {
            entry: entry.to_owned(),
            source: source.map(PathBuf::from),
            sha256: source.map(|_| "ab".repeat(32)),
            action,
            allow_delete: action == Action::Delete,
            allow_missing: false,
        }
    }

    fn digest(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn begin(seq: u64, after: u8) -> Begin {
        Begin {
            seq,
            old_len: 10,
            new_len: 20,
            prev: digest(0),
            after: digest(after),
            dead_after: 0,
            bytes_written: 0,
            bytes_moved: 0,
            moves: Vec::new(),
            identity: None,
            anchors: Vec::new(),
            old_head: Vec::new(),
            new_sectors: Vec::new(),
            regions: Vec::new(),
            fills: Vec::new(),
            note: Vec::new(),
        }
    }

    fn journal(base: u8, records: &[(u64, u8, Phase)]) -> Replay {
        let mut replay = Replay::default();
        replay.base = Some(Base {
            len: 10,
            head_sha: digest(0),
            head_len: 4,
            digest: digest(base),
            stamp: Stamp::default(),
        });
        replay.records = records
            .iter()
            .map(|&(seq, after, phase)| Record {
                begin: begin(seq, after),
                phase,
                bytes: 0,
            })
            .collect();
        replay
    }

    fn recipe_over(base: u8, batches: Vec<Batch>) -> Summary {
        let hex_base = hex(&digest(base));
        Summary {
            batches,
            ..Summary::start("update/update.rpf", &hex_base, 4096)
        }
    }

    fn batch(record: u64, after: u8, operations: Vec<Operation>) -> Batch {
        Batch::plain(
            Some(record),
            Some("a1:00".to_owned()),
            Some(fingerprint(&digest(after))),
            operations,
        )
    }

    #[test]
    fn a_summary_is_ascii_and_reads_back_the_same_with_its_operations_by_batch() {
        let mut summary = recipe_over(
            7,
            vec![
                batch(
                    0,
                    1,
                    vec![
                        op("common/data/a.xml", Action::Replace, Some("C:\\кэш\\a.xml")),
                        op("common/data/gone.xml", Action::Delete, None),
                    ],
                ),
                batch(
                    1,
                    2,
                    vec![op(
                        "x64/new.rpf/in.xml",
                        Action::Upsert,
                        Some("C:\\s\\in.xml"),
                    )],
                ),
            ],
        );
        summary.allow_deletes = true;
        let dir = tempdir().unwrap();
        let file = dir.path().join("recipes").join("append.json");
        summary.save(&file).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.is_ascii(), "{text}");
        assert!(text.starts_with("{\n  \"schema\": 2,\n  \"kind\": \"append\""));
        assert_eq!(Summary::load(&file).unwrap(), summary);
        assert!(!points::sibling_name(&file, "tmp").exists());
        assert_eq!(summary.records(), vec![0, 1]);
        assert_eq!(summary.state(), fingerprint(&digest(2)));
        // у рецепта без записей состояние — файл начала цепочки
        assert_eq!(recipe_over(7, Vec::new()).state(), hex(&digest(7)));
    }

    #[test]
    fn a_toggle_batch_is_kept_by_its_record_number_and_follows_the_fingerprint_of_the_journal() {
        let toggle = |record: u64, after: u8| {
            let mut one = batch(record, after, Vec::new());
            one.toggle = true;
            one
        };
        let plain = vec![op(
            "common/data/a.xml",
            Action::Replace,
            Some("C:\\s\\a.xml"),
        )];
        let mut layered = batch(0, 1, plain);
        layered.layer = Some("mod-1".to_owned());
        let mut summary = recipe_over(7, vec![layered, toggle(1, 2), toggle(2, 3)]);
        // записи 1 и 2 слились в одну с номером 1 и отпечатком последней
        let replay = journal(7, &[(0, 1, Phase::Done), (1, 9, Phase::Done)]);
        let (standing, changed) = summary.reconcile(&replay);
        assert_eq!((standing, changed), (Standing::Same, true));
        assert_eq!(summary.records(), vec![0, 1]);
        assert_eq!(summary.batches[1].after, Some(fingerprint(&digest(9))));
        assert_eq!(summary.state(), fingerprint(&digest(9)));
        assert!(summary.covers(&replay));
        assert_eq!(summary.reconcile(&replay), (Standing::Same, false));
        // обычная партия с чужим отпечатком уходит, как раньше
        let mut stale = recipe_over(7, vec![batch(0, 5, Vec::new())]);
        assert_eq!(stale.reconcile(&replay), (Standing::Same, true));
        assert!(stale.is_empty());
        // партии слоёв и переключений переживают запись и чтение
        let dir = tempdir().unwrap();
        let file = dir.path().join("append.json");
        summary.save(&file).unwrap();
        let again = Summary::load(&file).unwrap();
        assert_eq!(again, summary);
        assert_eq!(again.layer_ids(), vec!["mod-1".to_owned()]);
        assert!(again.batches[1].toggle && again.batches[0].layer.is_some());
        // слитые переключения в рецепте: ушедшая партия уходит, оставшаяся несёт итог
        let mut direct = recipe_over(7, vec![batch(0, 1, Vec::new()), toggle(1, 2), toggle(2, 3)]);
        direct.merge_toggles(1, 2, &fingerprint(&digest(3)));
        assert_eq!(direct.records(), vec![0, 1]);
        assert_eq!(direct.state(), fingerprint(&digest(3)));
        // «Починить» не ставит заново партии слоёв, которых нет в файле, и переключения
        let kept = summary.without_layers(&["mod-1".to_owned()]);
        assert_eq!(kept.records(), vec![1]);
        assert!(summary.rebased("ab").batches.iter().all(|one| !one.toggle));
    }

    #[test]
    fn toggles_that_set_shared_entries_carry_them_through_merging_and_rebasing() {
        // замены общих записей у переключения: слитая партия несёт позднейшие, а после
        // починки партия остаётся партией основы (без неё вторая починка собрала бы
        // общие записи по установке слоя, а не по набору, что остался)
        let shared = |content: &str, dlclist: &str| {
            vec![
                op("content.xml", Action::Replace, Some(content)),
                op("common/data/dlclist.xml", Action::Replace, Some(dlclist)),
            ]
        };
        let toggle = |record: u64, after: u8, operations: Vec<Operation>| {
            let mut one = batch(record, after, operations);
            one.toggle = true;
            one
        };
        let mut layered = batch(0, 1, shared("C:\\s\\c1.xml", "C:\\s\\d1.xml"));
        layered.layer = Some("L1".to_owned());
        let mut summary = recipe_over(
            7,
            vec![
                layered,
                toggle(1, 2, shared("C:\\s\\c2.xml", "C:\\s\\d2.xml")),
                toggle(2, 3, shared("C:\\s\\c3.xml", "C:\\s\\d3.xml")),
            ],
        );
        summary.merge_toggles(1, 2, &fingerprint(&digest(3)));
        assert_eq!(summary.records(), vec![0, 1]);
        let merged = &summary.batches[1];
        assert!(merged.toggle);
        assert_eq!(merged.after, Some(fingerprint(&digest(3))));
        // у каждой записи одна замена, позднейшая
        let mut sources: Vec<String> = merged
            .operations
            .iter()
            .map(|one| one.source.as_ref().unwrap().to_string_lossy().into_owned())
            .collect();
        sources.sort();
        assert_eq!(
            sources,
            vec!["C:\\s\\c3.xml".to_owned(), "C:\\s\\d3.xml".to_owned()]
        );
        assert_eq!(
            summary.sources().len(),
            4,
            "источники первой установки и слитой партии"
        );

        // у слитых без операций ничего не меняется
        let mut plain = recipe_over(
            7,
            vec![
                batch(0, 1, Vec::new()),
                toggle(1, 2, Vec::new()),
                toggle(2, 3, Vec::new()),
            ],
        );
        plain.merge_toggles(1, 2, &fingerprint(&digest(3)));
        assert!(plain.batches[1].operations.is_empty());

        // после починки партия с общими записями остаётся (как партия основы), пустая уходит
        let mut mixed = summary.clone();
        mixed.batches.push(toggle(3, 4, Vec::new()));
        let based = mixed.rebased(&"ab".repeat(32));
        assert_eq!(based.batches.len(), 2, "{based:?}");
        assert!(based
            .batches
            .iter()
            .all(|one| !one.toggle && one.record.is_none() && one.after.is_none()));
        assert_eq!(based.batches[1].operations.len(), 2);
        // и она переживает запись и чтение рецепта
        let dir = tempdir().unwrap();
        let file = dir.path().join("append.json");
        based.save(&file).unwrap();
        assert_eq!(Summary::load(&file).unwrap(), based);
    }

    #[test]
    fn a_stage_one_recipe_or_any_other_file_is_not_a_summary_and_is_never_taken_for_one() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("r.json");
        let good = recipe_over(7, vec![batch(0, 1, vec![])]).text().unwrap();
        let cases = [
            ("", "not JSON"),
            ("[]", "not an object"),
            (
                &good.replace("\"schema\": 2", "\"schema\": 1"),
                "unknown schema",
            ),
            (&good.replace("\"append\"", "\"other\""), "unknown kind"),
            (&good.replace("\"origin\"", "\"orig\""), "no origin"),
            (&good.replace("\"batches\"", "\"b\""), "no batches"),
            (&good.replace("\"operations\"", "\"ops\""), "no operations"),
            (&good.replace(&hex(&digest(7)), "xyz"), "no origin sha256"),
        ];
        for (text, reason) in cases {
            fs::write(&file, text).unwrap();
            let error = Summary::load(&file).unwrap_err();
            assert_eq!(error.code, RECIPE_DAMAGED, "{text}");
            assert!(
                error.message.contains(reason),
                "{reason}: {}",
                error.message
            );
        }
        let missing = Summary::load(&dir.path().join("none.json")).unwrap_err();
        assert_eq!(missing.code, RECIPE_MISSING);
    }

    #[test]
    fn the_journal_keeps_the_truth_records_without_a_finished_journal_record_go() {
        let kept = batch(0, 1, vec![op("a.xml", Action::Replace, Some("C:\\a"))]);
        let ahead = batch(1, 2, vec![op("b.xml", Action::Replace, Some("C:\\b"))]);
        let mut summary = recipe_over(7, vec![kept.clone(), ahead.clone()]);
        // запись 1 откатили или не закончили: в журнале только 0
        let (standing, changed) = summary.reconcile(&journal(7, &[(0, 1, Phase::Done)]));
        assert_eq!((standing, changed), (Standing::Same, true));
        assert_eq!(summary.batches, vec![kept.clone()]);
        // запись, которая не закончена, тоже уходит
        let mut summary = recipe_over(7, vec![kept.clone(), ahead.clone()]);
        let unfinished = journal(7, &[(0, 1, Phase::Done), (1, 2, Phase::Synced)]);
        assert_eq!(summary.reconcile(&unfinished), (Standing::Same, true));
        assert_eq!(summary.records(), vec![0]);
        // запись с тем же номером, но другим отпечатком, — чужая
        let mut summary = recipe_over(7, vec![kept.clone(), ahead.clone()]);
        let other = journal(7, &[(0, 1, Phase::Done), (1, 99, Phase::Done)]);
        assert_eq!(summary.reconcile(&other), (Standing::Same, true));
        assert_eq!(summary.records(), vec![0]);
        // всё сошлось: ничего не менялось, рецепт покрывает журнал
        let mut summary = recipe_over(7, vec![kept.clone(), ahead.clone()]);
        let whole = journal(7, &[(0, 1, Phase::Done), (1, 2, Phase::Done)]);
        assert_eq!(summary.reconcile(&whole), (Standing::Same, false));
        assert!(summary.covers(&whole));
        assert!(!summary.covers(&journal(7, &[(0, 1, Phase::Done)])));
        assert!(!recipe_over(7, vec![kept]).covers(&whole));
    }

    #[test]
    fn another_chain_is_left_alone_and_no_journal_drops_every_record() {
        let one = batch(0, 1, vec![op("a.xml", Action::Replace, Some("C:\\a"))]);
        let mut summary = recipe_over(7, vec![one.clone()]);
        let foreign = journal(8, &[(0, 1, Phase::Done)]);
        assert_eq!(summary.reconcile(&foreign), (Standing::Other, false));
        assert_eq!(summary.records(), vec![0]);
        assert_eq!(
            summary.reconcile(&Replay::default()),
            (Standing::NoJournal, true)
        );
        assert!(summary.is_empty());
        // партии основы (после починки) журнал не трогает никогда
        let mut folded = recipe_over(7, vec![Batch::plain(None, None, None, one.operations)]);
        assert_eq!(
            folded.reconcile(&Replay::default()),
            (Standing::NoJournal, false)
        );
        assert_eq!(folded.batches.len(), 1);
    }

    #[test]
    fn a_rebased_summary_keeps_the_origin_and_folds_every_batch_into_the_new_chain_base() {
        let summary = recipe_over(
            7,
            vec![batch(0, 1, vec![op("a", Action::Replace, Some("C:\\a"))])],
        );
        let built = "CD".repeat(32);
        let rebased = summary.rebased(&built);
        assert_eq!(rebased.origin_sha256, summary.origin_sha256);
        assert_eq!(rebased.chain_base, built.to_ascii_lowercase());
        assert_eq!(rebased.records(), Vec::<u64>::new());
        assert_eq!(rebased.state(), built.to_ascii_lowercase());
        assert_eq!(
            rebased.operations().count(),
            summary.operations().count(),
            "операции остались"
        );
    }

    #[test]
    fn the_effective_operations_follow_the_last_word_on_every_path() {
        let a1 = op("common/data/a.xml", Action::Replace, Some("C:\\a1"));
        let a2 = op("common/data/a.xml", Action::Replace, Some("C:\\a2"));
        let gone = op("common/data/gone.xml", Action::Delete, None);
        let back = op("common/data/gone.xml", Action::Import, Some("C:\\gone"));
        let inner = op("x64/pack.rpf/in.xml", Action::Upsert, Some("C:\\in"));
        let whole = op("x64/pack.rpf", Action::Replace, Some("C:\\pack.rpf"));
        let summary = recipe_over(
            7,
            vec![
                batch(0, 1, vec![a1, gone.clone(), inner]),
                batch(1, 2, vec![a2.clone(), back.clone()]),
                batch(2, 3, vec![whole.clone()]),
            ],
        );
        let effective = summary.effective();
        let by_entry: BTreeMap<&str, &Operation> =
            effective.iter().map(|op| (op.entry.as_str(), op)).collect();
        // последняя замена, возвращённая запись и целый вложенный архив
        assert_eq!(by_entry["common/data/a.xml"], &a2);
        assert_eq!(by_entry["common/data/gone.xml"], &back);
        assert_eq!(by_entry["x64/pack.rpf"], &whole);
        // правка внутри вложенного архива отменена его заменой целиком
        assert!(!by_entry.contains_key("x64/pack.rpf/in.xml"));
        assert_eq!(effective.len(), 3);

        // снятая и не возвращённая запись должна отсутствовать
        let only_gone = recipe_over(7, vec![batch(0, 1, vec![gone])]);
        let effective = only_gone.effective();
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].action, Action::Delete);
        assert!(effective[0].allow_missing && effective[0].allow_delete);

        // запись внутри вложенного архива снята, потом в него добавлена другая:
        // обе остаются условиями итога
        let recreated = recipe_over(
            7,
            vec![
                batch(0, 1, vec![op("x64/gone.rpf/old.xml", Action::Delete, None)]),
                batch(
                    1,
                    2,
                    vec![op("x64/gone.rpf/new.xml", Action::Upsert, Some("C:\\n"))],
                ),
            ],
        );
        let entries: Vec<String> = recreated
            .effective()
            .into_iter()
            .map(|op| op.entry)
            .collect();
        assert_eq!(
            entries,
            vec!["x64/gone.rpf/new.xml", "x64/gone.rpf/old.xml"]
        );
    }

    #[test]
    fn sources_are_pinned_by_their_hash_with_a_link_or_a_copy_and_garbage_is_collected() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("payloads").join("Mod.YDD");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"payload").unwrap();
        let recipe = dir.path().join("recipes").join("append.json");
        let folder = sources_folder(&recipe);
        let operations = vec![
            Operation {
                entry: "a/mod.ydd".to_owned(),
                source: Some(source.clone()),
                sha256: None,
                action: Action::Upsert,
                allow_delete: false,
                allow_missing: false,
            },
            op("a/gone.ydd", Action::Delete, None),
        ];
        let pinned = pin_operations(&operations, &folder).unwrap();
        let hash = sha256_file(&source).unwrap();
        let place = folder.join(format!("{hash}.ydd"));
        assert_eq!(pinned[0].source, Some(place.clone()));
        assert_eq!(pinned[0].sha256.as_deref(), Some(hash.as_str()));
        assert_eq!(fs::read(&place).unwrap(), b"payload");
        assert_eq!(pinned[1].source, None);
        // повтор ничего не меняет и не кладёт лишнего
        assert_eq!(pin_operations(&pinned, &folder).unwrap(), pinned);
        let names = |folder: &Path| -> Vec<String> {
            let mut all: Vec<String> = fs::read_dir(folder)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            all.sort();
            all
        };
        assert_eq!(names(&folder), vec![format!("{hash}.ydd")]);
        // источник можно убрать у мода: закреплённый остаётся
        fs::remove_file(&source).unwrap();
        let summary = recipe_over(
            7,
            vec![Batch::plain(
                Some(0),
                None,
                Some(fingerprint(&digest(1))),
                pinned.clone(),
            )],
        );
        summary.check_sources().unwrap();
        // лишний файл в папке уходит при записи рецепта, нужный остаётся
        fs::write(folder.join("stray.bin"), b"x").unwrap();
        summary.save(&recipe).unwrap();
        assert_eq!(names(&folder), vec![format!("{hash}.ydd")]);
        // пропавший и изменённый источник отказывают разными кодами
        fs::write(&place, b"changed").unwrap();
        assert_eq!(summary.check_sources().unwrap_err().code, SOURCE_CHANGED);
        fs::remove_file(&place).unwrap();
        assert_eq!(summary.check_sources().unwrap_err().code, SOURCE_MISSING);
    }

    #[test]
    fn the_notes_of_the_journal_name_each_recipe_once() {
        let mut replay = journal(7, &[(0, 1, Phase::Done), (1, 2, Phase::Done)]);
        let place = std::env::temp_dir().join("r.json");
        replay.records[0].begin.note = place.to_string_lossy().as_bytes().to_vec();
        replay.records[1].begin.note = place.to_string_lossy().to_uppercase().as_bytes().to_vec();
        assert_eq!(recipe_notes(&replay), vec![place]);
        // пустая, не путь и не UTF-8 пометки пропускаются
        let mut empty = journal(7, &[(0, 1, Phase::Done), (1, 2, Phase::Done)]);
        empty.records[0].begin.note = b"relative.json".to_vec();
        empty.records[1].begin.note = vec![0xff, 0xfe];
        assert!(recipe_notes(&empty).is_empty());
    }
}
