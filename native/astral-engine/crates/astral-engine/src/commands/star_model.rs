//! `compile-star-model`: модель звезды `<имя>.ydr` на донорском скелете и, если нужны движение или живая картинка,
//! словарь клипов `<словарь клипов>.ycd` рядом. Берёт все виды запросов приложения: шейдеры `default`, `alpha`,
//! `emissive`, `emissive_alpha`; без движения (донор — плашка, модель без скелета) и с движением (донор — сушилка,
//! скелет из четырёх костей, фигура на кости барабана); живая картинка — клип развёртки `<модель>_uv_0`. Клипы собирает
//! тот же писатель, что и `compile-star-clip`. Что команда не берёт (чужой шейдер, неразборчивый запрос, длинное имя,
//! нет донора нужного вида), она отдаёт хосту словами «пока на хосте».

use std::{borrow::Cow, fs, ops::RangeInclusive, path::Path};

use rage_res::{
    dds,
    donor::{Donor, Mesh, Refusal, Round, Skin, SkinnedMesh},
    hash::{joaat, sha256_hex},
    shader_write::ShaderSpec,
    star_clip::{self, Motion, UvAnimation},
    texture::Format,
    ytd_write::NewTexture,
};
use serde_json::{Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const ORDER_FORMAT: &str = "astral.compile-star-model";
const ORDER_VERSION: u64 = 1;
const MAX_ORDER_BYTES: u64 = 16_777_216;
const MIN_PICTURE_BYTES: usize = 128;
const MAX_PICTURE_BYTES: usize = 8_388_608;
const NAME_LIMIT: usize = 63;
/// К имени модели дописывается суффикс картинки `_star`.
const PICTURE_SUFFIX: &str = "_star";
/// Дальность модели в файле, не зависящая от `lodDist` заказа.
const DRAW_DISTANCE: f32 = 9998.0;
/// Ось фигуры на барабане: к каждой вершине прибавляется при сборке.
const PIVOT: [f32; 3] = [0.000_643_253_3, -0.314_974_78, 0.0];
const VERTEX_RANGE: RangeInclusive<usize> = 3..=60_000;
const MAX_INDICES: usize = 360_000;
/// Дальше от оси модели — не сетка, а порча: проверка на здравость, не предел формата (позиция вершины — полный
/// float3). Вещи арен Majestic — до 92 м (опись рамок), 06.11.2026 подняли с 40 м. Тот же предел — `MaxExtent` на хосте.
const REACH: f32 = 256.0;
const UV_RANGE: RangeInclusive<f32> = -0.01..=1.01;
const SIDE_RANGE: RangeInclusive<u64> = 4..=2048;

/// Образец раскладки вершин у плашки: её единственный шейдер.
const PLATE_LAYOUT: u16 = 0;
/// У сушилки образец раскладки со скиннингом — шейдер 3, и его лист в словаре донора зовётся так.
const DRYER_LAYOUT: u16 = 3;
const DRYER_SHEET: &str = "prop_money_basic";
/// Кость барабана сушилки: на ней висит фигура; подставка — на корне (кость 0).
const DRUM_BONE: u8 = 2;
const FULL_WEIGHT: u8 = 255;

/// Почему заказ не принят. Русские тексты — «пока на хосте», английские — как у хоста.
enum Reason {
    Size,
    Unreadable,
    OtherFormat,
    OtherShader(String),
    BadName,
    LongName,
    BadClipName,
    SameClipName,
    LodRange,
    EmissiveRange,
    NoDonor,
    NoMotionDonor,
    NotDryer,
    OutputBusy,
    MeshIncomplete,
    MeshNotNumber,
    MeshNotInteger,
    MeshVertices,
    MeshTriangles,
    MeshReach,
    MeshRange,
    MeshParts,
    MeshIndex,
    MotionFrames,
    MotionTime,
    MotionValues,
    PictureFrames,
    PictureTime,
    PictureRate,
    PictureShifts,
    SideRange,
    NoPicture,
    PictureMissing,
    PictureUnsafe,
    PictureSum,
    PictureNotDds,
    PictureShape(u32, u32),
}

impl Reason {
    fn words(&self) -> Cow<'static, str> {
        let fixed = match self {
            Reason::OtherShader(shader) => {
                return format!("Звезда с шейдером {shader}: пока на хосте.").into()
            }
            Reason::PictureShape(width, height) => {
                return format!("Star texture is not {width}x{height} DXT5 with a full mip chain.")
                    .into()
            }
            Reason::Size => "Запрос звезды вне размера: пока на хосте.",
            Reason::Unreadable => "Запрос звезды не читается: пока на хосте.",
            Reason::OtherFormat => "Запрос звезды другого формата: пока на хосте.",
            Reason::BadName => "Star model name must be lowercase letters, digits and underscores.",
            Reason::LongName => "Длинное имя звезды: пока на хосте.",
            Reason::BadClipName => {
                "Star clip dictionary name must be lowercase letters, digits and underscores."
            }
            Reason::SameClipName => "Star model and clip dictionary need different names.",
            Reason::LodRange => "Star model draw distance is out of range.",
            Reason::EmissiveRange => "Star emissive must be 0…64.",
            Reason::NoDonor => "Звезда без донора: пока на хосте.",
            Reason::NoMotionDonor => "Звезда с движением без донора сушилки: пока на хосте.",
            Reason::NotDryer => "Донор звезды с движением — не сушилка: пока на хосте.",
            Reason::OutputBusy => "Папка вывода звезды не пуста: пока на хосте.",
            Reason::MeshIncomplete => "Star mesh is incomplete.",
            Reason::MeshNotNumber => "Star mesh value is not a number.",
            Reason::MeshNotInteger => "Star mesh value is not an integer.",
            Reason::MeshVertices => {
                "Star mesh must have 3…60000 vertices with matching normals, uvs and parts."
            }
            Reason::MeshTriangles => "Star mesh indices must be whole triangles.",
            Reason::MeshReach => "Star mesh must fit within 256 m.",
            Reason::MeshRange => "Star mesh normals or uvs are out of range.",
            Reason::MeshParts => "Star mesh parts must be 0 (stand) or 1 (figure).",
            Reason::MeshIndex => "Star mesh index points outside the mesh.",
            Reason::MotionFrames => "Star motion must list 2…512 frames of lift and angle.",
            Reason::MotionTime => "Star motion duration must be 0.1…120 s.",
            Reason::MotionValues => "Star motion values are out of range.",
            Reason::PictureFrames => "Star uv animation must list 2…1201 frames of (u, v) shifts.",
            Reason::PictureTime => "Star uv animation duration must be 0.05…40 s.",
            Reason::PictureRate => "Star uv animation must run at 30 frames per second.",
            Reason::PictureShifts => "Star uv animation shifts are out of range.",
            Reason::SideRange => "Star texture must be a power of two, 4…2048 px.",
            Reason::NoPicture => "Звезда без картинки: пока на хосте.",
            Reason::PictureMissing => "Картинка звезды не найдена: пока на хосте.",
            Reason::PictureUnsafe => "Star texture has an unsafe file type or size.",
            Reason::PictureSum => "Star texture SHA-256 mismatch.",
            Reason::PictureNotDds => "Star texture is not a DDS.",
        };
        fixed.into()
    }
}

