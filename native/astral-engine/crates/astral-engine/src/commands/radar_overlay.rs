//! Слои большой карты поверх плиток радара. Окно присылает список цветных
//! треугольников в мировых координатах (файл «ARO1»); игра же рисует радар
//! плитками `minimap_R_C.ydd`, поэтому слои раскладываются по плиткам и
//! дописываются в рисовалку суши каждой плитки отдельной моделью High.
//!
//! Команд в модуле нет: это библиотека для `minimap`. Модуль чистый, диска и
//! времени не трогает.

use std::{
    cmp::Ordering,
    collections::{hash_map::Entry, HashMap},
};

use rage_res::{
    drawable_write::{self, GeometryData, NewGeometry, Shape},
    resource_graph::Graph,
};

use crate::error::{EngineError, Result};

/// Пределы модуля.
mod limit {
    pub const FILE_TRIANGLES: usize = 3_000_000;
    pub const TILE_TRIANGLES: usize = 600_000;
    pub const TILE_BYTES: usize = 48 * 1024 * 1024;
    /// Геометрия закрывается, когда под этот потолок ещё три вершины не влезают.
    pub const GEOMETRY_VERTICES: usize = 65_000;
    /// Дальше этого от любой рамки центр треугольника считается лежащим за краем карты.
    pub const EDGE: f32 = 60.0;
}

/// Чем кончается разбор слоёв, склейка, дописывание и сверка; код у всех — `InvalidDataException`.
#[derive(Debug, PartialEq, Eq)]
enum Fault {
    ShortHeader,
    NotAro,
    Version(u32),
    Dimensions,
    Length { actual: usize, expected: usize },
    NotNumber(usize),
    OffMap(usize),
    IndexOut(usize),
    TooManyLayers(usize),
    TooManyInTile(usize),
    NoLayout,
    ShaderOutside,
    TileBytes(usize),
    Mismatch(String),
}

impl Fault {
    /// Текст отказа, как он уходит в ответ.
    fn words(&self) -> String {
        match self {
            Fault::ShortHeader => "Файл слоёв мини-карты короче заголовка.".to_owned(),
            Fault::NotAro => "Это не файл слоёв мини-карты (нет метки ARO1).".to_owned(),
            Fault::Version(found) => format!("Версия файла слоёв мини-карты {found} неизвестна."),
            Fault::Dimensions => "В файле слоёв мини-карты недопустимые размеры.".to_owned(),
            Fault::Length { actual, expected } => {
                format!("Файл слоёв мини-карты {actual} байт, по заголовку должно быть {expected}.")
            }
            Fault::NotNumber(at) => format!("Вершина {at} слоёв мини-карты — не число."),
            Fault::OffMap(at) => format!("Вершина {at} слоёв мини-карты лежит вне карты."),
            Fault::IndexOut(at) => format!("Индекс {at} слоёв мини-карты вне списка вершин."),
            Fault::TooManyLayers(sum) => format!(
                "Слоёв мини-карты {sum} треугольников — больше предела {}.",
                limit::FILE_TRIANGLES
            ),
            Fault::TooManyInTile(count) => format!(
                "В одну плитку радара ложится {count} треугольников — это больше предела {}.",
                limit::TILE_TRIANGLES
            ),
            Fault::NoLayout => "У образца радара нет раскладки вершин.".to_owned(),
            Fault::ShaderOutside => {
                "У образца радара шейдер вне группы шейдеров рисовалки.".to_owned()
            }
            Fault::TileBytes(len) => format!("Плитка {len} байт, предел {}.", limit::TILE_BYTES),
            Fault::Mismatch(what) => {
                format!("Плитка с дописанными слоями не прошла сверку: {what}.")
            }
        }
    }
}

impl From<Fault> for EngineError {
    fn from(fault: Fault) -> Self {
        EngineError::invalid_data(fault.words())
    }
}

/// Набор слоёв: столбцы вершин и список индексов, каждые три — треугольник.
#[derive(Debug, Clone, Default)]
pub struct Overlay {
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    pub z: Vec<f32>,
    pub rgba: Vec<[u8; 4]>,
    pub index: Vec<u32>,
}

impl Overlay {
    pub fn triangles(&self) -> usize {
        self.index.len() / 3
    }

    fn corner(&self, vertex: u32) -> [f32; 3] {
        let at = vertex as usize;
        [self.x[at], self.y[at], self.z[at]]
    }

