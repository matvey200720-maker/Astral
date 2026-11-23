//! Правка `weapons.meta`: эффект трассера с шансами, вспышка и общий вид выстрела.
//!
//! Документ разбирается `roxmltree`, правки копятся поверх дерева и применяются при записи,
//! которая повторяет вывод `XmlDocument.Save` на хосте: своя декларация, LF, пустые элементы
//! вида `<X />`. Всё, что хост записал бы иначе, отклоняется словами «пока на хосте».

use std::borrow::Cow;
use std::collections::{BTreeSet, HashMap};

use roxmltree::{Document, Node, NodeId, NodeType};

use crate::error::{Error, Result};

const MAX_BINDINGS: usize = 256;
const MAX_IDENTIFIER: usize = 96;
/// Глубже этого разбор `roxmltree` рекурсивен настолько, что переполняет стек главного потока.
const MAX_NESTING: usize = 100;
const OUR_DECLARATION: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>";

/// Текст отказа «… — пока на хосте.».
fn pending(reason: &str) -> String {
    format!("weapons.meta: {reason} — пока на хосте.")
}

/// Первый сработавший отказ из таблицы правил «условие → текст»; порядок правил — порядок проверок.
fn refuse_first<const N: usize>(rules: [Option<String>; N]) -> Result<()> {
    match rules.into_iter().flatten().next() {
        Some(text) => Err(Error::broken(text)),
        None => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Чтение документа
// ---------------------------------------------------------------------------

/// Значение атрибута в тексте декларации: первое вхождение слова, `=`, затем любой символ
/// служит кавычкой, значение — до такой же.
fn declared_value<'a>(declaration: &'a str, word: &str) -> Option<&'a str> {
    let after_word = &declaration[declaration.find(word)? + word.len()..];
    let value_part = after_word.trim_start().strip_prefix('=')?.trim_start();
    let quote = value_part.chars().next()?;
    let inner = &value_part[quote.len_utf8()..];
    inner.split_once(quote).map(|(value, _)| value)
}

/// Проверяет декларацию (если она есть) и возвращает место сразу за ней.
fn skip_declaration(text: &str) -> Result<usize> {
    let Some(after_tag) = text.strip_prefix("<?xml") else { return Ok(0) };
    let Some(first) = after_tag.chars().next().filter(|c| c.is_whitespace()) else { return Ok(0) };
    // `roxmltree` узнаёт декларацию только по обычному пробелу; с табуляцией, переводом строки и
    // прочими пробельными знаками он принимает её за обычную инструкцию, и границы кусков расходятся.
    refuse_first([(first != ' ').then(|| pending("декларация XML с пробельным знаком вместо обычного пробела"))])?;
    let Some((head, _)) = text.split_once("?>") else {
        return Err(Error::broken("Декларация weapons.meta не закрыта."));
    };
    let inside = &head[5..];
    let is_utf8 = |value: &str| value.eq_ignore_ascii_case("utf-8");
    refuse_first([
        (declared_value(inside, "version") != Some("1.0")).then(|| pending("версия XML не 1.0")),
        (inside.contains("encoding") && !declared_value(inside, "encoding").is_some_and(is_utf8))
            .then(|| pending("кодировка декларации не UTF-8")),
        inside.contains("standalone").then(|| pending("декларация со standalone")),
    ])?;
    Ok(head.len() + 2)
}

/// Самая глубокая вложенность элементов по тексту, без разбора: комментарии, CDATA, инструкции
/// и значения атрибутов в кавычках пропускаются, пустые элементы глубины не добавляют.
fn nesting_depth(text: &str) -> usize {
    let bytes = text.as_bytes();
    let find = |from: usize, needle: &[u8]| {
        bytes[from..].windows(needle.len()).position(|w| w == needle).map(|at| from + at + needle.len())
    };
    let (mut at, mut depth, mut deepest) = (0, 0usize, 0usize);
    while let Some(open) = bytes[at..].iter().position(|&b| b == b'<').map(|p| at + p) {
        let rest = &bytes[open..];
        let end = if rest.starts_with(b"<!--") {
            find(open + 4, b"-->")
        } else if rest.starts_with(b"<![CDATA[") {
            find(open + 9, b"]]>")
        } else if rest.starts_with(b"<?") {
            find(open + 2, b"?>")
        } else if rest.starts_with(b"<!") {
            find(open + 2, b">")
        } else if rest.starts_with(b"</") {
            depth = depth.saturating_sub(1);
            find(open + 2, b">")
        } else {
            let mut quote = None;
            let close = (open + 1..bytes.len()).find(|&j| match (quote, bytes[j]) {
                (None, q @ (b'"' | b'\'')) => {
                    quote = Some(q);
                    false
                }
                (Some(q), c) if c == q => {
                    quote = None;
                    false
                }
                (None, b'>') => true,
                _ => false,
            });
            close.map(|j| {
                if bytes[j - 1] != b'/' {
                    depth += 1;
                    deepest = deepest.max(depth);
                }
                j + 1
            })
        };
        match end {
            Some(next) => at = next,
            None => break,
        }
    }
    deepest
}

