//! `compile-sky-flyer`: летающий дирижабль мастерской неба - модель `.ydr` и клип `.ycd`.
//!
//! Сетки запроса ложатся в раскладку вершин сушилки со скиннингом (барабан - кость 2,
//! гнущаяся часть - кость 3), шейдеры строятся по таблице пресетов прежнего хоста (шейдер -
//! это пресет, свечение и лист вместе), листов у запроса от одного до восьми, и все они
//! встают в словарь модели под своими именами вместо листа донора (лист картинки у дирижаблей
//! с лого и своей текстурой - второй лист). Любой запрос вне умений команды
//! получает `ArgumentException` с припиской «: пока на хосте.»: по ней окно передаёт
//! запрос прежнему хосту, который объяснит причину сам.

use std::{
    array,
    f64::consts::PI,
    fmt, fs,
    ops::RangeInclusive,
    path::{Path, PathBuf},
};

use rage_res::{
    dds::{self, Dds},
    donor::{Donor, Mesh, Round, Skin, SkinnedMesh},
    hash::sha256_hex,
    shader_write::ShaderSpec,
    sky_clip::{self, Local},
    texture::Format,
    ytd_write::NewTexture,
    Kind,
};
use serde_json::Value;

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const HOST_WORD: &str = "пока на хосте";
/// Лист донора, на место которого встаёт лист запроса, и шейдер-образец раскладки.
const DONOR_SHEET: &str = "prop_money_basic";
const DONOR_LAYOUT: u16 = 3;
/// Дальность в файле одна на все уровни.
const FILE_LOD: f32 = 9998.0;
/// Положение барабана сушилки в покое: прибавляется к каждой вершине при записи.
const REST: [f32; 3] = [0.000_643_253_3, -0.314_974_78, 1.120_286_6];
/// Вес кости: барабан держит всё, что не отдано гнущейся части.
const FULL_WEIGHT: u8 = 255;

// ---------------------------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------------------------

/// Причины, по которым запрос уходит прежнему хосту; номер варианта - строка в `reason`.
#[derive(Clone, Copy)]
enum Deferred {
    Size,
    Unreadable,
    Format,
    Name,
    SameName,
    Range,
    NoSheet,
    ManySheets,
    SheetNames,
    SheetSide,
    NoFile,
    FileMissing,
    FileSize,
    Digest,
    NotDds,
    Mips,
    Block,
    NoDonor,
    DonorMissing,
    NotDryer,
    NoGeometries,
    GeometryCount,
    OtherSheet,
    Glow,
    GlowDefault,
    Preset,
    Incomplete,
    Number,
    IndexRange,
    Triples,
    Pairs,
    VertexCount,
    Triangles,
    IndexOutside,
    VertexLimit,
    NormalLimit,
    ModelLimit,
    Flex,
    PathFrames,
    FrameCount,
    FrameShape,
    FrameNumber,
    Mismatch,
    NoDuration,
    OutputBusy,
}

impl Deferred {
    fn reason(self) -> &'static str {
        const TABLE: [&str; 45] = [
            "Запрос летающего дирижабля вне размера",
            "Запрос летающего дирижабля не читается",
            "Запрос летающего дирижабля другого формата",
            "Имя летающего дирижабля",
            "Модель и клип с одним именем",
            "Дальность вне пределов",
            "Летающий дирижабль без листа",
            "Больше восьми листов",
            "Листы с одним именем",
            "Размер листа",
            "Лист без файла",
            "Лист не найден",
            "Лист вне размера",
            "Лист с другим SHA-256",
            "Лист не DDS",
            "Лист без полной цепочки мипов или другого размера",
            "Лист не DXT1 и не DXT5",
            "Летающий дирижабль без донора",
            "Донор летающего дирижабля не найден",
            "Донор летающего дирижабля — не сушилка",
            "Летающий дирижабль без геометрий",
            "Число геометрий",
            "Геометрия с другим листом",
            "Свечение вне пределов",
            "Свечение у обычного шейдера",
            "Шейдер вне трёх пресетов",
            "Летающий дирижабль: неполная геометрия",
            "Число геометрии",
            "Индекс вне диапазона",
            "Тройки координат",
            "Пары uv",
            "Геометрия с неверным числом вершин",
            "Индексы не треугольники",
            "Индекс вне вершин",
            "Вершина вне предела",
            "Нормаль или uv вне предела",
            "Модель больше предела",
            "Гибкость: одна доля от 0 до 1 на вершину",
            "Кадры пути",
            "Число кадров пути",
            "Кадр пути — семь чисел",
            "Число кадра пути",
            "Гнущиеся вершины и местное движение не сходятся",
            "Путь без длительности",
            "Папка вывода летающего дирижабля не пуста",
        ];
        TABLE[self as usize]
    }
}

