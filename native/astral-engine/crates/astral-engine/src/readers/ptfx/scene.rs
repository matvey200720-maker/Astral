//! Сцены трассеров, тира и окружения (разделы `tracerScene`, `rangeScene`,
//! `environmentScene` ответа `read-ptfx-base`).
//!
//! Для каждого окна мастерской выгружаются правила эффектов сцены из ядра игрока и
//! готовятся картинки листов, которые эти правила рисуют; окно получает всё готовым:
//! выгрузку правил, найденные правила или выбранный эффект семейства и листы в виде
//! data-URL. Модуль только читает ресурс и хранилище оригиналов.

use std::{
    collections::{BTreeMap, HashSet},
    hash::Hash,
};

use rage_res::{
    texture::{Format, TextureRef},
    ypt::export,
    Resource,
};
use serde_json::{Map, Value};

use super::{
    clip_regions::{grid_for, Grid},
    environment::{
        base64, block_format, object_of, png_of, scaled, ByName, Family, Originals, FAMILIES,
    },
    pixels::{self, Dxt},
};
use crate::error::{EngineError, Result};

/// Эффекты сцены трассеров: порядок запроса.
const TRACER_RULES: [&str; 10] = [
    "bullet_tracer",
    "bullet_tracer_mg",
    "muz_assault_rifle",
    "muz_assault_rifle_fp",
    "muz_pistol",
    "muz_pistol_fp",
    "muz_smg",
    "muz_smg_fp",
    "muz_shotgun",
    "bul_concrete",
];

/// Эффекты сцены тира: порядок запроса.
const RANGE_RULES: [&str; 12] = [
    "muz_assault_rifle",
    "muz_pistol",
    "muz_smg",
    "muz_shotgun",
    "muz_minigun",
    "muz_smoking_barrel",
    "eject_auto",
    "eject_pistol",
    "eject_shotgun",
    "eject_sniper",
    "eject_sniper_heavy",
    "eject_minigun",
];

/// Кандидаты эффекта-витрины по семействам окружения, в порядке предпочтения.
const SHOWCASES: [(&str, &[&str]); 15] = [
    (
        "fire",
        &[
            "fire_map",
            "fire_object",
            "ent_amb_fbi_fire_lg",
            "ent_amb_fbi_fire_wall_lg",
            "ent_amb_beach_campfire",
            "ent_amb_barrel_fire",
            "ent_ray_heli_aprtmnt_h_fire",
            "ent_dst_elec_fire",
            "fire_wrecked_car",
            "fire_petroltank_car",
        ],
    ),
    (
        "flame",
        &[
            "ent_sht_flame",
            "fire_wrecked_car",
            "fire_petroltank_car",
            "fire_wrecked_plane_cockpit",
            "ent_amb_int_fireplace",
            "ent_anim_bbq",
            "proj_molotov_flame",
            "exp_air_molotov",
        ],
    ),
    (
        "fire-trail",
        &[
            "ent_amb_torch_fire",
            "proj_molotov_trail",
            "sp_fire_trail_heli",
            "sp_fire_trail_plane",
            "fire_ped_body",
            "exp_grd_vehicle",
        ],
    ),
    (
        "embers",
        &[
            "ent_amb_beach_campfire",
            "ent_ray_heli_aprtmnt_embers",
            "fire_map",
            "ent_amb_fbi_fire_lg",
            "exp_air_grenade",
        ],
    ),
    (
        "candle",
        &[
            "ent_anim_welder",
            "ent_amb_welding",
            "ent_amb_candle_flame",
            "ent_anim_cig_smoke",
        ],
    ),
    (
        "afterburner",
        &[
            "veh_exhaust_afterburner",
            "veh_exhaust_jet",
            "proj_rpg_trail",
            "proj_missile_trail",
        ],
    ),
    (
        "muzzle",
        &[
            "muz_assault_rifle",
            "muz_pistol",
            "muz_smg",
            "muz_shotgun",
            "muz_minigun",
            "muz_tank",
        ],
    ),
    (
        "impact-flash",
        &[
            "bul_carmetal",
            "bul_metal",
            "bul_concrete",
            "ent_sht_electrical_box",
        ],
    ),
    (
        "glow",
        &[
            "exp_grd_flare",
            "ent_amb_elec_crackle_sp",
            "sp_ent_sparking_wires",
            "ent_amb_elec_crackle",
        ],
    ),
    (
        "explosion-glow",
        &[
            "exp_grd_grenade",
            "exp_grd_rpg",
            "exp_grd_petrol_pump",
            "exp_arc_grd_flashbang",
            "exp_air_molotov",
        ],
    ),
    (
        "flare",
        &[
            "proj_flare_fuse",
            "exp_grd_flare",
            "proj_flare_trail",
            "weap_heist_flare_trail",
            "muz_railgun",
        ],
    ),
    (
        "explosion",
        &[
            "exp_grd_grenade",
            "exp_grd_vehicle",
            "exp_grd_rpg",
            "exp_grd_petrol_pump",
            "exp_grd_plane",
            "exp_air_grenade",
            "exp_air_molotov",
        ],
    ),
    (
        "sparks",
        &[
            "ent_amb_sparking_wires",
            "sp_foundry_sparks",
            "ent_amb_elec_crackle_sp",
            "ent_sht_electrical_box",
            "bul_stungun_metal",
            "shotgun_water",
        ],
    ),
    (
        "smoke",
        &[
            "ent_amb_smoke_general",
            "ent_amb_smoke_foundry",
            "fire_ped_smoulder",
            "env_gunsmoke",
            "ent_dst_electrical",
            "fire_wrecked_car",
        ],
    ),
    (
        "steam",
        &[
            "ent_amb_steam",
            "ent_amb_steam_vent_round",
            "ent_amb_steam_pipe",
            "ent_brk_steam_burst",
            "ent_amb_cig_smoke",
        ],
    ),
];