    /// Три вершины треугольника с номером `triangle`.
    fn corners_of(&self, triangle: usize) -> [u32; 3] {
        let trio = &self.index[triangle * 3..triangle * 3 + 3];
        [trio[0], trio[1], trio[2]]
    }

    /// Три точки треугольника в мировых координатах.
    fn points_of(&self, triangle: usize) -> [[f32; 3]; 3] {
        self.corners_of(triangle).map(|vertex| self.corner(vertex))
    }

    /// Дописывает набор в конец; его индексы сдвигаются на число вершин, что уже лежат.
    fn absorb(&mut self, part: Overlay) {
        let shift = self.x.len() as u32;
        let Overlay {
            x,
            y,
            z,
            rgba,
            index,
        } = part;
        self.x.extend(x);
        self.y.extend(y);
        self.z.extend(z);
        self.rgba.extend(rgba);
        self.index
            .extend(index.into_iter().map(|vertex| vertex + shift));
    }
}

/// Прямоугольник плитки в мировых координатах.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TileBox {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

impl TileBox {
    pub fn from_bounds(bounds: [f32; 4]) -> Self {
        TileBox {
            min_x: bounds[0],
            min_y: bounds[1],
            max_x: bounds[2],
            max_y: bounds[3],
        }
    }
}

/// Рамка как пара отрезков по осям `x` и `y`: проверки считаются одним проходом по осям.
#[derive(Clone, Copy)]
struct Extent([(f32, f32); 2]);

impl Extent {
    fn of(tile: &TileBox) -> Self {
        Extent([(tile.min_x, tile.max_x), (tile.min_y, tile.max_y)])
    }

    /// Рамка трёх точек.
    fn around(points: &[[f32; 3]; 3]) -> Self {
        Extent([0, 1].map(|axis| {
            let along = || points.iter().map(move |point| point[axis]);
            (
                along().fold(f32::INFINITY, f32::min),
                along().fold(f32::NEG_INFINITY, f32::max),
            )
        }))
    }

    fn area(&self) -> f32 {
        self.0.iter().map(|&(low, high)| high - low).product()
    }

    fn holds(&self, at: [f32; 2]) -> bool {
        self.0
            .iter()
            .zip(at)
            .all(|(&(low, high), value)| (low..=high).contains(&value))
    }

    /// Расстояние от точки до прямоугольника; у точки внутри — ноль.
    fn gap_to(&self, at: [f32; 2]) -> f32 {
        let offsets = self
            .0
            .iter()
            .zip(at)
            .map(|(&(low, high), value)| (low - value).max(value - high).max(0.0));
        offsets.map(|off| off * off).sum::<f32>().sqrt()
    }

    fn covers(&self, inner: &Extent) -> bool {
        let mut pairs = self.0.iter().zip(&inner.0);
        pairs.all(|(&(low, high), &(from, to))| low <= from && to <= high)
    }

    fn meets(&self, other: &Extent) -> bool {
        let mut pairs = self.0.iter().zip(&other.0);
        pairs.all(|(&(low, high), &(from, to))| from <= high && low <= to)
    }
}

fn word(bytes: &[u8], from: usize) -> u32 {
    let mut raw = [0u8; 4];
    raw.copy_from_slice(&bytes[from..from + 4]);
    u32::from_le_bytes(raw)
}

/// Одна вершина файла слоёв после проверки.
struct Vertex {
    at: [f32; 3],
    rgba: [u8; 4],
}

impl Vertex {
    fn parse(number: usize, record: &[u8]) -> std::result::Result<Self, Fault> {
        let at = [0, 4, 8].map(|from| f32::from_bits(word(record, from)));
        at.iter()
            .all(|value| value.is_finite())
            .then_some(())
            .ok_or(Fault::NotNumber(number))?;
        let on_map = at[0].abs() <= 20_000.0 && at[1].abs() <= 20_000.0 && at[2].abs() <= 100.0;
        on_map.then_some(()).ok_or(Fault::OffMap(number))?;
        Ok(Vertex {
            at,
            rgba: [record[12], record[13], record[14], record[15]],
        })
    }
}

