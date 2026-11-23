//! Модель игры в один GLB и выгрузка словарей текстур в PNG.
//!
//! Ресурс и вершины сюда не открываются: модуль берёт готовые меши, материалы
//! и текстуры у соседей, склеивает вершины и собирает сцену для `glb::write`.

use std::collections::hash_map::Entry as Slot;
use std::collections::HashMap;

use crate::{
    drawable::{self, Drawable, Entry, FileKind, Lod, Mesh},
    error::{Error, Result},
    glb::{self, ImageData, MaterialData, MeshData, NodeData, Scene, SkinData},
    hash::joaat,
    math::{invert, matrix_to_gltf, nearly_identity, IDENTITY},
    parallel::parallel_map,
    png_io,
    resource::Resource,
    shaders::{shader_name, AlphaMode, Role},
    texture::{self, TextureRef},
};

const PLACEHOLDERS: [&str; 4] = ["none", "givemechecker", "checker", "null"];
const TINY: f32 = 1e-6;

pub struct Converted {
    pub glb: Vec<u8>,
    pub drawables: Vec<String>,
    pub selected: Option<String>,
    /// Что пошло не так, но модель всё равно собрана (например, текстура из внешнего
    /// словаря найдена и не декодируется).
    pub warnings: Vec<String>,
}

pub(crate) fn failure() -> Error {
    Error::broken("Model conversion failed.")
}

/// Внешние словари; те, у кого в имени `+hi`, стоят впереди.
#[derive(Default)]
pub struct Library {
    dictionaries: Vec<Dictionary>,
}

/// Один `.ytd`: разобранный ресурс и список его текстур.
pub struct Dictionary {
    pub name: String,
    resource: Resource,
    textures: Vec<TextureRef>,
}

impl Dictionary {
    pub fn parse(name: &str, bytes: &[u8]) -> Result<Self> {
        let resource = Resource::parse(bytes)?;
        texture::read_dictionary(&resource).map(|textures| Self {
            name: name.to_owned(),
            resource,
            textures,
        })
    }

    pub fn textures(&self) -> &[TextureRef] {
        &self.textures
    }

    pub fn resource(&self) -> &Resource {
        &self.resource
    }
}

impl Library {
    pub fn load(files: &[(String, Vec<u8>)]) -> Result<Self> {
        let is_hi = |name: &str| name.to_ascii_lowercase().contains("+hi");
        let mut ordered: Vec<&(String, Vec<u8>)> = files.iter().collect();
        ordered.sort_by_key(|(name, _)| !is_hi(name));
        let mut dictionaries = Vec::with_capacity(ordered.len());
        for (name, bytes) in ordered {
            dictionaries.push(Dictionary::parse(name, bytes)?);
        }
        Ok(Self { dictionaries })
    }

    pub fn is_empty(&self) -> bool {
        self.dictionaries.is_empty()
    }

    pub fn find_in(&self, name: &str) -> Option<(usize, &Resource, &TextureRef)> {
        for (index, dictionary) in self.dictionaries.iter().enumerate() {
            let found = dictionary
                .textures
                .iter()
                .find(|texture| texture.name.eq_ignore_ascii_case(name));
            if let Some(texture) = found {
                return Some((index, &dictionary.resource, texture));
            }
        }
        None
    }

    pub fn dictionary(&self, index: usize) -> &Dictionary {
        &self.dictionaries[index]
    }
}

// ---------------------------------------------------------------- выбор записи

fn strip_ydd(text: &str) -> Option<&str> {
    let cut = text.len().checked_sub(4)?;
    let tail_is_ydd = text.is_char_boundary(cut) && text[cut..].eq_ignore_ascii_case(".ydd");
    tail_is_ydd.then(|| &text[..cut])
}

/// Подходит ли запись под текст пользователя: по названию или по имени из игры.
pub(crate) fn matches_selector(entry: &Entry, selector: &str) -> bool {
    // Суффикс «.ydd» отбрасывается без учёта регистра и сколько угодно раз.
    let bare = std::iter::successors(Some(selector.trim()), |text| strip_ydd(text))
        .last()
        .unwrap_or_default();
    if bare.is_empty() {
        return false;
    }
    let lowered = bare.to_lowercase();
    let by_label = drawable::entry_label(entry).to_lowercase() == lowered;
    by_label || entry.hash == Some(joaat(&lowered))
}

/// Прочитать запись, которую нужно превратить в сцену.
fn pick_drawable(
    res: &Resource,
    model: &drawable::Model,
    selector: Option<&str>,
) -> Result<(Entry, Drawable)> {
    let read = |entry: &Entry| drawable::read_drawable_at(res, entry.at, Lod::High, entry.hash);
    let chosen = match selector.map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => {
            let entry = model
                .entries
                .iter()
                .find(|entry| matches_selector(entry, text))
                .ok_or_else(failure)?;
            Some((*entry, read(entry)?))
        }
        None => model
            .entries
            .iter()
            .find_map(|entry| match read(entry) {
                Ok(item) if item.lod.is_none() => None,
                Ok(item) => Some(Ok((*entry, item))),
                Err(error) => Some(Err(error)),
            })
            .transpose()?,
    };
    match chosen {
        Some((entry, item)) if item.lod.is_some() => Ok((entry, item)),
        _ => Err(failure()),
    }
}

