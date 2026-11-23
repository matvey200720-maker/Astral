//! `lamp-studio-lod`: правило мастерской над парами карт огней дальнего света
//! города (файл LOD и дальний файл с параллельными массивами).
//!
//! Для каждой пары решается, какие огни трогать, какой цвет им дать и какие
//! множители применить; правка идёт на месте через `edit_lod_pair`, результат
//! перечитывается и сверяется, затем два файла записываются через временные.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, process};

use rage_res::mlo::{self, DistantLights, LodLights};
use rage_res::ymap_write::{self, LodEdit};
use rage_res::{hash, meta_graph};
use serde_json::Value;

use super::{fresh_dirs::FreshDirs, lamp_mutations::is_same_file, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

// ================================================================ отказы

const MSG_OUTPUT_IS_INPUT: &str = "lamp-studio-lod output must not be one of the pair inputs.";
const MSG_OUTPUTS_SHARE_PATH: &str = "lamp-studio-lod outputs must be two different files.";

/// Отказы команды: тексты собраны в одном месте.
enum Fail {
    BrokenRequest,
    PairCount,
    NoRule,
    NoNumber,
    NotList,
    BadColour,
    TooManySignatures,
    PointShape,
    PointFinite,
    OutsideLights,
    Envelope,
    OutputIsInput,
    OutputsSharePath,
    OutsideSpan {
        name: &'static str,
        value: f32,
        low: f32,
        high: f32,
    },
}

impl Fail {
    fn text(&self) -> String {
        let fixed = match self {
            Fail::BrokenRequest => "Запрос правки огней LOD пустой или сломан.",
            Fail::PairCount => "lamp-studio-lod needs 1-1024 pairs.",
            Fail::NoRule => "lamp-studio-lod needs a rule.",
            Fail::NoNumber => "lamp-studio-lod: число в правиле отсутствует.",
            Fail::NotList => "lamp-studio-lod: список в правиле — массив.",
            Fail::BadColour => "lamp-studio-lod: цвет — три байта от 0 до 255.",
            Fail::TooManySignatures => "lamp-studio-lod accepts at most 16 signatures.",
            Fail::PointShape => "lamp-studio-lod extra points must be x,y,z triples, at most 4096.",
            Fail::PointFinite => "lamp-studio-lod extra point is not finite.",
            Fail::OutsideLights => "Patched LOD pair changed bytes outside the light arrays.",
            Fail::Envelope => "Patched LOD pair changed non-light envelope fields.",
            Fail::OutputIsInput => MSG_OUTPUT_IS_INPUT,
            Fail::OutputsSharePath => MSG_OUTPUTS_SHARE_PATH,
            Fail::OutsideSpan {
                name,
                value,
                low,
                high,
            } => return format!("LOD rule {name} {value} is outside {low}…{high}."),
        };
        fixed.to_owned()
    }
}

impl From<Fail> for EngineError {
    fn from(fail: Fail) -> Self {
        EngineError::invalid_data(fail.text())
    }
}

fn ensure(holds: bool, otherwise: Fail) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(otherwise.into())
    }
}

/// Объект JSON из пар «ключ, значение» в заданном порядке.
fn object<I>(fields: I) -> Value
where
    I: IntoIterator<Item = (&'static str, Value)>,
{
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

// =============================================================== пределы

mod limits {
    pub const PAIRS: usize = 1024;
    pub const SIGNATURES: usize = 16;
    pub const POINTS: usize = 4096;
    pub const DEFAULT_RADIUS: f32 = 0.6;
    pub const RADIUS: (f32, f32) = (0.05, 2.0);
    /// Допуски подписи светофора: спад и показатель спада.
    pub const SIGNATURE: (f32, f32) = (0.05, 0.5);
    pub const FALLOFF: (f32, f32) = (0.1, 250.0);
    pub const EXPONENT: (f32, f32) = (1.0, 128.0);
    pub const CELL_SIDE: f32 = 2.0;
    pub const LOG_FLOOR: f64 = 0.01;
}

const STREET_BIT: u32 = 0x0100_0000;
const MAP_EXTENSION: &[&str] = &[".ymap"];

// ======================================================= чтение правила

/// Узел запроса: чтение по ключам; чужой тип и отсутствие дают пустое значение.
#[derive(Clone, Copy)]
struct Node<'a>(&'a Value);

impl<'a> Node<'a> {
    fn at(self, key: &str) -> Node<'a> {
        Node(&self.0[key])
    }

    fn text(self) -> &'a str {
        self.0.as_str().unwrap_or_default()
    }

    /// Число правила, приведённое к `f32`.
    fn real(self) -> Result<f32> {
        let wide = self.0.as_f64().ok_or(Fail::NoNumber)?;
        Ok(wide as f32)
    }

    /// Число или `null` (нет значения).
    fn real_or_none(self) -> Result<Option<f32>> {
        match self.0 {
            Value::Null => Ok(None),
            _ => self.real().map(Some),
        }
    }

    /// Список: `null` — пустой, массив — его элементы, иное — отказ.
    fn rows(self) -> Result<Vec<Node<'a>>> {
        match self.0 {
            Value::Null => Ok(Vec::new()),
            Value::Array(items) => Ok(items.iter().map(Node).collect()),
            _ => Err(Fail::NotList.into()),
        }
    }

    /// Цвет из трёх каналов 0…255; любая ошибка канала — один отказ.
    fn colour(self) -> Result<[u8; 3]> {
        let channel = |key: &str| {
            self.at(key)
                .0
                .as_u64()
                .filter(|&raw| raw <= 255)
                .map(|raw| raw as u8)
                .ok_or(Fail::BadColour)
        };
        Ok([channel("r")?, channel("g")?, channel("b")?])
    }

    /// Цвет, где `null` значит «цвета нет».
    fn colour_or_none(self) -> Result<Option<[u8; 3]>> {
        match self.0 {
            Value::Null => Ok(None),
            _ => self.colour().map(Some),
        }
    }
}

/// Четыре множителя правила: ключ и допустимый отрезок; порядок — порядок чтения и проверки.
#[derive(Clone, Copy)]
enum Knob {
    Intensity,
    Falloff,
    Exponent,
    Corona,
}

const KNOBS: [(&str, f32, f32); 4] = [
    ("intensityScale", 0.0, 8.0),
    ("falloffScale", 0.05, 8.0),
    ("exponentScale", 0.05, 8.0),
    ("coronaScale", 0.0, 8.0),
];

impl Knob {
    const ALL: [Knob; 4] = [Knob::Intensity, Knob::Falloff, Knob::Exponent, Knob::Corona];

    fn key(self) -> &'static str {
        KNOBS[self as usize].0
    }
}

/// Значение внутри отрезка — иначе отказ с числом в записи `f32`.
fn within(name: &'static str, value: f32, (low, high): (f32, f32)) -> Result<f32> {
    ensure(
        (low..=high).contains(&value),
        Fail::OutsideSpan {
            name,
            value,
            low,
            high,
        },
    )?;
    Ok(value)
}

struct Signature {
    falloff: f32,
    exponent: f32,
}

struct Swatch {
    falloff: f32,
    exponent: f32,
    rgb: [u8; 3],
}

fn read_signature(item: Node) -> Result<Signature> {
    let falloff = item.at("falloff").real()?;
    let exponent = item.at("exponent").real()?;
    Ok(Signature { falloff, exponent })
}

fn read_swatch(item: Node) -> Result<Swatch> {
    let falloff = item.at("falloff").real()?;
    let exponent = item.at("exponent").real()?;
    let rgb = item.at("color").colour()?;
    Ok(Swatch {
        falloff,
        exponent,
        rgb,
    })
}

/// Координата точки: число, приведённое к `f32`, и конечное.
fn finite(node: &Value) -> Result<f32> {
    let value = Node(node).real()?;
    ensure(value.is_finite(), Fail::PointFinite)?;
    Ok(value)
}

fn read_point(triple: &[Value]) -> Result<[f32; 3]> {
    Ok([
        finite(&triple[0])?,
        finite(&triple[1])?,
        finite(&triple[2])?,
    ])
}

/// Номер ячейки сетки: пол от деления координаты на сторону ячейки.
fn cell_of(point: [f32; 3]) -> [i64; 3] {
    point.map(|axis| (axis / limits::CELL_SIDE).floor() as i64)
}

/// Квадрат расстояния: сумма квадратов разностей слева направо.
fn distance_squared(a: [f32; 3], b: [f32; 3]) -> f32 {
    let gap: [f32; 3] = std::array::from_fn(|axis| a[axis] - b[axis]);
    gap.iter()
        .map(|part| part * part)
        .reduce(|sum, square| sum + square)
        .unwrap_or_default()
}

/// Огни рядом с заданными точками: сетка ячеек со стороной `CELL_SIDE`.
struct Extra {
    rgb: [u8; 3],
    radius_squared: f32,
    cells: HashMap<[i64; 3], Vec<[f32; 3]>>,
}

impl Extra {
    fn read(node: Node) -> Result<Option<Extra>> {
        let colour = node.at("color").colour_or_none()?;
        let points = node
            .at("points")
            .0
            .as_array()
            .filter(|list| !list.is_empty());
        let Some((rgb, raw)) = colour.zip(points) else {
            return Ok(None);
        };
        ensure(
            raw.len() % 3 == 0 && raw.len() / 3 <= limits::POINTS,
            Fail::PointShape,
        )?;
        let radius = node
            .at("radius")
            .real_or_none()?
            .unwrap_or(limits::DEFAULT_RADIUS);
        within("extra.radius", radius, limits::RADIUS)?;

        let cells = raw.chunks(3).map(read_point).try_fold(
            HashMap::<[i64; 3], Vec<[f32; 3]>>::new(),
            |mut cells, point| -> Result<_> {
                let point = point?;
                cells
                    .entry(cell_of(point))
                    .or_insert_with(Vec::new)
                    .push(point);
                Ok(cells)
            },
        )?;
        Ok(Some(Extra {
            rgb,
            radius_squared: radius * radius,
            cells,
        }))
    }

    /// Есть ли точка не дальше радиуса: смотрятся три ближайшие ячейки по каждой оси.
    fn reaches(&self, at: [f32; 3]) -> bool {
        let home = cell_of(at);
        (0..27i64)
            .map(|step| {
                [
                    home[0].saturating_add(step % 3 - 1),
                    home[1].saturating_add(step / 3 % 3 - 1),
                    home[2].saturating_add(step / 9 - 1),
                ]
            })
            .filter_map(|key| self.cells.get(&key))
            .flatten()
            .any(|&point| distance_squared(at, point) <= self.radius_squared)
    }
}

struct Rule {
    extra: Option<Extra>,
    signatures: Vec<Signature>,
    palette: Vec<Swatch>,
    scales: [Option<f32>; 4],
    rgb: Option<[u8; 3]>,
    street_only: bool,
}

