//! Журнал дозаписи: файл `<архив>.astral-journal` рядом с живым архивом.
//!
//! Журнал — стопка записей, но на диск он ложится только дописыванием: каждая
//! запись и каждая отметка о ней — отдельный кадр со своей контрольной суммой,
//! который пишется одним вызовом и сразу сбрасывается на диск. Оборванный
//! кадр (короткий, с неверной суммой в самом хвосте) отбрасывается при чтении:
//! до его записи ничего не менялось ни в архиве, ни в журнале. Испорченный
//! кадр посреди журнала отказ: гадать, что было дальше, нельзя.
//!
//! Файл: 16 байт (`ASTRJRNL`, версия формата, нули), дальше кадры:
//!
//! ```text
//! u32  длина полезной части        (младшим байтом вперёд, как всё ниже)
//! u8   вид кадра
//! u8   версия кадра (1)
//! u16  нули
//! ...  полезная часть
//! u32  CRC-32 всех байт кадра выше
//! ```
//!
//! Виды: 1 база цепочки, 2 начало записи, 3 «данные на диске», 4 «готово»
//! (с отпечатком файла), 5 намерение откатить, 6 откат закончен (запись
//! снята), 7 отпечаток файла, 8 нижняя граница номеров. Состояние записи
//! восстанавливается проходом по кадрам (`Replay`).

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use flate2::Crc;

use crate::append::{AppendError, Code};

/// Окончание имени файла журнала.
pub const JOURNAL_SUFFIX: &str = ".astral-journal";

/// Путь журнала архива: то же имя и `.astral-journal` на конце.
pub fn journal_path(archive: &Path) -> PathBuf {
    let mut name = archive.as_os_str().to_owned();
    name.push(JOURNAL_SUFFIX);
    PathBuf::from(name)
}

const FILE_MAGIC: [u8; 8] = *b"ASTRJRNL";
/// Версия формата файла.
pub const FORMAT_VERSION: u32 = 1;
const FILE_HEADER_LEN: usize = 16;
const FRAME_VERSION: u8 = 1;
const FRAME_HEAD_LEN: usize = 8;
const FRAME_TAIL_LEN: usize = 4;
/// Полезная часть длиннее этого не бывает (голова архива не больше 4 ГиБ).
const MAX_PAYLOAD: u64 = 1 << 31;

/// Отпечаток цепочки: 32 байта.
pub type Digest = [u8; 32];

fn damaged(text: impl Into<String>) -> AppendError {
    AppendError::refused(Code::JournalDamaged, text)
}

/// Состояние файла после нашей последней операции: время изменения и номер
/// файла на томе. Нужны, чтобы заметить правку тела на месте, которая не
/// меняет ни длину, ни оглавление.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Stamp {
    pub modified: Option<(u64, u32)>,
    pub identity: Option<(u64, u64)>,
}

impl Stamp {
    /// Время изменения как секунды и доли секунды от начала эпохи.
    pub fn from_time(modified: Option<SystemTime>) -> Option<(u64, u32)> {
        let since = modified?.duration_since(UNIX_EPOCH).ok()?;
        Some((since.as_secs(), since.subsec_nanos()))
    }

    /// Обратно во время (для сообщений и сверки).
    pub fn time(&self) -> Option<SystemTime> {
        let (secs, nanos) = self.modified?;
        Some(UNIX_EPOCH + Duration::new(secs, nanos))
    }
}

/// Начало цепочки: состояние архива до первой записи этого журнала.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Base {
    /// Длина файла.
    pub len: u64,
    /// SHA-256 головы (заголовок, записи, имена) на этот момент.
    pub head_sha: Digest,
    /// Длина головы.
    pub head_len: u32,
    /// SHA-256 файла целиком: отсюда идёт цепочка отпечатков.
    pub digest: Digest,
    pub stamp: Stamp,
}

/// Одно перенесённое тело.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Moved {
    pub from: u64,
    pub to: u64,
    pub len: u64,
}

/// Область файла ниже прежней длины, которая переписывается на месте (голова
/// вложенного архива): прежние байты, которыми запись откатывается, и SHA-256
/// каждого сектора по 512 байт в том виде, какой область примет после записи
/// (последний сектор может быть короче). По ним узнают новое содержимое и
/// порванную запись: сектор равен прежнему или новому, иначе файл не наш.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Region {
    /// Смещение области в файле; кратно 512, чтобы сектора области были
    /// секторами диска.
    pub at: u64,
    pub old: Vec<u8>,
    pub new_sectors: Vec<Digest>,
}

/// Кусок запаса вложенного архива, куда легли тела: до записи там нули, и откат
/// возвращает нули.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fill {
    pub at: u64,
    pub len: u64,
}

/// Окно прежнего файла `[from, from + len)` и его SHA-256. Запись не пишет в него
/// ни до, ни после себя: окна стоят там, куда она не пишет, и по ним узнают
/// «файл наш» (дешёвая проверка по телам).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Anchor {
    pub from: u64,
    pub len: u64,
    pub sha: Digest,
}

/// Запись о дозаписи: всё, чем её можно откатить и чем отличить результат.
///
/// Ниже прежней длины файла запись пишет только в названные области: голова
/// корня (`old_head`), головы вложенных архивов (`regions`) и куски запаса
/// вложенных (`fills`). Всё выше прежней длины откат отсекает усечением.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Begin {
    /// Номер записи; растёт на единицу, снятые номера не повторяются.
    pub seq: u64,
    /// Длина файла до и после.
    pub old_len: u64,
    pub new_len: u64,
    /// Отпечаток состояния до и после (`after` — от длины, головы и `prev`).
    pub prev: Digest,
    pub after: Digest,
    /// Мёртвых байт в архиве после записи.
    pub dead_after: u64,
    /// Сколько байт записала установка (тела, переезды, головы) и сколько из них переехало.
    pub bytes_written: u64,
    pub bytes_moved: u64,
    pub moves: Vec<Moved>,
    /// Том и номер файла в начале записи; `None` — хозяин их не знал.
    pub identity: Option<(u64, u64)>,
    /// Окна прежних тел перед концом прежнего файла, куда запись не пишет:
    /// это дешёвая проверка «файл наш» по телам.
    pub anchors: Vec<Anchor>,
    /// Область головы корня — прежние байты от начала файла до конца большей из
    /// голов (прежней и новой). Ими запись откатывается.
    pub old_head: Vec<u8>,
    /// SHA-256 каждого сектора по 512 байт той же области в том виде, какой она
    /// примет после записи головы (последний сектор может быть короче). По ним
    /// узнают новую голову и порванную запись головы: сектор равен прежнему или
    /// новому, иначе файл не наш.
    pub new_sectors: Vec<Digest>,
    /// Остальные области, переписываемые на месте: головы вложенных архивов.
    pub regions: Vec<Region>,
    /// Куски запаса вложенных архивов, куда легли тела.
    pub fills: Vec<Fill>,
    /// Пометка вызывающего: писатель её не читает и отдаёт как есть (движок кладёт
    /// сюда путь сводного рецепта, чтобы восстановление нашло его без запроса).
    /// Не длиннее `MAX_NOTE` байт; у кадров без пометки пусто.
    pub note: Vec<u8>,
}