/// Все элементы документа в порядке чтения.
fn elements<'a, 'i>(doc: &'a Document<'i>) -> impl Iterator<Item = Node<'a, 'i>> {
    doc.descendants().filter(Node::is_element)
}

/// Чем элемент не годится для записи хоста по части пространств имён.
fn namespace_complaint(node: Node) -> Option<&'static str> {
    [
        (
            node.tag_name().namespace().is_some() || node.namespaces().next().is_some(),
            "пространство имён",
        ),
        (node.attributes().any(|a| a.namespace().is_some()), "пространство имён у атрибута"),
    ]
    .into_iter()
    .find_map(|(hit, why)| hit.then_some(why))
}

fn reject_namespaces(doc: &Document) -> Result<()> {
    match elements(doc).find_map(namespace_complaint) {
        Some(why) => Err(Error::broken(pending(why))),
        None => Ok(()),
    }
}

/// Кусок верхнего уровня документа: промежуток между узлами или сам узел.
enum Piece<'a, 'i> {
    Gap(&'i str),
    Node(Node<'a, 'i>),
}

/// Верхний уровень по порядку: промежуток, узел, промежуток, …, промежуток.
/// Границы берутся из диапазонов узлов в исходном тексте.
fn split_pieces<'a, 'i>(doc: &'a Document<'i>, text: &'i str, start: usize) -> Vec<Piece<'a, 'i>> {
    let nodes: Vec<Node<'a, 'i>> = doc.root().children().collect();
    let gap_from = std::iter::once(start).chain(nodes.iter().map(|n| n.range().end));
    let gap_to = nodes.iter().map(|n| n.range().start).chain([text.len()]);
    gap_from
        .zip(gap_to)
        .map(|(from, to)| &text[from..to])
        .zip(nodes.iter().copied().map(Some).chain([None]))
        .flat_map(|(gap, node)| [Some(Piece::Gap(gap)), node.map(Piece::Node)])
        .flatten()
        .collect()
}

/// `CR LF` и одиночный `CR` становятся `LF`.
fn line_feeds(text: &str) -> Cow<'_, str> {
    if text.contains('\r') {
        Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(text)
    }
}

