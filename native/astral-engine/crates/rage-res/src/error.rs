//! Общий тип отказа разбора и записи ресурсов.

use std::io;

pub type Result<T> = std::result::Result<T, Error>;

/// Виды отказа и именованные конструкторы пишутся одним списком: у вида без имени
/// конструктора («Enhanced», «Io») нет и короткой формы.
macro_rules! error_kinds {
    ($($variant:ident $(=> $constructor:ident)?),+ $(,)?) => {
        /// Вид отказа: по нему слой команд выбирает код ответа.
        #[derive(Debug)]
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum Kind {
            $($variant),+
        }

        impl Error {
            $($(
                pub fn $constructor(message: impl Into<String>) -> Self {
                    Self::new(Kind::$variant, message)
                }
            )?)+
        }
    };
}

error_kinds! {
    Broken => broken,
    Version => version,
    Enhanced,
    Texture => texture,
    Argument => argument,
    Operation => operation,
    Io,
}

#[derive(Debug, Clone)]
pub struct Error {
    pub kind: Kind,
    pub message: String,
}

impl Error {
    pub fn new(kind: Kind, message: impl Into<String>) -> Self {
        let message = message.into();
        Self { kind, message }
    }
}

impl std::error::Error for Error {}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message.as_str())
    }
}

impl From<io::Error> for Error {
    fn from(error: io::Error) -> Self {
        let message = error.to_string();
        Error {
            kind: Kind::Io,
            message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    /// Отладочная запись ошибки с видом `kind` и сообщением `message`.
    fn debug_of(kind: &str, message: &str) -> String {
        format!("Error {{ kind: {kind}, message: {message:?} }}")
    }

    #[test]
    fn debug_and_display() {
        let e = Error::new(Kind::Broken, "m");
        assert_eq!(format!("{e:?}"), debug_of("Broken", "m"));
        assert_eq!(e.to_string(), "m");
    }

    #[test]
    fn named_constructors_pick_their_kind() {
        type Constructor = fn(&str) -> Error;
        let constructors: [(Constructor, Kind, &str); 5] = [
            (|m| Error::broken(m), Kind::Broken, "Broken"),
            (|m| Error::version(m), Kind::Version, "Version"),
            (|m| Error::texture(m), Kind::Texture, "Texture"),
            (|m| Error::argument(m), Kind::Argument, "Argument"),
            (|m| Error::operation(m), Kind::Operation, "Operation"),
        ];
        for (make, kind, name) in constructors {
            let error = make("x");
            assert_eq!(error.kind, kind);
            assert_eq!(format!("{error:?}"), debug_of(name, "x"));
        }
    }

    #[test]
    fn new_accepts_owned_string_and_enhanced() {
        let e = Error::new(Kind::Enhanced, String::from("s"));
        assert_eq!(format!("{e:?}"), debug_of("Enhanced", "s"));
    }

    #[test]
    fn io_errors_become_io_kind() {
        let from_kind = |kind: io::ErrorKind| Error::from(io::Error::from(kind));
        let e = from_kind(io::ErrorKind::NotFound);
        assert_eq!(format!("{e:?}"), debug_of("Io", "entity not found"));
        let e = Error::from(io::Error::other("boom"));
        assert_eq!(e.to_string(), "boom");
        assert_eq!(from_kind(io::ErrorKind::PermissionDenied).kind, Kind::Io);
    }

    #[test]
    fn boxed_error_has_no_source() {
        let boxed: Box<dyn std::error::Error> = Box::new(Error::broken("q"));
        assert!(boxed.source().is_none());
        assert_eq!(boxed.to_string(), "q");
    }

    #[test]
    fn kind_equality_and_empty_message() {
        assert_eq!(Kind::Io, Kind::Io);
        assert_ne!(Kind::Io, Kind::Broken);
        assert_eq!(Error::broken("").to_string(), "");
    }

    #[test]
    fn error_is_send_sync() {
        fn check<T: Send + Sync + Clone>() {}
        check::<Error>();
    }
}
