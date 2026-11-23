//! Вложенные архивы сразу во внешний файл, без временного файла и без второго
//! прохода.
//!
//! Прежний путь: вложенный архив пишется во временный файл, доводчик правит его
//! там (шифрует оглавление, переносит первые тела в конец), и готовый файл
//! копируется во внешний. Каждый байт вложенного архива пишется дважды и читается
//! один раз ради копии, а доводчик читает и пишет ещё раз.
//!
//! Раскладка вложенного архива известна до записи: места тел, оглавление и (у
//! родной доводки, `Finalizer::memory_keys`) голова после доводки и переносы тел.
//! Поэтому вложенный архив ложится на своё место во внешнем файле как есть: голова
//! после доводки, тела на местах, копии перенесённых тел за ними. Это те же байты,
//! что и на прежнем пути, а сама копия и временный файл не нужны.
//!
//! Что не меняется: доводчик, которому нужен файл (ArchiveFix), идёт прежним
//! путём; вложенный архив, который не взялся по любой причине (переносы, которые
//! нельзя разложить, не хватило памяти), тоже. Результат при этом тот же байт в
//! байт: меняется только то, где собран вложенный архив.

use std::{
    io::{Read, Seek, SeekFrom, Write},
    time::{Duration, Instant},
};

use super::*;
use crate::{
    seal::{self, Move},
    source::{ByteSource, FileSource},
    toc::{read_toc, Toc},
};

/// Как готовятся вложенные архивы.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NestedMode {
    /// Прежний путь: временный файл, доводчик на нём, копия во внешний.
    #[default]
    Staged,
    /// Сразу во внешний, когда доводчик шифрует в памяти (`Finalizer::memory_keys`)
    /// или его нет. `ram_cap` — сколько байт сжатых тел вложенных архивов можно
    /// держать в памяти до записи; что не поместилось, идёт прежним путём.
    Direct { ram_cap: u64 },
}

impl NestedMode {
    /// Память под тела вложенных архивов по умолчанию (1 ГиБ).
    pub const DEFAULT_RAM_CAP: u64 = 1 << 30;

    /// `Direct` с памятью по умолчанию.
    pub const fn direct() -> NestedMode {
        NestedMode::Direct {
            ram_cap: Self::DEFAULT_RAM_CAP,
        }
    }

    pub const fn is_direct(self) -> bool {
        matches!(self, NestedMode::Direct { .. })
    }
}

/// Что сделано с вложенным архивом без вызова `Finalizer::finalize`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handled {
    /// Оглавление зашифровано в памяти; `took` — время расчёта, `moves` — сколько
    /// тел переносится в конец, `moved` — сколько это байт.
    Sealed {
        took: Duration,
        moves: usize,
        moved: u64,
    },
    /// Архив уже закрыт верно, доводчик его не тронул бы.
    Untouched,
}

/// Состояние подготовки одного дерева: режим и счёт памяти под тела.
pub(super) struct Prep {
    mode: NestedMode,
    /// Сколько байт сжатых тел держат уже готовые вложенные архивы.
    held: u64,
}

impl Prep {
    pub(super) fn new(mode: NestedMode) -> Prep {
        Prep { mode, held: 0 }
    }

    pub(super) fn is_direct(&self) -> bool {
        self.mode.is_direct()
    }

    /// Счёт занятой памяти: вызывающий запоминает его до подготовки вложенного
    /// архива и возвращает, если тот пошёл через временный файл (его тела ушли
    /// из памяти).
    pub(super) fn held(&self) -> u64 {
        self.held
    }

    pub(super) fn release_to(&mut self, held: u64) {
        self.held = held;
    }