/// Сколько имён в одной порции выгрузки сцены окружения.
const EXPORT_BATCH: usize = 32;

/// Два блока частицы, порождающие другие эффекты, в порядке обхода.
const SPAWNER_BLOCKS: [&str; 2] = ["EffectSpawnerAtRatio", "EffectSpawnerOnCollision"];

/// Начало имени переменной шейдера, которая несёт основную текстуру частицы.
const DIFFUSE_PREFIX: &[u8] = b"diffusetex";

/// Сцена трассеров пуль.
pub fn tracer_scene(
    resource: &Resource,
    textures: &[TextureRef],
    grids: &BTreeMap<String, Grid>,
    originals: &Originals,
) -> Result<Value> {
    Stage::new(resource, textures, grids, originals).weapons(&TRACER_RULES)
}

/// Сцена тира.
pub fn range_scene(
    resource: &Resource,
    textures: &[TextureRef],
    grids: &BTreeMap<String, Grid>,
    originals: &Originals,
) -> Result<Value> {
    Stage::new(resource, textures, grids, originals).weapons(&RANGE_RULES)
}

/// Сцена окружения: эффект-витрина для каждого семейства и его листы.
pub fn environment_scene(
    resource: &Resource,
    textures: &[TextureRef],
    grids: &BTreeMap<String, Grid>,
    originals: &Originals,
) -> Result<Value> {
    Stage::new(resource, textures, grids, originals).environment()
}

/// Как строится картинка листа.
#[derive(Clone, Copy)]
pub(super) enum SheetKind {
    /// Трассеры, тир и импакт.
    Weapon,
    /// Окружение: в записи листа есть формат.
    Environment,
}

impl SheetKind {
    /// Верхний предел длинной стороны листа.
    const EDGE: usize = 1024;

    /// Предел длинной стороны для сетки: нижняя граница, но не больше `EDGE`; размер
    /// кадра при расчёте переполняется по кругу, как в исходной арифметике.
    fn cap(self, grid: Grid) -> usize {
        let (floor, frame): (usize, usize) = match self {
            SheetKind::Weapon => (128, 128),
            SheetKind::Environment => (256, 160),
        };
        let across = grid.columns.max(grid.rows);
        floor.max(frame.wrapping_mul(across)).min(Self::EDGE)
    }

    fn names_format(self) -> bool {
        matches!(self, SheetKind::Environment)
    }
}

