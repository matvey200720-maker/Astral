//! Запись нового архива RPF7 из дерева `DirNode`.
//!
//! Раскладка как у игры: заголовок, таблица записей и блок имён, затем тела блоками
//! по 512 байт. Оглавление всегда открытое (`OPEN`): шифр накладывает внешняя
//! «доводка» (`Finalizer`), которую писатель зовёт только для вложенных архивов.
//!
//! Ход работы: плоская таблица записей, подготовка тел (сжатие, сборка вложенных
//! архивов), блок имён, размещение и запись данных, в конце — заголовок с таблицей.

use std::{
    collections::{hash_map::Entry, HashMap},
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom, Write},
    ops::Range,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use flate2::{write::DeflateEncoder, Compression};

use crate::{
    activity,
    archive::{Archive, EntryId, EntryKind},
    digest::Watermark,
    error::{Result, RpfError},
    keys::KeySet,
    tally::{self, Phase},
    toc::{encode_entry, Encryption, RawEntry, RawKind, BLOCK, ENTRY_SIZE, HEADER_SIZE, MAGIC},
    tree::{Body, Compress, Data, DirNode, FileNode},
};

mod direct;

pub use direct::{Handled, NestedMode};

/// С этой длины ресурс прячет настоящий размер в собственных данных.
pub const EXTENDED_SIZE_FROM: u64 = 0xff_ffff;

/// Пределы формата и настройки записи.
mod limit {
    /// Порция чтения и записи крупных тел.
    pub const PORTION: usize = 8 << 20;
    /// Файл длиннее этого для проверки сжатия в память не читается.
    pub const DEFLATE_READ_FILE: u64 = 256 << 20;
    /// Сжатое длиннее не помещается в 24 бита поля размера.
    pub const DEFLATED: usize = 0xff_ffff;
    /// Длина записи: поле размера в таблице — 32 бита.
    pub const ENTRY: u64 = u32::MAX as u64;
    /// Смещение имени файла хранится в 16 битах.
    pub const FILE_NAME_AT: usize = 0xffff;
    /// Выше этого размера ресурсы ложатся вперёд: у них блок короче на бит.
    pub const RESOURCES_FIRST_ABOVE: u64 = 4 << 30;
    /// Последний блок, на который можно положить запись: смещение в оглавлении -
    /// 23 бита, старший бит поля - признак ресурса.
    pub const RESOURCE_BLOCK: u64 = 0x7f_ffff;
    /// У двоичной записи тот же предел: с блока 0x800000 её читали бы как ресурс.
    pub const BINARY_BLOCK: u64 = RESOURCE_BLOCK;
    pub const RESOURCE_HEADER: usize = 16;
    /// «RSC7» как слово.
    pub const RESOURCE_WORD: u32 = u32::from_le_bytes(*b"RSC7");
}

const TOO_BIG_TOC: &str = "The archive is too large for the RPF7 table of contents.";
const TOO_MANY_NAMES: &str =
    "The archive has too many file names for the RPF7 table of contents.";

pub mod sized;

/// Итог записи.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteReport {
    /// Размер файла, всегда кратен 512.
    pub size: u64,
    /// Число записей оглавления вместе с корнем и каталогами.
    pub entries: usize,
}

/// Идущая пробная доводка (см. `Finalizer::begin_trial`): ждёт её конца в любом
/// потоке.
pub trait TrialRun: Send {
    /// Дожидается конца пробы и проверяет её итог.
    fn finish(self: Box<Self>) -> Result<()>;
}

/// Заключительная обработка вложенного архива после записи во временный файл.
pub trait Finalizer {
    fn finalize(&self, path: &Path, name: &str) -> Result<()>;

    /// Запускает пробную доводку файла с пустыми телами (нули на месте данных)
    /// и не ждёт её конца: программа идёт своим процессом, пока вызывающий пишет
    /// тела. Результат читают только из головы файла, когда `finish` вернётся.
    /// `Some` значит, что доводчик ручается: голова после настоящей доводки
    /// готового файла того же имени, размера и с тем же оглавлением будет такой же,
    /// а файл разве что подрастёт на хвост. По умолчанию доводчик на пробу не
    /// соглашается (`None`).
    fn begin_trial(&self, _path: &Path, _name: &str) -> Result<Option<Box<dyn TrialRun>>> {
        Ok(None)
    }

    /// SHA-256 внешней программы доводки для ответа команды. `None` — как у
    /// прежних доводчиков (ответ называет закреплённую программу); доводчик
    /// без программы отвечает пустой строкой.
    fn executable_sha256(&self) -> Option<&str> {
        None
    }

    /// Голова файла после доводки, если доводчик может назвать её по одному
    /// размеченному архиву, не трогая файл: первые `layout.head_len()` байт
    /// того, что получится на диске после `finalize` готового файла имени
    /// `name`. Тогда пробная доводка не нужна. `Ok(None)` — доводчик так не
    /// умеет (по умолчанию).
    fn predict_head(&self, _layout: &Layout<'_>, _name: &str) -> Result<Option<Vec<u8>>> {
        Ok(None)
    }

    /// Ключи, которыми доводчик шифрует оглавление в памяти, не трогая файл
    /// (родная доводка `seal`). `Some` разрешает писателю в режиме
    /// `NestedMode::Direct` не писать вложенный архив во временный файл: его голова
    /// и переносы тел известны до записи (`seal::plan_seal`), и он ложится сразу на
    /// своё место во внешнем файле, а `finalize` для него не зовётся (вместо этого
    /// `note_handled`). По умолчанию — `None`: доводчик работает только на файле.
    fn memory_keys(&self) -> Option<&KeySet> {
        None
    }

    /// Доводчик не меняет файл, у которого метка не «открыто» (ArchiveFix: так, и
    /// после него заголовок обязан читаться как NG). Привезённый готовый архив
    /// с таким заголовком, читающимся верно, писатель кладёт как есть, без копии во
    /// временную папку и без запуска доводчика.
    fn leaves_closed_alone(&self) -> bool {
        false
    }

    /// Вложенный архив обработан без вызова `finalize` (см. `memory_keys` и
    /// `leaves_closed_alone`); вызывается в том же порядке, в каком шли бы вызовы
    /// `finalize`: сначала вложенные, потом сам архив.
    fn note_handled(&self, _name: &str, _how: Handled) {}
}

/// Параметры записи, которые не входят в дерево.
pub struct WriteContext<'a> {
    pub staging: &'a Path,
    pub keys: Option<&'a KeySet>,
    pub finalizer: Option<&'a dyn Finalizer>,
}