/// Заголовок «ARO1»: метка, версия, число вершин и индексов; длина файла сверена.
fn header(bytes: &[u8]) -> std::result::Result<(usize, usize), Fault> {
    let head = bytes.get(..16).ok_or(Fault::ShortHeader)?;
    (head[..4] == *b"ARO1").then_some(()).ok_or(Fault::NotAro)?;
    let [version, vertices, indices] = [4, 8, 12].map(|from| word(head, from));
    (version == 1)
        .then_some(())
        .ok_or(Fault::Version(version))?;
    let (vertices, indices) = (vertices as usize, indices as usize);
    let sane = vertices <= 6_000_000 && indices <= limit::FILE_TRIANGLES * 3 && indices % 3 == 0;
    sane.then_some(()).ok_or(Fault::Dimensions)?;
    let expected = 16 + vertices * 16 + indices * 4;
    (bytes.len() == expected)
        .then_some((vertices, indices))
        .ok_or(Fault::Length {
            actual: bytes.len(),
            expected,
        })
}

pub fn read_overlay(bytes: &[u8]) -> Result<Overlay> {
    let (count, _) = header(bytes)?;
    let (vertex_bytes, index_bytes) = bytes[16..].split_at(count * 16);
    let mut layer = Overlay {
        x: Vec::with_capacity(count),
        y: Vec::with_capacity(count),
        z: Vec::with_capacity(count),
        rgba: Vec::with_capacity(count),
        index: Vec::new(),
    };
    for (number, record) in vertex_bytes.chunks_exact(16).enumerate() {
        let Vertex {
            at: [x, y, z],
            rgba,
        } = Vertex::parse(number, record)?;
        layer.x.push(x);
        layer.y.push(y);
        layer.z.push(z);
        layer.rgba.push(rgba);
    }
    layer.index = index_bytes
        .chunks_exact(4)
        .map(|raw| word(raw, 0))
        .collect();
    match layer.index.iter().position(|&v| v as usize >= count) {
        Some(position) => Err(Fault::IndexOut(position).into()),
        None => Ok(layer),
    }
}

pub fn merge(parts: Vec<Overlay>) -> Result<Overlay> {
    match parts.len() {
        0 | 1 => Ok(parts.into_iter().next().unwrap_or_default()),
        _ => {
            let sum: usize = parts.iter().map(Overlay::triangles).sum();
            if sum > limit::FILE_TRIANGLES {
                return Err(Fault::TooManyLayers(sum).into());
            }
            let mut whole = Overlay::default();
            parts.into_iter().for_each(|part| whole.absorb(part));
            Ok(whole)
        }
    }
}

/// Куда пошёл треугольник.
enum Placement {
    Lost,
    Tiles(Vec<usize>),
}

/// Рамки плиток в удобном для проверок виде; плитки без рамки сохраняют свои номера.
struct Router {
    extents: Vec<Option<Extent>>,
}

impl Router {
    fn new(boxes: &[Option<TileBox>]) -> Self {
        Router {
            extents: boxes
                .iter()
                .map(|tile| tile.as_ref().map(Extent::of))
                .collect(),
        }
    }

    /// Своя плитка — меньшая из накрывающих центр, иначе ближайшая не дальше `limit::EDGE`; затем остальные,
    /// которых задевает рамка треугольника, если своя не накрывает её целиком.
    fn place(&self, points: &[[f32; 3]; 3]) -> Placement {
        let centre = [0, 1].map(|axis| (points[0][axis] + points[1][axis] + points[2][axis]) / 3.0);
        let rank = |tile: &Extent| {
            if tile.holds(centre) {
                (0u8, tile.area())
            } else {
                (1u8, tile.gap_to(centre))
            }
        };
        let live = self
            .extents
            .iter()
            .enumerate()
            .filter_map(|(at, tile)| tile.map(|found| (at, found)));
        let best = live.min_by(|(_, left), (_, right)| {
            rank(left)
                .partial_cmp(&rank(right))
                .unwrap_or(Ordering::Equal)
        });
        let Some((home, tile)) = best else {
            return Placement::Lost;
        };
        if matches!(rank(&tile), (1, gap) if gap > limit::EDGE) {
            return Placement::Lost;
        }
        let hull = Extent::around(points);
        let neighbours = self
            .extents
            .iter()
            .enumerate()
            .filter(|&(at, other)| at != home && other.is_some_and(|found| found.meets(&hull)));
        let touched: Vec<usize> = if tile.covers(&hull) {
            Vec::new()
        } else {
            neighbours.map(|(at, _)| at).collect()
        };
        Placement::Tiles(std::iter::once(home).chain(touched).collect())
    }

    /// Списки номеров треугольников по плиткам и число упавших за край карты.
    fn deal(&self, overlay: &Overlay) -> (Vec<Vec<usize>>, usize) {
        let mut lists = vec![Vec::new(); self.extents.len()];
        let mut lost = 0;
        for number in 0..overlay.triangles() {
            match self.place(&overlay.points_of(number)) {
                Placement::Lost => lost += 1,
                Placement::Tiles(tiles) => tiles.into_iter().for_each(|at| lists[at].push(number)),
            }
        }
        (lists, lost)
    }
}

