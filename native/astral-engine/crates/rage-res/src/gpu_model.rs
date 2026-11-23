//! Модель игры (`.ydr`, `.ydd`, `.yft`) в ARS2 для окна лаунчера: меши по партиям шейдеров.
//!
//! Байты ARS2 делает `gpu_asset::encode`; здесь выбирается drawable, меши склеиваются и группируются.

use std::collections::HashMap;

use crate::{
    convert::{failure, matches_selector, weld, Welded},
    drawable::{self, Drawable, Entry, FileKind, Lod, Mesh, Model},
    error::{Error, Result},
    gpu_asset::{self, Batch, Lod as ArsLod, Mesh as ArsMesh},
    resource::Resource,
    shaders::shader_name,
};

#[derive(Debug, Clone)]
pub struct Ars2Model {
    pub bytes: Vec<u8>,
    pub vertices: usize,
    pub indices: usize,
    pub batches: Vec<Batch>,
    pub drawable: Option<String>,
    pub drawables: Vec<String>,
}

/// Партия: имя и её меши в порядке подачи.
type Group<'a> = (&'a str, Vec<&'a Mesh>);

/// Меши с одним именем партии подряд, партии — в порядке первого появления имени.
fn group_by_batch<'a>(parts: &'a [(String, &'a Mesh)]) -> Vec<Group<'a>> {
    let mut slot_of: HashMap<&str, usize> = HashMap::new();
    let mut groups: Vec<Group> = Vec::new();
    for (name, mesh) in parts {
        let slot = *slot_of.entry(name.as_str()).or_insert_with(|| {
            groups.push((name.as_str(), Vec::new()));
            groups.len() - 1
        });
        groups[slot].1.push(mesh);
    }
    groups
}

/// Нормаль или UV вершины из плоского массива, если он её покрывает.
fn component<const N: usize>(
    values: Option<&[f32]>,
    vertex: usize,
    fallback: [f32; N],
) -> [f32; N] {
    values
        .and_then(|all| all.get(vertex * N..)?.first_chunk::<N>())
        .copied()
        .unwrap_or(fallback)
}

/// Дописывает вершины и индексы меша; индексы сдвигаются на число уже лежащих вершин.
fn append_mesh(mesh: &Mesh, out: &mut ArsMesh) {
    let base = out.positions.len() as u32;
    let count = mesh.vertex_count();
    out.positions.extend((0..count).map(|vertex| -> [f32; 3] {
        std::array::from_fn(|axis| mesh.positions[vertex * 3 + axis])
    }));
    let normals =
        (0..count).map(|vertex| component(mesh.normals.as_deref(), vertex, [0.0, 0.0, 1.0]));
    out.normals.extend(normals);
    let uvs = (0..count).map(|vertex| component(mesh.uvs.as_deref(), vertex, [0.0, 0.0]));
    out.uvs.extend(uvs);
    out.indices
        .extend(mesh.indices.iter().map(|&index| base + u32::from(index)));
}

pub fn meshes_to_ars2(parts: &[(String, &Mesh)]) -> Result<ArsMesh> {
    let groups = group_by_batch(parts);
    let mut out = ArsMesh::default();
    for (name, meshes) in groups {
        let first = out.indices.len();
        meshes
            .into_iter()
            .for_each(|mesh| append_mesh(mesh, &mut out));
        let added = out.indices.len() - first;
        if added == 0 {
            continue;
        }
        out.batches.push(Batch {
            material: name.to_owned(),
            first: first as u32,
            count: added as u32,
        });
    }
    let Some(total) = (!out.indices.is_empty()).then_some(out.indices.len() as u32) else {
        return Err(Error::broken("В модели нет треугольников."));
    };
    out.lods.extend([ArsLod {
        name: String::from("#high"),
        first: 0,
        count: total,
    }]);
    Ok(out)
}

/// Разобранный ресурс и словарь моделей в нём.
struct Dictionary {
    resource: Resource,
    model: Model,
}

impl Dictionary {
    fn open(bytes: &[u8], kind: Option<FileKind>) -> Result<Dictionary> {
        Resource::parse(bytes).and_then(|resource| {
            drawable::open_model(&resource, kind).map(|model| Dictionary { resource, model })
        })
    }

    /// Подписи всех записей словаря в его порядке.
    fn labels(&self) -> Vec<String> {
        let entries = self.model.entries.iter();
        entries.map(drawable::entry_label).collect::<Vec<_>>()
    }

    /// Выбранная запись словаря: номер и прочитанный drawable с хотя бы одним уровнем.
    fn choose(&self, selector: Option<&str>) -> Result<(usize, Drawable)> {
        let entries = &self.model.entries;
        let read = |entry: &Entry| {
            drawable::read_drawable_at(&self.resource, entry.at, Lod::High, entry.hash)
        };
        // С выбором смотрим одну найденную запись, без выбора — все по порядку.
        let candidates = match selector.filter(|text| !text.trim().is_empty()) {
            Some(text) => {
                let found = entries
                    .iter()
                    .position(|entry| matches_selector(entry, text));
                let index = found.ok_or_else(failure)?;
                index..index + 1
            }
            None => 0..entries.len(),
        };
        for index in candidates {
            let item = read(&entries[index])?;
            if item.lod.is_some() {
                return Ok((index, item));
            }
        }
        Err(failure())
    }
}

/// Имя партии меша: шейдер его материала.
fn batch_name(item: &Drawable, mesh: &Mesh) -> String {
    let hash = match item.material_of(mesh) {
        Some(material) => material.shader_hash,
        None => return "default".to_owned(),
    };
    shader_name(hash)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("<unknown:{hash}>"))
}

/// Меш после склейки одинаковых вершин: только то, что нужно ARS2.
fn welded_copy(mesh: &Mesh) -> Mesh {
    let Welded {
        positions,
        normals,
        uvs,
        indices,
        ..
    } = weld(mesh, false);
    Mesh {
        positions,
        normals,
        uvs,
        indices,
        shader_index: mesh.shader_index,
        ..Mesh::default()
    }
}

pub fn model_to_ars2(
    bytes: &[u8],
    kind: Option<FileKind>,
    selector: Option<&str>,
) -> Result<Ars2Model> {
    let dictionary = Dictionary::open(bytes, kind)?;
    let drawables = dictionary.labels();
    let (index, item) = dictionary.choose(selector)?;

    let (names, meshes): (Vec<String>, Vec<Mesh>) = item
        .meshes
        .iter()
        .map(|mesh| (batch_name(&item, mesh), welded_copy(mesh)))
        .unzip();
    let parts: Vec<(String, &Mesh)> = names.into_iter().zip(&meshes).collect();
    let combined = meshes_to_ars2(&parts)?;
    let bytes = gpu_asset::encode(&combined)?;

    let named = selector.is_some() && dictionary.model.kind == FileKind::Ydd;
    let chosen = named.then(|| drawables[index].clone());
    Ok(Ars2Model {
        vertices: combined.positions.len(),
        indices: combined.indices.len(),
        batches: combined.batches,
        drawable: chosen,
        drawables,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::resource::Header;

    /// Плоский список координат из точек.
    fn flat(points: &[[f32; 3]]) -> Vec<f32> {
        points.iter().flatten().copied().collect()
    }

    /// Меш из одних координат.
    fn solid(positions: Vec<f32>) -> Mesh {
        Mesh {
            positions,
            ..Mesh::default()
        }
    }

    fn triangle(shift: f32) -> Mesh {
        let corners = [
            [shift, 0.0, 0.0],
            [shift + 1.0, 0.0, 0.0],
            [shift, 1.0, 0.0],
        ];
        Mesh {
            indices: vec![0, 1, 2],
            ..solid(flat(&corners))
        }
    }

    fn run(parts: &[(&str, &Mesh)]) -> Result<ArsMesh> {
        let owned: Vec<(String, &Mesh)> = parts
            .iter()
            .map(|&(name, mesh)| (name.to_owned(), mesh))
            .collect();
        meshes_to_ars2(&owned)
    }

    /// Удачный `run`.
    fn built(parts: &[(&str, &Mesh)]) -> ArsMesh {
        run(parts).expect("меш должен собраться")
    }

    /// Партии меша одной строкой: `материал@начало+число`, через пробел.
    fn batch_rows(mesh: &ArsMesh) -> String {
        let rows: Vec<String> = mesh
            .batches
            .iter()
            .map(|batch| format!("{}@{}+{}", batch.material, batch.first, batch.count))
            .collect();
        rows.join(" ")
    }

    /// Первый уровень меша в той же записи.
    fn first_lod(mesh: &ArsMesh) -> String {
        let lod = mesh.lods.first().expect("нет ни одного уровня");
        format!("{}@{}+{}", lod.name, lod.first, lod.count)
    }

    fn refusal<T>(result: Result<T>) -> (Kind, String) {
        match result {
            Ok(_) => panic!("ожидалась ошибка"),
            Err(error) => (error.kind, error.message),
        }
    }

    /// Меш после кодирования и обратного разбора.
    fn round_trip(mesh: &ArsMesh) -> ArsMesh {
        gpu_asset::decode(&gpu_asset::encode(mesh).unwrap()).unwrap()
    }

    const NO_TRIANGLES: &str = "В модели нет треугольников.";

    #[test]
    fn one_triangle_gets_defaults() {
        let mesh = built(&[("default", &triangle(0.0))]);
        let corners = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let expected = corners.map(|corner| (corner, [0.0, 0.0, 1.0], [0.0, 0.0]));
        let rows: Vec<_> = mesh
            .positions
            .iter()
            .zip(&mesh.normals)
            .zip(&mesh.uvs)
            .map(|((&point, &normal), &uv)| (point, normal, uv))
            .collect();
        assert_eq!(rows, expected);
        assert_eq!(mesh.indices, [0, 1, 2]);
        assert_eq!(batch_rows(&mesh), "default@0+3");
        assert_eq!(first_lod(&mesh), "#high@0+3");
    }

    #[test]
    fn meshes_are_grouped_by_batch_in_first_seen_order() {
        let (a, b, c) = (triangle(0.0), triangle(5.0), triangle(10.0));
        let mesh = built(&[("paint", &a), ("glass", &b), ("paint", &c)]);
        let xs: Vec<f32> = mesh.positions.iter().map(|point| point[0]).collect();
        let order: Vec<f32> = [0.0, 10.0, 5.0]
            .into_iter()
            .flat_map(|shift| [shift, shift + 1.0, shift])
            .collect();
        assert_eq!(xs, order);
        assert!(mesh.indices.iter().copied().eq(0..9));
        assert_eq!(batch_rows(&mesh), "paint@0+6 glass@6+3");
        assert_eq!(first_lod(&mesh), "#high@0+9");
    }

    #[test]
    fn batch_names_are_exact() {
        let a = triangle(0.0);
        let b = triangle(5.0);
        let cases: [(Vec<(&str, &Mesh)>, &str); 2] = [
            (vec![("Paint", &a), ("paint", &b)], "Paint@0+3 paint@3+3"),
            (vec![("", &a)], "@0+3"),
        ];
        for (parts, expected) in &cases {
            assert_eq!(&batch_rows(&built(parts)), expected);
        }
    }

    #[test]
    fn nothing_to_draw_is_refused() {
        let empties = [Mesh::default(), solid(vec![0.0; 6])];
        let mut outcomes = vec![refusal(run(&[]))];
        outcomes.extend(empties.iter().map(|mesh| refusal(run(&[("x", mesh)]))));
        for outcome in outcomes {
            assert_eq!(outcome, (Kind::Broken, NO_TRIANGLES.to_owned()));
        }
    }

    #[test]
    fn orphan_vertices_shift_later_indices() {
        let orphan = solid(flat(&[[9.0, 9.0, 9.0], [8.0, 8.0, 8.0]]));
        let tri = triangle(0.0);
        let mesh = built(&[("orphan", &orphan), ("x", &tri)]);
        assert_eq!(mesh.positions.len(), 5);
        assert_eq!(mesh.indices, [2, 3, 4]);
        assert_eq!(batch_rows(&mesh), "x@0+3");
    }

    #[test]
    fn short_normals_and_uvs_fall_back_per_vertex() {
        let mesh = Mesh {
            normals: Some(flat(&[[0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])),
            uvs: Some(vec![0.1, 0.2, 0.3, 0.4, 0.5]),
            ..triangle(0.0)
        };
        let out = built(&[("x", &mesh)]);
        assert_eq!(
            out.normals,
            [[0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]
        );
        assert_eq!(out.uvs, [[0.1, 0.2], [0.3, 0.4], [0.0, 0.0]]);
    }

    #[test]
    fn indices_are_not_checked_against_vertices() {
        let tail = Mesh {
            indices: vec![0, 1, 2],
            ..solid([flat(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]), vec![5.0]].concat())
        };
        let out = built(&[("x", &tail)]);
        assert_eq!(out.positions.len(), 2);
        assert_eq!(out.indices, [0, 1, 2]);
        let (kind, message) = refusal(gpu_asset::encode(&out));
        assert_eq!(kind, Kind::Argument);
        assert_eq!(message, "Индекс смотрит мимо вершин.");

        let far = Mesh {
            indices: vec![65535; 3],
            ..solid(vec![0.0; 9])
        };
        let out = built(&[("x", &far), ("x", &far)]);
        assert_eq!(out.indices, [65535, 65535, 65535, 65538, 65538, 65538]);
        assert_eq!(batch_rows(&out), "x@0+6");
    }

    #[test]
    fn odd_positions_pass_through() {
        let points = [
            [f32::NAN, f32::INFINITY, -0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        ];
        let mesh = Mesh {
            indices: vec![0, 1, 2],
            ..solid(flat(&points))
        };
        let out = built(&[("x", &mesh)]);
        let [nan, infinity, negative_zero] = out.positions[0];
        assert!(nan.is_nan());
        assert_eq!(infinity, f32::INFINITY);
        assert!(negative_zero.is_sign_negative());
    }

    #[test]
    fn missing_normals_and_the_result_encodes() {
        let out = built(&[("x", &triangle(0.0))]);
        assert_eq!(out.normals[0], [0.0, 0.0, 1.0]);
        assert_eq!(out.uvs[0], [0.0, 0.0]);
        let back = round_trip(&out);
        assert_eq!(back.batches, out.batches);
        assert_eq!(back.indices, out.indices);
    }

    #[test]
    fn welding_of_duplicates_keeps_equal_triangles() {
        let corners = flat(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]);
        let doubled = Mesh {
            indices: (0..6).collect(),
            ..solid(corners.repeat(2))
        };
        let glued = weld(&doubled, false);
        assert_eq!(glued.positions.len(), 9);
        assert_eq!(glued.indices, [0, 1, 2, 0, 1, 2]);
    }

    fn file(version: u32, size: usize) -> Vec<u8> {
        let (high, low) = (version >> 4, version & 0xf);
        let header = Header {
            version,
            declared_version: version,
            system_flags: (high << 28) | (2 << 17),
            graphics_flags: low << 28,
            system_size: size,
            graphics_size: 0,
        };
        let resource = Resource::from_parts(header, vec![0; size]);
        resource.to_file_bytes().unwrap()
    }

    #[test]
    fn garbage_bytes_are_refused_without_panic() {
        let short = (Kind::Broken, "Ресурс короче заголовка RSC7.".to_owned());
        let inputs: [&[u8]; 2] = [b"", b"not a resource"];
        let outcomes = inputs.map(|bytes| refusal(model_to_ars2(bytes, Some(FileKind::Ydr), None)));
        assert_eq!(outcomes, [short.clone(), short]);
    }

    #[test]
    fn foreign_and_enhanced_versions() {
        let dictionary = file(13, 0x4000);
        let enhanced = file(154, 0x4000);
        let cases = [
            (
                &dictionary,
                None,
                Kind::Version,
                "Это не модель GTA V Legacy (версия ресурса 13).",
            ),
            (
                &dictionary,
                Some(FileKind::Ydr),
                Kind::Broken,
                "Model conversion failed.",
            ),
            (
                &enhanced,
                None,
                Kind::Enhanced,
                "Модель из GTA V Enhanced (версия 154): Astral читает модели Legacy.",
            ),
        ];
        for (bytes, kind, want_kind, want_text) in cases {
            let got = refusal(model_to_ars2(bytes, kind, None));
            assert_eq!(got, (want_kind, want_text.to_owned()));
        }
    }
}