    fn cap(&self) -> u64 {
        match self.mode {
            NestedMode::Direct { ram_cap } => ram_cap,
            NestedMode::Staged => 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Вложенный архив из дерева
// ---------------------------------------------------------------------------

/// Вложенный архив, разложенный и доведённый в памяти: пишется на своё место за
/// один вызов `put`.
pub(crate) struct Nested<'k> {
    layout: Layout<'k>,
    /// Первые `head_len` байт файла: голова после доводки, дальше нули.
    head: Vec<u8>,
    /// Переносы: номер тела в плане и куда его копия.
    moves: Vec<(usize, Move)>,
}

/// Итог попытки положить вложенный архив на место.
pub(super) enum Placed<'k> {
    Here(Plan<'k>),
    /// Не вышло: вложенный архив идёт прежним путём (временный файл).
    Stage(Layout<'k>),
}

/// Попытка записать подготовленный вложенный архив сразу во внешний.
pub(super) fn nested<'k>(
    name: &str,
    layout: Layout<'k>,
    ctx: &WriteContext<'k>,
    prep: &mut Prep,
) -> Result<Placed<'k>> {
    let begun = Instant::now();
    let (head, moves, final_len, sealed) = match ctx.finalizer {
        None => (layout.plain_head(), Vec::new(), layout.total, false),
        Some(finalizer) => {
            let Some(keys) = finalizer.memory_keys() else {
                return Ok(Placed::Stage(layout));
            };
            let (head, plan) = layout.seal(name, keys)?;
            check_sealed(keys, name, &HeadSource::new(&plan.head, plan.final_len))?;
            (head, plan.moves, plan.final_len, true)
        }
    };
    let Some(moves) = resolve(&layout, &moves) else {
        return Ok(Placed::Stage(layout));
    };
    let own = ram_held(&layout);
    if prep.held.saturating_add(own) > prep.cap() {
        return Ok(Placed::Stage(layout));
    }
    require_fit(name, final_len)?;
    if let (true, Some(finalizer)) = (sealed, ctx.finalizer) {
        let moved = moves.iter().map(|(_, shift)| shift.len).sum();
        finalizer.note_handled(
            name,
            Handled::Sealed {
                took: begun.elapsed(),
                moves: moves.len(),
                moved,
            },
        );
    }
    prep.held += own;
    Ok(Placed::Here(Plan {
        meta: Meta::plain(final_len),
        len: final_len,
        origin: Origin::Nested(Box::new(Nested {
            layout,
            head,
            moves,
        })),
        fix_head: false,
    }))
}

/// Сколько байт сжатых тел держит этот архив в памяти (тела вложенных в него
/// считаются при их размещении).
fn ram_held(layout: &Layout<'_>) -> u64 {
    layout
        .plans
        .iter()
        .map(|plan| match &plan.origin {
            Origin::Ram(Ram::Owned(bytes)) => bytes.len() as u64,
            _ => 0,
        })
        .sum()
}

/// Каждому переносу — тело, которое он копирует; `None`, если раскладку нельзя
/// проверить: тела не нашлись или места копий задевают друг друга или чужие
/// источники (тогда порядок записи влиял бы на байты).
fn resolve(layout: &Layout<'_>, moves: &[Move]) -> Option<Vec<(usize, Move)>> {
    let at_offset: HashMap<u64, usize> = layout
        .plans
        .iter()
        .zip(&layout.placed)
        .enumerate()
        .filter(|(_, (plan, _))| plan.len > 0)
        .map(|(i, (_, &block))| (u64::from(block) * BLOCK, i))
        .collect();
    let mut found = Vec::with_capacity(moves.len());
    for shift in moves {
        let i = *at_offset.get(&shift.from)?;
        if layout.plans[i].len != shift.len {
            return None;
        }
        found.push((i, *shift));
    }
    independent(moves).then_some(found)
}

/// Места копий не пересекаются ни друг с другом, ни с телами, которые копируются.
fn independent(moves: &[Move]) -> bool {
    let target = |shift: &Move| shift.to..shift.to + shift.len;
    let source = |shift: &Move| shift.from..shift.from + shift.len;
    let overlap =
        |a: std::ops::Range<u64>, b: std::ops::Range<u64>| a.start < b.end && b.start < a.end;
    moves.iter().enumerate().all(|(i, one)| {
        moves.iter().enumerate().all(|(j, other)| {
            (i == j || !overlap(target(one), target(other))) && !overlap(target(one), source(other))
        })
    })
}

/// Голову вложенного можно положить первой: она короче места под оглавление и не
/// задета ни одной копией перенесённого тела (тогда порядок записи не влияет на
/// байты). Тогда файл пишется строго по возрастанию смещений.
fn head_goes_first(head_len: u64, room: u64, moves: impl IntoIterator<Item = u64>) -> bool {
    // `ASTRAL_ENGINE_NESTED_HEAD_LAST=1` возвращает прежний порядок (голова последней):
    // нужен только разбору расхождений, чтобы сравнить два порядка на одной сборке
    let last = std::env::var("ASTRAL_ENGINE_NESTED_HEAD_LAST").is_ok_and(|v| v.trim() == "1");
    !last && head_len <= room && moves.into_iter().all(|to| to >= head_len)
}

impl Nested<'_> {
    /// Пишет вложенный архив с позиции `at` внешнего файла: голова, тела на местах,
    /// копии перенесённых тел. Прочее место остаётся нулями (файл уже растянут до
    /// итогового размера). Смещения растут от начала к концу. Голова вложенного,
    /// записанная после его хвоста (так было раньше), совпадала с нулями на месте
    /// головы в кэшированном чтении при холодном кэше системы и отпечатке по ходу
    /// записи (в файле на диске байты верные); причинная связь не доказана, см.
    /// `docs/INSTALL-RUST-COMPOSE-FAST.md`.
    pub(super) fn put(&self, out: &mut File, at: u64, sink: &mut Sink<'_>) -> Result<()> {
        let layout = &self.layout;
        let first = head_goes_first(
            self.head.len() as u64,
            layout.data_start,
            self.moves.iter().map(|(_, shift)| shift.to),
        );
        if first {
            put_head(out, at, &self.head, sink)?;
        }
        let mut cursor = at + layout.data_start;
        for &i in &layout.order {
            activity::check()?;
            let plan = &layout.plans[i];
            sink.put(out, cursor, plan)?;
            cursor += plan.span();
        }
        for (i, shift) in &self.moves {
            activity::check()?;
            sink.put(out, at + shift.to, &layout.plans[*i])?;
            if shift.rewrite_header {
                rewrite_header(out, at + shift.to, shift.len)?;
            }
        }
        if first {
            Ok(())
        } else {
            put_head(out, at, &self.head, sink)
        }
    }
}

