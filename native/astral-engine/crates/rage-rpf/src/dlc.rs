//! Новый архив из потока: тела ложатся в новый файл по плану размеров, голова
//! пишется последней.
//!
//! Проект этапа 3, раздел 6 (E3-3). Живой архив игры не трогается: строится
//! отдельный файл `<архив>.astral-part`, рядом лежит маркер `<архив>.astral-building`
//! (`marker`). Порядок на диске:
//!
//! 1. План по размерам (`SizedPlan`): голова, места тел, длина файла. Отказ до записи.
//! 2. Маркер создаётся и сбрасывается, потом создаётся файл нужной длины (нули;
//!    выделение места на томе при нехватке отказывает здесь), номер файла идёт в маркер.
//!    До головы файл не архив ни для игры, ни для читателя: первые байты нули. Под
//!    своим именем (`.astral-part`) игра его не видит; готовый файл встаёт на место
//!    переименованием.
//! 3. Тела ложатся по плану строго по порядку записи (один курсор вперёд), по мере
//!    прихода. SHA-256 тела считается по ходу и сверяется с ожидаемым (если назван).
//!    На границе файла (не реже заданного числа файлов и байт) файл сбрасывается на
//!    диск и в маркер дописывается кадр «тела легли» с SHA-256 каждого.
//! 4. Печать: оглавление собирается по словам ресурсов, шифруется NG (ключ — по имени
//!    архива и длине файла), ложится в начало файла: сначала всё, кроме первого сектора,
//!    потом, после сброса, первый сектор с магией. Строгий читатель открывает файл,
//!    сверяет таблицу с планом и (по режиму) тела с их SHA-256. Маркер получает кадр
//!    «запечатан», файл переименовывается в готовый, маркер убирается.
//!
//! Резюме после обрыва (в том числе убитого процесса): маркер и файл сверяются, лёгшие
//! тела перечитываются с диска и сверяются с SHA-256 из маркера (заодно восстанавливается
//! состояние SHA-256 файла), курсор встаёт на границу последнего сброшенного тела. Чужой
//! или повреждённый файл — отказ с кодом (`BuildForeign`, `BuildDamaged`,
//! `BuildPlanChanged`), файл не меняется.

pub mod follow;
pub mod marker;

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use sha2::{Digest as _, Sha256};

use crate::{
    activity,
    append::{AppendError, Code, Facts, Host},
    archive::{Archive, EntryId, EntryKind},
    error::RpfError,
    journal::Digest,
    keys::KeySet,
    read_pace,
    source::FileSource,
    toc::{Encryption, BLOCK},
    write::{
        extended_size_bytes,
        sized::{SizedFile, SizedKind, SizedPlan},
        EXTENDED_SIZE_FROM,
    },
};
use marker::{Begin, Frame, Laid, PartId, Sealed as SealedFrame, Sealing, State};

/// Окончание имени недостроенного файла.
pub const PART_SUFFIX: &str = ".astral-part";
/// Окончание имени маркера недостроенного архива.
pub const MARKER_SUFFIX: &str = ".astral-building";

/// Порция чтения и записи.
const PORTION: usize = 8 << 20;
/// Сколько начала файла проверяется на нули у недостроенного файла, если номер
/// файла не известен обеим сторонам, — вся голова; иначе только это.
const ZERO_PROBE: u64 = 64 << 10;
/// Потолок длины нового архива по умолчанию: самый большой штатный `dlc.rpf`
/// (проект, раздел 6.1); выше без проверки в игре не идём.
pub const MAX_ARCHIVE_BYTES: u64 = 3_300_000_000;

/// Путь недостроенного файла.
pub fn part_path(output: &Path) -> PathBuf {
    suffixed(output, PART_SUFFIX)
}

/// Путь маркера недостроенной сборки.
pub fn marker_path(output: &Path) -> PathBuf {
    suffixed(output, MARKER_SUFFIX)
}

fn suffixed(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn refused(code: Code, text: impl Into<String>) -> AppendError {
    AppendError::refused(code, text)
}

fn argument(text: impl Into<String>) -> AppendError {
    AppendError::Other(RpfError::argument(text))
}

fn sha256(bytes: &[u8]) -> Digest {
    Sha256::digest(bytes).into()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX))
}

/// Одна запись нового архива: что за тело и (если известен) его SHA-256.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spec {
    pub file: SizedFile,
    /// SHA-256 тела, как оно придёт (из подписанного манифеста). Не сошёлся —
    /// `HashMismatch`, тело не засчитывается.
    pub sha256: Option<Digest>,
}

/// Как строго проверяется готовый файл при печати.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verify {
    /// Строгий читатель открывает файл, таблица равна плану, голова на диске
    /// равна записанной. Тела не перечитываются.
    Table,
    /// То же, плюс каждое десятое тело и каждый вложенный архив перечитываются
    /// и сверяются с SHA-256 при записи.
    Sample,
    /// Все тела и весь файл перечитываются; отпечаток файла сверяется с тем,
    /// что считался по ходу.
    Full,
}

impl Verify {
    pub fn word(self) -> &'static str {
        match self {
            Verify::Table => "table",
            Verify::Sample => "sample",
            Verify::Full => "full",
        }
    }

    pub fn from_word(word: &str) -> Option<Verify> {
        match word {
            "table" => Some(Verify::Table),
            "sample" => Some(Verify::Sample),
            "full" => Some(Verify::Full),
            _ => None,
        }
    }
}

/// Настройки сборки.
#[derive(Clone, Copy, Debug)]
pub struct Settings {
    /// Тела сбрасываются на диск и попадают в маркер не реже, чем через столько
    /// файлов.
    pub checkpoint_files: usize,
    /// …и не реже, чем через столько байт.
    pub checkpoint_bytes: u64,
    pub verify: Verify,
    /// Архив длиннее — `ArchiveTooLarge` до записи.
    pub max_bytes: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            checkpoint_files: 256,
            checkpoint_bytes: 32 << 20,
            verify: Verify::Sample,
            max_bytes: MAX_ARCHIVE_BYTES,
        }
    }
}

/// Как открывать сборку.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Маркер есть — продолжить, нет — начать.
    Auto,
    /// Начать; маркер уже есть — `BuildExists`.
    Fresh,
    /// Продолжить; маркера нет — отказ.
    ResumeOnly,
}

