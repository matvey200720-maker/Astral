//! Файлы ключевых кадров таймцикла (`common/data/timecycle/w_*.xml`).
//!
//! Файл приходит из архива игрока, поэтому разбор — граница доверия: DTD и
//! сущности запрещены, размеры и числа ограничены, всё непохожее на ожидаемую
//! форму отклоняется сообщением, которое окно показывает человеку как есть.

use crate::readers::js_text::{is_js_space, js_number, js_trim, utf16_len};
use roxmltree::{Document, Node, NodeType};
use std::{borrow::Cow, collections::HashMap, fmt};

/// Пределы разбора.
mod limit {
    /// Размер текста файла в байтах (12 МиБ).
    pub const FILE_BYTES: usize = 12 * 1024 * 1024;
    pub const REGIONS: usize = 16;
    pub const PARAMETERS: usize = 2048;
    pub const VALUES: usize = 64;
    /// Склеенный текст параметра в байтах (до обрезки пробелов).
    pub const TEXT_BYTES: usize = 8192;
    /// Имя региона в единицах UTF-16 и имя параметра в байтах.
    pub const REGION_NAME_UNITS: usize = 64;
    pub const PARAMETER_NAME_BYTES: usize = 80;
    /// Вложенность элементов. Настоящий файл — четыре уровня (корень, цикл, регион,
    /// параметр); разбор `roxmltree` рекурсивный, и на тысячах уровней он ронял процесс
    /// переполнением стека.
    pub const DEPTH: usize = 256;
}

const DEFAULT_VERSION: &str = "1.000000";

// ---------- отказы ----------

/// Причина отказа; её текст окно показывает человеку как есть.
#[derive(Debug)]
enum Refusal {
    Empty,
    TooBig,
    Dtd,
    /// Элементы вложены глубже предела.
    TooDeep,
    /// Ошибка разбора XML — текст самого `roxmltree`.
    Syntax(String),
    WrongRoot(String),
    StrayText,
    RootChild,
    SecondCycle,
    CycleName,
    CycleChild,
    RegionName,
    ManyRegions,
    RegionRepeats(String),
    ParameterName(String),
    ManyParameters,
    ParameterRepeats(String),
    Nested,
    TooLong(String),
    NoValues(String),
    ManyValues(String),
    NotNumber {
        parameter: String,
        piece: String,
    },
    NoRegions,
}

impl fmt::Display for Refusal {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        use Refusal::*;
        match self {
            Empty => out.write_str("Файл таймцикла пуст."),
            TooBig => out.write_str("Файл таймцикла превышает безопасный размер."),
            Dtd => out.write_str("Файл таймцикла не может содержать DTD или сущности."),
            TooDeep => write!(
                out,
                "XML nesting is too deep (more than {} levels)",
                limit::DEPTH
            ),
            Syntax(text) => out.write_str(text),
            WrongRoot(name) => write!(out, "Неожиданный корень файла таймцикла: <{name}>."),
            StrayText => out.write_str("Неожиданный текст в файле таймцикла."),
            RootChild => out.write_str("В корне таймцикла допустим только элемент <cycle>."),
            SecondCycle => out.write_str("Файл таймцикла содержит больше одного цикла."),
            CycleName => out.write_str("У цикла таймцикла нет имени."),
            CycleChild => out.write_str("В цикле таймцикла допустимы только элементы <region>."),
            RegionName => out.write_str("У региона таймцикла нет допустимого имени."),
            ManyRegions => out.write_str("Слишком много регионов в файле таймцикла."),
            RegionRepeats(name) => write!(out, "Регион таймцикла «{name}» повторяется."),
            ParameterName(name) => write!(out, "Недопустимое имя параметра таймцикла: <{name}>."),
            ManyParameters => out.write_str("Слишком много параметров в регионе таймцикла."),
            ParameterRepeats(name) => write!(out, "Параметр таймцикла «{name}» повторяется."),
            Nested => out.write_str("Вложенные элементы внутри параметра не поддерживаются."),
            TooLong(name) => write!(out, "Параметр таймцикла «{name}» слишком длинный."),
            NoValues(name) => write!(out, "Параметр таймцикла «{name}» пуст."),
            ManyValues(name) => write!(
                out,
                "Параметр таймцикла «{name}» содержит слишком много значений."
            ),
            NotNumber { parameter, piece } => write!(
                out,
                "Параметр таймцикла «{parameter}» содержит нечисловое значение «{piece}»."
            ),
            NoRegions => out.write_str("В файле таймцикла нет ни одного региона."),
        }
    }
}

