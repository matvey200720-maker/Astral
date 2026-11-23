//! Новый архив «следом» за сборщиком: тела ложатся в файл по мере того, как
//! сборщик их закончил, размеры приходят по ходу.
//!
//! Продолжение `dlc` (E3-3): там список записей с размерами известен до первого
//! байта, здесь заранее известны только **имена и порядок**, а длина каждого тела
//! становится известна, когда оно пришло. Итог — те же байты, что дал бы обычный
//! поток (`dlc::Build`) на тех же файлах: раскладка считается тем же кодом
//! (`SizedPlan`), голова ложится последней, ключ шифра оглавления берётся по имени
//! и итоговой длине.
//!
//! Что от чего зависит (решение, ради которого написан этот модуль):
//!
//! * Длина головы (оглавление и блок имён, добитые до границы блока) зависит от
//!   числа и имён записей, а не от размеров тел. Поэтому место под голову занимается
//!   сразу, а её содержимое (смещения и размеры) пишется при печати.
//! * Тела лежат в порядке таблицы, одно за другим; смещение тела — сумма мест всех
//!   предыдущих. Тело можно положить, только когда известны длины всех, что стоят
//!   перед ним. Поэтому тела ложатся строго по порядку плана, и тот, кто пришёл раньше
//!   очереди, ждёт на диске в папке сборщика (а потом читается из кэша системы).
//! * Вложенный архив — одна сплошная запись родителя. Он строится **на месте**:
//!   его голова занимает место сразу (длина известна по именам), тела его файлов
//!   ложатся следом, а когда пришёл последний, длина вложенного известна, его голова
//!   (ключ шифра зависит от длины) пишется на своё место, и родитель идёт дальше с
//!   того байта, где кончился вложенный. Вложенные идут по очереди, как стоят в
//!   таблице родителя. Промежуточного файла вложенного нет: тело не пишется дважды.
//! * SHA-256 файла по ходу записи считать нельзя: файл начинается с головы, а голова
//!   известна последней. Отпечаток считается одним проходом по готовому файлу при
//!   печати (его читают из кэша системы, файл только что записан); заодно проход
//!   сверяет каждое тело с его SHA-256 при записи (`hashStreamed: false`).
//!
//! Порядок на диске (как у `dlc`): маркер `<архив>.astral-building`, потом файл
//! `<архив>.astral-part`, который растёт по мере записи (длина заранее неизвестна;
//! место можно занять сразу ключом `reserve`). До печати первые байты файла нули:
//! файл не архив ни для читателя, ни для игры. Голова корня ложится в два приёма,
//! файл встаёт на место переименованием.
//!
//! Резюме и обрыв: каждое лёгшее и сброшенное на диск тело попадает в маркер кадром
//! вида 6 (SHA-256 тела, слова ресурса и длина). Повторный вызов с тем же планом
//! перечитывает лёгшее, сверяет с маркером и продолжает с границы последнего
//! сброшенного. Головы закрытых вложенных архивов повторно пишутся при резюме (они
//! однозначно выводятся из длин и слов).

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use sha2::{Digest as _, Sha256};

use super::{
    check_table, is_zero, marker, marker_path, now_ms, open_part, part_path, read_exactly,
    remove_if_exists, rsc7_words, sha256, Mode, Sealed, Settings, ZERO_PROBE, PORTION,
};
use super::Verify;
use crate::{
    activity,
    append::{AppendError, Code, Facts, Host},
    archive::Archive,
    error::RpfError,
    journal::Digest,
    keys::KeySet,
    source::FileSource,
    toc::{Encryption, BLOCK},
    write::{
        extended_size_bytes,
        sized::{check_place, SizedFile, SizedKind, SizedPlan},
        EXTENDED_SIZE_FROM,
    },
};
use marker::{Begin, Frame, Laid, PartId, Sealing, State};

/// Файл растёт не мелкими шагами: за один раз не меньше этого.
const GROW_STEP: u64 = 64 << 20;
/// Выше этого размера архива порядок тел другой (ресурсы вперёд, как у писателя
/// по готовым файлам): сборка «следом» его не умеет и отказывает заранее.
pub const FOLLOW_LIMIT: u64 = 4 << 30;
/// Глубже вложенных архивов не бывает.
const MAX_DEPTH: usize = 8;

fn refused(code: Code, text: impl Into<String>) -> AppendError {
    AppendError::refused(code, text)
}

fn argument(text: impl Into<String>) -> AppendError {
    AppendError::Other(RpfError::argument(text))
}

/// Вид записи в плане.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FollowKind {
    /// Вид определяется по первым байтам пришедшего тела: `RSC7` — ресурс (слова
    /// берутся из заголовка), иначе двоичная запись как есть.
    Auto,
    /// Ресурс; слова, если названы, сверяются с заголовком.
    Resource { words: Option<(u32, u32)> },
    /// Двоичная запись; `Some(n)` — лежит сжатой, `n` — длина после распаковки.
    Binary { unpacked: Option<u32> },
}

/// Одна запись плана: путь, вид и то, что известно заранее.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FollowSpec {
    /// Путь от корня архива с прямыми косыми. Звено, которое называет вложенный
    /// архив (имя на `.rpf`) и не последнее, делает остаток пути записью вложенного
    /// архива: тот строится на месте.
    pub path: String,
    pub kind: FollowKind,
    /// Хранимая длина, если она известна заранее (тогда пришедшее тело обязано
    /// быть такой длины).
    pub len: Option<u64>,
    /// SHA-256 тела так, как оно придёт.
    pub sha256: Option<Digest>,
}

/// Чьё тело должно прийти следующим.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Want {
    /// Номер записи в списке плана.
    pub index: usize,
    pub path: String,
    /// Длина, названная в плане.
    pub known: Option<u64>,
}

