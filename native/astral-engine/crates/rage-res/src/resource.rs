//! Контейнер ресурсов GTA V Legacy (RSC7): заголовок, две области, адресация.

use std::io::Write;

use flate2::{write::DeflateEncoder, Compression};
use libdeflater::Decompressor;
use miniz_oxide::inflate::TINFLStatus;

use crate::error::{Error, Result};

/// Открытые константы: `ИМЯ(тип) = значение;`.
macro_rules! resource_constants {
    ($($(#[$doc:meta])* $name:ident($kind:ty) = $value:expr;)+) => {
        $($(#[$doc])* pub const $name: $kind = $value;)+
    };
}

/// Открытая запись, которую можно копировать: `поле => тип`, порядок — как в списке.
macro_rules! resource_record {
    ($name:ident { $($field:ident => $kind:ty),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy)]
        pub struct $name {
            $(pub $field: $kind),+
        }
    };
}

/// Читатели чисел из данных ресурса: `имя(смещение)` на каждый тип.
macro_rules! scalar_readers {
    ($($kind:ident),+) => {
        $(
            pub fn $kind(&self, at: usize) -> Result<$kind> {
                self.array(at).map($kind::from_le_bytes)
            }
        )+
    };
}

resource_constants! {
    RSC7_MAGIC(u32) = 0x3743_5352;
    SYSTEM_BASE(u64) = 0x5000_0000;
    GRAPHICS_BASE(u64) = 0x6000_0000;
    HEADER_BYTES(usize) = 16;
    MAX_RESOURCE_BYTES(usize) = 256 * 1024 * 1024;
    VERSION_YTD(u32) = 13;
    /// Ядро эффектов `core.ypt` Legacy.
    VERSION_YPT_LEGACY(u32) = 68;
    VERSION_DRAWABLE(u32) = 165;
    VERSION_FRAGMENT(u32) = 162;
    ENHANCED_MODEL_VERSIONS([u32; 3]) = [154, 159, 171];
    VERSION_YTD_ENHANCED(u32) = 5;
}

/// Поля «число страниц»: (младший бит, ширина); вес поля — степень двойки по его номеру.
const PAGE_FIELDS: [(u32, u32); 9] = [
    (27, 1),
    (26, 1),
    (25, 1),
    (24, 1),
    (17, 7),
    (11, 6),
    (7, 4),
    (5, 2),
    (4, 1),
];

resource_record!(Header {
    system_flags => u32,
    graphics_flags => u32,
    system_size => usize,
    graphics_size => usize,
    version => u32,
    declared_version => u32,
});

resource_record!(PointerList {
    entries => u64,
    count => u16,
    capacity => u16,
});

#[derive(Debug)]
pub struct Resource {
    data: Vec<u8>,
    pub header: Header,
    pub complete: bool,
}

pub fn page_flag_size(flags: u32) -> usize {
    let pages = PAGE_FIELDS
        .iter()
        .enumerate()
        .fold(0usize, |sum, (number, &(low, width))| {
            let count = (flags >> low) & ((1 << width) - 1);
            sum + count as usize * (1usize << number)
        });
    (0x200usize << (flags & 0xf)) * pages
}

pub fn resource_version(system_flags: u32, graphics_flags: u32) -> u32 {
    let nibble = |flags: u32| (flags >> 28) & 0xf;
    (nibble(system_flags) << 4) + nibble(graphics_flags)
}

pub fn is_resource(bytes: &[u8]) -> bool {
    let magic = RSC7_MAGIC.to_le_bytes();
    bytes.len() >= HEADER_BYTES && bytes.starts_with(&magic)
}

impl Header {
    fn total(&self) -> usize {
        self.graphics_size + self.system_size
    }
}

/// Слово заголовка по номеру (4 байта, младшим вперёд).
fn word(bytes: &[u8], index: usize) -> u32 {
    let at = index * 4;
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}

const MSG_SHORT: &str = "Ресурс короче заголовка RSC7.";
const MSG_MAGIC: &str = "Файл не является ресурсом RSC7.";
const MSG_HUGE: &str = "Ресурс заявляет больше 256 МБ.";

pub fn read_header(bytes: &[u8]) -> Result<Header> {
    if bytes.len() < HEADER_BYTES {
        return Err(Error::broken(MSG_SHORT));
    }
    if word(bytes, 0) != RSC7_MAGIC {
        return Err(Error::broken(MSG_MAGIC));
    }
    let flags = [word(bytes, 2), word(bytes, 3)];
    let [system_size, graphics_size] = flags.map(page_flag_size);
    let header = Header {
        declared_version: word(bytes, 1),
        version: resource_version(flags[0], flags[1]),
        graphics_size,
        system_size,
        graphics_flags: flags[1],
        system_flags: flags[0],
    };
    match header.total() > MAX_RESOURCE_BYTES {
        true => Err(Error::broken(MSG_HUGE)),
        false => Ok(header),
    }
}

/// Сырой deflate (без обёртки zlib), уровень 9.
pub fn deflate_zlib9(body: &[u8]) -> Vec<u8> {
    let mut packer = DeflateEncoder::new(Vec::new(), Compression::new(9));
    let _ = packer.write_all(body);
    packer.finish().unwrap_or_default()
}

const MSG_EMPTY: &str = "Поток ресурса пуст или не распакован.";

/// Состояния распаковки, при которых прочитанное остаётся годным: поток оборвался
/// или упёрся в потолок объёма. Всё остальное — порченый поток.
fn tolerated(status: TINFLStatus) -> bool {
    use TINFLStatus::{FailedCannotMakeProgress, HasMoreOutput, NeedsMoreInput};
    matches!(
        status,
        NeedsMoreInput | FailedCannotMakeProgress | HasMoreOutput
    )
}

/// Распаковывает тело не больше `cap` байт. Файлы модов бывают без маркера конца
/// потока (обрыв) или с телом длиннее ожидаемого: берём, что успели. Порча — отказ.
///
/// Это прежний, медленный и всеядный путь: вывод идёт в растущий буфер, а у оборванного
/// потока в ответе остаётся весь буфер, добитый нулями (его длина зависит от размера
/// входа). Эту длину читатели видят и сегодня, поэтому путь не менялся ни на байт.
fn inflate_what_fits(body: &[u8], cap: usize) -> Result<Vec<u8>> {
    match miniz_oxide::inflate::decompress_to_vec_with_limit(body, cap) {
        Err(failure) if !tolerated(failure.status) => Err(Error::broken(MSG_EMPTY)),
        Err(failure) => Ok(failure.output),
        Ok(done) => Ok(done),
    }
}

/// Больше всего deflate раздувает поток в 1032 раза: совпадение в 258 байт кодируется двумя
/// битами (один код длины и один код расстояния по одному биту).
const MAX_DEFLATE_RATIO: usize = 1032;
/// Запас на крайние блоки потока: одно совпадение.
const MAX_DEFLATE_MATCH: usize = 258;

/// Может ли поток в `body_len` байт дать `total` байт. Заголовок порченого файла заявляет
/// до 256 МБ при теле в десяток байт: под такое буфер заранее не отводится.
fn could_fill(body_len: usize, total: usize) -> bool {
    let most = body_len
        .saturating_mul(MAX_DEFLATE_RATIO)
        .saturating_add(MAX_DEFLATE_MATCH);
    total <= most
}

/// Быстрый путь: libdeflate сразу в буфер заявленного размера, без роста и копий.
///
/// Результат окончательный только в одном исходе: поток дочитан до конца последнего блока
/// и дал ровно `total` байт (хвост после потока значения не имеет, как и у прежнего пути).
/// Тогда прежний путь тоже кончил бы разбор успешно и отдал те же `total` байт. Всё остальное
/// — `None`, и дело берёт прежний путь: короткий выход, лишние данные (обрезка по заявленному
/// размеру), оборванный поток и поток без маркера конца (у них прежний путь отдаёт буфер с
/// нулевым хвостом нужной ему длины), ошибка формата (отказ с прежним сообщением).
///
/// Единственное известное расхождение: libdeflate намеренно читает символы длины 286 и 287 как
/// длину 258 (и расстояния 30 и 31 как дальние), а RFC 1951 их запрещает, и miniz_oxide
/// отказывает. Упаковщики таких символов не пишут; на порченом потоке, что после порчи всё
/// равно закрылся маркером конца ровно на заявленном объёме, итогом станет разбор вместо отказа
/// (проверка — `reserved_deflate_symbols_are_the_known_gap_of_the_fast_path`).
fn inflate_declared(body: &[u8], total: usize) -> Option<Vec<u8>> {
    if total == 0 || !could_fill(body.len(), total) {
        return None;
    }
    let mut data = vec![0u8; total];
    match Decompressor::new().deflate_decompress(body, &mut data) {
        Ok(produced) if produced == total => Some(data),
        _ => None,
    }
}

impl Resource {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        Self::parse_proven(bytes).map(|(resource, _)| resource)
    }

    /// `parse` и признак «быстрый путь»: `true` — поток целиком и чисто дал заявленный объём,
    /// все байты настоящие. Пишущий код опирается на него и не распаковывает ресурс второй раз.
    pub(crate) fn parse_proven(bytes: &[u8]) -> Result<(Self, bool)> {
        let header = read_header(bytes)?;
        let body = &bytes[HEADER_BYTES..];
        if let Some(data) = inflate_declared(body, header.total()) {
            return Ok((Self::from_parts(header, data), true));
        }
        Self::parse_forgiving(header, body).map(|resource| (resource, false))
    }

    /// Прежний разбор целиком: допуски и отказы те же, что до быстрого пути.
    fn parse_forgiving(header: Header, body: &[u8]) -> Result<Self> {
        let cap = header.total().max(1);
        let mut data = inflate_what_fits(body, cap)?;
        if data.is_empty() {
            return Err(Error::broken(MSG_EMPTY));
        }
        data.truncate(cap);
        Ok(Self::from_parts(header, data))
    }

    pub fn from_parts(header: Header, data: Vec<u8>) -> Self {
        Self {
            complete: data.len() >= header.total(),
            header,
            data,
        }
    }

    pub fn to_file_bytes(&self) -> Result<Vec<u8>> {
        let h = &self.header;
        let words = [
            RSC7_MAGIC,
            h.declared_version,
            h.system_flags,
            h.graphics_flags,
        ];
        let mut out: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
        out.extend(deflate_zlib9(&self.data));
        Ok(out)
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn version(&self) -> u32 {
        self.header.version
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }

    pub fn data_mut(&mut self) -> &mut Vec<u8> {
        &mut self.data
    }

    /// Смещение в данных по указателю: системная область с `SYSTEM_BASE`, графическая
    /// — следом за системной, с `GRAPHICS_BASE`.
    pub fn at(&self, pointer: u64) -> Option<usize> {
        let offset = if pointer >= GRAPHICS_BASE {
            (pointer - GRAPHICS_BASE).checked_add(self.header.system_size as u64)?
        } else if pointer >= SYSTEM_BASE {
            pointer - SYSTEM_BASE
        } else {
            return None;
        };
        usize::try_from(offset)
            .ok()
            .filter(|&o| o < self.data.len())
    }

    pub fn root(&self) -> Option<usize> {
        self.at(SYSTEM_BASE)
    }

    pub fn bytes(&self, at: usize, len: usize) -> Result<&[u8]> {
        const MSG_EOF: &str = "Чтение за концом данных ресурса.";
        let end = at.checked_add(len).ok_or_else(|| Error::broken(MSG_EOF))?;
        self.data.get(at..end).ok_or_else(|| Error::broken(MSG_EOF))
    }

    fn array<const N: usize>(&self, at: usize) -> Result<[u8; N]> {
        let mut out = [0u8; N];
        out.copy_from_slice(self.bytes(at, N)?);
        Ok(out)
    }

    scalar_readers!(u8, u16, i16, u32, f32, u64);

    pub fn pointer_at(&self, at: usize) -> Option<usize> {
        let pointer = self.u64(at).ok()?;
        self.at(pointer)
    }

    pub fn cstring(&self, pointer: u64) -> Option<String> {
        self.cstring_limited(pointer, 256)
    }

    pub fn cstring_limited(&self, pointer: u64, limit: usize) -> Option<String> {
        let tail = &self.data[self.at(pointer)?..];
        let window = &tail[..limit.min(tail.len())];
        let text = match window.iter().position(|&b| b == 0) {
            Some(end) => &window[..end],
            None => window,
        };
        Some(String::from_utf8_lossy(text).into_owned())
    }

    pub fn pointer_list(&self, at: usize) -> Result<PointerList> {
        let entries = self.u64(at)?;
        let count = self.u16(at + 8)?;
        let capacity = self.u16(at + 10)?;
        Ok(PointerList {
            capacity,
            count,
            entries,
        })
    }
}

#[cfg(test)]
mod inflate_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use sha2::{Digest, Sha256};

    fn hex(bytes: &[u8]) -> String {
        let digest = Sha256::digest(bytes);
        digest.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Числа из записи «0x20000 8192 1_024»: десятичные или с `0x`, `_` и `;` не мешают.
    fn numbers(text: &str) -> Vec<u64> {
        let parse = |item: &str| {
            let plain = item.replace('_', "");
            match plain.strip_prefix("0x") {
                Some(digits) => u64::from_str_radix(digits, 16),
                None => plain.parse(),
            }
            .unwrap()
        };
        text.split(|c: char| c == ';' || c == ',' || c.is_whitespace())
            .filter(|item| !item.is_empty())
            .map(parse)
            .collect()
    }

    fn octets(text: &str) -> Vec<u8> {
        numbers(text).into_iter().map(|n| n as u8).collect()
    }

    fn file(version: u32, sys: u32, gfx: u32, body: &[u8]) -> Vec<u8> {
        let words = [RSC7_MAGIC, version, sys, gfx];
        let mut out: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        out.extend_from_slice(body);
        out
    }

    fn pattern() -> Vec<u8> {
        (0..8192u32).map(|i| (i * 7 + 3) as u8).collect()
    }

    /// Ресурс «Р» из описания.
    fn sample_file() -> Vec<u8> {
        file(165, 0xa002_0000, 0x5000_0000, &deflate_zlib9(&pattern()))
    }

    fn parts(sys: u32, gfx: u32, data: Vec<u8>) -> Resource {
        let header = read_header(&file(1, sys, gfx, &[])).unwrap();
        Resource::from_parts(header, data)
    }

    fn err_text<T: std::fmt::Debug>(r: Result<T>) -> String {
        let e = r.unwrap_err();
        assert_eq!(e.kind, Kind::Broken);
        e.message
    }

    #[test]
    fn page_sizes() {
        let table = numbers(
            "0 0;  4 0;  0x20000 8192;  0x0800_0000 512;  0x0400_0000 1024;
             0x0200_0000 2048;  0x0100_0000 4096;  0x10 131_072;  0x20 65_536;
             0x40 131_072;  0x80 32_768;  0x800 16_384;  0x400 262_144;
             0x00fe_0000 1_040_384;  0x0001_f800 1_032_192;  0x780 491_520;
             0x60 196_608;  0xf 0;  0xffff_ffff 95_009_374_208;
             0x0fff_ffff 95_009_374_208;  0xf000_0000 0;  0x0002_000f 268_435_456;
             0x1800_0000 512",
        );
        assert_eq!(table.len(), 46);
        for pair in table.chunks(2) {
            let (flags, size) = (pair[0] as u32, pair[1] as usize);
            assert_eq!(page_flag_size(flags), size, "{flags:#x}");
        }
        assert_eq!(page_flag_size((1 << 17) | 4), 0x2000 * 16);
        assert_eq!(page_flag_size((1 << 17) | (1 << 24)), (16 + 8) * 0x200);
    }

    #[test]
    fn versions() {
        let table = numbers(
            "0 0 0;  0xA000_0000 0x5000_0000 165;  0 0xD000_0000 13;
             0xF000_0000 0xF000_0000 255;  0x1000_0000 0x2000_0000 18;
             0x0fff_ffff 0x0fff_ffff 0",
        );
        for row in table.chunks(3) {
            let got = resource_version(row[0] as u32, row[1] as u32);
            assert_eq!(u64::from(got), row[2]);
        }
    }

    #[test]
    fn constants() {
        assert_eq!(RSC7_MAGIC.to_le_bytes(), *b"RSC7");
        assert_eq!(MAX_RESOURCE_BYTES, 268_435_456);
        assert_eq!(ENHANCED_MODEL_VERSIONS, [154, 159, 171]);
        let versions = [
            VERSION_YTD,
            VERSION_YPT_LEGACY,
            VERSION_DRAWABLE,
            VERSION_FRAGMENT,
        ];
        assert_eq!(versions, [13, 68, 165, 162]);
        assert_eq!(VERSION_YTD_ENHANCED, 5);
    }

    #[test]
    fn rejects_non_resources() {
        // Магия есть, а тело — нули: порченый поток, ресурса нет.
        let mut magic_over_zeros = vec![0u8; 32];
        magic_over_zeros[..4].copy_from_slice(b"RSC7");
        let samples = [b"short".to_vec(), vec![0u8; 32], magic_over_zeros];
        for bytes in &samples {
            assert!(Resource::parse(bytes).is_err());
        }
    }

    #[test]
    fn is_resource_and_header() {
        let f = file(1, 0, 0, &[]);
        let verdicts = [
            (&b"RSC7"[..], false),
            (&f[..], true),
            (&f[..15], false),
            (&[0u8; 16][..], false),
        ];
        for (bytes, want) in verdicts {
            assert_eq!(is_resource(bytes), want, "{bytes:?}");
        }
        let h = read_header(&f).unwrap();
        assert_eq!(
            format!("{h:?}"),
            "Header { system_flags: 0, graphics_flags: 0, system_size: 0, graphics_size: 0, version: 0, declared_version: 1 }"
        );
        let refusals: [(&[u8], &str); 2] = [
            (&[0u8; 16], "Файл не является ресурсом RSC7."),
            (&[1, 2, 3], "Ресурс короче заголовка RSC7."),
        ];
        for (bytes, text) in refusals {
            assert_eq!(err_text(read_header(bytes)), text);
        }
    }

    #[test]
    fn header_fields() {
        let h = read_header(&file(0xdead, 0xa002_0000, 0x5002_0000, &[])).unwrap();
        let got = (
            h.system_flags,
            h.graphics_flags,
            h.system_size,
            h.graphics_size,
        );
        assert_eq!(got, (2_684_485_632, 1_342_308_352, 8192, 8192));
        assert_eq!((h.version, h.declared_version), (165, 57005));
    }

    #[test]
    fn header_size_limit() {
        let huge = "Ресурс заявляет больше 256 МБ.";
        let sizes = |sys, gfx| {
            let h = read_header(&file(1, sys, gfx, &[])).unwrap();
            (h.system_size, h.graphics_size)
        };
        let refused = |sys, gfx| err_text(read_header(&file(1, sys, gfx, &[])));
        let half = (1 << 4) | 0xa;
        assert_eq!(refused((0x7f << 17) | 0xf, 0), huge);
        assert_eq!(refused(u32::MAX, u32::MAX), huge);
        assert_eq!(sizes((1 << 17) | 7, 0), (1_048_576, 0));
        assert_eq!(sizes((1 << 4) | 0xb, 0), (268_435_456, 0));
        assert_eq!(refused((1 << 4) | 0xb, 1 << 17), huge);
        assert_eq!(sizes(half, half), (134_217_728, 134_217_728));
        assert_eq!(refused(half, half | (1 << 7)), huge);
    }

    #[test]
    fn parse_sample_and_access() {
        let r = Resource::parse(&sample_file()).unwrap();
        assert_eq!(r.len(), 8192);
        assert!(r.complete);
        assert_eq!(r.version(), 165);
        assert_eq!(r.header.declared_version, 165);
        assert_eq!(r.header.graphics_size, 0);
        let probes =
            numbers("0 0x5000_0000 0x5000_0010 0x5000_1fff 0x5000_2000 0x6000_0000 0x4fff_ffff");
        let at: Vec<Option<usize>> = probes.iter().map(|&p| r.at(p)).collect();
        assert_eq!(at, [None, Some(0), Some(16), Some(8191), None, None, None]);
        assert_eq!(r.root(), Some(0));
        let scalars = (
            r.u8(1).unwrap(),
            r.u16(1).unwrap(),
            r.i16(1).unwrap(),
            r.u32(1).unwrap(),
            r.u64(1).unwrap(),
        );
        assert_eq!(
            scalars,
            (10, 4362, 4362, 521_670_922, 4_266_084_388_780_380_426)
        );
        assert_eq!(r.f32(1).unwrap(), 3.2201346e-20);
        let eof = "Чтение за концом данных ресурса.";
        assert_eq!(err_text(r.u8(0x2000)), eof);
        assert_eq!(err_text(r.u32(0x1ffe)), eof);
        assert_eq!(err_text(r.bytes(usize::MAX, 2)), eof);
        assert_eq!(r.bytes(0x1ffe, 2).unwrap().len(), 2);
        assert_eq!(r.bytes(0x2000, 0).unwrap().len(), 0);
        assert!(r.bytes(0x2001, 0).is_err());
        assert_eq!(r.to_file_bytes().unwrap(), sample_file());
    }

    #[test]
    fn negative_i16() {
        let negative = parts(0, 0, octets("0xfe 0xff"));
        assert_eq!(negative.i16(0).unwrap(), -2);
    }

    #[test]
    fn from_parts_addressing() {
        // (флаги системы, флаги графики, число байт данных, зонды «указатель -> смещение»)
        type Probe = (u64, Option<usize>);
        let layouts: [(u32, u32, usize, Vec<Probe>); 4] = [
            (
                0xa002_0000,
                0x5002_0000,
                8208,
                vec![
                    (0x6000_0000, Some(8192)),
                    (0x6000_0010, None),
                    (0x6000_0020, None),
                ],
            ),
            (
                0xa002_0000,
                0x5002_0000,
                16384,
                vec![
                    (0x5000_1fff, Some(8191)),
                    (0x5000_2000, Some(8192)),
                    (0x5000_3fff, Some(16383)),
                    (0x5000_4000, None),
                    (0x6000_0000, Some(8192)),
                    (0x6000_1fff, Some(16383)),
                    (0x6000_2000, None),
                    (0x4fff_ffff, None),
                    (0x5fff_ffff, None),
                    (u64::MAX, None),
                    (1, None),
                ],
            ),
            (
                0,
                0x5002_0000,
                8192,
                vec![
                    (0x5000_0000, Some(0)),
                    (0x6000_0000, Some(0)),
                    (0x6000_1fff, Some(8191)),
                ],
            ),
            (0, 0, 0, vec![(0x5000_0000, None)]),
        ];
        for (sys, gfx, size, probes) in layouts {
            let r = parts(sys, gfx, vec![0; size]);
            assert_eq!(
                r.complete,
                size >= r.header.system_size + r.header.graphics_size
            );
            for (pointer, want) in probes {
                assert_eq!(r.at(pointer), want, "{sys:#x} {gfx:#x} {pointer:#x}");
            }
        }
        let empty = parts(0, 0, vec![]);
        assert_eq!(empty.root(), None);
        assert!(empty.bytes(0, 0).unwrap().is_empty());
        assert!(empty.is_empty());
        assert_eq!(empty.len(), 0);
    }

    fn scratch() -> Resource {
        parts(0xa002_0000, 0, vec![0; 8192])
    }

    #[test]
    fn pointers_and_strings() {
        let mut r = scratch();
        let put = |r: &mut Resource, at: usize, bytes: &[u8]| {
            r.data_mut()[at..at + bytes.len()].copy_from_slice(bytes);
        };
        put(&mut r, 0, &0x5000_0100u64.to_le_bytes());
        put(&mut r, 8, &0x6000_0000u64.to_le_bytes());
        put(&mut r, 24, &0x1234u64.to_le_bytes());
        assert_eq!(r.pointer_at(0), Some(256));
        for at in [8, 16, 24, 0x2000] {
            assert_eq!(r.pointer_at(at), None);
        }

        put(&mut r, 0x100, b"hello\0");
        put(&mut r, 0x110, &[0xe2, 0x82, 0xac, 0x41]);
        put(&mut r, 0x120, &[0xff, 0x41]);
        let words = [
            (0x5000_0100, Some("hello")),
            (0x5000_0105, Some("")),
            (0x5000_0110, Some("€A")),
            (0x5000_0120, Some("\u{fffd}A")),
            (0, None),
            (0x5000_2000, None),
        ];
        for (pointer, want) in words {
            assert_eq!(r.cstring(pointer).as_deref(), want, "{pointer:#x}");
        }
        for (limit, want) in [(3, "hel"), (0, "")] {
            let cut = r.cstring_limited(0x5000_0100, limit);
            assert_eq!(cut.as_deref(), Some(want));
        }
    }

    #[test]
    fn long_strings_and_overflow() {
        let r = parts(0xa002_0000, 0, vec![b'x'; 8192]);
        let shown = [
            r.cstring(0x5000_0000),
            r.cstring_limited(0x5000_0000, usize::MAX),
        ];
        assert_eq!(shown.map(|text| text.unwrap().len()), [256, 8192]);
    }

    #[test]
    fn cstring_limit_overflow_is_clamped_to_the_data() {
        let r = parts(0xa002_0000, 0, vec![b'x'; 8192]);
        let rest = r.cstring_limited(0x5000_0001, usize::MAX);
        assert_eq!(rest.map(|text| text.len()), Some(8191));
    }

    #[test]
    fn pointer_list_reads() {
        let mut r = scratch();
        let list_bytes = octets("0 1 0 0x50 0 0 0 0  3 0  7 0");
        r.data_mut()[0x40..0x4c].copy_from_slice(&list_bytes);
        let list = r.pointer_list(0x40).unwrap();
        assert_eq!(
            format!("{list:?}"),
            "PointerList { entries: 1342177536, count: 3, capacity: 7 }"
        );
        let past_end = err_text(r.pointer_list(0x1ffa));
        assert_eq!(past_end, "Чтение за концом данных ресурса.");
    }

    fn parse_body(sys: u32, body: &[u8]) -> Result<Resource> {
        Resource::parse(&file(165, sys, 0, body))
    }

    #[test]
    fn parse_odd_bodies() {
        let empty = "Поток ресурса пуст или не распакован.";
        let refused = |body: &[u8]| err_text(parse_body(0xa002_0000, body));
        assert_eq!(refused(&[]), empty);
        assert_eq!(refused(&[3, 0]), empty);

        // Порченый поток (не обрыв, а ошибка формата) — отказ, а не нули.
        for garbage in [&[0xff; 4][..], &[7, 0], &[0xff], &[1, 2, 3, 4, 5, 6, 7, 8]] {
            assert_eq!(refused(garbage), empty, "{garbage:02x?}");
        }
        // Оборванный поток годится, пока он не порчен.
        let cut = parse_body(0xa002_0000, &[0]).unwrap();
        assert_eq!((cut.len(), cut.complete), (2, false));

        let stored = octets("1 4 0 0xfb 0xff 9 9 9 9");
        let r = parse_body(0xa002_0000, &stored).unwrap();
        assert_eq!(r.data(), &[9, 9, 9, 9]);
        assert!(!r.complete);

        // Поток, обёрнутый в zlib, для сырого deflate — порча.
        let zlib = octets("0x78 0x9c 0x4b 0x4c 0x4a 0x06 0x00 0x02 0x4d 0x01 0x27");
        assert_eq!(refused(&zlib), empty);
    }

    #[test]
    fn parse_truncated_and_oversized() {
        let full = deflate_zlib9(&pattern());
        assert_eq!(full.len(), 347);
        let r = parse_body(0xa002_0000, &full[..173]).unwrap();
        assert_eq!(r.len(), 346);
        assert!(!r.complete);
        assert_eq!(
            &r.data()[..8],
            octets("3 0x0a 0x11 0x18 0x1f 0x26 0x2d 0x34")
        );

        let big = deflate_zlib9(&vec![5u8; 0x5000]);
        let r = parse_body(0xa002_0000, &big).unwrap();
        assert_eq!((r.len(), r.complete), (8192, true));

        let r = parse_body(0xa000_0000, &deflate_zlib9(&[1, 2, 3, 4])).unwrap();
        assert_eq!((r.len(), r.complete), (1, true));

        let mut tail = sample_file();
        tail.extend_from_slice(&[1, 2, 3]);
        let r = Resource::parse(&tail).unwrap();
        assert_eq!((r.len(), r.complete), (8192, true));
    }

    #[test]
    fn edit_and_rebuild() {
        let mut r = Resource::parse(&sample_file()).unwrap();
        r.data_mut()[0] = 99;
        r.data_mut().push(1);
        assert_eq!((r.len(), r.complete), (8193, true));

        let header = read_header(&file(1, 0xa002_0000, 0x5002_0000, &[])).unwrap();
        let empty = Resource::from_parts(header, vec![]);
        assert_eq!(
            empty.to_file_bytes().unwrap(),
            octets("0x52 0x53 0x43 0x37 1 0 0 0 0 0 2 0xa0 0 0 2 0x50 3 0")
        );
        let shown = format!("{:?}", Resource::from_parts(header, vec![1, 2]));
        assert!(shown.starts_with("Resource { data: [1, 2], header: Header { system_flags: 2684"));
        assert!(shown.ends_with("complete: false }"));
    }

    #[test]
    fn deflate_reference_values() {
        let small: [(&[u8], &str); 3] = [
            (&[], "3 0"),
            (b"abc", "0x4b 0x4c 0x4a 0x06 0"),
            (&[0; 100], "0x63 0x60 0xa0 0x3d 0 0"),
        ];
        for (input, packed) in small {
            assert_eq!(deflate_zlib9(input), octets(packed));
        }

        let noise = {
            let mut x = 0x1234_5678u32;
            let mut next = || {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x >> 24) as u8
            };
            (0..20000).map(|_| next()).collect::<Vec<u8>>()
        };
        let sawtooth: Vec<u8> = (0..65536u32).map(|i| (i % 251) as u8).collect();
        let phrase = "Resource packing for the rage engine, tile 0123456789. ".repeat(300);
        let cases: [(Vec<u8>, usize, &str); 5] = [
            (
                pattern(),
                347,
                "626da34ec9b968f02287bf3fc7f88736326da16d2b53286aa23c09914a07929a",
            ),
            (
                sawtooth,
                573,
                "e556641f1df05bfa2ece11f1fd4c57af60a3ee2d97d5c456b96cb53ca7e0edda",
            ),
            (
                phrase.into_bytes(),
                121,
                "68baec91db782ff0fa941953831b4d65b2a62e959b5ebf3d33a108cac6403b24",
            ),
            (
                noise,
                20010,
                "090a9a8f982f7bc3d1eeb2402a6a8e3f2eda2eb9669620d7cfe6c191ccce7051",
            ),
            (
                vec![0; 70000],
                85,
                "5de73a93ed1d02e62a25d5f5bb9927bb9563ea9c2ba2dc32d78e45a323bc7b38",
            ),
        ];
        for (input, size, digest) in cases {
            let out = deflate_zlib9(&input);
            assert_eq!((out.len(), hex(&out).as_str()), (size, digest));
        }
    }

    #[test]
    fn a_pointer_that_overflows_the_offset_is_refused() {
        // Системная область 0x6000_0005 байт: графический указатель у верхней границы u64
        // давал переполнение суммы (паника в debug, в release обёртка в смещение 4).
        let header = Header {
            system_flags: 0,
            graphics_flags: 0,
            system_size: 0x6000_0005,
            graphics_size: 0,
            version: 0,
            declared_version: 0,
        };
        let res = Resource::from_parts(header, vec![0; 16]);
        assert_eq!(res.at(u64::MAX), None);
        assert_eq!(res.at(u64::MAX - 1), None);
        assert_eq!(res.at(GRAPHICS_BASE), None);
        assert_eq!(res.at(SYSTEM_BASE + 4), Some(4));
    }
}