impl From<Reason> for EngineError {
    fn from(reason: Reason) -> Self {
        EngineError::argument(reason.words())
    }
}

/// Отказ донора идёт с его собственным кодом и текстом.
fn refused(refusal: Refusal) -> EngineError {
    EngineError::new(refusal.code(), refusal.to_string())
}

/// Точка чтения JSON: каждый шаг вглубь может оборваться, и тогда дальше читать нечего.
#[derive(Clone, Copy)]
struct Node<'a>(Option<&'a Value>);

impl<'a> Node<'a> {
    fn at(self, key: &str) -> Self {
        Self(self.0.and_then(|value| value.get(key)))
    }

    fn text(self) -> Option<&'a str> {
        self.0?.as_str()
    }

    fn natural(self) -> Option<u64> {
        self.0?.as_u64()
    }

    fn real(self) -> Option<f64> {
        self.0?.as_f64()
    }

    fn fields(self) -> Option<&'a Map<String, Value>> {
        self.0?.as_object()
    }
}

fn fits_name(name: &str) -> bool {
    let plain = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    name.bytes().next().is_some_and(plain)
        && name.len() <= NAME_LIMIT
        && name.bytes().all(|byte| plain(byte) || byte == b'_')
}

/// Пресет шейдера звезды: как его называет заказ и что из него делает хост.
struct Preset {
    request: &'static str,
    name: &'static str,
    file: &'static str,
    /// Корзина с прозрачностью (1) вместо непрозрачной (0).
    alpha: bool,
    glows: bool,
}

