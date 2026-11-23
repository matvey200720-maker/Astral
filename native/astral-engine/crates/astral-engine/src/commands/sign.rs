//! `compile-sign-models`: сетки знаков (вершины и треугольники, посчитанные приложением)
//! упаковываются в настоящие модели GTA V - по файлу `.ydr` или `.ydd` на модель запроса.
//!
//! Два пути. Штатный (`source`): берётся готовая модель игры, сетки высокой детализации
//! вытесняются новыми, группа шейдеров и устройство вершин сохраняются; любое отклонение
//! отказывает припиской «: пока на хосте.». Путь на донора (`donor`): только `ydr`, основа -
//! рисовалка донора, листы - DDS запроса; его отказы несут коды `sign-*` и приписки не имеют.

use std::{
    array,
    collections::HashMap,
    fmt, fs,
    ops::RangeInclusive,
    path::{Path, PathBuf},
};

use rage_res::{
    dds::{self, Dds},
    donor::{pack_sign_geometry, root_of_by, Donor, Mesh, Naming, Packed, Round, SignShader},
    drawable::{kind_of, FileKind},
    drawable_write::{self as dw, NewGeometry},
    hash::sha256_hex,
    resource::Resource,
    resource_graph as rgraph,
    shader_write::ShaderSpec,
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

const HOST_WORD: &str = "пока на хосте";
const DONOR_REQUEST: &str = "sign-donor-request";
const MESH_INVALID: &str = "sign-mesh-invalid";
const TEXTURE_INVALID: &str = "sign-texture-invalid";

/// Тексты отказов.
mod say {
    pub const SIZE: &str = "Запрос моделей надписи вне размера";
    pub const UNREADABLE: &str = "Запрос моделей надписи не читается";
    pub const NOT_OBJECT: &str = "Запрос моделей надписи не объект";
    pub const ROOT_EXTRA: &str = "В запросе моделей надписи лишние поля";
    pub const FORMAT: &str = "Запрос моделей надписи другого формата";
    pub const NO_MODELS: &str = "В запросе нет моделей";
    pub const MODEL_COUNT: &str = "Число моделей надписи вне предела";
    pub const TWICE: &str = "Модель надписи записана дважды";
    pub const MODEL_EMPTY: &str = "Модель надписи пуста";
    pub const MODEL_EXTRA: &str = "В модели надписи лишние поля";
    pub const NO_NAME: &str = "Модель надписи без имени";
    pub const BAD_NAME: &str = "Имя модели надписи не подходит";
    pub const OTHER_KIND: &str = "Модели надписи другого вида";
    pub const NO_SOURCE: &str = "Модель надписи без источника";
    pub const NO_DRAWABLES: &str = "Модель надписи без рисовалки";
    pub const DRAWABLE_COUNT: &str = "Число рисовалок модели надписи вне предела";
    pub const DRAWABLE_EMPTY: &str = "Рисовалка пуста";
    pub const DRAWABLE_EXTRA: &str = "В рисовалке лишние поля: шейдеры и словари не поддержаны";
    pub const HASH_NUMBER: &str = "Хеш рисовалки не число";
    pub const HASH_RANGE: &str = "Хеш рисовалки вне предела";
    pub const YDR_HASH: &str = "У модели ydr рисовалка без хеша";
    pub const YDD_NO_HASH: &str = "Рисовалка словаря без хеша";
    pub const KEEP_SHADERS: &str = "Новые шейдеры надписи не поддержаны";
    pub const LOD_NUMBER: &str = "Дальность не число";
    pub const LOD_RANGE: &str = "Дальность вне предела";
    pub const NO_GRIDS: &str = "В рисовалке нет сеток";
    pub const GRID_COUNT: &str = "Число сеток вне предела";
    pub const HASH_TWICE: &str = "Рисовалка словаря заменяется дважды";
    pub const GRID_EMPTY: &str = "Сетка пуста";
    pub const GRID_EXTRA: &str = "В сетке лишние поля";
    pub const NO_SHADER: &str = "Сетка без шейдера";
    pub const SHADER_RANGE: &str = "Номер шейдера сетки вне предела";
    pub const NO_DATA: &str = "Сетка без данных";
    pub const NO_VERTICES: &str = "Сетка без вершин";
    pub const NO_INDICES: &str = "Сетка без индексов";
    pub const GRID_SIZE: &str = "Размер сетки вне предела";
    pub const DONOR_KIND: &str = "Модель на донора — только вида ydr";
    pub const NO_DONOR: &str = "Модель на донора без пути к донору";
    pub const ONE_DRAWABLE: &str = "Модель на донора — одна рисовалка";
    pub const DONOR_DRAWABLE_EXTRA: &str =
        "В рисовалке на донора лишние поля: hash и keepShaders здесь не нужны";
    pub const SHEETS_LIST: &str = "Листы текстур — список";
    pub const SHEET_COUNT: &str = "Число листов вне предела";
    pub const SHEET_EMPTY: &str = "Лист пуст";
    pub const SHEET_EXTRA: &str = "В листе лишние поля";
    pub const SHEET_NO_NAME: &str = "Лист без имени";
    pub const SHEET_BAD_NAME: &str = "Имя листа не подходит";
    pub const SHEET_NO_DDS: &str = "Лист без файла DDS";
    pub const SHEET_TWICE: &str = "Лист записан дважды";
    pub const OUTPUT_BUSY: &str = "Папка вывода моделей надписи не пуста";
    pub const SOURCE_MISSING: &str = "Источник модели надписи не найден";
    pub const SOURCE_SIZE: &str = "Источник модели надписи вне размера";
    pub const SOURCE_KIND: &str = "Источник не той модели, что в запросе";
    pub const NO_ROOT: &str = "Источник без корня";
    pub const NO_SUCH_HASH: &str = "В словаре нет рисовалки с таким хешем";
    pub const SKELETON: &str = "Источник со скелетом";
    pub const NO_SHADERS: &str = "Источник без шейдеров";
    pub const BUCKET: &str = "Корзина шейдера вне маски";
    pub const SHADER_OUTSIDE: &str = "Сетка указывает на шейдер, которого нет в источнике";
    pub const NO_TEMPLATE: &str = "У шейдера сетки нет образца вершин";
    pub const DATA_MISSING: &str = "Данные сетки не найдены";
    pub const DATA_SIZE: &str = "Размер данных сетки не совпадает";
    pub const DATA_UNREADABLE: &str = "Данные сетки не читаются";
    pub const INDEX_OUTSIDE: &str = "Индекс сетки вне вершин";
    pub const DONOR_MISSING: &str = "Донор модели надписи не найден.";
    pub const DONOR_SIZE: &str = "Донор модели надписи вне размера.";
    pub const SHEET_MISSING: &str = "Файл листа не найден.";
    pub const SHEET_NOT_DDS: &str = "Лист не DDS.";
    pub const SHEET_SIDE: &str = "Лист: стороны — степени двойки от 4 до 4096.";
    pub const SHEET_MIPS: &str = "Лист: нужна полная цепочка мипов.";
    pub const SHEET_FORMAT: &str = "Лист: только DXT1 или DXT5.";
    // Новая модель надписи: шейдеры и листы запроса, донор из корня запроса (путь `request-donor.json`).
    pub const FRESH_NO_DONOR: &str = "Новая модель надписи без донора";
    pub const FRESH_ON_SOURCE: &str = "Новые шейдеры в модели с источником";
    pub const FRESH_DONOR_MISSING: &str = "Донор новой модели надписи не найден";
    pub const FRESH_DONOR_SIZE: &str = "Донор новой модели надписи вне размера";
    pub const SHADERS_LIST: &str = "Шейдеры надписи — список";
    pub const SHADER_COUNT: &str = "Число шейдеров модели надписи вне предела";
    pub const SHADER_EMPTY: &str = "Шейдер надписи пуст";
    pub const SHADER_EXTRA: &str = "В шейдере надписи лишние поля";
    pub const SHADER_NO_NAME: &str = "Шейдер надписи без имени";
    pub const SHADER_FILE: &str = "Шейдер надписи не из собираемых";
    pub const SHADER_NO_TEXTURE: &str = "Шейдер надписи без листа";
    pub const SHADER_TEXTURE_NAME: &str = "Имя листа шейдера надписи не подходит";
    pub const SHADER_GLOW: &str = "Свечение шейдера надписи вне предела";
    pub const SHADER_NOT_LISTED: &str = "Сетка указывает на шейдер, которого нет в модели";
    pub const FRESH_NO_LOD: &str = "Рисовалка словаря с новой группой без дальности";
    pub const SHEET_DIGEST: &str = "Сумма листа не сошлась";
    pub const SHEET_SIDE_STOCK: &str = "Размер листа вне предела";
}

// ---------------------------------------------------------------------------------------------
// Дорожки отказов
// ---------------------------------------------------------------------------------------------

/// Какого пути касается отказ: от этого зависят код и приписка.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lane {
    Stock,
    Donor,
}

