//! Бандл сцены: набор моделей (частей) в один GLB и отчёт по каждой части.
//!
//! Дерево такое: узел части с её `id`, под ним узел на каждый уровень
//! детализации, на узле уровня стоит первый меш, остальные вешаются детьми.
//! Кости и скины не пишутся. Не прочитавшаяся часть попадает в отчёт с
//! ошибкой, остальные собираются.
//!
//! Вершины меша склеиваются (`convert::weld`), вырожденные треугольники
//! выбрасываются, поэтому в GLB вершин и треугольников может быть меньше. Числа
//! в отчёте по части считаются по прочитанной модели, то есть до склейки, и
//! с числами в самом файле могут расходиться.

use std::collections::{HashMap, HashSet};

use crate::{
    convert::{weld, Library},
    drawable::{self, FileKind, Frame, Level, Light, Lod, Material, Mesh},
    error::{Error, Kind, Result},
    glb::{self, ImageData, MaterialData, MeshData, NodeData, Scene},
    math::{matrix_to_gltf, nearly_identity},
    parallel::parallel_map,
    png_io::{encode_jpeg, encode_with},
    resource::Resource,
    shaders::{shader_name, AlphaMode, Role},
    texture::{self, TextureRef},
};

/// Открытая запись: `поле => тип`, порядок полей — как в списке.
macro_rules! report_record {
    ([$($derive:ident),+] $name:ident { $($field:ident => $kind:ty),+ $(,)? }) => {
        #[derive($($derive),+)]
        pub struct $name {
            $(pub $field: $kind),+
        }
    };
}

/// Ящик из двух углов: наименьшие и наибольшие координаты.
type Corners = ([f32; 3], [f32; 3]);

report_record!([Debug, Clone] Options {
    max_texture_size => u32,
    png_only => bool,
    jpeg_quality => u8,
    vertex_colours => bool,
    lods => bool,
    max_normal_texture_size => u32,
    normal_maps => bool,
});

report_record!([Debug, Clone] PieceInput {
    id => String,
    file => String,
    kind => FileKind,
    bytes => Vec<u8>,
    drawable_hash => Option<u32>,
});

report_record!([Debug, Clone] LodReport {
    level => &'static str,
    distance => f32,
    models => usize,
    meshes => usize,
    triangles => usize,
    vertices => usize,
});

report_record!([Debug, Clone] PieceReport {
    id => String,
    file => String,
    drawable_hash => Option<u32>,
    ok => bool,
    error => Option<String>,
    lods => Vec<LodReport>,
    bounds => Option<Corners>,
    sphere => Option<([f32; 3], f32)>,
    lights => Vec<Light>,
    textures => Vec<String>,
    missing_textures => Vec<String>,
    shaders => Vec<String>,
});

report_record!([Debug, Clone] ImageReport {
    name => String,
    width => u32,
    height => u32,
    source_width => u32,
    source_height => u32,
    bytes => usize,
    mime => &'static str,
    source => String,
});

report_record!([Debug] Bundle {
    glb => Vec<u8>,
    dictionaries => Vec<String>,
    materials => usize,
    triangles => usize,
    vertices => usize,
    image_bytes => usize,
    images => Vec<ImageReport>,
    pieces => Vec<PieceReport>,
});

const NO_GEOMETRY: &str = "Drawable has no renderable geometry.";
const NO_PIECES: &str = "No piece of the scene bundle could be converted.";
const PLACEHOLDERS: [&str; 4] = ["none", "givemechecker", "checker", "null"];
const LEVEL_NAMES: [&str; 4] = ["high", "med", "low", "vlow"];
const COLOUR_AND_NORMAL: [Role; 2] = [Role::Diffuse, Role::Normal];
const COLOUR_ONLY: [Role; 1] = [Role::Diffuse];

/// Откуда взята текстура; зашитые идут раньше внешних.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum Source {
    Embedded(usize),
    External(usize),
}

/// Ключ задания: имя строчными, откуда взята, карта нормалей ли.
type JobKey = (String, Source, bool);

/// Задания на цвет и карту нормалей слота: номера в общем списке.
type SlotJobs = [Option<usize>; 2];

/// Подготовленная часть: всё, что нужно для картинок и узлов.
struct Prepared {
    embedded: Vec<TextureRef>,
    materials: Vec<Option<Material>>,
    levels: Vec<Level>,
    resource: Resource,
}

struct Job<'a> {
    source: String,
    name: String,
    key: JobKey,
    texture: &'a TextureRef,
    resource: &'a Resource,
}

impl Job<'_> {
    fn is_normal(&self) -> bool {
        self.key.2
    }
}

