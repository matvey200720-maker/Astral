//! Чтение RBF (магия `RBF0`): дерево структур с байтовыми блоками.
//! Содержимое «значений» пропускается и отмечается пустым узлом.

use crate::error::{Error, Result};

const MAGIC: [u8; 4] = *b"RBF0";
const TAG_CLOSE: u8 = 0xff;
const TAG_BYTES: u8 = 0xfd;

const MSG_NOT_RBF: &str = "Файл не RBF.";
const MSG_NO_ROOT_END: &str = "RBF: неожиданный конец файла.";
const MSG_CLOSE_TAG: &str = "RBF: ожидался тег закрытия.";
const MSG_CLOSE_ALONE: &str = "RBF: закрытие без открытия.";
const MSG_AFTER_ROOT: &str = "RBF: после корня есть данные.";
const MSG_BYTES_TAG: &str = "RBF: ожидался тег байтов.";
const MSG_BYTES_OUTSIDE: &str = "RBF: байты вне структуры.";
const MSG_UNKNOWN_DESC: &str = "RBF: неизвестный дескриптор.";
const MSG_TYPE_MISMATCH: &str = "RBF: тип данных не совпал с дескриптором.";
const MSG_TYPE_UNSUPPORTED: &str = "RBF: тип данных не поддержан.";
const MSG_TRUNCATED: &str = "RBF: обрыв файла.";
const MSG_VALUE_OUTSIDE: &str = "RBF: значение вне структуры.";

#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    Struct(Struct),
    Bytes(Vec<u8>),
    Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Struct {
    pub name: String,
    pub children: Vec<Node>,
}

/// Глубокое дерево разбирается без рекурсии: порченый файл может вложить структуры
/// на тысячи уровней, и рекурсивный сброс полей положил бы стек потока.
impl Drop for Struct {
    fn drop(&mut self) {
        let mut pending = std::mem::take(&mut self.children);
        while let Some(node) = pending.pop() {
            if let Node::Struct(mut inner) = node {
                pending.append(&mut inner.children);
            }
        }
    }
}

pub fn is_rbf(bytes: &[u8]) -> bool {
    bytes.starts_with(&MAGIC)
}

/// Что лежит после имени дескриптора.
enum Payload {
    Open,
    Skip(usize),
    SkipPrefixed,
    Nothing,
}

fn payload_of(type_code: u8) -> Option<Payload> {
    Some(match type_code {
        0x00 => Payload::Open,
        0x10 | 0x40 => Payload::Skip(4),
        0x20 | 0x30 => Payload::Nothing,
        0x50 => Payload::Skip(12),
        0x60 => Payload::SkipPrefixed,
        _ => return None,
    })
}

struct Cursor<'a> {
    rest: &'a [u8],
}

impl<'a> Cursor<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        if count > self.rest.len() {
            return Err(Error::broken(MSG_TRUNCATED));
        }
        let (head, tail) = self.rest.split_at(count);
        self.rest = tail;
        Ok(head)
    }

    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<usize> {
        let raw = self.take(2)?;
        Ok(usize::from(u16::from_le_bytes([raw[0], raw[1]])))
    }

    fn u32(&mut self) -> Result<usize> {
        let raw = self.take(4)?;
        Ok(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize)
    }
}

