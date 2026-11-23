//! Радуга над Лос-Сантосом: геометрия дуги, лист спектра, типы по часам суток,
//! карта и манифест.
//!
//! Дуга лежит в вертикальной плоскости: её угловой радиус 42° отсчитывается от
//! антисолнечной точки, угловая ширина 2.2°, сегментов 96, расстояние от точки
//! обзора 3 км. Все расчёты дуги и спектра идут в `f32` в том порядке операций,
//! в каком они расписаны ниже: от него зависят биты результата.

use std::{array::from_fn, f32::consts::PI};

use crate::{
    donor::{Donor, Look, Mesh, Refusal, Round},
    error::{Error, Result},
    hash::joaat,
    placements::{self, ArchetypeFields, ArchetypeSpec, Compiled, EntitySpec},
    texture::Format,
    ytd_write::NewTexture,
};

/// Ступень радуги: модель, часы суток, в которые она видна, и яркость.
#[derive(Debug, Clone, PartialEq)]
pub struct Tier {
    pub asset: String,
    pub hours: Vec<u32>,
    pub brightness: f32,
}

/// Дуга: точка постановки, рамка и описывающая сфера.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Arc {
    pub origin: [f32; 3],
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub centre: [f32; 3],
    pub radius: f32,
}

pub const SPECTRUM_WIDTH: usize = 64;
pub const SPECTRUM_HEIGHT: usize = 128;

// Исходные данные дуги: откуда смотрят, куда, на каком расстоянии и под какими углами.
const SKY_EYE: [f32; 3] = [-150.0, -850.0, 40.0];
const SKY_HEADING: [f32; 2] = [0.97, 0.25];
const SKY_DISTANCE: f32 = 3000.0;
const SKY_DEPRESSION: f32 = 17.0;
const SKY_ARC: f32 = 42.0;
const SKY_WIDTH: f32 = 2.2;
const SKY_SEGMENTS: usize = 96;

/// Имена и общие числа выгрузки.
struct Export {
    types: &'static str,
    map: &'static str,
    sheet: &'static str,
    by: &'static str,
    time: &'static str,
    lod: f32,
    /// Базовое свечение ступени; яркость ступени — доля от него.
    glow: f32,
    /// Бит «исчезать, пока смотрят» в слове часов.
    fade_bit: u32,
    /// Бит флагов сущности: радуга не отбрасывает тени.
    no_shadows: u32,
}

const EXPORT: Export = Export {
    types: "astral_rainbow",
    map: "astral_rainbow_map",
    sheet: "astral_rainbow",
    by: "Astral Sky Rainbow Compiler 3",
    time: "01 January 1970 00:00",
    lod: 9000.0,
    glow: 3.5,
    fade_bit: 1 << 24,
    no_shadows: 0x40_0000,
};

fn radians(degrees: f32) -> f32 {
    degrees * PI / 180.0
}

/// Слово часов: бит исчезновения и по биту на каждый час. Часы не проверяются:
/// сдвиг на 32 и больше в отладочной сборке паникует, в релизной берётся по модулю 32.
pub fn time_flags(hours: &[u32]) -> u32 {
    let mut flags = EXPORT.fade_bit;
    for &hour in hours {
        flags |= 1u32 << hour;
    }
    flags
}

/// Одна точка ленты: доля дуги, сторона (0 — внутренний край, 1 — внешний) и место.
struct Sample {
    t: f32,
    v: f32,
    point: [f32; 3],
}

/// Трёхмерный вектор с покомпонентными операциями: порядок вычислений в них
/// тот же, что при записи по осям.
#[derive(Clone, Copy)]
struct V3([f32; 3]);

impl V3 {
    fn scaled(self, k: f32) -> V3 {
        V3(self.0.map(|c| c * k))
    }

    fn plus(self, other: V3) -> V3 {
        V3(from_fn(|i| self.0[i] + other.0[i]))
    }

    /// Прибавляет число только к третьей компоненте.
    fn lifted(self, dz: f32) -> V3 {
        V3([self.0[0], self.0[1], self.0[2] + dz])
    }
}

