//! `ycd-from-xml`: словарь клипов `.ycd` из XML в формате CodeWalker.
//!
//! Принимается узкий вид документа: клипы только типа `Animation`, у анимации перечень дорожек
//! `BoneIds` и ровно один блок последовательности, в дорожках каналы `StaticFloat`,
//! `StaticVector3` и `QuantizeFloat`. Остальное отвергается фразой «пока на хосте».

use std::{fmt, fs, path::Path};

use rage_res::{
    hash::sha256_hex,
    ycd::summarize,
    ycd_write::{
        name_hash, new_dictionary, BoneTrack, Channel, ClipProperty, Group, NewAnimation, NewClip,
        NewSequence,
    },
};
use roxmltree::{Document, Node};
use serde_json::{Map, Value};

use super::{readers::summary_json, shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const SLOTS: usize = 4;
const HASH_PREFIX: &str = "hash_";
const XML_FILE: &[&str] = &[".xml"];
const YCD_FILE: &[&str] = &[".ycd"];

// ---------------------------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------------------------

/// Что движок не собирает: хост собрал бы, поэтому слова одни - «пока на хосте».
enum Hosted {
    ClipKind(String),
    AnimationFlag,
    BoneWide,
    TrackWide,
    UnkWide,
    BlockCount,
    BlockHash,
    TrackCount,
    ChannelCount,
    ChannelKind(String),
    AttributeKind(String),
}

impl Hosted {
    fn what(&self) -> String {
        match self {
            Hosted::ClipKind(kind) => format!("клип типа {kind}"),
            Hosted::AnimationFlag => "анимация с Unknown10 не 1".to_owned(),
            Hosted::BoneWide => "кость больше u16".to_owned(),
            Hosted::TrackWide => "дорожка больше u8".to_owned(),
            Hosted::UnkWide => "Unk0 больше u8".to_owned(),
            Hosted::BlockCount => "больше одного блока последовательности".to_owned(),
            Hosted::BlockHash => "блок последовательности с хешем".to_owned(),
            Hosted::TrackCount => "число дорожек не совпадает с BoneIds".to_owned(),
            Hosted::ChannelCount => "больше четырёх каналов в дорожке".to_owned(),
            Hosted::ChannelKind(kind) => format!("канал {kind}"),
            Hosted::AttributeKind(kind) => format!("атрибут свойства клипа {kind}"),
        }
    }
}

/// Отказы разбора документа (все - `InvalidDataException`).
enum Failure<'a> {
    Unreadable,
    Root,
    NoElement(&'a str),
    NoAttribute(&'a str),
    Number,
    NotFinite(&'a str),
    Count,
    ValuesNumber,
    NoAnimation(&'a str),
    NoClips,
    Host(Hosted),
}

impl Failure<'_> {
    fn words(&self) -> String {
        let tail = match self {
            Failure::Unreadable => return "YCD XML не читается.".to_owned(),
            Failure::Root => "корень должен быть ClipDictionary.".to_owned(),
            Failure::NoElement(name) => format!("нет элемента {name}."),
            Failure::NoAttribute(name) => format!("нет атрибута {name}."),
            Failure::Number => "число не читается.".to_owned(),
            Failure::NotFinite(name) => format!("число в {name} не конечное."),
            Failure::Count => "счёт не читается.".to_owned(),
            Failure::ValuesNumber => "число в Values не читается.".to_owned(),
            Failure::NoAnimation(hash) => format!("нет анимации {hash}."),
            Failure::NoClips => "нет ни одного клипа.".to_owned(),
            Failure::Host(what) => format!("{} движком не собирается: пока на хосте.", what.what()),
        };
        format!("YCD XML: {tail}")
    }
}

impl fmt::Display for Failure<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.words())
    }
}

impl From<Failure<'_>> for EngineError {
    fn from(failure: Failure<'_>) -> Self {
        EngineError::invalid_data(failure.words())
    }
}