impl Lane {
    /// Отказ разбора запроса.
    fn refuse(self, text: &str) -> EngineError {
        match self {
            Lane::Stock => handed_back(text),
            Lane::Donor => EngineError::new(DONOR_REQUEST, text),
        }
    }

    /// Отказ данных сетки: на пути донора - со своим кодом и без точки.
    fn mesh(self, text: &str) -> EngineError {
        match self {
            Lane::Stock => handed_back(text),
            Lane::Donor => EngineError::new(MESH_INVALID, text),
        }
    }

    /// Отказ соседа-донора: код и текст его собственные, на штатном пути - с припиской.
    fn donor_refusal(self, refusal: rage_res::donor::Refusal) -> EngineError {
        match self {
            Lane::Stock => handed_back(refusal),
            Lane::Donor => EngineError::new(refusal.code(), refusal.to_string()),
        }
    }

    /// Условие данных сетки, нарушение которого - отказ голосом этого пути.
    fn mesh_ensure(self, holds: bool, text: &str) -> Result<()> {
        holds.then_some(()).ok_or_else(|| self.mesh(text))
    }

    /// Условие, нарушение которого - отказ разбора в голосе этого пути.
    fn ensure(self, holds: bool, text: &str) -> Result<()> {
        holds.then_some(()).ok_or_else(|| self.refuse(text))
    }
}

fn handed_back(reason: impl fmt::Display) -> EngineError {
    EngineError::argument(format!("{reason}: {HOST_WORD}."))
}

// ---------------------------------------------------------------------------------------------
// Разбор запроса
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Form {
    Ydr,
    Ydd,
}

impl Form {
    fn extension(self) -> &'static str {
        match self {
            Form::Ydr => "ydr",
            Form::Ydd => "ydd",
        }
    }

    fn file_kind(self) -> FileKind {
        match self {
            Form::Ydr => FileKind::Ydr,
            Form::Ydd => FileKind::Ydd,
        }
    }
}

/// Заявленные размеры сетки: вершины и индексы.
struct Counts {
    vertices: u64,
    indices: u64,
}

impl Counts {
    const VERTICES: RangeInclusive<u64> = 3..=65_535;
    const INDICES: RangeInclusive<u64> = 3..=600_000;
    /// Вершина файла сетки - восемь `f32`, индекс - `i32`.
    const VERTEX_BYTES: u64 = 32;
    const INDEX_BYTES: u64 = 4;

    fn fit(&self) -> bool {
        Self::VERTICES.contains(&self.vertices)
            && Self::INDICES.contains(&self.indices)
            && self.indices % 3 == 0
    }

    /// Длина файла данных, при которой он годится.
    fn file_bytes(&self) -> u64 {
        self.vertices * Self::VERTEX_BYTES + self.indices * Self::INDEX_BYTES
    }
}

/// Сетка запроса: номер шейдера, файл данных и заявленные размеры.
struct Grid {
    shader: u16,
    data: String,
    counts: Counts,
}

/// Лист модели: имя текстуры (у модели на донора - имя текстуры донора), файл DDS и сумма запроса, если она есть.
struct Sheet {
    name: String,
    dds: String,
    sha256: Option<String>,
}

/// Шейдер новой модели: название шейдера хоста, его файл, лист и свечение (у светящегося).
struct Shading {
    name: String,
    file: String,
    texture: String,
    emissive: Option<f32>,
}

/// Новая группа шейдеров рисовалки: шейдеры по номерам и листы, встроенные в модель.
struct Fresh {
    shaders: Vec<Shading>,
    sheets: Vec<Sheet>,
}

/// Что стоит в рисовалке после замены сеток: штатные шейдеры источника или новая группа.
enum Look {
    Kept,
    Fresh(Fresh),
}

/// Метки рисовалки: хеш в словаре (у `ydd`) и дальность.
struct Tag {
    hash: Option<u32>,
    lod: Option<f32>,
}

struct Drawable {
    tag: Tag,
    grids: Vec<Grid>,
    look: Look,
}

