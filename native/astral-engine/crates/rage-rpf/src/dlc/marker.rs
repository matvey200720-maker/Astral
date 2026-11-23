//! Маркер недостроенного нового архива: файл `<архив>.astral-building`.
//!
//! Рядом с недостроенным файлом (`<архив>.astral-part`) лежит маркер: что за
//! сборка (хэш плана, длина, имя архива), чей это файл (номер файла на томе) и
//! какие тела уже легли и сброшены на диск (их SHA-256 по месту). Маркер только
//! дописывается кадрами с контрольной суммой, как журнал дозаписи: кадр пишется
//! одним вызовом и сразу сбрасывается на диск. Оборванный хвост отбрасывается
//! при чтении; испорченный кадр посреди — `BuildDamaged`, гадать нельзя.
//!
//! Файл: 16 байт (`ASTRBLD1`, версия формата, нули), дальше кадры:
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
//! Виды: 1 начало сборки, 2 файл создан (номер файла), 3 тела легли, 4 голова
//! пишется, 5 архив запечатан, 6 тела легли с длинами (сборка «следом», `follow`:
//! размеры приходят по ходу, и маркер хранит их вместе с SHA-256).

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
};

use flate2::Crc;

use crate::{
    append::{AppendError, Code},
    journal::Digest,
};

const FILE_MAGIC: [u8; 8] = *b"ASTRBLD1";
const FORMAT_VERSION: u32 = 1;
const FILE_HEADER_LEN: usize = 16;
const FRAME_VERSION: u8 = 1;
const FRAME_HEAD_LEN: usize = 8;
const FRAME_TAIL_LEN: usize = 4;
/// Полезная часть длиннее этого не бывает (кадр «тела легли» с сотней тысяч записей).
const MAX_PAYLOAD: u64 = 1 << 28;

fn damaged(text: impl Into<String>) -> AppendError {
    AppendError::refused(Code::BuildDamaged, text)
}

/// Начало сборки: что строится.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Begin {
    /// Хэш плана: имя архива, записи, их виды, длины, слова и ожидаемые SHA-256.
    pub plan_hash: Digest,
    /// Длина готового файла и длина головы.
    pub total: u64,
    pub head_len: u64,
    /// Число файлов (записей с телами).
    pub files: u32,
    /// Имя архива, по которому выбирается ключ шифра оглавления.
    pub name: String,
    /// Слова всех ресурсов были названы заранее.
    pub words_known: bool,
    /// Сборка «следом» (`follow`): длины тел приходят по ходу, длина файла в
    /// начале неизвестна (`total` нуль), тела описывают кадры вида 6.
    pub follow: bool,
    /// Когда сборка началась, миллисекунды от начала эпохи.
    pub created_ms: u64,
}

/// Недостроенный файл создан; номер файла на томе, если хозяин его знает.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PartId {
    pub identity: Option<(u64, u64)>,
}

/// Тело, которое легло целиком и сброшено на диск.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Laid {
    /// Номер в порядке записи тел.
    pub pos: u32,
    /// SHA-256 тела так, как оно лежит в файле.
    pub sha: Digest,
    /// Слова ресурса (`system`, `graphics`) из первых 16 байт.
    pub words: Option<(u32, u32)>,
}

/// Голова пишется: все тела на месте.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sealing {
    /// SHA-256 головы, которая ляжет в файл.
    pub head_sha: Digest,
    /// SHA-256 всего файла, если он считался по ходу записи.
    pub digest: Option<Digest>,
}

/// Архив проверен; дальше только переименование.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sealed {
    pub sha: Digest,
    pub len: u64,
}

/// Кадр маркера.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Frame {
    Begin(Begin),
    Part(PartId),
    Laid(Vec<Laid>),
    /// Тела сборки «следом»: то же, что `Laid`, плюс длина каждого тела.
    LaidSized(Vec<(Laid, u64)>),
    Sealing(Sealing),
    Sealed(Sealed),
}

impl Frame {
    fn kind(&self) -> u8 {
        match self {
            Frame::Begin(_) => 1,
            Frame::Part(_) => 2,
            Frame::Laid(_) => 3,
            Frame::LaidSized(_) => 6,
            Frame::Sealing(_) => 4,
            Frame::Sealed(_) => 5,
        }
    }
}

