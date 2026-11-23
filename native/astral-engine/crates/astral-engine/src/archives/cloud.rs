//! Команда `extract-cloud-hats`: из `v_clouds.rpf` берутся оболочки облаков
//! (вершины, индексы, шейдерные значения) и листы плотности. Опись и листы
//! уходят в папку вывода, игра остаётся нетронутой.

use std::{
    collections::{BTreeSet, HashSet},
    fs,
    path::Path,
    sync::Arc,
};

use rage_res::{
    hash::joaat,
    png_io,
    texture::{decode, read_dictionary, read_dictionary_at, Image, TextureRef},
    vertex::{self, Element, Layout},
    Resource,
};
use rage_rpf::{Archive, EntryId, EntryKind, KeySet};
use serde_json::{Map, Number, Value};

use super::{game_root, load_keys};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths::full_path,
    progress::Progress,
    response::ascii_json,
};

const NOT_FOUND: &str = "levels/gta5/cloudhats/v_clouds.rpf was not found in the game archives.";
const MANIFEST: &str = "hats.json";
const MANIFEST_VERSION: u32 = 2;
const FILE_CEILING: usize = 64 << 20;
const PART_LIMIT: usize = 4096;
const SHADER_LIMIT: usize = 512;
const GEOMETRY_LIMIT: usize = 1024;
const TANGENT: usize = 14;

/// Откуда берётся `v_clouds.rpf`: архив игры и путь внутри него.
const CLOUD_PLACES: [(&str, &str); 2] = [
    (
        "update/update.rpf",
        "x64/levels/gta5/cloudhats/v_clouds.rpf",
    ),
    ("x64b.rpf", "levels/gta5/cloudhats/v_clouds.rpf"),
];

/// Сколько первых имён таблицы — гнёзда с листами плотности и нормалей.
const SHEET_SLOT_COUNT: usize = 6;

/// Имена параметров, которые модуль умеет называть по хешу.
const PARAMETER_NAMES: [&str; 36] = [
    "DensitySampler",
    "normalSampler",
    "DetailDensitySampler",
    "DetailNormalSampler",
    "DetailDensity2Sampler",
    "DetailNormal2Sampler",
    "cloudLayerAnimScale1",
    "cloudLayerAnimScale2",
    "cloudLayerAnimScale3",
    "gAmbientColor",
    "gAnimBlendWeights",
    "gAnimCombine",
    "gAnimSculpt",
    "gBounceColor",
    "gCameraPos",
    "gCloudColor",
    "gCloudViewProj",
    "gDensityShiftScale",
    "gEastMinusWestColor",
    "gNearFarQMult",
    "gPiercingLightPower_Strength_NormalStrength_Thickness",
    "gRescaleUV1",
    "gRescaleUV2",
    "gRescaleUV3",
    "gScaleDiffuseFillAmbient",
    "gScatterG_GSquared_PhaseMult_Scale",
    "gSkyColor",
    "gSoftParticleRange",
    "gSunColor",
    "gSunDirection",
    "gUVOffset",
    "gUVOffset1",
    "gUVOffset2",
    "gUVOffset3",
    "gWestColor",
    "gWrapLighting_MSAARef",
];

/// Имена типов элемента вершины по коду.
const TYPE_NAMES: [&str; 11] = [
    "Nothing",
    "Half2",
    "Float",
    "Half4",
    "FloatUnk",
    "Float2",
    "Float3",
    "Float4",
    "UByte4",
    "Colour",
    "RGBA8SNorm",
];

/// Причина пропуска файла бывает только текстом.
type Plain<T> = std::result::Result<T, String>;

/// Нечитаемый нужный лист: имя листа и строка для `skipped`.
type Unreadable = (String, String);

// ---------------------------------------------------------------------------
// Записи JSON, Base64, числа и имена
// ---------------------------------------------------------------------------

fn field<V: Into<Value>>(key: &'static str, value: V) -> (&'static str, Value) {
    (key, value.into())
}

/// Объект JSON с ключами в порядке перечисления.
fn object(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Стандартный Base64 с `=` до кратности четырём, без переводов строки.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let digit = |six: u32| char::from(ALPHABET[(six & 0x3f) as usize]);
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    // Накопитель держит ещё не выданные биты, их число — в `held`.
    let (mut bits, mut held) = (0u32, 0u32);
    for &byte in bytes {
        bits = bits << 8 | u32::from(byte);
        held += 8;
        while held >= 6 {
            held -= 6;
            out.push(digit(bits >> held));
        }
        bits &= (1 << held) - 1;
    }
    if held > 0 {
        out.push(digit(bits << (6 - held)));
    }
    while out.len() % 4 != 0 {
        out.push('=');
    }
    out
}

/// f32 → кратчайшая десятичная запись → f64 → число JSON (NaN и бесконечность — `null`).
fn json_number(value: f32) -> Value {
    let wide: Option<f64> = value
        .is_finite()
        .then(|| format!("{value}").parse().ok())
        .flatten();
    match wide.and_then(Number::from_f64) {
        Some(number) => Value::Number(number),
        None => Value::Null,
    }
}

fn parameter_name(hash: u32) -> String {
    match PARAMETER_NAMES.iter().find(|name| joaat(name) == hash) {
        Some(name) => name.to_string(),
        None => hash.to_string(),
    }
}

fn type_name(code: u8) -> String {
    match TYPE_NAMES.get(usize::from(code)) {
        Some(name) => (*name).to_owned(),
        None => code.to_string(),
    }
}

/// Имя листа → имя файла: буквы, цифры, `_` и `-` остаются, прочее — `_`.
fn sheet_file(name: &str) -> String {
    let mut file = String::with_capacity(name.len() + 4);
    for ch in name.chars() {
        file.push(if ch.is_alphanumeric() || matches!(ch, '_' | '-') {
            ch
        } else {
            '_'
        });
    }
    file.push_str(".png");
    file
}

// ---------------------------------------------------------------------------
// Курсор по данным ресурса
// ---------------------------------------------------------------------------

/// Позиция в данных ресурса: все чтения идут от неё.
#[derive(Clone, Copy)]
struct Probe<'r> {
    res: &'r Resource,
    at: usize,
}

impl<'r> Probe<'r> {
    fn plus(self, delta: usize) -> Probe<'r> {
        Probe {
            at: self.at + delta,
            ..self
        }
    }

    /// Указатель, лежащий в этой позиции, — как новая позиция.
    fn target(self) -> Option<Probe<'r>> {
        let at = self.res.pointer_at(self.at)?;
        Some(Probe { at, ..self })
    }

    fn field(self, delta: usize) -> Option<Probe<'r>> {
        self.plus(delta).target()
    }

    fn byte(self, delta: usize) -> Option<u8> {
        self.res.u8(self.at + delta).ok()
    }

    fn short(self, delta: usize) -> Option<u16> {
        self.res.u16(self.at + delta).ok()
    }

    fn word(self, delta: usize) -> Option<u32> {
        self.res.u32(self.at + delta).ok()
    }

    fn quad(self, delta: usize) -> Option<u64> {
        self.res.u64(self.at + delta).ok()
    }

    fn real(self, delta: usize) -> Option<f32> {
        self.res.f32(self.at + delta).ok()
    }

    fn short_strict(self, delta: usize) -> rage_res::Result<u16> {
        self.res.u16(self.at + delta)
    }

    fn span(self, len: usize) -> Option<&'r [u8]> {
        self.res.bytes(self.at, len).ok()
    }

    /// Список в этой позиции: начало массива и число записей.
    fn list(self) -> Option<(Probe<'r>, usize)> {
        let header = self.res.pointer_list(self.at).ok()?;
        let array = self.res.at(header.entries)?;
        Some((Probe { at: array, ..self }, usize::from(header.count)))
    }
}

// ---------------------------------------------------------------------------
// Шейдеры
// ---------------------------------------------------------------------------

/// Шейдер геометрии: хеш, два упорядоченных набора значений и все листы,
/// названные в записях гнёзд (в том числе перекрытые повтором имени).
#[derive(Default)]
struct ShaderData {
    hash: u32,
    textures: Map<String, Value>,
    parameters: Map<String, Value>,
    slot_sheets: Vec<String>,
}

impl ShaderData {
    fn read(at: Probe) -> Option<ShaderData> {
        let declared = usize::from(at.byte(0x10)?);
        let mut shader = ShaderData {
            hash: at.word(0x18)?,
            ..ShaderData::default()
        };
        if let Some(table) = at.target() {
            shader.fill(table, declared);
        }
        Some(shader)
    }

    fn fill(&mut self, table: Probe, declared: usize) {
        // Виды читаются, пока читаются; сумма прочитанных двигает таблицу хешей.
        let kinds: Vec<usize> = (0..declared)
            .map_while(|index| table.plus(index * 16).byte(0).map(usize::from))
            .collect();
        let hashes = table.plus((declared + kinds.iter().sum::<usize>()) * 16);
        for (index, kind) in kinds.into_iter().enumerate() {
            let Some(hash) = hashes.plus(index * 4).word(0) else {
                continue;
            };
            let object = table.plus(index * 16);
            match kind {
                0 => self.take_sheet(parameter_name(hash), object),
                vectors => self.take_vector(parameter_name(hash), object, vectors * 4),
            }
        }
    }

    fn take_sheet(&mut self, name: String, object: Probe) {
        let label = object
            .field(0x08)
            .and_then(|object| object.plus(0x28).quad(0))
            .and_then(|pointer| object.res.cstring(pointer))
            .filter(|text| !text.is_empty());
        let Some(label) = label else { return };
        if PARAMETER_NAMES[..SHEET_SLOT_COUNT]
            .iter()
            .any(|slot| slot.eq_ignore_ascii_case(&name))
        {
            self.slot_sheets.push(label.clone());
        }
        self.textures.insert(name, Value::String(label));
    }

    fn take_vector(&mut self, name: String, object: Probe, lanes: usize) {
        let Some(start) = object.field(0x08) else {
            return;
        };
        let values: Option<Vec<Value>> = (0..lanes)
            .map(|lane| start.plus(lane * 4).real(0).map(json_number))
            .collect();
        if let Some(values) = values {
            self.parameters.insert(name, Value::Array(values));
        }
    }
}

