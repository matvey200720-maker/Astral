//! Писатель моделей Legacy (`.ydr`, `.ydd`) поверх графа блоков ресурса: чтение словаря рисовалок,
//! дописывание и замена модели, сборка файла, каноническая запись и осмотр плитки радара.

use std::{
    cmp::Reverse,
    collections::{BTreeMap, HashMap, HashSet},
    ops::{ControlFlow, Range},
};

use serde_json::{Map, Number, Value};

use crate::{
    error::{Error, Result},
    hash::joaat,
    meta_graph::deflate_body,
    resource::{deflate_zlib9, Resource},
    resource_graph::{self, append_block, Address, Graph, Segment, Slot},
    vertex::{self, Element, Layout, COLOUR, COLOUR0, FLOAT3, POSITION},
};

// ---------- поля объектов ----------

/// Смещение внутри блока: число или именованное поле одной из структур ниже.
trait Spot: Copy {
    fn spot(self) -> usize;
}

impl Spot for usize {
    fn spot(self) -> usize {
        self
    }
}

/// Объявляет перечисление полей структуры: имя поля → смещение в блоке.
macro_rules! fields {
    ($kind:ident { $($name:ident = $at:literal),+ $(,)? }) => {
        #[derive(Clone, Copy)]
        #[repr(usize)]
        enum $kind {
            $($name = $at),+
        }

        impl Spot for $kind {
            fn spot(self) -> usize {
                self as usize
            }
        }
    };
}

fields!(Dict { Hashes = 0x20, HashCount = 0x28, Drawables = 0x30, DrawableCount = 0x38 });
fields!(Draw {
    Group = 0x10,
    Skeleton = 0x18,
    Sphere = 0x20,
    Radius = 0x2c,
    Min = 0x30,
    Max = 0x40,
    High = 0x50,
    Medium = 0x58,
    Low = 0x60,
    VeryLow = 0x68,
    Lod = 0x70,
    Flags = 0x80,
    Word = 0x9a,
    HighAlias = 0xa0,
    Name = 0xa8,
});
fields!(List { Entries = 0x00, Count = 0x08, Capacity = 0x0a });
fields!(Model {
    Geometries = 0x08,
    Count = 0x10,
    CountB = 0x12,
    Bounds = 0x18,
    Shaders = 0x20,
    Skin = 0x28,
    Render = 0x2c,
    CountC = 0x2e,
});
fields!(Geo {
    VertexBuffer = 0x18,
    IndexBuffer = 0x38,
    IndexCount = 0x58,
    Triangles = 0x5c,
    VertexCount = 0x60,
    Data = 0x78,
});
fields!(Vb { Stride = 0x08, Flags = 0x0a, Stream = 0x10, Count = 0x18, StreamB = 0x20, Declaration = 0x30 });
fields!(Ib { Count = 0x08, Data = 0x10 });
fields!(Group { List = 0x10, Count = 0x18 });
fields!(Shader { Name = 0x08, Bucket = 0x11, File = 0x18, Mask = 0x20 });

/// Уровни детализации по порядку: поле списка и имя в осмотре.
const LEVELS: [(Draw, &str); 4] = [(Draw::High, "high"), (Draw::Medium, "med"), (Draw::Low, "low"), (Draw::VeryLow, "vlow")];
/// Запись рамок модели: минимум и максимум по четыре f32.
const BOX_LEN: usize = 32;
/// Больше моделей High в рисовалке старший полубайт слова `+0x9a` не вмещает.
const HIGH_CAP: usize = 15;

/// VFT, которые пишет путь XML хоста.
struct Vft {
    drawable: u32,
    model: u32,
    geometry: u32,
    vertex_buffer: u32,
    index_buffer: u32,
}

const XML: Vft = Vft { drawable: 0x4057_3178, model: 0x4061_0a98, geometry: 0x4061_8798, vertex_buffer: 0x4061_d3f8, index_buffer: 0x4061_d158 };

// ---------- курсор чтения ----------

const PAST_BLOCK: &str = "писатель: чтение за блоком";

/// Место в графе: блок, от которого идут чтения. Указатель берётся из списка указателей блока,
/// число — из содержимого блока.
#[derive(Clone, Copy)]
struct Cursor<'g> {
    graph: &'g Graph,
    block: usize,
}

impl<'g> Cursor<'g> {
    fn on(graph: &'g Graph, block: usize) -> Self {
        Cursor { graph, block }
    }

    fn bytes(&self) -> &'g [u8] {
        self.graph.content(self.block)
    }

    /// Блок, на который указывает поле; цель вне блоков — как будто указателя нет.
    fn follow(&self, field: impl Spot) -> Option<Cursor<'g>> {
        let at = field.spot();
        let slot = self.graph.blocks[self.block].slots.iter().find(|slot| slot.relative == at)?;
        self.graph.block_at(slot.target).map(|block| Cursor::on(self.graph, block))
    }

    fn require(&self, field: impl Spot, message: &str) -> Result<Cursor<'g>> {
        self.follow(field).ok_or_else(|| Error::broken(message))
    }

    fn raw<const N: usize>(&self, at: impl Spot) -> Result<[u8; N]> {
        let at = at.spot();
        at.checked_add(N).and_then(|end| self.bytes().get(at..end)).and_then(|part| part.try_into().ok()).ok_or_else(|| Error::broken(PAST_BLOCK))
    }

    fn byte(&self, at: impl Spot) -> Result<u8> {
        self.raw::<1>(at).map(|[value]| value)
    }

    fn half(&self, at: impl Spot) -> Result<u16> {
        self.raw(at).map(u16::from_le_bytes)
    }

    fn word(&self, at: impl Spot) -> Result<u32> {
        self.raw(at).map(u32::from_le_bytes)
    }

    fn real(&self, at: impl Spot) -> Result<f32> {
        self.raw(at).map(f32::from_le_bytes)
    }

    /// Число u16 как `usize`: счётчики и шаги.
    fn count(&self, at: impl Spot) -> Result<usize> {
        self.half(at).map(usize::from)
    }

    fn reals<const N: usize>(&self, at: impl Spot) -> Result<[f32; N]> {
        let start = at.spot();
        let mut out = [0.0; N];
        for (i, slot) in out.iter_mut().enumerate() {
            *slot = self.real(start + 4 * i)?;
        }
        Ok(out)
    }

    /// Поток вершин буфера: первый, а если его нет — второй.
    fn stream(&self) -> Option<Cursor<'g>> {
        self.follow(Vb::Stream).or_else(|| self.follow(Vb::StreamB))
    }
}

/// Декларация вершин: флаги, типы по семантикам и шаг из заголовка.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Declaration {
    pub flags: u32,
    pub types: u64,
    pub stride: usize,
}

impl<'g> Cursor<'g> {
    /// Для буфера вершин: блок декларации (не короче 16 байт) и её поля.
    fn declared(&self) -> Option<(Cursor<'g>, Declaration)> {
        let block = self.follow(Vb::Declaration).filter(|d| d.bytes().len() >= 16)?;
        let declaration = Declaration { flags: block.word(0usize).ok()?, stride: block.count(4usize).ok()?, types: u64::from_le_bytes(block.raw::<8>(8usize).ok()?) };
        Some((block, declaration))
    }
}

// ---------- списки моделей и обход геометрий ----------

/// Тексты отказов разбора списка моделей: чтения и пути записи называют его по-разному.
struct Wording {
    no_entries: &'static str,
    empty_model: &'static str,
}

const READ_WORDS: Wording =
    Wording { no_entries: "писатель: список моделей без записей", empty_model: "писатель: пустая модель в списке" };
const WRITE_WORDS: Wording =
    Wording { no_entries: "писатель: список High без записей", empty_model: "писатель: пустая модель в списке High" };

/// Список моделей уровня: блоки головы, массива записей и моделей.
struct ModelList {
    head: usize,
    entries: usize,
    models: Vec<usize>,
}

/// Модель в списке уровня: номер уровня, место в списке, курсор модели.
#[derive(Clone, Copy)]
struct Stop<'g> {
    level: usize,
    at: usize,
    model: Cursor<'g>,
}

/// Геометрия вместе с моделью, в которой она лежит, и своим местом в ней.
struct Part<'g> {
    model: Cursor<'g>,
    index: usize,
    geometry: Cursor<'g>,
}

impl<'g> Cursor<'g> {
    /// Рисовалка: список моделей уровня; `None`, если на уровень нет указателя.
    fn model_list(&self, level: Draw, words: &Wording) -> Result<Option<ModelList>> {
        let Some(head) = self.follow(level) else {
            return Ok(None);
        };
        let total = head.count(List::Count)?;
        let entries = head.require(List::Entries, words.no_entries)?;
        let models = (0..total).map(|i| entries.require(i * 8, words.empty_model).map(|model| model.block)).collect::<Result<Vec<_>>>()?;
        Ok(Some(ModelList { head: head.block, entries: entries.block, models }))
    }

    /// Рисовалка: модели одного уровня.
    fn level_stops(&self, level: usize) -> Result<Vec<Stop<'g>>> {
        let models = self.model_list(LEVELS[level].0, &READ_WORDS)?.map(|list| list.models).unwrap_or_default();
        Ok(models.into_iter().enumerate().map(|(at, block)| Stop { level, at, model: Cursor::on(self.graph, block) }).collect())
    }

    /// Рисовалка: модели нескольких уровней подряд.
    fn stops(&self, levels: Range<usize>) -> Result<Vec<Stop<'g>>> {
        let mut all = Vec::new();
        for level in levels {
            all.extend(self.level_stops(level)?);
        }
        Ok(all)
    }

    /// Модель: геометрии по порядку.
    fn geometries(&self) -> Result<Vec<Cursor<'g>>> {
        let total = self.count(Model::Count)?;
        if total == 0 {
            return Ok(Vec::new());
        }
        let list = self.require(Model::Geometries, "писатель: модель без списка геометрий")?;
        (0..total).map(|i| list.require(i * 8, "писатель: пустая геометрия в модели")).collect()
    }

    /// Модель: рамки геометрий; у единственной геометрии — одна запись, иначе после сводной идут по записи на геометрию.
    fn boxes(&self) -> Result<Vec<([f32; 3], [f32; 3])>> {
        let total = self.count(Model::Count)?;
        if total == 0 {
            return Ok(Vec::new());
        }
        let bounds = self.require(Model::Bounds, "писатель: модель без рамок")?;
        let skip = usize::from(total > 1);
        (0..total)
            .map(|j| {
                let at = (skip + j) * BOX_LEN;
                Ok((bounds.reals::<3>(at)?, bounds.reals::<3>(at + 16)?))
            })
            .collect()
    }

    /// Модель: номер шейдера геометрии; без списка номеров — 0.
    fn shader_number(&self, index: usize) -> Result<u16> {
        self.follow(Model::Shaders).map_or(Ok(0), |numbers| numbers.half(index * 2))
    }
}

impl<'g> Cursor<'g> {
    /// Модель: геометрии вместе с местом в модели.
    fn parts(&self) -> Result<Vec<Part<'g>>> {
        let model = *self;
        Ok(self.geometries()?.into_iter().enumerate().map(|(index, geometry)| Part { model, index, geometry }).collect())
    }

    /// Рисовалка: геометрии на указанных уровнях, модель за моделью. Ошибка разбора модели приходит в тот
    /// момент, когда обход до неё дошёл.
    fn walk(&self, levels: Range<usize>) -> Result<impl Iterator<Item = Result<Part<'g>>>> {
        Ok(self.stops(levels)?.into_iter().flat_map(|stop| match stop.model.parts() {
            Ok(parts) => parts.into_iter().map(Ok).collect::<Vec<_>>(),
            Err(failure) => vec![Err(failure)],
        }))
    }

    /// Подряд `total` слов u32 от смещения `at`.
    fn words(&self, at: usize, total: usize) -> impl Iterator<Item = Result<u32>> + 'g {
        let cursor = *self;
        (0..total).map(move |i| cursor.word(at + 4 * i))
    }
}

fn dictionary_root(graph: &Graph) -> Option<Cursor<'_>> {
    graph.root().map(|block| Cursor::on(graph, block))
}

/// Рисовалки словаря по порядку; без корня или без массива рисовалок — пусто.
fn dictionary_drawables(graph: &Graph) -> Result<Vec<Cursor<'_>>> {
    let Some(root) = dictionary_root(graph) else {
        return Ok(Vec::new());
    };
    let Some(array) = root.follow(Dict::Drawables) else {
        return Ok(Vec::new());
    };
    (0..root.count(Dict::DrawableCount)?).map(|i| array.require(i * 8, "писатель: пустая рисовалка в словаре")).collect()
}

// ---------- поток вершин ----------

/// Поток вершин геометрии, у которой в декларации позиция `FLOAT3`.
struct VertexRun<'g> {
    data: &'g [u8],
    stride: usize,
    count: usize,
    layout: Layout,
    position: Element,
}

impl<'g> VertexRun<'g> {
    /// `None`, если чего-то из нужного нет: буфера, декларации, потока, позиции `FLOAT3` или шага.
    fn open(geometry: Cursor<'g>) -> Result<Option<Self>> {
        let Some(buffer) = geometry.follow(Geo::VertexBuffer) else {
            return Ok(None);
        };
        let Some((_, declaration)) = buffer.declared() else {
            return Ok(None);
        };
        let Some(stream) = buffer.stream() else {
            return Ok(None);
        };
        let layout = vertex::layout(declaration.flags, declaration.types)?;
        let Some(position) = layout.get(POSITION).filter(|element| element.type_code == FLOAT3) else {
            return Ok(None);
        };
        let stride = buffer.count(Vb::Stride)?;
        if stride == 0 {
            return Ok(None);
        }
        let count = buffer.word(Vb::Count)? as usize;
        Ok(Some(VertexRun { data: stream.bytes(), stride, count, layout, position }))
    }

    /// Смещения вершин: пока вершина целиком лежит в блоке потока и не дальше заявленного числа.
    fn rows(&self) -> impl Iterator<Item = usize> {
        let stride = self.stride;
        (0..self.count.min(self.data.len() / stride)).map(move |i| i * stride)
    }

    fn peek(&self, at: usize) -> Option<f32> {
        self.data.get(at..at.checked_add(4)?)?.try_into().ok().map(f32::from_le_bytes)
    }

    /// Точки (x, y) всех вершин потока; точки с бесконечностью или `NaN` отбрасываются.
    fn plane_points(&self) -> impl Iterator<Item = (f32, f32)> + '_ {
        let at = self.position.offset;
        self.rows().filter_map(move |base| Some((self.peek(base + at)?, self.peek(base + at + 4)?))).filter(|(x, y)| x.is_finite() && y.is_finite())
    }

    /// Есть ли вершина «воды»: ниже -1 по z или с заметным разбросом каналов цвета.
    fn shows_water(&self) -> bool {
        let colour = self.layout.get(COLOUR0);
        self.rows().any(|base| {
            // При шаге меньше раскладки то, что уходит за блок потока, не читается и воду не показывает.
            let below = self.peek(base + self.position.offset + 8).is_some_and(|z| z < -1.0);
            let tinted = colour.is_some_and(|colour| {
                let at = base + colour.offset;
                self.data.get(at..at + 3).is_some_and(|rgb| rgb.iter().max().unwrap_or(&0) - rgb.iter().min().unwrap_or(&0) > 4)
            });
            below || tinted
        })
    }
}