enum Route {
    Stock {
        form: Form,
        source: String,
        drawables: Vec<Drawable>,
        /// Донор из корня запроса: каркас новых групп шейдеров.
        donor: Option<String>,
    },
    /// Новая модель `ydr` без источника: каркас — донор из корня запроса.
    Fresh {
        drawable: Drawable,
        donor: Option<String>,
    },
    Donor {
        path: String,
        drawable: Drawable,
        sheets: Vec<Sheet>,
    },
}

struct Order {
    name: String,
    route: Route,
}

/// Имя в правилах хоста: 1…63 знака из `a–z`, `0–9`, `_`, `+`, первый - буква или цифра.
fn fits_name(name: &str) -> bool {
    let plain = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    name.len() <= 63
        && name.bytes().next().is_some_and(plain)
        && name
            .bytes()
            .all(|byte| plain(byte) || matches!(byte, b'_' | b'+'))
}

fn text_of<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key)?.as_str()
}

/// Читатель узлов запроса одного пути: все его отказы звучат голосом этого пути.
#[derive(Clone, Copy)]
struct Reader {
    lane: Lane,
}

impl Reader {
    fn object<'a>(self, node: &'a Value, empty: &str) -> Result<&'a Map<String, Value>> {
        node.as_object().ok_or_else(|| self.lane.refuse(empty))
    }

    /// Объект без ключей вне `allowed`.
    fn object_of<'a>(
        self,
        node: &'a Value,
        empty: &str,
        allowed: impl Fn(&str) -> bool,
        extra: &str,
    ) -> Result<&'a Map<String, Value>> {
        let map = self.object(node, empty)?;
        self.lane
            .ensure(map.keys().all(|key| allowed(key.as_str())), extra)?;
        Ok(map)
    }

    fn name<'a>(self, map: &'a Map<String, Value>, missing: &str, bad: &str) -> Result<&'a str> {
        let name = text_of(map, "name").ok_or_else(|| self.lane.refuse(missing))?;
        self.lane.ensure(fits_name(name), bad)?;
        Ok(name)
    }

    fn grid(self, node: &Value) -> Result<Grid> {
        let map = self.object_of(
            node,
            say::GRID_EMPTY,
            |key| matches!(key, "shader" | "data" | "vertexCount" | "indexCount"),
            say::GRID_EXTRA,
        )?;
        let shader = map
            .get("shader")
            .and_then(Value::as_i64)
            .ok_or_else(|| self.lane.refuse(say::NO_SHADER))?;
        let shader = u16::try_from(shader).map_err(|_| self.lane.refuse(say::SHADER_RANGE))?;
        let data = text_of(map, "data").ok_or_else(|| self.lane.refuse(say::NO_DATA))?;
        let count = |key: &str, missing: &str| {
            map.get(key)
                .and_then(Value::as_u64)
                .ok_or_else(|| self.lane.refuse(missing))
        };
        let counts = Counts {
            vertices: count("vertexCount", say::NO_VERTICES)?,
            indices: count("indexCount", say::NO_INDICES)?,
        };
        self.lane.ensure(counts.fit(), say::GRID_SIZE)?;
        Ok(Grid {
            shader,
            data: data.to_owned(),
            counts,
        })
    }

    fn grids(self, map: &Map<String, Value>) -> Result<Vec<Grid>> {
        let listed = map
            .get("geometries")
            .and_then(Value::as_array)
            .ok_or_else(|| self.lane.refuse(say::NO_GRIDS))?;
        self.lane
            .ensure((1..=64).contains(&listed.len()), say::GRID_COUNT)?;
        listed.iter().map(|node| self.grid(node)).collect()
    }

    /// `lodDist`: нет или `null` - дальности нет; число приводится к `f32` и ограничено.
    fn lod(self, map: &Map<String, Value>) -> Result<Option<f32>> {
        map.get("lodDist")
            .filter(|node| !node.is_null())
            .map(|node| {
                let far = node
                    .as_f64()
                    .ok_or_else(|| self.lane.refuse(say::LOD_NUMBER))?
                    as f32;
                self.lane
                    .ensure((1.0..=20_000.0).contains(&far), say::LOD_RANGE)?;
                Ok(far)
            })
            .transpose()
    }

    /// Хеш рисовалки: у `ydr` его быть не должно, у `ydd` он обязателен.
    fn hash(self, map: &Map<String, Value>, form: Form) -> Result<Option<u32>> {
        let hash = map
            .get("hash")
            .filter(|node| !node.is_null())
            .map(|node| {
                let raw = node
                    .as_u64()
                    .ok_or_else(|| self.lane.refuse(say::HASH_NUMBER))?;
                u32::try_from(raw).map_err(|_| self.lane.refuse(say::HASH_RANGE))
            })
            .transpose()?;
        match (form, hash) {
            (Form::Ydr, Some(_)) => Err(self.lane.refuse(say::YDR_HASH)),
            (Form::Ydd, None) => Err(self.lane.refuse(say::YDD_NO_HASH)),
            _ => Ok(hash),
        }
    }

    /// Название и файл шейдера новой модели: собираются только `default` (`default.sps`, `alpha.sps`)
    /// и `emissive` (`emissive.sps`, `emissive_alpha.sps`), как у хоста.
    fn shading(self, node: &Value) -> Result<Shading> {
        let one = self.object_of(
            node,
            say::SHADER_EMPTY,
            |key| matches!(key, "name" | "file" | "texture" | "emissive"),
            say::SHADER_EXTRA,
        )?;
        let name = text_of(one, "name").ok_or_else(|| self.lane.refuse(say::SHADER_NO_NAME))?;
        let file = text_of(one, "file").unwrap_or_default();
        let known = match name {
            "default" => matches!(file, "default.sps" | "alpha.sps"),
            "emissive" => matches!(file, "emissive.sps" | "emissive_alpha.sps"),
            _ => false,
        };
        self.lane.ensure(known, say::SHADER_FILE)?;
        let texture = text_of(one, "texture").ok_or_else(|| self.lane.refuse(say::SHADER_NO_TEXTURE))?;
        self.lane.ensure(fits_name(texture), say::SHADER_TEXTURE_NAME)?;
        let emissive = match one.get("emissive") {
            None | Some(Value::Null) => None,
            Some(node) => Some(node.as_f64().ok_or_else(|| self.lane.refuse(say::SHADER_GLOW))? as f32),
        };
        // Свечение хоста: у светящегося шейдера по умолчанию 1, от 0 до 64; у обычного оно не читается.
        let emissive = (name == "emissive").then(|| emissive.unwrap_or(1.0));
        if let Some(glow) = emissive {
            self.lane.ensure(glow.is_finite() && (0.0..=64.0).contains(&glow), say::SHADER_GLOW)?;
        }
        Ok(Shading {
            name: name.to_owned(),
            file: file.to_owned(),
            texture: texture.to_owned(),
            emissive,
        })
    }

    /// Новая группа шейдеров рисовалки: до восьми шейдеров и листы, встроенные в модель.
    fn fresh(self, map: &Map<String, Value>) -> Result<Fresh> {
        let listed = map
            .get("shaders")
            .and_then(Value::as_array)
            .ok_or_else(|| self.lane.refuse(say::SHADERS_LIST))?;
        self.lane
            .ensure((1..=8).contains(&listed.len()), say::SHADER_COUNT)?;
        let shaders = listed
            .iter()
            .map(|node| self.shading(node))
            .collect::<Result<Vec<_>>>()?;
        Ok(Fresh {
            shaders,
            sheets: self.sheets(map)?,
        })
    }

    fn stock_drawable(self, node: &Value, form: Form, taken: &mut Vec<u32>) -> Result<Drawable> {
        let map = self.object_of(
            node,
            say::DRAWABLE_EMPTY,
            |key| matches!(key, "hash" | "keepShaders" | "geometries" | "lodDist" | "shaders" | "textures"),
            say::DRAWABLE_EXTRA,
        )?;
        let hash = self.hash(map, form)?;
        let kept = map.get("keepShaders") == Some(&Value::Bool(true));
        // Штатные шейдеры не несут ни шейдеров, ни листов; без `keepShaders` нужна новая группа.
        self.lane.ensure(
            !(kept && (map.contains_key("shaders") || map.contains_key("textures"))),
            say::DRAWABLE_EXTRA,
        )?;
        self.lane
            .ensure(kept || map.contains_key("shaders"), say::KEEP_SHADERS)?;
        let look = if kept {
            Look::Kept
        } else {
            Look::Fresh(self.fresh(map)?)
        };
        let lod = self.lod(map)?;
        let grids = self.grids(map)?;
        if let Some(hash) = hash {
            self.lane.ensure(!taken.contains(&hash), say::HASH_TWICE)?;
            taken.push(hash);
        }
        Ok(Drawable {
            tag: Tag { hash, lod },
            grids,
            look,
        })
    }

    fn donor_drawable(self, node: &Value) -> Result<(Drawable, Vec<Sheet>)> {
        let map = self.object_of(
            node,
            say::DRAWABLE_EMPTY,
            |key| matches!(key, "geometries" | "lodDist" | "textures"),
            say::DONOR_DRAWABLE_EXTRA,
        )?;
        let lod = self.lod(map)?;
        let grids = self.grids(map)?;
        let drawable = Drawable {
            tag: Tag { hash: None, lod },
            grids,
            look: Look::Kept,
        };
        Ok((drawable, self.sheets(map)?))
    }

    fn sheet(self, entry: &Value) -> Result<Sheet> {
        let one = self.object_of(
            entry,
            say::SHEET_EMPTY,
            |key| matches!(key, "name" | "dds" | "sha256"),
            say::SHEET_EXTRA,
        )?;
        let name = self.name(one, say::SHEET_NO_NAME, say::SHEET_BAD_NAME)?;
        let dds = text_of(one, "dds").ok_or_else(|| self.lane.refuse(say::SHEET_NO_DDS))?;
        let sha256 = match one.get("sha256") {
            None | Some(Value::Null) => None,
            Some(Value::String(text)) => Some(text.clone()),
            Some(_) => return Err(self.lane.refuse(say::SHEET_DIGEST)),
        };
        Ok(Sheet {
            name: name.to_owned(),
            dds: dds.to_owned(),
            sha256,
        })
    }

    /// `textures`: нет - пусто; иначе список до восьми листов с разными именами.
    fn sheets(self, map: &Map<String, Value>) -> Result<Vec<Sheet>> {
        let Some(node) = map.get("textures") else {
            return Ok(Vec::new());
        };
        let listed = node
            .as_array()
            .ok_or_else(|| self.lane.refuse(say::SHEETS_LIST))?;
        self.lane.ensure(listed.len() <= 8, say::SHEET_COUNT)?;
        listed
            .iter()
            .try_fold(Vec::new(), |mut sheets: Vec<Sheet>, entry| {
                let sheet = self.sheet(entry)?;
                self.lane.ensure(
                    sheets.iter().all(|known| known.name != sheet.name),
                    say::SHEET_TWICE,
                )?;
                sheets.push(sheet);
                Ok(sheets)
            })
    }
}

