//! Итоги `content.xml` из корня архива: какие контейнеры мод подключает через
//! `filesToEnable` и какие из них штатные.

use super::log;

use std::borrow::Cow;
use std::collections::HashSet;
use std::fmt::Display;

use roxmltree::{Document, Node, NodeType};
use serde_json::json;
use serde_json::Value;

use rage_rpf::{Archive, EntryCipher};

/// Штатные контейнеры обновления: путь целиком, в нижнем регистре.
const STOCK_CONTAINERS: [&str; 8] = [
    "x64/patch/anim/expressions.rpf",
    "x64/patch/anim/networkdefs.rpf",
    "x64/data/cdimages/scaleform_generic.rpf",
    "x64/data/cdimages/scaleform_generic_2.rpf",
    "x64/patch/data/cdimages/scaleform_minigames.rpf",
    "x64/patch/data/cdimages/scaleform_minimap.rpf",
    "x64/patch/data/cdimages/scaleform_web.rpf",
    "x64/patch/data/effects/ptfx.rpf",
];

/// Штатный ли контейнер; путь уже в нижнем регистре.
fn is_stock(lowered: &str) -> bool {
    STOCK_CONTAINERS.contains(&lowered)
}

type PathList = Vec<String>;

#[derive(Default, Debug)]
// разбор сверяют целиком: списки и счётчик записей
#[derive(PartialEq, Eq)]
pub struct Analysis {
    pub files_to_enable: PathList,
    pub custom: PathList,
    pub default: PathList,
    /// Сколько элементов `Item` встретилось до отбрасывания повторов.
    pub raw_count: usize,
}

/// Метка строк журнала этого разбора.
const TAG: &str = "[ContentXmlAnalyzer]";

impl Analysis {
    fn to_value(&self) -> Value {
        json!({
            "filesToEnable": self.files_to_enable,
            "customRpfs": self.custom,
            "defaultRpfs": self.default,
        })
    }

    /// Две строки журнала об успешном разборе.
    fn summary(&self) -> [String; 2] {
        [
            format!("{TAG} Найдено записей filesToEnable: {}", self.raw_count),
            format!(
                "{TAG} Default RPFs: {}, Custom RPFs: {}",
                self.default.len(),
                self.custom.len()
            ),
        ]
    }
}

/// Слова UTF-16 из пар байт (нечётный хвост отбрасывается), негодное заменяется.
fn utf16_text(big_endian: bool, body: &[u8]) -> String {
    let read_word = if big_endian {
        u16::from_be_bytes
    } else {
        u16::from_le_bytes
    };
    let words = body
        .iter()
        .step_by(2)
        .zip(body.iter().skip(1).step_by(2))
        .map(|(&first, &second)| read_word([first, second]))
        .collect::<Vec<u16>>();
    String::from_utf16_lossy(&words)
}

/// Метка платформы в нижнем регистре: сравнение идёт по строке без заглавных ASCII.
const MARK: &str = "%platform%";

/// Заменяет каждое `%PLATFORM%` (регистр ASCII любой) на `x64`.
fn substitute_platform(path: &str) -> String {
    // строчные ASCII не сдвигают байты, поэтому места находок годятся и для исходной строки
    path.to_ascii_lowercase()
        .split(MARK)
        .scan(0, |cursor, piece| {
            let from = *cursor;
            *cursor += piece.len() + MARK.len();
            Some(&path[from..from + piece.len()])
        })
        .collect::<Vec<_>>()
        .join("x64")
}

const PREFIX: &str = "update:/";

/// Путь из элемента: срез пробелов, прямые слэши, один `update:/`, подстановка платформы.
fn tidy_path(raw: &str) -> String {
    substitute_platform(without_update_prefix(
        raw.chars()
            .map(|ch| if ch == '\\' { '/' } else { ch })
            .collect::<String>()
            .trim(),
    ))
}

/// Текст без одного начального `update:/` (регистр ASCII любой).
fn without_update_prefix(text: &str) -> &str {
    match text.split_at_checked(PREFIX.len()) {
        Some((head, tail)) if head.eq_ignore_ascii_case(PREFIX) => tail,
        _ => text,
    }
}

/// Локальное имя элемента; у остальных узлов имени нет.
fn element_name<'a>(node: &Node<'a, '_>) -> Option<&'a str> {
    node.is_element().then(|| node.tag_name().name())
}