struct Made {
    partial: f64,
    mime: &'static str,
    bytes: Vec<u8>,
    height: u32,
    width: u32,
}

fn failure_text(error: &Error) -> String {
    let named = [
        (Kind::Argument, "ArgumentException"),
        (Kind::Io, "IOException"),
    ];
    let class = named
        .into_iter()
        .find_map(|(kind, class)| (kind == error.kind).then_some(class))
        .unwrap_or("InvalidDataException");
    format!("{class}: {}", error.message)
}

/// Сортировка по верхнему регистру, затем по самой строке; соседние повторы уходят.
fn order_names(names: Vec<String>) -> Vec<String> {
    let mut keyed: Vec<(String, String)> = names
        .into_iter()
        .map(|name| (name.to_uppercase(), name))
        .collect();
    keyed.sort();
    keyed.dedup();
    keyed.into_iter().map(|(_, name)| name).collect()
}

fn distance_slot(lod: Lod) -> usize {
    Lod::ORDER.iter().position(|item| *item == lod).unwrap_or(0)
}

fn level_name(lod: Lod) -> &'static str {
    LEVEL_NAMES[distance_slot(lod)]
}

fn is_placeholder(name: &str) -> bool {
    PLACEHOLDERS
        .iter()
        .any(|stub| name.eq_ignore_ascii_case(stub))
}

fn real_texture(material: &Material, role: Role) -> Option<&str> {
    let name = material.textures.get(&role)?.as_str();
    (!name.is_empty() && !is_placeholder(name)).then_some(name)
}

fn shader_label(material: &Material) -> String {
    match shader_name(material.shader_hash) {
        Some(name) => name.to_owned(),
        None => format!("<unknown:{}>", material.shader_hash),
    }
}

/// Вершины меша; жёсткие части переводятся матрицей своей кости.
fn placed_points(mesh: &Mesh) -> Vec<[f32; 3]> {
    let placement = mesh
        .bone_matrix
        .map(|m| matrix_to_gltf(&m))
        .filter(|m| !nearly_identity(m));
    let shift = |v: &[f32]| match &placement {
        Some(m) => {
            [0, 1, 2].map(|row| m[row] * v[0] + m[row + 4] * v[1] + m[row + 8] * v[2] + m[row + 12])
        }
        None => [v[0], v[1], v[2]],
    };
    mesh.positions.chunks_exact(3).map(shift).collect()
}

/// Ящик по вершинам всех уровней.
fn bounding_box(levels: &[Level]) -> Option<Corners> {
    let mut corners: Corners = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
    let mut seen = false;
    let points = levels
        .iter()
        .flat_map(|level| &level.meshes)
        .flat_map(placed_points);
    for point in points {
        seen = true;
        for axis in 0..3 {
            corners.0[axis] = corners.0[axis].min(point[axis]);
            corners.1[axis] = corners.1[axis].max(point[axis]);
        }
    }
    seen.then_some(corners)
}

/// Строка уровня отчёта: числа считаются по прочитанным мешам.
fn lod_report(level: &Level, frame: &Frame) -> LodReport {
    let per_mesh = |size: fn(&Mesh) -> usize| level.meshes.iter().map(size).sum::<usize>();
    LodReport {
        vertices: per_mesh(|mesh| mesh.positions.len() / 3),
        triangles: per_mesh(|mesh| mesh.indices.len() / 3),
        meshes: level.meshes.len(),
        models: level.models,
        distance: frame.lod_distances[distance_slot(level.lod)],
        level: level_name(level.lod),
    }
}

fn blank_report(input: &PieceInput) -> PieceReport {
    PieceReport {
        lods: Default::default(),
        lights: Default::default(),
        textures: Default::default(),
        missing_textures: Default::default(),
        shaders: Default::default(),
        error: None,
        bounds: None,
        sphere: None,
        ok: false,
        drawable_hash: input.drawable_hash,
        file: input.file.clone(),
        id: input.id.clone(),
    }
}

/// Смещение рисунка в файле: у YDD — по хэшу, у остальных — первый.
fn pick_drawable(resource: &Resource, input: &PieceInput) -> Result<usize> {
    let model = drawable::open_model(resource, Some(input.kind))?;
    let chosen = match (input.kind, input.drawable_hash) {
        (FileKind::Ydd, Some(hash)) => model
            .entries
            .iter()
            .position(|entry| entry.hash == Some(hash))
            .ok_or_else(|| Error::broken(format!("YDD has no drawable 0x{hash:08x}.")))?,
        _ => (!model.entries.is_empty())
            .then_some(0)
            .ok_or_else(|| Error::broken(NO_GEOMETRY))?,
    };
    Ok(model.entries[chosen].at)
}

