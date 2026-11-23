//! `patch-animal-model`: метка над животным и свечение — новой геометрией в словаре моделей педа
//! (`a_c_boar.ydd`, `head_000_r.ydd` собаки…). Вызов: `patch-animal-model --input <запрос.json> --output <.ydd>`.
//!
//! Запрос:
//! `{ format: "astral.animal-model", version: 1, input, output?, marker?: { drawable, positions, uvs, indices,
//! normals?, texture, emissive }, glow?: { drawables, inflate, texture, emissive } }`. Нужна хотя бы одна из частей.
//! Ответ: `status`, `file`, `output`, `bytes`, `sha256`, `input { bytes, sha256 }` и `semantic` — по каждой
//! изменённой рисовалке уровни (геометрий было и стало, сколько оболочек и меток, маска уровня до и после),
//! шейдеры, листы и рамки до и после. Сама правка — `rage_res::animal_model`; здесь разбор запроса теми же
//! словами отказов, что у хоста, проверка листов DDS, запись результата и ответ.
//!
//! Разбор запроса повторяет строгий разбор хоста: имена полей в `camelCase` и с учётом регистра, лишних полей
//! нет, глубина не больше восьми, типы строгие. Тексты отказов разбора — те же, что у хоста (включая строку и
//! позицию в ней), кроме редких синтаксических ошибок, которые называются своими словами.

use std::{fs, path::Path};

use rage_res::{
    animal_model::{self, Glow, Marker, Patched, Refusal, Sheet},
    drawable_write::float_value,
    hash::sha256_hex,
    resource,
};
use serde_json::{json, Map, Value};

use super::{shop, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const REQUEST_FORMAT: &str = "astral.animal-model";
const REQUEST_VERSION: i32 = 1;
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_MODEL_BYTES: usize = 64 * 1024 * 1024;
const MAX_DDS_BYTES: u64 = 2 * 1024 * 1024;
/// Метка — маленькая картинка-значок, а не модель: пределы с запасом, но с потолком.
const MAX_MARKER_VERTICES: usize = 20_000;
const MAX_EXTENT: f32 = 64.0;
const MAX_UV: f32 = 64.0;
const MAX_EMISSIVE: f32 = 16.0;
const MAX_INFLATE: f32 = 0.5;
const MAX_GLOW_DRAWABLES: usize = 64;
const MAX_DEPTH: usize = 8;
const HOST_TYPE: &str = "Modovik.Native.Host.PatchAnimalModelCommands+";

pub const COMMANDS: &[Command] = &[Command::new("patch-animal-model", patch_animal_model)];

fn refusal(text: impl Into<String>) -> EngineError {
    EngineError::invalid_data(text)
}

impl From<Refusal> for EngineError {
    fn from(error: Refusal) -> Self {
        EngineError::invalid_data(error.0)
    }
}

/// Пустой путь у `Path.GetFullPath`: так он отказывает у хоста.
fn empty_path() -> EngineError {
    EngineError::argument("The path is empty. (Parameter 'path')")
}

/// Полный путь, как его даёт `Path.GetFullPath`: пустой и пробельный отказывают.
fn full_path(text: &str) -> Result<std::path::PathBuf> {
    if text.chars().all(char::is_whitespace) {
        return Err(empty_path());
    }
    paths::full_path(text)
}

fn same_path(left: &Path, right: &Path) -> bool {
    left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
}

fn ends_with_ydd(path: &Path) -> bool {
    path.to_string_lossy().to_lowercase().ends_with(".ydd")
}

// ---------------------------------------------------------------------------------------------------------------
// Строгий разбор JSON с позициями: хост сообщает путь, строку и позицию в строке
// ---------------------------------------------------------------------------------------------------------------

/// Узел разобранного запроса: значение и место, которое хост называет в отказе (конец значения, у контейнеров —
/// сразу за открывающей скобкой).
struct Node {
    kind: Kind,
    at: usize,
}

enum Kind {
    Null,
    Bool,
    Number(String),
    Text(String),
    List(Vec<Node>),
    Object(Vec<(String, Node)>),
}

struct Source<'a> {
    bytes: &'a [u8],
}

impl Source<'_> {
    /// Строка и позиция в строке (в байтах) для смещения.
    fn place(&self, at: usize) -> (usize, usize) {
        let head = &self.bytes[..at.min(self.bytes.len())];
        let line = head.iter().filter(|&&b| b == b'\n').count();
        let start = head
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(0, |found| found + 1);
        (line, head.len() - start)
    }

    fn tail(&self, at: usize, path: &str) -> String {
        let (line, column) = self.place(at);
        format!("Path: {path} | LineNumber: {line} | BytePositionInLine: {column}.")
    }
}

