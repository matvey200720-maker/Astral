//! `compile-mega-mall-overlay`: пять плоских поверхностей с вывесками и
//! фасадами поверх здания Davis Mega Mall. Запрос несёт пути к готовым DDS и
//! хеши; донор — настоящая рисовалка игры. Команда проверяет запрос и текстуры
//! и пишет в пустую папку четыре файла: `.ydr`, `.ytd`, `.ytyp`, `.ymap`.
//! Игровые архивы не меняются.

use std::fmt;
use std::path::{Path, PathBuf};

use rage_res::{
    donor::{Donor, OverlayFace, Refusal, Round},
    drawable_write::float_value,
    hash::{joaat, sha256_hex},
    placements::{self, ArchetypeFields, ArchetypeSpec, EntitySpec},
    texture::Format,
    ytd_write::{self, NewTexture},
};
use serde_json::{Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const LOD_DISTANCE: f32 = 650.0;
/// Начало данных текстуры в файле DDS.
const DDS_HEADER: usize = 128;
/// Слово использования листов, как его пишет хост (`UsageFlags` его XML словаря): вид `DIFFUSE` (20) и флаги
/// `NOT_HALF, HD_SPLIT, X32, X64, X128, X512, UNK24`.
const SHEET_USAGE: u32 = 20 | (1 | 1 << 1 | 1 << 7 | 1 << 8 | 1 << 10 | 1 << 12 | 1 << 24) << 5;
/// Запрос не короче байта и не длиннее 256 КиБ; DDS не длиннее 8 МиБ.
const REQUEST_LIMIT: u64 = 256 * 1024;
const DDS_LIMIT: u64 = 8 * 1024 * 1024;

/// Чем может кончиться проверка запроса и вывода; код у каждого свой.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Refused {
    Size,
    Broken,
    Profile,
    /// Профиль того же семейства (`<здание>.overlay.legacy-<сборка>.vN`), но не наш: раскладку здания знает хост.
    OtherProfile,
    DesignHash,
    SurfaceCount,
    NoDonor,
    UnexpectedSurface,
    Passport(String),
    DdsMissing(String),
    DdsUnsafe(String),
    DdsHeader(String),
    DdsHash(String),
    DonorMissing,
    YtdReopen,
    NotDirectory,
    NotEmpty,
}

impl fmt::Display for Refused {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Refused::Size => {
                out.write_str("Mega Mall compile request must be between 1 byte and 256 KiB.")
            }
            Refused::Broken => out.write_str("Mega Mall compile request is empty or broken."),
            Refused::Profile => {
                out.write_str("Mega Mall compile request does not match the pinned Legacy profile.")
            }
            Refused::OtherProfile => out.write_str("Другой профиль Мегамолла: пока на хосте."),
            Refused::DesignHash => out.write_str("Mega Mall designHash is invalid."),
            Refused::SurfaceCount => {
                out.write_str("Mega Mall compile request must contain exactly five surfaces.")
            }
            Refused::NoDonor => out.write_str("Мегамолл без донора: пока на хосте."),
            Refused::UnexpectedSurface => {
                out.write_str("Mega Mall compile request has an unexpected surface set.")
            }
            Refused::Passport(id) => {
                write!(out, "Surface {id} does not match its pinned DDS target.")
            }
            Refused::DdsMissing(id) => write!(out, "DDS for {id} was not found."),
            Refused::DdsUnsafe(id) => write!(out, "DDS for {id} has an unsafe file type or size."),
            Refused::DdsHeader(id) => {
                write!(out, "DDS header for {id} is not 2048x512 BC3 with 12 mips.")
            }
            Refused::DdsHash(id) => write!(out, "DDS SHA-256 mismatch for {id}."),
            Refused::DonorMissing => out.write_str("Донор Мегамолла не найден."),
            Refused::YtdReopen => out.write_str("Compiled overlay YTD failed semantic reopen."),
            Refused::NotDirectory => out.write_str("Mega Mall output must be a directory."),
            Refused::NotEmpty => out.write_str("Mega Mall output directory must be empty."),
        }
    }
}