const PRESETS: [Preset; 4] = [
    Preset {
        request: "default",
        name: "default",
        file: "default.sps",
        alpha: false,
        glows: false,
    },
    Preset {
        request: "alpha",
        name: "default",
        file: "alpha.sps",
        alpha: true,
        glows: false,
    },
    Preset {
        request: "emissive",
        name: "emissive",
        file: "emissive.sps",
        alpha: false,
        glows: true,
    },
    Preset {
        request: "emissive_alpha",
        name: "emissive",
        file: "emissive_alpha.sps",
        alpha: true,
        glows: true,
    },
];

impl Preset {
    fn named(request: &str) -> Option<&'static Preset> {
        PRESETS.iter().find(|preset| preset.request == request)
    }

    /// Шейдер модели: свечение — только у пресетов со свечением.
    fn spec(&self, glow: f32) -> ShaderSpec {
        ShaderSpec {
            name: self.name.to_owned(),
            file: self.file.to_owned(),
            alpha: self.alpha,
            emissive: self.glows.then_some(glow),
        }
    }

    /// Маска корзин модели: бит корзины шейдера.
    fn mask(&self) -> u8 {
        1 << u8::from(self.alpha)
    }
}

/// Массив чисел заказа как список `f32`: не число (и число вне `f32`) — заказ не читается, как у хоста.
fn floats(items: &[Value]) -> Option<Vec<f32>> {
    items
        .iter()
        .map(|item| {
            item.as_f64()
                .filter(|value| value.abs() <= f64::from(f32::MAX))
                .map(|value| value as f32)
        })
        .collect()
}

/// Движение звезды как оно записано в заказе: что не записано, хост считает пустым, а проверяет позже.
struct MotionOrder {
    duration: f32,
    lift: Option<Vec<f32>>,
    angle: Option<Vec<f32>>,
}

/// Живая картинка как она записана в заказе.
struct PictureOrder {
    duration: f32,
    shifts: Option<Vec<f32>>,
}

/// Раздел заказа `motion` или `uvAnimation`: нет и `null` — раздела нет, объект — раздел, прочее хост не читает.
fn section<'a>(top: Node<'a>, key: &str) -> Result<Option<Node<'a>>> {
    match top.at(key).0 {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(_)) => Ok(Some(top.at(key))),
        Some(_) => Err(Reason::Unreadable.into()),
    }
}

/// Число раздела: нет — ноль, как у записи хоста без этого поля; не число — заказ не читается.
fn duration_of(section: Node) -> Result<f32> {
    match section.at("duration").0 {
        None | Some(Value::Null) => Ok(0.0),
        Some(value) => value
            .as_f64()
            .filter(|number| number.abs() <= f64::from(f32::MAX))
            .map(|number| number as f32)
            .ok_or_else(|| Reason::Unreadable.into()),
    }
}

/// Список чисел раздела: нет и `null` — списка нет; не список и не числа — заказ не читается.
fn list_of(section: Node, key: &str) -> Result<Option<Vec<f32>>> {
    match section.at(key).0 {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => floats(items)
            .map(Some)
            .ok_or_else(|| Reason::Unreadable.into()),
        Some(_) => Err(Reason::Unreadable.into()),
    }
}

impl MotionOrder {
    fn read(section: Node) -> Result<Self> {
        Ok(Self {
            duration: duration_of(section)?,
            lift: list_of(section, "lift")?,
            angle: list_of(section, "angle")?,
        })
    }