/// Пары «номер байта среди первых 16 байт данных ресурса, значение» для размера.
pub fn extended_size_bytes(len: u64) -> [(usize, u8); 4] {
    let low = len as u32;
    [
        (7, low as u8),
        (14, (low >> 8) as u8),
        (5, (low >> 16) as u8),
        (2, (low >> 24) as u8),
    ]
}

/// Пишет дерево `root` в файл `out`. Доводка вложенных архивов — вызов `ctx.finalizer`;
/// верхний архив вызывающий доводит сам.
pub fn write_archive(
    root: &DirNode,
    out: &mut File,
    ctx: &mut WriteContext<'_>,
    progress: &mut dyn FnMut(u64),
) -> Result<WriteReport> {
    write_archive_with(root, out, ctx, progress, NestedMode::Staged)
}

/// `write_archive` с выбором, как идут вложенные архивы (`NestedMode`).
pub fn write_archive_with(
    root: &DirNode,
    out: &mut File,
    ctx: &mut WriteContext<'_>,
    progress: &mut dyn FnMut(u64),
    nested: NestedMode,
) -> Result<WriteReport> {
    let layout = Layout::prepare_with(root, ctx, nested)?;
    // Недописанный файл без оглавления, растянутый до итогового размера,
    // никому не нужен: отказ или отмена оставляют пустой файл.
    layout.write_all(out, progress, None)?;
    Ok(layout.report())
}

/// Архив, разложенный до последнего байта, но ещё не записанный: тела готовы
/// (вложенные архивы собраны и доведены), места розданы, оглавление
/// закодировано. Оглавление не зависит от записи тел, поэтому его известно до
/// записи, а значит, до записи можно узнать и голову файла после доводчика
/// (пробная доводка на файле с пустыми телами, `write_head`), а SHA-256 файла
/// считать по ходу записи другим потоком, который идёт по уже записанному
/// (`Watermark`, `FileDigest`): отдельного чтения готового файла не нужно.
pub struct Layout<'k> {
    plans: Vec<Plan<'k>>,
    /// Порядок записи тел в файл.
    order: Vec<usize>,
    /// Номер блока каждого тела (по порядку таблицы).
    placed: Vec<u32>,
    /// Заголовок, записи и блок имён, как они лягут с позиции 0.
    table: Vec<u8>,
    entries: usize,
    /// Первый байт данных: оглавление, добитое до границы блока.
    data_start: u64,
    total: u64,
}

impl<'k> Layout<'k> {
    /// Готовит тела (на диск ложатся только вложенные архивы во временной
    /// папке `ctx.staging`), раздаёт места и кодирует оглавление.
    pub fn prepare(root: &DirNode, ctx: &mut WriteContext<'k>) -> Result<Layout<'k>> {
        Layout::prepare_with(root, ctx, NestedMode::Staged)
    }

    /// То же с выбором, как идут вложенные архивы: через временный файл (прежний
    /// путь) или сразу во внешний (`NestedMode::Direct`, только когда доводчик
    /// шифрует в памяти или его нет; иначе вложенный идёт прежним путём).
    pub fn prepare_with(
        root: &DirNode,
        ctx: &mut WriteContext<'k>,
        nested: NestedMode,
    ) -> Result<Layout<'k>> {
        Layout::prepare_in(root, ctx, &mut direct::Prep::new(nested))
    }