/// Величины дуги, общие для рамки и для сетки.
struct Ribbon {
    direction: [f32; 2],
    origin: [f32; 3],
    right: V3,
    depth: f32,
    radius: f32,
    half_width: f32,
    limit: f32,
}

impl Ribbon {
    fn new() -> Ribbon {
        let [dx, dy] = SKY_HEADING;
        let inverse = 1.0 / (dx * dx + dy * dy).sqrt();
        let direction = [dx * inverse, dy * inverse];
        let along_ground = V3([direction[0], direction[1], 0.0]);
        let origin = along_ground.scaled(SKY_DISTANCE).plus(V3(SKY_EYE)).0;
        // Высота над землёй для угла в градусах на расстоянии до дуги.
        let reach = |degrees: f32| SKY_DISTANCE * radians(degrees).tan();
        let depth = reach(SKY_DEPRESSION);
        let radius = reach(SKY_ARC - SKY_DEPRESSION) + depth;
        let half_width = reach(SKY_WIDTH) * 0.5;
        // Синус предельного угла: дуга не опускается ниже земли.
        let outer = radius + half_width;
        let sine = (depth - 50.0) / outer;
        let sine = sine.clamp(-1.0, 1.0);
        Ribbon {
            direction,
            origin,
            right: V3([direction[1], -direction[0], 0.0]),
            depth,
            radius,
            half_width,
            limit: sine.asin(),
        }
    }

    /// Точка на краю ленты при доле дуги `t`.
    fn point(&self, t: f32, edge: f32) -> [f32; 3] {
        let angle = self.limit + (PI - 2.0 * self.limit) * t;
        let (sin, cos) = angle.sin_cos();
        let local = V3([0.0, 0.0, -self.depth]).plus(V3([cos, 0.0, sin]).scaled(edge));
        self.right.scaled(local.0[0]).lifted(local.0[2]).0
    }

    /// Точки ленты по шагам дуги, на каждом шаге внутренний край, затем внешний.
    fn strip(&self) -> impl Iterator<Item = Sample> + '_ {
        let sides = [
            (self.radius - self.half_width, 0.0),
            (self.radius + self.half_width, 1.0),
        ];
        (0..=SKY_SEGMENTS).flat_map(move |step| {
            let t = step as f32 / SKY_SEGMENTS as f32;
            sides.into_iter().map(move |(edge, v)| Sample {
                t,
                v,
                point: self.point(t, edge),
            })
        })
    }
}

/// Дуга: рамка по всем точкам ленты с запасом метр и сфера вокруг рамки.
pub fn build_arc() -> Arc {
    let ribbon = Ribbon::new();
    let (mut low, mut high) = ([f32::MAX; 3], [f32::MIN; 3]);
    for sample in ribbon.strip() {
        low = from_fn(|i| low[i].min(sample.point[i]));
        high = from_fn(|i| high[i].max(sample.point[i]));
    }
    let min = low.map(|v| v - 1.0);
    let max = high.map(|v| v + 1.0);
    let centre: [f32; 3] = from_fn(|i| (min[i] + max[i]) * 0.5);
    let squares: [f32; 3] = from_fn(|i| (max[i] - centre[i]).powi(2));
    Arc {
        origin: ribbon.origin,
        min,
        max,
        centre,
        radius: (squares[0] + squares[1] + squares[2]).sqrt(),
    }
}

/// Два треугольника квадрата между соседними шагами: смещения от первой вершины шага.
const QUAD: [u16; 6] = [0, 1, 3, 0, 3, 2];

/// Сетка дуги: по две вершины `[x y z nx ny nz t v]` на шаг и по два треугольника между шагами.
pub fn arc_mesh() -> (Vec<[f32; 8]>, Vec<u16>) {
    let ribbon = Ribbon::new();
    let [nx, ny] = ribbon.direction.map(|c| -c);
    let vertices = ribbon
        .strip()
        .map(
            |Sample {
                 t,
                 v,
                 point: [x, y, z],
             }| [x, y, z, nx, ny, 0.0, t, v],
        )
        .collect();
    let indices = (0..SKY_SEGMENTS as u16)
        .flat_map(|step| QUAD.map(|offset| step * 2 + offset))
        .collect();
    (vertices, indices)
}