/// Маркер, прочитанный проходом по кадрам.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct State {
    pub begin: Option<Begin>,
    pub part: Option<PartId>,
    pub laid: Vec<Laid>,
    /// Длины лёгших тел (только у сборки «следом», по одной на каждое `laid`).
    pub lens: Vec<u64>,
    pub sealing: Option<Sealing>,
    pub sealed: Option<Sealed>,
    /// Сколько байт файла годны (с заголовком файла).
    pub valid_len: u64,
    /// Оборванный хвост отброшен.
    pub torn: bool,
}

impl State {
    /// Кадр применяется к состоянию; несуразная очередь кадров — отказ.
    pub fn apply(&mut self, frame: Frame) -> Result<(), AppendError> {
        match frame {
            Frame::Begin(begin) => {
                if self.begin.is_some() {
                    return Err(damaged("The marker has a second begin."));
                }
                self.begin = Some(begin);
            }
            Frame::Part(part) => {
                if self.begin.is_none() || self.part.is_some() {
                    return Err(damaged("A marker frame about the file is out of place."));
                }
                self.part = Some(part);
            }
            Frame::Laid(rows) => {
                let Some(begin) = &self.begin else {
                    return Err(damaged("A marker frame is out of place."));
                };
                if begin.follow {
                    return Err(damaged("A marker of a following build has a frame without lengths."));
                }
                for row in rows {
                    if row.pos as usize != self.laid.len() || row.pos >= begin.files {
                        return Err(damaged("A laid body in the marker is out of order."));
                    }
                    self.laid.push(row);
                }
            }
            Frame::LaidSized(rows) => {
                let Some(begin) = &self.begin else {
                    return Err(damaged("A marker frame is out of place."));
                };
                if !begin.follow {
                    return Err(damaged("A marker frame with lengths is out of place."));
                }
                for (row, len) in rows {
                    if row.pos as usize != self.laid.len() || row.pos >= begin.files {
                        return Err(damaged("A laid body in the marker is out of order."));
                    }
                    self.laid.push(row);
                    self.lens.push(len);
                }
            }
            Frame::Sealing(sealing) => {
                let all = self
                    .begin
                    .as_ref()
                    .is_some_and(|begin| self.laid.len() == begin.files as usize);
                if !all {
                    return Err(damaged("The marker seals before every body is laid."));
                }
                self.sealing = Some(sealing);
            }
            Frame::Sealed(sealed) => {
                if self.sealing.is_none() {
                    return Err(damaged("The marker is sealed without a seal record."));
                }
                self.sealed = Some(sealed);
            }
        }
        Ok(())
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
    fn u16(&mut self, value: u16) {
        self.0.extend_from_slice(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.0.extend_from_slice(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_le_bytes());
    }
    fn digest(&mut self, value: &Digest) {
        self.0.extend_from_slice(value);
    }
    fn option_pair(&mut self, value: Option<(u64, u64)>) {
        match value {
            Some((a, b)) => {
                self.u8(1);
                self.u64(a);
                self.u64(b);
            }
            None => {
                self.u8(0);
                self.u64(0);
                self.u64(0);
            }
        }
    }
}

struct Take<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Take<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Take { bytes, at: 0 }
    }
    fn bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(len)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }
    fn u8(&mut self) -> Option<u8> {
        self.bytes(1).map(|b| b[0])
    }
    fn u16(&mut self) -> Option<u16> {
        self.bytes(2).map(|b| u16::from_le_bytes([b[0], b[1]]))
    }
    fn u32(&mut self) -> Option<u32> {
        self.bytes(4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn u64(&mut self) -> Option<u64> {
        self.bytes(8).map(|b| {
            let mut word = [0u8; 8];
            word.copy_from_slice(b);
            u64::from_le_bytes(word)
        })
    }
    fn digest(&mut self) -> Option<Digest> {
        self.bytes(32).map(|b| {
            let mut out = [0u8; 32];
            out.copy_from_slice(b);
            out
        })
    }
    fn option_pair(&mut self) -> Option<Option<(u64, u64)>> {
        let flag = self.u8()?;
        let (a, b) = (self.u64()?, self.u64()?);
        match flag {
            0 => Some(None),
            1 => Some(Some((a, b))),
            _ => None,
        }
    }
    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }
}

fn put_laid(put: &mut Put, row: &Laid) {
    put.u32(row.pos);
    put.digest(&row.sha);
    match row.words {
        Some((system, graphics)) => {
            put.u8(1);
            put.u32(system);
            put.u32(graphics);
        }
        None => {
            put.u8(0);
            put.u32(0);
            put.u32(0);
        }
    }
}

