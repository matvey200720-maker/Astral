//! Записи света (`LightAttributes`, по 168 байт) в `.yft`, `.ydr`, `.ydd`.
//!
//! Модуль разбирает и пишет запись, вынимает списки света из ресурсов, считает
//! отпечатки SHA-256 по каноническому JSON и строки описи так же, как программа-хост,
//! печатает `f32` как `System.Text.Json` и правит свет фрагмента на месте.

use crate::{
    drawable::read_skeleton,
    error::{Error, Result},
    hash::sha256_hex,
    meta_graph::deflate_body,
    resource::{Resource, HEADER_BYTES},
};

pub const LIGHT_BYTES: usize = 0xa8;

/// Адреса в теле ресурса.
mod place {
    /// Фрагмент: список света, число записей, рисовалка со скелетом.
    pub const FRAG_RECORDS: usize = 0x110;
    pub const FRAG_TOTAL: usize = 0x118;
    pub const FRAG_BODY: usize = 0x30;
    /// Рисовалка: список света и число записей.
    pub const DRAW_RECORDS: usize = 0xb0;
    pub const DRAW_TOTAL: usize = 0xb8;
    /// Словарь рисовалок: список указателей, их число и потолок числа.
    pub const DICT_ENTRIES: usize = 0x30;
    pub const DICT_TOTAL: usize = 0x38;
    pub const DICT_MAX: usize = 4096;
}

/// Тексты отказов.
struct Words {
    no_root: &'static str,
    no_list: &'static str,
    index_out: &'static str,
    record_out: &'static str,
    too_many_drawables: &'static str,
    short_record: &'static str,
}

const WORDS: Words = Words {
    no_root: "Фрагмент без корня.",
    no_list: "Фрагмент без списка света.",
    index_out: "Номер света вне списка фрагмента.",
    record_out: "Запись света вне тела.",
    too_many_drawables: "Словарь заявляет слишком много рисовалок.",
    short_record: "Запись света короче 168 байт.",
};

/// Имена известных типов света; всё прочее — «unknown».
const KIND_NAMES: [(u8, &str); 3] = [(1, "point"), (2, "spot"), (4, "capsule")];

// ------------------------------------------------------------ запись света

/// Поле записи: сколько занимает и как читается и пишется. Однобайтовые поля пишутся
/// по индексу, остальные срезом: от этого зависит, чем кончается запись в короткий буфер.
trait Wire: Sized {
    const SIZE: usize;
    fn get(raw: &[u8]) -> Self;
    fn put(&self, raw: &mut [u8], at: usize);
}

macro_rules! wire_numbers {
    ($($ty:ty),*) => {$(
        impl Wire for $ty {
            const SIZE: usize = std::mem::size_of::<$ty>();
            fn get(raw: &[u8]) -> Self {
                Self::from_le_bytes(raw[..Self::SIZE].try_into().expect("размер поля"))
            }
            fn put(&self, raw: &mut [u8], at: usize) {
                raw[at..at + Self::SIZE].copy_from_slice(&self.to_le_bytes());
            }
        }
    )*};
}
wire_numbers!(u16, u32, f32);

impl Wire for u8 {
    const SIZE: usize = 1;
    fn get(raw: &[u8]) -> Self {
        raw[0]
    }
    fn put(&self, raw: &mut [u8], at: usize) {
        raw[at] = *self;
    }
}

impl Wire for [u8; 3] {
    const SIZE: usize = 3;
    fn get(raw: &[u8]) -> Self {
        [raw[0], raw[1], raw[2]]
    }
    fn put(&self, raw: &mut [u8], at: usize) {
        raw[at..at + 3].copy_from_slice(self);
    }
}

impl Wire for [f32; 3] {
    const SIZE: usize = 12;
    fn get(raw: &[u8]) -> Self {
        std::array::from_fn(|i| f32::get(&raw[i * 4..]))
    }
    fn put(&self, raw: &mut [u8], at: usize) {
        for (i, part) in self.iter().enumerate() {
            raw[at + i * 4..at + i * 4 + 4].copy_from_slice(&part.to_le_bytes());
        }
    }
}