impl From<Refused> for EngineError {
    fn from(why: Refused) -> Self {
        let text = why.to_string();
        match why {
            Refused::NoDonor | Refused::OtherProfile => EngineError::argument(text),
            Refused::DdsMissing(_) => EngineError::file_not_found(text),
            Refused::DonorMissing => EngineError::new("mega-mall-donor-missing", text),
            _ => EngineError::invalid_data(text),
        }
    }
}

/// Плоскость поверхности.
enum Shape {
    /// Поставлена под углом: нормаль `(a, b)`, расстояние от начала, отрезок вдоль касательной и высота.
    Slanted {
        normal: [f32; 2],
        offset: f32,
        along: [f32; 2],
        height: [f32; 2],
    },
    /// Перпендикулярна оси X.
    FacingX {
        x: f32,
        y: [f32; 2],
        height: [f32; 2],
    },
}

struct Surface {
    id: &'static str,
    texture: &'static str,
    glowing: bool,
    shape: Shape,
}

/// Высота у всех четырёх фасадов одна.
const FACADE_HEIGHT: [f32; 2] = [-7.20, 10.90];

impl Surface {
    /// Несветящийся фасад под углом с высотой `FACADE_HEIGHT`.
    const fn facade(
        id: &'static str,
        texture: &'static str,
        normal: [f32; 2],
        offset: f32,
        along: [f32; 2],
    ) -> Surface {
        Surface::slanted(id, texture, false, normal, offset, along, FACADE_HEIGHT)
    }

    /// Поверхность под углом: светится или нет, нормаль, расстояние от начала, отрезок вдоль касательной и высоты краёв.
    const fn slanted(
        id: &'static str,
        texture: &'static str,
        glowing: bool,
        normal: [f32; 2],
        offset: f32,
        along: [f32; 2],
        height: [f32; 2],
    ) -> Surface {
        Surface {
            id,
            texture,
            glowing,
            shape: Shape::Slanted {
                normal,
                offset,
                along,
                height,
            },
        }
    }

    /// Грань для донора: имя текстуры, свечение и вершины.
    fn face(&self) -> OverlayFace {
        OverlayFace {
            texture: self.texture.to_owned(),
            emissive: self.glowing,
            vertices: self.shape.corners(),
        }
    }

    /// Лист словаря текстур с данными поверхности.
    fn sheet(&self, payload: Vec<u8>) -> NewTexture {
        NewTexture {
            name: self.texture.to_owned(),
            width: 2048,
            height: 512,
            format: Format::Dxt5,
            levels: 12,
            payload,
        }
    }

    /// Паспорт поверхности в запросе: имя текстуры, формат, размеры и число уровней.
    fn passport_matches(&self, entry: &Map<String, Value>) -> bool {
        let text = |key: &str| entry.get(key).and_then(Value::as_str);
        let number = |key: &str| entry.get(key).and_then(Value::as_u64);
        text("textureName") == Some(self.texture)
            && text("format") == Some("BC3")
            && [("width", 2048), ("height", 512), ("mipLevels", 12)]
                .into_iter()
                .all(|(key, want)| number(key) == Some(want))
    }

    /// Данные текстуры поверхности — хвост её DDS после заголовка — после проверок паспорта, файла, заголовка и хеша.
    fn payload(&self, entry: &Map<String, Value>) -> Result<Vec<u8>> {
        let id = || self.id.to_owned();
        if !self.passport_matches(entry) {
            return Err(Refused::Passport(id()).into());
        }
        let file = dds_file(entry).ok_or_else(|| Refused::DdsMissing(id()))?;
        let length = std::fs::metadata(&file).map_or(0, |meta| meta.len());
        if !(DDS_HEADER as u64..=DDS_LIMIT).contains(&length) {
            return Err(Refused::DdsUnsafe(id()).into());
        }
        let bytes = std::fs::read(&file)?;
        if !dds_header_fits(&bytes) {
            return Err(Refused::DdsHeader(id()).into());
        }
        let claimed = entry
            .get("ddsSha256")
            .and_then(Value::as_str)
            .and_then(|text| text.strip_prefix("sha256:"));
        if claimed != Some(sha256_hex(&bytes).as_str()) {
            return Err(Refused::DdsHash(id()).into());
        }
        Ok(bytes[DDS_HEADER..].to_vec())
    }
}

