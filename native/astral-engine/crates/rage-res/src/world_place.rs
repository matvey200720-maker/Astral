//! Сцена места мира по координатам: то, что собирает `buildWorldPlaceMeshes` (`apps/desktop/src/world-place-scene.js`), и тот же файл `ARS1`.
//!
//! Порядок и числа — как у JS: какие карты задевают круг, типы и сущности (круг или план), интерьеры у середины, модели от плит земли к реквизиту,
//! материал по классу `shopMaterialClass`, лист по поиску игры (`+hidr`, вшитый, словарь архетипа и родители `gtxd`, у каждого `+hi` раньше обычного), земля
//! с четырьмя слоями и маской, тинт по палитре, склейка по материалу и клеткам, вода. Чтение моделей, разбор и поиск листов — в пуле потоков порциями
//! (результат от числа потоков не зависит: расстановка идёт по порядку JS, одним потоком). Файлы игры отдаёт `WorldSource`; кодирует `ars1`.
//!
//! Обвод (`outline`): линии зон из моделей набора Astral — `world_place/outline.rs`; описание зон присылает оболочка. Чего движок не умеет, он отдаёт прежнему пути JS:
//! `Error` с текстом «unsupported: …» (модель обвода, что не разобралась).
//! Сверка с JS — `fixtures/world-place/` (игра из отдельных файлов, ответ настоящего `buildWorldPlaceMeshes`, распакованная нагрузка до байта).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use crate::ars1;
use crate::drawable::{self, Material};
use crate::drawable_js::{self, Mesh};
use crate::error::{Error, Result};
use crate::hash::joaat;
use crate::js_math::{number_to_string, round_to};
use crate::meta_map::{self, Archetype, MapEntity};
use crate::parallel::parallel_map_with;
use crate::placement_math::{self, Entity};
use crate::resource::{Resource, ENHANCED_MODEL_VERSIONS};
use crate::shader_vectors::{self, ShaderVectors};
use crate::shop_material::{self, diffuse_of, shader_file_name, shop_material_class};
use crate::texture::{self, TextureRef};
use crate::world_mesh::{self, Area, Palette, Placed};
use crate::world_rules::{
    entity_drawn_in_view, entity_in_reach, entity_key, entity_touches_plan, maps_for_place,
    model_in_frame, near_level, plan_shape, Footprint, MapRow, BIG_LOD_DIST,
};

mod outline;
pub use outline::{OutlineTarget, OutlineZone};

pub const WORLD_PLACE_PART: &str = "world-place";

/// Треугольник берётся, если его рамка задевает круг на столько шире (м): край круга кадр гасит сам.
const TRIM: f64 = 16.0;
/// План: метро и подвалы на столько ниже зоны (м) с земли не видны.
const PLAN_BELOW: f64 = 30.0;
/// Клетка склейки сеток (м) и предел вершин одной сетки кадра.
const CELL: f64 = 96.0;
const MESH_VERTICES: usize = 60_000;
/// Предел вершин сцены: дальше вещи мельче и дальше от середины уступают (плиты земли, дома и дороги — никогда).
const VERTEX_BUDGET: u64 = 4_500_000;
const INTERIOR_REACH: f64 = 180.0;
const INTERIOR_LIMIT: usize = 12;
const INTERIOR_HEIGHT: f64 = 30.0;
/// Реквизит: модель повторяется столько раз и стоит дальше стольких метров от середины — дальним уровнем игры.
const REPEATED_MODEL: usize = 6;
const PROP_NEAR: f64 = 110.0;
/// Самплеры слоёв земли и маски смешения.
const LAYER_SAMPLERS: [u32; 3] = [606_121_937, 831_736_502, 2_025_281_789];
const MASK_SAMPLER: u32 = 2_295_086_480;
const TERRAIN_WEIGHTS: u32 = 2;
const WATER_COLOUR: &str = "#2f6f95";
const WATER_OPACITY: f64 = 0.6;

/// Файлы игры: оглавление (старшее в порядке игры) и чтение по адресу.
pub trait WorldSource: Sync {
    /// Имена файлов оглавления (строчные), в порядке появления.
    fn names(&self) -> &[String];
    /// Адрес старшего файла с таким именем.
    fn lookup(&self, name: &str) -> Option<String>;
    /// Байты файла по адресу; `Ok(None)` — файла нет.
    fn read(&self, address: &str) -> Result<Option<Vec<u8>>>;
    /// Текст `water.xml`, если он есть.
    fn water(&self) -> Option<String> {
        None
    }
    /// Байты модели обвода по имени файла из папки зон; `Ok(None)` — файла нет (линии нет).
    fn zone_file(&self, _file: &str) -> Result<Option<Vec<u8>>> {
        Ok(None)
    }
}

/// Таблица карт, имён файлов типов и родство словарей листов.
#[derive(Debug, Clone, Default)]
pub struct Tables {
    pub type_names: Vec<String>,
    pub maps: Vec<MapRow>,
    pub parents: HashMap<String, String>,
}

/// Просьба: уже проверенная окном (`placeRequest`).
#[derive(Debug, Clone)]
pub struct Request {
    pub origin: [f64; 3],
    pub reach: f64,
    pub plan: Option<Vec<[f64; 2]>>,
    /// Не выше этой высоты над началом сцены (с планом); `INFINITY` — без потолка.
    pub top: f64,
    /// Часть обвода; пусто — без обвода.
    pub outline: String,
    /// Линии этой части (зоны `ZONES` JS с `line`, в порядке набора); пусто — обвода нет, как у JS без папки зон.
    pub zones: Vec<OutlineZone>,
    /// Потоков чтения моделей; 0 — половина ядер.
    pub threads: usize,
}