    fn prepare_in(
        root: &DirNode,
        ctx: &mut WriteContext<'k>,
        prep: &mut direct::Prep,
    ) -> Result<Layout<'k>> {
        let rows = tabulate(root);
        let plans = prepare_all(&rows, ctx, prep)?;
        Layout::assemble(&rows, plans)
    }

    /// Блок имён, места тел и оглавление по готовым планам тел. Общий конец
    /// `prepare` и плана по размерам (`sized`): раскладка не зависит от того,
    /// откуда взялась длина тела.
    fn assemble(rows: &[Row<'_>], plans: Vec<Plan<'k>>) -> Result<Layout<'k>> {
        let _toc = tally::span(Phase::Toc);
        let names = NameBlock::collect(rows)?;

        let table_len = HEADER_SIZE + rows.len() * ENTRY_SIZE + names.block.len();
        let data_start = blocks_of(table_len as u64) * BLOCK;
        let total = data_start + plans.iter().map(Plan::span).sum::<u64>();

        let (order, placed) = place(&plans, data_start, total)?;
        let table = encode_table(rows, &names, &plans, &placed)?;
        Ok(Layout {
            plans,
            order,
            placed,
            table,
            entries: rows.len(),
            data_start,
            total,
        })
    }

    /// Место тела каждого файла по порядку таблицы: смещение и длина тела (без
    /// добивки до границы блока).
    pub fn body_places(&self) -> Vec<(u64, u64)> {
        self.plans
            .iter()
            .zip(&self.placed)
            .map(|(plan, &block)| (u64::from(block) * BLOCK, plan.len))
            .collect()
    }

    /// Порядок, в котором тела ложатся в файл: номера файлов по порядку таблицы.
    pub fn write_order(&self) -> &[usize] {
        &self.order
    }

    /// Размер готового файла, кратен 512.
    pub fn size(&self) -> u64 {
        self.total
    }

    /// Сколько байт с начала файла занимает оглавление вместе с добивкой до
    /// границы блока: на этом месте доводчик правит файл, дальше лежат тела.
    pub fn head_len(&self) -> u64 {
        self.data_start
    }

    pub fn report(&self) -> WriteReport {
        WriteReport {
            size: self.total,
            entries: self.entries,
        }
    }

    /// Голова файла до доводчика: оглавление и нули до границы данных
    /// (`head_len` байт).
    pub fn plain_head(&self) -> Vec<u8> {
        let mut head = self.table.clone();
        head.resize(self.data_start as usize, 0);
        head
    }

    /// Голова файла после родной доводки (`seal`): первые `head_len` байт того,
    /// что ляжет на диск, когда готовый файл имени `name` будет доведён нашим
    /// кодом. Известна до записи тел: доводка зависит от оглавления, размера
    /// файла и имени, а у ресурсов с настоящим размером внутри (от 16 МиБ) — от
    /// размера, который здесь известен из плана. Освободившийся хвост прежнего
    /// блока имён доводка не трогает, он остаётся в голове как есть.
    pub fn sealed_head(&self, name: &str, keys: &KeySet) -> Result<Vec<u8>> {
        self.seal(name, keys).map(|(head, _)| head)
    }

    /// То же вместе с планом доводки: переносы тел и длина файла после них.
    fn seal(&self, name: &str, keys: &KeySet) -> Result<(Vec<u8>, crate::seal::SealPlan)> {
        let _toc = tally::span(Phase::Toc);
        let mut head = self.plain_head();
        let mut first_bytes = |at: u64| -> Result<[u8; 16]> {
            let found = self
                .plans
                .iter()
                .zip(&self.placed)
                .find(|(plan, &block)| u64::from(block) * BLOCK == at && plan.fix_head);
            let Some((plan, _)) = found else {
                return Err(RpfError::state(
                    "No resource with a hidden size lies at this place.",
                ));
            };
            let mut bytes = [0u8; 16];
            for (pos, value) in extended_size_bytes(plan.len) {
                bytes[pos] = value;
            }
            Ok(bytes)
        };
        let plan = crate::seal::plan_seal(&head, self.total, name, keys, &mut first_bytes)?;
        let plan = plan.ok_or_else(|| RpfError::state("The planned head is not an open one."))?;
        if plan.head.len() > head.len() {
            return Err(RpfError::state(
                "The sealed table of contents is longer than the head of the file.",
            ));
        }
        head[..plan.head.len()].copy_from_slice(&plan.head);
        Ok((head, plan))
    }

    /// Растягивает файл до итогового размера и кладёт оглавление с позиции 0;
    /// тела остаются нулями. На таком файле доводчик показывает, какой голова
    /// будет после него (размер файла итоговый, а ключ шифра зависит от размера).
    /// Отказ оставляет пустой файл.
    pub fn write_head(&self, out: &mut File) -> Result<()> {
        let put = |out: &mut File| -> Result<()> {
            out.set_len(self.total)?;
            self.put_table(out)
        };
        put(out).inspect_err(|_| {
            let _ = out.set_len(0);
        })
    }

    /// Пишет файл целиком в том же порядке, что `write_archive`: растянуть,
    /// тела по местам, оглавление последним. `mark` получает отметку: сколько
    /// байт области данных уже окончательно лежит в файле (вместе с нулями до
    /// границы блока); по ней идёт читатель отпечатка. Отметка закрывается при
    /// любом исходе. Отказ и отмена оставляют пустой файл.
    pub fn write_all(
        &self,
        out: &mut File,
        progress: &mut dyn FnMut(u64),
        mark: Option<&Watermark>,
    ) -> Result<()> {
        let mut run = |out: &mut File| -> Result<()> {
            out.set_len(self.total)?;
            self.lay_bodies(out, progress, mark)?;
            self.put_table(out)
        };
        let outcome = run(out).inspect_err(|_| {
            let _ = out.set_len(0);
        });
        if let Some(mark) = mark {
            mark.close();
        }
        outcome
    }

    /// Заголовок, записи и имена одним куском с позиции 0.
    fn put_table(&self, out: &mut File) -> Result<()> {
        let _write = tally::span(Phase::Bodies);
        out.seek(SeekFrom::Start(0))?;
        out.write_all(&self.table)?;
        out.flush()?;
        tally::add_written(self.table.len() as u64);
        Ok(())
    }

    fn lay_bodies(
        &self,
        out: &mut File,
        progress: &mut dyn FnMut(u64),
        mark: Option<&Watermark>,
    ) -> Result<()> {
        let mut sink = Sink {
            progress,
            written: 0,
            buf: Vec::new(),
            check_each: false,
            high: 0,
        };
        let mut cursor = self.data_start;
        for &i in &self.order {
            activity::check()?;
            let plan = &self.plans[i];
            sink.put(out, cursor, plan)?;
            cursor += plan.span();
            if let Some(mark) = mark {
                mark.advance(cursor);
            }
        }
        Ok(())
    }
}

fn blocks_of(len: u64) -> u64 {
    len.div_ceil(BLOCK)
}

// ---------------------------------------------------------------------------
// Таблица записей

#[derive(Clone, Copy)]
enum Node<'t> {
    Dir(&'t DirNode),
    File(&'t FileNode),
}

impl<'t> Node<'t> {
    fn name(self) -> &'t str {
        match self {
            Node::Dir(d) => &d.name,
            Node::File(f) => &f.name,
        }
    }

    fn is_dir(self) -> bool {
        matches!(self, Node::Dir(_))
    }
}

struct Row<'t> {
    node: Node<'t>,
    /// Для каталога: номера записей его детей (пустой каталог — пустой промежуток).
    kids: Range<usize>,
    /// Для файла: порядковый номер среди файлов таблицы.
    file_no: Option<usize>,
}

/// Корень, затем дети каждого каталога подряд (по имени, байтово, устойчиво);
/// каталоги разбираются вглубь, но без рекурсии.
fn tabulate(root: &DirNode) -> Vec<Row<'_>> {
    let mut rows = vec![Row {
        node: Node::Dir(root),
        kids: 0..0,
        file_no: None,
    }];
    let mut files_seen = 0;
    let mut agenda = vec![0usize];
    while let Some(at) = agenda.pop() {
        let Node::Dir(dir) = rows[at].node else {
            continue;
        };
        let mut kids: Vec<Node<'_>> = dir
            .dirs
            .iter()
            .map(Node::Dir)
            .chain(dir.files.iter().map(Node::File))
            .collect();
        // при равных именах каталоги стоят раньше файлов: так их свёл вектор
        kids.sort_by(|a, b| a.name().as_bytes().cmp(b.name().as_bytes()));

        let first = rows.len();
        rows.extend(kids.into_iter().map(|node| {
            let file_no = (!node.is_dir()).then(|| {
                files_seen += 1;
                files_seen - 1
            });
            Row {
                node,
                kids: 0..0,
                file_no,
            }
        }));
        rows[at].kids = first..rows.len();
        agenda.extend((first..rows.len()).rev().filter(|&i| rows[i].node.is_dir()));
    }
    rows
}

// ---------------------------------------------------------------------------
// Блок имён

struct NameBlock {
    block: Vec<u8>,
    /// Смещение имени каждой записи таблицы.
    offsets: Vec<usize>,
}

