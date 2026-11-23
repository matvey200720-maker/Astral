// Источники байт с произвольным доступом: файл, память, окно внутри другого источника.

use crate::read_pace::pace_read;
use std::{
    fs::File,
    io::{self, ErrorKind},
    path::Path,
    sync::Arc,
};

// Короткие имена для типов из подписей: это те же самые типы.
type Done = io::Result<()>;
type Filled = io::Result<Vec<u8>>;
type Window<'a> = &'a mut [u8];

fn eof(text: &'static str) -> io::Error {
    io::Error::new(ErrorKind::UnexpectedEof, text)
}

// Структура с закрытыми полями по списку «поле => тип».
macro_rules! fields_struct {
    ($vis:vis $name:ident { $($field:ident => $ty:ty;)+ }) => {
        $vis struct $name {
            $($field: $ty,)+
        }
    };
}

// Реализация источника по двум выражениям: длина и чтение в буфер.
macro_rules! byte_source {
    (
        $kind:ty,
        $this:ident,
        length = $len:expr,
        read($offset:ident, $buf:ident) $read:block
    ) => {
        impl ByteSource for $kind {
            fn len(&$this) -> u64 {
                $len
            }

            fn read_at(&$this, $offset: u64, $buf: Window) -> Done $read
        }
    };
}

pub trait ByteSource: Send + Sync {
    // Общая проверка границ для всех реализаций: участок [offset, offset + length)
    // должен целиком лежать внутри источника.
    #[doc(hidden)]
    fn ensure_range(&self, offset: u64, length: usize) -> Done {
        offset
            .checked_add(length as u64)
            .filter(|&end| end <= self.len())
            .map(|_| ())
            .ok_or_else(|| eof("read beyond the end of the source"))
    }

    fn len(&self) -> u64;

    fn read_at(&self, offset: u64, buf: Window) -> Done;

    // Границы проверяются до выделения: длина из порченого оглавления не должна
    // заставлять выделять гигабайты ради отказа.
    fn read_vec(&self, offset: u64, length: usize) -> Filled {
        self.ensure_range(offset, length)?;
        let mut buffer = vec![0u8; length];
        self.read_at(offset, &mut buffer).map(|()| buffer)
    }

    fn is_empty(&self) -> bool {
        matches!(self.len(), 0)
    }
}

pub struct MemSource(pub Vec<u8>);

byte_source! {
    MemSource,
    self,
    length = self.0.len() as u64,
    read(offset, buf) {
        self.ensure_range(offset, buf.len())?;
        let from = offset as usize;
        let to = from + buf.len();
        buf.copy_from_slice(&self.0[from..to]);
        Ok(())
    }
}

// Позиционное чтение файла; разница между системами спрятана внутри.
struct Positional(File);

impl Positional {
    fn fill(&self, offset: u64, buf: Window) -> Done {
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;

            self.0.read_exact_at(buf, offset)
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileExt;

            let mut done = 0usize;
            while done < buf.len() {
                match self.0.seek_read(&mut buf[done..], offset + done as u64) {
                    Ok(0) => return Err(ErrorKind::UnexpectedEof.into()),
                    Ok(got) => done += got,
                    Err(e) if e.kind() == ErrorKind::Interrupted => {}
                    Err(e) => return Err(e),
                }
            }
            Ok(())
        }
    }
}

fields_struct! {
    pub FileSource {
        io => Positional;
        size => u64;
    }
}

impl FileSource {
    pub fn open(path: &Path) -> io::Result<FileSource> {
        match File::open(path) {
            Ok(file) => FileSource::from_file(file),
            Err(cause) => Err(cause),
        }
    }

    pub fn from_file(file: File) -> io::Result<FileSource> {
        file.metadata().map(|meta| FileSource {
            size: meta.len(),
            io: Positional(file),
        })
    }
}

byte_source! {
    FileSource,
    self,
    length = self.size,
    read(offset, buf) {
        self.ensure_range(offset, buf.len())?;
        pace_read(buf.len() as u64);
        self.io.fill(offset, buf)
    }
}

fields_struct! {
    pub SliceSource {
        inner => Arc<dyn ByteSource>;
        start => u64;
        size => u64;
    }
}

impl SliceSource {
    pub fn new(inner: Arc<dyn ByteSource>, start: u64, len: u64) -> io::Result<SliceSource> {
        if start.checked_add(len).is_some_and(|end| end <= inner.len()) {
            Ok(SliceSource {
                inner,
                start,
                size: len,
            })
        } else {
            Err(eof("the window goes beyond the end of the source"))
        }
    }
}

byte_source! {
    SliceSource,
    self,
    length = self.size,
    read(offset, buf) {
        self.ensure_range(offset, buf.len())
            .and_then(|()| self.inner.read_at(self.start + offset, buf))
    }
}

// Источник с подставленными участками: то, что читатель увидел бы, если бы
// участки уже лежали на диске. Так открывается архив «как будет» до записи
// новой головы: длина и тела берутся из файла, голова — из подстановки.
fields_struct! {
    pub OverlaySource {
        inner => Arc<dyn ByteSource>;
        patches => Vec<(u64, Vec<u8>)>;
    }
}

impl OverlaySource {
    // Участки обязаны лежать внутри источника; перекрывающиеся накладываются
    // по порядку (последний побеждает).
    pub fn new(inner: Arc<dyn ByteSource>, patches: Vec<(u64, Vec<u8>)>) -> io::Result<OverlaySource> {
        let size = inner.len();
        let fits = patches.iter().all(|(at, bytes)| {
            at.checked_add(bytes.len() as u64)
                .is_some_and(|end| end <= size)
        });
        if fits {
            Ok(OverlaySource { inner, patches })
        } else {
            Err(eof("a patch goes beyond the end of the source"))
        }
    }
}

byte_source! {
    OverlaySource,
    self,
    length = self.inner.len(),
    read(offset, buf) {
        self.ensure_range(offset, buf.len())?;
        self.inner.read_at(offset, buf)?;
        let end = offset + buf.len() as u64;
        for (at, bytes) in &self.patches {
            let from = (*at).max(offset);
            let to = (*at + bytes.len() as u64).min(end);
            if from < to {
                buf[(from - offset) as usize..(to - offset) as usize]
                    .copy_from_slice(&bytes[(from - *at) as usize..(to - *at) as usize]);
            }
        }
        Ok(())
    }
}