/// Счётчики и времена сборки (поля как у `report` JS; `ms` — по этапам, `work_ms` — суммарное время потоков по этапам чтения и расстановки).
#[derive(Debug, Clone, Default)]
pub struct Report {
    pub maps: u32,
    pub types: u32,
    pub entities: usize,
    pub interiors: u32,
    pub models: u32,
    pub missing_models: u32,
    pub no_colour: u32,
    pub sheets: usize,
    pub missing_sheets: u32,
    pub dropped: u32,
    pub vertices: u64,
    pub triangles: u64,
    pub meshes: usize,
    pub water: bool,
    pub ms: Vec<(&'static str, f64)>,
    pub work_ms: Vec<(&'static str, f64)>,
    pub dictionaries: DictReport,
}

/// Словари листов за сборку: сколько прочитано и отпущено и сколько байт держалось разом. Словарь отпускается после последней модели, что может его читать
/// (по именам и родству `gtxd`), так что к концу сборки отпущены все (`kept_bytes` — ноль); `reloaded` — чтений словаря, уже отпущенного: ноль, если счёт верен.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DictReport {
    pub loaded: u64,
    pub loaded_bytes: u64,
    pub evicted: u64,
    pub reloaded: u64,
    pub peak_bytes: u64,
    pub kept_bytes: u64,
}

pub struct Built {
    pub scene: ars1::Scene,
    pub report: Report,
}

fn unsupported(what: &str) -> Error {
    Error::operation(format!("unsupported: {what}"))
}

fn ms_since(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

// ------------------------------------------------------------------ имена и словари

#[derive(Default, Clone)]
struct Named {
    ydr: Option<String>,
    yft: Option<String>,
    ytd: Option<String>,
}

fn name_hash(name: &str) -> u32 {
    joaat(name)
}

struct World<'a> {
    source: &'a dyn WorldSource,
    tables: &'a Tables,
    names: HashMap<u32, Named>,
    parent_names: HashMap<u32, String>,
    dictionaries: Mutex<HashMap<String, Arc<OnceLock<Option<Arc<Dict>>>>>>,
    stats: DictStats,
    /// Словари, отпущенные после последней модели-читателя: повторное чтение такого — ошибка счёта, оно считается.
    evicted_files: Mutex<HashSet<String>>,
    first_read_error: Mutex<Option<Error>>,
}

#[derive(Default)]
struct DictStats {
    loaded: AtomicU64,
    loaded_bytes: AtomicU64,
    resident: AtomicU64,
    peak: AtomicU64,
    evicted: AtomicU64,
    reloaded: AtomicU64,
}

/// Словарь листов: адрес файла, ресурс и листы по имени в нижнем регистре.
struct Dict {
    at: String,
    res: Arc<Resource>,
    refs: HashMap<String, TextureRef>,
}

/// Откуда лист: вшит в модель или лежит в словаре (имя файла словаря). Ресурс по нему достаётся при разборе, а не держится в записи: запись живёт всю сборку.
#[derive(Clone)]
enum Origin {
    Embedded,
    Dictionary(String),
}

#[derive(Clone)]
struct Located {
    at: String,
    tex: TextureRef,
    origin: Origin,
}

impl<'a> World<'a> {
    fn new(source: &'a dyn WorldSource, tables: &'a Tables) -> Self {
        let mut names: HashMap<u32, Named> = HashMap::new();
        for name in source.names() {
            let Some((stem, ext)) = name.rsplit_once('.') else {
                continue;
            };
            if stem.is_empty() || !matches!(ext, "ydr" | "yft" | "ydd" | "ytd" | "ytyp" | "ymap") {
                continue;
            }
            let slot = names.entry(name_hash(stem)).or_default();
            match ext {
                "ydr" => slot.ydr = Some(stem.to_owned()),
                "yft" => slot.yft = Some(stem.to_owned()),
                "ytd" => slot.ytd = Some(stem.to_owned()),
                _ => {}
            }
        }
        let mut parent_names = HashMap::new();
        for (child, parent) in &tables.parents {
            parent_names.insert(name_hash(child), child.clone());
            parent_names.insert(name_hash(parent), parent.clone());
        }
        World {
            source,
            tables,
            names,
            parent_names,
            dictionaries: Mutex::new(HashMap::new()),
            stats: DictStats::default(),
            evicted_files: Mutex::new(HashSet::new()),
            first_read_error: Mutex::new(None),
        }
    }

    fn name_of(&self, hash: u32, ext: &str) -> Option<&str> {
        let slot = self.names.get(&hash)?;
        match ext {
            "ydr" => slot.ydr.as_deref(),
            "yft" => slot.yft.as_deref(),
            _ => None,
        }
    }

    fn txd_name_of(&self, hash: u32) -> Option<String> {
        self.names
            .get(&hash)
            .and_then(|slot| slot.ytd.clone())
            .or_else(|| self.parent_names.get(&hash).cloned())
    }

    /// Чтение файла: отказ чтения (ключи, архив) запоминается, а файл считается отсутствующим, как у JS (`catch`).
    fn read(&self, address: &str) -> Option<Vec<u8>> {
        match self.source.read(address) {
            Ok(bytes) => bytes,
            Err(error) => {
                let mut first = self
                    .first_read_error
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                first.get_or_insert(error);
                None
            }
        }
    }

    /// Словарь листов по имени файла: читается один раз на сборку (потоки ждут одного чтения).
    fn dictionary(&self, file: &str) -> Option<Arc<Dict>> {
        let cell = {
            let mut table = self.dictionaries.lock().unwrap_or_else(|e| e.into_inner());
            Arc::clone(table.entry(file.to_owned()).or_default())
        };
        cell.get_or_init(|| {
            let at = self.source.lookup(file)?;
            let bytes = self.read(&at)?;
            let res = Resource::parse(&bytes).ok()?;
            let refs = texture::read_dictionary(&res).ok()?;
            let mut map = HashMap::new();
            for tex in refs {
                map.insert(tex.name.to_lowercase(), tex);
            }
            let size = res.len() as u64;
            self.stats.loaded.fetch_add(1, Relaxed);
            self.stats.loaded_bytes.fetch_add(size, Relaxed);
            let now = self.stats.resident.fetch_add(size, Relaxed) + size;
            self.stats.peak.fetch_max(now, Relaxed);
            if self
                .evicted_files
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains(file)
            {
                self.stats.reloaded.fetch_add(1, Relaxed);
            }
            Some(Arc::new(Dict {
                at,
                res: Arc::new(res),
                refs: map,
            }))
        })
        .clone()
    }

    /// Словари, в которых модель может искать лист, — те же файлы и в том же порядке, что обходит `locate_uncached`: `+hidr`, `+hifr`, потом цепочка `gtxd` (`+hi` раньше обычного).
    /// Список — верхняя граница: модель читает не все из них, но ни одного лишнего за его пределами.
    fn dictionary_files(&self, name: &str, txd: u32) -> Vec<String> {
        let mut files = vec![format!("{name}+hidr.ytd"), format!("{name}+hifr.ytd")];
        let mut txd = if txd != 0 {
            self.txd_name_of(txd)
        } else {
            None
        };
        let mut seen = HashSet::new();
        while let Some(chain) = txd.take() {
            if !seen.insert(chain.clone()) {
                break;
            }
            files.push(format!("{chain}+hi.ytd"));
            files.push(format!("{chain}.ytd"));
            txd = self.tables.parents.get(&chain).cloned();
        }
        files
    }

    /// Отпустить словарь: после последней модели, что может его читать, он больше никому не нужен (результат сборки от этого не зависит — это кэш).
    fn evict(&self, file: &str) {
        let cell = self
            .dictionaries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(file);
        if let Some(Some(dict)) = cell.as_ref().and_then(|cell| cell.get()) {
            self.stats
                .resident
                .fetch_sub(dict.res.len() as u64, Relaxed);
            self.stats.evicted.fetch_add(1, Relaxed);
            self.evicted_files
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(file.to_owned());
        }
    }

    /// Ресурс, из которого читаются пиксели листа: модель (вшитый лист) или словарь (если он уже отпущен — читается заново, это видно в `reloaded`).
    fn resource_of(&self, model: &Model, found: &Located) -> Option<Arc<Resource>> {
        match &found.origin {
            Origin::Embedded => Some(Arc::clone(&model.res)),
            Origin::Dictionary(file) => self.dictionary(file).map(|dict| Arc::clone(&dict.res)),
        }
    }