    /// Проверки хоста по порядку; годное движение отдаётся писателю клипов.
    fn checked(self) -> Result<Motion> {
        let (Some(lift), Some(angle)) = (self.lift, self.angle) else {
            return Err(Reason::MotionFrames.into());
        };
        let frames_fit = lift.len() == angle.len() && (2..=512).contains(&lift.len());
        frames_fit.then_some(()).ok_or(Reason::MotionFrames)?;
        (self.duration.is_finite() && (0.1..=120.0).contains(&self.duration))
            .then_some(())
            .ok_or(Reason::MotionTime)?;
        let values_fit = lift
            .iter()
            .all(|value| value.is_finite() && (0.0..=10.0).contains(value))
            && angle
                .iter()
                .all(|value| value.is_finite() && value.abs() <= 7.0);
        values_fit.then_some(()).ok_or(Reason::MotionValues)?;
        Ok(Motion {
            duration: self.duration,
            lift,
            angle,
        })
    }
}

impl PictureOrder {
    fn read(section: Node) -> Result<Self> {
        Ok(Self {
            duration: duration_of(section)?,
            shifts: list_of(section, "shifts")?,
        })
    }

    fn checked(self) -> Result<UvAnimation> {
        let shifts = self.shifts.unwrap_or_default();
        let frames = shifts.len() / 2;
        (shifts.len() % 2 == 0 && (2..=1201).contains(&frames))
            .then_some(())
            .ok_or(Reason::PictureFrames)?;
        (self.duration.is_finite() && (0.05..=40.0).contains(&self.duration))
            .then_some(())
            .ok_or(Reason::PictureTime)?;
        // Клипы развёртки игры — 30 кадров в секунду: (кадров − 1) / длительность.
        (((frames - 1) as f32 / self.duration - 30.0).abs() <= 0.5)
            .then_some(())
            .ok_or(Reason::PictureRate)?;
        shifts
            .iter()
            .all(|value| value.is_finite() && value.abs() <= 4.0)
            .then_some(())
            .ok_or(Reason::PictureShifts)?;
        Ok(UvAnimation {
            duration: self.duration,
            shifts: shifts
                .chunks_exact(2)
                .map(|pair| [pair[0], pair[1]])
                .collect(),
        })
    }
}

/// Заказ до донора: всё, что решается без чтения чужих файлов.
struct Brief {
    root: Value,
    name: String,
    /// Словарь клипов: он есть, когда есть движение или живая картинка.
    clips: Option<String>,
    preset: &'static Preset,
    glow: f32,
    /// Модель с движением: донор — сушилка, у модели скелет. Движение забирает проверка, а это признак остаётся.
    moving: bool,
    motion: Option<MotionOrder>,
    picture: Option<PictureOrder>,
}

impl Brief {
    /// Файл заказа: размер смотрится по метаданным, потом разбор и проверки по порядку.
    fn load(path: &Path) -> Result<Self> {
        let length = fs::metadata(path)?.len();
        (1..=MAX_ORDER_BYTES)
            .contains(&length)
            .then_some(())
            .ok_or(Reason::Size)?;
        let root: Value =
            serde_json::from_slice(&fs::read(path)?).map_err(|_| Reason::Unreadable)?;
        let top = Node(Some(&root));
        let known = top.at("format").text() == Some(ORDER_FORMAT)
            && top.at("version").natural() == Some(ORDER_VERSION);
        known.then_some(()).ok_or(Reason::OtherFormat)?;
        // Хост разбирает заказ целиком до любых проверок: разделы не того вида — заказ, который он один и объяснит.
        let motion = section(top, "motion")?.map(MotionOrder::read).transpose()?;
        let picture = section(top, "uvAnimation")?
            .map(PictureOrder::read)
            .transpose()?;
        let shader = match top.at("shader").0 {
            None | Some(Value::Null) => "default",
            Some(Value::String(text)) => text.as_str(),
            Some(_) => return Err(Reason::Unreadable.into()),
        };
        let preset = Preset::named(shader).ok_or_else(|| Reason::OtherShader(shader.to_owned()))?;
        let name = top.at("name").text().unwrap_or_default().to_owned();
        fits_name(&name).then_some(()).ok_or(Reason::BadName)?;
        (name.len() <= NAME_LIMIT - PICTURE_SUFFIX.len())
            .then_some(())
            .ok_or(Reason::LongName)?;
        let clips = if motion.is_some() || picture.is_some() {
            let clips = top
                .at("clipDictionary")
                .text()
                .unwrap_or_default()
                .to_owned();
            fits_name(&clips).then_some(()).ok_or(Reason::BadClipName)?;
            (clips != name).then_some(()).ok_or(Reason::SameClipName)?;
            Some(clips)
        } else {
            None
        };
        let near = top.at("lodDist").real().map(|value| value as f32);
        near.is_some_and(|value| (10.0..=5000.0).contains(&value))
            .then_some(())
            .ok_or(Reason::LodRange)?;
        let glow = top.at("emissive").real().map_or(1.0, |value| value as f32);
        (0.0..=64.0)
            .contains(&glow)
            .then_some(())
            .ok_or(Reason::EmissiveRange)?;
        Ok(Self {
            root,
            name,
            clips,
            preset,
            glow,
            moving: motion.is_some(),
            motion,
            picture,
        })
    }
}

