//! Образ ядра `core.ypt` Legacy для правок: значения кадров на месте, списки кадров с другой длиной.
//!
//! Образ — общий образ ядра (`Structure`), который открывается одним способом (`Structure::parse`).
//! Слова-хеши, слова внутри пикселей и внутри строк указателями не считаются, поэтому запись
//! их не портит (у ядер из `update.rpf` хеш вида поведения `0x6232E25A` попадает в диапазон адресов
//! графической области; разбор, который брал бы его за указатель, при сборке переписал бы значение).
//! Правка значений пишет числа прямо в область; смена длины списка кадров кладёт новый массив (или пишет
//! в прежний, если он не меньше) и обновляет число и ёмкость, как это делает помощник при сохранении.
//! Собирается образ в файл раскладкой «как есть» (`Structure::into_file`). Слоты следа, клоны и
//! остальное, что меняет состав ядра, работают над тем же образом: `Image::structure_mut`.

use super::structure::Structure;
use crate::error::{Error, Result};
use crate::resource::SYSTEM_BASE;
use crate::resource_graph::{append_block, Address, Graph, Segment, Slot};

/// Длина одного кадра: время (4 числа) и значение (4 числа).
pub const FRAME_BYTES: usize = 0x20;
/// Смещение списка кадров внутри свойства.
pub const KEY_LIST: usize = 0x70;
/// Смещение хеша имени внутри свойства.
pub const PROP_HASH: usize = 0x68;
/// Длина встроенного свойства.
pub const PROP_BYTES: usize = 0x90;
/// Поля корня: словари текстур, частиц, эффектов, эмиттеров.
pub const ROOT_TEXTURES: usize = 0x20;
pub const ROOT_PARTICLES: usize = 0x38;
pub const ROOT_EFFECTS: usize = 0x48;
pub const ROOT_EMITTERS: usize = 0x50;
/// Список значений внутри словаря.
pub const DICTIONARY_VALUES: usize = 0x30;
/// Смещения имён объектов.
pub const EFFECT_NAME: usize = 0x20;
pub const EMITTER_NAME: usize = 0x20;
pub const PARTICLE_NAME: usize = 0x120;
pub const TEXTURE_NAME: usize = 0x28;

const MSG_EOF: &str = "Чтение за концом данных ресурса.";

/// Кадр свойства как он лежит в файле: время (время, обратная длина отрезка, 0, 0) и значение.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub time: [f32; 4],
    pub value: [f32; 4],
}

impl Frame {
    fn to_bytes(self) -> [u8; FRAME_BYTES] {
        let mut out = [0u8; FRAME_BYTES];
        for (k, number) in self.time.into_iter().chain(self.value).enumerate() {
            out[k * 4..k * 4 + 4].copy_from_slice(&number.to_le_bytes());
        }
        out
    }

    /// Равенство «как у `Vector4.Equals`»: каждое число побитно, но NaN равно NaN.
    pub fn same(&self, other: &Frame) -> bool {
        let same = |a: &[f32; 4], b: &[f32; 4]| {
            a.iter()
                .zip(b)
                .all(|(x, y)| x == y || (x.is_nan() && y.is_nan()))
        };
        same(&self.time, &other.time) && same(&self.value, &other.value)
    }
}

/// Список L64: где массив (системная область), сколько записей и какая ёмкость.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct List {
    pub array: Option<usize>,
    pub count: usize,
    pub capacity: usize,
}

pub struct Image {
    structure: Structure,
}

impl Image {
    /// Файл ядра Legacy; обрыв потока и чужая версия — отказ. Единый способ открытия для всех шагов `ypt-patch`
    /// (`Structure::parse`): слова-хеши по схеме, слова внутри пикселей и внутри строк указателями не считаются.
    pub fn parse(file: &[u8]) -> Result<Image> {
        Ok(Image {
            structure: Structure::parse(file)?,
        })
    }

    /// Образ над готовым общим образом ядра (слоты, клоны и кадры идут над одним).
    pub fn from_structure(structure: Structure) -> Image {
        Image { structure }
    }

    /// Общий образ: слоты следа, клоны, словари и листы правятся над ним.
    pub fn structure(&self) -> &Structure {
        &self.structure
    }

    pub fn structure_mut(&mut self) -> &mut Structure {
        &mut self.structure
    }

    pub fn into_structure(self) -> Structure {
        self.structure
    }

    /// Граф блоков образа (для проверок: слоты на словах-хешах).
    #[doc(hidden)]
    pub fn graph(&self) -> &Graph {
        self.structure.graph()
    }