pub fn model_to_glb(
    bytes: &[u8],
    kind: Option<FileKind>,
    library: &Library,
    selector: Option<&str>,
) -> Result<Converted> {
    let res = Resource::parse(bytes)?;
    let model = drawable::open_model(&res, kind)?;
    let drawables = model.entries.iter().map(drawable::entry_label).collect();
    let (entry, item) = pick_drawable(&res, &model, selector)?;
    let is_ydd = model.kind == FileKind::Ydd;
    let selected = selector.filter(|_| is_ydd).map(str::to_owned);
    let (glb, warnings) = scene_glb(&item, &res, library, &drawable::entry_label(&entry))?;
    Ok(Converted {
        glb,
        drawables,
        selected,
        warnings,
    })
}

// ---------------------------------------------------------------- материалы и текстуры

fn is_placeholder(name: &str) -> bool {
    PLACEHOLDERS
        .iter()
        .any(|stub| name.eq_ignore_ascii_case(stub))
}

/// Имя текстуры роли, если оно настоящее, а не заглушка.
fn real_texture(material: Option<&drawable::Material>, role: Role) -> Option<&str> {
    let name = material?.textures.get(&role)?.as_str();
    (!name.is_empty() && !is_placeholder(name)).then_some(name)
}

fn material_at(item: &Drawable, index: usize) -> Option<&drawable::Material> {
    item.materials.get(index).and_then(Option::as_ref)
}

/// PNG самого большого уровня; `None`, если не декодировалось или не закодировалось.
fn texture_png(res: &Resource, texture: &TextureRef) -> Option<Vec<u8>> {
    let image = texture::decode(res, texture, Some(0), None).ok()?;
    png_io::encode(image.width, image.height, &image.rgba).ok()
}

/// Использованные номера шейдеров в порядке первого появления.
fn used_shaders(item: &Drawable) -> Vec<usize> {
    item.meshes
        .iter()
        .map(|mesh| mesh.shader_index)
        .fold(Vec::new(), |mut seen, index| {
            if !seen.contains(&index) {
                seen.push(index);
            }
            seen
        })
}

/// Нужные текстуры без повторов, по нижнему регистру.
fn wanted_textures(item: &Drawable, used: &[usize]) -> Vec<String> {
    let names = used.iter().flat_map(|&index| {
        [Role::Diffuse, Role::Normal].map(|role| real_texture(material_at(item, index), role))
    });
    names
        .flatten()
        .map(str::to_lowercase)
        .fold(Vec::new(), |mut seen, lowered| {
            if !seen.contains(&lowered) {
                seen.push(lowered);
            }
            seen
        })
}

/// Картинки сцены: сами картинки, номер картинки по имени текстуры и предупреждения.
struct Pictures<'a> {
    images: Vec<ImageData>,
    index_of: HashMap<&'a str, usize>,
    warnings: Vec<String>,
}

impl<'a> Pictures<'a> {
    /// Кодирует каждую нужную текстуру; одинаковые PNG делят одну картинку.
    fn gather(wanted: &'a [String], item: &Drawable, res: &Resource, library: &Library) -> Self {
        // Второй элемент: текстура нашлась во внешнем словаре (отдельный отказ — предупреждение).
        let pngs = parallel_map(wanted, |name| match library.find_in(name) {
            Some((_, owner, texture)) => (texture_png(owner, texture), true),
            None => {
                let embedded = item
                    .embedded_textures
                    .iter()
                    .find(|texture| texture.name.eq_ignore_ascii_case(name));
                (
                    embedded.and_then(|texture| texture_png(res, texture)),
                    false,
                )
            }
        });
        let mut pictures = Pictures {
            images: Vec::new(),
            index_of: HashMap::new(),
            warnings: Vec::new(),
        };
        for (name, (png, from_library)) in wanted.iter().zip(pngs) {
            match png {
                Some(bytes) => {
                    let at = pictures.place(bytes);
                    pictures.index_of.insert(name.as_str(), at);
                }
                None if from_library => pictures.warnings.push(format!(
                    "Текстура {name}: найдена во внешнем словаре, но не декодируется."
                )),
                None => {}
            }
        }
        pictures
    }

    /// Номер картинки с этими байтами; новая добавляется в конец.
    fn place(&mut self, bytes: Vec<u8>) -> usize {
        if let Some(at) = self.images.iter().position(|image| image.bytes == bytes) {
            return at;
        }
        self.images.push(ImageData {
            bytes,
            mime_type: "image/png",
        });
        self.images.len() - 1
    }

    fn of(&self, material: Option<&drawable::Material>, role: Role) -> Option<usize> {
        let name = real_texture(material, role)?;
        self.index_of.get(name.to_lowercase().as_str()).copied()
    }
}

fn material_set(item: &Drawable, used: &[usize], pictures: &Pictures) -> Vec<MaterialData> {
    let mut set = Vec::with_capacity(used.len());
    for &index in used {
        let material = material_at(item, index);
        let shader = match material {
            None => "default".to_owned(),
            Some(m) => shader_name(m.shader_hash)
                .map_or_else(|| format!("<unknown:{}>", m.shader_hash), str::to_owned),
        };
        let diffuse = real_texture(material, Role::Diffuse).unwrap_or("flat");
        let alpha_mode = material.map_or(AlphaMode::Opaque, |m| m.alpha_mode);
        set.push(MaterialData {
            name: format!("{shader}|{diffuse}"),
            base_color_texture: pictures.of(material, Role::Diffuse),
            normal_texture: pictures.of(material, Role::Normal),
            alpha_mode,
            double_sided: alpha_mode != AlphaMode::Opaque,
            emissive: material.is_some_and(|m| m.emissive),
            ..MaterialData::default()
        });
    }
    set
}

// ---------------------------------------------------------------- меши и узлы

