//! `convert-scene`: сцена из частей (модели `.ydr`, `.ydd`, `.yft`) в один `.glb`.
//!
//! Список частей лежит в файле-запросе JSON. Запрос читается мягко (ключи без учёта регистра,
//! значение не того типа равно отсутствующему), проверки идут в порядке хоста, а ответ — подробный
//! отчёт: размеры, картинки и отдельная запись на каждую часть, в том числе неудавшуюся.

use std::{
    collections::HashSet,
    fmt, fs,
    path::{Path, PathBuf},
};

use rage_res::{
    drawable::{FileKind, Light},
    hash::{joaat, sha256_hex},
    scene::{
        self, Bundle, ImageReport, LodReport, Options as SceneOptions, PieceInput, PieceReport,
    },
    Kind,
};
use serde_json::Value;

use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Границы подтягиваемых целых: размеры текстур и качество JPEG.
const SIZE_LOW: i64 = 64;
const SIZE_HIGH: i64 = 4096;
const QUALITY_LOW: i64 = 40;
const QUALITY_HIGH: i64 = 100;
/// Умолчания, когда значение не задано или записано не целым.
const SIZE_DEFAULT: i64 = 1024;
const QUALITY_DEFAULT: i64 = 88;

const REQUEST_FORMAT: &str = "astral.convert-scene";
const BUNDLE_FORMAT: &str = "astral.scene-bundle";
const ID_CHARS: usize = 160;
const ID_FORBIDDEN: [char; 2] = ['#', '|'];
const PIECE_LIMIT: usize = 2048;
const DICTIONARY_LIMIT: usize = 256;
/// Целые значения меньше этой границы печатаются целыми числами.
const INTEGER_PRINT_LIMIT: f32 = 1.0e9;
/// Расширения частей и названия видов огней.
const PIECE_KINDS: [(&str, FileKind); 3] = [
    (".ydr", FileKind::Ydr),
    (".ydd", FileKind::Ydd),
    (".yft", FileKind::Yft),
];
const LIGHT_KINDS: [(u16, &str); 3] = [(1, "Point"), (2, "Spot"), (4, "Capsule")];

// ---------------------------------------------------------------------------------------------
// Отказы запроса
// ---------------------------------------------------------------------------------------------

/// Что просит сцена, но хост не принимает: слова отказов запроса.
enum Refusal<'a> {
    Empty,
    Format,
    NoPieces,
    TooManyPieces,
    TooManyDictionaries,
    PieceId(&'a str),
    PieceTwice(&'a str),
    PieceMissing(&'a str),
    PieceKind(&'a str),
    HashNotYdd(&'a str),
    DictionaryMissing(&'a str),
    DictionaryKind(&'a str),
    TextureFormat,
}

impl Refusal<'_> {
    fn words(&self) -> String {
        match self {
            Refusal::Empty => "Empty scene bundle request.".to_owned(),
            Refusal::Format => "Unsupported scene bundle request format.".to_owned(),
            Refusal::NoPieces => "A scene bundle needs at least one piece.".to_owned(),
            Refusal::TooManyPieces => "Too many pieces in one scene bundle.".to_owned(),
            Refusal::TooManyDictionaries => {
                "Too many texture dictionaries in one scene bundle.".to_owned()
            }
            Refusal::PieceId(raw) => format!("Invalid piece id: {raw}"),
            Refusal::PieceTwice(id) => format!("Duplicate piece id: {id}"),
            Refusal::PieceMissing(raw) => format!("Piece file was not found: {raw}"),
            Refusal::PieceKind(extension) => format!("Unsupported piece resource: {extension}"),
            Refusal::HashNotYdd(id) => format!("drawableHash is only meaningful for .ydd: {id}"),
            Refusal::DictionaryMissing(raw) => format!("Texture dictionary was not found: {raw}"),
            Refusal::DictionaryKind(raw) => format!("Texture dictionaries must be .ytd: {raw}"),
            Refusal::TextureFormat => "textureFormat must be auto or png.".to_owned(),
        }
    }

    fn is_missing_file(&self) -> bool {
        matches!(
            self,
            Refusal::PieceMissing(_) | Refusal::DictionaryMissing(_)
        )
    }
}

impl fmt::Display for Refusal<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.words())
    }
}

impl From<Refusal<'_>> for EngineError {
    fn from(refusal: Refusal<'_>) -> Self {
        let text = refusal.words();
        if refusal.is_missing_file() {
            EngineError::file_not_found(text)
        } else {
            EngineError::invalid_data(text)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Чтение значений запроса
// ---------------------------------------------------------------------------------------------

/// Объект запроса: ключ ищется без учёта регистра, побеждает последняя запись, `null` равен отсутствию.
#[derive(Clone, Copy)]
struct Node<'a>(&'a Value);

impl<'a> Node<'a> {
    fn get(self, key: &str) -> Option<&'a Value> {
        let entries = self.0.as_object()?;
        let (_, found) = entries
            .iter()
            .rfind(|(name, _)| name.eq_ignore_ascii_case(key))?;
        (!found.is_null()).then_some(found)
    }

    fn text(self, key: &str) -> Option<&'a str> {
        self.get(key)?.as_str()
    }

    fn whole(self, key: &str) -> Option<i64> {
        self.get(key)?.as_i64()
    }

    fn flag(self, key: &str) -> Option<bool> {
        self.get(key)?.as_bool()
    }

    fn list(self, key: &str) -> &'a [Value] {
        match self.get(key) {
            Some(Value::Array(items)) => items,
            _ => &[],
        }
    }
}

