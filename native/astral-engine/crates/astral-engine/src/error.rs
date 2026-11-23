//! Единый отказ команды движка: пара «код, сообщение».
//!
//! Коды — имена типов исключений прежнего хоста (`ArgumentException`,
//! `FileNotFoundException` и так далее): паритетный прогон сверяет их вместе
//! с ответами. Ответ `{ok:false}` строит `response`, код выхода процесса
//! выбирает `lib`; здесь только хранение и переходы из чужих ошибок.

use std::fmt;
use std::io::{self, ErrorKind};

use rage_res::Kind;
use rage_rpf::RpfError;

/// Сообщение отмены. Одно и то же для `cancelled()` и `RpfError::Cancelled`.
const CANCELLED_MESSAGE: &str = "Отменено.";

/// Словарь кодов, которые создаёт сам модуль.
#[derive(Clone, Copy)]
enum Code {
    Argument,
    FileNotFound,
    DirectoryNotFound,
    InvalidData,
    InvalidOperation,
    Io,
    Unauthorized,
    Internal,
    Cancelled,
}

impl Code {
    const fn name(self) -> &'static str {
        match self {
            Code::Argument => "ArgumentException",
            Code::FileNotFound => "FileNotFoundException",
            Code::DirectoryNotFound => "DirectoryNotFoundException",
            Code::InvalidData => "InvalidDataException",
            Code::InvalidOperation => "InvalidOperationException",
            Code::Io => "IOException",
            Code::Unauthorized => "UnauthorizedAccessException",
            Code::Internal => "InternalError",
            Code::Cancelled => "Cancelled",
        }
    }
}

/// Какой код получает ошибка ввода-вывода данного вида; остальные виды - `IOException`.
const IO_KIND_CODES: [(ErrorKind, Code); 2] = [
    (ErrorKind::NotFound, Code::FileNotFound),
    (ErrorKind::PermissionDenied, Code::Unauthorized),
];

/// Какой код получает ошибка `rage_res` данного вида; остальные виды -
/// `InvalidOperationException`. Вид `Io` не различает «не найден» и «нет доступа».
const RES_KIND_CODES: [(Kind, Code); 2] = [(Kind::Argument, Code::Argument), (Kind::Io, Code::Io)];

fn code_for_io(error: &io::Error) -> Code {
    let mut code = Code::Io;
    for &(kind, candidate) in &IO_KIND_CODES {
        if kind == error.kind() {
            code = candidate;
            break;
        }
    }
    code
}

/// Отказ команды. Что получено, то и хранится: пустые код и сообщение допустимы.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineError {
    pub code: String,
    pub message: String,
}

pub type Result<T> = std::result::Result<T, EngineError>;

impl EngineError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn invalid_data(message: impl Into<String>) -> Self {
        Self::new(Code::InvalidData.name(), message)
    }

    pub fn invalid_operation(message: impl Into<String>) -> Self {
        Self::new(Code::InvalidOperation.name(), message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(Code::Io.name(), message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(Code::Internal.name(), message)
    }

    pub fn cancelled() -> Self {
        Self::new(Code::Cancelled.name(), CANCELLED_MESSAGE)
    }

    pub fn argument(message: impl Into<String>) -> Self {
        Self::new(Code::Argument.name(), message)
    }

    pub fn file_not_found(message: impl Into<String>) -> Self {
        Self::new(Code::FileNotFound.name(), message)
    }

    pub fn directory_not_found(message: impl Into<String>) -> Self {
        Self::new(Code::DirectoryNotFound.name(), message)
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for EngineError {}

impl From<io::Error> for EngineError {
    fn from(error: io::Error) -> Self {
        let code = code_for_io(&error);
        Self::new(code.name(), error.to_string())
    }
}

impl From<RpfError> for EngineError {
    /// Сообщение - текст самой ошибки `RpfError` (для `Io` текст вложенной
    /// ошибки, для `Cancelled` `Отменено.`), код - по варианту.
    fn from(error: RpfError) -> Self {
        let code = match &error {
            RpfError::Io(inner) => code_for_io(inner),
            RpfError::Format(_) => Code::InvalidData,
            RpfError::Keys(_) | RpfError::State(_) => Code::InvalidOperation,
            RpfError::NotFound(_) => Code::FileNotFound,
            RpfError::Argument(_) => Code::Argument,
            RpfError::Cancelled => Code::Cancelled,
        };
        Self::new(code.name(), error.to_string())
    }
}

impl From<rage_res::Error> for EngineError {
    fn from(error: rage_res::Error) -> Self {
        let mut code = Code::InvalidOperation;
        for &(kind, candidate) in &RES_KIND_CODES {
            if kind == error.kind {
                code = candidate;
                break;
            }
        }
        Self::new(code.name(), error.message)
    }
}
