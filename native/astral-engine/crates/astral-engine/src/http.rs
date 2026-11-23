//! Канал данных для окна Astral: небольшой HTTP-сервер на петлевом адресе.
//!
//! Через него окно забирает готовые байты (ассеты, звуки банков) и кладёт
//! звуковые банки в хранилище. Слушается только `127.0.0.1`; у каждого запуска
//! свой токен; `Host` сверяется целиком; междоменный доступ получает лишь
//! страница окна; отдаются только файлы, названные отпечатком sha256.

use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    fs::{self, File},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{Ipv4Addr, Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};

use crate::{archives::points::local_app_data, awc_channel, shelf::Shelf};

// ---------------------------------------------------------------------------
// Настройка
// ---------------------------------------------------------------------------

/// Настройка канала.
#[derive(Clone, Debug)]
pub struct Config {
    pub origin: Option<String>,
    pub token: String,
    pub assets: PathBuf,
}

/// Токен короче этого числа байт (после обрезки краёв) не принимается.
const MIN_TOKEN_BYTES: usize = 32;

/// Токен запуска (его вписывает главный процесс окна).
pub const TOKEN_ENV: &str = "ASTRAL_ENGINE_HTTP_TOKEN";

/// Токен: края без пробелов, длина считается в байтах UTF-8 после обрезки.
fn clean_token(raw: OsString) -> Option<String> {
    match raw.into_string() {
        Ok(text) if text.trim().len() >= MIN_TOKEN_BYTES => Some(text.trim().to_owned()),
        _ => None,
    }
}

/// Origin страниц окна, которому разрешён междоменный доступ.
pub const ORIGIN_ENV: &str = "ASTRAL_ENGINE_HTTP_ORIGIN";

/// Origin: сначала пробелы, потом все косые в конце; пустой результат — нет origin.
fn clean_origin(raw: OsString) -> Option<String> {
    let text = raw.into_string().unwrap_or_default();
    match text.trim().trim_end_matches('/') {
        "" => None,
        origin => Some(origin.to_owned()),
    }
}

/// Папка хранилища ассетов.
pub const ASSETS_ENV: &str = "ASTRAL_ENGINE_ASSETS_DIR";

/// Пустое значение — «не задано»; пробелы пустыми не считаются.
fn pick_assets(raw: Option<OsString>) -> PathBuf {
    raw.filter(|path| !path.is_empty())
        .map_or_else(default_assets_dir, PathBuf::from)
}

impl Config {
    fn from_lookup(lookup: &dyn Fn(&str) -> Option<OsString>) -> Option<Config> {
        let token = lookup(TOKEN_ENV).and_then(clean_token)?;
        let origin = lookup(ORIGIN_ENV).and_then(clean_origin);
        let assets = pick_assets(lookup(ASSETS_ENV));
        Some(Config {
            origin,
            token,
            assets,
        })
    }

    /// Настройка из окружения процесса; `None` — канал не поднимать.
    pub fn from_env() -> Option<Config> {
        Config::from_lookup(&|name| env::var_os(name))
    }
}

fn assets_under(mut base: PathBuf) -> PathBuf {
    base.extend(["Astral", "cache", "engine-assets"]);
    base
}

/// Хранилище по умолчанию: `<local_app_data>/Astral/cache/engine-assets`.
pub fn default_assets_dir() -> PathBuf {
    assets_under(local_app_data())
}

// ---------------------------------------------------------------------------
// Хранилище
// ---------------------------------------------------------------------------

/// Отпечаток содержимого: sha256 строчными шестнадцатеричными знаками.
pub(crate) fn fingerprint(content: impl AsRef<[u8]>) -> String {
    const NIBBLES: &[u8; 16] = b"0123456789abcdef";
    Sha256::digest(content)
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .map(|nibble| char::from(NIBBLES[usize::from(nibble)]))
        .collect()
}

/// Сколько знаков в имени файла хранилища.
const FINGERPRINT_CHARS: usize = 64;

/// Имя файла хранилища: ровно 64 знака `0-9a-f`.
fn is_fingerprint(text: &str) -> bool {
    let is_hex = |byte: &u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte);
    text.len() == FINGERPRINT_CHARS && text.as_bytes().iter().all(is_hex)
}

/// Кладёт байты под готовым отпечатком. Занятое имя не трогается и не сверяется.
/// Запись идёт во временный файл рядом и переименовывается; при неудаче
/// переименования временный файл убирается, а если целевой между тем
/// появился, это успех.
fn place(dir: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    let target = dir.join(name);
    if target.is_file() {
        return Ok(());
    }
    fs::create_dir_all(dir)?;
    let scratch = dir.join(format!("{name}.{}.stage", process::id()));
    // Если запись не удалась, временный файл остаётся лежать.
    File::create(&scratch)?.write_all(bytes)?;
    fs::rename(&scratch, &target).or_else(|failure| {
        let _ = fs::remove_file(&scratch);
        target.is_file().then_some(()).ok_or(failure)
    })
}

/// Сохраняет байты в файле хранилища, названном их sha256, и возвращает этот отпечаток.
pub fn store(dir: &Path, bytes: &[u8]) -> io::Result<String> {
    let name = fingerprint(bytes);
    place(dir, &name, bytes).map(|()| name)
}

// ---------------------------------------------------------------------------
// Голова запроса
// ---------------------------------------------------------------------------

struct Head {
    fields: HashMap<String, String>,
    target: String,
    method: String,
}

/// Строка без одного `\r` на конце.
fn without_cr(line: &str) -> &str {
    line.strip_suffix('\r').unwrap_or(line)
}

impl Head {
    /// Разбор текста головы: слова первой строки и пары `имя: значение`.
    /// Имя приводится к нижнему регистру, повторное имя не заменяет первое.
    fn parse(text: &str) -> Head {
        let mut lines = text.split('\n').map(without_cr);
        let mut words = lines
            .next()
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_owned);
        let method = words.next().unwrap_or_default();
        let target = words.next().unwrap_or_default();
        let fields = lines.filter_map(|line| line.split_once(':')).fold(
            HashMap::new(),
            |mut seen, (name, value)| {
                seen.entry(name.trim().to_lowercase())
                    .or_insert_with(|| value.trim().to_owned());
                seen
            },
        );
        Head {
            fields,
            target,
            method,
        }
    }

    fn field(&self, name: &'static str) -> Option<&str> {
        Some(self.fields.get(name)?.as_str())
    }

    fn wants_close(&self) -> bool {
        self.field("connection")
            .is_some_and(|value| value.eq_ignore_ascii_case("close"))
    }

    /// Заявленная длина тела: неотрицательное целое.
    fn declared_length(&self) -> Option<usize> {
        self.field("content-length")
            .and_then(|text| text.parse().ok())
    }
}

/// Самая длинная голова запроса, байт.
const HEAD_CEILING: usize = 16_384;

/// Читает голову запроса. `None` — читать нечего или голова не годится:
/// ответа не будет. Первая строка считается строкой запроса, даже пустая;
/// предел проверяется после каждой целой строки.
fn read_head(input: &mut impl BufRead) -> io::Result<Option<Head>> {
    let mut raw: Vec<u8> = Vec::new();
    let mut line_start = 0;
    while input.read_until(b'\n', &mut raw)? > 0 && raw.len() <= HEAD_CEILING {
        let is_blank = matches!(&raw[line_start..], b"\n" | b"\r\n");
        if is_blank && line_start > 0 {
            return Ok(Some(Head::parse(&String::from_utf8_lossy(&raw))));
        }
        line_start = raw.len();
    }
    Ok(None)
}

fn until_query(text: &str) -> &str {
    text.split_once('?').map_or(text, |(path, _)| path)
}

/// Сравнение секрета без раннего выхода по первому расхождению.
fn secrets_agree(given: &str, expected: &str) -> bool {
    given
        .bytes()
        .zip(expected.bytes())
        .fold(given.len() ^ expected.len(), |diff, (a, b)| {
            diff | usize::from(a ^ b)
        })
        == 0
}

// ---------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------

/// Слова статусов, которые канал вообще произносит.
const STATUS_WORDS: [(u16, &str); 13] = [
    (200, "OK"),
    (204, "No Content"),
    (206, "Partial Content"),
    (400, "Bad Request"),
    (401, "Unauthorized"),
    (403, "Forbidden"),
    (404, "Not Found"),
    (405, "Method Not Allowed"),
    (411, "Length Required"),
    (413, "Payload Too Large"),
    (416, "Range Not Satisfiable"),
    (422, "Unprocessable Entity"),
    (503, "Service Unavailable"),
];

fn status_word(code: u16) -> &'static str {
    for (known, word) in STATUS_WORDS {
        if known == code {
            return word;
        }
    }
    "Error"
}

/// Сколько читается за раз, когда в ответ уходит кусок файла.
const FILE_PORTION: usize = 262_144;

enum Body {
    Bytes(Vec<u8>),
    Span {
        file: File,
        from: u64,
        len: u64,
    },
    /// Часть ответа, лежащего на полке в памяти.
    Held {
        bytes: Arc<Vec<u8>>,
        from: u64,
        len: u64,
    },
    Nothing,
}

struct Response {
    headers: Vec<(&'static str, String)>,
    body: Body,
    code: u16,
    close: bool,
    /// Ответ с полки: после целой отдачи тела его доля на полке снимается.
    settle: Option<(Arc<Shelf>, String)>,
}

impl Response {
    fn new(code: u16, body: Body) -> Response {
        Response {
            headers: Vec::new(),
            body,
            code,
            close: false,
            settle: None,
        }
    }

    /// Дописывает заголовок в конец.
    fn header(mut self, name: &'static str, value: impl Into<String>) -> Response {
        self.headers.push((name, value.into()));
        self
    }

    /// Ответ без тела с единственным заголовком `Content-Length: 0`.
    fn plain(code: u16) -> Response {
        Response::new(code, Body::Nothing).header("Content-Length", "0")
    }

    /// После такого ответа соединение закрывается.
    fn closing(self) -> Response {
        Response {
            close: true,
            ..self
        }
    }

    /// Заголовки CORS ставятся перед заголовками самого ответа.
    fn with_cors(mut self, origin: Option<&str>) -> Response {
        if let Some(origin) = origin {
            let front = [
                ("Access-Control-Allow-Origin", origin.to_owned()),
                ("Vary", "Origin".to_owned()),
                (
                    "Access-Control-Expose-Headers",
                    "Content-Length, Content-Range, ETag".to_owned(),
                ),
            ];
            self.headers = front.into_iter().chain(self.headers).collect();
        }
        self
    }

    fn head_text(&self) -> String {
        let lines: String = self
            .headers
            .iter()
            .map(|(name, value)| format!("{name}: {value}\r\n"))
            .collect();
        format!(
            "HTTP/1.1 {} {}\r\n{lines}\r\n",
            self.code,
            status_word(self.code)
        )
    }