    /// Область системных данных: все объекты правил лежат в ней.
    pub fn system(&self) -> &[u8] {
        self.structure.system()
    }

    pub fn bytes(&self, at: usize, len: usize) -> Result<&[u8]> {
        let end = at.checked_add(len).ok_or_else(|| Error::broken(MSG_EOF))?;
        self.structure
            .system()
            .get(at..end)
            .ok_or_else(|| Error::broken(MSG_EOF))
    }

    pub fn u8(&self, at: usize) -> Result<u8> {
        Ok(self.bytes(at, 1)?[0])
    }

    pub fn u16(&self, at: usize) -> Result<u16> {
        Ok(u16::from_le_bytes(
            self.bytes(at, 2)?.try_into().unwrap_or_default(),
        ))
    }

    pub fn u32(&self, at: usize) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.bytes(at, 4)?.try_into().unwrap_or_default(),
        ))
    }

    pub fn u64(&self, at: usize) -> Result<u64> {
        Ok(u64::from_le_bytes(
            self.bytes(at, 8)?.try_into().unwrap_or_default(),
        ))
    }

    pub fn f32(&self, at: usize) -> Result<f32> {
        Ok(f32::from_bits(self.u32(at)?))
    }

    /// Куда в системной области ведёт указатель в слове `at`; нуль, чужая область и вылет за данные — `None`.
    pub fn pointer(&self, at: usize) -> Option<usize> {
        let value = self.u64(at).ok()?;
        let offset = value.checked_sub(SYSTEM_BASE)?;
        let offset = usize::try_from(offset).ok()?;
        (value < crate::resource::GRAPHICS_BASE && offset < self.structure.system().len())
            .then_some(offset)
    }

    /// Список «указатель, число, ёмкость» по смещению.
    pub fn list(&self, at: usize) -> Result<List> {
        Ok(List {
            array: self.pointer(at),
            count: usize::from(self.u16(at + 8)?),
            capacity: usize::from(self.u16(at + 10)?),
        })
    }

    /// Объекты, на которые указывают первые `count` слов массива; пустые указатели опускаются.
    pub fn objects(&self, list: List) -> Vec<usize> {
        let Some(array) = list.array else {
            return Vec::new();
        };
        (0..list.count)
            .filter_map(|k| self.pointer(array + k * 8))
            .collect()
    }

    /// Строка, на которую указывает слово `at`; пустая и из пробелов — `None`.
    pub fn name(&self, at: usize) -> Option<String> {
        let start = self.pointer(at)?;
        let tail = &self.structure.system()[start..];
        let window = &tail[..tail.len().min(256)];
        let text = match window.iter().position(|&b| b == 0) {
            Some(end) => &window[..end],
            None => window,
        };
        let text = String::from_utf8_lossy(text).into_owned();
        (!text.trim().is_empty()).then_some(text)
    }

    /// Объекты словаря из поля корня (`ROOT_*`); словаря нет — `None`. Пустые указатели опускаются.
    pub fn dictionary(&self, field: usize) -> Option<Vec<usize>> {
        let dictionary = self.pointer(field)?;
        let list = self.list(dictionary + DICTIONARY_VALUES).ok()?;
        Some(self.objects(list))
    }

    /// Единственный объект из `objects`, чьё имя (по смещению `name_at`) равно `wanted` без учёта
    /// регистра. Два объекта с одним именем — отказ, как у `SingleOrDefault`.
    pub fn single_named(
        &self,
        objects: &[usize],
        name_at: usize,
        wanted: &str,
    ) -> Result<Option<usize>> {
        let mut found = None;
        for &object in objects {
            let Some(name) = self.name(object + name_at) else {
                continue;
            };
            if super::cmp_ordinal_ignore_case(&name, wanted) != std::cmp::Ordering::Equal {
                continue;
            }
            if found.replace(object).is_some() {
                return Err(Error::operation(
                    "Sequence contains more than one matching element",
                ));
            }
        }
        Ok(found)
    }

    /// Первый объект с таким именем (как `FirstOrDefault`).
    pub fn first_named(&self, objects: &[usize], name_at: usize, wanted: &str) -> Option<usize> {
        objects.iter().copied().find(|&object| {
            self.name(object + name_at).is_some_and(|name| {
                super::cmp_ordinal_ignore_case(&name, wanted) == std::cmp::Ordering::Equal
            })
        })
    }

    /// Кадры свойства `prop` (начало свойства); нет массива — кадров нет.
    pub fn frames(&self, prop: usize) -> Result<Vec<Frame>> {
        self.frames_in(prop + KEY_LIST)
    }

    /// Кадры списка с заголовком в `header`.
    pub fn frames_in(&self, header: usize) -> Result<Vec<Frame>> {
        let list = self.list(header)?;
        let Some(array) = list.array else {
            return Ok(Vec::new());
        };
        (0..list.count)
            .map(|k| {
                let at = array + k * FRAME_BYTES;
                let read = |from: usize| -> Result<[f32; 4]> {
                    Ok([
                        self.f32(from)?,
                        self.f32(from + 4)?,
                        self.f32(from + 8)?,
                        self.f32(from + 12)?,
                    ])
                };
                Ok(Frame {
                    time: read(at)?,
                    value: read(at + 16)?,
                })
            })
            .collect()
    }

    /// Значение (четыре числа) кадра `k` свойства — на месте.
    pub fn set_value(&mut self, prop: usize, k: usize, value: [f32; 4]) -> Result<()> {
        let list = self.list(prop + KEY_LIST)?;
        let array = list
            .array
            .filter(|_| k < list.count)
            .ok_or_else(|| Error::broken(MSG_EOF))?;
        let at = array + k * FRAME_BYTES + 16;
        let mut bytes = [0u8; 16];
        for (n, number) in value.into_iter().enumerate() {
            bytes[n * 4..n * 4 + 4].copy_from_slice(&number.to_le_bytes());
        }
        self.put(at, &bytes)
    }

    pub fn set_f32(&mut self, at: usize, value: f32) -> Result<()> {
        self.put(at, &value.to_le_bytes())
    }

    /// Записывает байты в системную область по смещению; за пределы области — отказ.
    pub fn put(&mut self, at: usize, bytes: &[u8]) -> Result<()> {
        let end = at
            .checked_add(bytes.len())
            .ok_or_else(|| Error::broken(MSG_EOF))?;
        self.structure
            .graph_mut()
            .system
            .get_mut(at..end)
            .ok_or_else(|| Error::broken(MSG_EOF))?
            .copy_from_slice(bytes);
        Ok(())
    }

    /// Заменяет кадры свойства: число и ёмкость становятся длиной нового списка. Новый массив влезает в
    /// прежний, если у того хватало записей; иначе дописывается блоком в конец области.
    pub fn replace_frames(&mut self, prop: usize, frames: &[Frame]) -> Result<()> {
        self.replace_frames_in(prop + KEY_LIST, frames)
    }

    /// То же для списка кадров с заголовком в `header` (у наборов кадров эволюций список лежит в начале набора).
    pub fn replace_frames_in(&mut self, header: usize, frames: &[Frame]) -> Result<()> {
        let old = self.list(header)?;
        let owner = self
            .structure
            .graph()
            .block_at(Address {
                segment: Segment::System,
                offset: header,
            })
            .ok_or_else(|| Error::broken(MSG_EOF))?;
        let relative = header - self.structure.graph().blocks[owner].start;
        let bytes: Vec<u8> = frames.iter().flat_map(|frame| frame.to_bytes()).collect();
        let room = old.count.max(old.capacity) * FRAME_BYTES;
        let in_place = old.array.filter(|&array| {
            !frames.is_empty() && bytes.len() <= room && self.block_room(array) >= bytes.len()
        });
        match (frames.is_empty(), in_place) {
            (true, _) => {
                self.drop_slot(owner, relative);
                self.put(header, &0u64.to_le_bytes())?;
            }
            (false, Some(array)) => {
                // Хвост прежних кадров, которого в новом списке нет, обнуляется.
                let stale = (old.count.max(old.capacity) * FRAME_BYTES).min(self.block_room(array));
                self.put(array, &vec![0u8; stale.max(bytes.len())])?;
                self.put(array, &bytes)?;
            }
            (false, None) => {
                let index =
                    append_block(self.structure.graph_mut(), Segment::System, bytes, Vec::new());
                let start = self.structure.graph().blocks[index].start;
                self.set_slot(
                    owner,
                    relative,
                    Address {
                        segment: Segment::System,
                        offset: start,
                    },
                );
                self.put(header, &(SYSTEM_BASE + start as u64).to_le_bytes())?;
            }
        }
        let count =
            u16::try_from(frames.len()).map_err(|_| Error::argument("Слишком много кадров."))?;
        self.put(header + 8, &count.to_le_bytes())?;
        self.put(header + 10, &count.to_le_bytes())
    }

    /// Сколько байт от начала массива до конца его блока (блок обязан начинаться ровно с массива).
    fn block_room(&self, array: usize) -> usize {
        let at = Address {
            segment: Segment::System,
            offset: array,
        };
        let graph = self.structure.graph();
        match graph.block_at(at) {
            Some(index) if graph.blocks[index].start == array => graph.blocks[index].end - array,
            _ => 0,
        }
    }

    fn set_slot(&mut self, block: usize, relative: usize, target: Address) {
        let slots = &mut self.structure.graph_mut().blocks[block].slots;
        match slots.iter_mut().find(|slot| slot.relative == relative) {
            Some(slot) => slot.target = target,
            None => {
                let place = slots.partition_point(|slot| slot.relative < relative);
                slots.insert(place, Slot { relative, target });
            }
        }
    }

    fn drop_slot(&mut self, block: usize, relative: usize) {
        self.structure.graph_mut().blocks[block]
            .slots
            .retain(|slot| slot.relative != relative);
    }

    /// Файл из образа: блоки в прежнем порядке, страницы пересчитаны.
    pub fn into_file(self) -> Result<Vec<u8>> {
        self.structure.into_file()
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::Resource;
    use crate::ypt::fixture;

    fn frame(time: f32, inverse: f32, value: [f32; 4]) -> Frame {
        Frame {
            time: [time, inverse, 0.0, 0.0],
            value,
        }
    }

    #[test]
    fn frames_read_back_in_file_order() {
        let core = fixture::core(false);
        let image = Image::parse(&core.bytes).unwrap();
        let prop = core.map.effect + 0xC0 + 0x90 * 2;
        let frames = image.frames(prop).unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].value, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(frames[1].time[..2], [1.0, 1.0]);
        assert_eq!(frames[1].value, [2.0, 2.0, 2.0, 2.0]);
    }

    #[test]
    fn a_longer_list_moves_to_a_new_block_and_survives_the_rebuild() {
        let core = fixture::core(false);
        let mut image = Image::parse(&core.bytes).unwrap();
        let prop = core.map.effect + 0xC0 + 0x90 * 2;
        let wanted: Vec<Frame> = (0..5)
            .map(|k| {
                frame(
                    k as f32 * 0.25,
                    if k == 0 { 0.0 } else { 4.0 },
                    [k as f32; 4],
                )
            })
            .collect();
        image.replace_frames(prop, &wanted).unwrap();
        assert_eq!(image.list(prop + KEY_LIST).unwrap().count, 5);
        assert_eq!(image.list(prop + KEY_LIST).unwrap().capacity, 5);
        let file = image.into_file().unwrap();
        let again = Image::parse(&file).unwrap();
        // положение объектов в области могло сместиться: свойство ищется заново по имени правила
        let list = crate::ypt::rules::effect_positions(&Resource::parse(&file).unwrap()).unwrap();
        let effect = list["tracer"];
        let found = again.frames(effect + 0xC0 + 0x90 * 2).unwrap();
        assert_eq!(found.len(), 5);
        assert!(found.iter().zip(&wanted).all(|(a, b)| a.same(b)));
    }

    #[test]
    fn a_shorter_or_empty_list_stays_in_place() {
        let core = fixture::core(false);
        let mut image = Image::parse(&core.bytes).unwrap();
        let prop = core.map.effect + 0xC0 + 0x90 * 2;
        let before = image.list(prop + KEY_LIST).unwrap();
        image
            .replace_frames(prop, &[frame(0.0, 0.0, [9.0; 4])])
            .unwrap();
        let after = image.list(prop + KEY_LIST).unwrap();
        assert_eq!(after.array, before.array);
        assert_eq!((after.count, after.capacity), (1, 1));
        image.replace_frames(prop, &[]).unwrap();
        let none = image.list(prop + KEY_LIST).unwrap();
        assert_eq!((none.array, none.count, none.capacity), (None, 0, 0));
        let file = image.into_file().unwrap();
        let reread = Image::parse(&file).unwrap();
        let effect = crate::ypt::rules::effect_positions(&Resource::parse(&file).unwrap()).unwrap()
            ["tracer"];
        assert!(reread.frames(effect + 0xC0 + 0x90 * 2).unwrap().is_empty());
    }

    #[test]
    fn a_foreign_version_is_refused() {
        let mut core = fixture::core(false).bytes;
        // версия — старшие четыре бита слов флагов
        core[11] = 0x10;
        assert!(Image::parse(&core).is_err());
    }
}
