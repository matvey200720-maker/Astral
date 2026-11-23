//! Писатель с дозаписью для корневого архива RPF7.
//!
//! Полный путь пишет архив целиком. Дозапись кладёт новые и изменённые тела в
//! конец живого файла и переписывает только голову (заголовок, записи, блок
//! имён); остальные тела остаются на своих местах.
//!
//! Раскладка (проект, раздел 3):
//!
//! * новое тело встаёт на `ceil512(конец файла)`, файл растёт только вперёд;
//! * оглавление кодируется заново целиком так же, как у доводчика (порядок
//!   записей, блок имён, `seal::relayout`), и шифруется NG своим кодом: ключ
//!   берётся по имени файла и НОВОЙ длине;
//! * правило головы: ни одно живое тело не начинается ниже
//!   `H = ceil512(E) + 64 КиБ`, где `E` — порог доводчика для нового
//!   оглавления; тела ниже `H` переезжают в конец тем же проходом.
//!
//! Порядок на диске (раздел 5), каждый шаг сброшен на диск:
//!
//! 1. запись журнала (прежняя голова, переезды, отпечатки, области на месте);
//! 2. файл растёт, пишутся переезды и новые тела выше прежней длины, а у
//!    вложенных архивов с запасом — тела в запас;
//! 3. отметка «данные на диске»;
//! 4. запись новых голов: сначала вложенные, потом корень;
//! 5. отметка «готово» с отпечатком файла.
//!
//! До шага 4 архив читается как прежний; оборванную запись откатывает
//! `Session::settle` (прежние байты голов из журнала, нули в куски запаса,
//! усечение). Откат любой готовой записи возвращает файл байт в байт.
//!
//! Вложенные архивы (проект, раздел 3; глубина 1). Вложенный `.rpf` — одна
//! сплошная запись корня. Первая правка переносит его в конец корня целиком с
//! запасом внутри: новая длина — `ceil512(конец тел + max(1 МиБ, 1/8 длины))`;
//! оглавление вложенного пишется заново (свой ключ NG по имени записи и НОВОЙ
//! длине). Следующие правки кладут новые тела в запас (нули после последнего
//! тела по оглавлению), длина вложенного и его запись в корне не меняются,
//! переписывается только голова вложенного. Запас кончился или в нём не нули —
//! переезд заново. Вложенный больше 256 МиБ не переезжает (`NestedTooLarge`),
//! вложенный во вложенном не правится (`NestedTooDeep`), вложенный не NG
//! отказ (`NotNg`).
//!
//! Правка запаса пишет ниже прежней длины файла: голову вложенного и тела в
//! запас. Журнал хранит для каждой такой области прежние байты (`Region`) и
//! нули запаса (`Fill`), а окна прежних тел, по которым узнаётся «файл наш»,
//! выбираются там, куда запись не пишет (`Anchor`).
//!
//! Уплотнение (проект, раздел 10). Снятые и заменённые тела оставляют дыры, а
//! архив растёт только вперёд. Перед записью, по раскладке, писатель решает,
//! каким архив станет после неё, и отказывает `CompactionDue` до любой записи
//! в файл, если после неё: мёртвых байт больше `Tuning::dead_limit` или больше
//! `1/dead_share` длины архива; старт следующих тел выше потолка; записей в
//! журнале больше `Tuning::max_records`. Мёртвые байты для порога — настоящий
//! мусор (старые копии переехавших тел и вложенных, снятые тела), а
//! неиспользованный запас вложенных архивов считается отдельно
//! (`reserve_bytes`): иначе одна первая правка вложенного, которая по замыслу
//! оставляет запас, давала бы ложное срабатывание порога в 1/8. Вызывающий на
//! `CompactionDue` идёт полным путём: он пересобирает архив без дыр, а подмена
//! файла убирает журнал, и цепочка начинается заново.
//!
//! Сводный рецепт. Писатель ничего не знает о рецептах: он отдаёт вызывающему
//! крюк `before_head` (после отметки «данные на диске», до записи голов), и
//! пометку записи в журнале (`Session::set_note`), по которой восстановление
//! находит то, что вызывающий хранит рядом с записью.

use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use sha2::{Digest as _, Sha256};

use crate::{
    activity,
    archive::{Archive, EntryCipher, EntryId, EntryKind},
    error::{Result, RpfError},
    journal::{
        self, Anchor, Base, Begin, Digest, Entry, Fill, LayerOp, Moved, Phase, Region, RegionRef,
        Replay, Stamp, JOURNAL_SUFFIX,
    },
    keys::KeySet,
    layers::{self, LayerPlace, LayerReport, LayerSet, Word},
    read_pace,
    seal::{self, Node},
    source::{ByteSource, FileSource, OverlaySource, SliceSource},
    tail::{tail_len, TailPolicy},
    toc::{
        encode_entry, parse_entry, read_toc, RawEntry, RawKind, BLOCK, ENCRYPTION_NG, ENTRY_SIZE,
        HEADER_SIZE, MAGIC,
    },
    tree::{Body, DirNode, FileNode},
    write::{prepare_fresh, Fresh, Sink, WriteContext},
};

pub use crate::journal::journal_path;

mod switch;
pub use switch::{RegistryInput, RegistryReport, SwitchAll, SwitchInput, SwitchReport};

/// Общая запись корня, которую слой при установке заменяет, но не берёт себе:
/// её тело собирает вызывающий из включённых слоёв, поэтому она не входит в
/// записи слоя (нет зависимости слоёв друг от друга, нет `LayerCovered`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistryPlace {
    /// Путь записи в корне (ASCII, звенья через `/`, регистр не важен).
    pub entry: String,
    /// SHA-256 нового содержимого (распакованных данных).
    pub sha: Digest,
}

/// Архив меньше этого дозаписью не пишется: оболочки одежды и дорог (3–7 КБ)
/// полным путём дешевле журнала.
pub const MIN_ARCHIVE: u64 = 64 << 20;
/// Старт новых тел не выше 2 500 000 000 Б (десятичные), пока игра с большими
/// смещениями в `update.rpf` не проверена: у Rockstar тела встречаются до
/// 2,56 ГБ, и потолок должен стоять ниже.
pub const BODY_START_CEILING: u64 = 2_500_000_000;
/// Запас головы за порогом доводчика: около 1500 новых записей до следующего
/// переезда тел.
pub const HEAD_MARGIN: u64 = 64 << 10;
/// Последний блок, на который можно положить запись (23 бита смещения).
const LAST_BLOCK: u64 = 0x7f_ffff;
/// Смещение имени файла в записи — 16 бит.
const FILE_NAME_AT_MAX: u32 = 0xffff;
/// Порция чтения и копирования.
const PORTION: usize = 8 << 20;
/// Сектор, по которому голова сверяется при доводке оборванной записи.
const SECTOR: usize = 512;
/// Окно прежнего файла перед его концом, по которому узнаётся «файл наш».
const ANCHOR_WINDOW: u64 = 64 << 10;
/// Окон не больше стольких: между областями записи они режутся на куски.
const MAX_ANCHORS: usize = 16;
/// Вложенный не меньше такого запаса при переезде.
pub const NESTED_RESERVE_MIN: u64 = 1 << 20;
/// Вложенный больше этого не переезжает: такая установка идёт полным путём.
pub const NESTED_MAX_MOVE: u64 = 256 << 20;
/// Порция нулей при откате запаса.
const ZERO_PORTION: usize = 1 << 20;
/// Предел числа записей и размера блока имён, как у чтения оглавления.
const MAX_ENTRIES: u32 = 8_000_000;
const MAX_NAMES_BYTES: u32 = 268_435_456;
/// Мёртвых байт больше этого после записи — пора уплотнять (проект, раздел 10).
pub const DEAD_LIMIT: u64 = 256 << 20;
/// Мёртвых байт больше этой доли архива (одной восьмой) — пора уплотнять.
pub const DEAD_SHARE: u64 = 8;
/// Записей на стопке журнала после новой больше стольких — пора уплотнять. 256 с 20.11.2026: замер на настоящем движке (200 установок в контейнер, `docs/RP-CONTAINER-APPEND.md`) —
/// время установки и открытия не растёт (0,24 → 0,30 с, 1,4 с), журнал ≈ 49 КБ на запись, полный откат побайтно; прежнее значение было 64.
pub const MAX_RECORDS: usize = 256;

// ---------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------

/// Код отказа дозаписи: по нему вызывающий решает, идти ли полным путём.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Code {
    /// Вложенный архив нельзя править дозаписью (сжатая запись, не `.rpf`-файл
    /// там, где ждали архив).
    NestedNotSupported,
    /// У живого файла больше одной жёсткой ссылки.
    Linked,
    /// Архив не тот, что мы оставили (чужая правка, обновление игры).
    ForeignChange,
    /// Архив меньше порога дозаписи.
    ArchiveTooSmall,
    /// Метка оглавления не NG (AES, открытое).
    NotNg,
    /// Новое тело стартовало бы выше потолка или выше блока 0x7fffff.
    BodyStartTooHigh,
    /// Смещение имени файла не помещается в 16 бит.
    NameOffsetTooHigh,
    /// Имя не из ASCII: блок имён его не передаст байт в байт.
    UnsupportedName,
    /// Журнал испорчен посреди или чужой.
    JournalDamaged,
    /// Вложенный архив больше предела переезда (или стал бы больше 4 ГиБ).
    NestedTooLarge,
    /// Правка во вложенном архиве вложенного архива: глубина больше одного.
    NestedTooDeep,
    /// Пора уплотнять: после этой записи архив перешёл бы порог мёртвых байт,
    /// потолка или длины журнала. Файл не тронут; вызывающий идёт полным путём.
    CompactionDue,
    /// Таблица слоёв испорчена или потеряна (слои есть в журнале, а в таблице нет).
    LayersDamaged,
    /// Такого слоя нет (или он уже снят).
    LayerUnknown,
    /// Слой с таким id уже стоит.
    LayerExists,
    /// Запись слоя, которую нужно вернуть, перекрыта чужой правкой: слово записи
    /// не то, которое положил слой.
    LayerCovered,
    /// Слой правил существующий вложенный архив: он не переключается.
    LayerLinked,
    /// Не выполнены условия слоя: нужный слой выключен или от него зависит
    /// включённый.
    LayerRequires,
    /// Один слой назван в запросе дважды (включить и выключить).
    LayerConflict,
    /// Голова после переключения не поместилась перед первым живым или спящим телом.
    HeadBeyondMax,
    /// Запись, названная реестром, не годится (нет или не двоичная).
    RegistryInvalid,
    /// Файл недостроенного нового архива чужой: не тот, что оставила сборка
    /// (другой номер файла, другая длина, не нули там, где ещё нет головы), либо
    /// на его месте лежит файл без маркера.
    BuildForeign,
    /// Маркер недостроенного архива или лёгшие тела испорчены.
    BuildDamaged,
    /// Маркер недостроенного архива описывает другой состав (список записей,
    /// размеры, имя).
    BuildPlanChanged,
    /// Недостроенный архив уже есть, а запрос не просит продолжить.
    BuildExists,
    /// Не все тела легли: печатать рано.
    BuildIncomplete,
    /// SHA-256 пришедшего тела не равен ожидаемому.
    HashMismatch,
    /// Пришло не столько байт, сколько заказано.
    SizeMismatch,
    /// На месте готового архива уже лежит файл.
    OutputExists,
    /// Архив длиннее потолка нового архива.
    ArchiveTooLarge,
    /// Запись длиннее 4 ГиБ.
    EntryTooLarge,
    /// Файл не доказан нашим: отпечаток не совпал с ожидаемым.
    NotOurs,
    /// Файл занят другим процессом, который не даёт писать.
    Busy,
    /// Архив «как будет» не держит того, что ждал вызывающий (проверка до записи
    /// голов): запись снята, архив прежний.
    ExpectationFailed,
    /// Удержанной записи нет на вершине журнала (её не было, она уже записана,
    /// снята откатом или доведена восстановлением).
    HoldMissing,
    /// Удержанная запись не та: файл, будущие головы или тела в хвосте не совпали
    /// с тем, что снято при удержании.
    StageChanged,
    /// Сборка «следом» (`follow`): в журнале готовности долго нет новых строк.
    /// Недостроенное остаётся для резюме.
    FollowStalled,
    /// Сборка «следом»: сборщик написал в журнале `abort`; недостроенное убрано.
    FollowAborted,
    /// Сборка «следом»: строка журнала не разбирается или без обязательных полей.
    FollowBadLine,
    /// Сборка «следом»: путь назван в журнале дважды.
    FollowDuplicate,
    /// Сборка «следом»: в журнале путь, которого нет в плане.
    FollowUnknown,
    /// Сборка «следом»: журнал кончился (`end`), а часть записей плана не названа.
    FollowIncomplete,
    /// Длина файла должна держать ключ головы (`set_keep_key`), а прежняя голова
    /// открывается не тем ключом, что даёт формула от длины файла: архив уже
    /// «сдвинут» (чужая запись, подмена). Ничего не записано.
    KeyShifted,
    /// Добавка нулей, при которой длина файла держит ключ головы, не нашлась до
    /// потолка перебора. Ничего не записано.
    KeyPadTooLong,
}

impl Code {
    /// Слово кода в ответе команды.
    pub const fn name(self) -> &'static str {
        match self {
            Code::ExpectationFailed => "ExpectationFailed",
            Code::HoldMissing => "HoldMissing",
            Code::StageChanged => "StageChanged",
            Code::BuildForeign => "BuildForeign",
            Code::BuildDamaged => "BuildDamaged",
            Code::BuildPlanChanged => "BuildPlanChanged",
            Code::BuildExists => "BuildExists",
            Code::BuildIncomplete => "BuildIncomplete",
            Code::HashMismatch => "HashMismatch",
            Code::SizeMismatch => "SizeMismatch",
            Code::OutputExists => "OutputExists",
            Code::ArchiveTooLarge => "ArchiveTooLarge",
            Code::EntryTooLarge => "EntryTooLarge",
            Code::NotOurs => "NotOurs",
            Code::Busy => "Busy",
            Code::LayersDamaged => "LayersDamaged",
            Code::LayerUnknown => "LayerUnknown",
            Code::LayerExists => "LayerExists",
            Code::LayerCovered => "LayerCovered",
            Code::LayerLinked => "LayerLinked",
            Code::LayerRequires => "LayerRequires",
            Code::LayerConflict => "LayerConflict",
            Code::HeadBeyondMax => "HeadBeyondMax",
            Code::RegistryInvalid => "RegistryInvalid",
            Code::CompactionDue => "CompactionDue",
            Code::NestedTooLarge => "NestedTooLarge",
            Code::NestedTooDeep => "NestedTooDeep",
            Code::NestedNotSupported => "NestedNotSupported",
            Code::Linked => "Linked",
            Code::ForeignChange => "ForeignChange",
            Code::ArchiveTooSmall => "ArchiveTooSmall",
            Code::NotNg => "NotNg",
            Code::BodyStartTooHigh => "BodyStartTooHigh",
            Code::NameOffsetTooHigh => "NameOffsetTooHigh",
            Code::UnsupportedName => "UnsupportedName",
            Code::JournalDamaged => "JournalDamaged",
            Code::FollowStalled => "FollowStalled",
            Code::FollowAborted => "FollowAborted",
            Code::FollowBadLine => "FollowBadLine",
            Code::FollowDuplicate => "FollowDuplicate",
            Code::FollowUnknown => "FollowUnknown",
            Code::FollowIncomplete => "FollowIncomplete",
            Code::KeyShifted => "KeyShifted",
            Code::KeyPadTooLong => "KeyPadTooLong",
        }
    }
}

/// Отказ дозаписи.
#[derive(Debug)]
pub enum AppendError {
    /// Отказ с кодом; файл не тронут (или возвращён к прежнему).
    Refused { code: Code, message: String },
    /// Отмена; файл возвращён к прежнему.
    Cancelled,
    /// Остальное: ввод-вывод, формат, ключи.
    Other(RpfError),
}

impl AppendError {
    pub fn refused(code: Code, message: impl Into<String>) -> AppendError {
        AppendError::Refused {
            code,
            message: message.into(),
        }
    }

    /// Код отказа, если он с кодом.
    pub fn code(&self) -> Option<Code> {
        match self {
            AppendError::Refused { code, .. } => Some(*code),
            _ => None,
        }
    }
}

impl std::fmt::Display for AppendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppendError::Refused { code, message } => write!(f, "{}: {message}", code.name()),
            AppendError::Cancelled => f.write_str("Cancelled"),
            AppendError::Other(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for AppendError {}

impl From<RpfError> for AppendError {
    fn from(error: RpfError) -> Self {
        match error {
            RpfError::Cancelled => AppendError::Cancelled,
            other => AppendError::Other(other),
        }
    }
}

impl From<io::Error> for AppendError {
    fn from(error: io::Error) -> Self {
        AppendError::Other(RpfError::Io(error))
    }
}

fn format_error(text: impl Into<String>) -> AppendError {
    AppendError::Other(RpfError::format(text))
}

// ---------------------------------------------------------------------------
// Хозяин: признаки файла и точки обрыва
// ---------------------------------------------------------------------------

/// Признаки открытого файла, которые крейт сам не узнаёт (системные вызовы).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Facts {
    /// Сколько у файла имён (жёстких ссылок); `None` — не знаем.
    pub links: Option<u64>,
    /// Том и номер файла на нём.
    pub identity: Option<(u64, u64)>,
}

/// То, что дозапись берёт у вызывающего: признаки файла и точки обрыва для
/// стендов (`hit` умирает или стоит в названном месте; по умолчанию пустая).
pub trait Host: Sync {
    fn facts(&self, file: &File) -> io::Result<Facts>;