/// Годится ли декларация образцом слоёв: позиция `FLOAT3` в начале, цвет `COLOUR` не раньше 12 и в пределах шага.
/// Возвращает смещение цвета.
fn layer_colour(declaration: &Declaration) -> Option<usize> {
    let layout = vertex::layout(declaration.flags, declaration.types).ok()?;
    layout.get(POSITION).filter(|p| p.type_code == FLOAT3 && p.offset == 0)?;
    layout.get(COLOUR0).filter(|c| c.type_code == COLOUR && c.offset >= 12 && c.offset + 4 <= declaration.stride).map(|c| c.offset)
}

// ---------- чтения словаря ----------

pub fn graph_of(bytes: &[u8]) -> Result<Graph> {
    Resource::parse(bytes).and_then(|resource| resource_graph::scan(&resource))
}

pub fn dictionary_index_of_hash(graph: &Graph, hash: u32) -> Result<Option<usize>> {
    let Some((root, hashes)) = dictionary_root(graph).and_then(|root| Some((root, root.follow(Dict::Hashes)?))) else {
        return Ok(None);
    };
    let total = root.count(Dict::HashCount)?;
    let verdict = hashes.words(0, total).enumerate().try_for_each(|(index, word)| match word {
        Ok(found) if found == hash => ControlFlow::Break(Ok(index)),
        Ok(_) => ControlFlow::Continue(()),
        Err(failure) => ControlFlow::Break(Err(failure)),
    });
    match verdict {
        ControlFlow::Break(outcome) => outcome.map(Some),
        ControlFlow::Continue(()) => Ok(None),
    }
}

pub fn drawable_at(graph: &Graph, index: usize) -> Result<usize> {
    let no_such = "писатель: нет рисовалки с таким номером";
    let root = dictionary_root(graph).ok_or_else(|| Error::broken("писатель: словарь без корня"))?;
    let array = root.require(Dict::Drawables, "писатель: словарь без списка рисовалок")?;
    let offset = index.checked_mul(8).ok_or_else(|| Error::broken(no_such))?;
    Ok(array.require(offset, no_such)?.block)
}

/// Рисовалка словаря с номером `index` заменяется целиком рисовалкой из графа `fresh` (корень `fresh` — рисовалка).
/// Хеши словаря и прочие рисовалки не трогаются; прежняя рисовалка со всем, на что она одна ссылалась, уйдёт при сборке файла.
/// Возвращает номер блока новой рисовалки. Отказ оставляет граф таким, каким он был.
pub fn swap_dictionary_drawable(graph: &mut Graph, index: usize, fresh: &Graph) -> Result<usize> {
    all_or_nothing(graph, |graph| {
        let no_such = "писатель: нет рисовалки с таким номером";
        let root = dictionary_root(graph).ok_or_else(|| Error::broken("писатель: словарь без корня"))?;
        let array = root.require(Dict::Drawables, "писатель: словарь без списка рисовалок")?.block;
        let offset = index.checked_mul(8).ok_or_else(|| Error::broken(no_such))?;
        let (merged, placed) = resource_graph::graft(graph, fresh)?;
        *graph = merged;
        resource_graph::retarget(graph, array, offset, placed)?;
        graph.block_at(placed).ok_or_else(|| Error::broken("писатель: новая рисовалка вне блоков"))
    })
}

/// Число в заголовке буфера геометрии; нет буфера — 0.
fn buffer_total(geometry: Cursor, buffer: Geo, field: impl Spot) -> Result<u64> {
    geometry.follow(buffer).map_or(Ok(0), |b| b.word(field).map(u64::from))
}

pub fn shape(graph: &Graph) -> Result<Shape> {
    let drawables = dictionary_drawables(graph)?;
    let empty = Shape { drawables: drawables.len(), models: 0, geometries: 0, vertices: 0, indices: 0 };
    drawables.iter().try_fold(empty, |sum, drawable| {
        drawable.stops(0..LEVELS.len())?.iter().try_fold(sum, |sum, stop| {
            let geometries = stop.model.geometries()?;
            geometries.into_iter().try_fold(Shape { models: sum.models + 1, ..sum }, |sum, geometry| {
                Ok(Shape {
                    geometries: sum.geometries + 1,
                    vertices: sum.vertices + buffer_total(geometry, Geo::VertexBuffer, Vb::Count)?,
                    indices: sum.indices + buffer_total(geometry, Geo::IndexBuffer, Ib::Count)?,
                    ..sum
                })
            })
        })
    })
}

/// Счётчики по всему словарю.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    pub drawables: usize,
    pub models: usize,
    pub geometries: usize,
    pub vertices: u64,
    pub indices: u64,
}

pub fn lod_mismatch(graph: &Graph) -> Result<Option<String>> {
    let first_odd = dictionary_drawables(graph)?.into_iter().enumerate().find_map(|(index, drawable)| {
        let verdict = drawable.level_stops(0).map(|stops| {
            let flag = drawable.bytes().get(Draw::Flags.spot()).copied().unwrap_or(0);
            (usize::from(flag) != stops.len()).then(|| format!("рисовалка {index}, уровень high: флаг {flag}, моделей {}", stops.len()))
        });
        verdict.transpose()
    });
    first_odd.transpose()
}

/// Прямоугольник по x и y, в который входят все учтённые вершины; пока вершин не было — пуст.
#[derive(Default)]
struct Extent {
    corners: Option<([f32; 2], [f32; 2])>,
}

impl Extent {
    fn take_in(&mut self, x: f32, y: f32) {
        let (lo, hi) = self.corners.get_or_insert(([x, y], [x, y]));
        *lo = [lo[0].min(x), lo[1].min(y)];
        *hi = [hi[0].max(x), hi[1].max(y)];
    }

    fn flat(&self) -> Option<[f32; 4]> {
        self.corners.map(|(lo, hi)| [lo[0], lo[1], hi[0], hi[1]])
    }
}

pub fn tile_bounds(graph: &Graph) -> Result<Option<[f32; 4]>> {
    let mut extent = Extent::default();
    dictionary_drawables(graph)?.into_iter().try_for_each(|drawable| -> Result<()> {
        for part in drawable.walk(0..LEVELS.len())? {
            if let Some(run) = VertexRun::open(part?.geometry)? {
                run.plane_points().for_each(|(x, y)| extent.take_in(x, y));
            }
        }
        Ok(())
    })?;
    Ok(extent.flat())
}

pub fn drawable_has_water(graph: &Graph, drawable: usize) -> Result<bool> {
    let mut parts = Cursor::on(graph, drawable).walk(0..1)?;
    let hit = parts.find_map(|part| match part.and_then(|part| VertexRun::open(part.geometry)) {
        Ok(Some(run)) => run.shows_water().then_some(Ok(())),
        Ok(None) => None,
        Err(failure) => Some(Err(failure)),
    });
    hit.transpose().map(|found| found.is_some())
}

/// Годится ли рисовалка под слои: у образца геометрии шаг сходится с декларацией, есть цвет и нет воды.
fn lands_layers(graph: &Graph, drawable: Cursor) -> Result<bool> {
    // Модель, у которой список геометрий не читается, считается пустой.
    let listed = drawable.level_stops(0)?.into_iter().find_map(|stop| stop.model.geometries().ok().filter(|list| !list.is_empty()));
    let sample = listed.and_then(|geometries| {
        geometries.iter().find_map(|geometry| {
            let buffer = geometry.follow(Geo::VertexBuffer)?;
            Some((buffer, buffer.declared()?.1))
        })
    });
    let Some((buffer, declaration)) = sample else {
        return Ok(false);
    };
    let stride = buffer.count(Vb::Stride)?;
    Ok(stride == declaration.stride && stride > 0 && layer_colour(&declaration).is_some() && !drawable_has_water(graph, drawable.block)?)
}

pub fn land_drawable(graph: &Graph) -> Result<Option<usize>> {
    let drawables = dictionary_drawables(graph)?;
    let hit = drawables.iter().enumerate().rev().find_map(|(index, &drawable)| lands_layers(graph, drawable).map(|fits| fits.then_some(index)).transpose());
    hit.transpose()
}

// ---------- чтения рисовалки ----------

pub fn template_layout_of(graph: &Graph, drawable: usize) -> Result<Option<(usize, usize)>> {
    match Cursor::on(graph, drawable).walk(0..1)?.next() {
        None => Ok(None),
        Some(part) => {
            let declared = part?.geometry.follow(Geo::VertexBuffer).and_then(|buffer| buffer.declared());
            Ok(declared.and_then(|(_, declaration)| Some((declaration.stride, layer_colour(&declaration)?))))
        }
    }
}

pub fn template_shader(graph: &Graph, drawable: usize) -> Result<u16> {
    match Cursor::on(graph, drawable).level_stops(0)?.first() {
        Some(stop) => stop.model.shader_number(0),
        None => Ok(0),
    }
}

pub fn shader_count(graph: &Graph, drawable: usize) -> Result<usize> {
    match Cursor::on(graph, drawable).follow(Draw::Group) {
        Some(group) => group.count(Group::Count),
        None => Ok(0),
    }
}

pub fn shader_buckets(graph: &Graph, drawable: usize) -> Result<Option<Vec<u8>>> {
    let Some(group) = Cursor::on(graph, drawable).follow(Draw::Group) else {
        return Ok(None);
    };
    let total = group.count(Group::Count)?;
    let list = group.require(Group::List, "писатель: группа шейдеров без списка")?;
    let buckets = (0..total).try_fold(Vec::with_capacity(total), |mut buckets, i| {
        buckets.push(list.require(i * 8, "писатель: пустой шейдер в группе")?.byte(Shader::Bucket)?);
        Ok(buckets)
    });
    buckets.map(Some)
}

pub fn has_skeleton(graph: &Graph, drawable: usize) -> bool {
    Cursor::on(graph, drawable).follow(Draw::Skeleton).is_some()
}

pub fn has_lower_levels(graph: &Graph, drawable: usize) -> Result<bool> {
    let drawable = Cursor::on(graph, drawable);
    let hit = (1..LEVELS.len()).find_map(|level| drawable.level_stops(level).map(|stops| (!stops.is_empty()).then_some(())).transpose());
    hit.transpose().map(|found| found.is_some())
}

pub fn high_geometry_templates(graph: &Graph, drawable: usize) -> Result<HashMap<u16, usize>> {
    let mut found = HashMap::new();
    for part in Cursor::on(graph, drawable).walk(0..1)? {
        let Part { model, index, geometry } = part?;
        found.entry(model.shader_number(index)?).or_insert(geometry.block);
    }
    Ok(found)
}

pub fn geometry_layout(graph: &Graph, geometry: usize) -> Option<(usize, Layout)> {
    let (_, declaration) = Cursor::on(graph, geometry).follow(Geo::VertexBuffer)?.declared()?;
    Some((declaration.stride, vertex::layout(declaration.flags, declaration.types).ok()?))
}

fn geometry_data(part: Part) -> Result<GeometryData> {
    let Part { model, index, geometry } = part;
    let buffer = geometry.require(Geo::VertexBuffer, "писатель: геометрия без буфера вершин")?;
    let index_buffer = geometry.require(Geo::IndexBuffer, "писатель: геометрия без буфера индексов")?;
    let stride = buffer.count(Vb::Stride)?;
    let stream = buffer.stream().ok_or_else(|| Error::broken("писатель: буфер вершин без потока"))?;
    let vertex_total = buffer.word(Vb::Count)? as usize;
    let vertices = stream.bytes().get(..vertex_total * stride).ok_or_else(|| Error::broken("писатель: вершины короче буфера"))?.to_vec();
    let index_total = index_buffer.word(Ib::Count)? as usize;
    let data = index_buffer.require(Ib::Data, "писатель: буфер индексов без данных")?;
    let raw = data.bytes().get(..index_total * 2).ok_or_else(|| Error::broken("писатель: индексы короче буфера"))?;
    let indices = raw.chunks_exact(2).map(|pair| u16::from_le_bytes(pair.try_into().expect("пара байт"))).collect();
    Ok(GeometryData { vertices, indices, shader: model.shader_number(index)? })
}

pub fn last_high_geometries(graph: &Graph, drawable: usize) -> Result<Vec<GeometryData>> {
    let mut stops = Cursor::on(graph, drawable).level_stops(0)?;
    match stops.pop() {
        Some(stop) => stop.model.parts()?.into_iter().map(geometry_data).collect(),
        None => Ok(Vec::new()),
    }
}

/// Сфера и рамка самой рисовалки: центр, радиус, минимум и максимум.
pub fn root_bounds(graph: &Graph, drawable: usize) -> Result<([f32; 3], f32, [f32; 3], [f32; 3])> {
    let root = Cursor::on(graph, drawable);
    Ok((root.reals::<3>(Draw::Sphere)?, root.real(Draw::Radius)?, root.reals::<3>(Draw::Min)?, root.reals::<3>(Draw::Max)?))
}

/// Рамки геометрий последней модели High с четвёртым числом: у каждой минимум и максимум по четыре числа (x, y, z, w).
/// У модели с несколькими геометриями сводная запись идёт первой и в список не входит.
pub fn last_high_boxes(graph: &Graph, drawable: usize) -> Result<Vec<([f32; 4], [f32; 4])>> {
    let mut stops = Cursor::on(graph, drawable).level_stops(0)?;
    let Some(stop) = stops.pop() else { return Ok(Vec::new()) };
    let model = stop.model;
    let total = model.count(Model::Count)?;
    if total == 0 {
        return Ok(Vec::new());
    }
    let bounds = model.require(Model::Bounds, "писатель: модель без рамок")?;
    let skip = usize::from(total > 1);
    (0..total).map(|j| Ok((bounds.reals::<4>((skip + j) * BOX_LEN)?, bounds.reals::<4>((skip + j) * BOX_LEN + 16)?))).collect()
}

/// Вершины, индексы и номер шейдера одной геометрии.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeometryData {
    pub vertices: Vec<u8>,
    pub indices: Vec<u16>,
    pub shader: u16,
}

/// Слово `+0x9a` корня модели надписи по числу геометрий.
pub fn sign_render_word(geometries: usize) -> u16 {
    // Девять восьмых на геометрию плюс поправка по остатку от деления на восемь.
    const PAD: [usize; 8] = [0, 11, 6, 9, 4, 7, 2, 5];
    match geometries {
        0 | 1 => 18,
        n => {
            let scaled = n.saturating_mul(101).saturating_add(56 + PAD[n & 7]);
            u16::try_from(scaled >> 3).unwrap_or(u16::MAX)
        }
    }
}

// ---------- запись: черновики блоков ----------