/// Модель `ydr` без источника, у которой единственная рисовалка несёт `shaders`: новая модель на каркасе донора.
fn is_fresh_ydr(map: &Map<String, Value>, form: Form) -> bool {
    let sourceless = !map.contains_key("source");
    let one_with_shaders = map
        .get("drawables")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            matches!(items.as_slice(), [only] if only.as_object().is_some_and(|item| item.contains_key("shaders")))
        });
    sourceless && form == Form::Ydr && one_with_shaders
}

fn stock_order(map: &Map<String, Value>, donor: Option<&str>) -> Result<Order> {
    let reader = Reader { lane: Lane::Stock };
    reader.lane.ensure(
        map.keys()
            .all(|key| matches!(key.as_str(), "name" | "kind" | "source" | "drawables")),
        say::MODEL_EXTRA,
    )?;
    let name = reader.name(map, say::NO_NAME, say::BAD_NAME)?;
    let form = match text_of(map, "kind") {
        Some("ydr") => Form::Ydr,
        Some("ydd") => Form::Ydd,
        _ => return Err(reader.lane.refuse(say::OTHER_KIND)),
    };
    let fresh = is_fresh_ydr(map, form);
    let source = match (text_of(map, "source"), fresh) {
        (Some(source), _) => Some(source),
        (None, true) => None,
        (None, false) => return Err(reader.lane.refuse(say::NO_SOURCE)),
    };
    let listed = map
        .get("drawables")
        .and_then(Value::as_array)
        .ok_or_else(|| reader.lane.refuse(say::NO_DRAWABLES))?;
    let counted = match form {
        Form::Ydr => listed.len() == 1,
        Form::Ydd => (1..=16).contains(&listed.len()),
    };
    reader.lane.ensure(counted, say::DRAWABLE_COUNT)?;
    let mut taken = Vec::new();
    let mut drawables = listed
        .iter()
        .map(|node| reader.stock_drawable(node, form, &mut taken))
        .collect::<Result<Vec<_>>>()?;
    let donor = donor.map(str::to_owned);
    let route = match (source, drawables.pop()) {
        // Новая модель: единственная рисовалка с новой группой шейдеров.
        (None, Some(drawable)) => Route::Fresh { drawable, donor },
        (Some(source), last) => {
            drawables.extend(last);
            // У `ydr` с источником новые шейдеры пока на хосте; у словаря рисовалка заменяется целиком.
            let swapped = form == Form::Ydd || drawables.iter().all(|item| matches!(item.look, Look::Kept));
            reader.lane.ensure(swapped, say::FRESH_ON_SOURCE)?;
            Route::Stock {
                form,
                source: source.to_owned(),
                drawables,
                donor,
            }
        }
        (None, None) => return Err(reader.lane.refuse(say::NO_DRAWABLES)),
    };
    Ok(Order {
        name: name.to_owned(),
        route,
    })
}