/// Картинка с размерами.
struct Raster {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

impl Raster {
    /// Уменьшает так, чтобы длинная сторона не превышала `cap`; больше листа не растим.
    fn shrunk_to(self, cap: usize) -> std::result::Result<Raster, String> {
        let ratio = cap as f64 / self.width.max(self.height) as f64;
        if ratio >= 1.0 {
            return Ok(self);
        }
        let (width, height) = scaled(self.width, self.height, ratio);
        let rgba = pixels::resample(&self.rgba, self.width, self.height, width, height)?;
        Ok(Raster {
            width,
            height,
            rgba,
        })
    }
}

/// Формат и блочный вид листа, если лист такой, что его рисуют.
fn codec_of(texture: &TextureRef) -> Option<(Format, Dxt)> {
    let format = texture.format?;
    Some((format, block_format(format)?))
}

/// Что нужно, чтобы нарисовать лист: ресурс, хранилище оригиналов и вид картинки.
pub(super) struct Press<'a> {
    resource: &'a Resource,
    originals: &'a Originals,
    kind: SheetKind,
}

impl<'a> Press<'a> {
    pub(super) fn new(resource: &'a Resource, originals: &'a Originals, kind: SheetKind) -> Self {
        Press {
            resource,
            originals,
            kind,
        }
    }

    /// Запись одного листа. `Ok(None)` — «листа не будет»: не блочный формат, лист не
    /// больше 8 пикселей или оригинал короче уровня.
    pub(super) fn entry(&self, texture: &TextureRef, grid: Grid) -> Result<Option<Value>> {
        let width = texture.width as usize;
        let height = texture.height as usize;
        let Some((format, dxt)) = codec_of(texture).filter(|_| width.max(height) > 8) else {
            return Ok(None);
        };
        let Some((base, _)) = self.originals.level_zero(self.resource, texture, format)? else {
            return Ok(None);
        };
        let rgba =
            pixels::decode_dxt(dxt, &base, width, height).map_err(EngineError::invalid_data)?;
        let picture = Raster {
            width,
            height,
            rgba,
        }
        .shrunk_to(self.kind.cap(grid))
        .map_err(EngineError::invalid_data)?;
        let png = png_of(picture.width, picture.height, &picture.rgba)?;

        let labelled = self
            .kind
            .names_format()
            .then(|| ("format", Value::from(format.name())));
        let url = format!("data:image/png;base64,{}", base64(&png));
        let fields = [
            ("width", Value::from(picture.width)),
            ("height", Value::from(picture.height)),
            ("columns", Value::from(grid.columns)),
            ("rows", Value::from(grid.rows)),
        ]
        .into_iter()
        .chain(labelled)
        .chain([("png", Value::from(url))]);
        Ok(Some(object_of(fields)))
    }
}

/// Элементы JSON-массива по ключу; нет ключа или это не массив — пусто.
pub(super) fn list_at<'v>(value: &'v Value, key: &str) -> &'v [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

/// Строка по ключу; нет ключа или это не строка — пустая.
fn text_at<'v>(value: &'v Value, key: &str) -> &'v str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Выгрузка правил в форме ответа: поля `Export` как есть, в порядке ключей.
pub(super) fn export_of(resource: &Resource, rules: &[&str]) -> Result<Value> {
    let requested: Vec<String> = rules.iter().copied().map(String::from).collect();
    let dump = export::rules(resource, &requested)?;
    Ok(object_of([
        ("effects", Value::Object(dump.effects)),
        ("emitters", Value::Object(dump.emitters)),
        ("particles", Value::Object(dump.particles)),
        ("textures", Value::from(dump.textures)),
        ("drawables", Value::from(dump.drawables)),
        ("meshes", Value::Object(dump.meshes)),
        ("missing", Value::from(dump.missing)),
    ]))
}

/// Без повторов, в порядке первого появления.
fn first_seen<T: Eq + Hash + Clone>(items: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(item.clone()))
        .collect()
}