    /// Отправляет ответ. Файл, укороченный посреди отдачи, обрывает соединение ошибкой.
    fn transmit(self, out: &mut impl Write, with_body: bool) -> io::Result<()> {
        let head = self.head_text();
        let settle = self.settle.filter(|_| with_body);
        let payload = if with_body { self.body } else { Body::Nothing };
        match payload {
            Body::Bytes(bytes) => out.write_all(&[head.as_bytes(), &bytes].concat())?,
            Body::Span { file, from, len } if len > 0 => {
                send_span(out, &head, (file, from), len)?;
            }
            Body::Held { bytes, from, len } => {
                out.write_all(head.as_bytes())?;
                let (from, len) = (from as usize, len as usize);
                out.write_all(bytes.get(from..from + len).unwrap_or_default())?;
            }
            Body::Span { .. } | Body::Nothing => out.write_all(head.as_bytes())?,
        }
        out.flush()?;
        if let Some((shelf, name)) = settle {
            shelf.settle(&name);
        }
        Ok(())
    }
}

/// Голова и затем `len` байт файла начиная с `from`; короткий файл — ошибка.
fn send_span(
    out: &mut impl Write,
    head: &str,
    (mut file, from): (File, u64),
    len: u64,
) -> io::Result<()> {
    out.write_all(head.as_bytes())?;
    file.seek(SeekFrom::Start(from))?;
    let mut source = BufReader::with_capacity(FILE_PORTION, file.take(len));
    let copied = io::copy(&mut source, out)?;
    if copied == len {
        Ok(())
    } else {
        Err(io::ErrorKind::UnexpectedEof.into())
    }
}

// ---------------------------------------------------------------------------
// Диапазоны
// ---------------------------------------------------------------------------

/// Один выполнимый диапазон `(первый байт, последний байт)` для файла размером
/// `size`; всё остальное, в том числе любой диапазон пустого файла, — `None`.
fn parse_byte_range(spec: &str, size: u64) -> Option<(u64, u64)> {
    let end = size.checked_sub(1)?;
    let (lead, trail) = spec.strip_prefix("bytes=")?.split_once('-')?;
    let (lead, trail) = (lead.trim(), trail.trim());
    let number = |text: &str| text.parse::<u64>().ok();
    let (first, last) = if lead.is_empty() {
        // Последние `count` байт.
        match number(trail)? {
            0 => return None,
            count => (size.saturating_sub(count), end),
        }
    } else if trail.is_empty() {
        (number(lead)?, end)
    } else {
        (number(lead)?, number(trail)?.min(end))
    };
    (first <= last).then_some((first, last))
}

fn open_regular(path: &Path) -> Option<(File, u64)> {
    File::open(path).ok().and_then(|file| {
        let meta = file.metadata().ok()?;
        meta.is_file().then_some((file, meta.len()))
    })
}

// ---------------------------------------------------------------------------
// Станция: правила ответа
// ---------------------------------------------------------------------------

/// Номер потока в банке умещается в 29 бит.
const STREAM_BITS: u32 = 0x1FFF_FFFF;

/// Десятичное `u32`, сведённое к 29 битам.
fn stream_id(text: &str) -> Result<u32, u16> {
    match text.parse::<u32>() {
        Ok(id) => Ok(id & STREAM_BITS),
        Err(_) => Err(400),
    }
}

type Sound = Result<(&'static str, Vec<u8>), u16>;

/// Заголовок токена в нижнем регистре; в запросах имена читаются без учёта регистра.
pub const TOKEN_HEADER: &str = "x-astral-engine-token";

/// Самый большой принимаемый банк, байт.
const UPLOAD_LIMIT: usize = 67_108_864;

/// Отдаваемое навсегда: файлы названы своим отпечатком и не меняются.
const FOREVER: &str = "private, max-age=31536000, immutable";

struct Station {
    busy: AtomicUsize,
    host_line: String,
    config: Config,
    shelf: Arc<Shelf>,
}

impl Station {
    fn new(config: Config, port: u16, shelf: Arc<Shelf>) -> Arc<Station> {
        Arc::new(Station {
            busy: AtomicUsize::new(0),
            host_line: format!("127.0.0.1:{port}"),
            config,
            shelf,
        })
    }

    /// Origin окна, если запрос пришёл от него (сравнение точное).
    fn window_origin(&self, head: &Head) -> Option<&str> {
        let allowed = self.config.origin.as_deref()?;
        head.field("origin")
            .filter(|seen| seen.trim_end_matches('/') == allowed)
            .map(|_| allowed)
    }

    fn token_ok(&self, head: &Head) -> bool {
        matches!(
            head.field(TOKEN_HEADER),
            Some(given) if secrets_agree(given, &self.config.token)
        )
    }

    /// Порядок проверок: `Host`, затем метод, затем токен.
    fn respond(&self, head: &Head, body: &mut impl Read) -> io::Result<Response> {
        if !head
            .field("host")
            .is_some_and(|host| host == self.host_line)
        {
            return Ok(Response::plain(403).closing());
        }
        let cors = self.window_origin(head);
        let response = match head.method.as_str() {
            "GET" | "HEAD" => self.fetch(head),
            "OPTIONS" => preflight(cors.is_some()),
            "PUT" => return self.accept_upload(head, body, cors),
            _ => Response::plain(405),
        };
        Ok(response.with_cors(cors))
    }

    fn fetch(&self, head: &Head) -> Response {
        if !self.token_ok(head) {
            return Response::plain(401);
        }
        match head.target.strip_prefix("/awc/") {
            Some(path) if head.method == "GET" => self.sound(path),
            _ => self.asset(head),
        }
    }

    // --- /a/<sha> ---

    /// Имя, открытый файл и его размер для `/a/<sha>`; код — чем отказать.
    fn locate_asset<'h>(&self, head: &'h Head) -> Result<(&'h str, File, u64), u16> {
        let tail = head.target.strip_prefix("/a/").ok_or(404u16)?;
        let name = until_query(tail);
        if !is_fingerprint(name) {
            return Err(400);
        }
        let (file, size) = open_regular(&self.config.assets.join(name)).ok_or(404u16)?;
        Ok((name, file, size))
    }

    /// Ответ, лежащий на полке в памяти, если `/a/<sha>` назван им: полка раньше хранилища.
    fn held_asset(&self, head: &Head) -> Option<Response> {
        let name = until_query(head.target.strip_prefix("/a/")?);
        if !is_fingerprint(name) {
            return None;
        }
        let bytes = self.shelf.lookup(name)?;
        let size = bytes.len() as u64;
        let held = |code: u16, (from, len): (u64, u64)| {
            let body = Body::Held {
                bytes: Arc::clone(&bytes),
                from,
                len,
            };
            asset_headers(Response::new(code, body), name, len)
        };
        let Some(spec) = head.field("range") else {
            let mut whole = held(200, (0, size));
            whole.settle = Some((Arc::clone(&self.shelf), name.to_owned()));
            return Some(whole);
        };
        Some(match parse_byte_range(spec.trim(), size) {
            Some((first, last)) => held(206, (first, last - first + 1))
                .header("Content-Range", format!("bytes {first}-{last}/{size}")),
            None => Response::new(416, Body::Nothing)
                .header("Content-Range", format!("bytes */{size}"))
                .header("Content-Length", "0"),
        })
    }

    fn asset(&self, head: &Head) -> Response {
        if let Some(held) = self.held_asset(head) {
            return held;
        }
        let (name, file, size) = match self.locate_asset(head) {
            Ok(found) => found,
            Err(code) => return Response::plain(code),
        };
        let Some(spec) = head.field("range") else {
            return asset_response(200, name, file, (0, size));
        };
        match parse_byte_range(spec.trim(), size) {
            Some((first, last)) => asset_response(206, name, file, (first, last - first + 1))
                .header("Content-Range", format!("bytes {first}-{last}/{size}")),
            None => Response::new(416, Body::Nothing)
                .header("Content-Range", format!("bytes */{size}"))
                .header("Content-Length", "0"),
        }
    }

    // --- PUT /awc/<sha> ---

    /// Ранние проверки загрузки; код отказа закрывает соединение.
    fn upload_plan<'h>(&self, head: &'h Head) -> Result<(&'h str, usize), u16> {
        let name = match (self.token_ok(head), head.target.strip_prefix("/awc/")) {
            (false, _) => return Err(401),
            (true, None) => return Err(404),
            (true, Some(name)) if !is_fingerprint(name) => return Err(400),
            (true, Some(name)) => name,
        };
        match head.declared_length() {
            None => Err(411),
            Some(declared) if declared > UPLOAD_LIMIT => Err(413),
            Some(declared) => Ok((name, declared)),
        }
    }

    fn accept_upload(
        &self,
        head: &Head,
        body: &mut impl Read,
        cors: Option<&str>,
    ) -> io::Result<Response> {
        let (name, declared) = match self.upload_plan(head) {
            Ok(plan) => plan,
            Err(code) => return Ok(Response::plain(code).closing().with_cors(cors)),
        };
        let expected = declared as u64;
        let mut payload = Vec::new();
        if io::copy(&mut body.take(expected), &mut payload)? != expected {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        let code = if fingerprint(&payload) == name {
            // Ошибка записи ответа не получает: соединение просто бросается.
            place(&self.config.assets, name, &payload)?;
            204
        } else {
            400
        };
        Ok(Response::plain(code).with_cors(cors))
    }

    // --- GET /awc/... ---

    fn sound(&self, path: &str) -> Response {
        let parts: Vec<&str> = until_query(path).split('/').collect();
        let made = match parts[..] {
            ["pair", left_bank, left_id, right_bank, right_id] => {
                self.stereo((left_bank, left_id), (right_bank, right_id))
            }
            [bank] => self.listing(bank),
            [bank, "wav", id] => self.mono(bank, id),
            _ => return Response::plain(404),
        };
        made.map_or_else(Response::plain, |(kind, bytes)| {
            let length = bytes.len().to_string();
            Response::new(200, Body::Bytes(bytes))
                .header("Content-Type", kind)
                .header("Content-Length", length)
                .header("Cache-Control", FOREVER)
        })
    }

    fn bank_bytes(&self, name: &str) -> Result<Vec<u8>, u16> {
        if is_fingerprint(name) {
            fs::read(self.config.assets.join(name)).map_err(|_| 404)
        } else {
            Err(400)
        }
    }

    fn listing(&self, name: &str) -> Sound {
        let bank = self.bank_bytes(name)?;
        awc_channel::overview(&bank)
            .map(|overview| ("application/json", overview.to_string().into_bytes()))
            .map_err(|_| 422)
    }

    fn mono(&self, name: &str, id: &str) -> Sound {
        let bank = self.bank_bytes(name)?;
        awc_channel::mono_wav(&bank, stream_id(id)?)
            .map(|wav| ("audio/wav", wav))
            .map_err(|_| 422)
    }

    /// Оба банка читаются раньше, чем разбираются номера потоков.
    fn stereo(
        &self,
        (left_bank, left_id): (&str, &str),
        (right_bank, right_id): (&str, &str),
    ) -> Sound {
        let (first, second) = (self.bank_bytes(left_bank)?, self.bank_bytes(right_bank)?);
        let (left_stream, right_stream) = (stream_id(left_id)?, stream_id(right_id)?);
        awc_channel::pair_wav((&first, left_stream), (&second, right_stream))
            .map(|wav| ("audio/wav", wav))
            .map_err(|_| 422)
    }

    /// Занимает одно из мест под соединения; `false` — все заняты.
    fn reserve_slot(&self) -> bool {
        let taken = self.busy.fetch_add(1, Ordering::AcqRel);
        let room = taken < CONNECTION_CEILING;
        if !room {
            self.busy.fetch_sub(1, Ordering::AcqRel);
        }
        room
    }

    /// Занимает место под соединение или отвечает 503, не читая запроса.
    fn admit(self: &Arc<Self>, mut socket: TcpStream) {
        if !self.reserve_slot() {
            // Запрос не читается: клиент может получить сброс вместо 503.
            let _ = socket.write_all(OVERLOAD_REPLY);
            return;
        }
        let station = Arc::clone(self);
        // Если поток завести не вышло, место не возвращается.
        let _ = thread::Builder::new().spawn(move || {
            let _ = Session::begin(&station, socket).and_then(|mut session| session.converse());
            station.busy.fetch_sub(1, Ordering::AcqRel);
        });
    }
}

/// Столько соединений обслуживается одновременно.
const CONNECTION_CEILING: usize = 64;

/// Ответ тем, кому места не хватило.
const OVERLOAD_REPLY: &[u8] = b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n";

/// Предполёт: заголовки CORS только для origin окна, иначе голый 204.
fn preflight(allowed: bool) -> Response {
    let reply = Response::new(204, Body::Nothing);
    let reply = if allowed {
        reply
            .header("Access-Control-Allow-Methods", "GET, HEAD, PUT")
            .header(
                "Access-Control-Allow-Headers",
                "Range, Content-Type, X-Astral-Engine-Token",
            )
            .header("Access-Control-Max-Age", "600")
    } else {
        reply
    };
    reply.header("Content-Length", "0")
}

/// Ответ 200/206 на `/a/<sha>`: `(от, длина)` отдаваемой части файла.
fn asset_response(code: u16, name: &str, file: File, (from, len): (u64, u64)) -> Response {
    asset_headers(
        Response::new(code, Body::Span { file, from, len }),
        name,
        len,
    )
}

/// Заголовки ответа на `/a/<sha>`, одни у файла и у полки.
fn asset_headers(response: Response, name: &str, len: u64) -> Response {
    response
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", len.to_string())
        .header("Accept-Ranges", "bytes")
        .header("ETag", format!("\"{name}\""))
        .header("Cache-Control", FOREVER)
}

// ---------------------------------------------------------------------------
// Соединение
// ---------------------------------------------------------------------------

/// Сколько ждать следующий запрос на уже открытом соединении.
const IDLE_LIMIT: Duration = Duration::from_secs(5);
/// Сколько после последнего ответа вычитывать присланное.
const LINGER_LIMIT: Duration = Duration::from_secs(2);

struct Session<'a> {
    writer: TcpStream,
    reader: BufReader<TcpStream>,
    station: &'a Station,
}

