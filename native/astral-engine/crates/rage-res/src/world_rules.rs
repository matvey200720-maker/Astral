//! Правила отбора сущностей для места мира: те же функции и числа, что у `apps/desktop/src/world-place-rules.js` (чистые, без файлов игры).
//!
//! Повторяют JS выражение в выражение: регулярные выражения (`modelInFrame`, `mapInWorld`) разобраны на подстроки и края по их записи, числа — `f64`
//! (`Math.hypot` — `js_math::hypot`, `Math.round` — `js_math::round`). Сверка с JS — `fixtures/world-place/rules.json` (имена всей таблицы карт игры и
//! ответы настоящих `modelInFrame` и `mapInWorld`; делает `tests/helpers/world-place-gold.js`) и чистые случаи в `world_rules/tests.rs`.

use std::collections::HashMap;

use crate::js_math::{hypot, number_to_string, round};

/// Крупная модель: дальность показа от столького (м) — плита земли, скала, обрыв.
pub const BIG_LOD_DIST: f64 = 200.0;
/// Насколько дальше круга места искать сущности: обычные и крупные модели (м).
pub const NEAR_MARGIN: f64 = 90.0;
pub const BIG_MARGIN: f64 = 330.0;

const LEVEL_HD: u32 = 0;
const LEVEL_ORPHAN: u32 = 5;

/// Уровни сущностей `rage__eLodType`, что кадр рисует вблизи.
pub fn near_level(level: u32) -> bool {
    level == LEVEL_HD || level == LEVEL_ORPHAN
}

/// `text` кончается на `stem` и цифры (`stem\d*$`).
fn ends_with_digits_after(text: &str, stem: &str) -> bool {
    text.trim_end_matches(|c: char| c.is_ascii_digit())
        .ends_with(stem)
}

/// Модели, которых в дневном кадре нет (`NOT_IN_FRAME` JS): дальние копии, тени, ночные огни, заменители.
pub fn model_in_frame(name: &str) -> bool {
    let inside = [
        "_lod_",
        "slod",
        "_emissive",
        "_emis_",
        "_shadow",
        "shadowproxy",
        "refprox",
        "_proxy_",
        "runlight",
        "_lightcone",
        "furgrass",
        "_fur_",
        "_puddle",
        "_rwire",
    ];
    let hit = ends_with_digits_after(name, "_lod")
        || ends_with_digits_after(name, "_emis")
        || ends_with_digits_after(name, "_fur")
        || name.ends_with("proxy")
        || inside.iter().any(|part| name.contains(part));
    !hit
}

/// Состояния карты, что включает сюжет или сервер (`STATE_MAP` JS): разрушенное, сгоревшее, декорация миссии.
pub fn map_in_world(name: &str) -> bool {
    let inside = [
        "_destroyed",
        "_destruct",
        "_burnt",
        "_burned",
        "_collapsed",
        "fake",
        "_damaged_",
        "_trash",
        "_tidy",
        "_onmission",
        "_sunk",
        "_wreck",
        "_crash",
        "_cutscene",
        "_mph4_",
        "_open_",
        "_ipl_gr",
        "banners",
    ];
    let starts = [
        "des_",
        "rc12b_fixed",
        "rc12b_destroyed",
        "prologue",
        "canyonriver",
        "fbi_repair",
        "fbi_colplug",
        "h4_",
    ];
    let ends = [
        "_damage",
        "_damaged",
        "_movie",
        "_hc_end",
        "_hc_req",
        "_heist_dmg",
        "_heist_lights",
        "_request",
        "mission",
        "_open",
        "_broken",
        "_ipl",
        "_int_off",
        "_int_on",
        "_switch_off",
    ];
    let hit = inside.iter().any(|part| name.contains(part))
        || starts.iter().any(|part| name.starts_with(part))
        || ends.iter().any(|part| name.ends_with(part))
        || ends_with_digits_after(name, "_mission")
        || name == "trv1_trail_end";
    !hit
}

/// Сущность, которую игра рисует только в тенях или только в отражениях (`fwEntityDef`), в кадре не нужна.
pub fn entity_drawn_in_view(flags: u32) -> bool {
    const ONLY_SHADOWS: u32 = 1 << 23;
    const ONLY_REFLECTIONS: u32 = 1 << 25;
    const ONLY_WATER_REFLECTIONS: u32 = 1 << 27;
    flags & (ONLY_SHADOWS | ONLY_REFLECTIONS | ONLY_WATER_REFLECTIONS) == 0
}

pub fn distance_2d(x0: f64, y0: f64, x1: f64, y1: f64) -> f64 {
    hypot(&[x0 - x1, y0 - y1])
}