fn take_laid(take: &mut Take<'_>) -> Option<Laid> {
    let pos = take.u32()?;
    let sha = take.digest()?;
    let flag = take.u8()?;
    let (system, graphics) = (take.u32()?, take.u32()?);
    let words = match flag {
        0 => None,
        1 => Some((system, graphics)),
        _ => return None,
    };
    Some(Laid { pos, sha, words })
}

fn encode_payload(frame: &Frame) -> Vec<u8> {
    let mut put = Put::default();
    match frame {
        Frame::Begin(begin) => {
            put.digest(&begin.plan_hash);
            put.u64(begin.total);
            put.u64(begin.head_len);
            put.u32(begin.files);
            put.u8(u8::from(begin.words_known) | (u8::from(begin.follow) << 1));
            put.u64(begin.created_ms);
            let name = begin.name.as_bytes();
            put.u16(name.len().min(u16::MAX as usize) as u16);
            put.0.extend_from_slice(&name[..name.len().min(u16::MAX as usize)]);
        }
        Frame::Part(part) => put.option_pair(part.identity),
        Frame::Laid(rows) => {
            put.u32(rows.len() as u32);
            for row in rows {
                put_laid(&mut put, row);
            }
        }
        Frame::LaidSized(rows) => {
            put.u32(rows.len() as u32);
            for (row, len) in rows {
                put_laid(&mut put, row);
                put.u64(*len);
            }
        }
        Frame::Sealing(sealing) => {
            put.digest(&sealing.head_sha);
            match &sealing.digest {
                Some(digest) => {
                    put.u8(1);
                    put.digest(digest);
                }
                None => {
                    put.u8(0);
                    put.digest(&[0; 32]);
                }
            }
        }
        Frame::Sealed(sealed) => {
            put.digest(&sealed.sha);
            put.u64(sealed.len);
        }
    }
    put.0
}

fn decode_payload(kind: u8, payload: &[u8]) -> Option<Frame> {
    let mut take = Take::new(payload);
    let frame = match kind {
        1 => {
            let plan_hash = take.digest()?;
            let total = take.u64()?;
            let head_len = take.u64()?;
            let files = take.u32()?;
            let flags = take.u8()?;
            if flags > 3 {
                return None;
            }
            let (words_known, follow) = (flags & 1 != 0, flags & 2 != 0);
            let created_ms = take.u64()?;
            let name_len = usize::from(take.u16()?);
            let name = String::from_utf8(take.bytes(name_len)?.to_vec()).ok()?;
            Frame::Begin(Begin {
                plan_hash,
                total,
                head_len,
                files,
                name,
                words_known,
                follow,
                created_ms,
            })
        }
        2 => Frame::Part(PartId {
            identity: take.option_pair()?,
        }),
        3 => {
            let count = take.u32()? as usize;
            let mut rows = Vec::with_capacity(count.min(1 << 20));
            for _ in 0..count {
                rows.push(take_laid(&mut take)?);
            }
            Frame::Laid(rows)
        }
        6 => {
            let count = take.u32()? as usize;
            let mut rows = Vec::with_capacity(count.min(1 << 20));
            for _ in 0..count {
                let row = take_laid(&mut take)?;
                rows.push((row, take.u64()?));
            }
            Frame::LaidSized(rows)
        }
        4 => {
            let head_sha = take.digest()?;
            let flag = take.u8()?;
            let digest = take.digest()?;
            let digest = match flag {
                0 => None,
                1 => Some(digest),
                _ => return None,
            };
            Frame::Sealing(Sealing { head_sha, digest })
        }
        5 => Frame::Sealed(Sealed {
            sha: take.digest()?,
            len: take.u64()?,
        }),
        _ => return None,
    };
    take.done().then_some(frame)
}

fn crc_of(bytes: &[u8]) -> u32 {
    let mut crc = Crc::new();
    crc.update(bytes);
    crc.sum()
}

/// Кадр целиком: заголовок, полезная часть, контрольная сумма.
pub fn encode_frame(frame: &Frame) -> Vec<u8> {
    let payload = encode_payload(frame);
    let mut out = Vec::with_capacity(FRAME_HEAD_LEN + payload.len() + FRAME_TAIL_LEN);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.push(frame.kind());
    out.push(FRAME_VERSION);
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&payload);
    let crc = crc_of(&out);
    out.extend_from_slice(&crc.to_le_bytes());
    out
}