/// Текстуры-переменные частицы вида `diffusetex…` с непустым именем текстуры.
fn diffuse_textures(particle: &Value) -> impl Iterator<Item = String> + '_ {
    list_at(particle, "ShaderVars").iter().filter_map(|var| {
        let name = text_at(var, "TextureName");
        let diffuse = text_at(var, "Name")
            .as_bytes()
            .get(..DIFFUSE_PREFIX.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(DIFFUSE_PREFIX));
        let wanted = diffuse && text_at(var, "Type") == "Texture" && !name.is_empty();
        wanted.then(|| name.to_ascii_lowercase())
    })
}

/// Выгрузки, в которых ищутся эффекты и частицы: побеждает первая, где имя найдено.
struct Dumps<'a>(&'a [Value]);

impl<'a> Dumps<'a> {
    fn lookup(&self, table: &str, name: &str) -> Option<&'a Value> {
        self.0.iter().find_map(|dump| dump.get(table)?.get(name))
    }

    /// Листы эффекта (нижний регистр) в порядке появления; посещённые имена общие на обход.
    fn sheets_of(&self, effect: &str) -> Vec<String> {
        first_seen(Trail::start(self, effect))
    }
}

/// Шаг обхода: эффект, в который ещё предстоит войти, или частица, которую ещё читать.
enum Step<'a> {
    Effect(String),
    Particle(&'a Value),
}

/// Обход эффекта и порождённых им эффектов в глубину. Выдаёт имена листов (нижний
/// регистр) в порядке появления, повторы не убирает; на каждом имени эффекта обход
/// бывает один раз.
struct Trail<'a> {
    dumps: &'a Dumps<'a>,
    pending: Vec<Step<'a>>,
    visited: HashSet<String>,
    ready: Vec<String>,
}

impl<'a> Trail<'a> {
    fn start(dumps: &'a Dumps<'a>, effect: &str) -> Self {
        Trail {
            dumps,
            pending: vec![Step::Effect(effect.to_owned())],
            visited: HashSet::new(),
            ready: Vec::new(),
        }
    }

    /// Входит в эффект, если он не пуст и не посещён: его частицы встают в очередь так,
    /// что первая из них идёт первой.
    fn enter(&mut self, effect: String) {
        if effect.is_empty() || !self.visited.insert(effect.clone()) {
            return;
        }
        let dumps = self.dumps;
        let events = dumps
            .lookup("effects", &effect)
            .map(|found| list_at(found, "EventEmitters"))
            .unwrap_or_default();
        let particles = events
            .iter()
            .filter_map(|event| dumps.lookup("particles", text_at(event, "ParticleRule")));
        let mut queued: Vec<&'a Value> = particles.collect();
        queued.reverse();
        self.pending.extend(queued.into_iter().map(Step::Particle));
    }

    /// Читает частицу: её текстуры готовятся к выдаче, а порождённые ею эффекты встают
    /// в очередь следом, в порядке блоков.
    fn read(&mut self, particle: &'a Value) {
        self.ready = diffuse_textures(particle).collect();
        self.ready.reverse();
        for block in SPAWNER_BLOCKS.iter().rev() {
            let spawned = particle.get(block).map_or("", |b| text_at(b, "EffectRule"));
            self.pending.push(Step::Effect(spawned.to_owned()));
        }
    }
}

impl Iterator for Trail<'_> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        loop {
            if let Some(name) = self.ready.pop() {
                return Some(name);
            }
            match self.pending.pop()? {
                Step::Effect(name) => self.enter(name),
                Step::Particle(particle) => self.read(particle),
            }
        }
    }
}

/// Текстуры моделей выгрузки: части каждой модели, нижний регистр, пустые как есть.
fn model_textures(dump: &Value) -> Vec<String> {
    let Some(meshes) = dump.get("meshes").and_then(Value::as_object) else {
        return Vec::new();
    };
    meshes
        .values()
        .flat_map(|mesh| list_at(mesh, "parts"))
        .filter_map(|part| part.get("texture")?.as_str())
        .map(str::to_ascii_lowercase)
        .collect()
}

/// Имена эффектов выгрузки, в порядке её ключей.
fn effect_names(dump: &Value) -> Vec<String> {
    dump.get("effects")
        .and_then(Value::as_object)
        .map(|effects| effects.keys().cloned().collect())
        .unwrap_or_default()
}