/// Материалы, зашитые текстуры, рамка и огни рисунка; у YFT огней нет.
fn read_extras(
    resource: &Resource,
    at: usize,
    kind: FileKind,
) -> Result<(Vec<Option<Material>>, Vec<TextureRef>, Frame, Vec<Light>)> {
    let (_, materials, embedded) = drawable::read_materials(resource, at)?;
    let frame = drawable::read_frame(resource, at)?;
    let lights = match kind {
        FileKind::Yft => Vec::new(),
        _ => drawable::read_lights(resource, at)?,
    };
    Ok((materials, embedded, frame, lights))
}

/// Разбор части до уровней, материалов и рамки.
fn prepare(input: &PieceInput, options: &Options) -> Result<(Prepared, PieceReport)> {
    let resource = Resource::parse(&input.bytes)?;
    let at = pick_drawable(&resource, input)?;
    let mut levels = drawable::read_levels(&resource, at)?;
    levels.retain(|level| !level.meshes.is_empty());
    levels.truncate(if options.lods { levels.len() } else { 1 });
    if levels.is_empty() {
        return Err(Error::broken(NO_GEOMETRY));
    }
    let (materials, embedded, frame, lights) = read_extras(&resource, at, input.kind)?;
    let report = PieceReport {
        ok: true,
        lights,
        sphere: Some((frame.sphere_center, frame.sphere_radius)),
        bounds: bounding_box(&levels),
        lods: levels
            .iter()
            .map(|level| lod_report(level, &frame))
            .collect(),
        ..blank_report(input)
    };
    let part = Prepared {
        embedded,
        materials,
        levels,
        resource,
    };
    Ok((part, report))
}

/// Все части по порядку: годные — с разбором, негодные — только с отчётом об ошибке.
fn prepare_all(
    inputs: &[PieceInput],
    options: &Options,
) -> (Vec<Option<Prepared>>, Vec<PieceReport>) {
    inputs
        .iter()
        .map(|input| match prepare(input, options) {
            Ok((part, report)) => (Some(part), report),
            Err(error) => {
                let report = PieceReport {
                    error: Some(failure_text(&error)),
                    ..blank_report(input)
                };
                (None, report)
            }
        })
        .unzip()
}

/// Режим прозрачности по материалу и доле частично прозрачных пикселей цвета.
fn bundle_alpha(material: Option<&Material>, partial: f64) -> AlphaMode {
    let drawn = material.filter(|m| m.render_bucket != 0 && shader_name(m.shader_hash).is_some());
    let Some(material) = drawn else {
        return AlphaMode::Opaque;
    };
    let shader = material.shader.as_str();
    let blends = match material.render_bucket {
        1 => {
            shader.starts_with("emissive")
                || shader.starts_with("glass")
                || (shader == "default" && partial > 0.5)
        }
        3 => shader == "default_tnt",
        _ => false,
    };
    if blends {
        AlphaMode::Blend
    } else {
        AlphaMode::Mask
    }
}

fn same_material(a: &MaterialData, b: &MaterialData) -> bool {
    let textures = |m: &MaterialData| (m.base_color_texture, m.normal_texture);
    a.name == b.name
        && textures(a) == textures(b)
        && (a.alpha_mode, a.double_sided, a.emissive) == (b.alpha_mode, b.double_sided, b.emissive)
}

/// Картинка задания в байтах GLB: JPEG для непрозрачных цветовых карт, иначе PNG.
fn run_job(job: &Job, options: &Options) -> Option<Made> {
    let limit = match job.is_normal() {
        true => options.max_normal_texture_size,
        false => options.max_texture_size,
    };
    let image = texture::decode(job.resource, job.texture, None, Some(limit)).ok()?;
    let (width, height) = (image.width, image.height);
    let as_jpeg = !(image.has_transparency() || job.is_normal() || options.png_only);
    let (encoded, mime) = if as_jpeg {
        let jpeg = encode_jpeg(width, height, &image.rgba, options.jpeg_quality);
        (jpeg, "image/jpeg")
    } else {
        let png = encode_with(width, height, &image.rgba, png::Compression::Default);
        (png, "image/png")
    };
    let half_clear = image
        .rgba
        .chunks_exact(4)
        .filter(|p| p[3] != 0 && p[3] != 255)
        .count();
    let pixels = (width as usize * height as usize).max(1);
    Some(Made {
        partial: half_clear as f64 / pixels as f64,
        bytes: encoded.ok()?,
        mime,
        height,
        width,
    })
}