fn file_header() -> [u8; FILE_HEADER_LEN] {
    let mut head = [0u8; FILE_HEADER_LEN];
    head[..8].copy_from_slice(&FILE_MAGIC);
    head[8..12].copy_from_slice(&FORMAT_VERSION.to_le_bytes());
    head
}

enum Read1 {
    Frame(Box<Frame>, usize),
    Short,
    Bad(Option<usize>),
}

fn read_frame(bytes: &[u8], at: usize) -> Read1 {
    let left = bytes.len() - at;
    if left < FRAME_HEAD_LEN {
        return Read1::Short;
    }
    let len = u64::from(u32::from_le_bytes([
        bytes[at],
        bytes[at + 1],
        bytes[at + 2],
        bytes[at + 3],
    ]));
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
        Some(frame) => Read1::Frame(Box::new(frame), total),
        None => Read1::Bad(Some(total)),
    }
}

fn replay_bytes(bytes: &[u8]) -> Result<State, AppendError> {
    let mut state = State::default();
    if bytes.len() < FILE_HEADER_LEN {
        // файл только создан, заголовок записан не весь: маркера ещё нет
        return if file_header().starts_with(bytes) {
            state.torn = !bytes.is_empty();
            Ok(state)
        } else {
            Err(damaged("The marker file is not an Astral build marker."))
        };
    }
    if bytes[..8] != FILE_MAGIC {
        return Err(damaged("The marker file is not an Astral build marker."));
    }
    let version = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    if version != FORMAT_VERSION {
        return Err(damaged("The marker has an unsupported format version."));
    }
    state.valid_len = FILE_HEADER_LEN as u64;
    let mut at = FILE_HEADER_LEN;
    while at < bytes.len() {
        match read_frame(bytes, at) {
            Read1::Frame(frame, len) => {
                state.apply(*frame)?;
                state.valid_len += len as u64;
                at += len;
            }
            Read1::Short => {
                state.torn = true;
                break;
            }
            Read1::Bad(size) => {
                let behind = size.map(|len| at + len).filter(|&next| next < bytes.len());
                if behind.is_some_and(|next| matches!(read_frame(bytes, next), Read1::Frame(..))) {
                    return Err(damaged("A marker frame in the middle is damaged."));
                }
                state.torn = true;
                break;
            }
        }
    }
    Ok(state)
}

/// Читает маркер, ничего не меняя. `None` — файла нет.
pub fn read(path: &Path) -> Result<Option<State>, AppendError> {
    let mut bytes = Vec::new();
    match File::open(path) {
        Ok(mut file) => file.read_to_end(&mut bytes)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    replay_bytes(&bytes).map(Some)
}

/// Создаёт маркер: заголовок и кадр начала, с броском на диск. Маркер уже есть —
/// `BuildExists` (чужой или оставленный: решает вызывающий).
pub fn create(path: &Path, begin: &Begin) -> Result<State, AppendError> {
    let mut file = match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(AppendError::refused(
                Code::BuildExists,
                "An unfinished build marker is already there.",
            ))
        }
        Err(error) => return Err(error.into()),
    };
    let frame = Frame::Begin(begin.clone());
    let mut bytes = file_header().to_vec();
    let encoded = encode_frame(&frame);
    bytes.extend_from_slice(&encoded);
    let written = file.write_all(&bytes).and_then(|()| file.sync_all());
    if let Err(error) = written {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    let mut state = State::default();
    state.apply(frame)?;
    state.valid_len = bytes.len() as u64;
    Ok(state)
}

/// Дописывает кадры в конец годной части маркера и сбрасывает файл на диск.
/// Оборванный хвост, если он был, отрезается. Состояние обновляется только после
/// того, как кадры легли на диск.
pub fn append(path: &Path, state: &mut State, frames: Vec<Frame>) -> Result<(), AppendError> {
    let mut bytes = Vec::new();
    let mut lens = Vec::with_capacity(frames.len());
    for frame in &frames {
        let encoded = encode_frame(frame);
        lens.push(encoded.len() as u64);
        bytes.extend_from_slice(&encoded);
    }
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let on_disk = file.metadata()?.len();
    if on_disk < state.valid_len {
        return Err(damaged("The marker became shorter than it was read."));
    }
    if on_disk > state.valid_len {
        file.set_len(state.valid_len)?;
    }
    file.seek(SeekFrom::Start(state.valid_len))?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    let mut next = state.clone();
    next.torn = false;
    for (frame, len) in frames.into_iter().zip(lens) {
        next.apply(frame)?;
        next.valid_len += len;
    }
    *state = next;
    Ok(())
}

