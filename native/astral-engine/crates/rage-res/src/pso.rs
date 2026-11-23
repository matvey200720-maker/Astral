//! PSO (метафайлы игры, числа big-endian): разбор в объекты по схеме и
//! запись обратно в том же порядке блоков, что у хост-программы.

use std::collections::HashMap;

use crate::error::{Error, Result};

const NOTE_FIELD: u32 = 0x100;
const TYPE_HASH: u8 = 0x0b;
const TYPE_STRUCT: u8 = 0x0c;
const TYPE_ARRAY: u8 = 0x0d;
const TYPE_ENUM: u8 = 0x0e;
const HASH_BLOCK_NAME: u32 = 6;
const BLOCK_LIMIT: usize = 0x10_0000;
const DATA_START: usize = 16;
const FIELD_BYTES: usize = 12;
const SECTION_HEAD: usize = 8;
const POINTER_BYTES: usize = 12;

const MSG_SECTION_END: &str = "PSO: раздел выходит за конец файла.";
const MSG_READ_PAST: &str = "PSO: чтение за концом раздела.";
const MSG_ROOT: &str = "PSO: корень вне блоков.";
const MSG_ELEMENT_OUT: &str = "PSO: элемент схемы вне раздела.";
const MSG_OBJECT_PAST: &str = "PSO: объект за концом блока.";
const MSG_NO_BLOCK: &str = "PSO: массив на несуществующий блок.";
const MSG_ARRAY_PAST: &str = "PSO: массив за концом блока.";
const MSG_UNDESCRIBED_TYPE: &str = "PSO: тип объекта не описан в схеме; пока на хосте.";
const MSG_NOT_STRUCT: &str = "PSO: тип объекта — не структура; пока на хосте.";
const MSG_NO_NOTE: &str = "PSO: массив без описания элементов; пока на хосте.";
const MSG_NESTED: &str = "PSO: вложенная структура внутри объекта; пока на хосте.";
const MSG_SCALAR_TYPE: &str = "PSO: тип элементов массива не разобран; пока на хосте.";