/// Хэш плана: имя архива и записи с видами, длинами, словами и ожидаемыми SHA-256.
pub fn plan_hash(name: &str, specs: &[Spec]) -> Digest {
    let mut sum = Sha256::new();
    let mut text = |bytes: &[u8]| {
        sum.update((bytes.len() as u64).to_le_bytes());
        sum.update(bytes);
    };
    text(b"ASTRDLC1");
    text(name.as_bytes());
    for spec in specs {
        text(spec.file.path.as_bytes());
        match spec.file.kind {
            SizedKind::Resource { words } => {
                text(b"R");
                let (system, graphics) = words.unwrap_or((0, 0));
                text(&[u8::from(words.is_some())]);
                text(&system.to_le_bytes());
                text(&graphics.to_le_bytes());
            }
            SizedKind::Binary { unpacked } => {
                text(b"B");
                text(&[u8::from(unpacked.is_some())]);
                text(&unpacked.unwrap_or(0).to_le_bytes());
            }
        }
        text(&spec.file.len.to_le_bytes());
        match &spec.sha256 {
            Some(digest) => {
                text(&[1]);
                text(digest);
            }
            None => text(&[0]),
        }
    }
    sum.finalize().into()
}

/// Итог печати.
#[derive(Clone, Debug)]
pub struct Sealed {
    /// SHA-256 готового файла.
    pub sha256: Digest,
    pub bytes: u64,
    /// Число записей оглавления (с корнем и каталогами) и число файлов.
    pub entries: usize,
    pub files: usize,
    pub head_len: u64,
    /// SHA-256 файла считался по ходу записи без отдельного прохода.
    pub hash_streamed: bool,
    /// Как строго файл сверен на самом деле (без потока SHA-256 нужен проход по
    /// всему файлу, и тогда сверены все тела).
    pub verified: Verify,
    /// Записано этим вызовом (тела и голова) и сколько уже лежало с прошлых.
    pub bytes_written: u64,
    pub bytes_resumed: u64,
    /// Миллисекунды: печать целиком и из них сверка.
    pub seal_ms: u64,
    pub verify_ms: u64,
    /// Маркер говорил «запечатан», а файл уже стоял на месте: ничего не делалось
    /// (обрыв после переименования).
    pub already_in_place: bool,
}

/// Проверка плана перед началом новой сборки (место на томе).
pub type Gate<'a> = &'a mut dyn FnMut(&SizedPlan) -> Result<(), AppendError>;

/// Что открыто.
pub enum Opened<'h> {
    Build(Box<Build<'h>>),
    /// Сборка кончилась раньше (обрыв после переименования); маркер убран.
    Finished(Sealed),
}

/// Сколько сделано.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Counts {
    pub files: usize,
    pub laid: usize,
    /// Из них записаны в маркер (пережили бы обрыв питания).
    pub durable: usize,
    pub bytes_laid: u64,
    pub total: u64,
    pub resumed_files: usize,
    pub resumed_bytes: u64,
}

struct Cur {
    pos: usize,
    input: usize,
    received: u64,
    emitted: u64,
    recv: Sha256,
    /// Отдельный SHA-256 лежащих байт: только у ресурса с настоящим размером
    /// внутри (первые 16 байт на диске другие).
    disk: Option<Sha256>,
    head: [u8; 16],
    held: usize,
    holding: bool,
    snapshot: Option<Sha256>,
    mid: bool,
    words: Option<(u32, u32)>,
}

/// Сборка нового архива.
pub struct Build<'h> {
    host: &'h dyn Host,
    output: PathBuf,
    part: PathBuf,
    marker: PathBuf,
    name: String,
    keys: Option<Arc<KeySet>>,
    specs: Vec<Spec>,
    plan: SizedPlan,
    settings: Settings,
    file: Option<File>,
    state: State,
    laid: Vec<Laid>,
    durable: usize,
    pending_files: usize,
    pending_bytes: u64,
    digest: Option<Sha256>,
    head_ahead: Option<Vec<u8>>,
    cur: Option<Cur>,
    buffer: Vec<u8>,
    resumed_files: usize,
    resumed_bytes: u64,
    session_bytes: u64,
}

fn open_part(path: &Path, create: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if create {
        options.create_new(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ: остальным можно только читать
        options.share_mode(1);
    }
    options.open(path)
}

fn read_exactly(file: &mut File, at: u64, len: u64, buffer: &mut Vec<u8>, mut each: impl FnMut(&[u8])) -> Result<(), AppendError> {
    file.seek(SeekFrom::Start(at))?;
    let mut left = len;
    while left > 0 {
        activity::check()?;
        let take = left.min(PORTION as u64) as usize;
        if buffer.len() < take {
            buffer.resize(take, 0);
        }
        read_pace::pace_read(take as u64);
        file.read_exact(&mut buffer[..take])?;
        each(&buffer[..take]);
        left -= take as u64;
    }
    Ok(())
}

fn is_zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|&byte| byte == 0)
}

fn rsc7_words(head: &[u8; 16]) -> Result<(u32, u32), AppendError> {
    if &head[..4] != b"RSC7" {
        return Err(AppendError::Other(RpfError::format(
            "A resource entry does not start with RSC7.",
        )));
    }
    let word = |at: usize| u32::from_le_bytes([head[at], head[at + 1], head[at + 2], head[at + 3]]);
    Ok((word(8), word(12)))
}