fn donor_order(map: &Map<String, Value>) -> Result<Order> {
    let reader = Reader { lane: Lane::Donor };
    reader.lane.ensure(
        map.keys()
            .all(|key| matches!(key.as_str(), "name" | "kind" | "donor" | "drawables")),
        say::MODEL_EXTRA,
    )?;
    let name = reader.name(map, say::NO_NAME, say::BAD_NAME)?;
    reader
        .lane
        .ensure(text_of(map, "kind") == Some("ydr"), say::DONOR_KIND)?;
    let path = text_of(map, "donor").ok_or_else(|| reader.lane.refuse(say::NO_DONOR))?;
    let listed = map
        .get("drawables")
        .and_then(Value::as_array)
        .ok_or_else(|| reader.lane.refuse(say::NO_DRAWABLES))?;
    let [only] = listed.as_slice() else {
        return Err(reader.lane.refuse(say::ONE_DRAWABLE));
    };
    let (drawable, sheets) = reader.donor_drawable(only)?;
    Ok(Order {
        name: name.to_owned(),
        route: Route::Donor {
            path: path.to_owned(),
            drawable,
            sheets,
        },
    })
}

/// Модель запроса: наличие ключа `donor` (даже `null`) выбирает путь на донора; `donor` из корня запроса
/// (его кладёт `request-donor.json`) — каркас новых групп шейдеров штатного пути.
fn order_of(node: &Value, root_donor: Option<&str>) -> Result<Order> {
    let Some(map) = node.as_object() else {
        return Err(Lane::Stock.refuse(say::MODEL_EMPTY));
    };
    if map.contains_key("donor") {
        donor_order(map)
    } else {
        stock_order(map, root_donor)
    }
}

fn parse_request(bytes: &[u8]) -> Result<Vec<Order>> {
    let stock = Lane::Stock;
    stock.ensure((1..=262_144).contains(&bytes.len()), say::SIZE)?;
    let document: Value =
        serde_json::from_slice(bytes).map_err(|_| stock.refuse(say::UNREADABLE))?;
    let root = Reader { lane: stock }.object(&document, say::NOT_OBJECT)?;
    stock.ensure(
        root.keys()
            .all(|key| matches!(key.as_str(), "format" | "version" | "models" | "donor")),
        say::ROOT_EXTRA,
    )?;
    let root_donor = text_of(root, "donor");
    let versioned = root.get("version").and_then(Value::as_u64) == Some(1);
    stock.ensure(
        versioned && text_of(root, "format") == Some("astral.compile-sign-models"),
        say::FORMAT,
    )?;
    let listed = root
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| stock.refuse(say::NO_MODELS))?;
    stock.ensure((1..=80).contains(&listed.len()), say::MODEL_COUNT)?;
    listed
        .iter()
        .try_fold(Vec::new(), |mut orders: Vec<Order>, node| {
            let order = order_of(node, root_donor)?;
            stock.ensure(
                orders.iter().all(|known| known.name != order.name),
                say::TWICE,
            )?;
            orders.push(order);
            Ok(orders)
        })
}

// ---------------------------------------------------------------------------------------------
// Данные сетки и файлы
// ---------------------------------------------------------------------------------------------

/// Пределы файлов источника, донора и данных сетки.
struct Files;

impl Files {
    const MOST: u64 = 67_108_864;
    const LEAST: u64 = 16;

    fn source_fits(length: u64) -> bool {
        (Self::LEAST..=Self::MOST).contains(&length)
    }
}

/// Файл сетки: вершины по восемь `f32`, затем индексы `i32`.
fn read_grid(grid: &Grid, lane: Lane) -> Result<Mesh> {
    let meta = fs::metadata(&grid.data).map_err(|_| lane.mesh(say::DATA_MISSING))?;
    let length = meta.len();
    lane.mesh_ensure(
        length == grid.counts.file_bytes() && length <= Files::MOST,
        say::DATA_SIZE,
    )?;
    let bytes = fs::read(&grid.data).map_err(|_| lane.mesh(say::DATA_UNREADABLE))?;
    let (rows, tail) = bytes.split_at((grid.counts.vertices * Counts::VERTEX_BYTES) as usize);
    let word = |raw: &[u8]| <[u8; 4]>::try_from(raw).unwrap_or_default();
    let vertices = rows
        .chunks_exact(Counts::VERTEX_BYTES as usize)
        .map(|row| {
            let mut words = row.chunks_exact(4).map(|raw| f32::from_le_bytes(word(raw)));
            array::from_fn(|_| words.next().unwrap_or_default())
        })
        .collect();
    let indices = tail
        .chunks_exact(Counts::INDEX_BYTES as usize)
        .map(|raw| {
            u16::try_from(i32::from_le_bytes(word(raw)))
                .ok()
                .filter(|&index| u64::from(index) < grid.counts.vertices)
                .ok_or_else(|| lane.mesh(say::INDEX_OUTSIDE))
        })
        .collect::<Result<_>>()?;
    Ok(Mesh {
        shader: grid.shader,
        vertices,
        indices,
    })
}

// ---------------------------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------------------------

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Готовая модель: файл и сводка `semantic` для ответа.
struct Built {
    bytes: Vec<u8>,
    semantic: Value,
}

/// Что записано в одну рисовалку источника: после перечитывания файла это обязано сойтись.
struct Written(Vec<NewGeometry>);

fn source_bytes(path: &str) -> Result<Vec<u8>> {
    let stock = Lane::Stock;
    let length = fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|_| stock.refuse(say::SOURCE_MISSING))?;
    stock.ensure(Files::source_fits(length), say::SOURCE_SIZE)?;
    Ok(fs::read(path)?)
}

