//! Обвод места: линии зон бизвара, ВЗХ и порта целиком (`outlineMeshes` в `apps/desktop/src/world-place-scene.js`).
//!
//! Линия — модели набора Astral из папки зон (`resources/recolor/zones`, они в git), а не файлы игры: у каждой зоны модели-половины (`targets`), в каждой берутся сетки с листом
//! зоны. Сетки встают в оси сцены (Y-вверх модели → Z-вверх игры), сдвинутые на `position + origin цели − начало места`, нормаль — вверх. Описание зон (`ZONES` JS) оболочка
//! присылает в запросе: так список зон остаётся один, у JS. Модель, что не разобралась, — отказ «unsupported»: прежний путь JS ведёт себя по-своему (он падает на такой модели).

use crate::ars1;
use crate::drawable;
use crate::drawable_js;
use crate::error::{Error, Result};
use crate::parallel::parallel_map_with;
use crate::resource::{Resource, ENHANCED_MODEL_VERSIONS};
use crate::shader_vectors;

use super::{unsupported, WorldSource};

/// Модель-половина обвода и лист, чьи сетки берутся.
#[derive(Debug, Clone)]
pub struct OutlineTarget {
    pub file: String,
    pub origin: [f64; 3],
    pub texture: String,
}

/// Линия обвода: материал зоны (цвет и альфа мода) и её модели.
#[derive(Debug, Clone)]
pub struct OutlineZone {
    pub id: String,
    /// Часть сцены: у обеих линий обвода она одна (`bizvar`).
    pub part: String,
    pub colour: String,
    /// Альфа мода из 255.
    pub alpha: f64,
    pub position: [f64; 3],
    pub targets: Vec<OutlineTarget>,
}

fn broken(file: &str, what: &str) -> Error {
    unsupported(&format!("outline model {file}: {what}"))
}

/// Сетки одной модели-половины; нет файла — нет сеток (как у JS: `catch(() => null)` и `continue`).
fn target_meshes(
    source: &dyn WorldSource,
    zone: &OutlineZone,
    target: &OutlineTarget,
    origin: [f64; 3],
) -> Result<Vec<ars1::Mesh>> {
    let Some(bytes) = source.zone_file(&target.file).ok().flatten() else {
        return Ok(Vec::new());
    };
    let shift = [0, 1, 2].map(|axis| zone.position[axis] + target.origin[axis] - origin[axis]);
    let res = Resource::parse(&bytes).map_err(|e| broken(&target.file, &e.message))?;
    if ENHANCED_MODEL_VERSIONS.contains(&res.version()) {
        return Err(broken(&target.file, "GTA V Enhanced"));
    }
    let Some(root) = shader_vectors::drawable_root_at(&res, false)
        .map_err(|e| broken(&target.file, &e.message))?
    else {
        return Ok(Vec::new());
    };
    let drawable = drawable_js::read_drawable_at(&res, root, drawable::Lod::High)
        .map_err(|e| broken(&target.file, &e.message))?;
    let (_, materials, _) =
        drawable::read_materials(&res, root).map_err(|e| broken(&target.file, &e.message))?;
    let wanted = target.texture.to_lowercase();
    let mut out = Vec::new();
    for mesh in &drawable.meshes {
        let named = materials
            .get(mesh.shader_index)
            .and_then(Option::as_ref)
            .is_some_and(|material| {
                material.samplers.iter().any(|sampler| {
                    sampler.texture.as_deref().unwrap_or("").to_lowercase() == wanted
                })
            });
        if !named {
            continue;
        }
        let mut positions = vec![0f32; mesh.positions.len()];
        let mut normals = vec![0f32; mesh.positions.len()];
        let mut at = 0;
        while at + 2 < positions.len() {
            positions[at] = (f64::from(mesh.positions[at]) + shift[0]) as f32;
            positions[at + 1] = (-f64::from(mesh.positions[at + 2]) + shift[1]) as f32;
            positions[at + 2] = (f64::from(mesh.positions[at + 1]) + shift[2]) as f32;
            normals[at + 2] = 1.0;
            at += 3;
        }
        out.push(ars1::Mesh {
            material: 0,
            part: 0,
            entity: None,
            positions,
            normals: Some(normals),
            uvs: mesh.uvs.clone(),
            uvs1: None,
            colours: None,
            indices: mesh.indices.iter().map(|&i| u32::from(i)).collect(),
        });
    }
    Ok(out)
}

/// Линии обвода по зонам в порядке зон: `(номер зоны, сетки)`; у зоны без сеток записи нет. Модели читаются и разбираются в пуле потоков, порядок от потоков не зависит.
pub(super) fn outline_meshes(
    source: &dyn WorldSource,
    zones: &[OutlineZone],
    origin: [f64; 3],
    threads: usize,
) -> Result<Vec<(usize, Vec<ars1::Mesh>)>> {
    let jobs: Vec<(usize, usize)> = zones
        .iter()
        .enumerate()
        .flat_map(|(zone, item)| (0..item.targets.len()).map(move |target| (zone, target)))
        .collect();
    let done = parallel_map_with(threads, &jobs, |&(zone, target)| {
        target_meshes(source, &zones[zone], &zones[zone].targets[target], origin)
    });
    let mut out: Vec<(usize, Vec<ars1::Mesh>)> = Vec::new();
    for (&(zone, _), result) in jobs.iter().zip(done) {
        let meshes = result?;
        let same_zone = out.last().is_some_and(|(last, _)| *last == zone);
        if same_zone {
            if let Some((_, list)) = out.last_mut() {
                list.extend(meshes);
            }
        } else {
            out.push((zone, meshes));
        }
    }
    out.retain(|(_, list)| !list.is_empty());
    Ok(out)
}