/// Применённые параметры сборки: хранят и то, что уходит соседу, и то, что печатается в ответе.
struct Settings {
    max_texture: i64,
    png_only: bool,
    quality: i64,
    vertex_colours: bool,
    lods: bool,
    max_normal: i64,
    normal_maps: bool,
}

impl Settings {
    /// Целое параметра: заданное или умолчание, затем подтянутое к границам.
    fn pulled(root: Node, key: &str, default: i64, low: i64, high: i64) -> i64 {
        root.whole(key).unwrap_or(default).clamp(low, high)
    }

    /// `textureFormat`: не строка равно `auto`; кроме `auto` и `png` ничего не принимается.
    fn wants_png(root: Node) -> Result<bool> {
        let Some(raw) = root.text("textureFormat") else {
            return Ok(false);
        };
        match raw.trim().to_lowercase().as_str() {
            "auto" => Ok(false),
            "png" => Ok(true),
            _ => Err(Refusal::TextureFormat.into()),
        }
    }

    /// Умолчание нормалей - половина уже подтянутого размера, не меньше нижней границы.
    fn read(root: Node) -> Result<Settings> {
        let max_texture = Self::pulled(root, "maxTextureSize", SIZE_DEFAULT, SIZE_LOW, SIZE_HIGH);
        let png_only = Self::wants_png(root)?;
        let half = (max_texture / 2).max(SIZE_LOW);
        Ok(Settings {
            max_texture,
            png_only,
            quality: Self::pulled(
                root,
                "jpegQuality",
                QUALITY_DEFAULT,
                QUALITY_LOW,
                QUALITY_HIGH,
            ),
            vertex_colours: root.flag("vertexColors").unwrap_or(true),
            lods: root.flag("lods").unwrap_or(true),
            max_normal: Self::pulled(root, "maxNormalTextureSize", half, SIZE_LOW, SIZE_HIGH),
            normal_maps: root.flag("normalMaps").unwrap_or(true),
        })
    }

    fn for_neighbour(&self) -> SceneOptions {
        SceneOptions {
            max_texture_size: self.max_texture as u32,
            png_only: self.png_only,
            jpeg_quality: self.quality as u8,
            vertex_colours: self.vertex_colours,
            lods: self.lods,
            max_normal_texture_size: self.max_normal as u32,
            normal_maps: self.normal_maps,
        }
    }

    fn echo(&self) -> Value {
        object([
            ("maxTextureSize", self.max_texture.into()),
            (
                "textureFormat",
                if self.png_only { "png" } else { "auto" }.into(),
            ),
            ("jpegQuality", self.quality.into()),
            ("vertexColors", self.vertex_colours.into()),
            ("lods", self.lods.into()),
            ("maxNormalTextureSize", self.max_normal.into()),
            ("normalMaps", self.normal_maps.into()),
        ])
    }
}

// ---------------------------------------------------------------------------------------------
// Части и словари
// ---------------------------------------------------------------------------------------------

/// Хеш модели из `drawableHash`: `0x…` - шестнадцатеричное, чистое десятичное - число, остальное - имя.
fn drawable_hash(raw: &str) -> Result<u32> {
    let value = raw.trim();
    match value.get(..2) {
        Some("0x" | "0X") => u32::from_str_radix(&value[2..], 16).map_err(|_| {
            let words = format!("The drawable hash is not valid: {raw}");
            EngineError::new("FormatException", words)
        }),
        _ => Ok(value
            .parse()
            .unwrap_or_else(|_| joaat(&value.to_lowercase()))),
    }
}

/// Существующий файл по записи из запроса; нет файла - отказ с записью как есть.
fn located<'r>(raw: &'r str, missing: impl FnOnce(&'r str) -> Refusal<'r>) -> Result<PathBuf> {
    let full = paths::full_path(raw)?;
    if full.is_file() {
        Ok(full)
    } else {
        Err(missing(raw).into())
    }
}

/// Части читаются по порядку; единственное состояние - уже занятые `id`.
#[derive(Default)]
struct PieceReader {
    taken: HashSet<String>,
}