/// Лежит ли сущность в поиске места: крупные модели ищутся дальше.
pub fn entity_in_reach(position: [f64; 3], lod_dist: f64, centre: [f64; 2], reach: f64) -> bool {
    let margin = if lod_dist >= BIG_LOD_DIST {
        BIG_MARGIN
    } else {
        NEAR_MARGIN
    };
    distance_2d(position[0], position[1], centre[0], centre[1]) <= reach + margin
}

/// Карта таблицы задевает круг места: рамка её сущностей с запасом.
pub fn map_touches(bounds: [f64; 4], big: bool, centre: [f64; 2], reach: f64) -> bool {
    let margin = reach + if big { BIG_MARGIN } else { NEAR_MARGIN };
    let dx = (bounds[0] - centre[0]).max(0.0).max(centre[0] - bounds[2]);
    let dy = (bounds[1] - centre[1]).max(0.0).max(centre[1] - bounds[3]);
    hypot(&[dx, dy]) <= margin
}

// ------------------------------------------------------------------ план

/// Многоугольник плана: вершины, рёбра `[a, b, c]` (`a·x + b·y + c` — метры внутрь) и рамка.
#[derive(Debug, Clone)]
pub struct PlanShape {
    pub points: Vec<[f64; 2]>,
    pub edges: Vec<[f64; 3]>,
    pub bounds: [f64; 4],
}

pub fn plan_shape(points: &[[f64; 2]]) -> PlanShape {
    let edges = points
        .iter()
        .enumerate()
        .map(|(at, &[x0, y0])| {
            let [x1, y1] = points[(at + 1) % points.len()];
            let length = hypot(&[x1 - x0, y1 - y0]);
            let size = if length == 0.0 || length.is_nan() {
                1.0
            } else {
                length
            };
            let a = -(y1 - y0) / size;
            let b = (x1 - x0) / size;
            [a, b, -(a * x0 + b * y0)]
        })
        .collect();
    let min = |axis: usize| points.iter().map(|p| p[axis]).fold(f64::INFINITY, f64::min);
    let max = |axis: usize| {
        points
            .iter()
            .map(|p| p[axis])
            .fold(f64::NEG_INFINITY, f64::max)
    };
    PlanShape {
        points: points.to_vec(),
        edges,
        bounds: [min(0), min(1), max(0), max(1)],
    }
}

/// Расстояние от точки до плана в плане сцены: внутри — ноль.
pub fn plan_distance(shape: &PlanShape, x: f64, y: f64) -> f64 {
    if shape
        .edges
        .iter()
        .all(|&[a, b, c]| a * x + b * y + c >= 0.0)
    {
        return 0.0;
    }
    let mut best = f64::INFINITY;
    for (at, &[x0, y0]) in shape.points.iter().enumerate() {
        let [x1, y1] = shape.points[(at + 1) % shape.points.len()];
        let (dx, dy) = (x1 - x0, y1 - y0);
        let square = dx * dx + dy * dy;
        let denominator = if square == 0.0 || square.is_nan() {
            1.0
        } else {
            square
        };
        // `Math.max(0, Math.min(1, …))`: NaN остаётся NaN
        let raw = ((x - x0) * dx + (y - y0) * dy) / denominator;
        let along = if raw.is_nan() {
            raw
        } else {
            raw.min(1.0).max(0.0)
        };
        let distance = hypot(&[x - x0 - along * dx, y - y0 - along * dy]);
        // `Math.min(best, distance)`: NaN побеждает
        best = if best.is_nan() || distance.is_nan() {
            f64::NAN
        } else {
            best.min(distance)
        };
    }
    best
}