/// Хэш плана «следом»: имя архива и записи с видами, названными длинами, словами и
/// ожидаемыми SHA-256. Длины, которые придут по ходу, в него не входят.
pub fn follow_plan_hash(name: &str, specs: &[FollowSpec]) -> Digest {
    let mut sum = Sha256::new();
    let mut text = |bytes: &[u8]| {
        sum.update((bytes.len() as u64).to_le_bytes());
        sum.update(bytes);
    };
    text(b"ASTRFLW1");
    text(name.as_bytes());
    for spec in specs {
        text(spec.path.as_bytes());
        match spec.kind {
            FollowKind::Auto => text(b"A"),
            FollowKind::Resource { words } => {
                text(b"R");
                let (system, graphics) = words.unwrap_or((0, 0));
                text(&[u8::from(words.is_some())]);
                text(&system.to_le_bytes());
                text(&graphics.to_le_bytes());
            }
            FollowKind::Binary { unpacked } => {
                text(b"B");
                text(&[u8::from(unpacked.is_some())]);
                text(&unpacked.unwrap_or(0).to_le_bytes());
            }
        }
        match spec.len {
            Some(len) => {
                text(&[1]);
                text(&len.to_le_bytes());
            }
            None => text(&[0]),
        }
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

// ---------------------------------------------------------------------------
// Устройство плана: архивы, записи, порядок событий
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
enum Slot {
    /// Запись с телом: номер в списке плана.
    Leaf(usize),
    /// Вложенный архив: номер узла.
    Archive(usize),
}

#[derive(Clone, Copy, Debug)]
enum Event {
    Enter(usize),
    Leaf,
    Exit(usize),
}

/// Один архив дерева: корень или вложенный.
struct Node {
    /// У корня — имя архива (по нему и длине выбирается ключ шифра), у вложенного —
    /// звено пути записи.
    name: String,
    parent: Option<usize>,
    /// Прямые записи в порядке списка: путь от начала этого архива и ячейка.
    entries: Vec<(String, Slot)>,
    /// Те же записи (номера в `entries`) в порядке записи тел.
    order: Vec<usize>,
    head_len: u64,
    rows: usize,
}

/// Устройство плана до первого байта.
struct Shape {
    nodes: Vec<Node>,
    events: Vec<Event>,
    /// Записи списка в порядке записи (тела приходят в этом порядке).
    seq: Vec<usize>,
    /// Узел и номер прямой записи для каждой записи списка.
    slot_of: Vec<(usize, usize)>,
}

fn placeholder(kind: FollowKind) -> (SizedKind, u64) {
    match kind {
        FollowKind::Auto => (SizedKind::Binary { unpacked: None }, 0),
        FollowKind::Resource { .. } => (SizedKind::Resource { words: None }, 16),
        FollowKind::Binary { unpacked: None } => (SizedKind::Binary { unpacked: None }, 0),
        FollowKind::Binary { unpacked: Some(unc) } => {
            (SizedKind::Binary { unpacked: Some(unc) }, 1)
        }
    }
}

fn shape_of(name: &str, specs: &[FollowSpec]) -> Result<Shape, AppendError> {
    if specs.is_empty() {
        return Err(argument("The list of entries is empty."));
    }
    let mut nodes = vec![Node {
        name: name.to_owned(),
        parent: None,
        entries: Vec::new(),
        order: Vec::new(),
        head_len: 0,
        rows: 0,
    }];
    let mut archives: HashMap<(usize, String), usize> = HashMap::new();
    let mut leaves: HashSet<(usize, String)> = HashSet::new();
    let mut slot_of = vec![(0usize, 0usize); specs.len()];
    for (index, spec) in specs.iter().enumerate() {
        let parts: Vec<&str> = spec.path.split('/').collect();
        if parts.iter().any(|part| part.is_empty()) {
            return Err(argument(format!("The entry path {:?} is not valid.", spec.path)));
        }
        let mut node = 0usize;
        let mut start = 0usize;
        for (at, part) in parts.iter().enumerate() {
            if at + 1 == parts.len() || !Archive::is_nested_archive_name(part) {
                continue;
            }
            let rel = parts[start..=at].join("/");
            let key = (node, rel.to_ascii_lowercase());
            if leaves.contains(&key) {
                return Err(argument(format!(
                    "{rel} is listed both as a file and as an archive with entries."
                )));
            }
            node = match archives.get(&key) {
                Some(&known) => known,
                None => {
                    if nodes.len() >= u16::MAX as usize {
                        return Err(argument("Too many nested archives."));
                    }
                    let child = nodes.len();
                    nodes.push(Node {
                        name: (*part).to_owned(),
                        parent: Some(node),
                        entries: Vec::new(),
                        order: Vec::new(),
                        head_len: 0,
                        rows: 0,
                    });
                    nodes[node].entries.push((rel.clone(), Slot::Archive(child)));
                    archives.insert(key, child);
                    child
                }
            };
            start = at + 1;
        }
        let rel = parts[start..].join("/");
        let key = (node, rel.to_ascii_lowercase());
        if archives.contains_key(&key) {
            return Err(argument(format!(
                "{rel} is listed both as a file and as an archive with entries."
            )));
        }
        if !leaves.insert(key) {
            return Err(argument(format!("The entry {:?} is listed twice.", spec.path)));
        }
        slot_of[index] = (node, nodes[node].entries.len());
        nodes[node].entries.push((rel, Slot::Leaf(index)));
    }

    // раскладка по именам каждого архива: длина головы и порядок записи тел
    for node in &mut nodes {
        let files: Vec<SizedFile> = node
            .entries
            .iter()
            .map(|(rel, slot)| {
                let (kind, len) = match slot {
                    Slot::Leaf(index) => placeholder(specs[*index].kind),
                    Slot::Archive(_) => (SizedKind::Binary { unpacked: None }, 0),
                };
                SizedFile {
                    path: rel.clone(),
                    kind,
                    len,
                }
            })
            .collect();
        let plan = SizedPlan::prepare(files)?;
        node.head_len = plan.head_len();
        node.rows = plan.entries();
        node.order = plan.order().to_vec();
    }

    // порядок событий: вход в архив, его записи по порядку, выход
    let mut events = Vec::new();
    let mut seq = Vec::new();
    let mut stack: Vec<(usize, usize)> = vec![(0, 0)];
    events.push(Event::Enter(0));
    while let Some(&(node, next)) = stack.last() {
        if stack.len() > MAX_DEPTH {
            return Err(argument("Archives are nested too deep."));
        }
        let Some(&entry) = nodes[node].order.get(next) else {
            events.push(Event::Exit(node));
            stack.pop();
            continue;
        };
        if let Some(top) = stack.last_mut() {
            top.1 += 1;
        }
        match nodes[node].entries[entry].1 {
            Slot::Leaf(index) => {
                events.push(Event::Leaf);
                seq.push(index);
            }
            Slot::Archive(child) => {
                events.push(Event::Enter(child));
                stack.push((child, 0));
            }
        }
    }
    Ok(Shape {
        nodes,
        events,
        seq,
        slot_of,
    })
}

// ---------------------------------------------------------------------------
// Ход сборки
// ---------------------------------------------------------------------------

/// Участок файла в порядке байт: голова архива или тело записи с добивкой.
#[derive(Clone, Copy, Debug)]
enum What {
    Head(usize),
    Body(u32),
}

#[derive(Clone, Copy, Debug)]
struct Region {
    offset: u64,
    len: u64,
    span: u64,
    what: What,
}

/// Закрытый архив: итоговая раскладка, голова и итоговая длина.
struct Closed {
    plan: SizedPlan,
    head: Vec<u8>,
    total: u64,
}

#[derive(Default)]
struct Run {
    base: u64,
    cursor: u64,
    /// Смещение и длина тела каждой прямой записи, когда она легла.
    placed: Vec<Option<(u64, u64)>>,
    kinds: Vec<Option<SizedKind>>,
    closed: Option<Closed>,
}

/// Что открыто.
pub enum Opened<'h> {
    Build(Box<Follow<'h>>),
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
    pub resumed_files: usize,
    pub resumed_bytes: u64,
    /// Вложенных архивов в плане и сколько из них закрыто (голова на месте).
    pub archives: usize,
    pub archives_closed: usize,
}

/// Проверка перед началом новой сборки: сколько места надо занять (хотя бы).
pub type Room<'a> = &'a mut dyn FnMut(u64) -> Result<(), AppendError>;

/// Сборка нового архива «следом».
pub struct Follow<'h> {
    host: &'h dyn Host,
    output: PathBuf,
    part: PathBuf,
    marker: PathBuf,
    name: String,
    keys: Option<Arc<KeySet>>,
    specs: Vec<FollowSpec>,
    shape: Shape,
    settings: Settings,
    reserve: u64,
    run: Vec<Run>,
    ev: usize,
    file: Option<File>,
    /// Длина файла на диске (то, до чего он вытянут).
    alloc: u64,
    state: State,
    laid: Vec<Laid>,
    lens: Vec<u64>,
    durable: usize,
    pending_files: usize,
    pending_bytes: u64,
    regions: Vec<Region>,
    head_sha: Vec<Option<Digest>>,
    buffer: Vec<u8>,
    resumed_files: usize,
    resumed_bytes: u64,
    session_bytes: u64,
}

fn read_full(reader: &mut dyn Read, out: &mut [u8]) -> io::Result<usize> {
    let mut got = 0;
    while got < out.len() {
        match reader.read(&mut out[got..]) {
            Ok(0) => break,
            Ok(n) => got += n,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(got)
}

impl<'h> Follow<'h> {
    /// Открывает сборку: начинает новую или продолжает оставленную. `reserve` —
    /// сколько байт занять в файле сразу (0 — файл растёт по мере записи).
    #[allow(clippy::too_many_arguments)]
    pub fn open(
        host: &'h dyn Host,
        output: &Path,
        name: &str,
        specs: Vec<FollowSpec>,
        settings: Settings,
        keys: Option<Arc<KeySet>>,
        mode: Mode,
        reserve: u64,
        room: Room<'_>,
    ) -> Result<Opened<'h>, AppendError> {
        if name.is_empty() || !name.is_ascii() {
            return Err(argument("The archive name must be ASCII and not empty."));
        }
        let mut settings = settings;
        settings.max_bytes = settings.max_bytes.min(FOLLOW_LIMIT);
        let shape = shape_of(name, &specs)?;
        let runs = shape
            .nodes
            .iter()
            .map(|node| Run {
                placed: vec![None; node.entries.len()],
                kinds: vec![None; node.entries.len()],
                ..Run::default()
            })
            .collect::<Vec<_>>();
        let head_sha = vec![None; shape.nodes.len()];
        let root_head = shape.nodes[0].head_len;
        if root_head > settings.max_bytes {
            return Err(refused(
                Code::ArchiveTooLarge,
                "The head of the archive alone is longer than the limit.",
            ));
        }
        let mut follow = Follow {
            host,
            output: output.to_path_buf(),
            part: part_path(output),
            marker: marker_path(output),
            name: name.to_owned(),
            keys,
            specs,
            shape,
            settings,
            reserve: reserve.min(settings.max_bytes),
            run: runs,
            ev: 0,
            file: None,
            alloc: 0,
            state: State::default(),
            laid: Vec::new(),
            lens: Vec::new(),
            durable: 0,
            pending_files: 0,
            pending_bytes: 0,
            regions: Vec::new(),
            head_sha,
            buffer: Vec::new(),
            resumed_files: 0,
            resumed_bytes: 0,
            session_bytes: 0,
        };
        let left = marker::read(&follow.marker)?;
        match (left, mode) {
            (Some(state), Mode::Fresh) if state.begin.is_some() => Err(refused(
                Code::BuildExists,
                "An unfinished build of this archive is already there.",
            )),
            (Some(state), _) => follow.resume(state, room),
            (None, Mode::ResumeOnly) => Err(argument("There is no unfinished build to resume.")),
            (None, _) => {
                follow.start(room)?;
                Ok(Opened::Build(Box::new(follow)))
            }
        }
    }

    fn begin_frame(&self) -> Begin {
        Begin {
            plan_hash: follow_plan_hash(&self.name, &self.specs),
            total: 0,
            head_len: self.shape.nodes[0].head_len,
            files: self.specs.len() as u32,
            name: self.name.clone(),
            words_known: false,
            follow: true,
            created_ms: now_ms(),
        }
    }

    fn hit(&self, point: &str) {
        self.host.hit(point);
    }

    fn file_mut(&mut self) -> Result<&mut File, AppendError> {
        self.file
            .as_mut()
            .ok_or_else(|| argument("The unfinished file is not open."))
    }

    /// Нижняя оценка места, которое займёт файл: голова корня, названные длины.
    fn floor(&self) -> u64 {
        let named: u64 = self
            .specs
            .iter()
            .filter_map(|spec| spec.len)
            .map(|len| len.div_ceil(BLOCK) * BLOCK)
            .sum();
        let heads: u64 = self.shape.nodes.iter().map(|node| node.head_len).sum();
        named + heads
    }

    /// Новая сборка: маркер, потом файл.
    fn start(&mut self, room: Room<'_>) -> Result<(), AppendError> {
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
        room(self.reserve.max(self.floor()))?;
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
        let first = self.reserve.max(self.shape.nodes[0].head_len);
        if let Err(error) = file.set_len(first) {
            drop(file);
            let _ = fs::remove_file(&self.part);
            let _ = marker::remove(&self.marker);
            return Err(error.into());
        }
        self.alloc = first;
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
        self.settle()?;
        self.hit("dlc-after-begin");
        Ok(())
    }

    /// Оставленная сборка: маркер и файл сверяются, лёгшее перечитывается.
    fn resume(mut self, state: State, room: Room<'_>) -> Result<Opened<'h>, AppendError> {
        let Some(begin) = state.begin.clone() else {
            // маркер создавался и оборвался: файла ещё не было
            if self.part.exists() {
                return Err(refused(
                    Code::BuildForeign,
                    "A file lies beside a marker that never began; it is left alone.",
                ));
            }
            marker::remove(&self.marker)?;
            self.start(room)?;
            return Ok(Opened::Build(Box::new(self)));
        };
        if !begin.follow
            || begin.plan_hash != follow_plan_hash(&self.name, &self.specs)
            || begin.head_len != self.shape.nodes[0].head_len
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
            let first = self.reserve.max(self.shape.nodes[0].head_len);
            file.set_len(first)?;
            self.alloc = first;
            let facts = self.host.facts(&file)?;
            marker::append(
                &self.marker,
                &mut self.state,
                vec![Frame::Part(PartId {
                    identity: facts.identity,
                })],
            )?;
            self.file = Some(file);
            self.settle()?;
            return Ok(Opened::Build(Box::new(self)));
        }
        let mut file = open_part(&self.part, false)?;
        prove_open_part(self.host, &mut file, &self.state, self.shape.nodes[0].head_len)?;
        if self.state.part.is_none() {
            let facts = self.host.facts(&file)?;
            marker::append(
                &self.marker,
                &mut self.state,
                vec![Frame::Part(PartId {
                    identity: facts.identity,
                })],
            )?;
        }
        self.alloc = file.metadata()?.len();
        self.file = Some(file);
        self.settle()?;
        self.replay()?;
        self.hit("dlc-after-resume");
        Ok(Opened::Build(Box::new(self)))
    }

    /// Файл на месте готового: длина и SHA-256 равны записанным в маркере.
    fn confirm_in_place(&mut self, sealed: &marker::Sealed) -> Result<Sealed, AppendError> {
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
            entries: self.shape.nodes[0].rows,
            files: self.specs.len(),
            head_len: self.shape.nodes[0].head_len,
            hash_streamed: false,
            verified: Verify::Full,
            bytes_written: 0,
            bytes_resumed: len,
            seal_ms: 0,
            verify_ms: 0,
            already_in_place: true,
        })
    }

    // ----- события: входы и выходы архивов -----

    /// Проходит события до следующего тела: открывает вложенные архивы (занимает
    /// место под голову) и закрывает кончившиеся (пишет голову на её место).
    fn settle(&mut self) -> Result<(), AppendError> {
        while let Some(&event) = self.shape.events.get(self.ev) {
            match event {
                Event::Leaf => break,
                Event::Enter(node) => self.enter(node)?,
                Event::Exit(node) => self.exit(node)?,
            }
            self.ev += 1;
        }
        Ok(())
    }

    fn enter(&mut self, node: usize) -> Result<(), AppendError> {
        let base = match self.shape.nodes[node].parent {
            Some(parent) => self.run[parent].cursor,
            None => 0,
        };
        let head_len = self.shape.nodes[node].head_len;
        let cursor = base + head_len;
        if cursor > self.settings.max_bytes {
            return Err(refused(
                Code::ArchiveTooLarge,
                format!(
                    "The archive would be longer than the limit of {} bytes.",
                    self.settings.max_bytes
                ),
            ));
        }
        self.ensure_len(cursor)?;
        self.run[node].base = base;
        self.run[node].cursor = cursor;
        self.regions.push(Region {
            offset: base,
            len: head_len,
            span: head_len,
            what: What::Head(node),
        });
        Ok(())
    }

    /// Все записи архива легли: итоговая раскладка по настоящим длинам, она обязана
    /// совпасть с тем, как тела легли; голова вложенного пишется на своё место, а у
    /// корня ждёт печати.
    fn exit(&mut self, node: usize) -> Result<(), AppendError> {
        let damaged = |text: &str| refused(Code::BuildDamaged, text.to_owned());
        let base = self.run[node].base;
        let entries = &self.shape.nodes[node].entries;
        let mut files = Vec::with_capacity(entries.len());
        for (at, (rel, slot)) in entries.iter().enumerate() {
            let (kind, len) = match slot {
                Slot::Leaf(_) => {
                    let (Some(kind), Some((_, len))) = (self.run[node].kinds[at], self.run[node].placed[at])
                    else {
                        return Err(damaged("An archive was closed before all its bodies were laid."));
                    };
                    (kind, len)
                }
                Slot::Archive(child) => {
                    let Some(closed) = &self.run[*child].closed else {
                        return Err(damaged("A nested archive was not closed before its parent."));
                    };
                    (SizedKind::Binary { unpacked: None }, closed.total)
                }
            };
            files.push(SizedFile {
                path: rel.clone(),
                kind,
                len,
            });
        }
        let plan = SizedPlan::prepare(files)?;
        let node_info = &self.shape.nodes[node];
        let same = plan.size() == self.run[node].cursor - base
            && plan.head_len() == node_info.head_len
            && plan.order() == node_info.order.as_slice()
            && (0..entries.len()).all(|at| {
                self.run[node].placed[at]
                    .is_none_or(|(offset, _)| offset - base == plan.place(at).offset)
            });
        if !same {
            return Err(damaged("The layout changed after the bodies of the archive arrived."));
        }
        let total = plan.size();
        let Some(keys) = self.keys.clone() else {
            return Err(AppendError::Other(RpfError::keys("Sealing needs the key set.")));
        };
        let head = plan.sealed_head(&node_info.name, &keys)?;
        let parent = node_info.parent;
        if let Some(parent) = parent {
            // тело вложенного — запись родителя: те же пределы формата
            let at = self.shape.nodes[parent]
                .entries
                .iter()
                .position(|(_, slot)| matches!(slot, Slot::Archive(child) if *child == node))
                .ok_or_else(|| damaged("A nested archive is not an entry of its parent."))?;
            let rel = self.shape.nodes[parent].entries[at].0.clone();
            let parent_base = self.run[parent].base;
            check_place(
                &SizedFile {
                    path: rel,
                    kind: SizedKind::Binary { unpacked: None },
                    len: total,
                },
                base - parent_base,
            )?;
            self.hit(&format!("follow-before-nested-head-{node}"));
            {
                let file = self.file_mut()?;
                file.seek(SeekFrom::Start(base))?;
                file.write_all(&head)?;
            }
            self.session_bytes += head.len() as u64;
            self.hit(&format!("follow-after-nested-head-{node}"));
            self.run[parent].placed[at] = Some((base, total));
            self.run[parent].kinds[at] = Some(SizedKind::Binary { unpacked: None });
            self.run[parent].cursor = base + total;
        }
        self.head_sha[node] = Some(sha256(&head));
        self.run[node].closed = Some(Closed { plan, head, total });
        Ok(())
    }

    /// Файл вытянут не меньше `end`; растёт большими шагами.
    fn ensure_len(&mut self, end: u64) -> Result<(), AppendError> {
        if end <= self.alloc {
            return Ok(());
        }
        let cap = self.settings.max_bytes;
        let target = end.max(self.alloc.saturating_add(GROW_STEP).min(cap));
        self.file_mut()?.set_len(target)?;
        self.alloc = target;
        Ok(())
    }

    // ----- резюме -----

    /// Лёгшие тела перечитываются, SHA-256 каждого сверяется с маркером, места
    /// раздаются заново по длинам из маркера (закрытые вложенные архивы получают
    /// головы снова). Курсор — на границе последнего сброшенного.
    fn replay(&mut self) -> Result<(), AppendError> {
        let rows = self.state.laid.clone();
        let lens = self.state.lens.clone();
        if rows.len() != lens.len() {
            return Err(refused(
                Code::BuildDamaged,
                "The marker has bodies without lengths.",
            ));
        }
        let mut buffer = std::mem::take(&mut self.buffer);
        let outcome = (|| -> Result<(), AppendError> {
            for (pos, (row, &len)) in rows.iter().zip(&lens).enumerate() {
                let Some(&index) = self.shape.seq.get(pos) else {
                    return Err(refused(Code::BuildDamaged, "The marker has more bodies than the plan."));
                };
                let spec = self.specs[index].clone();
                if spec.len.is_some_and(|known| known != len) {
                    return Err(refused(
                        Code::BuildPlanChanged,
                        format!("The marker names another length for {}.", spec.path),
                    ));
                }
                let kind = match (spec.kind, row.words) {
                    (FollowKind::Auto, Some(words)) => SizedKind::Resource { words: Some(words) },
                    (FollowKind::Auto, None) => SizedKind::Binary { unpacked: None },
                    (FollowKind::Resource { .. }, words) => SizedKind::Resource { words },
                    (FollowKind::Binary { unpacked }, _) => SizedKind::Binary { unpacked },
                };
                let (node, entry) = self.shape.slot_of[index];
                let offset = self.run[node].cursor;
                let place_check = SizedFile {
                    path: self.shape.nodes[node].entries[entry].0.clone(),
                    kind,
                    len,
                };
                check_place(&place_check, offset - self.run[node].base)?;
                let span = len.div_ceil(BLOCK) * BLOCK;
                if offset + span > self.alloc {
                    return Err(refused(
                        Code::BuildDamaged,
                        format!("Laid body {pos} lies beyond the end of the unfinished file."),
                    ));
                }
                let mut sum = Sha256::new();
                let mut file = self
                    .file
                    .take()
                    .ok_or_else(|| argument("The unfinished file is not open."))?;
                let read = read_exactly(&mut file, offset, len, &mut buffer, |chunk| sum.update(chunk));
                let mut zero = true;
                let pad = span - len;
                let padded = if read.is_ok() && pad > 0 {
                    read_exactly(&mut file, offset + len, pad, &mut buffer, |chunk| {
                        zero &= is_zero(chunk);
                    })
                } else {
                    Ok(())
                };
                self.file = Some(file);
                read?;
                padded?;
                if !zero {
                    return Err(refused(
                        Code::BuildDamaged,
                        format!("The padding after laid body {pos} is not zeros."),
                    ));
                }
                let got: Digest = sum.finalize().into();
                if got != row.sha {
                    return Err(refused(
                        Code::BuildDamaged,
                        format!("Laid body {pos} differs from what the marker recorded."),
                    ));
                }
                self.commit(index, offset, len, kind, *row)?;
            }
            Ok(())
        })();
        self.buffer = buffer;
        outcome?;
        self.durable = self.laid.len();
        self.resumed_files = self.laid.len();
        self.resumed_bytes = self.lens.iter().sum();
        Ok(())
    }

    // ----- ход работы -----

    /// Сколько сделано.
    pub fn counts(&self) -> Counts {
        let archives = self.shape.nodes.len() - 1;
        Counts {
            files: self.specs.len(),
            laid: self.laid.len(),
            durable: self.durable,
            bytes_laid: self.lens.iter().sum(),
            resumed_files: self.resumed_files,
            resumed_bytes: self.resumed_bytes,
            archives,
            archives_closed: (1..self.shape.nodes.len())
                .filter(|&node| self.run[node].closed.is_some())
                .count(),
        }
    }

    /// Записи в том порядке, в каком их тела ложатся в файл (номера в списке плана).
    pub fn order(&self) -> &[usize] {
        &self.shape.seq
    }

    /// Записано этим вызовом: тела и головы вложенных.
    pub fn session_bytes(&self) -> u64 {
        self.session_bytes
    }

    /// Чьё тело должно прийти следующим; `None` — все легли.
    pub fn want(&self) -> Option<Want> {
        let &index = self.shape.seq.get(self.laid.len())?;
        let spec = &self.specs[index];
        Some(Want {
            index,
            path: spec.path.clone(),
            known: spec.len,
        })
    }

    /// Кладёт тело, которое должно прийти следующим. `len` — его хранимая длина;
    /// `reader` отдаёт ровно столько байт (больше или меньше — `SizeMismatch`).
    /// Ошибка оставляет сборку как была до вызова: тело можно прислать заново.
    pub fn lay(
        &mut self,
        len: u64,
        reader: &mut dyn Read,
        meter: &mut dyn FnMut(u64),
    ) -> Result<(), AppendError> {
        self.lay_checked(len, None, reader, meter)
    }

    /// То же, но с SHA-256 тела, который назвал сборщик: не сошёлся — `HashMismatch`,
    /// тело не засчитывается.
    pub fn lay_checked(
        &mut self,
        len: u64,
        claimed: Option<Digest>,
        reader: &mut dyn Read,
        meter: &mut dyn FnMut(u64),
    ) -> Result<(), AppendError> {
        let Some(&index) = self.shape.seq.get(self.laid.len()) else {
            return Err(argument("Every body is already laid."));
        };
        let mut buffer = std::mem::take(&mut self.buffer);
        let outcome = self.lay_inner(index, len, claimed, reader, meter, &mut buffer);
        self.buffer = buffer;
        outcome
    }

    #[allow(clippy::too_many_arguments)]
    fn lay_inner(
        &mut self,
        index: usize,
        len: u64,
        claimed: Option<Digest>,
        reader: &mut dyn Read,
        meter: &mut dyn FnMut(u64),
        buffer: &mut Vec<u8>,
    ) -> Result<(), AppendError> {
        activity::check()?;
        let spec = self.specs[index].clone();
        if let Some(known) = spec.len {
            if known != len {
                return Err(refused(
                    Code::SizeMismatch,
                    format!("{} comes as {len} bytes; the plan names {known}.", spec.path),
                ));
            }
        }
        let short = |path: &str| {
            refused(
                Code::SizeMismatch,
                format!("The source of {path} ended before the announced {len} bytes."),
            )
        };
        let mut head = [0u8; 16];
        let take = len.min(16) as usize;
        if read_full(reader, &mut head[..take])? < take {
            return Err(short(&spec.path));
        }
        let looks_like_resource = len >= 16 && &head[..4] == b"RSC7";
        let kind = match spec.kind {
            FollowKind::Auto if looks_like_resource => SizedKind::Resource {
                words: Some(rsc7_words(&head)?),
            },
            FollowKind::Auto => SizedKind::Binary { unpacked: None },
            FollowKind::Resource { words } => {
                let found = rsc7_words(&head)?;
                if words.is_some_and(|named| named != found) {
                    return Err(AppendError::Other(RpfError::format(
                        "The words of a resource differ from the planned ones.",
                    )));
                }
                SizedKind::Resource { words: Some(found) }
            }
            FollowKind::Binary { unpacked } => SizedKind::Binary { unpacked },
        };
        let is_resource = matches!(kind, SizedKind::Resource { .. });
        let (node, entry) = self.shape.slot_of[index];
        let offset = self.run[node].cursor;
        let described = SizedFile {
            path: self.shape.nodes[node].entries[entry].0.clone(),
            kind,
            len,
        };
        check_place(&described, offset - self.run[node].base)?;
        let span = len.div_ceil(BLOCK) * BLOCK;
        let end = offset + span;
        if end > self.settings.max_bytes {
            return Err(refused(
                Code::ArchiveTooLarge,
                format!(
                    "The archive would be longer than the limit of {} bytes.",
                    self.settings.max_bytes
                ),
            ));
        }
        self.ensure_len(end)?;
        let pos = self.laid.len();
        self.file_mut()?.seek(SeekFrom::Start(offset))?;

        let patched = is_resource && len >= EXTENDED_SIZE_FROM;
        let mut recv = Sha256::new();
        let mut disk = patched.then(Sha256::new);
        let mut received = 0u64;
        let mut mid = false;
        // начало тела: от 16 МиБ размер лежит в самом ресурсе, заголовок ложится так,
        // как его оставляет настоящий ArchiveFix (нули и четыре байта размера)
        recv.update(&head[..take]);
        let mut first = head;
        if patched {
            first = [0u8; 16];
            for (at, value) in extended_size_bytes(len) {
                first[at] = value;
            }
        }
        if take > 0 {
            self.file_mut()?.write_all(&first[..take])?;
            if let Some(disk) = disk.as_mut() {
                disk.update(&first[..take]);
            }
            received += take as u64;
            self.session_bytes += take as u64;
            meter(take as u64);
            if len > 0 && received * 2 >= len {
                mid = true;
                self.hit(&format!("dlc-in-file-{pos}"));
            }
        }
        while received < len {
            activity::check()?;
            let want = (len - received).min(PORTION as u64) as usize;
            if buffer.len() < want {
                buffer.resize(want, 0);
            }
            let got = match reader.read(&mut buffer[..want]) {
                Ok(0) => return Err(short(&spec.path)),
                Ok(n) => n,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error.into()),
            };
            recv.update(&buffer[..got]);
            self.file_mut()?.write_all(&buffer[..got])?;
            if let Some(disk) = disk.as_mut() {
                disk.update(&buffer[..got]);
            }
            received += got as u64;
            self.session_bytes += got as u64;
            meter(got as u64);
            if !mid && len > 0 && received * 2 >= len {
                mid = true;
                self.hit(&format!("dlc-in-file-{pos}"));
            }
        }
        // больше, чем объявлено: источник вырос после того, как его назвали готовым
        let mut extra = [0u8; 1];
        if read_full(reader, &mut extra)? > 0 {
            return Err(refused(
                Code::SizeMismatch,
                format!("More bytes came for {} than the announced {len}.", spec.path),
            ));
        }
        let arrived: Digest = recv.finalize().into();
        for wanted in [spec.sha256, claimed].into_iter().flatten() {
            if wanted != arrived {
                return Err(refused(
                    Code::HashMismatch,
                    format!("The body of {} does not match its SHA-256.", spec.path),
                ));
            }
        }
        let pad = (span - len) as usize;
        if pad > 0 {
            // добивка до границы блока: нули, записанные явно (на этом месте могло
            // остаться чужое от недописанной попытки)
            let zeros = [0u8; BLOCK as usize];
            self.file_mut()?.write_all(&zeros[..pad])?;
            self.session_bytes += pad as u64;
        }
        let on_disk: Digest = disk.map_or(arrived, |disk| disk.finalize().into());
        let words = match kind {
            SizedKind::Resource { words } => words,
            SizedKind::Binary { .. } => None,
        };
        self.commit(
            index,
            offset,
            len,
            kind,
            Laid {
                pos: pos as u32,
                sha: on_disk,
                words,
            },
        )?;
        self.pending_files += 1;
        self.pending_bytes += len;
        self.hit(&format!("dlc-after-file-{pos}"));
        if self.pending_files >= self.settings.checkpoint_files
            || self.pending_bytes >= self.settings.checkpoint_bytes
        {
            self.checkpoint()?;
        }
        Ok(())
    }

    /// Тело легло: место засчитано, события идут дальше (закрываются кончившиеся
    /// архивы). Общий конец живой записи и резюме.
    fn commit(
        &mut self,
        index: usize,
        offset: u64,
        len: u64,
        kind: SizedKind,
        row: Laid,
    ) -> Result<(), AppendError> {
        let (node, entry) = self.shape.slot_of[index];
        let span = len.div_ceil(BLOCK) * BLOCK;
        let run = &mut self.run[node];
        run.placed[entry] = Some((offset, len));
        run.kinds[entry] = Some(kind);
        run.cursor = offset + span;
        self.regions.push(Region {
            offset,
            len,
            span,
            what: What::Body(row.pos),
        });
        self.laid.push(row);
        self.lens.push(len);
        // событие тела пройдено; следом выходы и входы
        self.ev += 1;
        self.settle()
    }

    /// Тела, которые легли, сбрасываются на диск, и маркер узнаёт о них.
    pub fn checkpoint(&mut self) -> Result<(), AppendError> {
        if self.durable == self.laid.len() {
            return Ok(());
        }
        self.file_mut()?.sync_all()?;
        let rows: Vec<(Laid, u64)> = self.laid[self.durable..]
            .iter()
            .copied()
            .zip(self.lens[self.durable..].iter().copied())
            .collect();
        marker::append(&self.marker, &mut self.state, vec![Frame::LaidSized(rows)])?;
        self.durable = self.laid.len();
        self.pending_files = 0;
        self.pending_bytes = 0;
        self.hit(&format!("dlc-after-checkpoint-{}", self.laid.len()));
        Ok(())
    }

    /// Остановка с возможностью продолжить: всё лёгшее сбрасывается и попадает в
    /// маркер. Файл и маркер остаются.
    pub fn pause(&mut self) -> Result<(), AppendError> {
        self.checkpoint()
    }

    /// Отмена с уборкой: недостроенный файл и маркер убираются.
    pub fn discard(mut self) -> Result<(), AppendError> {
        drop(self.file.take());
        remove_if_exists(&self.part)?;
        marker::remove(&self.marker)?;
        Ok(())
    }

    // ----- печать -----

    /// Печать: голова корня, сброс, строгая сверка, отпечаток, переименование.
    pub fn seal(mut self) -> Result<Sealed, AppendError> {
        let begun = Instant::now();
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
        self.settle()?;
        let Some(keys) = self.keys.clone() else {
            return Err(AppendError::Other(RpfError::keys("Sealing needs the key set.")));
        };
        let Some((head, total)) = self.run[0]
            .closed
            .as_ref()
            .map(|closed| (closed.head.clone(), closed.total))
        else {
            return Err(refused(
                Code::BuildIncomplete,
                "The root archive is not closed; the archive is not sealed.",
            ));
        };
        if total > self.settings.max_bytes {
            return Err(refused(
                Code::ArchiveTooLarge,
                format!(
                    "The archive is {total} bytes; the limit is {} bytes.",
                    self.settings.max_bytes
                ),
            ));
        }
        self.checkpoint()?;
        // файл ровно итоговой длины; всё записанное (и головы вложенных) на диске
        {
            let file = self.file_mut()?;
            file.set_len(total)?;
            file.sync_all()?;
        }
        self.alloc = total;
        marker::append(
            &self.marker,
            &mut self.state,
            vec![Frame::Sealing(Sealing {
                head_sha: sha256(&head),
                digest: None,
            })],
        )?;
        self.hit("dlc-before-head");
        self.write_head(&head)?;
        self.hit("dlc-after-head");

        let verify_began = Instant::now();
        let sha = self.verify_written(&head, total, &keys)?;
        let verify_ms = u64::try_from(verify_began.elapsed().as_millis()).unwrap_or(u64::MAX);
        marker::append(
            &self.marker,
            &mut self.state,
            vec![Frame::Sealed(marker::Sealed { sha, len: total })],
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
            entries: self.shape.nodes[0].rows,
            files: self.specs.len(),
            head_len: self.shape.nodes[0].head_len,
            hash_streamed: false,
            verified: Verify::Full,
            bytes_written: self.session_bytes,
            bytes_resumed: self.resumed_bytes,
            seal_ms: u64::try_from(begun.elapsed().as_millis()).unwrap_or(u64::MAX),
            verify_ms,
            already_in_place: false,
        })
    }

    /// Голова корня ложится в два приёма: всё, кроме первого сектора, потом (после
    /// сброса) первый сектор с магией. Пока второго приёма не было, файл не архив.
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

    /// Строгая сверка записанного и отпечаток файла одним проходом.
    fn verify_written(
        &mut self,
        head: &[u8],
        total: u64,
        keys: &Arc<KeySet>,
    ) -> Result<Digest, AppendError> {
        let damaged = |text: String| refused(Code::BuildDamaged, text);
        let mut buffer = std::mem::take(&mut self.buffer);
        let outcome = (|| -> Result<Digest, AppendError> {
            // голова на диске равна записанной
            let mut file = File::open(&self.part)?;
            let mut on_disk = Vec::with_capacity(head.len());
            read_exactly(&mut file, 0, head.len() as u64, &mut buffer, |chunk| {
                on_disk.extend_from_slice(chunk);
            })?;
            if on_disk != head {
                return Err(damaged("The head on disk is not the one that was written.".to_owned()));
            }
            // строгий читатель и таблицы против плана (корень, при Sample и Full —
            // и вложенные на всех уровнях)
            let source = FileSource::open(&self.part)?;
            let archive = Archive::open(Arc::new(source), &self.name, Some(Arc::clone(keys)))?;
            if archive.encryption() != Encryption::Ng {
                return Err(damaged("The sealed archive is not NG.".to_owned()));
            }
            self.verify_tree(&archive, 0, self.settings.verify != Verify::Table)?;
            // один проход по всему файлу: отпечаток, тела с их SHA-256, добивка, головы
            let mut whole = Sha256::new();
            let mut disk = File::open(&self.part)?;
            let mut at = 0u64;
            for region in &self.regions {
                if region.offset != at {
                    return Err(damaged("The laid bodies do not follow one another.".to_owned()));
                }
                match region.what {
                    What::Head(node) => {
                        let mut sum = Sha256::new();
                        read_exactly(&mut disk, region.offset, region.len, &mut buffer, |chunk| {
                            sum.update(chunk);
                            whole.update(chunk);
                        })?;
                        let got: Digest = sum.finalize().into();
                        if self.head_sha[node] != Some(got) {
                            return Err(damaged(format!(
                                "The head of archive {node} on disk differs from what was written."
                            )));
                        }
                    }
                    What::Body(pos) => {
                        let mut sum = Sha256::new();
                        read_exactly(&mut disk, region.offset, region.len, &mut buffer, |chunk| {
                            sum.update(chunk);
                            whole.update(chunk);
                        })?;
                        let got: Digest = sum.finalize().into();
                        if got != self.laid[pos as usize].sha {
                            return Err(damaged(format!("Body {pos} on disk differs from what was laid.")));
                        }
                        let pad = region.span - region.len;
                        if pad > 0 {
                            let mut zero = true;
                            read_exactly(
                                &mut disk,
                                region.offset + region.len,
                                pad,
                                &mut buffer,
                                |chunk| {
                                    zero &= is_zero(chunk);
                                    whole.update(chunk);
                                },
                            )?;
                            if !zero {
                                return Err(damaged(format!("The padding after body {pos} is not zeros.")));
                            }
                        }
                    }
                }
                at += region.span;
            }
            if at != total {
                return Err(damaged("The laid bodies do not fill the file.".to_owned()));
            }
            Ok(whole.finalize().into())
        })();
        self.buffer = buffer;
        outcome
    }

    /// Таблица открытого архива против итоговой раскладки узла; вложенные архивы
    /// открываются и сверяются так же.
    fn verify_tree(&self, archive: &Archive, node: usize, nested: bool) -> Result<(), AppendError> {
        let Some(closed) = &self.run[node].closed else {
            return Err(refused(Code::BuildDamaged, "An archive was not closed."));
        };
        let ids = check_table(archive, &closed.plan, &[])?;
        if !nested {
            return Ok(());
        }
        for (at, (rel, slot)) in self.shape.nodes[node].entries.iter().enumerate() {
            if let Slot::Archive(child) = slot {
                let inner = archive.open_nested(ids[at]).map_err(|error| {
                    refused(
                        Code::BuildDamaged,
                        format!("The nested archive {rel} does not open: {error}."),
                    )
                })?;
                self.verify_tree(&inner, *child, true)?;
            }
        }
        Ok(())
    }
}

