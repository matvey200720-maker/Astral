//! Запись контейнера GLB (glTF 2.0 одним файлом).
//!
//! О RAGE модуль ничего не знает: принимает меши, материалы, готовые картинки
//! и дерево узлов, отдаёт байты файла. Вход не проверяется.

use serde_json::{json, Map, Value};

use crate::{
    error::{Error, Result},
    shaders::AlphaMode,
};

#[derive(Debug, Clone, Default)]
pub struct NodeData {
    pub name: Option<String>,
    pub children: Vec<usize>,
    pub mesh: Option<usize>,
    pub translation: Option<[f32; 3]>,
    pub rotation: Option<[f32; 4]>,
    pub scale: Option<[f32; 3]>,
    pub matrix: Option<[f32; 16]>,
    pub skin: Option<usize>,
}

const TARGET_ARRAY: u32 = 34962;
const TARGET_ELEMENTS: u32 = 34963;

#[derive(Debug, Clone, Default)]
pub struct SkinData {
    pub joints: Vec<usize>,
    pub inverse_bind: Vec<[f32; 16]>,
}

const FLOAT: u32 = 5126;
const UBYTE: u32 = 5121;
const USHORT: u32 = 5123;

#[derive(Debug, Clone, Default)]
pub struct MeshData {
    pub name: String,
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub colours: Option<Vec<u8>>,
    pub indices: Vec<u16>,
    pub material: Option<usize>,
    pub joints: Option<Vec<u16>>,
    pub weights: Option<Vec<f32>>,
}

/// Имя меша: своё или `mesh_<номер>`, если своё пусто.
fn mesh_name(mesh: &MeshData, index: usize) -> String {
    match mesh.name.as_str() {
        "" => format!("mesh_{index}"),
        own => own.to_owned(),
    }
}

#[derive(Debug, Clone)]
pub struct ImageData {
    pub bytes: Vec<u8>,
    pub mime_type: &'static str,
}

#[derive(Debug, Clone)]
pub struct MaterialData {
    pub name: String,
    pub base_color_texture: Option<usize>,
    pub normal_texture: Option<usize>,
    pub alpha_mode: AlphaMode,
    pub alpha_cutoff: f32,
    pub double_sided: bool,
    pub emissive: bool,
    pub base_color_factor: Option<[f32; 4]>,
}

impl Default for MaterialData {
    fn default() -> Self {
        Self {
            alpha_mode: AlphaMode::Opaque,
            alpha_cutoff: 0.5,
            double_sided: false,
            emissive: false,
            base_color_factor: None,
            base_color_texture: None,
            normal_texture: None,
            name: String::from("material"),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Scene {
    pub name: String,
    pub meshes: Vec<MeshData>,
    pub materials: Vec<MaterialData>,
    pub images: Vec<ImageData>,
    pub nodes: Vec<NodeData>,
    pub roots: Vec<usize>,
    pub skins: Vec<SkinData>,
}

// ---------------------------------------------------------------- JSON

/// Объект JSON из пар «ключ, значение» в заданном порядке.
fn object<'a>(pairs: impl IntoIterator<Item = (&'a str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<String, Value>>(),
    )
}

/// То же, но пары, которых нет (`None`), пропускаются.
fn present<'a>(pairs: Vec<Option<(&'a str, Value)>>) -> Value {
    object(pairs.into_iter().flatten())
}

/// Число `f32` в JSON: расширение до `f64` без округления; нечисло станет `null`.
fn num(v: f32) -> Value {
    Value::from(f64::from(v))
}

fn nums(values: &[f32]) -> Value {
    values.iter().map(|&v| num(v)).collect()
}

