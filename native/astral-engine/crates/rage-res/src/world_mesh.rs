//! Сетка модели на месте сущности и склейка сеток места: `placeMesh`, `joinMeshes`, `applyGlobalUv`, `vertexColours`, `terrainWeights`, `surfaceOf` из
//! `apps/desktop/src/world-place-scene.js` и `packages/rage-drawable/terrain-weights.js`.
//!
//! Числа — как у JS: вершины считаются в `f64` и пишутся в `f32`, `Math.hypot` — `js_math::hypot`, `Math.round` — `js_math::round`. Порядок первого
//! появления вершин при отсечении и «целая сетка» (`whole`) повторены вместе с особенностью JS: у целиком оставшейся сетки массивы лежат в порядке файла, а
//! индексы — в порядке первого появления (на сетках игры они совпадают, и это не ошибка сборки, а то, что записывает `placeMesh`).
//! Сверка с JS — `fixtures/world-place/mesh-ops.json` (`tests/helpers/world-place-gold.js`).

use crate::drawable_js::Mesh;
use crate::js_math::{hypot, round};
use crate::shader_vectors::{ShaderVectors, GLOBAL_ANIM_UV0, GLOBAL_ANIM_UV1};
use crate::world_rules::{triangle_touches_plan, PlanShape};

/// Что оставлять от сетки: круг (его радиус) или план.
#[derive(Clone, Copy)]
pub enum Area<'a> {
    Radius(f64),
    Plan(&'a PlanShape),
}

/// Сетка на месте: оси сцены, вершины только тех треугольников, что задевают место.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Placed {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Option<Vec<f32>>,
    pub uvs1: Option<Vec<f32>>,
    pub colours: Option<Vec<f32>>,
    pub colours1: Option<Vec<f32>>,
    pub indices: Vec<u32>,
    pub centre: [f64; 2],
}

/// Матрица места сущности 3×4 (`matrixOf` JS): точка модели → мир.
pub fn matrix_of(place: &dyn Fn([f64; 3]) -> [f64; 3]) -> [f64; 12] {
    let o = place([0.0, 0.0, 0.0]);
    let x = place([1.0, 0.0, 0.0]);
    let y = place([0.0, 1.0, 0.0]);
    let z = place([0.0, 0.0, 1.0]);
    [
        x[0] - o[0],
        y[0] - o[0],
        z[0] - o[0],
        o[0],
        x[1] - o[1],
        y[1] - o[1],
        z[1] - o[1],
        o[1],
        x[2] - o[2],
        y[2] - o[2],
        z[2] - o[2],
        o[2],
    ]
}

/// Поворот нормали 3×3 (`turnOf` JS).
pub fn turn_of(turn: &dyn Fn([f64; 3]) -> [f64; 3]) -> [f64; 9] {
    let x = turn([1.0, 0.0, 0.0]);
    let y = turn([0.0, 1.0, 0.0]);
    let z = turn([0.0, 0.0, 1.0]);
    [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]
}

/// Выбор вершин по новым номерам; целая сетка отдаётся копией в порядке файла (см. заметку выше).
fn pick(
    array: &Option<Vec<f32>>,
    size: usize,
    used: &[i32],
    vertices: usize,
    whole: bool,
) -> Option<Vec<f32>> {
    let array = array.as_ref()?;
    if whole {
        return Some(array.clone());
    }
    let mut out = vec![0f32; vertices * size];
    for (index, &slot) in used.iter().enumerate() {
        if slot < 0 {
            continue;
        }
        let slot = slot as usize;
        for part in 0..size {
            out[slot * size + part] = array.get(index * size + part).copied().unwrap_or(0.0);
        }
    }
    Some(out)
}