/// Отказ с припиской: окно по ней передаёт запрос хосту.
fn handed_back(reason: impl fmt::Display) -> EngineError {
    EngineError::argument(format!("{reason}: {HOST_WORD}."))
}

impl From<Deferred> for EngineError {
    fn from(why: Deferred) -> Self {
        handed_back(why.reason())
    }
}

/// Условие, нарушение которого - отказ.
fn ensure(holds: bool, otherwise: Deferred) -> Result<()> {
    holds.then_some(()).ok_or_else(|| otherwise.into())
}

// ---------------------------------------------------------------------------------------------
// Чтение запроса
// ---------------------------------------------------------------------------------------------

/// Линза на узел запроса: отсутствие на любом шаге пути - просто `None`.
#[derive(Clone, Copy)]
struct Lens<'a>(Option<&'a Value>);

impl<'a> Lens<'a> {
    fn key(self, name: &str) -> Self {
        Lens(self.0.and_then(|node| node.get(name)))
    }

    fn text(self) -> Option<&'a str> {
        self.0?.as_str()
    }

    fn number(self) -> Option<f64> {
        self.0?.as_f64()
    }

    fn whole(self) -> Option<u64> {
        self.0?.as_u64()
    }

    fn list(self) -> Option<&'a [Value]> {
        self.0?.as_array().map(Vec::as_slice)
    }

    /// Узел, если он есть и не `null`.
    fn set(self) -> Option<&'a Value> {
        self.0.filter(|node| !node.is_null())
    }
}

/// Имя в правилах хоста: 1…63 знака из `a–z`, `0–9`, `_`, первый - не `_`.
fn asset_name(text: Option<&str>) -> Result<String> {
    let name = text.ok_or(Deferred::Name)?;
    let plain = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    let fits = name.len() <= 63
        && name.bytes().all(|byte| plain(byte) || byte == b'_')
        && name.bytes().next().is_some_and(plain);
    ensure(fits, Deferred::Name)?;
    Ok(name.to_owned())
}

/// Файл запроса: размер по длине файла, потом разбор из байт.
fn load_request(input: &Path) -> Result<Value> {
    let length = fs::metadata(input)?.len();
    ensure((1..=16_777_216).contains(&length), Deferred::Size)?;
    serde_json::from_slice(&fs::read(input)?).map_err(|_| Deferred::Unreadable.into())
}

/// Имена и дальность: первые пять проверок запроса.
struct Head {
    name: String,
    clip: String,
    lod: f32,
}

impl Head {
    const FORMAT: &'static str = "astral.compile-sky-flyer";
    const LOD: RangeInclusive<f64> = 10.0..=6000.0;

    fn read(root: Lens<'_>) -> Result<Head> {
        let versioned = root.key("version").whole() == Some(1);
        ensure(
            versioned && root.key("format").text() == Some(Self::FORMAT),
            Deferred::Format,
        )?;
        let name = asset_name(root.key("name").text())?;
        let clip = asset_name(root.key("clipDictionary").text())?;
        ensure(name != clip, Deferred::SameName)?;
        let lod = root
            .key("lodDist")
            .number()
            .filter(|far| Self::LOD.contains(far))
            .ok_or(Deferred::Range)?;
        Ok(Head {
            name,
            clip,
            lod: lod as f32,
        })
    }
}

/// Лист запроса, проверенный до последней мелочи.
struct Sheet {
    name: String,
    picture: Dds,
}

impl Sheet {
    const SIDES: RangeInclusive<u64> = 4..=2048;
    const BYTES: RangeInclusive<u64> = 128..=8_388_608;

    fn side(entry: Lens<'_>, key: &str) -> Result<u16> {
        let side = entry.key(key).whole().unwrap_or(0);
        ensure(
            Self::SIDES.contains(&side) && side.is_power_of_two(),
            Deferred::SheetSide,
        )?;
        Ok(side as u16)
    }

