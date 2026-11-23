//! `split-sheet-surfaces` и чтение графа модели для соседних команд.
//!
//! У части поверхности модели бывает свой лист: выбранные треугольники геометрии
//! уходят в отдельные геометрии, а их шейдер - копия исходного с подменённым
//! листом. Те же чтения графа (`pointer_block`, `u16_at`, `geometry_blocks` и другие)
//! нужны `decorate`, `graft`, `lamp-pole` и `restyle*`, поэтому открыты соседям.

use std::{
    collections::HashMap,
    fs,
    ops::RangeInclusive,
    path::{Path, PathBuf},
};

use rage_res::{
    drawable::read_materials,
    hash::joaat,
    meta_graph::deflate_body,
    resource::Resource,
    resource_graph::{self as rgraph, Address, Graph, Segment, Slot},
};
use serde_json::Value;

use super::{
    shop::{embed_sheet, texture_objects, texture_of, valid_name, write_atomic, Flags},
    Command,
};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const PREFIX: &str = "split-sheet-surfaces: ";

/// Расширения файлов, которые принимает команда.
mod ext {
    pub const REQUEST: &[&str] = &[".json"];
    pub const MODEL: &[&str] = &[".ydr"];
    pub const PICTURE: &[&str] = &[".dds"];
    pub const DICTIONARY: &[&str] = &[".ytd"];
}

/// Размеры записей в байтах: рамки модели, параметр шейдера, хеш параметра, запись списка.
mod width {
    pub const FRAME: usize = 32;
    pub const PARAM: usize = 16;
    pub const HASH: usize = 4;
    pub const ENTRY: usize = 8;
}

/// Смещения полей графа модели.
mod at {
    pub const ROOT_GROUP: usize = 0x10;
    pub const ROOT_LEVELS: usize = 0x50;
    pub const LEVELS_ARRAY: usize = 0x00;
    pub const LEVELS_COUNT: usize = 0x08;
    pub const MODEL_GEOMETRIES: usize = 0x08;
    pub const MODEL_COUNT: usize = 0x10;
    pub const MODEL_FRAMES: usize = 0x18;
    pub const MODEL_SHADERS: usize = 0x20;
    /// Три копии числа геометрий, которые хост держит согласованными.
    pub const MODEL_COUNTERS: [usize; 3] = [0x10, 0x12, 0x2e];
    pub const GEOMETRY_VERTICES: usize = 0x18;
    pub const GEOMETRY_INDICES: usize = 0x38;
    /// Счётчики блока геометрии: индексов, треугольников, вершин (младшие 16 бит слова); указатель данных вершин.
    pub const GEOMETRY_INDEX_COUNT: usize = 0x58;
    pub const GEOMETRY_TRIANGLE_COUNT: usize = 0x5c;
    pub const GEOMETRY_VERTEX_COUNT: usize = 0x60;
    pub const GEOMETRY_DATA: usize = 0x78;
    pub const VERTICES_STRIDE: usize = 0x08;
    /// Два возможных потока вершин: у одежды занят только второй.
    pub const VERTICES_STREAMS: [usize; 2] = [0x10, 0x20];
    pub const VERTICES_COUNT: usize = 0x18;
    pub const VERTICES_DECLARATION: usize = 0x30;
    pub const DECLARATION_STRIDE: usize = 0x04;
    pub const INDICES_COUNT: usize = 0x08;
    pub const INDICES_DATA: usize = 0x10;
    pub const GROUP_DICTIONARY: usize = 0x08;
    pub const GROUP_SHADERS: usize = 0x10;
    pub const GROUP_COUNT: usize = 0x18;
    pub const GROUP_CAPACITY: usize = 0x1a;
    pub const SHADER_PARAMS: usize = 0x00;
    pub const SHADER_PARAM_COUNT: usize = 0x10;
    pub const TEXTURE_NAME: usize = 0x28;
}

// ---------------------------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------------------------

/// Отказы с готовым текстом; номер варианта - номер строки в `Fixed::words`.
#[derive(Clone, Copy)]
enum Fixed {
    Json,
    Format,
    Target,
    List,
    Count,
    TriangleList,
    TriangleNumber,
    SheetName,
    OwnName,
    NoRoot,
    NoHigh,
    ModelRange,
    LoneWhole,
    TriangleRange,
    TriangleTwice,
    VertexRange,
    StreamShort,
    FramesShort,
    ShaderMissing,
    ShaderOfGeometry,
    ParamOutside,
    FramesList,
}

impl Fixed {
    fn words(self) -> &'static str {
        const TABLE: [&str; 22] = [
            "JSON не разбирается.",
            "неизвестный формат запроса.",
            "нужен target.",
            "нужен список splits.",
            "от 1 до 128 частей.",
            "triangles — список номеров.",
            "номер треугольника не число.",
            "имя текстуры не допускается.",
            "новая текстура должна иметь своё имя.",
            "у модели нет корня.",
            "у модели нет высокой детализации.",
            "номер модели вне списка.",
            "целая геометрия не может делиться с другими частями.",
            "номер треугольника вне буфера индексов.",
            "треугольник принадлежит двум частям.",
            "индекс вне буфера вершин.",
            "буфер вершин короче заявленного.",
            "рамки модели короче заявленного.",
            "геометрия указывает на несуществующий шейдер.",
            "нет шейдера у геометрии.",
            "текстура параметра вне блоков.",
            "блок рамок короче нужного.",
        ];
        TABLE[self as usize]
    }
}

impl From<Fixed> for EngineError {
    fn from(fixed: Fixed) -> Self {
        invalid(format!("{PREFIX}{}", fixed.words()))
    }
}