/// Донор и образец раскладки его вершин.
struct Rig {
    donor: Donor,
    layout: u16,
}

impl Rig {
    /// Звезда без движения собирается на плашке (`donor`), с движением — на сушилке (`motionDonor`).
    fn open(order: Node, moving: bool) -> Result<Self> {
        let (field, absent) = if moving {
            ("motionDonor", Reason::NoMotionDonor)
        } else {
            ("donor", Reason::NoDonor)
        };
        let path = order.at(field).text().ok_or(absent)?;
        let bytes = fs::read(path)
            .map_err(|_| EngineError::new("star-donor-missing", "Донор звезды не найден."))?;
        // Хост пишет числа модели в XML (`0.######`): семь значащих цифр.
        let donor = Donor::open(&bytes).map_err(refused)?.with_round(Round::Seven);
        let layout = if moving { DRYER_LAYOUT } else { PLATE_LAYOUT };
        let sheet = donor
            .diffuse_name(layout)
            .map(str::to_owned)
            .ok_or_else(|| {
                EngineError::new(
                    "star-donor-no-texture",
                    "У донора звезды нет диффузной текстуры.",
                )
            })?;
        (!moving || sheet == DRYER_SHEET)
            .then_some(())
            .ok_or(Reason::NotDryer)?;
        Ok(Self { donor, layout })
    }

    /// Модель `.ydr`: сетка упаковывается на раскладку донора, шейдер — по пресету заказа, лист занимает место листа донора
    /// и зовётся `<модель>_star`.
    fn build(
        &self,
        brief: &Brief,
        figure: &Figure,
        picture: &Picture,
        reach: ([f32; 3], [f32; 3]),
    ) -> Result<Vec<u8>> {
        let mesh = Mesh {
            shader: self.layout,
            vertices: figure.vertices.clone(),
            indices: figure.indices.clone(),
        };
        // Цвет вершин у писателя летающих моделей тот же, что у хоста для звезды: `255 255 0 255`. Фигура висит на
        // кости барабана, подставка — на корне; у модели без движения скелета нет и веса не пишутся.
        let skin = figure
            .parts
            .iter()
            .map(|&part| Skin {
                bones: [
                    0,
                    0,
                    if brief.moving && part == 1 {
                        DRUM_BONE
                    } else {
                        0
                    },
                    0,
                ],
                weights: [0, 0, FULL_WEIGHT, 0],
            })
            .collect();
        let packed = self
            .donor
            .pack_flyer(
                &[(0, SkinnedMesh { mesh, skin })],
                self.layout,
                reach,
                brief.preset.mask(),
                Some(DRAW_DISTANCE),
            )
            .map_err(refused)?;
        let sheet = NewTexture {
            name: format!("{}{PICTURE_SUFFIX}", brief.name),
            width: picture.width,
            height: picture.height,
            format: Format::Dxt5,
            levels: picture.levels,
            payload: picture.payload.clone(),
        };
        self.donor
            .apply_flyer_sheets(
                &packed,
                &[(brief.preset.spec(brief.glow), 0)],
                self.layout,
                std::slice::from_ref(&sheet),
                &brief.name,
            )
            .map_err(refused)
    }
}

/// Пять массивов сетки, как они пришли в заказе.
struct Raw {
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    parts: Vec<i64>,
    indices: Vec<i64>,
}

fn reals(mesh: &Map<String, Value>, key: &str) -> Result<Vec<f32>> {
    let items = mesh
        .get(key)
        .and_then(Value::as_array)
        .ok_or(Reason::MeshIncomplete)?;
    items
        .iter()
        .map(|item| {
            item.as_f64()
                .map(|value| value as f32)
                .ok_or_else(|| Reason::MeshNotNumber.into())
        })
        .collect()
}

