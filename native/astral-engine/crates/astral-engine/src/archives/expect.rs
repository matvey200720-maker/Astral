//! Ожидания запроса к собранному архиву: ключи `install.expectEntries` и
//! `install.expectDlcList` (шаг проверки между сборкой и подменой).
//!
//! Приложение знает, что установка обязана оставить в архиве: записи работы (в
//! том числе внутри вложенных `.rpf`, `x64/astral/foo.rpf/bar.ytd`) и имена
//! пакетов в `dlclist.xml`. Движок проверяет это сам, над результатом, каким его
//! откроет игра, и отказывает до подмены (полный путь) или до смены головы
//! (дозапись): архив остаётся таким, каким был.
//!
//! Что значит «читается». Запись найдена по пути (каждый вложенный архив на пути
//! раскрывается строгим разбором оглавления), это файл, а не каталог, её тело
//! целиком лежит внутри своего архива, и начало тела читается с носителя. Тело
//! целиком не читается: проверка идёт за миллисекунды и на архиве в гигабайты.
//! Вложенный архив на конце пути ещё и раскрывается.
//!
//! Правила «игра увидит пакет» остаются в приложении (его строгий читатель
//! смотрит и на `content.xml`, и на `setup2.xml`): здесь только то, что запрос
//! назвал прямо.

use std::{collections::BTreeSet, path::Path, sync::Arc};

use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind, KeySet};
use serde_json::Value;

use super::compose::normalize_entry;
use crate::error::{EngineError, Result};

/// Код отказа: в результате нет названного запросом или оно не читается.
pub const EXPECTATION_FAILED: &str = "ExpectationFailed";

/// Где лежит список пакетов дополнения в корневом архиве обновления.
const DLC_LIST: [&str; 3] = ["common", "data", "dlclist.xml"];
/// Сколько байт начала тела читается ради «носитель отдаёт».
const PROBE_BYTES: u64 = 16;
/// Сколько имён каждого списка называет сообщение отказа.
const SHOWN: usize = 40;
/// Предел числа записей и имён пакетов в одном запросе.
const MAX_ENTRIES: usize = 200_000;
const MAX_PACKS: usize = 1_000;
/// Глубина вложенных архивов, которую проверка проходит.
const MAX_DEPTH: usize = 8;

/// Что запрос ждёт от одного архива.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Expectation {
    /// Путь архива в игре (строчными, с `/`); `None` — архив самого блока
    /// (единственная или первая цель).
    pub archive: Option<String>,
    /// Пути записей звеньями (строчными).
    pub entries: Vec<Vec<String>>,
    /// Имена пакетов дополнения (строчными).
    pub dlc_list: Vec<String>,
}

impl Expectation {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty() && self.dlc_list.is_empty()
    }
}

fn bad(what: &'static str) -> EngineError {
    EngineError::argument(what)
}

/// Список путей записей из запроса: нет или `null` — пусто.
pub fn entries_from(value: Option<&Value>) -> Result<Vec<Vec<String>>> {
    const INVALID: &str = "Install expectEntries is invalid.";
    let items = match value {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(items)) if items.len() <= MAX_ENTRIES => items,
        Some(_) => return Err(bad(INVALID)),
    };
    let mut seen = BTreeSet::new();
    let mut found = Vec::new();
    for item in items {
        let Some(text) = item.as_str() else {
            return Err(bad(INVALID));
        };
        let parts = normalize_entry(text, true).map_err(|_| bad(INVALID))?;
        if seen.insert(parts.join("/")) {
            found.push(parts);
        }
    }
    Ok(found)
}

/// Имена пакетов из запроса: от 1 до 64 знаков из букв, цифр и `_ . -`.
pub fn packs_from(value: Option<&Value>) -> Result<Vec<String>> {
    const INVALID: &str = "Install expectDlcList is invalid.";
    let items = match value {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(items)) if items.len() <= MAX_PACKS => items,
        Some(_) => return Err(bad(INVALID)),
    };
    let mut found: Vec<String> = Vec::new();
    for item in items {
        let name = match item.as_str() {
            Some(text)
                if (1..=64).contains(&text.len())
                    && text
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)) =>
            {
                text.to_ascii_lowercase()
            }
            _ => return Err(bad(INVALID)),
        };
        if !found.contains(&name) {
            found.push(name);
        }
    }
    Ok(found)
}