/// Поверхности профиля в порядке обработки.
const SURFACES: [Surface; 5] = [
    Surface::facade(
        "facade-front",
        "astral_mall_front",
        [0.766054, -0.642776],
        -5.94,
        [-34.8402, 39.8485],
    ),
    Surface::facade(
        "facade-right",
        "astral_mall_right",
        [0.642406, 0.766365],
        39.81,
        [-60.3114, 33.3705],
    ),
    Surface::facade(
        "facade-rear",
        "astral_mall_rear",
        [-0.766052, 0.642778],
        33.56,
        [-39.8285, 34.8609],
    ),
    Surface::facade(
        "facade-left",
        "astral_mall_left",
        [-0.642800, -0.766034],
        35.06,
        [-32.9253, 48.5752],
    ),
    Surface {
        id: "sign-main",
        texture: "astral_mall_sign",
        glowing: true,
        shape: Shape::FacingX {
            x: 77.94,
            y: [-12.0, 7.0],
            height: [-5.8, 1.1],
        },
    },
];

/// Здание: имя профиля в запросе, имя ресурса, точка в мире и пять поверхностей в порядке обработки.
struct Profile {
    id: &'static str,
    asset: &'static str,
    position: [f32; 3],
    surfaces: [Surface; 5],
}

/// Davis Mega Mall: четыре фасада и вывеска, перпендикулярная оси X.
const DAVIS: Profile = Profile {
    id: "davis-mega-mall.overlay.legacy-24129523.v2",
    asset: "astral_davis_megamall_overlay",
    position: [70.89937, -1773.2747, 35.434685],
    surfaces: SURFACES,
};

/// You Tool / Ashan (Сэнди-Шорс): плоскости по кластерам внешних треугольников `cs4_02_nmall00`; закрыты только верхние
/// полосы фасада, вход, двери и коллизия остаются штатными. Вывеска — тоже под углом.
const YOU_TOOL: Profile = Profile {
    id: "you-tool-ashan.overlay.legacy-24129523.v1",
    asset: "astral_you_tool_overlay",
    position: [2706.7502, 3480.1733, 62.7826],
    surfaces: [
        Surface::slanted("facade-front", "astral_youtool_front", false, [0.385351, 0.922770], 46.56, [-39.43, 44.18], [3.40, 9.72]),
        Surface::slanted("facade-right", "astral_youtool_right", false, [0.922679, -0.385569], 44.06, [-28.48, 46.25], [3.40, 9.72]),
        Surface::slanted("facade-rear", "astral_youtool_rear", false, [-0.385320, -0.922783], 28.56, [-43.94, 33.18], [3.40, 9.72]),
        Surface::slanted("facade-left", "astral_youtool_left", false, [-0.922623, 0.385703], -14.81, [-46.53, 28.62], [3.40, 9.72]),
        Surface::slanted("sign-main", "astral_youtool_sign", true, [-0.922623, 0.385703], -42.31, [-26.19, 8.41], [5.72, 11.48]),
    ],
};

/// Профили, которые движок знает.
const PROFILES: [&Profile; 2] = [&DAVIS, &YOU_TOOL];

/// Угол единичного квадрата текстуры при обходе: (0, 1), (1, 1), (1, 0), (0, 0).
fn square_corner(at: usize) -> [f32; 2] {
    [(at.div_ceil(2) % 2) as f32, (1 - at / 2) as f32]
}

impl Shape {
    /// Концы нижнего края на плане, нормаль плоскости и высоты нижнего и верхнего краёв.
    fn plan(&self) -> ([[f32; 2]; 2], [f32; 3], [f32; 2]) {
        match *self {
            Shape::Slanted {
                normal,
                offset,
                along,
                height,
            } => {
                let inverse = 1.0 / (normal[0] * normal[0] + normal[1] * normal[1]).sqrt();
                let unit = normal.map(|part| part * inverse);
                let tangent = [-unit[1], unit[0]];
                let foot = unit.map(|part| part * offset);
                let spot = |reach: f32| [0, 1].map(|axis| foot[axis] + tangent[axis] * reach);
                (
                    [spot(along[0]), spot(along[1])],
                    [unit[0], unit[1], 0.0],
                    height,
                )
            }
            Shape::FacingX { x, y, height } => ([[x, y[0]], [x, y[1]]], [1.0, 0.0, 0.0], height),
        }
    }

