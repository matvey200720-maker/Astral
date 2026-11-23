//! `skin-from-body`: вещь педа (`.ydd`) без привязки к костям получает веса и кости ближайших вершин частей тела игры.
//!
//! Вызов: `skin-from-body --input <запрос.json> --output <.ydd>`. Запрос — JSON `{ format: "astral.skin-from-body",
//! version: 1, model: <путь к .ydd вещи>, references: [<пути к .ydd частей тела>] }`, образцов от одного до восьми.
//! Ответ: `{ file, bytes, sha256, changed, models, geometries, vertices, far }`; ничего не нужно — файл как был
//! (`changed: false`). Отказы — те же случаи, коды и английские тексты, что у прежнего хоста; тексты разбора JSON
//! повторяют разбор хоста для типичных поломок запроса. Само правило — `rage_res::body_skin`.
//!
//! После правки словарь собирается заново и перечитывается: у каждой геометрии скинованной модели обязаны быть веса.
//! Слово `+0x9a` рисовалок (размер блоков моделей) хост при записи пересчитывает, и здесь тоже.

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use rage_res::{
    body_skin::{self, BodyVertices},
    drawable_write::{drawable_at, finish_compact, graph_of, shape},
    hash::sha256_hex,
    resource_graph::{self as rgraph, Graph},
};
use serde_json::{Map, Value};

use super::{shop::write_atomic, split_heads::models_blocks_size, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

pub const COMMANDS: &[Command] = &[Command::new("skin-from-body", skin_from_body)];

/// Название формата запроса и пределы, в байтах и штуках.
mod wire {
    pub const REQUEST: &str = "astral.skin-from-body";
    pub const VERSION: i32 = 1;
    pub const REQUEST_BYTES: usize = 16 * 1024;
    pub const MODEL_BYTES: usize = 64 * 1024 * 1024;
    pub const REFERENCES: usize = 8;
}

/// Слово размера блоков моделей в рисовалке.
const BLOCKS_SIZE: usize = 0x9a;

/// Тексты отказов хоста.
mod words {
    pub const REQUEST_SIZE: &str = "Skin request must be between 1 byte and 16 KiB.";
    pub const REQUEST_EMPTY: &str = "Skin request is empty.";
    pub const REQUEST_FORMAT: &str = "Skin request has an unknown format.";
    pub const REQUEST_REFERENCES: &str = "Skin request needs 1\u{2013}8 reference body parts.";
    pub const OUTPUT_EXTENSION: &str = "Skin output must be a .ydd file.";
    pub const NO_BODY: &str = "Reference body parts carry no skinned vertices.";
    pub const NOT_REOPENED: &str = "Skinned model failed to reopen.";
    /// Что отвечает хост на байты, которые не ресурс, и на ресурс, оборванный посреди тела.
    pub const NOT_A_RESOURCE: &str =
        "The archive entry was compressed using an unsupported compression method.";
    pub const CUT_SHORT: &str = "Offset and length were out of bounds for the array or count is greater than the number of elements from index to the end of the source collection.";
}

// ---------------------------------------------------------------------------------------------
// Разбор запроса: правила `System.Text.Json` хоста (регистр имён важен, лишние имена отказывают, число — только целое)
// ---------------------------------------------------------------------------------------------

/// Разобранный запрос: поля, которых не было, остаются пустыми.
#[derive(Debug, Default, PartialEq, Eq)]
struct Request {
    format: Option<String>,
    version: i32,
    model: Option<String>,
    references: Option<Vec<Option<String>>>,
}

/// Имя типа запроса в текстах разбора хоста.
const REQUEST_TYPE: &str = "Modovik.Native.Host.BodySkinCommands+SkinRequest";

/// Читатель текста запроса с позицией, как её называет хост: номер строки и байт в строке.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    line: usize,
    line_start: usize,
}