impl From<Hosted> for EngineError {
    fn from(what: Hosted) -> Self {
        Failure::Host(what).into()
    }
}

// ---------------------------------------------------------------------------------------------
// Элементы документа
// ---------------------------------------------------------------------------------------------

/// Элемент документа с короткими запросами: прямой потомок по локальному имени, список `Item`,
/// обрезанный текст, значение `value`.
#[derive(Clone, Copy)]
struct Tag<'a, 'i>(Node<'a, 'i>);

impl<'a, 'i> Tag<'a, 'i> {
    /// Прямые дочерние элементы с данным локальным именем.
    fn named(self, name: &'static str) -> impl Iterator<Item = Tag<'a, 'i>> {
        self.0
            .children()
            .filter(move |node| node.has_tag_name(name))
            .map(Tag)
    }

    fn child(self, name: &'static str) -> Result<Tag<'a, 'i>> {
        self.named(name)
            .next()
            .ok_or_else(|| Failure::NoElement(name).into())
    }

    fn items(self) -> impl Iterator<Item = Tag<'a, 'i>> {
        self.named("Item")
    }

    /// Все `Item` потомка читаются одной функцией; первая ошибка обрывает чтение.
    fn read_items<T>(self, read: impl Fn(Tag<'a, 'i>) -> Result<T>) -> Result<Vec<T>> {
        self.items().map(read).collect()
    }

    /// Анимация, чей `Hash` (текстом, регистр важен) равен `wanted`.
    fn animation_named(self, wanted: &str) -> Result<Tag<'a, 'i>> {
        let carries = |item: &Tag| item.child("Hash").is_ok_and(|hash| hash.text() == wanted);
        let found = self.items().find(carries);
        found.ok_or_else(|| Failure::NoAnimation(wanted).into())
    }