/// Отказы, в тексте которых названа текстура или число.
enum Refusal<'a> {
    SheetMissing(&'a str),
    NotUsing(&'a str),
    Unbound(&'a str),
    NotInDictionary(&'a str),
    Recount { found: usize, wanted: usize },
}

impl From<Refusal<'_>> for EngineError {
    fn from(refusal: Refusal<'_>) -> Self {
        let tail = match refusal {
            Refusal::SheetMissing(name) => format!("нет листа {name} в словаре."),
            Refusal::NotUsing(name) => format!("шейдер не использует текстуру {name}."),
            Refusal::Unbound(name) => format!("лист {name} ни к одному шейдеру не привязан."),
            Refusal::NotInDictionary(name) => format!("в словаре нет листа {name}."),
            Refusal::Recount { found, wanted } => format!("{found} геометрий вместо {wanted}."),
        };
        invalid(format!("{PREFIX}{tail}"))
    }
}

/// Отказ чтения графа: `<приставка><что>.`
fn refuse(what: &str) -> EngineError {
    invalid(format!("{PREFIX}{what}."))
}

pub(super) fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

// ---------------------------------------------------------------------------------------------
// Курсор над блоком и помощники для соседей
// ---------------------------------------------------------------------------------------------

/// Курсор над одним блоком: указатели по слотам и числа из его содержимого.
#[derive(Clone, Copy)]
struct Cell<'g> {
    graph: &'g Graph,
    block: usize,
}

impl<'g> Cell<'g> {
    fn at(graph: &'g Graph, block: usize) -> Self {
        Cell { graph, block }
    }

    /// `N` байт из содержимого блока; выход за него (и переполнение смещения) - отказ.
    fn le<const N: usize>(self, relative: usize) -> Result<[u8; N]> {
        relative
            .checked_add(N)
            .and_then(|end| self.graph.content(self.block).get(relative..end))
            .and_then(|window| <[u8; N]>::try_from(window).ok())
            .ok_or_else(|| refuse("чтение за блоком"))
    }

    /// Блок, на который указывает слот по смещению `relative`.
    fn child(self, relative: usize) -> Option<usize> {
        let slots = &self.graph.blocks[self.block].slots;
        let slot = slots.iter().find(|slot| slot.relative == relative)?;
        self.graph.block_at(slot.target)
    }

    fn require(self, relative: usize, what: &str) -> Result<usize> {
        self.child(relative).ok_or_else(|| refuse(what))
    }

    /// Записи массива указателей: `count` штук, запись `i` - слот по `i * 8`.
    fn items(self, count: usize, empty: &str) -> Result<Vec<usize>> {
        (0..count)
            .map(|item| self.require(item * width::ENTRY, empty))
            .collect()
    }
}

pub(super) fn address_of(graph: &Graph, block: usize) -> Address {
    let found = &graph.blocks[block];
    Address {
        segment: found.segment,
        offset: found.start,
    }
}

pub(super) fn pointer_block(graph: &Graph, block: usize, relative: usize) -> Option<usize> {
    Cell::at(graph, block).child(relative)
}

pub(super) fn need_block(
    graph: &Graph,
    block: usize,
    relative: usize,
    what: &str,
) -> Result<usize> {
    Cell::at(graph, block).require(relative, what)
}

pub(super) fn u16_at(graph: &Graph, block: usize, relative: usize) -> Result<u16> {
    Cell::at(graph, block).le(relative).map(u16::from_le_bytes)
}

pub(super) fn u32_at(graph: &Graph, block: usize, relative: usize) -> Result<u32> {
    Cell::at(graph, block).le(relative).map(u32::from_le_bytes)
}

pub(super) fn high_models(graph: &Graph, root: usize) -> Result<Vec<usize>> {
    let Some(target) = rgraph::pointer_from(graph, root, at::ROOT_LEVELS) else {
        return Ok(Vec::new());
    };
    let header = graph
        .block_at(target)
        .map(|block| Cell::at(graph, block))
        .ok_or_else(|| refuse("список моделей вне блоков"))?;
    // Массив нужен всегда, даже когда моделей ноль.
    let array = header.require(at::LEVELS_ARRAY, "список моделей без записей")?;
    let count = u16::from_le_bytes(header.le(at::LEVELS_COUNT)?);
    Cell::at(graph, array).items(usize::from(count), "пустая модель")
}

pub(super) fn geometry_blocks(graph: &Graph, model: usize) -> Result<Vec<usize>> {
    match u16_at(graph, model, at::MODEL_COUNT)? {
        0 => Ok(Vec::new()),
        count => {
            let list = need_block(
                graph,
                model,
                at::MODEL_GEOMETRIES,
                "модель без списка геометрий",
            )?;
            Cell::at(graph, list).items(usize::from(count), "пустая геометрия")
        }
    }
}

pub(super) fn mapping_of(graph: &Graph, model: usize) -> Result<Option<Vec<u16>>> {
    pointer_block(graph, model, at::MODEL_SHADERS)
        .map(|table| {
            let count = u16_at(graph, model, at::MODEL_COUNT)?;
            (0..usize::from(count))
                .map(|geometry| u16_at(graph, table, geometry * 2))
                .collect()
        })
        .transpose()
}

pub(super) fn vertex_stride(graph: &Graph, vertex_buffer: usize) -> Result<usize> {
    let own =
        Some(u16_at(graph, vertex_buffer, at::VERTICES_STRIDE)?).filter(|stride| *stride != 0);
    own.map_or_else(
        || {
            let declaration = need_block(
                graph,
                vertex_buffer,
                at::VERTICES_DECLARATION,
                "буфер вершин без декларации",
            )?;
            u16_at(graph, declaration, at::DECLARATION_STRIDE).map(usize::from)
        },
        |stride| Ok(usize::from(stride)),
    )
}

pub(super) fn read_indices(graph: &Graph, geometry: usize) -> Result<Vec<u16>> {
    let buffer = need_block(
        graph,
        geometry,
        at::GEOMETRY_INDICES,
        "геометрия без буфера индексов",
    )?;
    let count = u32_at(graph, buffer, at::INDICES_COUNT)? as usize;
    let data = need_block(graph, buffer, at::INDICES_DATA, "буфер индексов без данных")?;
    let stored = graph.content(data);
    let used = count
        .checked_mul(2)
        .filter(|&need| count % 3 == 0 && need <= stored.len())
        .ok_or_else(|| refuse("буфер индексов не список треугольников"))?;
    Ok(stored[..used]
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes(<[u8; 2]>::try_from(pair).unwrap_or_default()))
        .collect())
}