impl<'a> Session<'a> {
    fn begin(station: &'a Station, socket: TcpStream) -> io::Result<Session<'a>> {
        socket.set_read_timeout(Some(IDLE_LIMIT))?;
        let _ = socket.set_nodelay(true);
        Ok(Session {
            writer: socket.try_clone()?,
            reader: BufReader::new(socket),
            station,
        })
    }

    /// Обслуживает запросы по очереди, пока соединение не закроется.
    fn converse(&mut self) -> io::Result<()> {
        while let Some(head) = read_head(&mut self.reader)? {
            let response = self.station.respond(&head, &mut self.reader)?;
            let last = response.close || head.wants_close();
            response.transmit(&mut self.writer, head.method != "HEAD")?;
            if last {
                self.linger();
                break;
            }
        }
        Ok(())
    }

    /// После последнего ответа: закрыть свою сторону на запись и до двух секунд
    /// вычитывать присланное, иначе Windows сбросит соединение и клиент
    /// потеряет ответ.
    fn linger(&mut self) {
        let _ = self.writer.shutdown(Shutdown::Write);
        let deadline = Instant::now() + LINGER_LIMIT;
        let mut scrap = [0u8; 8192];
        while let Some(left) = time_left(deadline) {
            if self.reader.get_ref().set_read_timeout(Some(left)).is_err() {
                return;
            }
            if !matches!(self.reader.read(&mut scrap), Ok(got) if got > 0) {
                return;
            }
        }
    }
}

/// Сколько осталось до срока; `None` — срок вышел.
fn time_left(deadline: Instant) -> Option<Duration> {
    Some(deadline.saturating_duration_since(Instant::now())).filter(|left| !left.is_zero())
}

fn listen(listener: TcpListener, station: Arc<Station>) {
    listener
        .incoming()
        .flatten()
        .for_each(|socket| station.admit(socket));
}

/// Поднимает канал в фоновых потоках и возвращает порт. Остановки нет: канал
/// живёт до конца процесса.
pub fn start(config: Config) -> io::Result<u16> {
    let shelf = Shelf::new();
    let port = start_with(config, Arc::clone(&shelf))?;
    // Полка процесса — у боевого канала; проверки подставляют свою через `start_with`.
    #[cfg(not(test))]
    crate::shelf::adopt(&shelf);
    Ok(port)
}

/// То же с готовой полкой ответов в памяти: порт канала записывается в неё.
pub fn start_with(config: Config, shelf: Arc<Shelf>) -> io::Result<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    shelf.open(port);
    let station = Station::new(config, port, shelf);
    thread::Builder::new()
        .name(String::from("astral-data-channel"))
        .spawn(move || listen(listener, station))
        .map(|_| port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::awc_channel::tests::bank;
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef-token";
    const WINDOW: &str = "http://127.0.0.1:4174";
    const SAMPLE: &[u8] = b"ARS2 model bytes for the window";
    const CACHE_LINE: &str = "Cache-Control: private, max-age=31536000, immutable";
    const CORS_LINES: [&str; 3] = [
        "Access-Control-Allow-Origin: http://127.0.0.1:4174",
        "Vary: Origin",
        "Access-Control-Expose-Headers: Content-Length, Content-Range, ETag",
    ];

    fn absent() -> String {
        "f".repeat(64)
    }

    // ----- запрос -----

    struct Req {
        head: String,
        fields: Vec<(String, String)>,
        raw: Vec<String>,
        body: Vec<u8>,
        eol: &'static str,
        colon: &'static str,
    }

    impl Req {
        fn header(mut self, name: &str, value: &str) -> Req {
            self.fields.push((name.to_owned(), value.to_owned()));
            self
        }

        fn without(mut self, name: &str) -> Req {
            self.fields
                .retain(|(known, _)| !known.eq_ignore_ascii_case(name));
            self
        }

        fn set(self, name: &str, value: &str) -> Req {
            self.without(name).header(name, value)
        }

        fn keep(self) -> Req {
            self.without("Connection")
        }

        fn line(mut self, text: &str) -> Req {
            self.head = text.to_owned();
            self
        }

        fn raw(mut self, text: &str) -> Req {
            self.raw.push(text.to_owned());
            self
        }

        fn tight(mut self) -> Req {
            self.colon = ":";
            self
        }

        fn lf(mut self) -> Req {
            self.eol = "\n";
            self
        }

        fn body(mut self, bytes: &[u8]) -> Req {
            self.body = bytes.to_vec();
            self
        }

        fn origin(self) -> Req {
            self.header("Origin", WINDOW)
        }

        fn render(&self) -> Vec<u8> {
            let mut out = format!("{}{}", self.head, self.eol);
            for (name, value) in &self.fields {
                out.push_str(&format!("{name}{}{value}{}", self.colon, self.eol));
            }
            for line in &self.raw {
                out.push_str(line);
                out.push_str(self.eol);
            }
            out.push_str(self.eol);
            let mut bytes = out.into_bytes();
            bytes.extend_from_slice(&self.body);
            bytes
        }

        fn is_head(&self) -> bool {
            self.head.starts_with("HEAD ")
        }
    }

    // ----- ответ -----

    struct Answer {
        lines: Vec<String>,
        body: Vec<u8>,
    }

    impl Answer {
        fn status(&self) -> u16 {
            self.lines[0].split(' ').nth(1).unwrap().parse().unwrap()
        }

        fn starts_with_cors(&self) -> bool {
            self.lines.len() > 3 && self.lines[1..4] == CORS_LINES
        }
    }

    struct Conn {
        reader: BufReader<TcpStream>,
        writer: TcpStream,
    }

    impl Conn {
        fn open(port: u16) -> Conn {
            let writer = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            writer
                .set_read_timeout(Some(Duration::from_secs(20)))
                .unwrap();
            let reader = BufReader::new(writer.try_clone().unwrap());
            Conn { reader, writer }
        }

        fn send(&mut self, bytes: &[u8]) {
            let _ = self.writer.write_all(bytes);
        }

        /// Читает один ответ; `None` — соединение закрыто без него (или сброшено).
        fn answer(&mut self, head_only: bool) -> Option<Answer> {
            let mut first = String::new();
            if self.reader.read_line(&mut first).ok()? == 0 {
                return None;
            }
            let mut lines = vec![first.trim_end().to_owned()];
            loop {
                let mut line = String::new();
                if self.reader.read_line(&mut line).ok()? == 0 {
                    return None;
                }
                let line = line.trim_end().to_owned();
                if line.is_empty() {
                    break;
                }
                lines.push(line);
            }
            let declared = lines
                .iter()
                .find_map(|line| line.strip_prefix("Content-Length: "))
                .map_or(0, |value| value.parse::<usize>().unwrap());
            let mut body = vec![0u8; if head_only { 0 } else { declared }];
            self.reader.read_exact(&mut body).ok()?;
            Some(Answer { lines, body })
        }

        /// Закрыт ли поток сервером: чтение даёт конец (или сброс) без единого байта.
        fn ends_without_bytes(&mut self) -> bool {
            let mut byte = [0u8; 1];
            matches!(self.reader.read(&mut byte), Ok(0) | Err(_))
        }
    }

    // ----- стенд -----

    struct Rig {
        port: u16,
        dir: TempDir,
    }

    impl Rig {
        fn new() -> Rig {
            Rig::with_origin(Some(WINDOW))
        }

        fn with_origin(origin: Option<&str>) -> Rig {
            let dir = tempfile::tempdir().unwrap();
            let port = start(Config {
                token: TOKEN.to_owned(),
                origin: origin.map(str::to_owned),
                assets: dir.path().join("assets"),
            })
            .unwrap();
            Rig { port, dir }
        }

        fn assets(&self) -> PathBuf {
            self.dir.path().join("assets")
        }

        /// Кладёт файл в хранилище напрямую.
        fn plant(&self, bytes: &[u8]) -> String {
            store(&self.assets(), bytes).unwrap()
        }

        fn req(&self, method: &str, target: &str) -> Req {
            Req {
                head: format!("{method} {target} HTTP/1.1"),
                fields: vec![
                    ("Host".to_owned(), format!("127.0.0.1:{}", self.port)),
                    ("X-Astral-Engine-Token".to_owned(), TOKEN.to_owned()),
                    ("Connection".to_owned(), "close".to_owned()),
                ],
                raw: Vec::new(),
                body: Vec::new(),
                eol: "\r\n",
                colon: ": ",
            }
        }

        fn get(&self, target: &str) -> Req {
            self.req("GET", target)
        }

        fn upload(&self, name: &str, body: &[u8]) -> Req {
            self.req("PUT", &format!("/awc/{name}"))
                .header("Content-Length", &body.len().to_string())
                .body(body)
        }

        fn call(&self, req: &Req) -> Option<Answer> {
            let mut conn = Conn::open(self.port);
            conn.send(&req.render());
            conn.answer(req.is_head())
        }

        fn ask(&self, req: &Req) -> Answer {
            self.call(req).expect("ответ должен прийти")
        }

        fn status_of(&self, req: &Req) -> u16 {
            self.ask(req).status()
        }

        /// Статус ответа на GET, который повторяется, пока сервер отвечает 503
        /// «все места заняты» (но не дольше восьми секунд). Место возвращает
        /// поток соединения, когда до него доходит очередь, и на нагруженной
        /// машине это случается позже, чем рассчитано по таймеру теста.
        fn status_once_admitted(&self, target: &str) -> u16 {
            let deadline = Instant::now() + Duration::from_secs(8);
            loop {
                // отказ без чтения запроса клиент может увидеть как сброс соединения
                let status = self
                    .call(&self.get(target))
                    .map_or(503, |answer| answer.status());
                if status != 503 || Instant::now() >= deadline {
                    return status;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }

        /// Имена и размеры файлов хранилища.
        fn listing(&self) -> BTreeMap<String, u64> {
            let Ok(entries) = fs::read_dir(self.assets()) else {
                return BTreeMap::new();
            };
            entries
                .map(|entry| {
                    let entry = entry.unwrap();
                    (
                        entry.file_name().to_string_lossy().into_owned(),
                        entry.metadata().unwrap().len(),
                    )
                })
                .collect()
        }
    }

    // ----- ожидаемые головы -----

    fn texts(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    fn bare(status_line: &str, cors: bool) -> Vec<String> {
        let mut out = vec![status_line.to_owned()];
        if cors {
            out.extend(texts(&CORS_LINES));
        }
        out.push("Content-Length: 0".to_owned());
        out
    }

    fn asset_head(
        status_line: &str,
        len: usize,
        sha: &str,
        cors: bool,
        span: Option<&str>,
    ) -> Vec<String> {
        let mut out = vec![status_line.to_owned()];
        if cors {
            out.extend(texts(&CORS_LINES));
        }
        out.push("Content-Type: application/octet-stream".to_owned());
        out.push(format!("Content-Length: {len}"));
        out.push("Accept-Ranges: bytes".to_owned());
        out.push(format!("ETag: \"{sha}\""));
        out.push(CACHE_LINE.to_owned());
        if let Some(span) = span {
            out.push(format!("Content-Range: {span}"));
        }
        out
    }

    fn big_file() -> Vec<u8> {
        (0..1_048_593usize).map(|i| (i * 7 + 3) as u8).collect()
    }

    // =====================================================================
    // Настройка
    // =====================================================================

    fn lookup_of<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name: &str| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| OsString::from(*value))
        }
    }

    fn config_of(pairs: &[(&str, &str)]) -> Option<Config> {
        Config::from_lookup(&lookup_of(pairs))
    }

    const GOOD_TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn token_decides_whether_the_channel_exists() {
        // Кн1 – Кн9, Нк1 – Нк10
        let token = |value: &str| config_of(&[(TOKEN_ENV, value)]);
        assert!(config_of(&[]).is_none());
        assert!(token("").is_none());
        assert!(token(&" ".repeat(40)).is_none());
        assert!(token(&GOOD_TOKEN[..31]).is_none());
        assert!(token(&format!("  {} ", &GOOD_TOKEN[..31])).is_none());
        let exact = token(GOOD_TOKEN).unwrap();
        assert_eq!(exact.token, GOOD_TOKEN);
        assert_eq!(exact.origin, None);
        assert_eq!(exact.assets, default_assets_dir());
        let padded = token(&format!(" \t{GOOD_TOKEN}\t ")).unwrap();
        assert_eq!(padded.token, GOOD_TOKEN);
        let inner = "0123456789abcdef 123456789abcdef";
        assert_eq!(token(inner).unwrap().token, inner);
        let cyrillic = "ж".repeat(16);
        assert_eq!(token(&cyrillic).unwrap().token, cyrillic);
        assert!(token(&"ж".repeat(15)).is_none());
        let long = "a".repeat(4000);
        assert_eq!(token(&long).unwrap().token, long);
    }

    #[test]
    fn origin_is_trimmed_before_its_slashes() {
        // Кн10 – Кн15, Нк11 – Нк16
        let origin = |value: &str| {
            config_of(&[(TOKEN_ENV, GOOD_TOKEN), (ORIGIN_ENV, value)])
                .unwrap()
                .origin
        };
        assert_eq!(origin("http://a:1/").as_deref(), Some("http://a:1"));
        assert_eq!(origin(" http://a:1/// ").as_deref(), Some("http://a:1"));
        assert_eq!(origin("http://a:1/ /").as_deref(), Some("http://a:1/ "));
        assert_eq!(origin("Http://A:1").as_deref(), Some("Http://A:1"));
        assert_eq!(origin("/"), None);
        assert_eq!(origin(""), None);
        assert_eq!(origin("   "), None);
        assert_eq!(config_of(&[(TOKEN_ENV, GOOD_TOKEN)]).unwrap().origin, None);
    }

    #[test]
    fn assets_dir_is_taken_as_written_unless_empty() {
        // Кн16 – Кн20, Нк18, Нк19
        let assets = |value: &str| {
            config_of(&[(TOKEN_ENV, GOOD_TOKEN), (ASSETS_ENV, value)])
                .unwrap()
                .assets
        };
        assert_eq!(assets("D:/assets"), PathBuf::from("D:/assets"));
        assert_eq!(assets("D:/assets/"), PathBuf::from("D:/assets/"));
        assert_eq!(assets("rel"), PathBuf::from("rel"));
        assert_eq!(assets(""), default_assets_dir());
        assert_eq!(assets("   "), PathBuf::from("   "));
    }

    #[test]
    fn default_dir_is_astral_cache_engine_assets() {
        // Кд1 – Кд5, Н-4, Кд6
        let expected_tail: PathBuf = ["Astral", "cache", "engine-assets"].iter().collect();
        for base in [
            "C:/Users/x/AppData/Local",
            "D:/xdg",
            "C:/h/.local/share",
            ".",
        ] {
            let dir = assets_under(PathBuf::from(base));
            assert_eq!(dir, Path::new(base).join(&expected_tail));
        }
        assert_eq!(default_assets_dir(), assets_under(local_app_data()));
        assert_eq!(TOKEN_ENV, "ASTRAL_ENGINE_HTTP_TOKEN");
        assert_eq!(ORIGIN_ENV, "ASTRAL_ENGINE_HTTP_ORIGIN");
        assert_eq!(ASSETS_ENV, "ASTRAL_ENGINE_ASSETS_DIR");
        assert_eq!(TOKEN_HEADER, "x-astral-engine-token");
    }

    // =====================================================================
    // Хранилище
    // =====================================================================

    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const EMPTY_SHA: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    fn files_in(dir: &Path) -> BTreeMap<String, Vec<u8>> {
        fs::read_dir(dir)
            .unwrap()
            .map(|entry| {
                let entry = entry.unwrap();
                (
                    entry.file_name().to_string_lossy().into_owned(),
                    fs::read(entry.path()).unwrap_or_default(),
                )
            })
            .collect()
    }

    #[test]
    fn store_names_files_by_their_sha256() {
        // Хс1 – Хс4, Х-1, Х-2
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("a").join("b").join("c");
        assert_eq!(store(&nested, b"abc").unwrap(), ABC_SHA);
        assert_eq!(
            files_in(&nested),
            BTreeMap::from([(ABC_SHA.to_owned(), b"abc".to_vec())])
        );
        assert_eq!(store(&nested, b"abc").unwrap(), ABC_SHA);
        assert_eq!(files_in(&nested).len(), 1);
        assert_eq!(store(&nested, b"").unwrap(), EMPTY_SHA);
        assert_eq!(files_in(&nested)[EMPTY_SHA], Vec::<u8>::new());
        let other = root.path().join("other");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join(ABC_SHA), b"xyzzy").unwrap();
        assert_eq!(store(&other, b"abc").unwrap(), ABC_SHA);
        assert_eq!(fs::read(other.join(ABC_SHA)).unwrap(), b"xyzzy");
    }