/// Узел кости: перенос, поворот и масштаб в осях glTF без единичных значений.
fn bone_node(bone: &drawable::Bone) -> NodeData {
    let [tx, ty, tz] = bone.translation;
    let [qx, qy, qz, qw] = bone.rotation;
    let [sx, sy, sz] = bone.scale;
    let small = |v: f32| v.abs() < TINY;
    let moved = [tx, ty, tz].into_iter().any(|v| !small(v));
    let turned = [qx, qy, qz].into_iter().any(|v| !small(v)) || !((qw - 1.0).abs() < TINY);
    let scaled = [sx, sy, sz].iter().any(|v| !((v - 1.0).abs() < TINY));
    NodeData {
        name: Some(bone.name.clone()),
        translation: moved.then_some([tx, tz, -ty]),
        rotation: turned.then_some([qx, qz, -qy, qw]),
        scale: scaled.then_some([sx, sz, sy]),
        ..NodeData::default()
    }
}

/// Узлы скелета: нулевой `Armature`, дальше по узлу на кость.
fn push_skeleton(bones: &[drawable::Bone], nodes: &mut Vec<NodeData>) {
    let count = bones.len();
    let mut armature = NodeData {
        name: Some("Armature".to_owned()),
        ..NodeData::default()
    };
    let mut bone_nodes: Vec<NodeData> = bones.iter().map(bone_node).collect();
    for (at, bone) in bones.iter().enumerate() {
        let parent = usize::try_from(bone.parent)
            .ok()
            .filter(|&parent| parent < count && parent != at);
        let owner = match parent {
            Some(parent) => &mut bone_nodes[parent].children,
            None => &mut armature.children,
        };
        owner.push(at + 1);
    }
    nodes.push(armature);
    nodes.extend(bone_nodes);
}

/// Меши сцены: склеенные вершины, материал по номеру среди использованных.
fn mesh_set(item: &Drawable, used: &[usize]) -> Vec<MeshData> {
    let with_bones = !item.bones.is_empty();
    let mut set = Vec::with_capacity(item.meshes.len());
    for (number, mesh) in item.meshes.iter().enumerate() {
        let glued = weld(mesh, false);
        let skinned = with_bones && glued.joints.is_some();
        set.push(MeshData {
            name: format!("Mesh_{number}"),
            positions: glued.positions,
            normals: glued.normals,
            uvs: glued.uvs,
            colours: None,
            indices: glued.indices,
            material: used.iter().position(|&index| index == mesh.shader_index),
            joints: glued.joints.filter(|_| skinned),
            weights: glued.weights.filter(|_| skinned),
        });
    }
    set
}

/// Узлы, корни и скины: скелет (если есть кости) и по узлу на меш.
fn node_tree(item: &Drawable, meshes: &[MeshData]) -> (Vec<NodeData>, Vec<usize>, Vec<SkinData>) {
    let mut nodes: Vec<NodeData> = Vec::new();
    let mut roots: Vec<usize> = Vec::new();
    let mut skins: Vec<SkinData> = Vec::new();
    if !item.bones.is_empty() {
        push_skeleton(&item.bones, &mut nodes);
        roots.push(0);
        if meshes.iter().any(|mesh| mesh.joints.is_some()) {
            let inverse_bind = item
                .bones
                .iter()
                .map(|bone| invert(&matrix_to_gltf(&bone.matrix)).unwrap_or(IDENTITY))
                .collect();
            skins.push(SkinData {
                joints: (1..=item.bones.len()).collect(),
                inverse_bind,
            });
        }
    }
    for (number, (mesh, data)) in item.meshes.iter().zip(meshes).enumerate() {
        let placed = mesh
            .bone_matrix
            .map(|m| matrix_to_gltf(&m))
            .filter(|m| !nearly_identity(m));
        roots.push(nodes.len());
        nodes.push(NodeData {
            mesh: Some(number),
            matrix: placed,
            skin: (data.joints.is_some() && !skins.is_empty()).then_some(0),
            ..NodeData::default()
        });
    }
    (nodes, roots, skins)
}

/// Сборка GLB из прочитанной модели (без обращения к файлу).
fn scene_glb(
    item: &Drawable,
    res: &Resource,
    library: &Library,
    label: &str,
) -> Result<(Vec<u8>, Vec<String>)> {
    let used = used_shaders(item);
    let wanted = wanted_textures(item, &used);
    let pictures = Pictures::gather(&wanted, item, res, library);
    let materials = material_set(item, &used, &pictures);
    let meshes = mesh_set(item, &used);
    let (nodes, roots, skins) = node_tree(item, &meshes);
    let glb = glb::write(&Scene {
        name: label.to_owned(),
        meshes,
        materials,
        images: pictures.images,
        nodes,
        roots,
        skins,
    })?;
    Ok((glb, pictures.warnings))
}

