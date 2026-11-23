//! Донор: готовая штатная рисовалка Legacy `.ydr` с одним уровнем детализации.
//!
//! У писателя нет сборки модели с нуля: каркас берётся у донора. Модуль открывает донора,
//! считает по образцам вершин его шейдеров наши сетки (`pack*`) и собирает файл (`apply*`):
//! высокая детализация заменяется нашей моделью, шейдеры и словарь текстур остаются донорскими
//! (с точечными правками), листы приходят нашими. Кроме сборки, здесь лежат помощники над
//! графом блоков, которыми пользуются соседние команды движка.

use std::{borrow::Cow, collections::HashMap, ops::Range};

use crate::{
    drawable::{self, FileKind, Material},
    drawable_write::{self as dw, NewGeometry, SignRoot},
    error::{Error, Result},
    hash::joaat,
    resource::Resource,
    resource_graph::{self as rg, Address, Graph, Segment, Slot},
    shader_write::{self, ShaderSpec},
    shaders::{sampler_role, Role},
    texture::TextureRef,
    vertex::{self, Element, Layout},
    ytd_write::{self, Edit, NewTexture},
};

/// Результат шагов, которые отказывают словами `Refusal`.
type Verdict<T> = std::result::Result<T, Refusal>;

// ---------------------------------------------------------------- отказ

/// Строит `pub struct`/`pub enum` с тем же списком производных и полей/вариантов,
/// что обычное объявление — только форма записи другая.
macro_rules! data_type {
    (
        $(#[$meta:meta])*
        $vis:vis struct $name:ident $(<$lt:lifetime>)? {
            $($fvis:vis $field:ident : $ty:ty),* $(,)?
        }
    ) => {
        $(#[$meta])*
        $vis struct $name $(<$lt>)? {
            $($fvis $field: $ty,)*
        }
    };
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($variant:ident $(($($vty:ty),+))?),* $(,)?
        }
    ) => {
        $(#[$meta])*
        $vis enum $name {
            $($variant $(($($vty),+))?,)*
        }
    };
}

data_type! {
    /// Отказ донора. `code` уходит в мост и окно, `Display` — человеку.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum Refusal {
        NotDrawable(String),
        Unsupported(String),
        NoShader(u16),
        NoTexture(u16),
        NoLayout(u16),
        UnknownSheet(String),
        BadMesh(String),
    }
}

impl Refusal {
    /// Коды по порядку вариантов.
    const CODES: [&'static str; 7] = [
        "sign-donor-not-drawable",
        "sign-donor-unsupported",
        "sign-donor-no-shader",
        "sign-donor-no-texture",
        "sign-donor-no-layout",
        "sign-donor-unknown-sheet",
        "sign-mesh-invalid",
    ];

    fn ordinal(&self) -> usize {
        match self {
            Refusal::NotDrawable(_) => 0,
            Refusal::Unsupported(_) => 1,
            Refusal::NoShader(_) => 2,
            Refusal::NoTexture(_) => 3,
            Refusal::NoLayout(_) => 4,
            Refusal::UnknownSheet(_) => 5,
            Refusal::BadMesh(_) => 6,
        }
    }

    pub fn code(&self) -> &'static str {
        Self::CODES[self.ordinal()]
    }

    /// Слова отказа: готовый текст или шаблон с одной подстановкой.
    fn text(&self) -> Cow<'_, str> {
        let (template, subject) = match self {
            Refusal::NotDrawable(text) | Refusal::Unsupported(text) | Refusal::BadMesh(text) => return Cow::Borrowed(text.as_str()),
            Refusal::NoShader(n) => ("Сетка указывает на шейдер {}, которого нет в группе.", n.to_string()),
            Refusal::NoTexture(n) => ("У шейдера {} нет диффузной текстуры.", n.to_string()),
            Refusal::NoLayout(n) => ("У шейдера {} нет образца вершин в рисовалке.", n.to_string()),
            Refusal::UnknownSheet(name) => ("Лист {} не совпадает с текстурой словаря.", name.clone()),
        };
        Cow::Owned(template.replacen("{}", &subject, 1))
    }
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.text())
    }
}

impl std::error::Error for Refusal {}

impl From<Error> for Refusal {
    fn from(error: Error) -> Self {
        Refusal::Unsupported(error.message)
    }
}

fn refuse(text: impl Into<String>) -> Refusal {
    Refusal::Unsupported(text.into())
}

// ---------------------------------------------------------------- постоянные

/// Смещения полей объектов донора.
mod at {
    pub mod root {
        pub const GROUP: usize = 0x10;
        pub const LODS: usize = 0x70;
        pub const LEVEL_FLAGS: usize = 0x80;
        pub const NAME: usize = 0xa8;
        /// Указатель на коллизию, зашитую в саму рисовалку.
        pub const BOUNDS: usize = 0xc8;
    }
    pub mod group {
        pub const DICTIONARY: usize = 0x08;
        pub const LIST: usize = 0x10;
        pub const COUNT: usize = 0x18;
        pub const SIZE: usize = 0x30;
    }
    pub mod shader {
        pub const PARAMS: usize = 0x00;
        pub const NAME: usize = 0x08;
        pub const COUNT: usize = 0x10;
        pub const BUCKET: usize = 0x11;
        pub const FILE: usize = 0x18;
        pub const MASK: usize = 0x20;
    }
    pub mod dict {
        pub const LIST: usize = 0x30;
        pub const COUNT: usize = 0x38;
    }
    pub const TEXTURE_NAME: usize = 0x28;
    /// Слово `UsageData` объекта текстуры: младшие 5 разрядов — вид, остальные — флаги размеров.
    pub const TEXTURE_USAGE: usize = 0x40;
}

/// Флаги использования встроенного листа, как их пишет хост (`UsageFlags(width, height)` у плашки и звезды):
/// `NOT_HALF`, `X32`, `X64`, `X128`, от 512 пикселей по большей стороне ещё `X512`, от 1024 — `X1024`, и всегда `UNK24`.
pub fn host_usage_flags(width: u16, height: u16) -> u32 {
    let side = width.max(height);
    let mut flags = 1u32 | 1 << 7 | 1 << 8 | 1 << 10 | 1 << 24;
    if side >= 512 {
        flags |= 1 << 12;
    }
    if side >= 1024 {
        flags |= 1 << 14;
    }
    flags
}

/// Флаги использования листа модели надписи: как у плашки (`host_usage_flags`), а от 2048 пикселей по большей стороне хост
/// пишет ещё `X2048` (`SignModelCommands.UsageFlags`; у плашки и звезды такой ступени нет).
pub fn sign_usage_flags(width: u16, height: u16) -> u32 {
    let mut flags = host_usage_flags(width, height);
    if width.max(height) >= 2048 {
        flags |= 1 << 16;
    }
    flags
}

/// `UsageData` листа модели надписи: вид `DIFFUSE` и `sign_usage_flags`.
pub fn sign_usage_data(width: u16, height: u16) -> u32 {
    HOST_USAGE_KIND | (sign_usage_flags(width, height) << 5)
}

/// Вид листа у хоста: `TextureUsage.DIFFUSE`.
pub const HOST_USAGE_KIND: u32 = 20;

/// `UsageData` листа, как его пишет хост: вид `DIFFUSE` (младшие 5 разрядов) и флаги размеров (остальные).
pub fn host_usage_data(width: u16, height: u16) -> u32 {
    HOST_USAGE_KIND | (host_usage_flags(width, height) << 5)
}

mod limits {
    pub const MESH_VERTICES: usize = 65_535;
    pub const COORDINATE: f32 = 4000.0;
    /// Корзины донора обязаны влезать в маску из восьми разрядов.
    pub const BUCKETS: u8 = 8;
}

mod tint {
    pub const WHITE: [u8; 4] = [255, 255, 255, 255];
    pub const FLYER: [u8; 4] = [255, 255, 0, 255];
}

/// Заголовок отдельного словаря текстур: версия 13 и флаги областей `ytd`.
mod ytd_header {
    pub const VERSION: u32 = 13;
    pub const SYSTEM_FLAGS: u32 = 131_072;
    pub const GRAPHICS_FLAGS: u32 = 3_489_792_000;
}

/// Слова отказов, которые повторяются в нескольких местах.
mod words {
    pub const LAYOUT_UNSUPPORTED: &str = "Раскладка вершин образца не поддержана: пока не собирается.";
    pub const LAYOUT_GAPS: &str = "Раскладка вершин образца с промежутками: пока не собирается.";
    pub const NO_MESHES: &str = "Нет сеток для записи.";
    pub const SKIN_COUNT: &str = "Весов не столько, сколько вершин сетки.";
    pub const FIELD: &str = "Поле шейдера вне блока.";
    pub const HASH: &str = "Хеш параметра вне сегмента.";
    pub const SAMPLER: &str = "Сэмплер вне сегмента.";
    pub const NO_DICTIONARY: &str = "У группы нет словаря текстур.";
    pub const OUTSIDE: &str = "Блок вне графа.";
    pub const TEMPLATE_OUTSIDE: &str = "Образец вне графа.";
    pub const NO_NAME_SLOT: &str = "В блоке нет указателя по этому смещению.";
}

// ---------------------------------------------------------------- числа и рамки

/// Число так, как его пишет и читает XML хоста (`0.######`): не больше шести знаков после
/// точки, округление «от нуля» по седьмому знаку десятичной записи.
pub fn xml_float(value: f32) -> f32 {
    if !value.is_finite() || value.fract() == 0.0 {
        return value;
    }
    let spelled = value.abs().to_string();
    let (whole, fraction) = spelled.split_once('.').unwrap_or((spelled.as_str(), ""));
    if fraction.len() <= 6 {
        return value;
    }
    // Число в миллионных долях: шесть знаков дроби, плюс единица, если седьмой знак от пяти.
    let digits: Vec<u64> = fraction.bytes().take(7).map(|b| u64::from(b - b'0')).collect();
    let mut frac = 0u64;
    for &d in &digits[..6] {
        frac = frac * 10 + d;
    }
    let millionths = whole.parse::<u64>().unwrap_or(0) * 1_000_000 + frac + u64::from(digits[6] >= 5);
    let sign = if value.is_sign_negative() { "-" } else { "" };
    format!("{sign}{}.{:06}", millionths / 1_000_000, millionths % 1_000_000).parse().unwrap_or(value)
}

/// Число так, как `float.ToString("0.######")` у .NET 8 пишет его в XML модели надписи: сначала семь значащих цифр
/// точного значения (у `float` для своего формата .NET берёт ровно семь), потом не больше шести знаков после точки
/// (по цифрам, «от нуля»). У чисел от 10 по модулю это жёстче `xml_float`: `177.89119` хост читает как `177.8912`.
pub fn seven_digits(value: f32) -> f32 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    // «d.dddddde±x»: семь цифр и десятичный порядок.
    let spelled = format!("{:.6e}", value.abs());
    let Some((mantissa, exponent)) = spelled.split_once('e') else { return value };
    let (Ok(exponent), Ok(digits)) = (exponent.parse::<i32>(), mantissa.replace('.', "").parse::<u64>()) else { return value };
    let sign = if value.is_sign_negative() { "-" } else { "" };
    // Число — `digits` × 10^(exponent - 6). От единицы вес последней цифры не меньше миллионной доли: округлять нечего.
    if exponent >= 0 {
        return format!("{sign}{digits}e{}", exponent - 6).parse().unwrap_or(value);
    }
    // Меньше единицы: в миллионных долях это `digits` / 10^(-exponent), округление по цифре «от нуля».
    let micros = if exponent < -8 {
        0
    } else {
        let step = 10u64.pow((-exponent) as u32);
        digits / step + u64::from(digits % step * 2 >= step)
    };
    format!("{sign}{micros}e-6").parse().unwrap_or(value)
}

/// Как округляются числа перед записью в модель: так, как пишет XML хоста у остальных моделей (`Places6`: `xml_float`), или так,
/// как у модели надписи (`Seven`: `seven_digits`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Round {
    Places6,
    Seven,
}

impl Round {
    pub fn apply(self, value: f32) -> f32 {
        match self {
            Round::Places6 => xml_float(value),
            Round::Seven => seven_digits(value),
        }
    }
}

/// Рамка по трём осям. Пустая рамка перевёрнута: минимум — `MAX`, максимум — `MIN`.
#[derive(Clone, Copy)]
struct Bounds {
    low: [f32; 3],
    high: [f32; 3],
}

impl Bounds {
    const EMPTY: Bounds = Bounds { low: [f32::MAX; 3], high: [f32::MIN; 3] };

    /// Расширяет рамку другой по осям; `NaN` не принимается в расчёт.
    fn absorb(&mut self, other: Bounds) {
        self.low.iter_mut().zip(other.low).for_each(|(mine, theirs)| *mine = mine.min(theirs));
        self.high.iter_mut().zip(other.high).for_each(|(mine, theirs)| *mine = mine.max(theirs));
    }

    fn rounded_by(self, round: Round) -> ([f32; 3], [f32; 3]) {
        (self.low.map(|v| round.apply(v)), self.high.map(|v| round.apply(v)))
    }
}

fn widen(bounds: &mut Bounds, point: [f32; 3]) {
    bounds.absorb(Bounds { low: point, high: point });
}

/// Корень рисовалки по рамке: сфера вокруг центра, всё через `xml_float`.
pub fn root_of(min: [f32; 3], max: [f32; 3], mask: u8, lod: Option<f32>, geometries: usize) -> SignRoot {
    root_of_by(Round::Places6, min, max, mask, lod, geometries)
}

/// То же с правилом округления `round`.
pub fn root_of_by(round: Round, min: [f32; 3], max: [f32; 3], mask: u8, lod: Option<f32>, geometries: usize) -> SignRoot {
    let centre: [f32; 3] = std::array::from_fn(|axis| (min[axis] + max[axis]) * 0.5);
    let reach = centre.iter().zip(&max).map(|(c, m)| (c - m) * (c - m)).sum::<f32>().sqrt();
    let min_xml = min.map(|v| round.apply(v));
    let max_xml = max.map(|v| round.apply(v));
    let centre_xml = centre.map(|v| round.apply(v));
    let radius = round.apply(reach);
    let lod_xml = lod.map(|v| round.apply(v));
    let render_word = dw::sign_render_word(geometries);
    SignRoot { min: min_xml, max: max_xml, centre: centre_xml, radius, mask, lod: lod_xml, render_word, box_w_follows_x: false }
}

// ---------------------------------------------------------------- сетка

data_type! {
    /// Наша сетка: номер шейдера донора, вершины `[x y z nx ny nz u v]`, треугольники.
    #[derive(Debug, Clone, PartialEq)]
    pub struct Mesh {
        pub shader: u16,
        pub vertices: Vec<[f32; 8]>,
        pub indices: Vec<u16>,
    }
}

/// Сетка обязана укладываться в пределы: размер, координаты, индексы (в таком порядке).
pub fn check_mesh(mesh: &Mesh) -> Verdict<()> {
    let count = mesh.vertices.len();
    let wrong_size = || !(3..=limits::MESH_VERTICES).contains(&count) || mesh.indices.len() < 3 || mesh.indices.len() % 3 != 0;
    let wild_vertex = || mesh.vertices.iter().flatten().any(|v| !v.is_finite() || v.abs() > limits::COORDINATE);
    let stray_index = || mesh.indices.iter().any(|&i| usize::from(i) >= count);
    let rules: [(&dyn Fn() -> bool, &str); 3] = [
        (&wrong_size, "Размер сетки вне предела: нужны 3…65535 вершин и целые треугольники."),
        (&wild_vertex, "Вершина сетки вне предела."),
        (&stray_index, "Индекс сетки вне вершин."),
    ];
    match rules.iter().find(|(violated, _)| violated()) {
        Some((_, text)) => Err(Refusal::BadMesh((*text).to_string())),
        None => Ok(()),
    }
}

// ---------------------------------------------------------------- вершины

/// Элементы раскладки по возрастанию смещения (при равных — по номеру семантики).
pub fn ordered_elements(layout: &Layout) -> Vec<(usize, Element)> {
    let mut found: Vec<(usize, Element)> = Vec::new();
    for semantic in 0..16 {
        if let Some(element) = layout.get(semantic) {
            found.push((semantic, element));
        }
    }
    found.sort_unstable_by_key(|&(semantic, element)| (element.offset, semantic));
    found
}

data_type! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Skin {
        pub bones: [u8; 4],
        pub weights: [u8; 4],
    }
}

data_type! {
    #[derive(Debug, Clone, PartialEq)]
    pub struct SkinnedMesh {
        pub mesh: Mesh,
        pub skin: Vec<Skin>,
    }
}