/// Разбирает вход и отдаёт его замыканию вместе с раскладкой верхнего уровня.
fn with_document<R>(
    input: &[u8],
    work: impl FnOnce(&Document<'_>, &[Piece<'_, '_>], &str) -> Result<R>,
) -> Result<R> {
    let raw = match input {
        [0xEF, 0xBB, 0xBF, rest @ ..] => rest,
        whole => whole,
    };
    let text = std::str::from_utf8(raw).map_err(|_| Error::broken(pending("кодировка не UTF-8")))?;
    let after_declaration = skip_declaration(text)?;
    refuse_first([(nesting_depth(text) > MAX_NESTING)
        .then(|| pending(&format!("вложенность элементов глубже {MAX_NESTING} уровней")))])?;
    let doc = Document::parse(text)
        .map_err(|e| Error::broken(format!("weapons.meta не разобран: {e}")))?;
    refuse_first([text.contains("<![CDATA[").then(|| pending("раздел CDATA"))])?;
    reject_namespaces(&doc)?;
    let pieces = split_pieces(&doc, text, after_declaration);
    work(&doc, &pieces, text)
}

pub fn check(bytes: &[u8]) -> Result<()> {
    with_document(bytes, |_, _, _| Ok(()))
}

// ---------------------------------------------------------------------------
// Правки поверх дерева
// ---------------------------------------------------------------------------

/// Что стало с содержимым элемента.
#[derive(Default)]
enum Body {
    #[default]
    Keep,
    Cleared,
    Text(String),
}

#[derive(Default)]
struct Edit {
    body: Body,
    attrs: Vec<(String, String)>,
}

#[derive(Default)]
struct Edits(HashMap<NodeId, Edit>);

impl Edits {
    /// Пустой текст убирает содержимое, иначе оно заменяется этим текстом.
    fn rewrite(&mut self, node: Node, text: &str) {
        let body = if text.is_empty() { Body::Cleared } else { Body::Text(text.to_owned()) };
        self.0.entry(node.id()).or_default().body = body;
    }

    fn set_attr(&mut self, node: Node, name: &str, value: String) {
        let edit = self.0.entry(node.id()).or_default();
        match edit.attrs.iter_mut().find(|(known, _)| known == name) {
            Some(slot) => slot.1 = value,
            None => edit.attrs.push((name.to_owned(), value)),
        }
    }

    /// Узел лежит под элементом, у которого содержимое уже заменено, то есть для записи его нет.
    fn is_cut(&self, node: Node) -> bool {
        node.ancestors().skip(1).any(|up| {
            self.0.get(&up.id()).is_some_and(|edit| !matches!(edit.body, Body::Keep))
        })
    }
}

fn is_identifier(text: &str) -> bool {
    !text.is_empty()
        && text.chars().count() <= MAX_IDENTIFIER
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Число с шестью знаками после точки так, как его пишет помощник (`decimal`, на седьмом знаке «пять» — вверх);
/// `-0.0` становится `0.000000`.
fn number(value: f64) -> String {
    crate::weapons_meta_decimal::decimal6(value)
}

fn child_named<'a, 'i>(parent: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    parent.children().find(|c| c.is_element() && c.tag_name().name() == name)
}

fn inner_text(node: Node) -> String {
    node.descendants().filter(Node::is_text).filter_map(|t| t.text()).collect()
}

/// Единственный `Item`, у которого первый `Name` называет это оружие.
fn find_item<'a, 'i>(doc: &'a Document<'i>, weapon: &str, edits: &Edits) -> Result<Node<'a, 'i>> {
    let mut found = elements(doc)
        .filter(|n| n.tag_name().name() == "Item" && !edits.is_cut(*n))
        .filter(|item| {
            child_named(*item, "Name")
                .is_some_and(|name| inner_text(name).trim().eq_ignore_ascii_case(weapon))
        });
    let first = found
        .next()
        .ok_or_else(|| Error::broken(format!("Weapon was not found in metadata: {weapon}")))?;
    refuse_first([found
        .next()
        .map(|_| "Sequence contains more than one matching element".to_owned())])?;
    Ok(first)
}

/// Блок `Fx` найденного оружия.
struct Target<'a, 'i> {
    fx: Node<'a, 'i>,
    weapon: &'a str,
}

impl<'a, 'i> Target<'a, 'i> {
    fn element(&self, name: &str) -> Result<Node<'a, 'i>> {
        child_named(self.fx, name)
            .ok_or_else(|| Error::broken(format!("Weapon {name} is missing: {}", self.weapon)))
    }
}

fn require_range(name: &str, values: &[f64], max: f64) -> Result<()> {
    let inside = values.iter().all(|v| (0.0..=max).contains(v));
    refuse_first([(!inside).then(|| format!("{name} must be between 0 and {max}."))])
}

// ---------------------------------------------------------------------------
// Вид выстрела
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Look {
    pub flash_scale: Option<f64>,
    pub light_enabled: Option<bool>,
    pub light_rgb_min: Option<Vec<f64>>,
    pub light_rgb_max: Option<Vec<f64>>,
    pub light_intensity: Option<Vec<f64>>,
    pub light_range: Option<Vec<f64>>,
    pub smoke_fx: Option<String>,
    pub smoke_inc_per_shot: Option<f64>,
    pub shell_fx: Option<String>,
    pub flash_fx_fp: Option<String>,
    pub smoke_fx_fp: Option<String>,
    pub shell_fx_fp: Option<String>,
}

const XYZ: &[&str] = &["x", "y", "z"];
const XY: &[&str] = &["x", "y"];

/// Что делает поле вида выстрела с элементом.
enum Change<'a> {
    Number { value: f64, max: f64 },
    Switch(bool),
    Axes { names: &'static [&'static str], values: &'a [f64], max: f64 },
    Effect(&'a str),
}

type Pick = for<'a> fn(&'a Look) -> Option<Change<'a>>;

/// Поля вида выстрела в порядке применения: элемент `Fx` и выбор правки.
const LOOK_RULES: [(&str, Pick); 12] = [
    ("FlashFxScale", |l| l.flash_scale.map(|value| Change::Number { value, max: 10.0 })),
    ("FlashFxLightEnabled", |l| l.light_enabled.map(Change::Switch)),
    ("FlashFxLightRGBAMin", |l| {
        l.light_rgb_min.as_deref().map(|values| Change::Axes { names: XYZ, values, max: 255.0 })
    }),
    ("FlashFxLightRGBAMax", |l| {
        l.light_rgb_max.as_deref().map(|values| Change::Axes { names: XYZ, values, max: 255.0 })
    }),
    ("FlashFxLightIntensityMinMax", |l| {
        l.light_intensity.as_deref().map(|values| Change::Axes { names: XY, values, max: 64.0 })
    }),
    ("FlashFxLightRangeMinMax", |l| {
        l.light_range.as_deref().map(|values| Change::Axes { names: XY, values, max: 64.0 })
    }),
    ("MuzzleSmokeFx", |l| l.smoke_fx.as_deref().map(Change::Effect)),
    ("MuzzleSmokeFxIncPerShot", |l| {
        l.smoke_inc_per_shot.map(|value| Change::Number { value, max: 1.0 })
    }),
    ("ShellFx", |l| l.shell_fx.as_deref().map(Change::Effect)),
    ("FlashFxFP", |l| l.flash_fx_fp.as_deref().map(Change::Effect)),
    ("MuzzleSmokeFxFP", |l| l.smoke_fx_fp.as_deref().map(Change::Effect)),
    ("ShellFxFP", |l| l.shell_fx_fp.as_deref().map(Change::Effect)),
];

impl Change<'_> {
    fn apply(self, name: &str, target: &Target, edits: &mut Edits) -> Result<()> {
        match self {
            Change::Number { value, max } => {
                require_range(name, &[value], max)?;
                edits.set_attr(target.element(name)?, "value", number(value));
            }
            Change::Switch(on) => {
                edits.set_attr(target.element(name)?, "value", on.to_string());
            }
            Change::Axes { names, values, max } => {
                refuse_first([(values.len() != names.len()).then(|| {
                    format!("Weapon {name} needs {} numbers: {}", names.len(), target.weapon)
                })])?;
                let element = target.element(name)?;
                require_range(name, values, max)?;
                for (axis, value) in names.iter().zip(values) {
                    edits.set_attr(element, axis, number(*value));
                }
            }
            Change::Effect(text) => {
                let element = target.element(name)?;
                let text = text.trim();
                refuse_first([(!text.is_empty() && !is_identifier(text))
                    .then(|| format!("Invalid {name} identifier."))])?;
                edits.rewrite(element, text);
            }
        }
        Ok(())
    }
}