impl Rule {
    /// Порядок ошибок: подписи, их число, палитра, `extra`, цвет, множители.
    fn read(root: &Value) -> Result<Rule> {
        let node = Node(root);
        let signatures = node
            .at("signatures")
            .rows()?
            .into_iter()
            .map(read_signature)
            .collect::<Result<Vec<_>>>()?;
        ensure(
            signatures.len() <= limits::SIGNATURES,
            Fail::TooManySignatures,
        )?;
        let palette = node
            .at("palette")
            .rows()?
            .into_iter()
            .map(read_swatch)
            .collect::<Result<Vec<_>>>()?;
        let extra = Extra::read(node.at("extra"))?;
        let rgb = node.at("color").colour_or_none()?;
        let scales = Knob::ALL
            .iter()
            .map(|knob| node.at(knob.key()).real_or_none())
            .collect::<Result<Vec<_>>>()?
            .try_into()
            .expect("по числу на множитель");
        Ok(Rule {
            extra,
            signatures,
            palette,
            scales,
            rgb,
            street_only: node.at("streetOnly").0.as_bool().unwrap_or(true),
        })
    }

    /// Множитель, если он задан; вне допустимого отрезка — отказ.
    fn scale(&self, knob: Knob) -> Result<Option<f32>> {
        let (name, low, high) = KNOBS[knob as usize];
        self.scales[knob as usize]
            .map(|value| within(name, value, (low, high)))
            .transpose()
    }

    fn matches_signature(&self, falloff: f32, exponent: f32) -> bool {
        let (near_falloff, near_exponent) = limits::SIGNATURE;
        self.signatures.iter().any(|sig| {
            (falloff - sig.falloff).abs() <= near_falloff
                && (exponent - sig.exponent).abs() <= near_exponent
        })
    }

    /// Цвет огня: ближайший элемент палитры, иначе общий цвет правила.
    fn hue_for(&self, falloff: f32, exponent: f32) -> Option<[u8; 3]> {
        let ratio = |value: f32, anchor: f32| {
            // Как у помощника: частное считается в одинарной точности, логарифм — в двойной. В двойной
            // точности ничьи вроде 3/2 и 64/96 разрешались иначе, и огонь получал цвет другой подписи.
            let floor = limits::LOG_FLOOR as f32;
            f64::from(value.max(floor) / anchor.max(floor)).ln().abs()
        };
        let nearest = self
            .palette
            .iter()
            .fold(None, |best: Option<(f64, [u8; 3])>, swatch| {
                let score = ratio(falloff, swatch.falloff) + ratio(exponent, swatch.exponent);
                match best {
                    Some((held, _))
                        if score.partial_cmp(&held) != Some(std::cmp::Ordering::Less) =>
                    {
                        best
                    }
                    _ => Some((score, swatch.rgb)),
                }
            });
        nearest.map(|(_, rgb)| rgb).or(self.rgb)
    }
}

// ============================================================ огни пары

/// Упакованный цвет дальнего огня: яркость в старшем байте, затем r, g, b.
#[derive(Clone, Copy, PartialEq)]
struct Packed {
    level: u8,
    rgb: [u8; 3],
}

impl Packed {
    fn unpack(word: u32) -> Self {
        let [level, r, g, b] = word.to_be_bytes();
        Packed {
            level,
            rgb: [r, g, b],
        }
    }

    fn pack(self) -> u32 {
        let [r, g, b] = self.rgb;
        u32::from_be_bytes([self.level, r, g, b])
    }
}

/// Четыре пути пары в порядке проверки.
struct Dock {
    lod_in: PathBuf,
    distant_in: PathBuf,
    lod_out: PathBuf,
    distant_out: PathBuf,
}

impl Dock {
    fn resolve(item: &Value) -> Result<Dock> {
        let text = |key: &str| Node(item).at(key).text();
        let lod_in = paths::existing_file(text("lodInput"), MAP_EXTENSION)?;
        let distant_in = paths::existing_file(text("distantInput"), MAP_EXTENSION)?;
        let lod_out = paths::output_file(text("lodOutput"), MAP_EXTENSION)?;
        let distant_out = paths::output_file(text("distantOutput"), MAP_EXTENSION)?;
        Ok(Dock {
            lod_in,
            distant_in,
            lod_out,
            distant_out,
        })
    }

    /// Выход не может быть входом пары (раньше правка молча заменяла вход, и следующая пара читала уже правленый) и
    /// два выхода не могут быть одним файлом (раньше оставался один файл с содержимым дальней карты).
    fn ensure_safe_outputs(&self) -> Result<()> {
        let outputs = [&self.lod_out, &self.distant_out];
        let inputs = [&self.lod_in, &self.distant_in];
        let overwrites = outputs
            .iter()
            .flat_map(|out| inputs.iter().map(move |input| (*input, *out)))
            .any(|(input, out)| input == out || is_same_file(input, out));
        ensure(!overwrites, Fail::OutputIsInput)?;
        let twins =
            self.lod_out == self.distant_out || is_same_file(&self.lod_out, &self.distant_out);
        ensure(!twins, Fail::OutputsSharePath)
    }
}

/// Номера сторон пары в массивах: сначала файл LOD, затем дальний.
const LOD: usize = 0;
const DISTANT: usize = 1;

/// Действие над обеими сторонами пары по очереди (LOD первым); первый же отказ останавливает обход.
fn both<I, T>(inputs: [I; 2], mut act: impl FnMut(I) -> Result<T>) -> Result<[T; 2]> {
    let [first, second] = inputs;
    let done = act(first)?;
    Ok([done, act(second)?])
}

/// Файлы пары, прочитанные и разобранные.
struct Loaded {
    bytes: [Vec<u8>; 2],
    maps: [meta_graph::Read; 2],
    lod: LodLights,
    distant: DistantLights,
}

impl Loaded {
    /// Сначала оба файла (LOD первым), затем обе карты, затем огни.
    fn open(dock: &Dock) -> Result<Loaded> {
        let bytes = both([&dock.lod_in, &dock.distant_in], |path| Ok(fs::read(path)?))?;
        let maps = both([&bytes[LOD], &bytes[DISTANT]], |raw| {
            Ok(meta_graph::read(raw)?)
        })?;
        let lod = mlo::read_lod_lights(&maps[LOD])?;
        let distant = mlo::read_distant_lights(&maps[DISTANT])?;
        Ok(Loaded {
            bytes,
            maps,
            lod,
            distant,
        })
    }

    fn has_lights(&self) -> bool {
        [self.lod.direction.len(), self.distant.positions.len()]
            .iter()
            .all(|&len| len > 0)
    }

    /// Массивы сходятся: всё, кроме направлений, длиной с массив спадов;
    /// позиции сверяются только когда правило ими пользуется.
    fn aligned(&self, positions_needed: bool) -> bool {
        let (lod, distant) = (&self.lod, &self.distant);
        let mut lengths = vec![
            lod.falloff_exponent.len(),
            lod.time_and_state_flags.len(),
            lod.hash.len(),
            lod.cone_inner_angle.len(),
            lod.cone_outer_angle_or_cap_ext.len(),
            lod.corona_intensity.len(),
            distant.colours.len(),
        ];
        if positions_needed {
            lengths.push(distant.positions.len());
        }
        lengths.iter().all(|&len| len == lod.falloff.len())
    }

    fn street_lights(&self) -> usize {
        let flags = &self.lod.time_and_state_flags;
        flags
            .iter()
            .fold(0, |total, flag| total + usize::from(flag & STREET_BIT != 0))
    }

    /// Перечитывает выходы и сверяет: огни — по правкам, остальное — как было.
    fn audit(&self, edits: &[LodEdit], lod_out: &[u8], distant_out: &[u8]) -> Result<()> {
        let (mut want_lod, mut want_distant) = (self.lod.clone(), self.distant.clone());
        for edit in edits {
            apply_edit(&mut want_lod, &mut want_distant, edit);
        }
        let [lod_map, distant_map] =
            both([lod_out, distant_out], |raw| Ok(meta_graph::read(raw)?))?;
        let unchanged = mlo::read_lod_lights(&lod_map)? == want_lod
            && mlo::read_distant_lights(&distant_map)? == want_distant;
        ensure(unchanged, Fail::OutsideLights)?;
        for (before, after) in self.maps.iter().zip([&lod_map, &distant_map]) {
            let same = mlo::lod_envelope(before)? == mlo::lod_envelope(after)?;
            ensure(same, Fail::Envelope)?;
        }
        Ok(())
    }
}

/// Правка так, как её применяет `edit_lod_pair`, — на копиях массивов для сверки.
fn apply_edit(lod: &mut LodLights, distant: &mut DistantLights, edit: &LodEdit) {
    let at = edit.index;
    lod.falloff[at] = edit.falloff.unwrap_or(lod.falloff[at]);
    lod.falloff_exponent[at] = edit.falloff_exponent.unwrap_or(lod.falloff_exponent[at]);
    lod.corona_intensity[at] = edit.corona_intensity.unwrap_or(lod.corona_intensity[at]);
    if edit.intensity.is_some() || edit.colour.is_some() {
        let old = Packed::unpack(distant.colours[at]);
        let next = Packed {
            level: edit.intensity.unwrap_or(old.level),
            rgb: edit.colour.unwrap_or(old.rgb),
        };
        distant.colours[at] = next.pack();
    }
}

/// Правка одного огня: уличный и огонь по подписи идут по правилу целиком, прочие — только
/// по цвету рядом с точками (и только в режиме «только уличные»).
fn plan_light(loaded: &Loaded, rule: &Rule, index: usize) -> Result<Option<LodEdit>> {
    let lod = &loaded.lod;
    let on_street = lod.time_and_state_flags[index] & STREET_BIT != 0;
    let whole_rule = on_street
        || !rule.street_only
        || rule.matches_signature(lod.falloff[index], lod.falloff_exponent[index]);
    if whole_rule {
        retune(loaded, rule, index)
    } else {
        Ok(recolour_near_points(loaded, rule, index))
    }
}

/// Правка «только цвет» для огня рядом с точками `extra`.
fn recolour_near_points(loaded: &Loaded, rule: &Rule, index: usize) -> Option<LodEdit> {
    let extra = rule.extra.as_ref()?;
    let old = Packed::unpack(loaded.distant.colours[index]);
    let wanted = extra.reaches(loaded.distant.positions[index]) && old.rgb != extra.rgb;
    wanted.then(|| LodEdit {
        index,
        colour: Some(extra.rgb),
        ..LodEdit::default()
    })
}

/// Полная правка огня по правилу; `None`, если ни одна часть её не дала.
fn retune(loaded: &Loaded, rule: &Rule, index: usize) -> Result<Option<LodEdit>> {
    let lod = &loaded.lod;
    let old = Packed::unpack(loaded.distant.colours[index]);
    let stretched = |knob: Knob, current: f32, (low, high): (f32, f32)| -> Result<Option<f32>> {
        Ok(rule
            .scale(knob)?
            .map(|scale| (current * scale).clamp(low, high)))
    };

    let hue = rule
        .hue_for(lod.falloff[index], lod.falloff_exponent[index])
        .unwrap_or(old.rgb);
    let level = match rule.scale(Knob::Intensity)? {
        Some(scale) => (f32::from(old.level) * scale).floor().min(255.0) as u8,
        None => old.level,
    };
    let repaint = (Packed { level, rgb: hue } != old).then_some((level, hue));
    let falloff = stretched(Knob::Falloff, lod.falloff[index], limits::FALLOFF)?;
    let falloff_exponent = stretched(
        Knob::Exponent,
        lod.falloff_exponent[index],
        limits::EXPONENT,
    )?;
    let corona = lod.corona_intensity[index];
    let corona_intensity = rule
        .scale(Knob::Corona)?
        .map(|scale| {
            (f32::from(corona) * scale)
                .round_ties_even()
                .clamp(0.0, 255.0) as u8
        })
        .filter(|&next| next != corona);

    let edit = LodEdit {
        index,
        falloff,
        falloff_exponent,
        corona_intensity,
        intensity: repaint.map(|(level, _)| level),
        colour: repaint.map(|(_, rgb)| rgb),
    };
    let blank = LodEdit {
        index,
        ..LodEdit::default()
    };
    Ok((edit != blank).then_some(edit))
}

