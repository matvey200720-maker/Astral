//! Геометрия радара из плиток игры.
//!
//! Плитки `minimap_<строка>_<столбец>.ydd` — модели с цветом вершин; по цвету
//! треугольника видно, что это (вода с глубиной, суша, кварталы, тропы, трассы,
//! дороги, рельсы). Модуль раскладывает треугольники по группам «роль + цвет»,
//! кодирует результат в двоичный вид `AMG1` (его читает окно) и берёт из
//! `minimap.ymt` раскладку атласа карты паузы.

use super::{archive_access, js_text::js_round};
use crate::error::{EngineError, Result};
use rage_res::{
    drawable::{self, Drawable, FileKind, Lod, Mesh},
    Resource,
};
use rage_rpf::{Archive, KeySet};
use std::{cmp::Ordering, collections::BTreeMap, path::Path, sync::Arc};

// ---------- имена и пределы ----------

const ROLE_WATER: &str = "water";
const ROLE_LAND: &str = "land";
const ROLE_BLOCKS: &str = "blocks";
const ROLE_PATHS: &str = "paths";
const ROLE_FREEWAY: &str = "freeway";
const ROLE_ROADS: &str = "roads";
const ROLE_RAIL: &str = "rail";

/// Роли по порядку отрисовки: вода под сушей, суша под кварталами.
pub const ROLES: [&str; 7] = [
    ROLE_WATER,
    ROLE_LAND,
    ROLE_BLOCKS,
    ROLE_PATHS,
    ROLE_FREEWAY,
    ROLE_ROADS,
    ROLE_RAIL,
];

pub const ATLAS_ENTRY: &str = "data/tune/minimap.ymt";
pub const ATLAS_ARCHIVE: &str = "x64a.rpf";
pub const TILE_ARCHIVE: &str = "x64e.rpf";
pub const TILE_DIRECTORY: &str = "levels/gta5/minimap.rpf";
pub const MAX_TILES: usize = 128;
/// Сетка мест плиток: `GRID` × `GRID`.
pub const GRID: usize = 12;
pub const VERSION: u32 = 1;

/// «AMG1» как слово малого порядка байт.
const MAGIC: u32 = u32::from_le_bytes(*b"AMG1");
const MAX_GROUPS: usize = 256;
const MAX_VERTICES: usize = 4_000_000;
/// Яркость мелководья (`#d7dde0`) и глубины (`#3d4f55`).
const SHALLOW: f64 = 0.86;
const DEEP: f64 = 0.28;
const WATER_HEIGHT: f64 = -1.0;
const WATER_SPREAD: f64 = 4.0;
/// Номера ролей (в `ROLES`), которые идут по серому.
const LAND: usize = 1;
const BLOCKS: usize = 2;
const PATHS: usize = 3;
const FREEWAY: usize = 4;
const ROADS: usize = 5;
const RAIL: usize = 6;

// ---------- типы результата ----------

/// Что за вещь по цвету вершины.
#[derive(Clone, Debug, PartialEq)]
pub struct Class {
    pub depth: f64,
    pub role: &'static str,
}

/// Все треугольники одной пары «роль + цвет».
#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    /// Пара `x, y` на каждую вершину; треугольник — три вершины подряд.
    pub positions: Vec<f32>,
    /// `#rrggbb`.
    pub color: String,
    pub depth: f64,
    pub role: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Geometry {
    pub tiles: usize,
    pub triangles: usize,
    pub groups: Vec<Group>,
}

// ---------- классификация ----------

/// Номер роли и глубина воды по каналам цвета (0…255) и высоте.
fn classify_slot(channels: [f64; 3], height: f64) -> (usize, f64) {
    let [red, green, blue] = channels;
    // `max`/`min` Rust пропускают NaN-операнд.
    let top = channels.into_iter().fold(f64::NAN, f64::max);
    let bottom = channels.into_iter().fold(f64::NAN, f64::min);
    if height < WATER_HEIGHT || top - bottom > WATER_SPREAD {
        let luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255.0;
        let depth = (SHALLOW - luma) / (SHALLOW - DEEP);
        return (0, depth.clamp(0.0, 1.0));
    }
    // У NaN все сравнения ложны, и он падает в последнюю ветвь.
    let grey = (red + green + blue) / 3.0;
    let band = [
        (48.0, LAND),
        (80.0, BLOCKS),
        (112.0, PATHS),
        (138.0, FREEWAY),
        (200.0, ROADS),
    ]
    .into_iter()
    .find_map(|(limit, role)| (grey <= limit).then_some(role));
    (band.unwrap_or(RAIL), 0.0)
}