fn wholes(mesh: &Map<String, Value>, key: &str) -> Result<Vec<i64>> {
    let items = mesh
        .get(key)
        .and_then(Value::as_array)
        .ok_or(Reason::MeshIncomplete)?;
    items
        .iter()
        .map(|item| item.as_i64().ok_or_else(|| Reason::MeshNotInteger.into()))
        .collect()
}

impl Raw {
    fn read(mesh: &Map<String, Value>) -> Result<Self> {
        Ok(Self {
            positions: reals(mesh, "positions")?,
            normals: reals(mesh, "normals")?,
            uvs: reals(mesh, "uvs")?,
            parts: wholes(mesh, "parts")?,
            indices: wholes(mesh, "indices")?,
        })
    }

    /// Первое нарушение правил сетки в порядке проверок.
    fn defect(&self) -> Option<Reason> {
        let count = self.positions.len() / 3;
        let indices = self.indices.len();
        let mismatched = !VERTEX_RANGE.contains(&count)
            || self.positions.len() != 3 * count
            || self.normals.len() != 3 * count
            || self.uvs.len() != 2 * count
            || self.parts.len() != count;
        mismatched
            .then_some(Reason::MeshVertices)
            .or_else(|| {
                (indices == 0 || indices > MAX_INDICES || indices % 3 != 0)
                    .then_some(Reason::MeshTriangles)
            })
            .or_else(|| {
                let far = self
                    .positions
                    .iter()
                    .any(|value| !value.is_finite() || value.abs() > REACH);
                far.then_some(Reason::MeshReach)
            })
            .or_else(|| {
                let wild = self.normals.iter().any(|value| !value.is_finite())
                    || self.uvs.iter().any(|value| !UV_RANGE.contains(value));
                wild.then_some(Reason::MeshRange)
            })
            .or_else(|| {
                self.parts
                    .iter()
                    .any(|part| !(0..=1).contains(part))
                    .then_some(Reason::MeshParts)
            })
            .or_else(|| {
                let lost = self
                    .indices
                    .iter()
                    .any(|&index| usize::try_from(index).map_or(true, |at| at >= count));
                lost.then_some(Reason::MeshIndex)
            })
    }
}

/// Сетка заказа после проверок: вершины уже сдвинуты на ось фигуры.
struct Figure {
    vertices: Vec<[f32; 8]>,
    indices: Vec<u16>,
    /// Часть каждой вершины: 0 — подставка, 1 — фигура.
    parts: Vec<u8>,
    low: [f32; 3],
    high: [f32; 3],
}

impl Figure {
    fn from_mesh(mesh: Option<&Value>) -> Result<Self> {
        let fields = Node(mesh).fields().ok_or(Reason::MeshIncomplete)?;
        let raw = Raw::read(fields)?;
        if let Some(reason) = raw.defect() {
            return Err(reason.into());
        }
        let vertices: Vec<[f32; 8]> = raw
            .positions
            .chunks_exact(3)
            .zip(raw.normals.chunks_exact(3))
            .zip(raw.uvs.chunks_exact(2))
            .map(|((place, normal), tex)| {
                let [x, y, z] = [0, 1, 2].map(|axis| place[axis] + PIVOT[axis]);
                [x, y, z, normal[0], normal[1], normal[2], tex[0], tex[1]]
            })
            .collect();
        let first = [vertices[0][0], vertices[0][1], vertices[0][2]];
        let (low, high) = vertices.iter().fold((first, first), |(low, high), vertex| {
            (
                [0, 1, 2].map(|axis| low[axis].min(vertex[axis])),
                [0, 1, 2].map(|axis| high[axis].max(vertex[axis])),
            )
        });
        let indices = raw.indices.iter().map(|&index| index as u16).collect();
        let parts = raw.parts.iter().map(|&part| part as u8).collect();
        Ok(Self {
            vertices,
            indices,
            parts,
            low,
            high,
        })
    }

    fn triangles(&self) -> usize {
        self.indices.len() / 3
    }