impl NameBlock {
    /// Сначала имена файлов, потом каталогов (с корнем); повторы убираются в пределах
    /// своей группы.
    fn collect(rows: &[Row<'_>]) -> Result<NameBlock> {
        let mut block = vec![0u8];
        let mut offsets = vec![0usize; rows.len()];
        let mut seen: [HashMap<&str, usize>; 2] = Default::default();

        let numbered = || rows.iter().enumerate();
        let order = numbered()
            .filter(|(_, r)| !r.node.is_dir())
            .chain(numbered().filter(|(_, r)| r.node.is_dir()));
        for (ix, row) in order {
            let name = row.node.name();
            if name.is_empty() {
                continue;
            }
            if name.contains('\0') {
                return Err(RpfError::argument(format!(
                    "The name {name:?} contains a null character."
                )));
            }
            let is_dir = row.node.is_dir();
            offsets[ix] = match seen[usize::from(is_dir)].entry(name) {
                Entry::Occupied(known) => *known.get(),
                Entry::Vacant(slot) => {
                    let at = block.len();
                    if !is_dir && at > limit::FILE_NAME_AT {
                        return Err(RpfError::format(TOO_MANY_NAMES));
                    }
                    block.extend_from_slice(name.as_bytes());
                    block.push(0);
                    *slot.insert(at)
                }
            };
        }
        // добор нулями до кратного 16; у кратного — ещё целый блок
        block.resize((block.len() / 16 + 1) * 16, 0);
        Ok(NameBlock { block, offsets })
    }
}

// ---------------------------------------------------------------------------
// Подготовка тел

/// Как запись выглядит в оглавлении (без смещения, оно известно при размещении).
enum Meta {
    Binary {
        stored: u32,
        unc: u32,
        encrypted: bool,
    },
    Resource {
        stored: u32,
        system: u32,
        graphics: u32,
    },
}

impl Meta {
    fn plain(unc: u64) -> Meta {
        Meta::Binary {
            stored: 0,
            unc: unc as u32,
            encrypted: false,
        }
    }
}

enum Ram {
    Shared(Arc<[u8]>),
    Owned(Vec<u8>),
}

impl Ram {
    fn bytes(&self) -> &[u8] {
        match self {
            Ram::Shared(b) => b,
            Ram::Owned(b) => b,
        }
    }
}

/// Откуда брать байты тела при записи данных.
enum Origin<'k> {
    Ram(Ram),
    Disk(PathBuf),
    /// Хранимые байты записи открытого архива без разбора.
    Window {
        from: Arc<Archive>,
        at: u64,
    },
    /// То же, но запись шифрована AES и ложится открытой.
    Deciphered {
        from: Arc<Archive>,
        at: u64,
        keys: &'k KeySet,
    },
    /// Готовый файл: вложенный архив или доведённая копия. Папка доводки (если она
    /// была) убирается после файла, когда тело больше не нужно.
    Staged {
        file: File,
        _scratch: Option<Scratch>,
    },
    /// Тело, которое придёт позже: известна только длина (план по размерам,
    /// `sized`). Записать такой план нельзя.
    Pending,
    /// Вложенный архив, который пишется сразу на своё место во внешнем файле
    /// (`NestedMode::Direct`): без временного файла и без копии.
    Nested(Box<direct::Nested<'k>>),
    /// Привезённый готовый архив, доведённый в памяти: тело источника как есть,
    /// новая голова и копии перенесённых тел.
    Brought(Box<direct::Brought>),
}

/// Читатель порции: заполняет буфер телом, начиная со смещения внутри тела.
type Feed<'a> = Box<dyn FnMut(u64, &mut [u8]) -> io::Result<()> + 'a>;

enum Source<'a> {
    Whole(&'a [u8]),
    Pieces(Feed<'a>),
}

impl Origin<'_> {
    fn source(&self) -> io::Result<Source<'_>> {
        Ok(match self {
            Origin::Ram(ram) => Source::Whole(ram.bytes()),
            Origin::Disk(path) => {
                let mut file = File::open(path)?;
                Source::Pieces(Box::new(move |_, buf| {
                    file.read_exact(buf)?;
                    tally::add_read(buf.len() as u64);
                    Ok(())
                }))
            }
            Origin::Window { from, at } => {
                let (source, base) = (from.source(), *at);
                Source::Pieces(Box::new(move |off, buf| source.read_at(base + off, buf)))
            }
            Origin::Deciphered { from, at, keys } => {
                let (source, base, keys) = (from.source(), *at, *keys);
                Source::Pieces(Box::new(move |off, buf| {
                    source.read_at(base + off, buf)?;
                    keys.decrypt_aes(buf);
                    Ok(())
                }))
            }
            Origin::Staged { file, .. } => {
                let mut reader: &File = file;
                reader.seek(SeekFrom::Start(0))?;
                Source::Pieces(Box::new(move |_, buf| {
                    reader.read_exact(buf)?;
                    tally::add_read(buf.len() as u64);
                    Ok(())
                }))
            }
            // эти два тела пишутся сами (`Sink::put`), питающего читателя у них нет
            Origin::Nested(_) | Origin::Brought(_) => {
                return Err(io::Error::other("a body written in place has no reader"))
            }
            Origin::Pending => {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "The body of a planned entry has not arrived yet.",
                ))
            }
        })
    }
}

struct Plan<'k> {
    meta: Meta,
    /// Сколько байт тело занимает в файле.
    len: u64,
    origin: Origin<'k>,
    /// Первые 16 байт ресурса надо переписать расширенным размером.
    fix_head: bool,
}

/// Что делать с двоичной записью по её имени и режиму сжатия.
#[derive(Clone, Copy)]
enum Treatment {
    Verbatim,
    Deflate,
    Stage,
}

/// Правила по окончанию имени; первое подошедшее побеждает и сильнее режима сжатия.
const NAME_RULES: [(&str, Treatment); 2] =
    [(".rpf", Treatment::Stage), (".awc", Treatment::Verbatim)];

impl Treatment {
    fn pick(name: &str, mode: Compress) -> Treatment {
        let fallback = if mode == Compress::Store {
            Treatment::Verbatim
        } else {
            Treatment::Deflate
        };
        NAME_RULES
            .iter()
            .find(|(suffix, _)| has_suffix(name, suffix))
            .map_or(fallback, |&(_, treatment)| treatment)
    }
}

fn has_suffix(name: &str, suffix: &str) -> bool {
    let tail = name
        .len()
        .checked_sub(suffix.len())
        .map(|from| &name.as_bytes()[from..]);
    tail.is_some_and(|t| t.eq_ignore_ascii_case(suffix.as_bytes()))
}