// ---------- подготовка текста ----------

/// Первые проверки до разбора: пусто, слишком велик, DTD.
fn screen(input: &str) -> Result<(), Refusal> {
    match () {
        _ if js_trim(input).is_empty() => Err(Refusal::Empty),
        _ if input.len() > limit::FILE_BYTES => Err(Refusal::TooBig),
        _ if mentions_dtd(input) => Err(Refusal::Dtd),
        _ if nests_deeper_than(input, limit::DEPTH) => Err(Refusal::TooDeep),
        _ => Ok(()),
    }
}

/// Кавычки значений атрибутов: двойная и одинарная.
const QUOTES: [u8; 2] = [0x22, 0x27];

/// Где в `bytes` кончается `closing`, если искать с `from`; нет — `None`.
fn after_marker(bytes: &[u8], from: usize, closing: &[u8]) -> Option<usize> {
    let tail = bytes.get(from..)?;
    let found = tail
        .windows(closing.len())
        .position(|window| window == closing)?;
    Some(from + found + closing.len())
}

/// Конец начального тега, который начинается в `at` (на `<`): позиция за `>` и признак
/// самозакрытия `/>`. `>` внутри значений атрибутов в кавычках тег не кончает.
fn end_of_start_tag(bytes: &[u8], at: usize) -> Option<(usize, bool)> {
    let mut quote = None;
    for (offset, &byte) in bytes.get(at + 1..)?.iter().enumerate() {
        match quote {
            Some(open) if open == byte => quote = None,
            Some(_) => {}
            None if QUOTES.contains(&byte) => quote = Some(byte),
            None if byte == b'>' => {
                let end = at + 1 + offset;
                return Some((end + 1, bytes[end - 1] == b'/'));
            }
            None => {}
        }
    }
    None
}

/// Вложены ли элементы глубже `limit` уровней. Дешёвый просмотр текста без дерева: считает
/// начальные и закрывающие теги, пропуская комментарии, CDATA, инструкции, объявления и
/// значения атрибутов в кавычках. Нужен до `roxmltree`, чей рекурсивный разбор на очень
/// глубоком документе роняет процесс переполнением стека. Оборванный текст на этом
/// просмотре не ошибка: его отвергнет сам разбор.
fn nests_deeper_than(text: &str, limit: usize) -> bool {
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut at = 0usize;
    while let Some(found) = bytes[at..].iter().position(|&byte| byte == b'<') {
        at += found;
        let rest = &bytes[at..];
        let next = if rest.starts_with(b"<!--") {
            after_marker(bytes, at + 4, b"-->")
        } else if rest.starts_with(b"<![CDATA[") {
            after_marker(bytes, at + 9, b"]]>")
        } else if rest.starts_with(b"<?") {
            after_marker(bytes, at + 2, b"?>")
        } else if rest.starts_with(b"<!") {
            after_marker(bytes, at + 2, b">")
        } else if rest.starts_with(b"</") {
            depth = depth.saturating_sub(1);
            after_marker(bytes, at + 2, b">")
        } else {
            end_of_start_tag(bytes, at).map(|(end, self_closed)| {
                if !self_closed {
                    depth += 1;
                }
                end
            })
        };
        if depth > limit {
            return true;
        }
        match next {
            Some(end) => at = end,
            None => return false,
        }
    }
    false
}

/// Текстовый поиск `<!DOCTYPE` / `<!ENTITY`, за которым не идёт буква, цифра или `_`.
/// Работает по сырому тексту: срабатывает и внутри комментария, и внутри CDATA.
fn mentions_dtd(text: &str) -> bool {
    const MARKS: [&[u8]; 2] = [b"<!doctype", b"<!entity"];
    text.match_indices('<').any(|(at, _)| {
        let rest = &text.as_bytes()[at..];
        MARKS.iter().any(|mark| {
            let spelled = rest
                .get(..mark.len())
                .is_some_and(|word| word.eq_ignore_ascii_case(mark));
            let glued =
                matches!(rest.get(mark.len()), Some(b) if b.is_ascii_alphanumeric() || *b == b'_');
            spelled && !glued
        })
    })
}

fn skip_space(text: &str) -> &str {
    text.trim_start_matches(is_js_space)
}