/// Чем заполняются элементы вершины, которых нет среди её чисел: кости с весами и цвет; и как округляются числа вершины.
#[derive(Clone, Copy)]
struct Dress<'a> {
    skin: Option<&'a Skin>,
    colour: [u8; 4],
    round: Round,
    /// Правило модели надписи: элементы, для которых нет чисел, хост дописывает сам (вторая развёртка, второй цвет, касательная).
    fills: bool,
}

/// Номера семантик, которых нет среди `vertex::*`: развёртки с третьей по восьмую и касательная.
const FIRST_EXTRA_UV: usize = 8;
const LAST_EXTRA_UV: usize = 13;
const TANGENT: usize = 14;

impl Dress<'_> {
    const PLAIN: Dress<'static> = Dress { skin: None, colour: tint::WHITE, round: Round::Places6, fills: false };
    /// Вершины модели надписи: числа до семи цифр, недостающие элементы — как у хоста.
    const SIGN: Dress<'static> = Dress { skin: None, colour: tint::WHITE, round: Round::Seven, fills: true };

    /// Что хост кладёт в элемент модели надписи, для которого у него нет чисел: белый второй цвет (`255 255 255 255`),
    /// касательная вдоль X (`1 0 0 1`), у лишних развёрток — та же развёртка, что у первой.
    fn fill(&self, out: &mut Vec<u8>, values: &[f32; 8], semantic: usize, kind: u8) -> bool {
        match (semantic, kind) {
            (vertex::COLOUR1, vertex::COLOUR) => out.extend_from_slice(&tint::WHITE),
            (TANGENT, vertex::FLOAT4) => out.extend([1.0f32, 0.0, 0.0, 1.0].iter().flat_map(|x| x.to_le_bytes())),
            (FIRST_EXTRA_UV..=LAST_EXTRA_UV, vertex::FLOAT2) => out.extend(values[6..8].iter().flat_map(|&x| self.round.apply(x).to_le_bytes())),
            _ => return false,
        }
        true
    }

    /// Четыре байта для элемента цветового типа данной семантики.
    fn bytes(&self, semantic: usize) -> Option<[u8; 4]> {
        match semantic {
            vertex::BLEND_WEIGHTS => self.skin.map(|skin| skin.weights),
            vertex::BLEND_INDICES => self.skin.map(|skin| skin.bones),
            vertex::COLOUR0 => Some(self.colour),
            _ => None,
        }
    }
}

/// Какие числа вершины идут в элемент: (семантика, тип данных) → срез `[f32; 8]`.
const FLOAT_FEED: [(usize, u8, Range<usize>); 4] = [
    (vertex::POSITION, vertex::FLOAT3, 0..3),
    (vertex::NORMAL, vertex::FLOAT3, 3..6),
    (vertex::UV0, vertex::FLOAT2, 6..8),
    (vertex::UV1, vertex::FLOAT2, 6..8),
];

/// Дописывает элемент вершины; `false`, если для пары (семантика, тип) нет источника.
fn emit(out: &mut Vec<u8>, values: &[f32; 8], semantic: usize, kind: u8, dress: &Dress) -> bool {
    if kind == vertex::COLOUR {
        return dress.bytes(semantic).map(|bytes| out.extend_from_slice(&bytes)).is_some() || (dress.fills && dress.fill(out, values, semantic, kind));
    }
    let source = FLOAT_FEED.iter().find(|(s, k, _)| *s == semantic && *k == kind);
    match source {
        Some((_, _, range)) => {
            out.extend(values[range.clone()].iter().flat_map(|&x| dress.round.apply(x).to_le_bytes()));
            true
        }
        None => dress.fills && dress.fill(out, values, semantic, kind),
    }
}

/// Вершина по раскладке: элементы идут в порядке среза, записанное до отказа остаётся в `out`.
fn put_vertex(out: &mut Vec<u8>, values: &[f32; 8], layout: &[(usize, Element)], dress: &Dress) -> Verdict<()> {
    layout
        .iter()
        .all(|&(semantic, element)| emit(out, values, semantic, element.type_code, dress))
        .then_some(())
        .ok_or_else(|| refuse(words::LAYOUT_UNSUPPORTED))
}

/// Дописывает в `out` вершину по раскладке.
pub fn pack_vertex(out: &mut Vec<u8>, values: &[f32; 8], layout: &[(usize, Element)]) -> Verdict<()> {
    put_vertex(out, values, layout, &Dress::PLAIN)
}

pub fn pack_vertex_skinned(out: &mut Vec<u8>, values: &[f32; 8], skin: &Skin, layout: &[(usize, Element)]) -> Verdict<()> {
    pack_vertex_skinned_colour(out, values, skin, layout, tint::WHITE)
}

pub fn pack_vertex_skinned_colour(out: &mut Vec<u8>, values: &[f32; 8], skin: &Skin, layout: &[(usize, Element)], colour: [u8; 4]) -> Verdict<()> {
    put_vertex(out, values, layout, &Dress { skin: Some(skin), colour, round: Round::Places6, fills: false })
}

/// Образец раскладки вершины: шаг декларации и элементы по порядку смещений.
struct Pattern {
    stride: usize,
    elements: Vec<(usize, Element)>,
}

impl Pattern {
    fn of(graph: &Graph, geometry: usize) -> Option<Pattern> {
        let (stride, layout) = dw::geometry_layout(graph, geometry)?;
        Some(Pattern { stride, elements: ordered_elements(&layout) })
    }

    /// Элементы без промежутков: их размеры дают шаг.
    fn gapless(&self) -> bool {
        self.elements.iter().map(|(_, element)| element.size).sum::<usize>() == self.stride
    }
}

/// Сетка в геометрию по образцу; `label` — номер шейдера в геометрии и в отказе.
/// Вторым идёт неокруглённая рамка вершин.
fn build_geometry<'s>(graph: &Graph, template: usize, mesh: &Mesh, label: u16, round: Round, dressing: &dyn Fn(usize) -> Dress<'s>) -> Verdict<(NewGeometry, Bounds)> {
    check_mesh(mesh)?;
    if template >= graph.blocks.len() {
        return Err(refuse(words::TEMPLATE_OUTSIDE));
    }
    let pattern = Pattern::of(graph, template).ok_or(Refusal::NoLayout(label))?;
    if !pattern.gapless() {
        return Err(refuse(words::LAYOUT_GAPS));
    }
    let mut bytes = Vec::with_capacity(pattern.stride * mesh.vertices.len());
    mesh.vertices.iter().enumerate().try_for_each(|(i, v)| put_vertex(&mut bytes, v, &pattern.elements, &dressing(i)))?;
    let mut seen = Bounds::EMPTY;
    for v in &mesh.vertices {
        widen(&mut seen, [v[0], v[1], v[2]]);
    }
    let (min, max) = seen.rounded_by(round);
    Ok((NewGeometry { vertices: bytes, indices: mesh.indices.clone(), shader: label, min, max }, seen))
}

/// Сетка в геометрию по образцу `template` (номер блока в графе); следом — неокруглённые минимум и максимум.
pub fn pack_geometry(graph: &Graph, template: usize, mesh: &Mesh) -> Verdict<(NewGeometry, [f32; 3], [f32; 3])> {
    let (geometry, seen) = build_geometry(graph, template, mesh, mesh.shader, Round::Places6, &|_| Dress::PLAIN)?;
    Ok((geometry, seen.low, seen.high))
}

/// То же по правилам модели надписи: числа вершины и рамки до семи цифр (`seven_digits`), недостающие элементы раскладки
/// (второй цвет, касательная, лишние развёртки) дописываются, как у хоста. Так собирается штатная модель с новыми сетками.
pub fn pack_sign_geometry(graph: &Graph, template: usize, mesh: &Mesh) -> Verdict<(NewGeometry, [f32; 3], [f32; 3])> {
    let (geometry, seen) = build_geometry(graph, template, mesh, mesh.shader, Round::Seven, &|_| Dress::SIGN)?;
    Ok((geometry, seen.low, seen.high))
}

// ---------------------------------------------------------------- чтение графа

fn field_gap() -> Error {
    Error::broken(words::FIELD)
}

/// Номер блока должен быть номером блока этого графа: чужой отказывает, а не роняет чтение.
fn within(graph: &Graph, block: usize) -> Result<()> {
    if block < graph.blocks.len() {
        Ok(())
    } else {
        Err(Error::broken(words::OUTSIDE))
    }
}

fn byte_in(graph: &Graph, block: usize, offset: usize) -> Result<u8> {
    graph.content(block).get(offset).copied().ok_or_else(field_gap)
}

fn word_in(graph: &Graph, block: usize, offset: usize) -> Result<u32> {
    let raw = graph.content(block).get(offset..offset + 4).ok_or_else(field_gap)?;
    Ok(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]))
}

/// Блок, на который указывает слот `offset` блока `from`.
fn follow(graph: &Graph, from: usize, offset: usize) -> Option<usize> {
    rg::pointer_from(graph, from, offset).and_then(|address| graph.block_at(address))
}

/// Список шейдеров группы: блок списка, смещение начала в нём и число шейдеров.
struct Roster {
    block: usize,
    base: usize,
    count: usize,
}

impl Roster {
    fn of(graph: &Graph, group: usize) -> Result<Option<Roster>> {
        within(graph, group)?;
        let Some(address) = rg::pointer_from(graph, group, at::group::LIST) else { return Ok(None) };
        let Some(block) = graph.block_at(address) else { return Ok(None) };
        let count = u16::from_le_bytes([byte_in(graph, group, at::group::COUNT)?, byte_in(graph, group, at::group::COUNT + 1)?]);
        Ok(Some(Roster { block, base: address.offset - graph.blocks[block].start, count: usize::from(count) }))
    }

    fn nth(&self, graph: &Graph, index: usize) -> Option<usize> {
        follow(graph, self.block, self.base + index * 8)
    }
}

/// Параметры шейдера: типы записей и место таблицы хешей имён в байтах области.
struct ParamTable {
    block: usize,
    kinds: Vec<u8>,
    hashes_at: usize,
}

impl ParamTable {
    fn of(graph: &Graph, shader: usize) -> Result<Option<ParamTable>> {
        within(graph, shader)?;
        let Some(address) = rg::pointer_from(graph, shader, at::shader::PARAMS) else { return Ok(None) };
        let count = usize::from(byte_in(graph, shader, at::shader::COUNT)?);
        let Some(block) = graph.block_at(address) else { return Ok(None) };
        let mut kinds = Vec::with_capacity(count);
        for k in 0..count {
            kinds.push(byte_in(graph, block, k * 16)?);
        }
        // Данные идут по 16 байт на единицу типа; таблица хешей — сразу за ними.
        let data: usize = kinds.iter().map(|&kind| 16 * usize::from(kind)).sum();
        Ok(Some(ParamTable { block, kinds, hashes_at: graph.blocks[block].start + count * 16 + data }))
    }

    /// Хеш имени параметра `k`: читается из области целиком, а не из содержимого блока.
    fn hash(&self, graph: &Graph, k: usize, gap: &'static str) -> Result<u32> {
        let start = self.hashes_at + 4 * k;
        let raw = graph.bytes(graph.blocks[self.block].segment).get(start..start + 4).ok_or_else(|| Error::broken(gap))?;
        Ok(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]))
    }

    fn data(&self, graph: &Graph, k: usize) -> Option<Address> {
        rg::pointer_from(graph, self.block, k * 16 + 8)
    }

    /// Сколько байт блока параметров нужно скопировать, чтобы унести и таблицу хешей.
    fn span(&self, graph: &Graph) -> usize {
        self.hashes_at + 4 * self.kinds.len() - graph.blocks[self.block].start
    }

    /// Номер первой записи, которую признал `accept(тип, чтение хеша)`.
    fn first(&self, graph: &Graph, gap: &'static str, mut accept: impl FnMut(u8, &dyn Fn() -> Result<u32>) -> Result<bool>) -> Result<Option<usize>> {
        for (k, &kind) in self.kinds.iter().enumerate() {
            if accept(kind, &|| self.hash(graph, k, gap))? {
                return Ok(Some(k));
            }
        }
        Ok(None)
    }
}

/// Параметры шейдера `shader` группы; `None`, если чего-то на пути нет.
fn table_of(graph: &Graph, group: usize, shader: usize) -> Result<Option<ParamTable>> {
    let Some(roster) = Roster::of(graph, group)? else { return Ok(None) };
    if shader >= roster.count {
        return Ok(None);
    }
    match roster.nth(graph, shader) {
        Some(block) => ParamTable::of(graph, block),
        None => Ok(None),
    }
}

/// Первое совпадение хеша среди параметров шейдера: тип записи и адрес данных.
pub fn shader_param(graph: &Graph, group: usize, shader: usize, wanted: u32) -> Result<Option<(u8, Address)>> {
    let Some(table) = table_of(graph, group, shader)? else { return Ok(None) };
    let hit = table.first(graph, words::HASH, |_, hash| Ok(hash()? == wanted))?;
    Ok(hit.and_then(|k| table.data(graph, k).map(|address| (table.kinds[k], address))))
}

/// Объект диффузной текстуры шейдера: первая запись-текстура с диффузным сэмплером.
pub fn diffuse_texture(graph: &Graph, group: usize, shader: usize) -> Result<Option<Address>> {
    let Some(table) = table_of(graph, group, shader)? else { return Ok(None) };
    let hit = table.first(graph, words::SAMPLER, |kind, hash| Ok(kind == 0 && sampler_role(hash()?) == Some(Role::Diffuse)))?;
    Ok(hit.and_then(|k| table.data(graph, k)))
}

data_type! {
    /// Запись описи шейдера группы: хеши имени и файла, корзина, маска, параметры `(хеш, тип)`.
    #[derive(Debug, Clone, PartialEq)]
    pub struct ShaderEntry {
        pub name: u32,
        pub file: u32,
        pub bucket: u8,
        pub mask: u32,
        pub params: Vec<(u32, u8)>,
    }
}

fn inventory_entry(graph: &Graph, block: usize) -> Result<ShaderEntry> {
    let name = word_in(graph, block, at::shader::NAME)?;
    let file = word_in(graph, block, at::shader::FILE)?;
    let bucket = byte_in(graph, block, at::shader::BUCKET)?;
    let mask = word_in(graph, block, at::shader::MASK)?;
    let params = match ParamTable::of(graph, block)? {
        Some(table) => {
            let mut found = Vec::with_capacity(table.kinds.len());
            for k in 0..table.kinds.len() {
                found.push((table.hash(graph, k, words::HASH)?, table.kinds[k]));
            }
            found
        }
        None => Vec::new(),
    };
    Ok(ShaderEntry { name, file, bucket, mask, params })
}

/// Опись шейдеров группы.
pub fn shader_inventory(graph: &Graph, group: usize) -> Result<Vec<ShaderEntry>> {
    let Some(roster) = Roster::of(graph, group)? else { return Ok(Vec::new()) };
    (0..roster.count)
        .map(|index| {
            let block = roster.nth(graph, index).ok_or_else(|| Error::broken("Пустой шейдер в группе."))?;
            inventory_entry(graph, block)
        })
        .collect()
}

fn listing_gap(text: &str) -> Error {
    Error::broken(format!("словарь текстур: {text}"))
}

/// Шаг по указателю: адрес цели и её блок; `texts` — отказ «указателя нет» и «цель вне блоков».
fn hop(graph: &Graph, from: usize, offset: usize, texts: [&str; 2]) -> Result<(Address, usize)> {
    let address = rg::pointer_from(graph, from, offset).ok_or_else(|| listing_gap(texts[0]))?;
    let block = graph.block_at(address).ok_or_else(|| listing_gap(texts[1]))?;
    Ok((address, block))
}

/// Имя от адреса до первого нуля или до конца блока с именем.
fn name_at(graph: &Graph, address: Address, block: usize) -> String {
    let raw = &graph.bytes(address.segment)[address.offset..graph.blocks[block].end];
    String::from_utf8_lossy(raw.split(|&b| b == 0).next().unwrap_or(raw)).into_owned()
}

/// Листы словаря текстур: имя и адрес объекта, в порядке списка словаря.
pub fn texture_objects(graph: &Graph, dictionary: Address) -> Result<Vec<(String, Address)>> {
    let dict = graph.block_at(dictionary).ok_or_else(|| listing_gap("словарь вне блоков."))?;
    let no_list = "у словаря нет списка текстур.";
    let (_, list) = hop(graph, dict, at::dict::LIST, [no_list, no_list])?;
    // Число листов лежит в системной области по смещению блока словаря, даже если блок графический.
    let count_at = graph.blocks[dict].start + at::dict::COUNT;
    let count = graph.system.get(count_at..count_at + 2).map_or(0, |raw| usize::from(u16::from_le_bytes([raw[0], raw[1]])));
    (0..count)
        .map(|i| {
            let (object, texture) = hop(graph, list, i * 8, ["пустая запись списка текстур.", "текстура вне блоков."])?;
            let (name, name_block) = hop(graph, texture, at::TEXTURE_NAME, ["у текстуры нет имени.", "имя текстуры вне блоков."])?;
            Ok((name_at(graph, name, name_block), object))
        })
        .collect()
}