/// Что за вещь по цвету вершины (каналы 0…255) и высоте.
pub fn classify(red: f64, green: f64, blue: f64, height: f64) -> Class {
    Class::from(classify_slot([red, green, blue], height))
}

impl From<(usize, f64)> for Class {
    fn from((slot, depth): (usize, f64)) -> Class {
        Class {
            depth,
            role: ROLES[slot],
        }
    }
}

fn role_slot(role: &str) -> Option<usize> {
    ROLES.iter().position(|known| *known == role)
}

/// Канал цвета в байт: зажим, округление `Math.round`; NaN даёт 0.
fn channel_byte(value: f64) -> u8 {
    if value.is_nan() {
        0
    } else {
        js_round(value.clamp(0.0, 255.0)) as u8
    }
}

// ---------- сборка ----------

/// Один треугольник плитки, уже приведённый к виду для группы.
struct Facet {
    /// Цвет и высота — у первой вершины.
    rgb: [f64; 3],
    height: f64,
    /// `x, y` трёх углов; `y` — это `0 - z + 0`, поэтому отрицательного нуля нет.
    flat: [f32; 6],
}

/// Цвет вершины в шкале 0…255; без цветов — белый.
fn vertex_rgb(mesh: &Mesh, vertex: usize) -> [f64; 3] {
    let from = vertex * 4;
    match mesh.colours.as_deref().and_then(|c| c.get(from..from + 3)) {
        Some(&[r, g, b]) => [r, g, b].map(|channel| f64::from(channel) * 255.0),
        _ => [255.0; 3],
    }
}

/// Треугольники меша по три индекса подряд; хвост из одного-двух индексов не в счёт.
fn facets(mesh: &Mesh) -> impl Iterator<Item = Facet> + '_ {
    mesh.indices.chunks_exact(3).filter_map(move |triangle| {
        let corner = |index: u16| {
            let from = usize::from(index) * 3;
            mesh.positions.get(from..from + 3)
        };
        let [a, b, c] = [
            corner(triangle[0])?,
            corner(triangle[1])?,
            corner(triangle[2])?,
        ];
        let mut flat = [0.0f32; 6];
        for (slot, point) in [a, b, c].into_iter().enumerate() {
            flat[slot * 2] = point[0];
            flat[slot * 2 + 1] = ((0.0 - f64::from(point[2])) + 0.0) as f32;
        }
        Some(Facet {
            rgb: vertex_rgb(mesh, usize::from(triangle[0])),
            height: f64::from(a[1]),
            flat,
        })
    })
}

/// Ключ группы: номер роли и три байта цвета.
type GroupKey = (usize, [u8; 3]);

/// Копит группы по плиткам: по ключу пары (роль, цвет), с номером появления.
#[derive(Default)]
pub struct Builder {
    groups: BTreeMap<GroupKey, (usize, Group)>,
    triangles: usize,
    tiles: usize,
}

/// Читает плитку целиком; любой сбой — плитки как не бывало.
fn read_tile(bytes: &[u8]) -> Option<Vec<Drawable>> {
    let resource = Resource::parse(bytes).ok()?;
    let model = drawable::open_model(&resource, Some(FileKind::Ydd)).ok()?;
    let read = |entry: &drawable::Entry| {
        drawable::read_drawable_at(&resource, entry.at, Lod::High, entry.hash).ok()
    };
    model.entries.iter().map(read).collect()
}

impl Builder {
    pub fn new() -> Self {
        Builder::default()
    }

    /// Добавляет плитку; нечитаемая плитка пропускается без следа (`tiles` не растёт).
    pub fn add_tile_bytes(&mut self, bytes: &[u8]) {
        if let Some(drawables) = read_tile(bytes) {
            self.tiles += 1;
            drawables
                .iter()
                .flat_map(|drawable| drawable.meshes.iter())
                .for_each(|mesh| self.add_mesh(mesh));
        }
    }

    /// Группа пары (роль, цвет); глубину и номер появления запоминает первый её треугольник.
    fn group_mut(&mut self, key: GroupKey, depth: f64) -> &mut Group {
        let born = self.groups.len();
        let (slot, [r, g, b]) = key;
        let entry = self.groups.entry(key).or_insert_with(|| {
            let fresh = Group {
                positions: Vec::new(),
                color: format!("#{r:02x}{g:02x}{b:02x}"),
                depth,
                role: ROLES[slot],
            };
            (born, fresh)
        });
        &mut entry.1
    }

