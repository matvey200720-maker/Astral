// SHA-256 файла по ходу его записи: отдельный поток читает уже записанное.
//
// Писатель после каждого тела сообщает, докуда файл окончательно записан
// (`Watermark`). Читатель (`FileDigest`) ждёт голову файла, потом идёт по области
// данных за этой отметкой и хеширует то, что лежит на диске (данные только что
// записаны и ещё в кэше системы). Так отдельного прохода по готовому файлу после
// записи не остаётся: читатель отстаёт от писателя и догоняет его, пока тот занят
// диском и доводчиком.

use crate::{
    error::{Result, RpfError},
    read_pace,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Condvar, Mutex, PoisonError},
    thread::{self, JoinHandle},
};

// Читать записанное порциями этого размера.
const PORTION: usize = 4 << 20;

// Читатель просыпается, когда записано хотя бы столько новых байт.
const BATCH: u64 = 1 << 20;

// Выравнивание чтения мимо кэша: размер сектора не больше 4096 байт.
const ALIGN: u64 = 4096;

// Читатель записанного, пока файл пишет другой поток.
//
// На Windows чтение идёт мимо кэша системы (`FILE_FLAG_NO_BUFFERING`, выключатель
// `ASTRAL_ENGINE_DIGEST_UNCACHED=0`): так читатель не кладёт в кэш страницы файла,
// растянутого заранее, пока писатель их ещё не записал, и не видит в кэше
// устаревших. Данные, которые писатель только что отдал системе, система сама
// сбрасывает на диск перед таким чтением.
struct Reader {
    file: File,
    uncached: bool,
    raw: Vec<u8>,
}

#[cfg(windows)]
fn open_uncached(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    // FILE_FLAG_NO_BUFFERING
    const NO_BUFFERING: u32 = 0x2000_0000;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(NO_BUFFERING)
        .open(path)
}

impl Reader {
    fn open(path: &Path) -> io::Result<Reader> {
        #[cfg(windows)]
        {
            let off = std::env::var("ASTRAL_ENGINE_DIGEST_UNCACHED").is_ok_and(|v| v.trim() == "0");
            if !off {
                if let Ok(file) = open_uncached(path) {
                    return Ok(Reader {
                        file,
                        uncached: true,
                        raw: vec![0u8; PORTION + 3 * ALIGN as usize],
                    });
                }
            }
        }
        Ok(Reader {
            file: File::open(path)?,
            uncached: false,
            raw: vec![0u8; PORTION],
        })
    }

    // `len` байт файла с `pos` (`len` не больше `PORTION`).
    fn read(&mut self, pos: u64, len: usize) -> io::Result<&[u8]> {
        if !self.uncached {
            self.file.seek(SeekFrom::Start(pos))?;
            self.file.read_exact(&mut self.raw[..len])?;
            return Ok(&self.raw[..len]);
        }
        // чтение мимо кэша: с начала сектора, буфер выровнен, лишнее отбрасывается
        let start = pos & !(ALIGN - 1);
        let lead = (pos - start) as usize;
        let want = lead + len;
        let span = want.div_ceil(ALIGN as usize) * ALIGN as usize;
        let skew = self.raw.as_ptr().align_offset(ALIGN as usize);
        let window = &mut self.raw[skew..skew + span];
        self.file.seek(SeekFrom::Start(start))?;
        let mut got = 0;
        while got < want {
            match self.file.read(&mut window[got..])? {
                0 => return Err(io::ErrorKind::UnexpectedEof.into()),
                n => got += n,
            }
        }
        Ok(&self.raw[skew + lead..skew + lead + len])
    }
}

#[derive(Default)]
struct Mark {
    cursor: u64,
    closed: bool,
}

// Отметка записанного: растёт только вверх, закрывается при любом исходе записи.
#[derive(Default)]
pub struct Watermark {
    state: Mutex<Mark>,
    moved: Condvar,
}