/// Новый блок до дописывания в граф: байты и указатели, которые можно править.
struct Draft {
    segment: Segment,
    bytes: Vec<u8>,
    slots: Vec<Slot>,
}

/// Дописанный блок: номер и адрес начала.
#[derive(Clone, Copy)]
struct Placed {
    block: usize,
    at: Address,
}

impl Draft {
    fn bare(segment: Segment, bytes: Vec<u8>) -> Self {
        Draft { segment, bytes, slots: Vec::new() }
    }

    /// Копия блока: тот же сегмент, байты и указатели.
    fn copy_of(graph: &Graph, block: usize) -> Self {
        let source = &graph.blocks[block];
        Draft { segment: source.segment, bytes: graph.content(block).to_vec(), slots: source.slots.clone() }
    }

    /// Записывает байты по смещению; у слишком короткой копии это паника.
    fn put(&mut self, at: impl Spot, data: &[u8]) {
        let at = at.spot();
        self.bytes[at..at + data.len()].copy_from_slice(data);
    }

    fn put_u32(&mut self, at: impl Spot, value: u32) {
        self.put(at, &value.to_le_bytes());
    }

    fn put_u16(&mut self, at: impl Spot, value: u16) {
        self.put(at, &value.to_le_bytes());
    }

    /// Первое слово блока — его VFT; пишется, только если путь записи его задаёт.
    fn put_vft(&mut self, vft: Option<u32>) {
        if let Some(value) = vft {
            self.put_u32(0usize, value);
        }
    }

    /// Переводит существующий указатель на `to`; сообщает, был ли он.
    fn aim(&mut self, at: impl Spot, to: Address) -> bool {
        let at = at.spot();
        self.slots.iter_mut().find(|slot| slot.relative == at).map(|slot| slot.target = to).is_some()
    }

    /// Как `aim`, но недостающий указатель дописывается в конец списка.
    fn aim_or_add(&mut self, at: impl Spot, to: Address) {
        let relative = at.spot();
        if !self.aim(relative, to) {
            self.slots.push(Slot { relative, target: to });
        }
    }

    fn commit(self, graph: &mut Graph) -> Placed {
        let segment = self.segment;
        let block = append_block(graph, segment, self.bytes, self.slots);
        Placed { block, at: Address { segment, offset: graph.blocks[block].start } }
    }
}

/// Редактор графа: все дописывания, перевод указателей и обнуления блоков идут через него.
struct Editor<'g> {
    graph: &'g mut Graph,
}

impl Editor<'_> {
    /// Дописывает блок из одних байт, без указателей.
    fn append_bare(&mut self, segment: Segment, bytes: Vec<u8>) -> Placed {
        Draft::bare(segment, bytes).commit(self.graph)
    }

    /// Копия блока `from` с правкой, дописанная в граф.
    fn derive(&mut self, from: usize, edit: impl FnOnce(&mut Draft)) -> Placed {
        let mut draft = Draft::copy_of(self.graph, from);
        edit(&mut draft);
        draft.commit(self.graph)
    }

    fn address_of(&self, block: usize) -> Address {
        let found = &self.graph.blocks[block];
        Address { segment: found.segment, offset: found.start }
    }

    /// Дописывает блоки одной новой геометрии по образцу `sample` и возвращает блок геометрии.
    fn grow_geometry(&mut self, sample: usize, new: &NewGeometry, vft: Option<&Vft>) -> Result<usize> {
        let from = Sample::of(self.graph, sample)?;
        let vertex_total = new.vertex_total(from.stride)?;
        let index_total = new.indices.len();

        let (stream_in, data_in) = (self.graph.blocks[from.stream].segment, self.graph.blocks[from.data].segment);
        let stream = self.append_bare(stream_in, new.vertices.clone());
        let data = self.append_bare(data_in, new.indices.iter().flat_map(|index| index.to_le_bytes()).collect());

        let index_buffer = self.derive(from.index_buffer, |draft| {
            draft.put_u32(Ib::Count, index_total as u32);
            draft.aim(Ib::Data, data.at);
            draft.put_vft(vft.map(|tags| tags.index_buffer));
        });
        let declaration = from.declaration.map(|block| self.derive(block, |_| {}));
        let buffer = self.derive(from.buffer, |draft| {
            draft.put_u32(Vb::Count, vertex_total as u32);
            draft.aim(Vb::Stream, stream.at);
            draft.aim(Vb::StreamB, stream.at);
            if let Some(declaration) = declaration {
                draft.aim(Vb::Declaration, declaration.at);
            }
            draft.put_vft(vft.map(|tags| tags.vertex_buffer));
        });
        let geometry = self.derive(sample, |draft| {
            draft.put_u32(Geo::IndexCount, index_total as u32);
            draft.put_u32(Geo::Triangles, (index_total / 3) as u32);
            draft.put_u16(Geo::VertexCount, vertex_total as u16);
            draft.aim(Geo::VertexBuffer, buffer.at);
            draft.aim(Geo::IndexBuffer, index_buffer.at);
            draft.aim(Geo::Data, stream.at);
            draft.put_vft(vft.map(|tags| tags.geometry));
        });
        Ok(geometry.block)
    }

    /// Дописывает список геометрий, рамки, номера шейдеров и сам блок модели (копию образца).
    /// `replace` включает правила пути замены: VFT, флаги и добавление недостающих указателей.
    fn assemble_model(&mut self, sample: usize, built: &[usize], new: &[NewGeometry], w: BoxW, replace: bool) -> Placed {
        let segment = self.graph.blocks[sample].segment;
        let total = new.len();

        let mut pointers = Draft::bare(segment, vec![0; 8 * total]);
        pointers.slots = built.iter().enumerate().map(|(i, &geometry)| Slot { relative: 8 * i, target: self.address_of(geometry) }).collect();
        let list = pointers.commit(self.graph);
        let bounds = self.append_bare(segment, bounds_bytes(new, w));
        let numbers = self.append_bare(segment, new.iter().flat_map(|g| g.shader.to_le_bytes()).collect());

        self.derive(sample, |model| {
            let total = (total as u16).to_le_bytes();
            for at in [Model::Count, Model::CountB, Model::CountC] {
                model.put(at, &total);
            }
            if replace {
                model.put_vft(Some(XML.model));
                // Привязка к скелету и байт флагов живут только у скиннинга.
                if model.bytes[Model::Skin.spot() + 1] == 0 {
                    model.put(Model::Skin, &[0; 4]);
                    model.put(Model::Render.spot() + 1, &[0]);
                }
                model.put(Model::Render, &[0xff]);
            }
            // Недостающий у образца указатель дописывается: иначе номера шейдеров и рамки новой модели терялись бы.
            for (field, placed) in [(Model::Geometries, list), (Model::Bounds, bounds), (Model::Shaders, numbers)] {
                model.aim_or_add(field, placed.at);
            }
        })
    }

    /// Новый массив записей и новая голова списка High. Дописывание сохраняет прежние модели и кладёт массив
    /// рядом с моделью; замена оставляет одну модель и держит массив в области старой головы.
    fn relist(&mut self, list: &ModelList, model: Placed, keep_old: bool) -> Placed {
        let anchor = if keep_old { model.block } else { list.head };
        let segment = self.graph.blocks[anchor].segment;
        let mut targets: Vec<Address> = Vec::new();
        if keep_old {
            let graph = &*self.graph;
            targets.extend((0..list.models.len()).filter_map(|i| resource_graph::pointer_from(graph, list.entries, i * 8)));
        }
        targets.push(model.at);
        let mut array = Draft::bare(segment, vec![0; 8 * targets.len()]);
        array.slots = targets.iter().enumerate().map(|(i, &target)| Slot { relative: 8 * i, target }).collect();
        let array = array.commit(self.graph);

        let total = targets.len() as u16;
        self.derive(list.head, |head| {
            head.put_u16(List::Count, total);
            head.put_u16(List::Capacity, total);
            head.slots = vec![Slot { relative: List::Entries.spot(), target: array.at }];
        })
    }

    /// Указатели рисовалки на список High, которые вели на `old`, переводит на `new`.
    fn redirect_head(&mut self, drawable: usize, old: usize, new: Address) {
        let aliases = [Draw::High.spot(), Draw::HighAlias.spot()];
        let graph = &*self.graph;
        let hits: Vec<usize> = graph.blocks[drawable]
            .slots
            .iter()
            .enumerate()
            .filter(|(_, slot)| aliases.contains(&slot.relative) && graph.block_at(slot.target) == Some(old))
            .map(|(i, _)| i)
            .collect();
        for i in hits {
            self.graph.blocks[drawable].slots[i].target = new;
        }
    }

    /// Блок обнуляется на месте и теряет указатели; границы блоков прежние.
    fn retire(&mut self, block: usize) {
        let found = &self.graph.blocks[block];
        let (segment, start, end) = (found.segment, found.start, found.end);
        let area = match segment {
            Segment::System => &mut self.graph.system,
            Segment::Graphics => &mut self.graph.graphics,
        };
        area[start..end].fill(0);
        self.graph.blocks[block].slots.clear();
    }

    /// Ссылается ли на `block` хоть один блок, кроме `except`.
    fn referenced_besides(&self, block: usize, except: usize) -> bool {
        let graph = &*self.graph;
        let points_here = |slot: &Slot| graph.block_at(slot.target) == Some(block);
        graph.blocks.iter().enumerate().any(|(i, other)| i != except && other.slots.iter().any(points_here))
    }

    /// Голова старого списка и массив её записей больше никому не нужны: обнуляются.
    fn retire_old_list(&mut self, drawable: usize, list: &ModelList) {
        if self.referenced_besides(list.head, drawable) {
            return;
        }
        self.retire(list.head);
        if !self.referenced_besides(list.entries, list.head) {
            self.retire(list.entries);
        }
    }

    /// Блоки, достижимые от корня по указателям.
    fn reachable(&self) -> HashSet<usize> {
        let graph = &*self.graph;
        let mut seen = HashSet::new();
        let mut pending: Vec<usize> = graph.root().into_iter().collect();
        while let Some(block) = pending.pop() {
            if seen.insert(block) {
                pending.extend(graph.blocks[block].slots.iter().filter_map(|slot| graph.block_at(slot.target)));
            }
        }
        seen
    }
}

// ---------- запись: заголовки по таблице ----------

/// Строка таблицы записи: смещение и новые байты.
type Stamp = (usize, Vec<u8>);

fn stamp(at: impl Spot, bytes: impl Into<Vec<u8>>) -> Stamp {
    (at.spot(), bytes.into())
}

fn le_floats(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|value| value.to_le_bytes()).collect()
}

/// Записывает таблицу в блок по порядку строк; первая запись за блоком обрывает остальные.
fn apply_stamps(graph: &mut Graph, block: usize, table: &[Stamp]) -> Result<()> {
    table.iter().try_for_each(|(at, bytes)| resource_graph::write_at(graph, block, *at, bytes))
}

/// Сфера (центр и радиус подряд) и рамка рисовалки.
fn sphere_stamps(centre: [f32; 3], radius: f32, low: [f32; 3], high: [f32; 3]) -> [Stamp; 3] {
    let [x, y, z] = centre;
    [stamp(Draw::Sphere, le_floats(&[x, y, z, radius])), stamp(Draw::Min, le_floats(&low)), stamp(Draw::Max, le_floats(&high))]
}

// ---------- запись: геометрия ----------

/// Геометрия для дописывания: байты вершин, номера вершин и рамка.
#[derive(Debug, Clone, PartialEq)]
pub struct NewGeometry {
    pub vertices: Vec<u8>,
    pub indices: Vec<u16>,
    pub shader: u16,
    pub min: [f32; 3],
    pub max: [f32; 3],
}

/// Что берётся из образца геометрии.
struct Sample {
    buffer: usize,
    index_buffer: usize,
    stream: usize,
    data: usize,
    stride: usize,
    declaration: Option<usize>,
}

impl Sample {
    fn of(graph: &Graph, geometry: usize) -> Result<Sample> {
        let geometry = Cursor::on(graph, geometry);
        let buffer = geometry.require(Geo::VertexBuffer, "писатель: геометрия образца без буфера вершин")?;
        let index_buffer = geometry.require(Geo::IndexBuffer, "писатель: геометрия образца без буфера индексов")?;
        let stream = buffer.require(Vb::Stream, "писатель: буфер вершин образца без потока")?;
        let data = index_buffer.require(Ib::Data, "писатель: буфер индексов образца без данных")?;
        Ok(Sample {
            buffer: buffer.block,
            index_buffer: index_buffer.block,
            stream: stream.block,
            data: data.block,
            stride: buffer.count(Vb::Stride)?,
            declaration: buffer.follow(Vb::Declaration).map(|declaration| declaration.block),
        })
    }
}

impl NewGeometry {
    /// Число вершин по шагу образца; отказ, если данные не годятся.
    fn vertex_total(&self, stride: usize) -> Result<usize> {
        if stride == 0 || self.vertices.len() % stride != 0 {
            return Err(Error::broken("писатель: вершины не делятся на шаг образца"));
        }
        let total = self.vertices.len() / stride;
        let counted = (1..=usize::from(u16::MAX)).contains(&total) && !self.indices.is_empty() && self.indices.len() % 3 == 0;
        if !counted {
            return Err(Error::broken("писатель: геометрия с неверным числом вершин или индексов"));
        }
        match self.indices.iter().any(|&index| usize::from(index) >= total) {
            true => Err(Error::broken("писатель: индекс вне вершин геометрии")),
            false => Ok(total),
        }
    }
}

/// Что пишется в четвёртое число (w) рамок геометрий: у образца оно общее на всю модель, а Мегамолл хоста кладёт туда x
/// самой рамки (минимум — x минимума, максимум — x максимума).
#[derive(Debug, Clone, Copy, PartialEq)]
enum BoxW {
    Fixed([f32; 2]),
    FollowsX,
}

/// Записи рамок новой модели: одна геометрия — одна запись; несколько — сводная и по записи на геометрию.
fn bounds_bytes(geometries: &[NewGeometry], w: BoxW) -> Vec<u8> {
    let records: Vec<[f32; 8]> = geometries
        .iter()
        .map(|g| {
            let ([x0, y0, z0], [x1, y1, z1]) = (g.min, g.max);
            let [w0, w1] = match w {
                BoxW::Fixed(w) => w,
                BoxW::FollowsX => [x0, x1],
            };
            [x0, y0, z0, w0, x1, y1, z1, w1]
        })
        .collect();
    // Сводная запись: минимумы первых четырёх чисел и максимумы последних четырёх.
    let (lows, highs) = records.iter().fold(([f32::MAX; 4], [f32::MIN; 4]), |(mut lows, mut highs), record| {
        for k in 0..4 {
            lows[k] = lows[k].min(record[k]);
            highs[k] = highs[k].max(record[k + 4]);
        }
        (lows, highs)
    });
    let summary = (records.len() > 1).then(|| [lows, highs].concat());
    let numbers: Vec<f32> = summary.into_iter().flatten().chain(records.into_iter().flatten()).collect();
    le_floats(&numbers)
}