/// Голова файла: `head` с позиции `at`.
fn put_head(out: &mut File, at: u64, head: &[u8], sink: &mut Sink<'_>) -> Result<()> {
    sink.mark(at, head.len() as u64);
    let _write = tally::span(Phase::Bodies);
    out.seek(SeekFrom::Start(at))?;
    out.write_all(head)?;
    tally::add_written(head.len() as u64);
    sink.credit(head.len() as u64);
    Ok(())
}

/// У копии ресурса с размером внутри заголовок пишется заново: нули и четыре
/// байта размера (так делает доводчик, `seal::copy_range`).
fn rewrite_header(out: &mut File, at: u64, len: u64) -> Result<()> {
    let mut head = [0u8; limit::RESOURCE_HEADER];
    for (pos, value) in extended_size_bytes(len) {
        head[pos] = value;
    }
    let _write = tally::span(Phase::Bodies);
    out.seek(SeekFrom::Start(at))?;
    out.write_all(&head)?;
    tally::add_written(head.len() as u64);
    Ok(())
}

// ---------------------------------------------------------------------------
// Привезённый готовый архив
// ---------------------------------------------------------------------------

/// Откуда брать байты привезённого архива.
enum Bring {
    Disk(PathBuf),
    Ram(Arc<[u8]>),
}

/// Привезённый открытый архив, доведённый в памяти: его байты как есть, новая
/// голова и копии перенесённых тел.
pub(crate) struct Brought {
    source: Bring,
    /// Длина источника.
    len: u64,
    /// Доведённое оглавление, с позиции 0.
    head: Vec<u8>,
    moves: Vec<Move>,
}

/// Чтение источника привезённого архива подряд порциями.
fn feed_from<'a>(source: &'a Bring, from: u64) -> io::Result<Feed<'a>> {
    Ok(match source {
        Bring::Disk(path) => {
            let mut file = File::open(path)?;
            file.seek(SeekFrom::Start(from))?;
            Box::new(move |_, buf| {
                file.read_exact(buf)?;
                tally::add_read(buf.len() as u64);
                Ok(())
            })
        }
        Bring::Ram(bytes) => Box::new(move |off, buf| {
            let start = (from + off) as usize;
            buf.copy_from_slice(&bytes[start..start + buf.len()]);
            Ok(())
        }),
    })
}

impl Brought {
    fn copy(
        &self,
        out: &mut File,
        sink: &mut Sink<'_>,
        to: u64,
        from: u64,
        len: u64,
    ) -> Result<()> {
        if len == 0 {
            return Ok(());
        }
        let feed = feed_from(&self.source, from)?;
        sink.stream(out, to, len, false, feed)
    }

    /// Пишет привезённый архив с позиции `at`: новая голова, байты источника после
    /// неё, копии перенесённых тел (смещения растут, как у `Nested::put`).
    pub(super) fn put(&self, out: &mut File, at: u64, sink: &mut Sink<'_>) -> Result<()> {
        let head_len = self.head.len() as u64;
        let rest = self.len.saturating_sub(head_len);
        let first = head_goes_first(head_len, head_len, self.moves.iter().map(|shift| shift.to));
        if first {
            put_head(out, at, &self.head, sink)?;
        }
        self.copy(out, sink, at + head_len, head_len, rest)?;
        for shift in &self.moves {
            activity::check()?;
            self.copy(out, sink, at + shift.to, shift.from, shift.len)?;
            if shift.rewrite_header {
                rewrite_header(out, at + shift.to, shift.len)?;
            }
        }
        if first {
            Ok(())
        } else {
            put_head(out, at, &self.head, sink)
        }
    }
}

/// Источник байт с произвольным доступом для проверки заголовка.
struct ArcSource(Arc<[u8]>);

