//! Текстуры, зашитые в модель игры: чтение их описаний и правка прямо в байтах
//! ресурса, без пересборки модели.

use std::{collections::HashSet, ops::Range};

use rage_res::{
    resource::{is_resource, Resource, HEADER_BYTES},
    texture::Format,
};

use crate::error::{EngineError, Result};

/// Запись с открытыми полями: атрибуты и пары «имя, тип» задаёт вызов.
/// `Eq` объявляется отдельно от остальных свойств.
macro_rules! open_record {
    ($(#[$attr:meta])* $name:ident { $(($field:ident, $kind:ty)),+ $(,)? }) => {
        $(#[$attr])*
        pub struct $name {
            $(pub $field: $kind),+
        }

        impl Eq for $name {}
    };
}

/// Перечисление без данных, как задаёт вызов.
macro_rules! open_enum {
    ($(#[$attr:meta])* $name:ident { $($variant:ident),+ $(,)? }) => {
        $(#[$attr])*
        pub enum $name {
            $($variant),+
        }

        impl Eq for $name {}
        impl Copy for $name {}
    };
}

open_enum! {
    #[derive(Debug, Clone, PartialEq)]
    Kind { Ydr, Ydd, Yft }
}

open_record! {
    #[derive(Debug, Clone, PartialEq)]
    Texture {
        (name, String),
        (object, usize),
        (data_pointer, u64),
        (width, u16),
        (height, u16),
        (stride, u16),
        (levels, u8),
        (format, Format),
        (data_at, usize),
        (payload_len, usize),
    }
}

open_record! {
    #[derive(Debug, Clone, PartialEq)]
    Change {
        (texture, Texture),
        (width, u16),
        (height, u16),
        (stride, u16),
        (levels, u8),
        (format, Format),
        (payload, Vec<u8>),
    }
}

/// Смещение указателя или счётчика у вложенных структур ресурса.
#[derive(Clone, Copy)]
struct Link(usize);

impl Link {
    const FRAGMENT_DRAWABLE: Link = Link(0x30);
    const DRAWABLE_SHADERS: Link = Link(0x10);
    const SHADERS_TEXTURES: Link = Link(0x08);
    const DICTIONARY_LIST: Link = Link(0x30);
    const DICTIONARY_COUNT: Link = Link(0x38);
}

/// Смещения структур внутри ресурса.
type Offsets = Vec<usize>;

/// Поля описания текстуры; число — смещение от начала описания.
#[derive(Clone, Copy)]
enum Slot {
    Name = 0x28,
    Width = 0x50,
    Height = 0x52,
    Stride = 0x56,
    Format = 0x58,
    Levels = 0x5D,
    Data = 0x70,
}

impl Slot {
    /// Описание целиком занимает столько байт от своего начала.
    const SPAN: usize = 0x78;
    /// Описания в системной части стоят на границах по 8 байт.
    const ALIGN: usize = 8;

    fn at(self, object: usize) -> usize {
        object + self as usize
    }
}

/// Числовые поля описания и их размер в байтах, в порядке чтения.
const SCALARS: [(Slot, usize); 5] = [
    (Slot::Width, 2),
    (Slot::Height, 2),
    (Slot::Stride, 2),
    (Slot::Format, 4),
    (Slot::Levels, 1),
];

/// Число из байтов, младший первый.
fn little_endian(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .rev()
        .fold(0, |acc, &byte| (acc << 8) | u64::from(byte))
}

/// Чтение ресурса модели: переходы по указателям и числа в описаниях.
struct Walk<'a>(&'a Resource);

impl Walk<'_> {
    /// Следующая структура по указателю, лежащему на `from + link`.
    fn hop(&self, from: usize, link: Link) -> Option<usize> {
        self.0.pointer_at(from + link.0)
    }

    /// Счётчик записей рядом со списком указателей.
    fn count_in(&self, holder: usize) -> Result<usize> {
        let at = holder + Link::DICTIONARY_COUNT.0;
        Ok(usize::from(self.0.u16(at)?))
    }

    /// Годные указатели из `count` записей по 8 байт; негодные пропускаются.
    fn entries(&self, list: usize, count: usize) -> Offsets {
        (0..count)
            .filter_map(|i| self.0.pointer_at(list + 8 * i))
            .collect()
    }

    /// Смещения рисовалок, в которых надо искать текстуры.
    fn drawables(&self, kind: Kind) -> Result<Offsets> {
        let root = self
            .0
            .root()
            .ok_or_else(|| EngineError::invalid_data("корень модели недоступен"))?;
        Ok(match kind {
            Kind::Ydr => vec![root],
            Kind::Yft => self
                .hop(root, Link::FRAGMENT_DRAWABLE)
                .into_iter()
                .collect(),
            Kind::Ydd => {
                let count = self.count_in(root)?;
                let list = self.hop(root, Link::DICTIONARY_LIST);
                list.map(|list| self.entries(list, count))
                    .unwrap_or_default()
            }
        })
    }

    /// Смещения описаний текстур одной рисовалки; без цепочки указателей их нет.
    fn descriptions(&self, drawable: usize) -> Result<Offsets> {
        let dictionary = self
            .hop(drawable, Link::DRAWABLE_SHADERS)
            .and_then(|shaders| self.hop(shaders, Link::SHADERS_TEXTURES));
        let chain = dictionary.and_then(|at| Some((at, self.hop(at, Link::DICTIONARY_LIST)?)));
        match chain {
            Some((dictionary, list)) => Ok(self.entries(list, self.count_in(dictionary)?)),
            None => Ok(Vec::new()),
        }
    }

    fn texture(&self, object: usize) -> Result<Texture> {
        let res = self.0;
        let name = res
            .cstring(res.u64(Slot::Name.at(object))?)
            .ok_or_else(|| EngineError::invalid_data("у текстуры нет имени"))?;
        let values = SCALARS
            .iter()
            .map(|&(slot, size)| Ok(little_endian(res.bytes(slot.at(object), size)?)))
            .collect::<Result<Vec<u64>>>()?;
        let [width, height, stride, code, levels] =
            <[u64; 5]>::try_from(values).expect("пять числовых полей");
        let format = Format::from_code(code as u32).ok_or_else(|| {
            EngineError::invalid_data(format!("текстура {name}: формат 0x{code:x} не поддержан"))
        })?;
        let data_pointer = res.u64(Slot::Data.at(object))?;
        let data_at = match res.at(data_pointer) {
            Some(at) => at,
            None => {
                return Err(EngineError::invalid_data(format!(
                    "текстура {name} без данных"
                )));
            }
        };
        let payload_len = rage_res::ytd_write::payload_bytes(
            format,
            usize::from(width as u16),
            usize::from(height as u16),
            usize::from(levels as u8),
        );
        Ok(Texture {
            name,
            object,
            data_pointer,
            width: width as u16,
            height: height as u16,
            stride: stride as u16,
            levels: levels as u8,
            format,
            data_at,
            payload_len,
        })
    }
}

/// Текстуры модели в порядке обхода. Одно описание дважды не берётся; любая
/// ошибка чтения отменяет весь список.
pub fn embedded_textures(res: &Resource, kind: Kind) -> Result<Vec<Texture>> {
    let mut seen = HashSet::new();
    let walk = Walk(res);
    walk.drawables(kind)?
        .into_iter()
        .try_fold(Vec::new(), |mut found, drawable| {
            for object in walk
                .descriptions(drawable)?
                .into_iter()
                .filter(|&at| seen.insert(at))
            {
                found.push(walk.texture(object)?);
            }
            Ok(found)
        })
}

impl Texture {
    /// Где лежат данные текстуры в теле ресурса.
    fn data_range(&self) -> Option<Range<usize>> {
        Some(self.data_at..self.data_at.checked_add(self.payload_len)?)
    }

    /// Числовые поля описания в порядке `SCALARS`.
    fn scalars(&self) -> [u64; 5] {
        [
            self.width.into(),
            self.height.into(),
            self.stride.into(),
            self.format.code().into(),
            self.levels.into(),
        ]
    }

    /// Стоит ли в теле на смещении `at` описание с теми же числовыми полями.
    fn is_described_at(&self, body: &[u8], at: usize) -> bool {
        SCALARS
            .iter()
            .zip(self.scalars())
            .all(|(&(slot, size), want)| {
                let from = slot.at(at);
                little_endian(&body[from..from + size]) == want
            })
    }
}

impl Change {
    /// Новые числовые поля в порядке `SCALARS`.
    fn scalars(&self) -> [u64; 5] {
        [
            self.width.into(),
            self.height.into(),
            self.stride.into(),
            self.format.code().into(),
            self.levels.into(),
        ]
    }

    /// Правка ничего не меняет: поля те же, а данные уже лежат на месте.
    fn changes_nothing(&self, body: &[u8], range: &Range<usize>) -> bool {
        let old = &self.texture;
        body[range.clone()] == self.payload[..] && self.scalars() == old.scalars()
    }

    /// Пишет новые поля в описание на `at`, а данные — туда, где они лежали
    /// раньше; остаток прежней длины зануляется.
    fn write_at(&self, body: &mut [u8], at: usize) {
        for (&(slot, size), value) in SCALARS.iter().zip(self.scalars()) {
            let from = slot.at(at);
            body[from..from + size].copy_from_slice(&value.to_le_bytes()[..size]);
        }
        let old = &self.texture;
        let region = &mut body[old.data_at..old.data_at + old.payload_len];
        region.fill(0);
        region[..self.payload.len()].copy_from_slice(&self.payload);
    }
}

/// Распакованное тело ресурса и размер его системной части.
struct Body<'a> {
    bytes: &'a [u8],
    system: usize,
}

impl<'a> Body<'a> {
    /// Тело годится для правки, только если системная часть не пуста и обе части на месте.
    fn of(res: &'a Resource) -> Option<Body<'a>> {
        let head = &res.header;
        let bytes = res.data();
        (head.system_size > 0 && bytes.len() >= head.system_size + head.graphics_size).then_some(
            Body {
                bytes,
                system: head.system_size,
            },
        )
    }

    /// Правки, которые что-то меняют. `None`, если какая-то правка не лезет в
    /// данные или менять нечего.
    fn pending<'c>(&self, changes: &'c [Change]) -> Option<Vec<&'c Change>> {
        let mut placed = Vec::with_capacity(changes.len());
        for change in changes {
            let range = change.texture.data_range()?;
            if change.payload.len() > change.texture.payload_len || range.end > self.bytes.len() {
                return None;
            }
            placed.push((change, range));
        }
        let pending: Vec<&Change> = placed
            .into_iter()
            .filter(|(change, range)| !change.changes_nothing(self.bytes, range))
            .map(|(change, _)| change)
            .collect();
        (!pending.is_empty()).then_some(pending)
    }

    /// Место описания каждой правки в системной части: ровно одно подходящее на правку.
    fn locate(&self, changes: &[&Change]) -> Option<Vec<usize>> {
        let positions = || {
            (0..)
                .step_by(Slot::ALIGN)
                .take_while(|at| at + Slot::SPAN <= self.system)
        };
        let distinct: HashSet<u64> = changes.iter().map(|c| c.texture.data_pointer).collect();
        if distinct.len() < changes.len() {
            return None;
        }
        changes
            .iter()
            .map(|change| {
                let mut hits = positions().filter(|&at| {
                    let from = Slot::Data.at(at);
                    little_endian(&self.bytes[from..from + 8]) == change.texture.data_pointer
                        && change.texture.is_described_at(self.bytes, at)
                });
                let first = hits.next()?;
                hits.next().is_none().then_some(first)
            })
            .collect()
    }
}