/// Список High рисовалки; без него путь записи отказывает.
fn high_list(drawable: Cursor) -> Result<ModelList> {
    drawable.model_list(Draw::High, &WRITE_WORDS)?.ok_or_else(|| Error::broken("писатель: рисовалка без списка High"))
}

// ---------- запись: дописывание, обновление, замена ----------

/// Правка графа «всё или ничего»: при отказе граф остаётся таким, каким был до вызова.
fn all_or_nothing<T>(graph: &mut Graph, edit: impl FnOnce(&mut Graph) -> Result<T>) -> Result<T> {
    let backup = graph.clone();
    edit(graph).inspect_err(|_| *graph = backup)
}

fn require_geometries(geometries: &[NewGeometry]) -> Result<()> {
    (!geometries.is_empty()).then_some(()).ok_or_else(|| Error::broken("писатель: модель без геометрий"))
}

/// Первая модель списка High — образец; в пустом списке образца нет.
fn first_high_model(list: &ModelList) -> Result<usize> {
    list.models.first().copied().ok_or_else(|| Error::broken("писатель: в рисовалке нет модели High для образца"))
}

/// Корень модели надписи: рамка, сфера, маска корзин, дальность и слово рендера.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SignRoot {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub centre: [f32; 3],
    pub radius: f32,
    pub mask: u8,
    pub lod: Option<f32>,
    pub render_word: u16,
    /// Четвёртое число рамок геометрий повторяет x (так пишет Мегамолл хоста); иначе нули.
    pub box_w_follows_x: bool,
}

pub fn replace_high_model_layouts(graph: &mut Graph, drawable: usize, geometries: &[NewGeometry], layouts: Option<&[u16]>, root: &SignRoot) -> Result<()> {
    all_or_nothing(graph, |graph| Swap { drawable, geometries, layouts, root }.run(graph))
}

/// Замена модели High: что менять и чем.
struct Swap<'a> {
    drawable: usize,
    geometries: &'a [NewGeometry],
    layouts: Option<&'a [u16]>,
    root: &'a SignRoot,
}

impl Swap<'_> {
    /// Отказы до любой записи, в порядке проверок.
    fn vet(&self) -> Result<()> {
        let mismatch = self.layouts.is_some_and(|numbers| numbers.len() != self.geometries.len());
        [(mismatch, "писатель: по одному образцу раскладки на сетку"), (self.geometries.is_empty(), "писатель: модель без геометрий")]
            .into_iter()
            .find(|(hit, _)| *hit)
            .map_or(Ok(()), |(_, text)| Err(Error::broken(text)))
    }

    /// Номер шейдера, по которому берётся образец для геометрии `i`.
    fn wanted_shader(&self, i: usize) -> u16 {
        self.layouts.map_or(self.geometries[i].shader, |numbers| numbers[i])
    }

    /// Новые заголовки рисовалки: VFT, маска корзин, слово рендера, сфера с рамкой и, если задана, дальность.
    fn root_stamps(&self) -> Vec<Stamp> {
        let root = self.root;
        let head = [stamp(0usize, XML.drawable.to_le_bytes()), stamp(Draw::Flags, [root.mask]), stamp(Draw::Word, root.render_word.to_le_bytes())];
        let lod = root.lod.map(|lod| stamp(Draw::Lod, le_floats(&[lod; 4])));
        head.into_iter().chain(sphere_stamps(root.centre, root.radius, root.min, root.max)).chain(lod).collect()
    }

    fn run(&self, graph: &mut Graph) -> Result<()> {
        self.vet()?;
        let drawable = self.drawable;
        let list = high_list(Cursor::on(graph, drawable))?;
        let sample_model = first_high_model(&list)?;
        let templates = high_geometry_templates(graph, drawable)?;
        let mut editor = Editor { graph };
        let before = editor.reachable();

        let mut built = Vec::with_capacity(self.geometries.len());
        for (i, geometry) in self.geometries.iter().enumerate() {
            let sample = templates.get(&self.wanted_shader(i)).copied().ok_or_else(|| Error::broken("писатель: нет образца геометрии для шейдера"))?;
            built.push(editor.grow_geometry(sample, geometry, Some(&XML))?);
        }
        let w = if self.root.box_w_follows_x { BoxW::FollowsX } else { BoxW::Fixed([0.0, 0.0]) };
        let model = editor.assemble_model(sample_model, &built, self.geometries, w, true);
        let head = editor.relist(&list, model, false);
        editor.redirect_head(drawable, list.head, head.at);
        apply_stamps(editor.graph, drawable, &self.root_stamps())?;

        // Что было достижимо до правки и перестало быть — старая модель со всеми потрохами.
        let after = editor.reachable();
        let mut gone: Vec<usize> = before.into_iter().filter(|block| !after.contains(block)).collect();
        gone.sort_unstable();
        for block in gone {
            editor.retire(block);
        }
        Ok(())
    }
}

/// Число моделей High и общая рамка: рамка самой рисовалки, расширенная рамками геометрий всех её моделей.
fn high_extent(drawable: Cursor) -> Result<(usize, [f32; 3], [f32; 3])> {
    let list = high_list(drawable)?;
    let mut low = drawable.reals::<3>(Draw::Min)?;
    let mut high = drawable.reals::<3>(Draw::Max)?;
    for &block in &list.models {
        for (lo, hi) in Cursor::on(drawable.graph, block).boxes()? {
            low = std::array::from_fn(|i| low[i].min(lo[i]));
            high = std::array::from_fn(|i| high[i].max(hi[i]));
        }
    }
    (list.models.len() <= HIGH_CAP).then_some(()).ok_or_else(|| Error::broken("писатель: больше 15 моделей High в рисовалке"))?;
    Ok((list.models.len(), low, high))
}

pub fn refresh_drawable(graph: &mut Graph, drawable: usize) -> Result<()> {
    all_or_nothing(graph, |graph| {
        let cursor = Cursor::on(graph, drawable);
        let (models, low, high) = high_extent(cursor)?;
        let word = cursor.byte(Draw::Word)?;

        let centre: [f32; 3] = std::array::from_fn(|i| (low[i] + high[i]) / 2.0);
        let radius = (0..3).map(|i| (high[i] - low[i]) * (high[i] - low[i])).sum::<f32>().sqrt() / 2.0;
        let counters = [stamp(Draw::Flags, [models as u8]), stamp(Draw::Word, [(word & 0x0f) | ((models as u8) << 4)])];
        let table: Vec<Stamp> = counters.into_iter().chain(sphere_stamps(centre, radius, low, high)).collect();
        apply_stamps(graph, drawable, &table)
    })
}

/// Образец дописывания: список High, его первая модель, первая геометрия той модели и `w` из её рамок.
struct HighSample {
    list: ModelList,
    model: usize,
    geometry: usize,
    w: [f32; 2],
}

impl HighSample {
    fn of(graph: &Graph, drawable: usize) -> Result<Self> {
        let list = high_list(Cursor::on(graph, drawable))?;
        let model = first_high_model(&list)?;
        let cursor = Cursor::on(graph, model);
        let geometry = cursor.require(Model::Geometries, "писатель: модель образца без геометрий")?.require(0usize, "писатель: модель образца без первой геометрии")?.block;
        let total = cursor.count(Model::Count)?;
        (total != 0).then_some(()).ok_or_else(|| Error::broken("писатель: модель образца без геометрий"))?;
        let bounds = cursor.require(Model::Bounds, "писатель: модель без рамок")?;
        let record = if total == 1 { 0 } else { BOX_LEN };
        let w = [bounds.real(record + 12)?, bounds.real(record + 28)?];
        Ok(Self { list, model, geometry, w })
    }
}

pub fn append_high_model(graph: &mut Graph, drawable: usize, geometries: &[NewGeometry]) -> Result<()> {
    all_or_nothing(graph, |graph| {
        require_geometries(geometries)?;
        let HighSample { list, model, geometry, w } = HighSample::of(graph, drawable)?;
        let mut editor = Editor { graph };
        let built = geometries.iter().map(|each| editor.grow_geometry(geometry, each, None)).collect::<Result<Vec<_>>>()?;
        let placed = editor.assemble_model(model, &built, geometries, BoxW::Fixed(w), false);
        let head = editor.relist(&list, placed, true);
        editor.redirect_head(drawable, list.head, head.at);
        editor.retire_old_list(drawable, &list);
        Ok(())
    })
}

pub fn replace_high_model(graph: &mut Graph, drawable: usize, geometries: &[NewGeometry], root: &SignRoot) -> Result<()> {
    all_or_nothing(graph, |graph| Swap { drawable, geometries, layouts: None, root }.run(graph))
}

/// Указатель на коллизию в корне рисовалки.
const BOUNDS_POINTER: usize = 0xc8;

/// После замены сеток хост оставляет у рисовалки одну модель высокой детализации: средняя, низкая и очень низкая и зашитая коллизия
/// уходят (дальние планы у игры — свои сущности), флаги этих уровней — нуль. Указатели обнуляются, блоки уйдут при сборке файла.
pub fn drop_lower_levels(graph: &mut Graph, drawable: usize) -> Result<()> {
    all_or_nothing(graph, |graph| {
        for at in [Draw::Medium.spot(), Draw::Low.spot(), Draw::VeryLow.spot(), BOUNDS_POINTER] {
            graph.blocks[drawable].slots.retain(|slot| slot.relative != at);
            resource_graph::write_at(graph, drawable, at, &[0; 8])?;
        }
        resource_graph::write_at(graph, drawable, Draw::Flags.spot() + 4, &[0; 12])
    })
}

// ---------- сборка файла ----------

/// Сборка файла: блоки на прежних местах, страницы и флаги заново; сжатие тела — `deflate`.
fn pack(graph: &Graph, deflate: &dyn Fn(&[u8]) -> Vec<u8>) -> Result<Vec<u8>> {
    let [system, graphics] = [Segment::System, Segment::Graphics].map(|segment| resource_graph::identity_order(graph, segment));
    resource_graph::rebuild_with(graph, &system, &graphics, deflate)
}

pub fn finish(graph: &Graph) -> Result<Vec<u8>> {
    pack(graph, &deflate_zlib9)
}

pub fn finish_compact(graph: &Graph) -> Result<Vec<u8>> {
    pack(&resource_graph::subgraph(graph, Address { segment: Segment::System, offset: 0 })?, &deflate_body)
}

// ---------- каноническая запись ----------

/// Канонический текст графа: номер блока — порядок первой встречи при обходе вширь от корня,
/// указатели — в порядке хранения.
struct Canon<'g> {
    graph: &'g Graph,
    strings: bool,
}

impl Canon<'_> {
    /// Блоки в порядке встречи и номер каждого из них (`None` — до блока не дошли).
    fn ranking(&self, root: usize) -> (Vec<usize>, Vec<Option<usize>>) {
        let mut rank: Vec<Option<usize>> = vec![None; self.graph.blocks.len()];
        rank[root] = Some(0);
        let mut order = vec![root];
        let mut done = 0;
        while done < order.len() {
            let block = order[done];
            done += 1;
            for target in self.graph.blocks[block].slots.iter().filter_map(|slot| self.graph.block_at(slot.target)) {
                rank[target].get_or_insert_with(|| {
                    order.push(target);
                    order.len() - 1
                });
            }
        }
        (order, rank)
    }

    /// Строка одного блока: содержимое без указателей, затем сами указатели.
    fn line(&self, id: usize, block: usize, rank: &[Option<usize>]) -> String {
        let graph = self.graph;
        let slots = &graph.blocks[block].slots;
        let raw = graph.content(block);
        let mut body = raw.to_vec();
        // Восемь байтов каждого указателя, который целиком лежит в блоке, считаются нулевыми.
        for slot in slots.iter().filter(|slot| slot.relative + 8 <= raw.len()) {
            body[slot.relative..slot.relative + 8].fill(0);
        }
        body.truncate(body.iter().rposition(|&byte| byte != 0).map_or(0, |last| last + 1));
        if !self.strings && body.len() > 1 && body.iter().all(|byte| (0x20..=0x7e).contains(byte)) {
            body = b"<string>".to_vec();
        }
        let links: String = slots
            .iter()
            .map(|slot| match graph.block_at(slot.target) {
                Some(target) => format!(" [+{:#x}->#{}+{:#x}]", slot.relative, rank[target].expect("блок пронумерован"), slot.target.offset - graph.blocks[target].start),
                None => format!(" [+{:#x}->?]", slot.relative),
            })
            .collect();
        format!("#{id} {:?} len {} {:02x?}{links}", graph.blocks[block].segment, body.len(), body)
    }

    fn text(&self) -> String {
        let Some(root) = self.graph.root() else {
            return String::new();
        };
        let (order, rank) = self.ranking(root);
        let lines: Vec<String> = order.iter().enumerate().map(|(id, &block)| self.line(id, block, &rank)).collect();
        lines.join("\n") + "\n"
    }
}

pub fn canonical_with(graph: &Graph, strings: bool) -> String {
    Canon { graph, strings }.text()
}

pub fn canonical(graph: &Graph) -> String {
    Canon { graph, strings: true }.text()
}

// ---------- числа в JSON ----------

/// Число `f32` в JSON, как его записал бы хост: кратчайшая запись, а на точных «серединах» — округление
/// точного значения до тех же знаков к чётной цифре.
pub fn float_value(value: f32) -> Value {
    value.is_finite().then(|| host_text(value)).and_then(|text| text.parse::<f64>().ok()).and_then(Number::from_f64).map_or(Value::Null, Value::Number)
}

/// Текст конечного `f32`, который потом читается как f64.
fn host_text(value: f32) -> String {
    // Кратчайшая запись в научном виде даёт значащие цифры и порядок: по ним видно, сколько знаков после точки.
    let shortest = format!("{value:e}");
    let (mantissa, exponent) = shortest.split_once('e').expect("научная запись");
    let digits = mantissa.bytes().filter(u8::is_ascii_digit).count();
    let after_point = digits as i32 - 1 - exponent.parse::<i32>().expect("порядок");
    if after_point <= 0 {
        return shortest;
    }
    // Те же значащие цифры, но от точного значения: ровная «середина» уходит к чётной цифре.
    let rounded = format!("{:.*e}", digits - 1, f64::from(value));
    if rounded.parse::<f32>().is_ok_and(|back| back == value) {
        rounded
    } else {
        shortest
    }
}

/// Расширение `f32` до f64 для JSON; бесконечность и `NaN` дают `null`.
fn widen(value: f32) -> Value {
    Number::from_f64(f64::from(value)).map_or(Value::Null, Value::Number)
}

fn float_list(values: &[f32]) -> Value {
    Value::Array(values.iter().copied().map(float_value).collect())
}

// ---------- осмотр плитки ----------

/// Объект JSON с ключами в заданном порядке.
fn object(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(pairs.into_iter().map(|(key, value)| (key.to_owned(), value)).collect::<Map<_, _>>())
}