    fn hit(&self, _point: &str) {}
}

/// Хозяин по умолчанию: там, где стандартная библиотека даёт ссылки и номер
/// файла (Unix), он их отдаёт; иначе «не знаем».
pub struct PlainHost;

impl Host for PlainHost {
    fn facts(&self, file: &File) -> io::Result<Facts> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let meta = file.metadata()?;
            Ok(Facts {
                links: Some(meta.nlink()),
                identity: Some((meta.dev(), meta.ino())),
            })
        }
        #[cfg(not(unix))]
        {
            let _ = file;
            Ok(Facts::default())
        }
    }
}

// ---------------------------------------------------------------------------
// Настройки и отпечаток цепочки
// ---------------------------------------------------------------------------

/// Пороги дозаписи; умолчания — боевые, тесты ставят свои.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tuning {
    pub min_archive: u64,
    pub body_start_ceiling: u64,
    /// Запас головы за порогом доводчика: у корня и у вложенных архивов.
    pub head_margin: u64,
    /// Вложенный архив длиннее этого не переезжает.
    pub nested_max_move: u64,
    /// Наименьший запас вложенного при переезде (иначе 1/8 его длины).
    pub nested_reserve_min: u64,
    /// Порог мёртвых байт после записи (без запаса вложенных); 0 — порога нет.
    pub dead_limit: u64,
    /// Мёртвых байт больше `1/dead_share` длины архива — пора уплотнять; 0 — нет.
    pub dead_share: u64,
    /// Записей на стопке журнала после новой не больше стольких; 0 — без предела.
    pub max_records: usize,
}

impl Default for Tuning {
    fn default() -> Self {
        Tuning {
            min_archive: MIN_ARCHIVE,
            body_start_ceiling: BODY_START_CEILING,
            head_margin: HEAD_MARGIN,
            nested_max_move: NESTED_MAX_MOVE,
            nested_reserve_min: NESTED_RESERVE_MIN,
            dead_limit: DEAD_LIMIT,
            dead_share: DEAD_SHARE,
            max_records: MAX_RECORDS,
        }
    }
}

impl Tuning {
    /// Пороги уплотнения сняты: стенды, которым нужны длинные цепочки правок
    /// на малых архивах.
    pub const fn without_compaction(mut self) -> Self {
        self.dead_limit = 0;
        self.dead_share = 0;
        self.max_records = 0;
        self
    }
}

/// Потолок добавки нулей, при которой длина файла держит ключ головы (R4). Ключ
/// NG идёт по кругу из 101 при каждом байте длины, а круг рвётся один раз на 2^32
/// (на самом деле сумма «хэш имени + длина + 61» переходит через 2^32): по формуле
/// хватает 168 байт, 201 — запас проекта (`2 * 100 + 1`). Не нашлась — отказ
/// `KeyPadTooLong`, ничего не записано.
pub const KEEP_KEY_PAD_MAX: u64 = 201;

/// Наименьшая добавка `k` из `0..=max`, при которой ключ по длине `len + k`
/// равен `wanted` (`pick` — выбор ключа по длине файла, у игры
/// `KeySet::ng_key_index(имя, длина)`). `None` — до потолка не нашлась.
pub fn keep_key_pad(
    len: u64,
    wanted: usize,
    max: u64,
    pick: &dyn Fn(u64) -> usize,
) -> Option<u64> {
    (0..=max).find(|&pad| pick(len.saturating_add(pad)) == wanted)
}

/// Сколько байт с конца файла просматривать в поисках нулевой добивки хвоста: запас хвоста вместе с подгонкой ключа — до ~450 КиБ.
const TAIL_SCAN_MAX: u64 = 1 << 20;

/// Начало последней записи с телом по узлам оглавления (по смещению); 0 — тел нет.
fn last_body_start(nodes: &[Node]) -> u64 {
    nodes
        .iter()
        .filter_map(|node| match node.kind {
            RawKind::Binary {
                stored_size,
                offset_blocks,
                uncompressed_size,
                ..
            } => {
                let len = if stored_size == 0 { uncompressed_size } else { stored_size };
                (len > 0).then(|| u64::from(offset_blocks) * BLOCK)
            }
            RawKind::Resource {
                stored_size,
                offset_blocks,
                ..
            } => (stored_size > 0).then(|| u64::from(offset_blocks) * BLOCK),
            RawKind::Directory { .. } => None,
        })
        .max()
        .unwrap_or(0)
}

/// Сколько осталось до каждого порога уплотнения после записи (`None` — порога
/// нет). Если хоть что-то перейдено, запись отказывает `CompactionDue`, так что
/// у готовой записи остатки не отрицательные.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Remaining {
    /// До порога мёртвых байт.
    pub dead_bytes: Option<u64>,
    /// До порога в долю архива (по длине файла после записи).
    pub dead_share: Option<u64>,
    /// От старта следующих тел до потолка.
    pub body_start: Option<u64>,
    /// Записей журнала, которые ещё поместятся.
    pub records: Option<usize>,
}

/// Отпечаток состояния: SHA-256 (длина файла ‖ SHA-256 головы ‖ предыдущий
/// отпечаток); длина — восемь байт, младшим вперёд.
pub fn chain_digest(len: u64, head_sha: &Digest, prev: &Digest) -> Digest {
    let mut sum = Sha256::new();
    sum.update(len.to_le_bytes());
    sum.update(head_sha);
    sum.update(prev);
    sum.finalize().into()
}

/// SHA-256 байт.
pub fn sha256(bytes: &[u8]) -> Digest {
    Sha256::digest(bytes).into()
}

/// Отпечаток для ответов: `a1:` и 64 шестнадцатеричные цифры.
pub fn fingerprint(digest: &Digest) -> String {
    format!("a1:{}", hex(digest))
}

/// Шестнадцатеричные цифры (строчные).
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Из 64 шестнадцатеричных цифр (любой регистр) или из `a1:` и 64 цифр.
pub fn parse_digest(text: &str) -> Option<Digest> {
    let digits = text.strip_prefix("a1:").unwrap_or(text);
    if digits.len() != 64 || !digits.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (at, pair) in digits.as_bytes().chunks(2).enumerate() {
        out[at] = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// Итоги
// ---------------------------------------------------------------------------

/// Что сделало восстановление над оборванной записью.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Settled {
    /// Всё чисто: оборванной записи не было.
    Clean,
    /// Новая голова лежала целиком: запись доведена до «готово».
    Completed(u64),
    /// Запись откатана: архив прежний.
    RolledBack(u64),
}

/// Времена шагов, миллисекунды.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Timings {
    pub plan: u64,
    pub write: u64,
    pub sync: u64,
    pub head: u64,
    pub journal: u64,
}

/// Итог дозаписи.
#[derive(Clone, Debug)]
pub struct AppendReport {
    pub seq: u64,
    /// Отпечаток после записи (`a1:…`) и до неё.
    pub fingerprint: String,
    pub fingerprint_before: String,
    pub old_len: u64,
    pub new_len: u64,
    /// Записано байт: тела, переезды, голова.
    pub bytes_written: u64,
    /// Из них переехало телами.
    pub bytes_moved: u64,
    /// Мёртвых байт в архиве после записи, считая неиспользованный запас
    /// вложенных архивов.
    pub dead_bytes: u64,
    /// Из них запас тронутых вложенных (нули после последнего тела): не мусор, а
    /// место под следующие правки.
    pub reserve_bytes: u64,
    /// Мусор: `dead_bytes` без запаса и без спящих тел слоёв. По нему считаются
    /// пороги уплотнения.
    pub garbage_bytes: u64,
    /// Спящие тела слоёв (нужны, чтобы включить или выключить слой): не мусор.
    /// У архива без слоёв 0.
    pub dormant_bytes: u64,
    /// Слой, который положила эта запись.
    pub layer: Option<LayerReport>,
    /// Сколько осталось до каждого порога уплотнения.
    pub remaining: Remaining,
    /// SHA-256 файла в начале цепочки журнала, которой принадлежит запись.
    pub chain_base: Digest,
    pub moved_bodies: usize,
    pub new_bodies: usize,
    pub head_len: u64,
    /// Вложенных архивов переехало в конец корня (первая правка или запас кончился).
    pub nested_moved: usize,
    /// Правок вложенных архивов, которые легли в их запас (длина вложенного и его
    /// запись в корне не менялись).
    pub nested_in_reserve: usize,
    /// Вложенных архивов, которых раньше не было и которые записаны заново.
    pub nested_created: usize,
    /// Записей на стопке журнала после этой.
    pub journal_records: usize,
    /// Сколько нулей добавлено в конец файла, чтобы длина держала ключ головы
    /// (`set_keep_key`); `None` — ключ не держался.
    pub key_pad: Option<u64>,
    pub settled: Settled,
    pub timings: Timings,
}

/// Итог отката.
#[derive(Clone, Debug)]
pub struct RollbackReport {
    /// Номера снятых записей, с вершины вниз.
    pub rolled_back: Vec<u64>,
    /// Названной записи в журнале не было.
    pub missing: bool,
    pub settled: Settled,
    pub journal_records: usize,
    /// Отпечаток архива после отката (`a1:…` или SHA-256 базы).
    pub fingerprint: Option<String>,
    pub timings: Timings,
}

/// Одна запись журнала для разговора с вызывающим.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordInfo {
    pub seq: u64,
    pub phase: Phase,
    pub old_len: u64,
    pub new_len: u64,
    pub before: Digest,
    pub after: Digest,
}

/// Что журнал знает об архиве.
#[derive(Clone, Debug)]
pub struct Status {
    pub records: Vec<RecordInfo>,
    /// SHA-256 файла в начале цепочки.
    pub base: Option<Digest>,
    pub torn: bool,
}

// ---------------------------------------------------------------------------
// Сессия
// ---------------------------------------------------------------------------

/// Файл открыт на запись без общего доступа на запись и удаление; журнал
/// прочитан. Всё, что меняет архив, идёт через сессию.
pub struct Session<'h> {
    host: &'h dyn Host,
    path: PathBuf,
    name: String,
    file: File,
    journal: PathBuf,
    replay: Replay,
    tuning: Tuning,
    clock: Clock,
    /// Пометка, которую получит следующая запись журнала.
    note: Vec<u8>,
    /// Слой, который положит следующая дозапись этой сессии.
    layer: Option<LayerPlace>,
    /// Общие записи корня, которые слой заменяет, но не берёт себе.
    layer_registry: Vec<RegistryPlace>,
    /// Проверка архива «как будет» до записи голов.
    preview: Option<PreviewCheck>,
    /// Длина файла держит ключ головы (R4): потолок добавки нулей; `None` — не держит.
    keep_key: Option<u64>,
    /// Хвост после последней записи (`crate::tail`): запас от начала последней записи до конца, длина кратна границе;
    /// `None` — файл кончается сразу за последним телом (прежнее поведение).
    tail: Option<TailPolicy>,
}

/// Проверка будущего архива до записи голов: получает архив, каким его откроет
/// читатель после записи (голова подставлена поверх файла, тела уже лежат).
/// Отказ снимает запись, файл возвращается к прежнему.
pub type PreviewCheck = Box<dyn FnMut(&Archive) -> std::result::Result<(), AppendError> + Send>;

/// Что дозапись знает перед записью голов: по этому вызывающий записывает то, что
/// должно лежать на диске до голов (сводный рецепт).
#[derive(Clone, Debug)]
pub struct Ahead {
    /// Номер записи, которую пишет дозапись.
    pub seq: u64,
    /// Отпечатки состояния до записи и после неё (текст, как в ответах).
    pub fingerprint_before: String,
    pub fingerprint_after: String,
    /// SHA-256 файла в начале цепочки и длина файла тогда.
    pub chain_base: Digest,
    pub chain_base_len: u64,
    /// Цепочка началась этой записью (журнала раньше не было).
    pub new_chain: bool,
}

/// Крюк перед записью голов: тела и журнал уже на диске, головы прежние. Отказ
/// возвращает файл к прежнему (запись снимается), и дозапись отказывает им.
pub type BeforeHead<'a> = &'a mut dyn FnMut(&Ahead) -> std::result::Result<(), AppendError>;

/// Что отдаёт первый шаг дозаписи в два шага: будущие головы и отпечаток
/// дописанных байт. Вызывающий хранит это рядом с архивом (файл
/// `<архив>.astral-head-preview`), второй шаг читает обратно.
///
/// Подставив `patches` поверх файла (`OverlaySource`), читатель видит архив
/// «как будет»: головы вложенных и корня, длина файла уже новая, тела лежат.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldHead {
    /// Номер удержанной записи журнала.
    pub seq: u64,
    pub old_len: u64,
    pub new_len: u64,
    /// Участки для подстановки в порядке записи: головы вложенных архивов, голова
    /// корня последней (она всегда с нуля).
    pub patches: Vec<(u64, Vec<u8>)>,
    /// SHA-256 дописанных байт `[old_len, new_len)`.
    pub tail_sha: Digest,
}

/// Метка файла удержанных голов.
const HELD_MAGIC: &[u8; 8] = b"ASTRALHP";
const HELD_VERSION: u32 = 1;
/// Больше этого в файле удержанных голов не бывает (голова `update.rpf` — мегабайты).
const HELD_MAX_PATCH_BYTES: usize = 256 << 20;

/// Окончание имени файла удержанных голов рядом с архивом.
pub const HELD_SUFFIX: &str = ".astral-head-preview";

/// Путь файла удержанных голов рядом с архивом.
pub fn held_path(archive: &Path) -> PathBuf {
    let mut name = archive.as_os_str().to_os_string();
    name.push(HELD_SUFFIX);
    PathBuf::from(name)
}

impl HeldHead {
    /// Байты файла: метка, версия, номер, длины, отпечаток, участки.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(HELD_MAGIC);
        out.extend_from_slice(&HELD_VERSION.to_le_bytes());
        out.extend_from_slice(&self.seq.to_le_bytes());
        out.extend_from_slice(&self.old_len.to_le_bytes());
        out.extend_from_slice(&self.new_len.to_le_bytes());
        out.extend_from_slice(&self.tail_sha);
        out.extend_from_slice(&(self.patches.len() as u32).to_le_bytes());
        for (at, bytes) in &self.patches {
            out.extend_from_slice(&at.to_le_bytes());
            out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
            out.extend_from_slice(bytes);
        }
        out
    }

    /// Разбор файла; чужие или усечённые байты — отказ `StageChanged`.
    pub fn from_bytes(bytes: &[u8]) -> std::result::Result<HeldHead, AppendError> {
        let broken = || {
            AppendError::refused(
                Code::StageChanged,
                "The file of the held heads is damaged or foreign.",
            )
        };
        let mut at = 0usize;
        let mut take = |count: usize| -> std::result::Result<&[u8], AppendError> {
            let end = at.checked_add(count).ok_or_else(broken)?;
            let slice = bytes.get(at..end).ok_or_else(broken)?;
            at = end;
            Ok(slice)
        };
        if take(8)? != HELD_MAGIC {
            return Err(broken());
        }
        let word = |slice: &[u8]| u32::from_le_bytes(slice.try_into().unwrap_or([0; 4]));
        let long = |slice: &[u8]| u64::from_le_bytes(slice.try_into().unwrap_or([0; 8]));
        if word(take(4)?) != HELD_VERSION {
            return Err(broken());
        }
        let seq = long(take(8)?);
        let old_len = long(take(8)?);
        let new_len = long(take(8)?);
        let tail_sha: Digest = take(32)?.try_into().map_err(|_| broken())?;
        let count = word(take(4)?) as usize;
        let mut patches = Vec::new();
        let mut total = 0usize;
        for _ in 0..count {
            let place = long(take(8)?);
            let len = usize::try_from(long(take(8)?)).map_err(|_| broken())?;
            total = total.checked_add(len).ok_or_else(broken)?;
            if total > HELD_MAX_PATCH_BYTES {
                return Err(broken());
            }
            patches.push((place, take(len)?.to_vec()));
        }
        if at != bytes.len() {
            return Err(broken());
        }
        Ok(HeldHead {
            seq,
            old_len,
            new_len,
            patches,
            tail_sha,
        })
    }
}

/// Итог второго шага дозаписи в два шага.
#[derive(Clone, Debug)]
pub struct CommitReport {
    pub seq: u64,
    /// Отпечаток после записи (`a1:…`).
    pub fingerprint: String,
    pub timings: Timings,
}

/// Чем кончился проход дозаписи: записью голов или удержанием перед ними.
enum Staged {
    Done(AppendReport),
    Held(AppendReport, HeldHead),
}

#[derive(Default)]
struct Clock {
    sync: Duration,
    journal: Duration,
}

fn millis(span: Duration) -> u64 {
    u64::try_from(span.as_millis()).unwrap_or(u64::MAX)
}

fn open_exclusive(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ: остальным можно только читать
        options.share_mode(1);
    }
    options.open(path)
}

/// Заголовок и оглавление файла.
struct Head {
    /// Сколько байт занимает голова: заголовок, записи, блок имён.
    span: usize,
    count: u32,
    marker: u32,
}

fn parse_head(header: &[u8; HEADER_SIZE], len: u64) -> Result<Head> {
    let word = |at: usize| {
        u32::from_le_bytes([header[at], header[at + 1], header[at + 2], header[at + 3]])
    };
    if word(0) != MAGIC {
        return Err(RpfError::format(format!(
            "The identifier {:08X} did not match the expected value of 0x52504637",
            word(0)
        )));
    }
    let (count, names) = (word(4), word(8));
    if count > MAX_ENTRIES || names > MAX_NAMES_BYTES {
        return Err(RpfError::format(
            "the table of contents is implausibly large",
        ));
    }
    let span = HEADER_SIZE + count as usize * ENTRY_SIZE + names as usize;
    if span as u64 > len {
        return Err(RpfError::format(
            "the table of contents goes beyond the end of the file",
        ));
    }
    Ok(Head {
        span,
        count,
        marker: word(12),
    })
}