/// Переводит все указатели с `old` на `new` без проверок; байты областей не трогает.
pub fn redirect(graph: &mut Graph, old: Address, new: Address) {
    for slot in graph.blocks.iter_mut().flat_map(|block| block.slots.iter_mut()) {
        if slot.target == old {
            slot.target = new;
        }
    }
}

// ---------------------------------------------------------------- правки графа

fn valid_name(name: &str) -> bool {
    (1..=63).contains(&name.len()) && name.bytes().all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_'))
}

/// Блок «строка и нуль» в конце системной области; возвращает адрес его начала.
fn text_block(graph: &mut Graph, text: &str) -> Address {
    let mut bytes = text.as_bytes().to_vec();
    bytes.push(0);
    let block = rg::append_block(graph, Segment::System, bytes, Vec::new());
    head_of(graph, block)
}

/// Дописывает новое имя и перенацеливает на него указатель `offset` блока `block`.
fn rename_at(graph: &mut Graph, block: usize, offset: usize, text: &str) -> Result<()> {
    // Блок и указатель проверяются до дописывания имени: отказ не оставляет в графе лишнего блока.
    within(graph, block)?;
    if !graph.blocks[block].slots.iter().any(|slot| slot.relative == offset) {
        return Err(Error::broken(words::NO_NAME_SLOT));
    }
    let target = text_block(graph, text);
    rg::retarget(graph, block, offset, target)
}

pub fn rename_external_texture(graph: &mut Graph, texture: Address, name: &str) -> Result<()> {
    if !valid_name(name) {
        return Err(Error::argument("Имя внешней текстуры: строчные буквы, цифры и «_», до 63 символов."));
    }
    let block = graph.block_at(texture).ok_or_else(|| Error::broken("Текстура вне блоков."))?;
    rename_at(graph, block, at::TEXTURE_NAME, name)
}

/// Смещение массива хешей имён листов в блоке словаря текстур.
const DICTIONARY_HASHES: usize = 0x20;

/// Пишет в массив хешей словаря рисовалки хеши настоящих имён листов (`joaat`) в порядке списка. Переименование внешнего листа
/// (`rename_external_texture`) меняет имя в объекте текстуры, а массив хранит хеш прежнего имени; хост пишет хеш настоящего.
/// Листов несколько — порядок обязан остаться по возрастанию хеша (по нему игра ищет лист), иначе отказ.
pub fn refresh_dictionary_hashes(graph: &mut Graph) -> Result<()> {
    let root = graph.root().ok_or_else(|| Error::broken("Рисовалка без корня."))?;
    let group = follow(graph, root, at::root::GROUP).ok_or_else(|| Error::broken("У рисовалки нет группы шейдеров."))?;
    let dictionary = rg::pointer_from(graph, group, at::group::DICTIONARY).ok_or_else(|| Error::broken(words::NO_DICTIONARY))?;
    let sheets = texture_objects(graph, dictionary)?;
    let hashes: Vec<u32> = sheets.iter().map(|(name, _)| joaat(name)).collect();
    if hashes.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(Error::broken("Листы словаря идут не по возрастанию хеша."));
    }
    let block = graph.block_at(dictionary).ok_or_else(|| Error::broken(words::OUTSIDE))?;
    let array = rg::pointer_from(graph, block, DICTIONARY_HASHES).ok_or_else(|| Error::broken("У словаря нет массива хешей."))?;
    let holder = graph.block_at(array).ok_or_else(|| Error::broken(words::OUTSIDE))?;
    let first = array.offset - graph.blocks[holder].start;
    for (at, hash) in hashes.iter().enumerate() {
        rg::write_at(graph, holder, first + 4 * at, &hash.to_le_bytes())?;
    }
    Ok(())
}

fn rename_model(graph: &mut Graph, root: usize, name: &str, suffix: &str) -> Result<()> {
    if !valid_name(name) {
        return Err(Error::argument("Имя модели: строчные буквы, цифры и «_», до 63 символов."));
    }
    rename_at(graph, root, at::root::NAME, &format!("{name}{suffix}"))
}

/// Имя модели с суффиксом `.#dr`.
pub fn rename_drawable(graph: &mut Graph, root: usize, name: &str) -> Result<()> {
    rename_model(graph, root, name, ".#dr")
}

/// Имя модели как есть.
pub fn rename_drawable_plain(graph: &mut Graph, root: usize, name: &str) -> Result<()> {
    rename_model(graph, root, name, "")
}

fn head_of(graph: &Graph, block: usize) -> Address {
    let b = &graph.blocks[block];
    Address { segment: b.segment, offset: b.start }
}

/// Копия блока вместе с указателями — в конец той же области.
fn clone_block(graph: &mut Graph, block: usize) -> usize {
    let segment = graph.blocks[block].segment;
    let bytes = graph.content(block).to_vec();
    let slots = graph.blocks[block].slots.clone();
    rg::append_block(graph, segment, bytes, slots)
}

/// Словарь текстур группы как отдельный файл `ytd`: подграф словаря с заголовком словаря.
fn dictionary_as_ytd(graph: &Graph, dictionary: Address) -> Result<Vec<u8>> {
    let mut part = rg::subgraph(graph, dictionary)?;
    part.declared_version = ytd_header::VERSION;
    part.system_flags = ytd_header::SYSTEM_FLAGS;
    part.graphics_flags = ytd_header::GRAPHICS_FLAGS;
    dw::finish(&part)
}

// ---------------------------------------------------------------- открытие донора

/// Разборщик файла донора: порядок шагов задаёт порядок отказов.
struct Survey {
    materials: Vec<Option<Material>>,
    textures: Vec<TextureRef>,
    graph: Graph,
    root: usize,
}

impl Survey {
    /// Ресурс читается, это рисовалка `ydr`, материалы и граф разобраны, корень есть.
    fn open(bytes: &[u8]) -> Verdict<Survey> {
        let Ok(resource) = Resource::parse(bytes) else {
            return Err(Refusal::NotDrawable("Донор не читается как ресурс.".into()));
        };
        let is_ydr = drawable::kind_of(&resource) == Some(FileKind::Ydr);
        if !is_ydr {
            return Err(Refusal::NotDrawable("Донор — не рисовалка ydr.".into()));
        }
        let (_, materials, textures) = drawable::read_materials(&resource, 0)?;
        let graph = dw::graph_of(bytes)?;
        let root = graph.root().ok_or_else(|| Refusal::NotDrawable("У донора нет корня.".into()))?;
        Ok(Survey { materials, textures, graph, root })
    }

    /// Корзины шейдеров группы: один уровень, группа есть, корзины в маске, материалы по числу шейдеров.
    fn buckets(&self) -> Verdict<Vec<u8>> {
        if dw::has_lower_levels(&self.graph, self.root)? {
            return Err(refuse("Донор с уровнями Medium/Low: такая модель пока не собирается."));
        }
        let buckets = dw::shader_buckets(&self.graph, self.root)?.ok_or_else(|| refuse("У донора нет группы шейдеров."))?;
        if buckets.iter().any(|&bucket| bucket >= limits::BUCKETS) {
            return Err(refuse("Корзина шейдера донора вне маски."));
        }
        if self.materials.len() != buckets.len() {
            return Err(refuse("Материалы донора не совпадают с группой шейдеров."));
        }
        Ok(buckets)
    }

    /// Образцы вершин: первая геометрия High с каждым номером шейдера.
    fn templates(&self) -> Verdict<HashMap<u16, usize>> {
        Ok(dw::high_geometry_templates(&self.graph, self.root)?)
    }

    /// Диффузное имя каждого шейдера группы.
    fn diffuse(&self) -> Vec<Option<String>> {
        self.materials.iter().map(|material| material.as_ref().and_then(|m| m.textures.get(&Role::Diffuse).cloned())).collect()
    }

    /// Имена листов, встроенных в рисовалку.
    fn sheets(&self) -> Vec<String> {
        self.textures.iter().map(|texture| texture.name.clone()).collect()
    }
}

pub struct Donor {
    graph: Graph,
    root: usize,
    /// Объединённая маска `1 << корзина` по всем шейдерам группы.
    mask: u8,
    /// Диффузное имя каждого шейдера группы.
    diffuse: Vec<Option<String>>,
    /// Имена листов, встроенных в рисовалку.
    sheets: Vec<String>,
    /// Первая геометрия High с данным номером шейдера: образец раскладки.
    templates: HashMap<u16, usize>,
    /// Как округляются числа сборки: прежнее правило `Places6` или правило хоста `Seven` (`with_round`).
    round: Round,
    /// Страничная добивка последнего блока системной области не идёт в готовую модель (`without_page_padding`).
    tight: bool,
}

impl Donor {
    pub fn open(bytes: &[u8]) -> Verdict<Donor> {
        let survey = Survey::open(bytes)?;
        let buckets = survey.buckets()?;
        let templates = survey.templates()?;
        let (diffuse, sheets) = (survey.diffuse(), survey.sheets());
        let mut mask = 0u8;
        for &bucket in &buckets {
            mask |= 1 << bucket;
        }
        Ok(Donor { graph: survey.graph, root: survey.root, mask, diffuse, sheets, templates, round: Round::Places6, tight: false })
    }

    /// Правило округления чисел сборки (вершины, рамки, дальности, свечение пресета). Без вызова — `Places6`; команды,
    /// которые пишут XML хоста (`0.######`, у `float` семь значащих цифр), берут `Round::Seven`. Модель надписи правило
    /// `Seven` несёт сама.
    pub fn with_round(mut self, round: Round) -> Donor {
        self.round = round;
        self
    }

    /// Модель без страничной добивки: у донора и у каждого приклеиваемого словаря листов последний блок системной области
    /// теряет нулевой хвост (`trim_tail_padding`). Файл игры дописывает страницу до конца, и последний блок (описание вершин
    /// на 16 байт, строка имени, хвост словаря) «вмещает» 4–11 КБ нулей: каждый такой хвост тянул в готовую модель лишнюю
    /// страницу, а хост кладёт блоки вплотную.
    pub fn without_page_padding(mut self) -> Donor {
        trim_tail_padding(&mut self.graph);
        self.tight = true;
        self
    }

    /// Шаг вершины образца и его элементы по порядку смещений.
    pub fn template_layout(&self, shader: u16) -> Option<(usize, Vec<(usize, Element)>)> {
        let pattern = Pattern::of(&self.graph, *self.templates.get(&shader)?)?;
        Some((pattern.stride, pattern.elements))
    }

    pub fn diffuse_name(&self, shader: u16) -> Option<&str> {
        self.diffuse.get(usize::from(shader))?.as_deref()
    }

    /// Шейдер сетки обязан быть в группе и иметь диффузное имя.
    fn check_shader(&self, shader: u16) -> Verdict<()> {
        let Some(entry) = self.diffuse.get(usize::from(shader)) else {
            return Err(Refusal::NoShader(shader));
        };
        if entry.is_none() {
            return Err(Refusal::NoTexture(shader));
        }
        Ok(())
    }

    fn template_of(&self, shader: u16) -> Verdict<usize> {
        self.templates.get(&shader).copied().ok_or(Refusal::NoLayout(shader))
    }
}

// ---------------------------------------------------------------- страничная добивка

/// Срезает нулевой хвост у последнего блока системной области: блок сохраняет всё до последнего ненулевого байта (слова
/// указателей считаются занятыми), округлённое вверх до 16. Слова блока и указатели на него не трогаются: указатель на
/// начало блока остаётся верным, а указатель внутрь срезанного хвоста сюда не попадает (хвост — одни нули и ни одного начала
/// блока: границы блоков идут по целям указателей).
fn trim_tail_padding(graph: &mut Graph) {
    let Some(&last) = graph.segment_blocks(Segment::System).last() else { return };
    let block = &graph.blocks[last];
    let length = block.end - block.start;
    let mut body = graph.content(last).to_vec();
    let words = block.slots.iter().map(|slot| slot.relative + 8).max().unwrap_or(0);
    for slot in block.slots.iter().filter(|slot| slot.relative + 8 <= length) {
        body[slot.relative..slot.relative + 8].fill(0);
    }
    let used = body.iter().rposition(|&byte| byte != 0).map_or(0, |at| at + 1).max(words).max(1);
    let kept = used.next_multiple_of(rg::ALIGN).min(length);
    graph.blocks[last].end = graph.blocks[last].start + kept;
}

// ---------------------------------------------------------------- сборка геометрий

/// Посчитанные геометрии и корень, готовые лечь в донора.
#[derive(Debug, Clone)]
pub struct Packed {
    pub geometries: Vec<NewGeometry>,
    pub root: SignRoot,
    pub vertices: usize,
}