pub fn extract_textures(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>> {
    let dictionary = Dictionary::parse("", bytes)?;
    let encoded = parallel_map(dictionary.textures(), |texture| {
        texture_png(dictionary.resource(), texture).map(|png| (texture.name.clone(), png))
    });
    let mut out: Vec<(String, Vec<u8>)> = Vec::new();
    let mut place: HashMap<String, usize> = HashMap::new();
    for (name, png) in encoded.into_iter().flatten() {
        match place.entry(name.clone()) {
            Slot::Occupied(seen) => out[*seen.get()].1 = png,
            Slot::Vacant(free) => {
                free.insert(out.len());
                out.push((name, png));
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- склейка вершин

/// Меш после склейки одинаковых вершин.
pub(crate) struct Welded {
    pub(crate) positions: Vec<f32>,
    pub(crate) normals: Option<Vec<f32>>,
    pub(crate) uvs: Option<Vec<f32>>,
    pub(crate) colours: Option<Vec<f32>>,
    pub(crate) joints: Option<Vec<u16>>,
    pub(crate) weights: Option<Vec<f32>>,
    pub(crate) indices: Vec<u16>,
}

/// Биты числа; минус и плюс ноль равны, у остальных (и NaN) все 32 бита.
fn weld_bits(value: f32) -> u32 {
    match value == 0.0 {
        true => 0,
        false => value.to_bits(),
    }
}

/// Вершина `at` из плоского массива по `width` чисел.
fn lane<T>(values: &[T], at: usize, width: usize) -> &[T] {
    &values[at * width..(at + 1) * width]
}

/// Ключ вершины: все её потоки подряд, недостающие места заполнены нулями.
fn vertex_key(
    mesh: &Mesh,
    colours: Option<&[f32]>,
    skin: Option<(&[u16], &[f32])>,
    at: usize,
) -> [u32; 20] {
    let mut words: Vec<u32> = Vec::with_capacity(20);
    let floats = |values: &[f32], width: usize| -> Vec<u32> {
        lane(values, at, width)
            .iter()
            .map(|&v| weld_bits(v))
            .collect()
    };
    words.extend(floats(&mesh.positions, 3));
    if let Some(normals) = &mesh.normals {
        words.extend(floats(normals, 3));
    }
    if let Some(uvs) = &mesh.uvs {
        words.extend(floats(uvs, 2));
    }
    if let Some(colours) = colours {
        words.extend(floats(colours, 4));
    }
    if let Some((joints, weights)) = skin {
        words.extend(lane(joints, at, 4).iter().map(|&v| u32::from(v)));
        words.extend(floats(weights, 4));
    }
    let mut key = [0u32; 20];
    key[..words.len()].copy_from_slice(&words);
    key
}

pub(crate) fn weld(mesh: &Mesh, with_colours: bool) -> Welded {
    let count = mesh.vertex_count();
    let colours = mesh.colours.as_deref().filter(|_| with_colours);
    let skin = mesh.joints.as_deref().zip(mesh.weights.as_deref());

    let mut first_of: HashMap<[u32; 20], usize> = HashMap::new();
    let mut canonical: Vec<usize> = Vec::with_capacity(count);
    for at in 0..count {
        let key = vertex_key(mesh, colours, skin, at);
        canonical.push(*first_of.entry(key).or_insert(at));
    }

    let same_place = |a: usize, b: usize| {
        let (first, second) = (lane(&mesh.positions, a, 3), lane(&mesh.positions, b, 3));
        first
            .iter()
            .zip(second)
            .all(|(x, y)| x.to_bits() == y.to_bits())
    };
    let mut kept: Vec<[usize; 3]> = Vec::new();
    for t in mesh.indices.chunks_exact(3) {
        let [a, b, c] = [t[0], t[1], t[2]].map(|index| canonical[usize::from(index)]);
        let collapsed = a == b || b == c || a == c;
        if !collapsed && !same_place(a, b) && !same_place(b, c) && !same_place(a, c) {
            kept.push([a, b, c]);
        }
    }

    let mut renumbered: HashMap<usize, u16> = HashMap::new();
    let mut order: Vec<usize> = Vec::new();
    let mut indices: Vec<u16> = Vec::with_capacity(kept.len() * 3);
    for &vertex in kept.iter().flatten() {
        let number = *renumbered.entry(vertex).or_insert_with(|| {
            order.push(vertex);
            (order.len() - 1) as u16
        });
        indices.push(number);
    }

    let gather = |values: &[f32], width: usize| -> Vec<f32> {
        let mut out = Vec::with_capacity(order.len() * width);
        for &at in &order {
            out.extend_from_slice(lane(values, at, width));
        }
        out
    };
    Welded {
        positions: gather(&mesh.positions, 3),
        normals: mesh.normals.as_deref().map(|v| gather(v, 3)),
        uvs: mesh.uvs.as_deref().map(|v| gather(v, 2)),
        colours: colours.map(|v| gather(v, 4)),
        joints: mesh.joints.as_deref().map(|v| {
            let mut out = Vec::with_capacity(order.len() * 4);
            for &at in &order {
                out.extend_from_slice(lane(v, at, 4));
            }
            out
        }),
        weights: mesh.weights.as_deref().map(|v| gather(v, 4)),
        indices,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawable::{Bone, Material};
    use crate::error::Kind;
    use serde_json::Value;

    /// Меш по умолчанию, поправленный функцией.
    fn shaped(edit: impl FnOnce(&mut Mesh)) -> Mesh {
        let mut mesh = Mesh::default();
        edit(&mut mesh);
        mesh
    }

    fn unit() -> Vec<f32> {
        vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    }

    /// Треугольник `unit` с индексами 0, 1, 2 поверх остальных потоков `extra`.
    fn tri(extra: Mesh) -> Mesh {
        let mut mesh = extra;
        mesh.indices = vec![0, 1, 2];
        mesh.positions = unit();
        mesh
    }

    fn corner_mesh(positions: Vec<f32>, indices: Vec<u16>) -> Mesh {
        shaped(|m| {
            m.indices = indices;
            m.positions = positions;
        })
    }

    /// Склеенные индексы меша из `positions` и `indices` без цветов.
    fn welded_indices(positions: Vec<f32>, indices: Vec<u16>) -> Vec<u16> {
        weld(&corner_mesh(positions, indices), false).indices
    }

    #[test]
    fn weld_keeps_a_plain_triangle() {
        let out = weld(&tri(Mesh::default()), false);
        assert_eq!(out.positions, unit());
        assert_eq!(out.indices, [0, 1, 2]);
        assert!(out.normals.is_none() && out.uvs.is_none() && out.colours.is_none());
        assert!(out.joints.is_none() && out.weights.is_none());
    }

    #[test]
    fn weld_merges_equal_vertices_and_keeps_repeats() {
        let twice = [unit(), unit()].concat();
        let out = weld(&corner_mesh(twice.clone(), vec![0, 1, 2, 3, 4, 5]), false);
        assert_eq!(
            (out.positions, out.indices),
            (unit(), vec![0, 1, 2, 0, 1, 2])
        );
        assert_eq!(
            welded_indices(twice.clone(), vec![0, 1, 2, 5, 4, 3]),
            [0, 1, 2, 2, 1, 0]
        );
        let thrice = [unit(), unit(), unit()].concat();
        assert_eq!(
            welded_indices(thrice, (0..9).collect()),
            [0, 1, 2, 0, 1, 2, 0, 1, 2]
        );
    }

    #[test]
    fn weld_signed_zero_and_nan() {
        let mut pos = unit();
        pos[0] = -0.0;
        let mixed = [pos.clone(), unit()].concat();
        let out = weld(&corner_mesh(mixed, (0..6).collect()), false);
        assert_eq!(out.indices, [0, 1, 2, 0, 1, 2]);
        assert!(out.positions[0].is_sign_negative());

        let nan = f32::from_bits(0x7fc0_0001);
        let other = f32::from_bits(0x7fc0_0002);
        let with_nan = |last: f32| {
            let mut first = unit();
            first[2] = nan;
            let mut second = unit();
            second[2] = last;
            weld(
                &corner_mesh([first, second].concat(), (0..6).collect()),
                false,
            )
        };
        assert_eq!(with_nan(nan).indices, [0, 1, 2, 0, 1, 2]);
        assert_eq!(with_nan(other).indices, [0, 1, 2, 3, 1, 2]);
        assert_eq!(with_nan(other).positions.len() / 3, 4);
    }

    #[test]
    fn weld_drops_degenerate_triangles() {
        let flat = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        for indices in [vec![0, 0, 1], vec![0, 1, 1], vec![0, 1, 0]] {
            let out = weld(&corner_mesh(flat.clone(), indices), false);
            assert!(out.positions.is_empty() && out.indices.is_empty());
        }
        // Две вершины в одной точке с разными нормалями: треугольник теряется...
        let mut pos = unit();
        pos.extend([0.0, 0.0, 0.0]);
        let mesh = shaped(|m| {
            m.indices = vec![0, 1, 3, 0, 1, 2];
            m.normals = Some(vec![
                0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0,
            ]);
            m.positions = pos;
        });
        let out = weld(&mesh, false);
        // ...а второй остаётся, и вершины 3 в выходе нет.
        assert_eq!(out.indices, [0, 1, 2]);
        assert_eq!(out.normals.unwrap().len(), 9);
    }

    #[test]
    fn weld_drops_unused_vertices_and_renumbers_by_first_use() {
        let pos = vec![0.0, 0.0, 0.0, 9.0, 9.0, 9.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let out = weld(&corner_mesh(pos, vec![3, 2, 0]), false);
        assert_eq!(out.positions, [0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert_eq!(out.indices, [0, 1, 2]);
        let shared = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
        let out = weld(&corner_mesh(shared, vec![2, 1, 0, 3, 1, 0]), false);
        assert_eq!(
            out.positions,
            [0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0]
        );
        assert_eq!(out.indices, [0, 1, 2, 3, 1, 2]);
    }

    #[test]
    fn weld_streams_and_colours() {
        let mut full = tri(Mesh::default());
        full.colours = Some(vec![
            1.0, 0.5, 0.25, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0,
        ]);
        full.uvs = Some(vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
        full.normals = Some(vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
        let off = weld(&full, false);
        assert!(off.colours.is_none() && off.uvs.as_ref().unwrap().len() == 6);
        let on = weld(&full, true);
        assert_eq!(
            on.colours.unwrap(),
            [1.0, 0.5, 0.25, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
        );

        // Второй треугольник отличается цветом первой вершины.
        let mut doubled = corner_mesh([unit(), unit()].concat(), (0..6).collect());
        doubled.colours = Some(
            [
                vec![0.0; 12],
                vec![0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ]
            .concat(),
        );
        assert_eq!(weld(&doubled, false).positions.len() / 3, 3);
        assert_eq!(weld(&doubled, true).positions.len() / 3, 4);
        assert_eq!(weld(&doubled, true).indices, [0, 1, 2, 3, 1, 2]);
        // uvs1 и признак skinned склейку не задевают.
        doubled.colours = None;
        doubled.uvs1 = Some(vec![
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ]);
        assert_eq!(weld(&doubled, true).indices, [0, 1, 2, 0, 1, 2]);

        let mut uv_split = corner_mesh([unit(), unit()].concat(), (0..6).collect());
        uv_split.uvs = Some(vec![
            0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.5, 0.0, 1.0, 0.0, 0.0, 1.0,
        ]);
        assert_eq!(weld(&uv_split, false).indices, [0, 1, 2, 3, 1, 2]);
    }

    #[test]
    fn weld_skin_streams() {
        let mut skinned = tri(Mesh::default());
        skinned.weights = Some(vec![
            0.5, 0.5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.25, 0.25, 0.25, 0.25,
        ]);
        skinned.joints = Some(vec![1, 2, 0, 0, 3, 0, 0, 0, 4, 5, 6, 7]);
        let out = weld(&skinned, false);
        assert_eq!(out.joints.unwrap(), [1, 2, 0, 0, 3, 0, 0, 0, 4, 5, 6, 7]);
        assert_eq!(out.weights.unwrap().len(), 12);

        let mut two = corner_mesh([unit(), unit()].concat(), (0..6).collect());
        two.weights = Some([1.0, 0.0, 0.0, 0.0].repeat(6));
        two.joints = Some(
            [
                vec![1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                vec![2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
            ]
            .concat(),
        );
        assert_eq!(weld(&two, false).indices, [0, 1, 2, 3, 1, 2]);

        let mut weights_only = tri(Mesh::default());
        weights_only.weights = Some([1.0, 0.0, 0.0, 0.0].repeat(3));
        let out = weld(&weights_only, false);
        assert!(out.joints.is_none() && out.weights.is_some());
        let mut joints_only = tri(Mesh::default());
        joints_only.joints = Some([1, 0, 0, 0].repeat(3));
        let out = weld(&joints_only, false);
        assert!(out.joints.is_some() && out.weights.is_none());
    }

    #[test]
    fn weld_odd_sizes_and_empty() {
        for indices in [vec![0, 1, 2, 0], vec![0, 1, 2, 0, 1]] {
            assert_eq!(welded_indices(unit(), indices), [0, 1, 2]);
        }
        let none = weld(&corner_mesh(unit(), vec![]), false);
        assert!(none.positions.is_empty() && none.indices.is_empty());
        let empty = weld(&Mesh::default(), false);
        assert!(empty.positions.is_empty() && empty.indices.is_empty());
        let seven = weld(&corner_mesh(vec![0.0; 7], vec![]), false);
        assert!(seven.positions.is_empty());
    }

    #[test]
    fn weld_panics_on_broken_input() {
        let far = std::panic::catch_unwind(|| weld(&corner_mesh(unit(), vec![0, 1, 3]), false));
        assert!(far.is_err());
        let mut short = tri(Mesh::default());
        short.normals = Some(vec![0.0; 6]);
        assert!(std::panic::catch_unwind(|| weld(&short, false)).is_err());
    }

    #[test]
    fn weld_handles_more_than_65536_vertices() {
        let mut positions = Vec::new();
        for n in 0..70_000u32 {
            positions.extend([n as f32, 0.0, 1.0]);
        }
        let out = weld(&corner_mesh(positions, vec![65_533, 65_534, 65_535]), false);
        assert_eq!(out.indices, [0, 1, 2]);
        assert_eq!(out.positions.len(), 9);
        assert_eq!(out.positions[0], 65_533.0);
    }

    fn entry(hash: Option<u32>) -> Entry {
        Entry { at: 0, hash }
    }

    #[test]
    fn selector_table() {
        let hashed = entry(Some(0x15C7_92F2));
        let plain = entry(None);
        let rows: [(&str, bool, bool); 22] = [
            ("hash_15C792F2", true, false),
            ("hash_15c792f2", true, false),
            ("HASH_15C792F2", true, false),
            ("  hash_15C792F2  ", true, false),
            ("hash_15C792F2.ydd", true, false),
            ("hash_15C792F2.YDD", true, false),
            ("hash_15C792F2.Ydd.YDD", true, false),
            ("hash_15C792F2.ydd.ydd", true, false),
            ("hash_15C792F2.ydd ", true, false),
            (" hash_15C792F2 .ydd", false, false),
            ("hash_15C792F2.", false, false),
            ("15C792F2", false, false),
            ("0x15C792F2", false, false),
            ("", false, false),
            ("   ", false, false),
            (".ydd", false, false),
            ("drawable", false, true),
            ("Drawable.ydd", false, true),
            ("Drawable.YDD", false, true),
            ("é.YDD", false, false),
            ("hash_15C792F3", false, false),
            ("hash_015C792F2", false, false),
        ];
        for (text, with_hash, without) in rows {
            assert_eq!(matches_selector(&hashed, text), with_hash, "{text:?}");
            assert_eq!(matches_selector(&plain, text), without, "{text:?}");
        }
        let gum = entry(Some(joaat("prop_gumball_01")));
        for text in [
            "prop_gumball_01",
            "PROP_GUMBALL_01",
            "prop_gumball_01.ydd",
            "Prop_Gumball_01 ",
        ] {
            assert!(matches_selector(&gum, text), "{text:?}");
        }
        assert_eq!(joaat("hash_15c792f2"), 0x8d4b_f4cc);
        assert!(matches_selector(&entry(Some(0x8d4b_f4cc)), "hash_15c792f2"));
    }

    #[test]
    fn failure_is_the_agreed_error() {
        let e = failure();
        assert_eq!(
            format!("{e:?}"),
            r#"Error { kind: Broken, message: "Model conversion failed." }"#
        );
        assert_eq!(e.to_string(), "Model conversion failed.");
    }

    fn square(shader_index: usize) -> Mesh {
        shaped(|m| {
            m.shader_index = shader_index;
            m.indices = vec![0, 1, 2, 0, 2, 3];
            m.uvs = Some(vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]);
            m.normals = Some([0.0, 0.0, 1.0].repeat(4));
            m.positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
        })
    }

    fn material(name: &str, alpha_mode: AlphaMode, emissive: bool) -> Material {
        Material {
            shader: name.to_owned(),
            shader_hash: joaat(name),
            shader_file: None,
            shader_file_hash: 0,
            render_bucket: 0,
            alpha_mode,
            emissive,
            textures: HashMap::new(),
            samplers: Vec::new(),
        }
    }

    fn model(meshes: Vec<Mesh>, materials: Vec<Option<Material>>, bones: Vec<Bone>) -> Drawable {
        Drawable {
            name: None,
            hash: None,
            lod: Some(Lod::High),
            has_shader_group: true,
            meshes,
            materials,
            embedded_textures: Vec::new(),
            bones,
        }
    }

    fn bone(name: &str, parent: i16, translation: [f32; 3]) -> Bone {
        let mut matrix = IDENTITY;
        matrix[12..15].copy_from_slice(&translation);
        Bone {
            name: name.to_owned(),
            parent,
            tag: 0,
            rotation: [0.0, 0.0, 0.0, 1.0],
            translation,
            scale: [1.0; 3],
            matrix,
        }
    }

    fn glb_json(glb: &[u8]) -> Value {
        let length = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        serde_json::from_slice(&glb[20..20 + length]).unwrap()
    }

    fn dummy_resource() -> Resource {
        let header = crate::resource::Header {
            system_flags: 0,
            graphics_flags: 0,
            system_size: 0,
            graphics_size: 0,
            version: 0,
            declared_version: 0,
        };
        Resource::from_parts(header, vec![0; 16])
    }

    fn build(item: &Drawable) -> Value {
        let (glb, _) = scene_glb(item, &dummy_resource(), &Library::default(), "x").unwrap();
        glb_json(&glb)
    }

    /// Имена всех объектов массива `key` в JSON.
    fn names(json: &Value, key: &str) -> Vec<String> {
        let Some(all) = json[key].as_array() else {
            return Vec::new();
        };
        all.iter()
            .filter_map(|n| n["name"].as_str().map(str::to_owned))
            .collect()
    }

    #[test]
    fn materials_follow_first_use_and_the_material_alpha() {
        let item = model(
            vec![square(2), square(0), square(2)],
            vec![
                Some(material("glass", AlphaMode::Blend, false)),
                None,
                Some(material("normal_spec_cutout", AlphaMode::Mask, true)),
            ],
            vec![],
        );
        let json = build(&item);
        assert_eq!(
            names(&json, "materials"),
            ["normal_spec_cutout|flat", "glass|flat"]
        );
        let materials = json["materials"].as_array().unwrap();
        assert_eq!(materials[0]["alphaMode"], "MASK");
        assert_eq!(materials[0]["doubleSided"], true);
        assert_eq!(materials[1]["alphaMode"], "BLEND");
        let meshes = json["meshes"].as_array().unwrap();
        assert_eq!(
            meshes
                .iter()
                .map(|m| m["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["Mesh_0", "Mesh_1", "Mesh_2"]
        );
        // Номер за пределами массива: материала нет.
        let beyond = build(&model(vec![square(7)], vec![None], vec![]));
        assert_eq!(names(&beyond, "materials"), ["default|flat"]);
        let mut odd = material("x", AlphaMode::Mask, false);
        odd.shader_hash = 0x1234_5678;
        let unknown = build(&model(vec![square(0)], vec![Some(odd)], vec![]));
        assert_eq!(names(&unknown, "materials"), ["<unknown:305419896>|flat"]);
    }

    #[test]
    fn empty_model_has_no_nodes() {
        let json = build(&model(vec![], vec![], vec![]));
        assert!(json.get("nodes").is_none() || json["nodes"].as_array().unwrap().is_empty());
        assert!(json.get("meshes").is_none() || json["meshes"].as_array().unwrap().is_empty());
    }

    fn rig() -> Vec<Bone> {
        let mut rot = bone("rot", 1, [0.0; 3]);
        rot.rotation = [0.0, 0.0, 0.707_106_77, 0.707_106_77];
        let mut scaled = bone("scaled", 1, [0.0; 3]);
        scaled.scale = [2.0, 3.0, 4.0];
        let mut tiny = bone("tiny-diff", 0, [0.0; 3]);
        tiny.translation = [2e-6, 0.0, 0.0];
        let mut singular = bone("singular", 0, [0.0; 3]);
        singular.matrix = [0.0; 16];
        let mut all = vec![
            bone("root", -1, [0.0; 3]),
            bone("moved", 0, [1.0, 2.0, 3.0]),
            rot,
            scaled,
        ];
        all.extend([
            bone("self-parent", 4, [0.0; 3]),
            bone("bad-parent", 99, [0.0; 3]),
            bone("neg-parent", -5, [0.0; 3]),
            singular,
            tiny,
        ]);
        all
    }

    #[test]
    fn bones_become_an_armature_tree() {
        let json = build(&model(vec![square(0)], vec![None], rig()));
        let nodes = json["nodes"].as_array().unwrap();
        assert_eq!(nodes.len(), 11);
        assert_eq!(nodes[0]["name"], "Armature");
        assert_eq!(nodes[0]["children"], serde_json::json!([1, 5, 6, 7]));
        assert_eq!(nodes[1]["children"], serde_json::json!([2, 8, 9]));
        assert_eq!(nodes[2]["translation"], serde_json::json!([1.0, 3.0, -2.0]));
        assert_eq!(nodes[2]["children"], serde_json::json!([3, 4]));
        assert!(nodes[3]["rotation"].is_array() && nodes[3].get("translation").is_none());
        assert_eq!(nodes[4]["scale"], serde_json::json!([2.0, 4.0, 3.0]));
        assert!(nodes[5].get("children").is_none());
        assert!(nodes[9]["translation"].is_array());
        assert_eq!(nodes[10], serde_json::json!({"mesh": 0}));
        assert!(json.get("skins").is_none());
        assert_eq!(json["scenes"][0]["nodes"], serde_json::json!([0, 10]));
    }

    fn skinned_square() -> Mesh {
        let mut mesh = square(0);
        mesh.skinned = true;
        mesh.weights = Some([1.0, 0.0, 0.0, 0.0].repeat(4));
        mesh.joints = Some([1, 0, 0, 0].repeat(4));
        mesh
    }

    #[test]
    fn skin_covers_every_bone_and_inverts_the_bone_matrix() {
        let json = build(&model(vec![skinned_square()], vec![None], rig()));
        let skins = json["skins"].as_array().unwrap();
        assert_eq!(skins.len(), 1);
        assert_eq!(
            skins[0]["joints"],
            serde_json::json!([1, 2, 3, 4, 5, 6, 7, 8, 9])
        );
        assert_eq!(json["nodes"][10], serde_json::json!({"mesh": 0, "skin": 0}));
        let attrs = &json["meshes"][0]["primitives"][0]["attributes"];
        assert!(attrs.get("JOINTS_0").is_some() && attrs.get("WEIGHTS_0").is_some());

        // Без костей суставы отбрасываются, скина нет.
        let bare = build(&model(vec![skinned_square()], vec![None], vec![]));
        assert!(bare.get("skins").is_none());
        assert!(bare["meshes"][0]["primitives"][0]["attributes"]
            .get("JOINTS_0")
            .is_none());
    }

    #[test]
    fn rigid_meshes_stand_on_their_bone_matrix() {
        let mut moved = IDENTITY;
        moved[12..15].copy_from_slice(&[1.0, 2.0, 3.0]);
        let mut placed = square(0);
        placed.bone_matrix = Some(moved);
        let mut same = square(0);
        same.bone_matrix = Some(IDENTITY);
        let root = vec![bone("root", -1, [0.0; 3])];
        let json = build(&model(vec![placed, same], vec![None], root));
        let nodes = json["nodes"].as_array().unwrap();
        let matrix = nodes[2]["matrix"].as_array().unwrap();
        assert_eq!(matrix[12..15], [1.0, 3.0, -2.0].map(Value::from));
        assert!(nodes[3].get("matrix").is_none());
        // Цвета вершин в GLB модели не пишутся.
        let mut coloured = square(0);
        coloured.colours = Some([1.0, 0.0, 0.0, 1.0].repeat(4));
        let json = build(&model(vec![coloured], vec![None], vec![]));
        assert!(json["meshes"][0]["primitives"][0]["attributes"]
            .get("COLOR_0")
            .is_none());
    }

    #[test]
    fn all_degenerate_mesh_is_kept_empty() {
        let mut mesh = square(0);
        mesh.indices = vec![0, 0, 0];
        let json = build(&model(vec![mesh], vec![None], vec![]));
        assert_eq!(json["meshes"].as_array().unwrap().len(), 1);
    }

    /// Текстура нашлась во внешнем словаре и не декодируется: модель собрана, а в
    /// предупреждениях — имя этой текстуры. Текстура без записи в словаре молчит.
    #[test]
    fn undecodable_library_texture_is_reported() {
        let broken = TextureRef {
            name: "Broken_Diff".to_owned(),
            width: 4,
            height: 4,
            depth: 1,
            levels: 1,
            format: None,
            format_code: 0,
            bytes: 0,
            complete: false,
            data_at: None,
            spans: Vec::new(),
        };
        let library = Library {
            dictionaries: vec![Dictionary {
                name: "lib.ytd".to_owned(),
                resource: dummy_resource(),
                textures: vec![broken],
            }],
        };
        let mut known = material("normal", AlphaMode::Opaque, false);
        known
            .textures
            .insert(Role::Diffuse, "broken_diff".to_owned());
        known.textures.insert(Role::Normal, "nowhere_n".to_owned());
        let item = model(vec![square(0)], vec![Some(known)], vec![]);
        let (glb, warnings) = scene_glb(&item, &dummy_resource(), &library, "x").unwrap();
        assert!(!glb.is_empty());
        assert_eq!(
            warnings,
            ["Текстура broken_diff: найдена во внешнем словаре, но не декодируется."]
        );
        let (_, quiet) = scene_glb(&item, &dummy_resource(), &Library::default(), "x").unwrap();
        assert!(quiet.is_empty());
    }

    /// Ошибка загрузки библиотеки из одного файла: вид и текст.
    fn load_failure(name: &str, bytes: Vec<u8>) -> Error {
        Library::load(&[(name.to_owned(), bytes)]).err().unwrap()
    }

    #[test]
    fn library_order_and_lookup() {
        assert!(Library::default().is_empty());
        assert!(Library::default().find_in("x").is_none());
        assert!(Library::load(&[]).unwrap().is_empty());
        let error = load_failure("a.ytd", b"nonsense nonsense nonsense".to_vec());
        assert_eq!(
            (error.kind, error.message.as_str()),
            (Kind::Broken, "Файл не является ресурсом RSC7.")
        );
        let empty = load_failure("a.ytd", vec![]);
        assert_eq!(empty.message, "Ресурс короче заголовка RSC7.");
    }

    #[test]
    fn extract_textures_refuses_garbage() {
        let message = |bytes: &[u8]| extract_textures(bytes).err().unwrap().message;
        assert_eq!(message(&[]), "Ресурс короче заголовка RSC7.");
        assert_eq!(
            message(b"garbage garbage garbage"),
            "Файл не является ресурсом RSC7."
        );
        assert_eq!(
            Dictionary::parse("n", &[]).err().unwrap().kind,
            Kind::Broken
        );
    }
}