#[derive(Debug, Clone, PartialEq)]
pub struct Element {
    pub name: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub name: u32,
    pub dtype: u8,
    pub offset: usize,
    pub reference: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Structure {
    pub length: usize,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub name: u32,
    pub offset: usize,
    pub length: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct File {
    pub elements: Vec<Element>,
    pub blocks: Vec<Block>,
    pub root: usize,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Object {
    pub name: u32,
    pub bytes: Vec<u8>,
    pub arrays: Vec<(usize, Array)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Array {
    Structs(Vec<Object>),
    Scalars { dtype: u8, bytes: Vec<u8> },
}

// ---------------------------------------------------------------- числа

fn slice(bytes: &[u8], at: usize, len: usize) -> Result<&[u8]> {
    at.checked_add(len)
        .and_then(|end| bytes.get(at..end))
        .ok_or_else(|| Error::broken(MSG_READ_PAST))
}

fn be32(bytes: &[u8], at: usize) -> Result<u32> {
    let raw = slice(bytes, at, 4)?;
    Ok(u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]))
}

fn be16(bytes: &[u8], at: usize) -> Result<u16> {
    let raw = slice(bytes, at, 2)?;
    Ok(u16::from_be_bytes([raw[0], raw[1]]))
}

/// Размер скалярного элемента массива по коду типа.
fn scalar_size(dtype: u8) -> Option<usize> {
    match dtype {
        0x00..=0x02 => Some(1),
        0x03 | 0x04 => Some(2),
        0x05..=0x07 | 0x0b | 0x0e | 0x0f => Some(4),
        0x08 | 0x20 => Some(8),
        0x09 | 0x14 => Some(12),
        0x0a | 0x15 => Some(16),
        _ => None,
    }
}

// ---------------------------------------------------------------- схема

pub fn structure_of(element: &Element) -> Option<Structure> {
    let bytes = element.bytes.as_slice();
    if bytes.len() < 8 || bytes[0] != 0 {
        return None;
    }
    let count = usize::from(be16(bytes, 2).ok()?);
    let length = be32(bytes, 4).ok()? as usize;
    let fields = (0..count)
        .map(|i| {
            let raw = bytes.get(12 + i * FIELD_BYTES..12 + (i + 1) * FIELD_BYTES)?;
            Some(Field {
                name: u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]),
                dtype: raw[4],
                offset: usize::from(u16::from_be_bytes([raw[6], raw[7]])),
                reference: u32::from_be_bytes([raw[8], raw[9], raw[10], raw[11]]),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(Structure { length, fields })
}

/// `schema` — раздел `PSCH` целиком, вместе с 8-байтовым заголовком.
pub fn schema_elements(schema: &[u8]) -> Result<Vec<Element>> {
    if schema.len() < 12 {
        return Err(Error::broken(MSG_READ_PAST));
    }
    let count = be32(schema, 8)? as usize;
    let mut index = Vec::new();
    for i in 0..count {
        let at = 12 + i * 8;
        index.push((be32(schema, at)?, be32(schema, at + 4)? as usize));
    }
    let ends = index
        .iter()
        .skip(1)
        .map(|&(_, start)| start)
        .chain(std::iter::once(schema.len()));
    index
        .iter()
        .zip(ends)
        .map(|(&(name, start), end)| {
            if start > end || end > schema.len() {
                return Err(Error::broken(MSG_ELEMENT_OUT));
            }
            Ok(Element {
                name,
                bytes: schema[start..end].to_vec(),
            })
        })
        .collect()
}

// ---------------------------------------------------------------- разбор

pub fn parse(bytes: &[u8]) -> Result<File> {
    // Раздел -> (начало, конец); при повторе действует последний.
    let mut sections: HashMap<[u8; 4], (usize, usize)> = HashMap::new();
    let mut at = 0;
    while bytes.len() - at >= SECTION_HEAD {
        let id = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
        let length = be32(bytes, at + 4)? as usize;
        let end = at.checked_add(length);
        match end {
            Some(end) if length >= SECTION_HEAD && end <= bytes.len() => {
                sections.insert(id, (at, end));
                at = end;
            }
            _ => return Err(Error::broken(MSG_SECTION_END)),
        }
    }
    let find = |id: &[u8; 4], label: &str| {
        sections
            .get(id)
            .copied()
            .ok_or_else(|| Error::broken(format!("Это не PSO: нет {label}.")))
    };
    let (data_start, data_end) = find(b"PSIN", "PSIN")?;
    let (map_start, map_end) = find(b"PMAP", "PMAP")?;
    let (schema_start, schema_end) = find(b"PSCH", "PSCH")?;

    // Карта блоков читается только в пределах собственного раздела.
    let map = &bytes[map_start..map_end];
    let root = be32(map, 8)? as usize;
    let count = usize::from(be16(map, 12)?);
    let blocks = (0..count)
        .map(|i| {
            let entry = 16 + i * 16;
            Ok(Block {
                name: be32(map, entry)?,
                offset: be32(map, entry + 4)? as usize,
                length: be32(map, entry + 12)? as usize,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if root == 0 || root > blocks.len() {
        return Err(Error::broken(MSG_ROOT));
    }
    Ok(File {
        elements: schema_elements(&bytes[schema_start..schema_end])?,
        blocks,
        root: root - 1,
        data: bytes[data_start..data_end].to_vec(),
    })
}

impl File {
    pub fn root_object(&self) -> Result<Object> {
        let block = self
            .blocks
            .get(self.root)
            .ok_or_else(|| Error::broken(MSG_ROOT))?;
        self.read_object(block.name, block.offset)
    }

    fn structure(&self, name: u32) -> Result<Structure> {
        let element = self
            .elements
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| Error::argument(MSG_UNDESCRIBED_TYPE))?;
        structure_of(element).ok_or_else(|| Error::argument(MSG_NOT_STRUCT))
    }

    fn read_object(&self, name: u32, at: usize) -> Result<Object> {
        let structure = self.structure(name)?;
        let bytes = at
            .checked_add(structure.length)
            .and_then(|end| self.data.get(at..end))
            .ok_or_else(|| Error::broken(MSG_OBJECT_PAST))?
            .to_vec();
        let mut arrays = Vec::new();
        // Описание элементов, оставленное служебным полем для ближайшего массива.
        let mut note: Option<&Field> = None;
        for field in &structure.fields {
            if field.name == NOTE_FIELD {
                note = Some(field);
            } else if field.dtype == TYPE_ARRAY {
                let info = note.take().ok_or_else(|| Error::argument(MSG_NO_NOTE))?;
                arrays.push((field.offset, self.read_array(&bytes, field.offset, info)?));
            } else if field.dtype == TYPE_STRUCT {
                return Err(Error::argument(MSG_NESTED));
            }
        }
        Ok(Object {
            name,
            bytes,
            arrays,
        })
    }

    fn read_array(&self, owner: &[u8], offset: usize, info: &Field) -> Result<Array> {
        let pointer = be32(owner, offset)?;
        let count = usize::from(be16(owner, offset + 8)?);
        let block_number = (pointer & 0xfff) as usize;
        let is_structs = info.dtype == TYPE_STRUCT;
        if count == 0 || block_number == 0 {
            return Ok(if is_structs {
                Array::Structs(Vec::new())
            } else {
                Array::Scalars {
                    dtype: info.dtype,
                    bytes: Vec::new(),
                }
            });
        }
        let block = self
            .blocks
            .get(block_number - 1)
            .ok_or_else(|| Error::broken(MSG_NO_BLOCK))?;
        let start = block.offset + (pointer >> 12) as usize;
        if is_structs {
            let length = self.structure(info.reference)?.length;
            let items = (0..count)
                .map(|i| {
                    let at = i
                        .checked_mul(length)
                        .and_then(|shift| start.checked_add(shift))
                        .ok_or_else(|| Error::broken(MSG_OBJECT_PAST))?;
                    self.read_object(info.reference, at)
                })
                .collect::<Result<Vec<_>>>()?;
            return Ok(Array::Structs(items));
        }
        let size = scalar_size(info.dtype).ok_or_else(|| Error::argument(MSG_SCALAR_TYPE))?;
        let bytes = start
            .checked_add(count * size)
            .and_then(|end| self.data.get(start..end))
            .ok_or_else(|| Error::broken(MSG_ARRAY_PAST))?;
        Ok(Array::Scalars {
            dtype: info.dtype,
            bytes: bytes.to_vec(),
        })
    }
}

// ---------------------------------------------------------------- запись

struct OutBlock {
    name: u32,
    data: Vec<u8>,
}

#[derive(Default)]
struct Sink {
    blocks: Vec<OutBlock>,
    /// Имя -> индекс блока, в который сейчас дописывают.
    open: HashMap<u32, usize>,
}

impl Sink {
    /// Дописывает кусок; возвращает (номер блока с единицы, смещение куска).
    fn append(&mut self, name: u32, chunk: &[u8]) -> (usize, usize) {
        let reusable = self
            .open
            .get(&name)
            .copied()
            .filter(|&i| self.blocks[i].data.len() < BLOCK_LIMIT);
        let index = reusable.unwrap_or_else(|| {
            self.blocks.push(OutBlock {
                name,
                data: Vec::new(),
            });
            self.open.insert(name, self.blocks.len() - 1);
            self.blocks.len() - 1
        });
        let block = &mut self.blocks[index];
        let offset = block.data.len();
        block.data.extend_from_slice(chunk);
        (index + 1, offset)
    }

    /// Обрабатывает массивы объекта и вписывает в его байты указатели.
    fn settle(&mut self, object: &mut Object) -> Result<()> {
        for (offset, array) in &mut object.arrays {
            let (pointer, count) = self.place_array(array)?;
            let slot = offset
                .checked_add(POINTER_BYTES)
                .and_then(|end| object.bytes.get_mut(*offset..end))
                .ok_or_else(|| Error::broken(MSG_OBJECT_PAST))?;
            slot[0..4].copy_from_slice(&pointer.to_be_bytes());
            slot[4..8].fill(0);
            slot[8..10].copy_from_slice(&count.to_be_bytes());
            slot[10..POINTER_BYTES].copy_from_slice(&count.to_be_bytes());
        }
        Ok(())
    }

    fn place_array(&mut self, array: &mut Array) -> Result<(u32, u16)> {
        let (name, chunk, count) = match array {
            Array::Structs(items) => {
                let Some(first) = items.first().map(|item| item.name) else {
                    return Ok((0, 0));
                };
                let mut chunk = Vec::new();
                for item in items.iter_mut() {
                    self.settle(item)?;
                    chunk.extend_from_slice(&item.bytes);
                }
                (first, chunk, items.len())
            }
            Array::Scalars { dtype, bytes } => {
                if bytes.is_empty() {
                    return Ok((0, 0));
                }
                let size = scalar_size(*dtype).ok_or_else(|| Error::argument(MSG_SCALAR_TYPE))?;
                let name = match *dtype {
                    TYPE_HASH => HASH_BLOCK_NAME,
                    other => u32::from(other),
                };
                (name, bytes.clone(), bytes.len() / size)
            }
        };
        let (block, offset) = self.append(name, &chunk);
        let pointer = (block as u32 & 0xfff) | ((offset as u32) << 12);
        Ok((pointer, count as u16))
    }
}

fn is_structure(element: &Element) -> bool {
    element.bytes.first() == Some(&0)
}

/// Элементы схемы для выхода: структуры по порядку блоков, затем перечисления
/// из их полей.
fn pick_schema<'a>(elements: &'a [Element], blocks: &[OutBlock]) -> Vec<&'a Element> {
    let find = |name: u32| elements.iter().position(|e| e.name == name);
    let mut taken: Vec<usize> = Vec::new();
    for block in blocks {
        if let Some(i) = find(block.name) {
            if is_structure(&elements[i]) && !taken.contains(&i) {
                taken.push(i);
            }
        }
    }
    let structures = taken.clone();
    for i in structures {
        let fields = structure_of(&elements[i])
            .map(|s| s.fields)
            .unwrap_or_default();
        for field in fields.iter().filter(|f| f.dtype == TYPE_ENUM) {
            if let Some(j) = find(field.reference) {
                if !taken.contains(&j) {
                    taken.push(j);
                }
            }
        }
    }
    taken.into_iter().map(|i| &elements[i]).collect()
}

fn put32(out: &mut Vec<u8>, value: usize) {
    out.extend_from_slice(&(value as u32).to_be_bytes());
}

/// Записывает корень и всё его дерево; байты объектов получают новые указатели.
pub fn write(elements: &[Element], root: &mut Object) -> Result<Vec<u8>> {
    let mut sink = Sink::default();
    sink.settle(root)?;
    sink.append(root.name, &root.bytes);
    let schema = pick_schema(elements, &sink.blocks);

    let mut out = Vec::new();
    let data_length = DATA_START + sink.blocks.iter().map(|b| b.data.len()).sum::<usize>();
    out.extend_from_slice(b"PSIN");
    put32(&mut out, data_length);
    out.extend_from_slice(&[0; 8]);
    sink.blocks
        .iter()
        .for_each(|b| out.extend_from_slice(&b.data));

    out.extend_from_slice(b"PMAP");
    put32(&mut out, 16 + 16 * sink.blocks.len());
    // Корень записан последним, поэтому его номер с единицы равен числу блоков.
    put32(&mut out, sink.blocks.len());
    out.extend_from_slice(&(sink.blocks.len() as u16).to_be_bytes());
    out.extend_from_slice(&[0x70, 0x70]);
    let mut offset = DATA_START;
    for block in &sink.blocks {
        out.extend_from_slice(&block.name.to_be_bytes());
        put32(&mut out, offset);
        put32(&mut out, 0);
        put32(&mut out, block.data.len());
        offset += block.data.len();
    }

    let bodies: usize = schema.iter().map(|e| e.bytes.len()).sum();
    out.extend_from_slice(b"PSCH");
    put32(&mut out, 12 + 8 * schema.len() + bodies);
    put32(&mut out, schema.len());
    let mut body_at = 12 + 8 * schema.len();
    for element in &schema {
        out.extend_from_slice(&element.name.to_be_bytes());
        put32(&mut out, body_at);
        body_at += element.bytes.len();
    }
    schema.iter().for_each(|e| out.extend_from_slice(&e.bytes));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;

    const LINK: u32 = 0xc11f_3ee1;
    const ROOT: u32 = 0x93a6_8a2f;

    const FIXTURES: [(&str, &[u8]); 5] = [
        (
            "one-map-one-type",
            include_bytes!("../../../parity/host-port/manifest/one-map-one-type.ymf"),
        ),
        (
            "merge-into-one-map",
            include_bytes!("../../../parity/host-port/manifest/merge-into-one-map.ymf"),
        ),
        (
            "merge-two-into-one-map",
            include_bytes!("../../../parity/host-port/manifest/merge-two-into-one-map.ymf"),
        ),
        (
            "three-maps-nine-types",
            include_bytes!("../../../parity/host-port/manifest/three-maps-nine-types.ymf"),
        ),
        (
            "two-maps-three-types",
            include_bytes!("../../../parity/host-port/manifest/two-maps-three-types.ymf"),
        ),
    ];

    fn one() -> &'static [u8] {
        FIXTURES[0].1
    }

    fn refuse<T: std::fmt::Debug>(r: Result<T>, kind: Kind) -> String {
        let e = r.unwrap_err();
        assert_eq!(e.kind, kind);
        e.message
    }

    fn broken<T: std::fmt::Debug>(r: Result<T>) -> String {
        refuse(r, Kind::Broken)
    }

    fn argument<T: std::fmt::Debug>(r: Result<T>) -> String {
        refuse(r, Kind::Argument)
    }

    fn blocks_of(file: &File) -> Vec<(u32, usize, usize)> {
        file.blocks
            .iter()
            .map(|b| (b.name, b.offset, b.length))
            .collect()
    }

    #[test]
    fn host_files_read_and_rewrite_byte_for_byte() {
        let expected_blocks: [[(u32, usize, usize); 3]; 5] = [
            [(6, 16, 4), (LINK, 20, 24), (ROOT, 44, 96)],
            [(6, 16, 12), (LINK, 28, 48), (ROOT, 76, 96)],
            [(6, 16, 16), (LINK, 32, 72), (ROOT, 104, 96)],
            [(6, 16, 36), (LINK, 52, 72), (ROOT, 124, 96)],
            [(6, 16, 12), (LINK, 28, 48), (ROOT, 76, 96)],
        ];
        let sizes = [480, 512, 540, 560, 512];
        for (i, (label, bytes)) in FIXTURES.iter().enumerate() {
            assert_eq!(bytes.len(), sizes[i], "{label}");
            let file = parse(bytes).unwrap();
            assert_eq!(blocks_of(&file), expected_blocks[i], "{label}");
            assert_eq!(file.root, 2);
            assert_eq!(file.elements.len(), 3);
            let mut root = file.root_object().unwrap();
            let again = write(&file.elements, &mut root).unwrap();
            assert_eq!(&again, bytes, "{label}");
        }
        assert_eq!(
            sha256_hex(one()),
            "c13c2ed3c9cb7799ea6df9cf373c0f22ab92b3dae398c2588fc7c2447fd1925e"
        );
    }

    #[test]
    fn first_host_file_objects() {
        let file = parse(one()).unwrap();
        assert_eq!(file.data.len(), 140);
        let root_type = structure_of(&file.elements[1]).unwrap();
        assert_eq!(root_type.length, 96);
        assert_eq!(root_type.fields.len(), 12);
        assert_eq!(
            root_type.fields[0],
            Field {
                name: 256,
                dtype: 12,
                offset: 0,
                reference: 3260758307
            }
        );
        assert_eq!(
            root_type.fields[1],
            Field {
                name: 3039604259,
                dtype: 13,
                offset: 0,
                reference: 0
            }
        );
        assert_eq!(
            root_type.fields[6],
            Field {
                name: 256,
                dtype: 12,
                offset: 0,
                reference: 3240050401
            }
        );
        assert_eq!(
            root_type.fields[7],
            Field {
                name: 3712769228,
                dtype: 13,
                offset: 48,
                reference: 6
            }
        );
        let link_type = structure_of(&file.elements[0]).unwrap();
        assert_eq!(link_type.length, 24);
        assert_eq!(
            link_type.fields,
            vec![
                Field {
                    name: 833569695,
                    dtype: 11,
                    offset: 0,
                    reference: 0
                },
                Field {
                    name: 256,
                    dtype: 14,
                    offset: 0,
                    reference: 1683136603
                },
                Field {
                    name: 1683136603,
                    dtype: 15,
                    offset: 4,
                    reference: 2097153
                },
                Field {
                    name: 256,
                    dtype: 11,
                    offset: 0,
                    reference: 0
                },
                Field {
                    name: 2410949350,
                    dtype: 13,
                    offset: 8,
                    reference: 3
                },
            ]
        );

        let root = file.root_object().unwrap();
        assert_eq!(root.name, ROOT);
        let mut expect_bytes = vec![0u8; 48];
        expect_bytes.extend([0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 1]);
        expect_bytes.extend([0u8; 36]);
        assert_eq!(root.bytes, expect_bytes);
        let offsets: Vec<usize> = root.arrays.iter().map(|(at, _)| *at).collect();
        assert_eq!(offsets, [0, 16, 32, 48, 64, 80]);
        for (at, array) in &root.arrays {
            if *at != 48 {
                assert_eq!(array, &Array::Structs(vec![]));
            }
        }
        let link = Object {
            name: LINK,
            bytes: vec![
                0x2e, 0xc0, 0x3b, 0xb0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0,
            ],
            arrays: vec![(
                8,
                Array::Scalars {
                    dtype: 0x0b,
                    bytes: vec![0x25, 0x34, 0x2d, 0x0b],
                },
            )],
        };
        assert_eq!(root.arrays[3].1, Array::Structs(vec![link]));
    }

    #[test]
    fn section_walk_errors_and_tolerance() {
        let f = one();
        let (psin, pmap, psch) = (&f[..140], &f[140..204], &f[204..]);
        assert_eq!(broken(parse(&[])), "Это не PSO: нет PSIN.");
        assert_eq!(broken(parse(&[0; 7])), "Это не PSO: нет PSIN.");
        let section_end = "PSO: раздел выходит за конец файла.";
        assert_eq!(broken(parse(&[0; 16])), section_end);
        assert_eq!(broken(parse(&f[..f.len() - 1])), section_end);
        assert_eq!(broken(parse(&f[..f.len() / 2])), section_end);

        let join = |parts: &[&[u8]]| parts.concat();
        assert_eq!(broken(parse(&join(&[pmap, psch]))), "Это не PSO: нет PSIN.");
        assert_eq!(broken(parse(&join(&[psin, psch]))), "Это не PSO: нет PMAP.");
        assert_eq!(broken(parse(&join(&[psin, pmap]))), "Это не PSO: нет PSCH.");

        let shuffled = parse(&join(&[psch, pmap, psin])).unwrap();
        assert_eq!(
            (
                shuffled.root,
                shuffled.blocks.len(),
                shuffled.elements.len()
            ),
            (2, 3, 3)
        );

        assert_eq!(
            broken(parse(&join(&[f, &[0, 0, 0, 0, 0, 0, 0, 3]]))),
            section_end
        );
        assert_eq!(broken(parse(&join(&[f, &[0; 8]]))), section_end);
        let mut signature = b"PSIG".to_vec();
        signature.extend([0, 0, 0, 12, 1, 2, 3, 4]);
        assert!(parse(&join(&[f, &signature])).is_ok());
        assert!(parse(&join(&[f, &[1, 2, 3]])).is_ok());
        assert!(parse(&join(&[f, b"XXXX", &[0, 0, 0, 8]])).is_ok());
    }

    #[test]
    fn map_errors() {
        let patched = |at: usize, value: &[u8]| {
            let mut f = one().to_vec();
            f[at..at + value.len()].copy_from_slice(value);
            f
        };
        let root_at = 140 + 8;
        assert_eq!(
            broken(parse(&patched(root_at, &[0, 0, 0, 0]))),
            "PSO: корень вне блоков."
        );
        assert_eq!(
            broken(parse(&patched(root_at, &[0, 0, 0, 99]))),
            "PSO: корень вне блоков."
        );
        assert_eq!(
            broken(parse(&patched(140 + 12, &[0, 200]))),
            "PSO: чтение за концом раздела."
        );
    }

    fn three_maps() -> File {
        parse(FIXTURES[3].1).unwrap()
    }

    /// Смещение байтов корня в `data` и начало поля связей.
    fn links_pointer_at(file: &File) -> usize {
        file.blocks[file.root].offset + 48
    }

    #[test]
    fn object_read_errors() {
        let hidden = "PSO: тип объекта не описан в схеме; пока на хосте.";
        let mut f = three_maps();
        f.elements.clear();
        assert_eq!(argument(f.root_object()), hidden);

        let mut f = three_maps();
        f.data.truncate(4);
        assert_eq!(broken(f.root_object()), "PSO: объект за концом блока.");

        let mut f = three_maps();
        f.blocks[0].offset = 100_000;
        assert_eq!(broken(f.root_object()), "PSO: массив за концом блока.");

        let mut f = three_maps();
        f.blocks[1].offset = 100_000;
        assert_eq!(broken(f.root_object()), "PSO: объект за концом блока.");

        let mut f = three_maps();
        let at = links_pointer_at(&f);
        f.data[at..at + 4].copy_from_slice(&7u32.to_be_bytes());
        assert_eq!(
            broken(f.root_object()),
            "PSO: массив на несуществующий блок."
        );

        let mut f = three_maps();
        f.data[at..at + 4].copy_from_slice(&[0; 4]);
        assert_eq!(f.root_object().unwrap().arrays[3].1, Array::Structs(vec![]));

        let mut f = three_maps();
        f.data[at + 8..at + 10].copy_from_slice(&[0, 0]);
        assert_eq!(f.root_object().unwrap().arrays[3].1, Array::Structs(vec![]));

        let mut f = three_maps();
        f.data[at + 8..at + 10].copy_from_slice(&[0xff, 0xff]);
        assert_eq!(broken(f.root_object()), "PSO: объект за концом блока.");

        let mut f = three_maps();
        f.elements.retain(|e| e.name != LINK);
        assert_eq!(argument(f.root_object()), hidden);

        // перечисление с тем же именем идёт позже: берётся первая, структурная запись
        let mut f = three_maps();
        f.elements.push(Element {
            name: LINK,
            bytes: vec![1, 0, 0, 1, 0, 0, 0, 0],
        });
        assert_eq!(
            f.root_object().unwrap(),
            three_maps().root_object().unwrap()
        );

        let mut f = three_maps();
        f.elements.insert(
            0,
            Element {
                name: ROOT,
                bytes: vec![1, 0, 0, 1],
            },
        );
        assert_eq!(
            argument(f.root_object()),
            "PSO: тип объекта — не структура; пока на хосте."
        );
    }

    #[test]
    fn root_outside_blocks_is_an_error() {
        let mut f = parse(one()).unwrap();
        f.root = 99;
        assert_eq!(broken(f.root_object()), MSG_ROOT);
    }

    #[test]
    fn dropped_blocks_are_an_error() {
        let mut f = parse(one()).unwrap();
        f.blocks.truncate(2);
        assert_eq!(broken(f.root_object()), MSG_ROOT);
    }

    #[test]
    fn block_map_is_read_only_within_its_own_section() {
        // PMAP объявляет 3 блока, но её длина вмещает только заголовок и один:
        // остальное принадлежит следующему разделу и блоками считаться не может.
        let f = one();
        let (psin, pmap, psch) = (&f[..140], &f[140..204], &f[204..]);
        let mut short = pmap[..32].to_vec();
        short[4..8].copy_from_slice(&32u32.to_be_bytes());
        let mut file = psin.to_vec();
        file.extend_from_slice(&short);
        file.extend_from_slice(psch);
        assert_eq!(broken(parse(&file)), MSG_READ_PAST);
    }

    /// Структура-помощник для ручных схем: `fields` — (имя, тип, смещение, ссылка).
    fn structure_bytes(length: u32, fields: &[(u32, u8, u16, u32)]) -> Vec<u8> {
        let mut out = vec![0, 0];
        out.extend((fields.len() as u16).to_be_bytes());
        out.extend(length.to_be_bytes());
        out.extend([0; 4]);
        for &(name, dtype, offset, reference) in fields {
            out.extend(name.to_be_bytes());
            out.extend([dtype, 0]);
            out.extend(offset.to_be_bytes());
            out.extend(reference.to_be_bytes());
        }
        out
    }

    fn hand_file(element: Vec<u8>, data_after_header: Vec<u8>, root_length: usize) -> File {
        let mut data = vec![0; 16];
        data.extend(data_after_header);
        File {
            elements: vec![Element {
                name: 5,
                bytes: element,
            }],
            blocks: vec![Block {
                name: 5,
                offset: 16,
                length: root_length,
            }],
            root: 0,
            data,
        }
    }

    #[test]
    fn unsupported_shapes_on_read() {
        let no_note = structure_bytes(12, &[(1, 0x0d, 0, 0)]);
        assert_eq!(
            argument(hand_file(no_note, vec![0; 12], 12).root_object()),
            "PSO: массив без описания элементов; пока на хосте."
        );
        let nested = structure_bytes(12, &[(1, 0x0c, 0, 0)]);
        assert_eq!(
            argument(hand_file(nested, vec![0; 12], 12).root_object()),
            "PSO: вложенная структура внутри объекта; пока на хосте."
        );
        let scalars = structure_bytes(12, &[(0x100, 0x50, 0, 0), (1, 0x0d, 0, 0)]);
        let mut raw = vec![0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1];
        raw.extend([9; 4]);
        let mut file = hand_file(scalars, raw, 12);
        file.blocks.push(Block {
            name: 0x50,
            offset: 28,
            length: 4,
        });
        assert_eq!(
            argument(file.root_object()),
            "PSO: тип элементов массива не разобран; пока на хосте."
        );
    }

    #[test]
    fn schema_elements_cases() {
        let msg = "PSO: чтение за концом раздела.";
        assert_eq!(broken(schema_elements(&[])), msg);
        assert_eq!(broken(schema_elements(&[0; 8])), msg);
        assert_eq!(schema_elements(&[0; 12]).unwrap(), vec![]);

        let mut one_missing = vec![0; 12];
        one_missing[11] = 1;
        assert_eq!(broken(schema_elements(&one_missing)), msg);

        let with_pair = |pairs: &[(u32, u32)], tail: &[u8], declared: u8| {
            let mut out = vec![0; 12];
            out[11] = declared;
            for &(name, at) in pairs {
                out.extend(name.to_be_bytes());
                out.extend(at.to_be_bytes());
            }
            out.extend_from_slice(tail);
            out
        };
        let out_of_section = "PSO: элемент схемы вне раздела.";
        assert_eq!(
            broken(schema_elements(&with_pair(&[(0xaabbccdd, 200)], &[], 1))),
            out_of_section
        );
        assert_eq!(
            schema_elements(&with_pair(&[(0xaabbccdd, 20)], &[1, 2, 3], 1)).unwrap(),
            vec![Element {
                name: 2864434397,
                bytes: vec![1, 2, 3]
            }]
        );
        let two = with_pair(&[(1, 28), (2, 26)], &[0; 1], 2);
        assert_eq!(two.len(), 29);
        assert_eq!(broken(schema_elements(&two)), out_of_section);
    }

    #[test]
    fn structure_of_cases() {
        let el = |bytes: &[u8]| Element {
            name: 0,
            bytes: bytes.to_vec(),
        };
        assert_eq!(structure_of(&el(&[])), None);
        assert_eq!(structure_of(&el(&[1, 0, 0, 0, 0, 0, 0, 0])), None);
        assert_eq!(structure_of(&el(&[0, 0, 0, 0])), None);
        assert_eq!(
            structure_of(&el(&[0, 0, 0, 0, 0, 0, 0, 0x10, 0, 0, 0, 0])),
            Some(Structure {
                length: 16,
                fields: vec![]
            })
        );
        assert_eq!(
            structure_of(&el(&[0, 0, 0, 1, 0, 0, 0, 0x10, 0, 0, 0, 0])),
            None
        );
        let one_field = [
            0, 0, 0, 1, 0, 0, 0, 0x10, 0, 0, 0, 0, 0xde, 0xad, 0xbe, 0xef, 0x0c, 0x77, 1, 2, 0x11,
            0x22, 0x33, 0x44,
        ];
        assert_eq!(
            structure_of(&el(&one_field)),
            Some(Structure {
                length: 16,
                fields: vec![Field {
                    name: 3735928559,
                    dtype: 12,
                    offset: 258,
                    reference: 287454020
                }]
            })
        );
        assert_eq!(
            structure_of(&el(&[0, 1, 0, 0, 0, 0, 0, 0x10, 0, 0, 0, 0])).map(|s| s.fields.len()),
            Some(0)
        );
        assert_eq!(
            structure_of(&el(&[0, 0, 0xff, 0xff, 0, 0, 0, 0x10, 0, 0, 0, 0])),
            None
        );
    }

    fn plain_root(bytes: Vec<u8>, arrays: Vec<(usize, Array)>) -> Object {
        Object {
            name: 0x1234,
            bytes,
            arrays,
        }
    }

    fn empty_pmap(blocks: &[(u32, u32, u32)], root: u32) -> Vec<u8> {
        let mut out = b"PMAP".to_vec();
        out.extend((16 + 16 * blocks.len() as u32).to_be_bytes());
        out.extend(root.to_be_bytes());
        out.extend((blocks.len() as u16).to_be_bytes());
        out.extend([0x70, 0x70]);
        for &(name, offset, length) in blocks {
            out.extend(name.to_be_bytes());
            out.extend(offset.to_be_bytes());
            out.extend([0; 4]);
            out.extend(length.to_be_bytes());
        }
        out
    }

    const EMPTY_SCHEMA: [u8; 12] = [b'P', b'S', b'C', b'H', 0, 0, 0, 12, 0, 0, 0, 0];

    fn psin(blocks: &[u8]) -> Vec<u8> {
        let mut out = b"PSIN".to_vec();
        out.extend((16 + blocks.len() as u32).to_be_bytes());
        out.extend([0; 8]);
        out.extend_from_slice(blocks);
        out
    }

    #[test]
    fn write_plain_root() {
        let host = parse(one()).unwrap();
        let mut root = plain_root(vec![0; 16], vec![]);
        let out = write(&host.elements, &mut root).unwrap();
        let expect = [
            psin(&[0; 16]),
            empty_pmap(&[(0x1234, 16, 16)], 1),
            EMPTY_SCHEMA.to_vec(),
        ]
        .concat();
        assert_eq!(out, expect);
        assert_eq!(out.len(), 32 + 32 + 12);
    }

    #[test]
    fn write_hash_array() {
        let hashes = Array::Scalars {
            dtype: 0x0b,
            bytes: (1..=8).collect(),
        };
        let mut root = plain_root(vec![0xff; 16], vec![(0, hashes)]);
        let out = write(&[], &mut root).unwrap();
        let mut blocks: Vec<u8> = (1..=8).collect();
        blocks.extend([0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 2, 0xff, 0xff, 0xff, 0xff]);
        let expect = [
            psin(&blocks),
            empty_pmap(&[(6, 16, 8), (0x1234, 24, 16)], 2),
            EMPTY_SCHEMA.to_vec(),
        ]
        .concat();
        assert_eq!(out, expect);
        assert_eq!(root.bytes, &blocks[8..]);
    }

    #[test]
    fn write_empty_arrays_zero_their_slots() {
        let arrays = vec![
            (
                0,
                Array::Scalars {
                    dtype: 6,
                    bytes: vec![],
                },
            ),
            (12, Array::Structs(vec![])),
        ];
        let mut root = plain_root(vec![0xff; 24], arrays);
        let out = write(&[], &mut root).unwrap();
        assert_eq!(root.bytes, vec![0; 24]);
        let expect = [
            psin(&[0; 24]),
            empty_pmap(&[(0x1234, 16, 24)], 1),
            EMPTY_SCHEMA.to_vec(),
        ]
        .concat();
        assert_eq!(out, expect);
    }

    #[test]
    fn write_scalar_rules() {
        let mut root = plain_root(
            vec![0; 16],
            vec![(
                0,
                Array::Scalars {
                    dtype: 0x50,
                    bytes: vec![1],
                },
            )],
        );
        assert_eq!(
            argument(write(&[], &mut root)),
            "PSO: тип элементов массива не разобран; пока на хосте."
        );

        let mut root = plain_root(
            vec![0; 16],
            vec![(
                0,
                Array::Scalars {
                    dtype: 0x08,
                    bytes: vec![7; 12],
                },
            )],
        );
        let out = write(&[], &mut root).unwrap();
        assert_eq!(root.bytes[..12], [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
        let map = out.windows(4).position(|w| w == b"PMAP").unwrap();
        let first_entry = &out[map + 16..map + 32];
        assert_eq!(
            first_entry,
            [0, 0, 0, 8, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 12]
        );

        let mut root = plain_root(
            vec![0; 16],
            vec![(
                0,
                Array::Scalars {
                    dtype: 0,
                    bytes: vec![0; 70000],
                },
            )],
        );
        write(&[], &mut root).unwrap();
        assert_eq!(
            root.bytes[..12],
            [0, 0, 0, 1, 0, 0, 0, 0, 0x11, 0x70, 0x11, 0x70]
        );
    }

    #[test]
    fn write_big_scalar_block_stays_in_one_chunk() {
        let mut root = plain_root(
            vec![0; 12],
            vec![(
                0,
                Array::Scalars {
                    dtype: 6,
                    bytes: vec![0; 0x10_0008],
                },
            )],
        );
        let out = write(&[], &mut root).unwrap();
        assert_eq!(out.len(), 1_048_672);
        assert_eq!(root.bytes[8..10], [0, 2]);
    }

    #[test]
    fn write_struct_array_goes_into_one_chunk() {
        let item = |fill: u8| Object {
            name: 0x77,
            bytes: vec![fill; 4],
            arrays: vec![],
        };
        let mut root = plain_root(
            vec![0; 12],
            vec![(0, Array::Structs(vec![item(1), item(2)]))],
        );
        let out = write(&[], &mut root).unwrap();
        assert_eq!(root.bytes, [0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 2]);
        let map = out.windows(4).position(|w| w == b"PMAP").unwrap();
        assert_eq!(
            &out[map + 16..map + 32],
            [0, 0, 0, 0x77, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 8]
        );
        assert_eq!(&out[16..24], [1, 1, 1, 1, 2, 2, 2, 2]);
    }

    #[test]
    fn open_block_closes_at_the_limit() {
        let blocks_for = |first: usize| {
            let arrays = vec![
                (
                    0,
                    Array::Scalars {
                        dtype: 6,
                        bytes: vec![0; first],
                    },
                ),
                (
                    12,
                    Array::Scalars {
                        dtype: 6,
                        bytes: vec![0; 4],
                    },
                ),
            ];
            let mut root = plain_root(vec![0; 24], arrays);
            let out = write(&[], &mut root).unwrap();
            let map = out.windows(4).position(|w| w == b"PMAP").unwrap();
            let count = usize::from(u16::from_be_bytes([out[map + 12], out[map + 13]]));
            (
                count,
                root.bytes[0..4].to_vec(),
                root.bytes[12..16].to_vec(),
            )
        };
        // ниже предела второй кусок дописывается в тот же блок
        let (count, first, second) = blocks_for(0x2_0000);
        assert_eq!(
            (count, first, second),
            (2, vec![0, 0, 0, 1], vec![0x20, 0, 0, 1])
        );
        // на пределе открывается новый блок с тем же именем
        let (count, first, second) = blocks_for(BLOCK_LIMIT);
        assert_eq!(
            (count, first, second),
            (3, vec![0, 0, 0, 1], vec![0, 0, 0, 2])
        );
    }

    #[test]
    fn short_object_bytes_are_an_error_on_write() {
        let mut root = plain_root(
            vec![0; 8],
            vec![(
                0,
                Array::Scalars {
                    dtype: 0x0b,
                    bytes: vec![1; 4],
                },
            )],
        );
        assert_eq!(broken(write(&[], &mut root)), MSG_OBJECT_PAST);
    }

    #[test]
    fn schema_pick_follows_blocks_then_enums() {
        let host = parse(one()).unwrap();
        let mut root = host.root_object().unwrap();
        let out = write(&host.elements, &mut root).unwrap();
        let again = parse(&out).unwrap();
        let names: Vec<u32> = again.elements.iter().map(|e| e.name).collect();
        assert_eq!(names, [LINK, ROOT, 0x6452_a05b]);
        // чужой тип в схеме не попадает в выход
        let mut extended = host.elements.clone();
        extended.push(Element {
            name: 0xdead,
            bytes: structure_bytes(4, &[]),
        });
        let mut root = host.root_object().unwrap();
        assert_eq!(write(&extended, &mut root).unwrap(), one());
    }

    #[test]
    fn element_equality() {
        let a = Element {
            name: 1,
            bytes: vec![],
        };
        assert_eq!(a, a.clone());
        assert_eq!(format!("{a:?}"), "Element { name: 1, bytes: [] }");
    }
}