/// Опорные точки спектра поперёк полосы: позиция, затем цвет `R, G, B`.
const SPECTRUM_STOPS: [[f32; 4]; 7] = [
    [0.00, 0.56, 0.32, 1.00],
    [0.18, 0.28, 0.46, 1.00],
    [0.36, 0.28, 0.92, 0.48],
    [0.54, 1.00, 0.95, 0.38],
    [0.72, 1.00, 0.62, 0.24],
    [0.90, 1.00, 0.28, 0.22],
    [1.00, 0.95, 0.22, 0.22],
];
/// Доля света неба, подмешиваемая к цвету спектра.
const SKY_LIGHT: f32 = 0.05;

fn mix(a: f32, b: f32, t: f32) -> f32 {
    let step = (b - a) * t;
    a + step
}

fn smooth(edge0: f32, edge1: f32, x: f32) -> f32 {
    let span = edge1 - edge0;
    let t = ((x - edge0) / span).clamp(0.0, 1.0);
    let blend = 3.0 - 2.0 * t;
    t * t * blend
}

/// Спад к обоим краям: `smooth` от нуля к `width` и зеркально от единицы.
fn fade(width: f32, x: f32) -> f32 {
    smooth(0.0, width, x) * smooth(0.0, width, 1.0 - x)
}

/// Цвет спектра в точке `t` поперёк полосы; на стыке берётся левая пара.
fn spectrum_colour(t: f32) -> [f32; 3] {
    let t = t.clamp(0.0, 1.0);
    // Первая опорная точка не левее `t` замыкает пару справа.
    let right = SPECTRUM_STOPS.partition_point(|stop| stop[0] < t).max(1);
    let rgb = |stop: [f32; 4]| [stop[1], stop[2], stop[3]];
    match (SPECTRUM_STOPS.get(right - 1), SPECTRUM_STOPS.get(right)) {
        (Some(&left), Some(&next)) => {
            let (from, to) = (left[0], next[0]);
            let (low, high) = (rgb(left), rgb(next));
            let blend = (t - from) / (to - from);
            from_fn(|i| mix(mix(low[i], high[i], blend), 1.0, SKY_LIGHT))
        }
        _ => rgb(SPECTRUM_STOPS[SPECTRUM_STOPS.len() - 1]),
    }
}

type Texel = [f32; 4];

/// Квадраты, из которых складывается пиксель следующего уровня, как смещения `(dx, dy)`.
const TAPS: [(usize, usize); 4] = [(0, 0), (1, 0), (0, 1), (1, 1)];

/// Уровень мипов: размеры и пиксели `[R, G, B, A]` по строкам.
struct Mip {
    width: usize,
    height: usize,
    texels: Vec<Texel>,
}

impl Mip {
    /// Основной уровень: лента мягко гаснет к краям, цвет умножен на прозрачность.
    fn base() -> Mip {
        let texels = (0..SPECTRUM_HEIGHT)
            .flat_map(|y| {
                let across = (y as f32 + 0.5) / SPECTRUM_HEIGHT as f32;
                let colour = spectrum_colour(across);
                let envelope = fade(0.18, across);
                (0..SPECTRUM_WIDTH).map(move |x| {
                    let u = (x as f32 + 0.5) / SPECTRUM_WIDTH as f32;
                    let alpha = envelope * fade(0.12, u);
                    let [r, g, b] = colour.map(|channel| channel * alpha);
                    [r, g, b, alpha]
                })
            })
            .collect();
        Mip {
            width: SPECTRUM_WIDTH,
            height: SPECTRUM_HEIGHT,
            texels,
        }
    }