pub fn route(overlay: &Overlay, boxes: &[Option<TileBox>]) -> (Vec<Vec<usize>>, usize) {
    Router::new(boxes).deal(overlay)
}

/// Раскладка вершин и шейдер образца рисовалки.
#[derive(Clone, Copy)]
struct Template {
    stride: usize,
    colour_at: usize,
    shader: u16,
}

impl Template {
    fn of(graph: &Graph, block: usize) -> Result<Self> {
        let (stride, colour_at) =
            drawable_write::template_layout_of(graph, block)?.ok_or(Fault::NoLayout)?;
        let shader = drawable_write::template_shader(graph, block)?;
        // Группы шейдеров нет вовсе либо шейдер образца лежит в её пределах.
        let groups = drawable_write::shader_count(graph, block)?;
        (groups == 0 || usize::from(shader) < groups)
            .then_some(())
            .ok_or(Fault::ShaderOutside)?;
        Ok(Template {
            stride,
            colour_at,
            shader,
        })
    }

    /// Геометрии слоёв: треугольники идут снизу вверх по самой низкой вершине (при равенстве — как в списке).
    fn pack(&self, overlay: &Overlay, triangles: &[usize]) -> Vec<NewGeometry> {
        let lowest = |triangle: usize| {
            overlay
                .corners_of(triangle)
                .into_iter()
                .map(|vertex| overlay.z[vertex as usize])
                .fold(f32::INFINITY, f32::min)
        };
        let mut keyed: Vec<(f32, usize)> = triangles.iter().map(|&at| (lowest(at), at)).collect();
        keyed.sort_by(|(a, _), (b, _)| a.partial_cmp(b).unwrap_or(Ordering::Equal));
        let mut packer = Packer::new(overlay, *self);
        let mut sealed: Vec<NewGeometry> = keyed
            .into_iter()
            .filter_map(|(_, at)| packer.feed(overlay.corners_of(at)))
            .collect();
        sealed.extend(packer.close());
        sealed
    }
}

/// Геометрия в сборке: вершины набора получают местные номера по первой встрече.
struct Packer<'o> {
    overlay: &'o Overlay,
    template: Template,
    seen: HashMap<u32, u16>,
    bytes: Vec<u8>,
    indices: Vec<u16>,
    span: ([f32; 3], [f32; 3]),
}

impl<'o> Packer<'o> {
    fn new(overlay: &'o Overlay, template: Template) -> Self {
        Packer {
            overlay,
            template,
            seen: HashMap::new(),
            bytes: Vec::new(),
            indices: Vec::new(),
            span: ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]),
        }
    }

    /// Вершина набора в этой геометрии: местный номер, запись добавляется при первой встрече.
    fn local(&mut self, vertex: u32) -> u16 {
        let next = self.seen.len() as u16;
        let slot = match self.seen.entry(vertex) {
            Entry::Occupied(known) => return *known.get(),
            Entry::Vacant(slot) => slot,
        };
        slot.insert(next);
        let mut record = vec![0u8; self.template.stride];
        for (axis, value) in self.overlay.corner(vertex).into_iter().enumerate() {
            record[axis * 4..axis * 4 + 4].copy_from_slice(&value.to_le_bytes());
            self.span.0[axis] = self.span.0[axis].min(value);
            self.span.1[axis] = self.span.1[axis].max(value);
        }
        let colour = self.template.colour_at;
        record[colour..colour + 4].copy_from_slice(&self.overlay.rgba[vertex as usize]);
        self.bytes.extend_from_slice(&record);
        next
    }

    /// Кладёт треугольник; если прежняя геометрия уже не вместила бы ещё три вершины, она закрывается и отдаётся.
    fn feed(&mut self, corners: [u32; 3]) -> Option<NewGeometry> {
        let sealed = if self.seen.len() + 3 > limit::GEOMETRY_VERTICES {
            self.close()
        } else {
            None
        };
        let locals = corners.map(|vertex| self.local(vertex));
        self.indices.extend(locals);
        sealed
    }

    /// Закрывает собранное (если есть индексы) и начинает новую геометрию.
    fn close(&mut self) -> Option<NewGeometry> {
        let fresh = Packer::new(self.overlay, self.template);
        let done = std::mem::replace(self, fresh);
        (!done.indices.is_empty()).then_some(NewGeometry {
            vertices: done.bytes,
            indices: done.indices,
            shader: done.template.shader,
            min: done.span.0,
            max: done.span.1,
        })
    }
}