/// Объявляет структуру и разом читающие и пишущие её поля подряд, без пропусков.
macro_rules! light_record {
    ($($field:ident: $ty:ty,)*) => {
        /// Запись света: 41 поле, little-endian, вплотную.
        #[derive(Debug, Clone, Copy, PartialEq)]
        pub struct Light {
            $(pub $field: $ty,)*
        }

        impl Light {
            /// Первые 168 байт как запись; короче — `None`.
            pub fn decode(raw: &[u8]) -> Option<Light> {
                if raw.len() < LIGHT_BYTES {
                    return None;
                }
                let mut at = 0;
                $(
                    let $field = <$ty as Wire>::get(&raw[at..]);
                    at += <$ty as Wire>::SIZE;
                )*
                debug_assert_eq!(at, LIGHT_BYTES);
                Some(Light { $($field,)* })
            }

            /// Пишет 168 байт. Буфер короче — отказ, и в нём не записано ничего.
            pub fn try_encode(&self, raw: &mut [u8]) -> Result<()> {
                if raw.len() < LIGHT_BYTES {
                    return Err(Error::broken(WORDS.short_record));
                }
                let mut at = 0;
                $(
                    Wire::put(&self.$field, raw, at);
                    at += <$ty as Wire>::SIZE;
                )*
                debug_assert_eq!(at, LIGHT_BYTES);
                Ok(())
            }

            /// То же, что `try_encode`, но в короткий буфер паникует (ничего не записав).
            pub fn encode(&self, raw: &mut [u8]) {
                if let Err(refusal) = self.try_encode(raw) {
                    panic!("{}", refusal.message);
                }
            }
        }
    };
}

light_record! {
    unknown_0h: u32,
    unknown_4h: u32,
    position: [f32; 3],
    unknown_14h: u32,
    color: [u8; 3],
    flashiness: u8,
    intensity: f32,
    flags: u32,
    bone_id: u16,
    kind: u8,
    group_id: u8,
    time_flags: u32,
    falloff: f32,
    falloff_exponent: f32,
    culling_plane_normal: [f32; 3],
    culling_plane_offset: f32,
    shadow_blur: u8,
    unknown_45h: u8,
    unknown_46h: u16,
    unknown_48h: u32,
    volume_intensity: f32,
    volume_size_scale: f32,
    volume_outer_color: [u8; 3],
    light_hash: u8,
    volume_outer_intensity: f32,
    corona_size: f32,
    volume_outer_exponent: f32,
    light_fade_distance: u8,
    shadow_fade_distance: u8,
    specular_fade_distance: u8,
    volumetric_fade_distance: u8,
    shadow_near_clip: f32,
    corona_intensity: f32,
    corona_z_bias: f32,
    direction: [f32; 3],
    tangent: [f32; 3],
    cone_inner_angle: f32,
    cone_outer_angle: f32,
    extent: [f32; 3],
    projected_texture_hash: u32,
    unknown_a4h: u32,
}

// ------------------------------------------------------------ числа в JSON

/// Цифры (по одной в байте) и десятичный порядок первой цифры; хвостовые нули срезаны.
fn scientific_digits(text: &str) -> (Vec<u8>, i32) {
    let (mantissa, exponent) = text.split_once('e').expect("запись с порядком");
    let mut digits: Vec<u8> = mantissa.bytes().filter(u8::is_ascii_digit).map(|b| b - b'0').collect();
    while digits.len() > 1 && digits.last() == Some(&0) {
        digits.pop();
    }
    (digits, exponent.parse().expect("порядок"))
}

/// Округление точного значения до `n` цифр к чётной, когда за ними остаётся ровно «5».
fn round_even(exact: &[u8], exponent: i32, n: usize) -> (Vec<u8>, i32) {
    let mut kept = exact[..n].to_vec();
    if kept[n - 1] % 2 == 0 {
        return (kept, exponent);
    }
    for digit in kept.iter_mut().rev() {
        if *digit == 9 {
            *digit = 0;
        } else {
            *digit += 1;
            return (kept, exponent);
        }
    }
    // перенос через старшую цифру: 99|5 -> 100
    kept.insert(0, 1);
    kept.truncate(n);
    (kept, exponent + 1)
}

/// Число `f32` в тексте `System.Text.Json`: кратчайшие цифры, без `.0`, научная запись
/// вне `1E-5 … 1E+14`. Не конечное значение — паника: свет с таким числом отсекает
/// `Light::check_finite` до печати.
pub fn float_json(value: f32) -> String {
    if !value.is_finite() {
        panic!("научная запись");
    }
    if value == 0.0 {
        return if value.is_sign_negative() { "-0" } else { "0" }.to_string();
    }
    let magnitude = value.abs();
    let (mut digits, mut exponent) = scientific_digits(&format!("{magnitude:e}"));
    // В точной ничьей (точное значение длиннее на одну цифру «5») хост берёт чётную,
    // а Rust — старшую по модулю.
    let (exact, exact_exponent) = scientific_digits(&format!("{magnitude:.120e}"));
    if exact.len() == digits.len() + 1 && exact.last() == Some(&5) {
        (digits, exponent) = round_even(&exact, exact_exponent, digits.len());
        while digits.len() > 1 && digits.last() == Some(&0) {
            digits.pop();
        }
    }
    place_digits(value < 0.0, &digits, exponent)
}