    /// Файл листа: он есть, не выходит за размеры и совпадает с хешем из запроса.
    fn load(entry: Lens<'_>) -> Result<Vec<u8>> {
        let file = entry.key("file").text().ok_or(Deferred::NoFile)?;
        let length = fs::metadata(file)
            .ok()
            .filter(|meta| meta.is_file())
            .map(|meta| meta.len())
            .ok_or(Deferred::FileMissing)?;
        ensure(Self::BYTES.contains(&length), Deferred::FileSize)?;
        let bytes = fs::read(file).map_err(|_| Deferred::FileMissing)?;
        let digest = format!("sha256:{}", sha256_hex(&bytes));
        ensure(
            entry.key("sha256").text() == Some(digest.as_str()),
            Deferred::Digest,
        )?;
        Ok(bytes)
    }

    /// Листов у модели от одного до восьми (у хоста тот же предел), имена без повторов; листы идут в порядке запроса.
    const MOST: usize = 8;

    fn read_all(root: Lens<'_>) -> Result<Vec<Sheet>> {
        let listed = root.key("textures").list().ok_or(Deferred::NoSheet)?;
        ensure(!listed.is_empty(), Deferred::NoSheet)?;
        ensure(listed.len() <= Self::MOST, Deferred::ManySheets)?;
        let mut sheets: Vec<Sheet> = Vec::with_capacity(listed.len());
        for entry in listed {
            let sheet = Sheet::read(Lens(Some(entry)))?;
            ensure(
                sheets.iter().all(|known| known.name != sheet.name),
                Deferred::SheetNames,
            )?;
            sheets.push(sheet);
        }
        Ok(sheets)
    }

    /// Один лист запроса: имя, стороны, файл.
    fn read(entry: Lens<'_>) -> Result<Sheet> {
        let name = asset_name(entry.key("name").text())?;
        let (width, height) = (Self::side(entry, "width")?, Self::side(entry, "height")?);
        let picture = dds::parse(&Self::load(entry)?).map_err(|_| Deferred::NotDds)?;
        let chain = u16::BITS - width.max(height).leading_zeros();
        let sized = [(picture.width, width), (picture.height, height)]
            .iter()
            .all(|&(found, asked)| found == u32::from(asked));
        ensure(sized && u32::from(picture.levels) == chain, Deferred::Mips)?;
        ensure(
            matches!(picture.format, Format::Dxt1 | Format::Dxt5),
            Deferred::Block,
        )?;
        Ok(Sheet { name, picture })
    }

    /// Лист под своим именем: в словаре модели он займёт место листа донора.
    fn as_texture(&self) -> NewTexture {
        let Dds {
            width,
            height,
            levels,
            format,
            payload,
        } = self.picture.clone();
        NewTexture {
            name: self.name.clone(),
            width: width as u16,
            height: height as u16,
            format,
            levels,
            payload,
        }
    }
}

fn open_donor(root: Lens<'_>) -> Result<Donor> {
    let path = root.key("donor").text().ok_or(Deferred::NoDonor)?;
    let bytes = fs::read(path).map_err(|_| Deferred::DonorMissing)?;
    // Хост пишет числа модели в XML (`0.######`): семь значащих цифр.
    let donor = Donor::open(&bytes).map_err(handed_back)?.with_round(Round::Seven);
    ensure(
        donor.diffuse_name(DONOR_LAYOUT) == Some(DONOR_SHEET),
        Deferred::NotDryer,
    )?;
    Ok(donor)
}

// ---------------------------------------------------------------------------------------------
// Геометрии
// ---------------------------------------------------------------------------------------------

/// Пресет шейдера хоста: имя, файл и прозрачность; свечение задают все, кроме обычного.
fn preset(key: &str, glow: Option<f32>) -> Result<ShaderSpec> {
    let (name, file, alpha) = match key {
        "default" => ("default", "default.sps", false),
        "emissive" => ("emissive", "emissive.sps", false),
        "emissive_alpha" => ("emissive", "emissive_alpha.sps", true),
        _ => return Err(Deferred::Preset.into()),
    };
    let glows = key != "default";
    ensure(glows || glow.is_none(), Deferred::GlowDefault)?;
    Ok(ShaderSpec {
        name: name.to_owned(),
        file: file.to_owned(),
        alpha,
        emissive: glows.then(|| glow.unwrap_or(1.0)),
    })
}