/// Отказ разбора: текст, а путь и позицию добавляет вызывающий.
type Parsed<T> = std::result::Result<T, String>;

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            at: 0,
            line: 0,
            line_start: 0,
        }
    }

    /// «Путь | строка | байт» в конце текста отказа.
    fn place(&self, path: &str) -> String {
        format!(
            "Path: {path} | LineNumber: {} | BytePositionInLine: {}.",
            self.line,
            self.at - self.line_start
        )
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn skip_space(&mut self) {
        while let Some(byte) = self.peek() {
            match byte {
                b' ' | b'\t' | b'\r' => self.at += 1,
                b'\n' => {
                    self.at += 1;
                    self.line += 1;
                    self.line_start = self.at;
                }
                _ => break,
            }
        }
    }

    /// Знак для текста отказа: печатный как есть, остальной байтом.
    fn shown(byte: u8) -> String {
        if byte.is_ascii_graphic() {
            format!("'{}'", char::from(byte))
        } else {
            format!("'0x{byte:02X}'")
        }
    }

    fn invalid_start(&self, path: &str) -> String {
        let byte = self.peek().map_or_else(|| "''".to_owned(), Self::shown);
        format!(
            "{byte} is an invalid start of a value. {}",
            self.place(path)
        )
    }

    /// Строка JSON: открывающая кавычка уже под курсором; курсор встаёт за закрывающей.
    fn string(&mut self, path: &str) -> Parsed<String> {
        self.at += 1;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let Some(byte) = self.peek() else {
                return Err(format!(
                    "Expected end of string, but instead reached end of data. {}",
                    self.place(path)
                ));
            };
            self.at += 1;
            match byte {
                b'"' => break,
                b'\\' => {
                    let Some(escape) = self.peek() else {
                        return Err(format!(
                            "Expected end of string, but instead reached end of data. {}",
                            self.place(path)
                        ));
                    };
                    let simple = match escape {
                        b'"' | b'\\' | b'/' => Some(escape),
                        b'b' => Some(8),
                        b'f' => Some(12),
                        b'n' => Some(b'\n'),
                        b'r' => Some(b'\r'),
                        b't' => Some(b'\t'),
                        _ => None,
                    };
                    if let Some(byte) = simple {
                        self.at += 1;
                        out.push(byte);
                        continue;
                    }
                    match escape {
                        b'u' => {
                            self.at += 1;
                            let hex = self
                                .bytes
                                .get(self.at..self.at + 4)
                                .and_then(|part| std::str::from_utf8(part).ok())
                                .and_then(|part| u32::from_str_radix(part, 16).ok());
                            let Some(unit) = hex else {
                                return Err(format!("'u' is an invalid escapable character within a JSON string. The string should be correctly escaped. {}", self.place(path)));
                            };
                            self.at += 4;
                            let mut units = vec![unit as u16];
                            // Пара суррогатов: вторая половина идёт следом.
                            if (0xd800..0xdc00).contains(&unit)
                                && self.bytes.get(self.at..self.at + 2) == Some(b"\\u")
                            {
                                let low = self
                                    .bytes
                                    .get(self.at + 2..self.at + 6)
                                    .and_then(|part| std::str::from_utf8(part).ok())
                                    .and_then(|part| u32::from_str_radix(part, 16).ok());
                                if let Some(low) = low.filter(|low| (0xdc00..0xe000).contains(low))
                                {
                                    units.push(low as u16);
                                    self.at += 6;
                                }
                            }
                            let text = String::from_utf16_lossy(&units);
                            out.extend(text.as_bytes());
                        }
                        other => {
                            return Err(format!("{} is an invalid escapable character within a JSON string. The string should be correctly escaped. {}", Self::shown(other), self.place(path)));
                        }
                    }
                }
                0..=0x1f => {
                    return Err(format!("Invalid control character within a JSON string. The string should be correctly escaped. {}", self.place(path)));
                }
                _ => out.push(byte),
            }
        }
        String::from_utf8(out).map_err(|_| {
            format!(
                "Cannot transcode invalid UTF-8 JSON text to UTF-16 string. {}",
                self.place(path)
            )
        })
    }

    /// Литерал `null`, `true` или `false` под курсором. Отказ называет весь остаток входа с начала литерала, а позиция
    /// стоит на первом несовпавшем байте.
    fn literal(&mut self, word: &str, path: &str) -> Parsed<()> {
        let rest = &self.bytes[self.at..];
        let matched = rest
            .iter()
            .zip(word.bytes())
            .take_while(|(found, wanted)| *found == wanted)
            .count();
        if matched == word.len() {
            self.at += word.len();
            return Ok(());
        }
        let text = String::from_utf8_lossy(rest).into_owned();
        self.at += matched;
        Err(format!(
            "'{text}' is an invalid JSON literal. Expected the literal '{word}'. {}",
            self.place(path)
        ))
    }

    /// Число JSON под курсором: текст числа и признак «целое без дроби и порядка».
    fn number(&mut self, path: &str) -> Parsed<(String, bool)> {
        let start = self.at;
        let mut whole = true;
        if self.peek() == Some(b'-') {
            self.at += 1;
        }
        let digits = |reader: &mut Reader| {
            let from = reader.at;
            while reader.peek().is_some_and(|byte| byte.is_ascii_digit()) {
                reader.at += 1;
            }
            reader.at - from
        };
        let found = |reader: &Reader| reader.peek().map_or_else(|| "''".to_owned(), Self::shown);
        match self.peek() {
            Some(b'0') => {
                self.at += 1;
                if self.peek().is_some_and(|byte| byte.is_ascii_digit()) {
                    return Err(format!("Invalid leading zero before '{}'. {}", char::from(self.bytes[self.at]), self.place(path)));
                }
            }
            Some(b'1'..=b'9') => {
                digits(self);
            }
            _ => return Err(format!("{} is invalid within a number, immediately after a sign character ('+' or '-'). Expected a digit ('0'-'9'). {}", found(self), self.place(path))),
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            whole = false;
            if digits(self) == 0 {
                return Err(format!("{} is invalid within a number, immediately after a decimal point ('.'). Expected a digit ('0'-'9'). {}", found(self), self.place(path)));
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            whole = false;
            let signed = matches!(self.peek(), Some(b'+' | b'-'));
            if signed {
                self.at += 1;
            }
            if digits(self) == 0 {
                let after = if signed {
                    "a sign character ('+' or '-')"
                } else {
                    "an exponent ('E' or 'e')"
                };
                return Err(format!("{} is invalid within a number, immediately after {after}. Expected a digit ('0'-'9'). {}", found(self), self.place(path)));
            }
        }
        Ok((
            String::from_utf8_lossy(&self.bytes[start..self.at]).into_owned(),
            whole,
        ))
    }

    /// Значение, которое строковое свойство не берёт: оно читается целиком (начало списка и объекта — только знак),
    /// затем отказ с позицией после прочитанного.
    fn refuse_value(&mut self, target: &str, path: &str) -> String {
        let outcome = match self.peek() {
            Some(b'[' | b'{') => {
                self.at += 1;
                Ok(())
            }
            Some(b'"') => self.string(path).map(drop),
            Some(b't') => self.literal("true", path),
            Some(b'f') => self.literal("false", path),
            Some(b'n') => self.literal("null", path),
            Some(b'-' | b'0'..=b'9') => self.number(path).map(drop),
            _ => Err(self.invalid_start(path)),
        };
        match outcome {
            Ok(()) => format!(
                "The JSON value could not be converted to {target}. {}",
                self.place(path)
            ),
            Err(message) => message,
        }
    }

    /// Строка или `null` у свойства-строки.
    fn text_or_null(&mut self, path: &str) -> Parsed<Option<String>> {
        match self.peek() {
            Some(b'"') => self.string(path).map(Some),
            Some(b'n') => self.literal("null", path).map(|()| None),
            _ => Err(self.refuse_value("System.String", path)),
        }
    }

    fn version(&mut self, path: &str) -> Parsed<i32> {
        match self.peek() {
            Some(b'-' | b'0'..=b'9') => {
                let (text, whole) = self.number(path)?;
                match text.parse::<i32>().ok().filter(|_| whole) {
                    Some(value) => Ok(value),
                    None => Err(format!(
                        "The JSON value could not be converted to System.Int32. {}",
                        self.place(path)
                    )),
                }
            }
            _ => Err(self.refuse_value("System.Int32", path)),
        }
    }

    /// Список строк или `null`.
    fn references(&mut self, path: &str) -> Parsed<Option<Vec<Option<String>>>> {
        match self.peek() {
            Some(b'n') => self.literal("null", path).map(|()| None),
            Some(b'[') => {
                self.at += 1;
                let mut items = Vec::new();
                self.skip_space();
                if self.peek() == Some(b']') {
                    self.at += 1;
                    return Ok(Some(items));
                }
                loop {
                    self.skip_space();
                    let at = format!("{path}[{}]", items.len());
                    if self.peek().is_none() {
                        return Err(format!("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed. {}", self.place(&at)));
                    }
                    items.push(self.text_or_null(&at)?);
                    self.skip_space();
                    match self.peek() {
                        Some(b',') => {
                            self.at += 1;
                            self.skip_space();
                            if self.peek() == Some(b']') {
                                let next = format!("{path}[{}]", items.len());
                                return Err(format!("The JSON array contains a trailing comma at the end which is not supported in this mode. Change the reader options. {}", self.place(&next)));
                            }
                        }
                        Some(b']') => {
                            self.at += 1;
                            return Ok(Some(items));
                        }
                        Some(byte) => {
                            return Err(format!(
                            "{} is invalid after a value. Expected either ',', '}}', or ']'. {}",
                            Self::shown(byte),
                            self.place(&at)
                        ))
                        }
                        None => {
                            let next = format!("{path}[{}]", items.len());
                            return Err(format!("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed. {}", self.place(&next)));
                        }
                    }
                }
            }
            _ => Err(self.refuse_value("System.String[]", path)),
        }
    }

    /// Корневой объект: курсор на `{`.
    fn object(&mut self) -> Parsed<Request> {
        self.at += 1;
        let mut request = Request::default();
        self.skip_space();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(request);
        }
        loop {
            self.skip_space();
            match self.peek() {
                Some(b'"') => {}
                Some(b'/') => return Err(format!("'/' is invalid after a value. Expected either ',', '}}', or ']'. {}", self.place("$"))),
                Some(byte) => return Err(format!("{} is an invalid start of a property name. Expected a '\"'. {}", Self::shown(byte), self.place("$"))),
                None => return Err(format!("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed. {}", self.place("$"))),
            }
            let name = self.string("$")?;
            self.skip_space();
            if self.peek() != Some(b':') {
                let found = self.peek().map_or_else(|| "''".to_owned(), Self::shown);
                return Err(format!(
                    "{found} is invalid after a property name. Expected a ':'. {}",
                    self.place("$")
                ));
            }
            self.at += 1;
            self.skip_space();
            let path = format!("$.{name}");
            match name.as_str() {
                "format" => request.format = self.text_or_null(&path)?,
                "version" => request.version = self.version(&path)?,
                "model" => request.model = self.text_or_null(&path)?,
                "references" => request.references = self.references(&path)?,
                _ => return Err(format!("The JSON property '{name}' could not be mapped to any .NET member contained in type '{REQUEST_TYPE}'.")),
            }
            self.skip_space();
            match self.peek() {
                Some(b',') => {
                    self.at += 1;
                    self.skip_space();
                    if self.peek() == Some(b'}') {
                        return Err(format!("The JSON object contains a trailing comma at the end which is not supported in this mode. Change the reader options. {}", self.place("$")));
                    }
                }
                Some(b'}') => {
                    self.at += 1;
                    return Ok(request);
                }
                Some(byte) => return Err(format!("{} is invalid after a value. Expected either ',', '}}', or ']'. {}", Self::shown(byte), self.place("$"))),
                None => return Err(format!("Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed. {}", self.place("$"))),
            }
        }
    }
}