/// Записывает объект JSON по строкам `"ключ" => значение`; значения вычисляются в том порядке, в каком написаны.
macro_rules! record {
    ($($key:literal => $value:expr),+ $(,)?) => {
        object([$(($key, $value)),+])
    };
}

/// Четыре числа по уровням детализации: `high`, `med`, `low`, `vlow`.
fn per_level(values: [u32; 4]) -> Value {
    object(LEVELS.iter().zip(values).map(|((_, name), value)| (*name, Value::from(value))))
}

/// Статистика по вершинам геометрии: рамка xy, диапазон z и гистограмма цветов.
struct VertexStats {
    xy: Value,
    z: Value,
    colours: Value,
}

/// Сколько раз встретился цвет и в каких пределах лежит z его вершин.
struct Tally {
    first: usize,
    count: usize,
    z_lo: f32,
    z_hi: f32,
}

/// Гистограмма цветов вершин по строке RGBA.
#[derive(Default)]
struct Palette {
    tallies: BTreeMap<String, Tally>,
}

impl Palette {
    fn note(&mut self, key: String, z: f32) {
        let ordinal = self.tallies.len();
        self.tallies
            .entry(key)
            .and_modify(|tally| {
                tally.count += 1;
                tally.z_lo = tally.z_lo.min(z);
                tally.z_hi = tally.z_hi.max(z);
            })
            .or_insert(Tally { first: ordinal, count: 1, z_lo: z, z_hi: z });
    }

    /// До `limit` самых частых цветов: по убыванию числа вершин, при равенстве — кто встретился раньше.
    fn top(self, limit: usize) -> Vec<Value> {
        let mut ranked: Vec<(String, Tally)> = self.tallies.into_iter().collect();
        ranked.sort_by_key(|(_, tally)| (Reverse(tally.count), tally.first));
        ranked
            .into_iter()
            .take(limit)
            .map(|(rgba, tally)| {
                record! {
                    "rgba" => Value::from(rgba),
                    "vertices" => Value::from(tally.count),
                    "zMin" => float_value(tally.z_lo),
                    "zMax" => float_value(tally.z_hi),
                }
            })
            .collect()
    }
}

fn vertex_stats(geometry: Cursor) -> Result<VertexStats> {
    let Some(run) = VertexRun::open(geometry)? else {
        return Ok(VertexStats { xy: Value::Null, z: Value::Null, colours: Value::Array(Vec::new()) });
    };
    let at = run.position.offset;
    let colour = run.layout.get(COLOUR0);
    let mut span: Option<([f32; 3], [f32; 3])> = None;
    let mut palette = Palette::default();
    for base in run.rows() {
        let point: [f32; 3] = std::array::from_fn(|axis| run.peek(base + at + 4 * axis).unwrap_or(0.0));
        let (lo, hi) = span.get_or_insert((point, point));
        for axis in 0..3 {
            lo[axis] = lo[axis].min(point[axis]);
            hi[axis] = hi[axis].max(point[axis]);
        }
        if let Some(colour) = colour {
            let from = base + colour.offset;
            let key = run.data.get(from..from + 4).map_or_else(String::new, |rgba| rgba.iter().map(|byte| format!("{byte:02X}")).collect());
            palette.note(key, point[2]);
        }
    }
    let (xy, z) = match span {
        Some((lo, hi)) if !lo[0].is_nan() => (Value::Array([lo[0], lo[1], hi[0], hi[1]].map(widen).to_vec()), Value::Array([lo[2], hi[2]].map(widen).to_vec())),
        _ => (Value::Null, Value::Null),
    };
    Ok(VertexStats { xy, z, colours: Value::Array(palette.top(24)) })
}

/// Число из заголовка, а без объекта — 0.
fn or_zero(at: Option<Cursor>, read: impl FnOnce(Cursor) -> Result<u64>) -> Result<u64> {
    at.map_or(Ok(0), read)
}

fn geometry_report(model: Cursor, index: usize, geometry: Cursor, mapping: &[u16], records: usize) -> Result<Value> {
    let buffer = geometry.follow(Geo::VertexBuffer);
    let index_buffer = geometry.follow(Geo::IndexBuffer);
    let table = record! {
        "geometry" => Value::from(geometry.word(0usize)?),
        "vertexBuffer" => Value::from(or_zero(buffer, |b| b.word(0usize).map(u64::from))?),
        "indexBuffer" => Value::from(or_zero(index_buffer, |b| b.word(0usize).map(u64::from))?),
    };
    let declaration = match buffer.and_then(|b| b.declared()) {
        Some((block, found)) => record! {
            "flags" => Value::from(found.flags),
            "types" => Value::from(format!("{:016X}", found.types)),
            "stride" => Value::from(found.stride),
            "count" => Value::from(block.byte(7usize)?),
        },
        None => Value::Null,
    };
    let aabb = match model.follow(Model::Bounds) {
        Some(bounds) => {
            let at = (if records > 1 { index + 1 } else { 0 }) * BOX_LEN;
            record! {
                "min" => float_list(&bounds.reals::<4>(at)?),
                "max" => float_list(&bounds.reals::<4>(at + 16)?),
            }
        }
        None => record! { "min" => float_list(&[0.0; 4]), "max" => float_list(&[0.0; 4]) },
    };
    let stats = vertex_stats(geometry)?;
    Ok(record! {
        "shaderId" => Value::from(mapping.get(index).copied().unwrap_or(0)),
        "vertices" => Value::from(or_zero(buffer, |b| b.word(Vb::Count).map(u64::from))?),
        "indices" => Value::from(or_zero(index_buffer, |b| b.word(Ib::Count).map(u64::from))?),
        "stride" => Value::from(or_zero(buffer, |b| b.half(Vb::Stride).map(u64::from))?),
        "vft" => table,
        "bufferFlags" => Value::from(or_zero(buffer, |b| b.half(Vb::Flags).map(u64::from))?),
        "declaration" => declaration,
        "twoBuffers" => Value::from(buffer.is_some_and(|b| b.follow(Vb::Stream).is_some() && b.follow(Vb::StreamB).is_some())),
        "aabb" => aabb,
        "xy" => stats.xy,
        "z" => stats.z,
        "colours" => stats.colours,
    })
}

fn model_report(stop: Stop) -> Result<Value> {
    let model = stop.model;
    let geometries = model.geometries()?;
    let mapping = match model.follow(Model::Shaders) {
        Some(numbers) => (0..geometries.len()).map(|j| numbers.half(j * 2)).collect::<Result<Vec<_>>>()?,
        None => Vec::new(),
    };
    let records = match (model.follow(Model::Bounds), geometries.len()) {
        (None, _) => 0,
        (Some(_), total) if total > 1 => total + 1,
        (Some(_), total) => total,
    };
    let render = model.half(Model::Render)?;
    let listed = geometries.iter().enumerate().map(|(j, &geometry)| geometry_report(model, j, geometry, &mapping, records)).collect::<Result<Vec<_>>>()?;
    Ok(record! {
        "level" => Value::from(LEVELS[stop.level].1),
        "at" => Value::from(stop.at),
        "renderMaskFlags" => Value::from(render),
        "renderMask" => Value::from(render & 0xff),
        "flags" => Value::from(render >> 8),
        "skeletonBinding" => Value::from(model.word(Model::Skin)?),
        "shaderMapping" => Value::from(mapping),
        "boundsData" => Value::from(records),
        "geometries" => Value::Array(listed),
    })
}

fn shader_report(shader: Cursor) -> Result<Value> {
    Ok(record! {
        "name" => Value::from(shader.word(Shader::Name)?.to_string()),
        "file" => Value::from(shader.word(Shader::File)?.to_string()),
        "bucket" => Value::from(shader.bytes().get(Shader::Bucket.spot()).copied().unwrap_or(0)),
        "bucketMask" => Value::from(shader.word(Shader::Mask)?),
    })
}

fn shader_reports(drawable: Cursor) -> Result<Value> {
    let Some(group) = drawable.follow(Draw::Group) else {
        return Ok(Value::Array(Vec::new()));
    };
    let Some(list) = group.follow(Group::List) else {
        return Ok(Value::Array(Vec::new()));
    };
    let reports = (0..group.count(Group::Count)?).map(|i| list.require(i * 8, "писатель: пустой шейдер в группе").and_then(shader_report)).collect::<Result<Vec<_>>>()?;
    Ok(Value::Array(reports))
}

/// Имя рисовалки из словаря: берётся, только если его хеш совпадает с хешем рисовалки.
fn drawable_name(drawable: Cursor, hash: Option<u32>) -> Value {
    let Some(hash) = hash else { return Value::Null };
    let stored = drawable.follow(Draw::Name).map(|block| {
        let text = block.bytes();
        String::from_utf8_lossy(text.split(|&byte| byte == 0).next().unwrap_or(&[])).into_owned()
    });
    Value::String(match stored {
        Some(name) if !name.is_empty() && joaat(&name) == hash => name,
        _ => format!("hash_{hash:08X}"),
    })
}

/// Хеши рисовалок словаря: список под указателем и число хешей читаются целиком, нехватка блока — отказ.
fn listed_hashes(graph: &Graph) -> Result<Vec<u32>> {
    let Some(root) = dictionary_root(graph) else {
        return Ok(Vec::new());
    };
    let Some(list) = root.follow(Dict::Hashes) else {
        return Ok(Vec::new());
    };
    list.words(0, root.count(Dict::HashCount)?).collect()
}

fn drawable_report(graph: &Graph, index: usize, drawable: Cursor, hash: Option<u32>) -> Result<Value> {
    let mut words = [0u32; 4];
    for (i, word) in words.iter_mut().enumerate() {
        *word = drawable.word(Draw::Flags.spot() + 4 * i)?;
    }
    let lod = (0..4).map(|i| drawable.real(Draw::Lod.spot() + 4 * i)).collect::<Result<Vec<_>>>()?;
    let bounds = record! {
        "min" => float_list(&drawable.reals::<3>(Draw::Min)?),
        "max" => float_list(&drawable.reals::<3>(Draw::Max)?),
        "center" => float_list(&drawable.reals::<3>(Draw::Sphere)?),
        "radius" => float_value(drawable.real(Draw::Radius)?),
    };
    let shaders = shader_reports(drawable)?;
    let models = drawable.stops(0..LEVELS.len())?.into_iter().map(model_report).collect::<Result<Vec<_>>>()?;
    Ok(record! {
        "index" => Value::from(index),
        "hash" => hash.map_or(Value::Null, |h| Value::from(format!("{h:08X}"))),
        "name" => drawable_name(drawable, hash),
        "water" => Value::from(drawable_has_water(graph, drawable.block)?),
        "flags" => per_level(words.map(|word| word & 0xff)),
        "renderMask" => per_level(words.map(|word| (word >> 8) & 0xff)),
        "lodDist" => float_list(&lod),
        "bounds" => bounds,
        "shaders" => shaders,
        "models" => Value::Array(models),
    })
}