    fn dict_report(&self) -> DictReport {
        DictReport {
            loaded: self.stats.loaded.load(Relaxed),
            loaded_bytes: self.stats.loaded_bytes.load(Relaxed),
            evicted: self.stats.evicted.load(Relaxed),
            reloaded: self.stats.reloaded.load(Relaxed),
            peak_bytes: self.stats.peak.load(Relaxed),
            kept_bytes: self.stats.resident.load(Relaxed),
        }
    }

    /// Лист — где его ищет игра; у каждого словаря сперва его `+hi`.
    fn locate_uncached(&self, texture: &str, model: &Model) -> Option<Located> {
        for suffix in ["+hidr", "+hifr"] {
            let file = format!("{}{suffix}.ytd", model.name);
            if let Some(dict) = self.dictionary(&file) {
                if let Some(tex) = dict.refs.get(texture) {
                    return Some(Located {
                        at: dict.at.clone(),
                        tex: tex.clone(),
                        origin: Origin::Dictionary(file),
                    });
                }
            }
        }
        if let Some(tex) = model.embedded.get(texture) {
            return Some(Located {
                at: model.at.clone(),
                tex: tex.clone(),
                origin: Origin::Embedded,
            });
        }
        let mut txd = if model.txd != 0 {
            self.txd_name_of(model.txd)
        } else {
            None
        };
        let mut seen = HashSet::new();
        while let Some(name) = txd.take() {
            if !seen.insert(name.clone()) {
                break;
            }
            for file in [format!("{name}+hi.ytd"), format!("{name}.ytd")] {
                if let Some(dict) = self.dictionary(&file) {
                    if let Some(tex) = dict.refs.get(texture) {
                        return Some(Located {
                            at: dict.at.clone(),
                            tex: tex.clone(),
                            origin: Origin::Dictionary(file),
                        });
                    }
                }
            }
            txd = self.tables.parents.get(&name).cloned();
        }
        None
    }
}

// ------------------------------------------------------------------ модели

/// Модель, прочитанная из файла игры: материалы, листы по умолчанию, параметры шейдеров и сетки уровней.
struct Model {
    name: String,
    at: String,
    res: Arc<Resource>,
    drawable: drawable_js::Drawable,
    far: Option<drawable_js::Drawable>,
    txd: u32,
    embedded: HashMap<String, TextureRef>,
    vectors: Vec<ShaderVectors>,
    materials: Vec<Option<Material>>,
    surfaces: Vec<f64>,
    far_surfaces: Vec<f64>,
}

/// Сетка модели из файла игры (`readDrawable(resource, { kind })` JS) вместе с материалами и параметрами шейдеров.
#[allow(clippy::type_complexity)]
fn read_model(
    bytes: &[u8],
    fragment: bool,
    with_far: bool,
) -> Result<(
    Arc<Resource>,
    drawable_js::Drawable,
    Option<drawable_js::Drawable>,
    Vec<Option<Material>>,
    HashMap<String, TextureRef>,
    Vec<ShaderVectors>,
)> {
    let res = Resource::parse(bytes)?;
    if ENHANCED_MODEL_VERSIONS.contains(&res.version()) {
        return Err(Error::broken("Модель из GTA V Enhanced."));
    }
    let root = shader_vectors::drawable_root_at(&res, fragment)?
        .ok_or_else(|| Error::broken("Корень модели недоступен."))?;
    let drawable = drawable_js::read_drawable_at(&res, root, drawable::Lod::High)?;
    let far = if with_far {
        Some(drawable_js::read_drawable_at(
            &res,
            root,
            drawable::Lod::Low,
        )?)
    } else {
        None
    };
    let (_, materials, embedded) = drawable::read_materials(&res, root)?;
    let mut by_name = HashMap::new();
    for tex in embedded {
        by_name.insert(tex.name.to_lowercase(), tex);
    }
    let vectors = shader_vectors::shader_vectors(&res, root)?;
    Ok((Arc::new(res), drawable, far, materials, by_name, vectors))
}

struct Counters {
    read_ns: AtomicU64,
    parse_ns: AtomicU64,
    locate_ns: AtomicU64,
}

fn load_model(
    world: &World,
    name: &str,
    with_far: bool,
    txd: u32,
    counters: &Counters,
) -> Option<Model> {
    for ext in ["ydr", "yft"] {
        let Some(at) = world.source.lookup(&format!("{name}.{ext}")) else {
            continue;
        };
        let began = Instant::now();
        let bytes = world.read(&at);
        counters
            .read_ns
            .fetch_add(began.elapsed().as_nanos() as u64, Relaxed);
        let Some(bytes) = bytes else { continue };
        let began = Instant::now();
        let attempt = read_model(&bytes, ext == "yft", with_far);
        counters
            .parse_ns
            .fetch_add(began.elapsed().as_nanos() as u64, Relaxed);
        let Ok((res, drawable, far, materials, embedded, vectors)) = attempt else {
            continue;
        };
        let surfaces = drawable.meshes.iter().map(world_mesh::surface_of).collect();
        let far_surfaces = far.as_ref().map_or_else(Vec::new, |far| {
            far.meshes.iter().map(world_mesh::surface_of).collect()
        });
        return Some(Model {
            name: name.to_owned(),
            at,
            res,
            drawable,
            far,
            txd,
            embedded,
            vectors,
            materials,
            surfaces,
            far_surfaces,
        });
    }
    None
}

// ------------------------------------------------------------------ сборка

/// Сущность места: куда ставить модель и что про неё знает окно.
struct Item {
    name: String,
    lod_dist: f64,
    texture_dictionary: u32,
    matrix: [f64; 12],
    turn: [f64; 9],
    tint: u32,
    distance: f64,
}

struct Interior {
    entity: MapEntity,
    archetype: Archetype,
    distance: f64,
}

/// Материал сцены; ключи JSON — в порядке JS (`area` дописывается при первой сетке).
enum Look {
    Terrain {
        layers: Vec<Option<usize>>,
        mask: Option<usize>,
    },
    Plain {
        alpha: &'static str,
        decal: bool,
        dirt: bool,
        mirror: bool,
        emission: f64,
        vertex: bool,
        through: bool,
        double_sided: bool,
        texture: Option<usize>,
    },
    Water,
    /// Линия обвода: цвет и альфа мода, прозрачность — доля от 255.
    Zone {
        opacity: f64,
    },
}

struct SceneMaterial {
    id: String,
    name: String,
    colour: String,
    look: Look,
    area: Option<f64>,
}

struct SceneTexture {
    name: String,
    game: String,
    texture: String,
}

/// Как рисуется сетка модели: материал, цвета вершин, тинт.
struct ModelLook {
    slot: usize,
    terrain: bool,
    mask: bool,
    vertex: bool,
    pixels: Option<Arc<texture::Image>>,
    vertex_alpha: bool,
}

fn entity_of(entity: &MapEntity) -> Entity {
    Entity {
        position: entity.position,
        rotation: entity.rotation,
        scale_xy: entity.scale_xy,
        scale_z: entity.scale_z,
    }
}

fn json_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_owned())
}