    #[test]
    fn an_existing_file_is_not_rewritten() {
        // Хр2
        let root = tempfile::tempdir().unwrap();
        store(root.path(), b"abc").unwrap();
        let first = fs::metadata(root.path().join(ABC_SHA))
            .unwrap()
            .modified()
            .unwrap();
        thread::sleep(Duration::from_millis(1100));
        store(root.path(), b"abc").unwrap();
        let second = fs::metadata(root.path().join(ABC_SHA))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn store_failures_and_foreign_stage_files() {
        // Хс5 – Хс7, Х-4, Х-6
        let root = tempfile::tempdir().unwrap();
        let blocked = root.path().join("blocked");
        fs::create_dir_all(blocked.join(ABC_SHA)).unwrap();
        assert!(store(&blocked, b"abc").is_err());
        assert!(blocked.join(ABC_SHA).is_dir());
        let names: Vec<_> = files_in(&blocked).into_keys().collect();
        assert_eq!(names, vec![ABC_SHA.to_owned()], "временный файл убран");
        let flat = root.path().join("flat");
        fs::write(&flat, b"not a folder").unwrap();
        assert!(store(&flat, b"abc").is_err());
        let shared = root.path().join("shared");
        fs::create_dir_all(&shared).unwrap();
        let foreign = format!("{ABC_SHA}.1.stage");
        fs::write(shared.join(&foreign), b"12345678").unwrap();
        assert_eq!(store(&shared, b"abc").unwrap(), ABC_SHA);
        let seen = files_in(&shared);
        assert_eq!(seen[ABC_SHA], b"abc");
        assert_eq!(seen[&foreign].len(), 8);
        assert_eq!(seen.len(), 2);
    }

    #[test]
    fn parallel_stores_do_not_collide_on_distinct_bytes() {
        // Хс9, Хс10
        let root = tempfile::tempdir().unwrap();
        let same = root.path().join("same");
        let alike: Vec<_> = (0..16)
            .map(|_| {
                let dir = same.clone();
                thread::spawn(move || store(&dir, b"identical bytes").is_ok())
            })
            .collect();
        assert!(alike.into_iter().all(|worker| worker.join().unwrap()));
        assert_eq!(files_in(&same).len(), 1);
        let apart = root.path().join("apart");
        let different: Vec<_> = (0..16)
            .map(|index| {
                let dir = apart.clone();
                thread::spawn(move || store(&dir, format!("bytes {index}").as_bytes()).is_ok())
            })
            .collect();
        assert!(different.into_iter().all(|worker| worker.join().unwrap()));
        assert_eq!(files_in(&apart).len(), 16);
    }

    #[test]
    fn fingerprint_shape_is_checked_strictly() {
        let good = "0123456789abcdef".repeat(4);
        assert!(is_fingerprint(&good));
        assert!(!is_fingerprint(&good.to_uppercase()));
        assert!(!is_fingerprint(&good[1..]));
        assert!(!is_fingerprint(&format!("{good}0")));
        assert!(!is_fingerprint(&format!("g{}", &good[1..])));
        assert!(!is_fingerprint(""));
        assert_eq!(fingerprint(b"abc"), ABC_SHA);
    }

    // =====================================================================
    // GET и HEAD /a/<sha>
    // =====================================================================

    #[test]
    fn an_asset_comes_with_its_headers_and_optional_cors() {
        // Гт1 – Гт7, Гт10, Гт11, Нк11, Нк17
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let plain = rig.ask(&rig.get(&path));
        assert_eq!(
            plain.lines,
            asset_head("HTTP/1.1 200 OK", 31, &sha, false, None)
        );
        assert_eq!(plain.body, SAMPLE);
        let windowed = rig.ask(&rig.get(&path).origin());
        assert_eq!(
            windowed.lines,
            asset_head("HTTP/1.1 200 OK", 31, &sha, true, None)
        );
        assert_eq!(windowed.body, SAMPLE);
        let stranger = rig.ask(&rig.get(&path).header("Origin", "http://evil.example"));
        assert_eq!(stranger.lines, plain.lines);
        let slashed = rig.ask(&rig.get(&path).header("Origin", "http://127.0.0.1:4174/"));
        assert!(slashed.starts_with_cors());
        let shouted = rig.ask(&rig.get(&path).header("Origin", "HTTP://127.0.0.1:4174"));
        assert_eq!(shouted.lines, plain.lines);
        let head = rig.ask(&rig.req("HEAD", &path));
        assert_eq!(head.lines, plain.lines);
        assert!(head.body.is_empty());
        let queried = rig.ask(&rig.get(&format!("{path}?x=1&y=2")));
        assert_eq!(queried.lines, plain.lines);
        assert_eq!(queried.body, SAMPLE);
        assert_eq!(rig.ask(&rig.get(&format!("{path}?"))).body, SAMPLE);
        let empty = rig.plant(b"");
        let blank = rig.ask(&rig.get(&format!("/a/{empty}")));
        assert_eq!(
            blank.lines,
            asset_head("HTTP/1.1 200 OK", 0, &empty, false, None)
        );
        assert!(blank.body.is_empty());
        let missing = rig.ask(&rig.get(&format!("/a/{}", absent())));
        assert_eq!(missing.lines, bare("HTTP/1.1 404 Not Found", false));
        let no_cors = Rig::with_origin(None);
        let sha_again = no_cors.plant(SAMPLE);
        assert!(!no_cors
            .ask(&no_cors.get(&format!("/a/{sha_again}")).origin())
            .starts_with_cors());
    }

    #[test]
    fn names_and_routes_are_validated_strictly() {
        // Гт8, Гт9, Гт12 – Гт23, Гт37, Хр5
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let long = format!("{sha}0");
        let mut upper = sha.clone();
        upper.make_ascii_uppercase();
        let mut broken = sha.clone();
        broken.replace_range(10..11, "z");
        let encoded = format!("%36{}", &sha[1..]);
        let cases: Vec<(String, u16)> = vec![
            (format!("/a/{sha}#frag"), 400),
            (format!("/a/{sha}/"), 400),
            ("/a/".to_owned(), 400),
            ("/a".to_owned(), 404),
            ("/a//".to_owned(), 400),
            ("/a/../../secret".to_owned(), 400),
            (format!("/a/{upper}"), 400),
            (format!("/a/{}", &sha[1..]), 400),
            (format!("/a/{long}"), 400),
            (format!("/a/{broken}"), 400),
            (format!("/a/{encoded}"), 400),
            ("/".to_owned(), 404),
            ("/etc/passwd".to_owned(), 404),
            (format!("/A/{sha}"), 404),
            (format!("http://127.0.0.1:{}/a/{sha}", rig.port), 404),
            (format!("/a/{sha}.12345.stage"), 400),
        ];
        for (target, expected) in cases {
            let answer = rig.ask(&rig.get(&target));
            assert_eq!(answer.status(), expected, "{target}");
            assert_eq!(answer.lines.len(), 2, "{target}");
            assert!(answer.body.is_empty());
        }
    }

    #[test]
    fn the_token_comes_after_host_and_method_but_before_the_path() {
        // Гт24, Гт25, Гт26, Гт28 – Гт33
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let unauthorized = bare("HTTP/1.1 401 Unauthorized", false);
        assert_eq!(
            rig.ask(&rig.get(&path).without("X-Astral-Engine-Token"))
                .lines,
            unauthorized
        );
        assert_eq!(
            rig.ask(&rig.get("/nonsense").without("X-Astral-Engine-Token"))
                .lines,
            unauthorized
        );
        let forbidden = rig.ask(&rig.get(&path).origin().without("Host"));
        assert_eq!(forbidden.lines, bare("HTTP/1.1 403 Forbidden", false));
        let ok = |req: Req| assert_eq!(rig.status_of(&req), 200);
        ok(rig.get(&path).set("x-ASTRAL-engine-TOKEN", TOKEN));
        ok(rig
            .get(&path)
            .set("X-Astral-Engine-Token", &format!("   {TOKEN}   ")));
        ok(rig.get(&path).tight());
        ok(rig.get(&path).header("X-Astral-Engine-Token", "intruder"));
        let wrong_first = rig
            .get(&path)
            .set("X-Astral-Engine-Token", "intruder")
            .header("X-Astral-Engine-Token", TOKEN);
        assert_eq!(rig.status_of(&wrong_first), 401);
        let short = rig.get(&path).set("X-Astral-Engine-Token", &TOKEN[1..]);
        assert_eq!(rig.status_of(&short), 401);
    }

    #[test]
    fn request_parsing_quirks() {
        // Гт34 – Гт43
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let full = asset_head("HTTP/1.1 200 OK", 31, &sha, false, None);
        for req in [
            rig.get(&path).line(&format!("GET {path} HTTP/1.0")).keep(),
            rig.get(&path).line(&format!("GET {path}")),
            rig.get(&path).lf(),
            rig.get(&path).line(&format!("GET  {path}   HTTP/1.1")),
            rig.get(&path).raw("garbage line without a colon"),
            rig.get(&path).set("Connection", "Close"),
        ] {
            let answer = rig.ask(&req);
            assert_eq!(answer.lines, full);
            assert_eq!(answer.body, SAMPLE);
        }
        let lower = rig.ask(&rig.get(&path).line(&format!("get {path} HTTP/1.1")));
        assert_eq!(lower.lines, bare("HTTP/1.1 405 Method Not Allowed", false));
        let word = rig.ask(&rig.get(&path).line("GET"));
        assert_eq!(word.lines, bare("HTTP/1.1 404 Not Found", false));
        let mut conn = Conn::open(rig.port);
        conn.send(b"\r\n\r\n");
        assert_eq!(
            conn.answer(false).unwrap().lines,
            bare("HTTP/1.1 403 Forbidden", false)
        );
        // Гт27: условные заголовки не поддержаны
        let conditional = rig.ask(
            &rig.get(&path)
                .header("If-None-Match", &format!("\"{sha}\"")),
        );
        assert_eq!(conditional.lines, full);
        assert_eq!(conditional.body, SAMPLE);
    }

    #[test]
    fn a_connection_with_a_close_header_is_closed_and_without_it_stays() {
        // Гт43, Н-11, Лм7
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let mut conn = Conn::open(rig.port);
        conn.send(&rig.get(&path).keep().render());
        conn.send(&rig.get(&path).keep().render());
        assert_eq!(conn.answer(false).unwrap().status(), 200);
        assert_eq!(conn.answer(false).unwrap().status(), 200);
        conn.send(&rig.get(&path).set("Connection", "Close").render());
        assert_eq!(conn.answer(false).unwrap().status(), 200);
        assert!(
            conn.ends_without_bytes(),
            "после Connection: close сервер закрывает соединение"
        );
        // Лм7: два запроса одной записью, второй с close
        let mut pipelined = Conn::open(rig.port);
        let mut both = rig.get(&path).keep().render();
        both.extend(rig.get(&format!("/a/{}", absent())).render());
        pipelined.send(&both);
        let first = pipelined.answer(false).unwrap();
        assert_eq!(
            first.lines,
            asset_head("HTTP/1.1 200 OK", 31, &sha, false, None)
        );
        let second = pipelined.answer(false).unwrap();
        assert_eq!(second.lines, bare("HTTP/1.1 404 Not Found", false));
        assert!(pipelined.ends_without_bytes());
    }

    #[test]
    fn a_big_file_is_sent_whole_and_in_parts() {
        // Гт44 – Гт46, Дп33, Дп34
        let rig = Rig::new();
        let content = big_file();
        let sha = rig.plant(&content);
        let path = format!("/a/{sha}");
        let whole = rig.ask(&rig.get(&path));
        assert_eq!(
            whole.lines,
            asset_head("HTTP/1.1 200 OK", 1_048_593, &sha, false, None)
        );
        assert!(whole.body == content);
        let head = rig.ask(&rig.req("HEAD", &path));
        assert_eq!(head.lines, whole.lines);
        assert!(head.body.is_empty());
        let across = rig.ask(&rig.get(&path).header("Range", "bytes=262140-262150"));
        assert_eq!(
            across.lines,
            asset_head(
                "HTTP/1.1 206 Partial Content",
                11,
                &sha,
                false,
                Some("bytes 262140-262150/1048593")
            )
        );
        assert_eq!(across.body, &content[262_140..262_151]);
        let tail = rig.ask(&rig.get(&path).header("Range", "bytes=-1000000"));
        assert_eq!(
            tail.lines,
            asset_head(
                "HTTP/1.1 206 Partial Content",
                1_000_000,
                &sha,
                false,
                Some("bytes 48593-1048592/1048593")
            )
        );
        assert!(tail.body == content[48_593..]);
        let port = rig.port;
        let workers: Vec<_> = (0..24)
            .map(|_| {
                let request = rig.get(&path).render();
                thread::spawn(move || {
                    let mut conn = Conn::open(port);
                    conn.send(&request);
                    conn.answer(false).unwrap().body.len()
                })
            })
            .collect();
        for worker in workers {
            assert_eq!(worker.join().unwrap(), 1_048_593);
        }
    }

    #[test]
    fn ranges_follow_the_documented_table() {
        type RangeRow = (u16, Option<String>, Vec<u8>);
        // Дп1 – Дп32
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let partial = |from: usize, to: usize| {
            (
                206u16,
                Some(format!("bytes {from}-{to}/31")),
                SAMPLE[from..=to].to_vec(),
            )
        };
        let refused = (416u16, Some("bytes */31".to_owned()), Vec::new());
        let rows: Vec<(&str, RangeRow)> = vec![
            ("bytes=5-9", partial(5, 9)),
            ("bytes=0-0", partial(0, 0)),
            ("bytes=0-", partial(0, 30)),
            ("bytes=25-", partial(25, 30)),
            ("bytes=-6", partial(25, 30)),
            ("bytes=-31", partial(0, 30)),
            ("bytes=-99", partial(0, 30)),
            ("bytes=-0", refused.clone()),
            ("bytes=10-5000", partial(10, 30)),
            ("bytes=30-30", partial(30, 30)),
            ("bytes=31-31", refused.clone()),
            ("bytes=31-", refused.clone()),
            ("bytes=99-", refused.clone()),
            ("bytes=5-2", refused.clone()),
            ("bytes=0-5,7-9", refused.clone()),
            ("bytes=abc", refused.clone()),
            ("bytes=-", refused.clone()),
            ("bytes=1-2-3", refused.clone()),
            ("bytes=", refused.clone()),
            ("items=0-5", refused.clone()),
            ("BYTES=5-9", refused.clone()),
            ("bytes= 5 - 9", partial(5, 9)),
            ("bytes=+5-9", partial(5, 9)),
            ("bytes=05-09", partial(5, 9)),
            ("bytes=-5-9", refused.clone()),
            ("bytes=18446744073709551615-", refused.clone()),
            ("bytes=18446744073709551616-", refused.clone()),
            ("bytes=0-18446744073709551615", partial(0, 30)),
            ("", refused.clone()),
        ];
        for (header, (status, span, body)) in rows {
            let answer = rig.ask(&rig.get(&path).header("Range", header));
            assert_eq!(answer.status(), status, "{header:?}");
            if status == 206 {
                let span = span.unwrap();
                let expected = asset_head(
                    "HTTP/1.1 206 Partial Content",
                    body.len(),
                    &sha,
                    false,
                    Some(&span),
                );
                assert_eq!(answer.lines, expected, "{header:?}");
            } else {
                let expected = texts(&[
                    "HTTP/1.1 416 Range Not Satisfiable",
                    "Content-Range: bytes */31",
                    "Content-Length: 0",
                ]);
                assert_eq!(answer.lines, expected, "{header:?}");
            }
            assert_eq!(answer.body, body, "{header:?}");
        }
        // Дп29: HEAD отдаёт заголовки диапазона без тела
        let head = rig.ask(&rig.req("HEAD", &path).header("Range", "bytes=5-9"));
        assert_eq!(
            head.lines,
            asset_head(
                "HTTP/1.1 206 Partial Content",
                5,
                &sha,
                false,
                Some("bytes 5-9/31")
            )
        );
        assert!(head.body.is_empty());
        // Дп31: у пустого файла любой диапазон не выполним
        let empty = rig.plant(b"");
        let none = rig.ask(&rig.get(&format!("/a/{empty}")).header("Range", "bytes=0-0"));
        assert_eq!(
            none.lines,
            texts(&[
                "HTTP/1.1 416 Range Not Satisfiable",
                "Content-Range: bytes */0",
                "Content-Length: 0"
            ])
        );
        // Дп32: сначала открытие файла
        let missing = rig.ask(
            &rig.get(&format!("/a/{}", absent()))
                .header("Range", "bytes=0-0"),
        );
        assert_eq!(missing.status(), 404);
        // CORS у 416 стоит перед Content-Range
        let dressed = rig.ask(&rig.get(&path).origin().header("Range", "bytes=99-"));
        assert_eq!(
            dressed.lines,
            [
                vec!["HTTP/1.1 416 Range Not Satisfiable".to_owned()],
                texts(&CORS_LINES),
                texts(&["Content-Range: bytes */31", "Content-Length: 0"]),
            ]
            .concat()
        );
    }

    #[test]
    fn byte_range_parser_directly() {
        assert_eq!(parse_byte_range("bytes=0-", 31), Some((0, 30)));
        assert_eq!(parse_byte_range("bytes=-1", 31), Some((30, 30)));
        assert_eq!(parse_byte_range("bytes=0-0", 0), None);
        assert_eq!(parse_byte_range("bytes=4-4", 5), Some((4, 4)));
        assert_eq!(parse_byte_range("bytes=5-5", 5), None);
    }

    #[test]
    fn a_directory_or_missing_file_under_the_name_is_not_found() {
        // Хр6
        let rig = Rig::new();
        let sha = fingerprint(SAMPLE);
        fs::create_dir_all(rig.assets().join(&sha)).unwrap();
        assert_eq!(rig.status_of(&rig.get(&format!("/a/{sha}"))), 404);
    }

    // =====================================================================
    // OPTIONS, методы, Host
    // =====================================================================

    fn preflight_lines() -> Vec<String> {
        [
            texts(&["HTTP/1.1 204 No Content"]),
            texts(&CORS_LINES),
            texts(&[
                "Access-Control-Allow-Methods: GET, HEAD, PUT",
                "Access-Control-Allow-Headers: Range, Content-Type, X-Astral-Engine-Token",
                "Access-Control-Max-Age: 600",
                "Content-Length: 0",
            ]),
        ]
        .concat()
    }

    #[test]
    fn preflight_needs_neither_token_nor_path_but_the_window_origin() {
        // Оп1 – Оп7
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let loose = |req: Req| req.without("X-Astral-Engine-Token");
        let windowed = rig.ask(&loose(rig.req("OPTIONS", &path)).origin());
        assert_eq!(windowed.lines, preflight_lines());
        assert!(windowed.body.is_empty());
        let plain = rig.ask(&loose(rig.req("OPTIONS", &path)));
        assert_eq!(plain.lines, bare("HTTP/1.1 204 No Content", false));
        let stranger =
            rig.ask(&loose(rig.req("OPTIONS", &path)).header("Origin", "http://evil.example"));
        assert_eq!(stranger.lines, plain.lines);
        let anywhere = rig.ask(&loose(rig.req("OPTIONS", "/что-угодно")).origin());
        assert_eq!(anywhere.lines, preflight_lines());
        let star = rig.ask(&loose(rig.req("OPTIONS", "*")).origin());
        assert_eq!(star.lines, preflight_lines());
        let wrong_host = rig.ask(
            &rig.req("OPTIONS", &path)
                .origin()
                .set("Host", "localhost:1"),
        );
        assert_eq!(wrong_host.lines, bare("HTTP/1.1 403 Forbidden", false));
        // Оп7: без Connection: close соединение остаётся
        let mut conn = Conn::open(rig.port);
        conn.send(&loose(rig.req("OPTIONS", &path)).origin().keep().render());
        assert_eq!(conn.answer(false).unwrap().lines, preflight_lines());
        conn.send(&loose(rig.req("OPTIONS", &path)).keep().render());
        assert_eq!(conn.answer(false).unwrap().status(), 204);
    }

    #[test]
    fn other_methods_are_refused_before_the_token_is_looked_at() {
        // Оп8 – Оп13
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let refused = bare("HTTP/1.1 405 Method Not Allowed", false);
        for method in ["POST", "DELETE", "PATCH", "TRACE"] {
            assert_eq!(rig.ask(&rig.req(method, &path)).lines, refused, "{method}");
        }
        assert_eq!(rig.ask(&rig.req("CONNECT", "127.0.0.1:1")).lines, refused);
        let dressed = rig.ask(
            &rig.req("POST", &path)
                .without("X-Astral-Engine-Token")
                .origin(),
        );
        assert_eq!(dressed.lines, bare("HTTP/1.1 405 Method Not Allowed", true));
    }

    #[test]
    fn host_must_be_the_exact_loopback_address_and_port() {
        // Оп14 – Оп22
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let port = rig.port;
        for foreign in [
            format!("localhost:{port}"),
            "127.0.0.1".to_owned(),
            format!("127.0.0.1:{}", port.wrapping_add(1)),
            format!("[::1]:{port}"),
        ] {
            let answer = rig.ask(&rig.get(&path).set("Host", &foreign));
            assert_eq!(
                answer.lines,
                bare("HTTP/1.1 403 Forbidden", false),
                "{foreign}"
            );
        }
        let right = format!("127.0.0.1:{port}");
        assert_eq!(
            rig.status_of(&rig.get(&path).set("Host", &format!("  {right}  "))),
            200
        );
        assert_eq!(rig.status_of(&rig.get(&path).set("HOST", &right)), 200);
        assert_eq!(
            rig.status_of(&rig.get(&path).header("Host", "evil.example")),
            200
        );
        assert_eq!(
            rig.status_of(
                &rig.get(&path)
                    .set("Host", "evil.example")
                    .header("Host", &right)
            ),
            403
        );
        let put = rig
            .upload(&fingerprint(b"x"), b"x")
            .set("Host", "evil.example");
        assert_eq!(rig.ask(&put).lines, bare("HTTP/1.1 403 Forbidden", false));
        assert_eq!(
            rig.listing().len(),
            1,
            "кроме подложенного образца, ничего не появилось"
        );
    }

    // =====================================================================
    // PUT /awc/<sha>
    // =====================================================================

    fn bank_k() -> Vec<u8> {
        bank(0x0339_2BEC, &[1, 2, 3])
    }

    fn bank_left() -> Vec<u8> {
        bank(7, &[1, 2, 3])
    }

    /// Правый банк с частотой 44100 Гц (у помощника она всегда 22050).
    fn bank_right() -> Vec<u8> {
        let mut bytes = bank(8, &[-1, -2]);
        bytes[44..46].copy_from_slice(&44100u16.to_le_bytes());
        bytes
    }

    /// Банк с двумя потоками: 7 (22050 Гц) и 8 (44100 Гц).
    fn bank_twin() -> Vec<u8> {
        let word = |tag: u8, size: usize, offset: usize| -> [u8; 8] {
            ((offset as u64) | ((size as u64) << 28) | (u64::from(tag) << 56)).to_le_bytes()
        };
        let format = |samples: u32, rate: u16| -> Vec<u8> {
            let mut blob = vec![0u8; 20];
            blob[..4].copy_from_slice(&samples.to_le_bytes());
            blob[8..10].copy_from_slice(&rate.to_le_bytes());
            blob
        };
        let pcm =
            |samples: &[i16]| -> Vec<u8> { samples.iter().flat_map(|s| s.to_le_bytes()).collect() };
        let blobs = [
            (0xFAu8, format(3, 22050)),
            (0x55, pcm(&[1, 2, 3])),
            (0xFA, format(2, 44100)),
            (0x55, pcm(&[-1, -2])),
        ];
        let mut out = b"ADAT".to_vec();
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&2i32.to_le_bytes());
        out.extend_from_slice(&0i32.to_le_bytes());
        for id in [7u32, 8] {
            out.extend_from_slice(&((2u32 << 29) | id).to_le_bytes());
        }
        let mut cursor = 64usize;
        let mut placed = Vec::new();
        for (tag, blob) in &blobs {
            out.extend_from_slice(&word(*tag, blob.len(), cursor));
            placed.push((cursor, blob));
            cursor = (cursor + blob.len()).div_ceil(16) * 16;
        }
        for (at, blob) in placed {
            out.resize(at, 0);
            out.extend_from_slice(blob);
        }
        out
    }