impl<'h> Build<'h> {
    /// Открывает сборку: начинает новую или продолжает оставленную.
    ///
    /// `output` — путь готового архива; рядом лягут `.astral-part` и `.astral-building`.
    /// `name` — имя архива для ключа шифра оглавления (последнее звено пути в игре,
    /// обычно `dlc.rpf`). Ключи нужны для печати и для SHA-256 файла по ходу записи
    /// (голова известна заранее, если названы слова всех ресурсов).
    pub fn open(
        host: &'h dyn Host,
        output: &Path,
        name: &str,
        specs: Vec<Spec>,
        settings: Settings,
        keys: Option<Arc<KeySet>>,
        mode: Mode,
    ) -> Result<Opened<'h>, AppendError> {
        Build::open_checked(host, output, name, specs, settings, keys, mode, &mut |_| Ok(()))
    }

    /// То же, но `gate` зовётся с планом, когда сборка начинается заново и ни файла,
    /// ни маркера ещё нет (проверка места на томе); отказ — до любой записи. У
    /// продолжаемой сборки файл уже выделен, и `gate` не зовётся.
    #[allow(clippy::too_many_arguments)]
    pub fn open_checked(
        host: &'h dyn Host,
        output: &Path,
        name: &str,
        specs: Vec<Spec>,
        settings: Settings,
        keys: Option<Arc<KeySet>>,
        mode: Mode,
        gate: Gate<'_>,
    ) -> Result<Opened<'h>, AppendError> {
        let plan = SizedPlan::prepare(specs.iter().map(|spec| spec.file.clone()).collect())?;
        if plan.size() > settings.max_bytes {
            return Err(refused(
                Code::ArchiveTooLarge,
                format!(
                    "The archive would be {} bytes; the limit is {} bytes.",
                    plan.size(),
                    settings.max_bytes
                ),
            ));
        }
        if name.is_empty() || !name.is_ascii() {
            return Err(argument("The archive name must be ASCII and not empty."));
        }
        let part = part_path(output);
        let marker_file = marker_path(output);
        let mut build = Build {
            host,
            output: output.to_path_buf(),
            part,
            marker: marker_file,
            name: name.to_owned(),
            keys,
            specs,
            plan,
            settings,
            file: None,
            state: State::default(),
            laid: Vec::new(),
            durable: 0,
            pending_files: 0,
            pending_bytes: 0,
            digest: None,
            head_ahead: None,
            cur: None,
            buffer: Vec::new(),
            resumed_files: 0,
            resumed_bytes: 0,
            session_bytes: 0,
        };
        build.head_ahead = build.sealed_head_ahead()?;
        let left = marker::read(&build.marker)?;
        match (left, mode) {
            (Some(state), Mode::Fresh) if state.begin.is_some() => Err(refused(
                Code::BuildExists,
                "An unfinished build of this archive is already there.",
            )),
            (Some(state), _) => build.resume(state, gate),
            (None, Mode::ResumeOnly) => Err(argument("There is no unfinished build to resume.")),
            (None, _) => {
                build.start(gate)?;
                Ok(Opened::Build(Box::new(build)))
            }
        }
    }

    /// Голова файла, если она известна до записи тел: названы слова всех ресурсов и
    /// есть ключи.
    fn sealed_head_ahead(&self) -> Result<Option<Vec<u8>>, AppendError> {
        match (&self.keys, self.plan.words_known()) {
            (Some(keys), true) => self.plan.sealed_head(&self.name, keys).map(Some),
            _ => Ok(None),
        }
    }

    fn begin_frame(&self) -> Begin {
        Begin {
            plan_hash: plan_hash(&self.name, &self.specs),
            total: self.plan.size(),
            head_len: self.plan.head_len(),
            files: self.specs.len() as u32,
            name: self.name.clone(),
            words_known: self.plan.words_known(),
            follow: false,
            created_ms: now_ms(),
        }
    }

    fn hit(&self, point: &str) {
        self.host.hit(point);
    }

    fn start_digest(&mut self) {
        self.digest = self.head_ahead.as_ref().map(|head| {
            let mut sum = Sha256::new();
            sum.update(head);
            sum
        });
    }

    /// Новая сборка: маркер, потом файл.
    fn start(&mut self, gate: Gate<'_>) -> Result<(), AppendError> {
        if self.part.exists() {
            return Err(refused(
                Code::BuildForeign,
                "A file without a marker lies where the unfinished archive would be; it is left alone.",
            ));
        }
        if self.output.exists() {
            return Err(refused(
                Code::OutputExists,
                "A file already lies where the finished archive would be.",
            ));
        }
        gate(&self.plan)?;
        if let Some(folder) = self.output.parent() {
            fs::create_dir_all(folder)?;
        }
        let begin = self.begin_frame();
        self.state = marker::create(&self.marker, &begin)?;
        self.hit("dlc-after-marker");
        let file = match open_part(&self.part, true) {
            Ok(file) => file,
            Err(error) => {
                let _ = marker::remove(&self.marker);
                return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                    refused(
                        Code::BuildForeign,
                        "A file without a marker lies where the unfinished archive would be; it is left alone.",
                    )
                } else {
                    error.into()
                });
            }
        };
        // длина сразу итоговая: нехватка места отказывает здесь, до тел
        if let Err(error) = file.set_len(self.plan.size()) {
            drop(file);
            let _ = fs::remove_file(&self.part);
            let _ = marker::remove(&self.marker);
            return Err(error.into());
        }
        let facts = self.host.facts(&file)?;
        let appended = marker::append(
            &self.marker,
            &mut self.state,
            vec![Frame::Part(PartId {
                identity: facts.identity,
            })],
        );
        if let Err(error) = appended {
            drop(file);
            let _ = fs::remove_file(&self.part);
            let _ = marker::remove(&self.marker);
            return Err(error);
        }
        self.file = Some(file);
        self.start_digest();
        self.hit("dlc-after-begin");
        Ok(())
    }

    /// Оставленная сборка: маркер и файл сверяются, лёгшее перечитывается.
    fn resume(mut self, state: State, gate: Gate<'_>) -> Result<Opened<'h>, AppendError> {
        let Some(begin) = state.begin.clone() else {
            // маркер создавался и оборвался: файла ещё не было
            if self.part.exists() {
                return Err(refused(
                    Code::BuildForeign,
                    "A file lies beside a marker that never began; it is left alone.",
                ));
            }
            marker::remove(&self.marker)?;
            self.start(gate)?;
            return Ok(Opened::Build(Box::new(self)));
        };
        if begin.plan_hash != plan_hash(&self.name, &self.specs)
            || begin.total != self.plan.size()
            || begin.head_len != self.plan.head_len()
            || begin.files as usize != self.specs.len()
            || begin.name != self.name
        {
            return Err(refused(
                Code::BuildPlanChanged,
                "The unfinished build was made for another list of entries.",
            ));
        }
        // обрыв после переименования: файл уже на месте
        if let (Some(sealed), false) = (state.sealed.as_ref(), self.part.exists()) {
            if self.output.is_file() {
                return self.confirm_in_place(sealed).map(Opened::Finished);
            }
        }
        if self.output.exists() && state.sealed.is_none() {
            return Err(refused(
                Code::OutputExists,
                "A file already lies where the finished archive would be.",
            ));
        }
        self.state = state;
        if !self.part.exists() {
            if self.state.part.is_some() || !self.state.laid.is_empty() {
                return Err(refused(
                    Code::BuildDamaged,
                    "The unfinished file is gone, but the marker says it was started.",
                ));
            }
            // обрыв между маркером и файлом: файл создаётся заново, маркер наш
            let file = open_part(&self.part, true)?;
            file.set_len(self.plan.size())?;
            self.adopt(file)?;
            self.start_digest();
            return Ok(Opened::Build(Box::new(self)));
        }
        let mut file = open_part(&self.part, false)?;
        self.prove_part(&mut file)?;
        if self.state.part.is_none() {
            self.adopt_marker(&file)?;
        }
        self.file = Some(file);
        self.start_digest();
        self.rebuild()?;
        self.hit("dlc-after-resume");
        Ok(Opened::Build(Box::new(self)))
    }

    /// Файл создан этим вызовом: номер файла уходит в маркер.
    fn adopt(&mut self, file: File) -> Result<(), AppendError> {
        self.adopt_marker(&file)?;
        self.file = Some(file);
        Ok(())
    }

    fn adopt_marker(&mut self, file: &File) -> Result<(), AppendError> {
        let facts = self.host.facts(file)?;
        marker::append(
            &self.marker,
            &mut self.state,
            vec![Frame::Part(PartId {
                identity: facts.identity,
            })],
        )
    }

    /// Файл на месте готового: длина и SHA-256 равны записанным в маркере.
    fn confirm_in_place(&mut self, sealed: &SealedFrame) -> Result<Sealed, AppendError> {
        let mut file = File::open(&self.output)?;
        let len = file.metadata()?.len();
        let mut sum = Sha256::new();
        let mut buffer = Vec::new();
        if len == sealed.len {
            read_exactly(&mut file, 0, len, &mut buffer, |chunk| sum.update(chunk))?;
        }
        let digest: Digest = sum.finalize().into();
        if len != sealed.len || digest != sealed.sha {
            return Err(refused(
                Code::OutputExists,
                "A file lies where the finished archive should be, and it is not the one that was sealed.",
            ));
        }
        marker::remove(&self.marker)?;
        Ok(Sealed {
            sha256: digest,
            bytes: len,
            entries: self.plan.entries(),
            files: self.specs.len(),
            head_len: self.plan.head_len(),
            hash_streamed: false,
            verified: Verify::Full,
            bytes_written: 0,
            bytes_resumed: len,
            seal_ms: 0,
            verify_ms: 0,
            already_in_place: true,
        })
    }

    /// Файл наш: длина, номер файла, начало (нули, пока головы нет).
    fn prove_part(&mut self, file: &mut File) -> Result<(), AppendError> {
        prove_part(self.host, file, &self.state, self.plan.size(), self.plan.head_len())
    }

    /// Лёгшие тела перечитываются, SHA-256 каждого сверяется с маркером, состояние
    /// SHA-256 файла восстанавливается. Курсор — на границе последнего сброшенного.
    fn rebuild(&mut self) -> Result<(), AppendError> {
        let rows = self.state.laid.clone();
        let mut buffer = std::mem::take(&mut self.buffer);
        let mut file = self
            .file
            .take()
            .ok_or_else(|| argument("The unfinished file is not open."))?;
        let outcome = (|| -> Result<(), AppendError> {
            for (pos, row) in rows.iter().enumerate() {
                let input = self.plan.order()[pos];
                let place = self.plan.place(input);
                let mut sum = Sha256::new();
                let mut whole = self.digest.take();
                read_exactly(&mut file, place.offset, place.len, &mut buffer, |chunk| {
                    sum.update(chunk);
                    if let Some(whole) = whole.as_mut() {
                        whole.update(chunk);
                    }
                })?;
                let pad = place.span - place.len;
                if pad > 0 {
                    let mut zero = true;
                    read_exactly(&mut file, place.offset + place.len, pad, &mut buffer, |chunk| {
                        zero &= is_zero(chunk);
                        if let Some(whole) = whole.as_mut() {
                            whole.update(chunk);
                        }
                    })?;
                    if !zero {
                        return Err(refused(
                            Code::BuildDamaged,
                            format!("The padding after laid body {pos} is not zeros."),
                        ));
                    }
                }
                self.digest = whole;
                let got: Digest = sum.finalize().into();
                if got != row.sha {
                    return Err(refused(
                        Code::BuildDamaged,
                        format!("Laid body {pos} differs from what the marker recorded."),
                    ));
                }
                self.pending_files = 0;
            }
            Ok(())
        })();
        self.file = Some(file);
        self.buffer = buffer;
        outcome?;
        self.laid = rows;
        self.durable = self.laid.len();
        self.resumed_files = self.laid.len();
        self.resumed_bytes = self
            .laid
            .iter()
            .enumerate()
            .map(|(pos, _)| self.plan.place(self.plan.order()[pos]).len)
            .sum();
        Ok(())
    }

    // ----- ход работы -----

    /// Сколько сделано.
    pub fn counts(&self) -> Counts {
        let bytes_laid = self
            .laid
            .iter()
            .enumerate()
            .map(|(pos, _)| self.plan.place(self.plan.order()[pos]).len)
            .sum();
        Counts {
            files: self.specs.len(),
            laid: self.laid.len(),
            durable: self.durable,
            bytes_laid,
            total: self.plan.size(),
            resumed_files: self.resumed_files,
            resumed_bytes: self.resumed_bytes,
        }
    }

    /// План по размерам этой сборки.
    pub fn plan(&self) -> &SizedPlan {
        &self.plan
    }

    /// Входная запись, чьё тело должно прийти следующим; `None` — все легли.
    pub fn next(&self) -> Option<usize> {
        self.plan.order().get(self.laid.len()).copied()
    }

    /// Записано этим вызовом: тела, голова.
    pub fn session_bytes(&self) -> u64 {
        self.session_bytes
    }

    fn file_mut(&mut self) -> Result<&mut File, AppendError> {
        self.file
            .as_mut()
            .ok_or_else(|| argument("The unfinished file is not open."))
    }

    /// Начинает тело входной записи `index`; оно обязано быть следующим по плану.
    pub fn begin_file(&mut self, index: usize) -> Result<(), AppendError> {
        if self.cur.is_some() {
            return Err(argument("A body is already being written."));
        }
        let Some(want) = self.next() else {
            return Err(argument("Every body is already laid."));
        };
        if index != want {
            return Err(argument(format!(
                "The next body in the plan is entry {want}, not {index}."
            )));
        }
        let place = self.plan.place(index);
        let is_resource = matches!(self.specs[index].file.kind, SizedKind::Resource { .. });
        let patched = is_resource && self.specs[index].file.len >= EXTENDED_SIZE_FROM;
        self.file_mut()?.seek(SeekFrom::Start(place.offset))?;
        self.cur = Some(Cur {
            pos: self.laid.len(),
            input: index,
            received: 0,
            emitted: 0,
            recv: Sha256::new(),
            disk: patched.then(Sha256::new),
            head: [0; 16],
            held: 0,
            holding: is_resource,
            snapshot: self.digest.clone(),
            mid: false,
            words: None,
        });
        Ok(())
    }

    /// Кусок тела. Больше, чем заказано, — `SizeMismatch`; тело при этом нужно
    /// бросить (`abandon_file`) и прислать заново.
    pub fn write(&mut self, chunk: &[u8]) -> Result<(), AppendError> {
        activity::check()?;
        let mut cur = self
            .cur
            .take()
            .ok_or_else(|| argument("No body is being written."))?;
        let outcome = self.write_inner(&mut cur, chunk);
        self.cur = Some(cur);
        outcome
    }

    fn write_inner(&mut self, cur: &mut Cur, mut chunk: &[u8]) -> Result<(), AppendError> {
        let spec_len = self.specs[cur.input].file.len;
        if cur.received + chunk.len() as u64 > spec_len {
            return Err(refused(
                Code::SizeMismatch,
                format!(
                    "More bytes came for {} than the plan names ({spec_len}).",
                    self.specs[cur.input].file.path
                ),
            ));
        }
        cur.received += chunk.len() as u64;
        cur.recv.update(chunk);
        if cur.holding {
            let take = (16 - cur.held).min(chunk.len());
            cur.head[cur.held..cur.held + take].copy_from_slice(&chunk[..take]);
            cur.held += take;
            chunk = &chunk[take..];
            if cur.held < 16 {
                return Ok(());
            }
            cur.holding = false;
            let words = rsc7_words(&cur.head)?;
            if let SizedKind::Resource { words: Some(named) } = self.specs[cur.input].file.kind {
                if named != words {
                    return Err(AppendError::Other(RpfError::format(
                        "The words of a resource differ from the planned ones.",
                    )));
                }
            }
            cur.words = Some(words);
            let mut head = cur.head;
            if spec_len >= EXTENDED_SIZE_FROM {
                // от 16 МиБ размер лежит в самом ресурсе. Заголовок ложится так, как его
                // оставляет настоящий ArchiveFix: нули и четыре байта размера (слова
                // ресурса — в оглавлении). Тогда ArchiveFix на готовом архиве ничего не
                // меняет, а итог равен полному пути с ним.
                head = [0u8; 16];
                for (at, value) in extended_size_bytes(spec_len) {
                    head[at] = value;
                }
            }
            self.emit(cur, &head)?;
        }
        if !chunk.is_empty() {
            self.emit(cur, chunk)?;
        }
        if !cur.mid && spec_len > 0 && cur.received * 2 >= spec_len {
            cur.mid = true;
            self.hit(&format!("dlc-in-file-{}", cur.pos));
        }
        Ok(())
    }

    fn emit(&mut self, cur: &mut Cur, bytes: &[u8]) -> Result<(), AppendError> {
        self.file_mut()?.write_all(bytes)?;
        if let Some(disk) = cur.disk.as_mut() {
            disk.update(bytes);
        }
        if let Some(whole) = self.digest.as_mut() {
            whole.update(bytes);
        }
        cur.emitted += bytes.len() as u64;
        self.session_bytes += bytes.len() as u64;
        Ok(())
    }

    /// Тело кончилось: длина и SHA-256 сверяются, тело засчитывается.
    pub fn end_file(&mut self) -> Result<(), AppendError> {
        let Some(cur) = self.cur.take() else {
            return Err(argument("No body is being written."));
        };
        let Cur {
            pos,
            input,
            received,
            recv,
            disk,
            snapshot,
            words,
            ..
        } = cur;
        let spec = self.specs[input].clone();
        let place = self.plan.place(input);
        if received != spec.file.len {
            self.digest = snapshot;
            return Err(refused(
                Code::SizeMismatch,
                format!(
                    "{} came as {received} bytes; the plan names {}.",
                    spec.file.path, spec.file.len
                ),
            ));
        }
        let arrived: Digest = recv.finalize().into();
        if let Some(wanted) = spec.sha256 {
            if wanted != arrived {
                self.digest = snapshot;
                return Err(refused(
                    Code::HashMismatch,
                    format!("The body of {} does not match its SHA-256.", spec.file.path),
                ));
            }
        }
        let on_disk: Digest = disk.map_or(arrived, |disk| disk.finalize().into());
        if place.span > place.len {
            if let Some(whole) = self.digest.as_mut() {
                // добивка до границы блока: нули, которые файл уже содержит
                let zeros = vec![0u8; (place.span - place.len) as usize];
                whole.update(&zeros);
            }
        }
        self.laid.push(Laid {
            pos: pos as u32,
            sha: on_disk,
            words,
        });
        self.pending_files += 1;
        self.pending_bytes += place.len;
        self.hit(&format!("dlc-after-file-{pos}"));
        if self.pending_files >= self.settings.checkpoint_files
            || self.pending_bytes >= self.settings.checkpoint_bytes
        {
            self.checkpoint()?;
        }
        Ok(())
    }

    /// Бросает тело, которое не получилось: курсор остаётся на его начале, место
    /// перепишется.
    pub fn abandon_file(&mut self) {
        if let Some(cur) = self.cur.take() {
            self.digest = cur.snapshot;
        }
    }

    /// Целое тело из читателя; `meter` получает число байт каждой порции.
    pub fn put(
        &mut self,
        index: usize,
        reader: &mut dyn Read,
        meter: &mut dyn FnMut(u64),
    ) -> Result<(), AppendError> {
        self.begin_file(index)?;
        let len = self.specs[index].file.len;
        let mut buffer = std::mem::take(&mut self.buffer);
        let outcome = (|| -> Result<(), AppendError> {
            let mut left = len;
            while left > 0 {
                let want = left.min(PORTION as u64) as usize;
                if buffer.len() < want {
                    buffer.resize(want, 0);
                }
                let got = reader.read(&mut buffer[..want])?;
                if got == 0 {
                    return Err(refused(
                        Code::SizeMismatch,
                        format!(
                            "The source of {} ended {left} bytes before the plan says.",
                            self.specs[index].file.path
                        ),
                    ));
                }
                self.write(&buffer[..got])?;
                meter(got as u64);
                left -= got as u64;
            }
            self.end_file()
        })();
        self.buffer = buffer;
        if outcome.is_err() {
            self.abandon_file();
        }
        outcome
    }

    /// Тела, которые легли, сбрасываются на диск, и маркер узнаёт о них.
    pub fn checkpoint(&mut self) -> Result<(), AppendError> {
        if self.durable == self.laid.len() {
            return Ok(());
        }
        self.file_mut()?.sync_all()?;
        let rows = self.laid[self.durable..].to_vec();
        marker::append(&self.marker, &mut self.state, vec![Frame::Laid(rows)])?;
        self.durable = self.laid.len();
        self.pending_files = 0;
        self.pending_bytes = 0;
        self.hit(&format!("dlc-after-checkpoint-{}", self.laid.len()));
        Ok(())
    }

    /// Остановка с возможностью продолжить: всё лёгшее сбрасывается и попадает в
    /// маркер, недописанное тело бросается. Файл и маркер остаются.
    pub fn pause(&mut self) -> Result<(), AppendError> {
        self.abandon_file();
        self.checkpoint()
    }

    /// Отмена с уборкой: недостроенный файл и маркер убираются.
    pub fn discard(mut self) -> Result<(), AppendError> {
        self.abandon_file();
        drop(self.file.take());
        remove_if_exists(&self.part)?;
        marker::remove(&self.marker)?;
        Ok(())
    }

    // ----- печать -----

    /// Слова ресурсов, как они пришли, для сборки итогового оглавления.
    fn final_plan(&self) -> Result<SizedPlan, AppendError> {
        let mut files: Vec<SizedFile> = self.specs.iter().map(|spec| spec.file.clone()).collect();
        for (pos, row) in self.laid.iter().enumerate() {
            let input = self.plan.order()[pos];
            if let SizedKind::Resource { words } = &mut files[input].kind {
                *words = row.words.or(*words);
            }
        }
        let plan = SizedPlan::prepare(files)?;
        let same = plan.size() == self.plan.size()
            && plan.head_len() == self.plan.head_len()
            && (0..self.specs.len()).all(|input| plan.place(input) == self.plan.place(input));
        if !same {
            return Err(refused(
                Code::BuildDamaged,
                "The layout changed after the words of the resources arrived.",
            ));
        }
        Ok(plan)
    }

    /// Печать: голова, сброс, строгая сверка, отпечаток, переименование.
    pub fn seal(mut self) -> Result<Sealed, AppendError> {
        let begun = Instant::now();
        self.abandon_file();
        if self.laid.len() != self.specs.len() {
            return Err(refused(
                Code::BuildIncomplete,
                format!(
                    "{} of {} bodies are laid; the archive is not sealed.",
                    self.laid.len(),
                    self.specs.len()
                ),
            ));
        }
        let Some(keys) = self.keys.clone() else {
            return Err(AppendError::Other(RpfError::keys(
                "Sealing needs the key set.",
            )));
        };
        self.checkpoint()?;
        let plan = self.final_plan()?;
        let head = plan.sealed_head(&self.name, &keys)?;
        if let Some(ahead) = &self.head_ahead {
            if *ahead != head {
                return Err(refused(
                    Code::BuildDamaged,
                    "The head that was known ahead differs from the final one.",
                ));
            }
        }
        let streamed: Option<Digest> = self.digest.clone().map(|sum| sum.finalize().into());
        marker::append(
            &self.marker,
            &mut self.state,
            vec![Frame::Sealing(Sealing {
                head_sha: sha256(&head),
                digest: streamed,
            })],
        )?;
        self.hit("dlc-before-head");
        self.write_head(&head)?;
        self.hit("dlc-after-head");

        let verify_began = Instant::now();
        let (sha, verified) = self.verify_written(&plan, &head, &keys, streamed)?;
        let verify_ms = u64::try_from(verify_began.elapsed().as_millis()).unwrap_or(u64::MAX);
        let total = self.plan.size();
        marker::append(
            &self.marker,
            &mut self.state,
            vec![Frame::Sealed(SealedFrame { sha, len: total })],
        )?;
        self.hit("dlc-after-sealed");

        drop(self.file.take());
        if self.output.exists() {
            return Err(refused(
                Code::OutputExists,
                "A file already lies where the finished archive should be.",
            ));
        }
        fs::rename(&self.part, &self.output)?;
        self.hit("dlc-after-rename");
        marker::remove(&self.marker)?;
        Ok(Sealed {
            sha256: sha,
            bytes: total,
            entries: self.plan.entries(),
            files: self.specs.len(),
            head_len: self.plan.head_len(),
            hash_streamed: streamed.is_some(),
            verified,
            bytes_written: self.session_bytes,
            bytes_resumed: self.resumed_bytes,
            seal_ms: u64::try_from(begun.elapsed().as_millis()).unwrap_or(u64::MAX),
            verify_ms,
            already_in_place: false,
        })
    }

    /// Голова ложится в два приёма: всё, кроме первого сектора, потом (после сброса)
    /// первый сектор с магией. Пока второго приёма не было, файл не архив.
    fn write_head(&mut self, head: &[u8]) -> Result<(), AppendError> {
        let sector = BLOCK as usize;
        {
            let file = self.file_mut()?;
            file.seek(SeekFrom::Start(sector as u64))?;
            file.write_all(&head[sector..])?;
            file.sync_all()?;
        }
        self.hit("dlc-mid-head");
        {
            let file = self.file_mut()?;
            file.seek(SeekFrom::Start(0))?;
            file.write_all(&head[..sector])?;
            file.sync_all()?;
        }
        self.session_bytes += head.len() as u64;
        Ok(())
    }

    /// Строгая сверка записанного. Возвращает SHA-256 файла и то, как строго сверено.
    fn verify_written(
        &mut self,
        plan: &SizedPlan,
        head: &[u8],
        keys: &Arc<KeySet>,
        streamed: Option<Digest>,
    ) -> Result<(Digest, Verify), AppendError> {
        let mut buffer = std::mem::take(&mut self.buffer);
        let outcome = self.verify_inner(plan, head, keys, streamed, &mut buffer);
        self.buffer = buffer;
        outcome
    }

    fn verify_inner(
        &mut self,
        plan: &SizedPlan,
        head: &[u8],
        keys: &Arc<KeySet>,
        streamed: Option<Digest>,
        buffer: &mut Vec<u8>,
    ) -> Result<(Digest, Verify), AppendError> {
        // голова на диске равна записанной
        let mut file = File::open(&self.part)?;
        let mut on_disk = Vec::with_capacity(head.len());
        read_exactly(&mut file, 0, head.len() as u64, buffer, |chunk| {
            on_disk.extend_from_slice(chunk);
        })?;
        if on_disk != head {
            return Err(refused(
                Code::BuildDamaged,
                "The head on disk is not the one that was written.",
            ));
        }
        // строгий читатель и таблица против плана
        let source = FileSource::open(&self.part)?;
        let archive = Archive::open(Arc::new(source), &self.name, Some(Arc::clone(keys)))?;
        if archive.encryption() != Encryption::Ng {
            return Err(refused(Code::BuildDamaged, "The sealed archive is not NG."));
        }
        let ids = check_table(&archive, plan, &self.laid)?;

        let mode = self.settings.verify;
        let sampled = |pos: usize, input: usize| {
            mode == Verify::Full
                || (mode == Verify::Sample
                    && (pos % 10 == 0 || archive_is_nested(&self.specs[input].file.path)))
        };
        // вложенные архивы открываются (пробно) при Sample и Full
        if mode != Verify::Table {
            for (input, spec) in self.specs.iter().enumerate() {
                if archive_is_nested(&spec.file.path) {
                    archive.open_nested(ids[input]).map_err(|error| {
                        refused(
                            Code::BuildDamaged,
                            format!("The nested archive {} does not open: {error}.", spec.file.path),
                        )
                    })?;
                }
            }
        }

        let need_pass = streamed.is_none() || mode == Verify::Full;
        if need_pass {
            // один проход по всему файлу: тела и добивка сверяются, SHA-256 файла считается
            let mut whole = Sha256::new();
            whole.update(head);
            let mut disk = File::open(&self.part)?;
            let mut at = head.len() as u64;
            for (pos, &input) in plan.order().iter().enumerate() {
                let place = plan.place(input);
                let mut sum = Sha256::new();
                read_exactly(&mut disk, at, place.len, buffer, |chunk| {
                    sum.update(chunk);
                    whole.update(chunk);
                })?;
                let got: Digest = sum.finalize().into();
                if got != self.laid[pos].sha {
                    return Err(refused(
                        Code::BuildDamaged,
                        format!("Body {pos} on disk differs from what was laid."),
                    ));
                }
                let pad = place.span - place.len;
                if pad > 0 {
                    let mut zero = true;
                    read_exactly(&mut disk, at + place.len, pad, buffer, |chunk| {
                        zero &= is_zero(chunk);
                        whole.update(chunk);
                    })?;
                    if !zero {
                        return Err(refused(
                            Code::BuildDamaged,
                            format!("The padding after body {pos} is not zeros."),
                        ));
                    }
                }
                at += place.span;
            }
            let sha: Digest = whole.finalize().into();
            if let Some(expected) = streamed {
                if expected != sha {
                    return Err(refused(
                        Code::BuildDamaged,
                        "The file on disk differs from the bytes that were streamed.",
                    ));
                }
            }
            return Ok((sha, Verify::Full));
        }

        // потоковый SHA-256 есть; сверяются выборочные тела
        if mode == Verify::Sample {
            let mut disk = File::open(&self.part)?;
            for (pos, &input) in plan.order().iter().enumerate() {
                if !sampled(pos, input) {
                    continue;
                }
                let place = plan.place(input);
                let mut sum = Sha256::new();
                read_exactly(&mut disk, place.offset, place.len, buffer, |chunk| {
                    sum.update(chunk)
                })?;
                let got: Digest = sum.finalize().into();
                if got != self.laid[pos].sha {
                    return Err(refused(
                        Code::BuildDamaged,
                        format!("Body {pos} on disk differs from what was laid."),
                    ));
                }
            }
        }
        let sha = streamed.unwrap_or([0; 32]);
        Ok((sha, mode))
    }
}