pub fn read(bytes: &[u8]) -> Result<Struct> {
    if !is_rbf(bytes) {
        return Err(Error::broken(MSG_NOT_RBF));
    }
    let mut cursor = Cursor {
        rest: &bytes[MAGIC.len()..],
    };
    // Дескрипторы: (имя, тип). Открытые структуры: последняя — текущая.
    let mut descriptors: Vec<(String, u8)> = Vec::new();
    let mut open: Vec<Struct> = Vec::new();

    loop {
        if cursor.rest.is_empty() {
            return Err(Error::broken(MSG_NO_ROOT_END));
        }
        match cursor.byte()? {
            TAG_CLOSE => {
                if cursor.byte()? != TAG_CLOSE {
                    return Err(Error::broken(MSG_CLOSE_TAG));
                }
                let finished = open.pop().ok_or_else(|| Error::broken(MSG_CLOSE_ALONE))?;
                match open.last_mut() {
                    Some(parent) => parent.children.push(Node::Struct(finished)),
                    None if cursor.rest.is_empty() => return Ok(finished),
                    None => return Err(Error::broken(MSG_AFTER_ROOT)),
                }
            }
            TAG_BYTES => {
                if cursor.byte()? != TAG_CLOSE {
                    return Err(Error::broken(MSG_BYTES_TAG));
                }
                let length = cursor.u32()?;
                let block = cursor.take(length)?.to_vec();
                let current = open
                    .last_mut()
                    .ok_or_else(|| Error::broken(MSG_BYTES_OUTSIDE))?;
                current.children.push(Node::Bytes(block));
            }
            index => {
                let index = usize::from(index);
                if index > descriptors.len() {
                    return Err(Error::broken(MSG_UNKNOWN_DESC));
                }
                let type_code = cursor.byte()?;
                if index == descriptors.len() {
                    let name_length = cursor.u16()?;
                    let name = cursor
                        .take(name_length)?
                        .iter()
                        .map(|&b| if b.is_ascii() { char::from(b) } else { '?' })
                        .collect();
                    descriptors.push((name, type_code));
                } else if descriptors[index].1 != type_code {
                    return Err(Error::broken(MSG_TYPE_MISMATCH));
                }
                let payload =
                    payload_of(type_code).ok_or_else(|| Error::broken(MSG_TYPE_UNSUPPORTED))?;
                match payload {
                    Payload::Open => {
                        cursor.take(6)?;
                        open.push(Struct {
                            name: descriptors[index].0.clone(),
                            children: Vec::new(),
                        });
                    }
                    other => {
                        match other {
                            Payload::Skip(count) => {
                                cursor.take(count)?;
                            }
                            Payload::SkipPrefixed => {
                                let count = cursor.u16()?;
                                cursor.take(count)?;
                            }
                            _ => {}
                        }
                        let current = open
                            .last_mut()
                            .ok_or_else(|| Error::broken(MSG_VALUE_OUTSIDE))?;
                        current.children.push(Node::Value);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;

    #[test]
    fn a_very_deep_tree_is_dropped_without_recursion() {
        let mut node = Struct {
            name: "leaf".into(),
            children: vec![Node::Bytes(vec![1, 2, 3])],
        };
        for _ in 0..300_000 {
            node = Struct {
                name: String::new(),
                children: vec![Node::Struct(node), Node::Value],
            };
        }
        drop(node);
    }

    /// Открытие структуры с новым дескриптором: `idx 00 | len | имя | 6 нулей`.
    fn open_new(index: u8, name: &[u8]) -> Vec<u8> {
        let mut out = vec![index, 0];
        out.extend((name.len() as u16).to_le_bytes());
        out.extend(name);
        out.extend([0; 6]);
        out
    }

    fn file(parts: &[&[u8]]) -> Vec<u8> {
        let mut out = b"RBF0".to_vec();
        parts.iter().for_each(|p| out.extend_from_slice(p));
        out
    }

    const CLOSE: &[u8] = &[0xff, 0xff];

    fn message(bytes: &[u8]) -> String {
        let e = read(bytes).unwrap_err();
        assert_eq!(e.kind, Kind::Broken);
        e.message
    }

    fn bare(name: &str, children: Vec<Node>) -> Struct {
        Struct {
            name: name.into(),
            children,
        }
    }

    #[test]
    fn magic_detection() {
        let table: [(&[u8], bool); 5] = [
            (b"RBF0", true),
            (b"RBF", false),
            (b"RBF1", false),
            (b"RBF0xyz", true),
            (b"", false),
        ];
        for (bytes, expected) in table {
            assert_eq!(is_rbf(bytes), expected);
        }
    }

    #[test]
    fn not_rbf_and_truncated_root() {
        assert_eq!(message(b""), "Файл не RBF.");
        assert_eq!(message(b"hello world"), "Файл не RBF.");
        assert_eq!(message(b"RBF0"), "RBF: неожиданный конец файла.");
    }

    #[test]
    fn minimal_file() {
        let bytes = file(&[&open_new(0, b"root"), CLOSE]);
        assert_eq!(read(&bytes).unwrap(), bare("root", vec![]));
        // те же байты, записанные вручную
        let raw = [
            0x52, 0x42, 0x46, 0x30, 0, 0, 4, 0, 0x72, 0x6f, 0x6f, 0x74, 0, 0, 0, 0, 0, 0, 0xff,
            0xff,
        ];
        assert_eq!(read(&raw).unwrap(), bare("root", vec![]));
    }

    #[test]
    fn nested_tree_with_all_value_kinds() {
        let mut body: Vec<u8> = Vec::new();
        body.extend([1, 0x10, 1, 0, b'i', 1, 2, 3, 4]);
        body.extend([2, 0x40, 1, 0, b'f', 1, 2, 3, 4]);
        body.extend([3, 0x20, 1, 0, b'z']);
        body.extend([4, 0x30, 1, 0, b'o']);
        body.extend([5, 0x50, 2, 0, b'v', b'3']);
        body.extend([0; 12]);
        body.extend([6, 0x60, 1, 0, b's', 3, 0, b'a', b'b', b'c']);
        body.extend(open_new(7, b"kid"));
        body.extend([0xfd, 0xff, 3, 0, 0, 0, 9, 8, 7]);
        body.extend([0xfd, 0xff, 0, 0, 0, 0]);
        body.extend(CLOSE);
        body.extend([7, 0, 0, 0, 0, 0, 0, 0]);
        body.extend(CLOSE);
        let bytes = file(&[&open_new(0, b"root"), &body, CLOSE]);

        let mut children = vec![Node::Value; 6];
        children.push(Node::Struct(bare(
            "kid",
            vec![Node::Bytes(vec![9, 8, 7]), Node::Bytes(vec![])],
        )));
        children.push(Node::Struct(bare("kid", vec![])));
        assert_eq!(read(&bytes).unwrap(), bare("root", children));
    }

    #[test]
    fn descriptor_reuse() {
        let bytes = file(&[
            &open_new(0, b"root"),
            &open_new(1, b"kid"),
            CLOSE,
            &[1, 0, 0, 0, 0, 0, 0, 0],
            CLOSE,
            CLOSE,
        ]);
        let kid = || Node::Struct(bare("kid", vec![]));
        assert_eq!(read(&bytes).unwrap(), bare("root", vec![kid(), kid()]));

        let mismatch = file(&[
            &open_new(0, b"root"),
            &open_new(1, b"kid"),
            CLOSE,
            &[1, 0x10],
        ]);
        assert_eq!(
            message(&mismatch),
            "RBF: тип данных не совпал с дескриптором."
        );
        let mismatch = file(&[&open_new(0, b"r"), &[0, 0x10]]);
        assert_eq!(
            message(&mismatch),
            "RBF: тип данных не совпал с дескриптором."
        );
        assert_eq!(
            message(&file(&[&open_new(0, b"r"), &[5, 0, 0, 0]])),
            "RBF: неизвестный дескриптор."
        );
        assert_eq!(
            message(&file(&[&[0xfe, 0, 0, 0]])),
            "RBF: неизвестный дескриптор."
        );
        assert_eq!(message(&file(&[&[0xfe]])), "RBF: неизвестный дескриптор.");
    }

    #[test]
    fn outside_the_root() {
        assert_eq!(
            message(&file(&[&[0, 0x10, 1, 0, b'a', 0, 0, 0, 0]])),
            "RBF: значение вне структуры."
        );
        assert_eq!(
            message(&file(&[&[0xfd, 0xff, 0, 0, 0, 0]])),
            "RBF: байты вне структуры."
        );
        assert_eq!(message(&file(&[CLOSE])), "RBF: закрытие без открытия.");
        assert_eq!(message(&file(&[&[0xff, 0]])), "RBF: ожидался тег закрытия.");
        assert_eq!(message(&file(&[&[0xff]])), "RBF: обрыв файла.");
    }

    #[test]
    fn byte_block_errors() {
        let root = open_new(0, b"root");
        assert_eq!(
            message(&file(&[&root, &[0xfd, 0]])),
            "RBF: ожидался тег байтов."
        );
        assert_eq!(
            message(&file(&[&root, &[0xfd, 0xff, 0xff, 0xff, 0xff, 0xff]])),
            "RBF: обрыв файла."
        );
        assert_eq!(
            message(&file(&[&root, &[0xfd, 0xff, 5, 0, 0, 0, 1, 2]])),
            "RBF: обрыв файла."
        );
    }

    #[test]
    fn root_end_rules() {
        let root = open_new(0, b"root");
        assert_eq!(
            message(&file(&[&root, CLOSE, &[0]])),
            "RBF: после корня есть данные."
        );
        assert_eq!(message(&file(&[&root])), "RBF: неожиданный конец файла.");
        assert_eq!(
            message(&file(&[&root, CLOSE, &root, CLOSE])),
            "RBF: после корня есть данные."
        );
    }

    #[test]
    fn descriptor_type_errors() {
        let root = open_new(0, b"root");
        for t in [0x70u8, 0x01] {
            assert_eq!(
                message(&file(&[&root, &[1, t, 1, 0, b'x']])),
                "RBF: тип данных не поддержан."
            );
        }
        assert_eq!(
            message(&file(&[&root, &[1, 0x10, 1, 0, b'x', 1, 2]])),
            "RBF: обрыв файла."
        );
        assert_eq!(
            message(&file(&[&root, &[1, 0x20, 0xff, 0xff]])),
            "RBF: обрыв файла."
        );
        assert_eq!(message(&file(&[&root, &[1]])), "RBF: обрыв файла.");
    }

    #[test]
    fn names() {
        let bytes = file(&[&open_new(0, &[0xc3, 0xa9]), CLOSE]);
        assert_eq!(read(&bytes).unwrap(), bare("??", vec![]));
        let bytes = file(&[&open_new(0, b""), CLOSE]);
        assert_eq!(read(&bytes).unwrap(), bare("", vec![]));
        let short = file(&[&[0, 0, 1, 0, b'a', 0, 0, 0, 0, 0]]);
        assert_eq!(message(&short), "RBF: обрыв файла.");
    }

    #[test]
    fn descriptor_index_253_is_a_byte_tag() {
        let mut body = open_new(0, b"root");
        for i in 1..=254u32 {
            let name = format!("d{}", i - 1);
            body.extend([i as u8, 0x20]);
            body.extend((name.len() as u16).to_le_bytes());
            body.extend(name.as_bytes());
        }
        assert_eq!(message(&file(&[&body])), "RBF: ожидался тег байтов.");
    }

    #[test]
    fn deep_nesting_is_read_iteratively() {
        let mut body = open_new(0, b"n");
        let mut tail = Vec::new();
        for _ in 0..300 {
            body.extend([0, 0, 0, 0, 0, 0, 0, 0]);
            tail.extend(CLOSE);
        }
        let parsed = read(&file(&[&body, &tail, CLOSE])).unwrap();
        let mut depth = 0;
        let mut node = &parsed;
        while let Some(Node::Struct(next)) = node.children.first() {
            depth += 1;
            node = next;
        }
        assert_eq!(depth, 300);
        assert_eq!(Node::Value, Node::Value);
    }
}