// =============================================================== итог пары

/// Что стало с парой.
enum Fate {
    Skipped(&'static str),
    Untouched {
        lights: usize,
        streets: usize,
    },
    Written {
        lights: usize,
        streets: usize,
        edits: usize,
        lod_sha256: String,
        distant_sha256: String,
    },
}

impl Fate {
    /// Поля отчёта по порядку, после имён файлов.
    fn fields(&self) -> Vec<(&'static str, Value)> {
        let counted = |lights: usize, streets: usize, changed: usize| {
            vec![
                ("lights", Value::from(lights)),
                ("streetLights", Value::from(streets)),
                ("changed", Value::from(changed)),
            ]
        };
        match self {
            Fate::Skipped(reason) => vec![
                ("skipped", Value::from(*reason)),
                ("changed", Value::from(0)),
            ],
            Fate::Untouched { lights, streets } => counted(*lights, *streets, 0),
            Fate::Written {
                lights,
                streets,
                edits,
                lod_sha256,
                distant_sha256,
            } => {
                let mut all = counted(*lights, *streets, *edits);
                all.push(("lodSha256", Value::from(lod_sha256.as_str())));
                all.push(("distantSha256", Value::from(distant_sha256.as_str())));
                all
            }
        }
    }

    fn written_edits(&self) -> usize {
        match self {
            Fate::Written { edits, .. } => *edits,
            _ => 0,
        }
    }
}

struct Report {
    lod: String,
    distant: String,
    fate: Fate,
}

impl Report {
    fn of(dock: &Dock, fate: Fate) -> Report {
        let base = |path: &Path| {
            path.file_name()
                .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
        };
        Report {
            lod: base(&dock.lod_in),
            distant: base(&dock.distant_in),
            fate,
        }
    }

    fn to_json(&self) -> Value {
        let names = [
            ("lod", Value::from(self.lod.as_str())),
            ("distant", Value::from(self.distant.as_str())),
        ];
        object(names.into_iter().chain(self.fate.fields()))
    }
}

fn process_pair(item: &Value, rule: &Rule) -> Result<Report> {
    // Папки выходов создаются раньше чтения карт; если пара не записана (пропуск, «править нечего», отказ), пустые убираются.
    let created = FreshDirs::merged(
        ["lodOutput", "distantOutput"].map(|key| FreshDirs::beside(Ok(Node(item).at(key).text()))),
    );
    let dock = Dock::resolve(item)?;
    let loaded = Loaded::open(&dock)?;
    let fate = decide(&dock, &loaded, rule)?;
    if let Fate::Written { .. } = fate {
        created.keep();
    }
    Ok(Report::of(&dock, fate))
}

/// Причина пропустить пару до всякой правки.
fn skip_reason(loaded: &Loaded, rule: &Rule) -> Option<&'static str> {
    if !loaded.has_lights() {
        Some("no-lod-lights")
    } else if !loaded.aligned(rule.extra.is_some()) {
        Some("arrays-not-aligned")
    } else {
        None
    }
}

/// Правки по всем огням подряд; первый отказ правила обрывает обход.
fn collect_edits(loaded: &Loaded, rule: &Rule) -> Result<Vec<LodEdit>> {
    let mut edits = Vec::new();
    for index in 0..loaded.lod.falloff.len() {
        edits.extend(plan_light(loaded, rule, index)?);
    }
    Ok(edits)
}

/// Число уличных огней, объявленное в конверте дальней карты.
fn declared_streets(loaded: &Loaded) -> Result<Option<usize>> {
    let mut envelope = mlo::lod_envelope(&loaded.maps[DISTANT])?;
    Ok(envelope
        .remove("distantNumStreetLights")
        .and_then(|text| text.parse().ok()))
}

fn decide(dock: &Dock, loaded: &Loaded, rule: &Rule) -> Result<Fate> {
    if let Some(reason) = skip_reason(loaded, rule) {
        return Ok(Fate::Skipped(reason));
    }
    let lights = loaded.lod.falloff.len();
    let edits = collect_edits(loaded, rule)?;
    let streets = loaded.street_lights();
    if declared_streets(loaded)? != Some(streets) {
        return Ok(Fate::Skipped("street-count-mismatch"));
    }
    if edits.is_empty() {
        return Ok(Fate::Untouched { lights, streets });
    }

    let (lod_out, distant_out) =
        ymap_write::edit_lod_pair(&loaded.bytes[LOD], &loaded.bytes[DISTANT], &edits)?;
    loaded.audit(&edits, &lod_out, &distant_out)?;
    dock.ensure_safe_outputs()?;
    commit((&lod_out, &dock.lod_out), (&distant_out, &dock.distant_out))?;
    Ok(Fate::Written {
        lights,
        streets,
        edits: edits.len(),
        lod_sha256: hash::sha256_hex(&lod_out),
        distant_sha256: hash::sha256_hex(&distant_out),
    })
}

// ================================================================== запись

/// Временный сосед выхода: `<выход>.lamp-studio-<процесс>-<наносекунды>`.
fn sibling(dest: &Path, stamp: &str) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(stamp);
    name.into()
}

/// Один файл на запись: байты, временный путь и итоговый путь.
struct Staged<'a> {
    bytes: &'a [u8],
    temp: PathBuf,
    dest: &'a Path,
}

/// Пути, которые убираются, если запись не доведена до конца.
struct Rollback {
    doomed: Vec<PathBuf>,
    armed: bool,
}

impl Rollback {
    fn disarm(mut self) {
        self.armed = false;
    }
}

impl Drop for Rollback {
    fn drop(&mut self) {
        if self.armed {
            for path in &self.doomed {
                let _ = fs::remove_file(path);
            }
        }
    }
}

/// Сначала оба временных файла, потом оба переименования; при сбое оба
/// временных пути убираются и уже поставленный результат тоже.
fn commit(lod: (&[u8], &Path), distant: (&[u8], &Path)) -> Result<()> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let stamp = format!(".lamp-studio-{}-{nanos}", process::id());
    let staged = [lod, distant].map(|(bytes, dest)| Staged {
        bytes,
        temp: sibling(dest, &stamp),
        dest,
    });

    // Пара не остаётся наполовину записанной: временные файлы и уже поставленный результат убираются.
    let mut rollback = Rollback {
        doomed: staged.iter().map(|file| file.temp.clone()).collect(),
        armed: true,
    };
    for file in &staged {
        fs::write(&file.temp, file.bytes)?;
    }
    for file in &staged {
        fs::rename(&file.temp, file.dest)?;
        rollback.doomed.push(file.dest.to_path_buf());
    }
    rollback.disarm();
    Ok(())
}

// ============================================================ вход команды

fn load_request(argument: &str) -> Result<Value> {
    let raw = fs::read(paths::existing_file(argument, &[".json"])?)?;
    serde_json::from_slice(&raw).map_err(|_| Fail::BrokenRequest.into())
}

pub fn lamp_studio_lod(options: &Options, _progress: &Progress) -> Result<Value> {
    let argument = options.required("request")?;
    let request = load_request(argument)?;
    let pairs = request["lampStudioLodPairs"]
        .as_array()
        .filter(|list| (1..=limits::PAIRS).contains(&list.len()))
        .ok_or(Fail::PairCount)?;
    ensure(!request["lampStudioLodRule"].is_null(), Fail::NoRule)?;
    let rule = Rule::read(&request["lampStudioLodRule"])?;

    let reports = pairs
        .iter()
        .map(|item| process_pair(item, &rule))
        .collect::<Result<Vec<Report>>>()?;
    let changed: usize = reports
        .iter()
        .map(|report| report.fate.written_edits())
        .sum();
    Ok(object([
        ("status", Value::from("ready")),
        ("mode", Value::from("lamp-studio-lod")),
        (
            "pairs",
            Value::Array(reports.iter().map(Report::to_json).collect()),
        ),
        ("changed", Value::from(changed)),
        (
            "validation",
            object([
                ("reopened", Value::Bool(true)),
                ("onlyLightBytesChanged", Value::Bool(true)),
                ("streetCountsMatch", Value::Bool(true)),
            ]),
        ),
    ]))
}