    /// Четыре вершины `x, y, z, nx, ny, nz, u, v` в порядке обхода: нижний край, затем верхний от конца к началу.
    fn corners(&self) -> [[f32; 8]; 4] {
        let ([start, end], normal, [bottom, top]) = self.plan();
        let ring = [(start, bottom), (end, bottom), (end, top), (start, top)];
        std::array::from_fn(|at| {
            let ([x, y], z) = ring[at];
            let [u, v] = square_corner(at);
            [x, y, z, normal[0], normal[1], normal[2], u, v]
        })
    }
}

/// `designHash`: `sha256:` и ровно 64 строчные шестнадцатеричные цифры.
fn is_design_hash(text: &str) -> bool {
    let Some(("sha256", digits)) = text.split_once(':') else {
        return false;
    };
    digits.len() == 64
        && digits
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// Разобранный запрос.
struct Order {
    profile: &'static Profile,
    design_hash: String,
    surfaces: Vec<Value>,
    donor: Option<String>,
}

impl Order {
    fn read(bytes: &[u8]) -> std::result::Result<Self, Refused> {
        let parsed = serde_json::from_slice::<Value>(bytes).or(Err(Refused::Broken))?;
        let Value::Object(mut root) = parsed else {
            return Err(Refused::Profile);
        };
        let text_of = |key: &str| root.get(key).and_then(Value::as_str).map(str::to_owned);
        let pins = [
            ("format", "astral.compile-mega-mall-overlay"),
            ("targetId", "gta5-legacy-story"),
            ("buildId", "24129523"),
        ];
        let others_hold = pins
            .into_iter()
            .all(|(key, want)| text_of(key).as_deref() == Some(want))
            && root.get("version").and_then(Value::as_u64) == Some(1);
        let known = text_of("profileId").and_then(|id| PROFILES.into_iter().find(|profile| profile.id == id));
        let Some(profile) = known.filter(|_| others_hold) else {
            // Другое здание или другая версия профиля того же семейства: движок его не знает, и приложению нужно вернуть
            // такой заказ хосту словами «пока на хосте», а не ломать сборку.
            let family = text_of("profileId").is_some_and(|id| id.contains(".overlay.legacy-"));
            return Err(if others_hold && family { Refused::OtherProfile } else { Refused::Profile });
        };
        let design_hash = text_of("designHash")
            .filter(|text| is_design_hash(text))
            .ok_or(Refused::DesignHash)?;
        let donor = text_of("donor");
        match root.remove("surfaces") {
            Some(Value::Array(surfaces)) if surfaces.len() == profile.surfaces.len() => Ok(Order {
                profile,
                design_hash,
                surfaces,
                donor,
            }),
            _ => Err(Refused::SurfaceCount),
        }
    }

    /// Запрос из командной строки: файл `--input`, его размер и разбор.
    fn open(options: &Options) -> Result<Self> {
        let input = paths::existing_file(options.required("input")?, &[".json"])?;
        let length = std::fs::metadata(&input)?.len();
        if !(1..=REQUEST_LIMIT).contains(&length) {
            return Err(Refused::Size.into());
        }
        Ok(Order::read(&std::fs::read(&input)?)?)
    }

    /// Описание поверхности из запроса: первое с таким `surfaceId`.
    fn entry_for(&self, id: &str) -> std::result::Result<&Map<String, Value>, Refused> {
        self.surfaces
            .iter()
            .find_map(|item| {
                item.as_object()
                    .filter(|entry| entry.get("surfaceId").and_then(Value::as_str) == Some(id))
            })
            .ok_or(Refused::UnexpectedSurface)
    }

    /// Все пять файлов; донор читается только после проверки всех DDS.
    fn compile(&self) -> Result<Bundle> {
        let donor_path = self.donor.as_deref().ok_or(Refused::NoDonor)?;
        let payloads = self
            .profile
            .surfaces
            .iter()
            .map(|surface| surface.payload(self.entry_for(surface.id)?))
            .collect::<Result<Vec<_>>>()?;
        let faces = self.profile.surfaces.each_ref().map(Surface::face);
        let drawable = overlay_drawable(donor_path, self.profile, &faces)?;
        let (types, map) = types_and_map(self.profile, &self.design_hash, &faces)?;
        let dictionary = texture_dictionary(self.profile, payloads)?;
        Ok(Bundle {
            profile: self.profile,
            drawable,
            dictionary,
            types,
            map,
        })
    }
}

/// Файл DDS из `ddsPath` запроса: должен быть настоящим файлом.
fn dds_file(entry: &Map<String, Value>) -> Option<PathBuf> {
    let path = paths::full_path(entry.get("ddsPath")?.as_str()?).ok()?;
    path.is_file().then_some(path)
}

/// Слово заголовка DDS по смещению.
fn dds_word(bytes: &[u8], at: usize) -> Option<u32> {
    let raw: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(raw))
}