pub(super) fn copy_span(graph: &Graph, block: usize, len: usize) -> Result<(Vec<u8>, Vec<Slot>)> {
    let first = &graph.blocks[block];
    let start = first.start;
    let raw = start
        .checked_add(len)
        .and_then(|stop| graph.bytes(first.segment).get(start..stop))
        .ok_or_else(|| refuse("кусок параметров выходит за область"))?;
    let slots = graph
        .segment_blocks(first.segment)
        .iter()
        .flat_map(|&index| {
            let found = &graph.blocks[index];
            found
                .slots
                .iter()
                .map(move |slot| (found.start + slot.relative, slot.target))
        })
        .filter_map(|(absolute, target)| {
            let relative = absolute.checked_sub(start)?;
            (relative + width::ENTRY <= len).then_some(Slot { relative, target })
        })
        .collect();
    Ok((raw.to_vec(), slots))
}

pub(super) fn texture_name(graph: &Graph, object: usize) -> Result<String> {
    let text = need_block(graph, object, at::TEXTURE_NAME, "у текстуры нет имени")?;
    let raw = graph.content(text);
    let name = raw.split(|&byte| byte == 0).next().unwrap_or(raw);
    Ok(String::from_utf8_lossy(name).into_owned())
}

pub(super) fn pointer_list(graph: &Graph, blocks: &[usize]) -> (Vec<u8>, Vec<Slot>) {
    let slots = blocks
        .iter()
        .zip((0..).step_by(width::ENTRY))
        .map(|(&block, relative)| Slot {
            relative,
            target: address_of(graph, block),
        })
        .collect();
    (vec![0; blocks.len() * width::ENTRY], slots)
}

// ---------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------

/// Узел запроса: чтение полей без отказов, плохое значение читается как «нет».
#[derive(Clone, Copy)]
struct Node<'a>(&'a Value);

fn whole(value: &Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|number| usize::try_from(number).ok())
}

impl<'a> Node<'a> {
    fn child(self, key: &str) -> Option<&'a Value> {
        self.0.get(key)
    }

    fn text(self, key: &str) -> Option<&'a str> {
        self.child(key)?.as_str()
    }

    /// Неотрицательное целое; всё остальное (строка, минус, дробь, нет) - 0.
    fn ordinal(self, key: &str) -> usize {
        self.child(key).and_then(whole).unwrap_or(0)
    }

    /// Имя листа: края срезаны, ASCII-буквы строчные; нет или не строка - пусто.
    fn label(self, key: &str) -> String {
        self.text(key)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
    }

    /// `triangles`: нет или `null` - вся геометрия, иначе список неотрицательных целых.
    fn triangles(self) -> Result<Option<Vec<usize>>> {
        match self.child("triangles") {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Array(items)) => items
                .iter()
                .map(|item| whole(item).ok_or_else(|| Fixed::TriangleNumber.into()))
                .collect::<Result<Vec<_>>>()
                .map(Some),
            Some(_) => Err(Fixed::TriangleList.into()),
        }
    }

    /// Пара имён «было, стало»: обе годятся для хоста и не совпадают.
    fn swap(self) -> Result<Swap> {
        let swap = Swap {
            from: self.label("from"),
            to: self.label("to"),
        };
        if ![&swap.from, &swap.to]
            .into_iter()
            .all(|name| valid_name(name))
        {
            return Err(Fixed::SheetName.into());
        }
        (swap.from != swap.to)
            .then_some(swap)
            .ok_or_else(|| Fixed::OwnName.into())
    }
}

/// Куда в запросе целится часть: модель и геометрия в ней.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Aim {
    model: usize,
    geometry: usize,
}

/// Какой лист на какой меняется.
struct Swap {
    from: String,
    to: String,
}

/// Одна часть запроса: что выделить и на какой лист перевести.
struct Part {
    aim: Aim,
    /// `None` - вся геометрия.
    triangles: Option<Vec<usize>>,
    swap: Swap,
    dds: PathBuf,
    source: Option<PathBuf>,
}

impl Part {
    fn read(node: Node<'_>) -> Result<Part> {
        let triangles = node.triangles()?;
        let swap = node.swap()?;
        Ok(Part {
            aim: Aim {
                model: node.ordinal("model"),
                geometry: node.ordinal("geometry"),
            },
            triangles,
            swap,
            dds: paths::existing_file(node.text("dds").unwrap_or_default(), ext::PICTURE)?,
            source: node
                .text("source")
                .filter(|path| !path.is_empty())
                .map(|path| paths::existing_file(path, ext::DICTIONARY))
                .transpose()?,
        })
    }
}

/// Разобранный запрос: путь цели и части.
struct Request {
    target: String,
    parts: Vec<Part>,
}

impl Request {
    const FORMAT: &'static str = "astral.split-sheet-surfaces";
    const PARTS: RangeInclusive<usize> = 1..=128;

    fn load(path: &Path) -> Result<Request> {
        let document: Value =
            serde_json::from_str(&fs::read_to_string(path)?).map_err(|_| Fixed::Json)?;
        let root = Node(&document);
        let version_one = root.child("version").and_then(Value::as_u64) == Some(1);
        if root.text("format") != Some(Self::FORMAT) || !version_one {
            return Err(Fixed::Format.into());
        }
        let target = root.text("target").ok_or(Fixed::Target)?.to_owned();
        let listed = root
            .child("splits")
            .and_then(Value::as_array)
            .ok_or(Fixed::List)?;
        if !Self::PARTS.contains(&listed.len()) {
            return Err(Fixed::Count.into());
        }
        let parts = listed
            .iter()
            .map(|item| Part::read(Node(item)))
            .collect::<Result<_>>()?;
        Ok(Request { target, parts })
    }
}

/// Проверенные пути и части запроса.
struct Job {
    parts: Vec<Part>,
    target: PathBuf,
    output: PathBuf,
}