    fn text(self) -> &'a str {
        self.0.text().unwrap_or_default().trim()
    }

    fn attribute(self, name: &'static str) -> Result<&'a str> {
        self.0
            .attribute(name)
            .ok_or_else(|| Failure::NoAttribute(name).into())
    }

    /// Атрибут `value` вложенного элемента.
    fn value(self, name: &'static str) -> Result<&'a str> {
        self.child(name)?.attribute("value")
    }

    fn float_value(self, name: &'static str) -> Result<f32> {
        read_float(self.value(name)?)
    }

    /// Число, которое обязано быть конечным: `NaN` и бесконечность отказывают с именем поля.
    fn finite_value(self, name: &'static str) -> Result<f32> {
        let number = self.float_value(name)?;
        match number.is_finite() {
            true => Ok(number),
            false => Err(Failure::NotFinite(name).into()),
        }
    }

    fn count_value(self, name: &'static str) -> Result<usize> {
        self.value(name)?.parse().map_err(|_| Failure::Count.into())
    }

    fn hash_text(self, name: &'static str) -> Result<u32> {
        self.child(name).map(|inner| read_hash(inner.text()))
    }
}

fn read_float(text: &str) -> Result<f32> {
    text.parse().map_err(|_| Failure::Number.into())
}

/// `hash_` и шестнадцатеричное `u32` - само значение, всё остальное хешируется как имя.
fn read_hash(text: &str) -> u32 {
    match text
        .strip_prefix(HASH_PREFIX)
        .map(|digits| u32::from_str_radix(digits, 16))
    {
        Some(Ok(value)) => value,
        _ => name_hash(text),
    }
}

/// Целое с проверкой ширины: слишком большое - «пока на хосте».
fn narrow<T: TryFrom<usize>>(count: usize, too_wide: Hosted) -> Result<T> {
    T::try_from(count).map_err(|_| too_wide.into())
}

// ---------------------------------------------------------------------------------------------
// Дорожки, каналы, блок
// ---------------------------------------------------------------------------------------------

fn bone_track(item: Tag) -> Result<BoneTrack> {
    Ok(BoneTrack {
        bone: narrow(item.count_value("BoneId")?, Hosted::BoneWide)?,
        track: narrow(item.count_value("Track")?, Hosted::TrackWide)?,
        unk: narrow(item.count_value("Unk0")?, Hosted::UnkWide)?,
    })
}

/// Три оси `x`, `y`, `z` одного элемента `Value`.
fn vector_value(item: Tag) -> Result<[f32; 3]> {
    let vector = item.child("Value")?;
    let axes = ["x", "y", "z"];
    let mut out = [0.0; 3];
    for (slot, axis) in out.iter_mut().zip(axes) {
        *slot = read_float(vector.attribute(axis)?)?;
    }
    Ok(out)
}

/// `Values` - числа через пробельные знаки.
fn frame_values(item: Tag) -> Result<Vec<f32>> {
    let words = item.child("Values")?.text().split_whitespace();
    words
        .map(|word| word.parse().map_err(|_| Failure::ValuesNumber.into()))
        .collect()
}

fn channel(item: Tag) -> Result<Channel> {
    let kind = item.child("Type")?.attribute("value")?;
    match kind {
        "StaticFloat" => item.float_value("Value").map(Channel::StaticFloat),
        "StaticVector3" => vector_value(item).map(Channel::StaticVector3),
        "QuantizeFloat" => Ok(Channel::Quantize {
            values: frame_values(item)?,
            quantum: item.float_value("Quantum")?,
            offset: item.float_value("Offset")?,
        }),
        other => Err(Hosted::ChannelKind(other.to_owned()).into()),
    }
}

/// Дорожка: до четырёх каналов, канал `i` идёт в слот `i`.
fn group(item: Tag) -> Result<Group> {
    let channels = item.child("Channels")?;
    if channels.items().count() > SLOTS {
        return Err(Hosted::ChannelCount.into());
    }
    let mut pending = channels.read_items(channel)?.into_iter();
    Ok(Group {
        slots: [(); SLOTS].map(|_| pending.next()),
        cached: None,
    })
}

/// Единственный блок последовательности: его число кадров и группы по дорожкам.
struct Block {
    frames: usize,
    groups: Vec<Group>,
}

fn only_block(node: Tag) -> Result<Block> {
    let mut blocks = node.child("Sequences")?.items();
    let (Some(block), None) = (blocks.next(), blocks.next()) else {
        return Err(Hosted::BlockCount.into());
    };
    if !block.child("Hash")?.text().is_empty() {
        return Err(Hosted::BlockHash.into());
    }
    let frames = block.count_value("FrameCount")?;
    let groups = block.child("SequenceData")?.read_items(group)?;
    Ok(Block { frames, groups })
}

fn animation(node: Tag) -> Result<NewAnimation> {
    if node.value("Unknown10")? != "1" {
        return Err(Hosted::AnimationFlag.into());
    }
    let frames = node.count_value("FrameCount")?;
    let bones = node.child("BoneIds")?.read_items(bone_track)?;
    let Block {
        frames: block_frames,
        groups,
    } = only_block(node)?;
    if groups.len() != bones.len() {
        return Err(Hosted::TrackCount.into());
    }
    let sequences = Some(vec![NewSequence {
        frames: block_frames,
        groups,
    }]);
    Ok(NewAnimation {
        hash: node.hash_text("Hash")?,
        signature: node.hash_text("Unknown1C")?,
        duration: node.float_value("Duration")?,
        frames,
        limit: node.count_value("SequenceFrameLimit")?,
        bones,
        groups: Vec::new(),
        sequences,
    })
}

// ---------------------------------------------------------------------------------------------
// Клипы
// ---------------------------------------------------------------------------------------------

/// Атрибут свойства: пишутся только целые (`Int`), остальные виды собирает хост.
fn int_attribute(item: Tag) -> Result<(u32, i32)> {
    let kind = item.value("Type")?;
    if kind != "Int" {
        return Err(Hosted::AttributeKind(kind.to_owned()).into());
    }
    let value = item.value("Value")?.parse().map_err(|_| Failure::Number)?;
    Ok((item.hash_text("NameHash")?, value))
}

fn property(item: Tag) -> Result<ClipProperty> {
    let ints = match item.child("Attributes") {
        Ok(list) => list.read_items(int_attribute)?,
        Err(_) => Vec::new(),
    };
    Ok(ClipProperty { name: item.hash_text("NameHash")?, unk: item.hash_text("UnkHash")?, ints })
}

/// Свойства клипа: пустой или отсутствующий `Properties` — их нет.
fn properties(item: Tag) -> Result<Vec<ClipProperty>> {
    match item.child("Properties") {
        Ok(list) => list.read_items(property),
        Err(_) => Ok(Vec::new()),
    }
}

fn clip(item: Tag, animations: Tag) -> Result<NewClip> {
    let kind = item.value("Type")?;
    if kind != "Animation" {
        return Err(Hosted::ClipKind(kind.to_owned()).into());
    }
    let source = animations.animation_named(item.child("AnimationHash")?.text())?;
    Ok(NewClip {
        hash: item.hash_text("Hash")?,
        name: item.child("Name")?.text().to_owned(),
        start: item.finite_value("StartTime")?,
        end: item.finite_value("EndTime")?,
        rate: item.finite_value("Rate")?,
        properties: properties(item)?,
        animation: animation(source)?,
    })
}

/// Корневой элемент документа обязан называться `ClipDictionary`.
fn dictionary_root<'a, 'i>(document: &'a Document<'i>) -> Result<Tag<'a, 'i>> {
    let root = document.root_element();
    match root.has_tag_name("ClipDictionary") {
        true => Ok(Tag(root)),
        false => Err(Failure::Root.into()),
    }
}

/// Клипы документа: корень, потом `Animations`, потом `Clips`.
fn clips_of(document: &Document) -> Result<Vec<NewClip>> {
    let root = dictionary_root(document)?;
    let animations = root.child("Animations")?;
    let clips = root
        .child("Clips")?
        .read_items(|item| clip(item, animations))?;
    match clips.len() {
        0 => Err(Failure::NoClips.into()),
        _ => Ok(clips),
    }
}

/// Файл XML целиком в клипы.
fn clips_from_file(xml: &Path) -> Result<Vec<NewClip>> {
    let text = fs::read_to_string(xml)?;
    let document = Document::parse(&text).map_err(|_| Failure::Unreadable)?;
    clips_of(&document)
}

/// Ответ команды: файл, длина, сумма и сводка по анимациям собранного словаря.
fn answer(output: &Path, bytes: &[u8]) -> Result<Value> {
    let file = output
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let summary: Vec<Value> = summarize(bytes)?.iter().map(summary_json).collect();
    let mut fields = Map::new();
    fields.insert("file".to_owned(), file.into());
    fields.insert("bytes".to_owned(), bytes.len().into());
    fields.insert("sha256".to_owned(), sha256_hex(bytes).into());
    fields.insert("summary".to_owned(), summary.into());
    Ok(Value::Object(fields))
}

fn run_from_xml(options: &Options, _progress: &Progress) -> Result<Value> {
    let (xml, output) = (
        paths::existing_file(options.required("xml")?, XML_FILE)?,
        paths::output_file(options.required("output")?, YCD_FILE)?,
    );
    let bytes = new_dictionary(&clips_from_file(&xml)?)?;
    write_atomic(&output, &bytes)?;
    answer(&output, &bytes)
}

const FROM_XML: Command = Command::new("ycd-from-xml", run_from_xml);

pub const COMMANDS: &[Command] = &[FROM_XML];

#[cfg(test)]
mod tests;