impl<'h> Session<'h> {
    /// Открывает архив для работы и читает журнал рядом. Жёсткие ссылки
    /// (больше одной) — отказ `Linked`: запись «на месте» тронула бы и другие
    /// имена файла.
    pub fn open(
        host: &'h dyn Host,
        path: &Path,
        tuning: Tuning,
    ) -> std::result::Result<Self, AppendError> {
        let file = open_exclusive(path)?;
        let facts = host.facts(&file)?;
        if facts.links.is_some_and(|links| links > 1) {
            return Err(AppendError::refused(
                Code::Linked,
                "The archive has more than one hard link; it is not written in place.",
            ));
        }
        let journal = journal_path(path);
        let replay = journal::read(&journal)?.unwrap_or_default();
        let name = path
            .file_name()
            .map_or_else(String::new, |last| last.to_string_lossy().into_owned());
        Ok(Session {
            host,
            path: path.to_path_buf(),
            name,
            file,
            journal,
            replay,
            tuning,
            clock: Clock::default(),
            note: Vec::new(),
            layer: None,
            layer_registry: Vec::new(),
            preview: None,
            keep_key: None,
            tail: None,
        })
    }

    /// Следующие записи этой сессии оставляют хвост по правилу `crate::tail`: от начала последней записи до конца файла не
    /// меньше запаса, длина кратна границе (нулями в конце; при `set_keep_key` ещё и с прежним ключом головы). Съёмка в игре
    /// (20.11.2026): маленький вложенный архив последним в `update.rpf`, сразу за ним конец файла, роняет сюжет. `None` — файл
    /// кончается за последним телом, как прежде.
    pub fn set_tail(&mut self, policy: Option<TailPolicy>) {
        self.tail = policy;
    }

    /// Следующие записи этой сессии растят файл до длины, у которой ключ шифрования
    /// головы прежний (R4): ключ NG берётся по имени и длине файла, и пока файл
    /// вырос, а голова ещё прежняя, игра, запущенная мимо Astral, всё равно читает
    /// прежнюю. Длина подбирается добавкой нулей в конец (`keep_key_pad`); `limit` —
    /// потолок добавки (`KEEP_KEY_PAD_MAX`), `None` — ключ не держится, запись
    /// прежняя байт в байт. Прежняя голова обязана открываться ключом по формуле
    /// от своей длины (`KeyShifted`), добавка не нашлась до потолка — `KeyPadTooLong`;
    /// оба отказа до любой записи.
    pub fn set_keep_key(&mut self, limit: Option<u64>) {
        self.keep_key = limit;
    }

    /// Проверка архива «как будет» до записи голов у следующей дозаписи этой
    /// сессии. Без неё дозапись прежняя.
    pub fn set_preview_check(&mut self, check: Option<PreviewCheck>) {
        self.preview = check;
    }

    /// Следующая дозапись этой сессии кладёт слой: запись журнала помечается им,
    /// порог головы считается по всем слоям (`H_max`), а строка слоя ложится в
    /// таблицу слоёв до записи голов. Без слоя дозапись прежняя.
    pub fn set_layer(&mut self, layer: Option<LayerPlace>) {
        self.layer = layer;
    }

    /// Общие записи корня слоя (`content.xml`, `dlclist.xml`): запись заменяется
    /// новым телом (оно в дереве запроса), но в записи слоя не входит: слой не
    /// зависит от слоёв, чьи строки лежат в том же реестре, и включается без них.
    /// Тело нового содержимого и прежнее, которое стояло, запоминаются в таблице
    /// вариантом по содержимому: потом `switch_all` ставит их без записи тела.
    /// Нужен слой (`set_layer`); общая запись обязана быть в архиве и заменяться
    /// двоичным телом в дереве (`RegistryInvalid` до любой записи).
    pub fn set_layer_registry(&mut self, registry: Vec<RegistryPlace>) {
        self.layer_registry = registry;
    }

    /// Пометка для записи, которую напишет эта сессия. Писатель её не читает: она
    /// ложится в кадр записи журнала и возвращается вместе с ним (`Begin::note`).
    /// Длиннее `journal::MAX_NOTE` байт обрезается.
    pub fn set_note(&mut self, note: &[u8]) {
        let len = note.len().min(journal::MAX_NOTE);
        self.note = note[..len].to_vec();
    }

    /// Отпечаток состояния для ответов: начало цепочки — SHA-256 файла как
    /// есть, дальше `a1:…`.
    pub fn text_of(&self, digest: &Digest) -> String {
        if self
            .replay
            .base
            .as_ref()
            .is_some_and(|base| &base.digest == digest)
        {
            hex(digest)
        } else {
            fingerprint(digest)
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn journal_file(&self) -> &Path {
        &self.journal
    }

    /// Журнал, как он прочитан.
    pub fn replay(&self) -> &Replay {
        &self.replay
    }

    /// Что журнал знает об архиве.
    pub fn status(&self) -> Status {
        Status {
            records: self
                .replay
                .records
                .iter()
                .map(|record| RecordInfo {
                    seq: record.begin.seq,
                    phase: record.phase,
                    old_len: record.begin.old_len,
                    new_len: record.begin.new_len,
                    before: record.begin.prev,
                    after: record.begin.after,
                })
                .collect(),
            base: self.replay.base.as_ref().map(|base| base.digest),
            torn: self.replay.torn,
        }
    }

    fn len(&mut self) -> io::Result<u64> {
        Ok(self.file.metadata()?.len())
    }

    fn read_at(&mut self, at: u64, buffer: &mut [u8]) -> io::Result<()> {
        self.file.seek(SeekFrom::Start(at))?;
        self.file.read_exact(buffer)
    }

    fn read_vec(&mut self, at: u64, len: usize) -> io::Result<Vec<u8>> {
        let mut buffer = vec![0u8; len];
        self.read_at(at, &mut buffer)?;
        Ok(buffer)
    }

    fn sync(&mut self) -> io::Result<()> {
        let begun = Instant::now();
        let outcome = self.file.sync_all();
        self.clock.sync += begun.elapsed();
        outcome
    }

    fn log(&mut self, entries: Vec<Entry>) -> std::result::Result<(), AppendError> {
        let begun = Instant::now();
        let outcome = journal::append(&self.journal, &mut self.replay, entries);
        self.clock.journal += begun.elapsed();
        outcome
    }

    fn stamp_now(&mut self) -> std::result::Result<Stamp, AppendError> {
        self.sync()?;
        // время читается заново по пути: так его видят и следующие процессы
        let modified = fs::metadata(&self.path)?.modified().ok();
        let facts = self.host.facts(&self.file)?;
        Ok(Stamp {
            modified: Stamp::from_time(modified),
            identity: facts.identity,
        })
    }

    /// Голова файла (с проверкой заголовка) и длина файла.
    fn head_now(&mut self) -> std::result::Result<(Vec<u8>, Head, u64), AppendError> {
        let len = self.len()?;
        if len < HEADER_SIZE as u64 {
            return Err(format_error("The file is too short to be an RPF7 archive."));
        }
        let mut header = [0u8; HEADER_SIZE];
        self.read_at(0, &mut header)?;
        let head = parse_head(&header, len)?;
        let bytes = self.read_vec(0, head.span)?;
        Ok((bytes, head, len))
    }

    // ----- сверка с журналом -----

    /// Отпечаток состояния, если журнал его знает, и совпадает ли с ним файл.
    /// `Ok(None)` — цепочки нет. Отказ `ForeignChange`, если архив не тот.
    fn chain_now(&mut self) -> std::result::Result<Option<Digest>, AppendError> {
        if self.replay.base.is_none() && self.replay.records.is_empty() {
            if !self.replay.is_blank() {
                return Err(AppendError::refused(
                    Code::JournalDamaged,
                    "The journal has no chain base.",
                ));
            }
            return Ok(None);
        }
        let (head, _, len) = self.head_now()?;
        let foreign = |what: &str| {
            AppendError::refused(
                Code::ForeignChange,
                format!("The archive is not the one the journal left: {what}."),
            )
        };
        let digest = match self.replay.top().map(|top| (top.phase, top.begin.clone())) {
            Some((Phase::Done, begin)) => {
                if len != begin.new_len
                    || chain_digest(len, &sha256(&head), &begin.prev) != begin.after
                {
                    return Err(foreign("length or head differ"));
                }
                // головы вложенных архивов, которые запись переписала на месте,
                // в отпечаток корня не входят: сверяются отдельно
                for region in &begin.regions {
                    let region = RegionRef {
                        at: region.at,
                        old: &region.old,
                        new_sectors: &region.new_sectors,
                    };
                    if !self.region_is_new(region)? {
                        return Err(foreign("the head of a nested archive differs"));
                    }
                }
                begin.after
            }
            Some(_) => {
                return Err(AppendError::refused(
                    Code::ForeignChange,
                    "The last journal record is unfinished.",
                ))
            }
            None => {
                let Some(base) = self.replay.base.clone() else {
                    return Ok(None);
                };
                if len != base.len
                    || head.len() != base.head_len as usize
                    || sha256(&head) != base.head_sha
                {
                    return Err(foreign("length or head differ"));
                }
                base.digest
            }
        };
        self.check_stamp()?;
        Ok(Some(digest))
    }

    /// Время изменения и номер файла те же, что после нашей последней операции.
    fn check_stamp(&mut self) -> std::result::Result<(), AppendError> {
        let Some(stamp) = self.replay.stamp.clone() else {
            return Ok(());
        };
        let modified = Stamp::from_time(fs::metadata(&self.path)?.modified().ok());
        let facts = self.host.facts(&self.file)?;
        let time_moved =
            stamp.modified.is_some() && modified.is_some() && stamp.modified != modified;
        let file_moved = stamp.identity.is_some()
            && facts.identity.is_some()
            && stamp.identity != facts.identity;
        if time_moved || file_moved {
            return Err(AppendError::refused(
                Code::ForeignChange,
                "The archive was written or replaced after the last journal record.",
            ));
        }
        Ok(())
    }

    /// Отпечаток архива по журналу; файл при этом сверяется. `None` — журнала нет.
    pub fn fingerprint(&mut self) -> std::result::Result<Option<String>, AppendError> {
        if !self
            .replay
            .records
            .iter()
            .all(|record| record.phase == Phase::Done)
        {
            return Err(AppendError::refused(
                Code::ForeignChange,
                "The last journal record is unfinished.",
            ));
        }
        let digest = self.chain_now()?;
        Ok(digest.map(|digest| self.text_of(&digest)))
    }

    /// SHA-256 файла целиком (один раз, в начале цепочки).
    fn hash_file(&mut self) -> std::result::Result<Digest, AppendError> {
        let len = self.len()?;
        let mut sum = Sha256::new();
        let mut buffer = vec![0u8; PORTION.min(len as usize).max(1)];
        let mut done = 0u64;
        self.file.seek(SeekFrom::Start(0))?;
        while done < len {
            activity::check()?;
            let take = (len - done).min(PORTION as u64) as usize;
            read_pace::pace_read(take as u64);
            self.file.read_exact(&mut buffer[..take])?;
            sum.update(&buffer[..take]);
            done += take as u64;
        }
        Ok(sum.finalize().into())
    }

    // ----- восстановление и откат -----

    /// Доводит оборванную запись: новая голова целиком на диске — запись
    /// готова; иначе файл возвращается к прежнему (прежние байты головы из
    /// журнала и усечение). Повторяем после обрыва в любой точке.
    ///
    /// Перед первой правкой файла доказывается, что файл наш (`prove_ours`):
    /// иначе, если лаунчер Rockstar или Steam подменил архив после обрыва,
    /// прежняя голова легла бы поверх чужого целого архива. Не доказано —
    /// `ForeignChange`, файл и журнал не тронуты.
    pub fn settle(&mut self) -> std::result::Result<Settled, AppendError> {
        let Some(top) = self.replay.top().map(|top| (top.phase, top.begin.clone())) else {
            return Ok(Settled::Clean);
        };
        let (phase, begin) = top;
        match phase {
            Phase::Done => Ok(Settled::Clean),
            Phase::Begun | Phase::Undoing => {
                self.undo_top(true)?;
                Ok(Settled::RolledBack(begin.seq))
            }
            Phase::Synced => {
                let whole = self.prove_ours(&begin)?;
                if whole && self.len()? == begin.new_len {
                    let stamp = self.stamp_now()?;
                    self.log(vec![Entry::Done(begin.seq, stamp)])?;
                    Ok(Settled::Completed(begin.seq))
                } else {
                    self.undo_top(false)?;
                    Ok(Settled::RolledBack(begin.seq))
                }
            }
        }
    }

    /// Доказательство «файл наш» для оборванной (или откатываемой) записи.
    /// Проверяется до любой правки файла и журнала:
    ///
    /// * номер файла тот же, что в начале записи (если он известен обеим сторонам);
    /// * длина не меньше прежней и не больше новой;
    /// * каждый сектор по 512 байт каждой области, которую запись переписывает на
    ///   месте (голова корня и головы вложенных), равен сектору прежнего образа
    ///   или новому (по SHA-256 из журнала): порванная запись головы даёт смесь
    ///   секторов, чужой файл — нет;
    /// * окна прежнего файла перед его концом (до 64 КиБ вместе, там, куда запись
    ///   не пишет) не изменились: ниже прежней длины запись пишет только в свои
    ///   области и куски запаса.
    ///
    /// Куски запаса (нули до записи, тела после) не проверяются: что в них
    /// легло, в журнале не записано, а откат возвращает туда нули.
    ///
    /// Ответ `true` — все области на месте уже новые.
    fn prove_ours(&mut self, begin: &Begin) -> std::result::Result<bool, AppendError> {
        let foreign = |what: &str| {
            AppendError::refused(
                Code::ForeignChange,
                format!(
                    "The archive is not the one the unfinished journal record was writing: {what}."
                ),
            )
        };
        let facts = self.host.facts(&self.file)?;
        if let (Some(then), Some(now)) = (begin.identity, facts.identity) {
            if then != now {
                return Err(foreign("another file now lies under this name"));
            }
        }
        let len = self.len()?;
        if len < begin.old_len || len > begin.new_len {
            return Err(foreign("its length is outside the record"));
        }
        // куски запаса лежат ниже прежней длины и не налезают на области на месте
        for fill in &begin.fills {
            if fill
                .at
                .checked_add(fill.len)
                .is_none_or(|end| end > begin.old_len)
            {
                return Err(foreign("the journal record does not fit the file"));
            }
        }
        let mut whole = true;
        for region in begin.in_place() {
            let Some(fresh) = self.prove_region(region, len)? else {
                return Err(foreign(
                    "a sector of a head is neither the old nor the new one",
                ));
            };
            whole &= fresh;
        }
        for anchor in &begin.anchors {
            let fits = anchor
                .from
                .checked_add(anchor.len)
                .is_some_and(|end| end <= begin.old_len)
                && anchor.len <= ANCHOR_WINDOW;
            if !fits {
                return Err(foreign("the journal record does not fit the file"));
            }
            let window = self.read_vec(anchor.from, anchor.len as usize)?;
            if sha256(&window) != anchor.sha {
                return Err(foreign("the old bodies below the previous end differ"));
            }
        }
        Ok(whole)
    }

    /// Область на месте: каждый сектор равен прежнему или новому. `Some(true)` —
    /// все новые, `Some(false)` — смесь, `None` — чужое. Область не по длине
    /// файла или с чужим числом секторов в журнале — чужое.
    fn prove_region(
        &mut self,
        region: RegionRef<'_>,
        len: u64,
    ) -> std::result::Result<Option<bool>, AppendError> {
        let size = region.old.len();
        let end = region.at.checked_add(size as u64);
        if end.is_none_or(|end| end > len) || region.new_sectors.len() != size.div_ceil(SECTOR) {
            return Ok(None);
        }
        let now = self.read_vec(region.at, size)?;
        let mut whole = true;
        for (at, sector) in now.chunks(SECTOR).enumerate() {
            let from = at * SECTOR;
            let was = sector == &region.old[from..from + sector.len()];
            let is = sha256(sector) == region.new_sectors[at];
            if !was && !is {
                return Ok(None);
            }
            whole &= is;
        }
        Ok(Some(whole))
    }

    /// Область на месте целиком новая (для готовой записи).
    fn region_is_new(&mut self, region: RegionRef<'_>) -> std::result::Result<bool, AppendError> {
        let len = self.len()?;
        let size = region.old.len();
        let end = region.at.checked_add(size as u64);
        if end.is_none_or(|end| end > len) || region.new_sectors.len() != size.div_ceil(SECTOR) {
            return Ok(false);
        }
        let now = self.read_vec(region.at, size)?;
        Ok(now
            .chunks(SECTOR)
            .zip(region.new_sectors)
            .all(|(sector, wanted)| &sha256(sector) == wanted))
    }

    /// Пишет нули на `[at, at + len)`.
    fn write_zeros(&mut self, at: u64, len: u64) -> io::Result<()> {
        let zeros = vec![0u8; ZERO_PORTION.min(len as usize).max(1)];
        self.file.seek(SeekFrom::Start(at))?;
        let mut left = len;
        while left > 0 {
            // откат отмены не слушается: он должен дойти до конца
            let take = left.min(zeros.len() as u64) as usize;
            self.file.write_all(&zeros[..take])?;
            left -= take as u64;
        }
        Ok(())
    }

    /// Участок файла целиком из нулей.
    fn is_zero(&mut self, at: u64, len: u64) -> io::Result<bool> {
        let mut buffer = vec![0u8; PORTION.min(len as usize).max(1)];
        self.file.seek(SeekFrom::Start(at))?;
        let mut left = len;
        while left > 0 {
            let take = left.min(buffer.len() as u64) as usize;
            read_pace::pace_read(take as u64);
            self.file.read_exact(&mut buffer[..take])?;
            if buffer[..take].iter().any(|&byte| byte != 0) {
                return Ok(false);
            }
            left -= take as u64;
        }
        Ok(true)
    }

    /// Снимает запись с вершины: прежние байты голов, нули в куски запаса,
    /// усечение, отметка. Сначала возвращаются головы (корня, потом вложенных) и
    /// только потом зануляется запас: пока голова вложенного новая, тела в запасе
    /// ей нужны. `prove` — сначала доказать, что файл наш; свои отказы записи
    /// (тот же сеанс держит файл) идут без доказательства.
    fn undo_top(&mut self, prove: bool) -> std::result::Result<(), AppendError> {
        let Some((phase, begin)) = self.replay.top().map(|top| (top.phase, top.begin.clone()))
        else {
            return Ok(());
        };
        if prove {
            self.prove_ours(&begin)?;
        }
        if phase != Phase::Undoing {
            self.log(vec![Entry::Undo(begin.seq)])?;
        }
        self.host.hit("undo-after-mark");

        let len = self.len()?;
        if len < begin.old_len {
            return Err(AppendError::refused(
                Code::ForeignChange,
                "The archive is shorter than before the record; it cannot be rolled back.",
            ));
        }
        for (at, region) in begin.in_place().enumerate() {
            self.file.seek(SeekFrom::Start(region.at))?;
            self.file.write_all(region.old)?;
            if at == 0 && !begin.regions.is_empty() {
                // корень возвращён, головы вложенных ещё новые
                self.sync()?;
                self.host.hit("undo-mid-heads");
            }
        }
        self.sync()?;
        self.host.hit("undo-after-head");

        if !begin.fills.is_empty() {
            for fill in &begin.fills {
                self.write_zeros(fill.at, fill.len)?;
            }
            self.sync()?;
            self.host.hit("undo-after-fills");
        }

        if len != begin.old_len {
            self.file.set_len(begin.old_len)?;
        }
        self.sync()?;
        self.host.hit("undo-after-truncate");

        let mut back = self.len()? == begin.old_len;
        for region in begin.in_place() {
            back &= self.read_vec(region.at, region.old.len())? == region.old;
        }
        for fill in &begin.fills {
            back &= self.is_zero(fill.at, fill.len)?;
        }
        if !back {
            return Err(format_error(
                "The archive did not return to the state before the record.",
            ));
        }
        let stamp = self.stamp_now()?;
        self.log(vec![Entry::Pop(begin.seq, stamp)])?;
        self.host.hit("undo-after-pop");
        // сжатие журнала — уборка: откат уже случился, и её отказ его не отменяет
        // (мёртвые кадры подождут следующего отката)
        let _ = self.compact_if_wasteful();
        Ok(())
    }

    fn compact_if_wasteful(&mut self) -> std::result::Result<(), AppendError> {
        let live = self.replay.valid_len.saturating_sub(self.replay.dead_bytes);
        if self.replay.dead_bytes > (64 << 10).max(live) {
            let begun = Instant::now();
            let outcome = journal::compact(&self.journal, &mut self.replay);
            self.clock.journal += begun.elapsed();
            outcome?;
        }
        Ok(())
    }

    /// Откат записей с вершины до записи `to_seq` включительно (точка отката
    /// установки — её запись). Записи с меньшими номерами остаются. Названной
    /// записи нет — откатывать нечего (`missing`), если она была уже снята.
    /// `expect_before` — отпечаток, которым начиналась откатываемая запись:
    /// не сошёлся — отказ `ForeignChange` до первого изменения.
    pub fn rollback(
        &mut self,
        to_seq: u64,
        expect_before: Option<&Digest>,
    ) -> std::result::Result<RollbackReport, AppendError> {
        let started = self.clock_start();
        let settled = self.settle()?;
        let found = self
            .replay
            .records
            .iter()
            .find(|record| record.begin.seq == to_seq)
            .map(|record| record.begin.prev);
        if let (Some(wanted), Some(actual)) = (expect_before, found) {
            if wanted != &actual {
                return Err(AppendError::refused(
                    Code::ForeignChange,
                    "The journal record does not start from the state the point remembers.",
                ));
            }
        }
        let mut done = Vec::new();
        let mut checked = false;
        while let Some(seq) = self.replay.top().map(|top| top.begin.seq) {
            if seq < to_seq {
                break;
            }
            if !checked {
                // первая откатываемая запись: файл обязан быть таким, каким мы его оставили
                self.chain_now()?;
                checked = true;
            }
            self.undo_top(true)?;
            done.push(seq);
        }
        let digest = if self.replay.records.is_empty() && self.replay.base.is_none() {
            None
        } else {
            self.chain_now()?
        };
        let fingerprint = digest.map(|digest| self.text_of(&digest));
        let settled_it = matches!(settled, Settled::RolledBack(seq) if seq >= to_seq);
        Ok(RollbackReport {
            missing: found.is_none() && done.is_empty() && !settled_it,
            rolled_back: done,
            settled,
            journal_records: self.replay.records.len(),
            fingerprint,
            timings: self.timings(started, Duration::ZERO, Duration::ZERO),
        })
    }

    fn clock_start(&mut self) -> Instant {
        self.clock = Clock::default();
        Instant::now()
    }

    fn timings(&self, started: Instant, plan: Duration, head: Duration) -> Timings {
        let total = started.elapsed();
        let rest = total
            .saturating_sub(plan)
            .saturating_sub(head)
            .saturating_sub(self.clock.sync)
            .saturating_sub(self.clock.journal);
        Timings {
            plan: millis(plan),
            write: millis(rest),
            sync: millis(self.clock.sync),
            head: millis(head),
            journal: millis(self.clock.journal),
        }
    }
}

// ---------------------------------------------------------------------------
// Дозапись
// ---------------------------------------------------------------------------

/// Чем заказана дозапись.
pub struct AppendInput<'a> {
    pub keys: &'a Arc<KeySet>,
    /// Архив, как его читал вызывающий, когда готовил дерево (после `settle`).
    pub base: &'a Arc<Archive>,
    /// Желаемое дерево: нетронутые файлы — `Body::Copy` из `base`, всё
    /// остальное — новые тела. Вложенный архив с правками — `Body::Nested` на
    /// месте своей записи в `base` (дерево из `FileNode::nested_root`); его
    /// нетронутые файлы — `Body::Copy` из вложенного архива, каким его отдаёт
    /// `base.open_nested_shared`. Вложенный архив, которого в `base` не было, —
    /// тоже `Body::Nested` (он записывается заново).
    pub tree: &'a DirNode,
    /// SHA-256 файла до первой дозаписи, если вызывающий его знает (без
    /// журнала цепочки). Нет — файл читается целиком один раз.
    pub base_sha256: Option<Digest>,
}

/// Тело, которое ляжет в файл по месту, и откуда оно.
enum Tail<'k> {
    /// Байты, уже лежащие в файле, копируются на новое место.
    Moved { from: u64, len: u64 },
    /// Новое тело.
    Fresh { body: Fresh<'k> },
    /// Готовые байты (голова переехавшего вложенного архива).
    Bytes { data: Vec<u8> },
}

/// Голова вложенного архива, которая пишется на месте.
struct HeadPlan {
    at: u64,
    bytes: Vec<u8>,
}

/// Общая запись слоя в дереве запроса.
struct RegistryNode {
    /// Узел новой таблицы.
    node: usize,
    /// Путь, как его назвал вызывающий.
    entry: String,
    /// SHA-256 нового содержимого.
    sha: Digest,
    /// Номер прежней записи в старом архиве.
    old: EntryId,
}

/// Прежнее тело общей записи читается ради SHA-256 содержимого, если оно не больше.
const REGISTRY_BODY_MAX: u64 = 64 << 20;

/// Всё, что нужно знать до первой записи.
struct Plan<'k> {
    head: Vec<u8>,
    /// Область головы корня: прежние байты `[0, max(прежняя голова, новая))`.
    old_head: Vec<u8>,
    /// SHA-256 секторов той же области после записи головы.
    new_sectors: Vec<Digest>,
    /// Головы вложенных архивов, которые пишутся на месте, и их области.
    nested_heads: Vec<HeadPlan>,
    regions: Vec<Region>,
    /// Куски запаса вложенных архивов, куда лягут тела.
    fills: Vec<Fill>,
    identity: Option<(u64, u64)>,
    anchors: Vec<Anchor>,
    tail: Vec<(u64, Tail<'k>)>,
    new_len: u64,
    dead_after: u64,
    moves: Vec<Moved>,
    bytes_moved: u64,
    bytes_new: u64,
    /// Байты голов вложенных архивов (на месте и в конце файла).
    bytes_heads: u64,
    prev: Digest,
    after: Digest,
    new_bodies: usize,
    nested_moved: usize,
    nested_in_reserve: usize,
    nested_created: usize,
    start_base: Option<Base>,
    /// Запас тронутых вложенных архивов после записи: нули после последнего тела.
    reserve_bytes: u64,
    /// Спящие тела слоёв после записи (у архива без слоёв 0).
    dormant_bytes: u64,
    /// Строка таблицы слоёв, которую пишет эта запись (слой заказан сессией).
    layer_row: Option<layers::Row>,
    layer_report: Option<LayerReport>,
    /// Варианты общих записей, которые лягут в таблицу вместе со слоем: запись,
    /// слово и SHA-256 содержимого (то, что стояло, и то, что встало).
    registry_variants: Vec<(String, Word, Digest)>,
    /// Добавка нулей к длине файла, которая держит ключ головы (`None` — не держится).
    key_pad: Option<u64>,
}

fn too_deep(name: &str) -> AppendError {
    AppendError::refused(
        Code::NestedTooDeep,
        format!(
            "{name} is a nested archive inside a nested archive; the depth is limited to one, \
             and nothing is appended."
        ),
    )
}

fn too_large(name: &str, why: &str) -> AppendError {
    AppendError::refused(
        Code::NestedTooLarge,
        format!("The nested archive {name} {why}; it is not moved."),
    )
}

/// Скелет таблицы: узлы в порядке «каталог, потом его дети подряд», и какие
/// из них новые тела.
struct Frame<'t> {
    nodes: Vec<Node>,
    /// Узел → прежний номер записи (нетронутые файлы).
    kept: Vec<(usize, usize)>,
    /// Узел → файл дерева, чьё тело новое.
    fresh: Vec<(usize, &'t FileNode)>,
    /// Вложенные архивы с правками (только у корня).
    nested: Vec<NestedJob<'t>>,
    /// Что нужно слою (только у корня и только когда слой заказан).
    track: Track,
}

/// Что запись делает с корнем, в понятиях слоя.
#[derive(Default)]
struct Track {
    /// Путь записи (звенья через `/`) у узлов, которые слой добавил или заменил.
    paths: HashMap<usize, String>,
    /// Новое тело на месте прежней записи: узел → номер прежней записи.
    replaced: Vec<(usize, usize)>,
    /// Каталоги, которых раньше не было, в порядке создания.
    created_dirs: Vec<String>,
    /// Файлов прежнего корня, которые есть и в новом дереве.
    present: usize,
}

/// Всё, что раскладка знает о слое: по этому строится строка таблицы.
struct LayerFacts<'a> {
    track: &'a Track,
    touched_nested: bool,
    /// Вложенные архивы, которых не было: узел и длина записи в корне.
    nested_added: &'a [(usize, u64)],
    /// Длины новых тел по узлам.
    fresh_len: &'a HashMap<usize, u64>,
    /// Слово и длина тела записи до замены, по узлам.
    before_of: &'a HashMap<usize, (Word, u64)>,
    /// Новый номер блока тела «до», если оно переехало из-под головы.
    moved_before: &'a HashMap<usize, u64>,
    /// Порядок записей новой таблицы и она сама.
    order: &'a [usize],
    table: &'a [u8],
    /// Узлы общих записей корня: слой их не берёт себе.
    registry: &'a [usize],
}