/// Записывает новые поля и данные текстур на их прежние места и собирает файл
/// заново: заголовок прежний, тело сжато заново. `None` на любую невозможность.
pub fn patch_in_place(original: &[u8], changes: &[Change]) -> Option<Vec<u8>> {
    let (head, rest) = original.split_first_chunk::<HEADER_BYTES>()?;
    let readable = !rest.is_empty() && is_resource(original);
    let res = readable.then(|| Resource::parse(original).ok()).flatten()?;
    let body = Body::of(&res)?;
    let pending = body.pending(changes)?;
    let spots = body.locate(&pending)?;

    let mut patched = body.bytes.to_vec();
    pending
        .iter()
        .zip(spots)
        .for_each(|(change, at)| change.write_at(&mut patched, at));
    // Как у остальных писателей: сырой deflate уровня 9 (libdeflate), файл не больше хостового.
    let packed = rage_res::meta_graph::deflate_body(&patched);
    Some([&head[..], &packed[..]].concat())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_res::resource::Header;

    const DESC_NAME: usize = Slot::Name as usize;
    const DESC_WIDTH: usize = Slot::Width as usize;
    const DESC_HEIGHT: usize = Slot::Height as usize;
    const DESC_STRIDE: usize = Slot::Stride as usize;
    const DESC_FORMAT: usize = Slot::Format as usize;
    const DESC_LEVELS: usize = Slot::Levels as usize;
    const DESC_DATA: usize = Slot::Data as usize;
    const DESC_SPAN: usize = Slot::SPAN;

    const SYSTEM: u64 = 0x5000_0000;
    const GRAPHICS: u64 = 0x6000_0000;
    const DXT1_CODE: u32 = 0x3154_5844;

    fn put16(body: &mut [u8], at: usize, value: u16) {
        body[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put32(body: &mut [u8], at: usize, value: u32) {
        body[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn put64(body: &mut [u8], at: usize, value: u64) {
        body[at..at + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn header() -> Header {
        Header {
            system_flags: 0xA800_0004,
            graphics_flags: 0x5800_0004,
            system_size: 0x2000,
            graphics_size: 0x2000,
            version: 165,
            declared_version: 0xFFFF_FFFF,
        }
    }

    /// Тело в 16384 байт: шум в обеих частях, служебная область системной части обнулена.
    fn noise() -> Vec<u8> {
        let mut body = vec![0u8; 0x4000];
        for i in 0..0x2000usize {
            body[i] = ((7 * i + 3) % 251) as u8;
            body[0x2000 + i] = ((13 * i + 1) % 253) as u8;
        }
        body[..0xC00].fill(0);
        body[0x1000..0x1040].fill(0);
        body
    }

    /// Описание текстуры по смещению `at`: сначала весь блок обнуляется.
    #[allow(clippy::too_many_arguments)]
    fn describe(
        body: &mut [u8],
        at: usize,
        name_at: u64,
        w: u16,
        h: u16,
        stride: u16,
        code: u32,
        levels: u8,
        data: u64,
    ) {
        body[at..at + DESC_SPAN].fill(0);
        put64(body, at + DESC_NAME, name_at);
        put16(body, at + DESC_WIDTH, w);
        put16(body, at + DESC_HEIGHT, h);
        put16(body, at + DESC_STRIDE, stride);
        put32(body, at + DESC_FORMAT, code);
        body[at + DESC_LEVELS] = levels;
        put64(body, at + DESC_DATA, data);
    }

    fn alpha_description(body: &mut [u8], at: usize) {
        describe(
            body,
            at,
            SYSTEM + 0x1000,
            64,
            64,
            32,
            DXT1_CODE,
            3,
            GRAPHICS,
        );
    }

    fn beta_description(body: &mut [u8], at: usize) {
        describe(
            body,
            at,
            SYSTEM + 0x1020,
            16,
            8,
            64,
            21,
            1,
            GRAPHICS + 0x1000,
        );
    }

    /// Образец M: рисовалка в корне, у неё одна группа, один словарь и два описания.
    fn sample() -> Vec<u8> {
        let mut body = noise();
        body[0x1000..0x100a].copy_from_slice(b"tex_alpha\0");
        body[0x1020..0x1029].copy_from_slice(b"tex_beta\0");
        put64(&mut body, 0x10, SYSTEM + 0x100);
        put64(&mut body, 0x108, SYSTEM + 0x200);
        put64(&mut body, 0x230, SYSTEM + 0x300);
        put16(&mut body, 0x238, 2);
        put64(&mut body, 0x300, SYSTEM + 0x400);
        put64(&mut body, 0x308, SYSTEM + 0x490);
        alpha_description(&mut body, 0x400);
        beta_description(&mut body, 0x490);
        body
    }

    fn alpha() -> Texture {
        Texture {
            name: "tex_alpha".to_owned(),
            object: 0x400,
            data_pointer: GRAPHICS,
            width: 64,
            height: 64,
            stride: 32,
            levels: 3,
            format: Format::Dxt1,
            data_at: 0x2000,
            payload_len: 2688,
        }
    }

    fn beta() -> Texture {
        Texture {
            name: "tex_beta".to_owned(),
            object: 0x490,
            data_pointer: GRAPHICS + 0x1000,
            width: 16,
            height: 8,
            stride: 64,
            levels: 1,
            format: Format::A8R8G8B8,
            data_at: 0x3000,
            payload_len: 512,
        }
    }

    fn resource(body: &[u8]) -> Resource {
        Resource::from_parts(header(), body.to_vec())
    }

    fn read(body: &[u8], kind: Kind) -> Result<Vec<Texture>> {
        embedded_textures(&resource(body), kind)
    }

    fn invalid(message: &str) -> EngineError {
        EngineError::invalid_data(message)
    }

    fn past_the_end() -> EngineError {
        EngineError::invalid_operation("Чтение за концом данных ресурса.")
    }

    fn file_of(body: &[u8]) -> Vec<u8> {
        resource(body).to_file_bytes().unwrap()
    }

    /// Фрагмент: рисовалка по указателю корня `+0x30`.
    fn as_fragment(body: &mut [u8]) {
        put64(body, 0x30, SYSTEM + 0x900);
        put64(body, 0x910, SYSTEM + 0x100);
    }

    /// Словарь моделей: массив указателей на рисовалки `0x900` и `0xA00`.
    fn as_dictionary(body: &mut [u8], entries: &[u64]) {
        put64(body, 0x30, SYSTEM + 0x800);
        put16(body, 0x38, entries.len() as u16);
        for (i, entry) in entries.iter().enumerate() {
            put64(body, 0x800 + 8 * i, *entry);
        }
        put64(body, 0x910, SYSTEM + 0x100);
        put64(body, 0xA10, SYSTEM + 0x100);
    }

    #[test]
    fn textures_are_read_from_drawables_dictionaries_and_fragments() {
        // Чт1 – Чт17, Вх2
        let model = sample();
        assert_eq!(read(&model, Kind::Ydr), Ok(vec![alpha(), beta()]));
        assert_eq!(read(&model, Kind::Yft), Ok(vec![]));
        assert_eq!(read(&model, Kind::Ydd), Ok(vec![]));

        let mut dictionary = sample();
        as_dictionary(&mut dictionary, &[SYSTEM + 0x900, SYSTEM + 0xA00, 0]);
        assert_eq!(read(&dictionary, Kind::Ydd), Ok(vec![alpha(), beta()]));

        // два словаря с одним именем: повтор по имени не убирается
        let mut twins = sample();
        as_dictionary(&mut twins, &[SYSTEM + 0x900, SYSTEM + 0xA00]);
        put64(&mut twins, 0xA10, SYSTEM + 0x140);
        put64(&mut twins, 0x148, SYSTEM + 0x280);
        put64(&mut twins, 0x2B0, SYSTEM + 0x340);
        put16(&mut twins, 0x2B8, 1);
        put64(&mut twins, 0x340, SYSTEM + 0x490);
        put64(&mut twins, 0x230, SYSTEM + 0x300);
        put16(&mut twins, 0x238, 1);
        put64(&mut twins, 0x490 + DESC_NAME, SYSTEM + 0x1000);
        let same_name = Texture {
            name: "tex_alpha".to_owned(),
            ..beta()
        };
        assert_eq!(read(&twins, Kind::Ydd), Ok(vec![alpha(), same_name]));

        // указатель на тот же объект дважды
        let mut repeated = sample();
        put64(&mut repeated, 0x300, SYSTEM + 0x400);
        put64(&mut repeated, 0x308, SYSTEM + 0x400);
        put64(&mut repeated, 0x310, SYSTEM + 0x490);
        put16(&mut repeated, 0x238, 3);
        assert_eq!(read(&repeated, Kind::Ydr), Ok(vec![alpha(), beta()]));

        // число записей больше и меньше настоящего
        let mut more = sample();
        put16(&mut more, 0x238, 5);
        assert_eq!(read(&more, Kind::Ydr), Ok(vec![alpha(), beta()]));
        let mut fewer = sample();
        put16(&mut fewer, 0x238, 1);
        assert_eq!(read(&fewer, Kind::Ydr), Ok(vec![alpha()]));
        let mut none = sample();
        put16(&mut none, 0x238, 0);
        assert_eq!(read(&none, Kind::Ydr), Ok(vec![]));

        // обрыв цепочки указателей молча даёт пустой список
        for (at, value) in [(0x10, 0u64), (0x108, 0), (0x230, 0), (0x10, 0x1234)] {
            let mut broken = sample();
            put64(&mut broken, at, value);
            assert_eq!(read(&broken, Kind::Ydr), Ok(vec![]), "{at:#x} {value:#x}");
        }

        // негодные записи списка пропускаются
        for skipped in [0u64, SYSTEM + 0x10_0000] {
            let mut gap = sample();
            put64(&mut gap, 0x300, skipped);
            assert_eq!(read(&gap, Kind::Ydr), Ok(vec![beta()]), "{skipped:#x}");
        }

        let mut fragment = sample();
        as_fragment(&mut fragment);
        assert_eq!(read(&fragment, Kind::Yft), Ok(vec![alpha(), beta()]));
    }

    #[test]
    fn broken_descriptions_cancel_the_whole_list() {
        // Чо1 – Чо13
        let at = 0x400;
        let mut no_name = sample();
        put64(&mut no_name, at + DESC_NAME, 0);
        assert_eq!(
            read(&no_name, Kind::Ydr),
            Err(invalid("у текстуры нет имени"))
        );
        let mut far_name = sample();
        put64(&mut far_name, at + DESC_NAME, SYSTEM + 0x10_0000);
        assert_eq!(
            read(&far_name, Kind::Ydr),
            Err(invalid("у текстуры нет имени"))
        );

        let mut odd_format = sample();
        put32(&mut odd_format, at + DESC_FORMAT, 0x1234_5678);
        assert_eq!(
            read(&odd_format, Kind::Ydr),
            Err(invalid(
                "текстура tex_alpha: формат 0x12345678 не поддержан"
            ))
        );
        put32(&mut odd_format, at + DESC_FORMAT, 0);
        assert_eq!(
            read(&odd_format, Kind::Ydr),
            Err(invalid("текстура tex_alpha: формат 0x0 не поддержан"))
        );

        let pointer_cases: [(u64, Option<usize>); 5] = [
            (0, None),
            (GRAPHICS + 0x2000, None),
            (0x1000, None),
            (GRAPHICS + 0x1FFF, Some(0x3FFF)),
            (SYSTEM + 0x1800, Some(0x1800)),
        ];
        for (pointer, data_at) in pointer_cases {
            let mut model = sample();
            put64(&mut model, at + DESC_DATA, pointer);
            match data_at {
                None => assert_eq!(
                    read(&model, Kind::Ydr),
                    Err(invalid("текстура tex_alpha без данных")),
                    "{pointer:#x}"
                ),
                Some(found) => {
                    let first = read(&model, Kind::Ydr).unwrap().remove(0);
                    let expected = Texture {
                        data_pointer: pointer,
                        data_at: found,
                        ..alpha()
                    };
                    assert_eq!(first, expected, "{pointer:#x}");
                }
            }
        }

        let mut empty = sample();
        empty[0x1000] = 0;
        assert_eq!(read(&empty, Kind::Ydr).unwrap()[0].name, "");
        let mut long = sample();
        long[0x1000..0x1000 + 300].fill(b'n');
        assert_eq!(read(&long, Kind::Ydr).unwrap()[0].name, "n".repeat(256));
        let mut lossy = sample();
        lossy[0x1000..0x1005].copy_from_slice(&[0xD0, 0xBF, 0xFF, 0x41, 0]);
        let name = read(&lossy, Kind::Ydr).unwrap()[0].name.clone();
        assert_eq!((name.as_str(), name.len()), ("п\u{fffd}A", 6));
        let mut open_ended = sample();
        open_ended[0x1F00..0x2000].fill(b'q');
        put64(&mut open_ended, at + DESC_NAME, SYSTEM + 0x1F00);
        assert_eq!(
            read(&open_ended, Kind::Ydr).unwrap()[0].name,
            "q".repeat(256)
        );
    }

    #[test]
    fn short_or_missing_bodies_give_read_errors() {
        // Чо14 – Чо18
        let mut tight = sample();
        tight.truncate(0x400);
        put64(&mut tight, 0x108, SYSTEM + 0x3C7);
        put64(&mut tight, 0x3C7 + 0x30, SYSTEM + 0x300);
        assert_eq!(read(&tight, Kind::Ydr), Err(past_the_end()));

        let hollow = Resource::from_parts(header(), Vec::new());
        assert_eq!(
            embedded_textures(&hollow, Kind::Ydr),
            Err(invalid("корень модели недоступен"))
        );
        let tiny = vec![0u8; 0x20];
        assert_eq!(read(&tiny, Kind::Ydd), Err(past_the_end()));
        assert_eq!(read(&tiny, Kind::Yft), Ok(vec![]));
        assert_eq!(read(&tiny, Kind::Ydr), Ok(vec![]));
    }

    #[test]
    fn odd_sizes_are_reported_as_they_are() {
        // Чр1 – Чр7
        type Odd = (&'static str, u16, u16, u16, u32, u8, Format, usize);
        let cases: [Odd; 7] = [
            ("Чр1", 0, 64, 0, DXT1_CODE, 3, Format::Dxt1, 224),
            ("Чр2", 64, 64, 32, DXT1_CODE, 0, Format::Dxt1, 0),
            ("Чр3", 64, 64, 32, DXT1_CODE, 12, Format::Dxt1, 2784),
            ("Чр4", 16, 8, 64, 0x15, 4, Format::A8R8G8B8, 680),
            ("Чр5", 5, 5, 8, 0x2037_4342, 2, Format::Bc7, 80),
            ("Чр6", 3, 3, 3, 0x32, 3, Format::L8, 11),
            (
                "Чр7",
                65535,
                65535,
                0,
                0x3554_5844,
                1,
                Format::Dxt5,
                4_294_967_296,
            ),
        ];
        for (label, w, h, stride, code, levels, format, len) in cases {
            let mut model = sample();
            describe(
                &mut model,
                0x400,
                SYSTEM + 0x1000,
                w,
                h,
                stride,
                code,
                levels,
                GRAPHICS,
            );
            let first = read(&model, Kind::Ydr).unwrap().remove(0);
            let expected = Texture {
                width: w,
                height: h,
                stride,
                levels,
                format,
                payload_len: len,
                ..alpha()
            };
            assert_eq!(first, expected, "{label}");
        }
        // Чр8, Чр9: сдвиг на 64 и больше (расчёт размера у rage_res с 05.11 не падает и не заворачивает сдвиг)
        let shifted: [(u16, u32, u8, usize); 2] = [(64, DXT1_CODE, 70, 3248), (4, 0x32, 255, 273)];
        for (side, code, levels, len) in shifted {
            let mut model = sample();
            describe(
                &mut model,
                0x400,
                SYSTEM + 0x1000,
                side,
                side,
                side / 2,
                code,
                levels,
                GRAPHICS,
            );
            assert_eq!(read(&model, Kind::Ydr).unwrap().remove(0).payload_len, len);
        }
    }

    #[test]
    fn synthetic_variants_with_copies_and_far_descriptions() {
        // Вх3, Вх4
        let mut copy = sample();
        alpha_description(&mut copy, 0x520);
        put64(&mut copy, 0x310, SYSTEM + 0x520);
        put16(&mut copy, 0x238, 3);
        let textures = read(&copy, Kind::Ydr).unwrap();
        assert_eq!(textures.len(), 3);
        assert_eq!(
            textures[2],
            Texture {
                object: 0x520,
                ..alpha()
            }
        );

        let mut far = sample();
        beta_description(&mut far, 0x1F90);
        put64(&mut far, 0x1F90 + DESC_NAME, SYSTEM + 0x1000);
        put64(&mut far, 0x308, SYSTEM + 0x1F90);
        let textures = read(&far, Kind::Ydr).unwrap();
        assert_eq!(
            textures[1],
            Texture {
                name: "tex_alpha".to_owned(),
                object: 0x1F90,
                ..beta()
            }
        );
    }

    fn pat(n: usize, k: usize) -> Vec<u8> {
        (0..n).map(|i| ((3 * i + k) % 256) as u8).collect()
    }

    fn change(
        texture: &Texture,
        w: u16,
        h: u16,
        stride: u16,
        levels: u8,
        format: Format,
        payload: Vec<u8>,
    ) -> Change {
        Change {
            texture: texture.clone(),
            width: w,
            height: h,
            stride,
            levels,
            format,
            payload,
        }
    }

    fn a_to_small(payload: Vec<u8>) -> Change {
        change(&alpha(), 32, 32, 16, 2, Format::Dxt1, payload)
    }

    /// Заголовок и распакованное тело результата.
    fn unpack(file: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let res = Resource::parse(file).unwrap();
        (file[..HEADER_BYTES].to_vec(), res.data().to_vec())
    }

    /// Непрерывные участки различий между двумя телами, включительно.
    fn ranges(before: &[u8], after: &[u8]) -> Vec<(usize, usize)> {
        assert_eq!(before.len(), after.len());
        let mut found: Vec<(usize, usize)> = Vec::new();
        for (at, (a, b)) in before.iter().zip(after).enumerate() {
            if a == b {
                continue;
            }
            match found.last_mut() {
                Some(last) if last.1 + 1 == at => last.1 = at,
                _ => found.push((at, at)),
            }
        }
        found
    }

    fn patch(file: &[u8], changes: &[Change]) -> Option<(Vec<u8>, Vec<u8>)> {
        patch_in_place(file, changes).map(|out| unpack(&out))
    }

    #[test]
    fn a_patch_rewrites_fields_and_data_in_place() {
        // Пр1 – Пр8
        let body = sample();
        let file = file_of(&body);
        let (header_before, _) = unpack(&file);

        let (header_after, after) = patch(&file, &[a_to_small(pat(640, 1))]).unwrap();
        assert_eq!(header_after, header_before);
        assert_eq!(after.len(), 0x4000);
        let diffs = ranges(&body, &after);
        let fields: Vec<_> = diffs.iter().filter(|r| r.0 < 0x2000).copied().collect();
        assert_eq!(
            fields,
            vec![
                (0x450, 0x450),
                (0x452, 0x452),
                (0x456, 0x456),
                (0x45D, 0x45D)
            ]
        );
        assert!(diffs
            .iter()
            .all(|r| r.0 < 0x2000 || (r.0 >= 0x2000 && r.1 < 0x2000 + 2688)));
        assert_eq!(&after[0x2000..0x2000 + 640], &pat(640, 1)[..]);
        assert!(after[0x2000 + 640..0x2000 + 2688].iter().all(|&b| b == 0));
        assert_eq!(&after[0x2000 + 2688..], &body[0x2000 + 2688..]);

        // A и B в любом порядке
        let b_change = change(&beta(), 4, 2, 16, 1, Format::A8R8G8B8, pat(32, 2));
        let forward = patch_in_place(&file, &[a_to_small(pat(640, 1)), b_change.clone()]).unwrap();
        let backward = patch_in_place(&file, &[b_change.clone(), a_to_small(pat(640, 1))]).unwrap();
        assert_eq!(forward, backward);
        let (_, both) = unpack(&forward);
        let both_fields: Vec<_> = ranges(&body, &both)
            .into_iter()
            .filter(|r| r.0 < 0x2000)
            .collect();
        assert_eq!(both_fields.len(), 7);
        assert_eq!(&both[0x3000..0x3020], &pat(32, 2)[..]);
        assert!(both[0x3020..0x3200].iter().all(|&b| b == 0));

        // новые данные той же длины: описание не меняется
        let same_fields = change(&alpha(), 64, 64, 32, 3, Format::Dxt1, pat(2688, 5));
        let (_, rewritten) = patch(&file, &[same_fields]).unwrap();
        assert!(ranges(&body, &rewritten).iter().all(|r| r.0 >= 0x2000));
        assert_eq!(&rewritten[0x2000..0x2000 + 2688], &pat(2688, 5)[..]);

        // прежние данные, новое описание
        let original_data = body[0x2000..0x2000 + 2688].to_vec();
        let (_, fields_only) = patch(&file, &[a_to_small(original_data)]).unwrap();
        let fields_only_diff = ranges(&body, &fields_only);
        assert_eq!(
            fields_only_diff,
            vec![
                (0x450, 0x450),
                (0x452, 0x452),
                (0x456, 0x456),
                (0x45D, 0x45D)
            ]
        );

        // неизменная правка выпадает, остальные пишутся
        let keep = change(
            &alpha(),
            64,
            64,
            32,
            3,
            Format::Dxt1,
            body[0x2000..0x2000 + 2688].to_vec(),
        );
        let (_, only_b) = patch(&file, &[keep, b_change]).unwrap();
        assert!(ranges(&body, &only_b)
            .iter()
            .all(|r| r.0 >= 0x2000 + 2688 || (0x450..0x4F0).contains(&r.0)));
        assert_eq!(&only_b[0x2000..0x2000 + 2688], &body[0x2000..0x2000 + 2688]);

        // данные короче и пустые: остаток зануляется
        for len in [100usize, 0] {
            let (_, shorter) = patch(
                &file,
                &[change(&alpha(), 64, 64, 32, 3, Format::Dxt1, pat(len, 0))],
            )
            .unwrap();
            assert_eq!(&shorter[0x2000..0x2000 + len], &pat(len, 0)[..]);
            assert!(shorter[0x2000 + len..0x2000 + 2688].iter().all(|&b| b == 0));
            assert!(ranges(&body, &shorter).iter().all(|r| r.0 >= 0x2000));
        }
    }

    #[test]
    fn a_patch_trusts_the_change_and_not_the_names() {
        // Пр9 – Пр13
        let body = sample();
        let file = file_of(&body);
        let reference = patch_in_place(&file, &[a_to_small(pat(640, 1))]).unwrap();
        let renamed = Texture {
            name: "other".to_owned(),
            object: 0x1234,
            ..alpha()
        };
        let by_pointer = change(&renamed, 32, 32, 16, 2, Format::Dxt1, pat(640, 1));
        assert_eq!(patch_in_place(&file, &[by_pointer]).unwrap(), reference);

        // длина зануляемого остатка берётся из правки, а не из файла
        let long_tail = Texture {
            payload_len: 3000,
            ..alpha()
        };
        let wide = change(&long_tail, 32, 32, 16, 2, Format::Dxt1, pat(640, 1));
        let (_, widened) = patch(&file, &[wide]).unwrap();
        assert!(widened[0x2000 + 640..0x2000 + 3000].iter().all(|&b| b == 0));
        assert!(widened[0x2000 + 2688..0x2000 + 3000]
            .iter()
            .all(|&b| b == 0));
        assert!(body[0x2000 + 2688..0x2000 + 3000].iter().any(|&b| b != 0));

        // данные пишутся по `data_at` правки
        let moved = Texture {
            data_at: 0x2800,
            ..alpha()
        };
        let elsewhere = change(&moved, 32, 32, 16, 2, Format::Dxt1, pat(640, 1));
        let (_, shifted) = patch(&file, &[elsewhere]).unwrap();
        assert_eq!(&shifted[0x2800..0x2800 + 640], &pat(640, 1)[..]);
        assert_eq!(&shifted[0x2000..0x2800], &body[0x2000..0x2800]);

        // новое состояние не проверяется
        let zero = change(&alpha(), 0, 0, 0, 0, Format::L8, pat(10, 0));
        let (_, zeroed) = patch(&file, &[zero]).unwrap();
        let zero_fields: Vec<_> = ranges(&body, &zeroed)
            .into_iter()
            .filter(|r| r.0 < 0x2000)
            .collect();
        assert_eq!(
            zero_fields,
            vec![
                (0x450, 0x450),
                (0x452, 0x452),
                (0x456, 0x456),
                (0x458, 0x45B),
                (0x45D, 0x45D)
            ]
        );
        let huge = change(&alpha(), 65535, 65535, 65535, 255, Format::Bc7, pat(10, 0));
        let (_, extreme) = patch(&file, &[huge]).unwrap();
        let extreme_fields: Vec<_> = ranges(&body, &extreme)
            .into_iter()
            .filter(|r| r.0 < 0x2000)
            .collect();
        assert_eq!(
            extreme_fields,
            vec![(0x450, 0x453), (0x456, 0x45B), (0x45D, 0x45D)]
        );
    }

    #[test]
    fn a_patched_file_reads_back_and_is_deterministic() {
        // Пр14, Пр21 – Пр24
        let body = sample();
        let file = file_of(&body);
        let bc7 = change(&alpha(), 32, 32, 16, 2, Format::Bc7, pat(640, 1));
        let out = patch_in_place(&file, &[bc7]).unwrap();
        let reopened = Resource::parse(&out).unwrap();
        let first = embedded_textures(&reopened, Kind::Ydr).unwrap().remove(0);
        assert_eq!(
            first,
            Texture {
                width: 32,
                height: 32,
                stride: 16,
                levels: 2,
                format: Format::Bc7,
                payload_len: 1280,
                ..alpha()
            }
        );

        // тело всегда собирается заново сырым deflate уровня 9 (libdeflate, как у остальных писателей) и не больше прежнего уровня 6
        let (header_before, unpacked) = unpack(&out);
        let mut expected = header_before;
        expected.extend(rage_res::meta_graph::deflate_body(&unpacked));
        assert_eq!(out, expected);
        assert!(out.len() <= HEADER_BYTES + miniz_oxide::deflate::compress_to_vec(&unpacked, 6).len());

        // второй проход поверх первого и повтор того же прохода
        let first_pass = patch_in_place(&file, &[a_to_small(pat(640, 1))]).unwrap();
        let smaller = Texture {
            width: 32,
            height: 32,
            stride: 16,
            levels: 2,
            payload_len: 640,
            ..alpha()
        };
        let second = change(&smaller, 16, 16, 8, 1, Format::Dxt1, pat(128, 3));
        let (_, twice) = patch(&first_pass, &[second]).unwrap();
        assert_eq!(&twice[0x2000..0x2000 + 128], &pat(128, 3)[..]);
        assert_eq!(
            patch_in_place(&file, &[a_to_small(pat(640, 1))]).unwrap(),
            first_pass
        );
        // повтор правки на её же результате: менять нечего
        let repeat = change(&smaller, 32, 32, 16, 2, Format::Dxt1, pat(640, 1));
        assert_eq!(patch_in_place(&first_pass, &[repeat]), None);
    }

    #[test]
    fn descriptions_are_found_by_pointer_and_fields() {
        // Пр15 – Пр17, От13 – От15

        // копия с другим числом ступеней различима
        let mut near_copy = sample();
        describe(
            &mut near_copy,
            0x520,
            SYSTEM + 0x1000,
            64,
            64,
            32,
            DXT1_CODE,
            5,
            GRAPHICS,
        );
        let (_, patched) = patch(&file_of(&near_copy), &[a_to_small(pat(640, 1))]).unwrap();
        let fields: Vec<_> = ranges(&near_copy, &patched)
            .into_iter()
            .filter(|r| r.0 < 0x2000)
            .collect();
        assert_eq!(
            fields,
            vec![
                (0x450, 0x450),
                (0x452, 0x452),
                (0x456, 0x456),
                (0x45D, 0x45D)
            ]
        );

        // точная копия описания: неоднозначно
        let mut twin = sample();
        alpha_description(&mut twin, 0x520);
        assert_eq!(
            patch_in_place(&file_of(&twin), &[a_to_small(pat(640, 1))]),
            None
        );

        // B у самого края системной части и на границе по 8 байт
        let b_change = || change(&beta(), 4, 2, 16, 1, Format::A8R8G8B8, pat(32, 2));
        for (at, found) in [
            (0x1F88usize, true),
            (0x528, true),
            (0x1F90, false),
            (0x524, false),
        ] {
            let mut moved = sample();
            moved[0x490..0x490 + DESC_SPAN].fill(0);
            beta_description(&mut moved, at);
            put64(&mut moved, 0x308, SYSTEM + at as u64);
            let moved_file = file_of(&moved);
            let before = unpack(&moved_file).1;
            assert_eq!(read(&before, Kind::Ydr).unwrap()[1].object, at, "{at:#x}");
            match patch(&moved_file, &[b_change()]) {
                Some((_, after)) => {
                    assert!(found, "{at:#x}");
                    let fields: Vec<_> = ranges(&before, &after)
                        .into_iter()
                        .filter(|r| r.0 < 0x2000)
                        .collect();
                    assert_eq!(
                        fields,
                        vec![
                            (at + 0x50, at + 0x50),
                            (at + 0x52, at + 0x52),
                            (at + 0x56, at + 0x56)
                        ],
                        "{at:#x}"
                    );
                }
                None => assert!(!found, "{at:#x}"),
            }
        }
    }

    #[test]
    fn a_patch_refuses_what_it_cannot_do_exactly() {
        // От1 – От12
        let body = sample();
        let file = file_of(&body);
        let keep = || {
            change(
                &alpha(),
                64,
                64,
                32,
                3,
                Format::Dxt1,
                body[0x2000..0x2000 + 2688].to_vec(),
            )
        };
        assert_eq!(patch_in_place(&file, &[keep()]), None);
        assert_eq!(patch_in_place(&file, &[]), None);
        assert_eq!(patch_in_place(&file, &[a_to_small(pat(2689, 0))]), None);
        assert_eq!(
            patch_in_place(&file, &[keep(), a_to_small(pat(2689, 0))]),
            None
        );
        assert_eq!(
            patch_in_place(&file, &[a_to_small(pat(640, 1)), a_to_small(pat(640, 2))]),
            None
        );

        let wrong = |texture: Texture| change(&texture, 32, 32, 16, 2, Format::Dxt1, pat(640, 1));
        let mismatches = [
            Texture {
                width: 128,
                ..alpha()
            },
            Texture {
                height: 128,
                ..alpha()
            },
            Texture {
                stride: 99,
                ..alpha()
            },
            Texture {
                levels: 9,
                ..alpha()
            },
            Texture {
                format: Format::Dxt5,
                ..alpha()
            },
        ];
        for texture in mismatches {
            assert_eq!(
                patch_in_place(&file, &[wrong(texture.clone())]),
                None,
                "{texture:?}"
            );
        }
        assert_eq!(
            patch_in_place(
                &file,
                &[wrong(Texture {
                    payload_len: 100,
                    ..alpha()
                })]
            ),
            None
        );
        assert_eq!(
            patch_in_place(
                &file,
                &[wrong(Texture {
                    data_at: 0x3FF0,
                    ..alpha()
                })]
            ),
            None
        );
    }

    #[test]
    fn broken_input_files_are_refused() {
        // От16 – От24, Пр18 – Пр20
        let body = sample();
        let file = file_of(&body);
        let edit = [a_to_small(pat(640, 1))];
        assert_eq!(patch_in_place(&[], &edit), None);
        assert_eq!(patch_in_place(&file[..16], &edit), None);
        assert_eq!(patch_in_place(&file[..17], &edit), None);
        let mut no_magic = file.clone();
        no_magic[0] = b'X';
        assert_eq!(patch_in_place(&no_magic, &edit), None);
        let garbage = [file[..16].to_vec(), vec![0xFF; 40]].concat();
        assert_eq!(patch_in_place(&garbage, &edit), None);
        assert_eq!(patch_in_place(&file[..file.len() / 2], &edit), None);

        let flags_none = Header {
            system_flags: 0,
            ..header()
        };
        assert_eq!(
            patch_in_place(
                &Resource::from_parts(flags_none, body.clone())
                    .to_file_bytes()
                    .unwrap(),
                &edit
            ),
            None
        );
        let short = Resource::from_parts(header(), body[..0x4000 - 0x800].to_vec());
        assert_eq!(patch_in_place(&short.to_file_bytes().unwrap(), &edit), None);

        // слова заголовка переносятся как есть: объявленная версия и флаги
        let declared = Header {
            declared_version: 12345,
            ..header()
        };
        let declared_file = Resource::from_parts(declared, body.clone())
            .to_file_bytes()
            .unwrap();
        let out = patch_in_place(&declared_file, &edit).unwrap();
        assert_eq!(&out[..16], &declared_file[..16]);
        assert_eq!(&out[4..8], &[0x39, 0x30, 0, 0]);
        for flags in [(0xD800_0004u32, 0x5800_0004u32), (0xA800_0004, 0x2800_0004)] {
            let other = Header {
                system_flags: flags.0,
                graphics_flags: flags.1,
                ..header()
            };
            let other_file = Resource::from_parts(other, body.clone())
                .to_file_bytes()
                .unwrap();
            let out = patch_in_place(&other_file, &edit).unwrap();
            assert_eq!(&out[..16], &other_file[..16]);
        }
    }

    #[test]
    fn kinds_are_plain_values() {
        let kinds = [Kind::Ydr, Kind::Ydd, Kind::Yft];
        let copy = kinds[1];
        assert_eq!(copy, Kind::Ydd);
        assert_ne!(kinds[0], kinds[2]);
        assert_eq!(format!("{:?}", kinds[2]), "Yft");
    }
}