fn place_digits(negative: bool, digits: &[u8], exponent: i32) -> String {
    let text: String = digits.iter().map(|d| char::from(b'0' + d)).collect();
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if !(-4..=14).contains(&exponent) {
        out.push_str(&text[..1]);
        if text.len() > 1 {
            out.push('.');
            out.push_str(&text[1..]);
        }
        out.push_str(&format!("E{}{:02}", if exponent < 0 { '-' } else { '+' }, exponent.abs()));
    } else if exponent < 0 {
        out.push_str("0.");
        out.push_str(&"0".repeat((-exponent - 1) as usize));
        out.push_str(&text);
    } else {
        let whole = exponent as usize + 1;
        if text.len() > whole {
            out.push_str(&text[..whole]);
            out.push('.');
            out.push_str(&text[whole..]);
        } else {
            out.push_str(&text);
            out.push_str(&"0".repeat(whole - text.len()));
        }
    }
    out
}

// ------------------------------------------------------------ JSON

/// Узел JSON без пробелов; текст вставляется в кавычки как есть.
enum Json {
    Int(u64),
    Real(f32),
    Vec3([f32; 3]),
    Text(String),
    Rgb([u8; 3]),
    Obj(Vec<(&'static str, Json)>),
    Null,
}

impl Json {
    fn render(&self, out: &mut String) {
        match self {
            Json::Int(n) => out.push_str(&n.to_string()),
            Json::Real(x) => out.push_str(&float_json(*x)),
            Json::Vec3([x, y, z]) => {
                out.push_str(&format!("{{\"x\":{},\"y\":{},\"z\":{}}}", float_json(*x), float_json(*y), float_json(*z)))
            }
            Json::Text(s) => {
                out.push('"');
                out.push_str(s);
                out.push('"');
            }
            Json::Rgb([r, g, b]) => out.push_str(&format!("{{\"r\":{r},\"g\":{g},\"b\":{b}}}")),
            Json::Obj(members) => {
                out.push('{');
                for (i, (key, value)) in members.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push('"');
                    out.push_str(key);
                    out.push_str("\":");
                    value.render(out);
                }
                out.push('}');
            }
            Json::Null => out.push_str("null"),
        }
    }

    fn into_text(self) -> String {
        let mut out = String::new();
        self.render(&mut out);
        out
    }
}

fn int(n: impl Into<u64>) -> Json {
    Json::Int(n.into())
}

impl Light {
    pub fn kind_name(&self) -> &'static str {
        KIND_NAMES
            .iter()
            .find(|(code, _)| *code == self.kind)
            .map_or("unknown", |(_, name)| name)
    }

    /// Имя первого поля-числа записи, которое не конечно (NaN или бесконечность), в
    /// написании JSON-описи; у вектора с осью: `position.y`. Проверяются ровно те числа,
    /// которые печатают `fingerprint`, `immutable_fingerprint`, `describe` и `studio_describe`.
    pub fn non_finite_field(&self) -> Option<String> {
        const AXES: [&str; 3] = ["x", "y", "z"];
        let fields: [(&str, &[f32]); 19] = [
            ("position", &self.position),
            ("intensity", std::slice::from_ref(&self.intensity)),
            ("falloff", std::slice::from_ref(&self.falloff)),
            ("falloffExponent", std::slice::from_ref(&self.falloff_exponent)),
            ("cullingPlaneNormal", &self.culling_plane_normal),
            ("cullingPlaneOffset", std::slice::from_ref(&self.culling_plane_offset)),
            ("volumeIntensity", std::slice::from_ref(&self.volume_intensity)),
            ("volumeSizeScale", std::slice::from_ref(&self.volume_size_scale)),
            ("volumeOuterIntensity", std::slice::from_ref(&self.volume_outer_intensity)),
            ("coronaSize", std::slice::from_ref(&self.corona_size)),
            ("volumeOuterExponent", std::slice::from_ref(&self.volume_outer_exponent)),
            ("shadowNearClip", std::slice::from_ref(&self.shadow_near_clip)),
            ("coronaIntensity", std::slice::from_ref(&self.corona_intensity)),
            ("coronaZBias", std::slice::from_ref(&self.corona_z_bias)),
            ("direction", &self.direction),
            ("tangent", &self.tangent),
            ("coneInnerAngle", std::slice::from_ref(&self.cone_inner_angle)),
            ("coneOuterAngle", std::slice::from_ref(&self.cone_outer_angle)),
            ("extent", &self.extent),
        ];
        fields.iter().find_map(|(name, values)| {
            let bad = values.iter().position(|value| !value.is_finite())?;
            Some(if values.len() == 1 { (*name).to_string() } else { format!("{name}.{}", AXES[bad]) })
        })
    }