impl ByteSource for ArcSource {
    fn len(&self) -> u64 {
        self.0.len() as u64
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<()> {
        self.ensure_range(offset, buf.len())?;
        let from = offset as usize;
        buf.copy_from_slice(&self.0[from..from + buf.len()]);
        Ok(())
    }
}

/// Только голова файла, а длина — настоящая: ключ шифра зависит от длины.
struct HeadSource<'a> {
    head: &'a [u8],
    len: u64,
}

impl<'a> HeadSource<'a> {
    fn new(head: &'a [u8], len: u64) -> Self {
        HeadSource { head, len }
    }
}

impl ByteSource for HeadSource<'_> {
    fn len(&self) -> u64 {
        self.len
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<()> {
        let end = offset.checked_add(buf.len() as u64);
        match end.filter(|&end| end <= self.head.len() as u64) {
            Some(end) => {
                buf.copy_from_slice(&self.head[offset as usize..end as usize]);
                Ok(())
            }
            None => Err(io::ErrorKind::UnexpectedEof.into()),
        }
    }
}

/// Заголовок обязан читаться как зашифрованный NG ключом, который выбирается по
/// имени и длине файла (то же, что проверяет доводчик после работы).
fn check_sealed(keys: &KeySet, name: &str, source: &dyn ByteSource) -> Result<()> {
    match read_toc(source, name, Some(keys))? {
        Toc {
            encryption: Encryption::Ng,
            ng_key_index: Some(found),
            ..
        } if found == keys.ng_key_index(name, source.len()) => Ok(()),
        _ => Err(RpfError::format(format!(
            "ArchiveFix did not encrypt the archive header: {name}"
        ))),
    }
}

/// Привезённый готовый архив без копии во временную папку. `None` — этот случай
/// идёт прежним путём (копия и доводка файла): доводчику нужен файл, архив не
/// читается, или любая проверка не сошлась. Прежний путь даёт тогда те же байты и
/// те же отказы.
pub(super) fn bring<'k>(
    name: &str,
    data: &Data,
    ctx: &WriteContext<'k>,
    finalizer: &dyn Finalizer,
) -> Result<Option<Plan<'k>>> {
    let begun = Instant::now();
    let source = match data {
        Data::Memory(bytes) => Bring::Ram(Arc::clone(bytes)),
        Data::File(path) => Bring::Disk(path.clone()),
    };
    let len = data_len(data)?;
    let reader: Box<dyn ByteSource> = match &source {
        Bring::Disk(path) => Box::new(FileSource::open(path)?),
        Bring::Ram(bytes) => Box::new(ArcSource(Arc::clone(bytes))),
    };
    if len < HEADER_SIZE as u64 {
        return Ok(None);
    }
    let first = reader.read_vec(0, HEADER_SIZE)?;
    let Ok(span) = seal::head_span(&first) else {
        return Ok(None);
    };
    let own_keys = finalizer.memory_keys();

    let Some(span) = span else {
        // метка не «открыто»: доводчик файл не трогает, остаётся проверить заголовок
        if own_keys.is_none() && !finalizer.leaves_closed_alone() {
            return Ok(None);
        }
        let Some(keys) = own_keys.or(ctx.keys) else {
            return Ok(None);
        };
        if check_sealed(keys, name, reader.as_ref()).is_err() {
            return Ok(None);
        }
        finalizer.note_handled(name, Handled::Untouched);
        return Ok(Some(Plan::verbatim(data, len)));
    };

    // открытый архив: доводка в памяти, если она есть
    let Some(keys) = own_keys else {
        return Ok(None);
    };
    if span as u64 > len {
        return Ok(None);
    }
    let head = reader.read_vec(0, span)?;
    let mut first_bytes = |at: u64| -> Result<[u8; limit::RESOURCE_HEADER]> {
        let mut bytes = [0u8; limit::RESOURCE_HEADER];
        reader.read_at(at, &mut bytes)?;
        Ok(bytes)
    };
    let Ok(Some(plan)) = seal::plan_seal(&head, len, name, keys, &mut first_bytes) else {
        return Ok(None);
    };
    if !independent(&plan.moves)
        || check_sealed(keys, name, &HeadSource::new(&plan.head, plan.final_len)).is_err()
    {
        return Ok(None);
    }
    require_fit(name, plan.final_len)?;
    let moved = plan.moves.iter().map(|shift| shift.len).sum();
    finalizer.note_handled(
        name,
        Handled::Sealed {
            took: begun.elapsed(),
            moves: plan.moves.len(),
            moved,
        },
    );
    Ok(Some(Plan {
        meta: Meta::plain(plan.final_len),
        len: plan.final_len,
        origin: Origin::Brought(Box::new(Brought {
            source,
            len,
            head: plan.head,
            moves: plan.moves,
        })),
        fix_head: false,
    }))
}
