//! Таблица слоёв: файл `<архив>.astral-layers` рядом с архивом и журналом.
//!
//! Слой — набор правок корня архива из одних добавлений (новые записи, замена
//! записи новой, новый вложенный контейнер). Тела слоя лежат в файле всегда; чтобы
//! слой включить или выключить, пишется только голова (оглавление), и таблица
//! хранит то, без чего это не сделать: у каждой записи слоя слово оглавления в 16
//! байт «до» (у замены) и «после».
//!
//! Таблица ничего не говорит о том, какие слои включены: это состояние лежит в
//! журнале (кадры 12, `journal::LayerOp`) и откатывается вместе с файлом. Таблица
//! только описывает слои, и поэтому она не бывает впереди архива так же, как
//! сводный рецепт:
//!
//! 1. журнал (`Begin`, кадр слоя, `Synced`) и тела на диске;
//! 2. таблица: временный файл, сброс, переименование — ДО записи голов;
//! 3. головы, «готово».
//!
//! Обрыв до шага 2 оставляет таблицу прежней, а запись откатывается. Обрыв после
//! шага 2 оставляет в таблице строку слоя, чьей записи в журнале нет или она не
//! готова: чтение таблицы (`LayerSet::load`) такую строку не принимает, а любая
//! следующая запись таблицы её убирает.
//!
//! Формат: 16 байт (`ASTRLAYR`, версия формата `u32`, нули), дальше кадры, как у
//! журнала: `u32` длина полезной части, `u8` вид, `u8` версия кадра (1), `u16`
//! нули, полезная часть, `u32` CRC-32 кадра выше. Виды: 1 цепочка (SHA-256 файла
//! начала цепочки журнала; таблица чужой цепочки не действует), 2 слой, 3 вариант
//! реестра. Файл целиком пишется заново и встаёт на место переименованием.

use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

use flate2::Crc;

use crate::{
    append::{AppendError, Code},
    journal::{Digest, Phase, Replay, MAX_LAYER_ID},
    seal::ceil_block,
    toc::{parse_entry, RawKind, BLOCK, ENTRY_SIZE},
};

/// Окончание имени файла таблицы слоёв.
pub const LAYERS_SUFFIX: &str = ".astral-layers";

/// Путь таблицы слоёв архива: то же имя и `.astral-layers` на конце.
pub fn layers_path(archive: &Path) -> PathBuf {
    let mut name = archive.as_os_str().to_owned();
    name.push(LAYERS_SUFFIX);
    PathBuf::from(name)
}

/// Слово оглавления: 16 байт записи, у которых смещение имени (первые два байта)
/// занулено: оно зависит от блока имён и каждый раз пересчитывается.
pub type Word = [u8; ENTRY_SIZE];

/// Запись без смещения имени.
pub fn bare(raw: &[u8; ENTRY_SIZE]) -> Word {
    let mut word = *raw;
    word[0] = 0;
    word[1] = 0;
    word
}

/// Одно ли это слово (смещение имени не в счёт).
pub fn same(left: &Word, right: &Word) -> bool {
    left[2..] == right[2..]
}

/// Номер блока, с которого начинается тело записи.
pub fn block_of(word: &Word) -> u64 {
    match parse_entry(word).kind {
        RawKind::Binary { offset_blocks, .. } | RawKind::Resource { offset_blocks, .. } => {
            u64::from(offset_blocks)
        }
        RawKind::Directory { .. } => 0,
    }
}

/// Сколько байт тело записи занимает в файле (0 у пустого).
pub fn body_len(word: &Word) -> u64 {
    match parse_entry(word).kind {
        RawKind::Binary {
            stored_size,
            uncompressed_size,
            ..
        } => u64::from(if stored_size == 0 {
            uncompressed_size
        } else {
            stored_size
        }),
        RawKind::Resource { stored_size, .. } => u64::from(stored_size),
        RawKind::Directory { .. } => 0,
    }
}

/// То же слово с другим номером блока тела.
pub fn with_block(word: &Word, block: u64) -> Word {
    let mut out = *word;
    out[5] = block as u8;
    out[6] = (block >> 8) as u8;
    out[7] = (out[7] & 0x80) | ((block >> 16) as u8 & 0x7f);
    out
}