fn fold(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

/// Что ждёт запрос от конкретной цели блока: общие ключи блока относятся к
/// первой цели, ключ `expect` называет архив.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Wanted {
    pub entries: Vec<Vec<String>>,
    pub dlc_list: Vec<String>,
}

impl Wanted {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty() && self.dlc_list.is_empty()
    }

    /// Ожидания цели `archive`; `first` — это первая цель блока.
    pub fn of(all: &[Expectation], archive: &str, first: bool) -> Wanted {
        let mut wanted = Wanted::default();
        let this = fold(archive);
        for item in all {
            let mine = match &item.archive {
                None => first,
                Some(name) => fold(name) == this,
            };
            if !mine {
                continue;
            }
            for entry in &item.entries {
                if !wanted.entries.contains(entry) {
                    wanted.entries.push(entry.clone());
                }
            }
            for name in &item.dlc_list {
                if !wanted.dlc_list.contains(name) {
                    wanted.dlc_list.push(name.clone());
                }
            }
        }
        wanted
    }
}

/// Сколько проверено (идёт в ответ у запроса с ожиданиями).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Checked {
    pub entries: usize,
    pub dlc_packs: usize,
}

/// Итог поиска одной записи.
enum Found {
    Fine,
    Missing,
    Unreadable(String),
}

/// Откройте архив файла (с оглавлением и вложенными, как их разбирает игра) и
/// сверьте с ожиданиями.
pub fn check_file(path: &Path, keys: &Arc<KeySet>, wanted: &Wanted) -> Result<Checked> {
    let opened = Archive::open_path(path, Some(Arc::clone(keys))).map_err(|error| {
        failure(format!(
            "The built archive does not open: {}.",
            error.to_string().trim_end_matches('.')
        ))
    })?;
    check_archive(&opened, wanted)
}

/// Сверка уже открытого архива с ожиданиями.
pub fn check_archive(archive: &Archive, wanted: &Wanted) -> Result<Checked> {
    let mut missing = Vec::new();
    let mut unreadable = Vec::new();
    for parts in &wanted.entries {
        match resolve(archive, parts, 0) {
            Found::Fine => {}
            Found::Missing => missing.push(parts.join("/")),
            Found::Unreadable(why) => unreadable.push(format!("{} ({why})", parts.join("/"))),
        }
    }
    let mut packs_missing = Vec::new();
    let mut list_note = None;
    if !wanted.dlc_list.is_empty() {
        match registered_packs(archive) {
            Ok(known) => {
                packs_missing.extend(
                    wanted
                        .dlc_list
                        .iter()
                        .filter(|name| !known.contains(*name))
                        .cloned(),
                );
            }
            Err(why) => {
                list_note = Some(why);
                packs_missing.extend(wanted.dlc_list.iter().cloned());
            }
        }
    }
    if missing.is_empty() && unreadable.is_empty() && packs_missing.is_empty() {
        return Ok(Checked {
            entries: wanted.entries.len(),
            dlc_packs: wanted.dlc_list.len(),
        });
    }
    let mut sentences = Vec::new();
    for (label, list) in [
        ("Missing entries", &missing),
        ("Unreadable entries", &unreadable),
        ("DLC packs missing from common/data/dlclist.xml", &packs_missing),
    ] {
        if !list.is_empty() {
            sentences.push(format!("{label} ({}): {}.", list.len(), shown(list)));
        }
    }
    if let Some(why) = list_note {
        sentences.push(format!("dlclist.xml: {why}."));
    }
    Err(failure(format!(
        "The built archive does not hold what was expected. {}",
        sentences.join(" ")
    )))
}

fn failure(message: String) -> EngineError {
    EngineError::new(EXPECTATION_FAILED, message)
}