    /// Уровень вдвое меньше: каждый пиксель — среднее квадрата 2×2 с обрезкой по краю.
    fn shrink(&self) -> Mip {
        let (width, height) = ((self.width / 2).max(1), (self.height / 2).max(1));
        let texels = (0..width * height)
            .map(|n| {
                let (x, y) = (n % width, n / width);
                let mut total = [0.0f32; 4];
                for &(dx, dy) in &TAPS {
                    let column = (2 * x + dx).min(self.width - 1);
                    let row = (2 * y + dy).min(self.height - 1);
                    let texel = self.texels[row * self.width + column];
                    total = from_fn(|channel| total[channel] + texel[channel]);
                }
                total.map(|value| value / 4.0)
            })
            .collect();
        Mip {
            width,
            height,
            texels,
        }
    }

    /// Байты уровня: на пиксель B, G, R, A.
    fn bytes(&self) -> Vec<u8> {
        let byte = |value: f32| (value * 255.0).round_ties_even().clamp(0.0, 255.0) as u8;
        self.texels
            .iter()
            .flat_map(|&[r, g, b, a]| [b, g, r, a].map(byte))
            .collect()
    }
}

/// Лист `astral_rainbow`: спектр 64×128, `A8R8G8B8`, мипы до 1×1.
pub fn spectrum_texture() -> NewTexture {
    let mut chain = vec![Mip::base()];
    while let Some(last) = chain.last() {
        if last.width <= 1 && last.height <= 1 {
            break;
        }
        let smaller = last.shrink();
        chain.push(smaller);
    }
    let [width, height] = [SPECTRUM_WIDTH, SPECTRUM_HEIGHT].map(|side| side as u16);
    NewTexture {
        name: String::from(EXPORT.sheet),
        width,
        height,
        format: Format::A8R8G8B8,
        levels: chain.len() as u8,
        payload: chain.iter().flat_map(Mip::bytes).collect(),
    }
}

/// Манифест: одна связь «карта → типы».
pub fn manifest() -> Result<Vec<u8>> {
    let Export { types, map, .. } = EXPORT;
    placements::manifest(types, map)
}

/// Всё, что одной ступени нужно в типах и в карте.
struct Placed {
    archetype: ArchetypeSpec,
    fields: ArchetypeFields,
    entity: EntitySpec,
}

impl Placed {
    fn of(arc: &Arc, index: usize, tier: &Tier) -> Placed {
        let guid_key = ["astral:", tier.asset.as_str()].concat();
        let lod_dist = EXPORT.lod;
        let archetype = ArchetypeSpec {
            name: tier.asset.clone(),
            lod_dist,
            bb_min: arc.min,
            bb_max: arc.max,
            flags: 0,
            clip_dictionary: None,
        };
        let fields = ArchetypeFields {
            special_attribute: 0,
            hd_texture_dist: lod_dist,
            texture_dictionary: Some(joaat(EXPORT.sheet)),
            time_flags: Some(time_flags(&tier.hours)),
        };
        let entity = EntitySpec {
            archetype: index,
            position: arc.origin,
            // Отрицательные нули по x, y, z: так же пишет выгрузка хоста.
            rotation: [-0.0, -0.0, -0.0, 1.0],
            lod_dist,
            flags: EXPORT.no_shadows,
            guid: Some(joaat(&guid_key)),
        };
        Placed {
            archetype,
            fields,
            entity,
        }
    }
}

/// Типы (по архетипу на ступень, `CTimeArchetypeDef`) и карта (по сущности на ступень).
pub fn compile(tiers: &[Tier]) -> Result<Compiled> {
    let arc = build_arc();
    let (mut archetypes, mut fields, mut entities) = (Vec::new(), Vec::new(), Vec::new());
    for (index, tier) in tiers.iter().enumerate() {
        let Placed {
            archetype,
            fields: extra,
            entity,
        } = Placed::of(&arc, index, tier);
        archetypes.push(archetype);
        fields.push(extra);
        entities.push(entity);
    }
    placements::compile_copied(
        EXPORT.types,
        EXPORT.map,
        &archetypes,
        &fields,
        &entities,
        EXPORT.by,
        EXPORT.time,
    )
}