/// Вершина запроса: позиция, нормаль, uv и вес гибкости (байт).
struct Vertex {
    position: [f32; 3],
    normal: [f32; 3],
    uv: [f32; 2],
    weight: u8,
}

impl Vertex {
    /// Строка вершины для донора: позиция идёт со сдвигом покоя барабана.
    fn row(&self) -> [f32; 8] {
        array::from_fn(|at| match at {
            0..=2 => self.position[at] + REST[at],
            3..=5 => self.normal[at - 3],
            _ => self.uv[at - 6],
        })
    }

    /// Кости и веса: без гибкости - один барабан, иначе барабан и «Innards».
    fn skin(&self) -> Skin {
        let bend = self.weight;
        Skin {
            bones: [0, 0, 2, if bend == 0 { 0 } else { 3 }],
            weights: [0, 0, FULL_WEIGHT - bend, bend],
        }
    }
}

/// Одна геометрия запроса: номер шейдера в сборке, вершины и индексы.
struct Hull {
    shader: usize,
    vertices: Vec<Vertex>,
    indices: Vec<u16>,
}

/// Плоский список чисел: не список - неполная геометрия, не число - отказ про число.
fn numbers(item: Lens<'_>, key: &str) -> Result<Vec<f64>> {
    item.key(key)
        .list()
        .ok_or(Deferred::Incomplete)?
        .iter()
        .map(|cell| cell.as_f64().ok_or_else(|| Deferred::Number.into()))
        .collect()
}

/// Числа запроса читаются как `f64` и приводятся к `f32`.
fn narrowed(item: Lens<'_>, key: &str) -> Result<Vec<f32>> {
    numbers(item, key).map(|list| list.into_iter().map(|value| value as f32).collect())
}

fn index_list(item: Lens<'_>) -> Result<Vec<u16>> {
    let list = item.key("indices").list().ok_or(Deferred::Incomplete)?;
    list.iter()
        .map(|cell| {
            let value = cell.as_f64().ok_or(Deferred::Number)?;
            let whole = value.fract() == 0.0 && (0.0..=f64::from(u16::MAX)).contains(&value);
            whole
                .then_some(value as u16)
                .ok_or_else(|| Deferred::IndexRange.into())
        })
        .collect()
}

/// Веса гибкости: байт = доля × 255 с округлением от нуля.
fn flex_weights(item: Lens<'_>, vertices: usize) -> Result<Vec<u8>> {
    if item.key("flex").set().is_none() {
        return Ok(vec![0; vertices]);
    }
    let shares = numbers(item, "flex")?;
    ensure(
        shares.len() == vertices && shares.iter().all(|share| (0.0..=1.0).contains(share)),
        Deferred::Flex,
    )?;
    Ok(shares
        .iter()
        .map(|&share| (share as f32 * f32::from(FULL_WEIGHT)).round() as u8)
        .collect())
}

/// Плоский список как строки по `N` чисел.
fn lanes<const N: usize>(flat: &[f32]) -> Vec<[f32; N]> {
    flat.chunks_exact(N)
        .map(|chunk| array::from_fn(|at| chunk[at]))
        .collect()
}

impl Hull {
    const VERTICES: RangeInclusive<usize> = 3..=65_000;
    const INDICES_MOST: usize = 390_000;
    const POSITION_MOST: f32 = 80.0;
    const UV_MOST: f32 = 64.0;