fn shaders_of(group: Probe) -> Vec<Option<ShaderData>> {
    let count = group.short(0x18).map_or(0, usize::from).min(SHADER_LIMIT);
    match group.field(0x10) {
        Some(array) => (0..count)
            .map(|index| array.plus(index * 8).target().and_then(ShaderData::read))
            .collect(),
        None => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Вершины
// ---------------------------------------------------------------------------

/// Каналы вершины: семантика, сколько чисел брать и что подставить, если элемента нет.
const VERTEX_LANES: [(usize, usize, [f32; 4]); 4] = [
    (vertex::POSITION, 3, [0.0; 4]),
    (vertex::NORMAL, 3, [0.0, 0.0, 1.0, 0.0]),
    (TANGENT, 4, [0.0; 4]),
    (vertex::UV0, 2, [0.0; 4]),
];

/// Сколько каналов у типа по-настоящему и какой они ширины в байтах.
fn native_shape(code: u8) -> Option<(usize, usize)> {
    Some(match code {
        vertex::FLOAT => (1, 4),
        vertex::FLOAT2 => (2, 4),
        vertex::FLOAT3 => (3, 4),
        vertex::FLOAT4 => (4, 4),
        vertex::HALF2 => (2, 2),
        vertex::HALF4 => (4, 2),
        _ => return None,
    })
}

/// Число из `width` байт вершины с позиции `from`; за концом вершины — ноль.
fn number_at(vertex_bytes: &[u8], from: usize, width: usize) -> f32 {
    match vertex_bytes.get(from..from + width) {
        Some(&[a, b, c, d]) if width == 4 => f32::from_le_bytes([a, b, c, d]),
        Some(&[a, b]) if width == 2 => vertex::half_to_float(u16::from_le_bytes([a, b])),
        _ => 0.0,
    }
}

/// Значение одного канала элемента. Недостающие каналы: четвёртый — единица,
/// остальные — нули; типы, которых модуль не читает, дают нули везде.
fn channel_of(vertex_bytes: &[u8], element: Element, channel: usize) -> f32 {
    let byte = vertex_bytes.get(element.offset + channel).copied();
    match (element.type_code, native_shape(element.type_code)) {
        (vertex::RGBA8_SNORM, _) => byte.map_or(0.0, |b| f32::from(b as i8) / 127.0),
        (vertex::UBYTE4 | vertex::COLOUR, _) => byte.map_or(0.0, |b| f32::from(b) / 255.0),
        (_, Some((channels, width))) if channel < channels => {
            number_at(vertex_bytes, element.offset + channel * width, width)
        }
        (_, Some(_)) if channel == 3 => 1.0,
        _ => 0.0,
    }
}

/// Числа одного канала у всех вершин подряд.
fn lane_values(
    raw: &[u8],
    stride: usize,
    layout: &Layout,
    lane: (usize, usize, [f32; 4]),
) -> Vec<f32> {
    let (semantic, width, fallback) = lane;
    let element = layout.get(semantic);
    raw.chunks_exact(stride)
        .flat_map(|vertex_bytes| {
            let mut values = fallback;
            if let Some(found) = element {
                for (channel, slot) in values.iter_mut().enumerate().take(width) {
                    *slot = channel_of(vertex_bytes, found, channel);
                }
            }
            values.into_iter().take(width)
        })
        .collect()
}

/// Цвет: четыре байта с позиции элемента; чего нет в вершине, то 255.
fn colour_stream(raw: &[u8], stride: usize, layout: &Layout) -> Vec<u8> {
    let start = layout.get(vertex::COLOUR0).map(|element| element.offset);
    raw.chunks_exact(stride)
        .flat_map(|vertex_bytes| {
            (0..4).map(move |shift| {
                start
                    .and_then(|from| vertex_bytes.get(from + shift))
                    .copied()
                    .unwrap_or(255)
            })
        })
        .collect()
}

fn floats_to_bytes(values: &[f32]) -> Vec<u8> {
    values.iter().copied().flat_map(f32::to_le_bytes).collect()
}

// ---------------------------------------------------------------------------
// Геометрия и модель
// ---------------------------------------------------------------------------

/// Описание геометрии для описи и листы, которые она просит у шейдера.
struct HatGeometry {
    json: Value,
    wanted_sheets: Vec<String>,
}

/// Всё, что геометрия берёт из вершинного и индексного буферов.
struct BufferSet<'r> {
    count: usize,
    index_count: usize,
    flags: u32,
    declared: u16,
    buffer_stride: u16,
    types: u64,
    data: Probe<'r>,
    indices: Probe<'r>,
}

impl<'r> BufferSet<'r> {
    /// `None`, если хоть одно поле не читается или не разрешился указатель.
    fn locate(geometry: Probe<'r>) -> Option<BufferSet<'r>> {
        let vertex_buffer = geometry.field(0x18)?;
        let index_buffer = geometry.field(0x38)?;
        let declaration = vertex_buffer.field(0x30)?;
        Some(BufferSet {
            count: usize::try_from(vertex_buffer.word(0x18)?).ok()?,
            index_count: usize::try_from(index_buffer.word(0x08)?).ok()?,
            flags: declaration.word(0)?,
            declared: declaration.short(0x04)?,
            buffer_stride: vertex_buffer.short(0x08)?,
            types: declaration.quad(0x08)?,
            data: vertex_buffer
                .field(0x10)
                .or_else(|| vertex_buffer.field(0x20))?,
            indices: index_buffer.field(0x10)?,
        })
    }
}

fn geometry_of(geometry: Probe, shader: Option<&ShaderData>) -> Option<HatGeometry> {
    let buffers = BufferSet::locate(geometry)?;
    if buffers.count == 0 || buffers.index_count == 0 {
        return None;
    }
    let layout = vertex::layout_lenient(buffers.flags, buffers.types);
    // Шаг: буфер, затем описание, затем сумма размеров элементов.
    let stride = [
        usize::from(buffers.buffer_stride),
        usize::from(buffers.declared),
        layout.stride,
    ]
    .into_iter()
    .find(|candidate| *candidate > 0)?;
    let raw = buffers.data.span(buffers.count.checked_mul(stride)?)?;
    let indices = buffers.indices.span(buffers.index_count.checked_mul(2)?)?;

    let [position, normal, tangent, uv] =
        VERTEX_LANES.map(|lane| lane_values(raw, stride, &layout, lane));
    let colour_type = match layout.get(vertex::COLOUR0) {
        Some(element) => type_name(element.type_code),
        None => "none".to_owned(),
    };
    let (textures, parameters, wanted_sheets) = match shader {
        Some(found) => (
            found.textures.clone(),
            found.parameters.clone(),
            found.slot_sheets.clone(),
        ),
        None => Default::default(),
    };

    let json = object([
        field("vertexCount", buffers.count),
        field(
            "layout",
            object([
                field("flags", buffers.flags),
                field("types", format!("{:016X}", buffers.types)),
                field("stride", stride),
                field("declared", buffers.declared),
                field("bytes", buffers.count * stride),
            ]),
        ),
        field("position", base64(&floats_to_bytes(&position))),
        field("normal", base64(&floats_to_bytes(&normal))),
        field("tangent", base64(&floats_to_bytes(&tangent))),
        field("uv", base64(&floats_to_bytes(&uv))),
        field("colour", base64(&colour_stream(raw, stride, &layout))),
        field("colourType", colour_type),
        field("index", base64(indices)),
        field("shader", shader.map(|found| found.hash.to_string())),
        field("textures", Value::Object(textures)),
        field("parameters", Value::Object(parameters)),
    ]);
    Some(HatGeometry {
        json,
        wanted_sheets,
    })
}

/// Части модели; всё, что не читается, молча выпадает.
fn part_probes(root: Probe) -> Vec<Probe> {
    let Some((array, count)) = root.field(0x50).and_then(Probe::list) else {
        return Vec::new();
    };
    (0..count.min(PART_LIMIT))
        .filter_map(|index| array.plus(index * 8).target())
        .collect()
}

fn collect_part(
    part: Probe,
    shaders: &[Option<ShaderData>],
    out: &mut Vec<HatGeometry>,
) -> rage_res::Result<()> {
    let count = usize::from(part.short_strict(0x10)?).min(GEOMETRY_LIMIT);
    let Some(array) = part.field(0x08) else {
        return Ok(());
    };
    let shader_of = part.field(0x20);
    let found = (0..count).filter_map(|index| {
        let geometry = array.plus(index * 8).target()?;
        let slot = shader_of
            .and_then(|map| map.plus(index * 2).short(0))
            .map_or(0, usize::from);
        geometry_of(
            geometry,
            shaders.get(slot).and_then(|shader| shader.as_ref()),
        )
    });
    out.extend(found);
    Ok(())
}

/// Разобранная модель: геометрии и словарь листов, встроенный в группу шейдеров.
struct Parsed {
    geometries: Vec<HatGeometry>,
    embedded: Vec<TextureRef>,
}

fn parse_model(res: &Resource) -> rage_res::Result<Parsed> {
    let root = res
        .root()
        .map(|at| Probe { res, at })
        .ok_or_else(|| rage_res::Error::broken("no drawable"))?;
    let group = root.field(0x10);
    let shaders = group.map(shaders_of).unwrap_or_default();
    let mut geometries = Vec::new();
    for part in part_probes(root) {
        collect_part(part, &shaders, &mut geometries)?;
    }
    let embedded = group
        .and_then(|at| read_dictionary_at(res, at.field(0x08).map(|dict| dict.at)).ok())
        .unwrap_or_default();
    Ok(Parsed {
        geometries,
        embedded,
    })
}

// ---------------------------------------------------------------------------
// Сбор по файлам v_clouds.rpf
// ---------------------------------------------------------------------------

/// Словарь листов вместе с ресурсом, из которого читаются пиксели.
struct SheetBook {
    /// Файл `v_clouds.rpf`, из которого словарь взят.
    origin: String,
    resource: Resource,
    textures: Vec<TextureRef>,
}

impl SheetBook {
    /// Текстуры, чьё имя нужно и ещё не занято (выбор на начало словаря).
    fn picks(&self, wanted: &HashSet<String>, taken: &HashSet<String>) -> Vec<&TextureRef> {
        let mut chosen: Vec<&TextureRef> = self.textures.iter().collect();
        chosen.retain(|texture| {
            let lower = texture.name.to_ascii_lowercase();
            !taken.contains(&lower) && wanted.contains(&lower)
        });
        chosen
    }

    /// PNG первого уровня; отказ — текст причины для `skipped`.
    fn render(&self, texture: &TextureRef) -> Plain<Vec<u8>> {
        let Image {
            width,
            height,
            rgba,
            ..
        } = decode(&self.resource, texture, Some(0), None).map_err(|error| error.message)?;
        png_io::encode(width, height, &rgba).map_err(|error| error.message)
    }
}

/// Файл архива целиком как ресурс; отказ — строка для `skipped`.
fn resource_of(archive: &Archive, id: EntryId) -> Plain<Resource> {
    let bytes = match archive.export(id) {
        Ok(bytes) => bytes,
        Err(error) => return Err(EngineError::from(error).message),
    };
    match bytes.len() {
        0 => Err("size 0".to_owned()),
        len if len > FILE_CEILING => Err(format!("size {len}")),
        _ => Resource::parse(&bytes).map_err(|error| error.message),
    }
}

#[derive(Default)]
struct Collected {
    drawables: Map<String, Value>,
    sheets: Vec<SheetBook>,
    needed: BTreeSet<String>,
    skipped: Vec<String>,
}

impl Collected {
    fn take(&mut self, archive: &Archive, id: EntryId) {
        let name = archive.entry(id).name.as_str();
        let Some((stem, extension)) = name.rsplit_once('.').filter(|(stem, _)| !stem.is_empty())
        else {
            return;
        };
        let absorb: fn(&mut Collected, &str, &str, Resource) -> Plain<()> =
            match extension.to_ascii_lowercase().as_str() {
                "ydr" => Collected::model,
                "ytd" => Collected::dictionary,
                _ => return,
            };
        let outcome =
            resource_of(archive, id).and_then(|resource| absorb(self, name, stem, resource));
        if let Err(reason) = outcome {
            self.skipped.push(format!("{name}: {reason}"));
        }
    }

    fn dictionary(&mut self, name: &str, _stem: &str, resource: Resource) -> Plain<()> {
        let textures = read_dictionary(&resource).map_err(|error| error.message)?;
        self.sheets.push(SheetBook {
            origin: name.to_owned(),
            resource,
            textures,
        });
        Ok(())
    }

    fn model(&mut self, name: &str, stem: &str, resource: Resource) -> Plain<()> {
        let Parsed {
            geometries,
            embedded,
        } = parse_model(&resource).map_err(|error| error.message)?;
        self.needed.extend(
            geometries
                .iter()
                .flat_map(|geometry| geometry.wanted_sheets.iter().cloned()),
        );
        if !geometries.is_empty() {
            let listed: Vec<Value> = geometries
                .into_iter()
                .map(|geometry| geometry.json)
                .collect();
            self.drawables
                .insert(stem.to_owned(), object([field("geometries", listed)]));
        }
        if !embedded.is_empty() {
            self.sheets.push(SheetBook {
                origin: name.to_owned(),
                resource,
                textures: embedded,
            });
        }
        Ok(())
    }

    /// Выкладывает нужные листы по словарям в порядке нахождения; вторым идут
    /// нечитаемые нужные листы: имя листа и строка для `skipped`.
    fn lay_out(&self, out_dir: &Path) -> Result<(Map<String, Value>, Vec<Unreadable>)> {
        let wanted: HashSet<String> = self
            .needed
            .iter()
            .map(|name| name.to_ascii_lowercase())
            .collect();
        let mut shelf = SheetShelf {
            dir: out_dir,
            placed: Map::new(),
            unreadable: Vec::new(),
        };
        self.sheets
            .iter()
            .try_for_each(|sheets| shelf.shelve(sheets, &wanted))?;
        Ok((shelf.placed, shelf.unreadable))
    }
}

/// Полка готовых листов: папка вывода и то, что уже в неё легло.
struct SheetShelf<'a> {
    dir: &'a Path,
    placed: Map<String, Value>,
    /// Нужные листы, которые не прочитались: имя листа и строка для `skipped`.
    unreadable: Vec<Unreadable>,
}

impl SheetShelf<'_> {
    fn shelve(&mut self, sheets: &SheetBook, wanted: &HashSet<String>) -> Result<()> {
        let taken: HashSet<String> = self
            .placed
            .keys()
            .map(|key| key.to_ascii_lowercase())
            .collect();
        for texture in sheets.picks(wanted, &taken) {
            let png = match sheets.render(texture) {
                Ok(png) => png,
                Err(reason) => {
                    let line = format!("{}/{}: {reason}", sheets.origin, texture.name);
                    self.unreadable.push((texture.name.clone(), line));
                    continue;
                }
            };
            let file = sheet_file(&texture.name);
            fs::write(self.dir.join(&file), png)?;
            let entry = object([
                field("file", file),
                field("width", texture.width),
                field("height", texture.height),
            ]);
            self.placed.insert(texture.name.clone(), entry);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Поиск архива и команда
// ---------------------------------------------------------------------------

/// Двоичная запись по пути из каталогов и файла; ресурс на её месте не годится.
fn binary_at(archive: &Archive, route: &str) -> Option<EntryId> {
    let (folders, leaf) = route.rsplit_once('/')?;
    let mut dir = archive.root();
    for step in folders.split('/') {
        dir = archive.find_dir(dir, step)?;
    }
    let id = archive.find_file(dir, leaf)?;
    matches!(archive.entry(id).kind, EntryKind::Binary(_)).then_some(id)
}

/// Один источник: `Ok(None)`, если в нём `v_clouds.rpf` нет; отказ открытия — ошибка.
fn probe_source(
    root: &Path,
    keys: &Arc<KeySet>,
    archive_name: &str,
    route: &str,
) -> Result<Option<(String, Archive)>> {
    let outer = Archive::open_path(&root.join(archive_name), Some(Arc::clone(keys)))?;
    let opened = binary_at(&outer, route)
        .map(|id| outer.open_nested(id))
        .transpose()?
        .map(|inner| (format!("{archive_name}/{route}"), inner));
    Ok(opened)
}

/// Первый источник, где запись нашлась; подпись источника и открытый вложенный архив.
fn find_clouds(root: &Path, keys: &Arc<KeySet>) -> Result<Option<(String, Archive)>> {
    CLOUD_PLACES
        .iter()
        .filter(|(archive_name, _)| root.join(archive_name).is_file())
        .find_map(|(archive_name, route)| probe_source(root, keys, archive_name, route).transpose())
        .transpose()
}

pub fn extract_cloud_hats(options: &Options, _progress: &Progress) -> Result<Value> {
    let root = game_root(options)?;
    let out_dir = options.required("output").and_then(full_path)?;
    let (keys, key_source) = load_keys(&root.to_string_lossy(), options.optional("keys"))?;
    fs::create_dir_all(&out_dir)?;
    let Some((source, clouds)) = find_clouds(&root, &keys)? else {
        return Err(EngineError::file_not_found(NOT_FOUND));
    };

    let mut harvest = Collected::default();
    clouds
        .files(clouds.root())
        .iter()
        .for_each(|&id| harvest.take(&clouds, id));
    let (textures, unreadable) = harvest.lay_out(&out_dir)?;
    let missing: Vec<&str> = harvest
        .needed
        .iter()
        .map(String::as_str)
        .filter(|name| textures.keys().all(|key| !key.eq_ignore_ascii_case(name)))
        .collect();
    // Лист, который так и остался в `missing` из-за чтения, а не из-за отсутствия.
    harvest.skipped.extend(
        unreadable
            .into_iter()
            .filter(|(sheet, _)| missing.iter().any(|name| name.eq_ignore_ascii_case(sheet)))
            .map(|(_, line)| line),
    );

    let manifest_path = out_dir.join(MANIFEST);
    let manifest = object([
        field("version", MANIFEST_VERSION),
        field("source", source.as_str()),
        field("drawables", Value::Object(harvest.drawables.clone())),
        field("textures", Value::Object(textures.clone())),
        field("missing", missing.clone()),
        field("skipped", harvest.skipped.clone()),
    ]);
    fs::write(&manifest_path, ascii_json(&manifest))?;

    Ok(object([
        field("source", source),
        field("manifest", manifest_path.to_string_lossy().into_owned()),
        field("drawables", harvest.drawables.len()),
        field("textures", textures.len()),
        field("missing", missing),
        field("skipped", harvest.skipped),
        field("keySource", key_source),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_res::resource::deflate_zlib9;
    use rage_res::texture::Format;
    use rage_res::ytd_write::{payload_bytes, write, NewTexture};
    use rage_rpf::fixtures::noise;
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::{tempdir, TempDir};

    // ----- стенд: архивы -----

    enum Node {
        Dir(String, Vec<Node>),
        Bin(String, Vec<u8>),
        Rsc(String, Vec<u8>),
        Pack(String, Vec<Node>),
    }

    fn dir(name: &str, kids: Vec<Node>) -> Node {
        Node::Dir(name.to_owned(), kids)
    }

    fn bin(name: &str, bytes: Vec<u8>) -> Node {
        Node::Bin(name.to_owned(), bytes)
    }

    fn rsc(name: &str, bytes: Vec<u8>) -> Node {
        Node::Rsc(name.to_owned(), bytes)
    }

    fn pack(name: &str, kids: Vec<Node>) -> Node {
        Node::Pack(name.to_owned(), kids)
    }

    fn build(name: &str, kids: Vec<Node>) -> DirNode {
        let mut node = DirNode::new(name);
        for kid in kids {
            let (file_name, body) = match kid {
                Node::Dir(inner_name, inner) => {
                    node.dirs.push(build(&inner_name, inner));
                    continue;
                }
                Node::Bin(file_name, bytes) => (
                    file_name,
                    Body::Binary {
                        data: Data::memory(bytes),
                        compress: Compress::Store,
                    },
                ),
                Node::Rsc(file_name, bytes) => (
                    file_name,
                    Body::Resource {
                        data: Data::memory(bytes),
                    },
                ),
                Node::Pack(file_name, inner) => {
                    (file_name, Body::Nested(Box::new(build("", inner))))
                }
            };
            node.files.push(FileNode {
                name: file_name,
                body,
            });
        }
        node
    }

    fn wrap(dirs: &[&str], leaf: Node) -> Node {
        dirs.iter()
            .rev()
            .fold(leaf, |inner, name| dir(name, vec![inner]))
    }

    fn put(world: &Path, rel: &str, bytes: &[u8]) {
        let target = world.join(rel);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, bytes).unwrap();
    }

    fn rpf(world: &Path, rel: &str, kids: Vec<Node>) {
        let target = world.join(rel);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        let mut file = fs::File::create(&target).unwrap();
        let mut context = WriteContext {
            staging: target.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(&build("", kids), &mut file, &mut context, &mut |_| {}).unwrap();
    }

    struct Lab {
        root: TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let root = tempdir().unwrap();
            let keys = root.path().join("keys");
            fs::create_dir_all(&keys).unwrap();
            fs::write(keys.join("gtav_aes_key.dat"), vec![7u8; 32]).unwrap();
            fs::write(keys.join("gtav_ng_key.dat"), vec![1u8; 101 * 68 * 4]).unwrap();
            fs::write(
                keys.join("gtav_ng_decrypt_tables.dat"),
                vec![2u8; 17 * 4096 * 4],
            )
            .unwrap();
            fs::write(keys.join("gtav_hash_lut.dat"), vec![3u8; 256]).unwrap();
            Lab { root }
        }

        fn keys(&self) -> String {
            self.root.path().join("keys").to_string_lossy().into_owned()
        }

        fn world(&self, name: &str) -> PathBuf {
            let path = self.root.path().join("worlds").join(name);
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("GTA5.exe"), b"").unwrap();
            path
        }

        fn out(&self, name: &str) -> PathBuf {
            self.root.path().join("out").join(name)
        }
    }

    fn text(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn call(args: &[&str]) -> Result<Value> {
        let owned: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        extract_cloud_hats(&Options::parse(&owned)?, &Progress::silent())
    }

    fn refused(args: &[&str]) -> (String, String) {
        match call(args) {
            Err(error) => (error.code, error.message),
            Ok(done) => panic!("ожидался отказ, а вышло {done}"),
        }
    }

    fn refusal_is(got: (String, String), code: &str, message: &str) {
        assert_eq!((got.0.as_str(), got.1.as_str()), (code, message));
    }

    fn listing(dir_path: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir_path)
            .unwrap()
            .flatten()
            .map(|item| {
                let mark = if item.path().is_dir() { "/" } else { "" };
                format!("{}{mark}", item.file_name().to_string_lossy())
            })
            .collect();
        names.sort();
        names
    }

    /// Запуск с ключами лаборатории; `tag` — имя папки вывода.
    fn hats(lab: &Lab, root: &Path, tag: &str) -> Result<Value> {
        call(&[
            "--game-root",
            &text(root),
            "--output",
            &text(&lab.out(tag)),
            "--keys",
            &lab.keys(),
        ])
    }

    fn manifest(lab: &Lab, tag: &str) -> String {
        fs::read_to_string(lab.out(tag).join(MANIFEST)).unwrap()
    }

    fn manifest_json(lab: &Lab, tag: &str) -> Value {
        serde_json::from_str(&manifest(lab, tag)).unwrap()
    }

    /// Мир с `v_clouds.rpf` в `update.rpf` и/или в `x64b.rpf`.
    fn cloud_world(
        lab: &Lab,
        name: &str,
        update: Option<Vec<Node>>,
        x64b: Option<Vec<Node>>,
    ) -> PathBuf {
        let root = lab.world(name);
        if let Some(files) = update {
            let leaf = pack("v_clouds.rpf", files);
            rpf(
                &root,
                "update/update.rpf",
                vec![wrap(&["x64", "levels", "gta5", "cloudhats"], leaf)],
            );
        }
        if let Some(files) = x64b {
            let leaf = pack("v_clouds.rpf", files);
            rpf(
                &root,
                "x64b.rpf",
                vec![wrap(&["levels", "gta5", "cloudhats"], leaf)],
            );
        }
        root
    }

    const UPDATE_SOURCE: &str = "update/update.rpf/x64/levels/gta5/cloudhats/v_clouds.rpf";
    const X64B_SOURCE: &str = "x64b.rpf/levels/gta5/cloudhats/v_clouds.rpf";

    // ----- стенд: ресурсы -----

    const SYS: usize = 8192;
    const GFX: usize = 8192;

    /// Область данных ресурса: системная часть, затем графическая; все смещения абсолютные.
    struct Mem {
        data: Vec<u8>,
        sys_top: usize,
        gfx_top: usize,
    }

    impl Mem {
        fn new() -> Mem {
            Mem {
                data: vec![0; SYS + GFX],
                sys_top: 0x80,
                gfx_top: SYS + 0x10,
            }
        }

        fn sys(&mut self, len: usize) -> usize {
            let at = (self.sys_top + 15) & !15;
            self.sys_top = at + len;
            assert!(self.sys_top <= SYS, "системная часть переполнена");
            at
        }

        fn gfx(&mut self, len: usize) -> usize {
            let at = (self.gfx_top + 15) & !15;
            self.gfx_top = at + len;
            assert!(self.gfx_top <= SYS + GFX, "графическая часть переполнена");
            at
        }

        fn pointer(at: usize) -> u64 {
            if at < SYS {
                0x5000_0000 + at as u64
            } else {
                0x6000_0000 + (at - SYS) as u64
            }
        }

        fn put(&mut self, at: usize, bytes: &[u8]) {
            self.data[at..at + bytes.len()].copy_from_slice(bytes);
        }

        fn put16(&mut self, at: usize, value: u16) {
            self.put(at, &value.to_le_bytes());
        }

        fn put32(&mut self, at: usize, value: u32) {
            self.put(at, &value.to_le_bytes());
        }

        fn put64(&mut self, at: usize, value: u64) {
            self.put(at, &value.to_le_bytes());
        }

        fn link(&mut self, at: usize, target: usize) {
            self.put64(at, Mem::pointer(target));
        }

        fn cstring(&mut self, text: &str) -> usize {
            let at = self.sys(text.len() + 1);
            self.put(at, text.as_bytes());
            at
        }

        fn file(&self) -> Vec<u8> {
            let mut out = Vec::new();
            for word in [
                0x3743_5352u32,
                165,
                0xa000_0000 | 1 << 17,
                0x5000_0000 | 1 << 17,
            ] {
                out.extend_from_slice(&word.to_le_bytes());
            }
            out.extend(deflate_zlib9(&self.data));
            out
        }
    }

    #[derive(Clone)]
    struct Geom {
        count: u32,
        flags: u32,
        types: u64,
        buffer_stride: u16,
        declared: u16,
        vertices: Vec<u8>,
        indices: Vec<u16>,
        index_count: u32,
        alt_pointer: bool,
    }

    const STANDARD_FLAGS: u32 = 16473;
    const STANDARD_TYPES: u64 = 0x0700_0000_0509_6006;

    fn standard_vertices(count: usize) -> Vec<u8> {
        let uv = [
            (0.0f32, 1.0f32),
            (0.25, 0.75),
            (0.5, 0.5),
            (0.75, 0.25),
            (1.0, 0.0),
        ];
        let mut bytes = Vec::new();
        for index in 0..count {
            let at = index as f32;
            for value in [at, at + 0.5, 2.0 * at, 0.0, 0.0, 1.0] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            bytes.extend_from_slice(&[10 + index as u8, 20, 30, 255 - index as u8]);
            let (u, v) = uv[index % 5];
            for value in [u, v, 1.0, 0.0, 0.0, -1.0] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        bytes
    }

    impl Geom {
        /// Геометрия образца: шаг 52, цвет, нормаль, касательная.
        fn standard(count: usize) -> Geom {
            let indices: Vec<u16> = (0..count.max(3)).map(|i| (i % count) as u16).collect();
            Geom {
                count: count as u32,
                flags: STANDARD_FLAGS,
                types: STANDARD_TYPES,
                buffer_stride: 52,
                declared: 52,
                vertices: standard_vertices(count),
                index_count: indices.len() as u32,
                indices,
                alt_pointer: false,
            }
        }

        fn raw(
            count: usize,
            flags: u32,
            types: u64,
            strides: (u16, u16),
            vertices: Vec<u8>,
        ) -> Geom {
            let indices: Vec<u16> = (0..count.max(3))
                .map(|i| (i % count.max(1)) as u16)
                .collect();
            Geom {
                count: count as u32,
                flags,
                types,
                buffer_stride: strides.0,
                declared: strides.1,
                vertices,
                index_count: indices.len() as u32,
                indices,
                alt_pointer: false,
            }
        }
    }

    enum Param {
        Sheet(u32, Option<String>),
        Vector(u32, Vec<f32>),
    }

    fn sheet(slot: &str, name: &str) -> Param {
        Param::Sheet(joaat(slot), Some(name.to_owned()))
    }

    fn vector(slot: &str, values: &[f32]) -> Param {
        Param::Vector(joaat(slot), values.to_vec())
    }

    struct ShaderSpec {
        hash: u32,
        params: Vec<Param>,
    }

    struct Part {
        geoms: Vec<Geom>,
        header_count: Option<u16>,
        map: Option<Vec<u16>>,
    }

    fn part(geoms: Vec<Geom>) -> Part {
        Part {
            geoms,
            header_count: None,
            map: None,
        }
    }

    struct Embedded {
        name: String,
        code: u32,
        width: u16,
        height: u16,
        payload: Vec<u8>,
    }

    fn embedded(name: &str, format: Format, width: u16, height: u16, seed: u64) -> Embedded {
        let size = payload_bytes(format, usize::from(width), usize::from(height), 1);
        Embedded {
            name: name.to_owned(),
            code: format.code(),
            width,
            height,
            payload: noise(size, seed),
        }
    }

    #[derive(Default)]
    struct Spec {
        shaders: Vec<ShaderSpec>,
        parts: Vec<Part>,
        embedded: Vec<Embedded>,
        no_group: bool,
        corrupt_part: bool,
    }

    fn write_shader(mem: &mut Mem, shader: &ShaderSpec) -> usize {
        let declared = shader.params.len();
        let kinds: Vec<usize> = shader
            .params
            .iter()
            .map(|param| match param {
                Param::Sheet(..) => 0,
                Param::Vector(_, values) => values.len() / 4,
            })
            .collect();
        let units: usize = kinds.iter().sum();
        let table = mem.sys(16 * declared + 16 * units + 4 * declared + 4);
        let hashes_at = table + 16 * declared + 16 * units;
        let mut used = 0;
        for (index, param) in shader.params.iter().enumerate() {
            let record = table + index * 16;
            mem.data[record] = kinds[index] as u8;
            let hash = match param {
                Param::Sheet(hash, name) => {
                    if let Some(name) = name {
                        let object = mem.sys(0x30);
                        let label = mem.cstring(name);
                        mem.link(object + 0x28, label);
                        mem.link(record + 8, object);
                    }
                    *hash
                }
                Param::Vector(hash, values) => {
                    let data = table + 16 * declared + 16 * used;
                    for (lane, value) in values.iter().enumerate() {
                        mem.put(data + lane * 4, &value.to_le_bytes());
                    }
                    mem.link(record + 8, data);
                    used += kinds[index];
                    *hash
                }
            };
            mem.put32(hashes_at + index * 4, hash);
        }
        let object = mem.sys(0x20);
        mem.link(object, table);
        mem.data[object + 0x10] = declared as u8;
        mem.put32(object + 0x18, shader.hash);
        object
    }

    fn write_embedded(mem: &mut Mem, textures: &[Embedded]) -> usize {
        let dict = mem.sys(0x40);
        let entries = mem.sys(8 * textures.len());
        mem.link(dict + 0x30, entries);
        mem.put16(dict + 0x38, textures.len() as u16);
        mem.put16(dict + 0x3a, textures.len() as u16);
        for (index, texture) in textures.iter().enumerate() {
            let object = mem.sys(0x80);
            let label = mem.cstring(&texture.name);
            mem.link(object + 0x28, label);
            mem.put16(object + 0x50, texture.width);
            mem.put16(object + 0x52, texture.height);
            mem.put16(object + 0x54, 1);
            mem.put32(object + 0x58, texture.code);
            mem.data[object + 0x5d] = 1;
            let pixels = mem.gfx(texture.payload.len());
            mem.put(pixels, &texture.payload);
            mem.link(object + 0x70, pixels);
            mem.link(entries + index * 8, object);
        }
        dict
    }

    fn write_geometry(mem: &mut Mem, geom: &Geom) -> usize {
        let geometry = mem.sys(0x40);
        let vbuf = mem.sys(0x40);
        let decl = mem.sys(0x10);
        let ibuf = mem.sys(0x20);
        mem.link(geometry + 0x18, vbuf);
        mem.link(geometry + 0x38, ibuf);
        mem.put16(vbuf + 0x08, geom.buffer_stride);
        if !geom.vertices.is_empty() {
            let data = mem.gfx(geom.vertices.len());
            mem.put(data, &geom.vertices);
            mem.link(vbuf + if geom.alt_pointer { 0x20 } else { 0x10 }, data);
        }
        mem.put32(vbuf + 0x18, geom.count);
        mem.link(vbuf + 0x30, decl);
        mem.put32(decl, geom.flags);
        mem.put16(decl + 4, geom.declared);
        mem.put64(decl + 8, geom.types);
        mem.put32(ibuf + 0x08, geom.index_count);
        let indices = mem.gfx(geom.indices.len() * 2);
        for (slot, index) in geom.indices.iter().enumerate() {
            mem.put16(indices + slot * 2, *index);
        }
        mem.link(ibuf + 0x10, indices);
        geometry
    }

    fn model_bytes(spec: &Spec) -> Vec<u8> {
        let mut mem = Mem::new();
        let group = mem.sys(0x40);
        if !spec.no_group {
            mem.link(0x10, group);
        }
        if !spec.shaders.is_empty() {
            let array = mem.sys(8 * spec.shaders.len());
            mem.link(group + 0x10, array);
            mem.put16(group + 0x18, spec.shaders.len() as u16);
            for (index, shader) in spec.shaders.iter().enumerate() {
                let at = write_shader(&mut mem, shader);
                mem.link(array + index * 8, at);
            }
        }
        if !spec.embedded.is_empty() {
            let dict = write_embedded(&mut mem, &spec.embedded);
            mem.link(group + 0x08, dict);
        }
        if !spec.parts.is_empty() {
            let array = mem.sys(8 * spec.parts.len());
            let header = mem.sys(16);
            mem.link(header, array);
            mem.put16(header + 8, spec.parts.len() as u16);
            mem.put16(header + 10, spec.parts.len() as u16);
            mem.link(0x50, header);
            for (index, part) in spec.parts.iter().enumerate() {
                if spec.corrupt_part {
                    mem.put64(array + index * 8, Mem::pointer(SYS + GFX - 4));
                    continue;
                }
                let at = mem.sys(0x40);
                mem.link(array + index * 8, at);
                let count = part.header_count.unwrap_or(part.geoms.len() as u16);
                mem.put16(at + 0x10, count);
                let geometries = mem.sys(8 * part.geoms.len());
                mem.link(at + 0x08, geometries);
                if let Some(map) = &part.map {
                    let mapping = mem.sys(map.len() * 2);
                    for (slot, shader) in map.iter().enumerate() {
                        mem.put16(mapping + slot * 2, *shader);
                    }
                    mem.link(at + 0x20, mapping);
                }
                for (slot, geom) in part.geoms.iter().enumerate() {
                    let written = write_geometry(&mut mem, geom);
                    mem.link(geometries + slot * 8, written);
                }
            }
        }
        mem.file()
    }

    /// Модель из одной части с одной стандартной геометрией и без шейдеров.
    fn plain_model(count: usize) -> Vec<u8> {
        model_bytes(&Spec {
            parts: vec![part(vec![Geom::standard(count)])],
            ..Spec::default()
        })
    }

    fn texture(name: &str, format: Format, width: u16, height: u16, seed: u64) -> NewTexture {
        let size = payload_bytes(format, usize::from(width), usize::from(height), 1);
        NewTexture {
            name: name.to_owned(),
            width,
            height,
            format,
            levels: 1,
            payload: noise(size, seed),
        }
    }

    fn sheets_file(parts: &[NewTexture]) -> Vec<u8> {
        write(parts).unwrap()
    }

    fn decode_floats(encoded: &str) -> Vec<f32> {
        decode_base64(encoded)
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect()
    }

    /// Независимый разбор Base64 для проверки кодировщика.
    fn decode_base64(encoded: &str) -> Vec<u8> {
        const DIGITS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = Vec::new();
        let mut bits = 0u32;
        let mut held = 0;
        for ch in encoded.chars().take_while(|&ch| ch != '=') {
            bits = bits << 6 | DIGITS.find(ch).expect("знак Base64") as u32;
            held += 6;
            if held >= 8 {
                held -= 8;
                out.push((bits >> held) as u8);
                bits &= (1 << held) - 1;
            }
        }
        out
    }

    fn same_floats(got: &[f32], expected: &[f32]) -> bool {
        got.len() == expected.len()
            && got
                .iter()
                .zip(expected)
                .all(|(a, b)| a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan()))
    }

    // ----- Base64 и числа -----

    #[test]
    fn base64_follows_the_standard_alphabet() {
        let table: Vec<(Vec<u8>, &str)> = vec![
            (vec![], ""),
            (b"f".to_vec(), "Zg=="),
            (b"fo".to_vec(), "Zm8="),
            (b"foo".to_vec(), "Zm9v"),
            (b"foob".to_vec(), "Zm9vYg=="),
            (b"fooba".to_vec(), "Zm9vYmE="),
            (b"foobar".to_vec(), "Zm9vYmFy"),
            (vec![0x00], "AA=="),
            (vec![0xff], "/w=="),
            (vec![0xfb, 0xef, 0xbe], "++++"),
            (vec![0xff, 0xff, 0xff], "////"),
            (vec![0xfb, 0xff], "+/8="),
            (vec![0x00, 0x10, 0x83, 0x10, 0x51, 0x87], "ABCDEFGH"),
            (b"Man".to_vec(), "TWFu"),
            (b"Ma".to_vec(), "TWE="),
            (b"M".to_vec(), "TQ=="),
            (
                (0u8..48).collect(),
                "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v",
            ),
        ];
        for (input, expected) in table {
            assert_eq!(base64(&input), expected, "{input:?}");
        }
        let thousand: Vec<u8> = (0..1000usize).map(|i| ((i * 7 + 3) % 256) as u8).collect();
        let long = base64(&thousand);
        assert_eq!(long.len(), 1336);
        assert!(long.starts_with("AwoRGB8mLTQ7QklQV15lbHN6"));
        assert!(long.ends_with("P0ZNVA=="));
        assert_eq!(decode_base64(&long), thousand);
    }

    #[test]
    fn parameter_numbers_print_like_serde_json_over_f64() {
        let table: &[(f32, &str)] = &[
            (0.1, "0.1"),
            (1.0, "1.0"),
            (-0.0, "-0.0"),
            (0.0, "0.0"),
            (1e20, "1e+20"),
            (1e-7, "1e-7"),
            (123_456.79, "123456.79"),
            (16777216.0, "16777216.0"),
            (f32::MAX, "3.4028235e+38"),
            (f32::MIN_POSITIVE, "1.1754944e-38"),
            (1e-45, "1e-45"),
            (f32::NAN, "null"),
            (f32::INFINITY, "null"),
            (f32::NEG_INFINITY, "null"),
            (0.3, "0.3"),
            (2.5, "2.5"),
            (-1.5, "-1.5"),
            (100.0, "100.0"),
            (1234567.0, "1234567.0"),
            (0.000123, "0.000123"),
            (33554432.0, "33554432.0"),
            (1.0e7, "10000000.0"),
            (0.99999994, "0.99999994"),
            (8.5e-5, "0.000085"),
            (1e-1, "0.1"),
            (1e2, "100.0"),
            (1e-3, "0.001"),
            (1e-4, "0.0001"),
            (1.5e-4, "0.00015"),
            (1e-5, "0.00001"),
            (9.9e-6, "9.9e-6"),
            (1e-6, "1e-6"),
            (1.2345679e5, "123456.79"),
            (1e15, "1000000000000000.0"),
            (9.99e15, "9990000000000000.0"),
            (1e16, "1e+16"),
            (1e17, "1e+17"),
            (1.5e17, "1.5e+17"),
            (3e38, "3e+38"),
            (3.3333334e-1, "0.33333334"),
            (5e-39, "5e-39"),
        ];
        for (input, expected) in table {
            assert_eq!(json_number(*input).to_string(), *expected, "{input:e}");
        }
    }

    #[test]
    fn parameter_names_come_from_joaat_of_the_table() {
        let hashes: [(&str, u32); 36] = [
            ("DensitySampler", 3828368598),
            ("normalSampler", 2327911600),
            ("DetailDensitySampler", 2270155403),
            ("DetailNormalSampler", 2903840997),
            ("DetailDensity2Sampler", 2587222892),
            ("DetailNormal2Sampler", 2004179855),
            ("cloudLayerAnimScale1", 2699058131),
            ("cloudLayerAnimScale2", 2904978527),
            ("cloudLayerAnimScale3", 1697604722),
            ("gAmbientColor", 2502793579),
            ("gAnimBlendWeights", 3438696362),
            ("gAnimCombine", 4162938569),
            ("gAnimSculpt", 732819097),
            ("gBounceColor", 3285219193),
            ("gCameraPos", 130109679),
            ("gCloudColor", 3349623462),
            ("gCloudViewProj", 1388118204),
            ("gDensityShiftScale", 3043875162),
            ("gEastMinusWestColor", 2332609458),
            ("gNearFarQMult", 2513511302),
            (
                "gPiercingLightPower_Strength_NormalStrength_Thickness",
                2302032860,
            ),
            ("gRescaleUV1", 724216589),
            ("gRescaleUV2", 2046871736),
            ("gRescaleUV3", 2259804698),
            ("gScaleDiffuseFillAmbient", 397913198),
            ("gScatterG_GSquared_PhaseMult_Scale", 987241318),
            ("gSkyColor", 3328933361),
            ("gSoftParticleRange", 3901093204),
            ("gSunColor", 3007207522),
            ("gSunDirection", 2009439163),
            ("gUVOffset", 3300015766),
            ("gUVOffset1", 2565276602),
            ("gUVOffset2", 2325899053),
            ("gUVOffset3", 3510465638),
            ("gWestColor", 3223173913),
            ("gWrapLighting_MSAARef", 833328952),
        ];
        assert_eq!(hashes.map(|(name, _)| name), PARAMETER_NAMES);
        for (name, hash) in hashes {
            assert_eq!(parameter_name(hash), name);
        }
        assert_eq!(parameter_name(joaat("densitysampler")), "DensitySampler");
        assert_eq!(parameter_name(3405705229), "3405705229");
        assert_eq!(
            sheet_file("\u{43e}\u{431}\u{43b}\u{430}\u{43a}\u{43e} 1.5"),
            "\u{43e}\u{431}\u{43b}\u{430}\u{43a}\u{43e}_1_5.png"
        );
        assert_eq!(sheet_file(" cloud:x*y "), "_cloud_x_y_.png");
        assert_eq!(sheet_file("a-b_c"), "a-b_c.png");
        assert_eq!(type_name(9), "Colour");
        assert_eq!(type_name(11), "11");
    }

    // ----- мир cloud-basic и описи из примеров -----

    fn basic_alto() -> Vec<u8> {
        let shader = ShaderSpec {
            hash: 305419896,
            params: vec![
                sheet("DensitySampler", "cloud_dens_a"),
                sheet("normalSampler", "cloud_norm_a"),
                sheet("DetailDensitySampler", "cloud_detail_a"),
                vector("gAmbientColor", &[0.1, 0.2, 0.3, 1.0]),
                vector("gSunDirection", &[0.0, -1.0, 0.5, 0.0]),
                vector(
                    "gPiercingLightPower_Strength_NormalStrength_Thickness",
                    &[2.0, 0.25, 1.5, 10.0],
                ),
            ],
        };
        model_bytes(&Spec {
            shaders: vec![shader],
            parts: vec![part(vec![Geom::standard(4)])],
            ..Spec::default()
        })
    }

    fn basic_cirrus() -> Vec<u8> {
        let main = ShaderSpec {
            hash: 305419896,
            params: vec![
                sheet("DensitySampler", "cloud_dens_b"),
                sheet("normalSampler", "cloud_norm_a"),
                sheet("DetailDensitySampler", "cloud_detail_a"),
                vector("gAmbientColor", &[0.1, 0.2, 0.3, 1.0]),
                vector("gSunDirection", &[0.0, -1.0, 0.5, 0.0]),
                vector(
                    "gPiercingLightPower_Strength_NormalStrength_Thickness",
                    &[2.0, 0.25, 1.5, 10.0],
                ),
            ],
        };
        let lonely = ShaderSpec {
            hash: 99,
            params: vec![sheet("DetailNormalSampler", "cloud_nrm_missing")],
        };
        model_bytes(&Spec {
            shaders: vec![main, lonely],
            parts: vec![Part {
                geoms: vec![Geom::standard(3), Geom::standard(5)],
                header_count: None,
                map: Some(vec![1, 0]),
            }],
            embedded: vec![embedded("cloud_dens_b", Format::Dxt5, 8, 8, 5)],
            ..Spec::default()
        })
    }

    fn basic_sheets() -> Vec<u8> {
        sheets_file(&[
            texture("cloud_dens_a", Format::Dxt5, 16, 16, 1),
            texture("cloud_norm_a", Format::Ati2, 16, 16, 2),
            texture("cloud_detail_a", Format::Dxt1, 8, 8, 3),
            texture("unused_sheet", Format::Dxt1, 4, 4, 4),
        ])
    }

    fn basic_files() -> Vec<Node> {
        vec![
            rsc("cloudhat_alto.ydr", basic_alto()),
            rsc("cloudhat_cirrus.ydr", basic_cirrus()),
            rsc("cloud_sheets.ytd", basic_sheets()),
            bin("readme.txt", b"clouds".to_vec()),
        ]
    }

    /// Опись примера Об1 целиком, как её записал прежний движок.
    const BASIC_MANIFEST: &str = r#"{"version":2,"source":"update/update.rpf/x64/levels/gta5/cloudhats/v_clouds.rpf","drawables":{"cloudhat_alto":{"geometries":[{"vertexCount":4,"layout":{"flags":16473,"types":"0700000005096006","stride":52,"declared":52,"bytes":208},"position":"AAAAAAAAAD8AAAAAAACAPwAAwD8AAABAAAAAQAAAIEAAAIBAAABAQAAAYEAAAMBA","normal":"AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/","tangent":"AACAPwAAAAAAAAAAAACAvwAAgD8AAAAAAAAAAAAAgL8AAIA/AAAAAAAAAAAAAIC/AACAPwAAAAAAAAAAAACAvw==","uv":"AAAAAAAAgD8AAIA+AABAPwAAAD8AAAA/AABAPwAAgD4=","colour":"ChQe/wsUHv4MFB79DRQe/A==","colourType":"Colour","index":"AAABAAIAAwA=","shader":"305419896","textures":{"DensitySampler":"cloud_dens_a","normalSampler":"cloud_norm_a","DetailDensitySampler":"cloud_detail_a"},"parameters":{"gAmbientColor":[0.1,0.2,0.3,1.0],"gSunDirection":[0.0,-1.0,0.5,0.0],"gPiercingLightPower_Strength_NormalStrength_Thickness":[2.0,0.25,1.5,10.0]}}]},"cloudhat_cirrus":{"geometries":[{"vertexCount":3,"layout":{"flags":16473,"types":"0700000005096006","stride":52,"declared":52,"bytes":156},"position":"AAAAAAAAAD8AAAAAAACAPwAAwD8AAABAAAAAQAAAIEAAAIBA","normal":"AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/","tangent":"AACAPwAAAAAAAAAAAACAvwAAgD8AAAAAAAAAAAAAgL8AAIA/AAAAAAAAAAAAAIC/","uv":"AAAAAAAAgD8AAIA+AABAPwAAAD8AAAA/","colour":"ChQe/wsUHv4MFB79","colourType":"Colour","index":"AAABAAIA","shader":"99","textures":{"DetailNormalSampler":"cloud_nrm_missing"},"parameters":{}},{"vertexCount":5,"layout":{"flags":16473,"types":"0700000005096006","stride":52,"declared":52,"bytes":260},"position":"AAAAAAAAAD8AAAAAAACAPwAAwD8AAABAAAAAQAAAIEAAAIBAAABAQAAAYEAAAMBAAACAQAAAkEAAAABB","normal":"AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/","tangent":"AACAPwAAAAAAAAAAAACAvwAAgD8AAAAAAAAAAAAAgL8AAIA/AAAAAAAAAAAAAIC/AACAPwAAAAAAAAAAAACAvwAAgD8AAAAAAAAAAAAAgL8=","uv":"AAAAAAAAgD8AAIA+AABAPwAAAD8AAAA/AABAPwAAgD4AAIA/AAAAAA==","colour":"ChQe/wsUHv4MFB79DRQe/A4UHvs=","colourType":"Colour","index":"AAABAAIAAwAEAA==","shader":"305419896","textures":{"DensitySampler":"cloud_dens_b","normalSampler":"cloud_norm_a","DetailDensitySampler":"cloud_detail_a"},"parameters":{"gAmbientColor":[0.1,0.2,0.3,1.0],"gSunDirection":[0.0,-1.0,0.5,0.0],"gPiercingLightPower_Strength_NormalStrength_Thickness":[2.0,0.25,1.5,10.0]}}]}},"textures":{"cloud_norm_a":{"file":"cloud_norm_a.png","width":16,"height":16},"cloud_detail_a":{"file":"cloud_detail_a.png","width":8,"height":8},"cloud_dens_a":{"file":"cloud_dens_a.png","width":16,"height":16},"cloud_dens_b":{"file":"cloud_dens_b.png","width":8,"height":8}},"missing":["cloud_nrm_missing"],"skipped":[]}"#;

    /// Опись примера Об3: единственная шапка без шейдера.
    const UPDATE_ONLY_MANIFEST: &str = r#"{"version":2,"source":"update/update.rpf/x64/levels/gta5/cloudhats/v_clouds.rpf","drawables":{"cloudhat_update":{"geometries":[{"vertexCount":2,"layout":{"flags":16473,"types":"0700000005096006","stride":52,"declared":52,"bytes":104},"position":"AAAAAAAAAD8AAAAAAACAPwAAwD8AAABA","normal":"AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/","tangent":"AACAPwAAAAAAAAAAAACAvwAAgD8AAAAAAAAAAAAAgL8=","uv":"AAAAAAAAgD8AAIA+AABAPw==","colour":"ChQe/wsUHv4=","colourType":"Colour","index":"AAABAAAA","shader":null,"textures":{},"parameters":{}}]}},"textures":{},"missing":[],"skipped":[]}"#;

    fn basic_answer(
        lab: &Lab,
        tag: &str,
        source: &str,
        drawables: u64,
        textures: u64,
        missing: Value,
    ) -> Value {
        json!({
            "source": source,
            "manifest": text(&lab.out(tag).join("hats.json")),
            "drawables": drawables,
            "textures": textures,
            "missing": missing,
            "skipped": [],
            "keySource": "configured-key-directory",
        })
    }

    #[test]
    fn basic_world_reproduces_the_old_manifest_byte_for_byte() {
        let lab = Lab::new();
        let root = cloud_world(&lab, "cloud-basic", Some(basic_files()), None);
        let answer = hats(&lab, &root, "C1").unwrap();
        assert_eq!(
            answer,
            basic_answer(
                &lab,
                "C1",
                UPDATE_SOURCE,
                2,
                4,
                json!(["cloud_nrm_missing"])
            )
        );
        let written = manifest(&lab, "C1");
        assert_eq!(written, BASIC_MANIFEST);
        assert_eq!(written.len(), 2644);
        assert_eq!(
            listing(&lab.out("C1")),
            [
                "cloud_dens_a.png",
                "cloud_dens_b.png",
                "cloud_detail_a.png",
                "cloud_norm_a.png",
                "hats.json"
            ]
        );
        // Листы — PNG полного размера тех же словарей.
        let first = fs::read(lab.out("C1").join("cloud_dens_a.png")).unwrap();
        assert_eq!(&first[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&first[16..24], [0, 0, 0, 16, 0, 0, 0, 16]);
        let embedded_png = fs::read(lab.out("C1").join("cloud_dens_b.png")).unwrap();
        assert_eq!(&embedded_png[16..24], [0, 0, 0, 8, 0, 0, 0, 8]);
    }

    #[test]
    fn source_choice_follows_the_two_places_in_order() {
        let lab = Lab::new();
        // Об2 и Об6: только x64b.rpf, или в update.rpf нет файла.
        let root = cloud_world(&lab, "cloud-x64b", None, Some(basic_files()));
        let answer = hats(&lab, &root, "C2").unwrap();
        assert_eq!(
            answer,
            basic_answer(&lab, "C2", X64B_SOURCE, 2, 4, json!(["cloud_nrm_missing"]))
        );
        assert_eq!(manifest(&lab, "C2").len(), 2631);
        let root = lab.world("cloud-update-without");
        rpf(
            &root,
            "update/update.rpf",
            vec![bin("other.txt", b"1".to_vec())],
        );
        rpf(
            &root,
            "x64b.rpf",
            vec![wrap(
                &["levels", "gta5", "cloudhats"],
                pack("v_clouds.rpf", basic_files()),
            )],
        );
        assert_eq!(hats(&lab, &root, "C6").unwrap()["source"], X64B_SOURCE);
        // Об3: в обоих — выигрывает update.rpf, и второй архив не читается.
        let update_hat = vec![rsc("cloudhat_update.ydr", plain_model(2))];
        let root = cloud_world(&lab, "cloud-both", Some(update_hat), Some(basic_files()));
        let answer = hats(&lab, &root, "C3").unwrap();
        assert_eq!(
            answer,
            basic_answer(&lab, "C3", UPDATE_SOURCE, 1, 0, json!([]))
        );
        assert_eq!(manifest(&lab, "C3"), UPDATE_ONLY_MANIFEST);
        assert_eq!(listing(&lab.out("C3")), ["hats.json"]);
        // Об10: каталоги и файл в другом регистре; в ответе написание констант.
        let root = lab.world("cloud-case");
        rpf(
            &root,
            "update/update.rpf",
            vec![wrap(
                &["X64", "Levels", "GTA5", "CloudHats"],
                pack("V_CLOUDS.RPF", basic_files()),
            )],
        );
        assert_eq!(hats(&lab, &root, "C10").unwrap()["source"], UPDATE_SOURCE);
        assert_eq!(manifest(&lab, "C10"), BASIC_MANIFEST);
    }

    #[test]
    fn missing_sources_and_opening_refusals() {
        let lab = Lab::new();
        let not_found = |tag: &str, root: &Path| {
            let failure = hats(&lab, root, tag).unwrap_err();
            refusal_is(
                (failure.code, failure.message),
                "FileNotFoundException",
                NOT_FOUND,
            );
            assert!(
                lab.out(tag).is_dir() && listing(&lab.out(tag)).is_empty(),
                "{tag}"
            );
        };
        // Об4 и Об5.
        let root = lab.world("cloud-none");
        rpf(
            &root,
            "update/update.rpf",
            vec![bin("a.txt", b"1".to_vec())],
        );
        rpf(
            &root,
            "x64b.rpf",
            vec![wrap(&["levels"], bin("v_clouds.rpf", b"x".to_vec()))],
        );
        not_found("C4", &root);
        not_found("C5", &lab.world("cloud-no-archives"));
        // Об7: update.rpf не архив — отказ без перехода к x64b.rpf.
        let root = lab.world("cloud-update-broken");
        put(&root, "update/update.rpf", b"this is not an archive");
        rpf(
            &root,
            "x64b.rpf",
            vec![wrap(
                &["levels", "gta5", "cloudhats"],
                pack("v_clouds.rpf", basic_files()),
            )],
        );
        let failure = hats(&lab, &root, "C7").unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "InvalidDataException",
            "update.rpf: The identifier 73696874 did not match the expected value of 0x52504637",
        );
        assert!(listing(&lab.out("C7")).is_empty());
        // Об8: сам v_clouds.rpf — двоичная запись из мусора.
        let root = lab.world("cloud-nested-garbage");
        rpf(
            &root,
            "update/update.rpf",
            vec![wrap(
                &["x64", "levels", "gta5", "cloudhats"],
                bin("v_clouds.rpf", b"garbage of a file".to_vec()),
            )],
        );
        let failure = hats(&lab, &root, "C8").unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "InvalidDataException",
            "v_clouds.rpf: The identifier 62726167 did not match the expected value of 0x52504637",
        );
        // Об9: запись v_clouds.rpf — ресурс; поиск идёт к x64b.rpf.
        let root = lab.world("cloud-resource-kind");
        rpf(
            &root,
            "update/update.rpf",
            vec![wrap(
                &["x64", "levels", "gta5", "cloudhats"],
                rsc("v_clouds.rpf", plain_model(2)),
            )],
        );
        rpf(
            &root,
            "x64b.rpf",
            vec![wrap(
                &["levels", "gta5", "cloudhats"],
                pack("v_clouds.rpf", basic_files()),
            )],
        );
        assert_eq!(hats(&lab, &root, "C9").unwrap()["source"], X64B_SOURCE);
    }

    #[test]
    fn argument_refusals_and_the_state_they_leave() {
        let lab = Lab::new();
        let root = cloud_world(&lab, "cloud-basic", Some(basic_files()), None);
        let (game, keys, out) = (text(&root), lab.keys(), text(&lab.out("A")));
        let bad_keys = text(&lab.root.path().join("worlds"));
        let noexe = lab.root.path().join("worlds").join("cloud-noexe");
        fs::create_dir_all(&noexe).unwrap();
        let noexe = text(&noexe);
        let cases: Vec<(&str, Vec<&str>, &str, &str)> = vec![
            (
                "Об19",
                vec!["--output", &out, "--keys", &keys],
                "ArgumentException",
                "--game-root is required.",
            ),
            (
                "Об20",
                vec!["--game-root", &game, "--keys", &keys],
                "ArgumentException",
                "--output is required.",
            ),
            (
                "Об21",
                vec!["--game-root", &game, "--output", "", "--keys", &keys],
                "ArgumentException",
                "The path is empty.",
            ),
            (
                "Об22",
                vec!["--game-root", &noexe, "--output", &out, "--keys", &keys],
                "DirectoryNotFoundException",
                "The selected directory is not a GTA V installation.",
            ),
        ];
        for (label, args, code, message) in cases {
            refusal_is(refused(&args), code, message);
            assert!(!lab.out("A").exists(), "{label}");
        }
        // Об23 по смыслу: ключи не читаются — папка вывода не создана.
        let failure = refused(&["--game-root", &game, "--output", &out, "--keys", &bad_keys]);
        assert_eq!(failure.0, "InvalidOperationException");
        assert!(!lab.out("A").exists());
    }

    #[test]
    fn rerun_keeps_old_files_and_replaces_the_manifest() {
        let lab = Lab::new();
        let basic = cloud_world(&lab, "cloud-basic", Some(basic_files()), None);
        let update_hat = vec![rsc("cloudhat_update.ydr", plain_model(2))];
        let both = cloud_world(&lab, "cloud-both", Some(update_hat), Some(basic_files()));
        hats(&lab, &basic, "C26").unwrap();
        fs::write(lab.out("C26").join("stale.png"), b"stale").unwrap();
        hats(&lab, &both, "C26").unwrap();
        assert_eq!(manifest(&lab, "C26"), UPDATE_ONLY_MANIFEST);
        assert_eq!(
            listing(&lab.out("C26")),
            [
                "cloud_dens_a.png",
                "cloud_dens_b.png",
                "cloud_detail_a.png",
                "cloud_norm_a.png",
                "hats.json",
                "stale.png"
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn write_failures_follow_the_windows_codes() {
        let lab = Lab::new();
        let root = cloud_world(&lab, "cloud-basic", Some(basic_files()), None);
        let denied = "Отказано в доступе. (os error 5)";
        // Об24: --output — существующий файл.
        let blocked = lab.out("C24");
        fs::create_dir_all(blocked.parent().unwrap()).unwrap();
        fs::write(&blocked, b"1234").unwrap();
        let failure = hats(&lab, &root, "C24").unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "IOException",
            "Невозможно создать файл, так как он уже существует. (os error 183)",
        );
        assert_eq!(fs::read(&blocked).unwrap(), b"1234");
        // Об27: на месте cloud_dens_a.png каталог; ранее записанные листы остались, описи нет.
        fs::create_dir_all(lab.out("C27").join("cloud_dens_a.png")).unwrap();
        let failure = hats(&lab, &root, "C27").unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "UnauthorizedAccessException",
            denied,
        );
        assert_eq!(
            listing(&lab.out("C27")),
            [
                "cloud_dens_a.png/",
                "cloud_detail_a.png",
                "cloud_norm_a.png"
            ]
        );
        // Об28: на месте hats.json каталог; листы уже записаны.
        fs::create_dir_all(lab.out("C28").join("hats.json")).unwrap();
        let failure = hats(&lab, &root, "C28").unwrap_err();
        refusal_is(
            (failure.code, failure.message),
            "UnauthorizedAccessException",
            denied,
        );
        assert_eq!(
            listing(&lab.out("C28")),
            [
                "cloud_dens_a.png",
                "cloud_dens_b.png",
                "cloud_detail_a.png",
                "cloud_norm_a.png",
                "hats.json/"
            ]
        );
    }

    // ----- пропуски -----

    #[test]
    fn unusable_files_are_listed_in_skipped_in_file_order() {
        let lab = Lab::new();
        let enhanced = {
            let mut patched = sheets_file(&[texture("moon", Format::Dxt1, 4, 4, 1)]);
            let graphics =
                u32::from_le_bytes(patched[12..16].try_into().unwrap()) & 0x0fff_ffff | 5 << 28;
            patched[12..16].copy_from_slice(&graphics.to_le_bytes());
            patched
        };
        let files = vec![
            bin("garbage.ydr", noise(300, 1)),
            bin("short.ydr", b"RSC7".to_vec()),
            bin("empty.ydr", Vec::new()),
            bin(
                "\u{43e}\u{448}\u{438}\u{431}\u{43a}\u{430}.ydr",
                noise(300, 2),
            ),
            bin("huge.ytd", vec![0u8; FILE_CEILING + 1]),
            rsc("enhanced.ytd", enhanced),
            rsc("model_as_dictionary.ytd", plain_model(2)),
            rsc("nogeometry.ydr", model_bytes(&Spec::default())),
            rsc(
                "corrupt.ydr",
                model_bytes(&Spec {
                    parts: vec![part(vec![Geom::standard(3)])],
                    corrupt_part: true,
                    ..Spec::default()
                }),
            ),
            rsc("UPPER.YDR", plain_model(3)),
            rsc("two.dots.ydr", plain_model(2)),
            bin("notes.txt", b"n".to_vec()),
            bin("noext", b"n".to_vec()),
            bin(".ydr", plain_model(2)),
            rsc("cloud_sheets.ytd", basic_sheets()),
            dir("sub", vec![rsc("inside.ydr", plain_model(2))]),
        ];
        let root = cloud_world(&lab, "cloud-skips", Some(files), None);
        let answer = hats(&lab, &root, "C11").unwrap();
        assert_eq!(answer["drawables"], 2);
        assert_eq!(answer["textures"], 0);
        assert_eq!(answer["missing"], json!([]));
        assert_eq!(
            answer["skipped"],
            json!([
                "corrupt.ydr: Чтение за концом данных ресурса.",
                "empty.ydr: size 0",
                "enhanced.ytd: Словарь текстур из GTA V Enhanced: Astral читает Legacy.",
                "garbage.ydr: Файл не является ресурсом RSC7.",
                format!("huge.ytd: size {}", FILE_CEILING + 1),
                "model_as_dictionary.ytd: Это не словарь текстур Legacy (версия 165).",
                "short.ydr: Ресурс короче заголовка RSC7.",
                "ошибка.ydr: Файл не является ресурсом RSC7.",
            ])
        );
        let written = manifest_json(&lab, "C11");
        let keys: Vec<&String> = written["drawables"].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["UPPER", "two.dots"]);
        assert_eq!(listing(&lab.out("C11")), ["hats.json"]);
        // Предел размера включителен: ровно 64 МиБ читается и отказывает уже как ресурс.
        let root = cloud_world(
            &lab,
            "cloud-limit",
            Some(vec![bin("exact.ytd", vec![0u8; FILE_CEILING])]),
            None,
        );
        let answer = hats(&lab, &root, "C11b").unwrap();
        assert_eq!(
            answer["skipped"],
            json!(["exact.ytd: Файл не является ресурсом RSC7."])
        );
    }

    #[test]
    fn two_files_with_one_stem_keep_the_later_one_in_the_first_place() {
        let lab = Lab::new();
        let files = vec![
            rsc("dup.YDR", plain_model(3)),
            rsc("dup.ydr", plain_model(2)),
            rsc("other.ydr", plain_model(4)),
        ];
        let root = cloud_world(&lab, "cloud-samestem", Some(files), None);
        let answer = hats(&lab, &root, "C18").unwrap();
        assert_eq!(answer["drawables"], 2);
        let written = manifest_json(&lab, "C18");
        let order: Vec<&String> = written["drawables"].as_object().unwrap().keys().collect();
        assert_eq!(order, ["dup", "other"]);
        assert_eq!(
            written["drawables"]["dup"]["geometries"][0]["vertexCount"],
            2
        );
    }

    // ----- вершины, шаг, отброшенные геометрии -----

    /// Геометрии единственной модели из описи, как объекты JSON.
    fn geometries_of(lab: &Lab, tag: &str, stem: &str) -> Vec<Value> {
        manifest_json(lab, tag)["drawables"][stem]["geometries"]
            .as_array()
            .unwrap_or_else(|| panic!("в описи нет {stem}"))
            .clone()
    }

    /// Один запуск с одной моделью; возвращает её геометрии.
    fn run_single_model(model: Vec<u8>) -> Vec<Value> {
        let lab = Lab::new();
        let root = cloud_world(&lab, "w", Some(vec![rsc("only.ydr", model)]), None);
        hats(&lab, &root, "O").unwrap();
        geometries_of(&lab, "O", "only")
    }

    fn floats(geometry: &Value, key: &str) -> Vec<f32> {
        decode_floats(geometry[key].as_str().unwrap())
    }

    fn bytes_of(geometry: &Value, key: &str) -> Vec<u8> {
        decode_base64(geometry[key].as_str().unwrap())
    }

    fn halves(values: &[u16]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    }

    fn floats_bytes(values: &[f32]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    }

    #[test]
    fn standard_vertices_decode_to_the_documented_arrays() {
        let geometry = &run_single_model(plain_model(3))[0];
        assert_eq!(geometry["vertexCount"], 3);
        assert_eq!(
            geometry["layout"],
            json!({"flags": 16473, "types": "0700000005096006", "stride": 52, "declared": 52, "bytes": 156})
        );
        assert!(same_floats(
            &floats(geometry, "position"),
            &[0.0, 0.5, 0.0, 1.0, 1.5, 2.0, 2.0, 2.5, 4.0]
        ));
        assert!(same_floats(
            &floats(geometry, "normal"),
            &[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]
        ));
        assert!(same_floats(
            &floats(geometry, "tangent"),
            &[1.0, 0.0, 0.0, -1.0, 1.0, 0.0, 0.0, -1.0, 1.0, 0.0, 0.0, -1.0]
        ));
        assert!(same_floats(
            &floats(geometry, "uv"),
            &[0.0, 1.0, 0.25, 0.75, 0.5, 0.5]
        ));
        assert_eq!(
            bytes_of(geometry, "colour"),
            [10, 20, 30, 255, 11, 20, 30, 254, 12, 20, 30, 253]
        );
        assert_eq!(geometry["colourType"], "Colour");
        assert_eq!(bytes_of(geometry, "index"), [0, 0, 1, 0, 2, 0]);
        assert_eq!(geometry["shader"], Value::Null);
        assert_eq!(geometry["textures"], json!({}));
        assert_eq!(geometry["parameters"], json!({}));
    }

    #[test]
    fn half_and_signed_byte_vertices() {
        // положение Half4, нормаль RGBA8SNorm, цвет UByte4, развёртка Half2; шаг 20.
        let mut vertices = Vec::new();
        vertices.extend(halves(&[0x3c00, 0x4000, 0xb800, 0x3c00]));
        vertices.extend([127u8, 0, 129, 0]);
        vertices.extend([255u8, 128, 0, 64]);
        vertices.extend(halves(&[0x3800, 0xc000]));
        vertices.extend(halves(&[0x0001, 0x7c00, 0x7e00, 0x3c00]));
        vertices.extend([1u8, 2, 3, 0]);
        vertices.extend([0u8, 1, 2, 3]);
        vertices.extend(halves(&[0x3c00, 0xbc00]));
        let geometry = &run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![Geom::raw(
                2,
                89,
                0x0000_0000_0108_a003,
                (20, 20),
                vertices,
            )])],
            ..Spec::default()
        }))[0];
        assert_eq!(
            geometry["layout"],
            json!({"flags": 89, "types": "000000000108A003", "stride": 20, "declared": 20, "bytes": 40})
        );
        let position = floats(geometry, "position");
        assert!(same_floats(
            &position,
            &[1.0, 2.0, -0.5, 5.9604645e-8, f32::INFINITY, f32::NAN]
        ));
        let normal = floats(geometry, "normal");
        assert!(same_floats(
            &normal,
            &[1.0, 0.0, -1.0, 1.0 / 127.0, 2.0 / 127.0, 3.0 / 127.0]
        ));
        assert_eq!(bytes_of(geometry, "colour"), [255, 128, 0, 64, 0, 1, 2, 3]);
        assert_eq!(geometry["colourType"], "UByte4");
        assert!(same_floats(
            &floats(geometry, "uv"),
            &[0.5, -2.0, 1.0, -1.0]
        ));
        assert!(same_floats(&floats(geometry, "tangent"), &[0.0; 8]));
        // Знаковый байт -128 не ограничивается снизу.
        let vertices = vec![0u8, 0, 128, 0];
        let low = &run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![Geom::raw(1, 8, 0xa000, (4, 4), vertices)])],
            ..Spec::default()
        }))[0];
        assert!(same_floats(
            &floats(low, "normal"),
            &[0.0, 0.0, -128.0 / 127.0]
        ));
    }

    #[test]
    fn missing_and_unsupported_elements_use_the_documented_defaults() {
        // Только положение Float4: нормаль по умолчанию (0, 0, 1), цвета нет.
        let vertices = floats_bytes(&[1.0, 2.0, 3.0, 9.0, -1.0, -2.0, -3.0, 9.0]);
        let only_position = &run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![Geom::raw(2, 1, 7, (0, 0), vertices)])],
            ..Spec::default()
        }))[0];
        assert_eq!(
            only_position["layout"],
            json!({"flags": 1, "types": "0000000000000007", "stride": 16, "declared": 0, "bytes": 32})
        );
        assert!(same_floats(
            &floats(only_position, "position"),
            &[1.0, 2.0, 3.0, -1.0, -2.0, -3.0]
        ));
        assert!(same_floats(
            &floats(only_position, "normal"),
            &[0.0, 0.0, 1.0, 0.0, 0.0, 1.0]
        ));
        assert!(same_floats(&floats(only_position, "tangent"), &[0.0; 8]));
        assert!(same_floats(&floats(only_position, "uv"), &[0.0; 4]));
        assert_eq!(bytes_of(only_position, "colour"), [255; 8]);
        assert_eq!(only_position["colourType"], "none");
        // Ширины не по типу: положение Float, развёртка Float3, касательная Float2.
        let vertices = [
            floats_bytes(&[2.5, 0.25, 0.75, 9.0]),
            floats_bytes(&[3.0, 4.0]),
        ]
        .concat();
        let odd = &run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![Geom::raw(
                1,
                16449,
                0x0500_0000_0600_0002,
                (0, 0),
                vertices,
            )])],
            ..Spec::default()
        }))[0];
        assert_eq!(
            odd["layout"],
            json!({"flags": 16449, "types": "0500000006000002", "stride": 24, "declared": 0, "bytes": 24})
        );
        assert!(same_floats(&floats(odd, "position"), &[2.5, 0.0, 0.0]));
        assert!(same_floats(&floats(odd, "tangent"), &[3.0, 4.0, 0.0, 1.0]));
        assert!(same_floats(&floats(odd, "uv"), &[0.25, 0.75]));
        // Типы, которых модуль не читает: нули, нормаль — тоже нули, а не (0, 0, 1).
        let unsupported = &run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![Geom::raw(
                1,
                25,
                0x9_0004,
                (0, 0),
                vec![1, 2, 3, 4],
            )])],
            ..Spec::default()
        }))[0];
        assert_eq!(
            unsupported["layout"],
            json!({"flags": 25, "types": "0000000000090004", "stride": 4, "declared": 0, "bytes": 4})
        );
        assert!(same_floats(&floats(unsupported, "position"), &[0.0; 3]));
        assert!(same_floats(&floats(unsupported, "normal"), &[0.0; 3]));
        assert_eq!(bytes_of(unsupported, "colour"), [1, 2, 3, 4]);
        // Цвет не помещается в короткую вершину: недостающие байты — 255.
        let mut vertex = floats_bytes(&[7.0, 8.0, 9.0]);
        vertex.extend([1u8, 2]);
        let short = &run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![Geom::raw(1, 17, 0x9_0006, (14, 14), vertex)])],
            ..Spec::default()
        }))[0];
        assert_eq!(bytes_of(short, "colour"), [1, 2, 255, 255]);
        assert_eq!(
            short["layout"],
            json!({"flags": 17, "types": "0000000000090006", "stride": 14, "declared": 14, "bytes": 14})
        );
    }

    #[test]
    fn colour_type_names_cover_every_code() {
        let names = [
            "Nothing",
            "Half2",
            "Float",
            "Half4",
            "FloatUnk",
            "Float2",
            "Float3",
            "Float4",
            "UByte4",
            "Colour",
            "RGBA8SNorm",
            "11",
        ];
        let geoms: Vec<Geom> = (0u64..12)
            .map(|code| Geom::raw(1, 16, code << 16, (8, 0), vec![10, 20, 30, 40, 0, 0, 0, 0]))
            .collect();
        let found = run_single_model(model_bytes(&Spec {
            parts: vec![part(geoms)],
            ..Spec::default()
        }));
        assert_eq!(found.len(), 12);
        for (index, geometry) in found.iter().enumerate() {
            assert_eq!(geometry["colourType"], names[index], "тип {index}");
            assert_eq!(
                geometry["layout"]["types"],
                format!("{:016X}", (index as u64) << 16)
            );
            assert_eq!(bytes_of(geometry, "colour"), [10, 20, 30, 40]);
            assert_eq!(geometry["layout"]["stride"], 8);
        }
    }

    #[test]
    fn stride_comes_from_the_buffer_then_the_declaration_then_the_layout() {
        let table = [
            (64u16, 52u16, 64u64),
            (0, 64, 64),
            (0, 0, 52),
            (52, 64, 52),
            (52, 52, 52),
        ];
        for (buffer, declared, expected) in table {
            // Вершины образца, добитые нулями до ожидаемого шага.
            let vertices: Vec<u8> = standard_vertices(2)
                .chunks(52)
                .flat_map(|vertex| {
                    let mut padded = vertex.to_vec();
                    padded.resize(expected as usize, 0);
                    padded
                })
                .collect();
            let mut geom = Geom::standard(2);
            geom.buffer_stride = buffer;
            geom.declared = declared;
            geom.vertices = vertices;
            let found = run_single_model(model_bytes(&Spec {
                parts: vec![part(vec![geom])],
                ..Spec::default()
            }));
            let layout = &found[0]["layout"];
            assert_eq!(layout["stride"], expected, "{buffer}/{declared}");
            assert_eq!(layout["declared"], declared, "{buffer}/{declared}");
            assert_eq!(layout["bytes"], 2 * expected, "{buffer}/{declared}");
        }
        // Данные по запасному указателю +0x20.
        let mut geom = Geom::standard(2);
        geom.alt_pointer = true;
        let found = run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![geom])],
            ..Spec::default()
        }));
        assert!(same_floats(
            &floats(&found[0], "position"),
            &[0.0, 0.5, 0.0, 1.0, 1.5, 2.0]
        ));
    }

    #[test]
    fn geometries_that_cannot_be_read_are_dropped_without_a_trace() {
        let zero_stride = Geom::raw(2, 0, 0, (0, 0), vec![0; 16]);
        let mut no_vertices = Geom::standard(2);
        no_vertices.count = 0;
        let mut no_indices = Geom::standard(2);
        no_indices.index_count = 0;
        let mut many_vertices = Geom::standard(2);
        many_vertices.count = 5_000_000;
        let mut many_indices = Geom::standard(2);
        many_indices.index_count = 3_000_000;
        let mut short_data = Geom::standard(2);
        short_data.count = 3;
        let good = Geom::standard(2);
        let mut no_data = Geom::standard(2);
        no_data.vertices = Vec::new();
        let found = run_single_model(model_bytes(&Spec {
            parts: vec![part(vec![
                zero_stride,
                no_vertices,
                no_indices,
                many_vertices,
                many_indices,
                short_data,
                good,
                no_data,
            ])],
            ..Spec::default()
        }));
        // Остались «три вершины при данных на две» (укладываются в ресурс) и хорошая.
        let counts: Vec<u64> = found
            .iter()
            .map(|g| g["vertexCount"].as_u64().unwrap())
            .collect();
        assert_eq!(counts, [3, 2]);
    }

    #[test]
    fn parts_geometries_and_shader_numbers_follow_the_header_counts() {
        let lab = Lab::new();
        let shader = |hash: u32, sheet_name: &str| ShaderSpec {
            hash,
            params: vec![sheet("DensitySampler", sheet_name)],
        };
        let spec = Spec {
            shaders: vec![shader(305419896, "d0"), shader(5, "n0"), shader(78, "t0")],
            parts: vec![
                // заголовок говорит об одной геометрии из двух; соответствие [2, 1]
                Part {
                    geoms: vec![Geom::standard(3), Geom::standard(4)],
                    header_count: Some(1),
                    map: Some(vec![2, 1]),
                },
                // номер шейдера за пределами массива
                Part {
                    geoms: vec![Geom::standard(2)],
                    header_count: None,
                    map: Some(vec![9]),
                },
                // соответствия нет: шейдер 0
                part(vec![Geom::standard(5)]),
            ],
            ..Spec::default()
        };
        let root = cloud_world(
            &lab,
            "cloud-stride",
            Some(vec![rsc("s_models.ydr", model_bytes(&spec))]),
            None,
        );
        let answer = hats(&lab, &root, "O").unwrap();
        let found = geometries_of(&lab, "O", "s_models");
        let shaders: Vec<&Value> = found.iter().map(|g| &g["shader"]).collect();
        assert_eq!(shaders, [&json!("78"), &Value::Null, &json!("305419896")]);
        let counts: Vec<u64> = found
            .iter()
            .map(|g| g["vertexCount"].as_u64().unwrap())
            .collect();
        assert_eq!(counts, [3, 2, 5]);
        assert_eq!(found[0]["textures"], json!({"DensitySampler": "t0"}));
        assert_eq!(found[1]["textures"], json!({}));
        // Нужные листы берутся только у геометрий, которые остались в описи.
        assert_eq!(answer["missing"], json!(["d0", "t0"]));
    }

    // ----- шейдеры и параметры -----

    fn full_shader() -> ShaderSpec {
        ShaderSpec {
            hash: 4_000_000_001,
            params: vec![
                sheet("DensitySampler", "dens_x"),
                sheet("normalSampler", "norm_x"),
                sheet("DetailDensitySampler", "ddens_x"),
                sheet("DetailNormalSampler", "dnorm_x"),
                sheet("DetailDensity2Sampler", "ddens2_x"),
                sheet("DetailNormal2Sampler", "dnorm2_x"),
                Param::Sheet(3405705229, Some("not_a_slot_tex".to_owned())),
                sheet("gSkyColor", "sky_as_texture"),
                sheet("gSunColor", ""),
                Param::Sheet(joaat("gUVOffset"), None),
                sheet("DensitySampler", "dens_second"),
                vector("cloudLayerAnimScale1", &[1.0, 2.0, 3.0, 4.0]),
                vector(
                    "gAnimBlendWeights",
                    &[0.5, 0.25, 0.125, 0.0, 1.0, 2.0, 3.0, 4.0],
                ),
                vector(
                    "gCloudViewProj",
                    &[
                        0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0,
                        14.0, 15.0,
                    ],
                ),
                Param::Vector(3405705230, vec![5.0, 6.0, 7.0, 8.0]),
                vector("gCameraPos", &[1.0, 1.0, 1.0, 1.0]),
                vector("gCameraPos", &[9.0, 9.0, 9.0, 9.0]),
                Param::Vector(joaat("gcloudcolor"), vec![0.3, 0.3, 0.3, 0.3]),
            ],
        }
    }

    #[test]
    fn shader_parameters_are_named_replaced_in_place_and_filtered() {
        let lab = Lab::new();
        let lower = ShaderSpec {
            hash: 7,
            params: vec![Param::Sheet(
                joaat("densitysampler"),
                Some("lowercase_hash_name".to_owned()),
            )],
        };
        let files = vec![
            rsc(
                "p_full.ydr",
                model_bytes(&Spec {
                    shaders: vec![full_shader()],
                    parts: vec![part(vec![Geom::standard(3)])],
                    ..Spec::default()
                }),
            ),
            rsc(
                "p_lowercase_hash.ydr",
                model_bytes(&Spec {
                    shaders: vec![lower],
                    parts: vec![part(vec![Geom::standard(3)])],
                    ..Spec::default()
                }),
            ),
            rsc(
                "p_no_group.ydr",
                model_bytes(&Spec {
                    shaders: vec![full_shader()],
                    parts: vec![part(vec![Geom::standard(3)])],
                    no_group: true,
                    ..Spec::default()
                }),
            ),
        ];
        let root = cloud_world(&lab, "cloud-shaders", Some(files), None);
        let answer = hats(&lab, &root, "C14").unwrap();
        let full = &geometries_of(&lab, "C14", "p_full")[0];
        assert_eq!(full["shader"], "4000000001");
        assert_eq!(
            serde_json::to_string(&full["textures"]).unwrap(),
            r#"{"DensitySampler":"dens_second","normalSampler":"norm_x","DetailDensitySampler":"ddens_x","DetailNormalSampler":"dnorm_x","DetailDensity2Sampler":"ddens2_x","DetailNormal2Sampler":"dnorm2_x","3405705229":"not_a_slot_tex","gSkyColor":"sky_as_texture"}"#
        );
        assert_eq!(
            serde_json::to_string(&full["parameters"]).unwrap(),
            concat!(
                r#"{"cloudLayerAnimScale1":[1.0,2.0,3.0,4.0],"gAnimBlendWeights":[0.5,0.25,0.125,0.0,1.0,2.0,3.0,4.0],"#,
                r#""gCloudViewProj":[0.0,1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0,9.0,10.0,11.0,12.0,13.0,14.0,15.0],"#,
                r#""3405705230":[5.0,6.0,7.0,8.0],"gCameraPos":[9.0,9.0,9.0,9.0],"gCloudColor":[0.3,0.3,0.3,0.3]}"#
            )
        );
        let lowercase = &geometries_of(&lab, "C14", "p_lowercase_hash")[0];
        assert_eq!(
            lowercase["textures"],
            json!({"DensitySampler": "lowercase_hash_name"})
        );
        let bare = &geometries_of(&lab, "C14", "p_no_group")[0];
        assert_eq!(bare["shader"], Value::Null);
        assert_eq!(bare["textures"], json!({}));
        // Нужны листы всех шести гнёзд, в том числе перекрытый повтором `dens_x`.
        assert_eq!(
            answer["missing"],
            json!([
                "ddens2_x",
                "ddens_x",
                "dens_second",
                "dens_x",
                "dnorm2_x",
                "dnorm_x",
                "lowercase_hash_name",
                "norm_x"
            ])
        );
    }

    #[test]
    fn eight_numbers_per_parameter_print_through_f64() {
        let lab = Lab::new();
        let shader = ShaderSpec {
            hash: 1,
            params: vec![
                vector(
                    "gAmbientColor",
                    &[0.1, 1.0, -0.0, 0.0, 1e20, 1e-7, 123_456.79, 16777216.0],
                ),
                vector(
                    "gBounceColor",
                    &[
                        f32::MAX,
                        f32::MIN_POSITIVE,
                        1e-45,
                        f32::NAN,
                        f32::INFINITY,
                        f32::NEG_INFINITY,
                        0.3,
                        2.5,
                    ],
                ),
                vector(
                    "gCameraPos",
                    &[
                        -1.5, 100.0, 1234567.0, 0.000123, 33554432.0, 1.0e7, 0.99999994, 8.5e-5,
                    ],
                ),
            ],
        };
        let spec = Spec {
            shaders: vec![shader],
            parts: vec![part(vec![Geom::standard(3)])],
            ..Spec::default()
        };
        let root = cloud_world(
            &lab,
            "cloud-numbers",
            Some(vec![rsc("n.ydr", model_bytes(&spec))]),
            None,
        );
        hats(&lab, &root, "C15").unwrap();
        let written = manifest(&lab, "C15");
        assert!(written
            .contains(r#""gAmbientColor":[0.1,1.0,-0.0,0.0,1e+20,1e-7,123456.79,16777216.0]"#));
        assert!(written.contains(
            r#""gBounceColor":[3.4028235e+38,1.1754944e-38,1e-45,null,null,null,0.3,2.5]"#
        ));
        assert!(written.contains(
            r#""gCameraPos":[-1.5,100.0,1234567.0,0.000123,33554432.0,10000000.0,0.99999994,0.000085]"#
        ));
    }

    // ----- листы -----

    fn sheet_model(slots: &[(&str, &str)], hash: u32, embedded: Vec<Embedded>) -> Vec<u8> {
        let params = slots.iter().map(|(slot, name)| sheet(slot, name)).collect();
        model_bytes(&Spec {
            shaders: vec![ShaderSpec { hash, params }],
            parts: vec![part(vec![Geom::standard(3)])],
            embedded,
            ..Spec::default()
        })
    }

    #[test]
    fn sheets_are_laid_out_in_dictionary_order_with_their_own_file_names() {
        let lab = Lab::new();
        let unreadable = Embedded {
            code: 0x1234_5678,
            ..embedded("cloud_bad", Format::Dxt1, 4, 4, 9)
        };
        let t_shaders = {
            let slots = [
                ("DensitySampler", "cloud_dens_a"),
                ("normalSampler", "cloud_norm_a"),
                ("DetailDensitySampler", "cloud_absent"),
                ("DetailNormalSampler", "cloud_bad"),
                ("DetailDensity2Sampler", "Dup_Tex"),
                ("DetailNormal2Sampler", "dup_tex"),
                ("gSkyColor", "NOT_A_SLOT_TEXTURE"),
            ];
            sheet_model(&slots, 2, Vec::new())
        };
        let t_shaders2 = sheet_model(
            &[
                (
                    "DensitySampler",
                    "\u{43e}\u{431}\u{43b}\u{430}\u{43a}\u{43e} 1.5",
                ),
                ("normalSampler", "cloud:x*y"),
            ],
            3,
            Vec::new(),
        );
        let t_embedded = model_bytes(&Spec {
            embedded: vec![
                embedded(
                    "\u{43e}\u{431}\u{43b}\u{430}\u{43a}\u{43e} 1.5",
                    Format::Dxt1,
                    4,
                    4,
                    11,
                ),
                embedded("cloud:x*y", Format::Dxt1, 4, 4, 12),
                embedded("Dup_Tex", Format::Dxt1, 4, 4, 13),
                embedded("dup_tex", Format::Dxt1, 4, 4, 14),
                unreadable,
            ],
            ..Spec::default()
        });
        let files = vec![
            rsc(
                "cloud_sheets.ytd",
                sheets_file(&[
                    texture("cloud_dens_a", Format::Dxt5, 16, 16, 1),
                    texture("cloud_norm_a", Format::Ati2, 16, 16, 2),
                ]),
            ),
            rsc(
                "rival_sheets.ytd",
                sheets_file(&[
                    texture("CLOUD_DENS_A", Format::Dxt1, 4, 4, 3),
                    texture("cloud_norm_a", Format::Dxt1, 8, 8, 4),
                    texture("cloud_extra", Format::Dxt1, 4, 4, 5),
                ]),
            ),
            rsc("t_embedded.ydr", t_embedded),
            rsc("t_shaders.ydr", t_shaders),
            rsc("t_shaders2.ydr", t_shaders2),
        ];
        let root = cloud_world(&lab, "cloud-sheets", Some(files), None);
        let answer = hats(&lab, &root, "C16").unwrap();
        assert_eq!(answer["drawables"], 2);
        assert_eq!(answer["textures"], 6);
        assert_eq!(answer["missing"], json!(["cloud_absent", "cloud_bad"]));
        let reported = answer["skipped"].as_array().unwrap();
        assert_eq!(reported.len(), 1, "{reported:?}");
        assert!(reported[0]
            .as_str()
            .unwrap()
            .starts_with("t_embedded.ydr/cloud_bad: "));
        let written = manifest_json(&lab, "C16");
        assert_eq!(
            serde_json::to_string(&written["textures"]).unwrap(),
            concat!(
                r#"{"cloud_norm_a":{"file":"cloud_norm_a.png","width":16,"height":16},"#,
                r#""cloud_dens_a":{"file":"cloud_dens_a.png","width":16,"height":16},"#,
                r#""облако 1.5":{"file":"облако_1_5.png","width":4,"height":4},"#,
                r#""cloud:x*y":{"file":"cloud_x_y.png","width":4,"height":4},"#,
                r#""Dup_Tex":{"file":"Dup_Tex.png","width":4,"height":4},"#,
                r#""dup_tex":{"file":"dup_tex.png","width":4,"height":4}}"#
            )
        );
        // На Windows `Dup_Tex.png` и `dup_tex.png` — один файл; других листов нет.
        let names = listing(&lab.out("C16"));
        assert!(
            names.contains(&"cloud_x_y.png".to_owned()) && names.contains(&"hats.json".to_owned())
        );
        assert!(names.contains(&"\u{43e}\u{431}\u{43b}\u{430}\u{43a}\u{43e}_1_5.png".to_owned()));
        assert!(!names
            .iter()
            .any(|name| name.contains("extra") || name.contains("absent")));
        // Лист из первого словаря остался тем, что в нём, а не из «соперника».
        let kept = fs::read(lab.out("C16").join("cloud_norm_a.png")).unwrap();
        assert_eq!(&kept[16..24], [0, 0, 0, 16, 0, 0, 0, 16]);
    }
    #[test]
    fn a_sheet_that_cannot_be_read_is_named_in_skipped_when_it_stays_missing() {
        let lab = Lab::new();
        let bad = |name: &str| Embedded {
            code: 0x1234_5678,
            ..embedded(name, Format::Dxt1, 4, 4, 9)
        };
        let wants = |names: &[&str]| {
            let slots = [("DensitySampler", names[0]), ("normalSampler", names[1])];
            slots
                .iter()
                .map(|(slot, name)| sheet(slot, name))
                .collect::<Vec<_>>()
        };
        // a_first.ydr: `cloud_bad` нечитаем и нужен; `unused_bad` нечитаем, но не нужен;
        // `cloud_twice` нечитаем здесь и читается во втором словаре.
        let first = model_bytes(&Spec {
            shaders: vec![ShaderSpec {
                hash: 7,
                params: wants(&["cloud_bad", "cloud_twice"]),
            }],
            parts: vec![part(vec![Geom::standard(3)])],
            embedded: vec![bad("cloud_bad"), bad("unused_bad"), bad("cloud_twice")],
            ..Spec::default()
        });
        let second = model_bytes(&Spec {
            embedded: vec![embedded("cloud_twice", Format::Dxt1, 4, 4, 31)],
            ..Spec::default()
        });
        let files = vec![rsc("a_first.ydr", first), rsc("b_second.ydr", second)];
        let root = cloud_world(&lab, "cloud-unreadable", Some(files), None);
        let answer = hats(&lab, &root, "C40").unwrap();
        assert_eq!(answer["textures"], 1);
        assert_eq!(answer["missing"], json!(["cloud_bad"]));
        let skipped = answer["skipped"].as_array().unwrap();
        assert_eq!(skipped.len(), 1, "{skipped:?}");
        assert!(
            skipped[0]
                .as_str()
                .unwrap()
                .starts_with("a_first.ydr/cloud_bad: "),
            "{skipped:?}"
        );
        // опись пишет те же строки
        assert_eq!(manifest_json(&lab, "C40")["skipped"], answer["skipped"]);
    }

    #[test]
    fn unicode_names_and_the_dictionary_of_a_model_without_geometry() {
        let lab = Lab::new();
        // Об17: лист с знаком вне BMP и параметр с «чужим» хешем.
        let unicode = model_bytes(&Spec {
            shaders: vec![ShaderSpec {
                hash: 3,
                params: vec![
                    Param::Sheet(
                        joaat("\u{43f}\u{430}\u{440}\u{430}\u{43c}"),
                        Some("x".to_owned()),
                    ),
                    sheet(
                        "DensitySampler",
                        "\u{442}\u{435}\u{441}\u{442}\u{1f600}\u{43b}\u{438}\u{441}\u{442}",
                    ),
                ],
            }],
            parts: vec![part(vec![Geom::standard(3)])],
            embedded: vec![embedded(
                "\u{442}\u{435}\u{441}\u{442}\u{1f600}\u{43b}\u{438}\u{441}\u{442}",
                Format::Dxt1,
                4,
                4,
                21,
            )],
            ..Spec::default()
        });
        let files = vec![
            rsc("\u{43e}\u{431}\u{43b}\u{430}\u{43a}\u{43e}_1.ydr", unicode),
            bin("\u{65e5}\u{672c}.ydr", noise(4, 1)),
        ];
        let root = cloud_world(&lab, "cloud-unicode", Some(files), None);
        let answer = hats(&lab, &root, "C17").unwrap();
        assert_eq!(answer["textures"], 1);
        assert_eq!(answer["missing"], json!([]));
        assert_eq!(
            answer["skipped"],
            json!(["\u{65e5}\u{672c}.ydr: Ресурс короче заголовка RSC7."])
        );
        assert_eq!(
            listing(&lab.out("C17")),
            [
                "hats.json",
                "\u{442}\u{435}\u{441}\u{442}_\u{43b}\u{438}\u{441}\u{442}.png"
            ]
        );
        // Опись только из ASCII: знаки выше записаны как \uXXXX прописными.
        let raw = manifest(&lab, "C17");
        assert!(raw.is_ascii());
        let slash = char::from(0x5cu8);
        assert!(raw.contains(&format!("{slash}uD83D{slash}uDE00")));
        // Об29: лист лежит во встроенном словаре модели без единой геометрии.
        let user = sheet_model(
            &[
                ("DensitySampler", "only_embedded"),
                ("normalSampler", "also_missing"),
            ],
            4,
            Vec::new(),
        );
        let holder = model_bytes(&Spec {
            embedded: vec![embedded("only_embedded", Format::Dxt1, 4, 4, 31)],
            ..Spec::default()
        });
        let root = cloud_world(
            &lab,
            "cloud-nogeo-dict",
            Some(vec![rsc("a_user.ydr", user), rsc("b_holder.ydr", holder)]),
            None,
        );
        let answer = hats(&lab, &root, "C29").unwrap();
        assert_eq!(answer["drawables"], 1);
        assert_eq!(answer["textures"], 1);
        assert_eq!(answer["missing"], json!(["also_missing"]));
        assert_eq!(listing(&lab.out("C29")), ["hats.json", "only_embedded.png"]);
    }
}