/// `placeMesh` JS. `None` — на месте ничего нет.
pub fn place_mesh(
    mesh: &Mesh,
    matrix: &[f64; 12],
    turn: &[f64; 9],
    origin: [f64; 3],
    area: Area,
    floor: f64,
    top: f64,
) -> Option<Placed> {
    let count = mesh.positions.len() / 3;
    let mut positions = vec![0f32; count * 3];
    let mut normals = vec![0f32; count * 3];
    let source = &mesh.positions;
    for at in 0..count {
        let mx = f64::from(source[at * 3]);
        let my = -f64::from(source[at * 3 + 2]);
        let mz = f64::from(source[at * 3 + 1]);
        positions[at * 3] =
            (matrix[0] * mx + matrix[1] * my + matrix[2] * mz + matrix[3] - origin[0]) as f32;
        positions[at * 3 + 1] =
            (matrix[4] * mx + matrix[5] * my + matrix[6] * mz + matrix[7] - origin[1]) as f32;
        positions[at * 3 + 2] =
            (matrix[8] * mx + matrix[9] * my + matrix[10] * mz + matrix[11] - origin[2]) as f32;
        // У листвы игры нормалей часто нет: без нормали вершина смотрит вверх, а не чернеет.
        normals[at * 3 + 2] = 1.0;
        if let Some(source_normals) = &mesh.normals {
            let nx = f64::from(source_normals[at * 3]);
            let ny = -f64::from(source_normals[at * 3 + 2]);
            let nz = f64::from(source_normals[at * 3 + 1]);
            let wx = turn[0] * nx + turn[1] * ny + turn[2] * nz;
            let wy = turn[3] * nx + turn[4] * ny + turn[5] * nz;
            let wz = turn[6] * nx + turn[7] * ny + turn[8] * nz;
            let size = hypot(&[wx, wy, wz]);
            if size > 1e-4 {
                normals[at * 3] = (wx / size) as f32;
                normals[at * 3 + 1] = (wy / size) as f32;
                normals[at * 3 + 2] = (wz / size) as f32;
            }
        }
    }
    // Отсечение — по всему треугольнику, не по середине: большой треугольник земли или стены с серединой снаружи оставлял дыру внутри.
    let indices = &mesh.indices;
    let limit = match area {
        Area::Radius(radius) => radius * radius,
        Area::Plan(_) => 0.0,
    };
    let mut kept: Vec<u32> = Vec::new();
    let mut used = vec![-1i32; count];
    let mut vertices = 0usize;
    let (mut sum_x, mut sum_y) = (0f64, 0f64);
    let p = |index: usize, axis: usize| f64::from(positions[index * 3 + axis]);
    let mut at = 0;
    while at + 2 < indices.len() {
        let (a, b, c) = (
            usize::from(indices[at]),
            usize::from(indices[at + 1]),
            usize::from(indices[at + 2]),
        );
        at += 3;
        let (ax, ay, bx, by, cx, cy) = (p(a, 0), p(a, 1), p(b, 0), p(b, 1), p(c, 0), p(c, 1));
        if p(a, 2) < floor && p(b, 2) < floor && p(c, 2) < floor {
            continue;
        }
        if p(a, 2) > top && p(b, 2) > top && p(c, 2) > top {
            continue;
        }
        match area {
            Area::Plan(shape) => {
                if !triangle_touches_plan(shape, [ax, ay], [bx, by], [cx, cy]) {
                    continue;
                }
            }
            Area::Radius(_) => {
                let dx = ax.min(bx).min(cx).max(0.0).max(-ax.max(bx).max(cx));
                let dy = ay.min(by).min(cy).max(0.0).max(-ay.max(by).max(cy));
                if dx * dx + dy * dy > limit {
                    continue;
                }
            }
        }
        for index in [a, b, c] {
            if used[index] < 0 {
                used[index] = vertices as i32;
                vertices += 1;
                sum_x += p(index, 0);
                sum_y += p(index, 1);
            }
            kept.push(used[index] as u32);
        }
    }
    if kept.is_empty() {
        return None;
    }
    let whole = vertices == count;
    let moved = |array: Vec<f32>, size: usize| {
        pick(&Some(array), size, &used, vertices, whole).unwrap_or_default()
    };
    Some(Placed {
        positions: if whole {
            positions
        } else {
            moved(positions, 3)
        },
        normals: if whole { normals } else { moved(normals, 3) },
        uvs: pick(&mesh.uvs, 2, &used, vertices, whole),
        uvs1: pick(&mesh.uvs1, 2, &used, vertices, whole),
        colours: pick(&mesh.colours, 4, &used, vertices, whole),
        colours1: pick(&mesh.colours1, 4, &used, vertices, whole),
        indices: kept,
        centre: [sum_x / vertices as f64, sum_y / vertices as f64],
    })
}

/// Сетки одной клетки — одной (`joinMeshes` JS): индексы со сдвигом, недостающие развёртки — нули, цвета — белый. Одна сетка отдаётся как есть.
pub fn join_meshes(mut list: Vec<Placed>) -> Placed {
    if list.len() == 1 {
        return list.pop().expect("одна сетка");
    }
    let vertices: usize = list.iter().map(|mesh| mesh.positions.len() / 3).sum();
    let index_count: usize = list.iter().map(|mesh| mesh.indices.len()).sum();
    let mut positions = vec![0f32; vertices * 3];
    let mut normals = vec![0f32; vertices * 3];
    let mut uvs = list
        .iter()
        .any(|mesh| mesh.uvs.is_some())
        .then(|| vec![0f32; vertices * 2]);
    let mut uvs1 = list
        .iter()
        .any(|mesh| mesh.uvs1.is_some())
        .then(|| vec![0f32; vertices * 2]);
    let mut colours = list
        .iter()
        .any(|mesh| mesh.colours.is_some())
        .then(|| vec![1f32; vertices * 4]);
    let mut indices = vec![0u32; index_count];
    let (mut vertex, mut index) = (0usize, 0usize);
    for mesh in &list {
        positions[vertex * 3..vertex * 3 + mesh.positions.len()].copy_from_slice(&mesh.positions);
        normals[vertex * 3..vertex * 3 + mesh.normals.len()].copy_from_slice(&mesh.normals);
        if let (Some(out), Some(from)) = (uvs.as_mut(), &mesh.uvs) {
            out[vertex * 2..vertex * 2 + from.len()].copy_from_slice(from);
        }
        if let (Some(out), Some(from)) = (uvs1.as_mut(), &mesh.uvs1) {
            out[vertex * 2..vertex * 2 + from.len()].copy_from_slice(from);
        }
        if let (Some(out), Some(from)) = (colours.as_mut(), &mesh.colours) {
            out[vertex * 4..vertex * 4 + from.len()].copy_from_slice(from);
        }
        for (at, value) in mesh.indices.iter().enumerate() {
            indices[index + at] = value + vertex as u32;
        }
        vertex += mesh.positions.len() / 3;
        index += mesh.indices.len();
    }
    Placed {
        positions,
        normals,
        uvs,
        uvs1,
        colours,
        colours1: None,
        indices,
        centre: [0.0, 0.0],
    }
}