    /// Массивы запроса и проверки по порядку; веса гибкости пока нули.
    fn read(item: Lens<'_>, shader: usize) -> Result<Hull> {
        let positions = narrowed(item, "positions")?;
        let normals = narrowed(item, "normals")?;
        let uvs = narrowed(item, "uvs")?;
        let indices = index_list(item)?;
        ensure(
            positions.len() % 3 == 0 && normals.len() % 3 == 0,
            Deferred::Triples,
        )?;
        ensure(uvs.len() % 2 == 0, Deferred::Pairs)?;
        let count = positions.len() / 3;
        ensure(
            Self::VERTICES.contains(&count) && normals.len() / 3 == count && uvs.len() / 2 == count,
            Deferred::VertexCount,
        )?;
        ensure(
            (1..=Self::INDICES_MOST).contains(&indices.len()) && indices.len() % 3 == 0,
            Deferred::Triangles,
        )?;
        ensure(
            indices.iter().all(|&index| usize::from(index) < count),
            Deferred::IndexOutside,
        )?;
        let tame = |value: &f32, most: f32| value.is_finite() && value.abs() <= most;
        ensure(
            positions
                .iter()
                .all(|value| tame(value, Self::POSITION_MOST)),
            Deferred::VertexLimit,
        )?;
        ensure(
            normals.iter().all(|value| value.is_finite())
                && uvs.iter().all(|value| tame(value, Self::UV_MOST)),
            Deferred::NormalLimit,
        )?;
        let vertices = lanes::<3>(&positions)
            .into_iter()
            .zip(lanes::<3>(&normals))
            .zip(lanes::<2>(&uvs))
            .map(|((position, normal), uv)| Vertex {
                position,
                normal,
                uv,
                weight: 0,
            })
            .collect();
        Ok(Hull {
            shader,
            vertices,
            indices,
        })
    }
}

/// Все геометрии запроса и различные шейдеры по порядку первого появления.
struct Cargo {
    hulls: Vec<Hull>,
    specs: Vec<ShaderSpec>,
    /// Номер листа запроса у шейдера с тем же номером в `specs`: шейдер — это пресет, свечение и лист вместе.
    sheets: Vec<usize>,
}

impl Cargo {
    const COUNT: RangeInclusive<usize> = 1..=16;
    const TOTAL_VERTICES: usize = 150_000;
    const TOTAL_INDICES: usize = 900_000;
    const GLOW: RangeInclusive<f64> = 0.0..=64.0;

    /// `sheets` — имена листов запроса по порядку.
    fn read(listed: Lens<'_>, sheets: &[String]) -> Result<Cargo> {
        let items = listed.list().ok_or(Deferred::NoGeometries)?;
        ensure(Self::COUNT.contains(&items.len()), Deferred::GeometryCount)?;
        let mut cargo = Cargo {
            hulls: Vec::with_capacity(items.len()),
            specs: Vec::new(),
            sheets: Vec::new(),
        };
        for item in items.iter().map(|item| Lens(Some(item))) {
            let shader = cargo.shader_of(item, sheets)?;
            let hull = Hull::read(item, shader)?;
            let count = hull.vertices.len();
            cargo.hulls.push(hull);
            let (vertices, indices) = cargo.hulls.iter().fold((0, 0), |(v, i), done| {
                (v + done.vertices.len(), i + done.indices.len())
            });
            ensure(
                vertices <= Self::TOTAL_VERTICES && indices <= Self::TOTAL_INDICES,
                Deferred::ModelLimit,
            )?;
            let weights = flex_weights(item, count)?;
            if let Some(last) = cargo.hulls.last_mut() {
                last.vertices
                    .iter_mut()
                    .zip(weights)
                    .for_each(|(vertex, weight)| vertex.weight = weight);
            }
        }
        Ok(cargo)
    }

    /// Лист, свечение и пресет геометрии: номер её шейдера в сборке (новый - в конец списка).
    fn shader_of(&mut self, item: Lens<'_>, sheets: &[String]) -> Result<usize> {
        let wanted = item.key("texture").text();
        let sheet = sheets
            .iter()
            .position(|name| Some(name.as_str()) == wanted)
            .ok_or(Deferred::OtherSheet)?;
        let glow = item
            .key("emissive")
            .set()
            .map(|node| {
                node.as_f64()
                    .filter(|glow| Self::GLOW.contains(glow))
                    .map(|glow| glow as f32)
                    .ok_or(Deferred::Glow)
            })
            .transpose()?;
        let spec = preset(item.key("shader").text().unwrap_or("default"), glow)?;
        Ok(self
            .specs
            .iter()
            .zip(&self.sheets)
            .position(|(known, on)| *known == spec && *on == sheet)
            .unwrap_or_else(|| {
                self.specs.push(spec);
                self.sheets.push(sheet);
                self.specs.len() - 1
            }))
    }

    /// Шейдеры сборки: пресет и номер листа.
    fn shaders(&self) -> Vec<(ShaderSpec, usize)> {
        self.specs
            .iter()
            .cloned()
            .zip(self.sheets.iter().copied())
            .collect()
    }