/// Рисовалка источника, на которую смотрит запрос: корень у `ydr`, запись словаря по хешу у `ydd`.
fn target_of(graph: &rgraph::Graph, hash: Option<u32>) -> Result<usize> {
    let stock = Lane::Stock;
    match hash {
        None => graph.root().ok_or_else(|| stock.refuse(say::NO_ROOT)),
        Some(hash) => {
            let index = dw::dictionary_index_of_hash(graph, hash)?
                .ok_or_else(|| stock.refuse(say::NO_SUCH_HASH))?;
            Ok(dw::drawable_at(graph, index)?)
        }
    }
}

/// Что источник готов принять: корзины шейдеров и образцы вершин по номерам шейдеров.
struct Frame {
    buckets: Vec<u8>,
    templates: HashMap<u16, usize>,
    /// У источника есть средняя, низкая или очень низкая детализация: хост их убирает (дальние планы у игры — свои сущности).
    lower: bool,
}

impl Frame {
    fn inspect(graph: &rgraph::Graph, target: usize) -> Result<Frame> {
        let stock = Lane::Stock;
        let lower = dw::has_lower_levels(graph, target)?;
        stock.ensure(!dw::has_skeleton(graph, target), say::SKELETON)?;
        let buckets =
            dw::shader_buckets(graph, target)?.ok_or_else(|| stock.refuse(say::NO_SHADERS))?;
        stock.ensure(buckets.iter().all(|&bucket| bucket < 8), say::BUCKET)?;
        let templates = dw::high_geometry_templates(graph, target)?;
        Ok(Frame {
            buckets,
            templates,
            lower,
        })
    }

    /// Маска корзин: «или» `1 << корзина` по шейдерам группы.
    fn mask(&self) -> u8 {
        self.buckets
            .iter()
            .fold(0, |mask, &bucket| mask | (1 << bucket))
    }

    /// Упаковка одной сетки по образцу её шейдера: геометрия и неокруглённые углы рамки.
    fn pack(
        &self,
        graph: &rgraph::Graph,
        grid: &Grid,
    ) -> Result<(NewGeometry, [f32; 3], [f32; 3])> {
        let stock = Lane::Stock;
        stock.ensure(
            usize::from(grid.shader) < self.buckets.len(),
            say::SHADER_OUTSIDE,
        )?;
        let template = *self
            .templates
            .get(&grid.shader)
            .ok_or_else(|| stock.refuse(say::NO_TEMPLATE))?;
        let mesh = read_grid(grid, stock)?;
        pack_sign_geometry(graph, template, &mesh).map_err(|refusal| stock.donor_refusal(refusal))
    }
}

/// Записывает сетки `drawable` в рисовалку `target` графа источника.
fn replace_in(
    graph: &mut rgraph::Graph,
    target: usize,
    drawable: &Drawable,
) -> Result<Vec<NewGeometry>> {
    let frame = Frame::inspect(graph, target)?;
    let packed = drawable
        .grids
        .iter()
        .map(|grid| frame.pack(graph, grid))
        .collect::<Result<Vec<_>>>()?;
    let (low, high) = packed.iter().fold(
        ([f32::MAX; 3], [f32::MIN; 3]),
        |(low, high), (_, corner_low, corner_high)| {
            (
                array::from_fn(|axis| low[axis].min(corner_low[axis])),
                array::from_fn(|axis| high[axis].max(corner_high[axis])),
            )
        },
    );
    let geometries: Vec<NewGeometry> = packed
        .into_iter()
        .map(|(geometry, _, _)| geometry)
        .collect();
    let root = root_of_by(
        Round::Seven,
        low,
        high,
        frame.mask(),
        drawable.tag.lod,
        geometries.len(),
    );
    dw::replace_high_model(graph, target, &geometries, &root)?;
    if frame.lower {
        dw::drop_lower_levels(graph, target)?;
    }
    Ok(geometries)
}

/// Перечитанная модель обязана содержать записанное: сетки, вершины, индексы и шейдеры.
fn verify_reopened(
    graph: &rgraph::Graph,
    name: &str,
    drawables: &[Drawable],
    written: &[Written],
) -> Result<()> {
    drawables
        .iter()
        .zip(written)
        .try_for_each(|(drawable, Written(expected))| {
            let found = dw::last_high_geometries(graph, target_of(graph, drawable.tag.hash)?)?;
            if found.len() != expected.len() {
                return Err(EngineError::invalid_data(format!(
                    "Модель надписи {name} прочиталась с другим числом сеток."
                )));
            }
            let bad = found.iter().zip(expected).position(|(seen, wrote)| {
                (&seen.vertices, &seen.indices, seen.shader)
                    != (&wrote.vertices, &wrote.indices, wrote.shader)
            });
            bad.map_or(Ok(()), |number| {
                Err(EngineError::invalid_data(format!(
                    "Сетка {number} модели надписи {name} прочиталась не так, как записана."
                )))
            })
        })
}

fn stock_semantic(
    form: Form,
    drawables: &[Drawable],
    reopened: &rgraph::Graph,
    replaced: usize,
) -> Result<Value> {
    let semantic = match form {
        Form::Ydr => {
            let grids: Vec<&Grid> = drawables
                .iter()
                .flat_map(|drawable| &drawable.grids)
                .collect();
            let vertices: u64 = grids.iter().map(|grid| grid.counts.vertices).sum();
            object([
                ("semanticReopen", true.into()),
                ("geometries", grids.len().into()),
                ("vertices", vertices.into()),
            ])
        }
        Form::Ydd => object([
            ("semanticReopen", true.into()),
            ("drawables", dw::shape(reopened)?.drawables.into()),
            ("replaced", replaced.into()),
        ]),
    };
    Ok(semantic)
}

fn build_stock(
    name: &str,
    form: Form,
    source: &str,
    drawables: &[Drawable],
    donor: Option<&str>,
) -> Result<Built> {
    let resource = Resource::parse(&source_bytes(source)?)?;
    Lane::Stock.ensure(
        kind_of(&resource) == Some(form.file_kind()),
        say::SOURCE_KIND,
    )?;
    let mut graph = rgraph::scan(&resource)?;
    let targets = drawables
        .iter()
        .map(|drawable| target_of(&graph, drawable.tag.hash))
        .collect::<Result<Vec<_>>>()?;
    let written = drawables
        .iter()
        .zip(targets)
        .map(|(drawable, target)| match &drawable.look {
            Look::Kept => replace_in(&mut graph, target, drawable).map(Written),
            Look::Fresh(_) => swap_in(&mut graph, target, drawable, donor).map(Written),
        })
        .collect::<Result<Vec<_>>>()?;
    let bytes = dw::finish_compact(&graph)?;
    let reopened = dw::graph_of(&bytes)?;
    verify_reopened(&reopened, name, drawables, &written)?;
    let semantic = stock_semantic(form, drawables, &reopened, written.len())?;
    Ok(Built { bytes, semantic })
}