    fn add_mesh(&mut self, mesh: &Mesh) {
        for facet in facets(mesh) {
            let (slot, depth) = classify_slot(facet.rgb, facet.height);
            let key = (slot, facet.rgb.map(channel_byte));
            self.group_mut(key, depth)
                .positions
                .extend_from_slice(&facet.flat);
            self.triangles += 1;
        }
    }

    /// Группы по номеру роли, затем по глубине (NaN считается равным), при равенстве —
    /// в порядке появления.
    pub fn finish(self) -> Geometry {
        let mut ordered: Vec<(usize, usize, Group)> = self
            .groups
            .into_iter()
            .map(|((slot, _), (born, group))| (slot, born, group))
            .collect();
        ordered.sort_by(|(slot_a, born_a, a), (slot_b, born_b, b)| {
            let by_depth = a.depth.partial_cmp(&b.depth);
            slot_a
                .cmp(slot_b)
                .then(by_depth.unwrap_or(Ordering::Equal))
                .then(born_a.cmp(born_b))
        });
        Geometry {
            groups: ordered.into_iter().map(|(_, _, group)| group).collect(),
            triangles: self.triangles,
            tiles: self.tiles,
        }
    }
}

// ---------- двоичный вид AMG1 ----------

/// Байты цвета из `#rrggbb`; не шестнадцатеричная строка даёт чёрный.
fn color_bytes(color: &str) -> [u8; 3] {
    let packed = u32::from_str_radix(color.strip_prefix('#').unwrap_or(color), 16).unwrap_or(0);
    let [_, r, g, b] = packed.to_be_bytes();
    [r, g, b]
}

/// Заголовок одной группы (8 байт) и число вершин.
fn group_head(group: &Group) -> [u8; 12] {
    let role = role_slot(group.role).unwrap_or(0) as u8;
    let depth = js_round(group.depth * 255.0) as u8;
    let [r, g, b] = color_bytes(&group.color);
    let vertices = ((group.positions.len() / 2) as u32).to_le_bytes();
    let mut head = [0u8; 12];
    head[..5].copy_from_slice(&[role, depth, r, g, b]);
    head[8..].copy_from_slice(&vertices);
    head
}

pub fn encode(geometry: &Geometry) -> Vec<u8> {
    let preamble = [MAGIC, VERSION, geometry.groups.len() as u32]
        .into_iter()
        .flat_map(u32::to_le_bytes);
    let groups = geometry.groups.iter().flat_map(|group| {
        let coordinates = group.positions.iter().flat_map(|value| value.to_le_bytes());
        group_head(group).into_iter().chain(coordinates)
    });
    preamble.chain(groups).collect()
}

fn le_word(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes[..4].try_into().expect("слово из четырёх байт"))
}

pub fn decode(bytes: &[u8]) -> Option<Geometry> {
    let (preamble, mut rest) = bytes.split_at_checked(12)?;
    if le_word(preamble) != MAGIC || le_word(&preamble[4..]) != VERSION {
        return None;
    }
    let count = le_word(&preamble[8..]) as usize;
    if count > MAX_GROUPS {
        return None;
    }
    let mut vertices = 0usize;
    let groups = (0..count)
        .map(|_| {
            let (head, tail) = rest.split_at_checked(12)?;
            let role = *ROLES.get(usize::from(head[0]))?;
            let amount = le_word(&head[8..]) as usize;
            vertices = vertices.checked_add(amount)?;
            (amount % 3 == 0 && vertices <= MAX_VERTICES).then_some(())?;
            let (raw, after) = tail.split_at_checked(amount * 8)?;
            rest = after;
            Some(Group {
                positions: raw
                    .chunks_exact(4)
                    .map(|quad| f32::from_bits(le_word(quad)))
                    .collect(),
                color: format!("#{:02x}{:02x}{:02x}", head[2], head[3], head[4]),
                depth: f64::from(head[1]) / 255.0,
                role,
            })
        })
        .collect::<Option<Vec<Group>>>()?;
    Some(Geometry {
        tiles: 0,
        triangles: vertices / 3,
        groups,
    })
}

// ---------- атлас ----------

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Atlas {
    pub tile_units: f32,
    pub origin_x: f32,
    pub origin_y: f32,
}