/// Запрос из байтов файла; `Ok(None)` — JSON `null`. Отказ разбора — `JsonException` с текстом хоста.
fn parse_request(bytes: &[u8]) -> Result<Option<Request>> {
    let json = |message: String| EngineError::new("JsonException", message);
    let mut reader = Reader::new(bytes);
    reader.skip_space();
    let parsed = match reader.peek() {
        None => Err(format!("The input does not contain any JSON tokens. Expected the input to start with a valid JSON token, when isFinalBlock is true. {}", reader.place("$"))),
        Some(b'{') => reader.object().map(Some),
        Some(b'n') => reader.literal("null", "$").map(|()| None),
        Some(_) => Err(reader.refuse_value(REQUEST_TYPE, "$")),
    };
    let request = parsed.map_err(json)?;
    reader.skip_space();
    if let Some(byte) = reader.peek() {
        let message = format!(
            "{} is invalid after a single JSON value. Expected end of data. {}",
            Reader::shown(byte),
            reader.place("$")
        );
        return Err(json(message));
    }
    Ok(request)
}

// ---------------------------------------------------------------------------------------------
// Файлы
// ---------------------------------------------------------------------------------------------

/// Полный путь, как его даёт хост: пустая строка и пробелы отказывают его текстами.
fn host_path(text: &str, empty: &str) -> Result<PathBuf> {
    if text.trim().is_empty() {
        let message = if text.is_empty() {
            empty
        } else {
            "The path is empty. (Parameter 'path')"
        };
        return Err(EngineError::argument(message));
    }
    paths::full_path(text)
}

/// «Отказано в доступе» хоста для пути.
fn denied(error: EngineError, path: &Path) -> EngineError {
    if error.code == "UnauthorizedAccessException" {
        EngineError::new(
            error.code,
            format!("Access to the path '{}' is denied.", path.display()),
        )
    } else {
        error
    }
}

/// Файл запроса целиком; отказы чтения — тексты хоста.
fn read_request_file(text: &str) -> Result<Vec<u8>> {
    let full = host_path(
        text,
        "The value cannot be an empty string. (Parameter 'path')",
    )?;
    fs::read(&full).map_err(|error| match error.kind() {
        ErrorKind::NotFound if full.parent().is_some_and(Path::is_dir) => {
            EngineError::file_not_found(format!("Could not find file '{}'.", full.display()))
        }
        ErrorKind::NotFound => EngineError::directory_not_found(format!(
            "Could not find a part of the path '{}'.",
            full.display()
        )),
        _ => denied(EngineError::from(error), &full),
    })
}

/// Выходной путь: пробелы в конце хост отбрасывает, а закрывающий разделитель оставляет — тогда это не файл `.ydd`.
fn output_target(text: &str) -> Result<PathBuf> {
    let full = host_path(text, "The path is empty. (Parameter 'path')")?;
    if text.ends_with(['/', '\\']) {
        return Err(refusal(words::OUTPUT_EXTENSION));
    }
    host_path(
        text.trim_end_matches(' '),
        "The path is empty. (Parameter 'path')",
    )
    .or(Ok(full))
}

fn refusal(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

/// Словарь из байтов; что не читается как ресурс, отказывает текстами хоста.
fn open_dictionary(bytes: &[u8], label: &str) -> Result<Graph> {
    let magic = 0x3743_5352u32.to_le_bytes();
    if bytes.len() < 4 || bytes[..4] != magic {
        return Err(refusal(words::NOT_A_RESOURCE));
    }
    let graph = graph_of(bytes).map_err(|_| EngineError::argument(words::CUT_SHORT))?;
    if !body_skin::has_drawables(&graph) {
        return Err(refusal(format!("Skin {label} does not open.")));
    }
    Ok(graph)
}

/// Файл `.ydd` запроса: путь, расширение, размер, разбор.
fn read_ydd(file: Option<&str>, label: &str) -> Result<(Vec<u8>, Graph)> {
    let Some(file) = file.filter(|file| !file.trim().is_empty()) else {
        return Err(refusal(format!("Skin {label} is missing.")));
    };
    let full = paths::full_path(file)?;
    if !has_ydd_extension(&full) || !full.is_file() {
        return Err(refusal(format!(
            "Skin {label} must be an existing .ydd file."
        )));
    }
    let bytes = fs::read(&full)?;
    if bytes.is_empty() || bytes.len() > wire::MODEL_BYTES {
        return Err(refusal(format!("Skin {label} is empty or too large.")));
    }
    let graph = open_dictionary(&bytes, label)?;
    Ok((bytes, graph))
}

fn has_ydd_extension(path: &Path) -> bool {
    path.to_string_lossy()
        .to_ascii_lowercase()
        .ends_with(".ydd")
}

// ---------------------------------------------------------------------------------------------
// Команда
// ---------------------------------------------------------------------------------------------

/// Ответ как пары «ключ, значение» в порядке записи.
fn table<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<String, Value>>(),
    )
}

fn answer(path: &Path, bytes: &[u8], changed: bool, report: &body_skin::Report) -> Value {
    let file = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    table([
        ("file", Value::from(file)),
        ("bytes", Value::from(bytes.len())),
        ("sha256", Value::from(sha256_hex(bytes))),
        ("changed", Value::from(changed)),
        ("models", Value::from(report.models)),
        ("geometries", Value::from(report.geometries)),
        ("vertices", Value::from(report.vertices)),
        ("far", Value::from(report.far)),
    ])
}

/// Хост при каждой записи пересчитывает слово `+0x9a` рисовалок; словарь, где формула не сходится, остаётся как есть.
fn refresh_block_sizes(graph: &mut Graph) -> Result<()> {
    let Ok(total) = shape(graph).map(|found| found.drawables) else {
        return Ok(());
    };
    for index in 0..total {
        let Ok(drawable) = drawable_at(graph, index) else {
            continue;
        };
        if let Ok(size) = models_blocks_size(graph, drawable) {
            rgraph::write_at(graph, drawable, BLOCKS_SIZE, &size.to_le_bytes())?;
        }
    }
    Ok(())
}

/// Собранный словарь перечитывается: каждая геометрия скинованной модели обязана нести веса.
fn reopen(bytes: &[u8], skinned: usize) -> Result<()> {
    let again = graph_of(bytes).map_err(|_| refusal(words::NOT_REOPENED))?;
    if !body_skin::has_drawables(&again) {
        return Err(refusal(words::NOT_REOPENED));
    }
    body_skin::verify_skinned(&again, skinned).map_err(|error| refusal(error.message))
}