impl Job {
    fn resolve(options: &Options) -> Result<Job> {
        let input = paths::existing_file(options.required("input")?, ext::REQUEST)?;
        let Request { target, parts } = Request::load(&input)?;
        Ok(Job {
            parts,
            target: paths::existing_file(&target, ext::MODEL)?,
            output: paths::output_file(options.required("output")?, ext::MODEL)?,
        })
    }
}

/// Части по адресу `(модель, геометрия)`, внутри адреса - в порядке запроса.
struct Lanes<'p>(HashMap<Aim, Vec<&'p Part>>);

impl<'p> Lanes<'p> {
    fn sort(parts: &'p [Part], models: usize) -> Result<Self> {
        let mut lanes: HashMap<Aim, Vec<&'p Part>> = HashMap::new();
        for part in parts {
            if part.aim.model >= models {
                return Err(Fixed::ModelRange.into());
            }
            lanes.entry(part.aim).or_default().push(part);
        }
        Ok(Lanes(lanes))
    }

    fn at(&self, model: usize, geometry: usize) -> Option<&[&'p Part]> {
        self.0.get(&Aim { model, geometry }).map(Vec::as_slice)
    }
}

// ---------------------------------------------------------------------------------------------
// Части правки: владельцы треугольников, нумерация вершин, копии шейдеров
// ---------------------------------------------------------------------------------------------

/// Чей каждый треугольник геометрии: номер части либо никто.
struct Owners {
    cells: Vec<Option<usize>>,
    /// Единственная часть без `triangles` - вся геометрия.
    whole: bool,
}

impl Owners {
    fn mark(triangles: usize, parts: &[&Part]) -> Result<Owners> {
        let mut owners = Owners {
            cells: vec![None; triangles],
            whole: false,
        };
        parts
            .iter()
            .enumerate()
            .try_for_each(|(number, part)| match &part.triangles {
                None if parts.len() == 1 => {
                    owners.whole = true;
                    Ok(())
                }
                None => Err(Fixed::LoneWhole.into()),
                Some(listed) => listed
                    .iter()
                    .try_for_each(|&triangle| owners.claim(number, triangle)),
            })?;
        Ok(owners)
    }

    fn claim(&mut self, part: usize, triangle: usize) -> Result<()> {
        let cell = self.cells.get_mut(triangle).ok_or(Fixed::TriangleRange)?;
        match cell.replace(part) {
            Some(_) => Err(Fixed::TriangleTwice.into()),
            None => Ok(()),
        }
    }

    /// Индексы по частям (`parts` штук) и остаток; внутри каждого - по возрастанию номера треугольника.
    fn deal(&self, indices: &[u16], parts: usize) -> (Vec<Vec<u16>>, Vec<u16>) {
        let mut shares = vec![Vec::new(); parts];
        let mut rest = Vec::new();
        for (owner, triangle) in self.cells.iter().zip(indices.chunks_exact(3)) {
            let bin = owner.map_or(&mut rest, |part| &mut shares[part]);
            bin.extend_from_slice(triangle);
        }
        (shares, rest)
    }
}

/// Новая нумерация вершин: порядок первого появления индекса среди треугольников.
struct Remap {
    seen: Vec<Option<u16>>,
    limit: usize,
    /// Старые номера оставленных вершин по порядку.
    kept: Vec<u16>,
    /// Индексы треугольников в новой нумерации.
    indices: Vec<u16>,
}

impl Remap {
    fn of(triangles: &[u16], vertices: usize) -> Result<Remap> {
        let mut remap = Remap {
            seen: vec![None; usize::from(u16::MAX) + 1],
            limit: vertices,
            kept: Vec::new(),
            indices: Vec::with_capacity(triangles.len()),
        };
        triangles.iter().try_for_each(|&old| remap.take(old))?;
        Ok(remap)
    }

    fn take(&mut self, old: u16) -> Result<()> {
        if usize::from(old) >= self.limit {
            return Err(Fixed::VertexRange.into());
        }
        let fresh = *self.seen[usize::from(old)].get_or_insert_with(|| {
            self.kept.push(old);
            (self.kept.len() - 1) as u16
        });
        self.indices.push(fresh);
        Ok(())
    }
}

/// План новой геометрии: всё, что можно проверить и посчитать, не трогая граф.
struct Carving {
    vertices: usize,
    indices: usize,
    data: usize,
    /// Новые потоки: исходный блок и байты оставленных вершин.
    streams: Vec<(usize, Vec<u8>)>,
    /// Слот потока в буфере вершин и номер нового потока для него.
    lanes: Vec<(usize, usize)>,
    kept: u32,
    renumbered: Vec<u8>,
}

impl Carving {
    fn inspect(graph: &Graph, geometry: usize, triangles: &[u16]) -> Result<Carving> {
        let cell = Cell::at(graph, geometry);
        let vertices = cell.require(at::GEOMETRY_VERTICES, "геометрия без буфера вершин")?;
        // Первый поток нужен всегда: у одежды (поток только во втором слоте) деление отказывает.
        let buffer = Cell::at(graph, vertices);
        buffer.require(at::VERTICES_STREAMS[0], "геометрия без буфера вершин")?;
        let indices = cell.require(at::GEOMETRY_INDICES, "геометрия без буфера индексов")?;
        let total = u32_at(graph, vertices, at::VERTICES_COUNT)? as usize;
        let stride = vertex_stride(graph, vertices)?;
        let remap = Remap::of(triangles, total)?;

        let mut streams: Vec<(usize, Vec<u8>)> = Vec::new();
        let lanes = at::VERTICES_STREAMS
            .iter()
            .filter_map(|&relative| buffer.child(relative).map(|stream| (relative, stream)))
            .map(|(relative, stream)| -> Result<(usize, usize)> {
                if let Some(place) = streams.iter().position(|(known, _)| *known == stream) {
                    return Ok((relative, place));
                }
                let rows = graph.content(stream);
                (total != 0 && stride != 0 && total * stride <= rows.len())
                    .then_some(())
                    .ok_or(Fixed::StreamShort)?;
                let cut = remap
                    .kept
                    .iter()
                    .flat_map(|&old| rows[usize::from(old) * stride..][..stride].iter().copied())
                    .collect();
                streams.push((stream, cut));
                Ok((relative, streams.len() - 1))
            })
            .collect::<Result<Vec<_>>>()?;
        let data = need_block(
            graph,
            indices,
            at::INDICES_DATA,
            "буфер индексов без данных",
        )?;
        Ok(Carving {
            vertices,
            indices,
            data,
            streams,
            lanes,
            kept: remap.kept.len() as u32,
            renumbered: remap
                .indices
                .iter()
                .flat_map(|index| index.to_le_bytes())
                .collect(),
        })
    }
}