/// Первые имена списка и сколько осталось за краем.
fn shown(list: &[String]) -> String {
    let mut text = list
        .iter()
        .take(SHOWN)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    if list.len() > SHOWN {
        text.push_str(&format!(" and {} more", list.len() - SHOWN));
    }
    text
}

/// Ищет запись по звеньям пути, раскрывая вложенные архивы по дороге.
fn resolve(archive: &Archive, parts: &[String], depth: usize) -> Found {
    let Some((leaf, middle)) = parts.split_last() else {
        return Found::Missing;
    };
    let mut dir = archive.root();
    for (at, part) in middle.iter().enumerate() {
        if let Some(below) = archive.find_dir(dir, part) {
            dir = below;
            continue;
        }
        if !Archive::is_nested_archive_name(part) {
            return Found::Missing;
        }
        let Some(id) = archive.find_file(dir, part) else {
            return Found::Missing;
        };
        if depth >= MAX_DEPTH {
            return Found::Unreadable(format!("{part} lies too deep"));
        }
        return match archive.open_nested_shared(id) {
            Ok(inner) => resolve(&inner, &parts[at + 1..], depth + 1),
            Err(error) => Found::Unreadable(format!(
                "the nested archive {part} does not open: {}",
                error.to_string().trim_end_matches('.')
            )),
        };
    }
    match archive.find_file(dir, leaf) {
        Some(id) => match probe(archive, id) {
            Ok(()) => Found::Fine,
            Err(why) => Found::Unreadable(why),
        },
        None if archive.find_dir(dir, leaf).is_some() => {
            Found::Unreadable("it is a directory".to_owned())
        }
        None => Found::Missing,
    }
}

/// Тело записи целиком внутри архива, начало читается; вложенный архив на
/// конце пути раскрывается.
fn probe(archive: &Archive, id: EntryId) -> std::result::Result<(), String> {
    let entry = archive.entry(id);
    let (offset, len) = match &entry.kind {
        EntryKind::Binary(info) => (info.offset(), info.stored_len()),
        EntryKind::Resource(info) => (info.offset(), u64::from(info.stored_size)),
        EntryKind::Directory { .. } => return Err("it is a directory".to_owned()),
    };
    let source = archive.source();
    let end = offset
        .checked_add(len)
        .ok_or_else(|| "its body does not fit the address space".to_owned())?;
    if end > source.len() {
        return Err(format!(
            "its body [{offset}, {end}) goes beyond the end of the archive ({} bytes)",
            source.len()
        ));
    }
    let head = len.min(PROBE_BYTES) as usize;
    if head > 0 {
        source
            .read_vec(offset, head)
            .map_err(|error| format!("its body does not read: {error}"))?;
    }
    if Archive::is_nested_archive_name(&entry.name) && matches!(entry.kind, EntryKind::Binary(_)) {
        archive.open_nested_shared(id).map_err(|error| {
            format!(
                "the nested archive does not open: {}",
                error.to_string().trim_end_matches('.')
            )
        })?;
    }
    Ok(())
}

/// Имена пакетов, что названы в `common/data/dlclist.xml` корня (строчными).
fn registered_packs(archive: &Archive) -> std::result::Result<BTreeSet<String>, String> {
    let mut dir = archive.root();
    for part in &DLC_LIST[..DLC_LIST.len() - 1] {
        dir = archive
            .find_dir(dir, part)
            .ok_or_else(|| "the archive has no common/data/dlclist.xml".to_owned())?;
    }
    let id = archive
        .find_file(dir, DLC_LIST[DLC_LIST.len() - 1])
        .ok_or_else(|| "the archive has no common/data/dlclist.xml".to_owned())?;
    let bytes = archive
        .decode(id, EntryCipher::ByArchive)
        .map_err(|error| format!("it does not read: {error}"))?;
    Ok(pack_names(&String::from_utf8_lossy(&bytes)))
}