/// Весь текст внутри узла в порядке документа.
fn inner_text(node: Node<'_, '_>) -> String {
    node.descendants()
        .filter_map(|part| match part.node_type() {
            NodeType::Text => part.text(),
            _ => None,
        })
        .collect()
}

/// Элементы `Item` из всех списков `filesToEnable` в порядке документа.
fn list_items<'a, 'input>(document: &'a Document<'input>) -> Vec<Node<'a, 'input>> {
    document
        .root()
        .descendants()
        .filter(|node| Some("filesToEnable") == element_name(node))
        .flat_map(|list| {
            list.children()
                .filter(|child| Some("Item") == element_name(child))
        })
        .collect()
}

/// Глубже этого `content.xml` не разбирается: разбор в `roxmltree` рекурсивный, и
/// очень глубокий документ переполняет стек процесса. Настоящие файлы вложены в
/// десяток уровней; отладочная сборка на 1 МиБ стека переживает около 160
/// уровней, релизная — около 1200.
const MAX_DEPTH: usize = 64;

/// Фрагменты, внутри которых теги глубины не прибавляют: начало и конец.
const OPAQUE: [(&[u8], &[u8]); 3] = [(b"<!--", b"-->"), (b"<![CDATA[", b"]]>"), (b"<?", b"?>")];

/// Почему подсчёт глубины остановился раньше конца документа.
enum Halt {
    /// Вложенность выше предела.
    TooDeep,
    /// Разметку дальше читать нельзя: остальное решит разборщик XML.
    Unreadable,
}

/// Подсчёт открытых элементов по границам тегов.
struct DepthScan<'a> {
    bytes: &'a [u8],
    limit: usize,
    open: usize,
}

impl DepthScan<'_> {
    /// Позиция сразу после первого `marker` не раньше `from`.
    fn skip_past(&self, marker: &[u8], from: usize) -> Option<usize> {
        (from..self.bytes.len())
            .find(|&at| self.bytes[at..].starts_with(marker))
            .map(|at| at + marker.len())
    }

    /// Конец начального тега, который начинается с `from`: позиция после `>` и
    /// признак пустого элемента (`/>`). Значения атрибутов в кавычках пропускаются.
    fn tag_end(&self, from: usize) -> Option<(usize, bool)> {
        let mut quote: Option<u8> = None;
        for (at, &byte) in self.bytes.iter().enumerate().skip(from) {
            match quote {
                Some(open) if byte == open => quote = None,
                Some(_) => {}
                None if byte == b'>' => return Some((at + 1, self.bytes[at - 1] == b'/')),
                None if byte == b'"' || byte == b'\'' => quote = Some(byte),
                None => {}
            }
        }
        None
    }

    /// Разбирает фрагмент, который начинается на `start` знаком `<`, и даёт
    /// позицию сразу за ним.
    fn consume(&mut self, start: usize) -> Result<usize, Halt> {
        let tail = &self.bytes[start..];
        if let Some((head, close)) = OPAQUE.iter().find(|(head, _)| tail.starts_with(head)) {
            return self
                .skip_past(close, start + head.len())
                .ok_or(Halt::Unreadable);
        }
        if tail.starts_with(b"<!") {
            return Err(Halt::Unreadable);
        }
        if tail.starts_with(b"</") {
            self.open = self.open.saturating_sub(1);
            return self.skip_past(b">", start + 2).ok_or(Halt::Unreadable);
        }
        let (end, empty) = self.tag_end(start + 1).ok_or(Halt::Unreadable)?;
        if self.open >= self.limit {
            return Err(Halt::TooDeep);
        }
        self.open += usize::from(!empty);
        Ok(end)
    }
}

/// Вложены ли элементы глубже `limit` уровней. Читает только границы тегов
/// (комментарии, инструкции и CDATA пропускает) и работает до разбора, потому что
/// сам разбор на глубоком документе убивает процесс. Всё, что здесь не
/// разобрать, остаётся разборщику XML: он откажет со своим текстом.
fn nests_deeper_than(text: &str, limit: usize) -> bool {
    let mut scan = DepthScan {
        bytes: text.as_bytes(),
        limit,
        open: 0,
    };
    let mut at = 0;
    while let Some(gap) = scan.bytes.iter().skip(at).position(|&byte| byte == b'<') {
        match scan.consume(at + gap) {
            Ok(end) => at = end,
            Err(halt) => return matches!(halt, Halt::TooDeep),
        }
    }
    false
}