fn json_opt(value: Option<usize>) -> String {
    value.map_or_else(|| "null".to_owned(), |v| v.to_string())
}

fn materials_json(materials: &[SceneMaterial]) -> String {
    let items: Vec<String> = materials
        .iter()
        .map(|m| {
            let mut parts = vec![
                format!("\"id\":{}", json_string(&m.id)),
                format!("\"name\":{}", json_string(&m.name)),
            ];
            match &m.look {
                Look::Terrain { layers, mask } => {
                    let layers: Vec<String> = layers.iter().map(|l| json_opt(*l)).collect();
                    parts.push("\"alpha\":\"opaque\"".to_owned());
                    parts.push("\"group\":\"terrain\"".to_owned());
                    parts.push("\"doubleSided\":false".to_owned());
                    parts.push(format!("\"colour\":{}", json_string(&m.colour)));
                    let base = layers.first().cloned().unwrap_or_else(|| "null".to_owned());
                    parts.push(format!("\"texture\":{base}"));
                    parts.push(format!(
                        "\"terrain\":{{\"layers\":[{}],\"mask\":{},\"weights\":{TERRAIN_WEIGHTS}}}",
                        layers.join(","),
                        json_opt(*mask)
                    ));
                }
                Look::Plain {
                    alpha,
                    decal,
                    dirt,
                    mirror,
                    emission,
                    vertex,
                    through,
                    double_sided,
                    texture,
                } => {
                    parts.push(format!("\"alpha\":\"{alpha}\""));
                    if *decal {
                        parts.push("\"decal\":true".to_owned());
                    }
                    if *dirt {
                        parts.push("\"dirt\":true".to_owned());
                    }
                    if *mirror {
                        parts.push("\"mirror\":true".to_owned());
                    }
                    if *emission != 0.0 {
                        parts.push("\"emissive\":true".to_owned());
                        parts.push(format!("\"emission\":{}", number_to_string(*emission)));
                    }
                    if *vertex {
                        parts.push("\"vertex\":true".to_owned());
                    }
                    if *through {
                        parts.push("\"through\":true".to_owned());
                    }
                    parts.push(format!("\"doubleSided\":{double_sided}"));
                    parts.push(format!("\"colour\":{}", json_string(&m.colour)));
                    parts.push(format!("\"texture\":{}", json_opt(*texture)));
                }
                Look::Water => {
                    parts.push("\"alpha\":\"blend\"".to_owned());
                    parts.push(format!("\"colour\":{}", json_string(&m.colour)));
                    parts.push(format!("\"opacity\":{}", number_to_string(WATER_OPACITY)));
                    parts.push("\"doubleSided\":true".to_owned());
                }
                Look::Zone { opacity } => {
                    parts.push("\"alpha\":\"blend\"".to_owned());
                    parts.push(format!("\"colour\":{}", json_string(&m.colour)));
                    parts.push(format!("\"opacity\":{}", number_to_string(*opacity)));
                    parts.push("\"shader\":\"default\"".to_owned());
                    parts.push("\"texture\":null".to_owned());
                }
            }
            if let Some(area) = m.area {
                parts.push(format!("\"area\":{}", number_to_string(area)));
            }
            format!("{{{}}}", parts.join(","))
        })
        .collect();
    format!("[{}]", items.join(","))
}