fn data_len(data: &Data) -> Result<u64> {
    Ok(match data {
        Data::Memory(bytes) => bytes.len() as u64,
        Data::File(path) => fs::metadata(path)?.len(),
    })
}

fn require_fit(name: &str, len: u64) -> Result<()> {
    if len <= limit::ENTRY {
        return Ok(());
    }
    Err(RpfError::format(format!(
        "{name} is too large for an RPF7 entry."
    )))
}

fn deflate(bytes: &[u8]) -> io::Result<Vec<u8>> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::new(6));
    encoder.write_all(bytes)?;
    encoder.finish()
}

/// Номер временной папки доводки общий на процесс.
static STAGED_SEQ: AtomicU64 = AtomicU64::new(0);

/// Временная папка доводки `staging/nested-<pid>-<n>` с файлом `<name>`; убирается
/// вместе с владельцем, в том числе при отказе записи.
struct Scratch {
    dir: PathBuf,
    file: PathBuf,
}

/// Имя вложенного архива становится именем файла в папке доводки (доводчик сверяет имя
/// файла с именем записи), а приходит оно из запроса или из оглавления чужого архива.
/// Годится только одно обычное звено: с разделителем, двоеточием (диск или поток NTFS),
/// нулём или из одних точек `join` увёл бы файл из папки доводки. Имя устройства Windows
/// открыло бы устройство вместо файла, а точку или пробел на конце Windows срезает молча
/// (имя файла перестало бы совпадать с именем записи). Устройства и хвост — то же правило,
/// что у пути на диске в движке (`paths::normalize_relative`): `rage-rpf` от движка не зависит,
/// поэтому правило записано дважды, а сходство двух копий держит тест `nested_name_rule_parity`.
pub fn plain_file_name(name: &str) -> bool {
    !matches!(name, "" | "." | "..")
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.ends_with(['.', ' '])
        && !is_device_name(name)
}

/// Цифра после COM и LPT: 0–9 и «верхние» ¹ ² ³ (U+00B9, U+00B2, U+00B3).
fn is_device_digit(symbol: char) -> bool {
    symbol.is_ascii_digit() || matches!(u32::from(symbol), 0xb9 | 0xb2 | 0xb3)
}

/// Имя устройства Windows: CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0–COM9, LPT0–LPT9. Регистр
/// не важен, расширение и пробелы перед ним не помогают: считается то, что стоит до первой точки.
fn is_device_name(name: &str) -> bool {
    let head = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(' ');
    let lower: Vec<char> = head.to_lowercase().chars().collect();
    let word: String = lower.iter().collect();
    if matches!(
        word.as_str(),
        "con" | "prn" | "aux" | "nul" | "conin$" | "conout$"
    ) {
        return true;
    }
    match lower.as_slice() {
        ['c', 'o', 'm', digit] | ['l', 'p', 't', digit] => is_device_digit(*digit),
        _ => false,
    }
}

impl Scratch {
    /// Отказ по имени идёт до создания папки: на диске не появляется ничего.
    fn create(staging: &Path, name: &str) -> Result<Scratch> {
        if !plain_file_name(name) {
            return Err(RpfError::format(format!(
                "Unsafe nested archive name: {name}"
            )));
        }
        let folder = format!(
            "nested-{}-{}",
            std::process::id(),
            STAGED_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let dir = staging.join(folder);
        fs::create_dir_all(&dir)?;
        Ok(Scratch {
            file: dir.join(name),
            dir,
        })
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

impl<'k> Plan<'k> {
    fn span(&self) -> u64 {
        blocks_of(self.len) * BLOCK
    }

    fn is_resource(&self) -> bool {
        matches!(self.meta, Meta::Resource { .. })
    }

    fn block_ceiling(&self) -> u64 {
        if self.is_resource() {
            limit::RESOURCE_BLOCK
        } else {
            limit::BINARY_BLOCK
        }
    }

    /// Двоичная запись на последнем блоке с размером в архиве меньше 64 КиБ: слова
    /// записи в оглавлении тогда совпадают с маркером каталога, и читатель принял
    /// бы её за каталог. Такому месту запись не годится.
    fn reads_as_directory_at(&self, block: u64) -> bool {
        matches!(self.meta, Meta::Binary { stored, .. } if stored >> 16 == 0)
            && block == limit::BINARY_BLOCK
    }

    fn in_ram(meta: Meta, ram: Ram) -> Plan<'k> {
        let len = ram.bytes().len() as u64;
        Plan {
            meta,
            len,
            origin: Origin::Ram(ram),
            fix_head: false,
        }
    }

    /// Тело как есть, без сжатия.
    fn verbatim(data: &Data, len: u64) -> Plan<'k> {
        let origin = match data {
            Data::Memory(bytes) => Origin::Ram(Ram::Shared(Arc::clone(bytes))),
            Data::File(path) => Origin::Disk(path.clone()),
        };
        Plan {
            meta: Meta::plain(len),
            len,
            origin,
            fix_head: false,
        }
    }

    fn deflated(data: &Data, len: u64, mode: Compress) -> Result<Plan<'k>> {
        let raw = match data {
            Data::Memory(bytes) => Ram::Shared(Arc::clone(bytes)),
            Data::File(path) if len <= limit::DEFLATE_READ_FILE => {
                let bytes = tally::timed(Phase::Sources, || fs::read(path))?;
                tally::add_read(bytes.len() as u64);
                Ram::Owned(bytes)
            }
            Data::File(_) => return Ok(Plan::verbatim(data, len)),
        };
        let packed = tally::timed(Phase::Deflate, || deflate(raw.bytes()))?;
        let unc = raw.bytes().len();
        let worth = mode == Compress::Always || packed.len() < unc;
        if worth && packed.len() <= limit::DEFLATED {
            let meta = Meta::Binary {
                stored: packed.len() as u32,
                unc: unc as u32,
                encrypted: false,
            };
            return Ok(Plan::in_ram(meta, Ram::Owned(packed)));
        }
        Ok(Plan::in_ram(Meta::plain(unc as u64), raw))
    }