/// Что и как считать в `pack*`: одно описание на все варианты.
enum Plan<'a> {
    /// Сетки по своим шейдерам: рамка (если задана), отступ геометрий, отступ корня.
    Meshes { meshes: &'a [Mesh], frame: Option<([f32; 3], [f32; 3])>, around: f32, root_around: f32 },
    /// Сетки по своим шейдерам с заданным цветом вершин (звезда арены: хост пишет `255 255 0 255`).
    Tinted { meshes: &'a [Mesh], colour: [u8; 4] },
    /// Сетки с костями и весами по своим шейдерам.
    Skinned(&'a [SkinnedMesh]),
    /// Летающая модель: номер шейдера сборки у сетки, один образец, рамка и маска заданы.
    Flyer { meshes: &'a [(u16, SkinnedMesh)], layout: u16, bounds: ([f32; 3], [f32; 3]), mask: u8 },
    /// Новая модель надписи: у сетки номер шейдера запроса (его в донорской группе может не быть), вершины идут по образцу
    /// `layout`, цвет вершин белый, а маска корзин посчитана по шейдерам запроса.
    Sign { meshes: &'a [Mesh], layout: u16, mask: u8 },
}

/// Одна сетка в работе: сама, кости (если есть), номер шейдера сборки (если задан).
struct Entry<'a> {
    mesh: &'a Mesh,
    skin: Option<&'a [Skin]>,
    shading: Option<u16>,
}

/// Правила обхода сеток, выведенные из `Plan`.
struct Rules {
    /// Шейдер сетки проверяется по группе донора.
    gate: bool,
    /// Образец вершин задан вызывающим, а не номером шейдера сетки.
    sample: Option<u16>,
    colour: [u8; 4],
    frame: Option<([f32; 3], [f32; 3])>,
    /// Отступы (геометрии, корня); без них корень берёт рамку вершин как есть.
    pad: Option<(f32, f32)>,
    /// Рамка корня и геометрий задана заранее.
    pinned: Option<([f32; 3], [f32; 3])>,
    mask: u8,
    round: Round,
}

impl<'a> Plan<'a> {
    fn entries(&self) -> Vec<Entry<'a>> {
        match self {
            Plan::Meshes { meshes, .. } | Plan::Tinted { meshes, .. } => meshes.iter().map(|mesh| Entry { mesh, skin: None, shading: None }).collect(),
            Plan::Skinned(items) => items.iter().map(|item| Entry { mesh: &item.mesh, skin: Some(&item.skin), shading: None }).collect(),
            Plan::Flyer { meshes, .. } => meshes.iter().map(|(shading, item)| Entry { mesh: &item.mesh, skin: Some(&item.skin), shading: Some(*shading) }).collect(),
            Plan::Sign { meshes, .. } => meshes.iter().map(|mesh| Entry { mesh, skin: None, shading: Some(mesh.shader) }).collect(),
        }
    }

    fn rules(&self, donor_mask: u8, round: Round) -> Rules {
        let base = Rules { gate: true, sample: None, colour: tint::WHITE, frame: None, pad: None, pinned: None, mask: donor_mask, round };
        match *self {
            Plan::Meshes { frame, around, root_around, .. } => Rules { frame, pad: Some((around, root_around)), ..base },
            Plan::Tinted { colour, .. } => Rules { pad: Some((0.0, 0.0)), colour, ..base },
            Plan::Skinned(_) => base,
            Plan::Flyer { layout, bounds, mask, .. } => Rules { gate: false, sample: Some(layout), colour: tint::FLYER, pinned: Some(bounds), mask, ..base },
            Plan::Sign { layout, mask, .. } => Rules { gate: false, sample: Some(layout), pad: Some((0.0, 0.0)), mask, round: Round::Seven, ..base },
        }
    }
}

impl Donor {
    fn pack_plan(&self, plan: Plan, lod: Option<f32>) -> Verdict<Packed> {
        let entries = plan.entries();
        let rules = plan.rules(self.mask, self.round);
        if entries.is_empty() {
            return Err(refuse(words::NO_MESHES));
        }
        if let Some(layout) = rules.sample.filter(|&layout| self.template_layout(layout).is_none()) {
            return Err(Refusal::NoLayout(layout));
        }
        let mut root_frame = Bounds::EMPTY;
        let mut geometries = Vec::with_capacity(entries.len());
        for entry in &entries {
            let mesh = entry.mesh;
            if rules.gate {
                self.check_shader(mesh.shader)?;
            }
            if entry.skin.is_some_and(|skin| skin.len() != mesh.vertices.len()) {
                return Err(refuse(words::SKIN_COUNT));
            }
            let shader = rules.sample.unwrap_or(mesh.shader);
            let template = self.template_of(shader)?;
            let dressing = |i: usize| Dress { skin: entry.skin.map(|skin| &skin[i]), colour: rules.colour, round: rules.round, fills: rules.round == Round::Seven };
            let (mut geometry, seen) = build_geometry(&self.graph, template, mesh, shader, rules.round, &dressing)?;
            geometry.shader = entry.shading.unwrap_or(geometry.shader);
            match (rules.pinned, rules.pad) {
                (Some(pinned), _) => {
                    (geometry.min, geometry.max) = Bounds { low: pinned.0, high: pinned.1 }.rounded_by(rules.round);
                }
                (None, Some((around, root_around))) => {
                    let frame = rules.frame.map_or_else(
                        || Bounds { low: seen.low.map(|v| v - around), high: seen.high.map(|v| v + around) },
                        |(low, high)| Bounds { low, high },
                    );
                    if rules.frame.is_some() || around != 0.0 {
                        (geometry.min, geometry.max) = frame.rounded_by(rules.round);
                    }
                    root_frame.absorb(Bounds { low: frame.low.map(|v| v - root_around), high: frame.high.map(|v| v + root_around) });
                }
                (None, None) => root_frame.absorb(seen),
            }
            geometries.push(geometry);
        }
        let shown = rules.pinned.map_or(root_frame, |(low, high)| Bounds { low, high });
        let vertices = entries.iter().map(|entry| entry.mesh.vertices.len()).sum();
        let root = root_of_by(rules.round, shown.low, shown.high, rules.mask, lod, geometries.len());
        Ok(Packed { geometries, root, vertices })
    }

    pub fn pack(&self, meshes: &[Mesh], lod: Option<f32>) -> Verdict<Packed> {
        self.pack_plan(Plan::Meshes { meshes, frame: None, around: 0.0, root_around: 0.0 }, lod)
    }

    /// Как `pack`, но цвет вершин задан (звезда арены: хост пишет `255 255 0 255`, плашка — белый).
    pub fn pack_tinted(&self, meshes: &[Mesh], lod: Option<f32>, colour: [u8; 4]) -> Verdict<Packed> {
        self.pack_plan(Plan::Tinted { meshes, colour }, lod)
    }

    pub fn pack_bounded(&self, meshes: &[Mesh], lod: Option<f32>, bounds: Option<([f32; 3], [f32; 3])>) -> Verdict<Packed> {
        self.pack_plan(Plan::Meshes { meshes, frame: bounds, around: 0.0, root_around: 0.0 }, lod)
    }

    pub fn pack_with_margin(&self, meshes: &[Mesh], lod: Option<f32>, margin: f32) -> Verdict<Packed> {
        self.pack_plan(Plan::Meshes { meshes, frame: None, around: margin, root_around: 0.0 }, lod)
    }

    pub fn pack_with_root_margin(&self, meshes: &[Mesh], lod: Option<f32>, root_margin: f32) -> Verdict<Packed> {
        self.pack_plan(Plan::Meshes { meshes, frame: None, around: 0.0, root_around: root_margin }, lod)
    }

    pub fn pack_skinned(&self, meshes: &[SkinnedMesh], lod: Option<f32>) -> Verdict<Packed> {
        self.pack_plan(Plan::Skinned(meshes), lod)
    }

    /// Летающая модель: у каждой сетки свой номер шейдера сборки, а вершины идут по образцу `layout`.
    pub fn pack_flyer(&self, meshes: &[(u16, SkinnedMesh)], layout: u16, bounds: ([f32; 3], [f32; 3]), mask: u8, lod: Option<f32>) -> Verdict<Packed> {
        self.pack_plan(Plan::Flyer { meshes, layout, bounds, mask }, lod)
    }

    /// Новая модель надписи: у каждой сетки номер шейдера запроса (`Mesh::shader`), вершины идут по образцу шейдера `layout`
    /// донора, маска корзин задана вызывающим (по шейдерам запроса); рамка корня — по вершинам, как у хоста.
    pub fn pack_sign(&self, meshes: &[Mesh], layout: u16, mask: u8, lod: Option<f32>) -> Verdict<Packed> {
        self.pack_plan(Plan::Sign { meshes, layout, mask }, lod)
    }
}

// ---------------------------------------------------------------- сборка файла

/// Что поменять на готовой модели: имя, текстуру, силу свечения.
#[derive(Debug, Clone, PartialEq)]
pub struct Look {
    pub model: Option<String>,
    pub texture: Option<String>,
    pub emissive: Option<f32>,
}

/// Шейдер новой модели надписи: пресет хоста (имя, файл, корзина, свечение), `HardAlphaBlend` и имя листа, на который он смотрит.
/// Лист — встроенный (его имя среди листов модели) либо внешний (лист словаря архетипа, у модели его нет).
#[derive(Debug, Clone, PartialEq)]
pub struct SignShader {
    pub spec: ShaderSpec,
    pub hard_alpha: f32,
    pub texture: String,
}

/// Грань фасада: лист по имени, светится ли она, четыре вершины.
#[derive(Debug, Clone, PartialEq)]
pub struct OverlayFace {
    pub texture: String,
    pub emissive: bool,
    pub vertices: [[f32; 8]; 4],
}

/// Вид грани фасада: по какому шейдеру донора брать образец и что хост пишет в копию.
struct FaceKind {
    sample: u16,
    file: u32,
    bucket: u8,
    mask: u32,
    param: &'static str,
    value: f32,
}

/// Обычная грань и светящаяся: индекс — признак `emissive`.
const FACE_KINDS: [FaceKind; 2] = [
    FaceKind { sample: 1, file: 0x5B38_0B60, bucket: 3, mask: 0xFF08, param: "wetnessMultiplier", value: 0.15 },
    FaceKind { sample: 0, file: 0x557D_B6E4, bucket: 0, mask: 0xFF01, param: "emissiveMultiplier", value: 1.35 },
];

/// Два треугольника на четыре вершины грани.
const QUAD: [u16; 6] = [0, 1, 2, 0, 2, 3];

impl OverlayFace {
    fn kind(&self) -> &'static FaceKind {
        &FACE_KINDS[usize::from(self.emissive)]
    }
}

/// Грани фасада и порядок шейдеров выхода: сначала обычные, потом светящиеся.
struct Facade<'a> {
    faces: &'a [OverlayFace],
    order: Vec<usize>,
}