    fn sizes(rig: &Rig) -> Vec<(String, u64)> {
        rig.listing().into_iter().collect()
    }

    #[test]
    fn an_upload_lands_under_its_fingerprint() {
        // Пт1 – Пт3, Пт20, Пт21, Пт23, Пт30
        let rig = Rig::new();
        assert!(!rig.assets().exists(), "запуск канала папку не создаёт");
        let k = bank_k();
        let sha_k = fingerprint(&k);
        let accepted = bare("HTTP/1.1 204 No Content", false);
        assert_eq!(rig.ask(&rig.upload(&sha_k, &k)).lines, accepted);
        assert_eq!(sizes(&rig), vec![(sha_k.clone(), 70)]);
        assert_eq!(rig.ask(&rig.upload(&sha_k, &k)).lines, accepted);
        assert_eq!(sizes(&rig).len(), 1);
        let left = bank_left();
        let with_cors = rig.ask(&rig.upload(&fingerprint(&left), &left).origin());
        assert_eq!(with_cors.lines, bare("HTTP/1.1 204 No Content", true));
        assert_eq!(rig.listing().len(), 2);
        let right = bank_right();
        let plus = rig
            .upload(&fingerprint(&right), &right)
            .set("Content-Length", &format!("+{}", right.len()));
        assert_eq!(rig.ask(&plus).lines, accepted);
        let nothing = rig.upload(EMPTY_SHA, b"");
        assert_eq!(rig.ask(&nothing).lines, accepted);
        assert_eq!(rig.listing()[EMPTY_SHA], 0);
        let doubled = rig
            .upload(&fingerprint(b"twice"), b"twice")
            .header("Content-Length", "1");
        assert_eq!(rig.ask(&doubled).lines, accepted);
        assert_eq!(rig.listing().len(), 5);
        assert_eq!(fs::read(rig.assets().join(&sha_k)).unwrap(), k);
    }