fn archive_is_nested(path: &str) -> bool {
    Archive::is_nested_archive_name(path)
}

fn remove_if_exists(path: &Path) -> Result<(), AppendError> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

/// Файл недостроенной сборки наш: длина, номер файла, начало (нули, пока головы нет).
fn prove_part(
    host: &dyn Host,
    file: &mut File,
    state: &State,
    total: u64,
    head_len: u64,
) -> Result<(), AppendError> {
    let foreign = |what: &str| {
        refused(
            Code::BuildForeign,
            format!("The file is not the one the marker belongs to: {what}; it is left alone."),
        )
    };
    let len = file.metadata()?.len();
    if len != total {
        return Err(foreign("its length differs"));
    }
    let facts: Facts = host.facts(file)?;
    let known = match (state.part.and_then(|part| part.identity), facts.identity) {
        (Some(then), Some(now)) => {
            if then != now {
                return Err(foreign("another file lies under this name"));
            }
            true
        }
        _ => false,
    };
    // пока головы нет, начало файла нули: чужой файл с той же длиной их не даст
    if state.sealing.is_none() {
        let probe = if known { ZERO_PROBE.min(head_len) } else { head_len };
        let mut buffer = Vec::new();
        let mut zero = true;
        read_exactly(file, 0, probe, &mut buffer, |chunk| zero &= is_zero(chunk))?;
        if !zero {
            return Err(foreign("the start of the file is not zeros, and no head was written"));
        }
    }
    Ok(())
}