/// Что слой сделал с записью корня.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Записи не было.
    Add,
    /// Запись была, и слой положил на её место другую.
    Replace,
}

/// Одна запись корня, которую слой добавил или заменил.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    /// Путь записи в оглавлении корня: звенья через `/`, регистр как в файле.
    pub path: String,
    pub kind: Kind,
    /// Слово «до» (у замены): его тело остаётся в файле, пока слой включён.
    pub before: Option<Word>,
    /// Слово «после».
    pub after: Word,
    /// Сколько байт занимают тела «до» и «после».
    pub before_len: u64,
    pub after_len: u64,
}

/// Слой.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub id: String,
    /// Номер записи журнала, которая положила слой.
    pub seq: u64,
    /// Слои, без которых этот не включается.
    pub requires: Vec<String>,
    /// Слой правил существующий вложенный архив (или снимал записи): такой слой не
    /// переключается, записей у него в таблице нет.
    pub linked: bool,
    pub changes: Vec<Change>,
    /// Каталоги, которые слой создал (в порядке создания): при выключении пустые
    /// из них уходят.
    pub dirs: Vec<String>,
}

impl Row {
    /// Сколько байт спящих тел у слоя в этом состоянии: у включённого — тела
    /// заменённых записей («до»), у выключенного — тела «после». Связанный слой
    /// спящих тел не имеет.
    pub fn dormant_bytes(&self, enabled: bool) -> u64 {
        if self.linked {
            return 0;
        }
        self.changes
            .iter()
            .map(|change| {
                if !enabled {
                    ceil_block(change.after_len)
                } else if change.before.is_some() {
                    ceil_block(change.before_len)
                } else {
                    0
                }
            })
            .sum()
    }
}

/// Вариант тела реестра: содержимое (SHA-256 распакованных данных) и слово записи,
/// с которым оно лежит в файле. Тело проверяется при каждом использовании
/// (`stored_sha`), поэтому устаревшая строка (откат, перезапись головой) никому
/// не мешает.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Variant {
    pub entry: String,
    pub sha: Digest,
    pub word: Word,
    /// SHA-256 хранимых байт тела и их число.
    pub stored_sha: Digest,
    pub stored_len: u64,
}

/// Таблица слоёв как она лежит на диске.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Table {
    /// SHA-256 файла начала цепочки журнала, которой принадлежит таблица.
    pub chain: Digest,
    pub rows: Vec<Row>,
    pub variants: Vec<Variant>,
}

/// Слой, который кладёт дозапись (`Session::set_layer`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerPlace {
    /// Id слоя: от 1 до 64 знаков ASCII.
    pub id: String,
    /// Слои, без которых этот не включается (сверх тех, на чьи записи он лёг).
    pub requires: Vec<String>,
}

/// Что дозапись сделала со слоем.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerReport {
    pub id: String,
    /// Слой правил существующий вложенный архив или снимал записи: не переключается.
    pub linked: bool,
    pub requires: Vec<String>,
    /// Записей корня: добавлено и заменено.
    pub added: usize,
    pub replaced: usize,
    /// Байт спящих тел слоя сейчас (включённого слоя: тела замененных записей).
    pub dormant_bytes: u64,
    /// Общие записи, которые эта установка заменила без слоя: путь и записанные
    /// байты тела.
    pub registry: Vec<(String, u64)>,
}

fn damaged(text: &str) -> AppendError {
    AppendError::refused(Code::LayersDamaged, text)
}

// ---------------------------------------------------------------------------
// Кодирование
// ---------------------------------------------------------------------------

const FILE_MAGIC: [u8; 8] = *b"ASTRLAYR";
const FORMAT_VERSION: u32 = 1;
const FILE_HEADER_LEN: usize = 16;
const FRAME_VERSION: u8 = 1;
const FRAME_HEAD_LEN: usize = 8;
const FRAME_TAIL_LEN: usize = 4;
const MAX_PAYLOAD: u64 = 1 << 30;
/// Слоёв в таблице и записей в слое не больше этого.
const MAX_ROWS: usize = 4096;
const MAX_CHANGES: usize = 4_000_000;