    #[test]
    fn a_wrong_fingerprint_is_refused_and_the_connection_stays() {
        // Пт4, Пт22, Пт24
        let rig = Rig::new();
        let k = bank_k();
        let mut conn = Conn::open(rig.port);
        conn.send(&rig.upload(&absent(), &k).keep().render());
        assert_eq!(
            conn.answer(false).unwrap().lines,
            bare("HTTP/1.1 400 Bad Request", false)
        );
        conn.send(&rig.get(&format!("/a/{}", absent())).keep().render());
        assert_eq!(
            conn.answer(false).unwrap().status(),
            404,
            "соединение осталось"
        );
        assert!(rig.listing().is_empty());
        let empty_body = rig.upload(&absent(), b"");
        assert_eq!(rig.status_of(&empty_body), 400);
        // Пт24: первый Content-Length (1) короче тела: прочитан один байт
        let mismatch = rig
            .upload(&fingerprint(b"ABCDEFGH"), b"ABCDEFGH")
            .set("Content-Length", "1");
        assert_eq!(rig.status_of(&mismatch), 400);
        let lucky = rig
            .upload(&fingerprint(b"A"), b"ABCDEFGH")
            .set("Content-Length", "1");
        assert_eq!(
            rig.status_of(&lucky),
            204,
            "прочитан один байт, он и есть тело"
        );
        assert_eq!(rig.listing(), BTreeMap::from([(fingerprint(b"A"), 1)]));
    }