/// Развёртка через `globalAnimUV0/1` шейдера, как у игры (`applyGlobalUv` JS): в `f64`, результат в `f32`.
pub fn apply_global_uv(mesh: &mut Placed, vectors: &ShaderVectors) {
    let (Some(a), Some(b)) = (vectors.get(&GLOBAL_ANIM_UV0), vectors.get(&GLOBAL_ANIM_UV1)) else {
        return;
    };
    let Some(uvs) = mesh.uvs.as_mut() else { return };
    let [a0, a1, a2] = [f64::from(a[0]), f64::from(a[1]), f64::from(a[2])];
    let [b0, b1, b2] = [f64::from(b[0]), f64::from(b[1]), f64::from(b[2])];
    if a0 == 1.0 && a1 == 0.0 && a2 == 0.0 && b0 == 0.0 && b1 == 1.0 && b2 == 0.0 {
        return;
    }
    for pair in uvs.chunks_exact_mut(2) {
        let (u, v) = (f64::from(pair[0]), f64::from(pair[1]));
        pair[0] = (a0 * u + a1 * v + a2) as f32;
        pair[1] = (b0 * u + b1 * v + b2) as f32;
    }
}

/// Пиксели палитры тинта: ширина, высота и RGBA уровня 0.
pub struct Palette<'a> {
    pub width: usize,
    pub height: usize,
    pub rgba: &'a [u8],
}

/// Цвета вершин материала (`vertexColours` JS): палитра тинта (столбец — синий канал вершины, строка — `tintValue` сущности) и альфа вершины.
pub fn vertex_colours(
    source: Option<&Vec<f32>>,
    palette: Option<&Palette>,
    vertex_alpha: bool,
    tint: u32,
    count: usize,
) -> Vec<f32> {
    let mut colours = vec![1f32; count * 4];
    let row = palette.map_or(0.0, |p| {
        (f64::from(tint)).min(p.height as f64 - 1.0).max(0.0)
    }) as usize;
    for at in 0..count {
        if let (Some(palette), Some(source)) = (palette, source) {
            let column = round(f64::from(source[at * 4 + 2]) * 255.0)
                .min(palette.width as f64 - 1.0)
                .max(0.0) as usize;
            let pixel = (row * palette.width + column) * 4;
            colours[at * 4] = (f64::from(palette.rgba[pixel]) / 255.0) as f32;
            colours[at * 4 + 1] = (f64::from(palette.rgba[pixel + 1]) / 255.0) as f32;
            colours[at * 4 + 2] = (f64::from(palette.rgba[pixel + 2]) / 255.0) as f32;
        }
        if let (true, Some(source)) = (vertex_alpha, source) {
            colours[at * 4 + 3] = source[at * 4 + 3];
        }
    }
    colours
}

/// Веса слоёв земли в цветах вершин сцены (`terrainWeights`): R — альфа первого цвета, G и B — второго набора; без второго набора — нули.
pub fn terrain_weights(mesh: &Placed) -> Vec<f32> {
    let count = mesh.positions.len() / 3;
    let mut out = vec![0f32; count * 4];
    for index in 0..count {
        let at = index * 4;
        out[at + 3] = 1.0;
        let Some(second) = &mesh.colours1 else {
            continue;
        };
        out[at] = mesh.colours.as_ref().map_or(1.0, |first| first[at + 3]);
        out[at + 1] = second[at + 1];
        out[at + 2] = second[at + 2];
    }
    out
}

/// Поверхность сетки модели, м² (`surfaceOf` JS): сумма площадей треугольников по положениям модели.
pub fn surface_of(mesh: &Mesh) -> f64 {
    let p = |index: usize, axis: usize| f64::from(mesh.positions[index * 3 + axis]);
    let mut area = 0f64;
    let mut at = 0;
    while at + 2 < mesh.indices.len() {
        let (a, b, c) = (
            usize::from(mesh.indices[at]),
            usize::from(mesh.indices[at + 1]),
            usize::from(mesh.indices[at + 2]),
        );
        at += 3;
        let (ux, uy, uz) = (p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2));
        let (vx, vy, vz) = (p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2));
        area += hypot(&[uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]) / 2.0;
    }
    area
}

#[cfg(test)]
mod tests;