/// Границы значения версии в начале `<?xml version="…"`: строгая запись, где `version`
/// в нижнем регистре, а значение не содержит кавычки другого вида.
fn declared_version_span(text: &str) -> Option<(usize, usize)> {
    let after_tag = text.strip_prefix("<?xml")?;
    // Между `<?xml` и `version` пробел обязателен.
    let rest = skip_space(after_tag);
    (rest.len() < after_tag.len()).then_some(())?;
    let rest = rest.strip_prefix("version")?;
    let rest = skip_space(skip_space(rest).strip_prefix('=')?);
    let quote = match rest.chars().next() {
        Some(mark @ ('"' | '\'')) => mark,
        _ => return None,
    };
    let value = &rest[1..];
    let length = value.find(['"', '\''])?;
    let begins = text.len() - value.len();
    value[length..]
        .starts_with(quote)
        .then_some((begins, begins + length))
}

/// Заменяет версию в декларации на `1.0` (кавычка остаётся), если запись подходит.
fn pin_declaration_version(text: &str) -> Cow<'_, str> {
    match declared_version_span(text) {
        Some((from, to)) => Cow::Owned([&text[..from], "1.0", &text[to..]].concat()),
        None => Cow::Borrowed(text),
    }
}

// ---------- обход документа ----------

/// Среди детей узла нет текста, кроме пробелов JS.
fn require_blank_text(node: Node) -> Result<(), Refusal> {
    let loose = node
        .children()
        .filter(Node::is_text)
        .filter_map(|child| child.text())
        .any(|text| !js_trim(text).is_empty());
    loose.then_some(Refusal::StrayText).map_or(Ok(()), Err)
}

/// Значение атрибута `name` без краевых пробелов JS (нет атрибута — пусто).
fn trimmed_name<'a>(node: Node<'a, '_>) -> &'a str {
    js_trim(node.attribute("name").unwrap_or_default())
}

/// Имя параметра: буква ASCII, затем буквы, цифры и `_`, не длиннее предела.
fn parameter_name_ok(name: &str) -> bool {
    name.len() <= limit::PARAMETER_NAME_BYTES
        && matches!(
            name.as_bytes(),
            [first, rest @ ..]
                if first.is_ascii_alphabetic()
                    && rest.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'_')
        )
}

/// Имя параметра-элемента, если оно годится.
fn checked_label<'a>(parameter: Node<'a, '_>) -> Result<&'a str, Refusal> {
    let label = parameter.tag_name().name();
    Some(label)
        .filter(|name| parameter_name_ok(name))
        .ok_or_else(|| Refusal::ParameterName(label.to_owned()))
}

/// Слова текста, разделённого пробелами JS.
fn js_words(text: &str) -> impl Iterator<Item = &str> {
    text.split(is_js_space).filter(|word| !word.is_empty())
}

/// Склеенный текст параметра; вложенный элемент и слишком длинный текст — отказ на месте.
fn parameter_text(node: Node, name: &str) -> Result<String, Refusal> {
    node.children().try_fold(String::new(), |mut text, child| {
        match child.node_type() {
            NodeType::Element => return Err(Refusal::Nested),
            NodeType::Text => text.push_str(child.text().unwrap_or("")),
            _ => {}
        }
        match text.len() > limit::TEXT_BYTES {
            true => Err(Refusal::TooLong(name.to_owned())),
            false => Ok(text),
        }
    })
}

/// Значения параметра: текст, разбитый по пробелам JS, и каждая часть как число.
fn parameter_values(node: Node, name: &str) -> Result<Vec<f64>, Refusal> {
    let text = parameter_text(node, name)?;
    // Число частей проверяется раньше самих чисел.
    match js_words(&text).count() {
        0 => return Err(Refusal::NoValues(name.to_owned())),
        count if count > limit::VALUES => return Err(Refusal::ManyValues(name.to_owned())),
        _ => {}
    }
    let as_number = |piece: &str| {
        js_number(piece)
            .filter(|number| number.is_finite())
            .ok_or_else(|| Refusal::NotNumber {
                parameter: name.to_owned(),
                piece: piece.to_owned(),
            })
    };
    js_words(&text).map(as_number).collect()
}

/// Регион файла: параметры в порядке файла и их значения.
#[derive(Clone, PartialEq, Debug)]
pub struct Region {
    pub values: HashMap<String, Vec<f64>>,
    pub order: Vec<String>,
    pub name: String,
}

impl Region {
    fn named(name: &str) -> Region {
        Region {
            values: HashMap::new(),
            order: Vec::new(),
            name: name.to_owned(),
        }
    }