fn apply_look(target: &Target, edits: &mut Edits, look: &Look) -> Result<()> {
    LOOK_RULES
        .iter()
        .filter_map(|(name, pick)| pick(look).map(|change| (*name, change)))
        .try_for_each(|(name, change)| change.apply(name, target, edits))
}

// ---------------------------------------------------------------------------
// Привязки
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Binding {
    pub weapon: String,
    pub tracer_fx: Option<String>,
    pub chance_sp: Option<f64>,
    pub chance_mp: Option<f64>,
    pub flash_fx: Option<String>,
    pub look: Option<Look>,
}

/// Привязка с обрезанными именами: что именно просят поменять.
struct Wanted<'b> {
    weapon: &'b str,
    tracer: Option<&'b str>,
    flash: Option<&'b str>,
}

impl<'b> Wanted<'b> {
    fn of(binding: &'b Binding) -> Self {
        let trimmed = |fx: &'b Option<String>| fx.as_deref().map(str::trim);
        Wanted {
            weapon: binding.weapon.trim(),
            tracer: trimmed(&binding.tracer_fx),
            flash: trimmed(&binding.flash_fx),
        }
    }
}

fn validate_bindings(bindings: &[Binding]) -> Result<()> {
    let names: Vec<String> =
        bindings.iter().map(|b| b.weapon.trim().to_ascii_lowercase()).collect();
    let distinct = names.iter().collect::<BTreeSet<_>>().len();
    refuse_first([
        (!(1..=MAX_BINDINGS).contains(&bindings.len()))
            .then(|| "Weapon tracer binding count must be between 1 and 256.".to_owned()),
        (distinct != names.len() || names.iter().any(String::is_empty))
            .then(|| "Weapon tracer bindings must use unique, non-empty weapon names.".to_owned()),
    ])
}

fn apply_tracer(target: &Target, edits: &mut Edits, binding: &Binding, effect: &str) -> Result<()> {
    edits.rewrite(target.element("TracerFx")?, effect);
    let chances = [
        (binding.chance_sp, "TracerFxChanceSP"),
        (binding.chance_mp, "TracerFxChanceMP"),
    ];
    for (chance, name) in chances {
        let Some(chance) = chance else { continue };
        let element = target.element(name)?;
        refuse_first([(!(0.0..=1.0).contains(&chance))
            .then(|| "Tracer chance must be between 0 and 1.".to_owned())])?;
        edits.set_attr(element, "value", number(chance));
    }
    Ok(())
}