#[derive(Default)]
struct Put(Vec<u8>);

impl Put {
    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }

    fn u32(&mut self, value: u32) {
        self.0.extend_from_slice(&value.to_le_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_le_bytes());
    }

    fn bytes(&mut self, value: &[u8]) {
        self.0.extend_from_slice(value);
    }

    /// Строка: `u16` длина и байты.
    fn text(&mut self, value: &str) {
        let len = value.len().min(usize::from(u16::MAX));
        self.0.extend_from_slice(&(len as u16).to_le_bytes());
        self.0.extend_from_slice(&value.as_bytes()[..len]);
    }

    fn texts(&mut self, values: &[String]) {
        self.u32(values.len() as u32);
        for value in values {
            self.text(value);
        }
    }
}

struct Take<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Take<'a> {
    fn slice(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(len)?;
        let part = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(part)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.slice(1)?[0])
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.slice(2)?.try_into().ok()?))
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.slice(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.slice(8)?.try_into().ok()?))
    }

    fn digest(&mut self) -> Option<Digest> {
        self.slice(32)?.try_into().ok()
    }

    fn word(&mut self) -> Option<Word> {
        self.slice(ENTRY_SIZE)?.try_into().ok()
    }

    fn text(&mut self) -> Option<String> {
        let len = usize::from(self.u16()?);
        let bytes = self.slice(len)?;
        std::str::from_utf8(bytes)
            .ok()
            .filter(|text| text.is_ascii())
            .map(str::to_owned)
    }

    fn texts(&mut self) -> Option<Vec<String>> {
        let count = self.u32()? as usize;
        if count > MAX_ROWS * 16 {
            return None;
        }
        let mut out = Vec::with_capacity(count.min(64));
        for _ in 0..count {
            out.push(self.text()?);
        }
        Some(out)
    }

    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }
}

fn crc_of(bytes: &[u8]) -> u32 {
    let mut crc = Crc::new();
    crc.update(bytes);
    crc.sum()
}

fn frame(kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(FRAME_HEAD_LEN + payload.len() + FRAME_TAIL_LEN);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.push(kind);
    out.push(FRAME_VERSION);
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(payload);
    let crc = crc_of(&out);
    out.extend_from_slice(&crc.to_le_bytes());
    out
}

fn row_payload(row: &Row) -> Vec<u8> {
    let mut out = Put::default();
    out.text(&row.id);
    out.u64(row.seq);
    out.u8(u8::from(row.linked));
    out.texts(&row.requires);
    out.texts(&row.dirs);
    out.u32(row.changes.len() as u32);
    for change in &row.changes {
        out.text(&change.path);
        out.u8(match change.kind {
            Kind::Add => 0,
            Kind::Replace => 1,
        });
        out.u8(u8::from(change.before.is_some()));
        out.bytes(&change.before.unwrap_or_default());
        out.bytes(&change.after);
        out.u64(change.before_len);
        out.u64(change.after_len);
    }
    out.0
}

fn variant_payload(variant: &Variant) -> Vec<u8> {
    let mut out = Put::default();
    out.text(&variant.entry);
    out.bytes(&variant.sha);
    out.bytes(&variant.word);
    out.bytes(&variant.stored_sha);
    out.u64(variant.stored_len);
    out.0
}