/// Где искать текстуру по имени: сначала словари, потом зашитые в часть.
fn locate_texture<'a>(
    library: &'a Library,
    part: &'a Prepared,
    at: usize,
    name: &str,
) -> Option<(Source, &'a Resource, &'a TextureRef, String)> {
    if let Some((index, resource, texture)) = library.find_in(name) {
        let label = library.dictionary(index).name.clone();
        return Some((Source::External(index), resource, texture, label));
    }
    let embedded = part
        .embedded
        .iter()
        .find(|texture| texture.name.eq_ignore_ascii_case(name))?;
    Some((
        Source::Embedded(at),
        &part.resource,
        embedded,
        "embedded".to_owned(),
    ))
}

/// Задания на картинки (общие для частей по ключу) и их номера по слотам материалов.
struct JobPlan<'a> {
    jobs: Vec<Job<'a>>,
    slots: Vec<HashMap<usize, SlotJobs>>,
}

struct Planner<'a> {
    library: &'a Library,
    roles: &'static [Role],
    by_key: HashMap<JobKey, usize>,
    plan: JobPlan<'a>,
}

impl<'a> Planner<'a> {
    /// Номер задания; новое заводится, только если ключа ещё не было.
    fn job_for(&mut self, job: Job<'a>) -> usize {
        if let Some(&known) = self.by_key.get(&job.key) {
            return known;
        }
        let number = self.plan.jobs.len();
        self.by_key.insert(job.key.clone(), number);
        self.plan.jobs.push(job);
        number
    }

    /// Текстуры одного материала по ролям: отчёт и задания для используемых слотов.
    fn plan_slot(
        &mut self,
        part: (usize, &'a Prepared),
        slot: (usize, &Material),
        used: &HashSet<usize>,
        report: &mut PieceReport,
    ) {
        let ((at, part), (slot, material)) = (part, slot);
        report.shaders.push(shader_label(material));
        for (role_at, &role) in self.roles.iter().enumerate() {
            let Some(name) = real_texture(material, role) else {
                continue;
            };
            let Some((source, resource, texture, label)) =
                locate_texture(self.library, part, at, name)
            else {
                if role == Role::Diffuse {
                    report.missing_textures.push(name.to_owned());
                }
                continue;
            };
            report.textures.push(texture.name.clone());
            if !used.contains(&slot) {
                continue;
            }
            let id = self.job_for(Job {
                key: (texture.name.to_lowercase(), source, role == Role::Normal),
                name: texture.name.clone(),
                source: label,
                resource,
                texture,
            });
            self.plan.slots[at].entry(slot).or_default()[role_at] = Some(id);
        }
    }

    fn plan_part(&mut self, at: usize, part: &'a Prepared, report: &mut PieceReport) {
        let used: HashSet<usize> = part
            .levels
            .iter()
            .flat_map(|level| &level.meshes)
            .map(|mesh| mesh.shader_index)
            .collect();
        let present = part
            .materials
            .iter()
            .enumerate()
            .filter_map(|(slot, material)| Some((slot, material.as_ref()?)));
        for (slot, material) in present {
            self.plan_slot((at, part), (slot, material), &used, report);
        }
    }
}

fn plan_jobs<'a>(
    library: &'a Library,
    parts: &'a [Option<Prepared>],
    reports: &mut [PieceReport],
    options: &Options,
) -> JobPlan<'a> {
    let roles: &'static [Role] = if options.normal_maps {
        &COLOUR_AND_NORMAL
    } else {
        &COLOUR_ONLY
    };
    let mut planner = Planner {
        library,
        roles,
        by_key: HashMap::new(),
        plan: JobPlan {
            jobs: Vec::new(),
            slots: vec![HashMap::new(); parts.len()],
        },
    };
    for (at, (part, report)) in parts.iter().zip(reports.iter_mut()).enumerate() {
        if let Some(part) = part {
            planner.plan_part(at, part, report);
        }
    }
    planner.plan
}

/// Картинки GLB без повторов и отчёты о них.
struct Atlas {
    images: Vec<ImageData>,
    image_of: Vec<Option<usize>>,
    reports: Vec<ImageReport>,
}

impl Atlas {
    /// Номер картинки с такими байтами; новая добавляется, если такой ещё нет.
    fn image_index(&mut self, made: &Made) -> usize {
        if let Some(found) = self.images.iter().position(|i| i.bytes == made.bytes) {
            return found;
        }
        self.images.push(ImageData {
            mime_type: made.mime,
            bytes: made.bytes.clone(),
        });
        self.images.len() - 1
    }
}