/// Лист донора: DDS с полной цепочкой мипов, DXT1 или DXT5, стороны - степени двойки 4…4096.
fn sheet_of(sheet: &Sheet) -> Result<NewTexture> {
    let invalid = |text: &str| EngineError::new(TEXTURE_INVALID, text);
    let bytes = fs::read(&sheet.dds).map_err(|_| invalid(say::SHEET_MISSING))?;
    if let Some(wanted) = &sheet.sha256 {
        if *wanted != format!("sha256:{}", sha256_hex(&bytes)) {
            return Err(invalid(say::SHEET_DIGEST));
        }
    }
    let picture = dds::parse(&bytes).map_err(|_| invalid(say::SHEET_NOT_DDS))?;
    let Dds {
        width,
        height,
        levels,
        format,
        payload,
    } = picture;
    let sides = 4..=4096;
    let sound = [width, height]
        .iter()
        .all(|side| sides.contains(side) && side.is_power_of_two());
    let checks = [
        (sound, say::SHEET_SIDE),
        (
            u32::from(levels) == 32 - width.max(height).leading_zeros(),
            say::SHEET_MIPS,
        ),
        (
            matches!(format, Format::Dxt1 | Format::Dxt5),
            say::SHEET_FORMAT,
        ),
    ];
    if let Some((_, text)) = checks.iter().find(|(holds, _)| !holds) {
        return Err(invalid(text));
    }
    Ok(NewTexture {
        name: sheet.name.clone(),
        width: width as u16,
        height: height as u16,
        format,
        levels,
        payload,
    })
}

/// Донор из корня запроса: без него новая группа шейдеров не собирается (хост соберёт по своей таблице).
fn open_root_donor(path: Option<&str>) -> Result<Donor> {
    let stock = Lane::Stock;
    let path = path.ok_or_else(|| stock.refuse(say::FRESH_NO_DONOR))?;
    let length = fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|_| stock.refuse(say::FRESH_DONOR_MISSING))?;
    stock.ensure(Files::source_fits(length), say::FRESH_DONOR_SIZE)?;
    Donor::open(&fs::read(path)?).map_err(|refusal| stock.donor_refusal(refusal))
}

/// Лист новой модели штатного пути: DDS без лишнего, DXT1 или DXT5, сумма запроса сверена; отказы — «пока на хосте».
fn fresh_sheet(sheet: &Sheet) -> Result<NewTexture> {
    let stock = Lane::Stock;
    let bytes = fs::read(&sheet.dds).map_err(|_| stock.refuse(say::SHEET_MISSING.trim_end_matches('.')))?;
    if let Some(wanted) = &sheet.sha256 {
        stock.ensure(
            *wanted == format!("sha256:{}", sha256_hex(&bytes)),
            say::SHEET_DIGEST,
        )?;
    }
    // Полная цепочка листа 4096 пикселей — 13 ступеней: читаем с запасом до 8192, как хост.
    let picture = dds::parse_long_chain(&bytes).map_err(|_| stock.refuse(say::SHEET_NOT_DDS.trim_end_matches('.')))?;
    let Dds {
        width,
        height,
        levels,
        format,
        payload,
    } = picture;
    let sound = [width, height]
        .iter()
        .all(|side| (4..=4096).contains(side) && side.is_power_of_two());
    stock.ensure(sound, say::SHEET_SIDE_STOCK)?;
    stock.ensure(
        u32::from(levels) == 32 - width.max(height).leading_zeros(),
        say::SHEET_MIPS.trim_end_matches('.'),
    )?;
    stock.ensure(
        matches!(format, Format::Dxt1 | Format::Dxt5),
        say::SHEET_FORMAT.trim_end_matches('.'),
    )?;
    Ok(NewTexture {
        name: sheet.name.clone(),
        width: width as u16,
        height: height as u16,
        format,
        levels,
        payload,
    })
}

/// Шейдеры новой группы по пресетам хоста: корзина `1` у `alpha.sps` и `emissive_alpha.sps`, `HardAlphaBlend` у обычного
/// равен корзине, у светящегося 1.
fn fresh_shaders(shaders: &[Shading]) -> Vec<SignShader> {
    shaders
        .iter()
        .map(|shading| {
            let alpha = matches!(shading.file.as_str(), "alpha.sps" | "emissive_alpha.sps");
            let glowing = shading.name == "emissive";
            SignShader {
                spec: ShaderSpec {
                    name: shading.name.clone(),
                    file: shading.file.clone(),
                    alpha,
                    emissive: shading.emissive,
                },
                hard_alpha: if glowing || alpha { 1.0 } else { 0.0 },
                texture: shading.texture.clone(),
            }
        })
        .collect()
}

/// Всё, что нужно собрать рисовалку с новой группой шейдеров: донор, шейдеры, листы и посчитанные геометрии.
struct FreshParts {
    donor: Donor,
    shaders: Vec<SignShader>,
    sheets: Vec<NewTexture>,
    packed: Packed,
}

/// Подготовка рисовалки с новой группой: донор из корня запроса, шейдеры по пресетам хоста, листы с проверкой сумм и
/// сетки по образцу раскладки донора. `lod` — дальность, которую получит рисовалка.
fn prepare_fresh(drawable: &Drawable, donor_path: Option<&str>, lod: f32) -> Result<FreshParts> {
    let stock = Lane::Stock;
    let Look::Fresh(fresh) = &drawable.look else {
        return Err(stock.refuse(say::KEEP_SHADERS));
    };
    let donor = open_root_donor(donor_path)?;
    let shaders = fresh_shaders(&fresh.shaders);
    let sheets = fresh
        .sheets
        .iter()
        .map(fresh_sheet)
        .collect::<Result<Vec<_>>>()?;
    let meshes = drawable
        .grids
        .iter()
        .map(|grid| {
            stock.ensure(
                usize::from(grid.shader) < shaders.len(),
                say::SHADER_NOT_LISTED,
            )?;
            read_grid(grid, stock)
        })
        .collect::<Result<Vec<_>>>()?;
    let mask = shaders
        .iter()
        .fold(0u8, |mask, shader| mask | 1 << u8::from(shader.spec.alpha));
    let packed = donor
        .pack_sign(&meshes, 0, mask, Some(lod))
        .map_err(|refusal| stock.donor_refusal(refusal))?;
    Ok(FreshParts {
        donor,
        shaders,
        sheets,
        packed,
    })
}