    /// Рамка модели с движением (как у хоста): фигура поднимается на наибольший подъём, а с поворотом обходит круг вокруг
    /// оси — модель не выходит из рамки при любом положении. Без движения — рамка вершин.
    fn reach(&self, motion: Option<&Motion>) -> ([f32; 3], [f32; 3]) {
        let spins =
            motion.is_some_and(|motion| motion.angle.iter().any(|value| value.abs() > 1e-4));
        let lift = motion.map_or(0.0, |motion| {
            motion.lift.iter().copied().fold(f32::MIN, f32::max)
        });
        let (mut low, mut high, mut radius) = (self.low, self.high, 0.0f32);
        for (vertex, &part) in self.vertices.iter().zip(&self.parts) {
            if part != 1 {
                continue;
            }
            let (dx, dy) = (vertex[0] - PIVOT[0], vertex[1] - PIVOT[1]);
            radius = radius.max(f64::from(dx * dx + dy * dy).sqrt() as f32);
            high[2] = high[2].max(vertex[2] + lift);
        }
        if spins {
            low = [
                low[0].min(PIVOT[0] - radius),
                low[1].min(PIVOT[1] - radius),
                low[2],
            ];
            high = [
                high[0].max(PIVOT[0] + radius),
                high[1].max(PIVOT[1] + radius),
                high[2],
            ];
        }
        (low, high)
    }
}

/// Картинка заказа: DDS в формате DXT5 с полной цепочкой ступеней.
struct Picture {
    width: u16,
    height: u16,
    levels: u8,
    payload: Vec<u8>,
    file_sum: String,
}

impl Picture {
    fn load(root: &Value) -> Result<Self> {
        let order = Node(Some(root));
        let side = |key: &str| {
            order
                .at(key)
                .natural()
                .filter(|side| SIDE_RANGE.contains(side) && side.is_power_of_two())
                .map(|side| side as u32)
        };
        let (width, height) = side("width").zip(side("height")).ok_or(Reason::SideRange)?;
        let path = order.at("texture").text().ok_or(Reason::NoPicture)?;
        let bytes = fs::read(path).map_err(|_| Reason::PictureMissing)?;
        (MIN_PICTURE_BYTES..=MAX_PICTURE_BYTES)
            .contains(&bytes.len())
            .then_some(())
            .ok_or(Reason::PictureUnsafe)?;
        let file_sum = sha256_hex(&bytes);
        let promised = order.at("textureSha256").text();
        (promised == Some(format!("sha256:{file_sum}").as_str()))
            .then_some(())
            .ok_or(Reason::PictureSum)?;
        let image = dds::parse(&bytes).map_err(|_| Reason::PictureNotDds)?;
        let full_chain = 32 - width.max(height).leading_zeros();
        let shaped = (
            image.width,
            image.height,
            u32::from(image.levels),
            image.format,
        ) == (width, height, full_chain, Format::Dxt5);
        shaped
            .then_some(())
            .ok_or(Reason::PictureShape(width, height))?;
        Ok(Self {
            width: width as u16,
            height: height as u16,
            levels: image.levels,
            payload: image.payload,
            file_sum,
        })
    }
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn point(values: [f32; 3]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|&value| Value::from(f64::from(value)))
            .collect(),
    )
}

/// Карточка файла в ответе: имя, длина, SHA-256 и то, что сверено при чтении выхода.
fn card(file: &str, bytes: &[u8], semantic: Value) -> Value {
    object([
        ("file", file.into()),
        ("bytes", bytes.len().into()),
        ("sha256", sha256_hex(bytes).into()),
        ("semantic", semantic),
    ])
}

fn describe(
    file: &str,
    bytes: &[u8],
    figure: &Figure,
    picture: &Picture,
    skeleton: usize,
) -> Value {
    let texture = object([
        ("width", picture.width.into()),
        ("height", picture.height.into()),
        ("mipLevels", picture.levels.into()),
        ("sha256", picture.file_sum.clone().into()),
    ]);
    let semantic = object([
        ("semanticReopen", true.into()),
        ("vertices", figure.vertices.len().into()),
        ("triangles", figure.triangles().into()),
        ("skeleton", skeleton.into()),
        ("texture", texture),
    ]);
    card(file, bytes, semantic)
}