/// Параметры шейдера: блок записей и вид каждой (первый байт записи).
struct Params {
    block: usize,
    kinds: Vec<u8>,
}

impl Params {
    fn read(graph: &Graph, shader: usize) -> Result<Params> {
        let block = need_block(graph, shader, at::SHADER_PARAMS, "у шейдера нет параметров")?;
        let declared = usize::from(Cell::at(graph, shader).le::<1>(at::SHADER_PARAM_COUNT)?[0]);
        let kinds = (0..declared)
            .map(|param| {
                Cell::at(graph, block)
                    .le::<1>(param * width::PARAM)
                    .map(|[kind]| kind)
            })
            .collect::<Result<_>>()?;
        Ok(Params { block, kinds })
    }

    /// Записи вместе с блоками данных векторов: хеши имён лежат следом.
    fn values(&self) -> usize {
        self.kinds
            .iter()
            .map(|&kind| usize::from(kind) + 1)
            .sum::<usize>()
            * width::PARAM
    }

    /// Записи, данные и хеши - кусок, который копируется целиком.
    fn span(&self) -> usize {
        self.values() + self.kinds.len() * width::HASH
    }

    /// Хеш имени параметра `param` из копии `raw`.
    fn hash(&self, raw: &[u8], param: usize) -> u32 {
        let at = self.values() + param * width::HASH;
        raw.get(at..at + width::HASH)
            .and_then(|word| <[u8; 4]>::try_from(word).ok())
            .map_or(0, u32::from_le_bytes)
    }

    /// Переводит на `sheet` слоты текстур, названных `swap.from` (по имени или по хешу параметра);
    /// возвращает число замен.
    fn retarget(
        &self,
        graph: &Graph,
        raw: &[u8],
        slots: &mut [Slot],
        swap: &Swap,
        sheet: Address,
    ) -> Result<usize> {
        let wanted = joaat(&swap.from);
        self.kinds
            .iter()
            .enumerate()
            .filter(|(_, &kind)| kind == 0)
            .try_fold(0, |hits, (param, _)| {
                let relative = param * width::PARAM + 8;
                let Some(slot) = slots.iter_mut().find(|slot| slot.relative == relative) else {
                    return Ok(hits);
                };
                let object = graph.block_at(slot.target).ok_or(Fixed::ParamOutside)?;
                let named = texture_name(graph, object)?.eq_ignore_ascii_case(&swap.from);
                let hit = named || self.hash(raw, param) == wanted;
                if hit {
                    slot.target = sheet;
                }
                Ok(hits + usize::from(hit))
            })
    }
}

/// Копии шейдеров в порядке создания: ключ «исходный шейдер, лист» и блок копии.
#[derive(Default)]
struct Spares {
    made: Vec<((usize, String), usize)>,
}

impl Spares {
    fn find(&self, source: usize, sheet: &str) -> Option<usize> {
        self.made
            .iter()
            .position(|((known, to), _)| *known == source && to == sheet)
    }

    fn add(&mut self, source: usize, sheet: &str, block: usize) -> usize {
        self.made.push(((source, sheet.to_owned()), block));
        self.made.len() - 1
    }

    fn blocks(&self) -> impl Iterator<Item = usize> + '_ {
        self.made.iter().map(|(_, block)| *block)
    }
}

// ---------------------------------------------------------------------------------------------
// Правка графа
// ---------------------------------------------------------------------------------------------

/// Геометрия на выходе: блок, номер шейдера и слот исходной геометрии (откуда рамка).
struct Placed {
    block: usize,
    shader: u16,
    origin: usize,
}

struct Model {
    block: usize,
    geometries: Vec<usize>,
}

/// Очередь выходных геометрий: часть (`None` - остаток) и номер её шейдера. Остаток встаёт на
/// место исходной с прежним шейдером; без остатка на её место идёт последняя часть.
fn lineup(
    mut live: Vec<(Option<usize>, u16)>,
    rest_empty: bool,
    shader: u16,
) -> Vec<(Option<usize>, u16)> {
    let lead = if rest_empty { live.pop() } else { None };
    live.insert(0, lead.unwrap_or((None, shader)));
    live
}

/// Рабочий стол команды: граф модели и всё, что накопили по ходу правки.
struct Bench {
    graph: Graph,
    group: usize,
    models: Vec<Model>,
    /// Шейдеры группы до правок.
    shaders: Vec<usize>,
    /// Объекты листов `to` в словаре, по имени в нижнем регистре.
    sheets: HashMap<String, Address>,
    spares: Spares,
    created: usize,
    moved: usize,
}

impl Bench {
    fn new(graph: Graph, group: usize, models: Vec<Model>) -> Bench {
        Bench {
            graph,
            group,
            models,
            shaders: Vec::new(),
            sheets: HashMap::new(),
            spares: Spares::default(),
            created: 0,
            moved: 0,
        }
    }

    fn open(target: &Path) -> Result<Bench> {
        let graph = rgraph::scan(&Resource::parse(&fs::read(target)?)?)?;
        let root = graph.root().ok_or(Fixed::NoRoot)?;
        let group = need_block(&graph, root, at::ROOT_GROUP, "у модели нет группы шейдеров")?;
        let high = high_models(&graph, root)?;
        if high.is_empty() {
            return Err(Fixed::NoHigh.into());
        }
        let models = high
            .into_iter()
            .map(|block| {
                geometry_blocks(&graph, block).map(|geometries| Model { block, geometries })
            })
            .collect::<Result<_>>()?;
        Ok(Bench::new(graph, group, models))
    }

