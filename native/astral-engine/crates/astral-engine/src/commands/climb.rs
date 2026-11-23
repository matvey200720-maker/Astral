//! `compile-climb-markers`: метки залазов как модели игры.
//!
//! Метка — плоская двусторонняя плашка с картинкой. На каждую нужен файл модели `.ydr`, на весь набор — файл
//! типов `.ytyp` и карта расстановки `.ymap` мода. Каркас модели берётся у донора, плашка подменяет его геометрию,
//! картинка метки встаёт в словарь под именем `<модель>_astral`. Типы и карту мода пересобирает `rage_res::climb_mod`.
//! Чего движок не умеет, он отдаёт хосту отказом со словами «пока на хосте».
//!
//! Устройство: запрос разбирается в `Request`; поля метки читают стадии над одной заготовкой (`STAGES`), каждая
//! знает свой отказ; плашка — `Quad` с осью, из которой выводятся и вершины, и рамка.

use std::fs;
use std::path::{Path, PathBuf};

use rage_res::climb_mod::{self, CopyBox, Edits, MarkerBox, Rename};
use rage_res::donor::{Donor, Mesh, Packed, Refusal};
use rage_res::{hash::sha256_hex, texture::Format, ytd_write::NewTexture};
use serde_json::Value;

use super::{emblem, fresh_dirs::FreshDirs, shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

// ---------------------------------------------------------------------------------------------------------------
// Пределы и слова
// ---------------------------------------------------------------------------------------------------------------

mod limits {
    use std::ops::RangeInclusive;

    pub const REQUEST_BYTES: u64 = 256 * 1024;
    pub const MARKERS: RangeInclusive<usize> = 1..=32;
    pub const NAME_BYTES: RangeInclusive<usize> = 1..=40;
    pub const QUAD_EDGE: f32 = 4.0;
    pub const QUAD_DEPTH: f32 = 0.25;
    pub const EMISSIVE: f64 = 16.0;
    pub const MODEL_RANGE: f32 = 9998.0;
    /// Данные листа 4×4 DXT5 с тремя ступенями: 16 + 16 + 16 байт.
    pub const BLANK_PAYLOAD: usize = 48;
}

mod words {
    pub const REQUEST: &str = "astral.compile-climb-markers";
    pub const ANSWER: &str = "astral.climb-marker-artifacts";
    pub const VERSION: u64 = 3;
    pub const EXPORTED_BY: &str = "Astral Climbs 3";
    pub const EXPORT_TIME: &str = "01 January 1970 00:00";
    pub const SUFFIX: &str = "_astral";
    pub const NO_GLOW_DONOR: &str = "Светящиеся метки без донора";
    pub const NO_MAP: &str = "В запросе нет карты мода";
}

/// Два треугольника лица; спина — те же с номерами на четыре больше и обратным обходом.
const FACE: [u16; 6] = [0, 1, 2, 0, 2, 3];
const BACK_SHIFT: u16 = 4;
/// Углы лица по кругу: номер предела по горизонтали и по вертикали (0 — минимум).
const RING: [(usize, usize); 4] = [(0, 0), (1, 0), (1, 1), (0, 1)];
/// Написание стороны спины в запросе и читается ли она.
const BACK_FACES: [(&str, bool); 2] = [("readable", true), ("none", false)];
/// Ключи шести чисел квада в порядке разбора.
const QUAD_KEYS: [&str; 6] = ["minX", "maxX", "minY", "maxY", "front", "back"];

// ---------------------------------------------------------------------------------------------------------------
// Чтение JSON
// ---------------------------------------------------------------------------------------------------------------

/// Что можно «мягко» прочитать из значения: не тот вид — `None`.
trait Pick<'a>: Sized {
    fn pick(value: &'a Value) -> Option<Self>;
}

impl<'a> Pick<'a> for &'a str {
    fn pick(value: &'a Value) -> Option<Self> {
        value.as_str()
    }
}

impl Pick<'_> for bool {
    fn pick(value: &Value) -> Option<Self> {
        value.as_bool()
    }
}

/// Целое без знака; запись с дробной частью (`64.0`) не годится.
impl Pick<'_> for u64 {
    fn pick(value: &Value) -> Option<Self> {
        value.as_u64()
    }
}

impl Pick<'_> for f64 {
    fn pick(value: &Value) -> Option<Self> {
        value.as_f64()
    }
}

/// Объект запроса с «мягкими» чтениями полей.
#[derive(Clone, Copy)]
struct Doc<'a>(&'a Value);

impl<'a> Doc<'a> {
    fn at(self, key: &str) -> Option<&'a Value> {
        self.0.get(key)
    }

    fn get<T: Pick<'a>>(self, key: &str) -> Option<T> {
        self.at(key).and_then(T::pick)
    }

    fn child(self, key: &str) -> Option<Doc<'a>> {
        self.at(key).filter(|value| value.is_object()).map(Doc)
    }

    /// Число, суженное до `f32`; бесконечность после сужения — «нет числа».
    fn single(self, key: &str) -> Option<f32> {
        let narrowed = self.get::<f64>(key)? as f32;
        narrowed.is_finite().then_some(narrowed)
    }

    /// Массив поля; другой вид значения читается как пустой список.
    fn items(self, key: &str) -> &'a [Value] {
        match self.at(key) {
            Some(Value::Array(list)) => list,
            _ => &[],
        }
    }
}

/// Имя ассета: строчные `a`–`z`, цифры и `_`, 1–40 байт.
fn lowercase_name(value: Option<&Value>) -> Option<&str> {
    let name = value?.as_str()?;
    let fits = limits::NAME_BYTES.contains(&name.len());
    let letters = name
        .bytes()
        .all(|byte| byte == b'_' || byte.is_ascii_digit() || byte.is_ascii_lowercase());
    (fits && letters).then_some(name)
}

fn bad_name() -> EngineError {
    EngineError::argument("Climb marker model must be a lowercase asset name.")
}

fn asset_name(value: Option<&Value>) -> Result<String> {
    lowercase_name(value)
        .map(str::to_owned)
        .ok_or_else(bad_name)
}

/// Отказ по полю метки: имя модели и хвост текста.
fn tail(model: &str, text: &str) -> EngineError {
    EngineError::argument(format!("Climb marker {model} {text}"))
}