fn textures_json(textures: &[SceneTexture]) -> String {
    let items: Vec<String> = textures
        .iter()
        .map(|t| {
            format!(
                "{{\"name\":{},\"game\":{},\"texture\":{}}}",
                json_string(&t.name),
                json_string(&t.game),
                json_string(&t.texture)
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

fn box_json(min: [f64; 3], max: [f64; 3]) -> String {
    let list = |values: [f64; 3]| {
        values
            .iter()
            .map(|v| number_to_string(round_to(*v, 2)))
            .collect::<Vec<_>>()
            .join(",")
    };
    format!("{{\"min\":[{}],\"max\":[{}]}}", list(min), list(max))
}

fn has_word(text: &str, words: &[&str]) -> bool {
    let lower = text.to_ascii_lowercase();
    words.iter().any(|word| lower.contains(word))
}

/// Вода: квады `water.xml` (`parseWaterQuads` JS) в круге места (`waterMesh` JS).
fn water_quads(text: &str) -> Vec<[f64; 5]> {
    let mut quads = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("<Item>") {
        let Some(len) = rest[start..].find("</Item>") else {
            break;
        };
        let block = &rest[start..start + len + 7];
        rest = &rest[start + len + 7..];
        let value = |name: &str| -> f64 {
            let key = format!("<{name} value=\"");
            block
                .find(&key)
                .and_then(|at| {
                    let tail = &block[at + key.len()..];
                    tail.find('"').map(|end| &tail[..end])
                })
                .filter(|text| !text.is_empty())
                .and_then(js_number)
                .unwrap_or(f64::NAN)
        };
        let quad = [
            value("minX"),
            value("maxX"),
            value("minY"),
            value("maxY"),
            value("z"),
        ];
        if quad.iter().all(|v| v.is_finite()) && !block.contains("<IsInvisible value=\"true\"") {
            quads.push(quad);
        }
    }
    quads
}

/// `Number(text)` JS для чисел `water.xml`: пробелы по краям допустимы, пусто — ноль.
fn js_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some(0.0);
    }
    trimmed.parse::<f64>().ok()
}

fn water_mesh(
    quads: &[[f64; 5]],
    origin: [f64; 3],
    reach: f64,
) -> Option<(Vec<f32>, Vec<f32>, Vec<u32>)> {
    let mut positions: Vec<f64> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    for [min_x, max_x, min_y, max_y, z] in quads {
        let x0 = (min_x - origin[0]).max(-reach);
        let x1 = (max_x - origin[0]).min(reach);
        let y0 = (min_y - origin[1]).max(-reach);
        let y1 = (max_y - origin[1]).min(reach);
        if x1 <= x0 || y1 <= y0 {
            continue;
        }
        let z = z - origin[2];
        let base = (positions.len() / 3) as u32;
        positions.extend([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]);
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    if positions.is_empty() {
        return None;
    }
    let mut normals = vec![0f32; positions.len()];
    let mut at = 2;
    while at < normals.len() {
        normals[at] = 1.0;
        at += 3;
    }
    Some((
        positions.iter().map(|v| *v as f32).collect(),
        normals,
        indices,
    ))
}

/// Собрать сцену места: сетки, материалы, листы и отчёт (без кодирования в файл).
pub fn build(source: &dyn WorldSource, tables: &Tables, request: &Request) -> Result<Built> {
    let started = Instant::now();
    let origin = request.origin;
    let reach = request.reach;
    let centre = [origin[0], origin[1]];
    let shape = request.plan.as_ref().map(|points| plan_shape(points));
    let area = match &shape {
        Some(shape) => Area::Plan(shape),
        None => Area::Radius(reach + TRIM),
    };
    let floor = if shape.is_some() {
        -PLAN_BELOW
    } else {
        f64::NEG_INFINITY
    };
    let top = request.top;
    let threads = if request.threads == 0 {
        (std::thread::available_parallelism().map_or(2, |n| n.get()) / 2).max(1)
    } else {
        request.threads
    };
    let mut st = State::default();
    let world = World::new(source, tables);
    let counters = Counters {
        read_ns: AtomicU64::new(0),
        parse_ns: AtomicU64::new(0),
        locate_ns: AtomicU64::new(0),
    };

    // Карты и типы — действующими копиями.
    let mut since = Instant::now();
    let wanted = maps_for_place(&tables.maps, centre, reach);
    let mut type_files: Vec<&str> = Vec::new();
    for map in &wanted {
        for &id in &map.types {
            if let Some(name) = tables.type_names.get(id) {
                if !type_files.contains(&name.as_str()) {
                    type_files.push(name);
                }
            }
        }
    }
    let loaded: Vec<Option<meta_map::MapTypes>> = parallel_map_with(threads, &type_files, |name| {
        let at = source.lookup(&format!("{name}.ytyp"))?;
        let bytes = world.read(&at)?;
        let res = Resource::parse(&bytes).ok()?;
        meta_map::read_map_types(&res).ok()
    });
    let mut types: HashMap<u32, Archetype> = HashMap::new();
    for file in loaded.into_iter().flatten() {
        for archetype in file.archetypes {
            types.entry(archetype.name).or_insert(archetype);
        }
        st.report.types += 1;
    }
    st.report.ms.push(("types", ms_since(since)));

    since = Instant::now();
    let map_files: Vec<Option<meta_map::MapData>> = parallel_map_with(threads, &wanted, |map| {
        let at = source.lookup(&format!("{}.ymap", map.name))?;
        let bytes = world.read(&at)?;
        let res = Resource::parse(&bytes).ok()?;
        meta_map::read_map_data(&res).ok()
    });

    let mut picked: Vec<Item> = Vec::new();
    let mut picked_at: HashMap<String, usize> = HashMap::new();
    let mut interiors: Vec<Interior> = Vec::new();
    let footprint_of = |archetype: Option<&Archetype>| Footprint {
        bb_min: archetype.map(|a| a.bb_min),
        bb_max: archetype.map(|a| a.bb_max),
        lod_dist: archetype.map_or(0.0, |a| a.lod_dist),
    };
    let mut take = |entity: &MapEntity,
                    archetype: Option<&Archetype>,
                    place: &dyn Fn([f64; 3]) -> [f64; 3],
                    turn: &dyn Fn([f64; 3]) -> [f64; 3],
                    tint: u32| {
        let hash = entity.archetype;
        let asset = archetype
            .map(|a| a.asset_name)
            .filter(|h| *h != 0)
            .unwrap_or(hash);
        let Some(name) = world
            .name_of(asset, "ydr")
            .or_else(|| world.name_of(asset, "yft"))
            .or_else(|| world.name_of(hash, "ydr"))
            .or_else(|| world.name_of(hash, "yft"))
        else {
            return;
        };
        if !model_in_frame(name) || !entity_drawn_in_view(entity.flags) {
            return;
        }
        if archetype.is_some_and(|a| placement_math::is_shadow_proxy(a.flags)) {
            return;
        }
        let world_point = place([0.0, 0.0, 0.0]);
        if let Some(shape) = &shape {
            if !entity_touches_plan(shape, origin, &footprint_of(archetype), place, world_point) {
                return;
            }
        }
        let key = entity_key(name, world_point);
        if let Some(&previous) = picked_at.get(&key) {
            let replaces = name.starts_with("hei_") && !picked[previous].name.starts_with("hei_");
            if !replaces {
                return;
            }
        }
        let item = Item {
            name: name.to_owned(),
            lod_dist: archetype.map_or(0.0, |a| a.lod_dist),
            texture_dictionary: archetype.map_or(0, |a| a.texture_dictionary),
            matrix: world_mesh::matrix_of(place),
            turn: world_mesh::turn_of(turn),
            tint,
            distance: crate::js_math::hypot(&[
                world_point[0] - centre[0],
                world_point[1] - centre[1],
            ]),
        };
        match picked_at.get(&key) {
            Some(&at) => picked[at] = item,
            None => {
                picked_at.insert(key, picked.len());
                picked.push(item);
            }
        }
    };

    for data in map_files.iter().flatten() {
        st.report.maps += 1;
        for entity in &data.entities {
            if !near_level(entity.lod_level) {
                continue;
            }
            let archetype = types.get(&entity.archetype);
            if !entity_in_reach(
                entity.position,
                archetype.map_or(0.0, |a| a.lod_dist),
                centre,
                reach,
            ) {
                continue;
            }
            if let Some(archetype) = archetype.filter(|a| a.mlo) {
                if let Some(shape) = &shape {
                    let instance = placement_math::mlo_instance_transform(&entity_of(entity));
                    if !entity_touches_plan(
                        shape,
                        origin,
                        &footprint_of(Some(archetype)),
                        &|p| instance.point(p),
                        entity.position,
                    ) {
                        continue;
                    }
                }
                interiors.push(Interior {
                    entity: entity.clone(),
                    archetype: archetype.clone(),
                    distance: crate::js_math::hypot(&[
                        entity.position[0] - centre[0],
                        entity.position[1] - centre[1],
                    ]),
                });
                continue;
            }
            let place = placement_math::placement_transform(&entity_of(entity));
            let turn = placement_math::placement_rotation(&entity_of(entity));
            take(
                entity,
                archetype,
                &|p| place.point(p),
                &|v| turn.direction(v),
                entity.tint_value,
            );
        }
    }
    // Интерьеры у середины: сквозь витрины и двери видно, что внутри.
    interiors.sort_by(|a, b| {
        a.distance
            .partial_cmp(&b.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for interior in interiors.iter().take(INTERIOR_LIMIT) {
        if interior.distance > INTERIOR_REACH {
            break;
        }
        let instance = &interior.entity;
        // Подземные и подвешенные интерьеры дополнений с улицы не видны.
        if (instance.position[2] - origin[2]).abs() > INTERIOR_HEIGHT {
            continue;
        }
        st.report.interiors += 1;
        let outer = placement_math::mlo_instance_transform(&entity_of(instance));
        let [rx, ry, rz, rw] = instance.rotation;
        let outer_turn_rotation = if rw == 1.0
            && (rx == 0.0 || rx.is_nan())
            && (ry == 0.0 || ry.is_nan())
            && (rz == 0.0 || rz.is_nan())
        {
            [0.0, 0.0, 0.0, 1.0]
        } else {
            [-rx, -ry, -rz, rw]
        };
        let turn_outer = placement_math::placement_rotation(&Entity {
            rotation: outer_turn_rotation,
            ..entity_of(instance)
        });
        for child in meta_map::mlo_entities(&interior.archetype) {
            let child_type = types.get(&child.archetype);
            let inner = placement_math::placement_transform(&entity_of(&child));
            let turn_inner = placement_math::placement_rotation(&entity_of(&child));
            take(
                &child,
                child_type,
                &|p| outer.point(inner.point(p)),
                &|v| turn_outer.direction(turn_inner.direction(v)),
                child.tint_value,
            );
        }
    }
    st.report.entities = picked.len();
    st.report.ms.push(("maps", ms_since(since)));

    // Модели: все места одной модели подряд.
    since = Instant::now();
    let mut by_model: Vec<(String, Vec<Item>)> = Vec::new();
    let mut by_model_at: HashMap<String, usize> = HashMap::new();
    for item in picked {
        let at = *by_model_at.entry(item.name.clone()).or_insert_with(|| {
            by_model.push((item.name.clone(), Vec::new()));
            by_model.len() - 1
        });
        by_model[at].1.push(item);
    }
    let big = |list: &Vec<Item>| {
        list.iter()
            .fold(f64::NEG_INFINITY, |m, item| m.max(item.lod_dist))
    };
    let near = |list: &Vec<Item>| {
        list.iter()
            .fold(f64::INFINITY, |m, item| m.min(item.distance))
    };
    by_model.sort_by(|a, b| {
        let (big_a, big_b) = (big(&a.1), big(&b.1));
        let result = if (big_b >= BIG_LOD_DIST) == (big_a >= BIG_LOD_DIST) {
            near(&a.1) - near(&b.1)
        } else {
            big_b - big_a
        };
        result
            .partial_cmp(&0.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut cells: Vec<(usize, CellGroups)> = Vec::new();
    let mut cells_at: HashMap<usize, usize> = HashMap::new();
    let mut spent: u64 = 0;
    let mut place_ns: u64 = 0;

    // Читатели словарей: сколько моделей из очереди могут искать лист в каждом. Словарь с нулём читателей после окна моделей отпускается:
    // порядок — по очереди моделей, а не по потокам; отпущенный словарь не влияет на результат, это кэш.
    let model_files: Vec<Vec<String>> = by_model
        .iter()
        .map(|(name, list)| world.dictionary_files(name, list[0].texture_dictionary))
        .collect();
    let mut readers: HashMap<&str, usize> = HashMap::new();
    for files in &model_files {
        for file in files {
            *readers.entry(file.as_str()).or_default() += 1;
        }
    }

    let window = (threads * 3).max(1);
    for (chunk_at, chunk) in by_model.chunks(window).enumerate() {
        // Чтение и разбор моделей порции — в потоках; поиск листов у каждой модели греет словари в тех же потоках.
        let prepared: Vec<Option<Model>> = parallel_map_with(threads, chunk, |(name, list)| {
            let repeated = list.len() >= REPEATED_MODEL
                || ["prop_", "p_", "v_"]
                    .iter()
                    .any(|prefix| name.starts_with(prefix));
            let with_far = repeated && list.iter().any(|item| item.distance > PROP_NEAR);
            let model = load_model(
                &world,
                name,
                with_far,
                list[0].texture_dictionary,
                &counters,
            )?;
            let began = Instant::now();
            warm_sheets(&world, &model);
            counters
                .locate_ns
                .fetch_add(began.elapsed().as_nanos() as u64, Relaxed);
            Some(model)
        });
        let began_place = Instant::now();
        for ((name, list), model) in chunk.iter().zip(prepared) {
            let Some(model) = model else {
                st.report.missing_models += 1;
                let _ = name;
                continue;
            };
            st.report.models += 1;
            let mut looks: HashMap<usize, Option<ModelLook>> = HashMap::new();
            for item in list {
                if spent > VERTEX_BUDGET
                    && item.lod_dist < BIG_LOD_DIST
                    && item.distance > reach * 0.45
                {
                    st.report.dropped += 1;
                    continue;
                }
                let use_far = model.far.is_some() && item.distance > PROP_NEAR;
                let (level, surfaces) = match (&model.far, use_far) {
                    (Some(far), true) => (far, &model.far_surfaces),
                    _ => (&model.drawable, &model.surfaces),
                };
                for (mesh_at, mesh) in level.meshes.iter().enumerate() {
                    if mesh.indices.is_empty() {
                        continue;
                    }
                    if !looks.contains_key(&mesh.shader_index) {
                        let look = st.look_of(&world, &model, mesh);
                        looks.insert(mesh.shader_index, look);
                    }
                    let Some(look) = looks.get(&mesh.shader_index).and_then(|l| l.as_ref()) else {
                        continue;
                    };
                    let Some(mut placed) = world_mesh::place_mesh(
                        mesh,
                        &item.matrix,
                        &item.turn,
                        origin,
                        area,
                        floor,
                        top,
                    ) else {
                        continue;
                    };
                    let slot = look.slot;
                    st.materials[slot].area =
                        Some(st.materials[slot].area.unwrap_or(0.0) + surfaces[mesh_at]);
                    let empty = ShaderVectors::new();
                    world_mesh::apply_global_uv(
                        &mut placed,
                        model.vectors.get(mesh.shader_index).unwrap_or(&empty),
                    );
                    if look.terrain {
                        if !look.mask {
                            placed.uvs1 = None;
                        }
                        placed.colours = Some(world_mesh::terrain_weights(&placed));
                    } else {
                        placed.uvs1 = None;
                        placed.colours = if look.vertex {
                            let palette = look.pixels.as_ref().map(|image| Palette {
                                width: image.width as usize,
                                height: image.height as usize,
                                rgba: &image.rgba,
                            });
                            Some(world_mesh::vertex_colours(
                                placed.colours.as_ref(),
                                palette.as_ref(),
                                look.vertex_alpha,
                                item.tint,
                                placed.positions.len() / 3,
                            ))
                        } else {
                            None
                        };
                    }
                    spent += (placed.positions.len() / 3) as u64;
                    let cell = (
                        (placed.centre[0] / CELL).floor() as i64,
                        (placed.centre[1] / CELL).floor() as i64,
                    );
                    let at = *cells_at.entry(slot).or_insert_with(|| {
                        cells.push((slot, CellGroups::default()));
                        cells.len() - 1
                    });
                    cells[at].1.add(cell, placed);
                }
            }
        }
        place_ns += began_place.elapsed().as_nanos() as u64;
        for files in &model_files[chunk_at * window..chunk_at * window + chunk.len()] {
            for file in files {
                if let Some(left) = readers.get_mut(file.as_str()) {
                    *left -= 1;
                    if *left == 0 {
                        world.evict(file);
                    }
                }
            }
        }
    }
    st.report.dictionaries = world.dict_report();
    st.report.ms.push(("models", ms_since(since)));
    st.report
        .work_ms
        .push(("read", counters.read_ns.load(Relaxed) as f64 / 1e6));
    st.report
        .work_ms
        .push(("parse", counters.parse_ns.load(Relaxed) as f64 / 1e6));
    st.report
        .work_ms
        .push(("sheets", counters.locate_ns.load(Relaxed) as f64 / 1e6));
    st.report.work_ms.push(("place", place_ns as f64 / 1e6));

    since = Instant::now();
    let mut meshes: Vec<ars1::Mesh> = Vec::new();
    for (slot, by_cell) in cells {
        for list in by_cell.groups {
            let mut group: Vec<Placed> = Vec::new();
            let mut count = 0usize;
            let mut flush = |group: &mut Vec<Placed>, count: &mut usize| {
                if group.is_empty() {
                    return;
                }
                let joined = world_mesh::join_meshes(std::mem::take(group));
                meshes.push(ars1::Mesh {
                    material: slot as u32,
                    part: 0,
                    entity: None,
                    positions: joined.positions,
                    normals: Some(joined.normals),
                    uvs: joined.uvs,
                    uvs1: joined.uvs1,
                    colours: joined.colours,
                    indices: joined.indices,
                });
                *count = 0;
            };
            for mesh in list {
                let size = mesh.positions.len() / 3;
                if count + size > MESH_VERTICES {
                    flush(&mut group, &mut count);
                }
                group.push(mesh);
                count += size;
            }
            flush(&mut group, &mut count);
        }
    }

    // Вода — плоскостями квадов, если они в круге: у моря в игре моделей нет.
    let mut water = false;
    if let Some(text) = source.water() {
        if let Some((positions, normals, indices)) = water_mesh(&water_quads(&text), origin, reach)
        {
            water = true;
            st.materials.push(SceneMaterial {
                id: "water".into(),
                name: "water".into(),
                colour: WATER_COLOUR.into(),
                look: Look::Water,
                area: None,
            });
            meshes.push(ars1::Mesh {
                material: (st.materials.len() - 1) as u32,
                part: 0,
                entity: None,
                positions,
                normals: Some(normals),
                uvs: None,
                uvs1: None,
                colours: None,
                indices,
            });
        }
    }
    st.report.water = water;
    // Обвод: линии — материалы зон, как у сцены зон: кадр красит их так же.
    let mut zone_parts: Vec<&str> = Vec::new();
    if !request.zones.is_empty() {
        let began_outline = Instant::now();
        for (at, lines) in outline::outline_meshes(source, &request.zones, origin, threads)? {
            let zone = &request.zones[at];
            let part = match zone_parts.iter().position(|id| *id == zone.part) {
                Some(part) => part,
                None => {
                    zone_parts.push(&zone.part);
                    zone_parts.len() - 1
                }
            };
            st.materials.push(SceneMaterial {
                id: zone.id.clone(),
                name: zone.id.clone(),
                colour: zone.colour.clone(),
                look: Look::Zone {
                    opacity: zone.alpha / 255.0,
                },
                area: None,
            });
            let material = (st.materials.len() - 1) as u32;
            for mut line in lines {
                line.material = material;
                line.part = (part + 1) as u32;
                meshes.push(line);
            }
        }
        st.report.ms.push(("outline", ms_since(began_outline)));
    }
    st.report.sheets = st.textures.len();
    st.report.meshes = meshes.len();
    for mesh in &meshes {
        st.report.vertices += (mesh.positions.len() / 3) as u64;
        st.report.triangles += (mesh.indices.len() / 3) as u64;
    }
    let bounds = ars1::bounds_of(&meshes);
    let mut parts = vec![format!(
        "{{\"id\":\"{WORLD_PLACE_PART}\",\"bounds\":{}{}}}",
        box_json(bounds.min, bounds.max),
        if water { ",\"water\":true" } else { "" }
    )];
    for (at, id) in zone_parts.iter().enumerate() {
        let lines = ars1::bounds_of_refs(meshes.iter().filter(|mesh| mesh.part == (at + 1) as u32));
        parts.push(format!(
            "{{\"id\":{},\"bounds\":{}}}",
            json_string(id),
            box_json(lines.min, lines.max)
        ));
    }
    st.report.ms.push(("join", ms_since(since)));
    st.report.ms.push(("total", ms_since(started)));
    if meshes.is_empty() {
        if let Some(error) = world
            .first_read_error
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            return Err(error);
        }
    }
    let scene = ars1::Scene {
        bounds: Some(bounds),
        parts: format!("[{}]", parts.join(",")),
        rooms: None,
        materials: materials_json(&st.materials),
        textures: textures_json(&st.textures),
        lamps: None,
        neutral_light: false,
        meshes,
    };
    Ok(Built {
        scene,
        report: st.report,
    })
}

/// Прогрев словарей листов модели в потоке чтения: те же поиски, что у расстановки, но без записи в сцену.
fn warm_sheets(world: &World, model: &Model) {
    let mut names: Vec<String> = Vec::new();
    for material in model.materials.iter().flatten() {
        for sampler in &material.samplers {
            if let Some(texture) = sampler.texture.as_deref().filter(|t| !t.is_empty()) {
                let lower = texture.to_lowercase();
                if !names.contains(&lower) {
                    names.push(lower);
                }
            }
        }
    }
    for name in names {
        let _ = world.locate_uncached(&name, model);
    }
}

/// Клетки одного материала: группы сеток в порядке появления клеток.
#[derive(Default)]
struct CellGroups {
    groups: Vec<Vec<Placed>>,
    at: HashMap<(i64, i64), usize>,
}

impl CellGroups {
    fn add(&mut self, cell: (i64, i64), placed: Placed) {
        match self.at.get(&cell) {
            Some(&at) => self.groups[at].push(placed),
            None => {
                self.at.insert(cell, self.groups.len());
                self.groups.push(vec![placed]);
            }
        }
    }
}

/// Что копится по ходу расстановки: материалы, листы, цвета листов, палитры, найденные листы и отчёт.
#[derive(Default)]
struct State {
    report: Report,
    materials: Vec<SceneMaterial>,
    material_index: HashMap<String, usize>,
    textures: Vec<SceneTexture>,
    texture_index: HashMap<String, usize>,
    colours: HashMap<String, String>,
    palettes: HashMap<String, Option<Arc<texture::Image>>>,
    locate_cache: HashMap<String, Option<Located>>,
}

impl State {
    fn locate(&mut self, world: &World, model: &Model, texture: &str) -> Option<Located> {
        let key = format!("{}|{}|{texture}", model.name, model.txd);
        self.locate_cache
            .entry(key)
            .or_insert_with(|| world.locate_uncached(texture, model))
            .clone()
    }

    /// Лист материала: найденный и его номер в сцене (лист попадает в сцену при первом обращении).
    fn sheet(
        &mut self,
        world: &World,
        model: &Model,
        texture: Option<&String>,
    ) -> Option<(Located, usize)> {
        let name = texture?;
        let Some(found) = self.locate(world, model, name) else {
            self.report.missing_sheets += 1;
            return None;
        };
        let key = format!("{}|{name}", found.at);
        let slot = match self.texture_index.get(&key) {
            Some(&slot) => slot,
            None => {
                self.textures.push(SceneTexture {
                    name: format!(
                        "g:{}:{name}",
                        found.at.rsplit('/').next().unwrap_or(&found.at)
                    ),
                    game: found.at.clone(),
                    texture: name.clone(),
                });
                self.texture_index.insert(key, self.textures.len() - 1);
                self.textures.len() - 1
            }
        };
        Some((found, slot))
    }

    /// Средний цвет листа; не прочитался — цвет земли.
    fn colour_of(&mut self, world: &World, model: &Model, found: &Located) -> String {
        let key = format!("{}|{}", found.at, found.tex.name);
        self.colours
            .entry(key)
            .or_insert_with(|| {
                let decoded = world
                    .resource_of(model, found)
                    .and_then(|res| texture::decode_js(&res, &found.tex, None, Some(32)).ok());
                match decoded {
                    Some(image) => crate::texture_js::mean_colour_of(&image.rgba),
                    None => "#8b7d61".to_owned(),
                }
            })
            .clone()
    }

    fn palette_of(
        &mut self,
        world: &World,
        model: &Model,
        found: &Located,
    ) -> Option<Arc<texture::Image>> {
        let key = format!("{}|{}", found.at, found.tex.name);
        self.palettes
            .entry(key)
            .or_insert_with(|| {
                let res = world.resource_of(model, found)?;
                texture::decode_js(&res, &found.tex, Some(0), None)
                    .ok()
                    .map(Arc::new)
            })
            .clone()
    }

    fn add_material(&mut self, key: &str, make: impl FnOnce(String) -> SceneMaterial) -> usize {
        if let Some(&slot) = self.material_index.get(key) {
            return slot;
        }
        self.material_index
            .insert(key.to_owned(), self.materials.len());
        self.materials.push(make(key.to_owned()));
        self.materials.len() - 1
    }

    fn look_of(&mut self, world: &World, model: &Model, mesh: &Mesh) -> Option<ModelLook> {
        let material = model
            .materials
            .get(mesh.shader_index)
            .and_then(|m| m.as_ref());
        let empty = ShaderVectors::new();
        let vectors = model.vectors.get(mesh.shader_index).unwrap_or(&empty);
        let Some(material) = material else {
            self.report.no_colour += 1;
            return None;
        };
        let shader = shader_file_name(material.shader_hash, material.shader_file_hash);
        let named = format!("{} {}", material.shader, material.shader_file.unwrap_or(""));
        let night_only = matches!(
            shader,
            "decal_emissive_only"
                | "decal_emissivenight_only"
                | "emissive_additive_alpha"
                | "emissive_additive_uv_alpha"
        );
        let kind = if night_only || has_word(&named, &["grass", "fur", "billboard", "ped_"]) {
            None
        } else {
            shop_material_class(material, vectors)
        };
        let mut samplers: HashMap<u32, String> = HashMap::new();
        for sampler in &material.samplers {
            if let Some(texture) = sampler.texture.as_deref().filter(|t| !t.is_empty()) {
                samplers.insert(sampler.hash, texture.to_lowercase());
            }
        }
        let diffuse = diffuse_of(material);
        let Some(kind) = kind.filter(|_| !diffuse.contains("ducttape") && !diffuse.is_empty())
        else {
            self.report.no_colour += 1;
            return None;
        };
        let layer_names: Vec<Option<String>> = LAYER_SAMPLERS
            .iter()
            .map(|hash| samplers.get(hash).cloned())
            .collect();
        let mask_name = samplers.get(&MASK_SAMPLER).cloned();
        let terrain = layer_names.iter().any(|name| name.is_some());

        let base = self.sheet(world, model, Some(&diffuse));
        let palette_name = if kind.tint {
            samplers.get(&shop_material::palette_sampler()).cloned()
        } else {
            None
        };
        let palette_at = palette_name.and_then(|name| self.locate(world, model, &name));
        let pixels = palette_at.and_then(|found| self.palette_of(world, model, &found));

        if terrain {
            let mut layers: Vec<Option<usize>> = vec![base.as_ref().map(|b| b.1)];
            for name in &layer_names {
                layers.push(self.sheet(world, model, name.as_ref()).map(|s| s.1));
            }
            let mask = self.sheet(world, model, mask_name.as_ref()).map(|s| s.1);
            let key = format!(
                "t|{}|{}",
                layers
                    .iter()
                    .map(|l| l.map_or(String::new(), |v| v.to_string()))
                    .collect::<Vec<_>>()
                    .join(","),
                mask.map_or(String::new(), |v| v.to_string())
            );
            let colour = base.as_ref().map_or_else(
                || "#8b7d61".to_owned(),
                |b| self.colour_of(world, model, &b.0),
            );
            let slot = self.add_material(&key, |id| SceneMaterial {
                id,
                name: diffuse.clone(),
                colour,
                look: Look::Terrain { layers, mask },
                area: None,
            });
            return Some(ModelLook {
                slot,
                terrain: true,
                mask: mask.is_some(),
                vertex: false,
                pixels: None,
                vertex_alpha: false,
            });
        }
        // Ночное свечение днём не горит: окна — обычным листом.
        let emission = if shader.contains("night") {
            0.0
        } else {
            kind.emission
        };
        let vertex = pixels.is_some() || kind.vertex_alpha;
        let base_slot = base.as_ref().map(|b| b.1);
        let key = [
            base_slot.map_or_else(|| format!("c:{diffuse}"), |slot| slot.to_string()),
            kind.alpha.as_str().to_owned(),
            u8::from(kind.decal).to_string(),
            u8::from(kind.dirt).to_string(),
            u8::from(kind.mirror).to_string(),
            number_to_string(emission),
            u8::from(vertex).to_string(),
        ]
        .join("|");
        let colour = if self.material_index.contains_key(&key) {
            String::new()
        } else {
            base.as_ref().map_or_else(
                || "#9a958c".to_owned(),
                |b| self.colour_of(world, model, &b.0),
            )
        };
        let slot = self.add_material(&key, |id| SceneMaterial {
            id,
            name: diffuse.clone(),
            colour,
            look: Look::Plain {
                alpha: kind.alpha.as_str(),
                decal: kind.decal,
                dirt: kind.dirt,
                mirror: kind.mirror,
                emission,
                vertex,
                through: kind.decal || kind.dirt || kind.glass,
                double_sided: kind.alpha == shop_material::Alpha::Blend && !kind.decal,
                texture: if kind.mirror { None } else { base_slot },
            },
            area: None,
        });
        Some(ModelLook {
            slot,
            terrain: false,
            mask: false,
            vertex,
            pixels,
            vertex_alpha: kind.vertex_alpha,
        })
    }
}

/// Кодировать сцену в файл `ARS1` (уровень сжатия JS — 4; число потоков квантования — как у сборки).
pub fn encode(built: &Built, level: i32, threads: usize) -> Result<(Vec<u8>, f64)> {
    let began = Instant::now();
    let options = ars1::Options {
        level,
        threads,
        entities: false,
    };
    let bytes = ars1::encode(&built.scene, &options)?;
    Ok((bytes, ms_since(began)))
}

#[cfg(test)]
mod tests;