/// Убирает маркер; нет файла — не отказ.
pub fn remove(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn begin() -> Begin {
        Begin {
            plan_hash: [7; 32],
            total: 4096,
            head_len: 1024,
            files: 2,
            name: "dlc.rpf".to_owned(),
            words_known: true,
            follow: false,
            created_ms: 99,
        }
    }

    fn laid(pos: u32) -> Laid {
        Laid {
            pos,
            sha: [pos as u8 + 1; 32],
            words: (pos % 2 == 0).then_some((5, 6)),
        }
    }

    #[test]
    fn every_kind_of_frame_round_trips() {
        let all = [
            Frame::Begin(begin()),
            Frame::Part(PartId {
                identity: Some((1, 2)),
            }),
            Frame::Part(PartId { identity: None }),
            Frame::Laid(vec![laid(0), laid(1)]),
            Frame::LaidSized(vec![(laid(0), 12), (laid(1), u64::MAX)]),
            Frame::Begin(Begin {
                follow: true,
                words_known: false,
                ..begin()
            }),
            Frame::Sealing(Sealing {
                head_sha: [3; 32],
                digest: Some([4; 32]),
            }),
            Frame::Sealing(Sealing {
                head_sha: [3; 32],
                digest: None,
            }),
            Frame::Sealed(Sealed {
                sha: [9; 32],
                len: 4096,
            }),
        ];
        for frame in all {
            let bytes = encode_frame(&frame);
            match read_frame(&bytes, 0) {
                Read1::Frame(back, len) => {
                    assert_eq!(*back, frame);
                    assert_eq!(len, bytes.len());
                }
                _ => panic!("кадр {frame:?} не прочитался"),
            }
        }
    }

    fn file_of(frames: &[Frame]) -> Vec<u8> {
        let mut bytes = file_header().to_vec();
        for frame in frames {
            bytes.extend_from_slice(&encode_frame(frame));
        }
        bytes
    }

    #[test]
    fn a_torn_tail_is_cut_and_a_damaged_middle_is_refused() {
        let frames = [Frame::Begin(begin()), Frame::Laid(vec![laid(0)])];
        let whole = file_of(&frames);
        for cut in 1..8 {
            let state = replay_bytes(&whole[..whole.len() - cut]).unwrap();
            assert!(state.torn);
            assert!(state.laid.is_empty());
            assert!(state.begin.is_some());
        }
        // испорчен кадр с годным кадром за ним
        let mut more = file_of(&[
            Frame::Begin(begin()),
            Frame::Laid(vec![laid(0)]),
            Frame::Laid(vec![laid(1)]),
        ]);
        let spot = FILE_HEADER_LEN + encode_frame(&Frame::Begin(begin())).len() + 12;
        more[spot] ^= 0x10;
        let error = replay_bytes(&more).unwrap_err();
        assert_eq!(error.code(), Some(Code::BuildDamaged));
        // испорчен только последний кадр: хвост оборван
        let mut last = whole.clone();
        let at = last.len() - 6;
        last[at] ^= 0x10;
        let state = replay_bytes(&last).unwrap();
        assert!(state.torn && state.laid.is_empty());
    }

    #[test]
    fn frames_out_of_order_are_damage() {
        let skipped = file_of(&[Frame::Begin(begin()), Frame::Laid(vec![laid(1)])]);
        assert_eq!(
            replay_bytes(&skipped).unwrap_err().code(),
            Some(Code::BuildDamaged)
        );
        let early = file_of(&[
            Frame::Begin(begin()),
            Frame::Sealing(Sealing {
                head_sha: [0; 32],
                digest: None,
            }),
        ]);
        assert_eq!(
            replay_bytes(&early).unwrap_err().code(),
            Some(Code::BuildDamaged)
        );
        assert_eq!(
            replay_bytes(b"NOTAMARKERNOTAMARKER").unwrap_err().code(),
            Some(Code::BuildDamaged)
        );
    }
}