/// Кандидаты витрин без повторов, в порядке таблицы.
fn showcase_names() -> Vec<&'static str> {
    first_seen(SHOWCASES.iter().flat_map(|&(_, list)| list.iter().copied()))
}

/// Витрина семейства — первый его кандидат, который есть в выгрузках и рисует лист семейства.
fn showcase_for(dumps: &Dumps, family: &Family) -> Option<&'static str> {
    let list: &'static [&'static str] = SHOWCASES
        .iter()
        .find_map(|&(id, list)| (id == family.id).then_some(list))?;
    let own: HashSet<String> = family.textures.iter().map(|t| t.to_lowercase()).collect();
    list.iter().copied().find(|&effect| {
        let known = dumps.lookup("effects", effect).is_some();
        known
            && dumps
                .sheets_of(effect)
                .iter()
                .any(|sheet| own.contains(sheet))
    })
}

/// Ядро игрока, из которого строятся сцены.
struct Stage<'a> {
    resource: &'a Resource,
    textures: &'a [TextureRef],
    grids: &'a BTreeMap<String, Grid>,
    originals: &'a Originals,
}

impl<'a> Stage<'a> {
    fn new(
        resource: &'a Resource,
        textures: &'a [TextureRef],
        grids: &'a BTreeMap<String, Grid>,
        originals: &'a Originals,
    ) -> Self {
        Stage {
            resource,
            textures,
            grids,
            originals,
        }
    }

    /// Листы по именам (нижний регистр), по порядку: нет текстуры или записи — пропуск.
    /// Ключ — имя текстуры словаря как есть.
    fn gather(&self, wanted: &[String], kind: SheetKind) -> Result<Map<String, Value>> {
        let press = Press::new(self.resource, self.originals, kind);
        let catalogue = ByName::of(self.textures);
        wanted
            .iter()
            .filter_map(|name| {
                let texture = catalogue.find(name)?;
                let entry = press.entry(texture, grid_for(self.grids, name));
                entry
                    .map(|sheet| sheet.map(|value| (texture.name.clone(), value)))
                    .transpose()
            })
            .collect()
    }

    /// Сцена по одному списку правил (трассеры и тир).
    fn weapons(&self, names: &[&str]) -> Result<Value> {
        let dump = export_of(self.resource, names)?;
        // «Правила сцены» — все эффекты выгрузки, в порядке её ключей.
        let present = effect_names(&dump);
        let dumps = Dumps(std::slice::from_ref(&dump));
        let drawn = present
            .iter()
            .flat_map(|effect| dumps.sheets_of(effect))
            .chain(model_textures(&dump));
        let needed = first_seen(drawn);
        let sheets = self.gather(&needed, SheetKind::Weapon)?;
        Ok(object_of([
            ("exports", Value::Array(vec![dump])),
            ("rules", Value::from(present)),
            ("sheets", Value::Object(sheets)),
        ]))
    }

    /// Сцена окружения: эффект-витрина для каждого семейства и его листы.
    fn environment(&self) -> Result<Value> {
        // Порция, которую не удалось выгрузить, молча пропускается.
        let batches: Vec<Value> = showcase_names()
            .chunks(EXPORT_BATCH)
            .filter_map(|chunk| export_of(self.resource, chunk).ok())
            .collect();
        if batches.is_empty() {
            return Ok(Value::Null);
        }
        let dumps = Dumps(&batches);
        let picks: Vec<(&str, &str)> = FAMILIES
            .iter()
            .filter_map(|family| Some((family.id, showcase_for(&dumps, family)?)))
            .collect();
        let chosen = first_seen(picks.iter().map(|&(_, effect)| effect));
        let needed = first_seen(chosen.iter().flat_map(|effect| dumps.sheets_of(effect)));
        let sheets = self.gather(&needed, SheetKind::Environment)?;
        let picked: Map<String, Value> = picks
            .into_iter()
            .map(|(family, effect)| (family.to_owned(), Value::from(effect)))
            .collect();
        Ok(object_of([
            ("exports", Value::Array(batches)),
            ("picks", Value::Object(picked)),
            ("sheets", Value::Object(sheets)),
        ]))
    }
}

#[cfg(test)]
mod tests;