    fn geometries_before(&self) -> usize {
        self.models.iter().map(|model| model.geometries.len()).sum()
    }

    fn embed_one(&mut self, part: &Part) -> Result<()> {
        let flags = Flags {
            from: &part.swap.from,
            source: part.source.as_deref(),
            keep_donor: false,
            prefer_dictionary: true,
        };
        let texture = texture_of(&part.swap.to, &part.dds)?;
        embed_sheet(&mut self.graph, self.group, texture, flags)
    }

    /// Вписывает листы запроса: каждый `to` один раз, по первой части с таким именем.
    fn embed_sheets(&mut self, parts: &[Part]) -> Result<Vec<String>> {
        let firsts: Vec<&Part> = parts
            .iter()
            .enumerate()
            .filter(|(at, part)| {
                parts[..*at]
                    .iter()
                    .all(|earlier| earlier.swap.to != part.swap.to)
            })
            .map(|(_, part)| part)
            .collect();
        firsts.iter().try_for_each(|part| self.embed_one(part))?;
        Ok(firsts.iter().map(|part| part.swap.to.clone()).collect())
    }

    /// Читает у группы словарь листов и список шейдеров (после вписывания листов).
    fn read_group(&mut self) -> Result<()> {
        let group = Cell::at(&self.graph, self.group);
        let dictionary = group.require(at::GROUP_DICTIONARY, "у группы нет словаря текстур")?;
        let objects = texture_objects(&self.graph, address_of(&self.graph, dictionary))?;
        // Одноимённые листы: побеждает первый, поэтому вставка идёт с конца.
        self.sheets.extend(
            objects
                .into_iter()
                .rev()
                .map(|(name, object)| (name.to_ascii_lowercase(), object)),
        );
        let list = group.require(at::GROUP_SHADERS, "у группы нет списка шейдеров")?;
        let count = u16::from_le_bytes(group.le(at::GROUP_COUNT)?);
        self.shaders =
            Cell::at(&self.graph, list).items(usize::from(count), "пустой шейдер в списке")?;
        Ok(())
    }

    /// Новый блок в той же области, что и `like`.
    fn spawn(&mut self, like: usize, bytes: Vec<u8>, slots: Vec<Slot>) -> usize {
        let segment = self.graph.blocks[like].segment;
        rgraph::append_block(&mut self.graph, segment, bytes, slots)
    }

    /// Копия блока `old` в его области: слоты из `moves` смотрят на новые блоки, а `word`
    /// (смещение и значение) правит четыре байта копии.
    fn reborn(
        &mut self,
        old: usize,
        moves: &[(usize, usize)],
        word: Option<(usize, u32)>,
    ) -> usize {
        let mut bytes = self.graph.content(old).to_vec();
        let window = word
            .and_then(|(relative, value)| Some((bytes.get_mut(relative..relative + 4)?, value)));
        if let Some((window, value)) = window {
            window.copy_from_slice(&value.to_le_bytes());
        }
        let slots = self.graph.blocks[old]
            .slots
            .iter()
            .map(|slot| {
                let moved = moves
                    .iter()
                    .find(|(relative, _)| *relative == slot.relative);
                moved.map_or(*slot, |&(_, fresh)| Slot {
                    relative: slot.relative,
                    target: address_of(&self.graph, fresh),
                })
            })
            .collect();
        self.spawn(old, bytes, slots)
    }

    /// Переводит слот блока `holder` по смещению `relative` на начало блока `fresh`.
    fn reroute(&mut self, holder: usize, relative: usize, fresh: usize) -> Result<()> {
        let target = address_of(&self.graph, fresh);
        Ok(rgraph::retarget(&mut self.graph, holder, relative, target)?)
    }

    /// Новый список указателей на `blocks` в системной области и слот `holder` на него.
    fn relist(&mut self, holder: usize, relative: usize, blocks: &[usize]) -> Result<()> {
        let (zeros, slots) = pointer_list(&self.graph, blocks);
        let list = rgraph::append_block(&mut self.graph, Segment::System, zeros, slots);
        self.reroute(holder, relative, list)
    }

    /// Копия исходного шейдера `source` с листом части: блок параметров, затем сам шейдер.
    fn copy_shader(&mut self, source: usize, part: &Part) -> Result<usize> {
        let original = *self.shaders.get(source).ok_or(Fixed::ShaderMissing)?;
        let sheet = *self
            .sheets
            .get(&part.swap.to)
            .ok_or(Refusal::SheetMissing(&part.swap.to))?;
        let params = Params::read(&self.graph, original)?;
        let (raw, mut slots) = copy_span(&self.graph, params.block, params.span())?;
        let hits = params.retarget(&self.graph, &raw, &mut slots, &part.swap, sheet)?;
        (hits > 0)
            .then_some(())
            .ok_or(Refusal::NotUsing(&part.swap.from))?;
        let params_copy = self.spawn(params.block, raw, slots);
        Ok(self.reborn(original, &[(at::SHADER_PARAMS, params_copy)], None))
    }

    /// Номер копии исходного шейдера `source` с листом части; новая копия создаётся один раз
    /// на пару «шейдер, лист».
    fn spare_for(&mut self, source: usize, part: &Part) -> Result<u16> {
        let base = self.shaders.len();
        let index = match self.spares.find(source, &part.swap.to) {
            Some(index) => index,
            None => {
                let block = self.copy_shader(source, part)?;
                self.spares.add(source, &part.swap.to, block)
            }
        };
        Ok((base + index) as u16)
    }