pub fn parse(text: &str) -> Result<Analysis, String> {
    if nests_deeper_than(text, MAX_DEPTH) {
        return Err(format!(
            "the document is nested deeper than {MAX_DEPTH} levels"
        ));
    }
    let document = Document::parse(text).map_err(|failure| ToString::to_string(&failure))?;
    let items = list_items(&document);
    let mut analysis = Analysis {
        raw_count: items.len(),
        ..Analysis::default()
    };
    let mut seen = HashSet::new();
    for item in items {
        let path = tidy_path(&inner_text(item));
        let key = path.to_lowercase();
        let stock = is_stock(&key);
        if seen.insert(key) {
            let bucket = if stock {
                &mut analysis.default
            } else {
                &mut analysis.custom
            };
            bucket.push(path.clone());
            analysis.files_to_enable.push(path);
        }
    }
    Ok(analysis)
}

/// Сообщение журнала о сбое чтения файла.
fn read_failure(cause: impl Display) -> String {
    format!("Ошибка чтения content.xml: {cause}")
}

/// Итог чтения файла; `Err` — строка для журнала без общей приставки.
type Verdict = Result<Analysis, String>;

/// Разбор файла из корня архива.
fn read_content(archive: &Archive) -> Verdict {
    const FILE: &str = "content.xml";
    let id = archive
        .find_file(archive.root(), FILE)
        .ok_or_else(|| "content.xml не найден в корне modded archive".to_owned())?;
    let bytes = archive
        .decode(id, EntryCipher::AlwaysNg)
        .map_err(read_failure)?;
    // кодировку решает только метка порядка байт в начале файла
    let text = match bytes.as_slice() {
        [0xFF, 0xFE, body @ ..] => Cow::Owned(utf16_text(false, body)),
        [0xFE, 0xFF, body @ ..] => Cow::Owned(utf16_text(true, body)),
        [0xEF, 0xBB, 0xBF, body @ ..] => String::from_utf8_lossy(body),
        other => String::from_utf8_lossy(other),
    };
    if text.chars().all(char::is_whitespace) {
        return Err("content.xml пустой после извлечения".to_owned());
    }
    parse(&text).map_err(read_failure)
}