impl Table {
    /// Файл целиком.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&FILE_MAGIC);
        out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&frame(1, &self.chain));
        for row in &self.rows {
            out.extend_from_slice(&frame(2, &row_payload(row)));
        }
        for variant in &self.variants {
            out.extend_from_slice(&frame(3, &variant_payload(variant)));
        }
        out
    }

    /// Разбор файла: любая порча — `LayersDamaged` (файл переписывается целиком
    /// переименованием, оборванного хвоста не бывает).
    pub fn decode(bytes: &[u8]) -> Result<Table, AppendError> {
        if bytes.len() < FILE_HEADER_LEN
            || bytes[..8] != FILE_MAGIC
            || bytes[12..FILE_HEADER_LEN] != [0; 4]
        {
            return Err(damaged("The file is not an Astral layers table."));
        }
        let version = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
        if version != FORMAT_VERSION {
            return Err(damaged(
                "The layers table has an unsupported format version.",
            ));
        }
        let mut table = Table::default();
        let mut at = FILE_HEADER_LEN;
        let mut first = true;
        while at < bytes.len() {
            if bytes.len() - at < FRAME_HEAD_LEN {
                return Err(damaged("The layers table ends inside a frame."));
            }
            let len = u64::from(u32::from_le_bytes([
                bytes[at],
                bytes[at + 1],
                bytes[at + 2],
                bytes[at + 3],
            ]));
            if len > MAX_PAYLOAD {
                return Err(damaged("A layers table frame is implausibly long."));
            }
            let total = FRAME_HEAD_LEN + len as usize + FRAME_TAIL_LEN;
            if bytes.len() - at < total {
                return Err(damaged("The layers table ends inside a frame."));
            }
            let body = &bytes[at..at + total - FRAME_TAIL_LEN];
            let stored = u32::from_le_bytes(
                bytes[at + total - 4..at + total]
                    .try_into()
                    .unwrap_or([0; 4]),
            );
            if stored != crc_of(body) || body[5] != FRAME_VERSION || body[6] != 0 || body[7] != 0 {
                return Err(damaged("A layers table frame is damaged."));
            }
            let kind = body[4];
            let mut take = Take {
                bytes: &body[FRAME_HEAD_LEN..],
                at: 0,
            };
            let bad = || damaged("A layers table frame does not read.");
            match (kind, first) {
                (1, true) => table.chain = take.digest().ok_or_else(bad)?,
                (2, false) => {
                    if table.rows.len() >= MAX_ROWS {
                        return Err(bad());
                    }
                    table.rows.push(read_row(&mut take).ok_or_else(bad)?);
                }
                (3, false) => table
                    .variants
                    .push(read_variant(&mut take).ok_or_else(bad)?),
                _ => return Err(bad()),
            }
            if !take.done() {
                return Err(bad());
            }
            first = false;
            at += total;
        }
        if first {
            return Err(damaged("The layers table has no chain frame."));
        }
        Ok(table)
    }
}

fn read_row(take: &mut Take<'_>) -> Option<Row> {
    let id = take.text()?;
    let seq = take.u64()?;
    let linked = take.u8()? != 0;
    let requires = take.texts()?;
    let dirs = take.texts()?;
    let count = take.u32()? as usize;
    if count > MAX_CHANGES || id.is_empty() || id.len() > MAX_LAYER_ID {
        return None;
    }
    let mut changes = Vec::with_capacity(count.min(1 << 12));
    for _ in 0..count {
        let path = take.text()?;
        let kind = match take.u8()? {
            0 => Kind::Add,
            1 => Kind::Replace,
            _ => return None,
        };
        let has_before = take.u8()? != 0;
        let before = take.word()?;
        let after = take.word()?;
        changes.push(Change {
            path,
            kind,
            before: has_before.then_some(before),
            after,
            before_len: take.u64()?,
            after_len: take.u64()?,
        });
    }
    Some(Row {
        id,
        seq,
        requires,
        linked,
        changes,
        dirs,
    })
}

fn read_variant(take: &mut Take<'_>) -> Option<Variant> {
    Some(Variant {
        entry: take.text()?,
        sha: take.digest()?,
        word: take.word()?,
        stored_sha: take.digest()?,
        stored_len: take.u64()?,
    })
}

// ---------------------------------------------------------------------------
// Файл
// ---------------------------------------------------------------------------