impl Watermark {
    pub fn new() -> Arc<Watermark> {
        Arc::new(Watermark::default())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Mark> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    // Файл окончательно записан до смещения `to` (от начала файла).
    pub fn advance(&self, to: u64) {
        let mut state = self.lock();
        if to > state.cursor {
            state.cursor = to;
            self.moved.notify_all();
        }
    }

    // Писать больше не будут (записано всё либо запись оборвалась).
    pub fn close(&self) {
        self.lock().closed = true;
        self.moved.notify_all();
    }

    // Ждёт, пока отметка уйдёт за `pos` или отметку закроют; отдаёт отметку и
    // признак «закрыта».
    fn wait_beyond(&self, pos: u64) -> (u64, bool) {
        let mut state = self.lock();
        while state.cursor <= pos && !state.closed {
            state = self
                .moved
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
        (state.cursor, state.closed)
    }
}

// Читатель отпечатка: поток, который хеширует голову файла, а затем область данных
// `from..to` по мере записи.
pub struct FileDigest {
    worker: Option<JoinHandle<Result<Sha256>>>,
}

fn aborted() -> RpfError {
    RpfError::state("The digest reader stopped before the end of the file.")
}

impl FileDigest {
    // Запускает читателя и отдаёт канал для головы файла. Читатель стартует с
    // головы: пока её нет, он ждёт; если все отправители закрыты, а головы не было,
    // он уходит (отпечатка не будет). `path` — файл, который пишет другой поток.
    pub fn start(
        path: PathBuf,
        from: u64,
        to: u64,
        mark: Arc<Watermark>,
    ) -> std::io::Result<(FileDigest, mpsc::Sender<Vec<u8>>)> {
        let (send, receive) = mpsc::channel::<Vec<u8>>();
        // потолок чтения запроса действует и на читателя
        let pace = read_pace::current();
        // счёт байт запроса: чтение читателя тоже его
        let counted = crate::tally::current();
        let worker = thread::Builder::new().name("rpf-sha256".to_owned()).spawn(
            move || -> Result<Sha256> {
                pace.install();
                let _counted = crate::tally::adopt(counted);
                let head = receive.recv().map_err(|_| aborted())?;
                let mut digest = Sha256::new();
                digest.update(&head);
                drop(head);
                // файл открывается, когда в нём уже есть записанное: писатель создаёт его позже
                let mut reader: Option<Reader> = None;
                let mut pos = from;
                while pos < to {
                    // не по каждому телу: ждать, пока набежит хотя бы `BATCH` байт (или файл
                    // дописан до конца); чтение мимо кэша дорого на каждом маленьком теле
                    let (cursor, closed) = mark.wait_beyond((pos + BATCH).min(to) - 1);
                    let upto = cursor.min(to);
                    if upto <= pos {
                        // отметка закрыта, а дальше записывать нечего: запись оборвалась
                        debug_assert!(closed);
                        return Err(aborted());
                    }
                    let reader = match reader.as_mut() {
                        Some(reader) => reader,
                        None => reader.insert(Reader::open(&path)?),
                    };
                    while pos < upto {
                        let take = (upto - pos).min(PORTION as u64) as usize;
                        let bytes = reader.read(pos, take)?;
                        read_pace::pace_read(take as u64);
                        digest.update(bytes);
                        pos += take as u64;
                    }
                }
                Ok(digest)
            },
        )?;
        Ok((
            FileDigest {
                worker: Some(worker),
            },
            send,
        ))
    }

    // Дожидается читателя: состояние хеша после головы и всей области данных.
    pub fn finish(mut self) -> Result<Sha256> {
        match self.worker.take() {
            Some(worker) => worker.join().unwrap_or_else(|_| Err(aborted())),
            None => Err(aborted()),
        }
    }
}

impl Drop for FileDigest {
    fn drop(&mut self) {
        // без ожидания: читателя отпускают закрытая отметка и закрытый канал головы
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

// Читает участок файла `from..to` в хеш (хвост, который дописал доводчик).
pub fn absorb_range(digest: &mut Sha256, file: &mut File, from: u64, to: u64) -> Result<()> {
    file.seek(SeekFrom::Start(from))?;
    let mut buf = vec![0u8; PORTION.min(to.saturating_sub(from) as usize)];
    let mut left = to.saturating_sub(from);
    while left > 0 {
        let take = left.min(buf.len() as u64) as usize;
        file.read_exact(&mut buf[..take])?;
        digest.update(&buf[..take]);
        left -= take as u64;
    }
    Ok(())
}