/// Пометка записи не длиннее этого (путь файла).
pub const MAX_NOTE: usize = 4096;

/// Слой дозаписи не длиннее этого (ASCII, id мода).
pub const MAX_LAYER_ID: usize = 64;
/// В одном кадре слоёв не больше стольких имён.
const MAX_LAYER_NAMES: usize = 4096;

/// Что запись делает со слоями (кадр 12, `Layers`). Состояние «какие слои
/// включены» не лежит в таблице слоёв: оно сворачивается по этим кадрам с
/// готовых записей стопки, и откат записи возвращает его вместе с файлом.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LayerOp {
    /// Слой, который положила сама запись (запись установки): он включён с неё.
    pub place: Option<String>,
    /// Слои, которые запись включила.
    pub enable: Vec<String>,
    /// Слои, которые запись выключила (тела остаются в файле спящими).
    pub disable: Vec<String>,
    /// Слои, которые запись сняла: тела больше никому не нужны, мусор.
    pub remove: Vec<String>,
}

impl LayerOp {
    /// Запись только переключает слои: ничего не кладёт и не правит чужого.
    pub fn is_toggle(&self) -> bool {
        self.place.is_none()
    }

    /// Все названные слои (для проверок).
    pub fn names(&self) -> impl Iterator<Item = &String> {
        self.place
            .iter()
            .chain(&self.enable)
            .chain(&self.disable)
            .chain(&self.remove)
    }

    /// Итог двух подряд идущих переключений: у слоя побеждает последнее слово.
    pub fn then(&self, later: &LayerOp) -> LayerOp {
        use std::collections::BTreeMap;
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
        enum Word {
            Enable,
            Disable,
            Remove,
        }
        let mut last: BTreeMap<&String, Word> = BTreeMap::new();
        for (word, names) in [
            (Word::Enable, &self.enable),
            (Word::Disable, &self.disable),
            (Word::Remove, &self.remove),
            (Word::Enable, &later.enable),
            (Word::Disable, &later.disable),
            (Word::Remove, &later.remove),
        ] {
            for name in names {
                last.insert(name, word);
            }
        }
        let mut out = LayerOp::default();
        for (name, word) in last {
            match word {
                Word::Enable => out.enable.push(name.clone()),
                Word::Disable => out.disable.push(name.clone()),
                Word::Remove => out.remove.push(name.clone()),
            }
        }
        out
    }
}

impl Begin {
    /// Все области, переписываемые на месте: голова корня и головы вложенных.
    pub fn in_place(&self) -> impl Iterator<Item = RegionRef<'_>> {
        std::iter::once(RegionRef {
            at: 0,
            old: &self.old_head,
            new_sectors: &self.new_sectors,
        })
        .chain(self.regions.iter().map(|region| RegionRef {
            at: region.at,
            old: &region.old,
            new_sectors: &region.new_sectors,
        }))
    }
}

/// Область на месте по ссылке (голова корня лежит в `Begin` отдельными полями).
#[derive(Clone, Copy, Debug)]
pub struct RegionRef<'a> {
    pub at: u64,
    pub old: &'a [u8],
    pub new_sectors: &'a [Digest],
}

/// Кадр журнала.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Entry {
    Base(Base),
    Begin(Begin),
    /// Тела лежат на диске; голова ещё прежняя.
    Synced(u64),
    /// Новая голова на диске и сброшена.
    Done(u64, Stamp),
    /// Запись решено откатить: если процесс оборвётся, откат доводят.
    Undo(u64),
    /// Откат закончен, запись снята со стопки.
    Pop(u64, Stamp),
    /// Файл после операции, которая записи не создаёт (откат, восстановление).
    Stamp(Stamp),
    /// Номера ниже этого уже были: сжатие журнала не должно их вернуть.
    Floor(u64),
    /// Что запись делает со слоями; стоит сразу за кадром начала записи.
    Layers(u64, LayerOp),
}

impl Entry {
    fn kind(&self) -> u8 {
        match self {
            Entry::Base(_) => 1,
            Entry::Begin(_) => 2,
            Entry::Synced(_) => 3,
            Entry::Done(..) => 4,
            Entry::Undo(_) => 5,
            Entry::Pop(..) => 6,
            Entry::Stamp(_) => 7,
            Entry::Floor(_) => 8,
            // 9–11 заняты кадрами открытой записи (часть E3-4)
            Entry::Layers(..) => 12,
        }
    }
}

// ---------------------------------------------------------------------------
// Кодирование
// ---------------------------------------------------------------------------

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

    fn stamp(&mut self, stamp: &Stamp) {
        let (secs, nanos) = stamp.modified.unwrap_or_default();
        let (volume, index) = stamp.identity.unwrap_or_default();
        self.u8(u8::from(stamp.modified.is_some()) | u8::from(stamp.identity.is_some()) << 1);
        self.u64(secs);
        self.u32(nanos);
        self.u64(volume);
        self.u64(index);
    }
}

struct Take<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Take<'a> {
    fn new(bytes: &'a [u8]) -> Take<'a> {
        Take { bytes, at: 0 }
    }

    fn slice(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(len)?;
        let part = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(part)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.slice(1)?[0])
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

    fn stamp(&mut self) -> Option<Stamp> {
        let flags = self.u8()?;
        let (secs, nanos) = (self.u64()?, self.u32()?);
        let (volume, index) = (self.u64()?, self.u64()?);
        Some(Stamp {
            modified: (flags & 1 != 0).then_some((secs, nanos)),
            identity: (flags & 2 != 0).then_some((volume, index)),
        })
    }

    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }
}