impl PieceReader {
    fn claim_id(&mut self, node: Node) -> Result<String> {
        let raw = node.text("id").unwrap_or_default();
        let id = raw.trim();
        let unusable = id.is_empty() || id.chars().count() > ID_CHARS || id.contains(ID_FORBIDDEN);
        if unusable {
            return Err(Refusal::PieceId(raw).into());
        }
        if self.taken.insert(id.to_owned()) {
            Ok(id.to_owned())
        } else {
            Err(Refusal::PieceTwice(id).into())
        }
    }

    /// `drawableHash` применяется, только если это непустая строка; и только к `.ydd`.
    fn chosen_hash(node: Node, kind: FileKind, id: &str) -> Result<Option<u32>> {
        let Some(text) = node
            .text("drawableHash")
            .filter(|text| !text.trim().is_empty())
        else {
            return Ok(None);
        };
        if kind != FileKind::Ydd {
            return Err(Refusal::HashNotYdd(id).into());
        }
        drawable_hash(text).map(Some)
    }

    fn read(&mut self, node: Node) -> Result<PieceInput> {
        let id = self.claim_id(node)?;
        let file = located(node.text("file").unwrap_or_default(), Refusal::PieceMissing)?;
        let extension = paths::extension_with_dot(&file).to_lowercase();
        let kind = PIECE_KINDS
            .iter()
            .find_map(|&(known, kind)| (known == extension).then_some(kind))
            .ok_or(Refusal::PieceKind(&extension))?;
        let drawable_hash = Self::chosen_hash(node, kind, &id)?;
        Ok(PieceInput {
            id,
            kind,
            drawable_hash,
            file: file.display().to_string(),
            bytes: fs::read(&file)?,
        })
    }
}

fn read_dictionary(item: &Value) -> Result<(String, Vec<u8>)> {
    let raw = item.as_str().unwrap_or_default();
    let file = located(raw, Refusal::DictionaryMissing)?;
    if !paths::extension_with_dot(&file).eq_ignore_ascii_case(".ytd") {
        return Err(Refusal::DictionaryKind(raw).into());
    }
    let name = file
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    Ok((name, fs::read(&file)?))
}

/// Разобранный запрос: части, словари и применённые параметры.
struct Request {
    pieces: Vec<PieceInput>,
    dictionaries: Vec<(String, Vec<u8>)>,
    settings: Settings,
}

impl Request {
    /// Порядок проверок: формат, число частей, число словарей, части, словари, параметры.
    fn parse(root: Node) -> Result<Request> {
        if root.text("format") != Some(REQUEST_FORMAT) || root.whole("version") != Some(1) {
            return Err(Refusal::Format.into());
        }
        let listed = root.list("pieces");
        match listed.len() {
            0 => return Err(Refusal::NoPieces.into()),
            count if count > PIECE_LIMIT => return Err(Refusal::TooManyPieces.into()),
            _ => {}
        }
        let wanted = root.list("textures");
        if wanted.len() > DICTIONARY_LIMIT {
            return Err(Refusal::TooManyDictionaries.into());
        }

        let mut reader = PieceReader::default();
        let mut pieces = Vec::with_capacity(listed.len());
        for item in listed {
            pieces.push(reader.read(Node(item))?);
        }
        let dictionaries = wanted.iter().map(read_dictionary).collect::<Result<_>>()?;
        Ok(Request {
            pieces,
            dictionaries,
            settings: Settings::read(root)?,
        })
    }

    /// Сборка у соседа: `Operation` остаётся операцией, прочие виды - ошибкой данных.
    fn assemble(&self) -> Result<Bundle> {
        let neighbour = self.settings.for_neighbour();
        scene::convert(&self.pieces, &self.dictionaries, &neighbour).map_err(
            |failure| match failure.kind {
                Kind::Operation => EngineError::invalid_operation(failure.message),
                _ => EngineError::invalid_data(failure.message),
            },
        )
    }
}

// ---------------------------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------------------------

/// Объект JSON с ключами в том порядке, в каком они перечислены.
fn object<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Дробное `f32` как печатает хост: нет значения - `null`, целое по модулю меньше 10⁹ - целое,
/// иначе кратчайшая запись того же `f32`, прочитанная как `f64`.
fn float_value(value: f32) -> Value {
    match value {
        bad if !bad.is_finite() => Value::Null,
        whole if whole.fract() == 0.0 && whole.abs() < INTEGER_PRINT_LIMIT => (whole as i64).into(),
        other => other.to_string().parse::<f64>().unwrap_or_default().into(),
    }
}

fn triple(values: [f32; 3]) -> Value {
    values.into_iter().map(float_value).collect()
}