pub fn analyze(archive: &Archive) -> Value {
    read_content(archive)
        .inspect(|found| {
            for line in found.summary() {
                log(line);
            }
        })
        .inspect_err(|note| log(format!("{TAG} {note}")))
        .unwrap_or_default()
        .to_value()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_rpf::fixtures::update_tree;
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use std::fs::File;
    use std::path::Path;
    use std::process::Command;
    use tempfile::tempdir;

    /// Оборачивает список в тот же каркас, что и примеры описания.
    fn wrap(inner: &str) -> String {
        format!(
            "<R><contentChangeSets><Item><filesToEnable>{inner}</filesToEnable></Item></contentChangeSets></R>"
        )
    }

    fn lists(text: &str) -> (Vec<String>, Vec<String>, Vec<String>, usize) {
        let found = parse(text).unwrap();
        (
            found.files_to_enable,
            found.custom,
            found.default,
            found.raw_count,
        )
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    /// Строка таблицы: (вход внутри обёртки, все, авторские, штатные, сколько Item).
    type Row = (
        &'static str,
        &'static [&'static str],
        &'static [&'static str],
        &'static [&'static str],
        usize,
    );

    #[test]
    fn wrapped_paths_table() {
        let rows: &[Row] = &[
            ("", &[], &[], &[], 0),
            ("<Item>update:/x64/a.rpf</Item>", &["x64/a.rpf"], &["x64/a.rpf"], &[], 1),
            (
                "<Item>update:/x64/a.rpf</Item><Item>UPDATE:/X64/A.RPF</Item>",
                &["x64/a.rpf"],
                &["x64/a.rpf"],
                &[],
                2,
            ),
            (
                "<Item>update:/x64/a.rpf</Item><Item>x64/A.rpf</Item>",
                &["x64/a.rpf"],
                &["x64/a.rpf"],
                &[],
                2,
            ),
            (
                "<Item>  update:\\x64\\a.rpf\n </Item>",
                &["x64/a.rpf"],
                &["x64/a.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/%PLATFORM%/a.rpf</Item>",
                &["x64/a.rpf"],
                &["x64/a.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/%platform%/%Platform%/%PLATFORM%.rpf</Item>",
                &["x64/x64/x64.rpf"],
                &["x64/x64/x64.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/x64/%PLATFORM</Item>",
                &["x64/%PLATFORM"],
                &["x64/%PLATFORM"],
                &[],
                1,
            ),
            ("<Item>%PLATFORM%</Item>", &["x64"], &["x64"], &[], 1),
            (
                "<Item>update:/update:/x64/a.rpf</Item>",
                &["update:/x64/a.rpf"],
                &["update:/x64/a.rpf"],
                &[],
                1,
            ),
            ("<Item> update:/x64/a.rpf</Item>", &["x64/a.rpf"], &["x64/a.rpf"], &[], 1),
            (
                "<Item>update:/ x64/a.rpf</Item>",
                &[" x64/a.rpf"],
                &[" x64/a.rpf"],
                &[],
                1,
            ),
            ("<Item>update:/</Item>", &[""], &[""], &[], 1),
            ("<Item></Item>", &[""], &[""], &[], 1),
            ("<Item/>", &[""], &[""], &[], 1),
            ("<Item>   </Item>", &[""], &[""], &[], 1),
            ("<Item>update:/</Item><Item/><Item>   </Item>", &[""], &[""], &[], 3),
            ("<Item>update</Item>", &["update"], &["update"], &[], 1),
            ("<Item>UPDATE:</Item>", &["UPDATE:"], &["UPDATE:"], &[], 1),
            ("<Item>update:\\</Item>", &[""], &[""], &[], 1),
            (
                "<Item>dlcpacks:/mine/dlc.rpf</Item>",
                &["dlcpacks:/mine/dlc.rpf"],
                &["dlcpacks:/mine/dlc.rpf"],
                &[],
                1,
            ),
            (
                "<Item>common:/data/a.meta</Item>",
                &["common:/data/a.meta"],
                &["common:/data/a.meta"],
                &[],
                1,
            ),
            (
                "<Item>x64/patch/anim/expressions.rpf</Item>",
                &["x64/patch/anim/expressions.rpf"],
                &[],
                &["x64/patch/anim/expressions.rpf"],
                1,
            ),
            (
                "<Item>update:/x64/patch/anim/expressions.rpf</Item>",
                &["x64/patch/anim/expressions.rpf"],
                &[],
                &["x64/patch/anim/expressions.rpf"],
                1,
            ),
            (
                "<Item>update:/%PLATFORM%/patch/anim/expressions.rpf</Item>",
                &["x64/patch/anim/expressions.rpf"],
                &[],
                &["x64/patch/anim/expressions.rpf"],
                1,
            ),
            (
                "<Item>dlcpacks:/x64/patch/anim/expressions.rpf</Item>",
                &["dlcpacks:/x64/patch/anim/expressions.rpf"],
                &["dlcpacks:/x64/patch/anim/expressions.rpf"],
                &[],
                1,
            ),
            (
                "<Item>X64/PATCH/ANIM/EXPRESSIONS.RPF</Item>",
                &["X64/PATCH/ANIM/EXPRESSIONS.RPF"],
                &[],
                &["X64/PATCH/ANIM/EXPRESSIONS.RPF"],
                1,
            ),
            (
                "<Item>update:/x64/patch/data/effects/ptfx.rpf</Item><Item>update:/x64/patch/data/effects/ptfx.rpf </Item>",
                &["x64/patch/data/effects/ptfx.rpf"],
                &[],
                &["x64/patch/data/effects/ptfx.rpf"],
                2,
            ),
            (
                "<Item><![CDATA[update:/x64/c.rpf]]></Item>",
                &["x64/c.rpf"],
                &["x64/c.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/x64/&amp;&lt;a&gt;.rpf</Item>",
                &["x64/&<a>.rpf"],
                &["x64/&<a>.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/x64/<!-- note -->b.rpf</Item>",
                &["x64/b.rpf"],
                &["x64/b.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/<b>x64</b>/<i>c.rpf</i></Item>",
                &["x64/c.rpf"],
                &["x64/c.rpf"],
                &[],
                1,
            ),
            (
                "<Item>a<filesToEnable><Item>b</Item></filesToEnable></Item>",
                &["ab", "b"],
                &["ab", "b"],
                &[],
                2,
            ),
            (
                "<item>update:/x64/lower.rpf</item><Item>update:/x64/ok.rpf</Item><ITEM>update:/x64/upper.rpf</ITEM>",
                &["x64/ok.rpf"],
                &["x64/ok.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/x64/Ünï.rpf</Item><Item>update:/X64/ÜNÏ.RPF</Item>",
                &["x64/Ünï.rpf"],
                &["x64/Ünï.rpf"],
                &[],
                2,
            ),
            (
                "<Item>update:/%PLATFORM%/İ.rpf</Item>",
                &["x64/İ.rpf"],
                &["x64/İ.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/%platform%/İ\\ẞ\\Ⱥ\\%PLATFORM%.rpf</Item>",
                &["x64/İ/ẞ/Ⱥ/x64.rpf"],
                &["x64/İ/ẞ/Ⱥ/x64.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/%PLATFORM%/K.rpf</Item>",
                &["x64/K.rpf"],
                &["x64/K.rpf"],
                &[],
                1,
            ),
            (
                "<Item>update:/%PLATFORM%/Ω.rpf</Item>",
                &["x64/Ω.rpf"],
                &["x64/Ω.rpf"],
                &[],
                1,
            ),
            (
                "<Item>иконка:/%PLATFORM%/a.rpf</Item>",
                &["иконка:/x64/a.rpf"],
                &["иконка:/x64/a.rpf"],
                &[],
                1,
            ),
            ("<Item>ünicode:/x</Item>", &["ünicode:/x"], &["ünicode:/x"], &[], 1),
            ("<Item>é:/x</Item>", &["é:/x"], &["é:/x"], &[], 1),
            (
                "<Item>\u{a0}update:/x64/nbsp.rpf\u{a0}</Item>",
                &["x64/nbsp.rpf"],
                &["x64/nbsp.rpf"],
                &[],
                1,
            ),
            (
                "<Item>\u{3000}update:/x64/wide-space.rpf\u{3000}</Item>",
                &["x64/wide-space.rpf"],
                &["x64/wide-space.rpf"],
                &[],
                1,
            ),
            (
                "<Item>\u{feff}update:/x64/bom.rpf</Item>",
                &["\u{feff}update:/x64/bom.rpf"],
                &["\u{feff}update:/x64/bom.rpf"],
                &[],
                1,
            ),
        ];
        for (inner, all, custom, stock, raw) in rows {
            let got = lists(&wrap(inner));
            assert_eq!(got.0, strings(all), "все: {inner}");
            assert_eq!(got.1, strings(custom), "авторские: {inner}");
            assert_eq!(got.2, strings(stock), "штатные: {inner}");
            assert_eq!(got.3, *raw, "число Item: {inner}");
        }
    }

    #[test]
    fn seven_stock_containers_keep_their_order() {
        let names = [
            "x64/patch/anim/networkdefs.rpf",
            "x64/data/cdimages/scaleform_generic.rpf",
            "x64/data/cdimages/scaleform_generic_2.rpf",
            "x64/patch/data/cdimages/scaleform_minigames.rpf",
            "x64/patch/data/cdimages/scaleform_minimap.rpf",
            "x64/patch/data/cdimages/scaleform_web.rpf",
            "x64/patch/data/effects/ptfx.rpf",
        ];
        let inner: String = names
            .iter()
            .map(|name| format!("<Item>update:/{name}</Item>"))
            .collect();
        let got = lists(&wrap(&inner));
        assert_eq!(got.0, strings(&names));
        assert_eq!(got.2, strings(&names));
        assert!(got.1.is_empty());
        assert_eq!(got.3, 7);
    }

    #[test]
    fn structure_rules_without_wrapper() {
        let rows: &[(&str, &[&str], usize)] = &[
            (
                "<filesToEnable><Item>update:/x64/top.rpf</Item></filesToEnable>",
                &["x64/top.rpf"],
                1,
            ),
            (
                "<a:filesToEnable xmlns:a=\"urn:x\"><a:Item>update:/x64/ns.rpf</a:Item><Item>update:/x64/plain.rpf</Item></a:filesToEnable>",
                &["x64/ns.rpf", "x64/plain.rpf"],
                2,
            ),
            (
                "<R><filesToEnable><Item>update:/x64/a.rpf</Item></filesToEnable><filesToEnable><Item>update:/x64/b.rpf</Item><Item>update:/x64/a.rpf</Item></filesToEnable></R>",
                &["x64/a.rpf", "x64/b.rpf"],
                3,
            ),
            (
                "<R><filestoenable><Item>update:/x64/a.rpf</Item></filestoenable><FilesToEnable><Item>update:/x64/b.rpf</Item></FilesToEnable></R>",
                &[],
                0,
            ),
            (
                "<R><wrap><Item>update:/x64/not-in-list.rpf</Item></wrap></R>",
                &[],
                0,
            ),
            (
                "<R><filesToEnable><sub><Item>update:/x64/deeper.rpf</Item></sub></filesToEnable></R>",
                &[],
                0,
            ),
            (
                "<R><filesToEnable><Item>update:/x64/a.rpf</Item></filesToEnable></R><!-- tail -->",
                &["x64/a.rpf"],
                1,
            ),
            (
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<R><filesToEnable><Item>update:/x64/decl.rpf</Item></filesToEnable></R>",
                &["x64/decl.rpf"],
                1,
            ),
            (
                "<?xml version=\"1.0\" encoding=\"windows-1251\"?><R><filesToEnable><Item>update:/x64/enc.rpf</Item></filesToEnable></R>",
                &["x64/enc.rpf"],
                1,
            ),
            ("\u{feff}<R/>", &[], 0),
            ("<a/>\n<!-- c -->\n", &[], 0),
        ];
        for (text, all, raw) in rows {
            let got = lists(text);
            assert_eq!(got.0, strings(all), "{text}");
            assert_eq!(got.3, *raw, "{text}");
        }
    }

    #[test]
    fn parser_refusals_keep_their_text() {
        let rows = [
            ("", "the document does not have a root node"),
            (" ", "the document does not have a root node"),
            ("<a><b>", "the root node was opened but never closed"),
            ("<a></b>", "expected 'a' tag, not 'b' at 1:4"),
            ("<a/><b/>", "unknown token at 1:5"),
            ("text only", "unknown token at 1:1"),
            ("<a>&bogus;</a>", "unknown entity reference 'bogus' at 1:4"),
            ("<a b=1/>", "expected a quote not '1' at 1:6"),
            (
                "<a b='1' b='2'/>",
                "attribute 'b' at 1:10 is already defined",
            ),
            ("<!DOCTYPE a><a/>", "XML with DTD detected"),
            ("<a>\0</a>", "a non-XML character '\\0' found at 1:4"),
            (
                "<a xmlns:x=\"u\"><x:y/><z:q/></a>",
                "an unknown namespace prefix 'z' at 1:23",
            ),
            ("<a><![CDATA[unclosed</a>", "expected ']]>' at 1:25"),
            ("<a>text</a>trailing", "unknown token at 1:12"),
            (
                "<R><filesToEnable><Item>update:/x64/a.rpf</Item></filesToEnable>",
                "the root node was opened but never closed",
            ),
        ];
        for (text, message) in rows {
            assert_eq!(parse(text).unwrap_err(), message, "{text:?}");
        }
    }

    #[test]
    fn large_lists_and_default_value() {
        let many: String = (0..2000)
            .map(|n| format!("<Item>update:/x64/f{n}.rpf</Item>"))
            .collect();
        let found = parse(&wrap(&many)).unwrap();
        assert_eq!(
            (
                found.raw_count,
                found.files_to_enable.len(),
                found.custom.len(),
                found.default.len()
            ),
            (2000, 2000, 2000, 0)
        );
        let same = "<Item>update:/x64/same.rpf</Item>".repeat(2000);
        let found = parse(&wrap(&same)).unwrap();
        assert_eq!((found.raw_count, found.files_to_enable.len()), (2000, 1));
        assert_eq!(
            format!("{:?}", Analysis::default()),
            "Analysis { files_to_enable: [], custom: [], default: [], raw_count: 0 }"
        );
        assert_eq!(Analysis::default(), Analysis::default());
    }

    // ----- глубина вложенности -----

    /// Документ глубиной ровно `levels` уровней: список внутри вложенных `<a>`.
    fn nested(levels: usize) -> String {
        let wrappers = levels - 2;
        format!(
            "{}<filesToEnable><Item>update:/x64/deep.rpf</Item></filesToEnable>{}",
            "<a>".repeat(wrappers),
            "</a>".repeat(wrappers)
        )
    }

    /// Разбор в потоке со стеком в 1 МиБ, как у главного потока на Windows.
    fn parse_on_one_mebibyte(text: String) -> Result<Analysis, String> {
        std::thread::Builder::new()
            .stack_size(1 << 20)
            .spawn(move || parse(&text))
            .unwrap()
            .join()
            .unwrap()
    }

    fn too_deep() -> String {
        format!("the document is nested deeper than {MAX_DEPTH} levels")
    }

    #[test]
    fn nesting_up_to_the_limit_parses_and_one_more_level_is_refused() {
        let found = parse_on_one_mebibyte(nested(MAX_DEPTH)).unwrap();
        assert_eq!(found.files_to_enable, strings(&["x64/deep.rpf"]));
        assert_eq!(found.raw_count, 1);
        assert_eq!(
            parse_on_one_mebibyte(nested(MAX_DEPTH + 1)).unwrap_err(),
            too_deep()
        );
        // листовой пустой элемент на следующем уровне тоже уровень
        let leaf = format!(
            "{}<a/>{}",
            "<a>".repeat(MAX_DEPTH),
            "</a>".repeat(MAX_DEPTH)
        );
        assert_eq!(parse_on_one_mebibyte(leaf).unwrap_err(), too_deep());
        let leaf_inside = format!(
            "{}<a/>{}",
            "<a>".repeat(MAX_DEPTH - 1),
            "</a>".repeat(MAX_DEPTH - 1)
        );
        assert!(parse_on_one_mebibyte(leaf_inside).is_ok());
    }

    #[test]
    fn a_document_far_beyond_the_limit_is_refused_instead_of_overflowing_the_stack() {
        for levels in [5000, 100_000] {
            assert_eq!(
                parse_on_one_mebibyte(nested(levels)).unwrap_err(),
                too_deep(),
                "{levels}"
            );
        }
        // без закрывающих тегов: глубина видна и у оборванного документа
        let open_only = "<a>".repeat(100_000);
        assert_eq!(parse_on_one_mebibyte(open_only).unwrap_err(), too_deep());
    }

    #[test]
    fn only_open_elements_count_as_depth() {
        let siblings = format!("<R>{}</R>", "<a></a><b/>".repeat(5000));
        assert!(parse_on_one_mebibyte(siblings).is_ok());
        // `>` и чужая кавычка внутри значения атрибута не закрывают тег
        let attributes = format!(
            "<R x=\"{gt}\" y='\"{gt}'><filesToEnable><Item>update:/x64/a.rpf</Item></filesToEnable></R>",
            gt = ">".repeat(500)
        );
        assert_eq!(parse_on_one_mebibyte(attributes).unwrap().raw_count, 1);
        // теги внутри комментария, инструкции и блока CDATA глубины не прибавляют
        let comments = format!(
            "<R><!-- {} --><?pi {} ?><filesToEnable><Item><![CDATA[{}]]></Item></filesToEnable></R>",
            "<a>".repeat(500),
            "<a>".repeat(500),
            "<a>".repeat(500)
        );
        let found = parse_on_one_mebibyte(comments).unwrap();
        assert_eq!(found.raw_count, 1);
        assert_eq!(found.files_to_enable.len(), 1);
    }

    #[test]
    fn analyze_answers_with_empty_lists_for_a_document_that_is_too_deep() {
        let (_keep, archive) = archive_with(Some(nested(100_000).into_bytes()), true);
        assert_eq!(analyze(&archive), empty_value());
        let (_keep, archive) = archive_with(Some(nested(MAX_DEPTH).into_bytes()), true);
        assert_eq!(analyze(&archive)["filesToEnable"], json!(["x64/deep.rpf"]));
    }

    // ----- analyze на настоящих архивах -----

    fn archive_with(content: Option<Vec<u8>>, in_root: bool) -> (tempfile::TempDir, Archive) {
        let dir = tempdir().unwrap();
        let mut tree = update_tree(content.clone());
        if !in_root {
            tree.files.retain(|file| file.name != "content.xml");
            if let Some(bytes) = content {
                let mut sub = DirNode::new("sub");
                sub.files.push(FileNode {
                    name: "content.xml".into(),
                    body: Body::Binary {
                        data: Data::memory(bytes),
                        compress: Compress::Auto,
                    },
                });
                tree.dirs.push(sub);
            }
        }
        let path = dir.path().join("a.rpf");
        write_to(&tree, &path);
        let archive = Archive::open_path(&path, None).unwrap();
        (dir, archive)
    }

    fn write_to(tree: &DirNode, path: &Path) {
        let mut file = File::create(path).unwrap();
        let mut context = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
    }

    fn utf16(text: &str, big: bool) -> Vec<u8> {
        let mut out = if big {
            vec![0xFE, 0xFF]
        } else {
            vec![0xFF, 0xFE]
        };
        for unit in text.encode_utf16() {
            out.extend(if big {
                unit.to_be_bytes()
            } else {
                unit.to_le_bytes()
            });
        }
        out
    }

    fn stock_value() -> Value {
        json!({
            "filesToEnable": [
                "x64/data/cdimages/scaleform_generic.rpf",
                "x64/models/cdimages/panika.rpf",
                "common/data/a.meta",
                "dlcpacks:/mine/dlc.rpf"
            ],
            "customRpfs": ["x64/models/cdimages/panika.rpf", "common/data/a.meta", "dlcpacks:/mine/dlc.rpf"],
            "defaultRpfs": ["x64/data/cdimages/scaleform_generic.rpf"]
        })
    }

    fn empty_value() -> Value {
        json!({"filesToEnable": [], "customRpfs": [], "defaultRpfs": []})
    }

    #[test]
    fn analyze_reads_files_in_all_encodings() {
        let sample = rage_rpf::fixtures::CONTENT_XML;
        let encodings: Vec<Vec<u8>> = vec![
            sample.as_bytes().to_vec(),
            [&[0xEF, 0xBB, 0xBF][..], sample.as_bytes()].concat(),
            utf16(sample, false),
            utf16(sample, true),
        ];
        for bytes in encodings {
            let (_keep, archive) = archive_with(Some(bytes), true);
            assert_eq!(analyze(&archive), stock_value());
        }
        let (_keep, archive) = archive_with(None, true);
        assert_eq!(analyze(&archive), stock_value());
    }

    #[test]
    fn analyze_turns_every_trouble_into_empty_lists() {
        let broken: Vec<Vec<u8>> = vec![
            Vec::new(),
            b"   \n\t ".to_vec(),
            vec![0xEF, 0xBB, 0xBF],
            b"<a><b>".to_vec(),
            b"definitely not xml".to_vec(),
            b"<!DOCTYPE a><a/>".to_vec(),
            rage_rpf::fixtures::noise(300, 3),
            utf16("<R/>", false)[2..].to_vec(),
        ];
        for bytes in broken {
            let (_keep, archive) = archive_with(Some(bytes), true);
            assert_eq!(analyze(&archive), empty_value());
        }
        let list_free = b"<R><contentChangeSets/></R>".to_vec();
        let (_keep, archive) = archive_with(Some(list_free), true);
        assert_eq!(analyze(&archive), empty_value());
        let (_keep, archive) = archive_with(Some(rage_rpf::fixtures::CONTENT_XML.into()), false);
        assert_eq!(analyze(&archive), empty_value());
    }

    #[test]
    fn analyze_matches_the_name_without_case_in_the_root_only() {
        let mut tree = update_tree(None);
        for file in &mut tree.files {
            if file.name == "content.xml" {
                file.name = "CONTENT.XML".into();
            }
        }
        let dir = tempdir().unwrap();
        let path = dir.path().join("upper.rpf");
        write_to(&tree, &path);
        let archive = Archive::open_path(&path, None).unwrap();
        assert_eq!(analyze(&archive), stock_value());
    }

    #[test]
    fn journal_lines_reach_stdout_in_order() {
        if std::env::var_os("ASTRAL_CONTENT_CHILD").is_some() {
            let cases: Vec<Option<Vec<u8>>> = vec![
                None,
                Some(Vec::new()),
                Some(b"<a><b>".to_vec()),
                Some(nested(100_000).into_bytes()),
                Some(wrap("").into_bytes()),
            ];
            for case in cases {
                let (_keep, archive) = archive_with(case, true);
                analyze(&archive);
            }
            let (_keep, archive) = archive_with(None, false);
            analyze(&archive);
            return;
        }
        let out = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "archives::content::tests::journal_lines_reach_stdout_in_order",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("ASTRAL_CONTENT_CHILD", "1")
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let expected = [
            "[ContentXmlAnalyzer] Найдено записей filesToEnable: 4",
            "[ContentXmlAnalyzer] Default RPFs: 1, Custom RPFs: 3",
            "[ContentXmlAnalyzer] content.xml пустой после извлечения",
            "[ContentXmlAnalyzer] Ошибка чтения content.xml: the root node was opened but never closed",
            "[ContentXmlAnalyzer] Ошибка чтения content.xml: the document is nested deeper than 64 levels",
            "[ContentXmlAnalyzer] Найдено записей filesToEnable: 0",
            "[ContentXmlAnalyzer] Default RPFs: 0, Custom RPFs: 0",
            "[ContentXmlAnalyzer] content.xml не найден в корне modded archive",
        ];
        let mut from = 0;
        for line in expected {
            let at = text[from..]
                .find(line)
                .unwrap_or_else(|| panic!("нет строки {line}: {text}"));
            from += at + line.len();
        }
    }
}