    /// Готовый, доведённый файл становится телом: размер берётся уже после доводки.
    fn finished_file(name: &str, scratch: Scratch) -> Result<Plan<'k>> {
        let file = File::open(&scratch.file)?;
        let len = file.metadata()?.len();
        require_fit(name, len)?;
        Ok(Plan {
            meta: Meta::plain(len),
            len,
            origin: Origin::Staged {
                file,
                _scratch: Some(scratch),
            },
            fix_head: false,
        })
    }

    /// Двоичная запись `.rpf` уходит на доводку копией во временной папке. В режиме
    /// `NestedMode::Direct` копии нет, если доводчик может обойтись без файла
    /// (см. `direct::bring`).
    fn through_finalizer(
        name: &str,
        data: &Data,
        ctx: &WriteContext<'k>,
        finalizer: &'k dyn Finalizer,
        prep: &mut direct::Prep,
    ) -> Result<Plan<'k>> {
        let _nested = tally::span(Phase::Nested);
        if prep.is_direct() {
            if let Some(plan) = direct::bring(name, data, ctx, finalizer)? {
                tally::note_nested(true);
                return Ok(plan);
            }
        }
        tally::note_nested(false);
        let scratch = Scratch::create(ctx.staging, name)?;
        match data {
            Data::Memory(bytes) => {
                tally::timed(Phase::Bodies, || fs::write(&scratch.file, bytes))?;
                tally::add_written(bytes.len() as u64);
            }
            Data::File(src) => {
                let copied = tally::timed(Phase::Bodies, || fs::copy(src, &scratch.file))?;
                tally::add_read(copied);
                tally::add_written(copied);
            }
        }
        finalizer.finalize(&scratch.file, name)?;
        Plan::finished_file(name, scratch)
    }

    fn resource(name: &str, data: &Data) -> Result<Plan<'k>> {
        let len = data_len(data)?;
        if len < limit::RESOURCE_HEADER as u64 {
            return Err(RpfError::format(format!(
                "{name}: the resource is shorter than its header."
            )));
        }
        let mut head = [0u8; limit::RESOURCE_HEADER];
        let origin = match data {
            Data::Memory(bytes) => {
                head.copy_from_slice(&bytes[..limit::RESOURCE_HEADER]);
                Origin::Ram(Ram::Shared(Arc::clone(bytes)))
            }
            Data::File(path) => {
                File::open(path)?.read_exact(&mut head)?;
                Origin::Disk(path.clone())
            }
        };
        // заголовок как одно 128-битное слово: магия, версия, системные, графические
        let word = u128::from_le_bytes(head);
        if word as u32 != limit::RESOURCE_WORD {
            return Err(RpfError::format(format!(
                "{name}: this is not a resource file (RSC7)."
            )));
        }
        require_fit(name, len)?;
        let fix_head = len >= EXTENDED_SIZE_FROM;
        let meta = Meta::Resource {
            stored: len.min(EXTENDED_SIZE_FROM) as u32,
            system: (word >> 64) as u32,
            graphics: (word >> 96) as u32,
        };
        Ok(Plan {
            meta,
            len,
            origin,
            fix_head,
        })
    }

    /// Перенос записи открытого архива хранимыми байтами.
    fn carried(
        name: &str,
        from: &Arc<Archive>,
        id: EntryId,
        keys: Option<&'k KeySet>,
    ) -> Result<Plan<'k>> {
        match &from.entry(id).kind {
            EntryKind::Directory { .. } => {
                Err(RpfError::argument(format!("{name} is a directory.")))
            }
            EntryKind::Binary(info) => {
                let aes = info.encrypted && from.encryption() == Encryption::Aes;
                let (from, at) = (Arc::clone(from), info.offset());
                let origin = if aes {
                    let keys = keys.ok_or_else(|| {
                        RpfError::keys("AES-encrypted entry requires the GTA V key set.")
                    })?;
                    Origin::Deciphered { from, at, keys }
                } else {
                    Origin::Window { from, at }
                };
                let meta = Meta::Binary {
                    stored: info.stored_size,
                    unc: info.uncompressed_size,
                    encrypted: info.encrypted && !aes,
                };
                Ok(Plan {
                    meta,
                    len: info.stored_len(),
                    origin,
                    fix_head: false,
                })
            }
            EntryKind::Resource(info) => {
                let len = u64::from(info.stored_size);
                Ok(Plan {
                    meta: Meta::Resource {
                        stored: info.stored_size.min(EXTENDED_SIZE_FROM as u32),
                        system: info.system_flags,
                        graphics: info.graphics_flags,
                    },
                    len,
                    origin: Origin::Window {
                        from: Arc::clone(from),
                        at: info.offset(),
                    },
                    fix_head: len >= EXTENDED_SIZE_FROM,
                })
            }
        }
    }

    /// Вложенный архив из своего дерева: во временный файл без доводки либо в файл
    /// с настоящим именем, если доводка есть.
    fn subarchive(
        name: &str,
        root: &DirNode,
        ctx: &mut WriteContext<'k>,
        prep: &mut direct::Prep,
    ) -> Result<Plan<'k>> {
        let _nested = tally::span(Phase::Nested);
        let held = prep.held();
        // На прежнем пути место под вложенный архив занимается до его
        // вложенных: номер папки доводки охватывающего меньше номеров внутренних.
        let early = if prep.is_direct() {
            None
        } else {
            Some(Home::open(name, ctx)?)
        };
        // Сначала готовятся вложенные этого архива (и доводятся: ход вызовов
        // доводчика — вложенные раньше охватывающего).
        let layout = Layout::prepare_in(root, ctx, prep)?;
        let layout = if prep.is_direct() {
            match direct::nested(name, layout, ctx, prep)? {
                direct::Placed::Here(plan) => {
                    tally::note_nested(true);
                    return Ok(plan);
                }
                // доводчик на файле, нечем собрать в памяти или не хватает памяти
                direct::Placed::Stage(layout) => layout,
            }
        } else {
            layout
        };
        tally::note_nested(false);
        // тела вложенных, что ждали в памяти, уйдут во временный файл вместе с этим
        prep.release_to(held);
        let home = match early {
            Some(home) => home,
            None => Home::open(name, ctx)?,
        };
        match home {
            Home::Anonymous(mut file) => {
                layout.write_all(&mut file, &mut |_| {}, None)?;
                let size = layout.size();
                require_fit(name, size)?;
                Ok(Plan {
                    meta: Meta::plain(size),
                    len: size,
                    origin: Origin::Staged {
                        file,
                        _scratch: None,
                    },
                    fix_head: false,
                })
            }
            Home::Scratch(scratch) => {
                layout.write_all(&mut File::create(&scratch.file)?, &mut |_| {}, None)?;
                if let Some(finalizer) = ctx.finalizer {
                    finalizer.finalize(&scratch.file, name)?;
                }
                Plan::finished_file(name, scratch)
            }
        }
    }
}

