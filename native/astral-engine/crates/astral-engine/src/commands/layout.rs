//! `compile-interior-layout`: карта `.ymap` с безопасными предметами внутри
//! известного торгового зала.
//!
//! Запрос задаёт предметы в локальной системе помещения. Команда проверяет
//! запрос строго (лишние ключи отказывают), переводит положение и поворот в мир,
//! проверяет размещение, строит карту писателем расстановки, перечитывает её,
//! сверяет с ожиданием и только потом пишет файл. Вся арифметика — во `f32`
//! в том порядке действий, который описан у каждой функции.
//!
//! Порядок стадий: найти файлы → прочитать запрос → составить план → собрать
//! карту → записать. Каталог выхода создаётся на первой стадии и остаётся при
//! любом дальнейшем отказе.

use std::collections::BTreeSet;
use std::fs;
use std::ops::RangeInclusive;
use std::path::PathBuf;

use crate::args::Options;
use crate::error::{EngineError, Result};
use crate::paths;
use crate::progress::Progress;
use rage_res as res;
use serde_json::{self as sj, json};

use super::fresh_dirs::FreshDirs;
use super::{shop::write_atomic, Command};

type Json = sj::Value;
type Object = sj::Map<String, Json>;
type Vec3 = [f32; 3];
type Quat = [f32; 4];

pub const COMMANDS: &[Command] = &[Command::new(
    "compile-interior-layout",
    compile_interior_layout,
)];

pub fn compile_interior_layout(options: &Options, _progress: &Progress) -> Result<Json> {
    let fresh = FreshDirs::beside(options.required("output"));
    let files = Files::resolve(options)?;
    let plan = Plan::parse(&files.read_request()?)?;
    let map = plan.build_map()?;
    files.store(&map)?;
    fresh.keep();
    Ok(plan.summary(&files, &map))
}

// ---------------------------------------------------------------------------
// Файлы команды.
// ---------------------------------------------------------------------------

/// Вход и выход команды: вход проверяется первым, каталог выхода создаётся сразу.
struct Files {
    input: PathBuf,
    output: PathBuf,
}

impl Files {
    fn resolve(options: &Options) -> Result<Self> {
        let input = options.required("input")?;
        let input = paths::existing_file(input, &[".json"])?;
        let output = options.required("output")?;
        let output = paths::output_file(output, &[".ymap"])?;
        Ok(Self { input, output })
    }

    /// Размер смотрится по метаданным до чтения; любая ошибка JSON называется одинаково.
    fn read_request(&self) -> Result<Json> {
        let size = fs::metadata(&self.input)?.len();
        if size == 0 || size > limits::REQUEST_BYTES {
            return Err(invalid(
                "Compile request must be between 1 byte and 512 KiB.",
            ));
        }
        let bytes = fs::read(&self.input)?;
        sj::from_slice(&bytes).map_err(|_| invalid("Compile request is empty."))
    }

    /// Каталог создаётся ещё раз; файл пишется через черновик рядом.
    fn store(&self, map: &[u8]) -> Result<()> {
        if let Some(parent) = self.output.parent() {
            fs::create_dir_all(parent)?;
        }
        write_atomic(&self.output, map)
    }
}

fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

// ---------------------------------------------------------------------------
// Читатель полей запроса.
// ---------------------------------------------------------------------------

/// Наборы допустимых ключей: корень запроса, `destination`, предмет.
#[derive(Clone, Copy)]
enum KeySet {
    Root,
    Destination,
    Entity,
}

impl KeySet {
    const fn names(self) -> &'static [&'static str] {
        match self {
            KeySet::Root => &[
                "blockers",
                "eligible",
                "destination",
                "entities",
                "catalogRevision",
                "templateRef",
                "locationId",
                "designHash",
                "targetId",
                "version",
                "format",
            ],
            KeySet::Destination => &["entry", "container", "atomicSlot"],
            KeySet::Entity => &["rotation", "position", "propId", "id"],
        }
    }
}

/// Объект запроса с уже проверенным составом ключей.
#[derive(Clone, Copy)]
struct Fields<'a>(&'a Object);

impl<'a> Fields<'a> {
    /// Не объект — отказ с `refusal`; затем один проход по ключам в порядке
    /// файла: первый лишний называется в отказе.
    fn open(raw: Option<&'a Json>, set: KeySet, refusal: &str) -> Result<Self> {
        let object = raw
            .and_then(Json::as_object)
            .ok_or_else(|| invalid(refusal))?;
        object.keys().try_for_each(|key| {
            if set.names().contains(&key.as_str()) {
                Ok(())
            } else {
                Err(invalid(format!(
                    "The JSON property '{key}' is not allowed."
                )))
            }
        })?;
        Ok(Self(object))
    }

    fn raw(&self, key: &str) -> Option<&'a Json> {
        self.0.get(key)
    }

    /// Обязательная строка.
    fn text(&self, key: &str) -> Result<&'a str> {
        self.raw(key)
            .and_then(Json::as_str)
            .ok_or_else(|| invalid(format!("{key} must be a string.")))
    }

    /// Обязательная строка, обязанная равняться образцу.
    fn text_equal_to(&self, key: &str, wanted: &str, refusal: &str) -> Result<&'a str> {
        let found = self.text(key)?;
        if found == wanted {
            Ok(found)
        } else {
            Err(invalid(refusal))
        }
    }

    /// Массив, длина которого обязана лежать в `span`.
    fn list(&self, key: &str, span: RangeInclusive<usize>, refusal: &str) -> Result<&'a [Json]> {
        self.raw(key)
            .and_then(Json::as_array)
            .map(Vec::as_slice)
            .filter(|items| span.contains(&items.len()))
            .ok_or_else(|| invalid(refusal))
    }

    /// Числа по осям (`f32`, конечные); нет оси или она не число — `None`.
    fn axes<const N: usize>(&self, key: &str, names: [&str; N]) -> Option<[f32; N]> {
        let object = self.raw(key)?.as_object()?;
        let mut out = [0.0f32; N];
        for (slot, name) in out.iter_mut().zip(names) {
            let value = object.get(name)?.as_f64()? as f32;
            if !value.is_finite() {
                return None;
            }
            *slot = value;
        }
        Some(out)
    }
}

// ---------------------------------------------------------------------------
// План: разбор запроса по стадиям.
// ---------------------------------------------------------------------------

/// Разобранный запрос: место, хеш замысла и предметы.
struct Plan {
    site: &'static Site,
    design_hash: String,
    items: Vec<Item>,
}

/// Предмет запроса после всех проверок.
struct Item {
    id: String,
    prop: &'static Prop,
    /// Мировое положение, мировая и хранимая ориентация.
    world: Vec3,
    orientation: Quat,
    stored: Quat,
}

impl Plan {
    fn parse(root: &Json) -> Result<Self> {
        let fields = Fields::open(Some(root), KeySet::Root, "request must be an object.")?;
        check_contract(&fields)?;
        let (design_hash, site) = read_header(&fields)?;
        let raw_items = fields.list(
            "entities",
            1..=limits::ENTITIES,
            "Compile request must contain between 1 and 128 entities.",
        )?;
        let destination = Destination::open(&fields, site)?;
        let items = Item::parse_all(raw_items, site)?;
        // Имя записи сверяется после предметов: их ошибка важнее.
        destination.check_entry(site)?;
        Ok(Self {
            site,
            design_hash: design_hash.to_owned(),
            items,
        })
    }

    fn map_name(&self) -> String {
        self.site.map_name()
    }

    /// Ответ команды: пути, сведения о карте и поза каждого предмета.
    fn summary(&self, files: &Files, map: &[u8]) -> Json {
        json!({
            "input": files.input.to_string_lossy(),
            "output": files.output.to_string_lossy(),
            "designHash": self.design_hash,
            "locationId": self.site.id,
            "mapName": self.map_name(),
            "entityCount": self.items.len(),
            "bytes": map.len(),
            "sha256": res::hash::sha256_hex(map),
            "semanticReopen": true,
            "deterministic": true,
            "entities": self.items.iter().map(Item::report).collect::<Vec<_>>(),
        })
    }
}

/// Формат, версия и цель: сначала формат как строка, затем всё вместе.
fn check_contract(fields: &Fields) -> Result<()> {
    let format_ok = fields.text("format")? == labels::FORMAT;
    let version_ok = fields.raw("version").and_then(Json::as_i64) == Some(1);
    if !(format_ok && version_ok) {
        return Err(invalid("Unsupported interior compile contract."));
    }
    fields.text_equal_to(
        "targetId",
        labels::TARGET,
        "Only the GTA V Legacy Story target is supported.",
    )?;
    Ok(())
}

/// Хеш замысла, место и редакция каталога — в таком порядке.
fn read_header<'a>(fields: &Fields<'a>) -> Result<(&'a str, &'static Site)> {
    let design_hash = fields.text("designHash")?;
    if !is_design_hash(design_hash) {
        return Err(invalid("designHash is invalid."));
    }
    let location = fields.text("locationId")?;
    let site = SITES
        .iter()
        .find(|site| site.id == location)
        .ok_or_else(|| invalid("Location is not in the compiled build-scoped registry."))?;
    fields.text_equal_to(
        "catalogRevision",
        labels::CATALOG_REVISION,
        "Catalog revision does not match this compiler.",
    )?;
    Ok((design_hash, site))
}

/// `sha256:` и ровно 64 строчные шестнадцатеричные цифры.
fn is_design_hash(value: &str) -> bool {
    let lower_hex = |b: &u8| matches!(b, b'0'..=b'9' | b'a'..=b'f');
    value
        .strip_prefix(labels::DESIGN_PREFIX)
        .is_some_and(|digits| digits.len() == 64 && digits.bytes().all(|b| lower_hex(&b)))
}

/// Назначение: контейнер и слот проверяются сразу, запись — после предметов.
struct Destination<'a> {
    fields: Fields<'a>,
}

impl<'a> Destination<'a> {
    fn open(root: &Fields<'a>, site: &Site) -> Result<Self> {
        let fields = Fields::open(
            root.raw("destination"),
            KeySet::Destination,
            "destination must be an object.",
        )?;
        // Контейнер раньше слота; при чужом контейнере слот не читается.
        let outside = || invalid("Destination is outside the managed interior location slot.");
        if fields.text("container")? != labels::CONTAINER {
            return Err(outside());
        }
        if fields.text("atomicSlot")? != format!("interior-location-{}", site.id) {
            return Err(outside());
        }
        Ok(Self { fields })
    }