/// Имена из строк `<Item>dlcpacks:/имя/</Item>`: теги и приставка без учёта
/// регистра, пробелы вокруг имени прощаются (так ищет и проверка приложения).
pub fn pack_names(xml: &str) -> BTreeSet<String> {
    const OPEN: &str = "<item>";
    const CLOSE: &str = "</item>";
    const PREFIX: &str = "dlcpacks:/";
    let lowered = xml.to_ascii_lowercase();
    let mut found = BTreeSet::new();
    let mut from = 0;
    while let Some(at) = lowered[from..].find(OPEN) {
        let start = from + at + OPEN.len();
        from = start;
        let rest = lowered[start..].trim_start();
        let Some(after) = rest.strip_prefix(PREFIX) else {
            continue;
        };
        let name: String = after
            .chars()
            .take_while(|ch| *ch != '/' && *ch != '<' && !ch.is_whitespace())
            .collect();
        if name.is_empty() {
            continue;
        }
        let tail = after[name.len()..].strip_prefix('/');
        if tail.is_some_and(|tail| tail.trim_start().starts_with(CLOSE)) {
            found.insert(name);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_rpf::fixtures::text;
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    fn file(name: &str, bytes: Vec<u8>) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Binary {
                data: Data::memory(bytes),
                compress: Compress::Store,
            },
        }
    }

    fn folder(name: &str, dirs: Vec<DirNode>, files: Vec<FileNode>) -> DirNode {
        let mut node = DirNode::new(name);
        node.dirs = dirs;
        node.files = files;
        node
    }

    /// Корень с `common/data/dlclist.xml` и вложенным `x64/astral/mod.rpf`.
    fn tree(list: &str) -> DirNode {
        let inner = folder(
            "",
            vec![folder(
                "deep",
                vec![],
                vec![file("leaf.txt", text(40, "leaf"))],
            )],
            vec![file("one.ydd", text(300, "one")), file("two.ydd", text(90, "two"))],
        );
        let packed = FileNode {
            name: "mod.rpf".to_owned(),
            body: Body::Nested(Box::new(inner)),
        };
        folder(
            "",
            vec![
                folder(
                    "common",
                    vec![folder(
                        "data",
                        vec![],
                        vec![file("dlclist.xml", list.as_bytes().to_vec())],
                    )],
                    vec![],
                ),
                folder("x64", vec![folder("astral", vec![], vec![packed])], vec![]),
            ],
            vec![file("top.txt", text(50, "top"))],
        )
    }

    fn open(list: &str) -> (tempfile::TempDir, Archive) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("probe.rpf");
        let mut out = fs::File::create(&path).unwrap();
        let mut context = WriteContext {
            staging: dir.path(),
            keys: None,
            finalizer: None,
        };
        write_archive(&tree(list), &mut out, &mut context, &mut |_| {}).unwrap();
        drop(out);
        let archive = Archive::open_path(&path, None).unwrap();
        (dir, archive)
    }

    fn wanted(entries: &[&str], packs: &[&str]) -> Wanted {
        Wanted {
            entries: entries_from(Some(&json!(entries))).unwrap(),
            dlc_list: packs_from(Some(&json!(packs))).unwrap(),
        }
    }

    const LIST: &str = "<?xml version=\"1.0\"?>\n<SMandatoryPacksData>\n  <Paths>\n    <Item>dlcpacks:/mpbeach/</Item>\n    <Item> dlcpacks:/Astral_Roads/ </Item>\n    <Item>dlcpacks:/notapack</Item>\n  </Paths>\n</SMandatoryPacksData>";

    #[test]
    fn pack_names_are_read_like_the_application_reads_them() {
        let names = pack_names(LIST);
        assert_eq!(
            names.into_iter().collect::<Vec<_>>(),
            ["astral_roads", "mpbeach"]
        );
        assert!(pack_names("<Item>other:/x/</Item><Item>dlcpacks://</Item>").is_empty());
        assert_eq!(
            pack_names("<ITEM>DLCPACKS:/Up/</ITEM>").len(),
            1,
            "регистр тегов и приставки не важен"
        );
    }

    #[test]
    fn entries_in_the_root_and_inside_a_nested_archive_are_found() {
        let (_dir, archive) = open(LIST);
        let found = check_archive(
            &archive,
            &wanted(
                &[
                    "top.txt",
                    "X64/Astral/mod.rpf/one.ydd",
                    "x64/astral/mod.rpf/deep/leaf.txt",
                    "x64/astral/mod.rpf",
                ],
                &["MPBeach", "astral_roads"],
            ),
        )
        .unwrap();
        assert_eq!(
            found,
            Checked {
                entries: 4,
                dlc_packs: 2
            }
        );
    }

    #[test]
    fn a_missing_entry_is_named_in_the_refusal() {
        let (_dir, archive) = open(LIST);
        let error = check_archive(
            &archive,
            &wanted(
                &[
                    "top.txt",
                    "nothing.txt",
                    "x64/astral/mod.rpf/absent.ydd",
                    "x64/astral/gone.rpf/one.ydd",
                ],
                &[],
            ),
        )
        .unwrap_err();
        assert_eq!(error.code, EXPECTATION_FAILED);
        assert!(
            error.message.contains(
                "Missing entries (3): nothing.txt, x64/astral/mod.rpf/absent.ydd, x64/astral/gone.rpf/one.ydd."
            ),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_directory_in_place_of_a_file_is_not_readable() {
        let (_dir, archive) = open(LIST);
        let error = check_archive(&archive, &wanted(&["x64/astral"], &[])).unwrap_err();
        assert!(
            error
                .message
                .contains("Unreadable entries (1): x64/astral (it is a directory)."),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_pack_missing_from_the_list_or_a_missing_list_is_refused() {
        let (_dir, archive) = open(LIST);
        let error = check_archive(&archive, &wanted(&[], &["mpbeach", "astral_veg"])).unwrap_err();
        assert!(
            error
                .message
                .contains("DLC packs missing from common/data/dlclist.xml (1): astral_veg."),
            "{}",
            error.message
        );
        // список без нужной строки вовсе
        let (_other, bare) = open("<SMandatoryPacksData/>");
        let error = check_archive(&bare, &wanted(&[], &["mpbeach"])).unwrap_err();
        assert_eq!(error.code, EXPECTATION_FAILED);
        assert!(error.message.contains("(1): mpbeach."), "{}", error.message);
    }

    #[test]
    fn the_request_lists_are_parsed_strictly() {
        assert!(entries_from(None).unwrap().is_empty());
        assert!(entries_from(Some(&Value::Null)).unwrap().is_empty());
        for bad_value in [
            json!("x"),
            json!([1]),
            json!([""]),
            json!(["../up"]),
            json!(["a/./b"]),
        ] {
            let error = entries_from(Some(&bad_value)).unwrap_err();
            assert_eq!(error.code, "ArgumentException", "{bad_value}");
            assert_eq!(error.message, "Install expectEntries is invalid.");
        }
        for bad_value in [json!("x"), json!([1]), json!([""]), json!(["a b"]), json!(["a/b"])] {
            let error = packs_from(Some(&bad_value)).unwrap_err();
            assert_eq!(error.message, "Install expectDlcList is invalid.", "{bad_value}");
        }
        // повторы и регистр сворачиваются
        assert_eq!(
            entries_from(Some(&json!(["A/b.ytd", "a\\B.ytd"]))).unwrap().len(),
            1
        );
        assert_eq!(
            packs_from(Some(&json!(["Foo", "foo"]))).unwrap(),
            ["foo"]
        );
    }

    #[test]
    fn expectations_go_to_the_first_target_or_to_the_named_archive() {
        let all = vec![
            Expectation {
                archive: None,
                entries: vec![vec!["a".into()]],
                dlc_list: vec!["p".into()],
            },
            Expectation {
                archive: Some("Update/X64/DLC.rpf".into()),
                entries: vec![vec!["b".into()]],
                dlc_list: vec![],
            },
        ];
        let first = Wanted::of(&all, "update/update.rpf", true);
        assert_eq!(first.entries, [vec!["a".to_owned()]]);
        assert_eq!(first.dlc_list, ["p"]);
        let named = Wanted::of(&all, "update\\x64\\dlc.rpf", false);
        assert_eq!(named.entries, [vec!["b".to_owned()]]);
        assert!(Wanted::of(&all, "other.rpf", false).is_empty());
    }
}