fn pack_images(jobs: &[Job], made: &[Option<Made>]) -> Atlas {
    let mut atlas = Atlas {
        images: Vec::new(),
        image_of: Vec::with_capacity(jobs.len()),
        reports: Vec::new(),
    };
    let mut listed: Vec<(String, &JobKey, ImageReport)> = Vec::new();
    for (job, made) in jobs.iter().zip(made) {
        let Some(made) = made else {
            atlas.image_of.push(None);
            continue;
        };
        let at = atlas.image_index(made);
        atlas.image_of.push(Some(at));
        let report = ImageReport {
            source: job.source.clone(),
            mime: made.mime,
            bytes: made.bytes.len(),
            source_height: job.texture.height,
            source_width: job.texture.width,
            height: made.height,
            width: made.width,
            name: job.name.clone(),
        };
        listed.push((job.name.to_uppercase(), &job.key, report));
    }
    listed.sort_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));
    atlas.reports = listed.into_iter().map(|(_, _, report)| report).collect();
    atlas
}

/// Куда в сборке сцены попадает очередной меш.
struct MeshSite<'a> {
    id: &'a str,
    tag: &'a str,
    level_node: usize,
    part: &'a Prepared,
    slots: &'a HashMap<usize, SlotJobs>,
    atlas: &'a Atlas,
    made: &'a [Option<Made>],
    options: &'a Options,
}

impl MeshSite<'_> {
    /// Материал GLB для меша: имя, картинки слота, прозрачность.
    fn wanted_material(&self, mesh: &Mesh) -> MaterialData {
        let slot_jobs = self
            .slots
            .get(&mesh.shader_index)
            .copied()
            .unwrap_or_default();
        let [colour_image, normal_image] =
            slot_jobs.map(|job| job.and_then(|job| self.atlas.image_of[job]));
        let partial = slot_jobs[0]
            .and_then(|job| self.made[job].as_ref())
            .map_or(0.0, |made| made.partial);
        let material = self
            .part
            .materials
            .get(mesh.shader_index)
            .and_then(Option::as_ref);
        let alpha_mode = bundle_alpha(material, partial);
        let shader = material.map_or_else(|| "default".to_owned(), shader_label);
        let diffuse = material
            .and_then(|m| real_texture(m, Role::Diffuse))
            .filter(|_| colour_image.is_some())
            .unwrap_or("flat");
        MaterialData {
            emissive: material.is_some_and(|m| m.emissive),
            double_sided: alpha_mode != AlphaMode::Opaque,
            alpha_mode,
            normal_texture: normal_image,
            base_color_texture: colour_image,
            name: format!("{shader}|{diffuse}"),
            ..MaterialData::default()
        }
    }
}

/// Узлы, меши и материалы будущего GLB.
#[derive(Default)]
struct Assembly {
    nodes: Vec<NodeData>,
    roots: Vec<usize>,
    meshes: Vec<MeshData>,
    materials: Vec<MaterialData>,
    triangles: usize,
    vertices: usize,
}

impl Assembly {
    fn push_node(&mut self, node: NodeData) -> usize {
        self.nodes.push(node);
        self.nodes.len() - 1
    }

    fn material_index(&mut self, wanted: MaterialData) -> usize {
        let known = self
            .materials
            .iter()
            .position(|m| same_material(m, &wanted));
        known.unwrap_or_else(|| {
            self.materials.push(wanted);
            self.materials.len() - 1
        })
    }

    fn add_mesh(&mut self, site: &MeshSite, number: usize, mesh: &Mesh) {
        let (id, tag) = (site.id, site.tag);
        self.triangles += mesh.indices.len() / 3;
        self.vertices += mesh.positions.len() / 3;
        let glued = weld(mesh, site.options.vertex_colours);
        let material_at = self.material_index(site.wanted_material(mesh));
        let colours = glued.colours.map(|values| {
            values
                .iter()
                .map(|v| (v * 255.0).round().clamp(0.0, 255.0) as u8)
                .collect()
        });
        let mesh_at = self.meshes.len();
        self.meshes.push(MeshData {
            weights: None,
            joints: None,
            material: Some(material_at),
            indices: glued.indices,
            colours,
            uvs: glued.uvs,
            normals: glued.normals,
            positions: glued.positions,
            name: format!("{id}#{tag}#{number}"),
        });

        let matrix = mesh
            .bone_matrix
            .map(|m| matrix_to_gltf(&m))
            .filter(|m| !nearly_identity(m));
        if number == 0 && matrix.is_none() {
            self.nodes[site.level_node].mesh = Some(mesh_at);
            return;
        }
        let name = matrix
            .is_some()
            .then(|| format!("{id}#{tag}#bone{}", mesh.bone_index.unwrap_or(0)));
        let child = self.push_node(NodeData {
            mesh: Some(mesh_at),
            matrix,
            name,
            ..NodeData::default()
        });
        self.nodes[site.level_node].children.push(child);
    }