fn encode_payload(entry: &Entry) -> Vec<u8> {
    let mut out = Put::default();
    match entry {
        Entry::Base(base) => {
            out.u64(base.len);
            out.u32(base.head_len);
            out.bytes(&base.head_sha);
            out.bytes(&base.digest);
            out.stamp(&base.stamp);
        }
        Entry::Begin(begin) => {
            for value in [begin.seq, begin.old_len, begin.new_len] {
                out.u64(value);
            }
            for digest in [&begin.prev, &begin.after] {
                out.bytes(digest);
            }
            for value in [begin.dead_after, begin.bytes_written, begin.bytes_moved] {
                out.u64(value);
            }
            out.u32(begin.moves.len() as u32);
            for shift in &begin.moves {
                for value in [shift.from, shift.to, shift.len] {
                    out.u64(value);
                }
            }
            let (volume, index) = begin.identity.unwrap_or_default();
            out.u8(u8::from(begin.identity.is_some()));
            out.u64(volume);
            out.u64(index);
            out.u32(begin.anchors.len() as u32);
            for anchor in &begin.anchors {
                out.u64(anchor.from);
                out.u64(anchor.len);
                out.bytes(&anchor.sha);
            }
            out.u32(begin.old_head.len() as u32);
            out.bytes(&begin.old_head);
            out.u32(begin.new_sectors.len() as u32);
            for sector in &begin.new_sectors {
                out.bytes(sector);
            }
            out.u32(begin.regions.len() as u32);
            for region in &begin.regions {
                out.u64(region.at);
                out.u32(region.old.len() as u32);
                out.bytes(&region.old);
                out.u32(region.new_sectors.len() as u32);
                for sector in &region.new_sectors {
                    out.bytes(sector);
                }
            }
            out.u32(begin.fills.len() as u32);
            for fill in &begin.fills {
                out.u64(fill.at);
                out.u64(fill.len);
            }
            out.u32(begin.note.len() as u32);
            out.bytes(&begin.note);
        }
        Entry::Synced(seq) | Entry::Undo(seq) | Entry::Floor(seq) => out.u64(*seq),
        Entry::Done(seq, stamp) | Entry::Pop(seq, stamp) => {
            out.u64(*seq);
            out.stamp(stamp);
        }
        Entry::Stamp(stamp) => out.stamp(stamp),
        Entry::Layers(seq, op) => {
            out.u64(*seq);
            put_name(&mut out, op.place.as_deref().unwrap_or(""));
            out.u8(u8::from(op.place.is_some()));
            for list in [&op.enable, &op.disable, &op.remove] {
                out.u32(list.len() as u32);
                for name in list {
                    put_name(&mut out, name);
                }
            }
        }
    }
    out.0
}

/// Имя слоя: u8 длина и байты.
fn put_name(out: &mut Put, name: &str) {
    out.u8(name.len().min(MAX_LAYER_ID) as u8);
    out.bytes(&name.as_bytes()[..name.len().min(MAX_LAYER_ID)]);
}

fn take_name(take: &mut Take<'_>) -> Option<String> {
    let len = take.u8()? as usize;
    if len > MAX_LAYER_ID {
        return None;
    }
    let text = std::str::from_utf8(take.slice(len)?).ok()?;
    text.is_ascii().then(|| text.to_owned())
}

fn take_names(take: &mut Take<'_>) -> Option<Vec<String>> {
    let count = take.u32()? as usize;
    if count > MAX_LAYER_NAMES {
        return None;
    }
    let mut names = Vec::with_capacity(count.min(64));
    for _ in 0..count {
        names.push(take_name(take)?);
    }
    Some(names)
}

fn decode_payload(kind: u8, payload: &[u8]) -> Option<Entry> {
    let mut take = Take::new(payload);
    let entry = match kind {
        1 => Entry::Base(Base {
            len: take.u64()?,
            head_len: take.u32()?,
            head_sha: take.digest()?,
            digest: take.digest()?,
            stamp: take.stamp()?,
        }),
        2 => {
            let (seq, old_len, new_len) = (take.u64()?, take.u64()?, take.u64()?);
            let (prev, after) = (take.digest()?, take.digest()?);
            let (dead_after, bytes_written, bytes_moved) = (take.u64()?, take.u64()?, take.u64()?);
            let count = take.u32()? as usize;
            let mut moves = Vec::with_capacity(count.min(1 << 16));
            for _ in 0..count {
                moves.push(Moved {
                    from: take.u64()?,
                    to: take.u64()?,
                    len: take.u64()?,
                });
            }
            let known = take.u8()? != 0;
            let (volume, index) = (take.u64()?, take.u64()?);
            let identity = known.then_some((volume, index));
            let count = take.u32()? as usize;
            let mut anchors = Vec::with_capacity(count.min(1 << 10));
            for _ in 0..count {
                anchors.push(Anchor {
                    from: take.u64()?,
                    len: take.u64()?,
                    sha: take.digest()?,
                });
            }
            let head_len = take.u32()? as usize;
            let old_head = take.slice(head_len)?.to_vec();
            let sectors = take.u32()? as usize;
            let mut new_sectors = Vec::with_capacity(sectors.min(1 << 20));
            for _ in 0..sectors {
                new_sectors.push(take.digest()?);
            }
            let count = take.u32()? as usize;
            let mut regions = Vec::with_capacity(count.min(1 << 16));
            for _ in 0..count {
                let at = take.u64()?;
                let old_len = take.u32()? as usize;
                let old = take.slice(old_len)?.to_vec();
                let sectors = take.u32()? as usize;
                let mut new_sectors = Vec::with_capacity(sectors.min(1 << 20));
                for _ in 0..sectors {
                    new_sectors.push(take.digest()?);
                }
                regions.push(Region {
                    at,
                    old,
                    new_sectors,
                });
            }
            let count = take.u32()? as usize;
            let mut fills = Vec::with_capacity(count.min(1 << 16));
            for _ in 0..count {
                fills.push(Fill {
                    at: take.u64()?,
                    len: take.u64()?,
                });
            }
            // пометка вызывающего стоит в самом конце; у кадров, записанных до
            // неё, её нет
            let note = if take.done() {
                Vec::new()
            } else {
                let len = take.u32()? as usize;
                if len > MAX_NOTE {
                    return None;
                }
                take.slice(len)?.to_vec()
            };
            Entry::Begin(Begin {
                seq,
                old_len,
                new_len,
                prev,
                after,
                dead_after,
                bytes_written,
                bytes_moved,
                moves,
                identity,
                anchors,
                old_head,
                new_sectors,
                regions,
                fills,
                note,
            })
        }
        3 => Entry::Synced(take.u64()?),
        4 => Entry::Done(take.u64()?, take.stamp()?),
        5 => Entry::Undo(take.u64()?),
        6 => Entry::Pop(take.u64()?, take.stamp()?),
        7 => Entry::Stamp(take.stamp()?),
        8 => Entry::Floor(take.u64()?),
        12 => {
            let seq = take.u64()?;
            let first = take_name(&mut take)?;
            let placed = take.u8()? != 0;
            let (enable, disable, remove) = (
                take_names(&mut take)?,
                take_names(&mut take)?,
                take_names(&mut take)?,
            );
            Entry::Layers(
                seq,
                LayerOp {
                    place: placed.then_some(first),
                    enable,
                    disable,
                    remove,
                },
            )
        }
        _ => return None,
    };
    take.done().then_some(entry)
}