fn floats_le(values: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

// ---------------------------------------------------------------- буфер

/// Что нужно знать об accessor сверх того, где лежат байты.
struct Access {
    count: usize,
    component: u32,
    kind: &'static str,
    normalized: bool,
    bounds: Option<([f32; 3], [f32; 3])>,
}

impl Access {
    fn new(component: u32, kind: &'static str, count: usize) -> Self {
        Self {
            count,
            kind,
            component,
            normalized: false,
            bounds: None,
        }
    }

    fn normalised(self) -> Self {
        Self {
            normalized: true,
            ..self
        }
    }

    fn within(self, bounds: Option<([f32; 3], [f32; 3])>) -> Self {
        Self { bounds, ..self }
    }
}

/// Общий буфер вместе с описаниями видов и accessor.
#[derive(Default)]
struct Buffer {
    bin: Vec<u8>,
    views: Vec<Value>,
    accessors: Vec<Value>,
}

impl Buffer {
    /// Кладёт байты видом, начинающимся на границе 4; возвращает номер вида.
    fn view(&mut self, bytes: &[u8], target: Option<u32>) -> usize {
        let offset = self.bin.len();
        self.bin.extend_from_slice(bytes);
        let padded = (self.bin.len() + 3) & !3;
        self.bin.resize(padded, 0);
        let mut pairs = vec![
            ("buffer", json!(0)),
            ("byteOffset", json!(offset)),
            ("byteLength", json!(bytes.len())),
        ];
        pairs.extend(target.map(|target| ("target", json!(target))));
        self.views.push(object(pairs));
        self.views.len() - 1
    }

    /// Вид + accessor разом; возвращает номер accessor.
    fn attribute(&mut self, bytes: &[u8], target: Option<u32>, access: Access) -> usize {
        let view = self.view(bytes, target);
        let bounds = access.bounds;
        self.accessors.push(present(vec![
            Some(("bufferView", json!(view))),
            Some(("componentType", json!(access.component))),
            access.normalized.then(|| ("normalized", json!(true))),
            Some(("count", json!(access.count))),
            Some(("type", json!(access.kind))),
            bounds.map(|(min, _)| ("min", nums(&min))),
            bounds.map(|(_, max)| ("max", nums(&max))),
        ]));
        self.accessors.len() - 1
    }
}

/// Границы по точкам, у которых все три координаты конечные: NaN и бесконечность не
/// попадают в границы (в JSON они стали бы null). Нет ни одной такой точки — границ нет.
fn axis_bounds(positions: &[f32]) -> Option<([f32; 3], [f32; 3])> {
    positions
        .chunks_exact(3)
        .filter(|p| p.iter().all(|c| c.is_finite()))
        .fold(None, |found, p| {
            let point = [p[0], p[1], p[2]];
            Some(match found {
                None => (point, point),
                Some((low, high)) => (
                    std::array::from_fn(|axis| low[axis].min(point[axis])),
                    std::array::from_fn(|axis| high[axis].max(point[axis])),
                ),
            })
        })
}

// ---------------------------------------------------------------- меши

/// Потоки одного меша в порядке записи: ключ атрибута, байты, описание accessor.
fn mesh_streams(mesh: &MeshData) -> Vec<(&'static str, Vec<u8>, Access)> {
    let mut streams = vec![(
        "POSITION",
        floats_le(&mesh.positions),
        Access::new(FLOAT, "VEC3", mesh.positions.len() / 3).within(axis_bounds(&mesh.positions)),
    )];
    if let Some(normals) = &mesh.normals {
        streams.push((
            "NORMAL",
            floats_le(normals),
            Access::new(FLOAT, "VEC3", normals.len() / 3),
        ));
    }
    if let Some(uvs) = &mesh.uvs {
        streams.push((
            "TEXCOORD_0",
            floats_le(uvs),
            Access::new(FLOAT, "VEC2", uvs.len() / 2),
        ));
    }
    if let Some(colours) = &mesh.colours {
        streams.push((
            "COLOR_0",
            colours.clone(),
            Access::new(UBYTE, "VEC4", colours.len() / 4).normalised(),
        ));
    }
    if let (Some(joints), Some(weights)) = (&mesh.joints, &mesh.weights) {
        let (bytes, component) = match joints.iter().all(|&j| j <= 255) {
            true => (joints.iter().map(|&j| j as u8).collect(), UBYTE),
            false => (
                joints.iter().flat_map(|j| j.to_le_bytes()).collect(),
                USHORT,
            ),
        };
        streams.push((
            "JOINTS_0",
            bytes,
            Access::new(component, "VEC4", joints.len() / 4),
        ));
        streams.push((
            "WEIGHTS_0",
            floats_le(weights),
            Access::new(FLOAT, "VEC4", weights.len() / 4),
        ));
    }
    streams
}

/// Пакует один меш и возвращает JSON меша.
fn pack_mesh(buffer: &mut Buffer, mesh: &MeshData, index: usize, material_count: usize) -> Value {
    let mut attributes = Map::new();
    for (key, bytes, access) in mesh_streams(mesh) {
        let at = buffer.attribute(&bytes, Some(TARGET_ARRAY), access);
        attributes.insert(key.to_owned(), json!(at));
    }
    let index_bytes: Vec<u8> = mesh.indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    let indices = buffer.attribute(
        &index_bytes,
        Some(TARGET_ELEMENTS),
        Access::new(USHORT, "SCALAR", mesh.indices.len()),
    );
    let primitive = present(vec![
        Some(("attributes", Value::Object(attributes))),
        Some(("indices", json!(indices))),
        Some(("mode", json!(4))),
        mesh.material
            .filter(|&m| m < material_count)
            .map(|material| ("material", json!(material))),
    ]);
    json!({ "name": mesh_name(mesh, index), "primitives": [primitive] })
}

// ------------------------------------------------------ материалы и узлы

fn material_json(material: &MaterialData) -> Value {
    let pbr = present(vec![
        Some(("metallicFactor", json!(0))),
        Some(("roughnessFactor", num(0.6))),
        material
            .base_color_factor
            .map(|factor| ("baseColorFactor", nums(&factor))),
        material
            .base_color_texture
            .map(|texture| ("baseColorTexture", json!({ "index": texture }))),
    ]);
    let head = vec![
        ("name", json!(material.name)),
        ("pbrMetallicRoughness", pbr),
        ("doubleSided", json!(material.double_sided)),
    ];
    let normal = material
        .normal_texture
        .map(|texture| ("normalTexture", json!({ "index": texture })));
    let alpha = match material.alpha_mode {
        AlphaMode::Opaque => vec![],
        AlphaMode::Mask => vec![
            ("alphaMode", json!("MASK")),
            ("alphaCutoff", num(material.alpha_cutoff)),
        ],
        AlphaMode::Blend => vec![("alphaMode", json!("BLEND"))],
    };
    let glow = match (material.emissive, material.base_color_texture) {
        (false, _) => vec![],
        (true, Some(texture)) => vec![
            ("emissiveTexture", json!({ "index": texture })),
            ("emissiveFactor", json!([1, 1, 1])),
        ],
        // Свечение без картинки: светится цветом материала (или белым).
        (true, None) => vec![(
            "emissiveFactor",
            material
                .base_color_factor
                .map_or_else(|| json!([1, 1, 1]), |f| nums(&[f[0], f[1], f[2]])),
        )],
    };
    object(head.into_iter().chain(normal).chain(alpha).chain(glow))
}

fn node_json(node: &NodeData) -> Value {
    present(vec![
        node.name.as_ref().map(|name| ("name", json!(name))),
        (!node.children.is_empty()).then(|| ("children", json!(node.children))),
        node.mesh.map(|mesh| ("mesh", json!(mesh))),
        node.translation.map(|v| ("translation", nums(&v))),
        node.rotation.map(|v| ("rotation", nums(&v))),
        node.scale.map(|v| ("scale", nums(&v))),
        node.matrix.map(|v| ("matrix", nums(&v))),
        node.skin.map(|skin| ("skin", json!(skin))),
    ])
}

// ---------------------------------------------------------------- запись

const MAGIC: u32 = 0x4654_6C67;
const CHUNK_JSON: u32 = 0x4E4F_534A;
const CHUNK_BIN: u32 = 0x004E_4942;

/// Длина всего файла для слова заголовка: 12 байт заголовка, по 8 на каждый кусок и сами куски.
fn file_length(json_len: usize, bin_len: usize) -> Result<u32> {
    [12, 8, json_len, 8, bin_len]
        .into_iter()
        .try_fold(0usize, usize::checked_add)
        .and_then(|total| u32::try_from(total).ok())
        .ok_or_else(|| Error::argument("Размер GLB не помещается в 32-битное слово заголовка."))
}

/// Рамка контейнера: заголовок, кусок JSON, кусок BIN.
fn container(json_bytes: &[u8], bin: &[u8]) -> Result<Vec<u8>> {
    // Файл не длиннее слова длины, поэтому и длины кусков влезают в u32.
    let total = file_length(json_bytes.len(), bin.len())?;
    let words = |words: &[u32]| -> Vec<u8> { words.iter().flat_map(|w| w.to_le_bytes()).collect() };
    Ok([
        words(&[MAGIC, 2, total, json_bytes.len() as u32, CHUNK_JSON]),
        json_bytes.to_vec(),
        words(&[bin.len() as u32, CHUNK_BIN]),
        bin.to_vec(),
    ]
    .concat())
}

/// Узлы и корни сцены; без своих узлов на каждый меш — по узлу.
fn scene_nodes(scene: &Scene) -> (Vec<Value>, Vec<usize>) {
    if !scene.nodes.is_empty() {
        let nodes = scene.nodes.iter().map(node_json).collect();
        return (nodes, scene.roots.clone());
    }
    let nodes = scene
        .meshes
        .iter()
        .enumerate()
        .map(|(i, mesh)| json!({ "name": mesh_name(mesh, i), "mesh": i }))
        .collect();
    (nodes, (0..scene.meshes.len()).collect())
}

pub fn write(scene: &Scene) -> Result<Vec<u8>> {
    let mut buffer = Buffer::default();

    let mut images: Vec<Value> = Vec::new();
    for image in &scene.images {
        let view = buffer.view(&image.bytes, None);
        images.push(json!({ "bufferView": view, "mimeType": image.mime_type }));
    }
    let mut meshes: Vec<Value> = Vec::new();
    for (i, mesh) in scene.meshes.iter().enumerate() {
        meshes.push(pack_mesh(&mut buffer, mesh, i, scene.materials.len()));
    }
    let mut skins: Vec<Value> = Vec::new();
    for skin in &scene.skins {
        let flat: Vec<f32> = skin.inverse_bind.concat();
        let access = Access::new(FLOAT, "MAT4", skin.inverse_bind.len());
        let matrices = buffer.attribute(&floats_le(&flat), None, access);
        skins.push(json!({ "inverseBindMatrices": matrices, "joints": skin.joints }));
    }
    let (nodes, roots) = scene_nodes(scene);

    let textures: Vec<Value> = (0..images.len())
        .map(|i| json!({ "sampler": 0, "source": i }))
        .collect();
    let samplers = match images.is_empty() {
        true => Vec::new(),
        false => {
            vec![json!({ "magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497 })]
        }
    };
    let has_views = !buffer.views.is_empty();
    let bin_len = buffer.bin.len();
    let optional: Vec<(&str, Vec<Value>)> = vec![
        ("meshes", meshes),
        ("skins", skins),
        (
            "materials",
            scene.materials.iter().map(material_json).collect(),
        ),
        ("images", images),
        ("textures", textures),
        ("samplers", samplers),
        ("accessors", buffer.accessors),
        ("bufferViews", buffer.views),
        (
            "buffers",
            match has_views {
                true => vec![json!({ "byteLength": bin_len })],
                false => Vec::new(),
            },
        ),
    ];

    let mut root = vec![
        (
            "asset",
            json!({ "version": "2.0", "generator": "Astral engine" }),
        ),
        ("scene", json!(0)),
        ("scenes", json!([{ "name": scene.name, "nodes": roots }])),
        ("nodes", Value::Array(nodes)),
    ];
    root.extend(
        optional
            .into_iter()
            .filter(|(_, items)| !items.is_empty())
            .map(|(key, items)| (key, Value::Array(items))),
    );

    let mut json_bytes = serde_json::to_vec(&object(root)).unwrap_or_else(|_| b"{}".to_vec());
    json_bytes.resize((json_bytes.len() + 3) & !3, b' ');
    container(&json_bytes, &buffer.bin)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Все сцены в этих испытаниях малы: отказ по размеру здесь был бы ошибкой испытания.
    fn write(scene: &Scene) -> Vec<u8> {
        super::write(scene).unwrap()
    }

    fn hex(bytes: &[u8]) -> String {
        let mut text = String::new();
        for b in bytes {
            text += &format!("{b:02x}");
        }
        text
    }

    fn le(bytes: &[u8], at: usize) -> usize {
        let word: [u8; 4] = bytes[at..at + 4].try_into().unwrap();
        u32::from_le_bytes(word) as usize
    }

    /// Проверяет рамку контейнера; отдаёт текст JSON (без добивки) и байты BIN.
    fn parse(file: &[u8]) -> (String, Vec<u8>) {
        assert_eq!(&file[0..4], b"glTF");
        assert_eq!(le(file, 4), 2);
        assert_eq!(le(file, 8), file.len());
        let json_len = le(file, 12);
        assert_eq!(json_len % 4, 0);
        assert_eq!(le(file, 16), 0x4E4F_534A_usize);
        let text = String::from_utf8(file[20..20 + json_len].to_vec()).unwrap();
        let bin_at = 20 + json_len;
        let bin_len = le(file, bin_at);
        assert_eq!(bin_len % 4, 0);
        assert_eq!(le(file, bin_at + 4), 0x004E_4942);
        assert_eq!(file.len(), bin_at + 8 + bin_len);
        let json = text.trim_end_matches(' ').to_string();
        (json, file[bin_at + 8..].to_vec())
    }

    /// Значение, записанное как JSON, равно ожидаемому тексту.
    fn same(value: &Value, expected: &str) {
        assert_eq!(value.to_string(), expected);
    }

    fn doc(file: &[u8]) -> Value {
        let (text, _) = parse(file);
        serde_json::from_str(&text).unwrap()
    }

    /// Меш `name` с заданными позициями; остальное по умолчанию.
    fn bare(name: &str, positions: Vec<f32>) -> MeshData {
        let mut mesh = MeshData::default();
        mesh.name = name.into();
        mesh.positions = positions;
        mesh
    }

    fn triangle() -> MeshData {
        let mut mesh = bare("tri", vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0, 0.0]);
        mesh.indices = vec![0, 1, 2];
        mesh.material = Some(0);
        mesh.uvs = Some(vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
        mesh.normals = Some([0.0, 0.0, 1.0].repeat(3));
        mesh
    }

    fn scene_of(meshes: Vec<MeshData>) -> Scene {
        let mut scene = Scene::default();
        scene.materials.push(MaterialData::default());
        scene.name = "test".into();
        scene.meshes = meshes;
        scene
    }

    fn one(mesh: MeshData) -> Scene {
        let mut scene = Scene::default();
        scene.meshes.push(mesh);
        scene
    }

    fn one_scene(meshes: Vec<MeshData>) -> Scene {
        let mut scene = Scene::default();
        scene.meshes = meshes;
        scene
    }

    /// Картинка с заданными байтами и типом.
    fn image(bytes: Vec<u8>, mime_type: &'static str) -> ImageData {
        ImageData { bytes, mime_type }
    }

    /// Материал по умолчанию, поправленный функцией.
    fn tuned(name: &str, edit: impl FnOnce(&mut MaterialData)) -> MaterialData {
        let mut material = MaterialData::default();
        material.name = name.into();
        edit(&mut material);
        material
    }

    const TRI_BIN: &str = "0000000000000000000000000000803f000000000000000000000000000000400000000000000000000000000000803f00000000000000000000803f00000000000000000000803f00000000000000000000803f00000000000000000000803f0000010002000000";

    #[test]
    fn l1_empty_scene() {
        let file = write(&Scene::default());
        assert_eq!(file.len(), 140);
        assert_eq!(
            hex(&file),
            "676c5446020000008c000000700000004a534f4e7b226173736574223a7b2276657273696f6e223a22322e30222c2267656e657261746f72223a2241737472616c20656e67696e65227d2c227363656e65223a302c227363656e6573223a5b7b226e616d65223a22222c226e6f646573223a5b5d7d5d2c226e6f646573223a5b5d7d20200000000042494e00"
        );
        assert_eq!(
            parse(&file).0,
            r#"{"asset":{"version":"2.0","generator":"Astral engine"},"scene":0,"scenes":[{"name":"","nodes":[]}],"nodes":[]}"#
        );
    }

    #[test]
    fn l2_triangle() {
        let file = write(&scene_of(vec![triangle()]));
        assert_eq!(file.len(), 1128);
        assert_eq!(hex(&file[..20]), "676c54460200000068040000e40300004a534f4e");
        let (json, bin) = parse(&file);
        assert_eq!(
            json,
            r#"{"asset":{"version":"2.0","generator":"Astral engine"},"scene":0,"scenes":[{"name":"test","nodes":[0]}],"nodes":[{"name":"tri","mesh":0}],"meshes":[{"name":"tri","primitives":[{"attributes":{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2},"indices":3,"mode":4,"material":0}]}],"materials":[{"name":"material","pbrMetallicRoughness":{"metallicFactor":0,"roughnessFactor":0.6000000238418579},"doubleSided":false}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0.0,0.0,0.0],"max":[1.0,2.0,0.0]},{"bufferView":1,"componentType":5126,"count":3,"type":"VEC3"},{"bufferView":2,"componentType":5126,"count":3,"type":"VEC2"},{"bufferView":3,"componentType":5123,"count":3,"type":"SCALAR"}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36,"target":34962},{"buffer":0,"byteOffset":36,"byteLength":36,"target":34962},{"buffer":0,"byteOffset":72,"byteLength":24,"target":34962},{"buffer":0,"byteOffset":96,"byteLength":6,"target":34963}],"buffers":[{"byteLength":104}]}"#
        );
        assert_eq!(hex(&bin), TRI_BIN);
        assert_eq!(
            hex(&file[file.len() - 112..file.len() - 104]),
            "6800000042494e00"
        );
    }

    fn materials_scene() -> Scene {
        let mask = tuned("mask", |m| {
            m.alpha_mode = AlphaMode::Mask;
            m.alpha_cutoff = 0.25;
        });
        let blend = tuned("blend", |m| {
            m.alpha_mode = AlphaMode::Blend;
            m.base_color_texture = Some(0);
            m.normal_texture = Some(1);
        });
        let glow = tuned("glow", |m| {
            m.base_color_texture = Some(0);
            m.double_sided = true;
            m.emissive = true;
            m.base_color_factor = Some([0.5, 0.25, 1.0, 1.0]);
        });
        let notex = tuned("glow_notex", |m| m.emissive = true);
        let mut mesh = triangle();
        mesh.name = "a".into();
        let mut scene = Scene::default();
        scene.name = "m".into();
        scene.meshes.push(mesh);
        scene.materials = vec![MaterialData::default(), mask, blend, glow, notex];
        scene.images = vec![
            image(vec![1, 2, 3], "image/png"),
            image(vec![4, 5, 6, 7, 8], "image/jpeg"),
        ];
        scene
    }

    #[test]
    fn l3_l23_l24_materials_and_images() {
        let file = write(&materials_scene());
        let (json, bin) = parse(&file);
        assert_eq!(bin.len(), 116);
        assert_eq!(
            json,
            r#"{"asset":{"version":"2.0","generator":"Astral engine"},"scene":0,"scenes":[{"name":"m","nodes":[0]}],"nodes":[{"name":"a","mesh":0}],"meshes":[{"name":"a","primitives":[{"attributes":{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2},"indices":3,"mode":4,"material":0}]}],"materials":[{"name":"material","pbrMetallicRoughness":{"metallicFactor":0,"roughnessFactor":0.6000000238418579},"doubleSided":false},{"name":"mask","pbrMetallicRoughness":{"metallicFactor":0,"roughnessFactor":0.6000000238418579},"doubleSided":false,"alphaMode":"MASK","alphaCutoff":0.25},{"name":"blend","pbrMetallicRoughness":{"metallicFactor":0,"roughnessFactor":0.6000000238418579,"baseColorTexture":{"index":0}},"doubleSided":false,"normalTexture":{"index":1},"alphaMode":"BLEND"},{"name":"glow","pbrMetallicRoughness":{"metallicFactor":0,"roughnessFactor":0.6000000238418579,"baseColorFactor":[0.5,0.25,1.0,1.0],"baseColorTexture":{"index":0}},"doubleSided":true,"emissiveTexture":{"index":0},"emissiveFactor":[1,1,1]},{"name":"glow_notex","pbrMetallicRoughness":{"metallicFactor":0,"roughnessFactor":0.6000000238418579},"doubleSided":false,"emissiveFactor":[1,1,1]}],"images":[{"bufferView":0,"mimeType":"image/png"},{"bufferView":1,"mimeType":"image/jpeg"}],"textures":[{"sampler":0,"source":0},{"sampler":0,"source":1}],"samplers":[{"magFilter":9729,"minFilter":9987,"wrapS":10497,"wrapT":10497}],"accessors":[{"bufferView":2,"componentType":5126,"count":3,"type":"VEC3","min":[0.0,0.0,0.0],"max":[1.0,2.0,0.0]},{"bufferView":3,"componentType":5126,"count":3,"type":"VEC3"},{"bufferView":4,"componentType":5126,"count":3,"type":"VEC2"},{"bufferView":5,"componentType":5123,"count":3,"type":"SCALAR"}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":3},{"buffer":0,"byteOffset":4,"byteLength":5},{"buffer":0,"byteOffset":12,"byteLength":36,"target":34962},{"buffer":0,"byteOffset":48,"byteLength":36,"target":34962},{"buffer":0,"byteOffset":84,"byteLength":24,"target":34962},{"buffer":0,"byteOffset":108,"byteLength":6,"target":34963}],"buffers":[{"byteLength":116}]}"#
        );
    }

    #[test]
    fn l4_l5_primitive_material_and_names() {
        let mut mesh = triangle();
        mesh.material = Some(5);
        let v = doc(&write(&scene_of(vec![mesh])));
        same(
            &v["meshes"][0]["primitives"][0],
            r#"{"attributes":{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2},"indices":3,"mode":4}"#,
        );
        let mut unnamed = triangle();
        unnamed.name = String::new();
        unnamed.material = None;
        let v = doc(&write(&one_scene(vec![unnamed.clone(), unnamed])));
        same(
            &v["meshes"],
            r#"[{"name":"mesh_0","primitives":[{"attributes":{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2},"indices":3,"mode":4}]},{"name":"mesh_1","primitives":[{"attributes":{"POSITION":4,"NORMAL":5,"TEXCOORD_0":6},"indices":7,"mode":4}]}]"#,
        );
        same(
            &v["nodes"],
            r#"[{"name":"mesh_0","mesh":0},{"name":"mesh_1","mesh":1}]"#,
        );
    }

    #[test]
    fn l6_colours() {
        let mut mesh = triangle();
        mesh.material = None;
        mesh.colours = Some(vec![255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]);
        let (json, bin) = parse(&write(&one(mesh)));
        let v: Value = serde_json::from_str(&json).unwrap();
        same(
            &v["meshes"][0]["primitives"][0]["attributes"],
            r#"{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2,"COLOR_0":3}"#,
        );
        same(
            &v["accessors"][3],
            r#"{"bufferView":3,"componentType":5121,"normalized":true,"count":3,"type":"VEC4"}"#,
        );
        let tail = hex(&bin);
        assert_eq!(
            &tail[tail.len() - 40..],
            "ff0000ff00ff00800000ff000000010002000000"
        );
        assert_eq!(v["accessors"].as_array().unwrap().len(), 5);
    }

    fn skinned(joints: Vec<u16>) -> MeshData {
        let mut mesh = triangle();
        mesh.material = None;
        mesh.weights = Some([1.0, 0.0, 0.0, 0.0].repeat(3));
        mesh.joints = Some(joints);
        mesh
    }

    #[test]
    fn l7_l9_joints() {
        let narrow = doc(&write(&one(skinned(vec![
            0, 1, 2, 3, 255, 0, 0, 0, 1, 1, 1, 1,
        ]))));
        same(
            &narrow["meshes"][0]["primitives"][0]["attributes"],
            r#"{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2,"JOINTS_0":3,"WEIGHTS_0":4}"#,
        );
        same(
            &narrow["accessors"][3],
            r#"{"bufferView":3,"componentType":5121,"count":3,"type":"VEC4"}"#,
        );
        same(
            &narrow["accessors"][4],
            r#"{"bufferView":4,"componentType":5126,"count":3,"type":"VEC4"}"#,
        );
        assert_eq!(narrow["bufferViews"][3]["byteLength"], 12);
        let wide = doc(&write(&one(skinned(vec![
            0, 1, 2, 3, 256, 0, 0, 0, 1, 1, 1, 1,
        ]))));
        same(
            &wide["accessors"][3],
            r#"{"bufferView":3,"componentType":5123,"count":3,"type":"VEC4"}"#,
        );
        assert_eq!(wide["bufferViews"][3]["byteLength"], 24);
        let mut only_joints = skinned(vec![0; 12]);
        only_joints.weights = None;
        let v = doc(&write(&one(only_joints)));
        same(
            &v["meshes"][0]["primitives"][0]["attributes"],
            r#"{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2}"#,
        );
    }

    #[test]
    fn l10_nodes_and_skin() {
        let mut armature = NodeData::default();
        armature.name = Some("Armature".into());
        armature.children = vec![1];
        let mut bone = NodeData::default();
        bone.name = Some("bone".into());
        bone.translation = Some([1.0, 2.0, 3.0]);
        bone.rotation = Some([0.0, 0.0, 0.0, 1.0]);
        bone.scale = Some([2.0, 2.0, 2.0]);
        let mut holder = NodeData::default();
        holder.mesh = Some(0);
        holder.matrix = Some(std::array::from_fn(|i| if i % 5 == 0 { 1.0 } else { 0.0 }));
        holder.skin = Some(0);
        let mut scene = Scene::default();
        scene.name = "n".into();
        scene.meshes = vec![skinned(vec![0, 1, 2, 3, 0, 0, 0, 0, 1, 1, 1, 1])];
        scene.nodes = vec![armature, bone, holder];
        scene.roots = vec![0, 2];
        scene.skins = vec![SkinData {
            joints: vec![1],
            inverse_bind: vec![[0.0; 16]],
        }];
        let (json, bin) = parse(&write(&scene));
        let v: Value = serde_json::from_str(&json).unwrap();
        same(
            &v["nodes"],
            r#"[{"name":"Armature","children":[1]},{"name":"bone","translation":[1.0,2.0,3.0],"rotation":[0.0,0.0,0.0,1.0],"scale":[2.0,2.0,2.0]},{"mesh":0,"matrix":[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0],"skin":0}]"#,
        );
        same(&v["scenes"], r#"[{"name":"n","nodes":[0,2]}]"#);
        same(&v["skins"], r#"[{"inverseBindMatrices":6,"joints":[1]}]"#);
        same(
            &v["accessors"][6],
            r#"{"bufferView":6,"componentType":5126,"count":1,"type":"MAT4"}"#,
        );
        same(
            &v["bufferViews"][6],
            r#"{"buffer":0,"byteOffset":164,"byteLength":64}"#,
        );
        assert_eq!(bin.len(), 228);
        let order: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(
            order,
            [
                "asset",
                "scene",
                "scenes",
                "nodes",
                "meshes",
                "skins",
                "accessors",
                "bufferViews",
                "buffers"
            ]
        );
    }

    #[test]
    fn l11_explicit_nodes_without_roots() {
        let mut scene = Scene::default();
        scene.nodes.push(NodeData::default());
        let v = doc(&write(&scene));
        same(&v["scenes"], r#"[{"name":"","nodes":[]}]"#);
        same(&v["nodes"], "[{}]");
    }

    #[test]
    fn l12_l17_empty_mesh() {
        let (json, bin) = parse(&write(&one(MeshData::default())));
        let v: Value = serde_json::from_str(&json).unwrap();
        same(
            &v["meshes"],
            r#"[{"name":"mesh_0","primitives":[{"attributes":{"POSITION":0},"indices":1,"mode":4}]}]"#,
        );
        same(
            &v["accessors"],
            r#"[{"bufferView":0,"componentType":5126,"count":0,"type":"VEC3"},{"bufferView":1,"componentType":5123,"count":0,"type":"SCALAR"}]"#,
        );
        same(
            &v["bufferViews"],
            r#"[{"buffer":0,"byteOffset":0,"byteLength":0,"target":34962},{"buffer":0,"byteOffset":0,"byteLength":0,"target":34963}]"#,
        );
        assert!(bin.is_empty());
    }

    #[test]
    fn l13_image_offsets() {
        let mut scene = Scene::default();
        scene.images.push(image(vec![7], "image/png"));
        scene.images.push(image(vec![8; 6], "image/png"));
        let (json, bin) = parse(&write(&scene));
        let v: Value = serde_json::from_str(&json).unwrap();
        same(
            &v["bufferViews"],
            r#"[{"buffer":0,"byteOffset":0,"byteLength":1},{"buffer":0,"byteOffset":4,"byteLength":6}]"#,
        );
        same(&v["buffers"], r#"[{"byteLength":12}]"#);
        assert_eq!(hex(&bin), "070000000808080808080000");
        assert!(v.get("accessors").is_none());
    }

    #[test]
    fn l14_escaping() {
        let mut scene = Scene::default();
        scene.name = "a\"б\n".into();
        same(
            &doc(&write(&scene))["scenes"],
            "[{\"name\":\"a\\\"б\\n\",\"nodes\":[]}]",
        );
    }

    /// Описание первого accessor (позиций) после записи меша `mesh` одним в сцене.
    fn first_accessor(mesh: MeshData) -> String {
        doc(&write(&one(mesh)))["accessors"][0].to_string()
    }

    #[test]
    fn l15_l16_l18_l30_bounds_and_numbers() {
        let mut mesh = triangle();
        mesh.positions = vec![0.1, -2.5, 0.3, 1.0e10, 1.0, 3.0, 0.2, 0.0, 0.5];
        mesh.normals = None;
        mesh.uvs = None;
        mesh.material = Some(0);
        let mut scene = scene_of(vec![mesh]);
        scene.materials[0].base_color_factor = Some([0.1, 0.2, 0.3, 1.0]);
        let v = doc(&write(&scene));
        same(
            &v["accessors"][0],
            r#"{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0.10000000149011612,-2.5,0.30000001192092896],"max":[10000000000.0,1.0,3.0]}"#,
        );
        same(
            &v["materials"][0],
            r#"{"name":"material","pbrMetallicRoughness":{"metallicFactor":0,"roughnessFactor":0.6000000238418579,"baseColorFactor":[0.10000000149011612,0.20000000298023224,0.30000001192092896,1.0]},"doubleSided":false}"#,
        );
        // NaN и бесконечность не попадают в границы: точка с такой координатой пропускается
        let mut mesh = triangle();
        mesh.positions[4] = f32::NAN;
        assert_eq!(
            first_accessor(mesh),
            r#"{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0.0,0.0,0.0],"max":[0.0,2.0,0.0]}"#
        );
        let mut mesh = triangle();
        mesh.positions = vec![1.0, 0.0, 0.0, f32::INFINITY, 5.0, 6.0, 2.0, 1.0, 0.0];
        assert_eq!(
            first_accessor(mesh),
            r#"{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[1.0,0.0,0.0],"max":[2.0,1.0,0.0]}"#
        );
        // Ни одной конечной точки: границ нет (а не null).
        let mut mesh = triangle();
        mesh.positions = vec![
            f32::NAN,
            0.0,
            0.0,
            f32::INFINITY,
            1.0,
            1.0,
            0.0,
            f32::NEG_INFINITY,
            0.0,
        ];
        let v = doc(&write(&one(mesh)));
        assert!(v["accessors"][0].get("min").is_none() && v["accessors"][0].get("max").is_none());
        // Свечение без картинки не теряется: светится цветом материала, а без него белым.
        let mut dark = scene_of(vec![triangle()]);
        dark.materials[0].emissive = true;
        let v = doc(&write(&dark));
        assert_eq!(v["materials"][0]["emissiveFactor"], json!([1, 1, 1]));
        assert!(v["materials"][0].get("emissiveTexture").is_none());
        dark.materials[0].base_color_factor = Some([0.5, 0.25, 1.0, 1.0]);
        let v = doc(&write(&dark));
        assert_eq!(v["materials"][0]["emissiveFactor"], json!([0.5, 0.25, 1.0]));
        // длина не кратна трём
        let mesh = bare("", vec![0.0, 1.0, 2.0, 7.0, 8.0]);
        let v = doc(&write(&one(mesh)));
        same(
            &v["accessors"][0],
            r#"{"bufferView":0,"componentType":5126,"count":1,"type":"VEC3","min":[0.0,1.0,2.0],"max":[0.0,1.0,2.0]}"#,
        );
        assert_eq!(v["bufferViews"][0]["byteLength"], 20);
    }

    #[test]
    fn l19_l21_defaults() {
        assert_eq!(
            format!("{:?}", MaterialData::default()),
            r#"MaterialData { name: "material", base_color_texture: None, normal_texture: None, alpha_mode: Opaque, alpha_cutoff: 0.5, double_sided: false, emissive: false, base_color_factor: None }"#
        );
        assert_eq!(
            format!(
                "{:?} {:?} {:?}",
                NodeData::default(),
                SkinData::default(),
                Scene::default()
            ),
            r#"NodeData { name: None, children: [], mesh: None, translation: None, rotation: None, scale: None, matrix: None, skin: None } SkinData { joints: [], inverse_bind: [] } Scene { name: "", meshes: [], materials: [], images: [], nodes: [], roots: [], skins: [] }"#
        );
        assert_eq!(
            format!("{:?}", MeshData::default()),
            r#"MeshData { name: "", positions: [], normals: None, uvs: None, colours: None, indices: [], material: None, joints: None, weights: None }"#
        );
    }

    #[test]
    fn old_container_tests() {
        let mut mesh = triangle();
        mesh.name = "tri".into();
        let v = doc(&write(&one(mesh)));
        assert_eq!(v["asset"]["version"], "2.0");
        assert_eq!(v["scenes"][0]["nodes"], json!([0]));
        assert_eq!(v["accessors"][0]["count"], 3);
        assert_eq!(v["accessors"][0]["max"], json!([1.0, 2.0, 0.0]));

        let mut scene = Scene::default();
        scene.materials.push(tuned("glass|window", |m| {
            m.base_color_texture = Some(0);
            m.alpha_mode = AlphaMode::Mask;
            m.double_sided = true;
            m.emissive = true;
        }));
        scene.images.push(image(vec![1, 2, 3], "image/png"));
        let v = doc(&write(&scene));
        assert_eq!(v["materials"][0]["alphaMode"], "MASK");
        assert_eq!(v["materials"][0]["alphaCutoff"], 0.5);
        assert_eq!(v["materials"][0]["doubleSided"], true);
        assert_eq!(v["materials"][0]["emissiveTexture"]["index"], 0);
        assert_eq!(v["images"][0]["mimeType"], "image/png");
        assert_eq!(v["textures"][0]["source"], 0);
    }

    #[test]
    fn negative_control_wrong_count_is_detected() {
        let file = write(&scene_of(vec![triangle()]));
        let (_, bin) = parse(&file);
        assert_ne!(hex(&bin), TRI_BIN.replace("0000803f", "0000803e"));
    }

    #[test]
    fn a_file_longer_than_the_length_word_is_refused() {
        // Раньше длина писалась как `as u32`: файл больше 4 ГиБ получал короткую длину и читался как обрезанный.
        let max = u32::MAX as usize;
        assert_eq!(file_length(max - 28, 0).unwrap(), u32::MAX);
        assert_eq!(file_length(0, max - 28).unwrap(), u32::MAX);
        for (json, bin) in [(max - 27, 0), (0, max - 27), (1 << 40, 1 << 40), (usize::MAX, 1)] {
            let error = file_length(json, bin).unwrap_err();
            assert_eq!(
                (error.kind, error.message.as_str()),
                (
                    crate::error::Kind::Argument,
                    "Размер GLB не помещается в 32-битное слово заголовка."
                ),
                "{json} + {bin}"
            );
        }
    }
}