fn hex_or_char(byte: u8) -> String {
    if (0x20..0x7f).contains(&byte) {
        (byte as char).to_string()
    } else {
        format!("0x{byte:02X}")
    }
}

struct Parser<'a> {
    source: Source<'a>,
    at: usize,
}

type Parsed<T> = std::result::Result<T, String>;

impl Parser<'_> {
    fn syntax(&self, text: &str, path: &str) -> String {
        format!("{text} {}", self.source.tail(self.at, path))
    }

    fn skip(&mut self) {
        while matches!(
            self.source.bytes.get(self.at),
            Some(b' ' | b'\t' | b'\r' | b'\n')
        ) {
            self.at += 1;
        }
    }

    fn value(&mut self, path: &str, depth: usize) -> Parsed<Node> {
        self.skip();
        let Some(&byte) = self.source.bytes.get(self.at) else {
            return Err(self.syntax("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed.", path));
        };
        match byte {
            b'{' | b'[' => {
                if depth >= MAX_DEPTH {
                    return Err(self.syntax(&format!("The maximum configured depth of {MAX_DEPTH} has been exceeded. Cannot read next JSON object."), path));
                }
                if byte == b'{' {
                    self.object(path, depth)
                } else {
                    self.list(path, depth)
                }
            }
            b'"' => {
                let text = self.string(path)?;
                Ok(Node {
                    kind: Kind::Text(text),
                    at: self.at,
                })
            }
            b't' | b'f' | b'n' => self.literal(path),
            b'-' | b'0'..=b'9' => self.number(path),
            other => Err(self.syntax(
                &format!("'{}' is an invalid start of a value.", hex_or_char(other)),
                path,
            )),
        }
    }

    fn literal(&mut self, path: &str) -> Parsed<Node> {
        for (word, kind) in [
            ("true", Kind::Bool),
            ("false", Kind::Bool),
            ("null", Kind::Null),
        ] {
            if self.source.bytes[self.at..].starts_with(word.as_bytes()) {
                self.at += word.len();
                return Ok(Node { kind, at: self.at });
            }
        }
        let byte = self.source.bytes[self.at];
        Err(self.syntax(
            &format!("'{}' is an invalid start of a value.", hex_or_char(byte)),
            path,
        ))
    }

    fn number(&mut self, path: &str) -> Parsed<Node> {
        let start = self.at;
        let bytes = self.source.bytes;
        let mut at = start;
        if bytes.get(at) == Some(&b'-') {
            at += 1;
        }
        let digits = |from: usize| {
            bytes[from..]
                .iter()
                .take_while(|b| b.is_ascii_digit())
                .count()
        };
        match bytes.get(at) {
            Some(b'0') => at += 1,
            Some(b'1'..=b'9') => at += digits(at),
            _ => {
                self.at = at;
                return Err(self.syntax("Expected a digit.", path));
            }
        }
        if bytes.get(at) == Some(&b'.') {
            let count = digits(at + 1);
            if count == 0 {
                self.at = at + 1;
                return Err(self.syntax("Expected a digit after the decimal point.", path));
            }
            at += 1 + count;
        }
        if matches!(bytes.get(at), Some(b'e' | b'E')) {
            let mut next = at + 1;
            if matches!(bytes.get(next), Some(b'+' | b'-')) {
                next += 1;
            }
            let count = digits(next);
            if count == 0 {
                self.at = next;
                return Err(self.syntax("Expected a digit in the exponent.", path));
            }
            at = next + count;
        }
        self.at = at;
        Ok(Node {
            kind: Kind::Number(String::from_utf8_lossy(&bytes[start..at]).into_owned()),
            at,
        })
    }

    fn string(&mut self, path: &str) -> Parsed<String> {
        let bytes = self.source.bytes;
        let mut out: Vec<u8> = Vec::new();
        self.at += 1;
        loop {
            let Some(&byte) = bytes.get(self.at) else {
                return Err(self.syntax("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed.", path));
            };
            self.at += 1;
            match byte {
                b'"' => break,
                b'\\' => {
                    let Some(&escape) = bytes.get(self.at) else {
                        continue;
                    };
                    self.at += 1;
                    match escape {
                        b'"' | b'\\' | b'/' => out.push(escape),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let hex = bytes
                                .get(self.at..self.at + 4)
                                .and_then(|part| std::str::from_utf8(part).ok())
                                .and_then(|text| u16::from_str_radix(text, 16).ok());
                            let Some(mut unit) = hex.map(u32::from) else {
                                return Err(
                                    self.syntax("'\\u' is followed by invalid hex digits.", path)
                                );
                            };
                            self.at += 4;
                            if (0xd800..0xdc00).contains(&unit)
                                && bytes.get(self.at..self.at + 2) == Some(b"\\u")
                            {
                                let low = bytes
                                    .get(self.at + 2..self.at + 6)
                                    .and_then(|part| std::str::from_utf8(part).ok())
                                    .and_then(|text| u16::from_str_radix(text, 16).ok());
                                if let Some(low) = low.filter(|low| (0xdc00..0xe000).contains(low))
                                {
                                    unit = 0x10000
                                        + ((unit - 0xd800) << 10)
                                        + (u32::from(low) - 0xdc00);
                                    self.at += 6;
                                }
                            }
                            let mut buffer = [0u8; 4];
                            out.extend_from_slice(
                                char::from_u32(unit)
                                    .unwrap_or('\u{fffd}')
                                    .encode_utf8(&mut buffer)
                                    .as_bytes(),
                            );
                        }
                        _ => {
                            return Err(self.syntax(
                                &format!(
                                    "'{}' is an invalid escapable character within a JSON string.",
                                    hex_or_char(escape)
                                ),
                                path,
                            ))
                        }
                    }
                }
                0..=0x1f => {
                    self.at -= 1;
                    return Err(self.syntax(&format!("'{}' is invalid within a JSON string. The string should be correctly escaped.", hex_or_char(byte)), path));
                }
                other => out.push(other),
            }
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    fn list(&mut self, path: &str, depth: usize) -> Parsed<Node> {
        let opened = self.at + 1;
        self.at += 1;
        let mut items = Vec::new();
        self.skip();
        if self.source.bytes.get(self.at) == Some(&b']') {
            self.at += 1;
            return Ok(Node {
                kind: Kind::List(items),
                at: opened,
            });
        }
        loop {
            let item = self.value(&format!("{path}[{}]", items.len()), depth + 1)?;
            items.push(item);
            self.skip();
            match self.source.bytes.get(self.at) {
                Some(b',') => {
                    self.at += 1;
                    self.skip();
                    if self.source.bytes.get(self.at) == Some(&b']') {
                        return Err(self.syntax("The JSON array contains a trailing comma at the end which is not supported in this mode. Change the reader options.", path));
                    }
                }
                Some(b']') => {
                    self.at += 1;
                    return Ok(Node { kind: Kind::List(items), at: opened });
                }
                Some(&other) => return Err(self.syntax(&format!("'{}' is invalid after a value. Expected either ',', '}}', or ']'.", hex_or_char(other)), path)),
                None => return Err(self.syntax("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed.", path)),
            }
        }
    }

    fn object(&mut self, path: &str, depth: usize) -> Parsed<Node> {
        let opened = self.at + 1;
        self.at += 1;
        let mut entries: Vec<(String, Node)> = Vec::new();
        self.skip();
        if self.source.bytes.get(self.at) == Some(&b'}') {
            self.at += 1;
            return Ok(Node {
                kind: Kind::Object(entries),
                at: opened,
            });
        }
        loop {
            self.skip();
            if self.source.bytes.get(self.at) != Some(&b'"') {
                return Err(match self.source.bytes.get(self.at) {
                    Some(&other) => self.syntax(&format!("'{}' is an invalid start of a property name. Expected a '\"'.", hex_or_char(other)), path),
                    None => self.syntax("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed.", path),
                });
            }
            let name = self.string(path)?;
            self.skip();
            if self.source.bytes.get(self.at) != Some(&b':') {
                return Err(match self.source.bytes.get(self.at) {
                    Some(&other) => self.syntax(&format!("'{}' is invalid after a property name. Expected a ':'.", hex_or_char(other)), path),
                    None => self.syntax("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed.", path),
                });
            }
            self.at += 1;
            let value = self.value(&format!("{path}.{name}"), depth + 1)?;
            entries.push((name, value));
            self.skip();
            match self.source.bytes.get(self.at) {
                Some(b',') => {
                    self.at += 1;
                    self.skip();
                    if self.source.bytes.get(self.at) == Some(&b'}') {
                        return Err(self.syntax("The JSON object contains a trailing comma at the end which is not supported in this mode. Change the reader options.", path));
                    }
                }
                Some(b'}') => {
                    self.at += 1;
                    return Ok(Node { kind: Kind::Object(entries), at: opened });
                }
                Some(&other) => return Err(self.syntax(&format!("'{}' is invalid after a property value. Expected either ',' or '}}'.", hex_or_char(other)), path)),
                None => return Err(self.syntax("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed.", path)),
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Типизированный запрос
// ---------------------------------------------------------------------------------------------------------------

#[derive(Default)]
struct AnimalRequest {
    format: Option<String>,
    version: i32,
    input: Option<String>,
    output: Option<String>,
    marker: Option<MarkerRequest>,
    glow: Option<GlowRequest>,
}

#[derive(Default)]
struct MarkerRequest {
    drawable: u32,
    positions: Option<Vec<f32>>,
    normals: Option<Vec<f32>>,
    uvs: Option<Vec<f32>>,
    indices: Option<Vec<i32>>,
    texture: Option<String>,
    emissive: Option<f32>,
}

#[derive(Default)]
struct GlowRequest {
    drawables: Option<Vec<u32>>,
    inflate: Option<f32>,
    texture: Option<String>,
    emissive: Option<f32>,
}

/// Отказ преобразования значения: хост называет тип, путь и место.
struct Convert<'s> {
    source: &'s Source<'s>,
}

impl Convert<'_> {
    fn fail(&self, target: &str, path: &str, node: &Node) -> String {
        format!(
            "The JSON value could not be converted to {target}. {}",
            self.source.tail(node.at, path)
        )
    }

    fn unmapped(&self, name: &str, owner: &str) -> String {
        format!("The JSON property '{name}' could not be mapped to any .NET member contained in type '{HOST_TYPE}{owner}'.")
    }

    fn text(&self, node: &Node, owner: &str, path: &str) -> Parsed<Option<String>> {
        match &node.kind {
            Kind::Null => Ok(None),
            Kind::Text(text) => Ok(Some(text.clone())),
            _ => Err(self.fail(&format!("{HOST_TYPE}{owner}"), path, node)),
        }
    }

    fn integer<T: std::str::FromStr>(&self, node: &Node, target: &str, path: &str) -> Parsed<T> {
        match &node.kind {
            Kind::Number(text) if !text.contains(['.', 'e', 'E']) => {
                text.parse::<T>().map_err(|_| self.fail(target, path, node))
            }
            _ => Err(self.fail(target, path, node)),
        }
    }

    fn real(&self, node: &Node, target: &str, path: &str) -> Parsed<f32> {
        match &node.kind {
            Kind::Number(text) => text
                .parse::<f32>()
                .map_err(|_| self.fail(target, path, node)),
            _ => Err(self.fail(target, path, node)),
        }
    }

    fn real_or_null(&self, node: &Node, owner: &str, path: &str) -> Parsed<Option<f32>> {
        match &node.kind {
            Kind::Null => Ok(None),
            _ => self
                .real(node, &format!("{HOST_TYPE}{owner}"), path)
                .map(Some),
        }
    }

    /// Массив чисел: не массив — отказ с типом массива, неверный элемент — с типом элемента.
    fn list<T>(
        &self,
        node: &Node,
        array: &str,
        element: impl Fn(&Node, &str) -> Parsed<T>,
        path: &str,
    ) -> Parsed<Option<Vec<T>>> {
        match &node.kind {
            Kind::Null => Ok(None),
            Kind::List(items) => items
                .iter()
                .enumerate()
                .map(|(k, item)| element(item, &format!("{path}[{k}]")))
                .collect::<Parsed<Vec<T>>>()
                .map(Some),
            _ => Err(self.fail(array, path, node)),
        }
    }

    fn marker(&self, node: &Node) -> Parsed<Option<MarkerRequest>> {
        let Kind::Object(entries) = &node.kind else {
            return if matches!(node.kind, Kind::Null) {
                Ok(None)
            } else {
                Err(self.fail(&format!("{HOST_TYPE}MarkerRequest"), "$.marker", node))
            };
        };
        let mut marker = MarkerRequest::default();
        for (name, value) in entries {
            let path = format!("$.marker.{name}");
            match name.as_str() {
                "drawable" => {
                    marker.drawable =
                        self.integer(value, &format!("{HOST_TYPE}MarkerRequest"), &path)?
                }
                "positions" => {
                    marker.positions = self.list(
                        value,
                        "System.Single[]",
                        |n, p| self.real(n, "System.Single", p),
                        &path,
                    )?
                }
                "normals" => {
                    marker.normals = self.list(
                        value,
                        "System.Single[]",
                        |n, p| self.real(n, "System.Single", p),
                        &path,
                    )?
                }
                "uvs" => {
                    marker.uvs = self.list(
                        value,
                        "System.Single[]",
                        |n, p| self.real(n, "System.Single", p),
                        &path,
                    )?
                }
                "indices" => {
                    marker.indices = self.list(
                        value,
                        "System.Int32[]",
                        |n, p| self.integer::<i32>(n, "System.Int32", p),
                        &path,
                    )?
                }
                "texture" => marker.texture = self.text(value, "MarkerRequest", &path)?,
                "emissive" => marker.emissive = self.real_or_null(value, "MarkerRequest", &path)?,
                _ => return Err(self.unmapped(name, "MarkerRequest")),
            }
        }
        Ok(Some(marker))
    }

    fn glow(&self, node: &Node) -> Parsed<Option<GlowRequest>> {
        let Kind::Object(entries) = &node.kind else {
            return if matches!(node.kind, Kind::Null) {
                Ok(None)
            } else {
                Err(self.fail(&format!("{HOST_TYPE}GlowRequest"), "$.glow", node))
            };
        };
        let mut glow = GlowRequest::default();
        for (name, value) in entries {
            let path = format!("$.glow.{name}");
            match name.as_str() {
                "drawables" => {
                    glow.drawables = self.list(
                        value,
                        "System.UInt32[]",
                        |n, p| self.integer::<u32>(n, "System.UInt32", p),
                        &path,
                    )?
                }
                "inflate" => glow.inflate = self.real_or_null(value, "GlowRequest", &path)?,
                "texture" => glow.texture = self.text(value, "GlowRequest", &path)?,
                "emissive" => glow.emissive = self.real_or_null(value, "GlowRequest", &path)?,
                _ => return Err(self.unmapped(name, "GlowRequest")),
            }
        }
        Ok(Some(glow))
    }

    fn request(&self, node: &Node) -> Parsed<Option<AnimalRequest>> {
        let Kind::Object(entries) = &node.kind else {
            return if matches!(node.kind, Kind::Null) {
                Ok(None)
            } else {
                Err(self.fail(&format!("{HOST_TYPE}AnimalRequest"), "$", node))
            };
        };
        let mut request = AnimalRequest::default();
        for (name, value) in entries {
            let path = format!("$.{name}");
            match name.as_str() {
                "format" => request.format = self.text(value, "AnimalRequest", &path)?,
                "version" => {
                    request.version =
                        self.integer(value, &format!("{HOST_TYPE}AnimalRequest"), &path)?
                }
                "input" => request.input = self.text(value, "AnimalRequest", &path)?,
                "output" => request.output = self.text(value, "AnimalRequest", &path)?,
                "marker" => request.marker = self.marker(value)?,
                "glow" => request.glow = self.glow(value)?,
                _ => return Err(self.unmapped(name, "AnimalRequest")),
            }
        }
        Ok(Some(request))
    }
}

/// Запрос из байт: `None` — в файле `null`.
fn parse_request(bytes: &[u8]) -> Parsed<Option<AnimalRequest>> {
    let mut parser = Parser {
        source: Source { bytes },
        at: 0,
    };
    let node = parser.value("$", 0)?;
    parser.skip();
    if let Some(&extra) = bytes.get(parser.at) {
        return Err(parser.syntax(
            &format!(
                "'{}' is invalid after a single JSON value. Expected end of data.",
                hex_or_char(extra)
            ),
            "$",
        ));
    }
    Convert {
        source: &parser.source,
    }
    .request(&node)
}

// ---------------------------------------------------------------------------------------------------------------
// Проверка значений
// ---------------------------------------------------------------------------------------------------------------

/// Число из списка текста хоста: целое печатается без запятой, дробное — с запятой (язык ru хоста).
fn host_number(value: f32) -> String {
    let mut text = format!("{value}");
    if text.contains('.') {
        text = text.replace('.', ",");
    }
    text
}

fn check_emissive(label: &str, value: Option<f32>) -> Result<f32> {
    match value.filter(|v| v.is_finite() && (0.0..=MAX_EMISSIVE).contains(v)) {
        Some(value) => Ok(value),
        None => Err(refusal(format!(
            "{label}: emissive — число от 0 до {}.",
            host_number(MAX_EMISSIVE)
        ))),
    }
}

/// Лист цвета: DXT5, степень двойки 4–1024; для листа больше 4×4 нужна полная цепочка mip (меньше — игра рисует
/// его серыми ступенями), для 4×4 допустим и один уровень. Заголовок и размер должны сходиться байт в байт.
fn read_sheet(label: &str, name: &'static str, path: Option<&str>) -> Result<Sheet> {
    let Some(path) = path.filter(|text| !text.chars().all(char::is_whitespace)) else {
        return Err(refusal(format!("{label}: не указан лист цвета (texture).")));
    };
    let file = full_path(path)?;
    if !file.is_file() {
        return Err(EngineError::file_not_found(format!(
            "{label}: лист цвета не найден: {}",
            file.display()
        )));
    }
    let meta = fs::symlink_metadata(&file)?;
    let reparse = meta.file_type().is_symlink() || reparse_point(&meta);
    if reparse || !(128..=MAX_DDS_BYTES).contains(&meta.len()) {
        return Err(refusal(format!(
            "{label}: лист цвета — небезопасный тип или размер файла."
        )));
    }
    let bytes = fs::read(&file)?;
    if bytes.get(0..4) != Some(b"DDS ") || bytes.get(84..88) != Some(b"DXT5") {
        return Err(refusal(format!(
            "{label}: лист цвета должен быть DDS в формате DXT5."
        )));
    }
    let word = |at: usize| i32::from_le_bytes(bytes[at..at + 4].try_into().expect("четыре байта"));
    let (height, width, levels) = (word(12), word(16), word(28).max(1));
    let side_ok = |side: i32| (4..=1024).contains(&side) && side & (side - 1) == 0;
    if !side_ok(width) || !side_ok(height) {
        return Err(refusal(format!(
            "{label}: лист цвета — степень двойки от 4 до 1024 по обеим сторонам."
        )));
    }
    let full = (32 - width.max(height).leading_zeros()) as i32;
    if levels > full || (levels != full && (width > 4 || height > 4)) {
        return Err(refusal(format!("{label}: у листа {width}x{height} нужна полная цепочка mip ({full} уровней), а в файле {levels}.")));
    }
    let payload: usize = (0..levels)
        .map(|level| {
            ((width >> level).max(1) as usize + 3) / 4
                * (((height >> level).max(1) as usize + 3) / 4)
                * 16
        })
        .sum();
    if bytes.len() != 128 + payload {
        return Err(refusal(format!(
            "{label}: файл листа обрезан или с лишним хвостом."
        )));
    }
    Ok(Sheet {
        name,
        width: width as u16,
        height: height as u16,
        levels: levels as u8,
        payload: bytes[128..].to_vec(),
    })
}

#[cfg(windows)]
fn reparse_point(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn reparse_point(_: &fs::Metadata) -> bool {
    false
}

fn valid_marker(request: &MarkerRequest) -> Result<Marker> {
    if request.drawable == 0 {
        return Err(refusal("Метка: не указан drawable (хэш имени)."));
    }
    let positions = request.positions.clone().unwrap_or_default();
    let uvs = request.uvs.clone().unwrap_or_default();
    let indices = request.indices.clone().unwrap_or_default();
    let count = positions.len() / 3;
    if count < 3 || count > MAX_MARKER_VERTICES || positions.len() != count * 3 {
        return Err(refusal(format!(
            "Метка: нужно от 3 до {MAX_MARKER_VERTICES} вершин (positions — тройки чисел)."
        )));
    }
    if uvs.len() != count * 2 {
        return Err(refusal(
            "Метка: развёрток (uvs) должно быть по паре чисел на вершину.",
        ));
    }
    if indices.len() < 3
        || indices.len() % 3 != 0
        || indices
            .iter()
            .any(|&value| value < 0 || value as usize >= count)
    {
        return Err(refusal(
            "Метка: индексы (indices) — тройки номеров вершин внутри сетки.",
        ));
    }
    if positions
        .iter()
        .any(|v| !v.is_finite() || v.abs() > MAX_EXTENT)
    {
        return Err(refusal(format!(
            "Метка: позиции должны быть конечными и в пределах ±{} м.",
            host_number(MAX_EXTENT)
        )));
    }
    if uvs.iter().any(|v| !v.is_finite() || v.abs() > MAX_UV) {
        return Err(refusal("Метка: развёртка вне разумной сетки повторов."));
    }
    let normals = match &request.normals {
        Some(normals) => {
            if normals.len() != positions.len()
                || normals.iter().any(|v| !v.is_finite() || v.abs() > 1.01)
            {
                return Err(refusal(
                    "Метка: нормали (normals) — тройки на вершину, длиной не больше единицы.",
                ));
            }
            normals.clone()
        }
        None => animal_model::smooth_normals(
            &positions,
            &indices.iter().map(|&i| i as usize).collect::<Vec<_>>(),
        ),
    };
    let emissive = check_emissive("Метка", request.emissive)?;
    let sheet = read_sheet(
        "Метка",
        animal_model::MARKER_TEXTURE,
        request.texture.as_deref(),
    )?;
    Ok(Marker {
        drawable: request.drawable,
        positions,
        normals,
        uvs,
        indices: indices.iter().map(|&i| i as u16).collect(),
        sheet,
        emissive,
    })
}

fn valid_glow(request: &GlowRequest) -> Result<Glow> {
    let drawables = request.drawables.clone().unwrap_or_default();
    if drawables.is_empty() || drawables.len() > MAX_GLOW_DRAWABLES {
        return Err(refusal(format!(
            "Свечение: нужен список из 1–{MAX_GLOW_DRAWABLES} drawable (drawables)."
        )));
    }
    let mut distinct = drawables.clone();
    distinct.sort_unstable();
    distinct.dedup();
    if distinct.len() != drawables.len() || distinct.first() == Some(&0) {
        return Err(refusal(
            "Свечение: хэши drawable должны быть ненулевыми и не повторяться.",
        ));
    }
    let Some(inflate) = request
        .inflate
        .filter(|v| v.is_finite() && *v > 0.0 && *v <= MAX_INFLATE)
    else {
        return Err(refusal(format!(
            "Свечение: inflate — число метров больше нуля и не больше {}.",
            host_number(MAX_INFLATE)
        )));
    };
    let emissive = check_emissive("Свечение", request.emissive)?;
    let sheet = read_sheet(
        "Свечение",
        animal_model::GLOW_TEXTURE,
        request.texture.as_deref(),
    )?;
    Ok(Glow {
        drawables,
        inflate,
        sheet,
        emissive,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// Команда
// ---------------------------------------------------------------------------------------------------------------

fn read_request(input: &str) -> Result<AnimalRequest> {
    let path = full_path(input)?;
    let bytes = fs::read(&path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound if path.parent().is_some_and(|parent| !parent.exists()) => {
            EngineError::directory_not_found(format!(
                "Could not find a part of the path '{}'.",
                path.display()
            ))
        }
        std::io::ErrorKind::NotFound => {
            EngineError::file_not_found(format!("Could not find file '{}'.", path.display()))
        }
        _ => EngineError::from(error),
    })?;
    if bytes.is_empty() || bytes.len() > MAX_REQUEST_BYTES {
        return Err(refusal(format!(
            "Запрос должен быть от 1 байта до {} МиБ.",
            MAX_REQUEST_BYTES / (1024 * 1024)
        )));
    }
    match parse_request(&bytes) {
        Ok(Some(request)) => Ok(request),
        Ok(None) => Err(refusal("Запрос пуст.")),
        Err(message) => Err(refusal(format!("Запрос не разобран: {message}"))),
    }
}

/// Файлы, которые хост отвергает при открытии теми же словами: не ресурс RSC7 (читатель хоста принимает его за сжатый
/// поток и отказывает словами распаковщика) и словарь текстур (читатель выходит за страницу).
fn host_open_refusal(model: &[u8]) -> Option<&'static str> {
    if !resource::is_resource(model) || model.len() <= resource::HEADER_BYTES {
        return Some("The archive entry was compressed using an unsupported compression method.");
    }
    let texture_dictionary = resource::read_header(model)
        .is_ok_and(|header| header.declared_version == resource::VERSION_YTD);
    texture_dictionary.then_some("illegal position!")
}

fn answer(output: &Path, bytes: &[u8], model: &[u8], patched: &Patched) -> Value {
    let frame = |frame: &animal_model::Frame| {
        let list = |values: &[f32]| Value::Array(values.iter().map(|&v| number(v)).collect());
        json!({ "min": list(&frame.min), "max": list(&frame.max), "center": list(&frame.centre), "radius": number(frame.radius) })
    };
    let changed: Vec<Value> = patched
        .semantic
        .changed
        .iter()
        .map(|row| {
            let lods: Vec<Value> = row
                .lods
                .iter()
                .map(|lod| {
                    json!({
                        "lod": lod.lod, "models": lod.models, "geometriesBefore": lod.before, "geometriesAfter": lod.after,
                        "glow": lod.glow, "marker": lod.marker, "flagsBefore": lod.flags_before, "flagsAfter": lod.flags_after,
                    })
                })
                .collect();
            let added: Vec<Value> = row
                .added
                .iter()
                .map(|shader| {
                    json!({
                        "index": shader.index, "texture": shader.texture, "shader": "emissive_alpha.sps", "bucket": 1,
                        "emissive": number(shader.emissive), "width": shader.width, "height": shader.height, "mipLevels": shader.levels,
                    })
                })
                .collect();
            json!({
                "hash": row.hash,
                "name": row.name,
                "marker": row.marker,
                "glow": row.glow,
                "lods": lods,
                "shaders": { "before": row.shaders_before, "after": row.shaders_after, "added": added },
                "textures": { "before": row.textures_before, "after": row.textures_after },
                "bounds": { "before": frame(&row.bounds_before), "after": frame(&row.bounds_after) },
                "boneCount": row.bones,
            })
        })
        .collect();
    let mut semantic = Map::new();
    semantic.insert("semanticReopen".into(), true.into());
    semantic.insert("drawables".into(), patched.semantic.drawables.into());
    semantic.insert(
        "unchangedDrawables".into(),
        patched.semantic.unchanged.into(),
    );
    semantic.insert("changed".into(), Value::Array(changed));
    semantic.insert("markerTexture".into(), animal_model::MARKER_TEXTURE.into());
    semantic.insert("glowTexture".into(), animal_model::GLOW_TEXTURE.into());
    json!({
        "status": "ok",
        "file": output.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        "output": output.display().to_string(),
        "bytes": bytes.len(),
        "sha256": sha256_hex(bytes),
        "input": { "bytes": model.len(), "sha256": sha256_hex(model) },
        "semantic": Value::Object(semantic),
    })
}

/// Число `f32` так, как его пишет хост: целое без точки, остальное кратчайшей записью.
fn number(value: f32) -> Value {
    if value.is_finite()
        && value.fract() == 0.0
        && value.abs() < 1e15
        && !(value == 0.0 && value.is_sign_negative())
    {
        return Value::from(value as i64);
    }
    float_value(value)
}

fn patch_animal_model(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = options.required("input")?;
    let output = options.required("output")?;
    let request = read_request(input)?;
    if request.format.as_deref() != Some(REQUEST_FORMAT) || request.version != REQUEST_VERSION {
        return Err(refusal(format!(
            "Запрос неизвестного вида: нужен format \"{REQUEST_FORMAT}\" версии {REQUEST_VERSION}."
        )));
    }
    if request.marker.is_none() && request.glow.is_none() {
        return Err(refusal(
            "В запросе нет ни метки (marker), ни свечения (glow): модель менять нечем.",
        ));
    }

    let output_path = full_path(output)?;
    if !ends_with_ydd(&output_path) {
        return Err(refusal("Результат должен быть файлом .ydd."));
    }
    if let Some(named) = request
        .output
        .as_deref()
        .filter(|text| !text.chars().all(char::is_whitespace))
    {
        if !same_path(&full_path(named)?, &output_path) {
            return Err(refusal(
                "Путь результата в запросе (output) не совпадает с --output.",
            ));
        }
    }
    let model_path = full_path(request.input.as_deref().unwrap_or(""))?;
    let blank_input = request
        .input
        .as_deref()
        .is_none_or(|text| text.chars().all(char::is_whitespace));
    if blank_input || !ends_with_ydd(&model_path) || !model_path.is_file() {
        return Err(refusal(
            "Исходная модель (input) должна быть существующим файлом .ydd.",
        ));
    }
    if same_path(&model_path, &output_path) {
        return Err(refusal(
            "Результат не может лечь поверх исходной модели: исходный файл не меняется.",
        ));
    }

    let marker = request.marker.as_ref().map(valid_marker).transpose()?;
    let glow = request.glow.as_ref().map(valid_glow).transpose()?;

    let model = fs::read(&model_path)?;
    if model.is_empty() || model.len() > MAX_MODEL_BYTES {
        return Err(refusal("Исходная модель пуста или слишком велика."));
    }
    if let Some(reason) = host_open_refusal(&model) {
        return Err(refusal(format!(
            "Модель не открывается как словарь .ydd Legacy: {reason}"
        )));
    }
    let patched = animal_model::patch(&model, marker.as_ref(), glow.as_ref())?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Результат ложится через соседний черновик: прежний выход цел, пока новый не записан целиком.
    shop::write_atomic(&output_path, &patched.bytes)?;
    Ok(answer(&output_path, &patched.bytes, &model, &patched))
}

#[cfg(test)]
mod tests;