/// Заголовок DDS: метка, высота, ширина, число уровней и `DXT5` — остальное не смотрится.
fn dds_header_fits(bytes: &[u8]) -> bool {
    let words = [(12, 512), (16, 2048), (28, 12)];
    bytes.starts_with(b"DDS ")
        && words
            .into_iter()
            .all(|(at, want)| dds_word(bytes, at) == Some(want))
        && bytes.get(84..88) == Some(b"DXT5".as_slice())
}

/// Рамка всех вершин, расширенная на 0.1 в каждую сторону.
fn archetype_box(faces: &[OverlayFace]) -> ([f32; 3], [f32; 3]) {
    let vertices: Vec<&[f32; 8]> = faces.iter().flat_map(|face| &face.vertices).collect();
    let extreme = |axis: usize, pick: fn(f32, f32) -> f32, seed: f32| {
        vertices
            .iter()
            .fold(seed, |best, vertex| pick(best, vertex[axis]))
    };
    (
        [0, 1, 2].map(|axis| extreme(axis, f32::min, f32::INFINITY) - 0.1),
        [0, 1, 2].map(|axis| extreme(axis, f32::max, f32::NEG_INFINITY) + 0.1),
    )
}

/// Рисовалка поверх донора; донор читается только теперь, после проверки всех DDS.
fn overlay_drawable(donor_path: &str, profile: &Profile, faces: &[OverlayFace]) -> Result<Vec<u8>> {
    let bytes = std::fs::read(donor_path).or(Err(Refused::DonorMissing))?;
    let as_engine = |refusal: Refusal| EngineError::new(refusal.code(), refusal.to_string());
    // Хост пишет числа модели в XML (`0.######`): семь значащих цифр.
    Donor::open(&bytes)
        .map_err(as_engine)?
        .with_round(Round::Seven)
        .apply_overlay_named(faces, LOD_DISTANCE, profile.asset)
        .map_err(as_engine)
}

/// Типы и карта: один архетип и одна сущность в точке здания.
fn types_and_map(profile: &Profile, design_hash: &str, faces: &[OverlayFace]) -> Result<(Vec<u8>, Vec<u8>)> {
    let (bb_min, bb_max) = archetype_box(faces);
    let archetype = ArchetypeSpec {
        name: profile.asset.to_owned(),
        lod_dist: LOD_DISTANCE,
        bb_min,
        bb_max,
        flags: 0,
        clip_dictionary: None,
    };
    let fields = ArchetypeFields {
        special_attribute: 0,
        hd_texture_dist: 220.0,
        texture_dictionary: Some(joaat(profile.asset)),
        time_flags: None,
    };
    let entity = EntitySpec {
        archetype: 0,
        position: profile.position,
        // Хост задаёт поворот `SetOrientation(Quaternion.Identity)` и получает сопряжённый: три нуля со знаком минус.
        rotation: [-0.0, -0.0, -0.0, 1.0],
        lod_dist: LOD_DISTANCE,
        flags: 1_572_864,
        guid: Some(joaat(&format!("{design_hash}:overlay"))),
    };
    let map_name = format!("{}_map", profile.asset);
    let built = placements::compile_copied(
        profile.asset,
        &map_name,
        &[archetype],
        &[fields],
        &[entity],
        "Astral Mega Mall Overlay Compiler 1",
        "01 January 1970 00:00",
    )?;
    Ok((built.types, built.map))
}