/// Один архив плана: корень или вложенный.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DescribedArchive {
    /// Путь записи вложенного архива от корня (у корня пусто).
    pub path: String,
    /// Имя, по которому выбирается ключ шифра оглавления.
    pub name: String,
    /// Длина головы (оглавление с добивкой до границы блока).
    pub head_len: u64,
    /// Прямых записей (файлов и вложенных архивов) и записей таблицы.
    pub entries: usize,
    pub rows: usize,
}

/// Устройство плана до первого байта: в каком порядке придут тела и какие архивы
/// будут построены. Ничего не пишет.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Described {
    /// Номера записей списка в порядке записи тел.
    pub order: Vec<usize>,
    pub archives: Vec<DescribedArchive>,
}

/// Раскладка плана по именам (длины тел не нужны): порядок записи тел и длины голов.
pub fn describe(name: &str, specs: &[FollowSpec]) -> Result<Described, AppendError> {
    let shape = shape_of(name, specs)?;
    let mut paths = vec![String::new(); shape.nodes.len()];
    for (at, node) in shape.nodes.iter().enumerate() {
        for (rel, slot) in &node.entries {
            if let Slot::Archive(child) = slot {
                paths[*child] = if paths[at].is_empty() {
                    rel.clone()
                } else {
                    format!("{}/{rel}", paths[at])
                };
            }
        }
    }
    let archives = shape
        .nodes
        .iter()
        .enumerate()
        .map(|(at, node)| DescribedArchive {
            path: paths[at].clone(),
            name: node.name.clone(),
            head_len: node.head_len,
            entries: node.entries.len(),
            rows: node.rows,
        })
        .collect();
    Ok(Described {
        order: shape.seq,
        archives,
    })
}