/// `sha256:` и 64 строчных шестнадцатеричных знака.
fn is_digest(text: &str) -> bool {
    let Some(hex) = text.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

// ---------------------------------------------------------------------------------------------------------------
// Плашка: ось, квад, вершины и рамка
// ---------------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
enum Axis {
    #[default]
    Z,
    Y,
}

impl Axis {
    fn parse(name: Option<&str>) -> Option<Axis> {
        match name? {
            "z" => Some(Axis::Z),
            "y" => Some(Axis::Y),
            _ => None,
        }
    }

    /// Номера координат модели для (горизонталь, вертикаль, глубина).
    fn slots(self) -> [usize; 3] {
        match self {
            Axis::Z => [0, 1, 2],
            Axis::Y => [0, 2, 1],
        }
    }

    /// Взгляд, при котором горизонталь зеркалится: у `z` — вниз по оси, у `y` — вверх.
    fn mirrored_at(self) -> f32 {
        match self {
            Axis::Z => -1.0,
            Axis::Y => 1.0,
        }
    }
}

/// Лицо метки: пределы по горизонтали и вертикали, глубины лица и спины, ось и взгляд (`1` или `-1`).
#[derive(Clone, Copy, Debug, Default)]
struct Quad {
    span: [[f32; 2]; 2],
    depth: [f32; 2],
    axis: Axis,
    facing: f32,
}

impl Quad {
    fn read(doc: Doc, model: &str) -> Result<Quad> {
        let quad = doc
            .child("quad")
            .ok_or_else(|| tail(model, "has no quad."))?;
        let shape = || tail(model, "has an invalid quad.");
        let numbers: Option<Vec<f32>> = QUAD_KEYS.iter().map(|key| quad.single(key)).collect();
        let [min_x, max_x, min_y, max_y, front, back]: [f32; 6] = numbers
            .and_then(|list| list.try_into().ok())
            .ok_or_else(shape)?;
        let off_scale = [min_x, max_x, min_y, max_y]
            .iter()
            .any(|edge| edge.abs() > limits::QUAD_EDGE);
        if [off_scale, min_x >= max_x, min_y >= max_y].contains(&true) {
            return Err(shape());
        }
        let heading = || tail(model, "has an unknown axis or facing.");
        let axis = Axis::parse(quad.get("axis")).ok_or_else(heading)?;
        let facing = quad
            .at("facing")
            .and_then(Value::as_i64)
            .filter(|turn| turn.abs() == 1)
            .ok_or_else(heading)? as f32;
        if front.abs().max(back.abs()) > limits::QUAD_DEPTH || (front - back) * facing <= 0.0 {
            return Err(tail(model, "has an invalid depth."));
        }
        Ok(Quad {
            span: [[min_x, max_x], [min_y, max_y]],
            depth: [front, back],
            axis,
            facing,
        })
    }

    /// Точка плашки в координатах модели: горизонталь зеркалится, когда метка смотрит «против» оси.
    fn point(&self, wide: usize, tall: usize, depth: f32) -> [f32; 3] {
        let across = self.span[0][wide];
        let across = if self.facing == self.axis.mirrored_at() {
            -across
        } else {
            across
        };
        let mut out = [0.0; 3];
        let values = [across, self.span[1][tall], depth];
        for (slot, value) in self.axis.slots().into_iter().zip(values) {
            out[slot] = value;
        }
        out
    }

    /// Нормаль лица: на оси глубины, направлена как взгляд.
    fn normal(&self) -> [f32; 3] {
        let mut out = [0.0; 3];
        out[self.axis.slots()[2]] = self.facing;
        out
    }

    /// Стороны плашки: глубина и признак спины.
    fn faces(&self) -> [(f32, bool); 2] {
        [(self.depth[0], false), (self.depth[1], true)]
    }

    /// Рамка метки по восьми углам: лицо и спина.
    fn frame(&self) -> ([f32; 3], [f32; 3]) {
        let corners: Vec<[f32; 3]> = self
            .faces()
            .into_iter()
            .flat_map(|(depth, _)| {
                RING.into_iter()
                    .map(move |(wide, tall)| self.point(wide, tall, depth))
            })
            .collect();
        let extreme = |pick: fn(f32, f32) -> f32, start: f32| {
            [0, 1, 2].map(|axis| corners.iter().map(|point| point[axis]).fold(start, pick))
        };
        (
            extreme(f32::min, f32::INFINITY),
            extreme(f32::max, f32::NEG_INFINITY),
        )
    }

    /// Сетка метки: лицо, а при читаемой спине ещё и спина; шейдер 0.
    fn mesh(&self, with_back: bool) -> Mesh {
        let face = self.normal();
        let vertices = self
            .faces()
            .into_iter()
            .take(1 + usize::from(with_back))
            .flat_map(|(depth, reversed)| {
                // Разность с нулём, не отрицание: нулевые компоненты остаются +0.0 (с `-c` в файл попал бы -0.0).
                let normal = if reversed {
                    face.map(|c| 0.0 - c)
                } else {
                    face
                };
                RING.into_iter().map(move |(wide, tall)| {
                    let [x, y, z] = self.point(wide, tall, depth);
                    let s = if reversed {
                        1.0 - wide as f32
                    } else {
                        wide as f32
                    };
                    [
                        x,
                        y,
                        z,
                        normal[0],
                        normal[1],
                        normal[2],
                        s,
                        1.0 - tall as f32,
                    ]
                })
            })
            .collect();
        let mut indices = FACE.to_vec();
        if with_back {
            // Спина обходится в обратную сторону.
            indices.extend(
                FACE.chunks(3)
                    .flat_map(|tri| [tri[0], tri[2], tri[1]].map(|index| index + BACK_SHIFT)),
            );
        }
        Mesh {
            shader: 0,
            vertices,
            indices,
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Метка и её стадии
// ---------------------------------------------------------------------------------------------------------------

struct Picture {
    file: PathBuf,
    width: u64,
    height: u64,
    sha: String,
}

/// Метка запроса; читается по стадиям поверх заготовки с пустыми значениями.
#[derive(Default)]
struct Marker {
    model: String,
    /// Имя метки-источника, если это копия «только лицом».
    source: Option<String>,
    lit: bool,
    readable_back: bool,
    emissive: f64,
    quad: Quad,
    /// Своя картинка; `None` — невидимая метка.
    picture: Option<Picture>,
}

type Stage = fn(Doc, &mut Marker) -> Result<()>;

/// Стадии чтения полей метки в том порядке, в каком отказы побеждают.
const STAGES: [Stage; 6] = [
    stage_source,
    stage_lit,
    stage_back,
    stage_glow,
    stage_quad,
    stage_picture,
];

fn stage_source(doc: Doc, marker: &mut Marker) -> Result<()> {
    marker.source = match doc.at("archetype") {
        None | Some(Value::Null) => None,
        given => Some(asset_name(given)?),
    };
    Ok(())
}

fn stage_lit(doc: Doc, marker: &mut Marker) -> Result<()> {
    marker.lit = doc
        .get("lit")
        .ok_or_else(|| tail(&marker.model, "has no lit flag."))?;
    Ok(())
}

fn stage_back(doc: Doc, marker: &mut Marker) -> Result<()> {
    let word = doc.get::<&str>("back");
    let known = BACK_FACES
        .iter()
        .find(|(spelling, _)| Some(*spelling) == word);
    marker.readable_back = known
        .map(|(_, readable)| *readable)
        .ok_or_else(|| tail(&marker.model, "has an unknown back face."))?;
    Ok(())
}

/// Множитель свечения обязателен у каждой метки, даже у обычной: нет числа читается как −1.
fn stage_glow(doc: Doc, marker: &mut Marker) -> Result<()> {
    marker.emissive = doc.get("emissive").unwrap_or(-1.0);
    if !(0.0..=limits::EMISSIVE).contains(&marker.emissive) {
        return Err(tail(&marker.model, "emissive multiplier is out of range."));
    }
    match marker.lit || marker.emissive > 0.0 {
        true => Ok(()),
        false => Err(tail(&marker.model, "glows with a zero multiplier.")),
    }
}

fn stage_quad(doc: Doc, marker: &mut Marker) -> Result<()> {
    marker.quad = Quad::read(doc, &marker.model)?;
    Ok(())
}

fn stage_picture(doc: Doc, marker: &mut Marker) -> Result<()> {
    let visible = doc
        .get::<bool>("visible")
        .ok_or_else(|| tail(&marker.model, "has no visible flag."))?;
    marker.picture = match visible {
        true => Some(Picture::read(doc, &marker.model)?),
        false => None,
    };
    Ok(())
}

impl Picture {
    fn read(doc: Doc, model: &str) -> Result<Picture> {
        let file = doc
            .get::<&str>("texture")
            .ok_or_else(|| emblem::refuse("Метка без картинки"))?;
        let sides = ["width", "height"].map(|key| doc.get::<u64>(key).unwrap_or(0));
        if !sides.into_iter().all(emblem::texture_side) {
            return Err(tail(model, "texture size must be a power of two 4…2048."));
        }
        let sha = doc
            .get::<&str>("textureSha256")
            .filter(|text| is_digest(text))
            .ok_or_else(|| tail(model, "has an invalid texture SHA-256."))?;
        Ok(Picture {
            file: PathBuf::from(file),
            width: sides[0],
            height: sides[1],
            sha: sha.to_owned(),
        })
    }
}

impl Marker {
    fn read(doc: Doc, earlier: &[Marker]) -> Result<Marker> {
        let model = asset_name(doc.at("model"))?;
        if earlier.iter().any(|other| other.model == model) {
            return Err(EngineError::argument(format!(
                "Climb marker {model} is listed twice."
            )));
        }
        let mut marker = Marker {
            model,
            ..Marker::default()
        };
        for stage in STAGES {
            stage(doc, &mut marker)?;
        }
        Ok(marker)
    }

    /// Все метки запроса: число, поля по порядку, потом проверка копий.
    fn read_all(doc: Doc) -> Result<Vec<Marker>> {
        let Some(Value::Array(items)) = doc.at("markers") else {
            return Err(emblem::refuse("В запросе меток нет списка"));
        };
        if !limits::MARKERS.contains(&items.len()) {
            return Err(EngineError::argument(
                "Climb markers request must list 1–32 markers.",
            ));
        }
        let markers = items.iter().try_fold(
            Vec::with_capacity(items.len()),
            |mut read, item| -> Result<Vec<Marker>> {
                let next = Marker::read(Doc(item), &read)?;
                read.push(next);
                Ok(read)
            },
        )?;
        match broken_copy(&markers) {
            Some(copy) => Err(EngineError::argument(format!(
                "Climb marker copy {} must be a front-only copy of a listed marker.",
                copy.model
            ))),
            None => Ok(markers),
        }
    }

    /// Лист картинки: невидимая метка получает пустой.
    fn sheet(&self, name: &str) -> Result<NewTexture> {
        let Some(picture) = &self.picture else {
            return Ok(blank_sheet(name));
        };
        emblem::dds_sheet(
            &picture.file,
            &picture.sha,
            picture.width,
            picture.height,
            name,
            &self.model,
        )
    }
}

/// Первая копия, которая не копия «только лицом» метки этого же запроса: со спиной или без обычной метки-источника.
fn broken_copy(markers: &[Marker]) -> Option<&Marker> {
    markers.iter().find(|copy| {
        copy.source.as_deref().is_some_and(|source| {
            copy.readable_back
                || !markers
                    .iter()
                    .any(|other| other.source.is_none() && other.model == source)
        })
    })
}

/// Лист невидимой метки: 4×4 DXT5, три ступени, нулевая альфа.
fn blank_sheet(name: &str) -> NewTexture {
    NewTexture {
        name: name.to_owned(),
        width: 4,
        height: 4,
        format: Format::Dxt5,
        levels: 3,
        payload: vec![0; limits::BLANK_PAYLOAD],
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------------------------

/// Имя и путь исходного файла мода.
struct Part {
    name: String,
    path: String,
}

/// Правки расстановки мода.
struct Placements {
    renames: Vec<Rename>,
    remove: Vec<usize>,
}

struct Request {
    donor: String,
    glow_donor: Option<String>,
    markers: Vec<Marker>,
    types: Part,
    map: Part,
    placements: Placements,
}

fn as_index(number: u64) -> usize {
    usize::try_from(number).unwrap_or(usize::MAX)
}

impl Part {
    /// Имя читается раньше пути: плохое имя побеждает отсутствующий путь.
    fn read(holder: Doc, name_key: &str, path_key: &str, missing: &str) -> Result<Part> {
        let name = asset_name(holder.at(name_key))?;
        let path = holder
            .get::<&str>(path_key)
            .ok_or_else(|| emblem::refuse(missing))?;
        Ok(Part {
            name,
            path: path.to_owned(),
        })
    }
}

impl Placements {
    fn read(doc: Doc) -> Result<Placements> {
        // `placements` не объект или вложенный не массив читаются как пустые.
        let held = doc.child("placements");
        let list = |key: &str| held.map_or(&[][..], |placements| placements.items(key));
        let mut renames = Vec::new();
        for item in list("rename") {
            let index = item.get("index").and_then(Value::as_u64).ok_or_else(|| {
                EngineError::argument("Climb placement rename must give the place number.")
            })?;
            renames.push(Rename {
                index: as_index(index),
                copy: asset_name(item.get("archetype"))?,
            });
        }
        let mut remove = Vec::new();
        for item in list("remove") {
            let number = item.as_u64().ok_or_else(|| {
                EngineError::argument("Climb placement removal must list place numbers.")
            })?;
            remove.push(as_index(number));
        }
        Ok(Placements { renames, remove })
    }
}

impl Request {
    fn load(options: &Options) -> Result<Request> {
        let given = options.required("input")?;
        let file = paths::existing_file(given, &[".json"])?;
        let length = fs::metadata(&file)?.len();
        if !(1..=limits::REQUEST_BYTES).contains(&length) {
            return Err(emblem::refuse("Запрос меток вне размера"));
        }
        let document: Value = match serde_json::from_slice(&fs::read(&file)?) {
            Ok(parsed) => parsed,
            Err(_) => return Err(emblem::refuse("Запрос меток не читается")),
        };
        Request::read(Doc(&document))
    }

    fn read(doc: Doc) -> Result<Request> {
        let format_ok = doc.get::<&str>("format") == Some(words::REQUEST);
        if !format_ok || doc.get::<u64>("version") != Some(words::VERSION) {
            return Err(emblem::refuse("Запрос меток другого формата"));
        }
        let donor = doc
            .get::<&str>("donor")
            .ok_or_else(|| emblem::refuse("Метки без донора"))?
            .to_owned();
        let glow_donor = doc.get::<&str>("emissiveDonor").map(str::to_owned);
        let markers = Marker::read_all(doc)?;
        let types = Part::read(doc, "typesName", "types", "В запросе нет типов мода")?;
        let map_doc = doc
            .child("map")
            .ok_or_else(|| emblem::refuse(words::NO_MAP))?;
        let map = Part::read(map_doc, "name", "input", words::NO_MAP)?;
        let placements = Placements::read(doc)?;
        Ok(Request {
            donor,
            glow_donor,
            markers,
            types,
            map,
            placements,
        })
    }

    /// Читает файлы мода и пересобирает типы и карту: этот шаг идёт раньше донора.
    fn rebuild_mod(&self) -> Result<climb_mod::Compiled> {
        let read_source = |path: &str, extension: &str| -> Result<Vec<u8>> {
            Ok(fs::read(paths::existing_file(path, &[extension])?)?)
        };
        let types = read_source(&self.types.path, ".ytyp")?;
        let map = read_source(&self.map.path, ".ymap")?;
        let mut boxes: Vec<MarkerBox> = Vec::new();
        let mut copies: Vec<CopyBox> = Vec::new();
        for marker in &self.markers {
            let (min, max) = marker.quad.frame();
            let model = marker.model.clone();
            match &marker.source {
                None => boxes.push(MarkerBox { model, min, max }),
                Some(source) => copies.push(CopyBox {
                    model,
                    source: source.clone(),
                    min,
                    max,
                }),
            }
        }
        let place = &self.placements;
        let edits = Edits {
            boxes: boxes.as_slice(),
            copies: copies.as_slice(),
            renames: place.renames.as_slice(),
            remove: place.remove.as_slice(),
        };
        let built = climb_mod::compile(
            &self.types.name,
            &self.map.name,
            &types,
            &map,
            &edits,
            words::EXPORTED_BY,
            words::EXPORT_TIME,
        )?;
        // Без правок расстановки карта уходит байтами исходной.
        let edited = !(place.remove.is_empty() && place.renames.is_empty());
        Ok(climb_mod::Compiled {
            types: built.types,
            map: if edited { built.map } else { map },
        })
    }

    fn types_artifact(&self, bytes: Vec<u8>) -> Artifact {
        let added = self.markers.iter().filter(|m| m.source.is_some()).count();
        Artifact {
            file: format!("{}.ytyp", self.types.name),
            bytes,
            semantic: record([
                ("semanticReopen", true.into()),
                ("archetypes", self.markers.len().into()),
                ("adjusted", (self.markers.len() - added).into()),
                ("added", added.into()),
            ]),
        }
    }

    fn map_artifact(&self, bytes: Vec<u8>) -> Artifact {
        let (renamed, removed) = (self.placements.renames.len(), self.placements.remove.len());
        Artifact {
            file: format!("{}.ymap", self.map.name),
            bytes,
            semantic: record([
                ("semanticReopen", true.into()),
                ("edited", (renamed + removed > 0).into()),
                ("renamed", renamed.into()),
                ("removed", removed.into()),
            ]),
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Сборка моделей на донорах
// ---------------------------------------------------------------------------------------------------------------

fn from_refusal(refusal: Refusal) -> EngineError {
    EngineError::new(refusal.code(), refusal.to_string())
}

fn open_donor(path: &str, missing: &str) -> Result<Donor> {
    match fs::read(path) {
        Ok(bytes) => Donor::open(&bytes).map_err(from_refusal),
        Err(_) => Err(EngineError::new("sign-donor-missing", missing)),
    }
}

/// Доноры запроса: обычный и (если задан) светящийся.
struct Studio {
    plain: Donor,
    /// Диффузная текстура шейдера 0 обычного донора: под этим именем лист встаёт в словарь.
    plain_sheet: String,
    glow: Option<Donor>,
}

impl Studio {
    fn open(request: &Request) -> Result<Studio> {
        let plain = open_donor(&request.donor, "Донор меток не найден.")?;
        let Some(plain_sheet) = plain.diffuse_name(0).map(str::to_owned) else {
            return Err(EngineError::new(
                "sign-donor-no-texture",
                "У донора меток нет диффузной текстуры.",
            ));
        };
        let glow = match &request.glow_donor {
            Some(path) => Some(open_donor(path, "Донор светящихся меток не найден.")?),
            None => None,
        };
        if glow.is_none() && request.markers.iter().any(|marker| !marker.lit) {
            return Err(emblem::refuse(words::NO_GLOW_DONOR));
        }
        Ok(Studio {
            plain,
            plain_sheet,
            glow,
        })
    }

    /// Сетка метки, разложенная по образцу вершин донора.
    fn pack(donor: &Donor, marker: &Marker) -> Result<Packed> {
        let mesh = marker.quad.mesh(marker.readable_back);
        donor
            .pack_bounded(
                &[mesh],
                Some(limits::MODEL_RANGE),
                Some(marker.quad.frame()),
            )
            .map_err(from_refusal)
    }

    /// Обычная метка: лист под диффузным именем донора, потом переименование листа и рисовалки.
    fn assemble_plain(&self, marker: &Marker) -> Result<(Vec<u8>, NewTexture)> {
        let sheet = marker.sheet(&self.plain_sheet)?;
        let packed = Self::pack(&self.plain, marker)?;
        let raw = self
            .plain
            .apply(&packed, std::slice::from_ref(&sheet))
            .map_err(from_refusal)?;
        let texture = format!("{}{}", marker.model, words::SUFFIX);
        let bytes = emblem::named_sheet(&raw, &self.plain_sheet, &texture, &marker.model)?;
        Ok((bytes, sheet))
    }

    /// Светящаяся метка: лист сразу под своим именем, сборка на светящемся доноре.
    fn assemble_glow(&self, marker: &Marker) -> Result<(Vec<u8>, NewTexture)> {
        let sheet = marker.sheet(&format!("{}{}", marker.model, words::SUFFIX))?;
        let Some(donor) = &self.glow else {
            return Err(emblem::refuse(words::NO_GLOW_DONOR));
        };
        let packed = Self::pack(donor, marker)?;
        let bytes = donor
            .apply_glow(&packed, &sheet, &marker.model, marker.emissive as f32)
            .map_err(from_refusal)?;
        Ok((bytes, sheet))
    }

    fn build(&self, marker: &Marker) -> Result<Artifact> {
        let (bytes, sheet) = if marker.lit {
            self.assemble_plain(marker)?
        } else {
            self.assemble_glow(marker)?
        };
        let texture = record([
            ("width", sheet.width.into()),
            ("height", sheet.height.into()),
            ("mipLevels", sheet.levels.into()),
        ]);
        Ok(Artifact {
            file: format!("{}.ydr", marker.model),
            bytes,
            semantic: record([
                ("semanticReopen", true.into()),
                ("model", marker.model.as_str().into()),
                ("visible", marker.picture.is_some().into()),
                (
                    "back",
                    (if marker.readable_back {
                        "readable"
                    } else {
                        "none"
                    })
                    .into(),
                ),
                (
                    "shader",
                    (if marker.lit {
                        "alpha.sps"
                    } else {
                        "emissive_alpha.sps"
                    })
                    .into(),
                ),
                ("texture", texture),
            ]),
        })
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Выход: файлы и ответ
// ---------------------------------------------------------------------------------------------------------------

/// Объект ответа из пар «ключ, значение» в том же порядке.
fn record<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Готовый файл выхода и то, что про него пишется в ответ.
struct Artifact {
    file: String,
    bytes: Vec<u8>,
    semantic: Value,
}

/// Пишет файлы по порядку (на сбое остаются записанные ранее) и собирает ответ.
fn publish(folder: &Path, artifacts: Vec<Artifact>) -> Result<Value> {
    let mut files = Vec::with_capacity(artifacts.len());
    for artifact in artifacts {
        write_atomic(&folder.join(&artifact.file), &artifact.bytes)?;
        files.push(record([
            ("file", artifact.file.into()),
            ("bytes", artifact.bytes.len().into()),
            ("sha256", sha256_hex(&artifact.bytes).into()),
            ("semantic", artifact.semantic),
        ]));
    }
    Ok(record([
        ("format", words::ANSWER.into()),
        ("version", words::VERSION.into()),
        ("files", Value::Array(files)),
    ]))
}

/// Папка вывода: нет — создаётся целиком, есть и пуста — годится, всё остальное (в том числе файл) — отказ.
fn open_folder(options: &Options) -> Result<PathBuf> {
    let folder = paths::full_path(options.required("output")?)?;
    let busy = fs::read_dir(&folder)
        .map_or_else(|_| folder.exists(), |mut entries| entries.next().is_some());
    if busy {
        return Err(emblem::refuse("Папка вывода меток не пуста"));
    }
    fs::create_dir_all(&folder)?;
    Ok(folder)
}

/// Обработчик команды: запрос читается и проверяется целиком, потом мод, доноры, папка, модели и запись.
pub fn compile_climb_markers(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = Request::load(options)?;
    let compiled = request.rebuild_mod()?;
    let studio = Studio::open(&request)?;
    let created = FreshDirs::at(options.required("output"));
    let folder = open_folder(options)?;
    let mut artifacts = Vec::with_capacity(request.markers.len() + 2);
    for marker in &request.markers {
        artifacts.push(studio.build(marker)?);
    }
    artifacts.push(request.types_artifact(compiled.types));
    artifacts.push(request.map_artifact(compiled.map));
    let answer = publish(&folder, artifacts)?;
    created.keep();
    Ok(answer)
}

pub const COMMANDS: &[Command] = &[Command::new("compile-climb-markers", compile_climb_markers)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use serde_json::json;

    struct Bench {
        dir: tempfile::TempDir,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        /// Путь внутри стенда со звеньями через разделитель системы.
        fn at(&self, name: &str) -> std::path::PathBuf {
            name.split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
        }

        fn path(&self, name: &str) -> String {
            self.at(name).to_string_lossy().into_owned()
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.at(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        }

        /// Запрос в файл и запуск команды; `output` — параметр `--output`, если он нужен.
        fn exec(&self, request: &Value, output: Option<&str>) -> (Value, i32) {
            let input = self.put("request.json", request.to_string().as_bytes());
            let mut argv = vec![
                "compile-climb-markers".to_owned(),
                "--input".to_owned(),
                input,
            ];
            if let Some(folder) = output {
                argv.extend(["--output".to_owned(), folder.to_owned()]);
            }
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }

        fn exec_raw(&self, args: &[&str]) -> (Value, i32) {
            let mut argv = vec!["compile-climb-markers".to_owned()];
            argv.extend(args.iter().map(|arg| (*arg).to_owned()));
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }
    }

    // -- входы из описания -------------------------------------------------------------------------------------

    fn sample(name: &str) -> Vec<u8> {
        std::fs::read(crate::test_support::engine(&format!(
            "parity/host-port/climb/{name}"
        )))
        .unwrap()
    }

    /// DDS из описания: шапка в 128 байт и данные, где байт `i` файла равен `(31·i + 7) mod 256`.
    fn dds(width: u32, height: u32, levels: u32, fourcc: &[u8; 4], flags: u32) -> Vec<u8> {
        let block = if fourcc == b"DXT1" { 8 } else { 16 };
        let data: usize = (0..levels)
            .map(|level| {
                let wide = (width >> level).max(1).div_ceil(4) as usize;
                let tall = (height >> level).max(1).div_ceil(4) as usize;
                wide * tall * block
            })
            .sum();
        let mut bytes = vec![0u8; 128];
        bytes[0..4].copy_from_slice(b"DDS ");
        for (at, value) in [
            (4, 124),
            (8, flags),
            (12, height),
            (16, width),
            (28, levels),
            (76, 32),
            (80, 4),
            (108, 0x1000),
        ] {
            bytes[at..at + 4].copy_from_slice(&u32::to_le_bytes(value));
        }
        bytes[84..88].copy_from_slice(fourcc);
        bytes.extend((128..128 + data).map(|index| (31 * index + 7) as u8));
        bytes
    }

    fn digest(bytes: &[u8]) -> String {
        format!("sha256:{}", sha256_hex(bytes))
    }

    fn marker_json(model: &str, texture: &str, sha: &str, quad: Value, back: &str) -> Value {
        json!({
            "model": model, "visible": true, "texture": texture, "textureSha256": sha,
            "width": 64, "height": 64, "quad": quad, "lit": true, "emissive": 0, "back": back,
        })
    }

    fn flat(axis: &str, facing: i64, depth: f64) -> Value {
        json!({
            "minX": -0.5, "minY": -0.25, "maxX": 0.5, "maxY": 0.25,
            "front": depth, "back": -depth, "axis": axis, "facing": facing,
        })
    }

    /// Базовый запрос из описания; пути — в папке стенда.
    fn base(bench: &Bench) -> Value {
        let picture = dds(64, 64, 7, b"DXT5", 0x0002_1007);
        let texture = bench.put("in/img64.dds", &picture);
        let sha = digest(&picture);
        bench.put("in/types.ytyp", &sample("mod3-types.ytyp"));
        bench.put("in/map.ymap", &sample("mod3-map.ymap"));
        let standing = json!({
            "minX": -0.25, "minY": -0.5, "maxX": 0.25, "maxY": 0.5,
            "front": -0.1, "back": 0.1, "axis": "y", "facing": -1,
        });
        json!({
            "format": "astral.compile-climb-markers",
            "version": 3,
            "donor": bench.path("in/donor.ydr"),
            "typesName": "climb_types",
            "types": bench.path("in/types.ytyp"),
            "map": { "name": "climb_map", "input": bench.path("in/map.ymap") },
            "markers": [
                marker_json("climb_a", &texture, &sha, flat("z", 1, 0.1), "readable"),
                marker_json("climb_b", &texture, &sha, flat("y", 1, 0.1), "readable"),
                marker_json("climb_c", &texture, &sha, standing, "none"),
            ],
        })
    }

    enum Edit {
        Set(&'static str, Value),
        Drop(&'static str),
    }
    use Edit::{Drop, Set};

    fn tweaked(request: &Value, edits: &[Edit]) -> Value {
        let mut doc = request.clone();
        for edit in edits {
            let (path, value) = match edit {
                Set(path, value) => (*path, Some(value.clone())),
                Drop(path) => (*path, None),
            };
            let (parent, key) = path.rsplit_once('/').unwrap();
            let target = doc.pointer_mut(parent).unwrap_or_else(|| panic!("{path}"));
            match (target, value) {
                (Value::Object(map), Some(value)) => {
                    map.insert(key.to_owned(), value);
                }
                (Value::Object(map), None) => {
                    map.remove(key).unwrap_or_else(|| panic!("{path}"));
                }
                (Value::Array(items), Some(value)) => {
                    let at: usize = key.parse().unwrap();
                    if at == items.len() {
                        items.push(value);
                    } else {
                        items[at] = value;
                    }
                }
                _ => panic!("{path}"),
            }
        }
        doc
    }

    fn marker_a(request: &Value) -> Value {
        request["markers"][0].clone()
    }

    fn with_markers(request: &Value, markers: Vec<Value>) -> Value {
        tweaked(request, &[Set("/markers", Value::Array(markers))])
    }

    // -- разбор меток: порядок проверок и тексты ------------------------------------------------------------------

    const NAME: &str = "Climb marker model must be a lowercase asset name.";
    const QUAD: &str = "has an invalid quad.";
    const AXIS: &str = "has an unknown axis or facing.";
    const DEPTH: &str = "has an invalid depth.";
    const SIZE: &str = "texture size must be a power of two 4…2048.";
    const SHA: &str = "has an invalid texture SHA-256.";
    const RANGE: &str = "emissive multiplier is out of range.";
    const NO_PICTURE: &str = "Метка без картинки: пока на хосте.";
    const LIST: &str = "В запросе меток нет списка: пока на хосте.";
    const COUNT: &str = "Climb markers request must list 1–32 markers.";

    fn a(tail: &str) -> String {
        format!("Climb marker climb_a {tail}")
    }

    fn read_markers(request: &Value) -> std::result::Result<Vec<Marker>, String> {
        Marker::read_all(Doc(request)).map_err(|error| {
            assert_eq!(error.code, "ArgumentException");
            error.message
        })
    }

    #[test]
    fn marker_table_from_the_description() {
        let bench = Bench::new();
        let request = base(&bench);
        let long = "a".repeat(41);
        let edge = "a".repeat(40);
        let cases: Vec<(&str, Vec<Edit>, Option<String>)> = vec![
            ("C60", vec![Drop("/markers")], Some(LIST.into())),
            ("C61", vec![Set("/markers", json!({}))], Some(LIST.into())),
            ("C62", vec![Set("/markers", json!([]))], Some(COUNT.into())),
            ("C65", vec![Set("/markers", json!([5]))], Some(NAME.into())),
            (
                "C66",
                vec![Set("/markers", json!([null]))],
                Some(NAME.into()),
            ),
            ("C67", vec![Drop("/markers/0/model")], Some(NAME.into())),
            (
                "C68",
                vec![Set("/markers/0/model", json!("Climb_a"))],
                Some(NAME.into()),
            ),
            (
                "C69",
                vec![Set("/markers/0/model", json!(long))],
                Some(NAME.into()),
            ),
            ("C70", vec![Set("/markers/0/model", json!(edge))], None),
            (
                "C71",
                vec![Set("/markers/0/model", json!(""))],
                Some(NAME.into()),
            ),
            (
                "C72",
                vec![Set("/markers/0/model", json!("climb-a"))],
                Some(NAME.into()),
            ),
            (
                "C73",
                vec![Set("/markers/0/model", json!("climb a.ydr"))],
                Some(NAME.into()),
            ),
            (
                "C74",
                vec![Set("/markers/0/model", json!(5))],
                Some(NAME.into()),
            ),
            (
                "C75",
                vec![Set("/markers/0/model", json!("метка"))],
                Some(NAME.into()),
            ),
            (
                "C76",
                vec![Set("/markers/1/model", json!("climb_a"))],
                Some("Climb marker climb_a is listed twice.".into()),
            ),
            (
                "C77",
                vec![Drop("/markers/0/lit")],
                Some(a("has no lit flag.")),
            ),
            (
                "C78",
                vec![Set("/markers/0/lit", json!("true"))],
                Some(a("has no lit flag.")),
            ),
            (
                "C79",
                vec![Set("/markers/0/lit", json!(1))],
                Some(a("has no lit flag.")),
            ),
            (
                "C80",
                vec![Drop("/markers/0/back")],
                Some(a("has an unknown back face.")),
            ),
            (
                "C81",
                vec![Set("/markers/0/back", json!("both"))],
                Some(a("has an unknown back face.")),
            ),
            (
                "C82",
                vec![Set("/markers/0/back", json!("Readable"))],
                Some(a("has an unknown back face.")),
            ),
            ("C83", vec![Drop("/markers/0/emissive")], Some(a(RANGE))),
            (
                "C84",
                vec![Set("/markers/0/emissive", json!(-0.5))],
                Some(a(RANGE)),
            ),
            ("C85", vec![Set("/markers/0/emissive", json!(16))], None),
            (
                "C86",
                vec![Set("/markers/0/emissive", json!(16.0001))],
                Some(a(RANGE)),
            ),
            (
                "C87",
                vec![Set("/markers/0/emissive", json!("2"))],
                Some(a(RANGE)),
            ),
            (
                "C88",
                vec![Set("/markers/0/emissive", json!(null))],
                Some(a(RANGE)),
            ),
            ("C89", vec![Set("/markers/0/emissive", json!(5))], None),
            (
                "C90",
                vec![Drop("/markers/0/visible")],
                Some(a("has no visible flag.")),
            ),
            (
                "C91",
                vec![Set("/markers/0/visible", json!("yes"))],
                Some(a("has no visible flag.")),
            ),
            (
                "C92",
                vec![Set("/markers/0/visible", json!(0))],
                Some(a("has no visible flag.")),
            ),
            (
                "C93",
                vec![Drop("/markers/0/lit"), Set("/markers/0/back", json!("zzz"))],
                Some(a("has no lit flag.")),
            ),
            (
                "C94",
                vec![
                    Set("/markers/0/emissive", json!(-1)),
                    Set("/markers/0/back", json!("zzz")),
                ],
                Some(a("has an unknown back face.")),
            ),
            (
                "C95",
                vec![
                    Drop("/markers/0/quad"),
                    Set("/markers/0/emissive", json!(-1)),
                ],
                Some(a(RANGE)),
            ),
            (
                "C96",
                vec![Drop("/markers/0/visible"), Drop("/markers/0/quad")],
                Some(a("has no quad.")),
            ),
            (
                "C97",
                vec![Set("/markers/1/model", json!("Bad"))],
                Some(NAME.into()),
            ),
            (
                "C100",
                vec![Drop("/markers/0/quad")],
                Some(a("has no quad.")),
            ),
            (
                "C101",
                vec![Set("/markers/0/quad", json!(3))],
                Some(a("has no quad.")),
            ),
            (
                "C102",
                vec![Set("/markers/0/quad", json!(null))],
                Some(a("has no quad.")),
            ),
            ("C103", vec![Drop("/markers/0/quad/minX")], Some(a(QUAD))),
            (
                "C104",
                vec![Set("/markers/0/quad/minX", json!("-0.5"))],
                Some(a(QUAD)),
            ),
            (
                "C105",
                vec![Set("/markers/0/quad/minX", json!(0.5))],
                Some(a(QUAD)),
            ),
            (
                "C106",
                vec![Set("/markers/0/quad/minX", json!(0.6))],
                Some(a(QUAD)),
            ),
            (
                "C107",
                vec![Set("/markers/0/quad/minY", json!(0.25))],
                Some(a(QUAD)),
            ),
            ("C108", vec![Set("/markers/0/quad/maxX", json!(4))], None),
            (
                "C109",
                vec![Set("/markers/0/quad/maxX", json!(4.0001))],
                Some(a(QUAD)),
            ),
            ("C110", vec![Set("/markers/0/quad/minX", json!(-4))], None),
            (
                "C111",
                vec![Set("/markers/0/quad/minY", json!(-4.5))],
                Some(a(QUAD)),
            ),
            ("C112", vec![Drop("/markers/0/quad/axis")], Some(a(AXIS))),
            (
                "C113",
                vec![Set("/markers/0/quad/axis", json!("x"))],
                Some(a(AXIS)),
            ),
            (
                "C114",
                vec![Set("/markers/0/quad/axis", json!("Z"))],
                Some(a(AXIS)),
            ),
            (
                "C115",
                vec![Set("/markers/0/quad/axis", json!(1))],
                Some(a(AXIS)),
            ),
            ("C116", vec![Drop("/markers/0/quad/facing")], Some(a(AXIS))),
            (
                "C117",
                vec![Set("/markers/0/quad/facing", json!(0))],
                Some(a(AXIS)),
            ),
            (
                "C118",
                vec![Set("/markers/0/quad/facing", json!(2))],
                Some(a(AXIS)),
            ),
            (
                "C119",
                vec![Set("/markers/0/quad/facing", json!(1.0))],
                Some(a(AXIS)),
            ),
            (
                "C120",
                vec![Set("/markers/0/quad/facing", json!("1"))],
                Some(a(AXIS)),
            ),
            ("C121", vec![Drop("/markers/0/quad/front")], Some(a(QUAD))),
            ("C122", vec![Drop("/markers/0/quad/back")], Some(a(QUAD))),
            (
                "C123",
                vec![Set("/markers/0/quad/front", json!(0.25))],
                None,
            ),
            (
                "C124",
                vec![Set("/markers/0/quad/front", json!(0.2501))],
                Some(a(DEPTH)),
            ),
            (
                "C125",
                vec![Set("/markers/0/quad/back", json!(-0.25))],
                None,
            ),
            (
                "C126",
                vec![Set("/markers/0/quad/back", json!(-0.2501))],
                Some(a(DEPTH)),
            ),
            (
                "C127",
                vec![Set("/markers/0/quad/back", json!(0.1))],
                Some(a(DEPTH)),
            ),
            (
                "C128",
                vec![
                    Set("/markers/0/quad/front", json!(-0.1)),
                    Set("/markers/0/quad/back", json!(0.1)),
                ],
                Some(a(DEPTH)),
            ),
            (
                "C129",
                vec![Set("/markers/0/quad/facing", json!(-1))],
                Some(a(DEPTH)),
            ),
            (
                "C130",
                vec![
                    Set("/markers/0/quad/maxX", json!(5)),
                    Set("/markers/0/quad/axis", json!("q")),
                ],
                Some(a(QUAD)),
            ),
            (
                "C131",
                vec![
                    Set("/markers/0/quad/axis", json!("q")),
                    Set("/markers/0/quad/facing", json!(9)),
                ],
                Some(a(AXIS)),
            ),
            (
                "C132",
                vec![
                    Set("/markers/0/quad/front", json!(5)),
                    Set("/markers/0/quad/facing", json!(9)),
                ],
                Some(a(AXIS)),
            ),
            (
                "C133",
                vec![Drop("/markers/0/quad/front"), Drop("/markers/0/quad/back")],
                Some(a(QUAD)),
            ),
            (
                "C340",
                vec![Set("/markers/0/quad/maxX", json!(1e39))],
                Some(a(QUAD)),
            ),
            (
                "C341",
                vec![Set("/markers/0/quad/maxX", json!(4.00000001))],
                None,
            ),
            (
                "C342",
                vec![Set("/markers/0/quad/maxX", json!(4.0000005))],
                Some(a(QUAD)),
            ),
            (
                "C343",
                vec![Set("/markers/0/quad/front", json!(0.25000001))],
                None,
            ),
            (
                "C344",
                vec![Set("/markers/0/emissive", json!(16.0000000001))],
                Some(a(RANGE)),
            ),
            (
                "C140",
                vec![Drop("/markers/0/texture")],
                Some(NO_PICTURE.into()),
            ),
            (
                "C141",
                vec![Set("/markers/0/texture", json!(5))],
                Some(NO_PICTURE.into()),
            ),
            ("C142", vec![Drop("/markers/0/width")], Some(a(SIZE))),
            (
                "C143",
                vec![Set("/markers/0/width", json!(3))],
                Some(a(SIZE)),
            ),
            (
                "C144",
                vec![Set("/markers/0/width", json!(4096))],
                Some(a(SIZE)),
            ),
            (
                "C145",
                vec![Set("/markers/0/height", json!(0))],
                Some(a(SIZE)),
            ),
            (
                "C146",
                vec![Set("/markers/0/width", json!("64"))],
                Some(a(SIZE)),
            ),
            (
                "C147",
                vec![Set("/markers/0/width", json!(64.0))],
                Some(a(SIZE)),
            ),
            ("C148", vec![Drop("/markers/0/textureSha256")], Some(a(SHA))),
            (
                "C149",
                vec![Set(
                    "/markers/0/textureSha256",
                    json!("3d71b5aa88a1c008c0f5fa7461f66e412f2cfeb57a615017d618c05c44ddd7c8"),
                )],
                Some(a(SHA)),
            ),
            (
                "C150",
                vec![Set(
                    "/markers/0/textureSha256",
                    json!(
                        "sha256:3D71B5AA88A1C008C0F5FA7461F66E412F2CFEB57A615017D618C05C44DDD7C8"
                    ),
                )],
                Some(a(SHA)),
            ),
            (
                "C151",
                vec![Set(
                    "/markers/0/textureSha256",
                    json!("sha256:3d71b5aa88a1c008c0f5fa7461f66e412f2cfeb57a615017d618c05c44ddd7c"),
                )],
                Some(a(SHA)),
            ),
            (
                "C162",
                vec![
                    Set("/markers/0/visible", json!(false)),
                    Drop("/markers/0/texture"),
                    Drop("/markers/0/textureSha256"),
                    Drop("/markers/0/width"),
                    Drop("/markers/0/height"),
                ],
                None,
            ),
            (
                "C163",
                vec![
                    Set("/markers/0/visible", json!(false)),
                    Set("/markers/0/texture", json!(5)),
                    Set("/markers/0/textureSha256", json!(1)),
                    Set("/markers/0/width", json!("x")),
                ],
                None,
            ),
            (
                "C164",
                vec![
                    Set("/markers/0/textureSha256", json!("x")),
                    Set("/markers/0/width", json!(3)),
                ],
                Some(a(SIZE)),
            ),
            (
                "C165",
                vec![
                    Drop("/markers/0/texture"),
                    Set("/markers/0/width", json!(3)),
                ],
                Some(NO_PICTURE.into()),
            ),
            (
                "C253",
                vec![
                    Set("/markers/0/lit", json!(false)),
                    Set("/markers/0/emissive", json!(0)),
                ],
                Some(a("glows with a zero multiplier.")),
            ),
            (
                "C345",
                vec![
                    Set("/markers/0/lit", json!(false)),
                    Set("/markers/0/emissive", json!(1e-300)),
                ],
                None,
            ),
            (
                "C346",
                vec![
                    Set("/markers/0/lit", json!(false)),
                    Set("/markers/0/emissive", json!(1e-50)),
                ],
                None,
            ),
        ];
        for (id, edits, expected) in cases {
            let outcome = read_markers(&tweaked(&request, &edits));
            match (outcome, expected) {
                (Ok(_), None) => {}
                (Err(message), Some(expected)) => assert_eq!(message, expected, "{id}"),
                (other, expected) => {
                    panic!("{id}: {:?} против {expected:?}", other.map(|_| "принято"))
                }
            }
        }
        let many: Vec<Value> = (0..33).map(|_| marker_a(&request)).collect();
        assert_eq!(
            read_markers(&with_markers(&request, many)).err().unwrap(),
            COUNT,
            "C63"
        );
    }

    #[test]
    fn copies_must_be_front_only_copies_of_listed_markers() {
        let bench = Bench::new();
        let request = base(&bench);
        let copy = |model: &str, source: Value, back: &str| {
            let mut marker = marker_a(&request);
            marker["model"] = json!(model);
            marker["archetype"] = source;
            marker["back"] = json!(back);
            marker
        };
        let message = |model: &str| {
            format!("Climb marker copy {model} must be a front-only copy of a listed marker.")
        };
        let with = |extra: Vec<Value>| {
            let mut all = request["markers"].as_array().unwrap().clone();
            all.extend(extra);
            read_markers(&with_markers(&request, all)).map(|found| found.len())
        };
        assert_eq!(
            with(vec![copy("climb_d", json!("climb_a"), "none")]),
            Ok(4),
            "C170"
        );
        assert_eq!(
            with(vec![copy("climb_d", json!("climb_zz"), "none")]),
            Err(message("climb_d")),
            "C172"
        );
        assert_eq!(
            with(vec![copy("climb_d", json!("climb_a"), "readable")]),
            Err(message("climb_d")),
            "C173"
        );
        let chain = vec![
            copy("climb_d", json!("climb_a"), "none"),
            copy("climb_e", json!("climb_d"), "none"),
        ];
        assert_eq!(with(chain), Err(message("climb_e")), "C174");
        assert_eq!(
            with(vec![copy("climb_d", json!(null), "none")]),
            Ok(4),
            "C175"
        );
        assert_eq!(
            with(vec![copy("climb_d", json!(5), "none")]),
            Err(NAME.to_owned()),
            "C176"
        );
        assert_eq!(
            with(vec![copy("climb_d", json!("Climb_a"), "none")]),
            Err(NAME.to_owned()),
            "C177"
        );
        let own = vec![copy("climb_d", json!("climb_d"), "none")];
        assert_eq!(with(own), Err(message("climb_d")));
    }

    // -- геометрия плашки: дампы из описания ----------------------------------------------------------------------

    fn quad_of(request: &Value, index: usize) -> Quad {
        Quad::read(Doc(&request["markers"][index]), "climb_a").expect("квад")
    }

    fn corners_of(mesh: &Mesh) -> Vec<String> {
        mesh.vertices
            .iter()
            .map(|v| {
                format!(
                    "{} {} {} | {} {} {} | {} {}",
                    v[0],
                    v[1],
                    v[2],
                    v[3] + 0.0,
                    v[4] + 0.0,
                    v[5] + 0.0,
                    v[6],
                    v[7]
                )
            })
            .collect()
    }

    #[test]
    fn quads_lay_out_as_the_dumps_do() {
        let bench = Bench::new();
        let request = base(&bench);
        // C300, climb_a: ось z, лицо к +z, спина читается.
        let mesh = quad_of(&request, 0).mesh(true);
        assert_eq!(mesh.shader, 0);
        assert_eq!(mesh.indices, [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
        assert_eq!(
            corners_of(&mesh),
            [
                "-0.5 -0.25 0.1 | 0 0 1 | 0 1",
                "0.5 -0.25 0.1 | 0 0 1 | 1 1",
                "0.5 0.25 0.1 | 0 0 1 | 1 0",
                "-0.5 0.25 0.1 | 0 0 1 | 0 0",
                "-0.5 -0.25 -0.1 | 0 0 -1 | 1 1",
                "0.5 -0.25 -0.1 | 0 0 -1 | 0 1",
                "0.5 0.25 -0.1 | 0 0 -1 | 0 0",
                "-0.5 0.25 -0.1 | 0 0 -1 | 1 0",
            ]
        );
        // C311: ось z, взгляд к −z.
        let looking_down = tweaked(
            &request,
            &[
                Set("/markers/0/quad/front", json!(-0.1)),
                Set("/markers/0/quad/back", json!(0.1)),
                Set("/markers/0/quad/facing", json!(-1)),
            ],
        );
        let mesh = quad_of(&looking_down, 0).mesh(true);
        assert_eq!(corners_of(&mesh)[0], "0.5 -0.25 -0.1 | 0 0 -1 | 0 1");
        assert_eq!(corners_of(&mesh)[1], "-0.5 -0.25 -0.1 | 0 0 -1 | 1 1");
        assert_eq!(corners_of(&mesh)[4], "0.5 -0.25 0.1 | 0 0 1 | 1 1");
        assert_eq!(corners_of(&mesh)[7], "0.5 0.25 0.1 | 0 0 1 | 1 0");
        // C312: ось y, взгляд к +y.
        let mesh = quad_of(&request, 1).mesh(true);
        assert_eq!(corners_of(&mesh)[0], "0.5 0.1 -0.25 | 0 1 0 | 0 1");
        assert_eq!(corners_of(&mesh)[2], "-0.5 0.1 0.25 | 0 1 0 | 1 0");
        assert_eq!(corners_of(&mesh)[4], "0.5 -0.1 -0.25 | 0 -1 0 | 1 1");
        assert_eq!(corners_of(&mesh)[6], "-0.5 -0.1 0.25 | 0 -1 0 | 0 0");
        // C313 и C300 climb_c: ось y, взгляд к −y; без спины четыре вершины.
        let standing = quad_of(&request, 2);
        let mesh = standing.mesh(true);
        assert_eq!(corners_of(&mesh)[0], "-0.25 -0.1 -0.5 | 0 -1 0 | 0 1");
        assert_eq!(corners_of(&mesh)[2], "0.25 -0.1 0.5 | 0 -1 0 | 1 0");
        assert_eq!(corners_of(&mesh)[4], "-0.25 0.1 -0.5 | 0 1 0 | 1 1");
        assert_eq!(corners_of(&mesh)[7], "-0.25 0.1 0.5 | 0 1 0 | 1 0");
        let front_only = standing.mesh(false);
        assert_eq!(front_only.vertices.len(), 4);
        assert_eq!(front_only.indices, [0, 1, 2, 0, 2, 3]);
        assert_eq!(corners_of(&front_only)[3], "-0.25 -0.1 0.5 | 0 -1 0 | 0 0");
    }

    /// Нормаль спины — лицевая, повёрнутая в обратную сторону: нулевые компоненты остаются +0.0.
    /// Отрицание давало -0.0, и байты вершин в .ydr расходились с прежним выходом (старший бит у нуля).
    /// Отказ после создания папки вывода убирает созданное (раньше пустая папка оставалась, C336).
    #[test]
    fn a_late_refusal_removes_the_folder_it_created() {
        let donor = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../resources/climbs/panika1z.ydr");
        let Ok(donor_bytes) = std::fs::read(&donor) else {
            eprintln!("донор из resources недоступен: пропущено");
            return;
        };
        let bench = Bench::new();
        bench.put("in/donor.ydr", &donor_bytes);
        // Хеш картинки не тот: отказ приходит, когда папка вывода уже создана.
        let bad = tweaked(
            &base(&bench),
            &[Set(
                "/markers/2/textureSha256",
                json!(format!("sha256:{}", "0".repeat(64))),
            )],
        );
        let out = bench.path("made/by/failure");
        let reply = bench.exec(&bad, Some(&out));
        assert_eq!(reply.1, 1, "{}", reply.0);
        assert!(!std::path::Path::new(&bench.path("made")).exists());
    }

    #[test]
    fn the_back_normal_keeps_its_zero_components_positive() {
        let bench = Bench::new();
        let request = base(&bench);
        for index in 0..3 {
            let mesh = quad_of(&request, index).mesh(true);
            for vertex in &mesh.vertices {
                for component in &vertex[3..6] {
                    assert_ne!(
                        component.to_bits(),
                        (-0.0f32).to_bits(),
                        "marker {index}: {vertex:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn the_frame_covers_both_faces_even_without_a_back() {
        let bench = Bench::new();
        let request = base(&bench);
        assert_eq!(
            quad_of(&request, 0).frame(),
            ([-0.5, -0.25, -0.1], [0.5, 0.25, 0.1])
        );
        assert_eq!(
            quad_of(&request, 1).frame(),
            ([-0.5, -0.1, -0.25], [0.5, 0.1, 0.25])
        );
        assert_eq!(
            quad_of(&request, 2).frame(),
            ([-0.25, -0.1, -0.5], [0.25, 0.1, 0.5])
        );
    }

    #[test]
    fn names_and_hashes_follow_the_host_rule() {
        let name = |text: &str| lowercase_name(Some(&json!(text))).is_some();
        assert!(name("a") && name("climb_a1") && name(&"z".repeat(40)));
        assert!(!name("") && !name("Aa") && !name("a-b") && !name(&"z".repeat(41)) && !name("é"));
        assert!(lowercase_name(Some(&json!(5))).is_none() && lowercase_name(None).is_none());
        let sha = "sha256:3d71b5aa88a1c008c0f5fa7461f66e412f2cfeb57a615017d618c05c44ddd7c8";
        assert!(is_digest(sha));
        assert!(!is_digest(&sha[7..]) && !is_digest(&sha.to_uppercase()) && !is_digest(&sha[..70]));
        assert!(!is_digest("sha256:") && !is_digest(&format!("{sha}0")));
    }

    #[test]
    fn the_sample_picture_is_rebuilt_byte_for_byte() {
        let picture = dds(64, 64, 7, b"DXT5", 0x0002_1007);
        assert_eq!(
            digest(&picture),
            "sha256:3d71b5aa88a1c008c0f5fa7461f66e412f2cfeb57a615017d618c05c44ddd7c8"
        );
        let nomip = dds(64, 64, 7, b"DXT5", 0x0000_1007);
        assert_eq!(
            digest(&nomip),
            "sha256:4989fb3904af588c1f3d7d636809b5cf6dd5f6f011e4a8fa51d4620adfe184d6"
        );
        let dxt1 = dds(64, 64, 7, b"DXT1", 0x0002_1007);
        assert_eq!(
            digest(&dxt1),
            "sha256:b21608efc442c58ae7e4052d1b4bb01046fc0819f23b9d7954dfdbea4825e02b"
        );
        assert_eq!(
            digest(&dds(4, 4, 3, b"DXT5", 0x0002_1007)),
            "sha256:a871359e86bd756e065079b6bff3b9b6d4e34376fc4af80cb6fa0cbecb906af0"
        );
        assert_eq!(
            digest(&dds(128, 64, 8, b"DXT5", 0x0002_1007)),
            "sha256:663098e27aca5bc8100e4173c1cee31686823f3e8e229f015fad134e4ba85cd6"
        );
    }

    // -- команда целиком: отказы до донора, параметры, запрос --------------------------------------------------------

    fn failure(outcome: &(Value, i32)) -> (String, String) {
        assert_eq!(outcome.1, 1, "{}", outcome.0);
        assert_eq!(outcome.0["ok"], json!(false));
        let error = &outcome.0["error"];
        (
            error["code"].as_str().unwrap().to_owned(),
            error["message"].as_str().unwrap().to_owned(),
        )
    }

    fn refused(code: &str, message: &str) -> (String, String) {
        (code.to_owned(), message.to_owned())
    }

    fn argument(message: &str) -> (String, String) {
        refused("ArgumentException", message)
    }

    fn host(what: &str) -> (String, String) {
        argument(&format!("{what}: пока на хосте."))
    }

    fn missing_donor() -> (String, String) {
        refused("sign-donor-missing", "Донор меток не найден.")
    }

    #[test]
    fn parameters_are_checked_before_the_request() {
        let bench = Bench::new();
        let output = bench.path("out");
        let cases: Vec<(&str, Vec<&str>, (String, String))> = vec![
            ("C1", vec![], argument("--input is required.")),
            (
                "C2",
                vec!["--output", &output],
                argument("--input is required."),
            ),
            (
                "C3",
                vec!["--input", "", "--output", &output],
                argument("The path is empty."),
            ),
            (
                "C4",
                vec!["--input", "   ", "--output", &output],
                argument("The path is empty."),
            ),
            (
                "C14",
                vec!["--input", "--output"],
                argument("A value is required for --input."),
            ),
            (
                "C15",
                vec!["--input"],
                argument("A value is required for --input."),
            ),
            (
                "C16",
                vec!["input"],
                argument("Invalid native option: input"),
            ),
        ];
        for (id, args, expected) in cases {
            assert_eq!(failure(&bench.exec_raw(&args)), expected, "{id}");
        }
        let nowhere = bench.path("nope.json");
        let denied = failure(&bench.exec_raw(&["--input", &nowhere, "--output", &output]));
        assert_eq!(
            denied,
            refused(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "C5"
        );
        let folder = bench.path("in");
        std::fs::create_dir_all(&folder).unwrap();
        let denied = failure(&bench.exec_raw(&["--input", &folder, "--output", &output]));
        assert_eq!(
            denied,
            refused(
                "FileNotFoundException",
                &format!("File was not found: {folder}")
            ),
            "C6"
        );
        let text = bench.put("req.txt", b"{}");
        let denied = failure(&bench.exec_raw(&["--input", &text, "--output", &output]));
        assert_eq!(denied, argument("Unsupported file extension: .txt"), "C7");
        assert!(!std::path::Path::new(&output).exists());
    }

    #[test]
    fn the_request_file_is_read_by_size_then_as_json_then_by_format() {
        let bench = Bench::new();
        let request = base(&bench);
        let out = bench.path("out");
        let try_file = |name: &str, bytes: &[u8]| {
            let input = bench.put(name, bytes);
            failure(&bench.exec_raw(&["--input", &input, "--output", &out]))
        };
        let text = request.to_string();
        assert_eq!(
            try_file("empty.json", b""),
            host("Запрос меток вне размера"),
            "C20"
        );
        let padded = |size: usize| {
            let mut bytes = text.clone().into_bytes();
            bytes.resize(size, b' ');
            bytes
        };
        assert_eq!(
            try_file("full.json", &padded(262_144)),
            missing_donor(),
            "C21"
        );
        assert_eq!(
            try_file("over.json", &padded(262_145)),
            host("Запрос меток вне размера"),
            "C22"
        );
        assert_eq!(
            try_file("c23.json", b"this is not json"),
            host("Запрос меток не читается"),
            "C23"
        );
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(text.as_bytes());
        assert_eq!(
            try_file("c33.json", &bom),
            host("Запрос меток не читается"),
            "C33"
        );
        assert_eq!(
            try_file("c34.json", format!("{text} tail").as_bytes()),
            host("Запрос меток не читается"),
            "C34"
        );
        assert_eq!(
            try_file("blank.json", b"   \n"),
            host("Запрос меток не читается")
        );
        for (id, body) in [("C24", "[]"), ("C25", "null"), ("C26", "{}")] {
            assert_eq!(
                try_file("c.json", body.as_bytes()),
                host("Запрос меток другого формата"),
                "{id}"
            );
        }
        let wrong = [
            ("C27", Set("/format", json!("astral.other"))),
            ("C28", Set("/version", json!(2))),
            ("C29", Set("/version", json!("3"))),
            ("C31", Set("/version", json!(4))),
            ("C32", Set("/format", json!(5))),
        ];
        for (id, edit) in wrong {
            let body = tweaked(&request, &[edit]).to_string();
            assert_eq!(
                try_file("c.json", body.as_bytes()),
                host("Запрос меток другого формата"),
                "{id}"
            );
        }
        let fractional = text.replace("\"version\":3", "\"version\":3.0");
        assert_eq!(
            try_file("c30.json", fractional.as_bytes()),
            host("Запрос меток другого формата"),
            "C30"
        );
        let extra = tweaked(
            &request,
            &[Set("/extra", json!(1)), Set("/emissiveDonor", json!(null))],
        )
        .to_string();
        assert_eq!(
            try_file("c35.json", extra.as_bytes()),
            missing_donor(),
            "C35"
        );
        assert!(!std::path::Path::new(&out).exists());
    }

    #[test]
    fn request_fields_are_checked_in_the_documented_order() {
        let bench = Bench::new();
        let request = base(&bench);
        let go = |edits: &[Edit]| {
            failure(&bench.exec(&tweaked(&request, edits), Some(&bench.path("out"))))
        };
        let no_donor = host("Метки без донора");
        assert_eq!(go(&[Drop("/donor")]), no_donor, "C40");
        assert_eq!(go(&[Set("/donor", json!(5))]), no_donor, "C41");
        assert_eq!(go(&[Set("/donor", json!(null))]), no_donor, "C42");
        assert_eq!(go(&[Set("/donor", json!(""))]), missing_donor(), "C43");
        assert_eq!(
            go(&[Set("/donor", json!(bench.path("in")))]),
            missing_donor(),
            "C45"
        );
        assert_eq!(go(&[Drop("/donor"), Drop("/markers")]), no_donor);
        assert_eq!(
            go(&[
                Set("/donor", json!(bench.path("none.ydr"))),
                Drop("/markers")
            ]),
            host("В запросе меток нет списка"),
            "C50"
        );
        // Мод читается и пересобирается раньше донора.
        let bad_name = argument(NAME);
        assert_eq!(go(&[Drop("/typesName")]), bad_name, "C190");
        assert_eq!(
            go(&[Set("/typesName", json!("Climb_types"))]),
            bad_name,
            "C191"
        );
        assert_eq!(go(&[Set("/typesName", json!(""))]), bad_name, "C192");
        assert_eq!(
            go(&[Set("/typesName", json!("t".repeat(41)))]),
            bad_name,
            "C193"
        );
        assert_eq!(
            go(&[Drop("/types")]),
            host("В запросе нет типов мода"),
            "C194"
        );
        assert_eq!(
            go(&[Set("/types", json!(3))]),
            host("В запросе нет типов мода"),
            "C195"
        );
        assert_eq!(
            go(&[Drop("/map")]),
            host("В запросе нет карты мода"),
            "C196"
        );
        assert_eq!(
            go(&[Set("/map", json!("x"))]),
            host("В запросе нет карты мода"),
            "C197"
        );
        assert_eq!(
            go(&[Set("/map", json!([]))]),
            host("В запросе нет карты мода"),
            "C198"
        );
        assert_eq!(go(&[Drop("/map/name")]), bad_name, "C199");
        assert_eq!(
            go(&[Set("/map/name", json!("Climb_map"))]),
            bad_name,
            "C200"
        );
        assert_eq!(
            go(&[Drop("/map/input")]),
            host("В запросе нет карты мода"),
            "C201"
        );
        assert_eq!(
            go(&[Set("/map/input", json!(5))]),
            host("В запросе нет карты мода"),
            "C202"
        );
        assert_eq!(
            go(&[Set("/typesName", json!("Bad")), Drop("/types")]),
            bad_name,
            "C203"
        );
        assert_eq!(
            go(&[Drop("/types"), Drop("/map")]),
            host("В запросе нет типов мода"),
            "C204"
        );
        assert_eq!(
            go(&[Set("/map/name", json!("Bad")), Drop("/map/input")]),
            bad_name,
            "C205"
        );
        for (id, placements) in [
            ("C206", json!(5)),
            ("C207", json!({"rename": "x"})),
            ("C213", json!({"remove": 1})),
            ("C217", json!({"remove": []})),
            ("C218", json!({"rename": [], "remove": []})),
            ("C219", json!({})),
        ] {
            assert_eq!(
                go(&[Set("/placements", placements)]),
                missing_donor(),
                "{id}"
            );
        }
        let copy = |model: &str| {
            let mut marker = marker_a(&request);
            marker["model"] = json!(model);
            marker["archetype"] = json!("climb_a");
            marker["back"] = json!("none");
            marker
        };
        let four = {
            let mut all = request["markers"].as_array().unwrap().clone();
            all.push(copy("climb_d"));
            Value::Array(all)
        };
        let rename = |placements: Value| {
            go(&[
                Set("/markers", four.clone()),
                Set("/placements", placements),
            ])
        };
        let number = argument("Climb placement rename must give the place number.");
        assert_eq!(
            rename(json!({"rename": [{"archetype": "climb_d"}]})),
            number,
            "C208"
        );
        assert_eq!(
            rename(json!({"rename": [{"index": "0", "archetype": "climb_d"}]})),
            number,
            "C209"
        );
        assert_eq!(
            rename(json!({"rename": [{"index": -1, "archetype": "climb_d"}]})),
            number,
            "C210"
        );
        assert_eq!(rename(json!({"rename": [{"index": 0}]})), bad_name, "C211");
        assert_eq!(
            rename(json!({"rename": [{"index": 0, "archetype": "Climb_d"}]})),
            bad_name,
            "C212"
        );
        let removal = argument("Climb placement removal must list place numbers.");
        for (id, list) in [
            ("C214", json!([1, "x"])),
            ("C215", json!([-1])),
            ("C216", json!([1.0])),
        ] {
            assert_eq!(
                go(&[Set("/placements", json!({ "remove": list }))]),
                removal,
                "{id}"
            );
        }
        assert_eq!(
            rename(json!({"rename": [{"index": 1}, {"index": "x"}]})),
            bad_name
        );
    }

    #[test]
    fn mod_files_are_read_and_refused_as_the_description_says() {
        let bench = Bench::new();
        let request = base(&bench);
        let go = |edits: &[Edit]| {
            failure(&bench.exec(&tweaked(&request, edits), Some(&bench.path("out"))))
        };
        let nowhere = bench.path("in/nope.ytyp");
        assert_eq!(
            go(&[Set("/types", json!(nowhere))]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "C220"
        );
        let wrong = bench.put("in/types.bin", b"x");
        assert_eq!(
            go(&[Set("/types", json!(wrong))]),
            argument("Unsupported file extension: .bin"),
            "C221"
        );
        let folder = bench.path("in");
        assert_eq!(
            go(&[Set("/types", json!(folder))]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {folder}")
            ),
            "C222"
        );
        let garbage = bench.put("in/garbage.ytyp", b"junk");
        let short = refused("InvalidOperationException", "Ресурс короче заголовка RSC7.");
        assert_eq!(go(&[Set("/types", json!(garbage))]), short, "C223");
        let nowhere = bench.path("in/nope.ymap");
        assert_eq!(
            go(&[Set("/map/input", json!(nowhere))]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "C224"
        );
        assert_eq!(
            go(&[Set("/map/input", json!(bench.path("in/types.ytyp")))]),
            argument("Unsupported file extension: .ytyp"),
            "C225"
        );
        let garbage_map = bench.put("in/garbage.ymap", b"junk");
        assert_eq!(go(&[Set("/map/input", json!(garbage_map))]), short, "C226");
        assert_eq!(
            go(&[Set("/types", json!(bench.path("in/map.ymap")))]),
            argument("Unsupported file extension: .ymap"),
            "C227"
        );
        assert_eq!(
            go(&[Set("/map/name", json!("other_map"))]),
            argument("Climb map other_map.ymap has another name."),
            "C229"
        );
        let missing = argument("Every climb marker needs its own archetype in the types.");
        let mut with_z = request["markers"].as_array().unwrap().clone();
        let mut extra = marker_a(&request);
        extra["model"] = json!("climb_z");
        with_z.push(extra);
        assert_eq!(
            go(&[Set("/markers", Value::Array(with_z))]),
            missing,
            "C230"
        );
        let thirty_two: Vec<Value> = (0..32)
            .map(|index| {
                let mut marker = marker_a(&request);
                marker["model"] = json!(format!("m{index}"));
                marker
            })
            .collect();
        assert_eq!(
            go(&[Set("/markers", Value::Array(thirty_two))]),
            missing,
            "C64"
        );
        let long = marker_a(&request);
        let mut long = long;
        long["model"] = json!("a".repeat(40));
        assert_eq!(go(&[Set("/markers/0", long)]), missing, "C70");
        let removal = |list: Value| go(&[Set("/placements", json!({ "remove": list }))]);
        let apart = argument("Места для удаления вне расстановки или повторяются.");
        assert_eq!(removal(json!([3])), apart, "C231");
        assert_eq!(removal(json!([1, 1])), apart, "C232");
        assert_eq!(
            removal(json!([0, 1, 2])),
            host("Расстановка мода не может стать пустой"),
            "C233"
        );
        let two = with_markers(
            &request,
            vec![request["markers"][0].clone(), request["markers"][1].clone()],
        );
        let strange = go_on(
            &bench,
            &tweaked(&two, &[Set("/placements", json!({"remove": [2]}))]),
        );
        assert_eq!(
            strange,
            argument("Climb placement 2 is not a marker of this request."),
            "C236"
        );
        let renamed = |index: u64, copy: &str, extra: Value| {
            let mut marker = marker_a(&request);
            marker["model"] = json!("climb_d");
            marker["archetype"] = json!("climb_a");
            marker["back"] = json!("none");
            let mut all = request["markers"].as_array().unwrap().clone();
            all.push(marker);
            let mut placements = json!({ "rename": [{ "index": index, "archetype": copy }] });
            placements["remove"] = extra;
            go(&[
                Set("/markers", Value::Array(all)),
                Set("/placements", placements),
            ])
        };
        assert_eq!(
            renamed(9, "climb_d", json!([])),
            argument("Climb placement 9 is renamed but out of range or removed."),
            "C238"
        );
        assert_eq!(
            renamed(0, "climb_d", json!([0])),
            argument("Climb placement 0 is renamed but out of range or removed."),
            "C239"
        );
        assert_eq!(
            renamed(0, "climb_q", json!([])),
            argument("Climb placement 0 is renamed to an unknown copy."),
            "C241"
        );
        assert_eq!(
            renamed(1, "climb_d", json!([])),
            argument("Climb placement 1 is renamed to a copy of another marker."),
            "C242"
        );
        let clash = {
            let mut marker = request["markers"][1].clone();
            marker["archetype"] = json!("climb_a");
            marker["back"] = json!("none");
            marker["quad"]["axis"] = json!("z");
            go(&[Set("/markers/1", marker)])
        };
        assert_eq!(
            clash,
            argument("Climb marker copy climb_b collides with an archetype of the types."),
            "C179"
        );
        // Без этих ошибок запрос доходит до донора.
        assert_eq!(go(&[]), missing_donor());
    }

    fn go_on(bench: &Bench, request: &Value) -> (String, String) {
        failure(&bench.exec(request, Some(&bench.path("out"))))
    }

    #[test]
    fn donors_that_cannot_be_opened_say_why() {
        let bench = Bench::new();
        let request = base(&bench);
        let go = |path: &str| go_on(&bench, &tweaked(&request, &[Set("/donor", json!(path))]));
        let garbage = bench.put("in/garbage.bin", b"not a resource at all, just text");
        let empty = bench.put("in/empty.ydr", b"");
        let unreadable = refused("sign-donor-not-drawable", "Донор не читается как ресурс.");
        assert_eq!(go(&bench.path("in/nope.ydr")), missing_donor(), "C44");
        assert_eq!(go(&garbage), unreadable, "C46");
        assert_eq!(go(&empty), unreadable, "C47");
        let types = bench.path("in/types.ytyp");
        assert_eq!(
            go(&types),
            refused("sign-donor-not-drawable", "Донор — не рисовалка ydr."),
            "C48"
        );
        // Светящийся донор открывается, когда он строка, даже если светящихся меток нет.
        let probe =
            |donor: Value| go_on(&bench, &tweaked(&request, &[Set("/emissiveDonor", donor)]));
        assert_eq!(probe(json!(bench.path("in/nope.ydr"))), missing_donor());
        assert_eq!(probe(json!(5)), missing_donor());
        // Выход не создан ни на одном из этих отказов.
        assert!(!std::path::Path::new(&bench.path("out")).exists());
    }

    #[test]
    fn glowing_markers_need_a_glow_donor_only_after_the_main_donor_opens() {
        let bench = Bench::new();
        let request = base(&bench);
        let glowing = tweaked(
            &request,
            &[
                Set("/markers/0/lit", json!(false)),
                Set("/markers/0/emissive", json!(2)),
            ],
        );
        assert_eq!(
            go_on(&bench, &glowing),
            missing_donor(),
            "C338: главный донор раньше"
        );
    }

    // -- мод: хэши типов и карты из описания ------------------------------------------------------------------------

    fn rebuilt(request: &Value) -> (String, String) {
        let parsed = Request::read(Doc(request)).expect("запрос");
        let built = parsed.rebuild_mod().expect("мод");
        (sha256_hex(&built.types), sha256_hex(&built.map))
    }

    #[allow(clippy::too_many_arguments)]
    fn quad_json(
        min_x: f64,
        min_y: f64,
        max_x: f64,
        max_y: f64,
        front: f64,
        back: f64,
        axis: &str,
        facing: i64,
    ) -> Value {
        json!({ "minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y, "front": front, "back": back, "axis": axis, "facing": facing })
    }

    const TYPES_C300: &str = "4a507614a3e0d9102d2642077abaac277b54ec2210b9b4acbdcffcd666b6a8d7";
    const MAP_UNTOUCHED: &str = "197135c5ee1dd41c4cbcf8b6c28f0c1f070a28d63cb4a8cd9822a2f30dade50e";

    #[test]
    fn the_rebuilt_types_and_map_match_the_hashes_of_the_description() {
        let bench = Bench::new();
        let request = base(&bench);
        let remove = |list: Value| Set("/placements", json!({ "remove": list }));
        let (types, map) = rebuilt(&tweaked(&request, &[remove(json!([1]))]));
        assert_eq!(
            (types.as_str(), map.as_str()),
            (
                TYPES_C300,
                "9265fb2abdb1c6d29e3adab4886e69c1d0674c28edc1f057288b8619eef05ee4"
            ),
            "C300"
        );
        let (types, map) = rebuilt(&request);
        assert_eq!(
            (types.as_str(), map.as_str()),
            (TYPES_C300, MAP_UNTOUCHED),
            "C301"
        );
        let (types, _) = rebuilt(&tweaked(
            &request,
            &[Set("/typesName", json!("climb_types_2"))],
        ));
        assert_eq!(
            types, "567d0bab5cb42f2adca7755de4e39394b18d0b83c92d1efade6818e3c925f3d4",
            "C303"
        );
        let (_, map) = rebuilt(&tweaked(&request, &[remove(json!([2]))]));
        assert!(map.starts_with("7b3a2d5cdcb2"), "C234");
        let (_, map) = rebuilt(&tweaked(&request, &[remove(json!([2, 0]))]));
        assert!(map.starts_with("a4230e8e5d9f"), "C235");
        let (_, map) = rebuilt(&tweaked(&request, &[remove(json!([0]))]));
        assert_eq!(
            map, "63612d66d4885c80f27860ff75d2ac10ee156bab770c3969b3446aba19d15948",
            "C326"
        );
        for (id, edits, expected) in [
            (
                "C108",
                vec![Set("/markers/0/quad/maxX", json!(4))],
                "4de2a27e8c40e5499e6b272cc7214ccae5a596f1c4e3e6684493771325772461",
            ),
            (
                "C110",
                vec![Set("/markers/0/quad/minX", json!(-4))],
                "025459aee2cbcc9ea494b40012b5719ba0efac493f2ac778124f0c0869dddd5b",
            ),
            (
                "C323",
                vec![Set(
                    "/markers/0/quad",
                    quad_json(-2.0, -1.0, 2.0, 1.0, 0.2, -0.2, "z", 1),
                )],
                "470d1242fff7f77ebb0a501cfecac619b3f7b1194036d30bab5269216e7963cb",
            ),
            (
                "C324",
                vec![Set(
                    "/markers/0/quad",
                    quad_json(-0.1, -0.05, 0.1, 0.05, 0.01, -0.01, "z", 1),
                )],
                "a5817071eb7b4a9ac423162469c994bf15b1c320d0f040a503a6a731326eb581",
            ),
            (
                "C347",
                vec![Set(
                    "/markers/0/quad",
                    quad_json(
                        -0.00005, -0.00005, 0.00005, 0.00005, 0.0001, -0.0001, "z", 1,
                    ),
                )],
                "3cb761e78972c9444459ad2b792fcaad63b4846bec0f452c0112e73a024096d4",
            ),
            (
                "C310",
                vec![
                    Set(
                        "/markers/1/quad",
                        quad_json(-0.5, -0.25, 0.5, 0.25, 0.1, -0.1, "z", 1),
                    ),
                    Set(
                        "/markers/2/quad",
                        quad_json(-0.5, -0.25, 0.5, 0.25, 0.1, -0.1, "z", 1),
                    ),
                ],
                "bf103775336d115f6edfe61fa336a2f374cc8571319fa49d110c61aec4ca58e1",
            ),
            (
                "C311",
                vec![
                    Set(
                        "/markers/0/quad",
                        quad_json(-0.5, -0.25, 0.5, 0.25, -0.1, 0.1, "z", -1),
                    ),
                    Set(
                        "/markers/1/quad",
                        quad_json(-0.5, -0.25, 0.5, 0.25, -0.1, 0.1, "z", -1),
                    ),
                    Set(
                        "/markers/2/quad",
                        quad_json(-0.5, -0.25, 0.5, 0.25, -0.1, 0.1, "z", -1),
                    ),
                ],
                "bf103775336d115f6edfe61fa336a2f374cc8571319fa49d110c61aec4ca58e1",
            ),
            (
                "C312",
                vec![
                    Set(
                        "/markers/0/quad",
                        quad_json(-0.5, -0.25, 0.5, 0.25, 0.1, -0.1, "y", 1),
                    ),
                    Set(
                        "/markers/2/quad",
                        quad_json(-0.5, -0.25, 0.5, 0.25, 0.1, -0.1, "y", 1),
                    ),
                ],
                "f8715fa5dd252e27e3d70fb3c1b12406c587819acb538d9762a0167b0244fd3d",
            ),
            (
                "C313",
                vec![
                    Set(
                        "/markers/0/quad",
                        quad_json(-0.25, -0.5, 0.25, 0.5, -0.1, 0.1, "y", -1),
                    ),
                    Set(
                        "/markers/1/quad",
                        quad_json(-0.25, -0.5, 0.25, 0.5, -0.1, 0.1, "y", -1),
                    ),
                ],
                "17b539a54a99dea80066b790f4cdd11fb67ce0a5419061299a2ad576f06c2d94",
            ),
        ] {
            let (types, map) = rebuilt(&tweaked(&request, &edits));
            assert_eq!(types, expected, "{id}");
            assert_eq!(map, MAP_UNTOUCHED, "{id}");
        }
        let two = with_markers(
            &request,
            vec![request["markers"][0].clone(), request["markers"][2].clone()],
        );
        let a_and_c = tweaked(
            &two,
            &[Set(
                "/markers/1/quad",
                request["markers"][2]["quad"].clone(),
            )],
        );
        assert_eq!(
            rebuilt(&a_and_c).0,
            "d02beb8a317c8295465b25e2c1698e616dd2df7a2597845a9f5ac11a98dfda4f",
            "C327"
        );
        let a_and_b = with_markers(
            &request,
            vec![request["markers"][0].clone(), request["markers"][1].clone()],
        );
        assert!(rebuilt(&a_and_b).0.starts_with("8cd937931b1e"), "C237");
    }

    #[test]
    fn copies_and_renames_rebuild_the_mod_as_described() {
        let bench = Bench::new();
        let request = base(&bench);
        let copy = |model: &str| {
            let mut marker = marker_a(&request);
            marker["model"] = json!(model);
            marker["archetype"] = json!("climb_a");
            marker["back"] = json!("none");
            marker
        };
        let with_copies = |models: &[&str], placements: Value| {
            let mut all = request["markers"].as_array().unwrap().clone();
            all.extend(models.iter().map(|model| copy(model)));
            tweaked(
                &request,
                &[
                    Set("/markers", Value::Array(all)),
                    Set("/placements", placements),
                ],
            )
        };
        let (types, map) = rebuilt(&with_copies(&["climb_d"], json!({})));
        assert_eq!(
            types, "80609524d14da2258f24b35b789a201095d224a564d368070a622fb23c9a4d7e",
            "C170"
        );
        assert_eq!(map, MAP_UNTOUCHED, "C170");
        let placements =
            json!({ "rename": [{ "index": 0, "archetype": "climb_d" }], "remove": [1] });
        let (types, map) = rebuilt(&with_copies(&["climb_d"], placements));
        assert_eq!(
            types, "80609524d14da2258f24b35b789a201095d224a564d368070a622fb23c9a4d7e",
            "C171"
        );
        assert_eq!(
            map, "15a648d142f375d584def79d456535e883c2b407e74ff50362f6a4ee331b69c3",
            "C171"
        );
        let placements = json!({ "rename": [{ "index": 0, "archetype": "climb_d" }] });
        let (types, map) = rebuilt(&with_copies(&["climb_d", "climb_e"], placements));
        assert_eq!(
            types, "0201803f28a0b6591d314dd7d12225d6ecb8f9e90c2973b8db0dfe50df6e3b89",
            "C180"
        );
        assert_eq!(
            map, "2c62566c3bdf7f12611fab158c0c374fd6d55e2e51627adf22b2d01491f16336",
            "C180"
        );
    }

    #[test]
    fn the_answer_for_types_and_map_counts_requests_not_files() {
        let bench = Bench::new();
        let request = base(&bench);
        let copy = {
            let mut marker = marker_a(&request);
            marker["model"] = json!("climb_d");
            marker["archetype"] = json!("climb_a");
            marker["back"] = json!("none");
            marker
        };
        let mut all = request["markers"].as_array().unwrap().clone();
        all.push(copy);
        let placements =
            json!({ "rename": [{ "index": 0, "archetype": "climb_d" }], "remove": [1, 2] });
        let parsed = Request::read(Doc(&tweaked(
            &request,
            &[
                Set("/markers", Value::Array(all)),
                Set("/placements", placements),
            ],
        )))
        .ok()
        .unwrap();
        let types = parsed.types_artifact(vec![1, 2, 3]);
        assert_eq!(types.file, "climb_types.ytyp");
        assert_eq!(
            types.semantic.to_string(),
            r#"{"semanticReopen":true,"archetypes":4,"adjusted":3,"added":1}"#
        );
        let map = parsed.map_artifact(vec![]);
        assert_eq!(map.file, "climb_map.ymap");
        assert_eq!(
            map.semantic.to_string(),
            r#"{"semanticReopen":true,"edited":true,"renamed":1,"removed":2}"#
        );
        let plain = Request::read(Doc(&request)).ok().unwrap();
        assert_eq!(
            plain.map_artifact(vec![]).semantic.to_string(),
            r#"{"semanticReopen":true,"edited":false,"renamed":0,"removed":0}"#
        );
    }

    // -- папка вывода и запись файлов --------------------------------------------------------------------------

    fn folder_options(value: &str) -> Options {
        Options::parse(&["--output".to_owned(), value.to_owned()]).unwrap()
    }

    #[test]
    fn the_output_folder_is_created_or_must_be_empty() {
        let bench = Bench::new();
        let nested = bench.path("a/b/c");
        assert_eq!(
            open_folder(&folder_options(&nested)).unwrap(),
            std::path::PathBuf::from(&nested)
        );
        assert!(std::path::Path::new(&nested).is_dir());
        assert!(
            open_folder(&folder_options(&nested)).is_ok(),
            "пустая подходит"
        );
        let dotted = bench.path("x/../x/y");
        assert!(open_folder(&folder_options(&dotted)).is_ok(), "C335");
        assert!(std::path::Path::new(&bench.path("x/y")).is_dir());
        let wide = bench.path("пробел и кириллица");
        assert!(open_folder(&folder_options(&wide)).is_ok(), "C339");
        std::fs::write(std::path::Path::new(&nested).join("f.txt"), b"x").unwrap();
        let busy = open_folder(&folder_options(&nested)).unwrap_err();
        assert_eq!(
            (busy.code.as_str(), busy.message.as_str()),
            (
                "ArgumentException",
                "Папка вывода меток не пуста: пока на хосте."
            ),
            "C330"
        );
        let file = bench.put("plain-file", b"x");
        assert_eq!(
            open_folder(&folder_options(&file)).unwrap_err().message,
            "Папка вывода меток не пуста: пока на хосте.",
            "C331"
        );
        assert_eq!(
            open_folder(&folder_options("")).unwrap_err().message,
            "The path is empty.",
            "C10"
        );
        assert_eq!(
            open_folder(&folder_options("  ")).unwrap_err().message,
            "The path is empty.",
            "C11"
        );
        let none = Options::parse(&[]).unwrap();
        assert_eq!(
            open_folder(&none).unwrap_err().message,
            "--output is required.",
            "C9"
        );
    }

    #[test]
    fn files_are_written_in_order_and_described_in_the_answer() {
        let bench = Bench::new();
        let folder = std::path::PathBuf::from(bench.path("out"));
        std::fs::create_dir_all(&folder).unwrap();
        let artifact = |file: &str, bytes: &[u8]| Artifact {
            file: file.to_owned(),
            bytes: bytes.to_vec(),
            semantic: json!({ "semanticReopen": true }),
        };
        let answer = publish(
            &folder,
            vec![
                artifact("climb_a.ydr", b"abc"),
                artifact("climb_types.ytyp", b""),
                artifact("climb_map.ymap", b"xyz"),
            ],
        )
        .unwrap();
        assert_eq!(answer["format"], json!("astral.climb-marker-artifacts"));
        assert_eq!(answer["version"], json!(3));
        let files = answer["files"].as_array().unwrap();
        let names: Vec<&str> = files
            .iter()
            .map(|entry| entry["file"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["climb_a.ydr", "climb_types.ytyp", "climb_map.ymap"]);
        assert_eq!(files[0]["bytes"], json!(3));
        assert_eq!(
            files[0]["sha256"],
            json!("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        let text = answer.to_string();
        assert!(text.find("\"format\"").unwrap() < text.find("\"version\"").unwrap());
        assert_eq!(
            std::fs::read(folder.join("climb_map.ymap")).unwrap(),
            b"xyz"
        );
        let keys: Vec<&String> = files[0].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["file", "bytes", "sha256", "semantic"]);
        // Сбой записи оставляет то, что записано раньше.
        let blocked = folder.join("blocked");
        std::fs::create_dir(&blocked).unwrap();
        let failed = publish(
            &folder,
            vec![
                artifact("late.ydr", b"1"),
                artifact("blocked", b"2"),
                artifact("never.ydr", b"3"),
            ],
        );
        assert!(failed.is_err());
        assert!(folder.join("late.ydr").exists() && !folder.join("never.ydr").exists());
    }

    #[test]
    fn the_blank_sheet_is_a_transparent_4x4_dxt5_with_three_levels() {
        let sheet = blank_sheet("climb_a_astral");
        assert_eq!(
            (sheet.width, sheet.height, sheet.levels, sheet.format),
            (4, 4, 3, Format::Dxt5)
        );
        assert_eq!(sheet.payload, vec![0u8; 48]);
        assert_eq!(sheet.name, "climb_a_astral");
    }

    /// Файл ложится через черновик рядом: имя черновика занято папкой - запись отказывает на
    /// этом файле, записанные ранее остаются, прежний файл цел. Прямая запись молча
    /// перезаписала бы его.
    #[test]
    fn published_files_are_staged_beside_their_names() {
        let dir = tempfile::tempdir().unwrap();
        let artifact = |file: &str, bytes: &[u8]| Artifact {
            file: file.to_owned(),
            bytes: bytes.to_vec(),
            semantic: Value::Null,
        };
        let artifacts = || vec![artifact("a.ytd", b"new a"), artifact("b.ytd", b"new b")];
        fs::write(dir.path().join("b.ytd"), b"old b").unwrap();
        fs::create_dir(dir.path().join("b.ytd.shop-stage")).unwrap();
        let error = publish(dir.path(), artifacts()).unwrap_err();
        assert_eq!(error.code, "UnauthorizedAccessException");
        assert_eq!(fs::read(dir.path().join("a.ytd")).unwrap(), b"new a");
        assert_eq!(fs::read(dir.path().join("b.ytd")).unwrap(), b"old b");
        assert!(dir.path().join("b.ytd.shop-stage").is_dir());

        fs::remove_dir(dir.path().join("b.ytd.shop-stage")).unwrap();
        publish(dir.path(), artifacts()).unwrap();
        assert_eq!(fs::read(dir.path().join("b.ytd")).unwrap(), b"new b");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
