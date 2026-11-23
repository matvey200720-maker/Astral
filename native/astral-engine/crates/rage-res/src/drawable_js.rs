//! Сетки модели **так, как их читает `readDrawable`** пакета `packages/rage-drawable` — вторая мода чтения рядом с `drawable.rs`.
//!
//! Нужна сборщикам сцен (интерьеры, зоны): их JS-версия кладёт в файл сцены числа читателя JS, а не читателя `drawable.rs`, и Rust обязан дать
//! те же биты. Отличия от `drawable.rs` (его поведение и его потребители не тронуты):
//!
//! * **нормали** — как записаны в вершине, без приведения к единице (читатель `drawable.rs` приводит к единице до перестановки осей);
//! * **матрица кости** — если геометрия привязана к кости (флаг кожи в связке модели равен 0, номер кости меньше числа костей), положения и
//!   нормали проходят через абсолютную матрицу кости в `f64` и только потом округляются до `f32`; нормаль после матрицы приводится к единице
//!   (`Math.hypot`, при нуле — единица). У `drawable.rs` матрица — отдельное поле меша, а своя цепочка костей — в `f32`;
//! * **второй набор цвета** (`colours1`, семантика 5): у земли в нём веса слоёв (`terrain_cb_*`); у `drawable.rs` его нет;
//! * оси те же, что у `drawable.rs`: игра (x, y, z) → (x, z, −y).
//!
//! Скелет и кожа (веса, номера костей) не читаются: сборщики сцен зовут `readDrawable` без `skin`.

use crate::drawable::{
    drawable_name, geometry_slots, level_models, read_declaration, read_indices, Lod, VertexBuffer,
    MAX_VERTICES, MSG_VERTEX_BUFFER,
};
use crate::error::{Error, Result};
use crate::js_math::hypot;
use crate::resource::Resource;
use crate::vertex;

const BONE_SIZE: usize = 0x50;
const MAX_BONES: usize = 1024;

type Matrix = [f64; 16];

/// Одна геометрия модели, как её видит читатель JS.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub uvs1: Option<Vec<f32>>,
    pub colours: Option<Vec<f32>>,
    pub colours1: Option<Vec<f32>>,
    pub indices: Vec<u16>,
    pub shader_index: usize,
    /// Номер кости, к которой привязана модель; `None` — у кожи.
    pub bone_index: Option<u8>,
    /// В вершинах есть веса кожи.
    pub skinned: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Drawable {
    pub name: Option<String>,
    /// Прочитанный уровень (запрошенный, а нет его — первый из имеющихся).
    pub lod: Option<Lod>,
    pub meshes: Vec<Mesh>,
}

// ------------------------------------------------------------------ матрицы костей в f64

fn floats<const N: usize>(res: &Resource, at: usize) -> Result<[f32; N]> {
    let mut out = [0f32; N];
    for (step, slot) in out.iter_mut().enumerate() {
        *slot = res.f32(at + step * 4)?;
    }
    Ok(out)
}

/// `localMatrix` JS: столбцы осей, умноженные на масштаб оси, и столбец переноса; всё в `f64`.
fn local_matrix(rotation: [f32; 4], translation: [f32; 3], scale: [f64; 3]) -> Matrix {
    let [x, y, z, w] = rotation.map(f64::from);
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let columns = [
        [1.0 - (yy + zz), xy + wz, xz - wy],
        [xy - wz, 1.0 - (xx + zz), yz + wx],
        [xz + wy, yz - wx, 1.0 - (xx + yy)],
    ];
    let mut out = [0.0; 16];
    for (column, values) in columns.iter().enumerate() {
        for (row, value) in values.iter().enumerate() {
            out[column * 4 + row] = value * scale[column];
        }
        out[column * 4 + 3] = 0.0;
    }
    let [tx, ty, tz] = translation.map(f64::from);
    out[12..].copy_from_slice(&[tx, ty, tz, 1.0]);
    out
}

/// `multiply` JS: сумма начинается с +0 (так `0 + (−0)` даёт +0, как у `reduce` с нулевым началом).
fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    std::array::from_fn(|cell| {
        let (column, row) = (cell >> 2, cell & 3);
        (0..4).fold(0.0, |sum, k| sum + a[k * 4 + row] * b[column * 4 + k])
    })
}