/// Шесть знаков после точки: так хост пишет в XML длительность клипа, и так её читает игра.
fn seconds(duration: f32) -> Value {
    Value::from(f64::from(star_clip::round6(duration)))
}

/// Карточка клипа: с движением без живой картинки — кадры и длительность, иначе ещё и клип развёртки (хост так и отвечает).
fn describe_clips(
    file: &str,
    bytes: &[u8],
    name: &str,
    motion: Option<&Motion>,
    picture: Option<&UvAnimation>,
) -> Value {
    let (frames, duration) = motion.map_or((0, 0.0), |motion| (motion.lift.len(), motion.duration));
    let moving = [
        ("semanticReopen", true.into()),
        ("frames", frames.into()),
        ("duration", seconds(duration)),
    ];
    let semantic = match picture {
        None => object(moving),
        Some(picture) => {
            let uv = object([
                ("clip", format!("{name}_uv_0").into()),
                ("key", format!("{:08X}", joaat(name).wrapping_add(1)).into()),
                ("frames", picture.shifts.len().into()),
                ("duration", seconds(picture.duration)),
            ]);
            let [opened, frames, duration] = moving;
            object([opened, frames, duration, ("uv", uv)])
        }
    };
    card(file, bytes, semantic)
}

pub fn compile_star_model(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = options
        .required("input")
        .and_then(|name| paths::existing_file(name, &[".json"]))?;
    let mut brief = Brief::load(&input)?;
    let rig = Rig::open(Node(Some(&brief.root)), brief.moving)?;
    let folder = options.required("output").and_then(paths::full_path)?;
    let busy = folder.exists() && (!folder.is_dir() || fs::read_dir(&folder)?.next().is_some());
    (!busy).then_some(()).ok_or(Reason::OutputBusy)?;
    let figure = Figure::from_mesh(brief.root.get("mesh"))?;
    let motion = brief.motion.take().map(MotionOrder::checked).transpose()?;
    let live = brief
        .picture
        .take()
        .map(PictureOrder::checked)
        .transpose()?;
    let picture = Picture::load(&brief.root)?;
    let reach = figure.reach(motion.as_ref());
    let model = rig.build(&brief, &figure, &picture, reach)?;
    let clips = brief
        .clips
        .as_deref()
        .map(|dictionary| {
            star_clip::build_dictionary(&brief.name, motion.as_ref(), live.as_ref())
                .map(|bytes| (dictionary, bytes))
        })
        .transpose()?;

    fs::create_dir_all(&folder)?;
    let file = format!("{}.ydr", brief.name);
    write_atomic(&folder.join(&file), &model)?;
    let skeleton = if motion.is_some() {
        star_clip::BONES.len()
    } else {
        0
    };
    let mut files = vec![describe(&file, &model, &figure, &picture, skeleton)];
    if let Some((dictionary, bytes)) = &clips {
        let clip_file = format!("{dictionary}.ycd");
        write_atomic(&folder.join(&clip_file), bytes)?;
        files.push(describe_clips(
            &clip_file,
            bytes,
            &brief.name,
            motion.as_ref(),
            live.as_ref(),
        ));
    }
    Ok(answer(
        &brief.name,
        reach,
        motion.is_some(),
        live.as_ref(),
        files,
    ))
}

/// Ответ команды: ось и рамка сущности (их читает установщик), признаки движения и живой картинки, карточки файлов.
fn answer(
    name: &str,
    reach: ([f32; 3], [f32; 3]),
    animated: bool,
    live: Option<&UvAnimation>,
    files: Vec<Value>,
) -> Value {
    let (low, high) = reach;
    object([
        ("format", "astral.star-model".into()),
        ("version", ORDER_VERSION.into()),
        ("pivot", point(PIVOT)),
        (
            "bounds",
            object([("min", point(low)), ("max", point(high))]),
        ),
        ("animated", animated.into()),
        (
            "uvClip",
            live.map_or(Value::Null, |_| format!("{name}_uv_0").into()),
        ),
        ("uvFrames", live.map_or(0, |live| live.shifts.len()).into()),
        ("files", Value::Array(files)),
    ])
}

const COMPILE_MODEL: Command = Command::new("compile-star-model", compile_star_model);

pub const COMMANDS: &[Command] = &[COMPILE_MODEL];

#[cfg(test)]
mod tests;