fn apply_binding(doc: &Document, edits: &mut Edits, binding: &Binding) -> Result<()> {
    let want = Wanted::of(binding);
    let bad_effect = |fx: Option<&str>| fx.is_some_and(|e| !e.is_empty() && !is_identifier(e));
    refuse_first([
        (!is_identifier(want.weapon)).then(|| "Invalid weapon identifier.".to_owned()),
        bad_effect(want.tracer).then(|| "Invalid tracer effect identifier.".to_owned()),
        bad_effect(want.flash).then(|| "Invalid flash effect identifier.".to_owned()),
        (want.tracer.is_none() && want.flash.is_none() && binding.look.is_none())
            .then(|| format!("Weapon binding changes nothing: {}", want.weapon)),
    ])?;

    let item = find_item(doc, want.weapon, edits)?;
    let fx = child_named(item, "Fx")
        .ok_or_else(|| Error::broken(format!("Weapon Fx block is missing: {}", want.weapon)))?;
    let target = Target { fx, weapon: want.weapon };

    if let Some(effect) = want.tracer {
        apply_tracer(&target, edits, binding, effect)?;
    }
    if let Some(effect) = want.flash {
        edits.rewrite(target.element("FlashFx")?, effect);
    }
    binding.look.as_ref().map_or(Ok(()), |look| apply_look(&target, edits, look))
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

/// `CR` в тексте узла — всегда из ссылки `&#13;`: настоящие `CR` разбор уже свёл к `LF`.
const TEXT_ESCAPES: [(char, &str); 4] = [('&', "&amp;"), ('<', "&lt;"), ('>', "&gt;"), ('\r', "&#xD;")];
const ATTR_ESCAPES: [(char, &str); 7] = [
    ('&', "&amp;"),
    ('<', "&lt;"),
    ('>', "&gt;"),
    ('"', "&quot;"),
    ('\t', "&#x9;"),
    ('\n', "&#xA;"),
    ('\r', "&#xD;"),
];

fn escape_into(out: &mut String, text: &str, table: &[(char, &str)]) {
    for ch in text.chars() {
        match table.iter().find(|(from, _)| *from == ch) {
            Some((_, entity)) => out.push_str(entity),
            None => out.push(ch),
        }
    }
}

/// Шаг обхода поддерева: вход в узел и выход из него.
enum Step<'a, 'i> {
    Open(Node<'a, 'i>),
    Close(Node<'a, 'i>),
}

/// Обход поддерева без рекурсии: у узла без потомков вход сразу сменяется выходом.
struct Tour<'a, 'i> {
    root: Node<'a, 'i>,
    next: Option<Step<'a, 'i>>,
}

impl<'a, 'i> Tour<'a, 'i> {
    fn of(root: Node<'a, 'i>) -> Self {
        Tour { root, next: Some(Step::Open(root)) }
    }
}

impl<'a, 'i> Iterator for Tour<'a, 'i> {
    type Item = Step<'a, 'i>;

    fn next(&mut self) -> Option<Self::Item> {
        let step = self.next.take()?;
        self.next = match &step {
            Step::Open(n) => Some(n.first_child().map_or(Step::Close(*n), Step::Open)),
            Step::Close(n) if *n == self.root => None,
            Step::Close(n) => {
                n.next_sibling().map(Step::Open).or_else(|| n.parent().map(Step::Close))
            }
        };
        Some(step)
    }
}

/// Пишущий в строку: исходный текст нужен, чтобы узнать, как был записан пустой элемент.
struct Printer<'e> {
    out: String,
    source: &'e str,
    edits: &'e Edits,
}

impl Printer<'_> {
    fn put_attr(&mut self, key: &str, value: &str) {
        self.out.push(' ');
        self.out.push_str(key);
        self.out.push_str("=\"");
        escape_into(&mut self.out, value, &ATTR_ESCAPES);
        self.out.push('"');
    }

    /// Начало элемента с атрибутами. Если правка уже записала элемент целиком, возвращает его
    /// номер: всё внутри до выхода из него пропускается.
    fn open(&mut self, node: Node) -> Option<NodeId> {
        let edits = self.edits;
        let edit = edits.0.get(&node.id());
        let name = node.tag_name().name();
        self.out.push('<');
        self.out.push_str(name);

        let overrides: &[(String, String)] = edit.map_or(&[][..], |e| e.attrs.as_slice());
        let own = node.attributes().map(|a| {
            let value = overrides
                .iter()
                .find(|(key, _)| key == a.name())
                .map_or(a.value(), |(_, v)| v.as_str());
            (a.name(), value)
        });
        let added = overrides
            .iter()
            .filter(|(key, _)| !node.has_attribute(key.as_str()))
            .map(|(key, v)| (key.as_str(), v.as_str()));
        for (key, value) in own.chain(added) {
            self.put_attr(key, value);
        }

        let was_closed = self.source[node.range()].ends_with("/>");
        match (edit.map(|e| &e.body), node.has_children(), was_closed) {
            (Some(Body::Cleared), _, _) => {
                self.out.push_str(" />");
                Some(node.id())
            }
            (Some(Body::Text(replacement)), _, _) => {
                self.out.push('>');
                escape_into(&mut self.out, replacement, &TEXT_ESCAPES);
                self.out.push_str("</");
                self.out.push_str(name);
                self.out.push('>');
                Some(node.id())
            }
            (_, true, _) => {
                self.out.push('>');
                None
            }
            (_, false, true) => {
                self.out.push_str(" />");
                None
            }
            (_, false, false) => {
                self.out.push_str("></");
                self.out.push_str(name);
                self.out.push('>');
                None
            }
        }
    }

    fn enter(&mut self, node: Node) -> Option<NodeId> {
        match node.node_type() {
            NodeType::Element => return self.open(node),
            NodeType::Text => escape_into(&mut self.out, node.text().unwrap_or(""), &TEXT_ESCAPES),
            NodeType::Comment => {
                self.out.push_str("<!--");
                self.out.push_str(&line_feeds(node.text().unwrap_or("")));
                self.out.push_str("-->");
            }
            NodeType::PI => {
                if let Some(pi) = node.pi() {
                    self.out.push_str("<?");
                    self.out.push_str(pi.target);
                    if let Some(data) = pi.value.filter(|d| !d.is_empty()) {
                        self.out.push(' ');
                        self.out.push_str(&line_feeds(data));
                    }
                    self.out.push_str("?>");
                }
            }
            NodeType::Root => {}
        }
        None
    }

    fn leave(&mut self, node: Node) {
        if node.is_element() && node.has_children() {
            self.out.push_str("</");
            self.out.push_str(node.tag_name().name());
            self.out.push('>');
        }
    }

    /// Пишет узел верхнего уровня со всем, что внутри него.
    fn subtree(&mut self, top: Node) {
        // Узел, чьё содержимое уже записано правкой: всё до его закрытия пропускается.
        let mut covered: Option<NodeId> = None;
        for step in Tour::of(top) {
            match (covered, step) {
                (Some(id), Step::Close(node)) if node.id() == id => covered = None,
                (Some(_), _) => {}
                (None, Step::Open(node)) => covered = self.enter(node),
                (None, Step::Close(node)) => self.leave(node),
            }
        }
    }
}