/// `absoluteMatrices` JS: цепочка предков считается от корня вниз; кольцо (цепочка длиннее предела костей) — отказ.
fn absolute_matrices(parents: &[i16], locals: &[Matrix]) -> Result<Vec<Matrix>> {
    let count = locals.len();
    let parent_of = |index: usize| {
        let parent = parents[index];
        usize::try_from(parent)
            .ok()
            .filter(|&p| p < count && p != index)
    };
    let mut solved: Vec<Option<Matrix>> = vec![None; count];
    for start in 0..count {
        let mut line = Vec::new();
        let mut at = Some(start);
        while let Some(index) = at.filter(|&index| solved[index].is_none()) {
            line.push(index);
            if line.len() > MAX_BONES {
                return Err(Error::broken("Кольцо в скелете модели."));
            }
            at = parent_of(index);
        }
        for &index in line.iter().rev() {
            let matrix = match parent_of(index) {
                None => locals[index],
                Some(parent) => multiply(
                    &solved[parent].expect("родитель посчитан раньше"),
                    &locals[index],
                ),
            };
            solved[index] = Some(matrix);
        }
    }
    Ok(solved
        .into_iter()
        .map(|matrix| matrix.expect("посчитана"))
        .collect())
}

/// Абсолютные матрицы костей модели в `f64` (столбцами, как у JS); нет скелета или он не читается — пусто.
pub fn skeleton_matrices(res: &Resource, drawable_at: usize) -> Result<Vec<[f64; 16]>> {
    let Some(skeleton) = res.pointer_at(drawable_at + 0x18) else {
        return Ok(Vec::new());
    };
    let array = res.pointer_at(skeleton + 0x20);
    let count = usize::from(res.u16(skeleton + 0x5e)?);
    let Some(first) = array.filter(|&first| {
        count != 0 && count <= MAX_BONES && first + count * BONE_SIZE <= res.len()
    }) else {
        return Ok(Vec::new());
    };
    let mut parents = Vec::with_capacity(count);
    let mut locals = Vec::with_capacity(count);
    for index in 0..count {
        let at = first + index * BONE_SIZE;
        let rotation: [f32; 4] = floats(res, at)?;
        let translation: [f32; 3] = floats(res, at + 0x10)?;
        let scale: [f32; 3] = floats(res, at + 0x20)?;
        // `value || 1`: ноль (в том числе −0) и NaN дают единицу.
        let scale = scale.map(|value| {
            if value == 0.0 || value.is_nan() {
                1.0
            } else {
                f64::from(value)
            }
        });
        parents.push(res.i16(at + 0x32)?);
        locals.push(local_matrix(rotation, translation, scale));
    }
    absolute_matrices(&parents, &locals)
}

// ------------------------------------------------------------------ вершины

/// Сумма произведений строки матрицы на вектор: `((m0·x + m4·y) + m8·z)`.
fn row_dot(m: &Matrix, row: usize, [x, y, z]: [f64; 3]) -> f64 {
    m[row] * x + m[row + 4] * y + m[row + 8] * z
}

fn transform_point(m: &Matrix, v: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|row| row_dot(m, row, v) + m[12 + row])
}

fn transform_direction(m: &Matrix, v: [f64; 3]) -> [f64; 3] {
    let turned = [0, 1, 2].map(|row| row_dot(m, row, v));
    let length = hypot(&turned);
    let length = if length == 0.0 || length.is_nan() {
        1.0
    } else {
        length
    };
    turned.map(|value| value / length)
}

/// Оси игры → оси сцены `(x, y, z) → (x, z, −y)`, число — в `f32`.
fn push_y_up(out: &mut Vec<f32>, [x, y, z]: [f64; 3]) {
    out.extend([x as f32, z as f32, (-y) as f32]);
}

struct Elements {
    position: vertex::Element,
    normal: Option<vertex::Element>,
    uv0: Option<vertex::Element>,
    uv1: Option<vertex::Element>,
    colour0: Option<vertex::Element>,
    colour1: Option<vertex::Element>,
}