impl<'a> Facade<'a> {
    fn new(faces: &'a [OverlayFace]) -> Facade<'a> {
        let mut order: Vec<usize> = (0..faces.len()).collect();
        order.sort_by_key(|&face| faces[face].emissive);
        Facade { faces, order }
    }

    /// Сетки граней с числами как в запросе: округляет их запись вершины (`Dress::round`), а рамки геометрий и корня хост считает
    /// от исходных чисел плоскостей, не от округлённых.
    fn meshes(&self) -> Vec<Mesh> {
        let mesh_of = |face: &OverlayFace| Mesh { shader: face.kind().sample, vertices: face.vertices.to_vec(), indices: QUAD.to_vec() };
        self.faces.iter().map(mesh_of).collect()
    }

    /// Место каждой грани в порядке выхода.
    fn ranks(&self) -> Vec<u16> {
        let mut ranks = vec![0u16; self.faces.len()];
        self.order.iter().enumerate().for_each(|(place, &face)| ranks[face] = place as u16);
        ranks
    }
}

/// Как называется модель при записи имени.
#[derive(Clone, Copy)]
enum NameStyle {
    /// Любая строка как есть.
    Stored,
    /// Строчное имя с суффиксом `.#dr`.
    Suffixed,
    /// Строчное имя без суффикса.
    Plain,
}

/// Этап сборки; `Bench::run` исполняет этапы по порядку.
enum Stage<'a> {
    SwapModel(Option<&'a [u16]>),
    NameModel(NameStyle, &'a str),
    EmbedSheets(&'a [NewTexture]),
    RenameSheets(&'a [NewTexture], &'a str),
    RenameDiffuse(&'a str),
    SetEmission(f32),
    RememberDiffuse,
    ReplaceDictionary(&'a NewTexture),
    GlowVectors(f32),
    /// Листы под своими именами вместо листа донора: словарь пересобирается, записи встают по хешам имён.
    EmbedNamed { sheets: &'a [NewTexture], donor_sheet: &'a str },
    /// Шейдеры летающей модели: копии образца `layout` по пресетам, у каждого свой лист из словаря.
    FlyerShaders { sheets: &'a [NewTexture], layout: u16, shaders: &'a [(ShaderSpec, usize)], round: Round },
    FacadeShaders(&'a Facade<'a>),
    /// Словарь из листов модели и шейдеры по пресетам хоста; образец шейдера и раскладки — шейдер `layout` донора.
    SignGroup { shaders: &'a [SignShader], sheets: &'a [NewTexture], layout: u16 },
    /// Только размер группы: словаря у модели без листов нет (у хоста в XML нет `TextureDictionary`).
    SizeGroup,
    CloseGroup,
    SetLevels(f32),
    /// Флаги использования встроенных листов — как у хоста (`host_usage_data`).
    HostUsage(&'a [NewTexture]),
    /// То же по правилу модели надписи (`sign_usage_data`: от 2048 пикселей ещё `X2048`).
    SignUsage(&'a [NewTexture]),
    /// Вектор шейдера 0 по имени, все четыре числа.
    SetVector(&'static str, [f32; 4]),
    /// Байт 1 строк шапки параметров с текстурой у каждого шейдера группы — 02, как пишет хост (у шейдера игры там 00).
    HostTextureRows,
    /// Коллизия донора в выход не идёт: хост собирает модель без неё.
    DropBounds,
    /// Имя рисовалки донора в выход не идёт (рисовалка словаря `ydd` имени не несёт).
    DropName,
}

/// Чем кончается сборка.
enum Ending {
    /// Собрать, перечитать, сверить геометрии с `Packed` и наличие листов.
    Reread(Vec<String>),
    /// Только собрать.
    Compact,
}

impl Donor {
    /// Общий конвейер всех `apply*`: рабочая копия графа, этапы по порядку, концовка.
    fn assemble(&self, packed: &Packed, stages: Vec<Stage<'_>>, ending: Ending) -> Verdict<Vec<u8>> {
        let mut bench = Bench::of(self);
        stages.into_iter().try_for_each(|stage| bench.run(stage, packed))?;
        match ending {
            Ending::Reread(sheets) => bench.seal(packed, &sheets),
            Ending::Compact => dw::finish_compact(&bench.graph).map_err(|_| refuse("Файл не собран.")),
        }
    }

    /// Листы без переименований: как `apply_model` без имени модели и текстуры.
    pub fn apply(&self, packed: &Packed, sheets: &[NewTexture]) -> Verdict<Vec<u8>> {
        self.apply_model(packed, sheets, None, None)
    }

    pub fn apply_model(&self, packed: &Packed, sheets: &[NewTexture], model: Option<&str>, texture: Option<&str>) -> Verdict<Vec<u8>> {
        if let Some(stranger) = sheets.iter().find(|sheet| !self.sheets.iter().any(|own| own.eq_ignore_ascii_case(&sheet.name))) {
            return Err(Refusal::UnknownSheet(stranger.name.clone()));
        }
        let stages = [Some(Stage::SwapModel(None)), model.map(|name| Stage::NameModel(NameStyle::Stored, name)), Some(Stage::EmbedSheets(sheets)), texture.map(|name| Stage::RenameSheets(sheets, name))];
        let expected = sheets.iter().map(|sheet| texture.map_or_else(|| sheet.name.clone(), str::to_string)).collect();
        self.assemble(packed, stages.into_iter().flatten().collect(), Ending::Reread(expected))
    }

    /// Плашка эмблемы и звезда арены: как `apply_model`, а флаги использования листа и `HardAlphaBlend` — как у хоста
    /// (его XML пишет `NOT_HALF, X32, X64, X128, … UNK24` и `HardAlphaBlend` 1; донор хранит свои значения).
    pub fn apply_hosted(&self, packed: &Packed, sheets: &[NewTexture], model: Option<&str>, texture: Option<&str>) -> Verdict<Vec<u8>> {
        if let Some(stranger) = sheets.iter().find(|sheet| !self.sheets.iter().any(|own| own.eq_ignore_ascii_case(&sheet.name))) {
            return Err(Refusal::UnknownSheet(stranger.name.clone()));
        }
        let stages = [
            Some(Stage::SwapModel(None)),
            model.map(|name| Stage::NameModel(NameStyle::Stored, name)),
            Some(Stage::EmbedSheets(sheets)),
            Some(Stage::HostUsage(sheets)),
            texture.map(|name| Stage::RenameSheets(sheets, name)),
            Some(Stage::SetVector("HardAlphaBlend", [1.0, 0.0, 0.0, 0.0])),
            Some(Stage::HostTextureRows),
            // Размер группы в 16-байтных единицах: хост пишет его у каждой модели (у донора там своё число).
            Some(Stage::CloseGroup),
        ];
        let expected = sheets.iter().map(|sheet| texture.map_or_else(|| sheet.name.clone(), str::to_string)).collect();
        self.assemble(packed, stages.into_iter().flatten().collect(), Ending::Reread(expected))
    }

    /// Готовая модель с новым именем, текстурой и силой свечения; листы не встраиваются.
    pub fn apply_look(&self, packed: &Packed, look: &Look) -> Verdict<Vec<u8>> {
        let stages = [
            Some(Stage::SwapModel(None)),
            look.model.as_deref().map(|name| Stage::NameModel(NameStyle::Suffixed, name)),
            look.texture.as_deref().map(Stage::RenameDiffuse),
            look.emissive.map(|power| Stage::SetEmission(self.round.apply(power))),
            Some(Stage::HostTextureRows),
            Some(Stage::CloseGroup),
        ];
        self.assemble(packed, stages.into_iter().flatten().collect(), Ending::Reread(Vec::new()))
    }

    /// Светящаяся метка: словарь группы заменяется одним нашим листом, шесть векторов шейдера 0 переписываются.
    pub fn apply_glow(&self, packed: &Packed, sheet: &NewTexture, model: &str, multiplier: f32) -> Verdict<Vec<u8>> {
        let stages = vec![
            Stage::SwapModel(None),
            Stage::NameModel(NameStyle::Plain, model),
            Stage::RememberDiffuse,
            Stage::CloseGroup,
            Stage::ReplaceDictionary(sheet),
            Stage::HostUsage(std::slice::from_ref(sheet)),
            Stage::GlowVectors(multiplier),
        ];
        self.assemble(packed, stages, Ending::Reread(vec![sheet.name.clone()]))
    }

    /// Фасады «Мегамолла»: на каждую грань свой шейдер-копия с внешней текстурой.
    pub fn apply_overlay(&self, faces: &[OverlayFace], lod: f32) -> Verdict<Vec<u8>> {
        self.overlay(faces, lod, None)
    }

    /// То же под именем набора: у корня имя `<имя>.#dr`, как у рисовалки хоста (донорское имя в выход не идёт).
    pub fn apply_overlay_named(&self, faces: &[OverlayFace], lod: f32, name: &str) -> Verdict<Vec<u8>> {
        self.overlay(faces, lod, Some(name))
    }

    fn overlay(&self, faces: &[OverlayFace], lod: f32, name: Option<&str>) -> Verdict<Vec<u8>> {
        let facade = Facade::new(faces);
        let meshes = facade.meshes();
        let mut packed = self.pack_plan(Plan::Meshes { meshes: &meshes, frame: None, around: 0.0, root_around: 0.1 }, Some(lod))?;
        packed.geometries.iter_mut().zip(facade.ranks()).for_each(|(geometry, rank)| geometry.shader = rank);
        // Четвёртое число рамок геометрий хост Мегамолла пишет равным x (`Vector4Element`).
        packed.root.box_w_follows_x = true;
        let samples: Vec<u16> = meshes.iter().map(|mesh| mesh.shader).collect();
        let stages = [
            Some(Stage::SwapModel(Some(&samples))),
            name.map(|text| Stage::NameModel(NameStyle::Suffixed, text)),
            Some(Stage::FacadeShaders(&facade)),
            Some(Stage::HostTextureRows),
            Some(Stage::CloseGroup),
            Some(Stage::SetLevels(lod)),
        ];
        self.assemble(&packed, stages.into_iter().flatten().collect(), Ending::Compact)
    }

    /// Летающая модель (дирижабль, звезда с движением и звезда на шейдерах пресетов): шейдеры по пресетам, листы под своими
    /// именами, имя модели. `shaders` — пресет и номер листа в `sheets`; словарь донора теряет лист образца `layout` и все
    /// прочие листы и становится словарём `sheets`, как у хоста: имена настоящие, хеши в массиве настоящие и по возрастанию.
    pub fn apply_flyer_sheets(&self, packed: &Packed, shaders: &[(ShaderSpec, usize)], layout: u16, sheets: &[NewTexture], model: &str) -> Verdict<Vec<u8>> {
        if shaders.is_empty() || shaders.len() > usize::from(u16::MAX) {
            return Err(refuse("Число шейдеров модели вне предела."));
        }
        if sheets.is_empty() || shaders.iter().any(|(_, sheet)| *sheet >= sheets.len()) {
            return Err(refuse("У шейдера нет листа среди листов модели."));
        }
        let donor_sheet = self.diffuse_name(layout).ok_or(Refusal::NoTexture(layout))?;
        let samples = vec![layout; packed.geometries.len()];
        let stages = vec![
            Stage::SwapModel(Some(&samples)),
            Stage::NameModel(NameStyle::Stored, model),
            Stage::EmbedNamed { sheets, donor_sheet },
            Stage::HostUsage(sheets),
            Stage::FlyerShaders { sheets, layout, shaders, round: self.round },
            Stage::DropBounds,
            Stage::CloseGroup,
        ];
        self.assemble(packed, stages, Ending::Reread(sheets.iter().map(|sheet| sheet.name.clone()).collect()))
    }

    /// Новая модель надписи на каркасе донора: геометрии `packed` (`pack_sign`), встроенные листы `sheets` в новом словаре,
    /// шейдеры по пресетам хоста со своими листами, имя модели (если задано); коллизия донора в выход не идёт.
    pub fn apply_sign(&self, packed: &Packed, shaders: &[SignShader], sheets: &[NewTexture], layout: u16, model: Option<&str>) -> Verdict<Vec<u8>> {
        let expected = sheets.iter().map(|sheet| sheet.name.clone()).collect();
        let samples = vec![layout; packed.geometries.len()];
        let stages = Self::sign_stages(&samples, shaders, sheets, layout, model.map_or(Naming::Dropped, Naming::Named))?;
        self.assemble(packed, stages, Ending::Reread(expected))
    }

    /// То же, но без сборки файла: готовый граф рисовалки, который встаёт в словарь `ydd` на место прежней (корень графа — рисовалка).
    /// Имя `Naming::Dropped` убирает имя донора: у рисовалки словаря его нет.
    pub fn sign_drawable_graph(&self, packed: &Packed, shaders: &[SignShader], sheets: &[NewTexture], layout: u16, naming: Naming<'_>) -> Verdict<Graph> {
        let samples = vec![layout; packed.geometries.len()];
        let stages = Self::sign_stages(&samples, shaders, sheets, layout, naming)?;
        let mut bench = Bench::of(self);
        stages.into_iter().try_for_each(|stage| bench.run(stage, packed))?;
        Ok(bench.graph)
    }

    fn sign_stages<'a>(samples: &'a [u16], shaders: &'a [SignShader], sheets: &'a [NewTexture], layout: u16, naming: Naming<'a>) -> Verdict<Vec<Stage<'a>>> {
        if shaders.is_empty() || shaders.len() > usize::from(u16::MAX) {
            return Err(refuse("Число шейдеров модели вне предела."));
        }
        let stages = [
            Some(Stage::SwapModel(Some(samples))),
            match naming {
                Naming::Named(name) => Some(Stage::NameModel(NameStyle::Stored, name)),
                Naming::Dropped => Some(Stage::DropName),
            },
            Some(Stage::SignGroup { shaders, sheets, layout }),
            (!sheets.is_empty()).then_some(Stage::SignUsage(sheets)),
            Some(Stage::DropBounds),
            Some(Stage::SizeGroup),
        ];
        Ok(stages.into_iter().flatten().collect())
    }
}

/// Имя новой рисовалки: своё или никакого (у рисовалки словаря `ydd` имени в файле нет).
#[derive(Clone, Copy)]
pub enum Naming<'a> {
    Named(&'a str),
    Dropped,
}

/// Имя рисовалки по указателю корня; `None`, если указателя нет.
pub fn drawable_name(graph: &Graph, root: usize) -> Option<String> {
    let address = rg::pointer_from(graph, root, at::root::NAME)?;
    let block = graph.block_at(address)?;
    Some(name_at(graph, address, block))
}

// ---------------------------------------------------------------- верстак

/// Чьими словами отказывать при записи вектора шейдера.
#[derive(Clone, Copy)]
enum Voice {
    Look,
    Glow,
    Overlay,
}

impl Voice {
    /// Тексты: параметра нет, не вектор, вне блоков, не записан.
    fn lines(self, name: &str) -> [String; 4] {
        match self {
            Voice::Look => [format!("У донора нет {name}."), format!("{name} донора — не вектор."), "Вектор свечения вне блоков.".to_string(), "Свечение не записано.".to_string()],
            Voice::Glow => [
                format!("У донора нет параметра {name}."),
                format!("Параметр {name} донора — не вектор."),
                format!("Параметр {name} вне блоков."),
                format!("Параметр {name} не записан."),
            ],
            Voice::Overlay => [format!("У шейдера нет {name}."), format!("{name} — не вектор."), "Вектор вне блоков.".to_string(), "Значение параметра не записано.".to_string()],
        }
    }
}

/// Шесть векторов светящейся метки в порядке записи; у "emissiveMultiplier"
/// первое число — заготовка, его подставляет `glow_vectors`.
const GLOW_TABLE: [(&str, [f32; 4]); 6] = [
    ("matMaterialColorScale", [1.0, 0.0, 0.0, 1.0]),
    ("HardAlphaBlend", [1.0, 0.0, 0.0, 0.0]),
    ("useTessellation", [0.0; 4]),
    ("emissiveMultiplier", [0.0, 0.0, 0.0, 0.0]),
    ("globalAnimUV1", [0.0, 1.0, 0.0, 0.0]),
    ("globalAnimUV0", [1.0, 0.0, 0.0, 0.0]),
];

fn glow_vectors(multiplier: f32) -> [(&'static str, [f32; 4]); 6] {
    let mut out = GLOW_TABLE;
    out[3].1[0] = multiplier;
    out
}

/// Рабочая копия графа донора, на которой собирается выход.
struct Bench {
    graph: Graph,
    root: usize,
    /// Объект внешней диффузной текстуры, запомненный для `ReplaceDictionary`.
    kept: Option<Address>,
    /// Приклеиваемые словари без страничной добивки (`Donor::without_page_padding`).
    tight: bool,
}

impl Bench {
    fn of(donor: &Donor) -> Bench {
        Bench { graph: donor.graph.clone(), root: donor.root, kept: None, tight: donor.tight }
    }

    fn run(&mut self, stage: Stage<'_>, packed: &Packed) -> Verdict<()> {
        match stage {
            Stage::SwapModel(samples) => Ok(dw::replace_high_model_layouts(&mut self.graph, self.root, &packed.geometries, samples, &packed.root)?),
            Stage::NameModel(style, text) => self.name_model(style, text),
            Stage::EmbedSheets(sheets) => self.embed(sheets),
            Stage::RenameSheets(sheets, name) => self.rename_sheets(sheets, name),
            Stage::RenameDiffuse(name) => self.rename_diffuse(name),
            Stage::SetEmission(power) => self.set_vector(0, "emissiveMultiplier", &[power], Voice::Look),
            Stage::RememberDiffuse => self.remember_diffuse(),
            Stage::ReplaceDictionary(sheet) => self.replace_dictionary(sheet),
            Stage::GlowVectors(multiplier) => glow_vectors(multiplier).iter().try_for_each(|(name, value)| self.set_vector(0, name, value, Voice::Glow)),
            Stage::EmbedNamed { sheets, donor_sheet } => self.embed_named(sheets, donor_sheet),
            Stage::FlyerShaders { sheets, layout, shaders, round } => self.flyer_shaders(sheets, layout, shaders, round),
            Stage::FacadeShaders(facade) => self.facade_shaders(facade),
            Stage::SignGroup { shaders, sheets, layout } => self.sign_group(shaders, sheets, layout),
            Stage::SizeGroup => self.size_group(),
            Stage::CloseGroup => self.close_group(),
            Stage::SetLevels(lod) => self.set_levels(lod),
            Stage::HostUsage(sheets) => self.host_usage(sheets),
            Stage::SignUsage(sheets) => self.usage_by(sheets, sign_usage_data),
            Stage::SetVector(name, values) => self.set_vector(0, name, &values, Voice::Glow),
            Stage::HostTextureRows => self.host_texture_rows(),
            Stage::DropBounds => self.drop_bounds(),
            Stage::DropName => self.drop_name(),
        }
    }

    /// Указатель на имя корня обнуляется; строка уйдёт со всем недостижимым при сборке.
    fn drop_name(&mut self) -> Verdict<()> {
        let root = self.root;
        self.graph.blocks[root].slots.retain(|slot| slot.relative != at::root::NAME);
        self.put(root, at::root::NAME, &[0u8; 8], "Имя донора не снято.")
    }

    /// Встроенные листы получают вид и флаги использования хоста.
    fn host_usage(&mut self, sheets: &[NewTexture]) -> Verdict<()> {
        self.usage_by(sheets, host_usage_data)
    }

    /// Слово использования каждого листа считает `usage` по его размеру.
    fn usage_by(&mut self, sheets: &[NewTexture], usage: fn(u16, u16) -> u32) -> Verdict<()> {
        let group = self.group()?;
        let dictionary = self.dictionary(group).ok_or_else(|| refuse(words::NO_DICTIONARY))?;
        for sheet in sheets {
            let object = self.object_named(dictionary, &sheet.name)?.ok_or_else(|| Refusal::UnknownSheet(sheet.name.clone()))?;
            let block = self.graph.block_at(object).ok_or_else(|| refuse(words::OUTSIDE))?;
            let relative = object.offset - self.graph.blocks[block].start + at::TEXTURE_USAGE;
            self.put(block, relative, &usage(sheet.width, sheet.height).to_le_bytes(), "Флаги листа не записаны.")?;
        }
        Ok(())
    }

    /// Указатель на коллизию корня обнуляется; недостижимые блоки уйдут при сборке.
    fn drop_bounds(&mut self) -> Verdict<()> {
        let root = self.root;
        self.graph.blocks[root].slots.retain(|slot| slot.relative != at::root::BOUNDS);
        self.put(root, at::root::BOUNDS, &[0u8; 8], "Коллизия донора не снята.")
    }

    fn group(&self) -> Verdict<usize> {
        let address = rg::pointer_from(&self.graph, self.root, at::root::GROUP).ok_or_else(|| refuse("У донора нет группы шейдеров."))?;
        self.graph.block_at(address).ok_or_else(|| refuse("Группа шейдеров донора вне блоков."))
    }

    /// Словарь текстур группы.
    fn dictionary(&self, group: usize) -> Option<Address> {
        rg::pointer_from(&self.graph, group, at::group::DICTIONARY)
    }

    fn put(&mut self, block: usize, offset: usize, bytes: &[u8], failure: &str) -> Verdict<()> {
        rg::write_at(&mut self.graph, block, offset, bytes).map_err(|_| refuse(failure))
    }

    fn object_named(&self, dictionary: Address, name: &str) -> Result<Option<Address>> {
        let found = texture_objects(&self.graph, dictionary)?.into_iter().find(|(own, _)| own.eq_ignore_ascii_case(name));
        Ok(found.map(|(_, object)| object))
    }

    fn name_model(&mut self, style: NameStyle, text: &str) -> Verdict<()> {
        let (renamed, verdict) = match style {
            NameStyle::Stored => (rename_at(&mut self.graph, self.root, at::root::NAME, text), "не записано"),
            NameStyle::Suffixed => (rename_drawable(&mut self.graph, self.root, text), "не годится"),
            NameStyle::Plain => (rename_drawable_plain(&mut self.graph, self.root, text), "не годится"),
        };
        renamed.map_err(|_| refuse(format!("Имя модели «{text}» {verdict}.")))
    }

    /// Приклеивает новый словарь и переводит на него указатель группы; возвращает адрес корня словаря.
    fn graft_dictionary(&mut self, group: usize, fresh: &Graph) -> Result<Address> {
        let (merged, root) = if self.tight {
            let mut trimmed = fresh.clone();
            trim_tail_padding(&mut trimmed);
            rg::graft(&self.graph, &trimmed)?
        } else {
            rg::graft(&self.graph, fresh)?
        };
        self.graph = merged;
        rg::retarget(&mut self.graph, group, at::group::DICTIONARY, root)?;
        Ok(root)
    }

    /// Заменяет листы словаря группы нашими одним проходом: лист донора с тем же именем уступает место
    /// с переносом служебных полей, новый словарь приклеивается один раз.
    fn embed(&mut self, sheets: &[NewTexture]) -> Verdict<()> {
        if sheets.is_empty() {
            return Ok(());
        }
        let group = self.group()?;
        let dictionary = self.dictionary(group).ok_or_else(|| refuse(words::NO_DICTIONARY))?;
        let file = dictionary_as_ytd(&self.graph, dictionary)?;
        let entries = ytd_write::read_entries(&file)?;
        let edits = sheets
            .iter()
            .map(|sheet| {
                let donor = entries.iter().find(|entry| entry.name.eq_ignore_ascii_case(&sheet.name)).ok_or_else(|| Refusal::UnknownSheet(sheet.name.clone()))?;
                Ok(Edit::Add { texture: sheet.clone(), donor: Some(donor.name.clone()) })
            })
            .collect::<Verdict<Vec<_>>>()?;
        let fresh = rg::scan(&Resource::parse(&ytd_write::edit(&file, &edits)?)?)?;

        // Шейдеры смотрят на объекты старого словаря: все листы, не только заменённые, переводятся на новые.
        let olds = texture_objects(&self.graph, dictionary)?;
        let root = self.graft_dictionary(group, &fresh)?;
        let news = texture_objects(&self.graph, root)?;
        for (name, old) in olds {
            if let Some((_, new)) = news.iter().find(|(own, _)| own.eq_ignore_ascii_case(&name)) {
                redirect(&mut self.graph, old, *new);
            }
        }
        Ok(())
    }

    /// Все встроенные листы получают одно новое имя.
    fn rename_sheets(&mut self, sheets: &[NewTexture], name: &str) -> Verdict<()> {
        let group = self.group()?;
        let dictionary = self.dictionary(group).ok_or_else(|| refuse(words::NO_DICTIONARY))?;
        for sheet in sheets {
            let object = self.object_named(dictionary, &sheet.name)?.ok_or_else(|| Refusal::UnknownSheet(sheet.name.clone()))?;
            rename_external_texture(&mut self.graph, object, name).map_err(|_| Refusal::UnknownSheet(name.to_string()))?;
        }
        Ok(())
    }

    /// Единственная диффузная текстура шейдера 0 получает новое имя.
    fn rename_diffuse(&mut self, name: &str) -> Verdict<()> {
        let group = self.group()?;
        let object = diffuse_texture(&self.graph, group, 0)?.ok_or(Refusal::NoTexture(0))?;
        rename_external_texture(&mut self.graph, object, name).map_err(|_| Refusal::UnknownSheet(name.to_string()))
    }

    fn remember_diffuse(&mut self) -> Verdict<()> {
        let group = self.group()?;
        self.kept = Some(diffuse_texture(&self.graph, group, 0)?.ok_or(Refusal::NoTexture(0))?);
        Ok(())
    }

    /// Словарь группы заменяется словарём из одного листа, запомненный внешний объект переводится на этот лист.
    fn replace_dictionary(&mut self, sheet: &NewTexture) -> Verdict<()> {
        let group = self.group()?;
        let fresh = rg::scan(&Resource::parse(&ytd_write::write(std::slice::from_ref(sheet))?)?)?;
        let root = self.graft_dictionary(group, &fresh)?;
        let own = self.object_named(root, &sheet.name)?.ok_or_else(|| Refusal::UnknownSheet(sheet.name.clone()))?;
        if let Some(external) = self.kept {
            redirect(&mut self.graph, external, own);
        }
        Ok(())
    }

    /// Пишет значения в вектор шейдера по имени параметра (с первого компонента).
    fn set_vector(&mut self, shader: usize, name: &str, values: &[f32], voice: Voice) -> Verdict<()> {
        let [missing, flat, outside, unwritten] = voice.lines(name);
        let group = self.group()?;
        let (kind, address) = shader_param(&self.graph, group, shader, joaat(name))?.ok_or_else(|| refuse(missing))?;
        if kind != 1 {
            return Err(refuse(flat));
        }
        let block = self.graph.block_at(address).ok_or_else(|| refuse(outside))?;
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let offset = address.offset - self.graph.blocks[block].start;
        self.put(block, offset, &bytes, &unwritten)
    }

    /// Строки шапки блока параметров каждого шейдера группы, у которых тип «текстура» (0): байт 1 становится 02. Хост пишет его
    /// у каждого шейдера из XML, шейдер игры держит там 00; у векторов в этом байте номера регистров настоящего шейдера, они
    /// остаются как есть (у шейдера донора они игровые, у шейдеров пресетов — `Tails` в `shader_write`).
    fn host_texture_rows(&mut self) -> Verdict<()> {
        let group = self.group()?;
        let roster = Roster::of(&self.graph, group)?.ok_or_else(|| refuse("У группы нет списка шейдеров."))?;
        for index in 0..roster.count {
            let shader = roster.nth(&self.graph, index).ok_or_else(|| refuse("Шейдер вне блоков."))?;
            let rows = usize::from(byte_in(&self.graph, shader, at::shader::COUNT)?);
            let Some(address) = rg::pointer_from(&self.graph, shader, at::shader::PARAMS) else { continue };
            let block = self.graph.block_at(address).ok_or_else(|| refuse("Параметры шейдера вне блоков."))?;
            let first = address.offset - self.graph.blocks[block].start;
            for row in 0..rows {
                let at = first + row * 16;
                if byte_in(&self.graph, block, at)? == 0 {
                    self.put(block, at + 1, &[2], "Хвост строки параметров не записан.")?;
                }
            }
        }
        Ok(())
    }

    /// Размер группы в 16-байтных единицах.
    fn size_group(&mut self) -> Verdict<()> {
        let group = self.group()?;
        let size = (self.graph.content(group).len() / 16) as u32;
        self.put(group, at::group::SIZE, &size.to_le_bytes(), "Размер группы не записан.")
    }

    /// Шаг, который хост делает с группой: размер группы в 16-байтных единицах и словарь, если его не было.
    fn close_group(&mut self) -> Verdict<()> {
        self.size_group()?;
        let group = self.group()?;
        if self.dictionary(group).is_some() {
            return Ok(());
        }
        let mut empty = vec![0u8; 64];
        empty[4] = 1;
        empty[24] = 1;
        let block = rg::append_block(&mut self.graph, Segment::System, empty, Vec::new());
        let target = head_of(&self.graph, block);
        let slots = &mut self.graph.blocks[group].slots;
        slots.push(Slot { relative: at::group::DICTIONARY, target });
        slots.sort_by_key(|slot| slot.relative);
        Ok(())
    }

    /// Новый список шейдеров группы из готовых блоков шейдеров; прежний уходит без ссылок.
    fn install_list(&mut self, group: usize, segment: Segment, shaders: &[usize]) -> Verdict<()> {
        let slots = shaders.iter().enumerate().map(|(i, &block)| Slot { relative: i * 8, target: head_of(&self.graph, block) }).collect();
        let array = rg::append_block(&mut self.graph, segment, vec![0u8; shaders.len() * 8], slots);
        let target = head_of(&self.graph, array);
        rg::retarget(&mut self.graph, group, at::group::LIST, target).map_err(|_| refuse("Список шейдеров не переписан."))?;
        // Число шейдеров (u16) и сразу за ним вместимость списка (u16): у хоста они равны, у донора вместимость своя.
        let count = (shaders.len() as u16).to_le_bytes();
        self.put(group, at::group::COUNT, &[count[0], count[1], count[0], count[1]], "Число шейдеров не записано.")
    }

    /// Листы под своими именами вместо листа донора: словарь группы пересобирается из `sheets` (по образцу объекта листа
    /// `donor_sheet`), всё прочее из него уходит. Записи встают по хешам имён — массив хешей настоящий, а не хеш прежнего
    /// имени, как было при переименовании листа донора.
    fn embed_named(&mut self, sheets: &[NewTexture], donor_sheet: &str) -> Verdict<()> {
        let group = self.group()?;
        let dictionary = self.dictionary(group).ok_or_else(|| refuse(words::NO_DICTIONARY))?;
        let file = dictionary_as_ytd(&self.graph, dictionary)?;
        let entries = ytd_write::read_entries(&file)?;
        let template = entries.iter().find(|entry| entry.name.eq_ignore_ascii_case(donor_sheet)).ok_or_else(|| Refusal::UnknownSheet(donor_sheet.to_string()))?;
        let mut edits: Vec<Edit> = sheets.iter().map(|sheet| Edit::Add { texture: sheet.clone(), donor: Some(template.name.clone()) }).collect();
        let left_over = entries.iter().filter(|entry| !sheets.iter().any(|sheet| sheet.name.eq_ignore_ascii_case(&entry.name)));
        edits.extend(left_over.map(|entry| Edit::Remove { name: entry.name.clone() }));
        let fresh = rg::scan(&Resource::parse(&ytd_write::edit(&file, &edits)?)?)?;
        self.graft_dictionary(group, &fresh)?;
        Ok(())
    }

    /// Шейдеры летающей модели: копии образца `layout` по пресетам, у каждой копии диффузный лист своего номера из `sheets`.
    /// Свечение пресета пишется так, как его печатает хост (правило `round`).
    fn flyer_shaders(&mut self, sheets: &[NewTexture], layout: u16, shaders: &[(ShaderSpec, usize)], round: Round) -> Verdict<()> {
        let group = self.group()?;
        let dictionary = self.dictionary(group).ok_or_else(|| refuse(words::NO_DICTIONARY))?;
        let objects = sheets
            .iter()
            .map(|sheet| self.object_named(dictionary, &sheet.name)?.ok_or_else(|| Refusal::UnknownSheet(sheet.name.clone())))
            .collect::<Verdict<Vec<Address>>>()?;

        let roster = Roster::of(&self.graph, group)?.ok_or_else(|| refuse("У группы нет списка шейдеров."))?;
        let sample = roster.nth(&self.graph, usize::from(layout)).ok_or(Refusal::NoShader(layout))?;
        let segment = self.graph.blocks[roster.block].segment;
        let made = shaders
            .iter()
            .map(|(spec, sheet)| {
                let printed = ShaderSpec { emissive: spec.emissive.map(|glow| round.apply(glow)), ..spec.clone() };
                // Хвосты строк шапки параметров (номера регистров, 02 у текстуры) — у образца донора, как у хоста: без них нули.
                shader_write::shader_item_with(&mut self.graph, sample, &printed, objects[*sheet], 1.0, true).map_err(Refusal::from)
            })
            .collect::<Verdict<Vec<usize>>>()?;
        self.install_list(group, segment, &made)
    }

    /// Новый словарь листов модели: старый уходит без ссылок; указатель группы на словарь дописывается, если донор словаря не знал.
    fn install_dictionary(&mut self, group: usize, sheets: &[NewTexture]) -> Verdict<Address> {
        let fresh = rg::scan(&Resource::parse(&ytd_write::write_long_chains(sheets)?)?)?;
        let (merged, root) = rg::graft(&self.graph, &fresh)?;
        self.graph = merged;
        if self.graph.blocks[group].slots.iter().any(|slot| slot.relative == at::group::DICTIONARY) {
            rg::retarget(&mut self.graph, group, at::group::DICTIONARY, root)?;
        } else {
            let slots = &mut self.graph.blocks[group].slots;
            slots.push(Slot { relative: at::group::DICTIONARY, target: root });
            slots.sort_by_key(|slot| slot.relative);
        }
        Ok(root)
    }

    /// Шейдеры новой модели надписи: словарь из листов, затем по шейдеру на пресет — копия образца с параметрами хоста.
    /// Лист шейдера берётся из нового словаря по имени; если такого листа нет — внешний (копия внешнего листа донора под новым именем).
    fn sign_group(&mut self, shaders: &[SignShader], sheets: &[NewTexture], layout: u16) -> Verdict<()> {
        let group = self.group()?;
        let roster = Roster::of(&self.graph, group)?.ok_or_else(|| refuse("У донора нет списка шейдеров."))?;
        let sample = roster.nth(&self.graph, usize::from(layout)).ok_or(Refusal::NoShader(layout))?;
        let segment = self.graph.blocks[roster.block].segment;
        // Внешний лист донора существует, только если у донора нет своего словаря: иначе лист образца — объект словаря.
        let donor_sheet = match self.dictionary(group) {
            None => diffuse_texture(&self.graph, group, usize::from(layout))?,
            Some(_) => None,
        };
        let dictionary = if sheets.is_empty() { None } else { Some(self.install_dictionary(group, sheets)?) };
        if dictionary.is_none() && self.dictionary(group).is_some() {
            // У модели без листов словаря нет (хост не пишет `TextureDictionary`): словарь донора уходит.
            self.graph.blocks[group].slots.retain(|slot| slot.relative != at::group::DICTIONARY);
            self.put(group, at::group::DICTIONARY, &[0u8; 8], "Словарь донора не снят.")?;
        }

        let mut objects: Vec<(&str, Address)> = Vec::with_capacity(shaders.len());
        for shader in shaders {
            let name = shader.texture.as_str();
            if objects.iter().any(|(known, _)| *known == name) {
                continue;
            }
            let embedded = match dictionary {
                Some(root) => self.object_named(root, name)?,
                None => None,
            };
            let object = match (embedded, donor_sheet) {
                (Some(own), _) => own,
                (None, Some(template)) => {
                    let block = self.graph.block_at(template).ok_or_else(|| refuse("Внешний лист донора вне блоков."))?;
                    let copy = clone_block(&mut self.graph, block);
                    let at = head_of(&self.graph, copy);
                    rename_external_texture(&mut self.graph, at, name).map_err(|_| Refusal::UnknownSheet(name.to_string()))?;
                    at
                }
                (None, None) => return Err(Refusal::UnknownSheet(name.to_string())),
            };
            objects.push((name, object));
        }

        let mut made = Vec::with_capacity(shaders.len());
        for shader in shaders {
            let object = objects.iter().find(|(name, _)| *name == shader.texture).map(|&(_, object)| object).ok_or_else(|| Refusal::UnknownSheet(shader.texture.clone()))?;
            made.push(shader_write::shader_item_with(&mut self.graph, sample, &shader.spec, object, shader.hard_alpha, true).map_err(Refusal::from)?);
        }
        self.install_list(group, segment, &made)
    }

    /// Шейдеры фасада: на каждую грань копии объекта текстуры, параметров и шейдера, затем новый список.
    fn facade_shaders(&mut self, facade: &Facade) -> Verdict<()> {
        let group = self.group()?;
        let roster = Roster::of(&self.graph, group)?.ok_or_else(|| refuse("У донора нет списка шейдеров."))?;
        // Образцы идут в порядке вида граней: обычный, затем светящийся.
        let mut blocks = Vec::with_capacity(FACE_KINDS.len());
        for kind in &FACE_KINDS {
            blocks.push(roster.nth(&self.graph, usize::from(kind.sample)).ok_or_else(|| refuse("Шейдер донора вне блоков."))?);
        }
        let mut objects = Vec::with_capacity(FACE_KINDS.len());
        for kind in &FACE_KINDS {
            objects.push(diffuse_texture(&self.graph, group, usize::from(kind.sample))?.ok_or(Refusal::NoTexture(kind.sample))?);
        }

        let mut made = Vec::with_capacity(facade.order.len());
        for &i in &facade.order {
            let face = &facade.faces[i];
            let slot = usize::from(face.emissive);
            made.push(self.clone_shader(blocks[slot], objects[slot], &face.texture, face.kind())?);
        }
        self.install_list(group, Segment::System, &made)?;
        for (place, &i) in facade.order.iter().enumerate() {
            let kind = facade.faces[i].kind();
            self.set_vector(place, kind.param, &[kind.value], Voice::Overlay)?;
        }
        Ok(())
    }

    /// Шейдер-копия для грани фасада: своя копия объекта текстуры, параметров и блока шейдера.
    fn clone_shader(&mut self, shader: usize, texture: Address, name: &str, kind: &FaceKind) -> Verdict<usize> {
        let graph = &mut self.graph;
        let object_block = graph.block_at(texture).ok_or_else(|| refuse("Объект текстуры не скопирован."))?;
        let object = clone_block(graph, object_block);
        let object_at = head_of(graph, object);
        rename_external_texture(graph, object_at, name).map_err(|_| Refusal::UnknownSheet(name.to_string()))?;

        // Копия параметров берёт и таблицу хешей, что лежит за блоком; значения остаются общими с донором.
        let table = ParamTable::of(graph, shader)?.ok_or_else(|| refuse("У шейдера донора нет параметров."))?;
        let (segment, start) = (graph.blocks[table.block].segment, graph.blocks[table.block].start);
        let bytes = graph.bytes(segment).get(start..start + table.span(graph)).ok_or_else(|| refuse("Параметры шейдера не переписаны."))?.to_vec();
        let slots = graph.blocks[table.block].slots.clone();
        let params = rg::append_block(graph, segment, bytes, slots);
        // Диффузной предполагается первая запись параметров.
        rg::retarget(graph, params, 8, object_at).map_err(|_| refuse("Текстура параметра не переписана."))?;

        let copy = clone_block(graph, shader);
        let params_at = head_of(graph, params);
        rg::retarget(graph, copy, at::shader::PARAMS, params_at).map_err(|_| refuse("Параметры шейдера не переписаны."))?;
        self.put(copy, at::shader::FILE, &kind.file.to_le_bytes(), "Файл шейдера не записан.")?;
        self.put(copy, at::shader::BUCKET, &[kind.bucket], "Корзина шейдера не записана.")?;
        self.put(copy, at::shader::MASK, &kind.mask.to_le_bytes(), "Маска шейдера не записана.")?;
        Ok(copy)
    }

    /// Дальности уровней и слова флагов фасада; перекрывают то, что записал `drawable_write`.
    fn set_levels(&mut self, lod: f32) -> Verdict<()> {
        let root = self.root;
        let lods: Vec<u8> = [lod; 4].iter().flat_map(|v| v.to_le_bytes()).collect();
        self.put(root, at::root::LODS, &lods, "Дальность не записана.")?;
        let flags: Vec<u8> = [0xFF01u32, 0, 0xFF01, 0].iter().flat_map(|v| v.to_le_bytes()).collect();
        self.put(root, at::root::LEVEL_FLAGS, &flags, "Флаги уровней не записаны.")
    }

    /// Собирает файл и перечитывает: геометрии совпали с `packed`, листы на месте.
    fn seal(self, packed: &Packed, sheets: &[String]) -> Verdict<Vec<u8>> {
        let bytes = dw::finish_compact(&self.graph)?;
        let again = dw::graph_of(&bytes)?;
        let root = again.root().ok_or_else(|| refuse("Собранная рисовалка без корня."))?;
        let seen = dw::last_high_geometries(&again, root)?;
        if seen.len() != packed.geometries.len() {
            return Err(refuse("Собранная рисовалка прочиталась с другим числом сеток."));
        }
        let same = seen.iter().zip(&packed.geometries).all(|(a, b)| a.vertices == b.vertices && a.indices == b.indices && a.shader == b.shader);
        if !same {
            return Err(refuse("Сетка собранной рисовалки прочиталась не так, как записана."));
        }
        if !sheets.is_empty() {
            let dictionary = follow(&again, root, at::root::GROUP)
                .and_then(|group| rg::pointer_from(&again, group, at::group::DICTIONARY))
                .ok_or_else(|| refuse("Собранная группа без словаря."))?;
            let names = texture_objects(&again, dictionary)?;
            if let Some(missing) = sheets.iter().find(|wanted| !names.iter().any(|(own, _)| own.eq_ignore_ascii_case(wanted))) {
                return Err(Refusal::UnknownSheet(missing.clone()));
            }
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::sha256_hex;
    use crate::resource::SYSTEM_BASE;
    use crate::texture::Format;
    use std::path::PathBuf;

    const L36: (u32, u64) = (0x59, 0x0509_6006);
    const SAMPLE: [f32; 8] = [1.5, -2.25, 3.0, 0.0, 0.0, 1.0, 0.25, 0.75];

    fn elements(shape: (u32, u64)) -> Vec<(usize, Element)> {
        ordered_elements(&vertex::layout(shape.0, shape.1).unwrap())
    }

    fn triangle() -> Mesh {
        Mesh { shader: 0, vertices: vec![[0.0; 8]; 3], indices: vec![0, 1, 2] }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn skinned_vertex_writes_weights_then_bones() {
        let layout = [
            (vertex::BLEND_WEIGHTS, Element { offset: 12, type_code: vertex::COLOUR, size: 4 }),
            (vertex::BLEND_INDICES, Element { offset: 16, type_code: vertex::COLOUR, size: 4 }),
        ];
        let skin = Skin { bones: [0, 0, 2, 3], weights: [0, 0, 127, 128] };
        let mut out = Vec::new();
        pack_vertex_skinned(&mut out, &[0.0; 8], &skin, &layout).unwrap();
        assert_eq!(out, [0, 0, 127, 128, 0, 0, 2, 3]);
    }

    #[test]
    fn refusal_codes_are_stable() {
        let all = [
            (Refusal::NotDrawable(String::new()), "sign-donor-not-drawable"),
            (Refusal::Unsupported(String::new()), "sign-donor-unsupported"),
            (Refusal::NoShader(0), "sign-donor-no-shader"),
            (Refusal::NoTexture(0), "sign-donor-no-texture"),
            (Refusal::NoLayout(0), "sign-donor-no-layout"),
            (Refusal::UnknownSheet(String::new()), "sign-donor-unknown-sheet"),
            (Refusal::BadMesh(String::new()), "sign-mesh-invalid"),
        ];
        for (refusal, code) in all {
            assert_eq!(refusal.code(), code);
        }
    }

    #[test]
    fn meshes_outside_the_limits_are_refused() {
        assert!(check_mesh(&triangle()).is_ok());
        let mut bad_index = triangle();
        bad_index.indices = vec![0, 1, 3];
        let mut short = triangle();
        short.indices = vec![0, 1];
        let mut far = triangle();
        far.vertices[0] = [5000.0; 8];
        for mesh in [bad_index, short, far] {
            assert!(check_mesh(&mesh).is_err());
        }
    }

    #[test]
    fn mesh_checks_run_in_a_fixed_order() {
        let size = "Размер сетки вне предела: нужны 3…65535 вершин и целые треугольники.";
        let mut two = triangle();
        two.vertices.truncate(2);
        two.vertices[0][0] = f32::NAN;
        assert_eq!(check_mesh(&two), Err(Refusal::BadMesh(size.into())));
        let mut nan = triangle();
        nan.vertices[1][7] = f32::NAN;
        nan.indices = vec![0, 1, 9];
        assert_eq!(check_mesh(&nan), Err(Refusal::BadMesh("Вершина сетки вне предела.".into())));
        let mut edge = triangle();
        edge.vertices[2][3] = -4000.0;
        assert!(check_mesh(&edge).is_ok());
        edge.vertices[2][3] = 4000.001;
        assert!(check_mesh(&edge).is_err());
        let mut many = triangle();
        many.vertices = vec![[0.0; 8]; 65_536];
        assert_eq!(check_mesh(&many), Err(Refusal::BadMesh(size.into())));
        many.vertices.truncate(65_535);
        many.indices = vec![0, 1, 65_535];
        assert_eq!(check_mesh(&many), Err(Refusal::BadMesh("Индекс сетки вне вершин.".into())));
    }

    #[test]
    fn refusals_print_their_words() {
        assert_eq!(Refusal::NoShader(7).to_string(), "Сетка указывает на шейдер 7, которого нет в группе.");
        assert_eq!(Refusal::NoTexture(8).to_string(), "У шейдера 8 нет диффузной текстуры.");
        assert_eq!(Refusal::NoLayout(9).to_string(), "У шейдера 9 нет образца вершин в рисовалке.");
        assert_eq!(Refusal::UnknownSheet("лист".into()).to_string(), "Лист лист не совпадает с текстурой словаря.");
        assert_eq!(format!("{:?}", Refusal::NoShader(7)), "NoShader(7)");
        let from_error = Refusal::from(Error::argument("сломано"));
        assert_eq!(from_error, Refusal::Unsupported("сломано".into()));
        let boxed: Box<dyn std::error::Error> = Box::new(Refusal::NoShader(3));
        assert_eq!(boxed.to_string(), "Сетка указывает на шейдер 3, которого нет в группе.");
    }

    /// Числа из выхода хоста (`zones-bizwar`, 18.11.2026): вход — `float` из файла сетки, выход — то, что хост записал в вершину.
    /// `float.ToString("0.######")` берёт семь значащих цифр: `177.89119` становится `177.8912`, а не остаётся как есть.
    #[test]
    fn seven_digits_follows_the_host_float_format() {
        let host: [(u32, u32); 5] = [
            (0x4331_e425, 0x4331_e426), // 177.89119 -> 177.8912
            (0x4331_7897, 0x4331_789a), // 177.47105 -> 177.4711
            (0x4135_bbc0, 0x4135_bbc3), // 11.358337 -> 11.35834
            (0x4343_be75, 0x4343_be77), // 195.74397 -> 195.744
            (0x3f00_0000, 0x3f00_0000), // 0.5 остаётся
        ];
        for (input, want) in host {
            let got = seven_digits(f32::from_bits(input));
            assert_eq!(got.to_bits(), want, "{input:#x}: {got}");
        }
        // Меньше десяти значащих знаков после шестого не бывает, а выше — режутся до семи цифр.
        assert_eq!(seven_digits(123_456.7890625).to_bits(), 123_456.8f32.to_bits());
        assert_eq!(seven_digits(1.234_567_8e10).to_bits(), 1.234_568e10f32.to_bits());
        // Малые числа: шесть знаков после точки, округление по цифре «от нуля».
        assert_eq!(seven_digits(0.098_017_14).to_bits(), 0.098_017f32.to_bits());
        assert_eq!(seven_digits(5e-7).to_bits(), 1e-6f32.to_bits());
        assert_eq!(seven_digits(4e-7).to_bits(), 0.0f32.to_bits());
        assert_eq!(seven_digits(-5e-7).to_bits(), (-1e-6f32).to_bits());
        assert_eq!(seven_digits(-1e-9).to_bits(), (-0.0f32).to_bits());
        assert_eq!(seven_digits(-0.0).to_bits(), (-0.0f32).to_bits());
        assert!(seven_digits(f32::NAN).is_nan());
        assert_eq!(seven_digits(f32::INFINITY), f32::INFINITY);
        assert_eq!(seven_digits(f32::MAX).to_bits(), 3.402_823e38f32.to_bits());
        // Правило надписи жёстче прежнего только у чисел от десяти.
        assert_eq!(Round::Seven.apply(0.1234567).to_bits(), Round::Places6.apply(0.1234567).to_bits());
        assert_ne!(Round::Seven.apply(177.891_19).to_bits(), Round::Places6.apply(177.891_19).to_bits());
    }

    #[test]
    fn sign_usage_adds_x2048_from_two_thousand_pixels() {
        let base = host_usage_flags(1024, 1024);
        assert_eq!(sign_usage_flags(1024, 1024), base, "до 2048 как у плашки");
        assert_eq!(sign_usage_flags(64, 2048), base | 1 << 16, "от 2048 по большей стороне — ещё `X2048`");
        assert_eq!(sign_usage_flags(4096, 512), base | 1 << 16);
        assert_eq!(sign_usage_data(2048, 1024), HOST_USAGE_KIND | (host_usage_flags(2048, 1024) | 1 << 16) << 5);
        assert_eq!(host_usage_data(2048, 1024), HOST_USAGE_KIND | host_usage_flags(2048, 1024) << 5, "у плашки и звезды правило прежнее");
    }

    #[test]
    fn xml_float_rounds_the_decimal_spelling() {
        let cases: [(f32, f32); 12] = [
            (0.1234567, 0.123457),
            (0.1234565, 0.123457),
            (0.1234564, 0.123456),
            (-0.1234567, -0.123457),
            (5e-7, 1e-6),
            (4e-7, 0.0),
            (-5e-7, -1e-6),
            (0.9999995, 1.0),
            (-2.0000005, -2.000001),
            (7.0000005, 7.000001),
            (16_777_218.0, 16_777_218.0),
            (0.1, 0.1),
        ];
        for (input, want) in cases {
            assert_eq!(xml_float(input).to_bits(), want.to_bits(), "{input}");
        }
        assert_eq!(xml_float(-1e-7).to_bits(), (-0.0f32).to_bits());
        assert_eq!(xml_float(-0.0).to_bits(), (-0.0f32).to_bits());
        assert!(xml_float(f32::NAN).is_nan());
        assert_eq!(xml_float(f32::INFINITY), f32::INFINITY);
        assert_eq!(xml_float(f32::MAX), f32::MAX);
        assert_eq!(xml_float(1.1754944e-38), 0.0);
    }

    #[test]
    fn root_follows_the_box() {
        let cube = root_of([0.0; 3], [1.0; 3], 1, Some(100.0), 1);
        assert_eq!(cube.centre, [0.5; 3]);
        assert_eq!(cube.radius, 0.866025);
        assert_eq!((cube.mask, cube.lod, cube.render_word), (1, Some(100.0), 18));
        let words: Vec<u16> = [0usize, 2, 3, 10, 16, 100, 1000].iter().map(|&n| root_of([0.0; 3], [1.0; 3], 1, None, n).render_word).collect();
        assert_eq!(words, [18, 33, 46, 134, 209, 1270, 12632]);
        let empty = root_of([f32::MAX; 3], [f32::MIN; 3], 1, None, 0);
        assert_eq!((empty.centre, empty.radius), ([0.0; 3], f32::INFINITY));
        let flipped = root_of([5.0; 3], [-5.0; 3], 1, None, 1);
        assert_eq!((flipped.centre, flipped.radius), ([0.0; 3], 8.660255));
    }

    #[test]
    fn elements_come_in_offset_order() {
        let shape: Vec<(usize, usize, u8, usize)> = elements(L36).iter().map(|(s, e)| (*s, e.offset, e.type_code, e.size)).collect();
        assert_eq!(shape, [(0, 0, 6, 12), (3, 12, 6, 12), (4, 24, 9, 4), (6, 28, 5, 8)]);
        assert!(ordered_elements(&Layout::default()).is_empty());
    }

    #[test]
    fn vertex_bytes_follow_the_layout() {
        let mut out = Vec::new();
        pack_vertex(&mut out, &SAMPLE, &elements(L36)).unwrap();
        assert_eq!(
            hex(&out),
            "00 00 c0 3f 00 00 10 c0 00 00 40 40 00 00 00 00 00 00 00 00 00 00 80 3f ff ff ff ff 00 00 80 3e 00 00 40 3f"
        );
        // порядок записи — порядок среза, а не смещений; буфер дописывается
        let swapped = [
            (vertex::UV0, Element { offset: 12, type_code: vertex::FLOAT2, size: 8 }),
            (vertex::POSITION, Element { offset: 0, type_code: vertex::FLOAT3, size: 12 }),
        ];
        let mut out = vec![0xaa, 0xbb];
        pack_vertex(&mut out, &SAMPLE, &swapped).unwrap();
        assert_eq!(hex(&out), "aa bb 00 00 80 3e 00 00 40 3f 00 00 c0 3f 00 00 10 c0 00 00 40 40");
        // неподдержанная пара: уже записанное остаётся в буфере
        let tangent = [
            (vertex::POSITION, Element { offset: 0, type_code: vertex::FLOAT3, size: 12 }),
            (5, Element { offset: 12, type_code: vertex::FLOAT4, size: 16 }),
        ];
        let mut out = Vec::new();
        let refusal = pack_vertex(&mut out, &SAMPLE, &tangent).unwrap_err();
        assert_eq!(refusal, Refusal::Unsupported("Раскладка вершин образца не поддержана: пока не собирается.".into()));
        assert_eq!(out.len(), 12);
    }

    #[test]
    fn skinned_colour_is_a_parameter() {
        let skin = Skin { bones: [0, 0, 2, 3], weights: [0, 0, 127, 128] };
        let mut out = Vec::new();
        pack_vertex_skinned_colour(&mut out, &SAMPLE, &skin, &elements(L36), [9, 8, 7, 6]).unwrap();
        assert_eq!(&out[24..28], &[9, 8, 7, 6]);
        let mut white = Vec::new();
        pack_vertex_skinned(&mut white, &SAMPLE, &skin, &elements(L36)).unwrap();
        assert_eq!(&white[24..28], &[255; 4]);
        // не цветовой тип весов не поддержан
        let floats = [(vertex::BLEND_WEIGHTS, Element { offset: 0, type_code: vertex::FLOAT4, size: 16 })];
        assert!(pack_vertex_skinned(&mut Vec::new(), &SAMPLE, &skin, &floats).is_err());
    }

    /// Мини-граф: объект текстуры (слот имени на +0x28) и блок имени за ним.
    fn texture_graph() -> Graph {
        let mut system = vec![0u8; 0x80];
        system[0x28..0x30].copy_from_slice(&(SYSTEM_BASE + 0x40).to_le_bytes());
        system[0x40..0x44].copy_from_slice(b"old\0");
        rg::from_parts(165, 0xa000_0000, 0x5000_0000, system, Vec::new())
    }

    #[test]
    fn texture_names_follow_the_rule() {
        let object = Address { segment: Segment::System, offset: 0 };
        let long = "a".repeat(63);
        for good in ["abc_123", "a", "123", long.as_str()] {
            let mut graph = texture_graph();
            let before = graph.blocks.len();
            rename_external_texture(&mut graph, object, good).unwrap();
            assert_eq!(graph.blocks.len(), before + 1, "{good}");
        }
        let too_long = "a".repeat(64);
        for bad in ["", "Abc", "a-b", "a.b", "a b", "звезда", too_long.as_str()] {
            let mut graph = texture_graph();
            let error = rename_external_texture(&mut graph, object, bad).unwrap_err();
            assert_eq!(error.message, "Имя внешней текстуры: строчные буквы, цифры и «_», до 63 символов.", "{bad:?}");
            assert_eq!(graph.blocks.len(), 2);
        }
        // имя проверяется раньше адреса
        let mut graph = texture_graph();
        let outside = Address { segment: Segment::System, offset: usize::MAX };
        assert_eq!(rename_external_texture(&mut graph, outside, "Bad").unwrap_err().kind, crate::error::Kind::Argument);
        assert_eq!(rename_external_texture(&mut graph, outside, "ok").unwrap_err().message, "Текстура вне блоков.");
    }

    #[test]
    fn redirect_moves_only_exact_targets() {
        let mut graph = texture_graph();
        let old = Address { segment: Segment::System, offset: 0x40 };
        let new = Address { segment: Segment::System, offset: 0 };
        let inside = Address { segment: Segment::System, offset: 0x48 };
        redirect(&mut graph, inside, new);
        assert_eq!(rg::pointer_from(&graph, 0, 0x28), Some(old));
        let bytes_before = graph.system.clone();
        redirect(&mut graph, old, new);
        assert_eq!(rg::pointer_from(&graph, 0, 0x28), Some(new));
        assert_eq!(graph.system, bytes_before);
    }

    #[test]
    fn drawable_names_get_their_suffix() {
        let mut graph = texture_graph();
        // у блока 0 есть слот на +0x28, но не на +0xa8: отказ, блок имени не дописывается
        let error = rename_drawable(&mut graph, 0, "star_1").unwrap_err();
        assert_eq!(error.message, "В блоке нет указателя по этому смещению.");
        assert_eq!(graph.blocks.len(), 2);
        graph.blocks[0].slots.push(Slot { relative: at::root::NAME, target: Address { segment: Segment::System, offset: 0 } });
        rename_drawable(&mut graph, 0, "star_1").unwrap();
        assert_eq!(graph.blocks.len(), 3);
        let text = &graph.system[graph.blocks[2].start..graph.blocks[2].end];
        assert_eq!(text, b"star_1.#dr\0");
        let plain = rename_drawable_plain(&mut graph, 0, "Bad").unwrap_err();
        assert_eq!(plain.message, "Имя модели: строчные буквы, цифры и «_», до 63 символов.");
    }

    #[test]
    fn donors_that_are_not_drawables_are_refused() {
        let not_resource = Refusal::NotDrawable("Донор не читается как ресурс.".into());
        for junk in [&[][..], &[1, 2, 3][..], &[0u8; 16][..]] {
            assert_eq!(Donor::open(junk).err(), Some(not_resource.clone()));
        }
        let ytd = ytd_write::write(&[NewTexture {
            name: "t".into(),
            width: 4,
            height: 4,
            format: crate::texture::Format::Dxt1,
            levels: 1,
            payload: vec![0; 8],
        }])
        .unwrap();
        assert_eq!(Donor::open(&ytd).err(), Some(Refusal::NotDrawable("Донор — не рисовалка ydr.".into())));
    }

    // ---- проверки с файлами игры: без переменных окружения выходят сразу

    fn game_donor(var: &str) -> Option<(PathBuf, Donor)> {
        let path = PathBuf::from(std::env::var(var).ok()?);
        let bytes = std::fs::read(&path).ok()?;
        match Donor::open(&bytes) {
            Ok(donor) => Some((path, donor)),
            Err(refusal) => {
                println!("donor refused: {refusal}");
                None
            }
        }
    }

    fn group_of(donor: &Donor) -> usize {
        Bench::of(donor).group().unwrap()
    }

    // ---- 16.11.2026: выход как у хоста (сверка на файлах игры показала расхождения в этих полях)

    #[test]
    fn host_usage_word_follows_the_host_rule() {
        const NOT_HALF: u32 = 1;
        let base = NOT_HALF | 1 << 7 | 1 << 8 | 1 << 10 | 1 << 24;
        assert_eq!(host_usage_flags(64, 128), base, "`NOT_HALF, X32, X64, X128, UNK24`");
        assert_eq!(host_usage_flags(256, 256), base);
        assert_eq!(host_usage_flags(512, 64), base | 1 << 12, "от 512 по большей стороне — ещё `X512`");
        assert_eq!(host_usage_flags(64, 2048), base | 1 << 12 | 1 << 14, "от 1024 — ещё `X1024`");
        // слово целиком: вид `DIFFUSE` (20) и флаги; у донора было `HD_SPLIT, X64, X128, UNK24`, у нашего листа нормали игры — вид 22.
        assert_eq!(host_usage_data(256, 256), 20 | base << 5);
        assert_eq!(host_usage_data(64, 128) & 0x1f, HOST_USAGE_KIND);
    }

    /// Вектор шейдера 0 готовой рисовалки по имени параметра.
    fn shader_vector(bytes: &[u8], name: &str) -> [f32; 4] {
        let graph = dw::graph_of(bytes).unwrap();
        let root = graph.root().unwrap();
        let group = follow(&graph, root, at::root::GROUP).unwrap();
        let (_, address) = shader_param(&graph, group, 0, joaat(name)).unwrap().unwrap();
        let block = graph.block_at(address).unwrap();
        let from = address.offset - graph.blocks[block].start;
        let raw = &graph.content(block)[from..from + 16];
        [0, 1, 2, 3].map(|i| f32::from_le_bytes(raw[i * 4..i * 4 + 4].try_into().unwrap()))
    }

    /// Слово использования первого встроенного листа готовой рисовалки.
    fn sheet_usage(bytes: &[u8]) -> u32 {
        let graph = dw::graph_of(bytes).unwrap();
        let root = graph.root().unwrap();
        let group = follow(&graph, root, at::root::GROUP).unwrap();
        let dictionary = rg::pointer_from(&graph, group, at::group::DICTIONARY).unwrap();
        let (_, object) = texture_objects(&graph, dictionary).unwrap().into_iter().next().unwrap();
        let block = graph.block_at(object).unwrap();
        let from = object.offset - graph.blocks[block].start + at::TEXTURE_USAGE;
        u32::from_le_bytes(graph.content(block)[from..from + 4].try_into().unwrap())
    }

    /// Плашка эмблемы и звезда на настоящем доноре `hw1_08_hotplaz_rail.ydr` (HW1_DONOR): флаги листа и `HardAlphaBlend` — как у хоста,
    /// у `apply_model` они остаются донорскими (`HD_SPLIT, X64, X128, UNK24` и 0): на этой разнице сверка по XML CodeWalker и красная.
    #[test]
    fn hosted_plate_gets_the_host_usage_flags_and_hard_alpha() {
        let Some((_, donor)) = game_donor("HW1_DONOR") else { return };
        let Some(sheet_name) = donor.diffuse_name(0).map(str::to_owned) else { return };
        let sheet = NewTexture { name: sheet_name, width: 64, height: 64, format: Format::Dxt5, levels: 7, payload: vec![0x5a; ytd_write::payload_bytes(Format::Dxt5, 64, 64, 7)] };
        let mesh = Mesh { shader: 0, vertices: quad([[-0.5, 0.0, -0.25], [0.5, 0.0, -0.25], [0.5, 0.0, 0.25], [-0.5, 0.0, 0.25]], [0.0, -1.0, 0.0]).to_vec(), indices: vec![0, 1, 2, 0, 2, 3] };
        let packed = donor.pack_tinted(&[mesh], Some(300.0), [255, 255, 0, 255]).unwrap();

        let plain = donor.apply_model(&packed, std::slice::from_ref(&sheet), None, None).unwrap();
        let hosted = donor.apply_hosted(&packed, std::slice::from_ref(&sheet), None, None).unwrap();
        assert_eq!(shader_vector(&hosted, "HardAlphaBlend"), [1.0, 0.0, 0.0, 0.0]);
        assert_eq!(sheet_usage(&hosted), host_usage_data(64, 64));
        assert_ne!(sheet_usage(&plain), sheet_usage(&hosted), "донорские флаги листа и флаги хоста различаются");
        assert_eq!(shader_vector(&plain, "HardAlphaBlend")[0], 0.0, "донор хранит HardAlphaBlend 0");
    }

    #[test]
    #[ignore = "нужен .ydr игры: YDR_DONOR"]
    fn print_donor_open() {
        if let Some((_, donor)) = game_donor("YDR_DONOR") {
            println!("donor ok: root {}", donor.root);
        }
    }

    /// Четыре вершины плоскости: углы по кругу, нормаль, UV `(0,1) (1,1) (1,0) (0,0)`.
    fn quad(corners: [[f32; 3]; 4], normal: [f32; 3]) -> [[f32; 8]; 4] {
        const UV: [[f32; 2]; 4] = [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]];
        let mut out = [[0.0; 8]; 4];
        for (i, out_row) in out.iter_mut().enumerate() {
            let [x, y, z] = corners[i];
            *out_row = [x, y, z, normal[0], normal[1], normal[2], UV[i][0], UV[i][1]];
        }
        out
    }

    #[test]
    #[ignore = "нужны донор игры и путь вывода: YDR_DONOR, YDR_OUT"]
    fn write_overlay_probe() {
        let (Some((_, donor)), Ok(out)) = (game_donor("YDR_DONOR"), std::env::var("YDR_OUT")) else { return };
        let face = |texture: &str, emissive: bool, corners, normal| OverlayFace { texture: texture.to_string(), emissive, vertices: quad(corners, normal) };
        let faces = [
            face("astral_mall_front", false, [[-20.0, 0.0, 0.0], [20.0, 0.0, 0.0], [20.0, 0.0, 10.0], [-20.0, 0.0, 10.0]], [0.0, -1.0, 0.0]),
            face("astral_mall_right", false, [[20.0, 0.0, 0.0], [20.0, 30.0, 0.0], [20.0, 30.0, 10.0], [20.0, 0.0, 10.0]], [1.0, 0.0, 0.0]),
            face("astral_mall_rear", false, [[20.0, 30.0, 0.0], [-20.0, 30.0, 0.0], [-20.0, 30.0, 10.0], [20.0, 30.0, 10.0]], [0.0, 1.0, 0.0]),
            face("astral_mall_left", false, [[-20.0, 30.0, 0.0], [-20.0, 0.0, 0.0], [-20.0, 0.0, 10.0], [-20.0, 30.0, 10.0]], [-1.0, 0.0, 0.0]),
            face("astral_mall_sign", true, [[-10.0, -0.1, 10.0], [10.0, -0.1, 10.0], [10.0, -0.1, 14.0], [-10.0, -0.1, 14.0]], [0.0, -1.0, 0.0]),
        ];
        let bytes = donor.apply_overlay(&faces, 650.0).unwrap();
        std::fs::write(&out, &bytes).unwrap();
        println!("overlay written: {} bytes", bytes.len());
    }

    #[test]
    #[ignore = "нужен .ydr: YDR_SHAPE"]
    fn print_overlay_shape() {
        let Some((_, donor)) = game_donor("YDR_SHAPE") else { return };
        let graph = &donor.graph;
        let geometries = dw::last_high_geometries(graph, donor.root).unwrap();
        for (i, g) in geometries.iter().enumerate() {
            println!("geometry {i}: shader {} vertices {} bytes indices {:?}", g.shader, g.vertices.len(), g.indices);
        }
        let content = graph.content(donor.root);
        let lods: Vec<f32> = (0..4).map(|i| f32::from_le_bytes(content[at::root::LODS + 4 * i..at::root::LODS + 4 * i + 4].try_into().unwrap())).collect();
        println!("lods {lods:?}");
        println!("low list: {}", rg::pointer_from(graph, donor.root, 0x60).is_some());
        for shader in 0..5u16 {
            println!("shader {shader}: diffuse {:?}", donor.diffuse_name(shader));
        }
    }

    #[test]
    #[ignore = "нужен .ydr: YDR_SHADERS"]
    fn print_shader_inventory() {
        let Some((_, donor)) = game_donor("YDR_SHADERS") else { return };
        for (i, entry) in shader_inventory(&donor.graph, group_of(&donor)).unwrap().iter().enumerate() {
            println!("{i}: {entry:?}");
        }
    }

    #[test]
    #[ignore = "нужен .ydr: DONOR_PROBE"]
    fn probe_donor() {
        let Some((_, donor)) = game_donor("DONOR_PROBE") else { return };
        println!("mask {:#04x}", donor.mask);
        println!("sheets {:?}", donor.sheets);
        for (i, name) in donor.diffuse.iter().enumerate() {
            println!("shader {i}: diffuse {name:?} layout {:?}", donor.template_layout(i as u16).map(|(stride, items)| (stride, items.len())));
        }
    }

    #[test]
    #[ignore = "нужен .ydr: PARTS_PROBE (и PARTS_DUMP — каталог для данных листов)"]
    fn probe_parts() {
        let Some((_, donor)) = game_donor("PARTS_PROBE") else { return };
        let graph = &donor.graph;
        let group = group_of(&donor);
        let list = Roster::of(graph, group).unwrap().unwrap();
        for index in 0..list.count {
            let Some(block) = list.nth(graph, index) else { continue };
            // канонический вид: указатели обнулены, хвостовые нули убраны
            let mut bytes = graph.content(block).to_vec();
            for slot in &graph.blocks[block].slots {
                bytes[slot.relative..slot.relative + 8].fill(0);
            }
            while bytes.last() == Some(&0) {
                bytes.pop();
            }
            println!("shader {index}: {}", sha256_hex(&bytes));
        }
        let Some(dictionary) = rg::pointer_from(graph, group, at::group::DICTIONARY) else { return };
        let file = dictionary_as_ytd(graph, dictionary).unwrap();
        let dump = std::env::var("PARTS_DUMP").ok().map(PathBuf::from);
        for entry in ytd_write::read_entries(&file).unwrap() {
            println!("sheet {}: {}x{} levels {} {:?} data {} object {}", entry.name, entry.width, entry.height, entry.levels, entry.format, sha256_hex(&entry.payload), sha256_hex(&entry.object));
            if let Some(dir) = &dump {
                std::fs::write(dir.join(format!("{}.bin", entry.name)), &entry.payload).unwrap();
            }
        }
    }

    /// Хеши, записанные у словаря текстур рисовалки, и имена листов в порядке списка.
    fn dictionary_hashes(graph: &Graph) -> (Vec<u32>, Vec<String>) {
        let root = graph.root().unwrap();
        let group = follow(graph, root, at::root::GROUP).unwrap();
        let dictionary = rg::pointer_from(graph, group, at::group::DICTIONARY).unwrap();
        let block = graph.block_at(dictionary).unwrap();
        let array = rg::pointer_from(graph, block, 0x20).unwrap();
        let names: Vec<String> = texture_objects(graph, dictionary).unwrap().into_iter().map(|(name, _)| name).collect();
        let raw = &graph.bytes(array.segment)[array.offset..array.offset + 4 * names.len()];
        (raw.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect(), names)
    }

    /// Первые 0x30 байт каждого шейдера группы: корзина, длины таблицы параметров, маска, число листов.
    #[test]
    #[ignore = "нужен .ydr: YDR_HEADS"]
    fn print_shader_heads() {
        let Ok(path) = std::env::var("YDR_HEADS") else { return };
        let graph = dw::graph_of(&std::fs::read(path).unwrap()).unwrap();
        let root = graph.root().unwrap();
        let group = follow(&graph, root, at::root::GROUP).unwrap();
        let roster = Roster::of(&graph, group).unwrap().unwrap();
        for index in 0..roster.count {
            let block = roster.nth(&graph, index).unwrap();
            let head = &graph.content(block)[..0x30.min(graph.content(block).len())];
            println!("head {index}: {}", hex(head));
        }
    }

    #[test]
    #[ignore = "нужен .ydr: YDR_HASHES"]
    fn print_dictionary_hashes() {
        let Ok(path) = std::env::var("YDR_HASHES") else { return };
        let graph = dw::graph_of(&std::fs::read(path).unwrap()).unwrap();
        let (hashes, names) = dictionary_hashes(&graph);
        for (hash, name) in hashes.iter().zip(&names) {
            println!("sheet {name}: stored {hash:#010x} real {:#010x}", joaat(name));
        }
    }

    #[test]
    #[ignore = "нужен .ydr: BLOCKS_PROBE"]
    fn probe_blocks() {
        let Some((_, donor)) = game_donor("BLOCKS_PROBE") else { return };
        let graph = &donor.graph;
        for segment in [Segment::System, Segment::Graphics] {
            let sizes: Vec<usize> = graph.segment_blocks(segment).iter().map(|&b| graph.blocks[b].end - graph.blocks[b].start).collect();
            println!("{segment:?}: {} blocks, {} bytes", sizes.len(), sizes.iter().sum::<usize>());
        }
        // системные блоки, на которые никто не указывает
        let pointed: std::collections::BTreeSet<(Segment, usize)> = graph.blocks.iter().flat_map(|b| b.slots.iter().map(|s| (s.target.segment, s.target.offset))).collect();
        for &block in graph.segment_blocks(Segment::System) {
            if !pointed.contains(&(Segment::System, graph.blocks[block].start)) {
                println!("unreferenced system block {block}: {:#x}..{:#x}", graph.blocks[block].start, graph.blocks[block].end);
            }
        }
    }

    #[test]
    #[ignore = "нужен .ydr: PLATE_PROBE"]
    fn probe_plate() {
        let Some((_, donor)) = game_donor("PLATE_PROBE") else { return };
        let graph = &donor.graph;
        let geometries = dw::last_high_geometries(graph, donor.root).unwrap();
        println!("shaders {} geometries {}", donor.diffuse.len(), geometries.len());
        for (shader, entry) in shader_inventory(graph, group_of(&donor)).unwrap().iter().enumerate() {
            let diffuse = donor.diffuse_name(shader as u16);
            let embedded = diffuse.is_some_and(|name| donor.sheets.iter().any(|own| own.eq_ignore_ascii_case(name)));
            let stride = donor.template_layout(shader as u16).map(|(stride, _)| stride);
            println!("shader {shader}: name {:#010x} file {:#010x} bucket {} diffuse {diffuse:?} embedded {embedded} stride {stride:?}", entry.name, entry.file, entry.bucket);
        }
    }

    fn tiny_graph() -> Graph {
        rg::from_parts(165, 0, 0, vec![0u8; 64], Vec::new())
    }

    #[test]
    fn a_block_number_outside_the_graph_is_refused_by_every_reader() {
        let graph = tiny_graph();
        let outside = graph.blocks.len() + 5;
        let gap = "Блок вне графа.";
        assert_eq!(shader_param(&graph, outside, 0, 1).unwrap_err().message, gap);
        assert_eq!(diffuse_texture(&graph, outside, 0).unwrap_err().message, gap);
        assert_eq!(shader_inventory(&graph, outside).unwrap_err().message, gap);
        match pack_geometry(&graph, outside, &triangle()) {
            Err(Refusal::Unsupported(text)) => assert_eq!(text, "Образец вне графа."),
            other => panic!("ожидался отказ: {other:?}"),
        }
        // Номер блока, который есть, по-прежнему читается как раньше.
        assert_eq!(shader_inventory(&graph, 0).unwrap(), Vec::new());
    }

    #[test]
    fn a_failed_rename_leaves_the_graph_as_it_was() {
        let mut graph = tiny_graph();
        let (blocks, area) = (graph.blocks.len(), graph.system.clone());
        // У блока нет указателя на имя: прежний отказ, но без дописанного блока имени.
        let refused = rename_drawable(&mut graph, 0, "fine_name").unwrap_err();
        assert_eq!(refused.message, "В блоке нет указателя по этому смещению.");
        assert_eq!((graph.blocks.len(), graph.system == area), (blocks, true));
        // Корень вне графа — отказ, а не паника.
        let outside = graph.blocks.len() + 2;
        assert_eq!(rename_drawable(&mut graph, outside, "fine_name").unwrap_err().message, "Блок вне графа.");
        assert_eq!(rename_drawable_plain(&mut graph, outside, "fine_name").unwrap_err().message, "Блок вне графа.");
        let texture = Address { segment: Segment::System, offset: 0x7000 };
        assert_eq!(rename_external_texture(&mut graph, texture, "fine_name").unwrap_err().message, "Текстура вне блоков.");
        assert_eq!((graph.blocks.len(), graph.system == area), (blocks, true));
    }
}