fn skin_from_body(options: &Options, _: &Progress) -> Result<Value> {
    let input = options.required("input")?;
    let output = options.required("output")?;

    let request_bytes = read_request_file(input)?;
    if request_bytes.is_empty() || request_bytes.len() > wire::REQUEST_BYTES {
        return Err(refusal(words::REQUEST_SIZE));
    }
    let request = parse_request(&request_bytes)?.ok_or_else(|| refusal(words::REQUEST_EMPTY))?;
    if request.format.as_deref() != Some(wire::REQUEST) || request.version != wire::VERSION {
        return Err(refusal(words::REQUEST_FORMAT));
    }
    let references = request.references.as_deref().unwrap_or_default();
    if references.is_empty() || references.len() > wire::REFERENCES {
        return Err(refusal(words::REQUEST_REFERENCES));
    }
    let output_path: PathBuf = output_target(output)?;
    if !has_ydd_extension(&output_path) {
        return Err(refusal(words::OUTPUT_EXTENSION));
    }

    let (model_bytes, mut graph) = read_ydd(request.model.as_deref(), "model")?;
    let mut body = BodyVertices::new();
    for reference in references {
        let (_, part) = read_ydd(reference.as_deref(), "reference")?;
        body.add(&part).map_err(|error| refusal(error.message))?;
    }
    if body.is_empty() {
        return Err(refusal(words::NO_BODY));
    }

    let report = body_skin::skin(&mut graph, &body).map_err(|error| refusal(error.message))?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if report.geometries == 0 {
        write_atomic(&output_path, &model_bytes).map_err(|error| denied(error, &output_path))?;
        return Ok(answer(&output_path, &model_bytes, false, &report));
    }
    refresh_block_sizes(&mut graph)?;
    let bytes = finish_compact(&graph)?;
    reopen(&bytes, report.geometries)?;
    write_atomic(&output_path, &bytes).map_err(|error| denied(error, &output_path))?;
    Ok(answer(&output_path, &bytes, true, &report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use rage_res::{
        resource::SYSTEM_BASE,
        resource_graph::{from_parts, Segment},
    };
    use serde_json::json;

    // ---------- стенд: словари собираются таблицами полей, всё в системной области ----------

    /// Описание геометрии: позиции; есть ли у вершин веса и кости; есть ли указатель на байты вершин.
    #[derive(Clone)]
    struct Geo {
        positions: Vec<[f32; 3]>,
        skin: bool,
        data: bool,
    }

    fn geo(positions: &[[f32; 3]], skin: bool) -> Geo {
        Geo {
            positions: positions.to_vec(),
            skin,
            data: true,
        }
    }

    /// Модель: геометрии, флаг кожи, кость.
    #[derive(Clone)]
    struct Part {
        geos: Vec<Geo>,
        has_skin: u8,
        bone: u8,
    }

    fn part(geos: Vec<Geo>, has_skin: u8, bone: u8) -> Part {
        Part {
            geos,
            has_skin,
            bone,
        }
    }

    struct Area(Vec<u8>);

    impl Area {
        fn reserve(&mut self, len: usize) -> usize {
            let start = self.0.len().next_multiple_of(16);
            self.0.resize(start + len.max(1), 0);
            start
        }

        fn poke(&mut self, at: usize, bytes: &[u8]) {
            self.0[at..at + bytes.len()].copy_from_slice(bytes);
        }

        fn pointer(&mut self, at: usize, to: usize) {
            self.poke(at, &(SYSTEM_BASE + to as u64).to_le_bytes());
        }
    }

    fn lay_geometry(area: &mut Area, geo: &Geo) -> usize {
        let types: u64 = 6 | 6 << 12 | 5 << 24 | if geo.skin { 9 << 4 | 8 << 8 } else { 0 };
        let flags: u32 = 0x49 | if geo.skin { 6 } else { 0 };
        let stride: usize = 12 + if geo.skin { 8 } else { 0 } + 12 + 8;
        let mut bytes = Vec::new();
        for (n, position) in geo.positions.iter().enumerate() {
            position
                .iter()
                .for_each(|value| bytes.extend(value.to_le_bytes()));
            if geo.skin {
                bytes.extend([255 - n as u8, n as u8, 0, 0, 10 + n as u8, 0, 0, 0]);
            }
            [n as f32, 0.5, -1.0]
                .iter()
                .for_each(|value| bytes.extend(value.to_le_bytes()));
            [n as f32 / 8.0, 0.25]
                .iter()
                .for_each(|value| bytes.extend(value.to_le_bytes()));
        }
        let data = area.reserve(bytes.len());
        area.poke(data, &bytes);
        let declaration = area.reserve(16);
        area.poke(declaration, &flags.to_le_bytes());
        area.poke(declaration + 4, &(stride as u16).to_le_bytes());
        area.poke(declaration + 7, &[flags.count_ones() as u8]);
        area.poke(declaration + 8, &types.to_le_bytes());
        let buffer = area.reserve(0x80);
        area.poke(buffer, &0x4061_b3f8u32.to_le_bytes());
        area.poke(buffer + 8, &(stride as u16).to_le_bytes());
        area.poke(buffer + 0x18, &(geo.positions.len() as u32).to_le_bytes());
        if geo.data {
            area.pointer(buffer + 0x10, data);
            area.pointer(buffer + 0x20, data);
        }
        area.pointer(buffer + 0x30, declaration);
        let geometry = area.reserve(0xa0);
        area.poke(geometry, &0x4061_9867u32.to_le_bytes());
        area.pointer(geometry + 0x18, buffer);
        area.poke(geometry + 0x60, &(geo.positions.len() as u16).to_le_bytes());
        area.poke(geometry + 0x70, &(stride as u16).to_le_bytes());
        if geo.data {
            area.pointer(geometry + 0x78, data);
        }
        geometry
    }

    fn lay_model(area: &mut Area, part: &Part) -> usize {
        let geometries: Vec<usize> = part
            .geos
            .iter()
            .map(|geo| lay_geometry(area, geo))
            .collect();
        let array = area.reserve(geometries.len() * 8);
        geometries
            .iter()
            .enumerate()
            .for_each(|(n, &geometry)| area.pointer(array + n * 8, geometry));
        let model = area.reserve(0x30);
        area.pointer(model + 8, array);
        area.poke(model + 0x10, &(geometries.len() as u16).to_le_bytes());
        area.poke(model + 0x12, &(geometries.len() as u16).to_le_bytes());
        area.poke(
            model + 0x28,
            &(u32::from(part.has_skin) << 8 | u32::from(part.bone) << 24).to_le_bytes(),
        );
        area.poke(model + 0x2e, &(geometries.len() as u16).to_le_bytes());
        model
    }

    /// Файл `.ydd` с одной рисовалкой: модели уровня High и, если нужно, Low.
    fn ydd(high: &[Part], low: &[Part]) -> Vec<u8> {
        let mut area = Area(Vec::new());
        area.reserve(0x40);
        let mut heads = [0usize; 2];
        for (slot, models) in [high, low].into_iter().enumerate() {
            if models.is_empty() {
                continue;
            }
            let placed: Vec<usize> = models
                .iter()
                .map(|model| lay_model(&mut area, model))
                .collect();
            let entries = area.reserve(placed.len() * 8);
            placed
                .iter()
                .enumerate()
                .for_each(|(n, &model)| area.pointer(entries + n * 8, model));
            let head = area.reserve(16);
            area.pointer(head, entries);
            area.poke(head + 8, &(placed.len() as u16).to_le_bytes());
            heads[slot] = head;
        }
        let drawable = area.reserve(0xb0);
        area.poke(drawable, &0x4057_1168u32.to_le_bytes());
        if heads[0] != 0 {
            area.pointer(drawable + 0x50, heads[0]);
        }
        if heads[1] != 0 {
            area.pointer(drawable + 0x60, heads[1]);
        }
        let hashes = area.reserve(4);
        let array = area.reserve(8);
        area.pointer(array, drawable);
        area.pointer(0x20, hashes);
        area.poke(0x28, &1u16.to_le_bytes());
        area.pointer(0x30, array);
        area.poke(0x38, &1u16.to_le_bytes());
        let graph = from_parts(165, 0, 0, area.0, Vec::new());
        finish_compact(&graph).expect("файл словаря")
    }

    /// Четыре вершины тела на осях, как в тестах ядра.
    fn body_ydd() -> Vec<u8> {
        let positions = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        ydd(&[part(vec![geo(&positions, true)], 1, 0)], &[])
    }

    fn cloth_ydd(has_skin: u8, bone: u8) -> Vec<u8> {
        ydd(
            &[part(
                vec![geo(
                    &[[0.9, 0.1, 0.0], [0.0, 0.8, 0.1], [0.05, 0.0, 0.9]],
                    false,
                )],
                has_skin,
                bone,
            )],
            &[],
        )
    }

    /// Папка запуска: запрос, образец тела и готовые пути.
    struct Lab {
        dir: tempfile::TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempfile::tempdir().expect("папка");
            fs::write(dir.path().join("body.ydd"), body_ydd()).expect("образец");
            Lab { dir }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn text(&self, name: &str) -> String {
            self.path(name).display().to_string()
        }

        fn model(&self, bytes: &[u8]) -> String {
            fs::write(self.path("model.ydd"), bytes).expect("модель");
            self.text("model.ydd")
        }

        fn request(&self, model: &str) -> Value {
            json!({ "format": "astral.skin-from-body", "version": 1, "model": model, "references": [self.text("body.ydd")] })
        }

        /// Запускает команду над телом запроса и отдаёт разобранный ответ и код выхода.
        fn call_raw(&self, request: &[u8], output: &str) -> (Value, i32) {
            fs::write(self.path("request.json"), request).expect("запрос");
            let argv: Vec<String> = [
                "skin-from-body",
                "--input",
                &self.text("request.json"),
                "--output",
                output,
            ]
            .map(String::from)
            .to_vec();
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).expect("ответ — JSON"),
                outcome.exit_code,
            )
        }

        fn call(&self, request: &Value) -> (Value, i32) {
            self.call_raw(
                request.to_string().as_bytes(),
                &self.text("out/skinned.ydd"),
            )
        }
    }

    fn refused(answer: &(Value, i32)) -> (String, String) {
        assert_eq!(answer.1, 1, "{}", answer.0);
        assert_eq!(answer.0["ok"], json!(false));
        (
            answer.0["error"]["code"].as_str().unwrap().to_owned(),
            answer.0["error"]["message"].as_str().unwrap().to_owned(),
        )
    }

    fn done(answer: &(Value, i32)) -> &Value {
        assert_eq!(
            (answer.1, &answer.0["ok"], &answer.0["command"]),
            (0, &json!(true), &json!("skin-from-body")),
            "{}",
            answer.0
        );
        &answer.0["result"]
    }

    // ---------- реестр ----------

    #[test]
    fn the_command_is_in_the_registry() {
        let found = crate::commands::find("skin-from-body").expect("команда есть");
        assert_eq!(found.name, "skin-from-body");
    }

    // ---------- счастливый путь ----------

    #[test]
    fn a_model_without_skin_gets_weights_and_the_answer_counts_it() {
        let lab = Lab::new();
        let model = lab.model(&cloth_ydd(0, 0));
        let answer = lab.call(&lab.request(&model));
        let result = done(&answer);
        let bytes = fs::read(lab.path("out/skinned.ydd")).expect("выход");
        assert_eq!(
            result,
            &json!({
                "file": "skinned.ydd",
                "bytes": bytes.len(),
                "sha256": sha256_hex(&bytes),
                "changed": true,
                "models": 1,
                "geometries": 1,
                "vertices": 3,
                "far": 0
            })
        );
        assert_eq!(
            result.as_object().unwrap().keys().collect::<Vec<_>>(),
            [
                "file",
                "bytes",
                "sha256",
                "changed",
                "models",
                "geometries",
                "vertices",
                "far"
            ]
        );
        let graph = graph_of(&bytes).expect("выход читается");
        body_skin::verify_skinned(&graph, 1).expect("веса на месте");
    }

    #[test]
    fn the_same_request_gives_the_same_bytes() {
        let lab = Lab::new();
        let model = lab.model(&cloth_ydd(0, 0));
        let first = lab.call(&lab.request(&model));
        let one = fs::read(lab.path("out/skinned.ydd")).unwrap();
        let second = lab.call(&lab.request(&model));
        assert_eq!(done(&first), done(&second));
        assert_eq!(one, fs::read(lab.path("out/skinned.ydd")).unwrap());
    }

    #[test]
    fn nothing_to_do_leaves_the_model_as_it_was() {
        let lab = Lab::new();
        let original = body_ydd();
        let model = lab.model(&original);
        let answer = lab.call(&lab.request(&model));
        let result = done(&answer);
        assert_eq!(fs::read(lab.path("out/skinned.ydd")).unwrap(), original);
        assert_eq!(result["changed"], json!(false));
        assert_eq!(
            (
                result["models"].as_u64(),
                result["geometries"].as_u64(),
                result["vertices"].as_u64(),
                result["far"].as_u64()
            ),
            (Some(0), Some(0), Some(0), Some(0))
        );
        assert_eq!(result["sha256"], json!(sha256_hex(&original)));
        // жёсткая деталь на кости — тоже как была
        let rigid = lab.model(&cloth_ydd(0, 7));
        let answer = lab.call(&lab.request(&rigid));
        assert_eq!(done(&answer)["changed"], json!(false));
    }

    #[test]
    fn a_model_without_vertex_data_is_counted_and_written_back_unchanged() {
        let lab = Lab::new();
        let mut bare = geo(&[[0.0; 3]], false);
        bare.data = false;
        let original = ydd(&[part(vec![bare], 0, 0)], &[]);
        let model = lab.model(&original);
        let answer = lab.call(&lab.request(&model));
        let result = done(&answer);
        assert_eq!(
            (
                result["changed"].as_bool(),
                result["models"].as_u64(),
                result["geometries"].as_u64()
            ),
            (Some(false), Some(1), Some(0))
        );
        assert_eq!(fs::read(lab.path("out/skinned.ydd")).unwrap(), original);
    }

    #[test]
    fn a_geometry_that_stays_bare_next_to_a_skinned_one_is_refused_after_the_reopen() {
        let lab = Lab::new();
        let mut bare = geo(&[[0.0; 3]], false);
        bare.data = false;
        let model = lab.model(&ydd(
            &[part(vec![geo(&[[0.9, 0.1, 0.0]], false), bare], 0, 0)],
            &[],
        ));
        let (code, message) = refused(&lab.call(&lab.request(&model)));
        assert_eq!(
            (code.as_str(), message.as_str()),
            (
                "InvalidDataException",
                "Skinned model still has geometry without bone weights."
            )
        );
    }

    #[test]
    fn lower_levels_are_skinned_too_and_the_output_directory_is_made() {
        let lab = Lab::new();
        let plain = part(vec![geo(&[[0.9, 0.1, 0.0], [0.0, 0.8, 0.1]], false)], 0, 0);
        let model = lab.model(&ydd(
            std::slice::from_ref(&plain),
            std::slice::from_ref(&plain),
        ));
        let request = lab.request(&model).to_string();
        let answer = lab.call_raw(request.as_bytes(), &lab.text("deep/er/skinned.ydd"));
        let result = done(&answer);
        assert_eq!(
            (
                result["models"].as_u64(),
                result["geometries"].as_u64(),
                result["vertices"].as_u64()
            ),
            (Some(2), Some(2), Some(4))
        );
        assert!(lab.path("deep/er/skinned.ydd").is_file());
    }

    // ---------- отказы запроса ----------

    #[test]
    fn request_refusals_keep_the_host_codes_and_texts() {
        let lab = Lab::new();
        let model = lab.model(&cloth_ydd(0, 0));
        let good = lab.request(&model);
        let with = |key: &str, value: Value| {
            let mut changed = good.clone();
            changed[key] = value;
            changed.to_string()
        };
        let sized = |extra: usize| format!("{}{}", good, " ".repeat(extra));
        let cases: Vec<(&str, Vec<u8>, &str, &str)> = vec![
            (
                "пусто",
                Vec::new(),
                "InvalidDataException",
                "Skin request must be between 1 byte and 16 KiB.",
            ),
            (
                "больше 16 КиБ",
                vec![b' '; 16 * 1024 + 1],
                "InvalidDataException",
                "Skin request must be between 1 byte and 16 KiB.",
            ),
            (
                "null",
                b"null".to_vec(),
                "InvalidDataException",
                "Skin request is empty.",
            ),
            (
                "пустой объект",
                b"{}".to_vec(),
                "InvalidDataException",
                "Skin request has an unknown format.",
            ),
            (
                "другой формат",
                with("format", json!("x")).into_bytes(),
                "InvalidDataException",
                "Skin request has an unknown format.",
            ),
            (
                "формат null",
                with("format", Value::Null).into_bytes(),
                "InvalidDataException",
                "Skin request has an unknown format.",
            ),
            (
                "версия 2",
                with("version", json!(2)).into_bytes(),
                "InvalidDataException",
                "Skin request has an unknown format.",
            ),
            (
                "образцов нет",
                with("references", json!([])).into_bytes(),
                "InvalidDataException",
                "Skin request needs 1\u{2013}8 reference body parts.",
            ),
            (
                "образцы null",
                with("references", Value::Null).into_bytes(),
                "InvalidDataException",
                "Skin request needs 1\u{2013}8 reference body parts.",
            ),
            (
                "образцов девять",
                with("references", json!(vec![lab.text("body.ydd"); 9])).into_bytes(),
                "InvalidDataException",
                "Skin request needs 1\u{2013}8 reference body parts.",
            ),
            (
                "модели нет",
                with("model", Value::Null).into_bytes(),
                "InvalidDataException",
                "Skin model is missing.",
            ),
            (
                "модель из пробелов",
                with("model", json!("  ")).into_bytes(),
                "InvalidDataException",
                "Skin model is missing.",
            ),
            (
                "модель не ydd",
                with("model", json!(lab.text("request.json"))).into_bytes(),
                "InvalidDataException",
                "Skin model must be an existing .ydd file.",
            ),
            (
                "модели нет на диске",
                with("model", json!(lab.text("none.ydd"))).into_bytes(),
                "InvalidDataException",
                "Skin model must be an existing .ydd file.",
            ),
            (
                "образец null",
                with("references", json!([null])).into_bytes(),
                "InvalidDataException",
                "Skin reference is missing.",
            ),
            (
                "образец пустой",
                with("references", json!([""])).into_bytes(),
                "InvalidDataException",
                "Skin reference is missing.",
            ),
            (
                "образца нет на диске",
                with("references", json!([lab.text("none.ydd")])).into_bytes(),
                "InvalidDataException",
                "Skin reference must be an existing .ydd file.",
            ),
            (
                "запрос ровно 16 КиБ, но модель без изменений",
                sized(16 * 1024 - good.to_string().len()).into_bytes(),
                "",
                "",
            ),
        ];
        for (name, request, code, message) in cases {
            let answer = lab.call_raw(&request, &lab.text("out/skinned.ydd"));
            if code.is_empty() {
                done(&answer);
                continue;
            }
            assert_eq!(
                refused(&answer),
                (code.to_owned(), message.to_owned()),
                "{name}"
            );
        }
    }

    /// Разбор запроса повторяет разбор хоста: тексты сняты с хоста на тех же телах.
    #[test]
    fn json_refusals_follow_the_host_parser() {
        let lab = Lab::new();
        let cases: &[(&str, &str)] = &[
            ("{", "Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed. Path: $ | LineNumber: 0 | BytePositionInLine: 1."),
            ("[]", "The JSON value could not be converted to Modovik.Native.Host.BodySkinCommands+SkinRequest. Path: $ | LineNumber: 0 | BytePositionInLine: 1."),
            ("5", "The JSON value could not be converted to Modovik.Native.Host.BodySkinCommands+SkinRequest. Path: $ | LineNumber: 0 | BytePositionInLine: 1."),
            ("\"x\"", "The JSON value could not be converted to Modovik.Native.Host.BodySkinCommands+SkinRequest. Path: $ | LineNumber: 0 | BytePositionInLine: 3."),
            ("{\"extra\":1}", "The JSON property 'extra' could not be mapped to any .NET member contained in type 'Modovik.Native.Host.BodySkinCommands+SkinRequest'."),
            ("{\"Format\":\"x\"}", "The JSON property 'Format' could not be mapped to any .NET member contained in type 'Modovik.Native.Host.BodySkinCommands+SkinRequest'."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":\"1\",\"model\":\"m\"}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 47."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1.5}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 47."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"model\":5}", "The JSON value could not be converted to System.String. Path: $.model | LineNumber: 0 | BytePositionInLine: 55."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"references\":\"x\"}", "The JSON value could not be converted to System.String[]. Path: $.references | LineNumber: 0 | BytePositionInLine: 62."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"references\":[5]}", "The JSON value could not be converted to System.String. Path: $.references[0] | LineNumber: 0 | BytePositionInLine: 61."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"model\":\"x\",}", "The JSON object contains a trailing comma at the end which is not supported in this mode. Change the reader options. Path: $ | LineNumber: 0 | BytePositionInLine: 58."),
            ("\u{feff}{}", "'0xEF' is an invalid start of a value. Path: $ | LineNumber: 0 | BytePositionInLine: 0."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"model\":\"m\",\"references\":[\"r\"]} x", "'x' is invalid after a single JSON value. Expected end of data. Path: $ | LineNumber: 0 | BytePositionInLine: 78."),
            (" ", "The input does not contain any JSON tokens. Expected the input to start with a valid JSON token, when isFinalBlock is true. Path: $ | LineNumber: 0 | BytePositionInLine: 1."),
            ("\n\n  [", "The JSON value could not be converted to Modovik.Native.Host.BodySkinCommands+SkinRequest. Path: $ | LineNumber: 2 | BytePositionInLine: 3."),
            ("{\"format\":\n\"x\",\n \"version\": true}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 2 | BytePositionInLine: 16."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"model\":{\"a\":1}}", "The JSON value could not be converted to System.String. Path: $.model | LineNumber: 0 | BytePositionInLine: 55."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"references\":[1,2]}", "The JSON value could not be converted to System.String. Path: $.references[0] | LineNumber: 0 | BytePositionInLine: 61."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"references\":[\"a\",]}", "The JSON array contains a trailing comma at the end which is not supported in this mode. Change the reader options. Path: $.references[1] | LineNumber: 0 | BytePositionInLine: 64."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"references\":[\"a\"", "Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed. Path: $.references[1] | LineNumber: 0 | BytePositionInLine: 63."),
            ("{\"format\":\"astral.skin-from-body\",\"version\":1,\"model\" \"x\"}", "'\"' is invalid after a property name. Expected a ':'. Path: $ | LineNumber: 0 | BytePositionInLine: 54."),
            ("{format:1}", "'f' is an invalid start of a property name. Expected a '\"'. Path: $ | LineNumber: 0 | BytePositionInLine: 1."),
            ("{\"format\":\"a\\qb\"}", "'q' is an invalid escapable character within a JSON string. The string should be correctly escaped. Path: $.format | LineNumber: 0 | BytePositionInLine: 13."),
            ("{\"format\":nul}", "'nul}' is an invalid JSON literal. Expected the literal 'null'. Path: $.format | LineNumber: 0 | BytePositionInLine: 13."),
            ("{\"format\":\"x\" \"version\":1}", "'\"' is invalid after a value. Expected either ',', '}', or ']'. Path: $ | LineNumber: 0 | BytePositionInLine: 14."),
            ("{\"version\":01}", "Invalid leading zero before '1'. Path: $.version | LineNumber: 0 | BytePositionInLine: 12."),
            ("{\"version\":1e1}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 14."),
            ("{\"version\":2147483648}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 21."),
            ("{\"version\":-}", "'}' is invalid within a number, immediately after a sign character ('+' or '-'). Expected a digit ('0'-'9'). Path: $.version | LineNumber: 0 | BytePositionInLine: 12."),
            ("{\"version\":1.}", "'}' is invalid within a number, immediately after a decimal point ('.'). Expected a digit ('0'-'9'). Path: $.version | LineNumber: 0 | BytePositionInLine: 13."),
            ("{\"references\":[tru]}", "'tru]}' is an invalid JSON literal. Expected the literal 'true'. Path: $.references[0] | LineNumber: 0 | BytePositionInLine: 18."),
            ("{\"references\":[[]]}", "The JSON value could not be converted to System.String. Path: $.references[0] | LineNumber: 0 | BytePositionInLine: 16."),
            ("{\"references\":{}}", "The JSON value could not be converted to System.String[]. Path: $.references | LineNumber: 0 | BytePositionInLine: 15."),
            ("{\"format\":true}", "The JSON value could not be converted to System.String. Path: $.format | LineNumber: 0 | BytePositionInLine: 14."),
            ("{\"format\":false}", "The JSON value could not be converted to System.String. Path: $.format | LineNumber: 0 | BytePositionInLine: 15."),
            ("{\"model\":[]}", "The JSON value could not be converted to System.String. Path: $.model | LineNumber: 0 | BytePositionInLine: 10."),
            ("{\"model\":{}}", "The JSON value could not be converted to System.String. Path: $.model | LineNumber: 0 | BytePositionInLine: 10."),
            ("{\"version\":null}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 15."),
            ("{\"version\":[]}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 12."),
            ("{\"version\":{}}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 12."),
            ("{\"version\":\"x\"}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 14."),
            ("{\"version\":true}", "The JSON value could not be converted to System.Int32. Path: $.version | LineNumber: 0 | BytePositionInLine: 15."),
        ];
        for (request, expected) in cases {
            let (code, message) =
                refused(&lab.call_raw(request.as_bytes(), &lab.text("out/skinned.ydd")));
            assert_eq!(code, "JsonException", "{request:?}");
            assert_eq!(&message, expected, "{request:?}");
        }
        // повторяющееся имя: побеждает последнее
        let model = lab.model(&cloth_ydd(0, 0));
        let twice = format!(
            r#"{{"format":"astral.skin-from-body","version":1,"version":1,"model":{},"references":[{}]}}"#,
            json!(model),
            json!(lab.text("body.ydd"))
        );
        done(&lab.call_raw(twice.as_bytes(), &lab.text("out/skinned.ydd")));
    }

    #[test]
    fn missing_arguments_and_request_file_follow_the_host() {
        let argv = |parts: &[&str]| {
            parts
                .iter()
                .map(|part| (*part).to_owned())
                .collect::<Vec<_>>()
        };
        let lab = Lab::new();
        let outcome = run(
            &argv(&["skin-from-body", "--output", &lab.text("o.ydd")]),
            &Progress::silent(),
        );
        assert_eq!(
            outcome.line,
            r#"{"ok":false,"error":{"code":"ArgumentException","message":"--input is required."}}"#
        );
        let outcome = run(
            &argv(&["skin-from-body", "--input", &lab.text("body.ydd")]),
            &Progress::silent(),
        );
        assert_eq!(
            outcome.line,
            r#"{"ok":false,"error":{"code":"ArgumentException","message":"--output is required."}}"#
        );
        let outcome = run(
            &argv(&[
                "skin-from-body",
                "--input",
                &lab.text("none.json"),
                "--output",
                &lab.text("o.ydd"),
            ]),
            &Progress::silent(),
        );
        let value: Value = serde_json::from_str(&outcome.line).unwrap();
        assert_eq!(value["error"]["code"], json!("FileNotFoundException"));
        assert_eq!(
            value["error"]["message"],
            json!(format!(
                "Could not find file '{}'.",
                paths::full_path(&lab.text("none.json")).unwrap().display()
            ))
        );
    }

    #[test]
    fn path_arguments_follow_the_host_texts() {
        let lab = Lab::new();
        lab.model(&cloth_ydd(0, 0));
        let request = lab.request(&lab.text("model.ydd")).to_string();
        fs::write(lab.path("request.json"), &request).unwrap();
        let ask = |input: &str, output: &str| {
            let argv: Vec<String> = ["skin-from-body", "--input", input, "--output", output]
                .map(String::from)
                .to_vec();
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str::<Value>(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        };
        let good = lab.text("request.json");
        let out = lab.text("out/skinned.ydd");
        let cases: Vec<(String, String, &str, String)> = vec![
            (
                String::new(),
                out.clone(),
                "ArgumentException",
                "The value cannot be an empty string. (Parameter 'path')".into(),
            ),
            (
                "   ".into(),
                out.clone(),
                "ArgumentException",
                "The path is empty. (Parameter 'path')".into(),
            ),
            (
                lab.text("nodir/x.json"),
                out.clone(),
                "DirectoryNotFoundException",
                format!(
                    "Could not find a part of the path '{}'.",
                    paths::full_path(&lab.text("nodir/x.json"))
                        .unwrap()
                        .display()
                ),
            ),
            (
                lab.dir.path().display().to_string(),
                out.clone(),
                "UnauthorizedAccessException",
                format!(
                    "Access to the path '{}' is denied.",
                    paths::full_path(&lab.dir.path().display().to_string())
                        .unwrap()
                        .display()
                ),
            ),
            (
                good.clone(),
                String::new(),
                "ArgumentException",
                "The path is empty. (Parameter 'path')".into(),
            ),
            (
                good.clone(),
                "  ".into(),
                "ArgumentException",
                "The path is empty. (Parameter 'path')".into(),
            ),
            (
                good.clone(),
                format!("{}/", lab.text("folder.ydd")),
                "InvalidDataException",
                "Skin output must be a .ydd file.".into(),
            ),
        ];
        for (input, output, code, message) in cases {
            let answer = ask(&input, &output);
            assert_eq!(
                refused(&answer),
                (code.to_owned(), message),
                "{input:?} {output:?}"
            );
        }
        // пробелы в конце выходного пути хост отбрасывает
        let answer = ask(&good, &format!("{} ", lab.text("trimmed.ydd")));
        assert_eq!(done(&answer)["file"], json!("trimmed.ydd"));
        assert!(lab.path("trimmed.ydd").is_file());
    }

    #[test]
    fn the_output_must_be_a_ydd_and_it_is_checked_before_the_model_is_read() {
        let lab = Lab::new();
        let request = lab.request(&lab.text("none.ydd")).to_string();
        let answer = lab.call_raw(request.as_bytes(), &lab.text("out/skinned.bin"));
        assert_eq!(
            refused(&answer),
            (
                "InvalidDataException".to_owned(),
                "Skin output must be a .ydd file.".to_owned()
            )
        );
        let upper = lab.call_raw(
            lab.request(&lab.model(&cloth_ydd(0, 0)))
                .to_string()
                .as_bytes(),
            &lab.text("out/skinned.YDD"),
        );
        done(&upper);
    }

    // ---------- отказы моделей ----------

    #[test]
    fn broken_models_are_refused_with_the_host_texts() {
        let lab = Lab::new();
        let cases: Vec<(&str, Vec<u8>, &str, &str)> = vec![
            (
                "пустой файл",
                Vec::new(),
                "InvalidDataException",
                "Skin model is empty or too large.",
            ),
            (
                "не ресурс",
                b"garbage-not-a-model".to_vec(),
                "InvalidDataException",
                "The archive entry was compressed using an unsupported compression method.",
            ),
        ];
        for (name, bytes, code, message) in cases {
            let model = lab.model(&bytes);
            let answer = lab.call(&lab.request(&model));
            assert_eq!(
                refused(&answer),
                (code.to_owned(), message.to_owned()),
                "{name}"
            );
        }
        // образец без вершин с кожей: нечего переносить
        let bare_body = lab.path("bare.ydd");
        fs::write(&bare_body, cloth_ydd(0, 0)).unwrap();
        let model = lab.model(&cloth_ydd(0, 0));
        let mut request = lab.request(&model);
        request["references"] = json!([bare_body.display().to_string()]);
        let answer = lab.call(&request);
        assert_eq!(
            refused(&answer),
            (
                "InvalidDataException".to_owned(),
                "Reference body parts carry no skinned vertices.".to_owned()
            )
        );
        // у образца словарь рисовалок пуст
        let mut broken_reference = lab.request(&model);
        fs::write(lab.path("garbage.ydd"), b"garbage-not-a-model").unwrap();
        broken_reference["references"] = json!([lab.text("garbage.ydd")]);
        let answer = lab.call(&broken_reference);
        assert_eq!(
            refused(&answer).1,
            "The archive entry was compressed using an unsupported compression method."
        );
    }

    #[test]
    fn real_models_without_skin_from_the_shop_set_are_counted_but_not_changed() {
        // Настоящая модель игры без кожи: её байты вершин лежат не там, где их ждёт правка, — вещь остаётся как есть.
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../../../resources/optimization/shelf-goods/ch1_01_liquorstore_slod_children.ydd",
        );
        let Ok(original) = fs::read(&source) else {
            return;
        };
        let lab = Lab::new();
        let model = lab.model(&original);
        let answer = lab.call(&lab.request(&model));
        let result = done(&answer);
        assert_eq!(
            (
                result["changed"].as_bool(),
                result["models"].as_u64(),
                result["geometries"].as_u64()
            ),
            (Some(false), Some(1), Some(0))
        );
        assert_eq!(fs::read(lab.path("out/skinned.ydd")).unwrap(), original);
    }

    // ---------- настоящие части тела игры ----------

    /// Каталог игры и ключи из окружения; иначе тест пропускается.
    fn game() -> Option<(String, String)> {
        Some((
            std::env::var("ASTRAL_TEST_GAME").ok()?,
            std::env::var("ASTRAL_TEST_KEYS").ok()?,
        ))
    }

    fn read_game_entry(game: &(String, String), entry: &str, output: &Path) {
        let argv: Vec<String> = [
            "read-archive-file",
            "--game-root",
            &game.0,
            "--keys",
            &game.1,
            "--entry",
            entry,
            "--output",
            &output.display().to_string(),
        ]
        .map(String::from)
        .to_vec();
        let outcome = run(&argv, &Progress::silent());
        assert_eq!(outcome.exit_code, 0, "{}", outcome.line);
    }

    #[test]
    fn the_real_male_body_parts_skin_a_model_that_lost_its_flag() {
        let Some(game) = game() else {
            return;
        };
        let lab = Lab::new();
        let folder = "x64v:/models/cdimages/streamedpeds_mp.rpf/mp_m_freemode_01";
        let parts = [
            "uppr_015_r.ydd",
            "lowr_000_r.ydd",
            "feet_005_r.ydd",
            "head_013_r.ydd",
        ];
        for name in parts {
            read_game_entry(&game, &format!("{folder}/{name}"), &lab.path(name));
        }
        // Вещь — сама часть тела, у которой флаг кожи снят: ближайшая вершина у каждой вершины — она сама, веса те же.
        let original = fs::read(lab.path("uppr_015_r.ydd")).unwrap();
        let mut graph = graph_of(&original).unwrap();
        let drawable = drawable_at(&graph, 0).unwrap();
        // Все уровни рисовалки: списки моделей по +0x50, +0x58, +0x60, +0x68.
        let split = super::super::split::pointer_block;
        let mut models = Vec::new();
        for list in [0x50usize, 0x58, 0x60, 0x68] {
            let Some(head) = split(&graph, drawable, list) else {
                continue;
            };
            let entries = split(&graph, head, 0).unwrap();
            let count = super::super::split::u16_at(&graph, head, 8).unwrap();
            models.extend((0..usize::from(count)).map(|n| split(&graph, entries, n * 8).unwrap()));
        }
        assert_eq!(models.len(), 3, "у части тела модели High, Med и Low");
        for model in models {
            let word = u32::from_le_bytes(graph.content(model)[0x28..0x2c].try_into().unwrap())
                & 0xffff_00ff;
            rgraph::write_at(&mut graph, model, 0x28, &word.to_le_bytes()).unwrap();
        }
        let flagged = lab.path("flagged.ydd");
        fs::write(&flagged, finish_compact(&graph).unwrap()).unwrap();
        let references: Vec<String> = parts.iter().map(|name| lab.text(name)).collect();
        let request = json!({ "format": "astral.skin-from-body", "version": 1, "model": flagged.display().to_string(), "references": references });
        let answer = lab.call(&request);
        let result = done(&answer);
        assert_eq!(result["changed"], json!(true));
        assert_eq!(result["models"], json!(3), "{result}");
        assert!(result["geometries"].as_u64().unwrap() >= 3, "{result}");
        let skinned = graph_of(&fs::read(lab.path("out/skinned.ydd")).unwrap()).unwrap();
        body_skin::verify_skinned(&skinned, result["geometries"].as_u64().unwrap() as usize)
            .expect("у всех геометрий веса");
        // детерминирован
        let again = lab.call(&request);
        assert_eq!(done(&again)["sha256"], result["sha256"]);
        let _: Option<Segment> = None;
    }
}