    /// Часть целиком: узел части, узлы уровней, меши уровней.
    fn add_part(
        &mut self,
        id: &str,
        part: &Prepared,
        slots: &HashMap<usize, SlotJobs>,
        shared: (&Atlas, &[Option<Made>], &Options),
    ) {
        let (atlas, made, options) = shared;
        let root = self.push_node(NodeData {
            name: Some(id.to_owned()),
            ..NodeData::default()
        });
        self.roots.push(root);
        for level in &part.levels {
            let tag = level_name(level.lod);
            let level_node = self.push_node(NodeData {
                name: Some(format!("{id}#{tag}")),
                ..NodeData::default()
            });
            self.nodes[root].children.push(level_node);
            let site = MeshSite {
                id,
                tag,
                level_node,
                part,
                slots,
                atlas,
                made,
                options,
            };
            for (number, mesh) in level.meshes.iter().enumerate() {
                self.add_mesh(&site, number, mesh);
            }
        }
    }
}

fn load_library(dictionaries: &[(String, Vec<u8>)]) -> Result<Library> {
    Library::load(dictionaries).map_err(|error| {
        let shown = error.message;
        Error::broken(format!("Texture dictionary could not be read: {shown}"))
    })
}

pub fn convert(
    inputs: &[PieceInput],
    dictionaries: &[(String, Vec<u8>)],
    options: &Options,
) -> Result<Bundle> {
    let library = load_library(dictionaries)?;

    let (parts, mut reports) = prepare_all(inputs, options);
    if parts.iter().all(Option::is_none) {
        return Err(Error::operation(NO_PIECES));
    }

    let plan = plan_jobs(&library, &parts, &mut reports, options);
    for report in &mut reports {
        for list in [
            &mut report.textures,
            &mut report.missing_textures,
            &mut report.shaders,
        ] {
            *list = order_names(std::mem::take(list));
        }
    }

    let made = parallel_map(&plan.jobs, |job| run_job(job, options));
    let atlas = pack_images(&plan.jobs, &made);

    let mut assembly = Assembly::default();
    for (at, part) in parts.iter().enumerate() {
        if let Some(part) = part {
            let shared = (&atlas, made.as_slice(), options);
            assembly.add_part(&inputs[at].id, part, &plan.slots[at], shared);
        }
    }

    let image_bytes = atlas.reports.iter().map(|image| image.bytes).sum();
    let scene = Scene {
        skins: Vec::new(),
        roots: assembly.roots,
        nodes: assembly.nodes,
        images: atlas.images,
        materials: assembly.materials.clone(),
        meshes: assembly.meshes,
        name: "scene".to_owned(),
    };
    Ok(Bundle {
        pieces: reports,
        images: atlas.reports,
        image_bytes,
        vertices: assembly.vertices,
        triangles: assembly.triangles,
        materials: assembly.materials.len(),
        dictionaries: dictionaries.iter().map(|(name, _)| name.clone()).collect(),
        glb: glb::write(&scene)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::joaat;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().copied().map(String::from).collect()
    }

    #[test]
    fn name_lists_sort_by_upper_case_then_bytes() {
        let cases: [(&[&str], &[&str]); 5] = [
            (
                &[
                    "b", "A", "a", "B", "a", "_x", "Z", "z", "ä", "Ä", "1", "10", "2",
                ],
                &["1", "10", "2", "A", "a", "B", "b", "Z", "z", "_x", "Ä", "ä"],
            ),
            (&["x", "x", "x"], &["x"]),
            (
                &["gz_V_247LOD", "GZ_V_247LOD", "gz_V_247LOD"],
                &["GZ_V_247LOD", "gz_V_247LOD"],
            ),
            (&[], &[]),
            (&["ß", "SS", "ss", "Ss"], &["SS", "Ss", "ss", "ß"]),
        ];
        for (given, want) in cases {
            assert_eq!(order_names(strings(given)), strings(want), "{given:?}");
        }
    }

    #[test]
    fn failure_text_names_the_class() {
        let text = |kind: Kind, message: &str| failure_text(&Error::new(kind, message));
        assert_eq!(text(Kind::Argument, "a"), "ArgumentException: a");
        assert_eq!(text(Kind::Io, "b"), "IOException: b");
        assert_eq!(text(Kind::Broken, "c"), "InvalidDataException: c");
        assert_eq!(text(Kind::Version, "d"), "InvalidDataException: d");
        assert_eq!(text(Kind::Enhanced, "e"), "InvalidDataException: e");
        assert_eq!(text(Kind::Texture, "f"), "InvalidDataException: f");
        assert_eq!(text(Kind::Operation, "g"), "InvalidDataException: g");
    }

    #[test]
    fn levels_have_names_and_distance_slots() {
        assert_eq!(level_name(Lod::High), "high");
        assert_eq!(distance_slot(Lod::High), 0);
        assert_eq!(level_name(Lod::Medium), "med");
        assert_eq!(distance_slot(Lod::Medium), 1);
        assert_eq!(level_name(Lod::Low), "low");
        assert_eq!(distance_slot(Lod::Low), 2);
        assert_eq!(level_name(Lod::VeryLow), "vlow");
        assert_eq!(distance_slot(Lod::VeryLow), 3);
    }

    fn level_of(meshes: Vec<Mesh>) -> Level {
        Level {
            meshes,
            models: 1,
            lod: Lod::High,
        }
    }

    fn cloud(positions: &[f32]) -> Mesh {
        let mut mesh = Mesh::default();
        mesh.positions = positions.to_vec();
        mesh
    }

    /// Уровень из одного облака точек.
    fn single(positions: &[f32]) -> Vec<Level> {
        vec![level_of(vec![cloud(positions)])]
    }

    #[test]
    fn bounding_box_cases() {
        let mut matrix = crate::math::IDENTITY;
        matrix[12] = 10.0;
        matrix[13] = 20.0;
        matrix[14] = 30.0;
        let moved = Mesh {
            bone_matrix: Some(matrix),
            ..cloud(&[1.0, 2.0, 3.0])
        };
        let cases: Vec<(Vec<Level>, Option<Corners>)> = vec![
            (vec![], None),
            (vec![level_of(vec![])], None),
            (single(&[]), None),
            (
                single(&[1.0, 2.0, 3.0]),
                Some(([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])),
            ),
            (
                vec![
                    level_of(vec![cloud(&[1.0, 2.0, 3.0, -1.0, 5.0, 0.0])]),
                    level_of(vec![cloud(&[10.0, -10.0, 0.5])]),
                ],
                Some(([-1.0, -10.0, 0.0], [10.0, 5.0, 3.0])),
            ),
            (
                single(&[f32::NAN, 1.0, 1.0, 0.0, 0.0, 0.0]),
                Some(([0.0, 0.0, 0.0], [0.0, 1.0, 1.0])),
            ),
            (
                single(&[1.0, 2.0, 3.0, 8.0, 9.0]),
                Some(([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])),
            ),
            (
                vec![level_of(vec![moved])],
                Some(([11.0, 32.0, -17.0], [11.0, 32.0, -17.0])),
            ),
        ];
        for (number, (levels, want)) in cases.iter().enumerate() {
            assert_eq!(&bounding_box(levels), want, "случай {number}");
        }
    }

    fn shader(name: &str, bucket: u8) -> Material {
        Material {
            samplers: Vec::new(),
            textures: HashMap::new(),
            emissive: false,
            alpha_mode: AlphaMode::Opaque,
            render_bucket: bucket,
            shader_file_hash: 0,
            shader_file: None,
            shader_hash: joaat(name),
            shader: name.to_owned(),
        }
    }

    /// «OBMMMM»: режим по каждому из шести ведёр отрисовки (O — Opaque, B — Blend, M — Mask).
    fn modes(letters: &str) -> Vec<AlphaMode> {
        let mode = |letter| match letter {
            'O' => AlphaMode::Opaque,
            'B' => AlphaMode::Blend,
            'M' => AlphaMode::Mask,
            other => panic!("нет режима {other}"),
        };
        letters.chars().map(mode).collect()
    }

    #[test]
    fn alpha_mode_table() {
        use AlphaMode::{Blend, Mask, Opaque};
        let plain = [
            "normal_spec",
            "normal_spec_cutout",
            "decal",
            "cutout",
            "alpha",
            "ped",
            "default.sps",
            "weapon_normal_spec",
            "ped_hair_cutout_alpha",
            "vehicle_vehglass",
        ];
        let special = [
            ("default", "OMMMMM"),
            ("default_tnt", "OMMBMM"),
            ("default_spec", "OMMMMM"),
            ("emissive", "OBMMMM"),
            ("emissivenight", "OBMMMM"),
            ("emissive_alpha", "OBMMMM"),
            ("glass", "OBMMMM"),
            ("glass_spec", "OBMMMM"),
            ("glass_breakable", "OBMMMM"),
        ];
        let rows = special
            .into_iter()
            .chain(plain.into_iter().map(|name| (name, "OMMMMM")));
        for (name, letters) in rows {
            for (bucket, expected) in modes(letters).into_iter().enumerate() {
                let material = shader(name, bucket as u8);
                assert_eq!(
                    bundle_alpha(Some(&material), 0.0),
                    expected,
                    "{name} {bucket}"
                );
            }
        }
        let default1 = shader("default", 1);
        let shares = [
            (0.0, Mask),
            (0.5, Mask),
            (0.500_000_1, Blend),
            (0.9, Blend),
            (f64::NAN, Mask),
        ];
        for (partial, want) in shares {
            assert_eq!(bundle_alpha(Some(&default1), partial), want, "{partial}");
        }
        let unknown = Material {
            shader_hash: 1,
            ..shader("emissive", 1)
        };
        let wrong_text = Material {
            shader: "0x00000001".to_owned(),
            ..shader("default", 1)
        };
        let upper = Material {
            shader: "EMISSIVE".to_owned(),
            ..shader("emissive", 1)
        };
        let odd = [
            (None, 0.9, Opaque),
            (Some(&unknown), 0.0, Opaque),
            (Some(&wrong_text), 0.9, Mask),
            (Some(&upper), 0.0, Mask),
        ];
        for (material, partial, want) in odd {
            assert_eq!(bundle_alpha(material, partial), want);
        }
        assert_eq!(bundle_alpha(Some(&shader("default_tnt", 255)), 0.0), Mask);
    }

    fn options() -> Options {
        Options {
            normal_maps: true,
            lods: true,
            vertex_colours: true,
            max_normal_texture_size: 512,
            max_texture_size: 1024,
            jpeg_quality: 88,
            png_only: false,
        }
    }

    fn piece(bytes: &[u8]) -> PieceInput {
        PieceInput {
            drawable_hash: None,
            bytes: bytes.to_vec(),
            kind: FileKind::Ydr,
            file: "f".to_owned(),
            id: "p".to_owned(),
        }
    }

    #[test]
    fn preparing_garbage_reports_the_neighbour_error() {
        let refusal = prepare(&piece(&[]), &options()).err().unwrap();
        assert_eq!(refusal.kind, Kind::Broken);
        assert_eq!(refusal.message, "Ресурс короче заголовка RSC7.");
    }

    #[test]
    fn nothing_converts_without_parts() {
        let refused = |inputs: &[PieceInput]| convert(inputs, &[], &options()).unwrap_err();
        let empty = refused(&[]);
        assert_eq!(empty.kind, Kind::Operation);
        assert_eq!(
            empty.message,
            "No piece of the scene bundle could be converted."
        );
        assert_eq!(refused(&[piece(&[])]).kind, Kind::Operation);
    }

    #[test]
    fn a_bad_dictionary_wins_over_everything() {
        let bad = [("bad.ytd".to_owned(), b"nonsense nonsense nonsense".to_vec())];
        let with_part = vec![piece(&[])];
        for inputs in [&[][..], &with_part[..]] {
            let error = convert(inputs, &bad, &options()).unwrap_err();
            assert_eq!(error.kind, Kind::Broken);
            assert_eq!(
                error.message,
                "Texture dictionary could not be read: Файл не является ресурсом RSC7."
            );
        }
    }

    #[test]
    fn failed_parts_still_get_reports() {
        // Одна часть выпала, но без рабочих — отказ; отчёт можно получить только из успешного вызова.
        let blank = blank_report(&piece(&[]));
        assert!(!blank.ok);
        assert!(blank.error.is_none());
        assert!(blank.lods.is_empty());
        assert!(blank.sphere.is_none());
    }

    #[test]
    fn job_keys_order_embedded_before_external_and_colour_before_normal() {
        let mut keys: Vec<JobKey> = [
            (Source::External(0), false),
            (Source::Embedded(5), true),
            (Source::Embedded(5), false),
            (Source::Embedded(2), false),
        ]
        .into_iter()
        .map(|(source, normal)| ("a".to_owned(), source, normal))
        .collect();
        keys.sort();
        let order: Vec<(Source, bool)> = keys.iter().map(|key| (key.1, key.2)).collect();
        assert_eq!(
            order,
            [
                (Source::Embedded(2), false),
                (Source::Embedded(5), false),
                (Source::Embedded(5), true),
                (Source::External(0), false),
            ]
        );
    }
}