fn light_type(kind: u16) -> String {
    LIGHT_KINDS
        .iter()
        .find(|(known, _)| *known == kind)
        .map_or_else(|| format!("Unknown{kind}"), |&(_, name)| name.to_owned())
}

fn light_json(light: &Light) -> Value {
    object([
        ("position", triple(light.position)),
        ("direction", triple(light.direction)),
        ("color", light.color.to_vec().into()),
        ("intensity", float_value(light.intensity)),
        ("falloff", float_value(light.falloff)),
        ("falloffExponent", float_value(light.falloff_exponent)),
        ("coneInnerAngle", float_value(light.cone_inner_angle)),
        ("coneOuterAngle", float_value(light.cone_outer_angle)),
        ("type", light_type(light.kind).into()),
        ("flags", light.flags.into()),
        ("timeFlags", light.time_flags.into()),
        ("boneId", light.bone_id.into()),
        ("coronaSize", float_value(light.corona_size)),
        ("coronaIntensity", float_value(light.corona_intensity)),
        ("extent", triple(light.extent)),
    ])
}

fn lod_json(lod: &LodReport) -> Value {
    object([
        ("level", lod.level.into()),
        ("distance", float_value(lod.distance)),
        ("models", lod.models.into()),
        ("meshes", lod.meshes.into()),
        ("triangles", lod.triangles.into()),
        ("vertices", lod.vertices.into()),
    ])
}

fn piece_json(piece: &PieceReport) -> Value {
    let (low, high) = piece
        .bounds
        .map_or((Value::Null, Value::Null), |(low, high)| {
            (triple(low), triple(high))
        });
    let (center, radius) = piece.sphere.map_or((Value::Null, 0.0), |(center, radius)| {
        (triple(center), radius)
    });
    object([
        ("id", piece.id.clone().into()),
        ("file", piece.file.clone().into()),
        (
            "drawableHash",
            piece
                .drawable_hash
                .map(|hash| format!("0x{hash:08x}"))
                .into(),
        ),
        ("ok", piece.ok.into()),
        ("error", piece.error.clone().into()),
        ("lods", piece.lods.iter().map(lod_json).collect()),
        ("boundsMin", low),
        ("boundsMax", high),
        ("sphereCenter", center),
        ("sphereRadius", float_value(radius)),
        ("lights", piece.lights.iter().map(light_json).collect()),
        ("textures", piece.textures.clone().into()),
        ("missingTextures", piece.missing_textures.clone().into()),
        ("shaders", piece.shaders.clone().into()),
    ])
}

fn image_json(image: &ImageReport) -> Value {
    object([
        ("name", image.name.clone().into()),
        ("width", image.width.into()),
        ("height", image.height.into()),
        ("sourceWidth", image.source_width.into()),
        ("sourceHeight", image.source_height.into()),
        ("bytes", image.bytes.into()),
        ("mime", image.mime.into()),
        ("source", image.source.clone().into()),
    ])
}

/// Ответ команды целиком, ключи в порядке, который читают окно и тесты.
fn report(bundle: &Bundle, output: &Path, settings: &Settings) -> Value {
    object([
        ("format", BUNDLE_FORMAT.into()),
        ("version", 1.into()),
        ("output", output.display().to_string().into()),
        ("bytes", bundle.glb.len().into()),
        ("sha256", sha256_hex(&bundle.glb).into()),
        ("options", settings.echo()),
        ("dictionaries", bundle.dictionaries.clone().into()),
        ("materials", bundle.materials.into()),
        ("triangles", bundle.triangles.into()),
        ("vertices", bundle.vertices.into()),
        ("imageBytes", bundle.image_bytes.into()),
        ("images", bundle.images.iter().map(image_json).collect()),
        ("pieces", bundle.pieces.iter().map(piece_json).collect()),
    ])
}

// ---------------------------------------------------------------------------------------------
// Команда
// ---------------------------------------------------------------------------------------------

/// Файл запроса: JSON, корень которого - объект; всё прочее считается пустым запросом.
fn request_document(path: &Path) -> Result<Value> {
    let parsed = serde_json::from_slice::<Value>(&fs::read(path)?);
    match parsed {
        Ok(document) if document.is_object() => Ok(document),
        _ => Err(Refusal::Empty.into()),
    }
}

pub fn convert_scene(options: &Options, progress: &Progress) -> Result<Value> {
    let (input, output) = (
        paths::existing_file(options.required("input")?, &[".json"])?,
        paths::output_file(options.required("output")?, &[".glb"])?,
    );
    let document = request_document(&input)?;
    let request = Request::parse(Node(&document))?;

    progress.report("convert");
    let bundle = request.assemble()?;
    crate::commands::shop::write_atomic(&output, &bundle.glb)?;
    Ok(report(&bundle, &output, &request.settings))
}

#[cfg(test)]
mod tests;