    /// Отказ, если в записи есть не конечное число: `float_json` на таком паникует, и опись
    /// или отпечаток света с ним не собрать. `index` — номер света в списке файла.
    pub fn check_finite(&self, index: usize) -> Result<()> {
        match self.non_finite_field() {
            None => Ok(()),
            Some(field) => Err(Error::broken(format!(
                "Свет {index}: поле {field} не число (NaN или бесконечность)."
            ))),
        }
    }

    /// То же, что `check_finite`, и ещё положение в модели, которое `describe` печатает
    /// как `modelPosition`: оно считается из матрицы кости, а не из записи, и с не конечной
    /// матрицей тоже не печатается. Для описи фрагмента: `light.check_described(i, *model)?`.
    pub fn check_described(&self, index: usize, model_position: Option<[f32; 3]>) -> Result<()> {
        self.check_finite(index)?;
        let bad = model_position.and_then(|spot| spot.iter().position(|value| !value.is_finite()));
        match bad {
            None => Ok(()),
            Some(axis) => Err(Error::broken(format!(
                "Свет {index}: поле modelPosition.{} не число (NaN или бесконечность).",
                ["x", "y", "z"][axis]
            ))),
        }
    }

    /// Неизменяемые мод-правкой поля; тип света идёт числом.
    fn fixed_fields(&self) -> Json {
        Json::Obj(vec![
            ("unknown_0h", int(self.unknown_0h)),
            ("unknown_4h", int(self.unknown_4h)),
            ("position", Json::Vec3(self.position)),
            ("unknown_14h", int(self.unknown_14h)),
            ("flashiness", int(self.flashiness)),
            ("boneId", int(self.bone_id)),
            ("type", int(self.kind)),
            ("groupId", int(self.group_id)),
            ("timeFlags", int(self.time_flags)),
            ("cullingPlaneNormal", Json::Vec3(self.culling_plane_normal)),
            ("cullingPlaneOffset", Json::Real(self.culling_plane_offset)),
            ("shadowBlur", int(self.shadow_blur)),
            ("unknown_45h", int(self.unknown_45h)),
            ("unknown_46h", int(self.unknown_46h)),
            ("unknown_48h", int(self.unknown_48h)),
            ("lightHash", int(self.light_hash)),
            ("shadowFadeDistance", int(self.shadow_fade_distance)),
            ("specularFadeDistance", int(self.specular_fade_distance)),
            ("shadowNearClip", Json::Real(self.shadow_near_clip)),
            ("direction", Json::Vec3(self.direction)),
            ("tangent", Json::Vec3(self.tangent)),
            ("coneInnerAngle", Json::Real(self.cone_inner_angle)),
            ("coneOuterAngle", Json::Real(self.cone_outer_angle)),
            ("extent", Json::Vec3(self.extent)),
            ("projectedTextureHash", int(self.projected_texture_hash)),
            ("unknown_A4h", int(self.unknown_a4h)),
        ])
    }

    /// Все поля, доступные мод-правке; неизменяемые вложены первым ключом.
    fn editable_fields(&self) -> Json {
        let [cr, cg, cb] = self.color;
        let [vr, vg, vb] = self.volume_outer_color;
        Json::Obj(vec![
            ("immutable", self.fixed_fields()),
            ("colorR", int(cr)),
            ("colorG", int(cg)),
            ("colorB", int(cb)),
            ("intensity", Json::Real(self.intensity)),
            ("falloff", Json::Real(self.falloff)),
            ("falloffExponent", Json::Real(self.falloff_exponent)),
            ("coronaIntensity", Json::Real(self.corona_intensity)),
            ("coronaSize", Json::Real(self.corona_size)),
            ("coronaZBias", Json::Real(self.corona_z_bias)),
            ("volumeIntensity", Json::Real(self.volume_intensity)),
            ("volumeSizeScale", Json::Real(self.volume_size_scale)),
            ("volumeOuterColorR", int(vr)),
            ("volumeOuterColorG", int(vg)),
            ("volumeOuterColorB", int(vb)),
            ("volumeOuterIntensity", Json::Real(self.volume_outer_intensity)),
            ("volumeOuterExponent", Json::Real(self.volume_outer_exponent)),
            ("lightFadeDistance", int(self.light_fade_distance)),
            ("volumetricFadeDistance", int(self.volumetric_fade_distance)),
            ("flags", int(self.flags)),
        ])
    }

    /// SHA-256 канонического JSON неизменяемых полей.
    pub fn immutable_fingerprint(&self) -> String {
        sha256_hex(self.fixed_fields().into_text().as_bytes())
    }