/// Словарь текстур из пяти листов профиля; перечитывание обязано найти пять записей.
fn texture_dictionary(profile: &Profile, payloads: Vec<Vec<u8>>) -> Result<Vec<u8>> {
    let sample = ytd_write::host_sample(SHEET_USAGE);
    let sheets: Vec<(NewTexture, Option<[u8; ytd_write::TEXTURE_BYTES]>)> = profile
        .surfaces
        .iter()
        .zip(payloads)
        .map(|(surface, payload)| (surface.sheet(payload), Some(sample)))
        .collect();
    let bytes = ytd_write::write_host(&sheets)?;
    let reread = ytd_write::read_entries(&bytes)?.len();
    (reread == profile.surfaces.len())
        .then_some(bytes)
        .ok_or_else(|| Refused::YtdReopen.into())
}

/// Четыре готовых файла.
struct Bundle {
    profile: &'static Profile,
    drawable: Vec<u8>,
    dictionary: Vec<u8>,
    types: Vec<u8>,
    map: Vec<u8>,
}

impl Bundle {
    /// (расширение, байты, что внутри: поле и число) в порядке записи.
    fn parts(&self) -> [(&'static str, &[u8], (&'static str, usize)); 4] {
        [
            ("ydr", &self.drawable, ("geometryCount", 10)),
            ("ytd", &self.dictionary, ("textureCount", self.profile.surfaces.len())),
            ("ytyp", &self.types, ("archetypeCount", 1)),
            ("ymap", &self.map, ("entityCount", 1)),
        ]
    }
}

/// Пустая выходная папка с записью файлов по очереди через временное имя.
struct Folder(PathBuf);

impl Folder {
    fn prepare(path: &Path) -> Result<Self> {
        if path.is_file() {
            return Err(Refused::NotDirectory.into());
        }
        std::fs::create_dir_all(path)?;
        std::fs::read_dir(path)?.next().map_or_else(
            || Ok(Folder(path.to_path_buf())),
            |_| Err(Refused::NotEmpty.into()),
        )
    }

    /// Записывает файл и возвращает его строку для ответа.
    fn store(&self, asset: &str, extension: &str, bytes: &[u8], inside: (&str, usize)) -> Result<Value> {
        let name = format!("{asset}.{extension}");
        write_atomic(&self.0.join(&name), bytes)?;
        let (field, count) = inside;
        Ok(object([
            ("file", name.into()),
            ("bytes", bytes.len().into()),
            ("sha256", sha256_hex(bytes).into()),
            (
                "semantic",
                object([("semanticReopen", true.into()), (field, count.into())]),
            ),
        ]))
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

/// Ответ команды: профиль, положение, сведения о наложении и строки файлов.
fn artifacts_report(profile: &Profile, design_hash: String, artifacts: Vec<Value>) -> Value {
    let world = object([
        ("x", float_value(profile.position[0])),
        ("y", float_value(profile.position[1])),
        ("z", float_value(profile.position[2])),
    ]);
    let overlay = object([
        ("independentSurfaceCount", profile.surfaces.len().into()),
        ("trianglesPerLod", 10.into()),
        ("triangleCountAcrossHighAndLow", 20.into()),
        ("lodStrategy", "unified-ultra-low-poly".into()),
        ("lodDistance", float_value(LOD_DISTANCE)),
        ("vanillaArchivesModified", false.into()),
    ]);
    object([
        ("format", "astral.mega-mall-overlay-artifacts".into()),
        ("version", 1.into()),
        ("profileId", profile.id.into()),
        ("designHash", design_hash.into()),
        ("assetName", profile.asset.into()),
        ("worldPosition", world),
        ("overlay", overlay),
        ("artifacts", Value::Array(artifacts)),
    ])
}

fn compile_mega_mall(options: &Options, _progress: &Progress) -> Result<Value> {
    let order = Order::open(options)?;
    let output = paths::full_path(options.required("output")?)?;
    let bundle = order.compile()?;
    let folder = Folder::prepare(&output)?;
    let artifacts = bundle
        .parts()
        .into_iter()
        .map(|(extension, bytes, inside)| folder.store(bundle.profile.asset, extension, bytes, inside))
        .collect::<Result<Vec<_>>>()?;
    Ok(artifacts_report(order.profile, order.design_hash, artifacts))
}

pub const COMMANDS: &[Command] = &[Command::new("compile-mega-mall-overlay", compile_mega_mall)];

#[cfg(test)]
mod tests;