/// Вложенный архив, который правит эта запись.
struct NestedJob<'t> {
    node: usize,
    name: String,
    sub: &'t DirNode,
    /// Прежняя запись вложенного в корне; `None` — архива раньше не было.
    old: Option<NestedOld>,
}

struct NestedOld {
    inner: Arc<Archive>,
    /// Где вложенный лежит в корне: смещение и длина записи.
    off: u64,
    len: u64,
}

fn ascii_name(name: &str) -> std::result::Result<Vec<u16>, AppendError> {
    if !name.is_ascii() || name.contains('\0') {
        return Err(AppendError::refused(
            Code::UnsupportedName,
            format!("The name {name:?} is not ASCII; the names block would not carry it."),
        ));
    }
    Ok(name.encode_utf16().collect())
}

fn dir_node(name: Vec<u16>) -> Node {
    let kind = RawKind::Directory { first: 0, count: 0 };
    Node {
        raw: encode_entry(&RawEntry {
            name_offset: 0,
            kind: kind.clone(),
        }),
        kind,
        name,
    }
}

fn blank_file_node(name: Vec<u16>) -> Node {
    let blank = RawKind::Binary {
        stored_size: 0,
        offset_blocks: 0,
        uncompressed_size: 0,
        encrypted: false,
    };
    Node {
        raw: [0; ENTRY_SIZE],
        kind: blank,
        name,
    }
}

/// Прежняя запись вложенного архива по имени в каталоге корня.
fn nested_old(
    base: Option<&Arc<Archive>>,
    dir: Option<EntryId>,
    name: &str,
) -> std::result::Result<Option<NestedOld>, AppendError> {
    let (Some(archive), Some(dir)) = (base, dir) else {
        return Ok(None);
    };
    let Some(id) = archive.find_file(dir, name) else {
        return Ok(None);
    };
    let entry = archive.entry(id);
    let EntryKind::Binary(info) = &entry.kind else {
        // на месте лежала не двоичная запись: вложенный пишется заново
        return Ok(None);
    };
    if !Archive::is_nested_archive_name(&entry.name) {
        return Ok(None);
    }
    if info.stored_size != 0 || info.encrypted {
        return Err(AppendError::refused(
            Code::NestedNotSupported,
            format!(
                "The nested archive {} is stored compressed or encrypted; it is not appended.",
                entry.name
            ),
        ));
    }
    let inner = archive.open_nested_shared(id)?;
    Ok(Some(NestedOld {
        inner,
        off: info.offset(),
        len: info.stored_len(),
    }))
}

/// Идёт по дереву в ширину: дети каждого каталога лежат в `nodes` подряд.
/// `base` — архив, из которого взяты нетронутые файлы (`None` у вложенного,
/// которого раньше не было); `root_level` — это корень файла, а не вложенный
/// архив: только в нём `Body::Nested` значит правку вложенного.
fn frame_of<'t>(
    tree: &'t DirNode,
    base: Option<&Arc<Archive>>,
    old_records: &[u8],
    root_level: bool,
    track: bool,
) -> std::result::Result<Frame<'t>, AppendError> {
    let mut frame = Frame {
        nodes: vec![dir_node(Vec::new())],
        kept: Vec::new(),
        fresh: Vec::new(),
        nested: Vec::new(),
        track: Track::default(),
    };
    let track = track && root_level;
    type Queued<'t> = (&'t DirNode, usize, Option<EntryId>, String);
    type Child<'t> = (usize, Option<(&'t DirNode, Option<EntryId>)>);
    let mut queue: std::collections::VecDeque<Queued<'t>> = std::collections::VecDeque::new();
    queue.push_back((
        tree,
        0,
        base.filter(|_| root_level).map(|a| a.root()),
        String::new(),
    ));
    let old_raw = |id: usize| -> std::result::Result<[u8; ENTRY_SIZE], AppendError> {
        old_records
            .get(id * ENTRY_SIZE..(id + 1) * ENTRY_SIZE)
            .and_then(|slice| slice.try_into().ok())
            .ok_or_else(|| format_error("An entry of the archive is not in its table."))
    };
    while let Some((dir, at, base_dir, prefix)) = queue.pop_front() {
        let first = frame.nodes.len();
        let mut children: Vec<Child<'t>> = Vec::new();
        for sub in &dir.dirs {
            let node = dir_node(ascii_name(&sub.name)?);
            let below = base
                .zip(base_dir)
                .and_then(|(archive, id)| archive.find_dir(id, &sub.name));
            if track && below.is_none() {
                frame
                    .track
                    .created_dirs
                    .push(format!("{prefix}{}", sub.name));
            }
            children.push((frame.nodes.len(), Some((sub, below))));
            frame.nodes.push(node);
        }
        for file in &dir.files {
            let name = ascii_name(&file.name)?;
            let index = frame.nodes.len();
            match &file.body {
                Body::Nested(sub) => {
                    if !root_level {
                        return Err(too_deep(&file.name));
                    }
                    let old = nested_old(base, base_dir, &file.name)?;
                    if track {
                        frame
                            .track
                            .paths
                            .insert(index, format!("{prefix}{}", file.name));
                        frame.track.present += usize::from(old.is_some());
                    }
                    // запись корня: прежняя (вложенный переедет или останется) либо пустая
                    let node = match (&old, base.zip(base_dir)) {
                        (Some(_), Some((archive, dir_id))) => {
                            let id = archive.find_file(dir_id, &file.name).unwrap_or_default();
                            let raw = old_raw(id)?;
                            Node {
                                kind: parse_entry(&raw).kind,
                                raw,
                                name,
                            }
                        }
                        _ => blank_file_node(name),
                    };
                    frame.nodes.push(node);
                    frame.nested.push(NestedJob {
                        node: index,
                        name: file.name.clone(),
                        sub,
                        old,
                    });
                }
                Body::Copy { archive, id } if base.is_some_and(|b| Arc::ptr_eq(archive, b)) => {
                    let id = *id;
                    let raw = old_raw(id)?;
                    frame.kept.push((index, id));
                    frame.track.present += usize::from(track);
                    frame.nodes.push(Node {
                        kind: parse_entry(&raw).kind,
                        raw,
                        name,
                    });
                }
                _ => {
                    frame.fresh.push((index, file));
                    if track {
                        frame
                            .track
                            .paths
                            .insert(index, format!("{prefix}{}", file.name));
                        let old = base
                            .zip(base_dir)
                            .and_then(|(archive, id)| archive.find_file(id, &file.name));
                        if let Some(old) = old {
                            frame.track.replaced.push((index, old));
                            frame.track.present += 1;
                        }
                    }
                    frame.nodes.push(blank_file_node(name));
                }
            }
            children.push((index, None));
        }
        let count = children.len();
        let kind = RawKind::Directory {
            first: u32::try_from(first).map_err(|_| format_error("Too many entries."))?,
            count: u32::try_from(count).map_err(|_| format_error("Too many entries."))?,
        };
        frame.nodes[at].raw = encode_entry(&RawEntry {
            name_offset: 0,
            kind: kind.clone(),
        });
        frame.nodes[at].kind = kind;
        for (index, sub) in children {
            if let Some((sub, below)) = sub {
                queue.push_back((sub, index, below, format!("{prefix}{}/", sub.name)));
            }
        }
    }
    Ok(frame)
}