pub const COMMANDS: &[Command] = &[Command::new("lamp-studio-lod", lamp_studio_lod)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support;
    use rage_res::hash::sha256_hex;
    use rage_res::resource::Resource;
    use serde_json::json;
    use tempfile::TempDir;

    const LOD_NAME: &str = "lodlights_small045.ymap";
    const DIST_NAME: &str = "distlodlights_small045.ymap";
    const INPUT_LOD_SHA: &str = "8747751ed6c4d7f3352ef503d7079ea453b221521b230c79b89833764d4315c2";
    const INPUT_DIST_SHA: &str = "41dc348f1aebd9ec67d6a05c242d54df426bc89a81b918c2e6a515f1f5a47a29";
    const RED_ORANGE: &str = r#"{"r":255,"g":200,"b":120}"#;

    fn sample(name: &str) -> Vec<u8> {
        let dir = test_support::engine("parity/host-port/lamp-lod-inspect-pair/pairs");
        fs::read(dir.join(name)).unwrap()
    }

    fn parse(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    /// Рабочая папка случая: копии шести настоящих файлов в `in/`.
    struct Bench {
        dir: TempDir,
    }

    impl Bench {
        fn new() -> Self {
            let bench = Bench {
                dir: tempfile::tempdir().unwrap(),
            };
            for name in [
                "lodlights_small008.ymap",
                "distlodlights_small008.ymap",
                LOD_NAME,
                DIST_NAME,
                "lodlights_medium017.ymap",
                "distlodlights_medium017.ymap",
            ] {
                bench.put(&format!("in/{name}"), &sample(name));
            }
            bench
        }

        fn path(&self, relative: &str) -> PathBuf {
            self.dir.path().join(relative)
        }

        fn put(&self, relative: &str, bytes: &[u8]) {
            let path = self.path(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }

        fn text(&self, relative: &str) -> String {
            self.path(relative).to_string_lossy().into_owned()
        }

        /// Пара small045 с выходами в `o/`.
        fn default_pair(&self) -> Value {
            self.pair(
                "in/lodlights_small045.ymap",
                "in/distlodlights_small045.ymap",
                "o",
            )
        }

        fn pair(&self, lod: &str, distant: &str, out: &str) -> Value {
            json!({
                "lodInput": self.text(lod),
                "distantInput": self.text(distant),
                "lodOutput": self.text(&format!("{out}/lod_small045.ymap")),
                "distantOutput": self.text(&format!("{out}/dist_small045.ymap")),
            })
        }

        fn run_request(&self, request: &Value) -> Value {
            fs::write(self.path("request.json"), request.to_string()).unwrap();
            self.run_argv(&["--request", &self.text("request.json")])
        }

        fn run_argv(&self, tail: &[&str]) -> Value {
            let mut argv = vec!["lamp-studio-lod".to_owned()];
            argv.extend(tail.iter().map(|part| (*part).to_owned()));
            let outcome = crate::run(&argv, &Progress::silent());
            let value: Value = parse(&outcome.line);
            assert_eq!(outcome.exit_code, i32::from(value["ok"] != true));
            value
        }

        fn run_rule(&self, rule: &Value) -> Value {
            self.run_request(&json!({
                "lampStudioLodPairs": [self.default_pair()],
                "lampStudioLodRule": rule,
            }))
        }

        fn sha(&self, relative: &str) -> String {
            sha256_hex(&fs::read(self.path(relative)).unwrap())
        }
    }

    fn failure_of(response: &Value) -> (String, String) {
        assert_eq!(response["ok"], false, "{response}");
        (
            response["error"]["code"].as_str().unwrap().to_owned(),
            response["error"]["message"].as_str().unwrap().to_owned(),
        )
    }

    fn assert_refused(response: &Value, code: &str, message: &str) {
        assert_eq!(failure_of(response), (code.to_owned(), message.to_owned()));
    }

    fn first_pair(response: &Value) -> &Value {
        assert_eq!(response["ok"], true, "{response}");
        &response["result"]["pairs"][0]
    }

    /// Правка флагов огней LOD в распакованном теле файла и повторная сборка.
    fn with_flags(bytes: &[u8], change: impl Fn(usize, u32) -> u32) -> Vec<u8> {
        let read = meta_graph::read(bytes).unwrap();
        let (node, count) = mlo::soa_array(&read, "LODLightsSOA", "timeAndStateFlags")
            .unwrap()
            .unwrap();
        let origin = read.origins[node].unwrap();
        let mut resource = Resource::parse(bytes).unwrap();
        for index in 0..count {
            let at = origin + index * 4;
            let old = u32::from_le_bytes(resource.data()[at..at + 4].try_into().unwrap());
            resource.data_mut()[at..at + 4].copy_from_slice(&change(index, old).to_le_bytes());
        }
        resource.to_file_bytes().unwrap()
    }

    // ------------------------------------------------------------- модульные

    fn bare_rule(text: &str) -> Rule {
        Rule::read(&parse(text)).unwrap()
    }

    #[test]
    fn palette_picks_the_nearest_in_log_distance_and_keeps_the_first_on_a_tie() {
        let rule = bare_rule(
            r#"{"palette":[
                {"falloff":8,"exponent":256,"color":{"r":1,"g":2,"b":3}},
                {"falloff":8,"exponent":256,"color":{"r":9,"g":9,"b":9}}]}"#,
        );
        assert_eq!(rule.hue_for(8.0, 256.0), Some([1, 2, 3]));
        let far = bare_rule(
            r#"{"palette":[
                {"falloff":2,"exponent":64,"color":{"r":10,"g":20,"b":30}},
                {"falloff":8,"exponent":128,"color":{"r":40,"g":50,"b":60}}]}"#,
        );
        assert_eq!(far.hue_for(7.0, 120.0), Some([40, 50, 60]));
        assert_eq!(far.hue_for(2.5, 60.0), Some([10, 20, 30]));
        assert_eq!(bare_rule("{}").hue_for(8.0, 256.0), None);
        assert_eq!(
            bare_rule(r#"{"color":{"r":4,"g":5,"b":6}}"#).hue_for(1.0, 1.0),
            Some([4, 5, 6])
        );
    }

    /// Подписи (3; 96) и (2; 64) равно далеки от огня (3; 64): обе в полтора раза, ln 1,5 с обеих сторон. В двойной точности
    /// вторая выходила ближе на последний знак (0,64/0,96 не точное число), у помощника частное одинарной точности — и
    /// побеждает первая. Найдено на 220 парах огней вдали игры (правило без «только улицы»: 9 запусков из 9 расходились).
    #[test]
    fn palette_distance_is_measured_in_single_precision_like_the_host() {
        let rule = bare_rule(
            r#"{"palette":[
                {"falloff":3,"exponent":96,"color":{"r":255,"g":0,"b":0}},
                {"falloff":2,"exponent":64,"color":{"r":40,"g":60,"b":255}}]}"#,
        );
        assert_eq!(rule.hue_for(3.0, 64.0), Some([255, 0, 0]));
        // Обратный порядок записей тот же результат: ничьей нет, победитель определён числом, а не местом.
        let reversed = bare_rule(
            r#"{"palette":[
                {"falloff":2,"exponent":64,"color":{"r":40,"g":60,"b":255}},
                {"falloff":3,"exponent":96,"color":{"r":255,"g":0,"b":0}}]}"#,
        );
        assert_eq!(reversed.hue_for(3.0, 64.0), Some([255, 0, 0]));
    }

    #[test]
    fn signature_matches_inside_the_tolerances_only() {
        let rule = bare_rule(r#"{"signatures":[{"falloff":8,"exponent":128}]}"#);
        assert!(rule.matches_signature(8.04, 128.4));
        assert!(!rule.matches_signature(8.2, 128.0));
        assert!(!rule.matches_signature(8.0, 128.6));
    }

    #[test]
    fn extra_point_counts_across_a_cell_boundary_within_the_radius() {
        let rule =
            bare_rule(r#"{"extra":{"color":{"r":1,"g":2,"b":3},"points":[1.9,0,0],"radius":1}}"#);
        let extra = rule.extra.unwrap();
        assert!(extra.reaches([2.5, 0.0, 0.0]));
        assert!(!extra.reaches([5.0, 0.0, 0.0]));
        assert!(
            !extra.reaches([1.9, 0.0, 1.2]),
            "расстояние считается и по оси z"
        );
        assert!(extra.reaches([1.9, 0.0, 0.9]));
        assert!(extra.reaches([1.9, -0.9, 0.0]));
        assert!(!extra.reaches([1.9, -1.1, 0.0]));
    }

    #[test]
    fn rule_scales_outside_their_range_are_refused() {
        let rule = bare_rule(r#"{"intensityScale":9,"coronaScale":4}"#);
        assert!(rule.scale(Knob::Intensity).is_err());
        assert_eq!(rule.scale(Knob::Corona).unwrap(), Some(4.0));
        assert_eq!(rule.scale(Knob::Falloff).unwrap(), None);
    }

    #[test]
    fn packed_colour_round_trips_with_the_level_in_the_top_byte() {
        let packed = Packed::unpack(0xAA11_2233);
        assert_eq!((packed.level, packed.rgb), (0xAA, [0x11, 0x22, 0x33]));
        assert_eq!(packed.pack(), 0xAA11_2233);
    }

    // ------------------------------------------- 4.6: суммы успешных выходов

    #[test]
    fn rules_on_the_small_pair_give_the_recorded_sums() {
        // (номер, правило, правок, sha lod, sha дальнего); None — выход равен входу.
        let cases: Vec<(&str, String, usize, Option<&str>, &str)> = vec![
            ("LS201", format!(r#"{{"color":{RED_ORANGE}}}"#), 37, None,
             "c9369c643e1fc5fcf4a5b99232c0a44da166a09f375cda43a500c67dd6183635"),
            ("LS202", format!(r#"{{"streetOnly":false,"color":{RED_ORANGE}}}"#), 324, None,
             "313dd656b4d527a6106a20f9c44a8f9c444d957fd647874780d8d0625389db0c"),
            ("LS203", r#"{"streetOnly":false,"color":{"r":255,"g":255,"b":255}}"#.into(), 166, None,
             "4791fd903eb52c9c2f7bc01a8888e93b8318def33fbd45f0a9751eaa05933844"),
            ("LS204", format!(r#"{{"streetOnly":"no","color":{RED_ORANGE}}}"#), 37, None,
             "c9369c643e1fc5fcf4a5b99232c0a44da166a09f375cda43a500c67dd6183635"),
            ("LS205", format!(r#"{{"streetOnly":0,"color":{RED_ORANGE}}}"#), 37, None,
             "c9369c643e1fc5fcf4a5b99232c0a44da166a09f375cda43a500c67dd6183635"),
            ("LS206", r#"{"intensityScale":1.25}"#.into(), 37, None,
             "4201b3b54d747a6bb334fd3faa5c3569c31d18e9837556b03b5833debbdb01ce"),
            ("LS208", r#"{"intensityScale":0}"#.into(), 37, None,
             "eba6b29f79ae3cfcc9c60a1c32108276682c5e539076afe4a5fa63d0f43f4b55"),
            ("LS209", r#"{"intensityScale":8}"#.into(), 37, None,
             "5d9fba7200362c90ec8f6b7f26ae914b38fff7c0486a6453df4b61941b129f67"),
            ("LS210", r#"{"streetOnly":false,"intensityScale":0.5}"#.into(), 321, None,
             "d41c816d05de083b1612c335aab0f0dbb1e378e2b4252e47f2492f5379218e31"),
            ("LS211", r#"{"falloffScale":0.9}"#.into(), 37,
             Some("c1fe33868485a9763f03d1eb5574033055bd39ec0712b412c2633d2b9ac39a6e"), INPUT_DIST_SHA),
            ("LS212", r#"{"falloffScale":1}"#.into(), 37, None, INPUT_DIST_SHA),
            ("LS213", r#"{"falloffScale":8,"streetOnly":false}"#.into(), 324,
             Some("537295b902fcd25a7dd67a0e723994e50236e24bc7eaaf7e98292513e273897c"), INPUT_DIST_SHA),
            ("LS214", r#"{"falloffScale":0.05,"streetOnly":false}"#.into(), 324,
             Some("f7195c2d283274177c4107cbb8fed9a367b8a90fbf8328a3110e5b9feeccd217"), INPUT_DIST_SHA),
            ("LS215", r#"{"exponentScale":1.1}"#.into(), 37,
             Some("cac6b487c3f652085544c0c5b2463906de738006aa638f84fa83a4924a6ea95b"), INPUT_DIST_SHA),
            ("LS216", r#"{"exponentScale":1}"#.into(), 37,
             Some("595a44ceec69e14dd7b56fc1d3a4d2cdcb2ba8b8639a7d34d21e94c85ada0260"), INPUT_DIST_SHA),
            ("LS217", r#"{"exponentScale":0.05,"streetOnly":false}"#.into(), 324,
             Some("843bf1d79e7aa0c81324922e11b7ec345a0008f20dce0215e52a69aaaa8c951f"), INPUT_DIST_SHA),
            ("LS218", r#"{"coronaScale":1.5}"#.into(), 35,
             Some("5215cd37c91360381e58b06a3d6a3c9d82a19b92d3de1924cc89df1d5398755b"), INPUT_DIST_SHA),
            ("LS219", r#"{"coronaScale":0.5,"streetOnly":false}"#.into(), 42,
             Some("1cefe59e40f5a92d116beb04495ed49d22984762b4b9df5e60803811519cb560"), INPUT_DIST_SHA),
            ("LS220", r#"{"coronaScale":0}"#.into(), 35,
             Some("79ea691b0938d446f087cc85e52fe7c6c5767ff361a49baf53de1e60f51d9277"), INPUT_DIST_SHA),
            ("LS221", r#"{"coronaScale":8,"streetOnly":false}"#.into(), 42,
             Some("c4b5688200255a0b34dc3599e71af3fceb232992d592a42b56788f6fce8ac874"), INPUT_DIST_SHA),
            ("LS118", r#"{"coronaScale":0.1}"#.into(), 35,
             Some("e56987f4a4fcb57ce629575af65579b27886f43e24fb0b1430b5e5414a12a00f"), INPUT_DIST_SHA),
            ("LS119", r#"{"intensityScale":8.00000001}"#.into(), 37, None,
             "5d9fba7200362c90ec8f6b7f26ae914b38fff7c0486a6453df4b61941b129f67"),
            ("LS223",
             r#"{"palette":[{"falloff":6,"exponent":64,"color":{"r":255,"g":230,"b":150}},{"falloff":15,"exponent":96,"color":{"r":200,"g":150,"b":255}}]}"#.into(),
             37, None, "947fcc8dad10252a3fb5f3cdc9664f93b5bb5fc3f660481df28ff5416eb756a8"),
            ("LS224",
             r#"{"color":{"r":1,"g":2,"b":3},"palette":[{"falloff":6,"exponent":64,"color":{"r":255,"g":230,"b":150}}]}"#.into(),
             37, None, "70c84d3f9f17b3189ea126ce4c9b93da336b6197472e278110b852b294fda57a"),
            ("LS225",
             r#"{"palette":[{"falloff":8,"exponent":256,"color":{"r":1,"g":2,"b":3}},{"falloff":8,"exponent":256,"color":{"r":9,"g":9,"b":9}}]}"#.into(),
             37, None, "b41f67d95f8f6bc1d9c7cf89c99bc5049d72485b5c331d44265747d5d16d34cf"),
            ("LS226",
             r#"{"streetOnly":false,"palette":[{"falloff":2,"exponent":64,"color":{"r":10,"g":20,"b":30}},{"falloff":8,"exponent":128,"color":{"r":40,"g":50,"b":60}}]}"#.into(),
             324, None, "c0955ee89c24b382b739a5dc7289e105a92529924a8e04bc1a6314b2d127ec29"),
            ("LS227", r#"{"signatures":[{"falloff":8,"exponent":128}],"color":{"r":255,"g":0,"b":0}}"#.into(),
             110, None, "331eb9ae115084fa62ce663dddeba0ec794c092e2dc5d265a19ded8554272fc8"),
            ("LS228", r#"{"signatures":[{"falloff":8.04,"exponent":128.4}],"color":{"r":255,"g":0,"b":0}}"#.into(),
             110, None, "331eb9ae115084fa62ce663dddeba0ec794c092e2dc5d265a19ded8554272fc8"),
            ("LS229", r#"{"signatures":[{"falloff":8.2,"exponent":128}],"color":{"r":255,"g":0,"b":0}}"#.into(),
             37, None, "d82718b2cd5698f7a030586cf6ebfb533931fb701460823bb1eca4c014d8323c"),
            ("LS230", r#"{"signatures":[{"falloff":8,"exponent":128},{"falloff":2,"exponent":64}],"intensityScale":0.8}"#.into(),
             156, None, "25c23f61e5f3a6cf17203c1bdf17298673d70c972ef89ae49c39c5a057a628ee"),
            ("LS231", r#"{"streetOnly":false,"signatures":[{"falloff":8,"exponent":128}],"color":{"r":255,"g":0,"b":0}}"#.into(),
             324, None, "cb98a082e03f8584c4210c2514e6e1439c6f43697dbf0833d56a05d46aef93a8"),
            ("LS233",
             r#"{"extra":{"color":{"r":90,"g":255,"b":90},"points":[108.89227,-636.70685,47.19371,147.61226,-723.71735,49.565903,168.9728,-754.7538,49.565903,33.361988,-941.4249,31.92908,186.47285,-716.7913,37.678707],"radius":0.05}}"#.into(),
             5, None, "b7062b883698a9df1aff50b44726acb83e914ec09922e30c5a3418c9a9278331"),
            ("LS234", r#"{"extra":{"color":{"r":90,"g":255,"b":90},"points":[109.39227,-636.70685,47.19371]}}"#.into(),
             1, None, "29f921630ddd33df4b8a7cc462ad7067b316df1323cc0ec15a75f66833f30881"),
            ("LS239",
             r#"{"extra":{"color":{"r":1,"g":2,"b":3},"points":[107.99226999999999,-635.80685,47.19371,146.71226,-722.81735,49.565903,168.0728,-753.8538,49.565903],"radius":2}}"#.into(),
             3, None, "cc87c1ddd389dfc10d091888ce12cdedfb3e0141e66f200a5dc3b95530921664"),
            ("LS244",
             r#"{"streetOnly":false,"color":{"r":255,"g":200,"b":120},"intensityScale":0.8,"falloffScale":1.1,"exponentScale":0.9,"coronaScale":1.2}"#.into(),
             324, Some("1634ce276f0339dbccb38a91800fe11afa20934d5d4795f53a9d79f877440805"),
             "4059b2ebf618c9c57c68d383d3617508ddd3f5cf3bba8f784d1d9793ef71ed6f"),
            ("LS258",
             r#"{"signatures":[{"falloff":6,"exponent":32}],"color":{"r":255,"g":0,"b":0},"extra":{"color":{"r":0,"g":255,"b":0},"points":[108.89227,-636.70685,47.19371,147.61226,-723.71735,49.565903,168.9728,-754.7538,49.565903,33.361988,-941.4249,31.92908,186.47285,-716.7913,37.678707],"radius":0.05}}"#.into(),
             52, None, "2b03ab60828fdfd320dcdcf1c7ce0a862378cf0cff465442c992c96cf25fb437"),
            ("LS260",
             r#"{"color":{"r":255,"g":200,"b":120},"intensityScale":1.25,"falloffScale":0.9,"exponentScale":1.1,"coronaScale":1.5,"palette":[{"falloff":6,"exponent":64,"color":{"r":255,"g":230,"b":150}}],"extra":{"color":{"r":0,"g":255,"b":0},"points":[108.89227,-636.70685,47.19371,147.61226,-723.71735,49.565903,168.9728,-754.7538,49.565903,33.361988,-941.4249,31.92908,186.47285,-716.7913,37.678707],"radius":0.05}}"#.into(),
             42, Some("a59ad404940c83adccf19ab5dafd23cd69a9236246f46ab0701ad11c2f532e2f"),
             "0a99308511a672c0e4e1a09328a81572ef1bd7298bbf3cdc0f1c983ff212ecfb"),
        ];
        for (id, rule, changed, lod_sha, dist_sha) in cases {
            let bench = Bench::new();
            let response = bench.run_rule(&parse(&rule));
            let pair = first_pair(&response);
            assert_eq!(pair["changed"], changed, "{id}");
            assert_eq!(pair["lights"], 324, "{id}");
            assert_eq!(pair["streetLights"], 37, "{id}");
            assert_eq!(response["result"]["changed"], changed, "{id}");
            assert_eq!(pair["lodSha256"], lod_sha.unwrap_or(INPUT_LOD_SHA), "{id}");
            assert_eq!(pair["distantSha256"], dist_sha, "{id}");
            assert_eq!(
                bench.sha("o/lod_small045.ymap"),
                pair["lodSha256"].as_str().unwrap(),
                "{id}"
            );
            assert_eq!(
                bench.sha("o/dist_small045.ymap"),
                pair["distantSha256"].as_str().unwrap(),
                "{id}"
            );
        }
    }

    #[test]
    fn extra_points_on_every_plain_light_recolour_287_lights() {
        let bench = Bench::new();
        let distant =
            mlo::read_distant_lights(&meta_graph::read(&sample(DIST_NAME)).unwrap()).unwrap();
        let lod = mlo::read_lod_lights(&meta_graph::read(&sample(LOD_NAME)).unwrap()).unwrap();
        let points: Vec<f32> = distant
            .positions
            .iter()
            .zip(&lod.time_and_state_flags)
            .filter(|(_, flags)| **flags & STREET_BIT == 0)
            .flat_map(|(position, _)| *position)
            .collect();
        assert_eq!(points.len(), 861);
        let response = bench.run_rule(&json!({
            "extra": {"color": {"r": 0, "g": 255, "b": 0}, "points": points, "radius": 0.05}
        }));
        let pair = first_pair(&response);
        assert_eq!(pair["changed"], 287);
        assert_eq!(
            pair["distantSha256"],
            "8044a38a8b84b02e7380058dbf574f1d85d5c47478563570905cc94483f5fe44"
        );
    }

    #[test]
    fn the_parity_rule_on_three_pairs_matches_the_recorded_answer() {
        let bench = Bench::new();
        let rule_text = fs::read(test_support::engine(
            "parity/host-port/lamp-studio-lod/rule.json",
        ))
        .unwrap();
        let pairs = json!([
            bench.pair(
                "in/lodlights_small008.ymap",
                "in/distlodlights_small008.ymap",
                "o"
            ),
            bench.pair(
                "in/lodlights_medium017.ymap",
                "in/distlodlights_medium017.ymap",
                "o2"
            ),
            bench.default_pair(),
        ]);
        // Выходы у пар разные, но имена файлов в ответе берутся от входов.
        let response = bench.run_request(&json!({
            "lampStudioLodPairs": pairs,
            "lampStudioLodRule": serde_json::from_slice::<Value>(&rule_text).unwrap(),
        }));
        let expected = parse(
            r#"{"status": "ready", "mode": "lamp-studio-lod", "pairs": [ {"lod": "lodlights_small008.ymap", "distant": "distlodlights_small008.ymap", "lights": 626, "streetLights": 51, "changed": 147, "lodSha256": "647273cad65ff86735dae3a6006446aff83da581978da3c2388e0fee60825796", "distantSha256": "b76561857cddd194f47cf8bc9d396dce40b0b7cd232b480913a3270a02e443e6"}, {"lod": "lodlights_medium017.ymap", "distant": "distlodlights_medium017.ymap", "lights": 1039, "streetLights": 89, "changed": 89, "lodSha256": "1d97c90aaf09e61a16dcb968937c686b5504dfcea21d1abd72a750dc0b2a3557", "distantSha256": "3e7ac46b113bb09db0b5d09c1120037fe22beddfc1b64f0feaed72924d5f957b"}, {"lod": "lodlights_small045.ymap", "distant": "distlodlights_small045.ymap", "lights": 324, "streetLights": 37, "changed": 110, "lodSha256": "5225a2baa92ba1978a8e71bc38dc6dd49029641069db10d3c0623ebf48567cd1", "distantSha256": "40cf2bd8ac5cb700ef6c129433d85c794ecba30e7e829d8e160552b1f760d529"} ], "changed": 346, "validation": {"reopened": true, "onlyLightBytesChanged": true, "streetCountsMatch": true}}"#,
        );
        assert_eq!(response["result"], expected);
        // Порядок ключей ответа важен глазам: сверяем строкой.
        let keys: Vec<&String> = response["result"].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["status", "mode", "pairs", "changed", "validation"]);
        let written = [
            ("o/lod_small045.ymap", 4846u64), // выход третьей пары идёт в o/
            ("o/dist_small045.ymap", 4439),
        ];
        // Третья пара пишется в `o`, первая тоже: последняя запись побеждает.
        for (path, size) in written {
            assert_eq!(
                fs::metadata(bench.path(path)).unwrap().len(),
                size,
                "{path}"
            );
        }
        assert_eq!(
            fs::metadata(bench.path("o2/lod_small045.ymap"))
                .unwrap()
                .len(),
            10142
        );
        assert_eq!(
            fs::metadata(bench.path("o2/dist_small045.ymap"))
                .unwrap()
                .len(),
            10657
        );
    }

    #[test]
    fn written_files_keep_the_header_and_the_body_size() {
        let bench = Bench::new();
        bench.run_rule(&parse(&format!(r#"{{"color":{RED_ORANGE}}}"#)));
        for (input, output) in [
            (LOD_NAME, "o/lod_small045.ymap"),
            (DIST_NAME, "o/dist_small045.ymap"),
        ] {
            let before = sample(input);
            let after = fs::read(bench.path(output)).unwrap();
            assert_eq!(before[..16], after[..16]);
            let (old_body, new_body) = (
                Resource::parse(&before).unwrap(),
                Resource::parse(&after).unwrap(),
            );
            assert_eq!(old_body.data().len(), new_body.data().len());
        }
        assert_eq!(
            fs::metadata(bench.path("o/lod_small045.ymap"))
                .unwrap()
                .len(),
            4840
        );
        assert_eq!(
            fs::metadata(bench.path("o/dist_small045.ymap"))
                .unwrap()
                .len(),
            4436
        );
    }

    // ---------------------------------------------- пустые правки и пропуски

    #[test]
    fn rules_that_change_nothing_write_no_files_but_create_folders() {
        let nothing = [
            "{}",
            "[]",
            "5",
            "\"text\"",
            "true",
            "false",
            "0",
            r#"{"foo":1,"bar":[1]}"#,
            r#"{"color":null}"#,
            r#"{"intensityScale":1}"#,
            r#"{"coronaScale":1}"#,
            r#"{"palette":[]}"#,
            r#"{"extra":5}"#,
            r#"{"extra":{"color":{"r":0,"g":255,"b":0}}}"#,
            r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[],"radius":99}}"#,
            r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":"abc"}}"#,
            r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0],"radius":null}}"#,
            r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0],"radius":2}}"#,
            r#"{"streetOnly":false,"extra":{"color":{"r":90,"g":255,"b":90},"points":[108.89227,-636.70685,47.19371]}}"#,
            r#"{"extra":{"color":{"r":90,"g":255,"b":90},"points":[109.59227,-636.70685,47.19371]}}"#,
            r#"{"extra":{"color":{"r":255,"g":234,"b":178},"points":[108.89227,-636.70685,47.19371]}}"#,
            r#"{"extra":{"color":{"r":90,"g":255,"b":90},"points":[178.84366,-716.1918,49.132206]}}"#,
        ];
        for rule in nothing {
            let bench = Bench::new();
            let response = bench.run_rule(&parse(rule));
            let pair = first_pair(&response);
            assert_eq!(
                pair,
                &json!({"lod": LOD_NAME, "distant": DIST_NAME, "lights": 324, "streetLights": 37, "changed": 0}),
                "{rule}"
            );
            assert_eq!(response["result"]["changed"], 0, "{rule}");
            assert!(!bench.path("o").exists(), "{rule}");
        }
    }

    #[test]
    fn multipliers_out_of_range_refuse_only_when_a_light_is_looked_at() {
        let cases = [
            (
                r#"{"intensityScale":9}"#,
                "LOD rule intensityScale 9 is outside 0…8.",
            ),
            (
                r#"{"intensityScale":-0.5}"#,
                "LOD rule intensityScale -0.5 is outside 0…8.",
            ),
            (
                r#"{"intensityScale":8.0001}"#,
                "LOD rule intensityScale 8.0001 is outside 0…8.",
            ),
            (
                r#"{"falloffScale":0.04}"#,
                "LOD rule falloffScale 0.04 is outside 0.05…8.",
            ),
            (
                r#"{"falloffScale":8.5}"#,
                "LOD rule falloffScale 8.5 is outside 0.05…8.",
            ),
            (
                r#"{"falloffScale":0}"#,
                "LOD rule falloffScale 0 is outside 0.05…8.",
            ),
            (
                r#"{"exponentScale":0.04}"#,
                "LOD rule exponentScale 0.04 is outside 0.05…8.",
            ),
            (
                r#"{"exponentScale":9}"#,
                "LOD rule exponentScale 9 is outside 0.05…8.",
            ),
            (
                r#"{"coronaScale":-1}"#,
                "LOD rule coronaScale -1 is outside 0…8.",
            ),
            (
                r#"{"coronaScale":8.5}"#,
                "LOD rule coronaScale 8.5 is outside 0…8.",
            ),
            (
                r#"{"intensityScale":100000000000000000000}"#,
                "LOD rule intensityScale 100000000000000000000 is outside 0…8.",
            ),
            (
                r#"{"falloffScale":1.5e-7}"#,
                "LOD rule falloffScale 0.00000015 is outside 0.05…8.",
            ),
            (
                r#"{"exponentScale":16777217}"#,
                "LOD rule exponentScale 16777216 is outside 0.05…8.",
            ),
            (
                r#"{"intensityScale":9,"falloffScale":99}"#,
                "LOD rule intensityScale 9 is outside 0…8.",
            ),
            (
                r#"{"falloffScale":99,"coronaScale":99}"#,
                "LOD rule falloffScale 99 is outside 0.05…8.",
            ),
            (
                r#"{"streetOnly":false,"intensityScale":99}"#,
                "LOD rule intensityScale 99 is outside 0…8.",
            ),
        ];
        for (rule, message) in cases {
            let bench = Bench::new();
            assert_refused(
                &bench.run_rule(&parse(rule)),
                "InvalidDataException",
                message,
            );
            // Отказ убирает созданную ради выхода пустую папку (раньше она оставалась).
            assert!(!bench.path("o").exists(), "{rule}");
        }
    }

    #[test]
    fn pairs_with_odd_inputs_are_skipped_with_a_reason() {
        let white = parse(r#"{"color":{"r":255,"g":255,"b":255}}"#);
        let cases: [(&str, &str, &str, &str); 6] = [
            (
                "LS300",
                "in/distlodlights_small045.ymap",
                "in/lodlights_small045.ymap",
                "no-lod-lights",
            ),
            (
                "LS301",
                "in/lodlights_small045.ymap",
                "in/lodlights_small045.ymap",
                "no-lod-lights",
            ),
            (
                "LS302",
                "in/distlodlights_small045.ymap",
                "in/distlodlights_small045.ymap",
                "no-lod-lights",
            ),
            (
                "LS303",
                "in/lodlights_small045.ymap",
                "in/distlodlights_small008.ymap",
                "arrays-not-aligned",
            ),
            (
                "LS304",
                "in/lodlights_small008.ymap",
                "in/distlodlights_small045.ymap",
                "arrays-not-aligned",
            ),
            (
                "LS305",
                "in/lodlights_small045.ymap",
                "in/distlodlights_medium017.ymap",
                "arrays-not-aligned",
            ),
        ];
        for (id, lod, distant, reason) in cases {
            let bench = Bench::new();
            let response = bench.run_request(&json!({
                "lampStudioLodPairs": [bench.pair(lod, distant, "o")],
                "lampStudioLodRule": white,
            }));
            let pair = first_pair(&response);
            assert_eq!(pair["skipped"], reason, "{id}");
            assert_eq!(pair["changed"], 0, "{id}");
            assert!(pair.get("lights").is_none(), "{id}");
            assert!(!bench.path("o").exists(), "{id}");
        }
        // Диапазоны множителей не смотрятся, если пара пропущена (LS112).
        let bench = Bench::new();
        let response = bench.run_request(&json!({
            "lampStudioLodPairs": [bench.pair("in/distlodlights_small045.ymap", "in/lodlights_small045.ymap", "o")],
            "lampStudioLodRule": {"intensityScale":99,"falloffScale":99,"exponentScale":99,"coronaScale":99},
        }));
        assert_eq!(first_pair(&response)["skipped"], "no-lod-lights");
    }

    #[test]
    fn street_counts_must_match_the_distant_file() {
        let colour = parse(&format!(r#"{{"color":{RED_ORANGE}}}"#));
        let lod = sample(LOD_NAME);
        let variants: [(&str, Vec<u8>, &str); 5] = [
            (
                "LS306",
                with_flags(&lod, |i, f| if i == 37 { f | STREET_BIT } else { f }),
                "street-count-mismatch",
            ),
            (
                "LS307",
                with_flags(&lod, |i, f| if i == 0 { f & !STREET_BIT } else { f }),
                "street-count-mismatch",
            ),
            (
                "LS308",
                with_flags(&lod, |_, f| f & !STREET_BIT),
                "street-count-mismatch",
            ),
            (
                "LS309",
                with_flags(&lod, |_, f| f | STREET_BIT),
                "street-count-mismatch",
            ),
            (
                "LS310",
                with_flags(&lod, |i, f| match i {
                    0 => f & !STREET_BIT,
                    37 => f | STREET_BIT,
                    _ => f,
                }),
                "",
            ),
        ];
        for (id, bytes, reason) in variants {
            let bench = Bench::new();
            bench.put("in/synth.ymap", &bytes);
            let response = bench.run_request(&json!({
                "lampStudioLodPairs": [bench.pair("in/synth.ymap", "in/distlodlights_small045.ymap", "o")],
                "lampStudioLodRule": colour,
            }));
            let pair = first_pair(&response);
            if reason.is_empty() {
                assert_eq!(pair["changed"], 37, "{id}");
                assert_eq!(
                    pair["lodSha256"],
                    "7d59d2df8a0248d2422d057db9362ee14993c6a9d689264f57d7aacf536b76ec",
                    "{id}"
                );
                assert_eq!(
                    pair["distantSha256"],
                    "1487fce9edd353e208c39dce2ef0d30f02eb574baa61911270e514b4126da906",
                    "{id}"
                );
            } else {
                assert_eq!(pair["skipped"], reason, "{id}");
            }
        }
        // Несовпадение побеждает «править нечего» (LS311), но не предел множителя (LS312).
        let bench = Bench::new();
        bench.put("in/synth.ymap", &with_flags(&lod, |_, f| f & !STREET_BIT));
        let pairs = json!([bench.pair("in/synth.ymap", "in/distlodlights_small045.ymap", "o")]);
        let response =
            bench.run_request(&json!({"lampStudioLodPairs": pairs, "lampStudioLodRule": {}}));
        assert_eq!(first_pair(&response)["skipped"], "street-count-mismatch");
        let response = bench.run_request(
            &json!({"lampStudioLodPairs": pairs, "lampStudioLodRule": {"intensityScale": 9}}),
        );
        // без уличных огней и подписей множитель не рассматривается (LS113)
        assert_eq!(first_pair(&response)["skipped"], "street-count-mismatch");
    }

    #[test]
    fn a_skipped_pair_in_the_middle_does_not_stop_the_others() {
        let bench = Bench::new();
        let response = bench.run_request(&json!({
            "lampStudioLodPairs": [
                bench.pair("in/lodlights_small045.ymap", "in/distlodlights_small045.ymap", "o1"),
                bench.pair("in/lodlights_small045.ymap", "in/distlodlights_small008.ymap", "o2"),
                bench.pair("in/lodlights_small008.ymap", "in/distlodlights_small008.ymap", "o3"),
            ],
            "lampStudioLodRule": parse(&format!(r#"{{"color":{RED_ORANGE}}}"#)),
        }));
        let result = &response["result"];
        assert_eq!(result["changed"], 88);
        assert_eq!(result["pairs"][1]["skipped"], "arrays-not-aligned");
        assert_eq!(result["pairs"][2]["changed"], 51);
        assert_eq!(
            fs::metadata(bench.path("o3/dist_small045.ymap"))
                .unwrap()
                .len(),
            7661
        );
        assert_eq!(
            fs::metadata(bench.path("o3/lod_small045.ymap"))
                .unwrap()
                .len(),
            7305
        );
        assert!(!bench.path("o2").exists());
    }

    // ---------------------------------------------------- запрос и параметры

    #[test]
    fn process_level_refusals() {
        let bench = Bench::new();
        assert_refused(
            &bench.run_argv(&[]),
            "ArgumentException",
            "--request is required.",
        );
        assert_refused(
            &bench.run_argv(&["--request"]),
            "ArgumentException",
            "A value is required for --request.",
        );
        assert_refused(
            &bench.run_argv(&["--input", "x.json"]),
            "ArgumentException",
            "--request is required.",
        );
        let one = bench.text("one.json");
        assert_refused(
            &bench.run_argv(&["--request", &one]),
            "FileNotFoundException",
            &format!("File was not found: {one}"),
        );
        bench.put("request.txt", b"{}");
        assert_refused(
            &bench.run_argv(&["--request", &bench.text("request.txt")]),
            "ArgumentException",
            "Unsupported file extension: .txt",
        );
        fs::create_dir(bench.path("d.json")).unwrap();
        let folder = bench.text("d.json");
        assert_refused(
            &bench.run_argv(&["--request", &folder]),
            "FileNotFoundException",
            &format!("File was not found: {folder}"),
        );
        assert_refused(
            &bench.run_argv(&["--request", ""]),
            "ArgumentException",
            "The path is empty.",
        );
    }

    #[test]
    fn broken_requests_and_the_order_of_top_level_checks() {
        let bench = Bench::new();
        let broken = "Запрос правки огней LOD пустой или сломан.";
        for body in [&b""[..], b"not json", b"\xEF\xBB\xBF{}"] {
            bench.put("request.json", body);
            assert_refused(
                &bench.run_argv(&["--request", &bench.text("request.json")]),
                "InvalidDataException",
                broken,
            );
        }
        let pair = bench.default_pair();
        let count = "lamp-studio-lod needs 1-1024 pairs.";
        let many: Vec<Value> = (0..1025).map(|_| pair.clone()).collect();
        let refused = [
            (json!([]), count),
            (Value::Null, count),
            (json!({}), count),
            (json!({"lampStudioLodPairs": []}), count),
            (json!({"lampStudioLodPairs": {}}), count),
            (json!({"lampStudioLodPairs": "x"}), count),
            (
                json!({"lampStudioLodPairs": many, "lampStudioLodRule": {}}),
                count,
            ),
            (
                json!({"lampStudioLodPairs": [pair.clone()]}),
                "lamp-studio-lod needs a rule.",
            ),
            (
                json!({"lampStudioLodPairs": [pair.clone()], "lampStudioLodRule": null}),
                "lamp-studio-lod needs a rule.",
            ),
            (json!({"lampStudioLodRule": {}}), count),
        ];
        for (request, message) in refused {
            assert_refused(
                &bench.run_request(&request),
                "InvalidDataException",
                message,
            );
        }
        // Повтор параметра: берётся последний; ключ в другом регистре и лишний параметр.
        bench.run_request(&json!({"lampStudioLodPairs": [pair.clone()], "lampStudioLodRule": {}}));
        let request = bench.text("request.json");
        let last = bench.run_argv(&[
            "--request",
            "nowhere.json",
            "--REQUEST",
            &request,
            "--extra",
            "1",
        ]);
        assert_eq!(first_pair(&last)["changed"], 0);
    }

    #[test]
    fn rule_reading_errors_come_in_the_documented_order() {
        let colour = "lamp-studio-lod: цвет — три байта от 0 до 255.";
        let number = "lamp-studio-lod: число в правиле отсутствует.";
        let list = "lamp-studio-lod: список в правиле — массив.";
        let sigs17: Vec<Value> = (0..17)
            .map(|i| json!({"falloff": 100 + i, "exponent": 1}))
            .collect();
        let mut sigs17_bad = sigs17.clone();
        sigs17_bad.push(json!({"falloff": 1}));
        let cases: Vec<(String, &str)> = vec![
            (r#"{"color":{"r":256,"g":0,"b":0}}"#.into(), colour),
            (r#"{"color":{"r":-1,"g":0,"b":0}}"#.into(), colour),
            (r#"{"color":{"r":1.5,"g":0,"b":0}}"#.into(), colour),
            (r#"{"color":{"r":"1","g":0,"b":0}}"#.into(), colour),
            (r#"{"color":{"r":1,"b":0}}"#.into(), colour),
            (r#"{"color":5}"#.into(), colour),
            (r#"{"color":{}}"#.into(), colour),
            (r#"{"color":[1,2,3]}"#.into(), colour),
            (r#"{"intensityScale":"2"}"#.into(), number),
            (r#"{"intensityScale":true}"#.into(), number),
            (r#"{"intensityScale":[]}"#.into(), number),
            (r#"{"falloffScale":"x"}"#.into(), number),
            (r#"{"exponentScale":{}}"#.into(), number),
            (r#"{"coronaScale":false}"#.into(), number),
            (r#"{"color":{"r":300,"g":0,"b":0},"intensityScale":"x"}"#.into(), colour),
            (r#"{"intensityScale":"x","falloffScale":"y"}"#.into(), number),
            (r#"{"signatures":{},"color":{"r":300,"g":0,"b":0}}"#.into(), list),
            (r#"{"signatures":"x"}"#.into(), list),
            (r#"{"signatures":[{"exponent":128}]}"#.into(), number),
            (r#"{"signatures":[{"falloff":8}]}"#.into(), number),
            (r#"{"signatures":[5]}"#.into(), number),
            (json!({"signatures": sigs17}).to_string(), "lamp-studio-lod accepts at most 16 signatures."),
            (json!({"signatures": sigs17_bad}).to_string(), number),
            (r#"{"palette":{}}"#.into(), list),
            (r#"{"palette":[{"falloff":6,"exponent":64}]}"#.into(), colour),
            (r#"{"palette":[{"exponent":64,"color":{"r":256,"g":0,"b":0}}]}"#.into(), number),
            (r#"{"palette":[{"falloff":6,"color":{"r":256,"g":0,"b":0}}]}"#.into(), number),
            (r#"{"palette":[{"falloff":6,"exponent":64,"color":{"r":255,"g":255,"b":255}},{"falloff":6,"exponent":64,"color":{"r":1,"g":2,"b":300}}]}"#.into(), colour),
            (r#"{"extra":{"color":{"r":256,"g":0,"b":0},"points":[0,0,0]}}"#.into(), colour),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0,1]}}"#.into(), "lamp-studio-lod extra points must be x,y,z triples, at most 4096."),
            (json!({"extra": {"color": {"r":0,"g":255,"b":0}, "points": vec![0; 12291]}}).to_string(), "lamp-studio-lod extra points must be x,y,z triples, at most 4096."),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0],"radius":0.04}}"#.into(), "LOD rule extra.radius 0.04 is outside 0.05…2."),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0],"radius":2.1}}"#.into(), "LOD rule extra.radius 2.1 is outside 0.05…2."),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0],"radius":5}}"#.into(), "LOD rule extra.radius 5 is outside 0.05…2."),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0],"radius":-0.5}}"#.into(), "LOD rule extra.radius -0.5 is outside 0.05…2."),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,0,0],"radius":"1"}}"#.into(), number),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,"1",0]}}"#.into(), number),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[null,null,null]}}"#.into(), number),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,1e+39,0]}}"#.into(), "lamp-studio-lod extra point is not finite."),
            (r#"{"extra":{"color":{"r":0,"g":255,"b":0},"points":[0,"1",0],"radius":5}}"#.into(), "LOD rule extra.radius 5 is outside 0.05…2."),
        ];
        let bench = Bench::new();
        for (rule, message) in cases {
            let response = bench.run_rule(&parse(&rule));
            assert_refused(&response, "InvalidDataException", message);
        }
        // Допустимые границы.
        for rule in [
            json!({"signatures": sigs17[..16].to_vec()}),
            json!({"extra": {"color": {"r": 0, "g": 255, "b": 0}, "points": vec![0; 12288]}}),
        ] {
            assert_eq!(first_pair(&bench.run_rule(&rule))["changed"], 0);
        }
    }

    #[test]
    fn pair_paths_are_checked_in_order_and_outputs_are_prepared() {
        let bench = Bench::new();
        let rule = json!({});
        let missing = bench.text("none.ymap");
        let good = bench.default_pair();
        let with = |key: &str, value: Value| {
            let mut pair = good.clone();
            pair[key] = value;
            pair
        };
        let run_pair = |pair: Value| {
            bench.run_request(&json!({"lampStudioLodPairs": [pair], "lampStudioLodRule": rule}))
        };
        bench.put("a.txt", b"x");
        fs::create_dir(bench.path("d.ymap")).unwrap();
        let path_empty = ("ArgumentException", "The path is empty.".to_owned());
        let not_found = |p: &str| ("FileNotFoundException", format!("File was not found: {p}"));
        let checks: Vec<(Value, (&str, String))> = vec![
            (json!(5), path_empty.clone()),
            (Value::Null, path_empty.clone()),
            (json!("text"), path_empty.clone()),
            (json!({}), path_empty.clone()),
            (with("lodInput", Value::Null), path_empty.clone()),
            (with("lodInput", json!(7)), path_empty.clone()),
            (with("lodInput", json!(missing)), not_found(&missing)),
            (
                with("lodInput", json!(bench.text("a.txt"))),
                (
                    "ArgumentException",
                    "Unsupported file extension: .txt".into(),
                ),
            ),
            (
                with("lodInput", json!(bench.text("d.ymap"))),
                not_found(&bench.text("d.ymap")),
            ),
            (with("distantInput", Value::Null), path_empty.clone()),
            (with("distantInput", json!(missing)), not_found(&missing)),
            (with("lodOutput", Value::Null), path_empty.clone()),
            (
                with("lodOutput", json!(bench.text("x.txt"))),
                (
                    "ArgumentException",
                    "Unsupported output extension: .txt".into(),
                ),
            ),
            (
                with("lodOutput", json!(bench.text("noext"))),
                ("ArgumentException", "Unsupported output extension: ".into()),
            ),
            (with("distantOutput", Value::Null), path_empty.clone()),
            (
                with("distantOutput", json!(bench.text("y.txt"))),
                (
                    "ArgumentException",
                    "Unsupported output extension: .txt".into(),
                ),
            ),
        ];
        for (index, (pair, (code, message))) in checks.into_iter().enumerate() {
            assert_refused(&run_pair(pair), code, &message);
            assert!(!bench.path("o/lod_small045.ymap").exists(), "{index}");
        }
        // Оба входа плохи: побеждает lodInput.
        let mut pair = good.clone();
        pair["lodInput"] = json!(bench.text("a.ymap"));
        pair["distantInput"] = json!(bench.text("b.ymap"));
        assert_refused(
            &run_pair(pair),
            "FileNotFoundException",
            &format!("File was not found: {}", bench.text("a.ymap")),
        );
        // Папка lodOutput создаётся до отказа distantOutput, но отказ убирает её (раньше пустая папка оставалась).
        let mut pair = good.clone();
        pair["lodOutput"] = json!(bench.text("fresh/l.ymap"));
        pair["distantOutput"] = Value::Null;
        assert_refused(&run_pair(pair), "ArgumentException", "The path is empty.");
        assert!(!bench.path("fresh").exists());
        // Отказ входа раньше создания папок выходов.
        let mut pair = good.clone();
        pair["distantInput"] = json!(missing);
        pair["lodOutput"] = json!(bench.text("never/l.ymap"));
        run_pair(pair);
        assert!(!bench.path("never").exists());
        // Родитель выхода — файл.
        bench.put("afile", b"x");
        let mut pair = good.clone();
        pair["lodOutput"] = json!(bench.text("afile/l.ymap"));
        let (code, _) = failure_of(&run_pair(pair));
        assert_eq!(code, "IOException");
    }

    // --------------------------------------------------- файлы пары и запись

    #[test]
    fn broken_map_files_are_refused_with_the_neighbour_text() {
        let bench = Bench::new();
        let lod = sample(LOD_NAME);
        let dist = sample(DIST_NAME);
        let mut header_only = lod[..16].to_vec();
        header_only.truncate(16);
        let mut zero_body = lod[..16].to_vec();
        zero_body.extend_from_slice(&[0xFF, 0xFF]);
        let cases: Vec<(&str, Vec<u8>, Vec<u8>, &str)> = vec![
            (
                "LS418",
                b"plain text that is no resource".to_vec(),
                dist.clone(),
                "Файл не является ресурсом RSC7.",
            ),
            (
                "LS419",
                Vec::new(),
                dist.clone(),
                "Ресурс короче заголовка RSC7.",
            ),
            (
                "LS420",
                header_only,
                dist.clone(),
                "Поток ресурса пуст или не распакован.",
            ),
            (
                "LS421",
                lod[..lod.len() / 2].to_vec(),
                dist.clone(),
                "Файл метаданных без таблицы.",
            ),
            (
                "LS422",
                lod.clone(),
                b"plain text that is no resource".to_vec(),
                "Файл не является ресурсом RSC7.",
            ),
            (
                "LS423",
                b"plain text that is no resource".to_vec(),
                b"plain text that is no resource".to_vec(),
                "Файл не является ресурсом RSC7.",
            ),
            (
                "LS425",
                zero_body,
                dist.clone(),
                "Поток ресурса пуст или не распакован.",
            ),
        ];
        for (id, first, second, message) in cases {
            bench.put("in/x_lod.ymap", &first);
            bench.put("in/x_dist.ymap", &second);
            let response = bench.run_request(&json!({
                "lampStudioLodPairs": [bench.pair("in/x_lod.ymap", "in/x_dist.ymap", "o")],
                "lampStudioLodRule": {},
            }));
            assert_eq!(
                failure_of(&response),
                ("InvalidOperationException".into(), message.into()),
                "{id}"
            );
        }
    }

    #[test]
    fn writing_replaces_outputs_and_reports_half_written_pairs() {
        let color = parse(&format!(r#"{{"color":{RED_ORANGE}}}"#));
        // LS254: выходы уже есть.
        let bench = Bench::new();
        bench.put("o/lod_small045.ymap", b"old");
        bench.put("o/dist_small045.ymap", b"old");
        let response = bench.run_rule(&color);
        assert_eq!(first_pair(&response)["changed"], 37);
        assert_eq!(bench.sha("o/lod_small045.ymap"), INPUT_LOD_SHA);

        // LS252: выход поверх входа.
        let bench = Bench::new();
        let pair = json!({
            "lodInput": bench.text("in/lodlights_small045.ymap"),
            "distantInput": bench.text("in/distlodlights_small045.ymap"),
            "lodOutput": bench.text("in/lodlights_small045.ymap"),
            "distantOutput": bench.text("in/distlodlights_small045.ymap"),
        });
        // Раньше вход молча заменялся правленым; теперь отказ, вход цел.
        let response =
            bench.run_request(&json!({"lampStudioLodPairs": [pair], "lampStudioLodRule": color}));
        assert_eq!(
            failure_of(&response),
            (
                "InvalidDataException".to_owned(),
                MSG_OUTPUT_IS_INPUT.to_owned()
            )
        );
        assert_eq!(bench.sha("in/distlodlights_small045.ymap"), INPUT_DIST_SHA);
        assert_eq!(bench.sha("in/lodlights_small045.ymap"), INPUT_LOD_SHA);

        // LS264: та же пара дважды поверх входа; второй проход берёт уже правленый файл.
        let bench = Bench::new();
        let pair = json!({
            "lodInput": bench.text("in/lodlights_small045.ymap"),
            "distantInput": bench.text("in/distlodlights_small045.ymap"),
            "lodOutput": bench.text("in/lodlights_small045.ymap"),
            "distantOutput": bench.text("in/distlodlights_small045.ymap"),
        });
        let response = bench.run_request(&json!({"lampStudioLodPairs": [pair.clone(), pair], "lampStudioLodRule": {"falloffScale": 0.5}}));
        assert_eq!(failure_of(&response).1, MSG_OUTPUT_IS_INPUT);
        assert_eq!(bench.sha("in/lodlights_small045.ymap"), INPUT_LOD_SHA);

        // LS253: оба выхода в один путь.
        let bench = Bench::new();
        let same = bench.text("o/same.ymap");
        let pair = json!({
            "lodInput": bench.text("in/lodlights_small045.ymap"),
            "distantInput": bench.text("in/distlodlights_small045.ymap"),
            "lodOutput": same,
            "distantOutput": same,
        });
        let response =
            bench.run_request(&json!({"lampStudioLodPairs": [pair], "lampStudioLodRule": color}));
        // Раньше второе переименование падало, а на диске оставался один файл с содержимым дальней карты.
        assert_eq!(failure_of(&response).1, MSG_OUTPUTS_SHARE_PATH);
        assert!(
            !bench.path("o").exists(),
            "ничего не записано, папка убрана"
        );

        // LS415 и LS417: выход — папка с именем .ymap.
        let bench = Bench::new();
        fs::create_dir_all(bench.path("o/lod_small045.ymap")).unwrap();
        let response = bench.run_rule(&color);
        assert_eq!(failure_of(&response).0, "UnauthorizedAccessException");
        let bench = Bench::new();
        fs::create_dir_all(bench.path("o/dist_small045.ymap")).unwrap();
        let response = bench.run_rule(&color);
        assert_eq!(failure_of(&response).0, "UnauthorizedAccessException");
        // Пара не остаётся наполовину записанной: первый результат, поставленный этой же командой, убран (раньше оставался).
        assert!(!bench.path("o/lod_small045.ymap").exists());
        assert_eq!(fs::read_dir(bench.path("o")).unwrap().count(), 1);
        // LS416: править нечего, папка-выход не мешает.
        let bench = Bench::new();
        fs::create_dir_all(bench.path("o/lod_small045.ymap")).unwrap();
        assert_eq!(first_pair(&bench.run_rule(&json!({})))["changed"], 0);
    }

    #[test]
    fn second_pair_failure_keeps_the_first_pairs_outputs() {
        let color = parse(&format!(r#"{{"color":{RED_ORANGE}}}"#));
        let bench = Bench::new();
        let mut second = bench.pair(
            "in/lodlights_small045.ymap",
            "in/distlodlights_small045.ymap",
            "o2",
        );
        second["lodInput"] = json!(bench.text("none.ymap"));
        let response = bench.run_request(&json!({
            "lampStudioLodPairs": [bench.pair("in/lodlights_small045.ymap", "in/distlodlights_small045.ymap", "o1"), second],
            "lampStudioLodRule": color,
        }));
        assert_eq!(failure_of(&response).0, "FileNotFoundException");
        assert_eq!(
            fs::metadata(bench.path("o1/lod_small045.ymap"))
                .unwrap()
                .len(),
            4840
        );
        assert!(!bench.path("o2").exists());
    }

    #[test]
    fn a_thousand_and_twenty_four_empty_pairs_make_one_line() {
        let bench = Bench::new();
        let pair = bench.default_pair();
        let pairs: Vec<Value> = (0..1024).map(|_| pair.clone()).collect();
        let response =
            bench.run_request(&json!({"lampStudioLodPairs": pairs, "lampStudioLodRule": {}}));
        assert_eq!(response["result"]["pairs"].as_array().unwrap().len(), 1024);
        assert_eq!(response["result"]["changed"], 0);
    }

    #[test]
    fn the_second_pass_over_the_first_output_reads_the_new_values() {
        let bench = Bench::new();
        let rule = parse(r#"{"falloffScale":0.5}"#);
        let first = bench.pair(
            "in/lodlights_small045.ymap",
            "in/distlodlights_small045.ymap",
            "o1",
        );
        let mut second = bench.pair(
            "in/lodlights_small045.ymap",
            "in/distlodlights_small045.ymap",
            "o2",
        );
        second["lodInput"] = first["lodOutput"].clone();
        second["distantInput"] = first["distantOutput"].clone();
        // Для второй пары вход создаётся первой: до запуска его нет, поэтому два запуска.
        bench.run_request(&json!({"lampStudioLodPairs": [first], "lampStudioLodRule": rule}));
        let response =
            bench.run_request(&json!({"lampStudioLodPairs": [second], "lampStudioLodRule": rule}));
        assert_eq!(first_pair(&response)["changed"], 37);
        let after = mlo::read_lod_lights(
            &meta_graph::read(&fs::read(bench.path("o2/lod_small045.ymap")).unwrap()).unwrap(),
        )
        .unwrap();
        let origin = mlo::read_lod_lights(&meta_graph::read(&sample(LOD_NAME)).unwrap()).unwrap();
        assert_eq!(after.falloff[0], origin.falloff[0] * 0.25);
        assert_eq!(after.falloff[100], origin.falloff[100]);
    }
}