    fn check_entry(&self, site: &Site) -> Result<()> {
        self.fields.text_equal_to(
            "entry",
            &format!("{}.ymap", site.map_name()),
            "Destination entry does not match the location-derived YMAP name.",
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Предметы: черновик, уникальность, размещение.
// ---------------------------------------------------------------------------

/// Идентификаторы, уже занятые предыдущими предметами запроса.
#[derive(Default)]
struct Registry {
    taken: BTreeSet<String>,
}

impl Registry {
    fn claim(&mut self, id: &str) -> Result<()> {
        if self.taken.insert(id.to_owned()) {
            Ok(())
        } else {
            Err(invalid(format!("Duplicate entity id: {id}")))
        }
    }
}

/// Запись предмета до проверок содержимого: известен номер и годный идентификатор.
struct Draft<'a> {
    index: usize,
    id: &'a str,
    fields: Fields<'a>,
}

impl<'a> Draft<'a> {
    fn read(index: usize, raw: &'a Json) -> Result<Self> {
        let fields = Fields::open(Some(raw), KeySet::Entity, "entity must be an object.")?;
        let id = fields.text("id")?;
        if !is_entity_id(id) {
            return Err(invalid(format!("entities[{index}].id is invalid.")));
        }
        Ok(Self { index, id, fields })
    }

    fn prop(&self) -> Result<&'static Prop> {
        let wanted = self.fields.text("propId")?;
        PROPS
            .iter()
            .find(|prop| prop.id == wanted)
            .ok_or_else(|| invalid(format!("Unknown safe propId: {wanted}")))
    }

    fn position(&self) -> Result<Vec3> {
        let within =
            |p: &Vec3| p[0].abs() <= 100.0 && p[1].abs() <= 100.0 && (-10.0..=20.0).contains(&p[2]);
        self.fields
            .axes("position", ["x", "y", "z"])
            .filter(within)
            .ok_or_else(|| {
                invalid(format!(
                    "entities[{}].position is not finite or bounded.",
                    self.index
                ))
            })
    }

    fn rotation(&self) -> Result<Quat> {
        let rotation = self
            .fields
            .axes("rotation", ["x", "y", "z", "w"])
            .ok_or_else(|| invalid(format!("entities[{}].rotation is invalid.", self.index)))?;
        let (low, high) = limits::ROTATION_LENGTH;
        let length = quat::length(rotation);
        if length < low || length > high {
            return Err(invalid(format!(
                "entities[{}].rotation must be normalized.",
                self.index
            )));
        }
        Ok(rotation)
    }

    /// Остальные проверки по порядку: предмет, положение, поворот, размещение.
    fn resolve(self, site: &'static Site) -> Result<Item> {
        let prop = self.prop()?;
        let position = self.position()?;
        let rotation = self.rotation()?;
        if let Some(refusal) = placement(site, prop, position, rotation).refusal(self.index) {
            return Err(refusal);
        }
        let (world, orientation, stored) = world_pose(site, prop, position, rotation);
        Ok(Item {
            id: self.id.to_owned(),
            prop,
            world,
            orientation,
            stored,
        })
    }
}

impl Item {
    /// Предметы по порядку: черновик, затем уникальность, затем остальное.
    fn parse_all(raw_items: &[Json], site: &'static Site) -> Result<Vec<Item>> {
        let mut registry = Registry::default();
        raw_items
            .iter()
            .enumerate()
            .map(|(index, raw)| {
                let draft = Draft::read(index, raw)?;
                registry.claim(draft.id)?;
                draft.resolve(site)
            })
            .collect()
    }

    fn report(&self) -> Json {
        let wide = |value: f32| f64::from(value);
        let [x, y, z] = self.world;
        let [qx, qy, qz, qw] = self.orientation;
        json!({
            "id": self.id,
            "archetype": self.prop.archetype,
            "archetypeHash": format!("0x{:08x}", res::hash::joaat(self.prop.archetype)),
            "position": { "x": wide(x), "y": wide(y), "z": wide(z) },
            "orientation": { "x": wide(qx), "y": wide(qy), "z": wide(qz), "w": wide(qw) },
        })
    }
}

/// Идентификатор предмета: 1…96 байт, первый — строчная латинская буква или цифра,
/// остальные — они же и `.`, `_`, `:`, `-`.
fn is_entity_id(id: &str) -> bool {
    let plain = |b: &u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    match id.as_bytes() {
        [head, tail @ ..] if id.len() <= limits::ID_BYTES => {
            plain(head) && tail.iter().all(|b| plain(b) || b".:_-".contains(b))
        }
        _ => false,
    }
}

/// Мировое положение, мировая ориентация и хранимый поворот предмета.
fn world_pose(site: &Site, prop: &Prop, position: Vec3, rotation: Quat) -> (Vec3, Quat, Quat) {
    // Предмет поднимается так, чтобы его низ стоял на заданной высоте.
    let local = [position[0], position[1], position[2] - prop.bounds.0[2]];
    let shift = quat::rotate(site.orientation, local);
    let world = std::array::from_fn(|axis| site.position[axis] + shift[axis]);
    let local_turn = quat::normalize(rotation);
    let orientation = quat::normalize(quat::product(site.orientation, local_turn));
    let stored = quat::normalize(quat::inverse(orientation));
    (world, orientation, stored)
}

/// Исход проверки размещения.
enum Placement {
    Clear,
    OutsideRoom,
    BlocksEntrance,
}

impl Placement {
    fn refusal(&self, index: usize) -> Option<EngineError> {
        match self {
            Placement::Clear => None,
            Placement::OutsideRoom => Some(invalid(format!(
                "entities[{index}] is outside the verified trading-room bounds."
            ))),
            Placement::BlocksEntrance => Some(invalid(format!(
                "entities[{index}] blocks the verified entrance portal."
            ))),
        }
    }
}

/// Размещение по положению запроса и повороту вокруг вертикали: след предмета,
/// повёрнутый на `yaw`, обязан лежать в комнате и не задевать вход (плоско).
fn placement(site: &Site, prop: &Prop, p: Vec3, q: Quat) -> Placement {
    let yaw = (2.0 * (q[3] * q[2] + q[0] * q[1])).atan2(1.0 - 2.0 * (q[1] * q[1] + q[2] * q[2]));
    let (width, depth) = prop.footprint_size();
    let (sin, cos) = (yaw.sin().abs(), yaw.cos().abs());
    let turned = (cos * width + sin * depth, sin * width + cos * depth);
    let (x1, x2) = (p[0] - turned.0 / 2.0, p[0] + turned.0 / 2.0);
    let (y1, y2) = (p[1] - turned.1 / 2.0, p[1] + turned.1 / 2.0);
    let top = p[2] + (prop.bounds.1[2] - prop.bounds.0[2]);

    let (room_min, room_max) = site.room;
    let leaves_room = [
        x1 < room_min[0],
        x2 > room_max[0],
        y1 < room_min[1],
        y2 > room_max[1],
        p[2] < 0.0,
        top > room_max[2],
    ];
    if leaves_room.contains(&true) {
        return Placement::OutsideRoom;
    }
    let [left, right, bottom, upper] = site.entrance;
    if x1 < right && x2 > left && y1 < upper && y2 > bottom {
        Placement::BlocksEntrance
    } else {
        Placement::Clear
    }
}

// ---------------------------------------------------------------------------
// Сборка карты и перечитывание.
// ---------------------------------------------------------------------------

impl Plan {
    /// Карта: сборка, предел размера, перечитывание и вторая сборка для сравнения.
    fn build_map(&self) -> Result<Vec<u8>> {
        let (archetypes, specs) = self.specs();
        let name = self.map_name();
        let compile = || {
            res::placements::compile_map(
                &name,
                &archetypes,
                &specs,
                labels::EXPORTED_BY,
                labels::EXPORTED_AT,
            )
        };
        let map = compile()?;
        if map.is_empty() || map.len() > limits::MAP_BYTES {
            return Err(invalid("Compiled YMAP exceeded the 1 MiB artifact limit."));
        }
        self.reopen(&map)?;
        if compile()? != map {
            return Err(invalid("Compiler output is not byte-deterministic."));
        }
        Ok(map)
    }

    /// Архетипы в порядке первого появления и сущности со ссылкой на номер.
    fn specs(
        &self,
    ) -> (
        Vec<res::placements::ArchetypeSpec>,
        Vec<res::placements::EntitySpec>,
    ) {
        let mut order: Vec<&'static Prop> = Vec::new();
        let mut slot_of = |prop: &'static Prop| {
            order
                .iter()
                .position(|known| std::ptr::eq(*known, prop))
                .unwrap_or_else(|| {
                    order.push(prop);
                    order.len() - 1
                })
        };
        let specs = self
            .items
            .iter()
            .map(|item| res::placements::EntitySpec {
                archetype: slot_of(item.prop),
                position: item.world,
                rotation: item.stored,
                lod_dist: item.prop.lod,
                flags: limits::ENTITY_FLAGS,
                guid: Some(res::hash::joaat(&format!(
                    "{}:{}",
                    self.design_hash, item.id
                ))),
            })
            .collect();
        let archetypes = order
            .into_iter()
            .map(|prop| res::placements::ArchetypeSpec {
                name: prop.archetype.to_owned(),
                lod_dist: prop.lod,
                bb_min: prop.bounds.0,
                bb_max: prop.bounds.1,
                flags: 0,
                clip_dictionary: None,
            })
            .collect();
        (archetypes, specs)
    }

    /// Записанные байты читаются заново и сверяются с ожиданием.
    fn reopen(&self, map: &[u8]) -> Result<()> {
        let graph = res::meta_graph::read(map)?;
        let reopened = res::mlo::read_ymap(&graph)?;
        if reopened.entities.len() != self.items.len() {
            return Err(invalid("Semantic reopen entity count mismatch."));
        }
        let drifted = self
            .items
            .iter()
            .zip(&reopened.entities)
            .find(|(item, found)| drifts(item, found));
        match drifted {
            Some((item, _)) => Err(invalid(format!(
                "Semantic reopen mismatch at entity {}.",
                item.id
            ))),
            None => Ok(()),
        }
    }
}

/// Предмет и его запись в карте расходятся: другой архетип, сдвиг больше допуска
/// или поворот дальше допуска. Отказ — когда величина строго больше допуска:
/// NaN (скалярное произведение чуть больше единицы) отказом не считается.
fn drifts(item: &Item, found: &res::mlo::CEntity) -> bool {
    let reopened_turn = res::placements::invert(found.rotation);
    found.archetype_hash != res::hash::joaat(item.prop.archetype)
        || distance(found.position, item.world) > limits::POSITION_TOLERANCE
        || angle_degrees(item.orientation, reopened_turn) > limits::ANGLE_TOLERANCE_DEGREES
}

// ---------------------------------------------------------------------------
// Места и предметы: таблицы строк и их сборка.
// ---------------------------------------------------------------------------

/// Зал: рамка комнаты (нижний и верхний угол) и вход
/// (левый и правый край по `x`, нижний и верхний по `y`), локальные координаты.
type Hall = ((Vec3, Vec3), [f32; 4]);

const SHOP_HALL: Hall = (
    (
        [-2.4835482, -5.576018, -0.002836],
        [9.024524, 1.9359231, 3.556323],
    ),
    [0.15, 3.65, -5.75, -4.65],
);
const GAS_HALL: Hall = (
    (
        [-3.8673806, -5.625234, -0.01788],
        [10.603222, 2.768371, 3.556324],
    ),
    [0.15, 3.75, -5.75, -4.6],
);

