//! Список эволюций эффекта (`EvolutionList`, 0x40 байт) из `core.ypt`.
//!
//! Объект читается целиком в обычные значения Rust: числа сохраняются как
//! записаны, без округления, нормализации и проверки по схеме. Отдельно читается
//! список ключей: тот же формат встроен в ключевые свойства правил.

use super::read_list;
use crate::error::Result;
use crate::resource::Resource;

/// Раскладка записей: шаги массивов и смещения полей внутри записи.
struct Rows {
    name: usize,
    property: usize,
    frame: usize,
    key: usize,
    /// Смещение списка свойств в объекте эволюций.
    properties_at: usize,
    /// Хеш и режим смешивания внутри записи свойства.
    property_tail: usize,
    /// Номер эволюции и флаг LOD внутри записи кадра.
    frame_tail: usize,
    /// Смещение «значения» внутри ключа (перед ним идёт «время»).
    key_value: usize,
}

const ROWS: Rows = Rows {
    name: 0x18,
    property: 0x18,
    frame: 0x30,
    key: 0x20,
    properties_at: 0x10,
    property_tail: 0x10,
    frame_tail: 0x20,
    key_value: 0x10,
};

/// Ключ кривой: четыре «времени» и четыре значения.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Key {
    pub time: [f32; 4],
    pub value: [f32; 4],
}

/// Кадр свойства: номер эволюции, флаг LOD и ключи.
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub evolution: i32,
    pub lod: u8,
    pub keys: Vec<Key>,
}

/// Свойство: хеш имени (в строку не превращается), режим смешивания и кадры.
#[derive(Debug, Clone, PartialEq)]
pub struct Property {
    pub hash: u32,
    pub blend: u32,
    pub frames: Vec<Frame>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Evolutions {
    pub names: Vec<String>,
    pub properties: Vec<Property>,
}

/// Читатель с курсором: числа идут одно за другим от заданного места.
struct Cursor<'a> {
    res: &'a Resource,
    at: usize,
}

impl<'a> Cursor<'a> {
    fn at(res: &'a Resource, at: usize) -> Self {
        Cursor { res, at }
    }

    fn word(&mut self) -> Result<u32> {
        let value = self.res.u32(self.at)?;
        self.at += 4;
        Ok(value)
    }

    fn byte(&mut self) -> Result<u8> {
        let value = self.res.u8(self.at)?;
        self.at += 1;
        Ok(value)
    }

    fn floats<const N: usize>(&mut self) -> Result<[f32; N]> {
        let mut out = [0.0f32; N];
        for slot in out.iter_mut() {
            *slot = self.res.f32(self.at)?;
            self.at += 4;
        }
        Ok(out)
    }
}

/// Начала записей списка с заголовком в `header`. Нет массива — записей нет,
/// сколько бы ни было заявлено; иначе ровно заявленное число.
fn row_starts(
    res: &Resource,
    header: usize,
    stride: usize,
) -> Result<impl Iterator<Item = usize>> {
    let (array, declared) = read_list(res, header)?;
    Ok(array
        .into_iter()
        .flat_map(move |base| (0..declared).map(move |n| base + n * stride)))
}

fn key_at(res: &Resource, at: usize) -> Result<Key> {
    let time = Cursor::at(res, at).floats::<4>()?;
    let value = Cursor::at(res, at + ROWS.key_value).floats::<4>()?;
    Ok(Key { time, value })
}

fn frame_at(res: &Resource, at: usize) -> Result<Frame> {
    let keys = read_keys(res, at)?;
    let mut tail = Cursor::at(res, at + ROWS.frame_tail);
    // Номер эволюции лежит как u32 и приводится к знаковому.
    let evolution = tail.word()? as i32;
    Ok(Frame {
        evolution,
        lod: tail.byte()?,
        keys,
    })
}

fn property_at(res: &Resource, at: usize) -> Result<Property> {
    let frames = row_starts(res, at, ROWS.frame)?
        .map(|frame| frame_at(res, frame))
        .collect::<Result<Vec<_>>>()?;
    let mut tail = Cursor::at(res, at + ROWS.property_tail);
    Ok(Property {
        hash: tail.word()?,
        blend: tail.word()?,
        frames,
    })
}

/// Читает объект списка эволюций: имена (+0x00) и свойства с кадрами (+0x10).
/// Версию ресурса не проверяет.
pub fn read(res: &Resource, list_at: usize) -> Result<Evolutions> {
    // Указатель, который никуда не ведёт, даёт пустое имя, а не пропуск записи.
    let names = row_starts(res, list_at, ROWS.name)?
        .map(|entry| {
            res.u64(entry)
                .map(|pointer| res.cstring(pointer).into_iter().collect::<String>())
        })
        .collect::<Result<Vec<_>>>()?;
    let properties = row_starts(res, list_at + ROWS.properties_at, ROWS.property)?
        .map(|property| property_at(res, property))
        .collect::<Result<Vec<_>>>()?;
    Ok(Evolutions { names, properties })
}