/// Новая модель `ydr` без источника на каркасе донора из корня запроса. Дальность по умолчанию - как у хоста (100).
fn build_fresh(name: &str, drawable: &Drawable, donor_path: Option<&str>) -> Result<Built> {
    let parts = prepare_fresh(drawable, donor_path, drawable.tag.lod.unwrap_or(100.0))?;
    let bytes = parts
        .donor
        .apply_sign(&parts.packed, &parts.shaders, &parts.sheets, 0, Some(name))
        .map_err(|refusal| Lane::Stock.donor_refusal(refusal))?;
    let semantic = object([
        ("semanticReopen", true.into()),
        ("geometries", parts.packed.geometries.len().into()),
        ("vertices", parts.packed.vertices.into()),
    ]);
    Ok(Built { bytes, semantic })
}

/// Рисовалка словаря с новой группой шейдеров: прежняя заменяется целиком, хеш и имя (если оно есть) остаются.
fn swap_in(
    graph: &mut rgraph::Graph,
    target: usize,
    drawable: &Drawable,
    donor_path: Option<&str>,
) -> Result<Vec<NewGeometry>> {
    let stock = Lane::Stock;
    let hash = drawable
        .tag
        .hash
        .ok_or_else(|| stock.refuse(say::YDD_NO_HASH))?;
    // Без своей дальности хост оставляет прежние четыре; здесь такое пока на хосте.
    let lod = drawable
        .tag
        .lod
        .ok_or_else(|| stock.refuse(say::FRESH_NO_LOD))?;
    let index = dw::dictionary_index_of_hash(graph, hash)?
        .ok_or_else(|| stock.refuse(say::NO_SUCH_HASH))?;
    let parts = prepare_fresh(drawable, donor_path, lod)?;
    let old_name = rage_res::donor::drawable_name(graph, target);
    let naming = old_name
        .as_deref()
        .map_or(Naming::Dropped, Naming::Named);
    let fresh = parts
        .donor
        .sign_drawable_graph(&parts.packed, &parts.shaders, &parts.sheets, 0, naming)
        .map_err(|refusal| stock.donor_refusal(refusal))?;
    dw::swap_dictionary_drawable(graph, index, &fresh)?;
    Ok(parts.packed.geometries)
}

fn build_donor(path: &str, drawable: &Drawable, sheets: &[Sheet]) -> Result<Built> {
    let lane = Lane::Donor;
    let length = fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|_| EngineError::new("sign-donor-missing", say::DONOR_MISSING))?;
    if !Files::source_fits(length) {
        return Err(EngineError::new("sign-donor-not-drawable", say::DONOR_SIZE));
    }
    let donor = Donor::open(&fs::read(path)?).map_err(|refusal| lane.donor_refusal(refusal))?;
    let meshes = drawable
        .grids
        .iter()
        .map(|grid| read_grid(grid, lane))
        .collect::<Result<Vec<_>>>()?;
    let packed = donor
        .pack(&meshes, drawable.tag.lod)
        .map_err(|refusal| lane.donor_refusal(refusal))?;
    let textures = sheets.iter().map(sheet_of).collect::<Result<Vec<_>>>()?;
    let bytes = donor
        .apply(&packed, &textures)
        .map_err(|refusal| lane.donor_refusal(refusal))?;
    let semantic = object([
        ("semanticReopen", true.into()),
        ("geometries", packed.geometries.len().into()),
        ("vertices", packed.vertices.into()),
        ("textures", textures.len().into()),
    ]);
    Ok(Built { bytes, semantic })
}

fn build(order: &Order) -> Result<(Built, &'static str)> {
    match &order.route {
        Route::Stock {
            form,
            source,
            drawables,
            donor,
        } => {
            let built = build_stock(&order.name, *form, source, drawables, donor.as_deref())?;
            Ok((built, form.extension()))
        }
        Route::Fresh { drawable, donor } => Ok((
            build_fresh(&order.name, drawable, donor.as_deref())?,
            Form::Ydr.extension(),
        )),
        Route::Donor {
            path,
            drawable,
            sheets,
        } => Ok((build_donor(path, drawable, sheets)?, Form::Ydr.extension())),
    }
}

// ---------------------------------------------------------------------------------------------
// Команда
// ---------------------------------------------------------------------------------------------

/// Папка вывода: нет или пуста; создаётся до сборки и остаётся при отказе сборки.
fn open_output(options: &Options) -> Result<PathBuf> {
    let folder = paths::full_path(options.required("output")?)?;
    let taken = folder.exists() && (!folder.is_dir() || fs::read_dir(&folder)?.next().is_some());
    Lane::Stock.ensure(!taken, say::OUTPUT_BUSY)?;
    fs::create_dir_all(&folder)?;
    Ok(folder)
}

fn file_row(folder: &Path, name: &str, extension: &str, built: Built) -> Result<Value> {
    let file = format!("{name}.{extension}");
    write_atomic(&folder.join(&file), &built.bytes)?;
    Ok(object([
        ("file", file.into()),
        ("bytes", built.bytes.len().into()),
        ("sha256", sha256_hex(&built.bytes).into()),
        ("semantic", built.semantic),
    ]))
}

/// Ответ команды: формат, версия, кто собрал и строки файлов по порядку моделей.
fn report_of(rows: Vec<Value>) -> Value {
    object([
        ("format", "astral.sign-models".into()),
        ("version", 1.into()),
        ("exportedBy", "Astral Sign Models 1".into()),
        ("files", rows.into()),
    ])
}

pub fn compile_sign_models(options: &Options, _progress: &Progress) -> Result<Value> {
    let orders = parse_request(&fs::read(options.required("input")?)?)?;
    let folder = open_output(options)?;
    let built = orders.iter().map(build).collect::<Result<Vec<_>>>()?;
    let rows = orders
        .iter()
        .zip(built)
        .map(|(order, (model, extension))| file_row(&folder, &order.name, extension, model))
        .collect::<Result<Vec<_>>>()?;
    Ok(report_of(rows))
}

const COMPILE_SIGN_MODELS: Command = Command::new("compile-sign-models", compile_sign_models);

pub const COMMANDS: &[Command] = &[COMPILE_SIGN_MODELS];

#[cfg(test)]
mod tests;