/// Таблица готового файла против плана: ровно те же записи, места, виды, длины,
/// слова. Возвращает номера записей читателя по входным записям.
fn check_table(
    archive: &Archive,
    plan: &SizedPlan,
    laid: &[Laid],
) -> Result<Vec<EntryId>, AppendError> {
    let damaged = |text: String| refused(Code::BuildDamaged, text);
    if archive.len() != plan.entries() {
        return Err(damaged(format!(
            "The sealed archive has {} entries; the plan names {}.",
            archive.len(),
            plan.entries()
        )));
    }
    // путь каждого файла читателя
    let mut found: std::collections::HashMap<String, EntryId> = std::collections::HashMap::new();
    let mut stack = vec![(archive.root(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        for &id in archive.files(dir) {
            found.insert(format!("{prefix}{}", archive.entry(id).name), id);
        }
        for &sub in archive.dirs(dir) {
            stack.push((sub, format!("{prefix}{}/", archive.entry(sub).name)));
        }
    }
    if found.len() != plan.files().len() {
        return Err(damaged("The sealed archive has other files than the plan.".to_owned()));
    }
    let mut words_of: Vec<Option<(u32, u32)>> = vec![None; plan.files().len()];
    for (pos, row) in laid.iter().enumerate() {
        words_of[plan.order()[pos]] = row.words;
    }
    let mut ids = Vec::with_capacity(plan.files().len());
    for (input, file) in plan.files().iter().enumerate() {
        let Some(&id) = found.get(&file.path) else {
            return Err(damaged(format!("{} is missing from the sealed archive.", file.path)));
        };
        let place = plan.place(input);
        match (&archive.entry(id).kind, file.kind) {
            (EntryKind::Resource(info), SizedKind::Resource { words }) => {
                let named = words.or(words_of[input]).unwrap_or((0, 0));
                let same = info.offset() == place.offset
                    && archive.listing_size(id) == file.len
                    && (info.system_flags, info.graphics_flags) == named;
                if !same {
                    return Err(damaged(format!("{} differs from the plan.", file.path)));
                }
            }
            (EntryKind::Binary(info), SizedKind::Binary { unpacked }) => {
                let (stored, unc) = match unpacked {
                    Some(unc) => (file.len as u32, unc),
                    None => (0, file.len as u32),
                };
                let same = info.offset() == place.offset
                    && info.stored_size == stored
                    && info.uncompressed_size == unc
                    && !info.encrypted;
                if !same {
                    return Err(damaged(format!("{} differs from the plan.", file.path)));
                }
            }
            _ => return Err(damaged(format!("{} has another kind than the plan.", file.path))),
        }
        ids.push(id);
    }
    Ok(ids)
}

// ---------------------------------------------------------------------------
// Без открытой сборки: что осталось от недостроенной, отмена
// ---------------------------------------------------------------------------

/// Что маркер знает о недостроенной сборке.
#[derive(Clone, Debug)]
pub struct Found {
    pub name: String,
    pub files: usize,
    pub laid: usize,
    pub total: u64,
    pub head_len: u64,
    pub sealing: bool,
    pub sealed: bool,
    pub part_present: bool,
    pub part_len: u64,
    pub created_ms: u64,
    /// Сборка «следом» (`follow`): длина файла заранее не известна.
    pub follow: bool,
}

/// Читает маркер у `output`, ничего не меняя. `None` — маркера нет.
pub fn found(output: &Path) -> Result<Option<Found>, AppendError> {
    let Some(state) = marker::read(&marker_path(output))? else {
        return Ok(None);
    };
    let part = part_path(output);
    let part_len = fs::metadata(&part).map(|meta| meta.len()).ok();
    let Some(begin) = state.begin else {
        return Ok(Some(Found {
            name: String::new(),
            files: 0,
            laid: 0,
            total: 0,
            head_len: 0,
            sealing: false,
            sealed: false,
            part_present: part_len.is_some(),
            part_len: part_len.unwrap_or(0),
            created_ms: 0,
            follow: false,
        }));
    };
    Ok(Some(Found {
        name: begin.name,
        files: begin.files as usize,
        laid: state.laid.len(),
        total: begin.total,
        head_len: begin.head_len,
        sealing: state.sealing.is_some(),
        sealed: state.sealed.is_some(),
        part_present: part_len.is_some(),
        part_len: part_len.unwrap_or(0),
        created_ms: begin.created_ms,
        follow: begin.follow,
    }))
}

/// Что сделала отмена.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cancelled {
    pub part_removed: bool,
    pub marker_removed: bool,
    pub freed: u64,
}

/// Отмена без открытой сборки: файл и маркер убираются, если файл доказан нашим
/// (длина, номер файла, начало). Чужой файл — `BuildForeign`, ничего не тронуто.
/// Нет маркера, а файл есть — тоже чужой.
pub fn cancel_unfinished(host: &dyn Host, output: &Path) -> Result<Cancelled, AppendError> {
    let marker_file = marker_path(output);
    let part = part_path(output);
    let state = marker::read(&marker_file)?;
    let Some(state) = state else {
        if part.exists() {
            return Err(refused(
                Code::BuildForeign,
                "A file without a marker lies where the unfinished archive would be; it is left alone.",
            ));
        }
        return Ok(Cancelled {
            part_removed: false,
            marker_removed: false,
            freed: 0,
        });
    };
    let mut freed = 0;
    let mut part_removed = false;
    if part.exists() {
        if let Some(begin) = &state.begin {
            let mut file = open_part(&part, false)?;
            if begin.follow {
                follow::prove_open_part(host, &mut file, &state, begin.head_len)?;
            } else {
                prove_part(host, &mut file, &state, begin.total, begin.head_len)?;
            }
            freed = file.metadata()?.len();
        } else {
            return Err(refused(
                Code::BuildForeign,
                "A file lies beside a marker that never began; it is left alone.",
            ));
        }
        remove_if_exists(&part)?;
        part_removed = true;
    }
    marker::remove(&marker_file)?;
    Ok(Cancelled {
        part_removed,
        marker_removed: true,
        freed,
    })
}