fn crc_of(bytes: &[u8]) -> u32 {
    let mut crc = Crc::new();
    crc.update(bytes);
    crc.sum()
}

/// Кадр целиком: заголовок, полезная часть, контрольная сумма.
pub fn encode_frame(entry: &Entry) -> Vec<u8> {
    let payload = encode_payload(entry);
    let mut frame = Vec::with_capacity(FRAME_HEAD_LEN + payload.len() + FRAME_TAIL_LEN);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.push(entry.kind());
    frame.push(FRAME_VERSION);
    frame.extend_from_slice(&[0, 0]);
    frame.extend_from_slice(&payload);
    let crc = crc_of(&frame);
    frame.extend_from_slice(&crc.to_le_bytes());
    frame
}

fn file_header() -> [u8; FILE_HEADER_LEN] {
    let mut head = [0u8; FILE_HEADER_LEN];
    head[..8].copy_from_slice(&FILE_MAGIC);
    head[8..12].copy_from_slice(&FORMAT_VERSION.to_le_bytes());
    head
}

/// Что вышло из попытки прочитать кадр.
enum Read1 {
    Frame(Box<Entry>, usize),
    /// Кадра нет: байты кончились раньше, чем он.
    Short,
    /// Кадр на месте, но не годится (сумма, вид, разбор). `usize` — его длина,
    /// если ей можно верить.
    Bad(Option<usize>),
}

fn read_frame(bytes: &[u8], at: usize) -> Read1 {
    let left = bytes.len() - at;
    if left < FRAME_HEAD_LEN {
        return Read1::Short;
    }
    let len = u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as u64;
    if len > MAX_PAYLOAD {
        return Read1::Bad(None);
    }
    let total = FRAME_HEAD_LEN + len as usize + FRAME_TAIL_LEN;
    if left < total {
        return Read1::Short;
    }
    let frame = &bytes[at..at + total];
    let (body, tail) = frame.split_at(total - FRAME_TAIL_LEN);
    let stored = u32::from_le_bytes([tail[0], tail[1], tail[2], tail[3]]);
    if stored != crc_of(body) || body[5] != FRAME_VERSION || body[6] != 0 || body[7] != 0 {
        return Read1::Bad(Some(total));
    }
    match decode_payload(body[4], &body[FRAME_HEAD_LEN..]) {
        Some(entry) => Read1::Frame(Box::new(entry), total),
        None => Read1::Bad(Some(total)),
    }
}

// ---------------------------------------------------------------------------
// Состояние по кадрам
// ---------------------------------------------------------------------------

/// Где запись в своём пути.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Журнал записан; тела могут лежать не до конца, голова прежняя.
    Begun,
    /// Тела на диске; голова прежняя или пишется.
    Synced,
    /// Новая голова на диске.
    Done,
    /// Откат начат.
    Undoing,
}

/// Запись на стопке.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub begin: Begin,
    pub phase: Phase,
    /// Сколько байт файла журнала занимают её кадры.
    pub bytes: u64,
}

/// Журнал, прочитанный проходом по кадрам.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Replay {
    pub base: Option<Base>,
    pub records: Vec<Record>,
    /// Последний отпечаток файла (база, «готово», откат).
    pub stamp: Option<Stamp>,
    /// Номер, который получит следующая запись.
    pub next_seq: u64,
    /// Сколько байт файла журнала годны (с заголовком файла).
    pub valid_len: u64,
    /// Хвост после годных байт отброшен как оборванный.
    pub torn: bool,
    /// Длина файла журнала, как он лежит.
    pub file_len: u64,
    /// Байты кадров, которые уже ничего не значат (снятые записи, прежние
    /// отпечатки): сжатие журнала убирает их.
    pub dead_bytes: u64,
    /// Что записи стопки делают со слоями (кадры 12), по номерам записей. У записей
    /// без слоёв строки нет.
    pub layer_ops: Vec<(u64, LayerOp)>,
    frames: u64,
}

impl Replay {
    /// Запись на вершине стопки.
    pub fn top(&self) -> Option<&Record> {
        self.records.last()
    }

    /// Что запись `seq` делает со слоями.
    pub fn layer_op(&self, seq: u64) -> Option<&LayerOp> {
        self.layer_ops
            .iter()
            .find(|(at, _)| *at == seq)
            .map(|(_, op)| op)
    }

    /// Журнал без единого кадра (файла нет или он пуст).
    pub fn is_blank(&self) -> bool {
        self.frames == 0
    }