/// Копия дерева, у которой в каждом каталоге подкаталоги и файлы идут по имени
/// (порядок кодовых единиц UTF-16, как сортирует оглавление `seal::relayout`).
/// Вложенные архивы внутри не трогаются.
fn sorted_tree(tree: &DirNode) -> DirNode {
    fn sort(dir: &mut DirNode, depth: usize) {
        let key = |name: &str| name.encode_utf16().collect::<Vec<u16>>();
        dir.dirs.sort_by_cached_key(|sub| key(&sub.name));
        dir.files.sort_by_cached_key(|file| key(&file.name));
        if depth < 64 {
            for sub in &mut dir.dirs {
                sort(sub, depth + 1);
            }
        }
    }
    let mut copy = tree.clone();
    sort(&mut copy, 0);
    copy
}

/// Сырые 16 байт записи по её номеру в прежней таблице.
fn raw_of(records: &[u8], id: usize) -> std::result::Result<[u8; ENTRY_SIZE], AppendError> {
    records
        .get(id * ENTRY_SIZE..(id + 1) * ENTRY_SIZE)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| format_error("An entry of the archive is not in its table."))
}

/// Где у прежней записи тело и сколько оно занимает.
fn old_extent(base: &Archive, id: usize) -> Option<(u64, u64)> {
    match &base.entry(id).kind {
        EntryKind::Binary(info) => Some((info.offset(), info.stored_len())),
        EntryKind::Resource(info) => Some((info.offset(), u64::from(info.stored_size))),
        EntryKind::Directory { .. } => None,
    }
}

fn ceil_block(value: u64) -> u64 {
    seal::ceil_block(value)
}

/// Куда ляжет кусок вложенного архива, считая от его начала.
enum Piece<'k> {
    Moved { from: u64, len: u64 },
    Fresh(Fresh<'k>),
}

impl Piece<'_> {
    fn len(&self) -> u64 {
        match self {
            Piece::Moved { len, .. } => *len,
            Piece::Fresh(body) => body.len(),
        }
    }
}

/// Прежнее состояние вложенного архива.
struct OldNested {
    off: u64,
    len: u64,
    head_span: u64,
    /// Записи оглавления, расшифрованные.
    records: Vec<u8>,
    /// Конец тел по оглавлению (не меньше головы): дальше идёт запас из нулей.
    data_end: u64,
}

/// Что запись делает с одним вложенным архивом. Места считаются от начала
/// вложенного: где он окажется в файле, решает раскладка корня.
struct NestedPlan<'k> {
    node: usize,
    /// Смещение и длина прежней записи в корне; `None` — архив новый.
    old: Option<(u64, u64)>,
    /// Вложенный переезжает в конец корня (иначе правка ложится в его запас).
    relocate: bool,
    /// Длина записи вложенного после правки.
    new_len: u64,
    head: Vec<u8>,
    /// Сколько прежних байт копируется при переезде (от начала вложенного).
    copy_len: u64,
    /// Куски (переезды тел и новые тела) и их места.
    pieces: Vec<(u64, Piece<'k>)>,
    /// Правка в запасе: куда лягут тела, `[начало, конец)`.
    zone: Option<(u64, u64)>,
    /// Правка в запасе: прежние байты области головы и SHA-256 новых секторов.
    region: Option<(Vec<u8>, Vec<Digest>)>,
    /// Сколько места вложенного занято живым (голова и тела с добивкой).
    live: u64,
    /// Неиспользованный запас после правки: от конца тел до конца записи.
    reserve: u64,
    bytes_moved: u64,
    bytes_new: u64,
    new_bodies: usize,
}