pub fn tile_inspection(graph: &Graph, file: &str, bytes: usize) -> Result<Value> {
    shape(graph).and_then(|counts| {
        let hashes = listed_hashes(graph)?;
        let drawables = dictionary_drawables(graph)?
            .into_iter()
            .enumerate()
            .map(|(index, drawable)| drawable_report(graph, index, drawable, hashes.get(index).copied()))
            .collect::<Result<Vec<_>>>()?;
        Ok(record! {
            "file" => Value::from(file),
            "bytes" => Value::from(bytes),
            "box" => tile_bounds(graph)?.map_or(Value::Null, |found| float_list(&found)),
            "shape" => Value::from(format!(
                "d{}/m{}/g{}/v{}/i{}",
                counts.drawables, counts.models, counts.geometries, counts.vertices, counts.indices
            )),
            "lodMismatch" => lod_mismatch(graph)?.map_or(Value::Null, Value::String),
            "drawables" => Value::Array(drawables),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{GRAPHICS_BASE, SYSTEM_BASE};
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};

    use Segment::{Graphics as Gfx, System as Sys};

    // ---------- стенд: графы собираются таблицами полей ----------

    /// Две области; блоки кладутся друг за другом по границе 16.
    #[derive(Default)]
    struct Arena {
        areas: [Vec<u8>; 2],
    }

    impl Arena {
        fn area(&mut self, segment: Segment) -> &mut Vec<u8> {
            &mut self.areas[usize::from(segment == Gfx)]
        }

        fn reserve(&mut self, segment: Segment, len: usize) -> usize {
            let area = self.area(segment);
            let start = area.len().next_multiple_of(16);
            area.resize(start + len, 0);
            start
        }

        fn poke(&mut self, segment: Segment, at: usize, bytes: &[u8]) {
            self.area(segment)[at..at + bytes.len()].copy_from_slice(bytes);
        }

        fn into_graph(self) -> Graph {
            let [system, graphics] = self.areas;
            resource_graph::from_parts(165, 0, 0, system, graphics)
        }
    }

    /// Что записать в поле объекта.
    enum Put {
        U32(u32),
        U16(u16),
        Raw(Vec<u8>),
        Reals(Vec<f32>),
        To(Segment, usize),
    }

    use Put::{Raw, Reals, To, U16, U32};

    /// Резервирует блок и заполняет его поля по таблице «смещение → значение»; возвращает начало блока.
    fn lay(arena: &mut Arena, segment: Segment, len: usize, fields: Vec<(usize, Put)>) -> usize {
        let start = arena.reserve(segment, len);
        for (offset, put) in fields {
            let bytes = match put {
                U32(value) => value.to_le_bytes().to_vec(),
                U16(value) => value.to_le_bytes().to_vec(),
                Raw(bytes) => bytes,
                Reals(values) => le_floats(&values),
                To(target, at) => ((if target == Sys { SYSTEM_BASE } else { GRAPHICS_BASE }) + at as u64).to_le_bytes().to_vec(),
            };
            arena.poke(segment, start + offset, &bytes);
        }
        start
    }

    /// Решётка 2×2 (шаг 16 по x и 24 по y), вершина = позиция float3 и серый цвет RGBA; z у последней вершины задаётся.
    fn lattice(gray: u8, depth: f32) -> Vec<u8> {
        (0..4u8)
            .flat_map(|i| {
                let z = if i == 3 { depth } else { 0.0 };
                le_floats(&[16.0 * f32::from(i & 1), 24.0 * f32::from(i >> 1), z]).into_iter().chain([gray + i, gray + i, gray + i, 255])
            })
            .collect()
    }

    const FAN: [u16; 6] = [0, 1, 2, 2, 1, 3];

    fn lay_geometry(a: &mut Arena, vertices: &[u8], indices: &[u16]) -> usize {
        let total = vertices.len() / 16;
        let stream = lay(a, Gfx, vertices.len(), vec![(0, Raw(vertices.to_vec()))]);
        let data = lay(a, Gfx, indices.len() * 2, vec![(0, Raw(indices.iter().flat_map(|i| i.to_le_bytes()).collect()))]);
        let index_buffer = lay(a, Sys, 0x60, vec![(0, U32(0x4061_d140)), (8, U32(indices.len() as u32)), (0x10, To(Gfx, data))]);
        let declaration = lay(a, Sys, 16, vec![(0, U32(0x11)), (4, U16(16)), (7, Raw(vec![2])), (8, Raw(0x0009_0006u64.to_le_bytes().to_vec()))]);
        let buffer = lay(
            a,
            Sys,
            0x80,
            vec![(0, U32(0x4061_d3e0)), (8, U16(16)), (0x0a, U16(4)), (0x10, To(Gfx, stream)), (0x18, U32(total as u32)), (0x20, To(Gfx, stream)), (0x30, To(Sys, declaration))],
        );
        let payload = lay(a, Sys, 0x40, vec![(0, U32(0x4061_17f0)), (0x10, To(Gfx, stream)), (0x30, Raw(vec![8]))]);
        lay(
            a,
            Sys,
            0xa0,
            vec![
                (0, U32(0x4061_8780)),
                (0x18, To(Sys, buffer)),
                (0x38, To(Sys, index_buffer)),
                (0x58, U32(indices.len() as u32)),
                (0x5c, U32((indices.len() / 3) as u32)),
                (0x60, U16(total as u16)),
                (0x78, To(Sys, payload)),
            ],
        )
    }

    fn lay_model(a: &mut Arena, geometry: usize, shader: u16) -> usize {
        let list = lay(a, Sys, 8, vec![(0, To(Sys, geometry))]);
        let bounds = lay(a, Sys, 32, vec![(0, Reals(vec![0.0, 0.0, 0.0, 5.0, 16.0, 24.0, 1.5, 11.0]))]);
        let numbers = lay(a, Sys, 2, vec![(0, U16(shader))]);
        lay(
            a,
            Sys,
            0x30,
            vec![
                (0, U32(0x4061_0a90)),
                (8, To(Sys, list)),
                (0x10, U16(1)),
                (0x12, U16(1)),
                (0x18, To(Sys, bounds)),
                (0x20, To(Sys, numbers)),
                (0x28, Raw(vec![4, 0, 0, 0])),
                (0x2c, U16(0x0201)),
                (0x2e, U16(1)),
            ],
        )
    }

    fn lay_drawable(a: &mut Arena, models: &[usize], name: &str) -> usize {
        let entries = lay(a, Sys, 8 * models.len(), models.iter().enumerate().map(|(i, &m)| (8 * i, To(Sys, m))).collect());
        let head = lay(a, Sys, 16, vec![(0, To(Sys, entries)), (8, U16(models.len() as u16)), (0x0a, U16(models.len() as u16))]);
        let shader = lay(a, Sys, 0x30, vec![(8, U32(joaat("default"))), (0x10, Raw(vec![7, 0])), (0x18, U32(joaat("default.sps"))), (0x20, U32(1))]);
        let list = lay(a, Sys, 8, vec![(0, To(Sys, shader))]);
        let group = lay(a, Sys, 0x20, vec![(0x10, To(Sys, list)), (0x18, U16(1))]);
        let label = lay(a, Sys, name.len() + 1, vec![(0, Raw(name.as_bytes().to_vec()))]);
        lay(
            a,
            Sys,
            0xb0,
            vec![
                (0, U32(0x4057_3170)),
                (0x10, To(Sys, group)),
                (0x20, Reals(vec![9.0, 13.0, 0.75, 16.0])),
                (0x40, Reals(vec![18.0, 26.0, 1.5])),
                (0x50, To(Sys, head)),
                (0x70, Reals(vec![7000.0, 0.0, 0.0, 0.0])),
                (0x80, Raw(vec![models.len() as u8, 1])),
                (0x9a, Raw(vec![((models.len() as u8) << 4) | 2])),
                (0xa0, To(Sys, head)),
                (0xa8, To(Sys, label)),
            ],
        )
    }

    /// Корень словаря: хеши и массив указателей на рисовалки (без указателей рисовалка не стала бы блоком).
    fn seal(mut arena: Arena, hashes: &[u32], drawables: &[usize]) -> Graph {
        let list = lay(&mut arena, Sys, 4 * hashes.len(), vec![(0, Raw(hashes.iter().flat_map(|h| h.to_le_bytes()).collect()))]);
        let array = lay(&mut arena, Sys, 8 * drawables.len(), drawables.iter().enumerate().map(|(i, &d)| (8 * i, To(Sys, d))).collect());
        arena.poke(Sys, 0x20, &(SYSTEM_BASE + list as u64).to_le_bytes());
        arena.poke(Sys, 0x28, &(hashes.len() as u16).to_le_bytes());
        arena.poke(Sys, 0x30, &(SYSTEM_BASE + array as u64).to_le_bytes());
        arena.poke(Sys, 0x38, &(drawables.len() as u16).to_le_bytes());
        arena.into_graph()
    }

    fn arena_with_root() -> Arena {
        let mut arena = Arena::default();
        assert_eq!(arena.reserve(Sys, 0x40), 0);
        arena
    }

    /// Словарь: по рисовалке на запись (хеш, имя, z последней вершины), у каждой одна модель с одной геометрией.
    fn dictionary(specs: &[(u32, &str, f32)]) -> Graph {
        let mut arena = arena_with_root();
        let drawables: Vec<usize> = specs
            .iter()
            .map(|&(_, name, depth)| {
                let geometry = lay_geometry(&mut arena, &lattice(100, depth), &FAN);
                let model = lay_model(&mut arena, geometry, 0);
                lay_drawable(&mut arena, &[model], name)
            })
            .collect();
        let hashes: Vec<u32> = specs.iter().map(|spec| spec.0).collect();
        seal(arena, &hashes, &drawables)
    }

    fn single() -> (Graph, usize) {
        let graph = dictionary(&[(joaat("alpha"), "alpha", 1.5)]);
        let drawable = drawable_at(&graph, 0).expect("рисовалка");
        (graph, drawable)
    }

    fn first_model(graph: &Graph, drawable: usize) -> usize {
        Cursor::on(graph, drawable).level_stops(0).expect("модели")[0].model.block
    }

    fn first_geometry(graph: &Graph, drawable: usize) -> usize {
        Cursor::on(graph, first_model(graph, drawable)).geometries().expect("геометрии")[0].block
    }

    fn fan(shader: u16) -> NewGeometry {
        NewGeometry { vertices: lattice(150, 2.0), indices: FAN.to_vec(), shader, min: [-3.0, -4.0, -5.0], max: [21.0, 30.0, 2.0] }
    }

    fn sign_root() -> SignRoot {
        SignRoot { min: [-2.0, -3.0, -4.0], max: [5.0, 6.0, 7.0], centre: [2.0; 3], radius: 9.5, mask: 5, lod: Some(80.0), render_word: 21, box_w_follows_x: false }
    }

    fn failure<T: std::fmt::Debug>(result: Result<T>) -> String {
        result.expect_err("ожидался отказ").message
    }

    fn real_at(graph: &Graph, block: usize, at: usize) -> f32 {
        Cursor::on(graph, block).real(at).expect("число")
    }

    fn is_retired(graph: &Graph, block: usize) -> bool {
        graph.content(block).iter().all(|&byte| byte == 0) && graph.blocks[block].slots.is_empty()
    }

    // ---------- чтения ----------

    #[test]
    fn dictionary_is_read_back() {
        let graph = dictionary(&[(0xa1a1_a1a1, "alpha", 1.5), (0xb2b2_b2b2, "beta", -5.0), (0xc3c3_c3c3, "gamma", 1.5)]);
        assert_eq!(shape(&graph).unwrap(), Shape { drawables: 3, models: 3, geometries: 3, vertices: 12, indices: 18 });
        assert_eq!(tile_bounds(&graph).unwrap(), Some([0.0, 0.0, 16.0, 24.0]));
        assert_eq!(lod_mismatch(&graph).unwrap(), None);
        assert_eq!(land_drawable(&graph).unwrap(), Some(2));
        let water: Vec<bool> = (0..3).map(|i| drawable_has_water(&graph, drawable_at(&graph, i).unwrap()).unwrap()).collect();
        assert_eq!(water, [false, true, false]);
        assert_eq!(dictionary_index_of_hash(&graph, 0xb2b2_b2b2).unwrap(), Some(1));
        assert_eq!(dictionary_index_of_hash(&graph, 0x0bad_f00d).unwrap(), None);
        assert_eq!(failure(drawable_at(&graph, 3)), "писатель: нет рисовалки с таким номером");

        let d = drawable_at(&graph, 0).unwrap();
        assert_eq!(template_layout_of(&graph, d).unwrap(), Some((16, 12)));
        assert_eq!((template_shader(&graph, d).unwrap(), shader_count(&graph, d).unwrap()), (0, 1));
        assert_eq!(shader_buckets(&graph, d).unwrap(), Some(vec![0]));
        assert_eq!((has_skeleton(&graph, d), has_lower_levels(&graph, d).unwrap()), (false, false));
        assert_eq!(last_high_geometries(&graph, d).unwrap(), [GeometryData { vertices: lattice(100, 1.5), indices: FAN.to_vec(), shader: 0 }]);
        assert_eq!(high_geometry_templates(&graph, d).unwrap(), HashMap::from([(0, first_geometry(&graph, d))]));
        let (stride, layout) = geometry_layout(&graph, first_geometry(&graph, d)).unwrap();
        assert_eq!((stride, layout.get(COLOUR0).map(|c| c.offset)), (16, Some(12)));
    }

    #[test]
    fn empty_and_rootless_graphs_read_as_empty() {
        let empty = resource_graph::from_parts(165, 0, 0, Vec::new(), Vec::new());
        assert_eq!(shape(&empty).unwrap(), Shape { drawables: 0, models: 0, geometries: 0, vertices: 0, indices: 0 });
        assert_eq!((tile_bounds(&empty).unwrap(), land_drawable(&empty).unwrap(), dictionary_index_of_hash(&empty, 1).unwrap()), (None, None, None));
        assert_eq!(failure(drawable_at(&empty, 0)), "писатель: словарь без корня");
        assert_eq!(canonical(&empty), "");
        assert_eq!(finish(&empty).unwrap().len(), 18);
        assert_eq!(failure(finish_compact(&empty)), "Корень вне блоков.");
    }

    #[test]
    fn missing_pointers_give_the_documented_errors() {
        let (graph, d) = single();
        let head = Cursor::on(&graph, d).follow(Draw::High).unwrap().block;

        let mut no_entries = graph.clone();
        no_entries.blocks[head].slots.clear();
        assert_eq!(failure(shape(&no_entries)), "писатель: список моделей без записей");
        assert!(!has_lower_levels(&no_entries, d).unwrap());
        assert_eq!(failure(append_high_model(&mut no_entries.clone(), d, &[fan(0)])), "писатель: список High без записей");

        let mut no_high = graph.clone();
        no_high.blocks[d].slots.retain(|slot| slot.relative != Draw::High.spot());
        assert_eq!(shape(&no_high).unwrap().models, 0);
        assert_eq!(failure(append_high_model(&mut no_high, d, &[fan(0)])), "писатель: рисовалка без списка High");

        // Указатель на адрес вне блоков — как будто его нет; на настоящий блок — есть.
        let mut skeleton = graph;
        skeleton.blocks[d].slots.push(Slot { relative: Draw::Skeleton.spot(), target: Address { segment: Sys, offset: 0x9999 } });
        assert!(!has_skeleton(&skeleton, d));
        let live = skeleton.blocks[d].slots.iter().find(|s| s.relative == Draw::High.spot()).unwrap().target;
        skeleton.blocks[d].slots.last_mut().unwrap().target = live;
        assert!(has_skeleton(&skeleton, d));
    }

    #[test]
    fn water_check_ignores_what_lies_past_the_stream_when_the_stride_is_short() {
        let mut arena = arena_with_root();
        let geometry = lay_geometry(&mut arena, &[0u8; 48], &[0, 1, 2]);
        let model = lay_model(&mut arena, geometry, 0);
        let drawable = lay_drawable(&mut arena, &[model], "short");
        let mut graph = seal(arena, &[1], &[drawable]);
        let d = drawable_at(&graph, 0).unwrap();
        // Шаг буфера 12 при декларации на 16: цвет последней вершины лежит за потоком.
        let buffer = Cursor::on(&graph, first_geometry(&graph, d)).follow(Geo::VertexBuffer).unwrap().block;
        resource_graph::write_at(&mut graph, buffer, 8, &12u16.to_le_bytes()).unwrap();
        resource_graph::write_at(&mut graph, buffer, 0x18, &4u32.to_le_bytes()).unwrap();
        assert!(!drawable_has_water(&graph, d).unwrap());
        assert_eq!(tile_bounds(&graph).unwrap(), Some([0.0, 0.0, 0.0, 0.0]));
        assert_eq!(land_drawable(&graph).unwrap(), None);
    }

    // ---------- дописывание ----------

    #[test]
    fn append_then_refresh_updates_counts_and_box() {
        let (mut graph, d) = single();
        let blocks = graph.blocks.len();
        let old_head = Cursor::on(&graph, d).follow(Draw::High).unwrap().block;
        append_high_model(&mut graph, d, &[fan(0)]).unwrap();
        assert_eq!(graph.blocks.len(), blocks + 12);
        assert!(is_retired(&graph, old_head));

        refresh_drawable(&mut graph, d).unwrap();
        assert_eq!(shape(&graph).unwrap(), Shape { drawables: 1, models: 2, geometries: 2, vertices: 8, indices: 12 });
        assert_eq!(lod_mismatch(&graph).unwrap(), None);
        let bytes = graph.content(d);
        assert_eq!((bytes[0x80], bytes[0x9a]), (2, 0x22));
        let corners = [(0x30, [-3.0, -4.0, -5.0]), (0x40, [21.0, 30.0, 2.0]), (0x20, [9.0, 13.0, -1.5])];
        for (at, expected) in corners {
            assert_eq!(Cursor::on(&graph, d).reals::<3>(at).unwrap(), expected);
        }
        assert!((real_at(&graph, d, 0x2c) - 21.101).abs() < 2e-3);
        let appended = last_high_geometries(&graph, d).unwrap();
        assert_eq!(appended, [GeometryData { vertices: lattice(150, 2.0), indices: FAN.to_vec(), shader: 0 }]);

        for bytes in [finish(&graph).unwrap(), finish_compact(&graph).unwrap()] {
            let again = graph_of(&bytes).unwrap();
            assert_eq!(shape(&again).unwrap(), shape(&graph).unwrap());
            assert_eq!(last_high_geometries(&again, drawable_at(&again, 0).unwrap()).unwrap(), appended);
        }
    }

    #[test]
    fn the_fourth_number_of_a_box_is_fixed_or_follows_x() {
        let one = [fan(0)];
        let floats = |bytes: Vec<u8>| -> Vec<f32> { bytes.chunks_exact(4).map(|word| f32::from_le_bytes(word.try_into().unwrap())).collect() };
        assert_eq!(floats(bounds_bytes(&one, BoxW::Fixed([0.5, 0.25]))), [-3.0, -4.0, -5.0, 0.5, 21.0, 30.0, 2.0, 0.25]);
        assert_eq!(floats(bounds_bytes(&one, BoxW::FollowsX)), [-3.0, -4.0, -5.0, -3.0, 21.0, 30.0, 2.0, 21.0]);
        // Несколько геометрий: сводная запись берёт минимумы и максимумы вместе с w, то есть минимум x и максимум x.
        let two = [fan(0), NewGeometry { min: [-9.0, 0.0, 0.0], max: [4.0, 1.0, 1.0], ..fan(1) }];
        let all = floats(bounds_bytes(&two, BoxW::FollowsX));
        assert_eq!(all[..8], [-9.0, -4.0, -5.0, -9.0, 21.0, 30.0, 2.0, 21.0], "сводная запись");
        assert_eq!(all[16..24], [-9.0, 0.0, 0.0, -9.0, 4.0, 1.0, 1.0, 4.0], "вторая геометрия");
    }

    #[test]
    fn append_takes_bounds_w_from_the_sample_and_joins_several_geometries() {
        let (mut graph, d) = single();
        let first = NewGeometry { min: [0.0, 1.0, 2.0], max: [3.0, 4.0, 5.0], ..fan(0) };
        let second = NewGeometry { vertices: lattice(10, 0.0)[..48].to_vec(), indices: vec![0, 1, 2], shader: 1, min: [-9.0, -8.0, -7.0], max: [9.0, 8.0, 7.0] };
        append_high_model(&mut graph, d, &[first, second]).unwrap();
        let model = Cursor::on(&graph, d).level_stops(0).unwrap()[1].model;
        assert_eq!(model.bytes()[0x10..0x14], [2, 0, 2, 0]);
        let bounds = model.follow(Model::Bounds).unwrap();
        // Сводная запись, затем по записи на геометрию; w у всех — из образца (5 и 11).
        let records: Vec<[f32; 8]> = (0..3).map(|i| bounds.reals::<8>(BOX_LEN * i).unwrap()).collect();
        assert_eq!(records[0], [-9.0, -8.0, -7.0, 5.0, 9.0, 8.0, 7.0, 11.0]);
        assert_eq!(records[1], [0.0, 1.0, 2.0, 5.0, 3.0, 4.0, 5.0, 11.0]);
        assert_eq!(records[2][..4], [-9.0, -8.0, -7.0, 5.0]);
        assert_eq!(model.follow(Model::Shaders).unwrap().bytes()[..4], [0, 0, 1, 0]);
    }

    #[test]
    fn append_refuses_bad_geometries() {
        let cases: Vec<(NewGeometry, &str)> = vec![
            (NewGeometry { vertices: vec![0; 47], ..fan(0) }, "писатель: вершины не делятся на шаг образца"),
            (NewGeometry { vertices: Vec::new(), indices: Vec::new(), ..fan(0) }, "писатель: геометрия с неверным числом вершин или индексов"),
            (NewGeometry { indices: vec![0, 1], ..fan(0) }, "писатель: геометрия с неверным числом вершин или индексов"),
            (NewGeometry { indices: vec![0, 1, 4], ..fan(0) }, "писатель: индекс вне вершин геометрии"),
            (NewGeometry { vertices: vec![0; 16 * 65_536], indices: vec![0, 1, 2], ..fan(0) }, "писатель: геометрия с неверным числом вершин или индексов"),
        ];
        for (bad, text) in cases {
            let (mut graph, d) = single();
            let (blocks, system) = (graph.blocks.len(), graph.system.clone());
            assert_eq!(failure(append_high_model(&mut graph, d, &[bad])), text);
            assert_eq!((graph.blocks.len(), graph.system == system), (blocks, true));
        }
        let (mut graph, d) = single();
        assert_eq!(failure(append_high_model(&mut graph, d, &[])), "писатель: модель без геометрий");
        // Вторая геометрия плохая: граф остаётся как был, блоки первой не дописываются.
        let (blocks, system, graphics) = (graph.blocks.len(), graph.system.clone(), graph.graphics.clone());
        let bad_second = NewGeometry { indices: vec![0, 1, 9], ..fan(0) };
        assert_eq!(failure(append_high_model(&mut graph, d, &[fan(0), bad_second])), "писатель: индекс вне вершин геометрии");
        assert_eq!((graph.blocks.len(), graph.system == system, graph.graphics == graphics), (blocks, true, true));
    }

    #[test]
    fn geometry_without_indices_is_refused_before_it_breaks_the_file() {
        let (mut graph, d) = single();
        let (blocks, system) = (graph.blocks.len(), graph.system.clone());
        let bare = NewGeometry { indices: Vec::new(), ..fan(0) };
        let text = "писатель: геометрия с неверным числом вершин или индексов";
        assert_eq!(failure(append_high_model(&mut graph, d, std::slice::from_ref(&bare))), text);
        assert_eq!(failure(replace_high_model(&mut graph, d, std::slice::from_ref(&bare), &sign_root())), text);
        assert_eq!((graph.blocks.len(), graph.system == system), (blocks, true));
        assert!(finish(&graph).is_ok());
    }

    #[test]
    fn refresh_never_shrinks_the_box_and_caps_the_models() {
        let (mut graph, d) = single();
        resource_graph::write_at(&mut graph, d, 0x30, &le_floats(&[100.0; 3])).unwrap();
        resource_graph::write_at(&mut graph, d, 0x40, &le_floats(&[200.0; 3])).unwrap();
        refresh_drawable(&mut graph, d).unwrap();
        assert_eq!([real_at(&graph, d, 0x30), real_at(&graph, d, 0x40)], [0.0, 200.0]);

        for (crowd, accepted) in [(15, true), (16, false)] {
            let mut arena = arena_with_root();
            let geometry = lay_geometry(&mut arena, &lattice(100, 0.0), &FAN);
            let model = lay_model(&mut arena, geometry, 0);
            let drawable = lay_drawable(&mut arena, &vec![model; crowd], "crowd");
            let mut graph = seal(arena, &[1], &[drawable]);
            let d = drawable_at(&graph, 0).unwrap();
            let outcome = refresh_drawable(&mut graph, d);
            assert_eq!(outcome.is_ok(), accepted, "{outcome:?}");
            match outcome {
                Ok(()) => assert_eq!((graph.content(d)[0x80], graph.content(d)[0x9a] >> 4), (15, 15)),
                Err(refusal) => assert_eq!(refusal.message, "писатель: больше 15 моделей High в рисовалке"),
            }
        }
    }

    // ---------- замена ----------

    fn replacement() -> NewGeometry {
        NewGeometry { vertices: lattice(30, 0.5), indices: vec![0, 1, 2], shader: 0, min: [1.0, 2.0, 3.0], max: [4.0, 5.0, 6.0] }
    }

    #[test]
    fn replace_swaps_the_list_and_writes_the_root() {
        let (mut graph, d) = single();
        let (blocks, old_model) = (graph.blocks.len(), first_model(&graph, d));
        replace_high_model(&mut graph, d, &[replacement()], &sign_root()).unwrap();
        assert_eq!(graph.blocks.len(), blocks + 12);
        assert!(is_retired(&graph, old_model));

        let bytes = graph.content(d);
        assert_eq!(bytes[..4], XML.drawable.to_le_bytes());
        assert_eq!((bytes[0x80], bytes[0x9a], bytes[0x9b]), (5, 21, 0));
        assert_eq!(real_at(&graph, d, 0x2c), 9.5);
        assert_eq!(bytes[0x70..0x80], le_floats(&[80.0; 4])[..]);
        assert_eq!(shape(&graph).unwrap(), Shape { drawables: 1, models: 1, geometries: 1, vertices: 4, indices: 3 });
        // В байте +0x80 теперь маска, поэтому осмотр жалуется на расхождение.
        assert_eq!(lod_mismatch(&graph).unwrap().as_deref(), Some("рисовалка 0, уровень high: флаг 5, моделей 1"));

        assert_eq!(graph.content(first_model(&graph, d))[..4], XML.model.to_le_bytes());
        assert_eq!(graph.content(first_geometry(&graph, d))[..4], XML.geometry.to_le_bytes());
        let wrote = [GeometryData { vertices: lattice(30, 0.5), indices: vec![0, 1, 2], shader: 0 }];
        assert_eq!(last_high_geometries(&graph, d).unwrap(), wrote);

        let compact = graph_of(&finish_compact(&graph).unwrap()).unwrap();
        let full = graph_of(&finish(&graph).unwrap()).unwrap();
        assert!(compact.blocks.len() < full.blocks.len());
        assert_eq!(last_high_geometries(&compact, drawable_at(&compact, 0).unwrap()).unwrap(), wrote);
    }

    #[test]
    fn replace_follows_the_skinning_rules() {
        let cases = [([4u8, 0, 0, 0, 3, 8], [0u8, 0, 0, 0, 0xff, 0, 1, 0]), ([4, 1, 5, 6, 3, 8], [4, 1, 5, 6, 0xff, 8, 1, 0])];
        for (tail, expected) in cases {
            let (mut graph, d) = single();
            let model = first_model(&graph, d);
            resource_graph::write_at(&mut graph, model, 0x28, &tail).unwrap();
            replace_high_model(&mut graph, d, &[replacement()], &sign_root()).unwrap();
            assert_eq!(graph.content(first_model(&graph, d))[0x28..0x30], expected);
        }
        // Триста геометрий: число целиком, и в старшем байте второй копии тоже.
        let (mut graph, d) = single();
        replace_high_model(&mut graph, d, &vec![replacement(); 300], &sign_root()).unwrap();
        let model = first_model(&graph, d);
        assert_eq!(graph.content(model)[0x10..0x12], 300u16.to_le_bytes());
        assert_eq!(graph.content(model)[0x2c..0x30], [0xff, 0, 0x2c, 1]);
    }

    #[test]
    fn replace_picks_samples_by_layout() {
        let (mut graph, d) = single();
        let (blocks, system) = (graph.blocks.len(), graph.system.clone());
        let refusals: [(u16, Option<&[u16]>, &str); 3] = [
            (7, None, "писатель: нет образца геометрии для шейдера"),
            (0, Some(&[9]), "писатель: нет образца геометрии для шейдера"),
            (0, Some(&[]), "писатель: по одному образцу раскладки на сетку"),
        ];
        for (shader, layouts, text) in refusals {
            let outcome = replace_high_model_layouts(&mut graph, d, &[NewGeometry { shader, ..replacement() }], layouts, &sign_root());
            assert_eq!(failure(outcome), text);
            assert_eq!((graph.blocks.len(), graph.system == system), (blocks, true));
        }
        // Раскладка берётся по своему номеру, а в список модели идёт номер геометрии.
        replace_high_model_layouts(&mut graph, d, &[NewGeometry { shader: 5, ..replacement() }], Some(&[0]), &sign_root()).unwrap();
        assert_eq!(last_high_geometries(&graph, d).unwrap()[0].shader, 5);
        // Длина списка раскладок проверяется раньше пустоты.
        assert_eq!(failure(replace_high_model_layouts(&mut graph, d, &[], Some(&[0]), &sign_root())), "писатель: по одному образцу раскладки на сетку");
        assert_eq!(failure(replace_high_model_layouts(&mut graph, d, &[], None, &sign_root())), "писатель: модель без геометрий");
    }

    #[test]
    fn replace_into_a_short_drawable_leaves_the_graph_as_it_was() {
        let (mut graph, d) = single();
        // Блок рисовалки короче 0x9c: корень не запишется, и всё перенаведённое откатывается.
        graph.blocks[d].end = graph.blocks[d].start + 0x90;
        let (blocks, system, graphics) = (graph.blocks.len(), graph.system.clone(), graph.graphics.clone());
        let head = graph.blocks[d].slots.clone();
        assert_eq!(failure(replace_high_model(&mut graph, d, &[replacement()], &sign_root())), "Запись за пределами блока.");
        assert_eq!((graph.blocks.len(), graph.system == system, graph.graphics == graphics), (blocks, true, true));
        assert_eq!(graph.blocks[d].slots, head);
        assert_ne!(graph.content(d)[..4], XML.drawable.to_le_bytes());
    }

    // ---------- сборка, запись, числа ----------

    #[test]
    fn canonical_text_marks_pointers_and_strings() {
        let mut arena = Arena::default();
        let root = lay(&mut arena, Sys, 0x20, vec![(0, To(Sys, 0x20))]);
        let text = lay(&mut arena, Sys, 16, vec![(0, Raw(b"abcdefghij012345".to_vec())), (8, To(Sys, root))]);
        assert_eq!((root, text), (0, 0x20));
        let graph = arena.into_graph();
        let plain = "#0 System len 0 [] [+0x0->#1+0x0]\n#1 System len 8 [61, 62, 63, 64, 65, 66, 67, 68] [+0x8->#0+0x0]\n";
        assert_eq!(canonical(&graph), plain);
        assert_eq!(canonical_with(&graph, true), plain);
        assert_eq!(canonical_with(&graph, false).lines().nth(1).unwrap(), "#1 System len 8 [3c, 73, 74, 72, 69, 6e, 67, 3e] [+0x8->#0+0x0]");
    }

    #[test]
    fn float_value_follows_the_host_rounding() {
        let cases: [(f32, &str); 14] = [
            (26.705_635, "26.705635"),
            (0.1, "0.1"),
            (1.0, "1.0"),
            (-0.0, "-0.0"),
            (1.5e-5, "0.000015"),
            (16_777_217.0, "16777216.0"),
            (1e20, "1e+20"),
            (f32::MAX, "3.4028235e+38"),
            (f32::from_bits(1_192_112_080), "36399.812"),
            (-6658.531_25, "-6658.5312"),
            (f32::from_bits(0x3980_0000), "0.00024414062"),
            (f32::from_bits(0x0f80_0000), "1.2621775e-29"),
            (f32::MIN_POSITIVE, "1.1754944e-38"),
            (1e-45, "1e-45"),
        ];
        for (value, shown) in cases {
            assert_eq!(float_value(value).to_string(), shown, "{value:e}");
        }
        for odd in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert_eq!(float_value(odd), Value::Null);
        }
        assert!(float_value(1.0).is_f64());
    }

    #[test]
    fn sign_render_word_matches_the_table() {
        let table = [(0, 18), (1, 18), (2, 33), (3, 46), (4, 58), (7, 96), (8, 108), (70, 891), (100, 1270), (256, 3239), (5190, 65_531)];
        for (count, word) in table {
            assert_eq!(sign_render_word(count), word, "n = {count}");
        }
    }

    #[test]
    fn sign_render_word_stops_at_the_largest_word() {
        assert_eq!(sign_render_word(5191), u16::MAX);
        for count in [5200, 6000, 100_000, usize::MAX / 101 + 1, usize::MAX] {
            assert_eq!(sign_render_word(count), u16::MAX, "n = {count}");
        }
    }

    #[test]
    fn drawable_at_refuses_an_index_whose_offset_does_not_fit() {
        let (graph, _) = single();
        for index in [usize::MAX / 8 + 1, usize::MAX] {
            assert_eq!(failure(drawable_at(&graph, index)), "писатель: нет рисовалки с таким номером", "{index}");
        }
    }

    #[test]
    fn graph_of_refuses_broken_files() {
        let broken: [(Vec<u8>, &str); 3] =
            [(Vec::new(), "Ресурс короче заголовка RSC7."), (vec![0; 15], "Ресурс короче заголовка RSC7."), (vec![0; 16], "Файл не является ресурсом RSC7.")];
        for (bytes, text) in broken {
            assert_eq!(failure(graph_of(&bytes)), text);
        }
        let (graph, _) = single();
        let file = finish(&graph).unwrap();
        assert_eq!(failure(graph_of(&file[..16])), "Поток ресурса пуст или не распакован.");
        assert_eq!(failure(graph_of(&file[..file.len() / 2])), "Ресурс короче заявленного: разбирать нечего.");
        let again = graph_of(&file).unwrap();
        assert_eq!((again.system.len(), again.graphics.len()), (8192, 8192));
    }

    #[test]
    fn inspection_lists_documented_keys_in_order() {
        let graph = dictionary(&[(joaat("alpha"), "alpha", 1.5), (0x2222_2222, "beta", -5.0)]);
        let report = tile_inspection(&graph, "minimap_3_5.ydd", 1234).unwrap();
        let keys = |value: &Value| value.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>().join(",");
        assert_eq!(keys(&report), "file,bytes,box,shape,lodMismatch,drawables");
        assert_eq!(report["shape"], "d2/m2/g2/v8/i12");
        assert_eq!(report["box"], serde_json::json!([0.0, 0.0, 16.0, 24.0]));
        let drawable = &report["drawables"][0];
        assert_eq!(keys(drawable), "index,hash,name,water,flags,renderMask,lodDist,bounds,shaders,models");
        assert_eq!(keys(&drawable["flags"]), "high,med,low,vlow");
        assert_eq!(keys(&drawable["bounds"]), "min,max,center,radius");
        assert_eq!(keys(&drawable["shaders"][0]), "name,file,bucket,bucketMask");
        assert_eq!(drawable["shaders"][0]["name"], joaat("default").to_string());
        let model = &drawable["models"][0];
        assert_eq!(keys(model), "level,at,renderMaskFlags,renderMask,flags,skeletonBinding,shaderMapping,boundsData,geometries");
        let geometry = &model["geometries"][0];
        assert_eq!(keys(geometry), "shaderId,vertices,indices,stride,vft,bufferFlags,declaration,twoBuffers,aabb,xy,z,colours");
        assert_eq!(keys(&geometry["declaration"]), "flags,types,stride,count");
        assert_eq!(geometry["declaration"]["types"], "0000000000090006");
        assert_eq!(geometry["z"], serde_json::json!([0.0, 1.5]));
        assert_eq!(geometry["colours"][0]["rgba"], "646464FF");
        let hash = format!("{:08X}", joaat("alpha"));
        assert_eq!((drawable["name"].as_str(), drawable["hash"].as_str()), (Some("alpha"), Some(hash.as_str())));
        let second = &report["drawables"][1];
        assert_eq!((second["hash"].as_str(), second["name"].as_str(), second["water"].as_bool()), (Some("22222222"), Some("hash_22222222"), Some(true)));
        assert_eq!(second["models"][0]["geometries"][0]["z"], serde_json::json!([-5.0, 0.0]));
    }

    // ---------- сверка с хостом (нужны файлы, поэтому с #[ignore]) ----------

    fn env_path(name: &str) -> String {
        std::env::var(name).expect(name)
    }

    fn env_bytes(name: &str) -> Vec<u8> {
        std::fs::read(env_path(name)).expect("файл")
    }

    /// Файлы `.ydd` каталога по порядку путей.
    fn ydd_files(dir: &Path) -> BTreeSet<PathBuf> {
        std::fs::read_dir(dir).expect("каталог").flatten().map(|entry| entry.path()).filter(|path| path.extension().is_some_and(|ext| ext == "ydd")).collect()
    }

    /// Вершины прямоугольных треугольников: у каждого вершина-угол `origin`, катеты длиной `leg` вдоль x и y.
    fn corner_triangles(parts: &[([f32; 3], f32, [u8; 4])]) -> Vec<u8> {
        parts
            .iter()
            .flat_map(|&(origin, leg, rgba)| {
                [[0.0, 0.0], [leg, 0.0], [0.0, leg]].into_iter().flat_map(move |[dx, dy]| le_floats(&[origin[0] + dx, origin[1] + dy, origin[2]]).into_iter().chain(rgba))
            })
            .collect()
    }

    /// Каноническая запись для сверки: число страниц в карте корня и тип вершин у хоста приводятся к общему.
    fn normalized(mut graph: Graph, from_host: bool) -> String {
        let map = graph.root().and_then(|root| resource_graph::pointer_from(&graph, root, 8)).and_then(|at| graph.block_at(at));
        let mut patches: Vec<(Segment, usize, u8)> = map.map(|block| (graph.blocks[block].segment, graph.blocks[block].start + 8, 0)).into_iter().collect();
        if from_host {
            let typed = |block: &usize| graph.content(*block).len() >= 49 && graph.content(*block)[..4] == [0xf0, 0x17, 0x61, 0x40];
            patches.extend((0..graph.blocks.len()).filter(typed).map(|block| (graph.blocks[block].segment, graph.blocks[block].start + 0x30, 8)));
        }
        for (segment, at, value) in patches {
            match segment {
                Sys => graph.system[at] = value,
                Gfx => graph.graphics[at] = value,
            }
        }
        canonical_with(&graph, false)
    }

    /// Номер первой строки, на которой тексты расходятся.
    fn diverge(a: &str, b: &str) -> Option<usize> {
        a.lines().zip(b.lines()).enumerate().find(|(_, (x, y))| x != y).map(|(line, _)| line)
    }

    fn clip(text: &str, line: Option<usize>) -> String {
        text.lines().nth(line.unwrap_or(0)).unwrap_or("").chars().take(400).collect()
    }

    /// Геометрия из треугольников `corner_triangles`: номера вершин подряд, рамка по самим вершинам.
    fn fitted(parts: &[([f32; 3], f32, [u8; 4])]) -> NewGeometry {
        let vertices = corner_triangles(parts);
        let points: Vec<[f32; 3]> = vertices
            .chunks_exact(16)
            .map(|vertex| {
                let mut at = [0.0; 3];
                for (value, bytes) in at.iter_mut().zip(vertex.chunks_exact(4)) {
                    *value = f32::from_le_bytes(bytes.try_into().expect("четыре байта"));
                }
                at
            })
            .collect();
        let extreme = |pick: fn(f32, f32) -> f32, start: f32| -> [f32; 3] { std::array::from_fn(|axis| points.iter().map(|p| p[axis]).fold(start, pick)) };
        NewGeometry { indices: (0..points.len() as u16).collect(), shader: 0, min: extreme(f32::min, f32::INFINITY), max: extreme(f32::max, f32::NEG_INFINITY), vertices }
    }

    /// Пара плиток для сверки с хостом: исходная и плитка хоста; пути берутся из переменных окружения.
    struct HostCase {
        orig: Vec<u8>,
        host: Vec<u8>,
    }

    impl HostCase {
        fn from_env(orig: &str, host: &str) -> Self {
            HostCase { orig: env_bytes(orig), host: env_bytes(host) }
        }

        /// Дописывает геометрию в рисовалку 10 исходной плитки и собирает файл.
        fn rebuild(&self, geometry: NewGeometry) -> Vec<u8> {
            let mut graph = graph_of(&self.orig).expect("исходная плитка");
            let drawable = drawable_at(&graph, 10).expect("рисовалка");
            append_high_model(&mut graph, drawable, &[geometry]).and_then(|()| refresh_drawable(&mut graph, drawable)).and_then(|()| finish(&graph)).expect("запись плитки")
        }

        /// Сравнивает каноническую запись перечитанного файла с плиткой хоста; расхождение — паника.
        fn verify(&self, ours: &[u8]) {
            let mine = normalized(graph_of(ours).expect("перечитывание"), false);
            let theirs = normalized(graph_of(&self.host).expect("плитка хоста"), true);
            if mine != theirs {
                let line = diverge(&mine, &theirs);
                println!("первая различающаяся строка {line:?}");
                println!("ours {}", clip(&mine, line));
                println!("host {}", clip(&theirs, line));
                panic!("канонический вид расходится с хостом");
            }
            println!("ours {} bytes, host {} bytes, original {} bytes", ours.len(), self.host.len(), self.orig.len());
        }

        fn check(&self, geometry: NewGeometry) -> Vec<u8> {
            let ours = self.rebuild(geometry);
            self.verify(&ours);
            ours
        }
    }

    fn land_geometry() -> NewGeometry {
        let (land, built) = ([200, 60, 20, 255], [30, 160, 40, 255]);
        fitted(&[([0.0, 0.0, 0.0], 40.0, land), ([10.0, 10.0, 0.0], 40.0, land), ([-300.0, -300.0, 6.0], 40.0, built)])
    }

    #[test]
    #[ignore = "зонд: нужен YDD_PROBE_DIR с каталогом .ydd"]
    fn probe_levels_dir() {
        for path in ydd_files(Path::new(&env_path("YDD_PROBE_DIR"))) {
            let graph = graph_of(&std::fs::read(&path).expect("файл")).expect("плитка");
            let name = path.file_name().expect("имя").to_string_lossy().into_owned();
            let mut index = 0;
            while let Ok(drawable) = drawable_at(&graph, index) {
                let cursor = Cursor::on(&graph, drawable);
                let [high, med, low, vlow] = LEVELS.map(|(level, _)| cursor.follow(level).map_or(0, |list| list.count(List::Count).expect("число")));
                let bytes = cursor.bytes();
                println!("{name} drawable {index}: high={high} med={med} low={low} vlow={vlow} flags {:02x?} mask9a {:02x}", &bytes[0x80..0x84], bytes[0x9a]);
                index += 1;
            }
        }
    }

    #[test]
    #[ignore = "зонд: нужен YDD_CANON с путём к .ydd"]
    fn print_canonical() {
        print!("{}", canonical(&graph_of(&env_bytes("YDD_CANON")).expect("плитка")));
    }

    #[test]
    #[ignore = "сверка с хостом: нужны DRAWABLE_ORIG и DRAWABLE_HOST"]
    fn appended_model_matches_host() {
        HostCase::from_env("DRAWABLE_ORIG", "DRAWABLE_HOST").check(land_geometry());
    }

    #[test]
    #[ignore = "сверка с хостом: нужны DRAWABLE_ORIG_2 и DRAWABLE_HOST_2"]
    fn road_model_matches_host() {
        HostCase::from_env("DRAWABLE_ORIG_2", "DRAWABLE_HOST_2").check(fitted(&[([900.0, 400.0, 12.0], 40.0, [40, 80, 220, 255])]));
    }

    #[test]
    #[ignore = "сверка байтов: нужны DRAWABLE_ORIG и DRAWABLE_HOST"]
    fn unchanged_blocks_keep_their_bytes() {
        let case = HostCase::from_env("DRAWABLE_ORIG", "DRAWABLE_HOST");
        let ours = case.check(land_geometry());
        let (before, after) = (Resource::parse(&case.orig).expect("исходный"), Resource::parse(&ours).expect("записанный"));
        let (a, b) = (before.data(), after.data());
        // Несовпавшие байты исходного тела; различия не дальше 16 байт друг от друга сливаются в один диапазон.
        let differing: Vec<usize> = (0..a.len().min(b.len())).filter(|&at| a[at] != b[at]).collect();
        let mut ranges: Vec<(usize, usize)> = Vec::new();
        for at in differing {
            match ranges.last_mut() {
                Some(last) if at - last.1 <= 16 => last.1 = at,
                _ => ranges.push((at, at)),
            }
        }
        let changed: usize = ranges.iter().map(|(from, to)| to - from + 1).sum();
        let shown: Vec<(String, String)> = ranges.iter().map(|&(from, to)| (format!("{from:#x}"), format!("{to:#x}"))).collect();
        println!("body {} -> {} bytes; differing ranges (start..end, bytes): {shown:?}", a.len(), b.len());
        println!("changed bytes within the original body: {changed} of {}", a.len());
    }

    #[test]
    #[ignore = "сверка каталогов: нужны CANON_HOST_DIR и CANON_RUST_DIR"]
    fn compare_tile_dirs() {
        let (host_dir, rust_dir) = (PathBuf::from(env_path("CANON_HOST_DIR")), PathBuf::from(env_path("CANON_RUST_DIR")));
        let files = ydd_files(&host_dir);
        let mut equal = 0;
        for path in &files {
            let name = path.file_name().expect("имя").to_string_lossy().into_owned();
            let host = normalized(graph_of(&std::fs::read(path).expect("файл хоста")).expect("плитка хоста"), true);
            let ours = normalized(graph_of(&std::fs::read(rust_dir.join(&name)).expect("файл Rust")).expect("плитка Rust"), false);
            match diverge(&ours, &host) {
                None if ours == host => equal += 1,
                line => {
                    println!("DIFF {name}: first differing block line {line:?}");
                    println!("  rust {}", clip(&ours, line));
                    println!("  host {}", clip(&host, line));
                }
            }
        }
        println!("canonical equal: {equal} of {}", files.len());
    }

    #[test]
    fn an_appended_model_keeps_shader_numbers_even_when_the_sample_has_no_pointer_for_them() {
        let (mut graph, d) = single();
        let sample = first_model(&graph, d);
        graph.blocks[sample].slots.retain(|slot| slot.relative != Model::Shaders.spot());
        append_high_model(&mut graph, d, &[fan(3)]).unwrap();
        let last = last_high_geometries(&graph, d).unwrap();
        assert_eq!(last.iter().map(|geometry| geometry.shader).collect::<Vec<_>>(), [3]);
    }

    #[test]
    fn inspection_reads_the_whole_hash_list_before_anything_else() {
        let (mut graph, _) = single();
        let root = graph.root().unwrap();
        // Число хешей больше списка: осмотр отказывает, даже когда рисовалок в словаре нет.
        resource_graph::write_at(&mut graph, root, Dict::HashCount.spot(), &1000u16.to_le_bytes()).unwrap();
        assert_eq!(failure(tile_inspection(&graph, "x.ydr", 1)), "писатель: чтение за блоком");
        resource_graph::write_at(&mut graph, root, Dict::DrawableCount.spot(), &0u16.to_le_bytes()).unwrap();
        assert_eq!(failure(tile_inspection(&graph, "x.ydr", 1)), "писатель: чтение за блоком");
        // Хеши есть у первых count рисовалок, у остальных их нет.
        let (mut graph, _) = single();
        let root = graph.root().unwrap();
        resource_graph::write_at(&mut graph, root, Dict::HashCount.spot(), &0u16.to_le_bytes()).unwrap();
        let shown = tile_inspection(&graph, "x.ydr", 1).unwrap();
        assert_eq!(shown["drawables"][0]["hash"], Value::Null);
    }
}