    /// SHA-256 канонического JSON всех полей, доступных мод-правке.
    pub fn fingerprint(&self) -> String {
        sha256_hex(self.editable_fields().into_text().as_bytes())
    }

    /// Строка описи для студии: `list` вставляется в кавычки без экранирования.
    pub fn studio_describe(&self, list: &str, index: usize) -> String {
        Json::Obj(vec![
            ("list", Json::Text(list.to_string())),
            ("index", int(index as u64)),
            ("type", Json::Text(self.kind_name().to_string())),
            ("flags", int(self.flags)),
            ("timeFlags", int(self.time_flags)),
            ("bone", int(self.bone_id)),
            ("color", Json::Rgb(self.color)),
            ("intensity", Json::Real(self.intensity)),
            ("falloff", Json::Real(self.falloff)),
            ("falloffExponent", Json::Real(self.falloff_exponent)),
            (
                "corona",
                Json::Obj(vec![
                    ("intensity", Json::Real(self.corona_intensity)),
                    ("size", Json::Real(self.corona_size)),
                ]),
            ),
            (
                "volume",
                Json::Obj(vec![
                    ("intensity", Json::Real(self.volume_intensity)),
                    ("sizeScale", Json::Real(self.volume_size_scale)),
                    ("outerColor", Json::Rgb(self.volume_outer_color)),
                ]),
            ),
            ("position", Json::Vec3(self.position)),
            ("direction", Json::Vec3(self.direction)),
            ("coneOuterAngle", Json::Real(self.cone_outer_angle)),
        ])
        .into_text()
    }

    /// Строка описи для `lamp-inspect`; положение в модели — вектор или `null`.
    pub fn describe(&self, index: usize, model_position: Option<[f32; 3]>) -> String {
        Json::Obj(vec![
            ("index", int(index as u64)),
            ("fingerprint", Json::Text(self.fingerprint())),
            ("immutableFingerprint", Json::Text(self.immutable_fingerprint())),
            ("boneTag", int(self.bone_id)),
            ("type", Json::Text(self.kind_name().to_string())),
            ("flags", int(self.flags)),
            ("timeFlags", int(self.time_flags)),
            ("position", Json::Vec3(self.position)),
            ("modelPosition", model_position.map_or(Json::Null, Json::Vec3)),
            ("color", Json::Rgb(self.color)),
            ("intensity", Json::Real(self.intensity)),
            ("falloff", Json::Real(self.falloff)),
            ("falloffExponent", Json::Real(self.falloff_exponent)),
            ("lightFadeDistance", int(self.light_fade_distance)),
            (
                "volume",
                Json::Obj(vec![
                    ("intensity", Json::Real(self.volume_intensity)),
                    ("sizeScale", Json::Real(self.volume_size_scale)),
                    ("outerColor", Json::Rgb(self.volume_outer_color)),
                    ("outerIntensity", Json::Real(self.volume_outer_intensity)),
                    ("outerExponent", Json::Real(self.volume_outer_exponent)),
                    ("fadeDistance", int(self.volumetric_fade_distance)),
                ]),
            ),
            (
                "corona",
                Json::Obj(vec![
                    ("intensity", Json::Real(self.corona_intensity)),
                    ("size", Json::Real(self.corona_size)),
                    ("zBias", Json::Real(self.corona_z_bias)),
                ]),
            ),
            ("direction", Json::Vec3(self.direction)),
            ("tangent", Json::Vec3(self.tangent)),
            ("coneInnerAngle", Json::Real(self.cone_inner_angle)),
            ("coneOuterAngle", Json::Real(self.cone_outer_angle)),
            ("extent", Json::Vec3(self.extent)),
            ("projectedTextureHash", Json::Text(format!("0x{:08X}", self.projected_texture_hash))),
        ])
        .into_text()
    }
}

// ------------------------------------------------------------ списки света

/// Массив записей света в теле: адрес первой записи и число записей.
struct Run {
    first: usize,
    count: usize,
}

impl Run {
    /// Список лежит по указателю `base + list_off`, число записей (u16) — по `base + count_off`.
    /// Нет указателя — `None`, и число тогда не читается.
    fn locate(res: &Resource, base: usize, list_off: usize, count_off: usize) -> Result<Option<Run>> {
        res.pointer_at(base + list_off)
            .map(|first| res.u16(base + count_off).map(|n| Run { first, count: usize::from(n) }))
            .transpose()
    }

    /// Запись `index`: 168 байт подряд; за концом тела — отказ.
    fn light(&self, res: &Resource, index: usize) -> Result<Light> {
        let raw = res.bytes(self.first + index * LIGHT_BYTES, LIGHT_BYTES)?;
        Light::decode(raw).ok_or_else(|| Error::broken(WORDS.short_record))
    }