fn refused_at(stage: &str, refusal: &Refusal) -> Error {
    Error::broken(format!("{stage}: {refusal:?}"))
}

/// Модели ступеней: геометрия дуги наша, шейдер и его параметры у донора
/// (`v_16_barglow.ydr`). Пары `(asset, байты .ydr)` идут в порядке ступеней.
pub fn tier_models(donor_bytes: &[u8], tiers: &[Tier]) -> Result<Vec<(String, Vec<u8>)>> {
    // Хост пишет числа радуги в XML (`0.######`): семь значащих цифр.
    let donor = Donor::open(donor_bytes).map_err(|r| refused_at("Донор радуги", &r))?.with_round(Round::Seven);
    let (vertices, indices) = arc_mesh();
    let arc_only = [Mesh {
        shader: 0,
        vertices,
        indices,
    }];
    let packed = donor
        .pack_with_margin(&arc_only, Some(EXPORT.lod), 1.0)
        .map_err(|r| refused_at("Сетка радуги", &r))?;
    let mut models = Vec::with_capacity(tiers.len());
    for tier in tiers {
        let look = Look {
            emissive: Some(EXPORT.glow * tier.brightness),
            texture: Some(EXPORT.sheet.to_string()),
            model: Some(tier.asset.clone()),
        };
        let stage = format!("Ступень {}", tier.asset);
        let bytes = donor
            .apply_look(&packed, &look)
            .map_err(|r| refused_at(&stage, &r))?;
        models.push((tier.asset.clone(), bytes));
    }
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_flags_set_the_hours_and_the_hide_bit() {
        let cases: [(&[u32], u32); 4] = [
            (&[10, 11, 12, 13, 14, 15], 0x0100_FC00),
            (&[6, 7, 17, 18], 0x0106_00C0),
            (&[], 0x0100_0000),
            (&[23, 23, 0], 0x0180_0001),
        ];
        for (hours, expected) in cases {
            assert_eq!(time_flags(hours), expected, "{hours:?}");
        }
    }

    #[test]
    fn the_arc_sits_east_north_east_of_the_viewpoint() {
        let arc = build_arc();
        let facts = [
            (arc.origin[0] - 2755.1).abs() < 2.0,
            arc.min[2] < arc.max[2],
            arc.radius > 0.0,
        ];
        assert_eq!(facts, [true; 3]);
    }

    #[test]
    fn the_mesh_has_two_vertices_per_step_and_two_triangles_between() {
        let (vertices, indices) = arc_mesh();
        assert_eq!(vertices.len(), 194);
        assert_eq!(indices.len(), 576);
        assert_eq!(indices[..6], [0, 1, 3, 0, 3, 2]);
        assert_eq!(indices.iter().max(), Some(&193));
    }

    #[test]
    fn the_sheet_carries_every_mip_down_to_one_pixel() {
        let sheet = spectrum_texture();
        assert_eq!((sheet.width, sheet.height, sheet.levels), (64, 128, 8));
        assert_eq!(sheet.payload.len(), 43692);
        // Углы прозрачны, середина полосы нет.
        assert_eq!(sheet.payload[..4], [0, 0, 0, 0]);
    }

    #[test]
    fn a_donor_that_is_not_a_drawable_is_refused_before_any_tier() {
        let err = tier_models(b"not a drawable at all", &[]).unwrap_err();
        assert!(err.message.starts_with("Донор радуги: NotDrawable"));
    }

    #[test]
    fn the_colour_of_a_joint_belongs_to_the_left_pair() {
        // На стыке 0.18 цвет тот же, что при подходе слева: пара (0.00, 0.18).
        let found = spectrum_colour(0.18);
        let expect = |c: f32| mix(c, 1.0, SKY_LIGHT);
        for (got, want) in found.into_iter().zip([0.28, 0.46, 1.0]) {
            assert!(
                (got - expect(want)).abs() < 1e-6,
                "{got} против {}",
                expect(want)
            );
        }
    }
}