/// Задевает ли треугольник план: разделяющие оси обеих фигур.
pub fn triangle_touches_plan(shape: &PlanShape, a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> bool {
    let [ax, ay] = a;
    let [bx, by] = b;
    let [cx, cy] = c;
    let bounds = shape.bounds;
    if ax.max(bx).max(cx) < bounds[0]
        || ax.min(bx).min(cx) > bounds[2]
        || ay.max(by).max(cy) < bounds[1]
        || ay.min(by).min(cy) > bounds[3]
    {
        return false;
    }
    for &[ea, eb, ec] in &shape.edges {
        if ea * ax + eb * ay + ec < 0.0
            && ea * bx + eb * by + ec < 0.0
            && ea * cx + eb * cy + ec < 0.0
        {
            return false;
        }
    }
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    // Стена с высоты — отрезок: у него осей своих нет, хватает проверки рёбер плана.
    if area.abs() < 1e-6 {
        return true;
    }
    let sign = if area > 0.0 { 1.0 } else { -1.0 };
    let sides = [ax, ay, bx, by, bx, by, cx, cy, cx, cy, ax, ay];
    let mut at = 0;
    while at < sides.len() {
        let (x0, y0) = (sides[at], sides[at + 1]);
        let (dx, dy) = (sides[at + 2] - x0, sides[at + 3] - y0);
        if shape
            .points
            .iter()
            .all(|&[x, y]| sign * (dx * (y - y0) - dy * (x - x0)) < 0.0)
        {
            return false;
        }
        at += 4;
    }
    true
}

/// Рамка типа и дальность показа — то, что нужно плану от архетипа.
#[derive(Debug, Clone, Copy, Default)]
pub struct Footprint {
    pub bb_min: Option<[f64; 3]>,
    pub bb_max: Option<[f64; 3]>,
    pub lod_dist: f64,
}

/// Лежит ли сущность на плане: шар рамки её типа (`place` — точка модели → мир). Рамки нет — прежний поиск с запасом от точки сущности.
pub fn entity_touches_plan(
    shape: &PlanShape,
    origin: [f64; 3],
    footprint: &Footprint,
    place: &dyn Fn([f64; 3]) -> [f64; 3],
    position: [f64; 3],
) -> bool {
    let corners = footprint
        .bb_min
        .zip(footprint.bb_max)
        .filter(|(low, high)| low != high);
    let Some((low, high)) = corners else {
        let margin = if footprint.lod_dist >= BIG_LOD_DIST {
            BIG_MARGIN
        } else {
            NEAR_MARGIN
        };
        return plan_distance(shape, position[0] - origin[0], position[1] - origin[1]) <= margin;
    };
    let a = place(low);
    let b = place(high);
    plan_distance(
        shape,
        (a[0] + b[0]) / 2.0 - origin[0],
        (a[1] + b[1]) / 2.0 - origin[1],
    ) <= hypot(&[a[0] - b[0], a[1] - b[1], a[2] - b[2]]) / 2.0 + 1.0
}

/// Ключ места сущности: копия дополнения (`hei_`) стоит на месте основной.
pub fn entity_key(name: &str, position: [f64; 3]) -> String {
    let base = name.strip_prefix("hei_").unwrap_or(name);
    let tenth = |value: f64| number_to_string(round(value * 10.0));
    format!(
        "{base}|{}|{}|{}",
        tenth(position[0]),
        tenth(position[1]),
        tenth(position[2])
    )
}

// ------------------------------------------------------------------ таблицы

/// Строка таблицы карт: имя, рамка сущностей, есть ли крупные модели, номера файлов типов.
#[derive(Debug, Clone, PartialEq)]
pub struct MapRow {
    pub name: String,
    pub bounds: [f64; 4],
    pub big: bool,
    pub types: Vec<usize>,
}

/// Разбор строк таблицы карт (`имя|x0|y0|x1|y1|крупные|типы`).
pub fn parse_world_maps(text: &str) -> Vec<MapRow> {
    let number = |text: Option<&str>| {
        text.and_then(|t| t.trim().parse::<f64>().ok())
            .unwrap_or(f64::NAN)
    };
    text.split('\n')
        .filter(|row| !row.is_empty())
        .map(|row| {
            let mut cells = row.split('|');
            let name = cells.next().unwrap_or("").to_owned();
            let bounds = [
                number(cells.next()),
                number(cells.next()),
                number(cells.next()),
                number(cells.next()),
            ];
            let big = cells.next() == Some("1");
            let types = cells
                .next()
                .filter(|list| !list.is_empty())
                .map(|list| {
                    list.split(',')
                        .map(|id| id.trim().parse::<usize>().unwrap_or(usize::MAX))
                        .collect()
                })
                .unwrap_or_default();
            MapRow {
                name,
                bounds,
                big,
                types,
            }
        })
        .collect()
}

/// Родство словарей из таблицы (`родитель:ребёнок,ребёнок`): ребёнок → родитель, поздняя запись перекрывает раннюю.
pub fn parse_txd_parents(text: &str) -> HashMap<String, String> {
    let mut parents = HashMap::new();
    for row in text.split('\n') {
        let Some(at) = row.find(':') else { continue };
        let parent = &row[..at];
        for child in row[at + 1..].split(',').filter(|child| !child.is_empty()) {
            parents.insert(child.to_owned(), parent.to_owned());
        }
    }
    parents
}

/// Какие карты читать для места: те, что задевают круг; основная не берётся, если есть её копия дополнения `hei_x`; состояния сюжета — не берутся.
pub fn maps_for_place<'a>(maps: &'a [MapRow], centre: [f64; 2], reach: f64) -> Vec<&'a MapRow> {
    let names: std::collections::HashSet<&str> = maps.iter().map(|map| map.name.as_str()).collect();
    maps.iter()
        .filter(|map| {
            map_touches(map.bounds, map.big, centre, reach)
                && map_in_world(&map.name)
                && !names.contains(format!("hei_{}", map.name).as_str())
        })
        .collect()
}

#[cfg(test)]
mod tests;