    fn lights<'a>(&'a self, res: &'a Resource) -> impl Iterator<Item = Result<Light>> + 'a {
        (0..self.count).map(move |index| self.light(res, index))
    }
}

/// Окно записей света в копии тела: отдаёт запись по номеру, если она помещается.
struct Window<'b> {
    body: &'b mut [u8],
    first: usize,
}

impl Window<'_> {
    fn at(&mut self, index: usize) -> Option<&mut [u8]> {
        let start = self.first + index * LIGHT_BYTES;
        self.body.get_mut(start..start + LIGHT_BYTES)
    }
}

/// Точка `p`, преобразованная матрицей по столбцам; вычисление в `f32` слева направо.
fn through(m: &[f32; 16], p: [f32; 3]) -> [f32; 3] {
    let row = |r: usize| ((m[r] * p[0] + m[r + 4] * p[1]) + m[r + 8] * p[2]) + m[r + 12];
    [row(0), row(1), row(2)]
}

/// Свет фрагмента с его положением в модели (по первой кости с тем же тегом).
fn placed_lights(res: &Resource, root: usize, run: &Run) -> Result<Vec<(Light, Option<[f32; 3]>)>> {
    // Скелет читается раньше записей: его ошибка побеждает.
    let bones = res
        .pointer_at(root + place::FRAG_BODY)
        .map_or_else(|| Ok(Vec::new()), |drawable| read_skeleton(res, drawable))?;
    run.lights(res)
        .map(|read| {
            read.map(|light| {
                let spot = bones
                    .iter()
                    .find(|bone| bone.tag == light.bone_id)
                    .map_or(light.position, |bone| through(&bone.matrix, light.position));
                (light, Some(spot))
            })
        })
        .collect()
}

/// Нет корня — нет и света; иначе дальше работает `then` с адресом корня.
fn from_root<T>(res: &Resource, then: impl FnOnce(usize) -> Result<Vec<T>>) -> Result<Vec<T>> {
    res.root().map_or_else(|| Ok(Vec::new()), then)
}

/// Свет фрагмента и его положение в модели.
pub fn fragment_lights(res: &Resource) -> Result<Vec<(Light, Option<[f32; 3]>)>> {
    from_root(res, |root| {
        Run::locate(res, root, place::FRAG_RECORDS, place::FRAG_TOTAL)?
            .map_or_else(|| Ok(Vec::new()), |run| placed_lights(res, root, &run))
    })
}

/// Свет рисовалки, лежащей по адресу `drawable_at` в теле.
pub fn drawable_lights(res: &Resource, drawable_at: usize) -> Result<Vec<Light>> {
    Run::locate(res, drawable_at, place::DRAW_RECORDS, place::DRAW_TOTAL)?
        .map_or_else(|| Ok(Vec::new()), |run| run.lights(res).collect())
}

/// Свет каждой рисовалки словаря, у которой он есть, с исходным номером в списке.
pub fn dictionary_lights(res: &Resource) -> Result<Vec<(usize, Vec<Light>)>> {
    from_root(res, |root| {
        match Run::locate(res, root, place::DICT_ENTRIES, place::DICT_TOTAL)? {
            None => Ok(Vec::new()),
            Some(run) if run.count > place::DICT_MAX => Err(Error::broken(WORDS.too_many_drawables)),
            Some(run) => (0..run.count)
                .filter_map(|index| res.pointer_at(run.first + index * 8).map(|at| (index, at)))
                .map(|(index, at)| drawable_lights(res, at).map(|lights| (index, lights)))
                .filter(|found| !matches!(found, Ok((_, lights)) if lights.is_empty()))
                .collect(),
        }
    })
}