/// Кладёт таблицу целиком или не кладёт: временный файл рядом, сброс на диск,
/// переименование поверх. `hit` зовётся, когда временный файл лежит, а
/// переименования ещё не было (точка обрыва для стендов).
pub fn save(path: &Path, table: &Table, hit: &dyn Fn(&str)) -> Result<(), AppendError> {
    let temporary = {
        let mut name = path.as_os_str().to_owned();
        name.push(".tmp");
        PathBuf::from(name)
    };
    let written = (|| -> io::Result<()> {
        let mut file = File::create(&temporary)?;
        file.write_all(&table.encode())?;
        file.sync_all()
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    hit("layers-after-temp");
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    Ok(())
}

/// Читает таблицу; `None` — файла нет.
pub fn read(path: &Path) -> Result<Option<Table>, AppendError> {
    match fs::read(path) {
        Ok(bytes) => Table::decode(&bytes).map(Some),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Убирает файл таблицы (и недописанный временный); нет файла — не отказ.
pub fn remove(path: &Path) -> io::Result<()> {
    let temporary = {
        let mut name = path.as_os_str().to_owned();
        name.push(".tmp");
        PathBuf::from(name)
    };
    let _ = fs::remove_file(temporary);
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

/// В каком состоянии слой.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Enabled,
    Disabled,
    /// Снят: тела больше никому не нужны.
    Removed,
}

impl Status {
    pub const fn word(self) -> &'static str {
        match self {
            Status::Enabled => "enabled",
            Status::Disabled => "disabled",
            Status::Removed => "removed",
        }
    }
}

/// Состояния слоёв по готовым записям журнала, от нижней к верхней.
pub fn statuses(replay: &Replay) -> BTreeMap<String, Status> {
    let mut map = BTreeMap::new();
    for record in &replay.records {
        if record.phase != Phase::Done {
            continue;
        }
        let Some(op) = replay.layer_op(record.begin.seq) else {
            continue;
        };
        if let Some(id) = &op.place {
            map.insert(id.clone(), Status::Enabled);
        }
        for (names, status) in [
            (&op.enable, Status::Enabled),
            (&op.disable, Status::Disabled),
            (&op.remove, Status::Removed),
        ] {
            for id in names {
                if let Some(slot) = map.get_mut(id) {
                    *slot = status;
                }
            }
        }
    }
    map
}

/// Таблица, сведённая с журналом: только слои, чьи записи готовы.
#[derive(Clone, Debug, Default)]
pub struct LayerSet {
    pub rows: Vec<Row>,
    pub variants: Vec<Variant>,
    pub status: BTreeMap<String, Status>,
    /// Слои, которые журнал знает, а таблица нет (таблицу потеряли или подменили).
    pub lost: Vec<String>,
}

impl LayerSet {
    /// Читает таблицу рядом с архивом и сводит её с журналом. Нет таблицы или она
    /// другой цепочки — слоёв нет. Испорченная таблица — `LayersDamaged`.
    pub fn load(archive: &Path, replay: &Replay) -> Result<LayerSet, AppendError> {
        let status = statuses(replay);
        let table = read(&layers_path(archive))?;
        let chain = replay.base.as_ref().map(|base| base.digest);
        let table = match (table, chain) {
            (Some(found), Some(chain)) if found.chain == chain => found,
            _ => {
                let lost = status
                    .iter()
                    .filter(|(_, state)| **state != Status::Removed)
                    .map(|(id, _)| id.clone())
                    .collect();
                return Ok(LayerSet {
                    status: BTreeMap::new(),
                    lost,
                    ..LayerSet::default()
                });
            }
        };
        let placed = |row: &Row| {
            replay.records.iter().any(|record| {
                record.phase == Phase::Done
                    && record.begin.seq == row.seq
                    && replay
                        .layer_op(row.seq)
                        .is_some_and(|op| op.place.as_deref() == Some(row.id.as_str()))
            })
        };
        let rows: Vec<Row> = table.rows.into_iter().filter(placed).collect();
        let lost = status
            .iter()
            .filter(|(id, state)| {
                **state != Status::Removed && !rows.iter().any(|row| &row.id == *id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        let status = status
            .into_iter()
            .filter(|(id, _)| rows.iter().any(|row| &row.id == id))
            .collect();
        Ok(LayerSet {
            rows,
            variants: table.variants,
            status,
            lost,
        })
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty() && self.lost.is_empty()
    }

    pub fn row(&self, id: &str) -> Option<&Row> {
        self.rows.iter().rev().find(|row| row.id == id)
    }

    pub fn state_of(&self, id: &str) -> Option<Status> {
        self.status.get(id).copied()
    }

    /// Слои не снятые, по возрастанию номера записи установки.
    pub fn live_rows(&self) -> impl Iterator<Item = &Row> {
        self.rows
            .iter()
            .filter(|row| self.state_of(&row.id).is_some_and(|s| s != Status::Removed))
    }

    /// Тела, которые не нужны оглавлению сейчас, но нужны слою, чтобы перейти в
    /// другое состояние: у выключенного слоя — тела «после», у включённого — тела
    /// «до» заменённых записей. Пороги уплотнения их мусором не считают.
    pub fn dormant_bytes(&self) -> u64 {
        self.live_rows()
            .map(|row| row.dormant_bytes(self.state_of(&row.id) == Some(Status::Enabled)))
            .sum()
    }

    /// Самое раннее смещение тела, которое держит слой: спящего, а у включённого
    /// слоя и тела его записей. Голова (и порог, ниже которого тела переезжают)
    /// не должна до него дорасти: спящее тело накрыла бы голова, а тело записи
    /// включённого слоя переехало бы, и слово слоя в таблице устарело бы.
    pub fn owned_floor(&self) -> Option<u64> {
        let mut floor: Option<u64> = None;
        for row in self.live_rows().filter(|row| !row.linked) {
            let enabled = self.state_of(&row.id) == Some(Status::Enabled);
            for change in &row.changes {
                // тело «до» выключенного слоя живёт в оглавлении и переезжает как всякое
                let mut owned = vec![(change.after, change.after_len)];
                if let (true, Some(before)) = (enabled, change.before) {
                    owned.push((before, change.before_len));
                }
                for (word, len) in owned {
                    if len > 0 {
                        let at = block_of(&word) * BLOCK;
                        floor = Some(floor.map_or(at, |known| known.min(at)));
                    }
                }
            }
        }
        floor
    }

    /// Сколько прибавили бы к порогу головы записи выключенных слоёв, которых
    /// сейчас нет в оглавлении (16 байт записи и имя с нулём): по этой сумме
    /// считается `H_max` при установке слоя, чтобы включение не переносило тела.
    pub fn extra_threshold(&self) -> u64 {
        let node = |path: &str| {
            let name = path.rsplit('/').next().unwrap_or(path);
            ENTRY_SIZE as u64 + name.len() as u64 + 1
        };
        self.live_rows()
            .filter(|row| !row.linked && self.state_of(&row.id) == Some(Status::Disabled))
            .map(|row| {
                let files: u64 = row
                    .changes
                    .iter()
                    .filter(|change| change.kind == Kind::Add)
                    .map(|change| node(&change.path))
                    .sum();
                let dirs: u64 = row.dirs.iter().map(|dir| node(dir)).sum();
                files + dirs
            })
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::{Base, Begin, LayerOp, Record, Stamp};

    fn word(block: u32, len: u32, tag: u8) -> Word {
        let mut raw = [0u8; ENTRY_SIZE];
        raw[2..5].copy_from_slice(&len.to_le_bytes()[..3]);
        raw[5..8].copy_from_slice(&block.to_le_bytes()[..3]);
        raw[8] = tag;
        raw
    }

    fn change(path: &str, kind: Kind, before: Option<Word>, after: Word) -> Change {
        Change {
            path: path.to_owned(),
            kind,
            before,
            before_len: before.map_or(0, |word| body_len(&word)),
            after_len: body_len(&after),
            after,
        }
    }

    fn row(id: &str, seq: u64, changes: Vec<Change>, dirs: &[&str]) -> Row {
        Row {
            id: id.to_owned(),
            seq,
            requires: vec!["base".to_owned()],
            linked: false,
            changes,
            dirs: dirs.iter().map(|dir| (*dir).to_owned()).collect(),
        }
    }

    fn table() -> Table {
        Table {
            chain: [7; 32],
            rows: vec![
                row(
                    "one",
                    0,
                    vec![
                        change("a/new.xml", Kind::Add, None, word(900, 1000, 1)),
                        change(
                            "a/old.xml",
                            Kind::Replace,
                            Some(word(40, 600, 2)),
                            word(902, 700, 3),
                        ),
                    ],
                    &["a"],
                ),
                Row {
                    linked: true,
                    ..row("two", 1, Vec::new(), &[])
                },
            ],
            variants: vec![Variant {
                entry: "content.xml".to_owned(),
                sha: [1; 32],
                word: word(950, 30, 4),
                stored_sha: [2; 32],
                stored_len: 30,
            }],
        }
    }

    fn journal(base: u8, ops: &[(u64, LayerOp)]) -> Replay {
        let mut replay = Replay::default();
        replay.base = Some(Base {
            len: 10,
            head_sha: [0; 32],
            head_len: 4,
            digest: [base; 32],
            stamp: Stamp::default(),
        });
        for (seq, op) in ops {
            replay.records.push(Record {
                begin: Begin {
                    seq: *seq,
                    old_len: 10,
                    new_len: 10,
                    prev: [0; 32],
                    after: [0; 32],
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
                },
                phase: Phase::Done,
                bytes: 0,
            });
            replay.layer_ops.push((*seq, op.clone()));
        }
        replay
    }

    fn op(place: Option<&str>, enable: &[&str], disable: &[&str], remove: &[&str]) -> LayerOp {
        let own = |names: &[&str]| names.iter().map(|name| (*name).to_owned()).collect();
        LayerOp {
            place: place.map(str::to_owned),
            enable: own(enable),
            disable: own(disable),
            remove: own(remove),
        }
    }

    #[test]
    fn a_table_reads_back_exactly_and_names_its_chain() {
        let whole = table();
        let bytes = whole.encode();
        assert_eq!(&bytes[..8], b"ASTRLAYR");
        assert_eq!(Table::decode(&bytes).unwrap(), whole);
        assert_eq!(
            layers_path(Path::new("C:/g/update/update.rpf")),
            PathBuf::from("C:/g/update/update.rpf.astral-layers")
        );
    }

    #[test]
    fn every_cut_and_every_flipped_byte_of_a_table_is_damage() {
        let whole = table();
        let bytes = whole.encode();
        // файл, оборванный на границе кадра, — целая таблица покороче: так не бывает,
        // потому что файл встаёт на место переименованием
        let boundaries: Vec<usize> = [
            Table {
                rows: Vec::new(),
                variants: Vec::new(),
                ..whole.clone()
            },
            Table {
                rows: whole.rows[..1].to_vec(),
                variants: Vec::new(),
                ..whole.clone()
            },
            Table {
                variants: Vec::new(),
                ..whole.clone()
            },
        ]
        .iter()
        .map(|part| part.encode().len())
        .collect();
        for cut in 0..bytes.len() {
            let read = Table::decode(&bytes[..cut]);
            assert_eq!(read.is_ok(), boundaries.contains(&cut), "cut {cut}");
        }
        for at in (0..bytes.len()).step_by(7) {
            let mut broken = bytes.clone();
            broken[at] ^= 0x10;
            assert!(Table::decode(&broken).is_err(), "byte {at}");
        }
        assert!(Table::decode(b"not a table at all, nothing like it").is_err());
    }

    #[test]
    fn the_state_of_every_layer_comes_from_the_ready_records_of_the_journal() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("update.rpf");
        save(&layers_path(&archive), &table(), &|_| {}).unwrap();
        let replay = journal(
            7,
            &[
                (0, op(Some("one"), &[], &[], &[])),
                (1, op(Some("two"), &[], &[], &[])),
                (2, op(None, &[], &["one"], &[])),
            ],
        );
        let set = LayerSet::load(&archive, &replay).unwrap();
        assert_eq!(set.state_of("one"), Some(Status::Disabled));
        assert_eq!(set.state_of("two"), Some(Status::Enabled));
        assert!(set.lost.is_empty());
        // выключенный слой бережёт все свои тела (1000 и 700 байт с добивкой до 512), и
        // к порогу головы он прибавил бы две записи (файл и каталог), по 16 байт и
        // имени с нулём
        assert_eq!(set.dormant_bytes(), 1024 + 1024);
        assert_eq!(set.extra_threshold(), (16 + 7 + 1) + (16 + 1 + 1));
        assert_eq!(set.owned_floor(), Some(900 * BLOCK));
        // у включённого слоя спят тела заменённых записей
        let enabled = journal(
            7,
            &[
                (0, op(Some("one"), &[], &[], &[])),
                (1, op(Some("two"), &[], &[], &[])),
            ],
        );
        let set = LayerSet::load(&archive, &enabled).unwrap();
        assert_eq!(set.dormant_bytes(), 1024);
        assert_eq!(set.extra_threshold(), 0);
        assert_eq!(set.owned_floor(), Some(40 * BLOCK));
        // снятый слой ничего не держит
        let removed = journal(
            7,
            &[
                (0, op(Some("one"), &[], &[], &[])),
                (1, op(Some("two"), &[], &[], &[])),
                (2, op(None, &[], &[], &["one"])),
            ],
        );
        let set = LayerSet::load(&archive, &removed).unwrap();
        assert_eq!(set.state_of("one"), Some(Status::Removed));
        assert_eq!(set.dormant_bytes(), 0);
        assert_eq!(set.owned_floor(), None);
    }

    #[test]
    fn a_row_without_a_ready_record_and_a_table_of_another_chain_do_not_count() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("update.rpf");
        save(&layers_path(&archive), &table(), &|_| {}).unwrap();
        // записи слоя нет в журнале (откат): строка не принимается
        let only_one = journal(7, &[(0, op(Some("one"), &[], &[], &[]))]);
        let set = LayerSet::load(&archive, &only_one).unwrap();
        assert!(set.row("two").is_none() && set.row("one").is_some());
        // у записи другой номер: не та запись
        let moved = journal(7, &[(5, op(Some("one"), &[], &[], &[]))]);
        assert!(LayerSet::load(&archive, &moved).unwrap().rows.is_empty());
        // журнал другой цепочки: таблица не действует, а слои журнала потеряны
        let other = journal(8, &[(0, op(Some("one"), &[], &[], &[]))]);
        let set = LayerSet::load(&archive, &other).unwrap();
        assert!(set.rows.is_empty());
        assert_eq!(set.lost, vec!["one".to_owned()]);
        // нет таблицы вовсе
        let none = dir.path().join("other.rpf");
        let set = LayerSet::load(&none, &only_one).unwrap();
        assert_eq!(set.lost, vec!["one".to_owned()]);
        assert!(LayerSet::load(&none, &Replay::default())
            .unwrap()
            .is_empty());
        // порча таблицы — отказ
        let mut bytes = table().encode();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        fs::write(layers_path(&archive), bytes).unwrap();
        assert!(LayerSet::load(&archive, &only_one).is_err());
    }

    #[test]
    fn a_saved_table_leaves_no_temporary_file_and_removal_takes_both() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("update.rpf");
        let path = layers_path(&archive);
        let points = std::cell::RefCell::new(0);
        save(&path, &table(), &|point| {
            assert_eq!(point, "layers-after-temp");
            assert!(path.with_extension("astral-layers.tmp").is_file());
            *points.borrow_mut() += 1;
        })
        .unwrap();
        assert_eq!(*points.borrow(), 1);
        assert!(!path.with_extension("astral-layers.tmp").exists());
        assert_eq!(read(&path).unwrap(), Some(table()));
        fs::write(path.with_extension("astral-layers.tmp"), b"half").unwrap();
        remove(&path).unwrap();
        assert!(!path.exists() && !path.with_extension("astral-layers.tmp").exists());
        remove(&path).unwrap();
        assert_eq!(read(&path).unwrap(), None);
    }

    #[test]
    fn words_keep_their_body_and_ignore_the_name_offset() {
        let mut raw = word(1234, 5000, 9);
        raw[0] = 0x11;
        raw[1] = 0x22;
        assert_eq!(bare(&raw)[..2], [0, 0]);
        assert!(same(&raw, &word(1234, 5000, 9)));
        assert!(!same(&raw, &word(1235, 5000, 9)));
        assert_eq!(block_of(&raw), 1234);
        assert_eq!(body_len(&raw), 5000);
        let moved = with_block(&raw, 70_000);
        assert_eq!(block_of(&moved), 70_000);
        assert_eq!(body_len(&moved), 5000);
        assert_eq!(moved[8], 9);
    }
}