/// Четыре слова `f32` (старший байт первым) подходят под раскладку атласа?
fn atlas_in(window: &[u8]) -> Option<Atlas> {
    let [units, again, x, y] = [0, 4, 8, 12].map(|at| {
        f32::from_be_bytes(
            window[at..at + 4]
                .try_into()
                .expect("слово из четырёх байт"),
        )
    });
    // `x < 0` строго (минус нуль не годится), `y > 0` строго; NaN и бесконечности отсеиваются границами.
    let fits = units == again
        && (1000.0..=20000.0).contains(&units)
        && (-20000.0..0.0).contains(&x)
        && y > 0.0
        && y <= 20000.0;
    fits.then_some(Atlas {
        tile_units: units,
        origin_x: x,
        origin_y: y,
    })
}

/// Раскладка ищется по форме на смещениях, кратных четырём (структуру PSO не разбираем).
pub fn read_atlas(bytes: &[u8]) -> Option<Atlas> {
    bytes.windows(16).step_by(4).find_map(atlas_in)
}

// ---------- чтение из игры ----------

/// Байты найденных плиток по порядку мест сетки. Предел плиток проверяется перед каждым
/// местом; ошибка чтения отдаётся один раз и кончает обход.
struct TileBytes<'a> {
    archive: &'a Archive,
    place: usize,
    yielded: usize,
    failed: bool,
}

impl<'a> TileBytes<'a> {
    fn over(archive: &'a Archive) -> Self {
        TileBytes {
            archive,
            place: 0,
            yielded: 0,
            failed: false,
        }
    }
}

impl Iterator for TileBytes<'_> {
    type Item = Result<Vec<u8>>;

    fn next(&mut self) -> Option<Self::Item> {
        while !self.failed && self.yielded < MAX_TILES && self.place < GRID * GRID {
            let (row, column) = (self.place / GRID, self.place % GRID);
            self.place += 1;
            let entry = format!("{TILE_DIRECTORY}/minimap_{row}_{column}.ydd");
            match archive_access::read_entry(self.archive, &entry) {
                Ok(None) => continue,
                Ok(found) => {
                    self.yielded += 1;
                    return found.map(Ok);
                }
                Err(error) => {
                    self.failed = true;
                    return Some(Err(error));
                }
            }
        }
        None
    }
}

/// Обходит сетку по строкам и отдаёт байты каждой найденной плитки; возвращает, сколько найдено.
fn walk_grid(archive: &Archive, sink: &mut dyn FnMut(&[u8])) -> Result<usize> {
    TileBytes::over(archive).try_fold(0usize, |count, tile| {
        sink(&tile?);
        Ok(count + 1)
    })
}

fn read_tiles(root: &Path, keys: &Arc<KeySet>) -> Result<Geometry> {
    let path = root.join(TILE_ARCHIVE);
    let archive = match path.is_file() {
        true => archive_access::open(&path, keys)?,
        false => {
            let text = format!("Archive was not found: {TILE_ARCHIVE}");
            return Err(EngineError::file_not_found(text));
        }
    };
    let mut builder = Builder::new();
    let found = walk_grid(&archive, &mut |bytes| builder.add_tile_bytes(bytes))?;
    if found == 0 {
        let text = format!("Radar tiles were not found in {TILE_ARCHIVE}");
        return Err(EngineError::file_not_found(text));
    }
    Some(builder.finish())
        .filter(|geometry| geometry.triangles > 0)
        .ok_or_else(|| EngineError::invalid_data("Radar tiles carry no triangles"))
}

/// Атлас из `x64a.rpf`; нет архива (или это каталог) или раскладки — `None`.
fn read_atlas_file(root: &Path, keys: &Arc<KeySet>) -> Result<Option<Atlas>> {
    let path = root.join(ATLAS_ARCHIVE);
    match path.is_file() {
        false => Ok(None),
        true => {
            let archive = archive_access::open(&path, keys)?;
            let entry = archive_access::read_entry(&archive, ATLAS_ENTRY)?;
            Ok(entry.as_deref().and_then(read_atlas))
        }
    }
}

/// Геометрия из плиток `x64e.rpf` и атлас из `x64a.rpf` (если есть).
pub fn read_from_game(root: &Path, keys: &Arc<KeySet>) -> Result<(Geometry, Option<Atlas>)> {
    let geometry = read_tiles(root, keys)?;
    let atlas = read_atlas_file(root, keys)?;
    Ok((geometry, atlas))
}

#[cfg(test)]
mod tests;