/// Переписывает записи света фрагмента: заголовок как был, тело пересжато.
pub fn patch_fragment_lights(input: &[u8], edits: &[(usize, Light)]) -> Result<Vec<u8>> {
    let res = Resource::parse(input)?;
    let root = res.root().ok_or_else(|| Error::broken(WORDS.no_root))?;
    let run = Run::locate(&res, root, place::FRAG_RECORDS, place::FRAG_TOTAL)?
        .ok_or_else(|| Error::broken(WORDS.no_list))?;

    let mut body = res.data().to_vec();
    let mut window = Window { body: &mut body, first: run.first };
    edits.iter().try_for_each(|(index, light)| -> Result<()> {
        if *index >= run.count {
            return Err(Error::argument(WORDS.index_out));
        }
        let slot = window.at(*index).ok_or_else(|| Error::broken(WORDS.record_out))?;
        light.encode(slot);
        Ok(())
    })?;

    Ok([&input[..HEADER_BYTES], deflate_body(&body).as_slice()].concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zero_light() -> Light {
        Light::decode(&[0u8; LIGHT_BYTES]).unwrap()
    }

    #[test]
    fn encode_round_trips_the_decoded_record() {
        let raw: Vec<u8> = (0..LIGHT_BYTES).map(|i| (i * 37 % 251) as u8).collect();
        let light = Light::decode(&raw).expect("168 байт");
        let mut again = vec![0u8; LIGHT_BYTES];
        light.encode(&mut again);
        assert_eq!(raw, again);
    }

    #[test]
    fn floats_follow_the_dotnet_text() {
        let cases = [
            (0.1f32, "0.1"),
            (96.0, "96"),
            (-1.410179e-7, "-1.410179E-07"),
            (1.0e15, "1E+15"),
            (0.0, "0"),
            (-0.0, "-0"),
            (2539.90625, "2539.9062"),
            (4620.03125, "4620.0312"),
            (1125009.25, "1125009.2"),
            (231292.125, "231292.12"),
            (2147483648.0, "2147483600"),
            (3.4028235e38, "3.4028235E+38"),
            (f32::from_bits(1), "1E-45"),
            (0.0001, "0.0001"),
            (9.9999e-5, "9.9999E-05"),
            (999999000000000.0, "999999000000000"),
        ];
        for (value, text) in cases {
            assert_eq!(float_json(value), text, "{value:e}");
        }
    }

    #[test]
    fn non_finite_numbers_panic_with_the_documented_text() {
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let caught = std::panic::catch_unwind(|| float_json(value)).unwrap_err();
            assert_eq!(caught.downcast_ref::<&str>(), Some(&"научная запись"));
        }
    }

    /// Все 29 чисел записи: по имени в описи, тремя видами не конечного значения.
    fn number_setters() -> Vec<(String, Box<dyn Fn(&mut Light, f32)>)> {
        let mut out: Vec<(String, Box<dyn Fn(&mut Light, f32)>)> = Vec::new();
        macro_rules! scalar {
            ($($name:literal => $field:ident),*) => {$(
                out.push(($name.to_string(), Box::new(|light: &mut Light, v: f32| light.$field = v)));
            )*};
        }
        macro_rules! vector {
            ($($name:literal => $field:ident),*) => {$(
                for (i, axis) in ["x", "y", "z"].into_iter().enumerate() {
                    out.push((format!("{}.{axis}", $name), Box::new(move |light: &mut Light, v: f32| light.$field[i] = v)));
                }
            )*};
        }
        scalar!("intensity" => intensity, "falloff" => falloff, "falloffExponent" => falloff_exponent,
            "cullingPlaneOffset" => culling_plane_offset, "volumeIntensity" => volume_intensity,
            "volumeSizeScale" => volume_size_scale, "volumeOuterIntensity" => volume_outer_intensity,
            "coronaSize" => corona_size, "volumeOuterExponent" => volume_outer_exponent,
            "shadowNearClip" => shadow_near_clip, "coronaIntensity" => corona_intensity,
            "coronaZBias" => corona_z_bias, "coneInnerAngle" => cone_inner_angle,
            "coneOuterAngle" => cone_outer_angle);
        vector!("position" => position, "cullingPlaneNormal" => culling_plane_normal,
            "direction" => direction, "tangent" => tangent, "extent" => extent);
        out
    }

    #[test]
    fn a_non_finite_number_is_named_and_is_exactly_what_breaks_the_fingerprint() {
        let setters = number_setters();
        assert_eq!(setters.len(), 29);
        assert_eq!(zero_light().non_finite_field(), None);
        assert!(zero_light().check_finite(0).is_ok());
        for (name, put) in &setters {
            for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
                let mut light = zero_light();
                put(&mut light, bad);
                assert_eq!(light.non_finite_field().as_deref(), Some(name.as_str()), "{name} {bad}");
                let broke = std::panic::catch_unwind(|| light.fingerprint()).is_err();
                assert!(broke, "{name} {bad}: отпечаток не упал, а поле названо");
                let refusal = light.check_finite(7).unwrap_err();
                assert_eq!(refusal.to_string(), format!("Свет 7: поле {name} не число (NaN или бесконечность)."));
            }
        }
    }

    #[test]
    fn a_non_finite_model_position_is_refused_by_axis_and_is_what_breaks_describe() {
        let light = zero_light();
        assert!(light.check_described(2, None).is_ok());
        assert!(light.check_described(2, Some([1.0, -2.0, f32::MAX])).is_ok());
        for (axis, name) in ["x", "y", "z"].into_iter().enumerate() {
            for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
                let mut spot = [0.5f32; 3];
                spot[axis] = bad;
                let refusal = light.check_described(2, Some(spot)).unwrap_err();
                assert_eq!(refusal.to_string(), format!("Свет 2: поле modelPosition.{name} не число (NaN или бесконечность)."));
                assert!(std::panic::catch_unwind(|| light.describe(2, Some(spot))).is_err(), "{name} {bad}");
            }
        }
        // Поле записи называется раньше положения в модели.
        let mut broken = light;
        broken.tangent[1] = f32::NAN;
        let refusal = broken.check_described(4, Some([f32::NAN; 3])).unwrap_err();
        assert_eq!(refusal.to_string(), "Свет 4: поле tangent.y не число (NaN или бесконечность).");
    }

    #[test]
    fn the_first_non_finite_number_in_record_order_is_named() {
        let mut light = zero_light();
        light.cone_outer_angle = f32::NAN;
        light.falloff = f32::INFINITY;
        light.direction[2] = f32::NAN;
        assert_eq!(light.non_finite_field().as_deref(), Some("falloff"));
        light.falloff = 1.0;
        assert_eq!(light.non_finite_field().as_deref(), Some("direction.z"));
        // Крайние конечные значения не отказ.
        light.direction[2] = f32::MAX;
        light.cone_outer_angle = f32::MIN_POSITIVE / 2.0;
        assert!(light.check_finite(0).is_ok());
        assert_eq!(float_json(f32::MAX), "3.4028235E+38");
    }

    #[test]
    fn a_light_takes_its_fields_from_the_entry() {
        let mut raw = [0u8; LIGHT_BYTES];
        raw[0x1c..0x20].copy_from_slice(&32.0f32.to_le_bytes());
        raw[0x26] = 2;
        raw[0x18..0x1b].copy_from_slice(&[255, 104, 0]);
        let light = Light::decode(&raw).unwrap();
        assert_eq!((light.intensity, light.kind, light.kind_name(), light.color), (32.0, 2, "spot", [255, 104, 0]));
        assert!(Light::decode(&raw[..167]).is_none());
        assert_eq!(std::mem::size_of::<Light>(), LIGHT_BYTES);
    }

    #[test]
    fn short_buffers_are_refused_with_nothing_written() {
        let mut light = zero_light();
        light.intensity = 5.0;
        for len in [0usize, 1, 100, 167] {
            let mut buffer = vec![0xeeu8; len];
            let refusal = light.try_encode(&mut buffer).unwrap_err();
            assert_eq!(refusal.message, "Запись света короче 168 байт.");
            assert!(buffer.iter().all(|&b| b == 0xee), "{len}");
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| light.encode(&mut buffer)));
            assert!(outcome.is_err());
            assert!(buffer.iter().all(|&b| b == 0xee), "{len}: encode записал до отказа");
        }
        // Ровно 168 байт и больше — как раньше; хвост за записью не тронут.
        let mut exact = vec![0xeeu8; LIGHT_BYTES + 4];
        light.try_encode(&mut exact).unwrap();
        assert!(exact[LIGHT_BYTES..].iter().all(|&b| b == 0xee));
        let mut round = vec![0u8; LIGHT_BYTES];
        light.encode(&mut round);
        assert_eq!(&exact[..LIGHT_BYTES], round.as_slice());
    }

    #[test]
    fn fingerprints_split_into_fixed_and_editable_fields() {
        let base = zero_light();
        let mut tinted = base;
        tinted.color = [1, 2, 3];
        assert_eq!(base.immutable_fingerprint(), tinted.immutable_fingerprint());
        assert_ne!(base.fingerprint(), tinted.fingerprint());
        assert_eq!(
            base.immutable_fingerprint(),
            "28dc10d3631311bc61df7b165d525a6e7d064ca1cea7487f30d6259b5e79e046"
        );
        assert_eq!(base.fingerprint(), "3f30a00d7d129865e0a10ab460142f85e3fcb44a46e7a18e6af9e738e32381d3");
    }

    #[test]
    fn descriptions_keep_the_documented_key_order() {
        let mut light = zero_light();
        light.kind = 2;
        light.projected_texture_hash = 0xabc;
        let text = light.describe(3, None);
        assert!(text.starts_with("{\"index\":3,\"fingerprint\":\""));
        assert!(text.contains("\"modelPosition\":null"));
        assert!(text.ends_with("\"projectedTextureHash\":\"0x00000ABC\"}"));
        let studio = light.studio_describe("a\"b", 1);
        assert!(studio.starts_with("{\"list\":\"a\"b\",\"index\":1,\"type\":\"spot\""));
    }
}