    #[test]
    fn early_upload_refusals_close_the_connection() {
        // Пт5 – Пт19
        let rig = Rig::new();
        let k = bank_k();
        let sha = fingerprint(&k);
        let name = |status_line: &str| bare(status_line, false);
        let cases: Vec<(Req, &str)> = vec![
            (
                rig.upload(&sha, &k)
                    .set("X-Astral-Engine-Token", "intruder"),
                "HTTP/1.1 401 Unauthorized",
            ),
            (
                rig.upload(&sha, &k).without("X-Astral-Engine-Token"),
                "HTTP/1.1 401 Unauthorized",
            ),
            (
                rig.req("PUT", &format!("/a/{sha}"))
                    .set("Content-Length", "70")
                    .body(&k),
                "HTTP/1.1 404 Not Found",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}?x=1"))
                    .header("Content-Length", "70")
                    .body(&k),
                "HTTP/1.1 400 Bad Request",
            ),
            (
                rig.req("PUT", &format!("/awc/{}", sha.to_uppercase()))
                    .header("Content-Length", "70")
                    .body(&k),
                "HTTP/1.1 400 Bad Request",
            ),
            (
                rig.req("PUT", "/awc/")
                    .header("Content-Length", "70")
                    .body(&k),
                "HTTP/1.1 400 Bad Request",
            ),
            (
                rig.req("PUT", "/awc")
                    .header("Content-Length", "70")
                    .body(&k),
                "HTTP/1.1 404 Not Found",
            ),
            (
                rig.req("PUT", "/").header("Content-Length", "70").body(&k),
                "HTTP/1.1 404 Not Found",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}")).body(&k),
                "HTTP/1.1 411 Length Required",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}"))
                    .header("Transfer-Encoding", "chunked"),
                "HTTP/1.1 411 Length Required",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}"))
                    .header("Content-Length", "abc"),
                "HTTP/1.1 411 Length Required",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}"))
                    .header("Content-Length", "-1"),
                "HTTP/1.1 411 Length Required",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}"))
                    .header("Content-Length", "99999999999999999999999"),
                "HTTP/1.1 411 Length Required",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}"))
                    .header("Content-Length", "67108865"),
                "HTTP/1.1 413 Payload Too Large",
            ),
            (
                rig.req("PUT", &format!("/awc/{sha}"))
                    .header("Content-Length", "18446744073709551615"),
                "HTTP/1.1 413 Payload Too Large",
            ),
        ];
        for (req, status_line) in cases {
            let mut conn = Conn::open(rig.port);
            conn.send(&req.render());
            let answer = conn.answer(false).expect(status_line);
            assert_eq!(answer.lines, name(status_line), "{status_line}");
            assert!(
                conn.ends_without_bytes(),
                "{status_line}: соединение закрыто"
            );
        }
        assert!(rig.listing().is_empty());
        let cors = rig.ask(
            &rig.upload(&sha, &k)
                .set("X-Astral-Engine-Token", "intruder")
                .origin(),
        );
        assert_eq!(cors.lines, bare("HTTP/1.1 401 Unauthorized", true));
    }

    #[test]
    fn any_bytes_are_accepted_when_the_fingerprint_matches() {
        // Пт27, Ак22, Ак23
        let rig = Rig::new();
        let text = b"this is not an audio bank, just a text.";
        let sha = fingerprint(text);
        let mut conn = Conn::open(rig.port);
        let mut both = rig.upload(&sha, text).keep().render();
        both.extend(rig.get(&format!("/awc/{sha}")).render());
        conn.send(&both);
        assert_eq!(
            conn.answer(false).unwrap().lines,
            bare("HTTP/1.1 204 No Content", false)
        );
        let listing = conn.answer(false).unwrap();
        let json = r#"{"encrypted":true,"version":0,"flags":0,"multiChannel":false,"streams":[]}"#;
        assert_eq!(
            listing.lines,
            texts(&[
                "HTTP/1.1 200 OK",
                "Content-Type: application/json",
                &format!("Content-Length: {}", json.len()),
                CACHE_LINE,
            ])
        );
        assert_eq!(listing.body, json.as_bytes());
        assert_eq!(rig.status_of(&rig.get(&format!("/awc/{sha}/wav/1"))), 422);
    }

    #[test]
    fn a_failing_write_gives_no_answer_but_the_channel_lives() {
        // Пт28, Пт29, Хр7
        let rig = Rig::new();
        fs::write(rig.assets(), b"I am a file, not a folder").unwrap();
        let k = bank_k();
        assert!(rig.call(&rig.upload(&fingerprint(&k), &k)).is_none());
        let sha = fingerprint(SAMPLE);
        assert_eq!(rig.status_of(&rig.get(&format!("/a/{sha}"))), 404);
        let other = Rig::new();
        fs::create_dir_all(other.assets().join(fingerprint(SAMPLE))).unwrap();
        assert!(other
            .call(&other.upload(&fingerprint(SAMPLE), SAMPLE))
            .is_none());
        assert!(other.assets().join(fingerprint(SAMPLE)).is_dir());
        let leftovers: Vec<_> = other.listing().into_keys().collect();
        assert_eq!(leftovers, vec![fingerprint(SAMPLE)]);
    }

    #[test]
    fn existing_files_and_foreign_stages_are_left_alone() {
        // Хр1, Хр3, Хр4
        let rig = Rig::new();
        let k = bank_k();
        let sha = fingerprint(&k);
        assert_eq!(rig.status_of(&rig.upload(&sha, &k)), 204);
        assert_eq!(rig.listing(), BTreeMap::from([(sha.clone(), 70)]));
        fs::write(rig.assets().join(&sha), b"corrupted").unwrap();
        assert_eq!(rig.status_of(&rig.upload(&sha, &k)), 204);
        assert_eq!(fs::read(rig.assets().join(&sha)).unwrap(), b"corrupted");
        let left = bank_left();
        let foreign = format!("{}.12345.stage", fingerprint(&left));
        fs::write(rig.assets().join(&foreign), b"someone else's").unwrap();
        assert_eq!(rig.status_of(&rig.upload(&fingerprint(&left), &left)), 204);
        let names: Vec<_> = rig.listing().into_keys().collect();
        assert!(names.contains(&foreign));
        assert_eq!(names.len(), 3);
    }

    // =====================================================================
    // GET /awc/...
    // =====================================================================

    fn json_lines(len: usize) -> Vec<String> {
        texts(&[
            "HTTP/1.1 200 OK",
            "Content-Type: application/json",
            &format!("Content-Length: {len}"),
            CACHE_LINE,
        ])
    }

    fn wav_lines(len: usize) -> Vec<String> {
        texts(&[
            "HTTP/1.1 200 OK",
            "Content-Type: audio/wav",
            &format!("Content-Length: {len}"),
            CACHE_LINE,
        ])
    }

    struct Banks {
        rig: Rig,
        k: String,
        left: String,
        right: String,
        twin: String,
    }

    fn banks() -> Banks {
        let rig = Rig::new();
        let k = rig.plant(&bank_k());
        let left = rig.plant(&bank_left());
        let right = rig.plant(&bank_right());
        let twin = rig.plant(&bank_twin());
        Banks {
            rig,
            k,
            left,
            right,
            twin,
        }
    }

    #[test]
    fn a_bank_overview_and_mono_wavs() {
        // Ак1 – Ак12, Ак24, Ак38
        let Banks { rig, k, twin, .. } = banks();
        let overview_text = awc_channel::overview(&bank_k()).unwrap().to_string();
        let listing = rig.ask(&rig.get(&format!("/awc/{k}")));
        assert_eq!(listing.lines, json_lines(overview_text.len()));
        assert_eq!(listing.body, overview_text.as_bytes());
        let queried = rig.ask(&rig.get(&format!("/awc/{k}?x=1")));
        assert_eq!(queried.lines, listing.lines);
        let wav = awc_channel::mono_wav(&bank_k(), 0x0339_2BEC).unwrap();
        for id in ["54078444", "3812174828", "+54078444", "054078444"] {
            let answer = rig.ask(&rig.get(&format!("/awc/{k}/wav/{id}")));
            assert_eq!(answer.lines, wav_lines(wav.len()), "{id}");
            assert_eq!(answer.body, wav, "{id}");
        }
        let cases = [
            ("4294967295", 422),
            ("4294967296", 400),
            ("-1", 400),
            ("0x339_2BEC", 400),
            ("", 400),
            ("9", 422),
        ];
        for (id, status) in cases {
            let answer = rig.ask(&rig.get(&format!("/awc/{k}/wav/{id}")));
            assert_eq!(
                answer.lines,
                bare(&format!("HTTP/1.1 {status} {}", status_word(status)), false),
                "{id:?}"
            );
        }
        let second = rig.ask(&rig.get(&format!("/awc/{twin}/wav/8")));
        assert_eq!(second.lines, wav_lines(48));
        assert_eq!(&second.body[44..], &[0xff, 0xff, 0xfe, 0xff]);
        let dressed = rig.ask(&rig.get(&format!("/awc/{k}")).origin());
        assert_eq!(
            dressed.lines,
            [
                texts(&["HTTP/1.1 200 OK"]),
                texts(&CORS_LINES),
                json_lines(overview_text.len())[1..].to_vec()
            ]
            .concat()
        );
    }

    #[test]
    fn stereo_pairs() {
        // Ак25 – Ак35
        let Banks {
            rig,
            left,
            right,
            twin,
            ..
        } = banks();
        let straight = awc_channel::pair_wav((&bank_left(), 7), (&bank_right(), 8)).unwrap();
        let answer = rig.ask(&rig.get(&format!("/awc/pair/{left}/7/{right}/8")));
        assert_eq!(answer.lines, wav_lines(52));
        assert_eq!(answer.body, straight);
        assert_eq!(&answer.body[44..], &[1, 0, 0xff, 0xff, 2, 0, 0xfe, 0xff]);
        let reversed = rig.ask(&rig.get(&format!("/awc/pair/{right}/8/{left}/7")));
        assert_eq!(&reversed.body[24..28], &44100u32.to_le_bytes());
        assert_eq!(&reversed.body[44..], &[0xff, 0xff, 1, 0, 0xfe, 0xff, 2, 0]);
        let same = rig.ask(&rig.get(&format!("/awc/pair/{twin}/7/{twin}/8")));
        assert_eq!(same.body, straight);
        let status = |target: String| rig.status_of(&rig.get(&target));
        assert_eq!(status(format!("/awc/pair/{left}/7/{right}/9")), 422);
        assert_eq!(status(format!("/awc/pair/{left}/7/{}/8", absent())), 404);
        assert_eq!(status(format!("/awc/pair/{}/7/{right}/x", absent())), 404);
        assert_eq!(status(format!("/awc/pair/{left}/x/{right}/8")), 400);
        assert_eq!(status(format!("/awc/pair/abc/7/{right}/8")), 400);
        assert_eq!(status(format!("/awc/pair/{left}/7/{right}")), 404);
        assert_eq!(status(format!("/awc/pair/{left}/7/{right}/8/")), 404);
        assert_eq!(status("/awc/pair".to_owned()), 400);
    }

    #[test]
    fn bank_routes_by_segment_count_and_words() {
        // Ак13 – Ак21, Ак36, Ак37
        let Banks { rig, k, .. } = banks();
        let status = |target: String| rig.status_of(&rig.get(&target));
        for target in [
            format!("/awc/{k}/wav/54078444/extra"),
            format!("/awc/{k}/"),
            format!("/awc/{k}/wav"),
            format!("/awc/{k}/mp3/54078444"),
            format!("/awc/{k}/WAV/54078444"),
        ] {
            assert_eq!(status(target.clone()), 404, "{target}");
        }
        assert_eq!(status("/awc/".to_owned()), 400);
        assert_eq!(status("/awc/not-a-fingerprint".to_owned()), 400);
        assert_eq!(status(format!("/awc/{}", absent())), 404);
        assert_eq!(status(format!("/awc/{}/wav/1", absent())), 404);
        assert_eq!(rig.status_of(&rig.req("HEAD", &format!("/awc/{k}"))), 404);
        assert_eq!(
            rig.status_of(
                &rig.get(&format!("/awc/{k}"))
                    .without("X-Astral-Engine-Token")
            ),
            401
        );
    }

    // =====================================================================
    // Лимиты и соединения
    // =====================================================================

    /// Запрос, у которого голова (до пустой строки включительно) ровно `total` байт.
    fn head_of_size(rig: &Rig, path: &str, total: usize) -> Req {
        let base = rig.get(path).header("X-Pad", "");
        let need = total - base.render().len();
        rig.get(path).header("X-Pad", &"a".repeat(need))
    }

    #[test]
    fn the_head_is_limited_to_16384_bytes() {
        // Лм1 – Лм3, Н-9
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let path = format!("/a/{sha}");
        let exact = head_of_size(&rig, &path, 16_384);
        assert_eq!(exact.render().len(), 16_384);
        assert_eq!(rig.status_of(&exact), 200);
        let over = head_of_size(&rig, &path, 16_385);
        assert!(rig.call(&over).is_none());
        let far_over = head_of_size(&rig, &path, 17_100);
        assert!(rig.call(&far_over).is_none());
    }

    #[test]
    fn a_dribbled_long_first_line_is_read_to_its_end_first() {
        // Гн1
        let rig = Rig::new();
        let mut conn = Conn::open(rig.port);
        conn.send(b"GET /");
        conn.send(&vec![b'a'; 3 * 1024 * 1024]);
        thread::sleep(Duration::from_millis(1200));
        conn.send(b"\r\n\r\n");
        assert!(
            conn.answer(false).is_none(),
            "слишком длинная голова закрывается без ответа"
        );
    }

    #[test]
    fn idle_connections_are_dropped_after_five_seconds() {
        // Лм4, Лм5, Лм6, Пт26, Н-8
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let k = bank_k();
        let started = Instant::now();
        thread::scope(|scope| {
            let silent = scope.spawn(|| {
                let mut conn = Conn::open(rig.port);
                let closed = conn.ends_without_bytes();
                (closed, started.elapsed())
            });
            let half = scope.spawn(|| {
                let mut conn = Conn::open(rig.port);
                conn.send(
                    format!("GET /a/{sha} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n", rig.port).as_bytes(),
                );
                let closed = conn.ends_without_bytes();
                (closed, started.elapsed())
            });
            let keepalive = scope.spawn(|| {
                let mut conn = Conn::open(rig.port);
                conn.send(&rig.get(&format!("/a/{sha}")).keep().render());
                let first = conn.answer(false).map(|answer| answer.status());
                let closed = conn.ends_without_bytes();
                (first, closed, started.elapsed())
            });
            let short_body = scope.spawn(|| {
                let mut conn = Conn::open(rig.port);
                let request = rig.upload(&fingerprint(&k), &k).render();
                let cut = request.len() - (k.len() - 10);
                conn.send(&request[..cut]);
                let answered = conn.answer(false).is_some();
                (answered, started.elapsed())
            });
            let (closed, took) = silent.join().unwrap();
            assert!(
                closed && took >= Duration::from_millis(4500) && took < Duration::from_secs(9),
                "{took:?}"
            );
            let (closed, took) = half.join().unwrap();
            assert!(closed && took >= Duration::from_millis(4500), "{took:?}");
            let (first, closed, took) = keepalive.join().unwrap();
            assert_eq!(first, Some(200));
            assert!(closed && took >= Duration::from_millis(4500), "{took:?}");
            let (answered, took) = short_body.join().unwrap();
            assert!(!answered && took >= Duration::from_millis(4500), "{took:?}");
        });
        assert!(!rig.listing().contains_key(&fingerprint(&k)));
    }

    #[test]
    fn a_wrong_token_upload_still_delivers_its_401() {
        // Лм9
        let rig = Rig::new();
        let body = vec![7u8; 3 * 1024 * 1024];
        let req = rig
            .upload(&fingerprint(&body), &body)
            .set("X-Astral-Engine-Token", "intruder");
        let answer = rig.call(&req).expect("401 доходит до клиента");
        assert_eq!(answer.lines, bare("HTTP/1.1 401 Unauthorized", false));
        assert!(rig.listing().is_empty());
    }

    #[test]
    fn exactly_64_mebibytes_are_read_and_checked() {
        // Лм14
        let rig = Rig::new();
        let body = vec![0u8; UPLOAD_LIMIT];
        let answer = rig.ask(&rig.upload(&absent(), &body));
        assert_eq!(answer.lines, bare("HTTP/1.1 400 Bad Request", false));
        assert!(rig.listing().is_empty());
    }

    #[test]
    fn at_most_64_connections_are_served_at_once() {
        // Н-7, Лм10, Лм12, Лм13
        let rig = Rig::new();
        let sha = rig.plant(SAMPLE);
        let mut idle: Vec<Conn> = (0..64).map(|_| Conn::open(rig.port)).collect();
        // Принимающий поток может отстать от клиентов: пока 65-е соединение
        // принимается, а не отвергается, оно молчит, и его закрывают и пробуют снова.
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut got = Vec::new();
        loop {
            let mut sixty_fifth = Conn::open(rig.port);
            let _ = sixty_fifth
                .reader
                .get_ref()
                .set_read_timeout(Some(Duration::from_millis(400)));
            got.clear();
            let _ = sixty_fifth.reader.read_to_end(&mut got);
            if got.len() == 55 || Instant::now() >= deadline {
                break;
            }
            drop(sixty_fifth);
            thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(
            got,
            b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n"
        );
        assert_eq!(got.len(), 55);
        // Лм12: места освобождаются, когда молчавшие соединения закрыты
        idle.truncate(53);
        thread::sleep(Duration::from_millis(600));
        assert_eq!(rig.status_once_admitted(&format!("/a/{sha}")), 200);
        // Лм13: 64-е соединение ещё принимается
        idle.truncate(52);
        thread::sleep(Duration::from_millis(400));
        let more: Vec<Conn> = (0..11).map(|_| Conn::open(rig.port)).collect();
        thread::sleep(Duration::from_millis(400));
        assert_eq!(rig.status_once_admitted(&format!("/a/{sha}")), 200);
        drop(more);
        drop(idle);
    }

    #[test]
    fn a_slot_is_held_for_two_seconds_after_connection_close() {
        // Н-12, Гн7
        // Все 64 ответа должны прийти раньше, чем освободится первое место (через
        // две секунды); на сильно нагруженной машине они не успевают, и тогда 65-е
        // соединение принимается вместо отказа: проход повторяется на новом стенде.
        let mut attempt = 0;
        let (rig, lingering, started) = loop {
            attempt += 1;
            let rig = Rig::new();
            let mut lingering: Vec<Conn> = (0..64).map(|_| Conn::open(rig.port)).collect();
            for conn in &mut lingering {
                conn.send(&rig.get(&format!("/a/{}", absent())).render());
            }
            for conn in &mut lingering {
                assert_eq!(conn.answer(false).unwrap().status(), 404);
            }
            let started = Instant::now();
            let mut crowded = Conn::open(rig.port);
            let _ = crowded
                .reader
                .get_ref()
                .set_read_timeout(Some(Duration::from_millis(1500)));
            let mut got = Vec::new();
            let _ = crowded.reader.read_to_end(&mut got);
            if got.starts_with(b"HTTP/1.1 503") {
                break (rig, lingering, started);
            }
            assert!(attempt < 4, "{:?}", String::from_utf8_lossy(&got));
        };
        thread::sleep(Duration::from_millis(2600).saturating_sub(started.elapsed()));
        assert_eq!(rig.status_once_admitted(&format!("/a/{}", absent())), 404);
        drop(lingering);
    }

    #[test]
    fn a_client_that_walks_away_mid_download_harms_nobody() {
        // Лм8
        let rig = Rig::new();
        let sha = rig.plant(&big_file());
        let mut walker = Conn::open(rig.port);
        walker.send(&rig.get(&format!("/a/{sha}")).render());
        let mut taste = [0u8; 4096];
        walker.reader.read_exact(&mut taste).unwrap();
        drop(walker);
        assert_eq!(
            rig.status_of(&rig.get(&format!("/a/{sha}")).header("Range", "bytes=0-9")),
            206
        );
    }

    #[test]
    fn parallel_uploads_and_reads_agree() {
        // Гн2 – Гн6
        let rig = Rig::new();
        let big = bank(0x0339_2BEC, &vec![5i16; 200_000]);
        let big_sha = fingerprint(&big);
        let port = rig.port;
        let same: Vec<_> = (0..24)
            .map(|_| {
                let request = rig.upload(&big_sha, &big).render();
                thread::spawn(move || {
                    let mut conn = Conn::open(port);
                    conn.send(&request);
                    conn.answer(false).map(|answer| answer.status())
                })
            })
            .collect();
        for worker in same {
            assert_eq!(worker.join().unwrap(), Some(204));
        }
        assert_eq!(fs::read(rig.assets().join(&big_sha)).unwrap(), big);
        assert_eq!(rig.listing().len(), 1);
        let distinct: Vec<_> = (0..16)
            .map(|index| {
                let body = bank(100 + index, &[index as i16; 64]);
                let request = rig.upload(&fingerprint(&body), &body).render();
                thread::spawn(move || {
                    let mut conn = Conn::open(port);
                    conn.send(&request);
                    conn.answer(false).map(|answer| answer.status())
                })
            })
            .collect();
        for worker in distinct {
            assert_eq!(worker.join().unwrap(), Some(204));
        }
        assert_eq!(rig.listing().len(), 17);
        // Гн6: читатель видит либо отсутствие файла, либо целый файл
        let fresh = bank(0x0339_2BEC, &vec![9i16; 150_000]);
        let fresh_sha = fingerprint(&fresh);
        let writer = {
            let request = rig.upload(&fresh_sha, &fresh).render();
            thread::spawn(move || {
                let mut conn = Conn::open(port);
                conn.send(&request);
                conn.answer(false).map(|answer| answer.status())
            })
        };
        let readers: Vec<_> = (0..30)
            .map(|_| {
                let request = rig.get(&format!("/a/{fresh_sha}")).render();
                thread::spawn(move || {
                    let mut conn = Conn::open(port);
                    conn.send(&request);
                    conn.answer(false)
                        .map(|answer| (answer.status(), answer.body.len()))
                })
            })
            .collect();
        for reader in readers {
            match reader.join().unwrap() {
                Some((404, 0)) => {}
                Some((200, len)) => assert_eq!(len, fresh.len()),
                other => panic!("неожиданный ответ читателя: {other:?}"),
            }
        }
        assert_eq!(writer.join().unwrap(), Some(204));
    }

    #[test]
    fn status_words_cover_what_the_channel_says() {
        for (code, word) in STATUS_WORDS {
            assert_eq!(status_word(code), word);
        }
        assert_eq!(status_word(500), "Error");
    }
}