    /// Кадр применяется к состоянию; несуразная очередь кадров — отказ.
    pub fn apply(&mut self, entry: Entry, frame_len: u64) -> Result<(), AppendError> {
        let first = self.frames == 0;
        self.frames += 1;
        self.valid_len += frame_len;
        match entry {
            Entry::Base(base) => {
                if !first {
                    return Err(damaged("The journal has a second chain base."));
                }
                self.stamp = Some(base.stamp.clone());
                self.base = Some(base);
            }
            Entry::Floor(next) => {
                self.next_seq = self.next_seq.max(next);
            }
            Entry::Begin(begin) => {
                if self
                    .records
                    .last()
                    .is_some_and(|top| top.phase != Phase::Done)
                {
                    return Err(damaged("A journal record starts over an unfinished one."));
                }
                if begin.seq < self.next_seq {
                    return Err(damaged("A journal record number goes back."));
                }
                self.next_seq = begin.seq + 1;
                self.records.push(Record {
                    begin,
                    phase: Phase::Begun,
                    bytes: frame_len,
                });
            }
            Entry::Synced(seq) => {
                let top = self.top_of(seq, &[Phase::Begun])?;
                top.phase = Phase::Synced;
                top.bytes += frame_len;
            }
            Entry::Done(seq, stamp) => {
                let top = self.top_of(seq, &[Phase::Synced])?;
                top.phase = Phase::Done;
                top.bytes += frame_len;
                self.stamp = Some(stamp);
            }
            Entry::Undo(seq) => {
                let top = self.top_of(
                    seq,
                    &[Phase::Begun, Phase::Synced, Phase::Done, Phase::Undoing],
                )?;
                top.phase = Phase::Undoing;
                top.bytes += frame_len;
            }
            Entry::Pop(seq, stamp) => {
                self.top_of(seq, &[Phase::Undoing])?;
                if let Some(gone) = self.records.pop() {
                    self.dead_bytes += gone.bytes + frame_len;
                }
                self.layer_ops.retain(|(at, _)| *at != seq);
                self.stamp = Some(stamp);
            }
            Entry::Layers(seq, op) => {
                if self.layer_ops.iter().any(|(at, _)| *at == seq) {
                    return Err(damaged("A journal record names its layers twice."));
                }
                let top = self.top_of(seq, &[Phase::Begun])?;
                top.bytes += frame_len;
                self.layer_ops.push((seq, op));
            }
            Entry::Stamp(stamp) => {
                if self.stamp.is_some() {
                    self.dead_bytes += frame_len;
                }
                self.stamp = Some(stamp);
            }
        }
        Ok(())
    }

    fn top_of(&mut self, seq: u64, phases: &[Phase]) -> Result<&mut Record, AppendError> {
        match self.records.last_mut() {
            Some(top) if top.begin.seq == seq && phases.contains(&top.phase) => Ok(top),
            _ => Err(damaged("A journal mark does not fit the record it names.")),
        }
    }

    fn blank_at(file_len: u64) -> Replay {
        Replay {
            file_len,
            ..Replay::default()
        }
    }
}

/// Разбор файла журнала по байтам. `None` — файла нет.
fn replay_bytes(bytes: &[u8]) -> Result<Replay, AppendError> {
    let mut replay = Replay::blank_at(bytes.len() as u64);
    if bytes.len() < FILE_HEADER_LEN {
        // файл только создан, заголовок записан не весь: журнала ещё нет
        return if file_header().starts_with(bytes) {
            replay.torn = !bytes.is_empty();
            Ok(replay)
        } else {
            Err(damaged("The journal file is not an Astral journal."))
        };
    }
    if bytes[..8] != FILE_MAGIC {
        return Err(damaged("The journal file is not an Astral journal."));
    }
    let version = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    if version != FORMAT_VERSION {
        return Err(damaged("The journal has an unsupported format version."));
    }
    replay.valid_len = FILE_HEADER_LEN as u64;
    let mut at = FILE_HEADER_LEN;
    while at < bytes.len() {
        match read_frame(bytes, at) {
            Read1::Frame(entry, len) => {
                replay.apply(*entry, len as u64)?;
                at += len;
            }
            Read1::Short => {
                replay.torn = true;
                break;
            }
            Read1::Bad(size) => {
                // кадр с неверной суммой в самом хвосте — оборванная запись;
                // если за ним идёт годный кадр, журнал испорчен посреди
                let behind = size.map(|len| at + len).filter(|&next| next < bytes.len());
                if behind.is_some_and(|next| matches!(read_frame(bytes, next), Read1::Frame(..))) {
                    return Err(damaged("A journal frame in the middle is damaged."));
                }
                replay.torn = true;
                break;
            }
        }
    }
    Ok(replay)
}