/// Строка таблицы мест: идентификатор, положение в мире, ориентация, зал.
type SiteRow = (&'static str, Vec3, Quat, Hall);

const SITE_ROWS: [SiteRow; 4] = [
    (
        "shop-247-sc1-03",
        [27.248524, -1343.679, 28.49696],
        [0.0, 0.0, 0.0, 1.0],
        SHOP_HALL,
    ),
    (
        "shop-247-cs2-11",
        [1731.9592, 6417.2437, 34.03717],
        [0.0, 0.0, -0.22800407, 0.9736602],
        SHOP_HALL,
    ),
    (
        "gasstation-sc1-21",
        [-50.868835, -1751.0383, 28.420937],
        [0.0, 0.0, -0.34213108, 0.9396522],
        GAS_HALL,
    ),
    (
        "gasstation-id2-21-b",
        [1156.7665, -321.44058, 68.20503],
        [0.0, 0.0, 0.08715597, 0.9961947],
        GAS_HALL,
    ),
];

/// Торговый зал: где он в мире и какая у него комната и вход.
#[derive(Clone, Copy)]
struct Site {
    id: &'static str,
    position: Vec3,
    orientation: Quat,
    room: (Vec3, Vec3),
    entrance: [f32; 4],
}

impl Site {
    const BLANK: Site = Site::from_row(("", [0.0; 3], [0.0; 4], (([0.0; 3], [0.0; 3]), [0.0; 4])));

    const fn from_row(row: SiteRow) -> Self {
        let (id, position, orientation, (room, entrance)) = row;
        Self {
            id,
            position,
            orientation,
            room,
            entrance,
        }
    }

    fn map_name(&self) -> String {
        format!("astral_int_{}", self.id.replace('-', "_"))
    }
}

const fn sites_from(rows: [SiteRow; 4]) -> [Site; 4] {
    let mut out = [Site::BLANK; 4];
    let mut at = 0;
    while at < rows.len() {
        out[at] = Site::from_row(rows[at]);
        at += 1;
    }
    out
}

static SITES: [Site; 4] = sites_from(SITE_ROWS);

/// Строка таблицы предметов: идентификатор, архетип, рамка модели, дальность,
/// след для проверки размещения (нули — брать из рамки).
type PropRow = (&'static str, &'static str, (Vec3, Vec3), f32, (f32, f32));

const PROP_ROWS: [PropRow; 5] = [
    (
        "vending-drink",
        "prop_vend_soda_01",
        (
            [-0.503182, -0.473903, -0.952678],
            [0.501645, 0.460195, 0.952574],
        ),
        60.0,
        (0.0, 0.0),
    ),
    (
        "vending-drink-blue",
        "prop_vend_soda_02",
        (
            [-0.502413, -0.473212, -0.952626],
            [0.502414, 0.473211, 0.952626],
        ),
        60.0,
        (0.0, 0.0),
    ),
    (
        "trash-bin",
        "prop_bin_05a",
        (
            [-0.389632, -0.389632, -0.037213],
            [0.389632, 0.389632, 1.018021],
        ),
        50.0,
        (0.0, 0.0),
    ),
    (
        "plant-pot",
        "prop_plant_int_01a",
        ([-1.8, -1.8, 0.0], [1.8, 1.8, 1.955277]),
        45.0,
        (0.961914, 0.998535),
    ),
    (
        "cooler-single",
        "prop_bar_fridge_01",
        (
            [-0.418179, -0.299095, -0.01045],
            [0.41818, 0.299095, 2.161334],
        ),
        40.0,
        (0.0, 0.0),
    ),
];

/// Безопасный предмет.
#[derive(Clone, Copy)]
struct Prop {
    id: &'static str,
    archetype: &'static str,
    bounds: (Vec3, Vec3),
    lod: f32,
    footprint: (f32, f32),
}

impl Prop {
    const BLANK: Prop = Prop::from_row(("", "", ([0.0; 3], [0.0; 3]), 0.0, (0.0, 0.0)));

    const fn from_row(row: PropRow) -> Self {
        let (id, archetype, bounds, lod, footprint) = row;
        Self {
            id,
            archetype,
            bounds,
            lod,
            footprint,
        }
    }

    /// Ширина и глубина следа: заданные или, если ноль, размеры рамки.
    fn footprint_size(&self) -> (f32, f32) {
        let (min, max) = self.bounds;
        let (width, depth) = self.footprint;
        (
            if width > 0.0 { width } else { max[0] - min[0] },
            if depth > 0.0 { depth } else { max[1] - min[1] },
        )
    }
}

const fn props_from(rows: [PropRow; 5]) -> [Prop; 5] {
    let mut out = [Prop::BLANK; 5];
    let mut at = 0;
    while at < rows.len() {
        out[at] = Prop::from_row(rows[at]);
        at += 1;
    }
    out
}

static PROPS: [Prop; 5] = props_from(PROP_ROWS);

// ---------------------------------------------------------------------------
// Арифметика кватернионов `[x, y, z, w]` (всё во `f32`, порядок действий важен).
// ---------------------------------------------------------------------------

/// Сумма слева направо: первое слагаемое — начальное значение (знак нуля сохраняется).
fn ordered_sum(terms: impl Iterator<Item = f32>) -> f32 {
    terms.reduce(|total, term| total + term).unwrap_or(0.0)
}

fn distance(a: Vec3, b: Vec3) -> f32 {
    ordered_sum(a.iter().zip(b).map(|(from, to)| (from - to) * (from - to))).sqrt()
}

/// Угол между двумя поворотами в градусах: `2·acos(|скалярное произведение|)`.
fn angle_degrees(a: Quat, b: Quat) -> f32 {
    2.0 * quat::dot(a, b).abs().acos() * 180.0 / std::f32::consts::PI
}

mod quat {
    use super::{ordered_sum, Quat, Vec3};

    /// Скалярное произведение: четыре произведения подряд.
    pub(super) fn dot(a: Quat, b: Quat) -> f32 {
        ordered_sum(a.iter().zip(b).map(|(x, y)| x * y))
    }

    pub(super) fn length(v: Quat) -> f32 {
        dot(v, v).sqrt()
    }

    /// Нулевой кватернион остаётся как есть.
    pub(super) fn normalize(v: Quat) -> Quat {
        let len = length(v);
        if len == 0.0 {
            return v;
        }
        let inv = 1.0 / len;
        v.map(|part| part * inv)
    }

    /// Обратный кватернион; отрицание берётся до умножения, поэтому у нулевых
    /// компонент выходит `-0.0`. Сокращения для единичного нет.
    pub(super) fn inverse(v: Quat) -> Quat {
        let scale = 1.0 / dot(v, v);
        [
            (-v[0]) * scale,
            (-v[1]) * scale,
            (-v[2]) * scale,
            v[3] * scale,
        ]
    }

    /// Произведение Гамильтона: `a` — поворот помещения, `b` — поворот предмета.
    pub(super) fn product(a: Quat, b: Quat) -> Quat {
        let [ax, ay, az, aw] = a;
        let [bx, by, bz, bw] = b;
        [
            ((aw * bx + ax * bw) + ay * bz) - az * by,
            ((aw * by - ax * bz) + ay * bw) + az * bx,
            ((aw * bz + ax * by) - ay * bx) + az * bw,
            ((aw * bw - ax * bx) - ay * by) - az * bz,
        ]
    }

    /// Попарные произведения компонент с удвоенными осями.
    struct Pairs {
        xx: f32,
        yy: f32,
        zz: f32,
        xy: f32,
        xz: f32,
        yz: f32,
        wx: f32,
        wy: f32,
        wz: f32,
    }

    impl Pairs {
        fn of(a: Quat) -> Self {
            let [x, y, z, w] = a;
            let doubled = [x * 2.0, y * 2.0, z * 2.0];
            // Строка — множитель слева (x, y, z, w), столбец — удвоенная ось.
            let at = |left: f32, axis: usize| left * doubled[axis];
            Self {
                wx: at(w, 0),
                wy: at(w, 1),
                wz: at(w, 2),
                xx: at(x, 0),
                xy: at(x, 1),
                xz: at(x, 2),
                yy: at(y, 1),
                yz: at(y, 2),
                zz: at(z, 2),
            }
        }

        fn row_x(&self) -> Vec3 {
            [
                (1.0 - self.yy) - self.zz,
                self.xy - self.wz,
                self.xz + self.wy,
            ]
        }

        fn row_y(&self) -> Vec3 {
            [
                self.xy + self.wz,
                (1.0 - self.xx) - self.zz,
                self.yz - self.wx,
            ]
        }

        fn row_z(&self) -> Vec3 {
            [
                self.xz - self.wy,
                self.yz + self.wx,
                (1.0 - self.xx) - self.yy,
            ]
        }
    }

    /// Поворот вектора кватернионом `a`: строки матрицы 3×3 на вектор.
    pub(super) fn rotate(a: Quat, l: Vec3) -> Vec3 {
        let pairs = Pairs::of(a);
        let times = |row: Vec3| ordered_sum(l.iter().zip(row).map(|(part, factor)| part * factor));
        [
            times(pairs.row_x()),
            times(pairs.row_y()),
            times(pairs.row_z()),
        ]
    }
}

// ---------------------------------------------------------------------------
// Значения контракта по назначению.
// ---------------------------------------------------------------------------

mod labels {
    pub(super) const FORMAT: &str = "astral.compile-interior-layout";
    pub(super) const TARGET: &str = "gta5-legacy-story";
    pub(super) const CATALOG_REVISION: &str = "legacy-24129523-v1";
    pub(super) const CONTAINER: &str = "x64/astral/astral_maps.rpf";
    pub(super) const DESIGN_PREFIX: &str = "sha256:";
    pub(super) const EXPORTED_BY: &str = "Astral Interior Compiler 1";
    pub(super) const EXPORTED_AT: &str = "01 January 1970 00:00";
}

mod limits {
    pub(super) const ENTITIES: usize = 128;
    pub(super) const ID_BYTES: usize = 96;
    pub(super) const REQUEST_BYTES: u64 = 512 * 1024;
    pub(super) const MAP_BYTES: usize = 1 << 20;
    pub(super) const ENTITY_FLAGS: u32 = 0x18_0000;
    /// Длина поворота из запроса: от и до включительно.
    pub(super) const ROTATION_LENGTH: (f32, f32) = (0.999, 1.001);
    /// Допуск перечитывания: расстояние и угол в градусах.
    pub(super) const POSITION_TOLERANCE: f32 = 0.01;
    pub(super) const ANGLE_TOLERANCE_DEGREES: f32 = 0.1;
}

#[cfg(test)]
mod tests {
    use super::*;

    const DESIGN: &str = "sha256:ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34";

    fn destination(location: &str) -> Json {
        json!({
            "atomicSlot": format!("interior-location-{location}"),
            "container": labels::CONTAINER,
            "entry": format!("astral_int_{}.ymap", location.replace('-', "_")),
        })
    }

    fn base_entity() -> Json {
        json!({ "id": "bin-1", "propId": "trash-bin", "position": {"x":5,"y":-1,"z":0}, "rotation": {"x":0,"y":0,"z":0,"w":1} })
    }

    fn request(location: &str, entities: Vec<Json>) -> Json {
        json!({
            "format": labels::FORMAT, "version": 1, "targetId": labels::TARGET, "designHash": DESIGN,
            "locationId": location, "templateRef": "tpl-1", "catalogRevision": labels::CATALOG_REVISION,
            "entities": entities, "destination": destination(location), "eligible": true, "blockers": [],
        })
    }

    fn base() -> Json {
        request("shop-247-sc1-03", vec![base_entity()])
    }

    fn with(mut value: Json, key: &str, replacement: Json) -> Json {
        value[key] = replacement;
        value
    }

    fn without(mut value: Json, key: &str) -> Json {
        value.as_object_mut().unwrap().remove(key);
        value
    }

    fn refusal(value: &Json) -> String {
        let error = Plan::parse(value).err().expect("запрос должен отказать");
        assert_eq!(error.code, "InvalidDataException");
        error.message
    }

    fn entity_with(key: &str, replacement: Json) -> Json {
        with(base_entity(), key, replacement)
    }

    fn parse_with_entity(entity: Json) -> std::result::Result<Plan, String> {
        Plan::parse(&request("shop-247-sc1-03", vec![entity])).map_err(|e| e.message)
    }

    // --- контракт и порядок проверок ---

    #[test]
    fn base_request_parses() {
        let plan = Plan::parse(&base()).unwrap();
        assert_eq!(plan.map_name(), "astral_int_shop_247_sc1_03");
        assert_eq!(plan.items.len(), 1);
        for location in SITES.iter().map(|site| site.id) {
            Plan::parse(&request(location, vec![base_entity()]))
                .map(|_| ())
                .or_else(|e| {
                    // одна и та же корзина может не лечь в чужой зал: важно, что место известно
                    assert!(
                        e.message.contains("entities[0]"),
                        "{location}: {}",
                        e.message
                    );
                    Ok::<(), ()>(())
                })
                .unwrap();
        }
    }

    #[test]
    fn contract_refusals() {
        let cases: Vec<(Json, &str)> = vec![
            (json!([]), "request must be an object."),
            (json!(null), "request must be an object."),
            (json!("x"), "request must be an object."),
            (json!(5), "request must be an object."),
            (
                with(base(), "extra", json!(1)),
                "The JSON property 'extra' is not allowed.",
            ),
            (
                with(without(base(), "format"), "Format", json!(labels::FORMAT)),
                "The JSON property 'Format' is not allowed.",
            ),
            (json!({}), "format must be a string."),
            (without(base(), "format"), "format must be a string."),
            (with(base(), "format", json!(5)), "format must be a string."),
            (
                with(base(), "format", json!("Astral.Compile-Interior-Layout")),
                "Unsupported interior compile contract.",
            ),
            (
                with(base(), "format", json!("astral.compile-interior-layout2")),
                "Unsupported interior compile contract.",
            ),
            (
                with(base(), "version", json!(2)),
                "Unsupported interior compile contract.",
            ),
            (
                with(base(), "version", json!(0)),
                "Unsupported interior compile contract.",
            ),
            (
                with(base(), "version", json!("1")),
                "Unsupported interior compile contract.",
            ),
            (
                with(base(), "version", json!(1.0)),
                "Unsupported interior compile contract.",
            ),
            (
                without(base(), "version"),
                "Unsupported interior compile contract.",
            ),
            (
                without(with(base(), "targetId", json!("x")), "version"),
                "Unsupported interior compile contract.",
            ),
            (without(base(), "targetId"), "targetId must be a string."),
            (
                with(base(), "targetId", json!(1)),
                "targetId must be a string.",
            ),
            (
                with(base(), "targetId", json!("GTA5-Legacy-Story")),
                "Only the GTA V Legacy Story target is supported.",
            ),
            (
                with(base(), "targetId", json!("gta5-enhanced")),
                "Only the GTA V Legacy Story target is supported.",
            ),
            (
                without(base(), "designHash"),
                "designHash must be a string.",
            ),
            (
                with(base(), "designHash", json!(5)),
                "designHash must be a string.",
            ),
            (
                with(base(), "designHash", json!("")),
                "designHash is invalid.",
            ),
            (
                with(base(), "designHash", json!(DESIGN.replace("sha256:", ""))),
                "designHash is invalid.",
            ),
            (
                with(base(), "designHash", json!(DESIGN.to_uppercase())),
                "designHash is invalid.",
            ),
            (
                with(
                    base(),
                    "designHash",
                    json!(DESIGN.replace("sha256", "SHA256")),
                ),
                "designHash is invalid.",
            ),
            (
                with(base(), "designHash", json!(format!("{DESIGN} "))),
                "designHash is invalid.",
            ),
            (
                with(base(), "designHash", json!(&DESIGN[..DESIGN.len() - 1])),
                "designHash is invalid.",
            ),
            (
                with(base(), "designHash", json!(format!("{DESIGN}a"))),
                "designHash is invalid.",
            ),
            (
                with(
                    base(),
                    "designHash",
                    json!(format!("sha256:{}", "g".repeat(64))),
                ),
                "designHash is invalid.",
            ),
            (
                without(base(), "locationId"),
                "locationId must be a string.",
            ),
            (
                with(base(), "locationId", json!("Shop-247-sc1-03")),
                "Location is not in the compiled build-scoped registry.",
            ),
            (
                with(base(), "locationId", json!("shop-247-sc1-03 ")),
                "Location is not in the compiled build-scoped registry.",
            ),
            (
                with(base(), "locationId", json!("shop-247-xx")),
                "Location is not in the compiled build-scoped registry.",
            ),
            (
                without(base(), "catalogRevision"),
                "catalogRevision must be a string.",
            ),
            (
                with(base(), "catalogRevision", json!("legacy-24129523-v2")),
                "Catalog revision does not match this compiler.",
            ),
            (
                without(base(), "entities"),
                "Compile request must contain between 1 and 128 entities.",
            ),
            (
                with(base(), "entities", json!({})),
                "Compile request must contain between 1 and 128 entities.",
            ),
            (
                with(base(), "entities", json!([])),
                "Compile request must contain between 1 and 128 entities.",
            ),
            (
                with(base(), "entities", Json::Array(vec![base_entity(); 129])),
                "Compile request must contain between 1 and 128 entities.",
            ),
            (
                without(base(), "destination"),
                "destination must be an object.",
            ),
            (
                with(base(), "destination", json!(null)),
                "destination must be an object.",
            ),
            (
                with(base(), "destination", json!([])),
                "destination must be an object.",
            ),
        ];
        for (value, expected) in cases {
            assert_eq!(refusal(&value), expected, "{value}");
        }
    }

    #[test]
    fn order_of_checks_matches_the_description() {
        // ключ вне списка побеждает ошибку формата
        assert_eq!(
            refusal(&with(with(base(), "format", json!("x")), "extra", json!(1))),
            "The JSON property 'extra' is not allowed."
        );
        // имя ключа — первый по порядку в файле
        let first: Json = serde_json::from_str(r#"{"zzz":1,"aaa":2}"#).unwrap();
        assert_eq!(refusal(&first), "The JSON property 'zzz' is not allowed.");
        // дизайн раньше места, место раньше каталога, каталог раньше предметов
        let both = with(
            with(base(), "designHash", json!("bad")),
            "locationId",
            json!("nope"),
        );
        assert_eq!(refusal(&both), "designHash is invalid.");
        let location = with(
            with(base(), "locationId", json!("nope")),
            "catalogRevision",
            json!("x"),
        );
        assert_eq!(
            refusal(&location),
            "Location is not in the compiled build-scoped registry."
        );
        let catalog = with(
            with(base(), "catalogRevision", json!("x")),
            "entities",
            json!([]),
        );
        assert_eq!(
            refusal(&catalog),
            "Catalog revision does not match this compiler."
        );
        // предметы раньше назначения
        let entities_first = with(with(base(), "entities", json!([])), "destination", json!(5));
        assert_eq!(
            refusal(&entities_first),
            "Compile request must contain between 1 and 128 entities."
        );
        let bad_entity = with(base(), "entities", json!([entity_with("id", json!("BAD"))]));
        assert_eq!(
            refusal(&with(bad_entity.clone(), "destination", json!(5))),
            "destination must be an object."
        );
        // запись назначения сверяется после предметов
        let late = with(
            bad_entity,
            "destination",
            json!({ "atomicSlot": "interior-location-shop-247-sc1-03", "container": labels::CONTAINER, "entry": "other.ymap" }),
        );
        assert_eq!(refusal(&late), "entities[0].id is invalid.");
    }

    #[test]
    fn destination_refusals() {
        let outside = "Destination is outside the managed interior location slot.";
        let slot = "interior-location-shop-247-sc1-03";
        let entry = "astral_int_shop_247_sc1_03.ymap";
        let dest = |value: Json| with(base(), "destination", value);
        let cases: Vec<(Json, &str)> = vec![
            (
                json!({"atomicSlot": slot, "container": labels::CONTAINER, "entry": entry, "more": 1}),
                "The JSON property 'more' is not allowed.",
            ),
            (
                json!({"atomicSlot": slot, "container": "X64/astral/astral_maps.rpf", "entry": entry}),
                outside,
            ),
            (
                json!({"atomicSlot": slot, "container": "x64/astral/other.rpf", "entry": entry}),
                outside,
            ),
            (
                json!({"atomicSlot": slot, "entry": entry}),
                "container must be a string.",
            ),
            (
                json!({"atomicSlot": slot, "container": 5, "entry": entry}),
                "container must be a string.",
            ),
            (json!({"container": "x", "entry": entry}), outside),
            (
                json!({"container": labels::CONTAINER, "entry": entry}),
                "atomicSlot must be a string.",
            ),
            (
                json!({"atomicSlot": 5, "container": labels::CONTAINER, "entry": entry}),
                "atomicSlot must be a string.",
            ),
            (
                json!({"atomicSlot": "interior-location-shop-247-cs2-11", "container": labels::CONTAINER, "entry": entry}),
                outside,
            ),
            (
                json!({"atomicSlot": slot, "container": labels::CONTAINER}),
                "entry must be a string.",
            ),
            (
                json!({"atomicSlot": slot, "container": labels::CONTAINER, "entry": 5}),
                "entry must be a string.",
            ),
            (
                json!({"atomicSlot": slot, "container": labels::CONTAINER, "entry": "Astral_Int_Shop_247_Sc1_03.ymap"}),
                "Destination entry does not match the location-derived YMAP name.",
            ),
            (
                json!({"atomicSlot": slot, "container": labels::CONTAINER, "entry": "other.ymap"}),
                "Destination entry does not match the location-derived YMAP name.",
            ),
        ];
        for (value, expected) in cases {
            assert_eq!(refusal(&dest(value.clone())), expected, "{value}");
        }
        let gas = request(
            "gasstation-sc1-21",
            vec![entity_with("propId", json!("vending-drink"))],
        );
        let wrong_entry = with(
            gas,
            "destination",
            json!({"atomicSlot": "interior-location-gasstation-sc1-21", "container": labels::CONTAINER, "entry": entry}),
        );
        assert_eq!(
            refusal(&wrong_entry),
            "Destination entry does not match the location-derived YMAP name."
        );
    }

    // --- предметы ---

    #[test]
    fn entity_id_and_prop_refusals() {
        let bad = |entity: Json| parse_with_entity(entity).err().unwrap();
        assert_eq!(bad(json!("x")), "entity must be an object.");
        assert_eq!(bad(json!(null)), "entity must be an object.");
        assert_eq!(
            bad(with(base_entity(), "more", json!(1))),
            "The JSON property 'more' is not allowed."
        );
        assert_eq!(
            bad(with(entity_with("id", json!("BAD ID")), "more", json!(1))),
            "The JSON property 'more' is not allowed."
        );
        assert_eq!(bad(without(base_entity(), "id")), "id must be a string.");
        assert_eq!(bad(entity_with("id", json!(5))), "id must be a string.");
        for id in [
            "a@b", ":a", "бин", "-a", ".a", "", "a\nb", "a+b", "a/b", "a b", "_a", "Bin",
        ] {
            assert_eq!(
                bad(entity_with("id", json!(id))),
                "entities[0].id is invalid.",
                "{id:?}"
            );
        }
        assert_eq!(
            bad(entity_with("id", json!("x".repeat(97)))),
            "entities[0].id is invalid."
        );
        for id in [
            "9a".to_owned(),
            "x".repeat(96),
            "a.b_c:d-e".to_owned(),
            "0".to_owned(),
            "z9".to_owned(),
        ] {
            parse_with_entity(entity_with("id", json!(id))).unwrap();
        }
        assert_eq!(
            bad(without(base_entity(), "propId")),
            "propId must be a string."
        );
        assert_eq!(
            bad(entity_with("propId", json!(5))),
            "propId must be a string."
        );
        for prop in ["sofa", "Trash-Bin", "prop_bin_05a"] {
            assert_eq!(
                bad(entity_with("propId", json!(prop))),
                format!("Unknown safe propId: {prop}")
            );
        }
    }

    #[test]
    fn duplicates_and_indices_in_messages() {
        let item = |id: &str, prop: &str, x: f64, y: f64| json!({ "id": id, "propId": prop, "position": {"x": x, "y": y, "z": 0}, "rotation": {"x":0,"y":0,"z":0,"w":1} });
        let dup = request(
            "shop-247-sc1-03",
            vec![
                item("a", "trash-bin", 5.0, -1.0),
                item("a", "trash-bin", 5.0, -1.0),
            ],
        );
        assert_eq!(refusal(&dup), "Duplicate entity id: a");
        let dup_before_prop = request(
            "shop-247-sc1-03",
            vec![
                item("a", "trash-bin", 5.0, -1.0),
                item("a", "nope", 5.0, -1.0),
            ],
        );
        assert_eq!(refusal(&dup_before_prop), "Duplicate entity id: a");
        let case = request(
            "shop-247-sc1-03",
            vec![
                item("a", "trash-bin", 5.0, -1.0),
                item("A", "trash-bin", 5.0, -1.0),
            ],
        );
        assert_eq!(refusal(&case), "entities[1].id is invalid.");
        let third = request(
            "shop-247-sc1-03",
            vec![
                item("a", "trash-bin", 5.0, -1.0),
                item("b", "trash-bin", 5.0, -1.0),
                item("c", "trash-bin", 2.0, -5.0),
            ],
        );
        assert_eq!(
            refusal(&third),
            "entities[2] blocks the verified entrance portal."
        );
        let second = request(
            "shop-247-sc1-03",
            vec![
                item("a", "trash-bin", 5.0, -1.0),
                item("b", "trash-bin", 50.0, 50.0),
            ],
        );
        assert_eq!(
            refusal(&second),
            "entities[1] is outside the verified trading-room bounds."
        );
        let first_bad = request(
            "shop-247-sc1-03",
            vec![
                item("a", "trash-bin", 50.0, 50.0),
                item("B", "trash-bin", 5.0, -1.0),
            ],
        );
        assert_eq!(
            refusal(&first_bad),
            "entities[0] is outside the verified trading-room bounds."
        );
    }

    fn position_error(position: &str) -> Option<String> {
        let value: Json = serde_json::from_str(position).unwrap();
        parse_with_entity(entity_with("position", value)).err()
    }

    #[test]
    fn position_bounds_and_forms() {
        let refused = Some("entities[0].position is not finite or bounded.".to_owned());
        for bad in [
            "[5,-1,0]",
            "null",
            r#"{"y":-1,"z":0}"#,
            r#"{"x":5,"z":0}"#,
            r#"{"x":5,"y":-1}"#,
            r#"{"x":null,"y":-1,"z":0}"#,
            r#"{"x":5,"y":null,"z":0}"#,
            r#"{"x":5,"y":-1,"z":null}"#,
            r#"{"x":"a","y":"b","z":"c"}"#,
            r#"{"x":"1","y":-1,"z":0}"#,
            r#"{"x":1e39,"y":-1,"z":0}"#,
            r#"{"x":1e300,"y":-1,"z":0}"#,
            r#"{"x":100.0001,"y":-1,"z":0}"#,
            r#"{"x":-100.0001,"y":-1,"z":0}"#,
            r#"{"x":5,"y":100.0001,"z":0}"#,
            r#"{"x":5,"y":-1,"z":20.0001}"#,
            r#"{"x":5,"y":-1,"z":-10.0001}"#,
        ] {
            assert_eq!(position_error(bad), refused, "{bad}");
        }
        // границы включены, но дальше комната отказывает
        let room = Some("entities[0] is outside the verified trading-room bounds.".to_owned());
        for edge in [
            r#"{"x":100,"y":-1,"z":0}"#,
            r#"{"x":-100,"y":-1,"z":0}"#,
            r#"{"x":5,"y":-1,"z":20}"#,
            r#"{"x":5,"y":-1,"z":-10}"#,
            r#"{"x":100.0000001,"y":-1,"z":0}"#,
            r#"{"x":100.000001,"y":-1,"z":0}"#,
        ] {
            assert_eq!(position_error(edge), room, "{edge}");
        }
        assert_eq!(position_error(r#"{"x":5,"y":-1,"z":0,"extra":1}"#), None);
    }

    fn rotation_error(rotation: &str) -> Option<String> {
        let value: Json = serde_json::from_str(rotation).unwrap();
        parse_with_entity(entity_with("rotation", value)).err()
    }

    #[test]
    fn rotation_forms_and_length_window() {
        let invalid_rotation = Some("entities[0].rotation is invalid.".to_owned());
        for bad in [
            "[0,0,0,1]",
            "null",
            r#"{"x":0,"y":0,"z":0}"#,
            r#"{"y":0,"z":0,"w":1}"#,
            r#"{"x":0,"z":0,"w":1}"#,
            r#"{"x":0,"y":0,"w":1}"#,
            r#"{"x":0,"y":0,"z":0,"w":"1"}"#,
            r#"{"x":0,"y":0,"z":0,"w":1e39}"#,
        ] {
            assert_eq!(rotation_error(bad), invalid_rotation, "{bad}");
        }
        let unnormalized = Some("entities[0].rotation must be normalized.".to_owned());
        for w in ["0.998", "0.9989", "1.0011", "1.002", "0", "2"] {
            let text = format!(r#"{{"x":0,"y":0,"z":0,"w":{w}}}"#);
            assert_eq!(rotation_error(&text), unnormalized, "{w}");
        }
        for w in ["0.999", "0.9991", "1.0009", "1.001", "-1"] {
            let text = format!(r#"{{"x":0,"y":0,"z":0,"w":{w}}}"#);
            assert_eq!(rotation_error(&text), None, "{w}");
        }
        assert_eq!(rotation_error(r#"{"x":0,"y":0,"z":1,"w":0}"#), None);
        assert_eq!(rotation_error(r#"{"x":0,"y":0,"z":0,"w":1,"t":2}"#), None);
        // положение раньше поворота, поворот раньше размещения
        let both = json!({ "id": "bin-1", "propId": "trash-bin", "position": {"x":500,"y":0,"z":0}, "rotation": {"x":0,"y":0,"z":0,"w":2} });
        assert_eq!(
            parse_with_entity(both).err().unwrap(),
            "entities[0].position is not finite or bounded."
        );
        let rotation_first = json!({ "id": "bin-1", "propId": "trash-bin", "position": {"x":99,"y":99,"z":0}, "rotation": {"x":0,"y":0,"z":0,"w":2} });
        assert_eq!(
            parse_with_entity(rotation_first).err().unwrap(),
            "entities[0].rotation must be normalized."
        );
    }

    // --- размещение (серии границ из описания) ---

    fn verdict_at(location: &str, prop: &str, x: f32, y: f32, z: f32) -> char {
        let site = SITES.iter().find(|site| site.id == location).unwrap();
        let prop = PROPS.iter().find(|candidate| candidate.id == prop).unwrap();
        match placement(site, prop, [x, y, z], [0.0, 0.0, 0.0, 1.0]) {
            Placement::Clear => '1',
            Placement::OutsideRoom => '0',
            Placement::BlocksEntrance => 'E',
        }
    }

    /// Серия из 13 шагов по 0,0004 вокруг границы; значения считаются в `f64`
    /// (как их писал сборщик запросов) и приводятся к `f32` при чтении запроса.
    fn row(location: &str, prop_id: &str, axis: &str) -> String {
        let site = SITES.iter().find(|site| site.id == location).unwrap();
        let prop = PROPS.iter().find(|prop| prop.id == prop_id).unwrap();
        let wide = |value: f32| f64::from(value);
        let (min, max) = prop.bounds;
        let width = if prop.footprint.0 > 0.0 {
            wide(prop.footprint.0)
        } else {
            wide(max[0] - min[0])
        };
        let depth = if prop.footprint.1 > 0.0 {
            wide(prop.footprint.1)
        } else {
            wide(max[1] - min[1])
        };
        let height = wide(max[2] - min[2]);
        let (rmin, rmax) = site.room;
        let [left, right, bottom, upper] = site.entrance.map(wide);
        (-6..=6)
            .map(|step| {
                let d = f64::from(step) * 0.0004;
                let (mut x, mut y, mut z) = (5.0f64, -1.0f64, 0.25f64);
                match axis {
                    "x-min" => x = wide(rmin[0]) + width / 2.0 + d,
                    "x-max" => x = wide(rmax[0]) - width / 2.0 + d,
                    "y-max" => y = wide(rmax[1]) - depth / 2.0 + d,
                    "z-low" => z = d,
                    "z-top" => z = wide(rmax[2]) - height + d,
                    "entrance-x" => {
                        x = right + width / 2.0 + d;
                        y = (bottom + upper) / 2.0;
                    }
                    "entrance-y" => {
                        x = (left + right) / 2.0;
                        y = upper + depth / 2.0 + d;
                    }
                    _ => unreachable!(),
                }
                verdict_at(location, prop_id, x as f32, y as f32, z as f32)
            })
            .collect()
    }

    /// Таблица 5.6: по предмету семь серий в порядке
    /// `x-min x-max y-max z-low z-top вход-x вход-y`.
    const SERIES_AXES: [&str; 7] = [
        "x-min",
        "x-max",
        "y-max",
        "z-low",
        "z-top",
        "entrance-x",
        "entrance-y",
    ];

    #[test]
    fn boundary_series_match_the_description() {
        let expected: [(&str, &str, [&str; 7]); 10] = [
            (
                "shop-247-sc1-03",
                "vending-drink",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "0000000000000",
                    "EEEEEE1111111",
                ],
            ),
            (
                "shop-247-sc1-03",
                "vending-drink-blue",
                [
                    "0000001111111",
                    "1111110000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "0000000000000",
                    "EEEEEE1111111",
                ],
            ),
            (
                "shop-247-sc1-03",
                "trash-bin",
                [
                    "0000001111111",
                    "1111110000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "0000000000000",
                    "EEEEEE1111111",
                ],
            ),
            (
                "shop-247-sc1-03",
                "plant-pot",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "0000000000000",
                    "EEEEEE1111111",
                ],
            ),
            (
                "shop-247-sc1-03",
                "cooler-single",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "EEEEEE1111111",
                    "EEEEEE1111111",
                ],
            ),
            (
                "gasstation-sc1-21",
                "vending-drink",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "0000000000000",
                    "EEEEEE1111111",
                ],
            ),
            (
                "gasstation-sc1-21",
                "vending-drink-blue",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "0000000000000",
                    "EEEEEE1111111",
                ],
            ),
            (
                "gasstation-sc1-21",
                "trash-bin",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "EEEEEE1111111",
                    "EEEEEEE111111",
                ],
            ),
            (
                "gasstation-sc1-21",
                "plant-pot",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "0000000000000",
                    "EEEEEE1111111",
                ],
            ),
            (
                "gasstation-sc1-21",
                "cooler-single",
                [
                    "0000001111111",
                    "1111111000000",
                    "1111111000000",
                    "0000001111111",
                    "1111111000000",
                    "EEEEEE1111111",
                    "EEEEEEE111111",
                ],
            ),
        ];
        for (location, prop, series) in expected {
            for (axis, want) in SERIES_AXES.iter().zip(series) {
                let got = row(location, prop, axis);
                // Ровно на границе (шаг 0) ответ зависит от последнего знака в числах
                // сборщика запросов, поэтому этот шаг не сверяется.
                let differing: Vec<usize> = got
                    .chars()
                    .zip(want.chars())
                    .enumerate()
                    .filter(|(_, (a, b))| a != b)
                    .map(|(at, _)| at)
                    .collect();
                assert!(
                    got.len() == want.len() && differing.iter().all(|&at| at == 6),
                    "{location} {prop} {axis}: {got} вместо {want}"
                );
            }
        }
    }

    #[test]
    fn placement_examples_from_the_tables() {
        let v = |x: f32, y: f32| verdict_at("shop-247-sc1-03", "trash-bin", x, y, 0.0);
        assert_eq!(v(2.0, -5.0), 'E');
        assert_eq!(v(4.1, -5.0), '1');
        assert_eq!(v(2.0, -4.2), '1');
        assert_eq!(v(9.2, -1.0), '0');
        assert_eq!(v(-2.5, -1.0), '0');
        assert_eq!(v(5.0, 1.9), '0');
        assert_eq!(v(5.0, -5.7), '0');
        assert_eq!(
            verdict_at("shop-247-sc1-03", "trash-bin", 5.0, -1.0, -0.001),
            '0'
        );
        assert_eq!(
            verdict_at("shop-247-sc1-03", "trash-bin", 5.0, -1.0, 2.6),
            '0'
        );
        assert_eq!(
            verdict_at("gasstation-sc1-21", "trash-bin", 3.9, -4.65, 0.0),
            'E'
        );
        assert_eq!(
            verdict_at("gasstation-id2-21-b", "trash-bin", 10.7, -1.0, 0.0),
            '0'
        );
    }

    // --- арифметика: пример ответа из описания (пять предметов) ---

    fn five_props() -> Json {
        let item = |id: &str, prop: &str, x: f64, y: f64, z: f64, qz: f64, qw: f64| json!({ "id": id, "propId": prop, "position": {"x": x, "y": y, "z": z}, "rotation": {"x":0,"y":0,"z": qz,"w": qw} });
        request(
            "shop-247-sc1-03",
            vec![
                item("a", "vending-drink", 7.0, -4.0, 0.0, 0.0, 1.0),
                item("b", "vending-drink-blue", 7.0, -1.0, 0.5, 0.0, 1.0),
                item("c", "trash-bin", -1.0, -1.0, 0.0, 0.0, 1.0),
                item(
                    "d",
                    "plant-pot",
                    4.0,
                    0.5,
                    0.0,
                    0.25881904510252074,
                    0.9659258262890683,
                ),
                item(
                    "e",
                    "cooler-single",
                    2.0,
                    -2.0,
                    1.25,
                    0.9238795325112867,
                    0.38268343236508984,
                ),
            ],
        )
    }

    #[test]
    fn five_props_response_matches_the_description() {
        let plan = Plan::parse(&five_props()).unwrap();
        let reports: Vec<Json> = plan.items.iter().map(Item::report).collect();
        let expected: Json = serde_json::from_str(
            r#"[{"id":"a","archetype":"prop_vend_soda_01","archetypeHash":"0x3b21c5e7","position":{"x":34.2485237121582,"y":-1347.678955078125,"z":29.44963836669922},"orientation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0}},{"id":"b","archetype":"prop_vend_soda_02","archetypeHash":"0x426a547c","position":{"x":34.2485237121582,"y":-1344.678955078125,"z":29.9495849609375},"orientation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0}},{"id":"c","archetype":"prop_bin_05a","archetypeHash":"0x4f3fa437","position":{"x":26.248523712158203,"y":-1344.678955078125,"z":28.53417205810547},"orientation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0}},{"id":"d","archetype":"prop_plant_int_01a","archetypeHash":"0x1081fbdd","position":{"x":31.248523712158203,"y":-1343.178955078125,"z":28.496959686279297},"orientation":{"x":0.0,"y":0.0,"z":0.258819043636322,"w":0.9659258127212524}},{"id":"e","archetype":"prop_bar_fridge_01","archetypeHash":"0xe4b0ae85","position":{"x":29.248523712158203,"y":-1345.678955078125,"z":29.757410049438477},"orientation":{"x":0.0,"y":0.0,"z":0.9238795042037964,"w":0.3826834261417389}}]"#,
        )
        .unwrap();
        assert_eq!(Json::Array(reports.clone()), expected);
        // текст ответа: расширенные f32, нули и единицы с точкой
        let line = serde_json::to_string(&reports[0]).unwrap();
        assert!(
            line.contains(r#""orientation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0}"#),
            "{line}"
        );
    }

    #[test]
    fn stored_rotation_keeps_negative_zeros() {
        let plan = Plan::parse(&five_props()).unwrap();
        let stored = plan.items[0].stored;
        assert_eq!(
            [
                stored[0].to_bits(),
                stored[1].to_bits(),
                stored[2].to_bits(),
                stored[3].to_bits()
            ],
            [0x8000_0000, 0x8000_0000, 0x8000_0000, 1.0f32.to_bits()]
        );
        // а в ответе мировая ориентация без отрицательных нулей
        let report = plan.items[0].report();
        assert_eq!(report["orientation"]["x"].to_string(), "0.0");
    }

    #[test]
    fn yaw_series_world_pose_matches_the_description() {
        let site = "shop-247-cs2-11";
        let cases: [(f64, [f64; 2]); 6] = [
            (0.0, [-0.2280040681362152, 0.9736601710319519]),
            (60.0, [0.2893727719783783, 0.9572165012359619]),
            (120.0, [0.7292124032974243, 0.684287428855896]),
            (180.0, [0.9736601710319519, 0.2280040681362152]),
            (240.0, [0.9572165012359619, -0.2893727719783783]),
            (300.0, [0.684287428855896, -0.7292124032974243]),
        ];
        for (degrees, [z, w]) in cases {
            let half = degrees.to_radians() / 2.0;
            let entity = json!({
                "id": "t", "propId": "trash-bin", "position": {"x": 4, "y": -0.5, "z": 0.25},
                "rotation": {"x": 0, "y": 0, "z": half.sin(), "w": half.cos()},
            });
            let plan = Plan::parse(&request(site, vec![entity])).unwrap();
            let item = &plan.items[0];
            let report = item.report();
            assert_eq!(report["position"]["x"], 1735.3212890625);
            assert_eq!(report["position"]["y"], 6415.01953125);
            assert_eq!(report["position"]["z"], 34.32438278198242);
            assert_eq!(report["orientation"]["x"], 0.0);
            assert_eq!(report["orientation"]["y"], 0.0);
            assert_eq!(report["orientation"]["z"], z, "{degrees}");
            assert_eq!(report["orientation"]["w"], w, "{degrees}");
        }
    }

    /// Запросы из таблиц описания, которые принимаются целиком.
    #[test]
    fn accepted_examples_from_the_tables() {
        let pos = |x: f64, y: f64, z: f64| json!({ "x": x, "y": y, "z": z });
        let rot = |x: f64, y: f64, z: f64, w: f64| json!({ "x": x, "y": y, "z": z, "w": w });
        let item = |prop: &str, p: Json, r: Json| json!({ "id": "bin-1", "propId": prop, "position": p, "rotation": r });
        let cases: Vec<(&str, Json)> = vec![
            (
                "shop-247-cs2-11",
                item(
                    "vending-drink",
                    pos(6.0, -2.0, 0.2),
                    rot(
                        0.10259783520851543,
                        0.20519567041703085,
                        0.30779350562554625,
                        0.9233805168766388,
                    ),
                ),
            ),
            (
                "gasstation-sc1-21",
                item(
                    "cooler-single",
                    pos(3.0, 1.0, 0.0),
                    rot(0.0, 0.0, 0.6087614290087207, 0.7933533402912352),
                ),
            ),
            (
                "shop-247-sc1-03",
                item(
                    "trash-bin",
                    pos(8.55, -1.0, 0.0),
                    rot(0.5000000016387101, 0.0, 0.0, 0.8660254028383291),
                ),
            ),
            (
                "shop-247-sc1-03",
                item(
                    "cooler-single",
                    pos(3.0, -1.0, 1.0),
                    rot(
                        0.30779350562554625,
                        0.20519567041703085,
                        0.10259783520851543,
                        0.9233805168766388,
                    ),
                ),
            ),
            (
                "shop-247-sc1-03",
                item("trash-bin", pos(5.0, -1.0, 0.0), rot(0.0, 0.0, 1.0, 0.0)),
            ),
            (
                "shop-247-sc1-03",
                item("trash-bin", pos(5.0, -1.0, 0.0), rot(0.0, 0.0, 0.0, -1.0)),
            ),
            (
                "shop-247-sc1-03",
                item(
                    "trash-bin",
                    pos(5.0, -1.0, 0.0),
                    rot(0.7071067811865475, 0.0, 0.0, 0.7071067811865475),
                ),
            ),
            (
                "shop-247-sc1-03",
                item("trash-bin", pos(4.1, -5.0, 0.0), rot(0.0, 0.0, 0.0, 1.0)),
            ),
            (
                "shop-247-sc1-03",
                item("trash-bin", pos(2.0, -4.2, 0.0), rot(0.0, 0.0, 0.0, 1.0)),
            ),
            (
                "shop-247-sc1-03",
                item("trash-bin", pos(5.0, -1.0, 1.5), rot(0.0, 0.0, 0.0, 1.0)),
            ),
        ];
        for (location, entity) in cases {
            Plan::parse(&request(location, vec![entity.clone()]))
                .unwrap_or_else(|error| panic!("{location} {entity}: {}", error.message));
        }
        // 128 предметов, в том числе в одном месте
        let many: Vec<Json> = (0..128)
            .map(|index| {
                json!({ "id": format!("e{index}"), "propId": "trash-bin",
                        "position": {"x": 5, "y": -1, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0, "w": 1} })
            })
            .collect();
        assert_eq!(
            Plan::parse(&request("shop-247-sc1-03", many))
                .unwrap()
                .items
                .len(),
            128
        );
    }

    /// Серия поворотов: на каждом месте и у каждого предмета все 24 угла по 15° принимаются.
    #[test]
    fn every_yaw_step_is_accepted_everywhere() {
        for site in SITES.iter().map(|site| site.id) {
            for prop in PROPS.iter().map(|prop| prop.id) {
                for step in 0..24 {
                    let half = (f64::from(step) * 15.0).to_radians() / 2.0;
                    let entity = json!({
                        "id": "t", "propId": prop, "position": {"x": 4, "y": -0.5, "z": 0.25},
                        "rotation": {"x": 0, "y": 0, "z": half.sin(), "w": half.cos()},
                    });
                    Plan::parse(&request(site, vec![entity]))
                        .unwrap_or_else(|error| panic!("{site} {prop} {step}: {}", error.message));
                }
            }
        }
    }
    /// Скалярное произведение чуть больше единицы даёт NaN; он отказом перечитывания не считается.
    #[test]
    fn a_dot_product_above_one_is_not_a_drift() {
        let q = [0.0, 0.0, 0.6, 0.8000001];
        let angle = angle_degrees(q, q);
        assert!(angle.is_nan());
        let drifted = angle > limits::ANGLE_TOLERANCE_DEGREES;
        assert!(!drifted);
    }

    #[test]
    fn quaternion_helpers() {
        assert_eq!(quat::normalize([0.0; 4]), [0.0; 4]);
        let unit = quat::normalize([0.0, 0.0, 0.0, 2.0]);
        assert_eq!(unit, [0.0, 0.0, 0.0, 1.0]);
        let inverse = quat::inverse([0.0, 0.0, 0.0, 1.0]);
        assert!(inverse[0].is_sign_negative() && inverse[0] == 0.0 && inverse[3] == 1.0);
        let turned = quat::rotate([0.0, 0.0, 0.0, 1.0], [1.0, 2.0, 3.0]);
        assert_eq!(turned, [1.0, 2.0, 3.0]);
        let half_turn = quat::rotate([0.0, 0.0, 1.0, 0.0], [1.0, 2.0, 3.0]);
        assert_eq!(half_turn, [-1.0, -2.0, 3.0]);
        assert_eq!(
            angle_degrees([0.0, 0.0, 0.0, 1.0], [0.0, 0.0, 0.0, -1.0]),
            0.0
        );
    }

    #[test]
    fn specs_list_archetypes_in_first_use_order_and_guids_from_the_design() {
        let item = |id: &str, prop: &str, x: f64| json!({ "id": id, "propId": prop, "position": {"x": x, "y": -1, "z": 0}, "rotation": {"x":0,"y":0,"z":0,"w":1} });
        let plan = Plan::parse(&request(
            "shop-247-sc1-03",
            vec![
                item("a", "trash-bin", 5.0),
                item("b", "cooler-single", 6.0),
                item("c", "trash-bin", 7.0),
            ],
        ))
        .unwrap();
        let (archetypes, specs) = plan.specs();
        let names: Vec<&str> = archetypes.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["prop_bin_05a", "prop_bar_fridge_01"]);
        assert_eq!(
            specs.iter().map(|s| s.archetype).collect::<Vec<_>>(),
            [0, 1, 0]
        );
        assert_eq!(
            specs[0].guid,
            Some(res::hash::joaat(&format!("{DESIGN}:a")))
        );
        assert_eq!(specs[1].flags, 0x180000);
        assert_eq!(specs[1].lod_dist, 40.0);
        assert_eq!(archetypes[0].bb_min, [-0.389632, -0.389632, -0.037213]);
        assert_eq!(
            (archetypes[0].flags, archetypes[0].clip_dictionary.clone()),
            (0, None)
        );
        assert_eq!(specs[0].position, plan.items[0].world);
        assert_eq!(specs[0].rotation, plan.items[0].stored);
    }

    #[test]
    fn prop_hashes_match_the_table() {
        for (name, hash) in [
            ("prop_vend_soda_01", 0x3b21c5e7u32),
            ("prop_vend_soda_02", 0x426a547c),
            ("prop_bin_05a", 0x4f3fa437),
            ("prop_plant_int_01a", 0x1081fbdd),
            ("prop_bar_fridge_01", 0xe4b0ae85),
        ] {
            assert_eq!(res::hash::joaat(name), hash, "{name}");
            assert!(PROPS.iter().any(|prop| prop.archetype == name));
        }
    }

    // --- команда целиком: параметры, пути, файлы ---

    struct Lab(tempfile::TempDir);

    impl Lab {
        fn new() -> Self {
            Self(tempfile::tempdir().unwrap())
        }

        fn path(&self, name: &str) -> std::path::PathBuf {
            self.0.path().join(name)
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.path(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path.display().to_string()
        }

        fn run(&self, args: &[&str]) -> Result<Json> {
            let argv: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
            compile_interior_layout(&Options::parse(&argv)?, &Progress::silent())
        }

        fn run_request(&self, text: &str) -> Result<Json> {
            let input = self.put("r.json", text.as_bytes());
            let output = self.path("out.ymap").display().to_string();
            self.run(&["--input", &input, "--output", &output])
        }
    }

    fn message_of(result: Result<Json>) -> (String, String) {
        let error = result.unwrap_err();
        (error.code, error.message)
    }

    #[test]
    fn parameter_and_path_refusals() {
        let lab = Lab::new();
        let input = lab.put("r.json", base().to_string().as_bytes());
        let missing = lab.path("nope.json").display().to_string();
        assert_eq!(lab.run(&[]).unwrap_err().message, "--input is required.");
        assert_eq!(
            lab.run(&["--output", "x.ymap"]).unwrap_err().message,
            "--input is required."
        );
        assert_eq!(
            lab.run(&["--input", &input]).unwrap_err().message,
            "--output is required."
        );
        assert_eq!(
            lab.run(&["--input", &input, "--output", ""])
                .unwrap_err()
                .message,
            "The path is empty."
        );
        // несуществующий вход не успевает создать каталог выхода
        let made = lab.path("made/out.ymap").display().to_string();
        assert_eq!(
            lab.run(&["--input", &missing, "--output", &made])
                .unwrap_err()
                .message,
            format!("File was not found: {missing}")
        );
        assert!(!lab.path("made").exists());
        let txt = lab.put("r.txt", b"{}");
        assert_eq!(
            lab.run(&["--input", &txt, "--output", &made])
                .unwrap_err()
                .message,
            "Unsupported file extension: .txt"
        );
        // неверное расширение выхода успевает создать каталог
        let wrong = lab.path("made2/out.ytyp").display().to_string();
        assert_eq!(
            lab.run(&["--input", &input, "--output", &wrong])
                .unwrap_err()
                .message,
            "Unsupported output extension: .ytyp"
        );
        let no_ext = lab.path("out").display().to_string();
        assert_eq!(
            lab.run(&["--input", &input, "--output", &no_ext])
                .unwrap_err()
                .message,
            "Unsupported output extension: "
        );
    }

    #[test]
    fn request_file_refusals_leave_no_output_directory_behind() {
        let lab = Lab::new();
        let size = "Compile request must be between 1 byte and 512 KiB.";
        assert_eq!(
            message_of(lab.run_request("")),
            ("InvalidDataException".into(), size.into())
        );
        let big = " ".repeat(512 * 1024 + 1);
        assert_eq!(message_of(lab.run_request(&big)).1, size);
        for broken in ["not json", "{", "\u{feff}{}", "   "] {
            assert_eq!(
                message_of(lab.run_request(broken)).1,
                "Compile request is empty.",
                "{broken:?}"
            );
        }
        let trailing = format!("{} x", base());
        assert_eq!(
            message_of(lab.run_request(&trailing)).1,
            "Compile request is empty."
        );
        for not_object in ["[]", "null", "5", "\"x\""] {
            assert_eq!(
                message_of(lab.run_request(not_object)).1,
                "request must be an object."
            );
        }
        assert_eq!(
            message_of(lab.run_request("{}")).1,
            "format must be a string."
        );
        // каталог выхода создаётся до чтения запроса, но отказ его убирает (раньше пустой каталог оставался)
        let input = lab.put("bad.json", b"{}");
        let output = lab.path("made/by/failure/out.ymap").display().to_string();
        assert_eq!(
            lab.run(&["--input", &input, "--output", &output])
                .unwrap_err()
                .message,
            "format must be a string."
        );
        assert!(!lab.path("made").exists());
    }

    #[test]
    fn old_output_survives_a_refusal() {
        let lab = Lab::new();
        lab.put("out.ymap", b"old");
        let error = lab.run_request("{}").unwrap_err();
        assert_eq!(error.message, "format must be a string.");
        assert_eq!(fs::read(lab.path("out.ymap")).unwrap(), b"old");
    }

    /// Писатель карты берёт шаблон хоста из `parity`; без него успешные запуски не проверить.
    fn map_writer_available() -> bool {
        res::placements::compile_map("probe", &[], &[], labels::EXPORTED_BY, labels::EXPORTED_AT)
            .is_ok()
    }

    #[test]
    fn full_run_writes_the_map_when_the_template_is_present() {
        if !map_writer_available() {
            eprintln!("шаблон карты хоста недоступен: успешный запуск пропущен");
            return;
        }
        let lab = Lab::new();
        let value = lab.run_request(&base().to_string()).unwrap();
        let written = fs::read(lab.path("out.ymap")).unwrap();
        assert_eq!(value["bytes"], written.len());
        assert_eq!(value["sha256"], res::hash::sha256_hex(&written));
        assert_eq!(value["bytes"], 1167);
        assert_eq!(
            value["sha256"],
            "a0804dd0bd373d4eb5a528f9b5b7a4553b02d6c8a515ea10655208fb57bdf014"
        );
        assert_eq!(value["mapName"], "astral_int_shop_247_sc1_03");
        assert_eq!(value["semanticReopen"], true);
        assert_eq!(value["deterministic"], true);
        let keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "input",
                "output",
                "designHash",
                "locationId",
                "mapName",
                "entityCount",
                "bytes",
                "sha256",
                "semanticReopen",
                "deterministic",
                "entities"
            ]
        );
        let five = lab.run_request(&five_props().to_string()).unwrap();
        assert_eq!(five["bytes"], 1305);
        assert_eq!(
            five["sha256"],
            "56203d80e1ec210f1006e1e4412cf71b3b98056728b2686155b83b2e7a4f4acd"
        );
    }

    /// Карта запроса: сборка, перечитывание и повторная сборка, без файлов.
    fn built(value: &Json) -> std::result::Result<Vec<u8>, String> {
        Plan::parse(value)
            .and_then(|plan| plan.build_map())
            .map_err(|error| error.message)
    }

    fn entity_of(id: &str, prop: &str, p: [f64; 3], q: [f64; 4]) -> Json {
        json!({
            "id": id, "propId": prop,
            "position": {"x": p[0], "y": p[1], "z": p[2]},
            "rotation": {"x": q[0], "y": q[1], "z": q[2], "w": q[3]},
        })
    }

    const UNIT: [f64; 4] = [0.0, 0.0, 0.0, 1.0];

    /// Успешные примеры таблицы 5.1: размер и sha256 файла.
    #[test]
    fn success_examples_match_bytes_and_sums() {
        if !map_writer_available() {
            eprintln!("шаблон карты хоста недоступен: пропущено");
            return;
        }
        let at = |prop: &str, id: &str| entity_of(id, prop, [5.0, -1.0, 0.0], UNIT);
        let shop = |entities: Vec<Json>| request("shop-247-sc1-03", entities);
        let loc = |location: &str| request(location, vec![base_entity()]);
        let base_sum = "a0804dd0bd373d4eb5a528f9b5b7a4553b02d6c8a515ea10655208fb57bdf014";
        let cases: Vec<(&str, Json, usize, &str)> = vec![
            ("base", base(), 1167, base_sum),
            (
                "contract-fields-absent",
                without(
                    without(without(base(), "templateRef"), "eligible"),
                    "blockers",
                ),
                1167,
                base_sum,
            ),
            (
                "contract-fields-ignored",
                with(
                    with(
                        with(base(), "templateRef", json!(5)),
                        "eligible",
                        json!("x"),
                    ),
                    "blockers",
                    json!({"a": 1}),
                ),
                1167,
                base_sum,
            ),
            (
                "design-hash-other",
                with(
                    base(),
                    "designHash",
                    json!(
                        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    ),
                ),
                1167,
                "12f7f581c92eeaa17f1f64e16253a8d9b16a7840530de9896ecc5525a45d34a0",
            ),
            (
                "loc-gasstation-id2-21-b",
                loc("gasstation-id2-21-b"),
                1178,
                "f8fc329d669fea219a9fc9c101a6c74483910dcd609128f643e2943bc4d02890",
            ),
            (
                "loc-gasstation-sc1-21",
                loc("gasstation-sc1-21"),
                1180,
                "506b191623deb2b7a774c1169596e96dacab789c1715c15c6a4749c50eb3e159",
            ),
            (
                "loc-shop-247-cs2-11",
                loc("shop-247-cs2-11"),
                1172,
                "184c2fdfb0eb8633f733fad70a81c17afe6f6b08f51daef6f291d8ecd9726f36",
            ),
            (
                "prop-cooler-single",
                shop(vec![at("cooler-single", "cooler_single")]),
                1167,
                "4fbbb967ff3e71356b065d00640813c1c05a822fec81c9cd8d2832f19271b08f",
            ),
            (
                "prop-plant-pot",
                shop(vec![at("plant-pot", "plant_pot")]),
                1163,
                "3350b268817b6a2cb8fa444c3664b45fdf1ab60937ab91bac8083a8b4cf125b4",
            ),
            (
                "prop-trash-bin",
                shop(vec![at("trash-bin", "trash_bin")]),
                1167,
                "df000c7c6adcaaa4ca3396533d01081596ea7add42c812267e935d9e2c141b6f",
            ),
            (
                "prop-vending-drink",
                shop(vec![at("vending-drink", "vending_drink")]),
                1168,
                "ea39279aa894e58f7280ff00d062e01ae06214879b81f45c2bf6fe96b391a7e5",
            ),
            (
                "prop-vending-drink-blue",
                shop(vec![at("vending-drink-blue", "vending_drink-blue")]),
                1169,
                "52551e4826d8418ee8598afed53cb979b5e2930a8bc8c7fa27ffdc561ba26fe7",
            ),
            (
                "five-props",
                five_props(),
                1305,
                "56203d80e1ec210f1006e1e4412cf71b3b98056728b2686155b83b2e7a4f4acd",
            ),
            (
                "rotated-cs2",
                request(
                    "shop-247-cs2-11",
                    vec![entity_of(
                        "g1",
                        "vending-drink",
                        [6.0, -2.0, 0.2],
                        [
                            0.10259783520851543,
                            0.20519567041703085,
                            0.30779350562554625,
                            0.9233805168766388,
                        ],
                    )],
                ),
                1179,
                "bb17a844b244133c994daff444fa2fe58ee92d678b94ebf97a1d6b8888f0f08a",
            ),
            (
                "rotated-gas",
                request(
                    "gasstation-sc1-21",
                    vec![entity_of(
                        "g1",
                        "cooler-single",
                        [3.0, 1.0, 0.0],
                        [0.0, 0.0, 0.6087614290087207, 0.7933533402912352],
                    )],
                ),
                1181,
                "550f74ca5a256851fc5834c218dbd51b2d483a36659e0b3b03ffcfdaa2353719",
            ),
            (
                "same-prop-twice",
                shop(vec![
                    entity_of("a", "trash-bin", [5.0, -1.0, 0.0], UNIT),
                    entity_of("b", "trash-bin", [6.0, -1.0, 0.0], UNIT),
                ]),
                1188,
                "50fe296f796bda54fb3c835fe30cc8471fe20857c125a5b38234648bccafd9e5",
            ),
            (
                "same-spot-twice",
                shop(vec![
                    entity_of("a", "trash-bin", [5.0, -1.0, 0.0], UNIT),
                    entity_of("b", "trash-bin", [5.0, -1.0, 0.0], UNIT),
                ]),
                1185,
                "b310e8f68c6df8c8b63a9328ce1abb7e2b7e2795cd77a06b70e53bb798d90b5b",
            ),
            (
                "z-up",
                shop(vec![entity_of(
                    "bin-1",
                    "trash-bin",
                    [5.0, -1.0, 1.5],
                    UNIT,
                )]),
                1167,
                "5568b90d0486d89c25988e80c16f43e189df49afbcbc1bf1cb9b8c7f044423da",
            ),
        ];
        for (name, request, bytes, sum) in cases {
            let map = built(&request).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(map.len(), bytes, "{name}");
            assert_eq!(res::hash::sha256_hex(&map), sum, "{name}");
        }
    }

    /// Принятые примеры с известным размером файла (повороты, края, идентификаторы).
    #[test]
    fn accepted_examples_have_the_recorded_sizes() {
        if !map_writer_available() {
            eprintln!("шаблон карты хоста недоступен: пропущено");
            return;
        }
        let one = |prop: &str, id: &str, p: [f64; 3], q: [f64; 4]| {
            request("shop-247-sc1-03", vec![entity_of(id, prop, p, q)])
        };
        let bin = |p: [f64; 3], q: [f64; 4]| one("trash-bin", "bin-1", p, q);
        let long = "x".repeat(96);
        let cases: Vec<(&str, Json, usize)> = vec![
            (
                "rotation-flip",
                bin([5.0, -1.0, 0.0], [0.0, 0.0, 1.0, 0.0]),
                1170,
            ),
            (
                "rotation-negative-w",
                bin([5.0, -1.0, 0.0], [0.0, 0.0, 0.0, -1.0]),
                1170,
            ),
            (
                "rotation-only-yaw",
                bin(
                    [8.55, -1.0, 0.0],
                    [0.5000000016387101, 0.0, 0.0, 0.8660254028383291],
                ),
                1171,
            ),
            (
                "rotation-tilt-over-top",
                one(
                    "cooler-single",
                    "bin-1",
                    [3.0, -1.0, 1.0],
                    [
                        0.30779350562554625,
                        0.20519567041703085,
                        0.10259783520851543,
                        0.9233805168766388,
                    ],
                ),
                1181,
            ),
            (
                "rotation-x-axis",
                bin(
                    [5.0, -1.0, 0.0],
                    [0.7071067811865475, 0.0, 0.0, 0.7071067811865475],
                ),
                1174,
            ),
            (
                "length-0.999",
                bin([5.0, -1.0, 0.0], [0.0, 0.0, 0.0, 0.999]),
                1167,
            ),
            (
                "length-0.9991",
                bin([5.0, -1.0, 0.0], [0.0, 0.0, 0.0, 0.9991]),
                1167,
            ),
            (
                "length-1.0009",
                bin([5.0, -1.0, 0.0], [0.0, 0.0, 0.0, 1.0009]),
                1167,
            ),
            (
                "length-1.001",
                bin([5.0, -1.0, 0.0], [0.0, 0.0, 0.0, 1.001]),
                1167,
            ),
            ("entrance-edge-x", bin([4.1, -5.0, 0.0], UNIT), 1168),
            ("entrance-edge-y", bin([2.0, -4.2, 0.0], UNIT), 1168),
            (
                "id-digit-first",
                one("trash-bin", "9a", [5.0, -1.0, 0.0], UNIT),
                1167,
            ),
            (
                "id-len-96",
                one("trash-bin", &long, [5.0, -1.0, 0.0], UNIT),
                1167,
            ),
        ];
        for (name, request, bytes) in cases {
            let map = built(&request).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(map.len(), bytes, "{name}");
        }
    }

    /// Ни одна принятая размещением расстановка не отказывает на перечитывании:
    /// 480 поворотов и псевдослучайные запросы.
    #[test]
    fn reopen_never_refuses_an_accepted_layout() {
        if !map_writer_available() {
            eprintln!("шаблон карты хоста недоступен: пропущено");
            return;
        }
        for site in SITES.iter().map(|site| site.id) {
            for prop in PROPS.iter().map(|prop| prop.id) {
                for step in 0..24 {
                    let half = (f64::from(step) * 15.0).to_radians() / 2.0;
                    let q = [0.0, 0.0, half.sin(), half.cos()];
                    let asked = request(site, vec![entity_of("t", prop, [4.0, -0.5, 0.25], q)]);
                    built(&asked).unwrap_or_else(|error| panic!("{site} {prop} {step}: {error}"));
                }
            }
        }
        // Детерминированный перебор: место, предмет, положение, произвольный поворот.
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let mut next = move || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((state >> 11) as f64) / ((1u64 << 53) as f64)
        };
        let (mut accepted, mut tried) = (0, 0);
        while accepted < 600 && tried < 20000 {
            tried += 1;
            let site = SITES[(next() * 4.0) as usize % 4].id;
            let prop = PROPS[(next() * 5.0) as usize % 5].id;
            let p = [next() * 9.0 - 2.0, next() * 7.0 - 5.5, next() * 2.0];
            let mut q = [next() - 0.5, next() - 0.5, next() - 0.5, next() - 0.5];
            let len = q.iter().map(|v| v * v).sum::<f64>().sqrt();
            q.iter_mut().for_each(|v| *v /= len);
            let asked = request(site, vec![entity_of("r", prop, p, q)]);
            match built(&asked) {
                Ok(_) => accepted += 1,
                Err(message) => assert!(
                    message.starts_with("entities[0] "),
                    "{site} {prop} {p:?} {q:?}: {message}"
                ),
            }
        }
        assert!(accepted >= 600, "принято только {accepted} из {tried}");
    }
}