fn read_geometry(res: &Resource, geometry: usize, matrix: Option<&Matrix>) -> Result<Option<Mesh>> {
    let Some(buffer) = VertexBuffer::read(res, geometry)? else {
        return Ok(None);
    };
    let Some(index_buffer) = res.pointer_at(geometry + 0x38) else {
        return Ok(None);
    };
    let (Some(data), Some(declaration)) = (buffer.data, buffer.declaration) else {
        return Ok(None);
    };
    if buffer.count == 0 {
        return Ok(None);
    }
    let (layout, declared_stride) = read_declaration(res, declaration)?;
    let stride = buffer.effective_stride(declared_stride, &layout);
    let count = buffer.count;
    if count > MAX_VERTICES || stride < 12 || data + count * stride > res.len() {
        return Err(Error::broken(MSG_VERTEX_BUFFER));
    }
    let position = layout
        .get(vertex::POSITION)
        .ok_or_else(|| Error::broken("Геометрия модели без позиций вершин."))?;
    let indices = read_indices(res, index_buffer, count)?;
    let found = Elements {
        position,
        normal: layout.get(vertex::NORMAL),
        uv0: layout.get(vertex::UV0),
        uv1: layout.get(vertex::UV1),
        colour0: layout.get(vertex::COLOUR0),
        colour1: layout.get(vertex::COLOUR1),
    };
    let skinned = layout.get(vertex::BLEND_WEIGHTS).is_some();

    let mut mesh = Mesh {
        positions: Vec::with_capacity(count * 3),
        normals: found.normal.map(|_| Vec::with_capacity(count * 3)),
        uvs: found.uv0.map(|_| vec![0.0; count * 2]),
        uvs1: found.uv1.map(|_| vec![0.0; count * 2]),
        colours: found.colour0.map(|_| vec![0.0; count * 4]),
        colours1: found.colour1.map(|_| vec![0.0; count * 4]),
        indices,
        skinned,
        ..Mesh::default()
    };
    let block = res.bytes(data, count * stride)?;
    for (n, bytes) in block.chunks_exact(stride).enumerate() {
        // Позиция, которую не удалось прочитать, — отказ геометрии (у JS старые числа рабочего массива; у Rust отказ, как у `drawable.rs`).
        let mut at = [0f32; 3];
        if !vertex::read_components(bytes, found.position, &mut at) {
            return Err(Error::broken(
                "Геометрия модели: позиция вершины не читается (тип не поддержан).",
            ));
        }
        let point = at.map(f64::from);
        match matrix {
            Some(m) => push_y_up(&mut mesh.positions, transform_point(m, point)),
            None => push_y_up(&mut mesh.positions, point),
        }
        if let (Some(element), Some(out)) = (found.normal, mesh.normals.as_mut()) {
            let mut work = [0f32; 3];
            vertex::read_components(bytes, element, &mut work);
            let direction = work.map(f64::from);
            match matrix {
                Some(m) => push_y_up(out, transform_direction(m, direction)),
                None => push_y_up(out, direction),
            }
        }
        for (element, out, width) in [
            (found.uv0, &mut mesh.uvs, 2),
            (found.uv1, &mut mesh.uvs1, 2),
            (found.colour0, &mut mesh.colours, 4),
            (found.colour1, &mut mesh.colours1, 4),
        ] {
            if let (Some(element), Some(out)) = (element, out.as_mut()) {
                vertex::read_components(bytes, element, &mut out[n * width..(n + 1) * width]);
            }
        }
    }
    Ok(Some(mesh))
}

// ------------------------------------------------------------------ модели и уровни

/// Сетки одной модели: номер таблицы шейдеров — по слоту геометрии, матрица — по связке модели.
fn model_meshes(res: &Resource, model: usize, matrices: &[Matrix]) -> Result<Vec<Mesh>> {
    let mapping = res.pointer_at(model + 0x20);
    let binding = res.u32(model + 0x28)?;
    let skin_flag = (binding >> 8) & 0xff != 0;
    let bone = (binding >> 24) as u8;
    let matrix = (!skin_flag)
        .then(|| matrices.get(usize::from(bone)))
        .flatten();
    let mut meshes = Vec::new();
    for (slot, geometry) in geometry_slots(res, model, true)? {
        let Some(mut mesh) = read_geometry(res, geometry, matrix)? else {
            continue;
        };
        mesh.shader_index = match mapping {
            Some(table) => usize::from(res.u16(table + slot * 2)?),
            None => 0,
        };
        mesh.bone_index = (!skin_flag).then_some(bone);
        meshes.push(mesh);
    }
    Ok(meshes)
}

fn read_level(
    res: &Resource,
    drawable_at: usize,
    lod: Lod,
    matrices: &[Matrix],
) -> Result<Option<Vec<Mesh>>> {
    let models = level_models(res, drawable_at, lod)?;
    if models.is_empty() {
        return Ok(None);
    }
    let per_model = models
        .iter()
        .map(|&model| model_meshes(res, model, matrices))
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(per_model.into_iter().flatten().collect()))
}

/// Модель по смещению: сначала запрошенный уровень, потом остальные по порядку, пока не найдётся уровень с частями.
pub fn read_drawable_at(res: &Resource, drawable_at: usize, lod: Lod) -> Result<Drawable> {
    let matrices = skeleton_matrices(res, drawable_at)?;
    let chosen = lod
        .fallback()
        .find_map(|level| {
            read_level(res, drawable_at, level, &matrices)
                .transpose()
                .map(|meshes| meshes.map(|m| (level, m)))
        })
        .transpose()?;
    let (lod, meshes) = match chosen {
        Some((level, meshes)) => (Some(level), meshes),
        None => (None, Vec::new()),
    };
    Ok(Drawable {
        name: drawable_name(res, drawable_at),
        lod,
        meshes,
    })
}

#[cfg(test)]
mod tests;