/// Читает журнал, ничего не меняя. `None` — файла нет.
pub fn read(path: &Path) -> Result<Option<Replay>, AppendError> {
    let mut bytes = Vec::new();
    match File::open(path) {
        Ok(mut file) => file.read_to_end(&mut bytes)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    replay_bytes(&bytes).map(Some)
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

/// Сбрасывает на диск и запись имени файла в папке (там, где это можно).
fn sync_folder(path: &Path) {
    #[cfg(unix)]
    if let Some(folder) = path.parent() {
        if let Ok(handle) = File::open(folder) {
            let _ = handle.sync_all();
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Дописывает кадры в конец годной части журнала и сбрасывает файл на диск.
/// Оборванный хвост, если он был, отрезается. Состояние `replay` обновляется
/// только после того, как кадры легли на диск.
pub fn append(path: &Path, replay: &mut Replay, entries: Vec<Entry>) -> Result<(), AppendError> {
    let mut frames = Vec::new();
    let mut lens = Vec::with_capacity(entries.len());
    for entry in &entries {
        let frame = encode_frame(entry);
        lens.push(frame.len() as u64);
        frames.extend_from_slice(&frame);
    }
    let created = replay.valid_len == 0;
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    let on_disk = file.metadata()?.len();
    if created {
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(&file_header())?;
        replay.valid_len = FILE_HEADER_LEN as u64;
    } else if on_disk < replay.valid_len {
        return Err(damaged("The journal file became shorter than it was read."));
    } else if on_disk > replay.valid_len {
        file.set_len(replay.valid_len)?;
    }
    file.seek(SeekFrom::Start(replay.valid_len))?;
    file.write_all(&frames)?;
    file.sync_all()?;
    drop(file);
    if created {
        sync_folder(path);
    }
    replay.torn = false;
    // кадры, уже лежащие на диске, применяются к состоянию
    let mut applied = Replay {
        valid_len: replay.valid_len,
        ..replay.clone()
    };
    for (entry, len) in entries.into_iter().zip(lens) {
        applied.apply(entry, len)?;
    }
    applied.file_len = applied.valid_len;
    *replay = applied;
    Ok(())
}

/// Переписывает журнал без мёртвых кадров: база, живые записи с их отметками,
/// отпечаток файла, нижняя граница номеров. Новый файл встаёт на место
/// переименованием: в любой миг лежит или прежний, или новый целый журнал.
pub fn compact(path: &Path, replay: &mut Replay) -> Result<(), AppendError> {
    compact_with(path, replay, &|_| {})
}

/// То же с точкой обрыва для стендов: `hit` зовётся, когда новый файл уже лежит
/// рядом на диске, а переименования ещё не было.
pub fn compact_with(
    path: &Path,
    replay: &mut Replay,
    hit: &dyn Fn(&str),
) -> Result<(), AppendError> {
    let mut fresh = Replay::default();
    let mut frames = file_header().to_vec();
    let mut put = |entry: Entry, fresh: &mut Replay| -> Result<(), AppendError> {
        let frame = encode_frame(&entry);
        frames.extend_from_slice(&frame);
        fresh.apply(entry, frame.len() as u64)
    };
    fresh.valid_len = FILE_HEADER_LEN as u64;
    if let Some(base) = &replay.base {
        put(Entry::Base(base.clone()), &mut fresh)?;
    }
    let mut last_stamp = replay.base.as_ref().map(|base| base.stamp.clone());
    for record in &replay.records {
        let seq = record.begin.seq;
        put(Entry::Begin(record.begin.clone()), &mut fresh)?;
        if let Some(op) = replay.layer_op(seq) {
            put(Entry::Layers(seq, op.clone()), &mut fresh)?;
        }
        if matches!(record.phase, Phase::Synced | Phase::Done | Phase::Undoing) {
            put(Entry::Synced(seq), &mut fresh)?;
        }
        if record.phase == Phase::Done {
            // отпечаток «готово» записи, которая не на вершине, уже заменён
            // более поздним; берём общий
            let stamp = replay.stamp.clone().unwrap_or_default();
            put(Entry::Done(seq, stamp.clone()), &mut fresh)?;
            last_stamp = Some(stamp);
        }
        if record.phase == Phase::Undoing {
            put(Entry::Undo(seq), &mut fresh)?;
        }
    }
    put(Entry::Floor(replay.next_seq), &mut fresh)?;
    if let Some(stamp) = replay.stamp.clone() {
        if last_stamp.as_ref() != Some(&stamp) {
            put(Entry::Stamp(stamp), &mut fresh)?;
        }
    }
    let temporary = {
        let mut name = path.as_os_str().to_owned();
        name.push(".tmp");
        PathBuf::from(name)
    };
    let written = (|| -> io::Result<()> {
        let mut file = File::create(&temporary)?;
        file.write_all(&frames)?;
        file.sync_all()
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    hit("journal-after-temp");
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    sync_folder(path);
    fresh.file_len = fresh.valid_len;
    fresh.dead_bytes = 0;
    *replay = fresh;
    Ok(())
}

/// Две последние готовые записи стопки становятся одной: `merged` — её начало
/// (номер и прежние байты — самой ранней из двух, отпечаток и секторы — поздней),
/// `op` — итог их слоёв. Журнал переписывается целиком во временный файл и встаёт
/// на место переименованием: в любой миг лежит или прежний, или новый целый журнал,
/// и оба описывают тот же архив. Номера не откатываются (`Floor`).
pub fn merge_top_two(
    path: &Path,
    replay: &mut Replay,
    merged: Begin,
    op: LayerOp,
    hit: &dyn Fn(&str),
) -> Result<(), AppendError> {
    let mut next = replay.clone();
    let (Some(top), Some(under)) = (next.records.pop(), next.records.pop()) else {
        return Err(damaged("A merge needs two records on the stack."));
    };
    let gone = [top.begin.seq, under.begin.seq];
    next.layer_ops.retain(|(at, _)| !gone.contains(at));
    next.layer_ops.push((merged.seq, op));
    next.records.push(Record {
        begin: merged,
        phase: Phase::Done,
        bytes: top.bytes,
    });
    compact_with(path, &mut next, hit)?;
    *replay = next;
    Ok(())
}

/// Убирает файл журнала (и недописанный временный); нет файла — не отказ.
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

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(second: u64) -> Stamp {
        Stamp {
            modified: Some((second, 5)),
            identity: Some((1, 2)),
        }
    }

    fn begin(seq: u64) -> Begin {
        Begin {
            seq,
            old_len: 100,
            new_len: 200,
            prev: [1; 32],
            after: [2; 32],
            dead_after: 7,
            bytes_written: 11,
            bytes_moved: 5,
            moves: vec![Moved {
                from: 1,
                to: 2,
                len: 3,
            }],
            identity: Some((4, 5)),
            anchors: vec![
                Anchor {
                    from: 60,
                    len: 40,
                    sha: [3; 32],
                },
                Anchor {
                    from: 10,
                    len: 7,
                    sha: [6; 32],
                },
            ],
            old_head: vec![9; 40],
            new_sectors: vec![[4; 32], [5; 32]],
            regions: vec![Region {
                at: 1024,
                old: vec![7; 700],
                new_sectors: vec![[1; 32], [2; 32]],
            }],
            fills: vec![Fill { at: 4096, len: 99 }],
            note: b"C:\\store\\recipes\\update.json".to_vec(),
        }
    }

    fn base() -> Base {
        Base {
            len: 100,
            head_sha: [8; 32],
            head_len: 40,
            digest: [6; 32],
            stamp: stamp(1),
        }
    }

    fn journal_of(entries: &[Entry]) -> Vec<u8> {
        let mut bytes = file_header().to_vec();
        for entry in entries {
            bytes.extend_from_slice(&encode_frame(entry));
        }
        bytes
    }

    #[test]
    fn every_kind_of_frame_round_trips() {
        let all = [
            Entry::Base(base()),
            Entry::Begin(begin(3)),
            Entry::Synced(3),
            Entry::Done(3, stamp(9)),
            Entry::Undo(3),
            Entry::Pop(3, Stamp::default()),
            Entry::Stamp(stamp(4)),
            Entry::Floor(77),
        ];
        for entry in all {
            let frame = encode_frame(&entry);
            match read_frame(&frame, 0) {
                Read1::Frame(back, len) => {
                    assert_eq!(*back, entry);
                    assert_eq!(len, frame.len());
                }
                _ => panic!("кадр {entry:?} не прочитался"),
            }
        }
    }

    /// Кадр записи так, как его писали до пометки: полезная часть без хвоста.
    fn frame_without_note(mut record: Begin) -> Vec<u8> {
        record.note = Vec::new();
        let mut payload = encode_payload(&Entry::Begin(record));
        payload.truncate(payload.len() - 4);
        let mut frame = Vec::new();
        frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        frame.extend_from_slice(&[2, FRAME_VERSION, 0, 0]);
        frame.extend_from_slice(&payload);
        let crc = crc_of(&frame);
        frame.extend_from_slice(&crc.to_le_bytes());
        frame
    }

    #[test]
    fn a_record_frame_written_before_the_note_still_reads_with_an_empty_note() {
        let frame = frame_without_note(begin(4));
        let mut expected = begin(4);
        expected.note = Vec::new();
        match read_frame(&frame, 0) {
            Read1::Frame(back, len) => {
                assert_eq!(*back, Entry::Begin(expected));
                assert_eq!(len, frame.len());
            }
            _ => panic!("старый кадр не прочитался"),
        }
    }

    #[test]
    fn a_note_longer_than_the_limit_is_a_bad_frame_and_the_note_survives_a_round_trip() {
        let mut long = begin(1);
        long.note = vec![b'x'; MAX_NOTE + 1];
        assert!(matches!(
            read_frame(&encode_frame(&Entry::Begin(long)), 0),
            Read1::Bad(_)
        ));
        let mut edge = begin(2);
        edge.note = vec![b'y'; MAX_NOTE];
        match read_frame(&encode_frame(&Entry::Begin(edge.clone())), 0) {
            Read1::Frame(back, _) => assert_eq!(*back, Entry::Begin(edge)),
            _ => panic!("кадр с пометкой в предел не прочитался"),
        }
    }

    #[test]
    fn a_stack_of_records_is_replayed_in_order() {
        let bytes = journal_of(&[
            Entry::Base(base()),
            Entry::Begin(begin(0)),
            Entry::Synced(0),
            Entry::Done(0, stamp(2)),
            Entry::Begin(begin(1)),
        ]);
        let replay = replay_bytes(&bytes).unwrap();
        assert_eq!(replay.records.len(), 2);
        assert_eq!(replay.records[0].phase, Phase::Done);
        assert_eq!(replay.records[1].phase, Phase::Begun);
        assert_eq!(replay.next_seq, 2);
        assert_eq!(replay.stamp, Some(stamp(2)));
        assert!(!replay.torn);
        assert_eq!(replay.valid_len, bytes.len() as u64);
    }

    #[test]
    fn a_popped_record_leaves_the_stack_and_its_number_is_not_reused() {
        let bytes = journal_of(&[
            Entry::Base(base()),
            Entry::Begin(begin(0)),
            Entry::Synced(0),
            Entry::Done(0, stamp(2)),
            Entry::Undo(0),
            Entry::Pop(0, stamp(3)),
        ]);
        let replay = replay_bytes(&bytes).unwrap();
        assert!(replay.records.is_empty());
        assert_eq!(replay.next_seq, 1);
        assert_eq!(replay.stamp, Some(stamp(3)));
        assert!(replay.dead_bytes > 0);
    }

    #[test]
    fn every_cut_of_the_last_frame_is_a_torn_tail_and_never_an_error() {
        let full = journal_of(&[Entry::Base(base()), Entry::Begin(begin(0))]);
        let keep = journal_of(&[Entry::Base(base())]).len();
        for cut in keep..full.len() {
            let replay = replay_bytes(&full[..cut]).unwrap();
            assert!(replay.records.is_empty(), "cut {cut}");
            assert_eq!(replay.valid_len, keep as u64, "cut {cut}");
            assert_eq!(replay.torn, cut > keep, "cut {cut}");
        }
    }

    #[test]
    fn a_bad_checksum_in_the_last_frame_is_a_torn_tail() {
        let mut bytes = journal_of(&[Entry::Base(base()), Entry::Begin(begin(0))]);
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        let replay = replay_bytes(&bytes).unwrap();
        assert!(replay.records.is_empty());
        assert!(replay.torn);
    }

    #[test]
    fn a_damaged_frame_in_the_middle_is_a_refusal() {
        let mut bytes = journal_of(&[
            Entry::Base(base()),
            Entry::Begin(begin(0)),
            Entry::Synced(0),
        ]);
        let begin_at = FILE_HEADER_LEN + encode_frame(&Entry::Base(base())).len();
        bytes[begin_at + 20] ^= 0x01;
        match replay_bytes(&bytes) {
            Err(AppendError::Refused { code, .. }) => assert_eq!(code, Code::JournalDamaged),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_mark_that_does_not_fit_its_record_is_a_refusal() {
        for entries in [
            vec![Entry::Base(base()), Entry::Synced(0)],
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Done(0, stamp(1)),
            ],
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Begin(begin(1)),
            ],
            vec![Entry::Base(base()), Entry::Pop(0, stamp(1))],
            vec![Entry::Base(base()), Entry::Base(base())],
        ] {
            assert!(
                matches!(
                    replay_bytes(&journal_of(&entries)),
                    Err(AppendError::Refused { .. })
                ),
                "{entries:?}"
            );
        }
    }

    #[test]
    fn a_file_that_is_not_a_journal_is_a_refusal_and_a_cut_header_is_not() {
        assert!(replay_bytes(b"MZ\x90\x00 not a journal at all").is_err());
        let header = file_header();
        for cut in 0..FILE_HEADER_LEN {
            let replay = replay_bytes(&header[..cut]).unwrap();
            assert!(replay.is_blank());
        }
    }

    #[test]
    fn compaction_keeps_the_live_stack_and_drops_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.rpf.astral-journal");
        let mut replay = Replay::default();
        append(
            &path,
            &mut replay,
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Synced(0),
                Entry::Done(0, stamp(2)),
                Entry::Begin(begin(1)),
                Entry::Synced(1),
                Entry::Done(1, stamp(3)),
                Entry::Undo(1),
                Entry::Pop(1, stamp(4)),
            ],
        )
        .unwrap();
        let before = fs::metadata(&path).unwrap().len();
        compact(&path, &mut replay).unwrap();
        let after = fs::metadata(&path).unwrap().len();
        assert!(after < before);
        let again = read(&path).unwrap().unwrap();
        assert_eq!(again.records.len(), 1);
        assert_eq!(again.records[0].begin.seq, 0);
        assert_eq!(again.records[0].phase, Phase::Done);
        assert_eq!(again.next_seq, 2);
        assert_eq!(again.stamp, Some(stamp(4)));
        assert_eq!(again.dead_bytes, 0);
        assert_eq!(replay.records, again.records);
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
    fn a_layers_frame_round_trips_and_belongs_to_the_record_it_follows() {
        let whole = op(Some("mod-1"), &["a"], &["b", "c"], &["d"]);
        let frame = encode_frame(&Entry::Layers(3, whole.clone()));
        match read_frame(&frame, 0) {
            Read1::Frame(back, len) => {
                assert_eq!(*back, Entry::Layers(3, whole.clone()));
                assert_eq!(len, frame.len());
            }
            _ => panic!("кадр слоёв не прочитался"),
        }
        let bytes = journal_of(&[
            Entry::Base(base()),
            Entry::Begin(begin(0)),
            Entry::Layers(0, whole.clone()),
            Entry::Synced(0),
            Entry::Done(0, stamp(2)),
            Entry::Begin(begin(1)),
        ]);
        let replay = replay_bytes(&bytes).unwrap();
        assert_eq!(replay.layer_op(0), Some(&whole));
        assert_eq!(replay.layer_op(1), None, "у записи без слоёв строки нет");
        // кадр слоёв чужой записи или второй раз — порча, гадать нельзя
        for entries in [
            vec![Entry::Base(base()), Entry::Layers(0, whole.clone())],
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Layers(5, whole.clone()),
            ],
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Layers(0, whole.clone()),
                Entry::Layers(0, whole.clone()),
            ],
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Synced(0),
                Entry::Layers(0, whole.clone()),
            ],
        ] {
            assert!(
                matches!(
                    replay_bytes(&journal_of(&entries)),
                    Err(AppendError::Refused { .. })
                ),
                "{entries:?}"
            );
        }
        // порча одного байта кадра слоёв — порча кадра
        let mut broken = encode_frame(&Entry::Layers(0, whole));
        broken[10] ^= 0x01;
        assert!(matches!(read_frame(&broken, 0), Read1::Bad(_)));
    }

    #[test]
    fn the_layers_of_two_switches_fold_to_the_last_word_for_each_layer() {
        let first = op(None, &["a", "b"], &["c"], &[]);
        let second = op(None, &[], &["a"], &["c"]);
        let both = first.then(&second);
        assert_eq!(both.enable, vec!["b".to_owned()]);
        assert_eq!(both.disable, vec!["a".to_owned()]);
        assert_eq!(both.remove, vec!["c".to_owned()]);
        assert!(both.is_toggle());
        assert!(!op(Some("x"), &[], &[], &[]).is_toggle());
    }

    #[test]
    fn a_popped_record_takes_its_layers_with_it_and_compaction_keeps_the_live_ones() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.rpf.astral-journal");
        let mut replay = Replay::default();
        let keep = op(Some("keep"), &[], &[], &[]);
        let drop_it = op(None, &[], &["keep"], &[]);
        append(
            &path,
            &mut replay,
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Layers(0, keep.clone()),
                Entry::Synced(0),
                Entry::Done(0, stamp(2)),
                Entry::Begin(begin(1)),
                Entry::Layers(1, drop_it),
                Entry::Synced(1),
                Entry::Done(1, stamp(3)),
                Entry::Undo(1),
                Entry::Pop(1, stamp(4)),
            ],
        )
        .unwrap();
        assert_eq!(replay.layer_op(1), None);
        compact(&path, &mut replay).unwrap();
        let again = read(&path).unwrap().unwrap();
        assert_eq!(again.layer_op(0), Some(&keep));
        assert_eq!(again.layer_ops.len(), 1);
        assert_eq!(again, replay);
    }

    #[test]
    fn merging_the_two_top_records_leaves_one_and_the_journal_reads_back_the_same() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.rpf.astral-journal");
        let mut replay = Replay::default();
        let mut entries = vec![Entry::Base(base())];
        for (seq, layers) in [
            (0u64, op(Some("l"), &[], &[], &[])),
            (1, op(None, &[], &["l"], &[])),
            (2, op(None, &["l"], &[], &[])),
        ] {
            entries.extend([
                Entry::Begin(begin(seq)),
                Entry::Layers(seq, layers),
                Entry::Synced(seq),
                Entry::Done(seq, stamp(2 + seq)),
            ]);
        }
        append(&path, &mut replay, entries).unwrap();
        let mut merged = begin(1);
        merged.after = [9; 32];
        let points = std::cell::RefCell::new(Vec::new());
        merge_top_two(
            &path,
            &mut replay,
            merged.clone(),
            op(None, &["l"], &[], &[]),
            &|point| points.borrow_mut().push(point.to_owned()),
        )
        .unwrap();
        assert_eq!(*points.borrow(), vec!["journal-after-temp".to_owned()]);
        assert_eq!(replay.records.len(), 2);
        assert_eq!(replay.records[1].begin, merged);
        assert_eq!(replay.records[1].phase, Phase::Done);
        assert_eq!(replay.layer_ops.len(), 2);
        assert_eq!(replay.next_seq, 3, "номера не откатываются");
        let again = read(&path).unwrap().unwrap();
        assert_eq!(again.records, replay.records);
        assert_eq!(again.layer_ops, replay.layer_ops);
        assert_eq!(again.next_seq, 3);
        assert_eq!(again.stamp, replay.stamp);
        // одной записи для слияния мало
        let mut single = Replay::default();
        let single_path = dir.path().join("b.astral-journal");
        append(
            &single_path,
            &mut single,
            vec![
                Entry::Base(base()),
                Entry::Begin(begin(0)),
                Entry::Synced(0),
                Entry::Done(0, stamp(2)),
            ],
        )
        .unwrap();
        assert!(merge_top_two(
            &single_path,
            &mut single,
            begin(0),
            LayerOp::default(),
            &|_| {}
        )
        .is_err());
    }

    #[test]
    fn appending_cuts_a_torn_tail_first() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.rpf.astral-journal");
        let mut replay = Replay::default();
        append(&path, &mut replay, vec![Entry::Base(base())]).unwrap();
        // хвост-обрывок
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(&encode_frame(&Entry::Begin(begin(0)))[..30])
            .unwrap();
        drop(file);
        let mut seen = read(&path).unwrap().unwrap();
        assert!(seen.torn);
        append(&path, &mut seen, vec![Entry::Begin(begin(0))]).unwrap();
        let after = read(&path).unwrap().unwrap();
        assert!(!after.torn);
        assert_eq!(after.records.len(), 1);
    }
}