/// Где собирается вложенный архив на прежнем пути: безымянный временный файл (без
/// доводчика) либо папка доводки `nested-<pid>-<n>` с файлом настоящего имени.
enum Home {
    Anonymous(File),
    Scratch(Scratch),
}

impl Home {
    fn open(name: &str, ctx: &WriteContext<'_>) -> Result<Home> {
        Ok(match ctx.finalizer {
            None => Home::Anonymous(tempfile::tempfile_in(ctx.staging)?),
            Some(_) => Home::Scratch(Scratch::create(ctx.staging, name)?),
        })
    }
}

fn prepare<'k>(
    node: &FileNode,
    ctx: &mut WriteContext<'k>,
    prep: &mut direct::Prep,
) -> Result<Plan<'k>> {
    let name = node.name.as_str();
    match &node.body {
        Body::Copy { archive, id } => Plan::carried(name, archive, *id, ctx.keys),
        Body::Resource { data } => Plan::resource(name, data),
        Body::Nested(root) => Plan::subarchive(name, root, ctx, prep),
        Body::Binary { data, compress } => {
            let len = data_len(data)?;
            require_fit(name, len)?;
            match (Treatment::pick(name, *compress), ctx.finalizer) {
                (Treatment::Stage, Some(finalizer)) => {
                    Plan::through_finalizer(name, data, ctx, finalizer, prep)
                }
                (Treatment::Deflate, _) => Plan::deflated(data, len, *compress),
                _ => Ok(Plan::verbatim(data, len)),
            }
        }
    }
}

/// Тела готовятся в порядке оглавления; перед каждым — проверка отмены и шаг хода.
fn prepare_all<'k>(
    rows: &[Row<'_>],
    ctx: &mut WriteContext<'k>,
    prep: &mut direct::Prep,
) -> Result<Vec<Plan<'k>>> {
    let files: Vec<&FileNode> = rows
        .iter()
        .filter_map(|r| match r.node {
            Node::File(f) => Some(f),
            Node::Dir(_) => None,
        })
        .collect();
    let total = files.len() as u64;
    files
        .into_iter()
        .zip(0u64..)
        .map(|(node, n)| {
            activity::check()?;
            activity::step("prepare", n, total);
            prepare(node, ctx, prep)
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Запись данных

/// Накопленный счёт записанных байт данных и общий буфер порций.
pub(crate) struct Sink<'p> {
    progress: &'p mut dyn FnMut(u64),
    written: u64,
    buf: Vec<u8>,
    /// Проверять отмену перед каждой порцией крупного тела (дозапись);
    /// полная запись проверяет её только между телами.
    check_each: bool,
    /// Конец самой дальней записи в файле: запись ниже него идёт «назад».
    high: u64,
}

impl Sink<'_> {
    fn advance(&mut self, n: u64) {
        self.written += n;
        (self.progress)(self.written);
    }

    /// Записывается `len` байт с `at`: назад ли это (ниже уже записанного места).
    /// Тела и головы вложенных идут по возрастанию смещений (`direct::Nested::put`);
    /// счёт нужен тесту, который это стережёт.
    fn mark(&mut self, at: u64, len: u64) {
        if at < self.high {
            tally::note_backward();
        }
        self.high = self.high.max(at + len);
    }

    /// Тело длиной `len` порциями до 8 МиБ, начиная с `at`. С `fix_head` первые
    /// 16 байт получают размер ресурса внутри.
    fn stream(
        &mut self,
        out: &mut File,
        at: u64,
        len: u64,
        fix_head: bool,
        mut feed: Feed<'_>,
    ) -> Result<()> {
        self.mark(at, len);
        out.seek(SeekFrom::Start(at))?;
        let mut done = 0u64;
        while done < len {
            if self.check_each {
                activity::check()?;
            }
            let take = (len - done).min(limit::PORTION as u64) as usize;
            if self.buf.len() < take {
                self.buf.resize(take, 0);
            }
            let chunk = &mut self.buf[..take];
            tally::timed(Phase::Sources, || feed(done, chunk))?;
            if done == 0 && fix_head {
                extended_size_bytes(len)
                    .into_iter()
                    .for_each(|(pos, value)| chunk[pos] = value);
            }
            tally::timed(Phase::Bodies, || out.write_all(chunk))?;
            tally::add_written(take as u64);
            done += take as u64;
            self.advance(take as u64);
        }
        Ok(())
    }

    /// Тело из памяти уходит одним куском и одним вызовом хода (даже пустое).
    fn whole(&mut self, out: &mut File, at: u64, plan: &Plan<'_>, bytes: &[u8]) -> Result<()> {
        if !bytes.is_empty() {
            self.mark(at, bytes.len() as u64);
            let _write = tally::span(Phase::Bodies);
            out.seek(SeekFrom::Start(at))?;
            match plan.fix_head {
                true => {
                    let (front, tail) = bytes.split_at(limit::RESOURCE_HEADER);
                    let mut head = [0u8; limit::RESOURCE_HEADER];
                    head.copy_from_slice(front);
                    extended_size_bytes(plan.len)
                        .into_iter()
                        .for_each(|(pos, value)| head[pos] = value);
                    out.write_all(&head)?;
                    out.write_all(tail)?;
                }
                false => out.write_all(bytes)?,
            }
            tally::add_written(bytes.len() as u64);
        }
        self.advance(bytes.len() as u64);
        Ok(())
    }

    fn put(&mut self, out: &mut File, at: u64, plan: &Plan<'_>) -> Result<()> {
        // пустое тело не из памяти не читается и ход не двигает
        if plan.len == 0 && !matches!(plan.origin, Origin::Ram(_)) {
            return Ok(());
        }
        match &plan.origin {
            // эти тела ложатся сами и в несколько мест: голова, тела, копии
            Origin::Nested(nested) => return nested.put(out, at, self),
            Origin::Brought(brought) => return brought.put(out, at, self),
            _ => {}
        }
        match plan.origin.source()? {
            Source::Whole(bytes) => self.whole(out, at, plan, bytes),
            Source::Pieces(feed) => self.stream(out, at, plan.len, plan.fix_head, feed),
        }
    }
}

// ---------------------------------------------------------------------------
// Новые тела для дозаписи в готовый архив

/// Тело новой записи, подготовленное к дозаписи в уже готовый архив (сжатие,
/// заголовок ресурса). Место ему раздаёт `append`, а не `Layout`.
pub(crate) struct Fresh<'k> {
    plan: Plan<'k>,
}