    fn vertices(&self) -> impl Iterator<Item = &Vertex> {
        self.hulls.iter().flat_map(|hull| &hull.vertices)
    }

    fn bending(&self) -> usize {
        self.vertices().filter(|vertex| vertex.weight != 0).count()
    }

    /// Маска корзин модели: корзина 1 у пресетов с прозрачностью, иначе 0.
    fn bucket_mask(&self) -> u8 {
        self.specs
            .iter()
            .fold(0, |mask, spec| mask | (1 << u8::from(spec.alpha)))
    }

    /// Сетки со скиннингом по раскладке донора.
    fn skinned(&self) -> Vec<(u16, SkinnedMesh)> {
        self.hulls
            .iter()
            .map(|hull| {
                let mesh = Mesh {
                    shader: hull.shader as u16,
                    vertices: hull.vertices.iter().map(Vertex::row).collect(),
                    indices: hull.indices.clone(),
                };
                let skin = hull.vertices.iter().map(Vertex::skin).collect();
                (hull.shader as u16, SkinnedMesh { mesh, skin })
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------------------------
// Путь
// ---------------------------------------------------------------------------------------------

type Frames = Vec<[f64; 7]>;

/// Кадр `[x, y, z, qx, qy, qz, qw]`: семь конечных чисел.
fn frame_of(frame: &Value) -> Result<[f64; 7]> {
    let cells = frame
        .as_array()
        .filter(|cells| cells.len() == 7)
        .ok_or(Deferred::FrameShape)?;
    let row = cells
        .iter()
        .map(|cell| {
            cell.as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| Deferred::FrameNumber.into())
        })
        .collect::<Result<Vec<f64>>>()?;
    Ok(<[f64; 7]>::try_from(row).unwrap_or_default())
}

/// Кадры из `holder.frames`, их число в пределах `allowed`.
fn read_frames(holder: Lens<'_>, allowed: RangeInclusive<usize>) -> Result<Frames> {
    let listed = holder.key("frames").list().ok_or(Deferred::PathFrames)?;
    ensure(allowed.contains(&listed.len()), Deferred::FrameCount)?;
    listed.iter().map(frame_of).collect()
}

/// Путь полёта и необязательное местное движение (до проверки длительности).
fn read_motion(path: Lens<'_>) -> Result<(Frames, Option<Frames>)> {
    let flight = read_frames(path, 2..=1024)?;
    let local = path
        .key("local")
        .set()
        .map(|node| read_frames(Lens(Some(node)), 2..=9001))
        .transpose()?;
    Ok((flight, local))
}

// ---------------------------------------------------------------------------------------------
// Рамка и радиус
// ---------------------------------------------------------------------------------------------

/// Длина вектора: корень суммы квадратов.
fn length32(vector: [f32; 3]) -> f32 {
    vector.iter().map(|part| part * part).sum::<f32>().sqrt()
}

fn length64(vector: [f64; 3]) -> f64 {
    vector.iter().map(|part| part * part).sum::<f64>().sqrt()
}

/// Угол между поворотами в градусах: `4 · atan2(d, e)` с выбором знака по скалярному произведению.
fn turn_degrees(a: [f64; 4], b: [f64; 4]) -> f64 {
    let dot: f64 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    let spread = |mix: f64| {
        a.iter()
            .zip(&b)
            .map(|(x, y)| (x + mix * y) * (x + mix * y))
            .sum::<f64>()
            .sqrt()
    };
    4.0 * spread(-sign).atan2(spread(sign)) * 180.0 / PI
}

/// Коробка по трём осям.
#[derive(Clone, Copy)]
struct Bounds {
    min: [f32; 3],
    max: [f32; 3],
}

impl Bounds {
    const EMPTY: Bounds = Bounds {
        min: [f32::MAX; 3],
        max: [f32::MIN; 3],
    };

    /// Коробка, расширенная до углов `low` и `high`.
    fn cover(self, low: [f32; 3], high: [f32; 3]) -> Bounds {
        Bounds {
            min: array::from_fn(|axis| self.min[axis].min(low[axis])),
            max: array::from_fn(|axis| self.max[axis].max(high[axis])),
        }
    }
}

/// Размах местного движения: наибольший сдвиг (м) и поворот (градусы).
struct Swing {
    shift: f64,
    degrees: f64,
}

impl Swing {
    fn of(local: &[[f64; 7]]) -> Swing {
        let still = [0.0, 0.0, 0.0, 1.0];
        local.iter().fold(
            Swing {
                shift: 0.0,
                degrees: 0.0,
            },
            |swing, frame| Swing {
                shift: swing.shift.max(length64([frame[0], frame[1], frame[2]])),
                degrees: swing.degrees.max(turn_degrees(
                    still,
                    [frame[3], frame[4], frame[5], frame[6]],
                )),
            },
        )
    }

    /// Во сколько раз поворот отодвигает вершину от оси.
    fn reach(&self) -> f64 {
        2.0 * (self.degrees.to_radians().min(PI) / 2.0).sin()
    }
}

/// Что сочинено про полёт: рамка, радиус и размах местного движения.
struct Extent {
    bounds: Bounds,
    radius: f32,
    swing: Swing,
}

impl Extent {
    fn measure(cargo: &Cargo, flight: &Frames, local: Option<&Frames>) -> Extent {
        let swing = local.map_or(
            Swing {
                shift: 0.0,
                degrees: 0.0,
            },
            |frames| Swing::of(frames),
        );
        let reach = swing.reach();
        let (bounds, widest) =
            cargo
                .vertices()
                .fold((Bounds::EMPTY, 0.0f64), |(bounds, widest), vertex| {
                    let length = f64::from(length32(vertex.position));
                    let share = f64::from(vertex.weight) / f64::from(FULL_WEIGHT);
                    let placed = array::from_fn(|axis| vertex.position[axis] + REST[axis]);
                    (
                        bounds.cover(placed, placed),
                        widest.max(length + share * (length * reach + swing.shift)),
                    )
                });
        let radius = widest as f32;
        let margin = radius + 1.0;
        let bounds = flight.iter().fold(bounds, |bounds, frame| {
            let place: [f32; 3] = array::from_fn(|axis| frame[axis] as f32);
            bounds.cover(
                place.map(|axis| axis - margin),
                place.map(|axis| axis + margin),
            )
        });
        Extent {
            bounds,
            radius,
            swing,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Запрос целиком и сборка
// ---------------------------------------------------------------------------------------------

/// Всё, что запрос обещал, проверено по порядку: донор открыт, геометрии и путь прочитаны.
struct Brief {
    head: Head,
    sheets: Vec<Sheet>,
    donor: Donor,
    cargo: Cargo,
    flight: Frames,
    local: Option<Frames>,
    duration: f64,
}

impl Brief {
    fn read(root: Lens<'_>) -> Result<Brief> {
        let head = Head::read(root)?;
        let sheets = Sheet::read_all(root)?;
        let donor = open_donor(root)?;
        let names: Vec<String> = sheets.iter().map(|sheet| sheet.name.clone()).collect();
        let cargo = Cargo::read(root.key("geometries"), &names)?;
        let (flight, local) = read_motion(root.key("path"))?;
        ensure((cargo.bending() > 0) == local.is_some(), Deferred::Mismatch)?;
        let duration = root
            .key("path")
            .key("duration")
            .number()
            .ok_or(Deferred::NoDuration)?;
        Ok(Brief {
            head,
            sheets,
            donor,
            cargo,
            flight,
            local,
            duration,
        })
    }

    /// Файл модели: сетки на раскладке донора, шейдеры по пресетам (у каждого свой лист), листы запроса вместо листа донора.
    fn model(&self, extent: &Extent) -> Result<Vec<u8>> {
        let packed = self
            .donor
            .pack_flyer(
                &self.cargo.skinned(),
                DONOR_LAYOUT,
                (extent.bounds.min, extent.bounds.max),
                self.cargo.bucket_mask(),
                Some(FILE_LOD),
            )
            .map_err(handed_back)?;
        let sheets: Vec<NewTexture> = self.sheets.iter().map(Sheet::as_texture).collect();
        self.donor
            .apply_flyer_sheets(
                &packed,
                &self.cargo.shaders(),
                DONOR_LAYOUT,
                &sheets,
                &self.head.name,
            )
            .map_err(handed_back)
    }
}

/// Клип полёта: отказ соседа по аргументам уходит хосту, остальные виды остаются как есть.
fn clip_of(name: &str, duration: f64, flight: Frames, local: Option<Frames>) -> Result<Vec<u8>> {
    let path = sky_clip::Path {
        duration,
        frames: flight,
    };
    let local = local.map(|frames| Local { frames });
    sky_clip::build_dictionary(name, &path, local.as_ref()).map_err(|error| match error.kind {
        Kind::Argument => handed_back(&error.message),
        _ => error.into(),
    })
}

/// Папка вывода: пустая или новая; создаётся вместе с родителями.
fn prepare_output(options: &Options) -> Result<PathBuf> {
    let folder = paths::full_path(options.required("output")?)?;
    let taken = folder.exists() && (!folder.is_dir() || fs::read_dir(&folder)?.next().is_some());
    ensure(!taken, Deferred::OutputBusy)?;
    fs::create_dir_all(&folder)?;
    Ok(folder)
}

// ---------------------------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------------------------

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Числа `f32` печатаются как `f64`, полученные расширением.
fn widened(values: [f32; 3]) -> Value {
    Value::Array(values.map(|one| f64::from(one).into()).to_vec())
}

fn file_row(file: String, bytes: &[u8]) -> Value {
    object([
        ("file", file.into()),
        ("bytes", bytes.len().into()),
        ("sha256", sha256_hex(bytes).into()),
    ])
}

/// Что считано в ответ: имена, дальность, рамка, местное движение, длительность и число кадров.
struct Report<'a> {
    head: &'a Head,
    extent: &'a Extent,
    flexing: usize,
    local_frames: Option<usize>,
    flight_frames: usize,
    duration: f32,
}

impl Report<'_> {
    fn local(&self) -> Value {
        self.local_frames.map_or(Value::Null, |frames| {
            object([
                ("frames", frames.into()),
                ("flexVertices", self.flexing.into()),
                ("maxShift", self.extent.swing.shift.into()),
                ("maxDegrees", self.extent.swing.degrees.into()),
            ])
        })
    }

    fn build(&self, model: &[u8], clip: &[u8]) -> Value {
        let bounds = object([
            ("min", widened(self.extent.bounds.min)),
            ("max", widened(self.extent.bounds.max)),
        ]);
        let clip_info = object([
            ("requestFrames", self.flight_frames.into()),
            ("duration", f64::from(self.duration).into()),
        ]);
        let files = vec![
            file_row(format!("{}.ydr", self.head.name), model),
            file_row(format!("{}.ycd", self.head.clip), clip),
        ];
        object([
            ("format", "astral.sky-flyer".into()),
            ("version", 1.into()),
            ("exportedBy", "Astral Sky Flyer 1".into()),
            ("name", self.head.name.clone().into()),
            ("clipDictionary", self.head.clip.clone().into()),
            ("lodDist", f64::from(self.head.lod).into()),
            ("bounds", bounds),
            ("radius", f64::from(self.extent.radius).into()),
            ("local", self.local()),
            ("clip", clip_info),
            ("files", files.into()),
        ])
    }
}

pub fn compile_sky_flyer(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = paths::existing_file(options.required("input")?, &[".json"])?;
    let document = load_request(&input)?;
    let brief = Brief::read(Lens(Some(&document)))?;
    let extent = Extent::measure(&brief.cargo, &brief.flight, brief.local.as_ref());
    let model = brief.model(&extent)?;

    let flexing = brief.cargo.bending();
    let Brief {
        head,
        flight,
        local,
        duration,
        ..
    } = brief;
    let (flight_frames, local_frames) = (flight.len(), local.as_ref().map(Vec::len));
    let clip = clip_of(&head.name, duration, flight, local)?;

    let folder = prepare_output(options)?;
    write_atomic(&folder.join(format!("{}.ydr", head.name)), &model)?;
    write_atomic(&folder.join(format!("{}.ycd", head.clip)), &clip)?;
    let report = Report {
        head: &head,
        extent: &extent,
        flexing,
        local_frames,
        flight_frames,
        duration: duration as f32,
    };
    Ok(report.build(&model, &clip))
}

const COMPILE_SKY_FLYER: Command = Command::new("compile-sky-flyer", compile_sky_flyer);

pub const COMMANDS: &[Command] = &[COMPILE_SKY_FLYER];

#[cfg(test)]
mod tests;