/// Результат записи слоёв в одну плитку.
pub struct Appended {
    pub triangles: usize,
    pub vertices: usize,
    pub geometries: Vec<NewGeometry>,
    /// Номер рисовалки суши среди рисовалок словаря.
    pub drawable: usize,
}

impl Appended {
    /// Пустой список треугольников: ничего не записано.
    fn nothing() -> Self {
        Appended {
            triangles: 0,
            vertices: 0,
            geometries: Vec::new(),
            drawable: 0,
        }
    }
}

/// Рисовалка суши, открытая для дописывания: номер в словаре, блок графа и образец.
struct Landing<'g> {
    graph: &'g mut Graph,
    land: usize,
    block: usize,
    template: Template,
}

impl<'g> Landing<'g> {
    fn open(graph: &'g mut Graph, land: usize, count: usize) -> Result<Self> {
        let block = drawable_write::drawable_at(graph, land)?;
        if count > limit::TILE_TRIANGLES {
            return Err(Fault::TooManyInTile(count).into());
        }
        let template = Template::of(graph, block)?;
        Ok(Landing {
            graph,
            land,
            block,
            template,
        })
    }

    /// Дописывает одну новую модель High со всеми геометриями слоёв и пересчитывает рамки рисовалки.
    fn write(self, overlay: &Overlay, triangles: &[usize]) -> Result<Appended> {
        let geometries = self.template.pack(overlay, triangles);
        drawable_write::append_high_model(self.graph, self.block, &geometries)?;
        drawable_write::refresh_drawable(self.graph, self.block)?;
        let stride = self.template.stride;
        Ok(Appended {
            triangles: triangles.len(),
            vertices: geometries
                .iter()
                .fold(0, |sum, part| sum + part.vertices.len() / stride),
            geometries,
            drawable: self.land,
        })
    }
}

pub fn append_tile(
    graph: &mut Graph,
    land: Option<usize>,
    overlay: &Overlay,
    triangles: &[usize],
) -> Result<Option<Appended>> {
    if triangles.is_empty() {
        return Ok(Some(Appended::nothing()));
    }
    let Some(land) = land else {
        return Ok(None);
    };
    Landing::open(graph, land, triangles.len())?
        .write(overlay, triangles)
        .map(Some)
}

/// Форма плитки после дописывания: на одну модель больше, остальное — по записанному.
fn expected_shape(before: Shape, appended: &Appended) -> Shape {
    let mut shape = before;
    shape.models += 1;
    shape.geometries += appended.geometries.len();
    shape.vertices += appended.vertices as u64;
    shape.indices += appended.triangles as u64 * 3;
    shape
}

/// Первое расхождение между записанными геометриями и перечитанными.
fn stored_difference(written: &Graph, appended: &Appended) -> Result<Option<String>> {
    let block = drawable_write::drawable_at(written, appended.drawable)?;
    let stored = drawable_write::last_high_geometries(written, block)?;
    let same = |read: &GeometryData, wrote: &NewGeometry| {
        read.vertices == wrote.vertices
            && read.indices == wrote.indices
            && read.shader == wrote.shader
    };
    Ok(if stored.len() == appended.geometries.len() {
        stored
            .iter()
            .zip(&appended.geometries)
            .position(|(read, wrote)| !same(read, wrote))
            .map(|number| format!("геометрия {number} прочиталась не так, как записана"))
    } else {
        Some("число геометрий не совпало".to_owned())
    })
}

pub fn verify_appended(written: &Graph, before: Shape, appended: &Appended) -> Result<()> {
    let wanted = expected_shape(before, appended);
    let found = drawable_write::shape(written)?;
    let mut verdict = (found != wanted).then(|| format!("форма {found:?}, ждали {wanted:?}"));
    if verdict.is_none() {
        verdict = drawable_write::lod_mismatch(written)?;
    }
    if verdict.is_none() {
        verdict = stored_difference(written, appended)?;
    }
    verdict.map_or(Ok(()), |what| Err(Fault::Mismatch(what).into()))
}

pub fn check_tile_size(bytes: &[u8]) -> Result<()> {
    if bytes.len() > limit::TILE_BYTES {
        return Err(Fault::TileBytes(bytes.len()).into());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