/// Длина каждого архива дерева (в том же порядке, что `Described::archives`: корень, потом
/// вложенные), когда длины **всех** тел названы заранее (`FollowSpec::len`). Так же, как их
/// посчитает сборка при закрытии архива: итоговая раскладка по длинам тел, а длина вложенного
/// архива — длина записи его родителя. Ничего не пишет. Не названа длина хотя бы одного тела —
/// отказ (`ArgumentException`).
pub fn sized_totals(name: &str, specs: &[FollowSpec]) -> Result<Vec<u64>, AppendError> {
    let shape = shape_of(name, specs)?;
    let mut totals = vec![0u64; shape.nodes.len()];
    // вложенный архив заведён после своего родителя: с конца дети раньше родителей
    for at in (0..shape.nodes.len()).rev() {
        let mut files = Vec::with_capacity(shape.nodes[at].entries.len());
        for (rel, slot) in &shape.nodes[at].entries {
            let (kind, len) = match slot {
                Slot::Leaf(index) => {
                    let spec = &specs[*index];
                    let Some(len) = spec.len else {
                        return Err(argument(format!("The size of {} is not named.", spec.path)));
                    };
                    let kind = match spec.kind {
                        FollowKind::Resource { words } => SizedKind::Resource { words },
                        FollowKind::Binary { unpacked } => SizedKind::Binary { unpacked },
                        // вид по первым байтам тела на длину не влияет
                        FollowKind::Auto => SizedKind::Binary { unpacked: None },
                    };
                    (kind, len)
                }
                Slot::Archive(child) => (SizedKind::Binary { unpacked: None }, totals[*child]),
            };
            files.push(SizedFile {
                path: rel.clone(),
                kind,
                len,
            });
        }
        totals[at] = SizedPlan::prepare(files)?.size();
    }
    Ok(totals)
}

/// Файл недостроенной сборки «следом» наш: номер файла, начало (нули, пока головы
/// корня нет). Длина файла заранее не известна, она не меньше головы.
pub(super) fn prove_open_part(
    host: &dyn Host,
    file: &mut File,
    state: &State,
    head_len: u64,
) -> Result<(), AppendError> {
    let foreign = |what: &str| {
        refused(
            Code::BuildForeign,
            format!("The file is not the one the marker belongs to: {what}; it is left alone."),
        )
    };
    let len = file.metadata()?.len();
    if len < head_len {
        return Err(foreign("it is shorter than the head"));
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
    // пока головы корня нет, начало файла нули: чужой файл их не даст
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