impl Session<'_> {
    /// Дозапись: раскладка, журнал, тела, голова, готово. Перед ней
    /// доводится оборванная запись. `verify` вызывается на только что
    /// записанном архиве до отметки «готово»: отказ откатывает запись.
    pub fn append(
        &mut self,
        input: AppendInput<'_>,
        progress: &mut dyn FnMut(u64),
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
    ) -> std::result::Result<AppendReport, AppendError> {
        self.append_with(input, progress, verify, &mut |_| Ok(()))
    }

    /// То же с крюком `before_head`: он вызывается, когда тела и запись журнала
    /// уже на диске, а головы ещё прежние. Что вызывающий должен успеть записать
    /// до голов (сводный рецепт), он пишет здесь; его отказ снимает запись.
    pub fn append_with(
        &mut self,
        input: AppendInput<'_>,
        progress: &mut dyn FnMut(u64),
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
        before_head: BeforeHead<'_>,
    ) -> std::result::Result<AppendReport, AppendError> {
        match self.append_stage(input, progress, verify, before_head, false)? {
            Staged::Done(report) => Ok(report),
            Staged::Held(report, _) => Ok(report),
        }
    }

    /// Первый шаг дозаписи в два шага: журнал, тела и отметка «данные на диске»,
    /// проверка архива «как будет» и крюк `before_head` выполнены, а головы
    /// остаются прежними. Архив для читателей прежний; будущие головы отдаются
    /// вызывающему (`HeldHead`), и вторая половина (`commit_held`) пишет их в
    /// другом процессе. Бросить запись можно откатом (`settle`, `rollback`).
    pub fn append_held(
        &mut self,
        input: AppendInput<'_>,
        progress: &mut dyn FnMut(u64),
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
        before_head: BeforeHead<'_>,
    ) -> std::result::Result<(AppendReport, HeldHead), AppendError> {
        match self.append_stage(input, progress, verify, before_head, true)? {
            Staged::Held(report, held) => Ok((report, held)),
            Staged::Done(_) => Err(format_error("A held append ended without holding.")),
        }
    }

    fn append_stage(
        &mut self,
        input: AppendInput<'_>,
        progress: &mut dyn FnMut(u64),
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
        before_head: BeforeHead<'_>,
        hold: bool,
    ) -> std::result::Result<Staged, AppendError> {
        let started = self.clock_start();
        let settled = self.settle()?;
        let plan_clock = Instant::now();
        activity::check()?;
        let (old_head_all, head, old_len) = self.head_now()?;
        self.require_appendable(&head, old_len)?;
        if input.base.len() != head.count as usize {
            return Err(format_error(
                "The archive was read before it was settled; read it again.",
            ));
        }
        let chain = self.chain_now()?;
        // цепочка без записей начинается с SHA-256 файла: вызывающий помнит то же
        if let (Some(known), Some(given), true) =
            (chain, input.base_sha256, self.replay.records.is_empty())
        {
            if known != given {
                return Err(AppendError::refused(
                    Code::ForeignChange,
                    "The archive is not the one the caller remembers.",
                ));
            }
        }
        // слои: таблица рядом, сведённая с журналом (нет таблицы — слоёв нет)
        let layers = LayerSet::load(&self.path, &self.replay)?;
        if let Some(place) = self.layer.clone() {
            self.check_layer_place(&place, &layers)?;
        }
        let plan = self.plan(&input, &old_head_all, &head, old_len, chain, &layers)?;
        // пора ли уплотнять: отказ до любой записи в файл и в журнал
        let remaining = self.check_compaction(&plan)?;
        let plan_time = plan_clock.elapsed();

        // шаг 1: журнал
        let seq = self.replay.next_seq;
        let begin = Begin {
            seq,
            old_len,
            new_len: plan.new_len,
            prev: plan.prev,
            after: plan.after,
            dead_after: plan.dead_after,
            bytes_written: plan.bytes_moved
                + plan.bytes_new
                + plan.bytes_heads
                + plan.head.len() as u64,
            bytes_moved: plan.bytes_moved,
            moves: plan.moves.clone(),
            identity: plan.identity,
            anchors: plan.anchors.clone(),
            old_head: plan.old_head.clone(),
            new_sectors: plan.new_sectors.clone(),
            regions: plan.regions.clone(),
            fills: plan.fills.clone(),
            note: self.note.clone(),
        };
        let mut entries = Vec::new();
        if let Some(base) = &plan.start_base {
            entries.push(Entry::Base(base.clone()));
        }
        entries.push(Entry::Begin(begin.clone()));
        if let Some(row) = &plan.layer_row {
            entries.push(Entry::Layers(
                seq,
                LayerOp {
                    place: Some(row.id.clone()),
                    ..LayerOp::default()
                },
            ));
        }
        self.log(entries)?;
        self.host.hit("append-after-journal");

        // шаг 2: тела
        let mut sink_total = 0u64;
        let wrote = self.write_tail(&plan, progress, &mut sink_total);
        if let Err(error) = wrote {
            self.abort_before_head(seq);
            return Err(error);
        }
        self.host.hit("append-after-data");

        // шаг 3: отметка
        if let Err(error) = self.log(vec![Entry::Synced(seq)]) {
            self.abort_before_head(seq);
            return Err(error);
        }
        self.host.hit("append-after-synced");

        // таблица слоёв ложится до голов: она не бывает впереди архива, потому что
        // строку слоя, чьей записи нет в журнале, читатель не принимает
        if let Some(row) = &plan.layer_row {
            if let Err(error) = self.write_layers(&layers, row, &plan.registry_variants) {
                self.abort_before_head(seq);
                return Err(error);
            }
        }

        // архив «как будет»: голова подставлена поверх файла, тела уже лежат. Что
        // вызывающий ждал от результата, проверяется здесь, пока читатели видят
        // прежний архив; отказ снимает запись, как отмена
        // При удержании то же смотрит и проверка записанного: головы вторым шагом
        // пишет другой процесс, которому дерево операций уже недоступно.
        if let Err(error) = self.check_preview(&plan, input.keys, &mut *verify, hold) {
            self.abort_before_head(seq);
            return Err(error);
        }
        self.host.hit("append-after-preview");

        // перед головами: что вызывающий обязан положить на диск раньше них
        let chain_base = self.replay.base.clone().ok_or_else(|| {
            format_error("The journal has no chain base after the record was logged.")
        });
        let announced = chain_base.and_then(|base| {
            before_head(&Ahead {
                seq,
                fingerprint_before: self.text_of(&plan.prev),
                fingerprint_after: self.text_of(&plan.after),
                chain_base: base.digest,
                chain_base_len: base.len,
                new_chain: plan.start_base.is_some(),
            })
        });
        if let Err(error) = announced {
            self.abort_before_head(seq);
            return Err(error);
        }
        self.host.hit("append-after-recipe");

        // удержание: головы остаются прежними, будущие уходят вызывающему
        if hold {
            let held = match self.held_of(&plan) {
                Ok(held) => held,
                Err(error) => {
                    self.abort_before_head(seq);
                    return Err(error);
                }
            };
            let report = self.make_report(&plan, &begin, remaining, settled, started, plan_time, Duration::ZERO);
            self.host.hit("append-after-hold");
            return Ok(Staged::Held(report, held));
        }

        // шаг 4: головы; с этой точки установка доводится, отмены нет
        let head_clock = Instant::now();
        if let Err(error) = self.write_heads(&plan) {
            let _ = self.undo_top(false);
            return Err(error);
        }
        let head_time = head_clock.elapsed();
        self.host.hit("append-after-head");

        // проверка записанного: отказ возвращает прежний архив
        if let Err(error) = self.verify_written(&input, verify) {
            let _ = self.undo_top(false);
            return Err(error);
        }

        // шаг 5: готово
        let stamp = self.stamp_now()?;
        self.log(vec![Entry::Done(seq, stamp)])?;
        self.host.hit("append-after-done");

        Ok(Staged::Done(self.make_report(
            &plan, &begin, remaining, settled, started, plan_time, head_time,
        )))
    }

    #[allow(clippy::too_many_arguments)]
    fn make_report(
        &self,
        plan: &Plan<'_>,
        begin: &Begin,
        remaining: Remaining,
        settled: Settled,
        started: Instant,
        plan_time: Duration,
        head_time: Duration,
    ) -> AppendReport {
        AppendReport {
            seq: begin.seq,
            fingerprint: self.text_of(&plan.after),
            fingerprint_before: self.text_of(&plan.prev),
            old_len: begin.old_len,
            new_len: plan.new_len,
            bytes_written: begin.bytes_written,
            bytes_moved: plan.bytes_moved,
            dead_bytes: plan.dead_after,
            reserve_bytes: plan.reserve_bytes,
            garbage_bytes: plan
                .dead_after
                .saturating_sub(plan.reserve_bytes)
                .saturating_sub(plan.dormant_bytes),
            dormant_bytes: plan.dormant_bytes,
            layer: plan.layer_report.clone(),
            remaining,
            chain_base: self
                .replay
                .base
                .as_ref()
                .map_or([0; 32], |base| base.digest),
            moved_bodies: plan.moves.len(),
            new_bodies: plan.new_bodies,
            head_len: plan.head.len() as u64,
            nested_moved: plan.nested_moved,
            nested_in_reserve: plan.nested_in_reserve,
            nested_created: plan.nested_created,
            journal_records: self.replay.records.len(),
            key_pad: plan.key_pad,
            settled,
            timings: self.timings(started, plan_time, head_time),
        }
    }

    /// Пора ли уплотнять (проект, раздел 10): по раскладке, до любой записи.
    /// Считается состояние ПОСЛЕ этой записи: мёртвых байт (без запаса вложенных)
    /// больше порога или доли архива; старт следующих тел выше потолка; записей на
    /// стопке журнала больше предела. Нет — сколько осталось до каждого порога.
    fn check_compaction(&self, plan: &Plan<'_>) -> std::result::Result<Remaining, AppendError> {
        let tuning = &self.tuning;
        let garbage = plan
            .dead_after
            .saturating_sub(plan.reserve_bytes)
            .saturating_sub(plan.dormant_bytes);
        let records = self.replay.records.len() + 1;
        let next_start = ceil_block(plan.new_len);
        let mut why: Vec<String> = Vec::new();
        if tuning.dead_limit > 0 && garbage > tuning.dead_limit {
            why.push(format!(
                "dead bytes {garbage} are above the limit of {} bytes",
                tuning.dead_limit
            ));
        }
        if tuning.dead_share > 0 && garbage.saturating_mul(tuning.dead_share) > plan.new_len {
            why.push(format!(
                "dead bytes {garbage} are above 1/{} of the archive ({} bytes)",
                tuning.dead_share, plan.new_len
            ));
        }
        if next_start > tuning.body_start_ceiling {
            why.push(format!(
                "the next bodies would start at {next_start}, above the ceiling of {} bytes",
                tuning.body_start_ceiling
            ));
        }
        if tuning.max_records > 0 && records > tuning.max_records {
            why.push(format!(
                "the journal would hold {records} records, above {}",
                tuning.max_records
            ));
        }
        if !why.is_empty() {
            return Err(AppendError::refused(
                Code::CompactionDue,
                format!(
                    "Compaction is due: {}; the archive is rebuilt by the full path and nothing \
                     is appended.",
                    why.join("; ")
                ),
            ));
        }
        let ceiling = tuning.body_start_ceiling;
        Ok(Remaining {
            dead_bytes: (tuning.dead_limit > 0).then(|| tuning.dead_limit - garbage),
            // порог не перейдён, значит `garbage * share <= new_len`
            dead_share: (tuning.dead_share > 0).then(|| plan.new_len / tuning.dead_share - garbage),
            body_start: (ceiling < u64::MAX).then(|| ceiling - next_start),
            records: (tuning.max_records > 0).then(|| tuning.max_records - records),
        })
    }

    /// Слой можно положить: таблица цела, такого слоя нет, нужные слои включены.
    fn check_layer_place(
        &self,
        place: &LayerPlace,
        layers: &LayerSet,
    ) -> std::result::Result<(), AppendError> {
        let id_ok = !place.id.is_empty()
            && place.id.len() <= journal::MAX_LAYER_ID
            && place.id.is_ascii()
            && !place.id.contains('\0');
        if !id_ok {
            return Err(AppendError::refused(
                Code::LayerUnknown,
                "A layer id is 1 to 64 ASCII characters.",
            ));
        }
        if !layers.lost.is_empty() {
            return Err(AppendError::refused(
                Code::LayersDamaged,
                "The journal knows layers the table beside the archive does not describe.",
            ));
        }
        if layers.live_rows().any(|row| row.id == place.id) {
            return Err(AppendError::refused(
                Code::LayerExists,
                format!("The layer {} is already installed.", place.id),
            ));
        }
        for needed in &place.requires {
            if layers.state_of(needed) != Some(layers::Status::Enabled) {
                return Err(AppendError::refused(
                    Code::LayerRequires,
                    format!(
                        "The layer {} needs {needed}, which is not installed and enabled.",
                        place.id
                    ),
                ));
            }
        }
        Ok(())
    }

    /// Таблица слоёв: прежние строки без устаревших, строка этой записи, варианты
    /// реестра как были и варианты общих записей этой установки (их тела уже на
    /// диске). Файл целиком встаёт на место переименованием.
    fn write_layers(
        &mut self,
        layers: &LayerSet,
        row: &layers::Row,
        shared: &[(String, Word, Digest)],
    ) -> std::result::Result<(), AppendError> {
        let mut rows: Vec<layers::Row> = layers
            .rows
            .iter()
            .filter(|known| known.id != row.id)
            .cloned()
            .collect();
        rows.push(row.clone());
        let variants = if shared.is_empty() {
            layers.variants.clone()
        } else {
            self.merged_variants(&layers.variants, shared)?
        };
        self.save_table(rows, variants)
    }

    /// Таблица слоёв целиком (цепочка — по журналу): временный файл, сброс,
    /// переименование.
    fn save_table(
        &mut self,
        rows: Vec<layers::Row>,
        variants: Vec<layers::Variant>,
    ) -> std::result::Result<(), AppendError> {
        let chain = self
            .replay
            .base
            .as_ref()
            .map(|base| base.digest)
            .ok_or_else(|| {
                format_error("The journal has no chain base after the record was logged.")
            })?;
        let table = layers::Table {
            chain,
            rows,
            variants,
        };
        let host = self.host;
        layers::save(&layers::layers_path(&self.path), &table, &|point| {
            host.hit(point)
        })?;
        self.host.hit("layers-after-table");
        Ok(())
    }

    fn require_appendable(&self, head: &Head, len: u64) -> std::result::Result<(), AppendError> {
        if head.marker != ENCRYPTION_NG {
            return Err(AppendError::refused(
                Code::NotNg,
                "Only an archive with an NG table of contents is appended.",
            ));
        }
        if len < self.tuning.min_archive {
            return Err(AppendError::refused(
                Code::ArchiveTooSmall,
                "The archive is smaller than the appending threshold.",
            ));
        }
        Ok(())
    }

    /// Прежнее состояние вложенного архива: метка NG, записи оглавления, конец тел.
    fn read_old_nested(
        &mut self,
        old: &NestedOld,
        keys: &KeySet,
        root_len: u64,
    ) -> std::result::Result<OldNested, AppendError> {
        let beyond = || format_error("A nested archive goes beyond the end of the file.");
        if old.len < HEADER_SIZE as u64
            || old
                .off
                .checked_add(old.len)
                .is_none_or(|end| end > root_len)
        {
            return Err(beyond());
        }
        let name = old.inner.name().to_owned();
        let mut header = [0u8; HEADER_SIZE];
        self.read_at(old.off, &mut header)?;
        let head = parse_head(&header, old.len)?;
        if head.marker != ENCRYPTION_NG {
            return Err(AppendError::refused(
                Code::NotNg,
                format!(
                    "The nested archive {name} has no NG table of contents; it is not appended."
                ),
            ));
        }
        let whole: Arc<dyn ByteSource> = Arc::new(FileSource::open(&self.path)?);
        let window = SliceSource::new(whole, old.off, old.len)?;
        let toc = read_toc(&window, &name, Some(keys))?;
        let key = toc.ng_key_index.ok_or_else(|| {
            format_error("The table of contents of a nested archive is not NG-encrypted.")
        })?;
        let mut records = self.read_vec(
            old.off + HEADER_SIZE as u64,
            head.count as usize * ENTRY_SIZE,
        )?;
        keys.decrypt_ng(key, &mut records);
        // конец тел по прежнему оглавлению: всё, что дальше, запас
        let mut data_end = head.span as u64;
        for entry in old.inner.entries() {
            let (from, len) = match &entry.kind {
                EntryKind::Binary(info) => (info.offset(), info.stored_len()),
                EntryKind::Resource(info) => (info.offset(), u64::from(info.stored_size)),
                EntryKind::Directory { .. } => continue,
            };
            if len == 0 {
                continue;
            }
            let end = from.saturating_add(len);
            if end > old.len {
                return Err(format_error(
                    "An entry body of a nested archive goes beyond its end.",
                ));
            }
            data_end = data_end.max(end);
        }
        Ok(OldNested {
            off: old.off,
            len: old.len,
            head_span: head.span as u64,
            records,
            data_end,
        })
    }

    /// Раскладка одного вложенного архива: правка ложится в его запас или он
    /// переезжает с новым запасом (см. описание модуля).
    fn plan_nested<'k>(
        &mut self,
        job: &NestedJob<'_>,
        keys: &'k KeySet,
        root_len: u64,
        floor: u64,
        context: &mut WriteContext<'k>,
    ) -> std::result::Result<NestedPlan<'k>, AppendError> {
        let tuning = self.tuning;
        let state = match &job.old {
            Some(known) => Some(self.read_old_nested(known, keys, root_len)?),
            None => None,
        };
        let inner = job.old.as_ref().map(|known| &known.inner);
        let no_records: &[u8] = &[];
        let records = state.as_ref().map_or(no_records, |s| s.records.as_slice());
        let Frame {
            mut nodes,
            kept,
            fresh,
            ..
        } = frame_of(job.sub, inner, records, false, false)?;
        let (old_len, data_end, head_span) = state
            .as_ref()
            .map_or((0, 0, 0), |s| (s.len, s.data_end, s.head_span));

        // новые тела готовятся до раскладки: их длины нужны для мест
        let mut bodies: Vec<(usize, Fresh<'k>)> = Vec::new();
        for (node, file) in fresh {
            activity::check()?;
            bodies.push((node, prepare_fresh(file, context)?));
        }

        // правило головы: ни одно живое тело не стоит ниже `limit`
        let limit = ceil_block(seal::threshold(&nodes)) + tuning.head_margin;
        let mut moving: Vec<(u64, usize, u64)> = Vec::new();
        let mut live = 0u64;
        if let Some(inner) = inner {
            for &(node, id) in &kept {
                let Some((from, len)) = old_extent(inner, id) else {
                    return Err(format_error("A directory is listed as a file."));
                };
                if len == 0 {
                    continue;
                }
                if from.saturating_add(len) > old_len {
                    return Err(format_error(
                        "An entry body of a nested archive goes beyond its end.",
                    ));
                }
                live += ceil_block(len);
                if from < limit {
                    moving.push((from, node, len));
                }
            }
        }
        moving.sort_by_key(|&(from, node, _)| (from, node));

        // места тел от начала вложенного; идут за концом тел по прежнему
        // оглавлению (всё живое и всё, что снятая правка оставила мёртвым, ниже)
        let mut cursor = data_end.max(limit);
        let zone_start = ceil_block(cursor);
        let mut end = data_end;
        let mut pieces: Vec<(u64, Piece<'k>)> = Vec::new();
        let mut new_blocks: HashMap<usize, u64> = HashMap::new();
        let (mut bytes_moved, mut bytes_new) = (0u64, 0u64);
        let too_far =
            |name: &str| too_large(name, "would run past the 4 GiB an RPF7 offset reaches");
        for (from, node, len) in moving {
            let to = ceil_block(cursor);
            if to / BLOCK > LAST_BLOCK {
                return Err(too_far(&job.name));
            }
            cursor = to + len;
            end = cursor;
            new_blocks.insert(node, to / BLOCK);
            bytes_moved += len;
            pieces.push((to, Piece::Moved { from, len }));
        }
        let new_bodies = bodies.len();
        for (node, body) in bodies {
            let to = ceil_block(cursor);
            if to / BLOCK > LAST_BLOCK || !body.fits_at(to / BLOCK) {
                return Err(too_far(&job.name));
            }
            let len = body.len();
            if len > 0 {
                cursor = to + len;
                end = cursor;
            }
            bytes_new += len;
            live += body.span();
            new_blocks.insert(node, to / BLOCK);
            let entry = body.raw_entry(0, (to / BLOCK) as u32);
            nodes[node].raw = encode_entry(&entry);
            nodes[node].kind = entry.kind;
            pieces.push((to, Piece::Fresh(body)));
        }
        let reach = pieces
            .iter()
            .map(|(to, piece)| to + piece.len())
            .max()
            .unwrap_or(0);
        let zone = pieces
            .iter()
            .any(|(_, piece)| piece.len() > 0)
            .then_some((zone_start, cursor));

        // в запас или переездом
        let mut in_place = state.as_ref().is_some_and(|s| {
            s.off >= floor
                && inner.is_some_and(|archive| archive.name() == job.name)
                && reach <= s.len
        });
        if let (true, Some(state), Some((from, to))) = (in_place, state.as_ref(), zone) {
            // запас обязан быть нулями: иначе под ним что-то лежит, и писать туда нельзя
            in_place = self.is_zero(state.off + from, to - from)?;
        }
        let (new_len, copy_len) = if in_place {
            (old_len, 0)
        } else {
            if state.is_some() && old_len > tuning.nested_max_move {
                return Err(too_large(
                    &job.name,
                    &format!("is longer than {} bytes", tuning.nested_max_move),
                ));
            }
            let reserve = tuning.nested_reserve_min.max(old_len / 8);
            let want = ceil_block(end.saturating_add(reserve));
            if want > u64::from(u32::MAX) {
                return Err(too_large(
                    &job.name,
                    "would be longer than an RPF7 entry holds",
                ));
            }
            (want, data_end)
        };

        // оглавление
        let layout = seal::relayout(&nodes)?;
        if nodes
            .iter()
            .enumerate()
            .any(|(at, node)| !node.is_dir() && layout.name_at[at] > FILE_NAME_AT_MAX)
        {
            return Err(AppendError::refused(
                Code::NameOffsetTooHigh,
                "A nested archive has too many file names for the RPF7 table of contents.",
            ));
        }
        let table = seal::encode_records(&nodes, &layout, &new_blocks)?;
        let names = seal::pad_names(layout.block);
        let key_index = keys.ng_key_index(&job.name, new_len);
        let mut sealed = table;
        sealed.extend_from_slice(&names);
        keys.encrypt_ng(key_index, &mut sealed)?;
        let mut head = Vec::with_capacity(HEADER_SIZE + sealed.len());
        for value in [MAGIC, nodes.len() as u32, names.len() as u32, ENCRYPTION_NG] {
            head.extend_from_slice(&value.to_le_bytes());
        }
        head.extend_from_slice(&sealed);
        if head.len() as u64 > limit || head.len() as u64 > new_len {
            return Err(format_error(
                "The new table of contents of a nested archive would run over the body of an entry.",
            ));
        }
        live += ceil_block(head.len() as u64);

        // область головы на месте: прежние байты до конца большей из голов
        let region = match (&state, in_place) {
            (Some(state), true) => {
                let size = head.len().max(head_span as usize);
                let old_bytes = self.read_vec(state.off, size)?;
                let mut image = old_bytes.clone();
                image[..head.len()].copy_from_slice(&head);
                let sectors: Vec<Digest> = image.chunks(SECTOR).map(sha256).collect();
                Some((old_bytes, sectors))
            }
            _ => None,
        };
        if !in_place {
            bytes_moved += copy_len;
        }
        // запас: нули от конца тел (по прежнему и новому оглавлению вместе) до
        // конца записи; голова тоже не запас
        let reserve = new_len.saturating_sub(ceil_block(end.max(head.len() as u64)));
        Ok(NestedPlan {
            node: job.node,
            old: state.as_ref().map(|s| (s.off, s.len)),
            relocate: !in_place,
            new_len,
            head,
            copy_len,
            pieces,
            zone: if in_place { zone } else { None },
            region,
            live,
            reserve,
            bytes_moved,
            bytes_new,
            new_bodies,
        })
    }

    fn plan<'k>(
        &mut self,
        input: &AppendInput<'k>,
        old_head_all: &[u8],
        head: &Head,
        old_len: u64,
        chain: Option<Digest>,
        layers: &LayerSet,
    ) -> std::result::Result<Plan<'k>, AppendError> {
        let keys: &'k KeySet = input.keys.as_ref();
        // прежние записи: как есть, расшифрованные тем ключом, что подошёл
        let source = FileSource::open(&self.path)?;
        let toc = read_toc(&source, &self.name, Some(keys))?;
        let key = toc
            .ng_key_index
            .ok_or_else(|| format_error("The table of contents is not NG-encrypted."))?;
        let records_end = HEADER_SIZE + head.count as usize * ENTRY_SIZE;
        let mut old_records = old_head_all[HEADER_SIZE..records_end].to_vec();
        keys.decrypt_ng(key, &mut old_records);
        drop(source);

        // слой: дети каждого каталога идут по имени, и голова зависит только от
        // набора записей, а не от порядка, в котором они легли (так включение и
        // выключение слоя возвращают голову байт в байт)
        let ordered;
        let tree: &DirNode = if self.layer.is_some() {
            ordered = sorted_tree(input.tree);
            &ordered
        } else {
            input.tree
        };
        let frame = frame_of(
            tree,
            Some(input.base),
            &old_records,
            true,
            self.layer.is_some(),
        )?;
        let Frame {
            mut nodes,
            kept,
            fresh,
            nested,
            track,
        } = frame;
        // общие записи слоя: слой их заменяет, но не берёт себе
        let registry_nodes = self.registry_nodes(&track, &fresh)?;

        // новые тела готовятся до раскладки: их длины нужны для мест
        // служебная папка не нужна: доводчик здесь не работает, вложенные
        // архивы собирает сама дозапись
        let mut context = WriteContext {
            staging: Path::new("."),
            keys: Some(keys),
            finalizer: None,
        };
        let mut bodies: Vec<(usize, Fresh<'k>)> = Vec::new();
        for (node, file) in fresh {
            activity::check()?;
            bodies.push((node, prepare_fresh(file, &mut context)?));
        }

        // порог головы; у архива со слоями (`H_max`) — по объединению всех слоёв,
        // включённых и выключенных: тела ниже него переезжают сейчас, а не при
        // включении слоя
        let threshold = seal::threshold(&nodes) + layers.extra_threshold();
        let limit = ceil_block(threshold) + self.tuning.head_margin;
        // вложенный архив, начинающийся ниже этого, правится только переездом:
        // здесь пишется голова корня
        let floor = limit.max(head.span as u64);

        // вложенные архивы с правками (чтения файла, но не запись)
        let mut jobs: Vec<NestedPlan<'k>> = Vec::new();
        for job in &nested {
            activity::check()?;
            jobs.push(self.plan_nested(job, keys, old_len, floor, &mut context)?);
        }

        // что переезжает (четвёртое: тело заменённой записи слоя, спящее)
        let mut moving: Vec<(u64, usize, u64, bool)> = Vec::new();
        let mut live_spans = 0u64;
        for &(node, id) in &kept {
            let Some((from, len)) = old_extent(input.base, id) else {
                return Err(format_error("A directory is listed as a file."));
            };
            if len == 0 {
                continue;
            }
            if from.saturating_add(len) > old_len {
                return Err(format_error(
                    "An entry body goes beyond the end of the file.",
                ));
            }
            if from < limit {
                moving.push((from, node, len, false));
            } else {
                live_spans += ceil_block(len);
            }
        }
        // слой: тело заменённой записи остаётся в файле, пока слой включён, и
        // нужно ему при выключении; голова не должна его накрыть, поэтому оно тоже
        // не стоит ниже порога головы (у обычной дозаписи замененное тело мёртво)
        let mut before_of: HashMap<usize, (Word, u64)> = HashMap::new();
        for &(node, id) in &track.replaced {
            let Some((from, len)) = old_extent(input.base, id) else {
                continue;
            };
            let raw: Word = layers::bare(&raw_of(&old_records, id)?);
            if len > 0 && from.saturating_add(len) <= old_len && from < limit {
                moving.push((from, node, len, true));
            }
            before_of.insert(node, (raw, len));
        }
        moving.sort_by_key(|&(from, node, _, _)| (from, node));

        // места в конце файла
        // ниже порога головы тела не стоят и тогда, когда сам файл короче порога
        // с хвостом по правилу (`set_tail`) новые тела начинаются там, где кончается последнее тело, а не после прежней добивки: нули хвоста
        // переиспользуются (откат возвращает их куском `Fill`), и файл от записи к записи не растёт на запас
        let reuse = self.reuse_floor(&old_records, old_len)?;
        let mut cursor = reuse.max(limit);
        let mut end = old_len;
        let mut new_blocks: HashMap<usize, u64> = HashMap::new();
        let mut tail: Vec<(u64, Tail<'k>)> = Vec::new();
        let mut moves = Vec::new();
        let (mut bytes_moved, mut bytes_new) = (0u64, 0u64);
        let ceiling = self.tuning.body_start_ceiling;
        let too_high = |to: u64| {
            AppendError::refused(
                Code::BodyStartTooHigh,
                format!(
                    "A body would start at {to}, above the appending ceiling of {ceiling} bytes."
                ),
            )
        };
        let mut moved_before: HashMap<usize, u64> = HashMap::new();
        for (from, node, len, dormant) in moving {
            let to = ceil_block(cursor);
            if to > ceiling || to / BLOCK > LAST_BLOCK {
                return Err(too_high(to));
            }
            cursor = to + len;
            end = cursor;
            if dormant {
                moved_before.insert(node, to / BLOCK);
            } else {
                new_blocks.insert(node, to / BLOCK);
                live_spans += ceil_block(len);
            }
            moves.push(Moved { from, to, len });
            bytes_moved += len;
            tail.push((to, Tail::Moved { from, len }));
        }

        // вложенные архивы: переезд в конец или правка в запасе
        let mut nested_heads: Vec<HeadPlan> = Vec::new();
        let mut regions: Vec<Region> = Vec::new();
        let mut fills: Vec<Fill> = Vec::new();
        if reuse < old_len {
            fills.push(Fill {
                at: reuse,
                len: old_len - reuse,
            });
        }
        let (mut nested_moved, mut nested_in_reserve, mut nested_created) =
            (0usize, 0usize, 0usize);
        let mut bytes_heads = 0u64;
        let mut reserve_bytes = 0u64;
        let mut new_count = bodies.len();
        // слой: вложенный архив, которого не было, — запись корня; существующий,
        // который правят, делает слой связанным
        let mut nested_added: Vec<(usize, u64)> = Vec::new();
        let mut touched_nested = false;
        for job in jobs {
            match job.old {
                Some(_) => touched_nested = true,
                None => nested_added.push((job.node, job.new_len)),
            }
            live_spans += job.live;
            reserve_bytes += job.reserve;
            bytes_moved += job.bytes_moved;
            bytes_new += job.bytes_new;
            bytes_heads += job.head.len() as u64;
            new_count += job.new_bodies;
            if job.relocate {
                let to = ceil_block(cursor);
                if to > ceiling || to / BLOCK > LAST_BLOCK {
                    return Err(too_high(to));
                }
                cursor = to + job.new_len;
                end = cursor;
                match job.old {
                    Some(_) => nested_moved += 1,
                    None => nested_created += 1,
                }
                if let Some((off, _)) = job.old {
                    if job.copy_len > 0 {
                        moves.push(Moved {
                            from: off,
                            to,
                            len: job.copy_len,
                        });
                        tail.push((
                            to,
                            Tail::Moved {
                                from: off,
                                len: job.copy_len,
                            },
                        ));
                    }
                }
                let old_off = job.old.map(|(off, _)| off);
                for (rel, piece) in job.pieces {
                    match piece {
                        Piece::Moved { from, len } => {
                            let from = old_off.unwrap_or_default() + from;
                            moves.push(Moved {
                                from,
                                to: to + rel,
                                len,
                            });
                            tail.push((to + rel, Tail::Moved { from, len }));
                        }
                        Piece::Fresh(body) => tail.push((to + rel, Tail::Fresh { body })),
                    }
                }
                tail.push((to, Tail::Bytes { data: job.head }));
                // запись корня: новое место и длина
                let mut raw = nodes[job.node].raw;
                raw[2..5].copy_from_slice(&[0, 0, 0]);
                raw[8..12].copy_from_slice(&(job.new_len as u32).to_le_bytes());
                nodes[job.node].raw = raw;
                nodes[job.node].kind = parse_entry(&raw).kind;
                new_blocks.insert(job.node, to / BLOCK);
            } else {
                nested_in_reserve += 1;
                let (off, _) = job.old.unwrap_or_default();
                for (rel, piece) in job.pieces {
                    match piece {
                        Piece::Moved { from, len } => {
                            moves.push(Moved {
                                from: off + from,
                                to: off + rel,
                                len,
                            });
                            tail.push((
                                off + rel,
                                Tail::Moved {
                                    from: off + from,
                                    len,
                                },
                            ));
                        }
                        Piece::Fresh(body) => tail.push((off + rel, Tail::Fresh { body })),
                    }
                }
                if let Some((from, to)) = job.zone {
                    fills.push(Fill {
                        at: off + from,
                        len: to - from,
                    });
                }
                if let Some((old_bytes, sectors)) = job.region {
                    regions.push(Region {
                        at: off,
                        old: old_bytes,
                        new_sectors: sectors,
                    });
                }
                nested_heads.push(HeadPlan {
                    at: off,
                    bytes: job.head,
                });
            }
        }

        // новые тела корня
        let mut fresh_len: HashMap<usize, u64> = HashMap::new();
        for (node, body) in bodies {
            let to = ceil_block(cursor);
            if to > ceiling || to / BLOCK > LAST_BLOCK || !body.fits_at(to / BLOCK) {
                return Err(too_high(to));
            }
            let len = body.len();
            fresh_len.insert(node, len);
            if len > 0 {
                cursor = to + len;
                end = cursor;
            }
            bytes_new += len;
            live_spans += body.span();
            new_blocks.insert(node, to / BLOCK);
            // запись узла: размеры и флаги из подготовленного тела
            let entry = body.raw_entry(0, (to / BLOCK) as u32);
            nodes[node].raw = encode_entry(&entry);
            nodes[node].kind = entry.kind;
            tail.push((to, Tail::Fresh { body }));
        }
        // длина файла после записи; с ключом головы (R4) в конец добавляются нули, чтобы
        // ключ по длине остался прежним
        let (new_len, key_pad) = self.kept_len(keys, key, old_len, end, last_body_start(&nodes))?;
        debug_assert!(new_len >= old_len, "the file never shrinks");

        // оглавление
        let layout = seal::relayout(&nodes)?;
        if nodes
            .iter()
            .enumerate()
            .any(|(at, node)| !node.is_dir() && layout.name_at[at] > FILE_NAME_AT_MAX)
        {
            return Err(AppendError::refused(
                Code::NameOffsetTooHigh,
                "The archive has too many file names for the RPF7 table of contents.",
            ));
        }
        let table = seal::encode_records(&nodes, &layout, &new_blocks)?;
        // общие записи: что стояло и что встало, по содержимому, для таблицы
        let mut registry_variants: Vec<(String, Word, Digest)> = Vec::new();
        let mut registry_written: Vec<(String, u64)> = Vec::new();
        for shared in &registry_nodes {
            let written = fresh_len.get(&shared.node).copied().unwrap_or(0);
            registry_written.push((shared.entry.clone(), written));
            if let Some(&(raw, before_len)) = before_of.get(&shared.node) {
                // прежнее тело: на месте или переехавшее в хвост (оно нужно, чтобы вернуть
                // прежнее содержимое без записи тела)
                let word = match moved_before.get(&shared.node) {
                    Some(&block) => layers::with_block(&raw, block),
                    None => raw,
                };
                let readable = before_len > 0 && before_len <= REGISTRY_BODY_MAX;
                let content = readable
                    .then(|| input.base.decode(shared.old, EntryCipher::AlwaysNg).ok())
                    .flatten();
                if let Some(content) = content {
                    registry_variants.push((shared.entry.clone(), word, sha256(&content)));
                }
            }
            if written > 0 {
                let position = layout.order.iter().position(|&old| old == shared.node);
                let raw: Option<[u8; ENTRY_SIZE]> = position.and_then(|at| {
                    table
                        .get(at * ENTRY_SIZE..(at + 1) * ENTRY_SIZE)
                        .and_then(|slice| slice.try_into().ok())
                });
                let raw = raw.ok_or_else(|| {
                    format_error("A registry entry is not in the new table.")
                })?;
                registry_variants.push((shared.entry.clone(), layers::bare(&raw), shared.sha));
            }
        }
        let registry_skip: Vec<usize> = registry_nodes.iter().map(|shared| shared.node).collect();
        // слой: слова записей корня, как они легли в новое оглавление
        let layer_row = match &self.layer {
            Some(place) => Some(self.layer_row_of(
                place,
                layers,
                input.base,
                &LayerFacts {
                    track: &track,
                    touched_nested,
                    nested_added: &nested_added,
                    fresh_len: &fresh_len,
                    before_of: &before_of,
                    moved_before: &moved_before,
                    order: &layout.order,
                    table: &table,
                    registry: &registry_skip,
                },
            )?),
            None => None,
        };
        let names = seal::pad_names(layout.block);
        let key_index = keys.ng_key_index(&self.name, new_len);
        let mut sealed = table;
        sealed.extend_from_slice(&names);
        keys.encrypt_ng(key_index, &mut sealed)?;
        let mut new_head = Vec::with_capacity(HEADER_SIZE + sealed.len());
        for value in [MAGIC, nodes.len() as u32, names.len() as u32, ENCRYPTION_NG] {
            new_head.extend_from_slice(&value.to_le_bytes());
        }
        new_head.extend_from_slice(&sealed);
        if new_head.len() as u64 > limit || new_head.len() as u64 > old_len {
            return Err(format_error(
                "The new table of contents would run over the body of an entry.",
            ));
        }
        // тела слоёв лежат в файле и нужны переключению: ни голова, ни порог, ниже
        // которого тела переезжают, не должны до них дорасти
        if let Some(floor) = layers.owned_floor() {
            if limit > floor {
                return Err(AppendError::refused(
                    Code::HeadBeyondMax,
                    format!(
                        "The head threshold ({limit}) would reach a body a layer keeps for \
                         switching (at {floor}); the archive is rebuilt by the full path."
                    ),
                ));
            }
        }
        let own_dormant = layer_row.as_ref().map_or(0, |row| row.dormant_bytes(true));
        let dormant_bytes = layers.dormant_bytes() + own_dormant;
        let layer_report = layer_row.as_ref().map(|row| LayerReport {
            id: row.id.clone(),
            linked: row.linked,
            requires: row.requires.clone(),
            added: row
                .changes
                .iter()
                .filter(|change| change.kind == layers::Kind::Add)
                .count(),
            replaced: row
                .changes
                .iter()
                .filter(|change| change.kind == layers::Kind::Replace)
                .count(),
            dormant_bytes: own_dormant,
            registry: registry_written,
        });

        // область головы: прежние байты до конца большей из голов, и то, чем она
        // станет; по ним запись откатывается, а файл узнаётся как наш
        let region = new_head.len().max(head.span);
        let old_head = if region <= old_head_all.len() {
            old_head_all[..region].to_vec()
        } else {
            self.read_vec(0, region)?
        };
        let mut new_image = old_head.clone();
        new_image[..new_head.len()].copy_from_slice(&new_head);
        let new_sectors: Vec<Digest> = new_image.chunks(SECTOR).map(sha256).collect();
        let identity = self.host.facts(&self.file)?.identity;

        // куда запись пишет ниже прежней длины: области не должны налезать друг на друга,
        // а окна прежних тел для проверки «файл наш» выбираются вне них
        let mut areas: Vec<(u64, u64)> = vec![(0, region as u64)];
        areas.extend(
            regions
                .iter()
                .map(|area| (area.at, area.at + area.old.len() as u64)),
        );
        areas.extend(fills.iter().map(|fill| (fill.at, fill.at + fill.len)));
        areas.sort_unstable();
        if areas.windows(2).any(|pair| pair[0].1 > pair[1].0)
            || areas.last().is_some_and(|&(_, to)| to > old_len)
        {
            return Err(format_error(
                "Two writes of one record overlap, or one goes beyond the end of the file.",
            ));
        }
        let anchors = self.anchors_outside(&areas, old_len)?;

        let (prev, start_base) = match chain {
            Some(digest) => (digest, None),
            None => {
                let digest = match input.base_sha256 {
                    Some(given) => given,
                    None => self.hash_file()?,
                };
                let stamp = self.stamp_now()?;
                let base = Base {
                    len: old_len,
                    head_len: head.span as u32,
                    head_sha: sha256(old_head_all),
                    digest,
                    stamp,
                };
                (digest, Some(base))
            }
        };
        let after = chain_digest(new_len, &sha256(&new_head), &prev);
        let dead_after = new_len
            .saturating_sub(ceil_block(new_head.len() as u64))
            .saturating_sub(live_spans);
        Ok(Plan {
            head: new_head,
            old_head,
            new_sectors,
            nested_heads,
            regions,
            fills,
            identity,
            anchors,
            tail,
            new_len,
            dead_after,
            moves,
            bytes_moved,
            bytes_new,
            bytes_heads,
            prev,
            after,
            new_bodies: new_count,
            nested_moved,
            nested_in_reserve,
            nested_created,
            start_base,
            reserve_bytes,
            dormant_bytes,
            layer_row,
            layer_report,
            registry_variants,
            key_pad,
        })
    }

    /// Откуда новые тела корня ложатся в файл. Без хвоста — с конца файла, как всегда. С хвостом (`set_tail`) — с границы блока за концом
    /// последнего живого тела, но не раньше начала нулевой добивки в конце файла: нули хвоста нужны только для запаса, и запись
    /// занимает их, а не растёт за ними. Не нули за последним телом (мёртвые тела прошлых записей) не трогаются.
    fn reuse_floor(&self, old_records: &[u8], old_len: u64) -> std::result::Result<u64, AppendError> {
        if self.tail.is_none() {
            return Ok(old_len);
        }
        let live_end = old_records
            .chunks_exact(ENTRY_SIZE)
            .filter_map(|chunk| <[u8; ENTRY_SIZE]>::try_from(chunk).ok())
            .map(|raw| match parse_entry(&raw).kind {
                RawKind::Binary {
                    stored_size,
                    offset_blocks,
                    uncompressed_size,
                    ..
                } => {
                    let len = if stored_size == 0 { uncompressed_size } else { stored_size };
                    u64::from(offset_blocks) * BLOCK + u64::from(len)
                }
                RawKind::Resource {
                    stored_size,
                    offset_blocks,
                    ..
                } => u64::from(offset_blocks) * BLOCK + u64::from(stored_size),
                RawKind::Directory { .. } => 0,
            })
            .max()
            .unwrap_or(0);
        // хвост из нулей в конце файла (не больше TAIL_SCAN_MAX назад)
        let window = old_len.min(TAIL_SCAN_MAX);
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(old_len - window))?;
        let mut bytes = vec![0u8; window as usize];
        file.read_exact(&mut bytes)?;
        let zeros = bytes.iter().rev().take_while(|byte| **byte == 0).count() as u64;
        Ok(ceil_block(live_end.max(old_len - zeros)).min(old_len))
    }

    /// Длина файла после записи и добавка нулей, которая держит ключ головы (R4).
    /// `end` — конец последнего тела, `opened_by` — ключ, которым открылась прежняя
    /// голова. Без `set_keep_key` длина та же и добавки нет. Прежняя голова обязана
    /// открываться ключом по формуле от своей длины (иначе архив уже сдвинут, и
    /// угадывать нечего: `KeyShifted`); добавка берётся наименьшая, до потолка
    /// (`KeyPadTooLong`). Отказы идут до любой записи.
    fn kept_len(
        &self,
        keys: &KeySet,
        opened_by: usize,
        old_len: u64,
        end: u64,
        last_start: u64,
    ) -> std::result::Result<(u64, Option<u64>), AppendError> {
        let pick = |len: u64| keys.ng_key_index(&self.name, len);
        let Some(limit) = self.keep_key else {
            let Some(policy) = self.tail else {
                return Ok((end, None));
            };
            // хвост без держания ключа: ключ идёт по длине, голова всё равно пишется заново
            let len = tail_len(policy, end.max(old_len), last_start, None, &pick).ok_or_else(|| {
                AppendError::refused(Code::KeyPadTooLong, "No file length satisfies the tail rule.")
            })?;
            let floor = end.max(old_len);
            return Ok((len, (len > floor).then_some(len - floor)));
        };
        let formula = pick(old_len);
        if opened_by != formula {
            return Err(AppendError::refused(
                Code::KeyShifted,
                format!(
                    "The table of contents opens with key {opened_by}, but the file length \
                     {old_len} gives key {formula}: the archive is already shifted, nothing is \
                     written."
                ),
            ));
        }
        if let Some(policy) = self.tail {
            // хвост по правилу вместе с прежним ключом головы: ближайшая подходящая длина (до ~200 КиБ сверх запаса)
            let floor = end.max(old_len);
            return match tail_len(policy, floor, last_start, Some(opened_by), &pick) {
                Some(len) => Ok((len, Some(len - floor))),
                None => Err(AppendError::refused(
                    Code::KeyPadTooLong,
                    format!(
                        "No file length from {end} satisfies the tail rule and key {opened_by}; \
                         nothing is written."
                    ),
                )),
            };
        }
        match keep_key_pad(end, opened_by, limit, &pick) {
            Some(pad) => Ok((end + pad, Some(pad))),
            None => Err(AppendError::refused(
                Code::KeyPadTooLong,
                format!(
                    "No zero pad up to {limit} bytes brings the file length {end} to key \
                     {opened_by}; nothing is written."
                ),
            )),
        }
    }

    /// Узлы общих записей слоя: каждая названа один раз, есть в прежнем архиве и
    /// заменяется новым двоичным телом. Пустой список — слой без общих записей.
    fn registry_nodes(
        &self,
        track: &Track,
        fresh: &[(usize, &FileNode)],
    ) -> std::result::Result<Vec<RegistryNode>, AppendError> {
        if self.layer_registry.is_empty() {
            return Ok(Vec::new());
        }
        let invalid = |text: String| AppendError::refused(Code::RegistryInvalid, text);
        if self.layer.is_none() {
            return Err(invalid(
                "A registry entry is placed together with a layer.".to_owned(),
            ));
        }
        let mut found: Vec<RegistryNode> = Vec::new();
        for (at, place) in self.layer_registry.iter().enumerate() {
            if self.layer_registry[..at]
                .iter()
                .any(|before| switch::same_entry(&before.entry, &place.entry))
            {
                return Err(invalid(format!(
                    "The registry entry {} is named twice in one install.",
                    place.entry
                )));
            }
            let located = track
                .paths
                .iter()
                .find(|(_, path)| switch::same_entry(path, &place.entry))
                .and_then(|(&node, _)| {
                    let (_, old) = track.replaced.iter().find(|(known, _)| *known == node)?;
                    let plain = fresh
                        .iter()
                        .any(|(known, file)| *known == node && matches!(file.body, Body::Binary { .. }));
                    plain.then_some((node, *old))
                });
            let Some((node, old)) = located else {
                return Err(invalid(format!(
                    "The registry entry {} is not an existing plain file the install replaces.",
                    place.entry
                )));
            };
            found.push(RegistryNode {
                node,
                entry: place.entry.clone(),
                sha: place.sha,
                old,
            });
        }
        Ok(found)
    }

    /// Строка таблицы слоёв по раскладке этой записи.
    fn layer_row_of(
        &self,
        place: &LayerPlace,
        layers: &LayerSet,
        base: &Archive,
        facts: &LayerFacts<'_>,
    ) -> std::result::Result<layers::Row, AppendError> {
        let track = facts.track;
        let removed = track.present
            < base
                .entries()
                .iter()
                .filter(|entry| !matches!(entry.kind, EntryKind::Directory { .. }))
                .count();
        let mut row = layers::Row {
            id: place.id.clone(),
            seq: self.replay.next_seq,
            requires: place.requires.clone(),
            linked: facts.touched_nested || removed,
            changes: Vec::new(),
            dirs: Vec::new(),
        };
        if row.linked {
            return Ok(row);
        }
        let position: HashMap<usize, usize> = facts
            .order
            .iter()
            .enumerate()
            .map(|(at, &old)| (old, at))
            .collect();
        let word_of = |node: usize| -> std::result::Result<Word, AppendError> {
            let at = position
                .get(&node)
                .map(|at| at * ENTRY_SIZE)
                .ok_or_else(|| format_error("A layer entry is not in the new table."))?;
            let raw: [u8; ENTRY_SIZE] = facts.table[at..at + ENTRY_SIZE]
                .try_into()
                .map_err(|_| format_error("A layer entry is not in the new table."))?;
            Ok(layers::bare(&raw))
        };
        // общие записи слою не принадлежат: их тело собирает вызывающий из включённых
        // слоёв, и они не связывают слои друг с другом
        let mut nodes: Vec<usize> = track
            .paths
            .keys()
            .copied()
            .filter(|node| !facts.registry.contains(node))
            .collect();
        nodes.sort_unstable();
        // слова «до» такими, какими их знал прежний слой (до переезда тела)
        let mut originals: Vec<(String, Word)> = Vec::new();
        for node in nodes {
            let path = track.paths[&node].clone();
            let after = word_of(node)?;
            if let Some(&len) = facts.fresh_len.get(&node) {
                if let Some(&(raw, _)) = facts.before_of.get(&node) {
                    originals.push((path.clone(), raw));
                }
                row.changes.push(match facts.before_of.get(&node) {
                    Some(&(raw, before_len)) => layers::Change {
                        path,
                        kind: layers::Kind::Replace,
                        before: Some(match facts.moved_before.get(&node) {
                            Some(&block) => layers::with_block(&raw, block),
                            None => raw,
                        }),
                        after,
                        before_len,
                        after_len: len,
                    },
                    None => layers::Change {
                        path,
                        kind: layers::Kind::Add,
                        before: None,
                        after,
                        before_len: 0,
                        after_len: len,
                    },
                });
            } else if let Some(&(_, len)) = facts.nested_added.iter().find(|(at, _)| *at == node) {
                row.changes.push(layers::Change {
                    path,
                    kind: layers::Kind::Add,
                    before: None,
                    after,
                    before_len: 0,
                    after_len: len,
                });
            }
        }
        row.dirs = track.created_dirs.clone();
        // слой, который заменил запись другого слоя, без него не включается
        for (path, before) in &originals {
            let owner = layers.live_rows().find(|other| {
                layers.state_of(&other.id) == Some(layers::Status::Enabled)
                    && other.changes.iter().any(|theirs| {
                        theirs.path.eq_ignore_ascii_case(path)
                            && layers::same(&theirs.after, before)
                    })
            });
            if let Some(owner) = owner {
                if !row.requires.contains(&owner.id) {
                    row.requires.push(owner.id.clone());
                }
            }
        }
        Ok(row)
    }

    /// Окна прежнего файла перед его концом (до 64 КиБ вместе), нетронутые
    /// записью: между областями, куда она пишет ниже прежней длины. `areas`
    /// отсортированы и не налезают друг на друга.
    fn anchors_outside(
        &mut self,
        areas: &[(u64, u64)],
        old_len: u64,
    ) -> std::result::Result<Vec<Anchor>, AppendError> {
        let mut found = Vec::new();
        let mut budget = ANCHOR_WINDOW;
        let mut high = old_len;
        for &(from, to) in areas.iter().rev() {
            if budget == 0 || found.len() >= MAX_ANCHORS {
                break;
            }
            if to < high {
                let take = (high - to).min(budget);
                let at = high - take;
                let bytes = self.read_vec(at, take as usize)?;
                found.push(Anchor {
                    from: at,
                    len: take,
                    sha: sha256(&bytes),
                });
                budget -= take;
            }
            high = high.min(from);
        }
        Ok(found)
    }

    /// Шаг 2: файл растёт, тела ложатся выше прежней длины, а у вложенных с
    /// запасом — в запас.
    fn write_tail(
        &mut self,
        plan: &Plan<'_>,
        progress: &mut dyn FnMut(u64),
        total: &mut u64,
    ) -> std::result::Result<(), AppendError> {
        if plan.new_len > self.len()? {
            self.file.set_len(plan.new_len)?;
        }
        let mut sink = Sink::for_append(progress, 0);
        let mut buffer: Vec<u8> = Vec::new();
        let mut first = true;
        for (to, piece) in &plan.tail {
            activity::check()?;
            match piece {
                Tail::Moved { from, len } => {
                    let mut done = 0u64;
                    while done < *len {
                        activity::check()?;
                        let take = (*len - done).min(PORTION as u64) as usize;
                        if buffer.len() < take {
                            buffer.resize(take, 0);
                        }
                        read_pace::pace_read(take as u64);
                        self.file.seek(SeekFrom::Start(*from + done))?;
                        self.file.read_exact(&mut buffer[..take])?;
                        self.file.seek(SeekFrom::Start(*to + done))?;
                        self.file.write_all(&buffer[..take])?;
                        done += take as u64;
                        sink.credit(take as u64);
                    }
                }
                Tail::Fresh { body } => body.put(&mut self.file, *to, &mut sink)?,
                Tail::Bytes { data } => {
                    self.file.seek(SeekFrom::Start(*to))?;
                    self.file.write_all(data)?;
                    sink.credit(data.len() as u64);
                }
            }
            if first {
                first = false;
                self.host.hit("append-in-data");
            }
        }
        *total = sink.written();
        self.sync()?;
        Ok(())
    }

    /// Отмена или отказ до голов: файл возвращается к прежнему (нули в запас,
    /// усечение), запись снимается. Если и это не вышло, запись остаётся в
    /// журнале, и её снимет `settle`.
    fn abort_before_head(&mut self, seq: u64) {
        let Some(begin) = self.replay.top().map(|top| top.begin.clone()) else {
            return;
        };
        if begin.seq != seq {
            return;
        }
        let _ = self.undo_top(false);
    }

    /// Шаг 4: головы. Сначала вложенные (каждая двумя половинами), потом корень.
    /// Между головой вложенного и головой корня архив читается ещё как прежний
    /// (корень не тронут), но вложенный уже новый: обрыв здесь чинится по журналу.
    fn write_heads(&mut self, plan: &Plan<'_>) -> std::result::Result<(), AppendError> {
        let nested: Vec<(u64, &[u8])> = plan
            .nested_heads
            .iter()
            .map(|head| (head.at, head.bytes.as_slice()))
            .collect();
        self.write_head_set(&nested, &plan.head)
    }

    /// Головы вложенных (каждая двумя половинами), потом корень.
    fn write_head_set(
        &mut self,
        nested: &[(u64, &[u8])],
        root: &[u8],
    ) -> std::result::Result<(), AppendError> {
        for (at, bytes) in nested {
            self.write_halves(*at, bytes, "append-mid-nested-head")?;
        }
        if !nested.is_empty() {
            self.host.hit("append-after-nested-head");
        }
        self.write_halves(0, root, "append-mid-head")
    }

    /// Архив «как будет»: файл с подставленными головами. Проверка вызывающего
    /// (если она есть) смотрит на него до того, как голова ляжет на диск.
    fn check_preview(
        &mut self,
        plan: &Plan<'_>,
        keys: &Arc<KeySet>,
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
        run_verify: bool,
    ) -> std::result::Result<(), AppendError> {
        if self.preview.is_none() && !run_verify {
            return Ok(());
        }
        let mut patches: Vec<(u64, Vec<u8>)> = plan
            .nested_heads
            .iter()
            .map(|head| (head.at, head.bytes.clone()))
            .collect();
        patches.push((0, plan.head.clone()));
        let opened = self.open_overlaid(patches, keys)?;
        if let Some(check) = self.preview.as_mut() {
            check(&opened)?;
        }
        if run_verify {
            verify(&opened).map_err(format_error)?;
        }
        Ok(())
    }

    /// Открывает архив с подставленными участками поверх файла.
    fn open_overlaid(
        &self,
        patches: Vec<(u64, Vec<u8>)>,
        keys: &Arc<KeySet>,
    ) -> std::result::Result<Archive, AppendError> {
        let file = FileSource::open(&self.path)?;
        let overlay = OverlaySource::new(Arc::new(file), patches)?;
        Ok(Archive::open(
            Arc::new(overlay),
            &self.name,
            Some(Arc::clone(keys)),
        )?)
    }

    /// Будущие головы удержанной записи и отпечаток дописанных байт.
    fn held_of(&mut self, plan: &Plan<'_>) -> std::result::Result<HeldHead, AppendError> {
        let mut patches: Vec<(u64, Vec<u8>)> = plan
            .nested_heads
            .iter()
            .map(|head| (head.at, head.bytes.clone()))
            .collect();
        patches.push((0, plan.head.clone()));
        let (seq, old_len) = self
            .replay
            .top()
            .map(|top| (top.begin.seq, top.begin.old_len))
            .ok_or_else(|| format_error("The held record is not on the journal."))?;
        let tail_sha = self.hash_range(old_len, plan.new_len)?;
        Ok(HeldHead {
            seq,
            old_len,
            new_len: plan.new_len,
            patches,
            tail_sha,
        })
    }

    /// SHA-256 участка файла `[from, to)`.
    fn hash_range(&mut self, from: u64, to: u64) -> std::result::Result<Digest, AppendError> {
        let mut sum = Sha256::new();
        let mut buffer = vec![0u8; PORTION.min(to.saturating_sub(from) as usize).max(1)];
        let mut done = from;
        self.file.seek(SeekFrom::Start(from))?;
        while done < to {
            activity::check()?;
            let take = (to - done).min(PORTION as u64) as usize;
            read_pace::pace_read(take as u64);
            self.file.read_exact(&mut buffer[..take])?;
            sum.update(&buffer[..take]);
            done += take as u64;
        }
        Ok(sum.finalize().into())
    }

    /// Второй шаг дозаписи в два шага: удержанная запись `held` лежит на вершине
    /// журнала с отметкой «данные на диске», головы прежние. Файл и головы
    /// сверяются с тем, что снято при удержании, потом головы пишутся и запись
    /// доводится до «готово» (проверка записанного, как у обычной дозаписи).
    ///
    /// Отказ до первой записи (`HoldMissing`, `ForeignChange`, `StageChanged`)
    /// ничего не меняет: удержание остаётся и снимается откатом. Отказ записи
    /// голов или проверки откатывает запись целиком.
    pub fn commit_held(
        &mut self,
        held: &HeldHead,
        keys: &Arc<KeySet>,
        check_tail: bool,
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
    ) -> std::result::Result<CommitReport, AppendError> {
        let started = self.clock_start();
        let top = self.replay.top().map(|top| (top.phase, top.begin.clone()));
        let Some((phase, begin)) = top else {
            return Err(AppendError::refused(
                Code::HoldMissing,
                "The journal holds no record to commit.",
            ));
        };
        if phase != Phase::Synced || begin.seq != held.seq {
            return Err(AppendError::refused(
                Code::HoldMissing,
                "The journal does not hold the record that was held.",
            ));
        }
        // файл наш и ровно того размера, какого его оставила удержанная запись
        let whole = self.prove_ours(&begin)?;
        if self.len()? != begin.new_len || held.new_len != begin.new_len {
            return Err(AppendError::refused(
                Code::StageChanged,
                "The archive has another length than at the hold.",
            ));
        }
        // будущие головы — те, что записал журнал: по секторам области, какой она станет
        if !whole {
            self.prove_patches(&begin, &held.patches)?;
        }
        if check_tail {
            let found = self.hash_range(begin.old_len, begin.new_len)?;
            if found != held.tail_sha {
                return Err(AppendError::refused(
                    Code::StageChanged,
                    "The bytes appended at the hold changed.",
                ));
            }
        }
        // с этой точки запись доводится
        let head_clock = Instant::now();
        if !whole {
            let (root, nested) = match held.patches.split_last() {
                Some((root, nested)) if root.0 == 0 => (&root.1, nested),
                _ => {
                    return Err(AppendError::refused(
                        Code::StageChanged,
                        "The held heads have no root head.",
                    ))
                }
            };
            let nested: Vec<(u64, &[u8])> = nested
                .iter()
                .map(|(at, bytes)| (*at, bytes.as_slice()))
                .collect();
            if let Err(error) = self.write_head_set(&nested, root) {
                let _ = self.undo_top(false);
                return Err(error);
            }
        }
        let head_time = head_clock.elapsed();
        self.host.hit("append-after-head");
        let opened = Archive::open_path(&self.path, Some(Arc::clone(keys)));
        let checked = opened
            .map_err(AppendError::from)
            .and_then(|archive| verify(&archive).map_err(format_error));
        if let Err(error) = checked {
            let _ = self.undo_top(false);
            return Err(error);
        }
        let stamp = self.stamp_now()?;
        self.log(vec![Entry::Done(begin.seq, stamp)])?;
        self.host.hit("append-after-done");
        Ok(CommitReport {
            seq: begin.seq,
            fingerprint: self.text_of(&begin.after),
            timings: self.timings(started, Duration::ZERO, head_time),
        })
    }

    /// Будущие головы дают в областях на месте ровно те сектора, что записал журнал.
    fn prove_patches(
        &mut self,
        begin: &Begin,
        patches: &[(u64, Vec<u8>)],
    ) -> std::result::Result<(), AppendError> {
        let wrong = || {
            AppendError::refused(
                Code::StageChanged,
                "The held heads do not match the journal record.",
            )
        };
        for region in begin.in_place() {
            let size = region.old.len();
            let end = region.at.checked_add(size as u64).ok_or_else(wrong)?;
            if end > self.len()? || region.new_sectors.len() != size.div_ceil(SECTOR) {
                return Err(wrong());
            }
            let mut image = self.read_vec(region.at, size)?;
            for (at, bytes) in patches {
                let from = (*at).max(region.at);
                let to = (*at + bytes.len() as u64).min(end);
                if from < to {
                    image[(from - region.at) as usize..(to - region.at) as usize]
                        .copy_from_slice(&bytes[(from - *at) as usize..(to - *at) as usize]);
                }
            }
            let fresh = image
                .chunks(SECTOR)
                .zip(region.new_sectors)
                .all(|(sector, wanted)| &sha256(sector) == wanted);
            if !fresh {
                return Err(wrong());
            }
        }
        Ok(())
    }

    /// Голова ложится двумя половинами с точкой обрыва между ними. Граница между
    /// половинами стоит на секторе по 512 байт (начало области тоже на секторе):
    /// порванная запись головы тогда даёт смесь целых секторов прежней и новой
    /// головы, а по ним `prove_ours` отличает её от чужого файла.
    fn write_halves(
        &mut self,
        at: u64,
        head: &[u8],
        point: &str,
    ) -> std::result::Result<(), AppendError> {
        let half = head.len() / 2 / SECTOR * SECTOR;
        self.file.seek(SeekFrom::Start(at))?;
        self.file.write_all(&head[..half])?;
        self.sync()?;
        self.host.hit(point);
        self.file.write_all(&head[half..])?;
        self.sync()?;
        Ok(())
    }

    /// Записанный архив открывается и проходит проверку вызывающего.
    fn verify_written(
        &mut self,
        input: &AppendInput<'_>,
        verify: &mut dyn FnMut(&Archive) -> std::result::Result<(), String>,
    ) -> std::result::Result<(), AppendError> {
        let opened = Archive::open_path(&self.path, Some(Arc::clone(input.keys)))?;
        verify(&opened).map_err(format_error)?;
        Ok(())
    }
}

/// Есть ли рядом с архивом журнал (по имени файла).
pub fn has_journal(archive: &Path) -> bool {
    journal_path(archive).is_file()
}

/// Окончание имени файла журнала.
pub const SUFFIX: &str = JOURNAL_SUFFIX;