    /// Новая геометрия из треугольников `triangles` исходной `geometry`; возвращает её блок.
    fn carve(&mut self, geometry: usize, triangles: &[u16]) -> Result<usize> {
        let plan = Carving::inspect(&self.graph, geometry, triangles)?;
        let streams: Vec<usize> = plan
            .streams
            .into_iter()
            .map(|(old, bytes)| self.spawn(old, bytes, Vec::new()))
            .collect();
        let stream_moves: Vec<(usize, usize)> = plan
            .lanes
            .iter()
            .map(|&(relative, place)| (relative, streams[place]))
            .collect();
        let vertex_copy = self.reborn(
            plan.vertices,
            &stream_moves,
            Some((at::VERTICES_COUNT, plan.kept)),
        );
        let data_copy = self.spawn(plan.data, plan.renumbered, Vec::new());
        let index_copy = self.reborn(
            plan.indices,
            &[(at::INDICES_DATA, data_copy)],
            Some((at::INDICES_COUNT, triangles.len() as u32)),
        );
        let mut moves = vec![
            (at::GEOMETRY_VERTICES, vertex_copy),
            (at::GEOMETRY_INDICES, index_copy),
        ];
        // данные вершин самой геометрии — копия основного потока, как у буфера вершин
        if let Some(&(_, stream)) = stream_moves
            .iter()
            .find(|(relative, _)| *relative == at::VERTICES_STREAMS[0])
        {
            moves.push((at::GEOMETRY_DATA, stream));
        }
        let fresh = self.reborn(geometry, &moves, None);
        // Счётчики блока геометрии (индексы `+0x58`, треугольники `+0x5c`, вершины `+0x60` по младшим 16 битам): игра рисует по ним,
        // а не по буферам. Копия оставляла числа исходной геометрии: новая рисовала столько индексов, сколько было у целой.
        let indices = triangles.len() as u32;
        let counters: [(usize, Vec<u8>); 3] = [
            (at::GEOMETRY_INDEX_COUNT, indices.to_le_bytes().to_vec()),
            (at::GEOMETRY_TRIANGLE_COUNT, (indices / 3).to_le_bytes().to_vec()),
            (at::GEOMETRY_VERTEX_COUNT, (plan.kept as u16).to_le_bytes().to_vec()),
        ];
        for (relative, bytes) in &counters {
            rgraph::write_at(&mut self.graph, fresh, *relative, bytes)?;
        }
        Ok(fresh)
    }

    /// Геометрия `geometry` (слот `slot` модели, шейдер `shader`), к которой отнесены `parts`.
    fn divide(
        &mut self,
        geometry: usize,
        slot: usize,
        shader: u16,
        parts: &[&Part],
    ) -> Result<Vec<Placed>> {
        Cell::at(&self.graph, geometry)
            .require(at::GEOMETRY_VERTICES, "геометрия без буфера вершин")?;
        let indices = read_indices(&self.graph, geometry)?;
        let owners = Owners::mark(indices.len() / 3, parts)?;
        let place = |block, shader| Placed {
            block,
            shader,
            origin: slot,
        };
        if owners.whole {
            let number = self.spare_for(usize::from(shader), parts[0])?;
            self.moved += indices.len() / 3;
            return Ok(vec![place(geometry, number)]);
        }

        let (shares, rest) = owners.deal(&indices, parts.len());
        let mut live: Vec<(Option<usize>, u16)> = Vec::new();
        for (number, part) in parts
            .iter()
            .enumerate()
            .filter(|(number, _)| !shares[*number].is_empty())
        {
            live.push((Some(number), self.spare_for(usize::from(shader), part)?));
            self.moved += shares[number].len() / 3;
        }
        let queue = lineup(live, rest.is_empty(), shader);
        self.created += queue.len() - 1;
        queue
            .into_iter()
            .map(|(number, shader)| {
                let share = number.map_or(rest.as_slice(), |number| shares[number].as_slice());
                self.carve(geometry, share)
                    .map(|block| place(block, shader))
            })
            .collect()
    }

    /// Выход одной модели: геометрии по порядку, с делением тех, к которым отнесены части.
    fn walk_model(
        &mut self,
        lanes: &Lanes<'_>,
        index: usize,
        block: usize,
        geometries: Vec<usize>,
    ) -> Result<Vec<Placed>> {
        let table = mapping_of(&self.graph, block)?;
        let mut placed = Vec::with_capacity(geometries.len());
        for (slot, geometry) in geometries.into_iter().enumerate() {
            let shader = match &table {
                Some(list) => *list.get(slot).ok_or(Fixed::ShaderOfGeometry)?,
                None => 0,
            };
            match lanes.at(index, slot) {
                Some(parts) => placed.extend(self.divide(geometry, slot, shader, parts)?),
                None => placed.push(Placed {
                    block: geometry,
                    shader,
                    origin: slot,
                }),
            }
        }
        Ok(placed)
    }

    /// Обход геометрий всех моделей: что стоит на выходе у каждой модели.
    fn walk(&mut self, lanes: &Lanes<'_>) -> Result<Vec<Vec<Placed>>> {
        let shape: Vec<(usize, Vec<usize>)> = self
            .models
            .iter()
            .map(|model| (model.block, model.geometries.clone()))
            .collect();
        shape
            .into_iter()
            .enumerate()
            .map(|(index, (block, geometries))| self.walk_model(lanes, index, block, geometries))
            .collect()
    }

    /// Номера шейдеров по выходным геометриям; если у модели нет таблицы - не пишутся.
    fn renew_table(&mut self, model: usize, placed: &[Placed]) -> Result<()> {
        if rgraph::pointer_from(&self.graph, model, at::MODEL_SHADERS).is_none() {
            return Ok(());
        }
        let numbers = placed
            .iter()
            .flat_map(|one| one.shader.to_le_bytes())
            .collect();
        let table = rgraph::append_block(&mut self.graph, Segment::System, numbers, Vec::new());
        self.reroute(model, at::MODEL_SHADERS, table)
    }