/// Готовит тело файла дерева: вложенный архив и доводчик здесь не работают
/// (`ctx.finalizer` вызывающий оставляет пустым), байты читаются при `put`.
pub(crate) fn prepare_fresh<'k>(node: &FileNode, ctx: &mut WriteContext<'k>) -> Result<Fresh<'k>> {
    prepare(node, ctx, &mut direct::Prep::new(NestedMode::Staged)).map(|plan| Fresh { plan })
}

impl Fresh<'_> {
    /// Сколько байт тело занимает в файле.
    pub(crate) fn len(&self) -> u64 {
        self.plan.len
    }

    /// Место, которое тело занимает вместе с добивкой до границы блока.
    pub(crate) fn span(&self) -> u64 {
        self.plan.span()
    }

    /// Номер блока годится телу: помещается в 23 бита записи и запись не
    /// читается как каталог.
    pub(crate) fn fits_at(&self, block: u64) -> bool {
        block <= self.plan.block_ceiling() && !self.plan.reads_as_directory_at(block)
    }

    /// Запись оглавления с этим смещением имени и номером блока.
    pub(crate) fn raw_entry(&self, name_offset: u32, block: u32) -> RawEntry {
        let kind = match self.plan.meta {
            Meta::Binary {
                stored,
                unc,
                encrypted,
            } => RawKind::Binary {
                stored_size: stored,
                offset_blocks: block,
                uncompressed_size: unc,
                encrypted,
            },
            Meta::Resource {
                stored,
                system,
                graphics,
            } => RawKind::Resource {
                stored_size: stored,
                offset_blocks: block,
                system_flags: system,
                graphics_flags: graphics,
            },
        };
        RawEntry { name_offset, kind }
    }

    /// Пишет тело с позиции `at`; ход и отмена — как у `Sink::for_append`.
    pub(crate) fn put(&self, out: &mut File, at: u64, sink: &mut Sink<'_>) -> Result<()> {
        sink.put(out, at, &self.plan)
    }
}

impl<'p> Sink<'p> {
    /// Приёмник для дозаписи: отмена проверяется перед каждой порцией, счёт
    /// записанных байт начинается с `written`.
    pub(crate) fn for_append(progress: &'p mut dyn FnMut(u64), written: u64) -> Sink<'p> {
        Sink {
            progress,
            written,
            buf: Vec::new(),
            check_each: true,
            high: 0,
        }
    }

    /// Сколько байт записано с начала счёта.
    pub(crate) fn written(&self) -> u64 {
        self.written
    }

    /// Засчитывает `n` записанных вне приёмника байт (перенос готового тела).
    pub(crate) fn credit(&mut self, n: u64) {
        self.advance(n);
    }
}

/// Порядок, в котором тела ложатся в файл: перенесённые записи идут по «источник,
/// смещение», потом остальные по таблице; у крупного архива сначала все ресурсы.
/// Источники упорядочены по первой встрече в таблице, а не по адресу в памяти:
/// одно и то же дерево даёт одни и те же байты при любом числе источников.
fn write_order(plans: &[Plan<'_>], total: u64) -> Vec<usize> {
    let mut met: Vec<*const Archive> = Vec::new();
    let source_rank: Vec<usize> = plans
        .iter()
        .map(|plan| match &plan.origin {
            Origin::Window { from, .. } => {
                let source = Arc::as_ptr(from);
                met.iter()
                    .position(|&seen| seen == source)
                    .unwrap_or_else(|| {
                        met.push(source);
                        met.len() - 1
                    })
            }
            _ => 0,
        })
        .collect();
    let rank = |i: usize| match &plans[i].origin {
        Origin::Window { at, .. } => (0u8, source_rank[i], *at),
        _ => (1, 0, 0),
    };
    let mut order: Vec<usize> = (0..plans.len()).collect();
    order.sort_by_key(|&i| rank(i));
    if total > limit::RESOURCES_FIRST_ABOVE {
        // вторым устойчивым проходом: ресурсы вперёд, прежний порядок внутри групп
        order.sort_by_key(|&i| !plans[i].is_resource());
    }
    order
}

/// Раздаёт места телам в порядке записи и возвращает этот порядок и номер блока
/// каждого тела (по порядку таблицы). Ничего не пишет.
fn place(plans: &[Plan<'_>], data_start: u64, total: u64) -> Result<(Vec<usize>, Vec<u32>)> {
    let order = write_order(plans, total);
    let mut placed = vec![0u32; plans.len()];
    let mut cursor = data_start;
    for &i in &order {
        let plan = &plans[i];
        let block = cursor / BLOCK;
        if block > plan.block_ceiling() || plan.reads_as_directory_at(block) {
            return Err(RpfError::format(TOO_BIG_TOC));
        }
        placed[i] = block as u32;
        cursor += plan.span();
    }
    Ok((order, placed))
}

// ---------------------------------------------------------------------------
// Заголовок и оглавление

fn encode_table(
    rows: &[Row<'_>],
    names: &NameBlock,
    plans: &[Plan<'_>],
    placed: &[u32],
) -> Result<Vec<u8>> {
    let too_big = |_| RpfError::format(TOO_BIG_TOC);
    let header = [
        MAGIC,
        u32::try_from(rows.len()).map_err(too_big)?,
        u32::try_from(names.block.len()).map_err(too_big)?,
        Encryption::None.marker(),
    ];
    let mut table: Vec<u8> = header.iter().flat_map(|w| w.to_le_bytes()).collect();

    for (row, &name_at) in rows.iter().zip(&names.offsets) {
        let kind = match row.file_no {
            None => RawKind::Directory {
                first: u32::try_from(row.kids.start).map_err(too_big)?,
                count: u32::try_from(row.kids.len()).map_err(too_big)?,
            },
            Some(n) => match plans[n].meta {
                Meta::Binary {
                    stored,
                    unc,
                    encrypted,
                } => RawKind::Binary {
                    stored_size: stored,
                    offset_blocks: placed[n],
                    uncompressed_size: unc,
                    encrypted,
                },
                Meta::Resource {
                    stored,
                    system,
                    graphics,
                } => RawKind::Resource {
                    stored_size: stored,
                    offset_blocks: placed[n],
                    system_flags: system,
                    graphics_flags: graphics,
                },
            },
        };
        let name_offset = u32::try_from(name_at).map_err(too_big)?;
        table.extend_from_slice(&encode_entry(&RawEntry { name_offset, kind }));
    }
    table.extend_from_slice(&names.block);
    Ok(table)
}