    /// Принимает параметр (элемент-ребёнок региона) со всеми проверками по порядку.
    fn take_parameter(&mut self, parameter: Node) -> Result<(), Refusal> {
        let label = checked_label(parameter)?;
        if self.order.len() >= limit::PARAMETERS {
            return Err(Refusal::ManyParameters);
        }
        if self.values.contains_key(label) {
            return Err(Refusal::ParameterRepeats(label.to_owned()));
        }
        let numbers = parameter_values(parameter, label)?;
        self.order.push(label.to_owned());
        self.values.insert(label.to_owned(), numbers);
        Ok(())
    }
}

/// Имя региона, если по нему можно принять регион: не пусто, не длиннее предела,
/// мест ещё хватает и такого имени ещё не было (проверки идут в этом порядке).
fn region_name<'a>(node: Node<'a, '_>, accepted: &[Region]) -> Result<&'a str, Refusal> {
    let name = trimmed_name(node);
    if name.is_empty() || utf16_len(name) > limit::REGION_NAME_UNITS {
        Err(Refusal::RegionName)
    } else if accepted.len() >= limit::REGIONS {
        Err(Refusal::ManyRegions)
    } else if accepted.iter().any(|seen| seen.name == name) {
        Err(Refusal::RegionRepeats(name.to_owned()))
    } else {
        Ok(name)
    }
}

fn read_region(node: Node, accepted: &[Region]) -> Result<Region, Refusal> {
    let name = region_name(node, accepted)?;
    require_blank_text(node)?;
    let mut parameters = node.children().filter(Node::is_element);
    parameters.try_fold(Region::named(name), |mut region, parameter| {
        region.take_parameter(parameter)?;
        Ok(region)
    })
}

/// Читает цикл: имя и регионы (они дописываются к уже накопленным).
fn read_cycle(node: Node, regions: Vec<Region>) -> Result<(String, Vec<Region>), Refusal> {
    let name = trimmed_name(node);
    if name.is_empty() {
        return Err(Refusal::CycleName);
    }
    require_blank_text(node)?;
    let all = node
        .children()
        .filter(Node::is_element)
        .try_fold(regions, |mut so_far, child| {
            if child.tag_name().name() != "region" {
                return Err(Refusal::CycleChild);
            }
            let region = read_region(child, &so_far)?;
            so_far.push(region);
            Ok(so_far)
        })?;
    Ok((name.to_owned(), all))
}

#[derive(Clone, PartialEq, Debug)]
pub struct KeyframeDocument {
    pub regions: Vec<Region>,
    pub cycle_name: String,
    pub version: String,
}

impl KeyframeDocument {
    /// Первый регион с тем же именем без учёта регистра (приведение по Юникоду).
    pub fn region(&self, name: &str) -> Option<&Region> {
        let key = name.to_uppercase();
        let at = self
            .regions
            .iter()
            .position(|region| region.name.to_uppercase() == key)?;
        self.regions.get(at)
    }
}

fn read_document(input: &str) -> Result<KeyframeDocument, Refusal> {
    screen(input)?;
    let unmarked = input.strip_prefix('\u{FEFF}').unwrap_or(input);
    let prepared = pin_declaration_version(unmarked);
    let document =
        Document::parse(&prepared).map_err(|failure| Refusal::Syntax(failure.to_string()))?;

    let root = document.root_element();
    let tag = root.tag_name().name();
    if tag != "timecycle_keyframe_data" {
        return Err(Refusal::WrongRoot(tag.to_owned()));
    }
    require_blank_text(root)?;

    // Элементы корня идут подряд: ошибка первого цикла побеждает ошибку второго.
    let mut cycles = root.children().filter(Node::is_element).enumerate();
    let (cycle_name, regions) = cycles.try_fold(
        (String::new(), Vec::new()),
        |(_, regions), (index, child)| {
            if child.tag_name().name() != "cycle" {
                Err(Refusal::RootChild)
            } else if index > 0 {
                Err(Refusal::SecondCycle)
            } else {
                read_cycle(child, regions)
            }
        },
    )?;
    if regions.is_empty() {
        return Err(Refusal::NoRegions);
    }
    Ok(KeyframeDocument {
        regions,
        cycle_name,
        version: root.attribute("version").unwrap_or(DEFAULT_VERSION).into(),
    })
}

/// Разбирает текст файла таймцикла; ошибка — готовое сообщение для человека.
pub fn parse(input: &str) -> Result<KeyframeDocument, String> {
    read_document(input).map_err(|refusal| refusal.to_string())
}

#[cfg(test)]
mod tests;