    /// Рамки: запись 0 и, если геометрий больше одной, запись «исходной» геометрии для каждой.
    fn renew_frames(&mut self, model: usize, placed: &[Placed]) -> Result<()> {
        let Some(old) = pointer_block(&self.graph, model, at::MODEL_FRAMES) else {
            return Ok(());
        };
        let frames = self.graph.content(old);
        let records = frames.len() / width::FRAME;
        let record = |number: usize| frames.get(number * width::FRAME..(number + 1) * width::FRAME);
        let mut bytes = record(0).ok_or(Fixed::FramesShort)?.to_vec();
        if placed.len() > 1 {
            // Модель с несколькими геометриями хранит запись 0 и по записи на каждую геометрию;
            // если блок короче, недостающие рамки были бы чужими данными или записью 0.
            let geometries = placed.iter().map(|one| one.origin + 1).max().unwrap_or(0);
            if geometries > 1 && records < geometries + 1 {
                return Err(Fixed::FramesList.into());
            }
            let numbers = placed.iter().map(|one| {
                Some(one.origin + 1)
                    .filter(|&number| number < records)
                    .unwrap_or(0)
            });
            for number in numbers {
                bytes.extend_from_slice(record(number).unwrap_or_default());
            }
        }
        let fresh = self.spawn(old, bytes, Vec::new());
        self.reroute(model, at::MODEL_FRAMES, fresh)
    }

    /// Новый список геометрий, номеров шейдеров, рамки и счётчики модели.
    fn rewrite(&mut self, model: usize, placed: &[Placed]) -> Result<()> {
        let blocks: Vec<usize> = placed.iter().map(|one| one.block).collect();
        self.relist(model, at::MODEL_GEOMETRIES, &blocks)?;
        self.renew_table(model, placed)?;
        self.renew_frames(model, placed)?;
        let total = (placed.len() as u16).to_le_bytes();
        at::MODEL_COUNTERS
            .iter()
            .try_for_each(|&relative| rgraph::write_at(&mut self.graph, model, relative, &total))?;
        Ok(())
    }

    /// Записывает все модели по их выходам (после обхода всех геометрий).
    fn rewrite_all(&mut self, layout: &[Vec<Placed>]) -> Result<()> {
        let blocks: Vec<usize> = self.models.iter().map(|model| model.block).collect();
        blocks
            .into_iter()
            .zip(layout)
            .try_for_each(|(model, placed)| self.rewrite(model, placed))
    }

    /// Новый список шейдеров группы: прежние и затем копии по порядку создания.
    fn extend_group_list(&mut self) -> Result<()> {
        if self.spares.made.is_empty() {
            return Ok(());
        }
        let all: Vec<usize> = self
            .shaders
            .iter()
            .copied()
            .chain(self.spares.blocks())
            .collect();
        self.relist(self.group, at::GROUP_SHADERS, &all)?;
        let count = (all.len() as u16).to_le_bytes();
        rgraph::write_at(&mut self.graph, self.group, at::GROUP_COUNT, &count)?;
        // ёмкость списка равна числу, как у игры и у хоста (прежняя ёмкость оставалась меньше числа)
        Ok(rgraph::write_at(
            &mut self.graph,
            self.group,
            at::GROUP_CAPACITY,
            &count,
        )?)
    }

    /// Файл модели: подграф от корня без мусора, блоки в прежнем порядке.
    fn export(&self) -> Result<Vec<u8>> {
        let root = Address {
            segment: Segment::System,
            offset: 0,
        };
        let kept = rgraph::subgraph(&self.graph, root)?;
        let order = |segment| rgraph::identity_order(&kept, segment);
        Ok(rgraph::rebuild_with(
            &kept,
            &order(Segment::System),
            &order(Segment::Graphics),
            &deflate_body,
        )?)
    }
}

// ---------------------------------------------------------------------------------------------
// Проверка результата, ответ, команда
// ---------------------------------------------------------------------------------------------

/// Проверка готового файла: число геометрий и привязка каждого листа к шейдеру.
fn audit(bytes: &[u8], sheets: &[String], wanted: usize) -> Result<()> {
    let resource = Resource::parse(bytes)?;
    let graph = rgraph::scan(&resource)?;
    let root = graph.root().ok_or(Fixed::NoRoot)?;
    let found = high_models(&graph, root)?
        .into_iter()
        .map(|model| geometry_blocks(&graph, model).map(|list| list.len()))
        .sum::<Result<usize>>()?;
    (found == wanted)
        .then_some(())
        .ok_or(Refusal::Recount { found, wanted })?;
    let (_, materials, embedded) = read_materials(&resource, 0)?;
    let bound: Vec<&str> = materials
        .iter()
        .flatten()
        .flat_map(|material| &material.samplers)
        .filter_map(|sampler| sampler.texture.as_deref())
        .collect();
    sheets.iter().try_for_each(|sheet| {
        let known = |name: &str| name.eq_ignore_ascii_case(sheet);
        embedded
            .iter()
            .any(|one| known(&one.name))
            .then_some(())
            .ok_or(Refusal::NotInDictionary(sheet))?;
        bound
            .iter()
            .any(|name| known(name))
            .then_some(())
            .ok_or(Refusal::Unbound(sheet))?;
        Ok(())
    })
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn answer(output: &Path, sheets: Vec<String>, counts: [usize; 3], written: usize) -> Value {
    let [geometries, created, moved] = counts;
    object([
        ("status", "ready".into()),
        ("mode", "split-sheet-surfaces".into()),
        ("output", output.display().to_string().into()),
        ("geometries", geometries.into()),
        ("created", created.into()),
        ("moved", moved.into()),
        ("textures", sheets.into()),
        ("outputBytes", written.into()),
    ])
}

fn run_split(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = Job::resolve(options)?;
    let mut bench = Bench::open(&job.target)?;
    let lanes = Lanes::sort(&job.parts, bench.models.len())?;
    let sheets = bench.embed_sheets(&job.parts)?;
    bench.read_group()?;
    let layout = bench.walk(&lanes)?;
    bench.rewrite_all(&layout)?;
    bench.extend_group_list()?;
    let bytes = bench.export()?;
    let geometries = bench.geometries_before() + bench.created;
    audit(&bytes, &sheets, geometries)?;
    write_atomic(&job.output, &bytes)?;
    Ok(answer(
        &job.output,
        sheets,
        [geometries, bench.created, bench.moved],
        bytes.len(),
    ))
}

const SPLIT_SHEET_SURFACES: Command = Command::new("split-sheet-surfaces", run_split);

pub const COMMANDS: &[Command] = &[SPLIT_SHEET_SURFACES];

#[cfg(test)]
mod tests;