/// Читает список ключей по заголовку в `list_at`.
pub fn read_keys(res: &Resource, list_at: usize) -> Result<Vec<Key>> {
    row_starts(res, list_at, ROWS.key)?
        .map(|key| key_at(res, key))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{Header, SYSTEM_BASE};

    const SYSTEM: usize = 0x400;
    const GRAPHICS: usize = 0x100;

    /// Образ ресурса: системная область 0x400 байт, затем графическая 0x100.
    struct Image(Vec<u8>);

    impl Image {
        fn new() -> Self {
            Image(vec![0; SYSTEM + GRAPHICS])
        }

        fn put(&mut self, at: usize, bytes: &[u8]) {
            self.0[at..at + bytes.len()].copy_from_slice(bytes);
        }

        /// Указатель в системную область.
        fn point(&mut self, at: usize, target: usize) {
            self.put(at, &(SYSTEM_BASE + target as u64).to_le_bytes());
        }

        /// Заголовок списка: указатель на массив, число и ёмкость.
        fn list(&mut self, at: usize, array: usize, count: u16) {
            self.point(at, array);
            self.put(at + 8, &count.to_le_bytes());
            self.put(at + 10, &count.to_le_bytes());
        }

        fn key(&mut self, at: usize, time: f32, value: f32) {
            for lane in 0..4 {
                self.put(at + lane * 4, &time.to_le_bytes());
                self.put(at + 16 + lane * 4, &value.to_le_bytes());
            }
        }

        fn resource(self) -> Resource {
            let header = Header {
                system_flags: 0,
                graphics_flags: 0,
                system_size: SYSTEM,
                graphics_size: GRAPHICS,
                version: 68,
                declared_version: 68,
            };
            Resource::from_parts(header, self.0)
        }
    }

    /// Список: два имени, одно свойство с двумя кадрами; у первого кадра один ключ.
    fn sample() -> Image {
        let mut img = Image::new();
        img.list(0x00, 0x100, 2);
        img.point(0x100, 0x180);
        img.put(0x180, b"evo_a\0");
        // второй указатель имени ведёт в никуда
        img.put(0x118, &0x1234_5678u64.to_le_bytes());
        img.list(0x10, 0x200, 1);
        img.list(0x200, 0x240, 2);
        img.put(0x210, &0xCAFE_F00Du32.to_le_bytes());
        img.put(0x214, &7u32.to_le_bytes());
        img.list(0x240, 0x2C0, 1);
        img.put(0x240 + 0x20, &0xFFFF_FFFFu32.to_le_bytes());
        img.put(0x240 + 0x24, &[200]);
        img.key(0x2C0, 0.5, -2.0);
        img
    }

    #[test]
    fn reads_names_properties_frames_and_keys() {
        let res = sample().resource();
        let found = read(&res, 0).unwrap();
        assert_eq!(found.names, ["evo_a", ""]);
        let property = &found.properties[0];
        assert_eq!((property.hash, property.blend), (0xCAFE_F00D, 7));
        assert_eq!(property.frames.len(), 2);
        let frame = &property.frames[0];
        assert_eq!((frame.evolution, frame.lod), (-1, 200));
        assert_eq!(
            frame.keys,
            [Key {
                time: [0.5; 4],
                value: [-2.0; 4]
            }]
        );
        assert!(property.frames[1].keys.is_empty());
        assert_eq!(read_keys(&res, 0x240).unwrap(), frame.keys);
    }

    #[test]
    fn a_missing_array_gives_an_empty_list_whatever_the_count() {
        let mut img = Image::new();
        img.put(0x08, &5u16.to_le_bytes());
        let res = img.resource();
        assert_eq!(read(&res, 0).unwrap(), Evolutions::default());
        assert!(read_keys(&res, 0).unwrap().is_empty());
    }

    #[test]
    fn reading_past_the_end_is_an_error() {
        let res = sample().resource();
        let end = res.len();
        // заголовок списка занимает 12 байт и должен лежать целиком
        assert!(read_keys(&res, end - 12).unwrap().is_empty());
        assert!(read_keys(&res, end - 11).is_err());
        assert!(read(&res, end - 13).is_err());
        let mut img = sample();
        img.list(0x300, 0x3F0, 100);
        assert!(read_keys(&img.resource(), 0x300).is_err());
    }
}
