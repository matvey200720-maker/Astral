// Единый вид отказа для чтения и записи архивов, ключей и источников байт.

use std::borrow::Cow;
use std::error::Error;
use std::fmt;
use std::io;

pub type Result<T> = std::result::Result<T, RpfError>;

#[derive(Debug)]
pub enum RpfError {
    Io(io::Error),
    Format(String),
    Keys(String),
    NotFound(String),
    Argument(String),
    State(String),
    Cancelled,
}

impl From<io::Error> for RpfError {
    fn from(error: io::Error) -> Self {
        RpfError::Io(error)
    }
}

impl RpfError {
    pub fn not_found(message: impl Into<String>) -> Self {
        RpfError::NotFound(message.into())
    }

    pub fn argument(message: impl Into<String>) -> Self {
        RpfError::Argument(message.into())
    }

    pub fn state(message: impl Into<String>) -> Self {
        RpfError::State(message.into())
    }

    pub fn format(message: impl Into<String>) -> Self {
        RpfError::Format(message.into())
    }

    pub fn keys(message: impl Into<String>) -> Self {
        RpfError::Keys(message.into())
    }

    fn io_cause(&self) -> Option<&io::Error> {
        if let RpfError::Io(inner) = self {
            Some(inner)
        } else {
            None
        }
    }

    // Текст отказа: у вариантов с сообщением — оно само, у отмены — фраза.
    fn message(&self) -> Cow<'_, str> {
        match self {
            RpfError::Io(inner) => Cow::Owned(inner.to_string()),
            RpfError::Cancelled => Cow::Borrowed("Отменено."),
            RpfError::Format(text)
            | RpfError::Keys(text)
            | RpfError::NotFound(text)
            | RpfError::Argument(text)
            | RpfError::State(text) => Cow::Borrowed(text.as_str()),
        }
    }
}

impl fmt::Display for RpfError {
    // Ширина и выравнивание не действуют: текст пишется одной записью строки.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message())
    }
}

impl Error for RpfError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self.io_cause() {
            Some(cause) => Some(cause as &(dyn Error + 'static)),
            None => None,
        }
    }
}