impl Piece<'_, '_> {
    fn put(&self, printer: &mut Printer) {
        match self {
            Piece::Gap(gap) => printer.out.push_str(&line_feeds(gap)),
            Piece::Node(node) => printer.subtree(*node),
        }
    }
}

pub fn patch(input: &[u8], bindings: &[Binding]) -> Result<Vec<u8>> {
    validate_bindings(bindings)?;
    with_document(input, |doc, pieces, text| {
        let mut edits = Edits::default();
        bindings.iter().try_for_each(|binding| apply_binding(doc, &mut edits, binding))?;
        let mut printer = Printer { out: String::new(), source: text, edits: &edits };
        pieces.iter().for_each(|piece| piece.put(&mut printer));
        Ok([OUR_DECLARATION, printer.out.as_str()].concat().into_bytes())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECLARATION: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>";

    fn doc(fx: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Blob><Items><Item><Name>W</Name><Fx>{fx}</Fx></Item></Items></Blob>\n"
        )
    }

    fn tracer(weapon: &str, fx: &str) -> Binding {
        Binding { weapon: weapon.into(), tracer_fx: Some(fx.into()), ..Binding::default() }
    }

    fn run(input: &str, bindings: &[Binding]) -> std::result::Result<String, String> {
        match patch(input.as_bytes(), bindings) {
            Ok(bytes) => Ok(String::from_utf8(bytes).unwrap()),
            Err(e) => Err(e.message),
        }
    }

    const TRACER_PART: &str = "<TracerFx>old</TracerFx><TracerFxChanceSP value=\"0.1\" /><TracerFxChanceMP value=\"0.2\" />";

    #[test]
    fn tracer_text_and_chances_are_written_with_six_digits() {
        let mut b = tracer("w", " t_new ");
        b.chance_sp = Some(0.5);
        b.chance_mp = Some(0.1234565);
        let out = run(&doc(TRACER_PART), &[b]).unwrap();
        // Седьмой знак «пять» помощник округляет вверх (`decimal`), а не по двоичному значению.
        assert_eq!(
            out,
            format!("{DECLARATION}\n<Blob><Items><Item><Name>W</Name><Fx><TracerFx>t_new</TracerFx><TracerFxChanceSP value=\"0.500000\" /><TracerFxChanceMP value=\"0.123457\" /></Fx></Item></Items></Blob>\n")
        );
    }

    /// Каждое число, которое движок пишет в `value` и в оси, идёт через одну запись помощника: шансы, размер вспышки,
    /// свет и дым (`ChanceValue` и `BoundedValue` у помощника, `ToString("0.000000")` от `decimal`).
    #[test]
    fn every_written_number_rounds_the_seventh_digit_five_up_like_the_helper() {
        let text = doc(
            "<TracerFx>t</TracerFx><TracerFxChanceSP value=\"0.1\" /><TracerFxChanceMP value=\"0.2\" />\
             <FlashFxScale value=\"1\" /><FlashFxLightRGBAMin x=\"0\" y=\"0\" z=\"0\" w=\"9\" />\
             <FlashFxLightIntensityMinMax x=\"0\" y=\"0\" /><MuzzleSmokeFxIncPerShot value=\"0\" />",
        );
        let mut binding = tracer("W", "t");
        binding.chance_sp = Some(0.000_000_5);
        binding.chance_mp = Some(0.999_999_5);
        binding.look = Some(Look {
            flash_scale: Some(9.999_999_5),
            light_rgb_min: Some(vec![0.123_456_5, 254.999_999_5, 63.999_999_5]),
            light_intensity: Some(vec![0.123_457_5, 0.000_001_5]),
            smoke_inc_per_shot: Some(0.333_333_5),
            ..Look::default()
        });
        let out = run(&text, &[binding]).unwrap();
        for wanted in [
            "<TracerFxChanceSP value=\"0.000001\" />",
            "<TracerFxChanceMP value=\"1.000000\" />",
            "<FlashFxScale value=\"10.000000\" />",
            "<FlashFxLightRGBAMin x=\"0.123457\" y=\"255.000000\" z=\"64.000000\" w=\"9\" />",
            "<FlashFxLightIntensityMinMax x=\"0.123458\" y=\"0.000002\" />",
            "<MuzzleSmokeFxIncPerShot value=\"0.333334\" />",
        ] {
            assert!(out.contains(wanted), "нет {wanted} в {out}");
        }
    }

    #[test]
    fn numbers_below_the_seventh_digit_five_and_whole_numbers_are_unchanged() {
        let mut binding = tracer("W", "t");
        binding.chance_sp = Some(0.000_000_4);
        binding.chance_mp = Some(1.0);
        let out = run(&doc(TRACER_PART), &[binding]).unwrap();
        assert!(out.contains("<TracerFxChanceSP value=\"0.000000\" />"), "{out}");
        assert!(out.contains("<TracerFxChanceMP value=\"1.000000\" />"), "{out}");
    }

    #[test]
    fn a_declaration_without_a_plain_space_is_refused_not_panicked_on() {
        let refusal = "weapons.meta: декларация XML с пробельным знаком вместо обычного пробела — пока на хосте.";
        for white in ["\t", "\n", "\r\n", "\u{a0}", "\u{85}", "\u{2028}", "\u{3000}"] {
            let text = format!("<?xml{white}version=\"1.0\"?><Blob><Items><Item><Name>W</Name><Fx><TracerFx>a</TracerFx></Fx></Item></Items></Blob>");
            assert_eq!(patch(text.as_bytes(), &[tracer("W", "b")]).unwrap_err().message, refusal, "{white:?}");
            assert_eq!(check(text.as_bytes()).unwrap_err().message, refusal, "{white:?}");
        }
        // С обычным пробелом документ принимается как раньше.
        let plain = "<?xml version=\"1.0\"?><Blob><Items><Item><Name>W</Name><Fx><TracerFx>a</TracerFx></Fx></Item></Items></Blob>";
        assert!(patch(plain.as_bytes(), &[tracer("W", "b")]).is_ok());
    }

    #[test]
    fn nesting_deeper_than_the_limit_is_refused_before_the_parser_can_overflow() {
        let nest = |depth: usize| {
            format!("<R>{}<Item><Name>W</Name><Fx><TracerFx>t</TracerFx></Fx></Item>{}</R>", "<A>".repeat(depth), "</A>".repeat(depth))
        };
        let refusal = "weapons.meta: вложенность элементов глубже 100 уровней — пока на хосте.";
        // Корень и сам Item лежат на уровнях 1 и depth + 2, а TracerFx — на depth + 4: предел по самому глубокому.
        assert!(patch(nest(96).as_bytes(), &[tracer("W", "x")]).is_ok());
        assert_eq!(patch(nest(97).as_bytes(), &[tracer("W", "x")]).unwrap_err().message, refusal);
        assert_eq!(check(nest(20_000).as_bytes()).unwrap_err().message, refusal);
        // Комментарии, кавычки атрибутов и пустые элементы глубину не набирают.
        let calm = "<R a=\">\"><!-- <A><A><A> --><B/><C x='<'/>".to_owned()
            + &"<D/>".repeat(500)
            + "<Item><Name>W</Name><Fx><TracerFx>t</TracerFx></Fx></Item></R>";
        assert_eq!(nesting_depth(&calm), 4);
    }

    #[test]
    fn a_carriage_return_reference_in_text_is_kept_and_real_line_breaks_are_not() {
        let kept = "<R><Note>a&#13;b</Note><Item><Name>W</Name><Fx><TracerFx>t</TracerFx></Fx></Item></R>";
        let out = run(kept, &[tracer("W", "x")]).unwrap();
        assert!(out.contains("<Note>a&#xD;b</Note>"), "{out}");
        // CRLF настоящих файлов по-прежнему сводится к LF и в тексте, и между узлами.
        let crlf = "<R>\r\n  <Note>a\r\nb</Note>\r\n<Item><Name>W</Name><Fx><TracerFx>t</TracerFx></Fx></Item>\r\n</R>\r\n";
        let out = run(crlf, &[tracer("W", "x")]).unwrap();
        assert!(!out.contains('\r') && !out.contains("&#xD;"), "{out:?}");
        assert!(out.contains("<Note>a\nb</Note>"), "{out:?}");
    }

    #[test]
    fn empty_effect_becomes_a_self_closed_element() {
        let out = run(&doc(TRACER_PART), &[tracer("W", "  ")]).unwrap();
        assert!(out.contains("<TracerFx /><TracerFxChanceSP"));
    }

    #[test]
    fn binding_list_and_names_are_checked_before_the_document() {
        let count = "Weapon tracer binding count must be between 1 and 256.";
        assert_eq!(patch(&[0xff], &[]).unwrap_err().message, count);
        let twin = [tracer("A", "x"), tracer(" a ", "y")];
        let unique = "Weapon tracer bindings must use unique, non-empty weapon names.";
        assert_eq!(patch(&[0xff], &twin).unwrap_err().message, unique);
        assert_eq!(
            patch(&[0xff], &[tracer("A", "x")]).unwrap_err().message,
            "weapons.meta: кодировка не UTF-8 — пока на хосте."
        );
    }

    #[test]
    fn binding_errors_follow_the_documented_order() {
        let text = doc(TRACER_PART);
        let nothing = Binding { weapon: "W".into(), ..Binding::default() };
        assert_eq!(run(&text, &[nothing]).unwrap_err(), "Weapon binding changes nothing: W");
        assert_eq!(run(&text, &[tracer("W-1", "x")]).unwrap_err(), "Invalid weapon identifier.");
        assert_eq!(run(&text, &[tracer("W", "a b")]).unwrap_err(), "Invalid tracer effect identifier.");
        assert_eq!(run(&text, &[tracer("NOPE", "a")]).unwrap_err(), "Weapon was not found in metadata: NOPE");
        let mut late = tracer("W", "a");
        late.chance_sp = Some(1.5);
        assert_eq!(run(&text, &[late]).unwrap_err(), "Tracer chance must be between 0 and 1.");
        let flash = Binding { weapon: "W".into(), flash_fx: Some("f".into()), ..Binding::default() };
        assert_eq!(run(&text, &[flash]).unwrap_err(), "Weapon FlashFx is missing: W");
    }

    #[test]
    fn look_checks_length_then_element_then_bounds() {
        let text = doc("<FlashFxLightRGBAMin x=\"0\" y=\"0\" z=\"0\" w=\"9\"/><FlashFxScale a=\"1\"/>");
        let look = |l: Look| Binding { weapon: "W".into(), look: Some(l), ..Binding::default() };
        let short = Look { light_rgb_min: Some(vec![1.0, 2.0]), ..Look::default() };
        assert_eq!(run(&text, &[look(short)]).unwrap_err(), "Weapon FlashFxLightRGBAMin needs 3 numbers: W");
        let wild = Look { light_rgb_min: Some(vec![0.0, 256.0, 0.0]), ..Look::default() };
        assert_eq!(run(&text, &[look(wild)]).unwrap_err(), "FlashFxLightRGBAMin must be between 0 and 255.");
        let fine = Look {
            light_rgb_min: Some(vec![1.0, 2.0, 3.0]),
            flash_scale: Some(2.0),
            ..Look::default()
        };
        let out = run(&text, &[look(fine)]).unwrap();
        assert!(out.contains("<FlashFxLightRGBAMin x=\"1.000000\" y=\"2.000000\" z=\"3.000000\" w=\"9\" />"));
        assert!(out.contains("<FlashFxScale a=\"1\" value=\"2.000000\" />"));
    }

    #[test]
    fn declaration_rules() {
        let body = "<Blob><Items><Item><Name>W</Name><Fx><TracerFx>t</TracerFx></Fx></Item></Items></Blob>";
        let b = [tracer("W", "n")];
        let with = |decl: &str| run(&format!("{decl}{body}"), &b);
        assert!(with("<?xml version='1.0' encoding='UTF-8'?>").is_ok());
        assert!(with("").is_ok());
        assert!(with("<?xml-stylesheet href=\"a\"?>").is_ok());
        for (decl, reason) in [
            ("<?xml version=\"1.1\"?>", "версия XML не 1.0"),
            ("<?xml version=\"1.0\" encoding=\"windows-1251\"?>", "кодировка декларации не UTF-8"),
            ("<?xml version=\"1.0\" standalone=\"yes\"?>", "декларация со standalone"),
        ] {
            assert_eq!(with(decl).unwrap_err(), format!("weapons.meta: {reason} — пока на хосте."));
        }
        assert_eq!(with("<?xml version=\"1.0\"").unwrap_err(), "Декларация weapons.meta не закрыта.");
    }

    #[test]
    fn writer_keeps_forms_and_escapes_like_the_host() {
        let source = "<R><A x=\"a&amp;b&#10;c\" y='q\"'>1 &lt; 2\r\n</A><B/><C></C><D /><!--k--><?p d?><Item><Name>W</Name><Fx><TracerFx/></Fx></Item></R>";
        let out = run(source, &[tracer("W", "n")]).unwrap();
        assert_eq!(
            out,
            format!("{DECLARATION}<R><A x=\"a&amp;b&#xA;c\" y=\"q&quot;\">1 &lt; 2\n</A><B /><C></C><D /><!--k--><?p d?><Item><Name>W</Name><Fx><TracerFx>n</TracerFx></Fx></Item></R>")
        );
    }

    #[test]
    fn refused_inputs_and_check() {
        assert!(check(doc("").as_bytes()).is_ok());
        assert_eq!(check(b"<a xmlns=\"u\"/>").unwrap_err().message, "weapons.meta: пространство имён — пока на хосте.");
        assert_eq!(
            check(b"<a xml:space=\"preserve\"/>").unwrap_err().message,
            "weapons.meta: пространство имён у атрибута — пока на хосте."
        );
        assert_eq!(check(b"<a><![CDATA[x]]></a>").unwrap_err().message, "weapons.meta: раздел CDATA — пока на хосте.");
        assert_eq!(check(b"").unwrap_err().message, "weapons.meta не разобран: the document does not have a root node");
    }
}
