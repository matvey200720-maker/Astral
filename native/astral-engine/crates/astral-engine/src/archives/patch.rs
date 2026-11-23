//! Заплатка для архивов игры: папка с описью `manifest.json` и файлами, на
//! которые опись ссылается. Модуль читает опись так, как её писал прежний хост,
//! и проверяет заплатку до первой записи в игру. Ничего не создаёт и не меняет.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};

use super::{index::compare_ignore_case, resolve_root_archive, sha256_file};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

fn manifest_invalid() -> EngineError {
    EngineError::invalid_data("RPF patch manifest is invalid.")
}

/// Вид действия: заменить существующую запись, добавить, удалить.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ActionKind {
    Replace = 0,
    Import = 1,
    Delete = 2,
}

impl ActionKind {
    /// Вид по номеру в описи; номера идут подряд с нуля.
    fn from_number(number: u64) -> Option<Self> {
        [Self::Replace, Self::Import, Self::Delete]
            .into_iter()
            .find(|kind| *kind as u64 == number)
    }

    /// Вид по слову, уже сведённому к нижнему регистру ASCII.
    fn from_word(lowered: &str) -> Option<Self> {
        match lowered {
            "replace" => Some(Self::Replace),
            "import" => Some(Self::Import),
            "delete" => Some(Self::Delete),
            _ => None,
        }
    }
}

/// Одно действие описи.
#[derive(Clone, Debug)]
pub struct PatchAction {
    /// Ожидаемый размер файла; `0` — «не проверять».
    pub size: u64,
    pub kind: ActionKind,
    /// Ожидаемый отпечаток; `None` — «не проверять».
    pub sha256: Option<String>,
    /// Путь записи в игре, как записан в описи (без правок и обрезки).
    pub target_path: String,
    /// Признак «целиком заменить вложенный архив»: читается и хранится, но
    /// дальше нигде не используется.
    pub whole_replace_nested: bool,
    /// Путь файла внутри папки патча, как в описи.
    pub source_path: String,
}

/// Объект описи: поля ищутся по имени без учёта регистра ASCII.
struct Record<'a>(&'a Map<String, Value>);

impl<'a> Record<'a> {
    /// Из совпадений берётся первое в файле.
    fn get(&self, name: &'static str) -> Option<&'a Value> {
        for (key, value) in self.0 {
            if key.eq_ignore_ascii_case(name) {
                return Some(value);
            }
        }
        None
    }

    /// Строка как есть; всё остальное — пустая строка.
    fn text(&self, name: &'static str) -> String {
        self.get(name)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    }

    /// Вид действия: слово (регистр ASCII не важен, пробелы не срезаются) или число 0–2.
    fn kind(&self) -> Result<ActionKind> {
        let given = self.get("Type").ok_or_else(manifest_invalid)?;
        if let Some(word) = given.as_str() {
            let lowered = word.to_ascii_lowercase();
            return ActionKind::from_word(&lowered).ok_or_else(|| {
                let reason = format!("RPF patch has an unsupported action type: {lowered}");
                EngineError::invalid_data(reason)
            });
        }
        given
            .as_u64()
            .and_then(ActionKind::from_number)
            .ok_or_else(manifest_invalid)
    }

    /// Размер: целое без знака как есть, любое другое число через дробное
    /// (отрицательное — 0, дробная часть и избыток отсекаются); не число — 0.
    fn size(&self) -> u64 {
        let Some(Value::Number(number)) = self.get("Size") else {
            return 0;
        };
        match number.as_u64() {
            Some(whole) => whole,
            None => number.as_f64().unwrap_or_default() as u64,
        }
    }

    /// Отпечаток: непустая (после обрезки) строка сохраняется как есть, без обрезки.
    fn sha256(&self) -> Option<String> {
        let text = self.get("Sha256")?.as_str()?;
        (!text.trim().is_empty()).then(|| text.to_owned())
    }

    fn action(&self) -> Result<PatchAction> {
        let kind = self.kind()?;
        Ok(PatchAction {
            whole_replace_nested: self
                .get("IsWholeReplaceNestedRpf")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            source_path: self.text("SourcePath"),
            target_path: self.text("TargetPath"),
            sha256: self.sha256(),
            size: self.size(),
            kind,
        })
    }
}

/// Корень `manifest.json`: объект JSON из папки патча.
fn load_root(patch: &Path) -> Result<Map<String, Value>> {
    let folder = patch.to_string_lossy();
    let found = paths::inside(&folder, "manifest.json")?;
    if !found.is_file() {
        let message = "RPF patch manifest.json was not found.";
        return Err(EngineError::file_not_found(message));
    }
    let text = fs::read_to_string(&found)?;
    match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(Value::Object(root)) => Ok(root),
        Ok(_) | Err(_) => Err(manifest_invalid()),
    }
}

/// Действия описи в порядке файла; не-массив значит «действий нет».
fn actions_of(root: &Map<String, Value>) -> Result<Vec<PatchAction>> {
    let Some(items) = Record(root).get("Actions").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    items
        .iter()
        .map(|item| {
            let object = item.as_object().ok_or_else(manifest_invalid)?;
            Record(object).action()
        })
        .collect()
}

/// Опись: действия в порядке файла.
#[derive(Clone, Debug)]
pub struct PatchManifest {
    pub actions: Vec<PatchAction>,
}

/// Загружает `manifest.json` из папки патча и превращает его в список действий.
pub fn read_manifest(patch: &Path) -> Result<PatchManifest> {
    load_root(patch)
        .and_then(|root| actions_of(&root))
        .map(|actions| PatchManifest { actions })
}

/// Условие выполнено, иначе — отказ, который строится только при отказе.
fn ensure(holds: bool, otherwise: impl FnOnce() -> EngineError) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(otherwise())
    }
}

impl PatchAction {
    /// Файл нагрузки: путь на месте, размер и отпечаток сошлись.
    fn verify_payload(&self, patch_text: &str) -> Result<()> {
        let name = &self.source_path;
        let file = paths::normalize_relative(name)
            .and_then(|relative| paths::inside(patch_text, &relative))?;
        ensure(file.is_file(), || {
            EngineError::file_not_found(format!("Patch payload is missing: {name}"))
        })?;
        ensure(
            self.size == 0 || fs::metadata(&file)?.len() == self.size,
            || EngineError::invalid_data(format!("Patch size mismatch: {name}")),
        )?;
        let Some(expected) = &self.sha256 else {
            return Ok(());
        };
        let actual = sha256_file(&file)?;
        ensure(actual.eq_ignore_ascii_case(expected), || {
            EngineError::invalid_data(format!("Patch checksum mismatch: {name}"))
        })
    }
}

/// Корневые архивы заплатки: без дублей по регистру ASCII, остаётся первое написание.
#[derive(Default)]
struct Roster(Vec<String>);

impl Roster {
    fn admit(&mut self, found: Option<String>) {
        let Some(name) = found else { return };
        if self.0.iter().all(|seen| !seen.eq_ignore_ascii_case(&name)) {
            self.0.push(name);
        }
    }

    /// Каждый архив должен лежать внутри папки игры.
    fn confine_to(&self, game: &Path) -> Result<()> {
        let game_text = game.to_string_lossy();
        self.0
            .iter()
            .try_for_each(|archive| paths::inside(&game_text, archive).map(drop))
    }

    fn into_sorted(self) -> Vec<String> {
        let by_name = |a: &String, b: &String| compare_ignore_case(a, b);
        let mut names = self.0;
        names.sort_by(by_name);
        names
    }
}

/// Папка патча (полный путь) вместе с непустой описью.
fn open_patch(patch_directory: &Path) -> Result<(PathBuf, PatchManifest)> {
    let given = patch_directory.to_string_lossy();
    let folder = paths::full_path(&given)?;
    match read_manifest(&folder)? {
        manifest if manifest.actions.is_empty() => {
            Err(EngineError::invalid_data("RPF patch has no actions."))
        }
        manifest => Ok((folder, manifest)),
    }
}

/// Проверяет заплатку целиком; первый же отказ побеждает.
pub fn validate(patch_directory: &Path, game_root: Option<&Path>) -> Result<Validation> {
    let (folder, manifest) = open_patch(patch_directory)?;
    examine(folder, manifest, game_root)
}

/// Действия описи по порядку: корневые архивы и файлы нагрузки, затем папка игры.
fn examine(
    patch_directory: PathBuf,
    manifest: PatchManifest,
    game_root: Option<&Path>,
) -> Result<Validation> {
    let mut roster = Roster::default();
    let payload_root = patch_directory.to_string_lossy();
    manifest.actions.iter().try_for_each(|action| {
        roster.admit(resolve_root_archive(&action.target_path)?);
        match action.kind {
            ActionKind::Delete => Ok(()),
            _ => action.verify_payload(&payload_root),
        }
    })?;
    if let Some(game) = game_root {
        roster.confine_to(game)?;
    }

    let actions = manifest.actions.len();
    Ok(Validation {
        manifest,
        patch_directory,
        actions,
        archives: roster.into_sorted(),
    })
}

/// Итог проверки заплатки.
pub struct Validation {
    /// Корневые архивы, которые заплатка затронет (отсортированы, без дублей).
    pub archives: Vec<String>,
    pub manifest: PatchManifest,
    pub patch_directory: PathBuf,
    /// Число всех действий описи.
    pub actions: usize,
}

impl Validation {
    /// Ответ команды: папка, корневые архивы, число действий.
    fn answer(&self) -> Value {
        json!({
            "patchDirectory": self.patch_directory.to_string_lossy(),
            "archives": self.archives,
            "actions": self.actions,
        })
    }
}

/// Команда `validate-rpf-patch --patch <папка>`.
pub fn validate_rpf_patch(options: &Options, _progress: &Progress) -> Result<Value> {
    options
        .required("patch")
        .and_then(|patch| validate(Path::new(patch), None))
        .map(|verdict| verdict.answer())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::sha256_hex;
    use tempfile::{tempdir, TempDir};

    // ----- помощники -----

    const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    /// Папка патча с описью-текстом и файлами нагрузки.
    fn patch_with(manifest: &[u8], files: &[(&str, &[u8])]) -> TempDir {
        let dir = tempdir().unwrap();
        write(&dir.path().join("manifest.json"), manifest);
        for (name, bytes) in files {
            write(&dir.path().join(name), bytes);
        }
        dir
    }

    fn show_action(action: &PatchAction) -> String {
        format!(
            "{:?} target={:?} source={:?} size={} sha={:?} whole={}",
            action.kind,
            action.target_path,
            action.source_path,
            action.size,
            action.sha256,
            action.whole_replace_nested
        )
    }

    /// Результат разбора описи в виде одной строки: `Ok, действий N: …` или `Err код|текст`.
    fn show_manifest(outcome: Result<PatchManifest>) -> String {
        match outcome {
            Err(error) => format!("Err {}|{}", error.code, error.message),
            Ok(manifest) if manifest.actions.is_empty() => "Ok, действий 0".to_owned(),
            Ok(manifest) => format!(
                "Ok, действий {}: {}",
                manifest.actions.len(),
                manifest
                    .actions
                    .iter()
                    .map(show_action)
                    .collect::<Vec<_>>()
                    .join("; ")
            ),
        }
    }

    fn parsed_text(text: &str) -> String {
        parsed_bytes(text.as_bytes())
    }

    fn parsed_bytes(bytes: &[u8]) -> String {
        let dir = patch_with(bytes, &[]);
        show_manifest(read_manifest(dir.path()))
    }

    /// Описью служит одно действие с данными полями.
    fn one_action(fields: &str) -> String {
        parsed_text(&format!(r#"{{"Actions":[{{{fields}}}]}}"#))
    }

    const INVALID: &str = "Err InvalidDataException|RPF patch manifest is invalid.";

    fn delete_of(target: &str) -> String {
        format!(r#"Ok, действий 1: Delete target="{target}" source="" size=0 sha=None whole=false"#)
    }

    // ----- read_manifest: файл описи (М-а - М-г) -----

    #[test]
    fn the_manifest_file_must_exist_and_be_a_file() {
        let dir = tempdir().unwrap();
        let not_found = "Err FileNotFoundException|RPF patch manifest.json was not found.";
        // М-а: папка есть, файла нет
        assert_eq!(show_manifest(read_manifest(dir.path())), not_found);
        // М-б: папки нет
        assert_eq!(
            show_manifest(read_manifest(&dir.path().join("none"))),
            not_found
        );
        // М-в: manifest.json - каталог
        fs::create_dir(dir.path().join("manifest.json")).unwrap();
        assert_eq!(show_manifest(read_manifest(dir.path())), not_found);
        // М-г: путь патча пуст
        assert_eq!(
            show_manifest(read_manifest(Path::new(""))),
            "Err ArgumentException|The path is empty."
        );
    }

    // ----- read_manifest: JSON и корень (М1 - М14) -----

    #[test]
    fn broken_json_and_a_root_that_is_not_an_object_are_refused() {
        for text in [
            "",
            "  \n",
            "[]",
            "\"x\"",
            "null",
            "5",
            "{not json",
            r#"{"Actions":[]} x"#,
            r#"{"Actions":[{"Type":"Delete"},]}"#,
        ] {
            assert_eq!(parsed_text(text), INVALID, "{text:?}");
        }
    }

    #[test]
    fn actions_that_are_not_an_array_mean_no_actions() {
        for text in [
            "{}",
            r#"{"Actions":null}"#,
            r#"{"Actions":{}}"#,
            r#"{"Actions":"x"}"#,
            r#"{"Actions":[]}"#,
        ] {
            assert_eq!(parsed_text(text), "Ok, действий 0", "{text}");
        }
    }

    // ----- read_manifest: имена полей (М15 - М21) -----

    #[test]
    fn field_names_are_matched_without_case_and_the_first_wins() {
        // М15, М16
        assert_eq!(
            parsed_text(
                r#"{"actions":[{"type":"replace","targetpath":"a","sourcepath":"b","size":5,"sha256":"AB","iswholereplacenestedrpf":true}]}"#
            ),
            r#"Ok, действий 1: Replace target="a" source="b" size=5 sha=Some("AB") whole=true"#
        );
        assert_eq!(
            parsed_text(
                r#"{"ACTIONS":[{"TYPE":"delete","TARGETPATH":"x","SOURCEPATH":"y","SIZE":3,"SHA256":"cd","ISWHOLEREPLACENESTEDRPF":true}]}"#
            ),
            r#"Ok, действий 1: Delete target="x" source="y" size=3 sha=Some("cd") whole=true"#
        );
        // М17-М18: два ключа Actions разного регистра - действует первый по порядку
        let delete_x = r#"[{"Type":"Delete","TargetPath":"x"}]"#;
        assert_eq!(
            parsed_text(&format!(r#"{{"Actions":[],"actions":{delete_x}}}"#)),
            "Ok, действий 0"
        );
        assert_eq!(
            parsed_text(&format!(r#"{{"actions":{delete_x},"Actions":[]}}"#)),
            delete_of("x")
        );
        // М19: один и тот же ключ дважды - последнее значение
        assert_eq!(
            parsed_text(&format!(r#"{{"Actions":{delete_x},"Actions":[]}}"#)),
            "Ok, действий 0"
        );
        // М20
        assert_eq!(
            one_action(r#""Type":"Delete","Type":"Import","TargetPath":"x""#),
            r#"Ok, действий 1: Import target="x" source="" size=0 sha=None whole=false"#
        );
        // М21: посторонние поля игнорируются
        assert_eq!(
            parsed_text(
                r#"{"ReduxName":"r","ParsedAt":"2026","TotalPatchSize":0,"Actions":[{"Type":"Delete","TargetPath":"x","Extra":[1,2]}],"Tail":null}"#
            ),
            delete_of("x")
        );
    }

    #[test]
    fn a_bom_is_skipped_but_not_after_whitespace_and_the_text_must_be_utf8() {
        let body = br#"{"Actions":[{"Type":"Delete","TargetPath":"x"}]}"#;
        // М22
        assert_eq!(parsed_bytes(&[BOM, body].concat()), delete_of("x"));
        // М23: два BOM подряд срезаются оба
        assert_eq!(
            parsed_bytes(&[BOM, BOM, br#"{"Actions":[]}"#].concat()),
            "Ok, действий 0"
        );
        // М24: BOM после пробела - уже часть текста
        assert_eq!(parsed_bytes(&[b" ", BOM, body].concat()), INVALID);
        // М25: UTF-16 LE с BOM
        let utf16: Vec<u8> = [0xFF, 0xFE]
            .into_iter()
            .chain("{}".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        let not_utf8 = "Err IOException|stream did not contain valid UTF-8";
        assert_eq!(parsed_bytes(&utf16), not_utf8);
        // М26: недопустимый байт внутри строки
        assert_eq!(parsed_bytes(b"{\"Actions\":\"\xFF\"}"), not_utf8);
    }

    // ----- read_manifest: элементы и поля действия (М27 - М86) -----

    #[test]
    fn an_action_that_is_not_an_object_is_refused_at_the_first_such_element() {
        for text in [
            r#"{"Actions":[5]}"#,
            r#"{"Actions":[null]}"#,
            r#"{"Actions":["x"]}"#,
            r#"{"Actions":[[]]}"#,
            r#"{"Actions":[{"Type":"Delete"},7]}"#,
        ] {
            assert_eq!(parsed_text(text), INVALID, "{text}");
        }
    }

    #[test]
    fn the_type_is_a_word_or_a_number_from_zero_to_two() {
        let kind = |value: &str| one_action(&format!(r#""Type":{value},"TargetPath":"t""#));
        let ok = |name: &str| {
            format!(r#"Ok, действий 1: {name} target="t" source="" size=0 sha=None whole=false"#)
        };
        // М32-М33: нет Type или null
        assert_eq!(one_action(r#""TargetPath":"t""#), INVALID);
        assert_eq!(kind("null"), INVALID);
        // М35-М38: слова без учёта регистра ASCII
        for (word, name) in [
            ("Replace", "Replace"),
            ("REPLACE", "Replace"),
            ("ImPoRt", "Import"),
            ("delete", "Delete"),
        ] {
            assert_eq!(kind(&format!("\"{word}\"")), ok(name), "{word}");
        }
        // М45-М47: числа 0, 1, 2
        for (number, name) in [("0", "Replace"), ("1", "Import"), ("2", "Delete")] {
            assert_eq!(kind(number), ok(name), "{number}");
        }
        // М48-М55: остальные числа и типы - отказ описи
        for bad in [
            "3",
            "-1",
            "1.0",
            "1e0",
            "18446744073709551615",
            "true",
            "[]",
            "{}",
        ] {
            assert_eq!(kind(bad), INVALID, "{bad}");
        }
    }

    #[test]
    fn an_unknown_type_word_is_named_in_lower_ascii_without_trimming() {
        let refused = |word: &str, shown: &str| {
            assert_eq!(
                one_action(&format!(r#""Type":"{word}","TargetPath":"t""#)),
                format!(
                    "Err InvalidDataException|RPF patch has an unsupported action type: {shown}"
                ),
                "{word:?}"
            );
        };
        refused("", ""); // М34
        refused(" Replace", " replace"); // М39
        refused("Replace ", "replace "); // М40
        refused("Teleport", "teleport"); // М41
        refused("Upsert", "upsert"); // М42
        refused("Замена", "Замена"); // М43
        refused("\u{130}MPORT", "\u{130}mport"); // М44: турецкая İ
    }

    #[test]
    fn paths_are_strings_as_they_are_or_empty() {
        let target = |value: &str| one_action(&format!(r#""Type":"Delete","TargetPath":{value}"#));
        // М56-М60
        for odd in ["5", "null", r#"["a"]"#, r#""""#] {
            assert_eq!(target(odd), delete_of(""), "{odd}");
        }
        assert_eq!(target(r#""  update:/a  ""#), delete_of("  update:/a  "));
        // М61-М62
        let import =
            |fields: &str| one_action(&format!(r#""Type":"Import","TargetPath":"t"{fields}"#));
        let expected = r#"Ok, действий 1: Import target="t" source="" size=0 sha=None whole=false"#;
        assert_eq!(import(""), expected);
        assert_eq!(import(r#","SourcePath":5"#), expected);
    }

    #[test]
    fn the_size_is_read_softly() {
        let size = |value: &str| {
            one_action(&format!(
                r#""Type":"Delete","TargetPath":"t","Size":{value}"#
            ))
        };
        let ok = |expected: &str| {
            format!(
                r#"Ok, действий 1: Delete target="t" source="" size={expected} sha=None whole=false"#
            )
        };
        let table = [
            ("5", "5"),
            ("5.9", "5"),
            ("0", "0"),
            ("-5", "0"),
            ("-0.5", "0"),
            ("\"5\"", "0"),
            ("null", "0"),
            ("true", "0"),
            ("1e3", "1000"),
            ("1e30", "18446744073709551615"),
            ("18446744073709551615", "18446744073709551615"),
            ("18446744073709551616", "18446744073709551615"),
            ("9007199254740993", "9007199254740993"),
        ];
        for (given, shown) in table {
            assert_eq!(size(given), ok(shown), "{given}");
        }
    }

    #[test]
    fn the_hash_keeps_its_spaces_and_blank_or_foreign_values_mean_none() {
        let sha = |value: &str| {
            one_action(&format!(
                r#""Type":"Delete","TargetPath":"t","Sha256":{value}"#
            ))
        };
        let ok = |expected: &str| {
            format!(
                r#"Ok, действий 1: Delete target="t" source="" size=0 sha={expected} whole=false"#
            )
        };
        for none in [r#""""#, r#""   ""#, "5", "null"] {
            assert_eq!(sha(none), ok("None"), "{none}");
        }
        assert_eq!(sha(r#"" abc ""#), ok(r#"Some(" abc ")"#));
        assert_eq!(sha(r#""ABC""#), ok(r#"Some("ABC")"#));
    }

    #[test]
    fn the_whole_nested_flag_is_a_real_boolean_or_false() {
        let flag = |value: &str| {
            one_action(&format!(
                r#""Type":"Delete","TargetPath":"t","IsWholeReplaceNestedRpf":{value}"#
            ))
        };
        let ok = |expected: bool| {
            format!(
                r#"Ok, действий 1: Delete target="t" source="" size=0 sha=None whole={expected}"#
            )
        };
        assert_eq!(flag("true"), ok(true));
        for other in [r#""true""#, "1", "null", "false"] {
            assert_eq!(flag(other), ok(false), "{other}");
        }
    }

    #[test]
    fn the_order_of_the_actions_is_the_order_of_the_file() {
        // М86
        assert_eq!(
            parsed_text(
                r#"{"Actions":[{"Type":"Import","TargetPath":"b"},{"Type":"Delete","TargetPath":"a"},{"Type":"Replace","TargetPath":"c"}]}"#
            ),
            concat!(
                "Ok, действий 3: ",
                r#"Import target="b" source="" size=0 sha=None whole=false; "#,
                r#"Delete target="a" source="" size=0 sha=None whole=false; "#,
                r#"Replace target="c" source="" size=0 sha=None whole=false"#
            )
        );
    }

    // ----- validate (П1 - П65) -----

    /// Итог `validate` без пути папки: `Ok, archives=[..], actions=N` или `Err код|текст`.
    fn show_validation(outcome: Result<Validation>) -> String {
        match outcome {
            Err(error) => format!("Err {}|{}", error.code, error.message),
            Ok(done) => format!("Ok, archives={:?}, actions={}", done.archives, done.actions),
        }
    }

    fn verdict(manifest: &str, files: &[(&str, &[u8])]) -> String {
        let dir = patch_with(manifest.as_bytes(), files);
        show_validation(validate(dir.path(), None))
    }

    /// Описью служат действия вида «Delete» и «Replace» с данными целями.
    fn deletes(targets: &[&str]) -> String {
        let actions: Vec<String> = targets
            .iter()
            .map(|target| format!(r#"{{"Type":"Delete","TargetPath":{}}}"#, json_text(target)))
            .collect();
        format!(r#"{{"Actions":[{}]}}"#, actions.join(","))
    }

    fn json_text(text: &str) -> String {
        serde_json::to_string(text).unwrap()
    }

    fn ok_for(archives: &[&str], actions: usize) -> String {
        format!("Ok, archives={archives:?}, actions={actions}")
    }

    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn replace_with(fields: &str) -> String {
        format!(r#"{{"Actions":[{{"Type":"Replace","TargetPath":"update:/x",{fields}}}]}}"#)
    }

    #[test]
    fn nothing_to_do_and_no_manifest_are_refused() {
        // П1, П6
        for text in ["{}", r#"{"Actions":[]}"#] {
            assert_eq!(
                verdict(text, &[]),
                "Err InvalidDataException|RPF patch has no actions."
            );
        }
        // П2, П3
        let dir = tempdir().unwrap();
        let not_found = "Err FileNotFoundException|RPF patch manifest.json was not found.";
        assert_eq!(show_validation(validate(dir.path(), None)), not_found);
        assert_eq!(
            show_validation(validate(&dir.path().join("none"), None)),
            not_found
        );
        // П4, П5
        for blank in ["", "   "] {
            assert_eq!(
                show_validation(validate(Path::new(blank), None)),
                "Err ArgumentException|The path is empty."
            );
        }
    }

    #[test]
    fn a_good_patch_lists_its_archives_sorted_and_deduplicated() {
        let manifest = format!(
            r#"{{"Actions":[
                {{"Type":"Replace","TargetPath":"update:/x64/a.xml","SourcePath":"payload/a","Size":3,"Sha256":"{}"}},
                {{"Type":"Import","TargetPath":"common:/data/b.xml","SourcePath":"payload/b"}},
                {{"Type":"Delete","TargetPath":"UPDATE:/old.xml"}}
            ]}}"#,
            ABC_SHA.to_uppercase()
        );
        let files: [(&str, &[u8]); 2] = [("payload/a", b"abc"), ("payload/b", b"bee")];
        // П7
        let dir = patch_with(manifest.as_bytes(), &files);
        let done = validate(dir.path(), None).ok().unwrap();
        assert_eq!(done.archives, ["common.rpf", "update/update.rpf"]);
        assert_eq!(done.actions, 3);
        assert_eq!(done.manifest.actions.len(), 3);
        assert_eq!(
            done.patch_directory,
            paths::full_path(&dir.path().to_string_lossy()).unwrap()
        );
        // П8: с папкой игры (существует лишь по тексту)
        let with_game = show_validation(validate(dir.path(), Some(Path::new("C:\\Games\\GTA V"))));
        assert_eq!(with_game, ok_for(&["common.rpf", "update/update.rpf"], 3));
        // П9: папка игры пуста
        assert_eq!(
            show_validation(validate(dir.path(), Some(Path::new("")))),
            "Err ArgumentException|The path is empty."
        );
    }

    #[test]
    fn the_payload_is_checked_for_presence_size_and_hash_in_that_order() {
        let a: [(&str, &[u8]); 1] = [("payload/a", b"abc")];
        assert_eq!(sha256_hex(b"abc"), ABC_SHA);
        let source = r#""SourcePath":"payload/a""#;
        let refused = |code: &str, message: &str| format!("Err {code}|{message}");
        let update = ok_for(&["update/update.rpf"], 1);

        // П10, П11: файла нет, источник - каталог
        assert_eq!(
            verdict(&replace_with(source), &[]),
            refused(
                "FileNotFoundException",
                "Patch payload is missing: payload/a"
            )
        );
        assert_eq!(
            verdict(
                &replace_with(r#""SourcePath":"payload""#),
                &[("payload/a", b"abc")]
            ),
            refused("FileNotFoundException", "Patch payload is missing: payload")
        );
        // П12, П13: размер; ноль не проверяется
        assert_eq!(
            verdict(&replace_with(&format!(r#"{source},"Size":9"#)), &a),
            refused("InvalidDataException", "Patch size mismatch: payload/a")
        );
        assert_eq!(
            verdict(&replace_with(&format!(r#"{source},"Size":0"#)), &a),
            update
        );
        // П14-П17: отпечаток
        let sha = |value: &str| replace_with(&format!(r#"{source},"Sha256":"{value}""#));
        assert_eq!(
            verdict(&sha("00"), &a),
            refused("InvalidDataException", "Patch checksum mismatch: payload/a")
        );
        assert_eq!(verdict(&sha(ABC_SHA), &a), update);
        assert_eq!(
            verdict(&sha(&format!(" {ABC_SHA} ")), &a),
            refused("InvalidDataException", "Patch checksum mismatch: payload/a")
        );
        assert_eq!(verdict(&sha("   "), &a), update);
        // П18: размер раньше отпечатка
        assert_eq!(
            verdict(
                &replace_with(&format!(r#"{source},"Size":9,"Sha256":"00""#)),
                &a
            ),
            refused("InvalidDataException", "Patch size mismatch: payload/a")
        );
        // П19, П63: первое неисправное действие побеждает
        let two = r#"{"Actions":[
                {"Type":"Replace","TargetPath":"update:/x","SourcePath":"payload/none"},
                {"Type":"Replace","TargetPath":"update:/y","SourcePath":"payload/a","Sha256":"00"}
            ]}"#;
        assert_eq!(
            verdict(two, &a),
            refused(
                "FileNotFoundException",
                "Patch payload is missing: payload/none"
            )
        );
    }

    #[test]
    fn the_source_path_must_stay_inside_the_patch_folder() {
        let a: [(&str, &[u8]); 1] = [("payload/a", b"abc")];
        let import = |source: &str| {
            format!(
                r#"{{"Actions":[{{"Type":"Import","TargetPath":"update:/x","SourcePath":{}}}]}}"#,
                json_text(source)
            )
        };
        let unsafe_path =
            |value: &str| format!("Err InvalidDataException|Unsafe relative path: {value}");
        let update = ok_for(&["update/update.rpf"], 1);
        // П21, П22: ведущий слэш и обратная косая допустимы
        assert_eq!(verdict(&import("/payload/a"), &a), update);
        assert_eq!(verdict(&import(r"payload\a"), &a), update);
        // П20, П23-П27, П29
        for bad in [
            "../a",
            "C:/x",
            "c:x",
            "a//b",
            "./payload/a",
            "",
            "payload/a/",
        ] {
            assert_eq!(verdict(&import(bad), &a), unsafe_path(bad), "{bad:?}");
        }
        // П28: звено «буква и двоеточие» в середине выводит за корень
        assert_eq!(
            verdict(&import("a/C:/b"), &a),
            "Err InvalidDataException|Path escapes its allowed directory: a/C:/b"
        );
        // П30: у Delete источник не проверяется, даже мусорный
        let garbage = r#"{"Actions":[{"Type":"Delete","TargetPath":"update:/x","SourcePath":"../..//","Size":9,"Sha256":"zz"}]}"#;
        assert_eq!(verdict(garbage, &[]), update);
    }

    #[test]
    fn the_root_archive_comes_from_the_target() {
        // П31-П57
        let table: [(&str, Option<&str>); 29] = [
            ("update:/x", Some("update/update.rpf")),
            ("UPDATE:/x", Some("update/update.rpf")),
            ("common:/x", Some("common.rpf")),
            ("COMMON:/x", Some("common.rpf")),
            ("x64/data/a", Some("update/update.rpf")),
            ("x64a:/data/a", Some("x64a.rpf")),
            ("X64A:/data/a", Some("X64A.rpf")),
            ("dlcpacks:/mine/x", Some("dlcpacks.rpf")),
            ("setup2.xml", None),
            ("ASSEMBLY.XML", None),
            ("update:\\x\\y", Some("update/update.rpf")),
            (" update:/x ", Some("update/update.rpf")),
            ("", Some("update/update.rpf")),
            (":/x", Some("update/update.rpf")),
            ("a b:/x", Some("a b.rpf")),
            ("C:/x", Some("C.rpf")),
            ("/x:/y", Some("x.rpf")),
            ("sub/dlc:/y", Some("sub/dlc.rpf")),
            ("a:b:c", Some("a.rpf")),
            ("common:x", Some("common.rpf")),
            ("update:x", Some("update/update.rpf")),
            ("Update:", Some("update/update.rpf")),
            ("x64a:", Some("x64a.rpf")),
            ("  setup2.xml  ", None),
            ("setup2.xml/x", Some("update/update.rpf")),
            ("x\\y:/z", Some("x/y.rpf")),
            ("x64z:/data", Some("x64z.rpf")),
            ("\\\\x:/y", Some("x.rpf")),
            ("sub\\dlc:\\y", Some("sub/dlc.rpf")),
        ];
        for (target, expected) in table {
            let shown = match expected {
                Some(archive) => ok_for(&[archive], 1),
                None => ok_for(&[], 1),
            };
            assert_eq!(verdict(&deletes(&[target]), &[]), shown, "{target:?}");
        }
        // П45, П62: ошибка нормализации имени - отказ сразу
        assert_eq!(
            verdict(&deletes(&["a/../b:/x"]), &[]),
            "Err InvalidDataException|Unsafe relative path: a/../b.rpf"
        );
        let broken_first = r#"{"Actions":[{"Type":"Replace","TargetPath":"a/../b:/x","SourcePath":"payload/none"}]}"#;
        assert_eq!(
            verdict(broken_first, &[]),
            "Err InvalidDataException|Unsafe relative path: a/../b.rpf"
        );
    }

    #[test]
    fn archives_are_sorted_by_upper_case_and_the_first_spelling_stays() {
        // П58: сравнение по заглавным буквам, «_» после цифр и букв
        assert_eq!(
            verdict(&deletes(&["a_b:/x", "ab:/x", "Ab2:/x"]), &[]),
            ok_for(&["ab.rpf", "Ab2.rpf", "a_b.rpf"], 3)
        );
        // П59: дубли по регистру ASCII склеиваются, остаётся первое написание
        assert_eq!(
            verdict(
                &deletes(&["X64A:/a", "common:/b", "x64a:/c", "COMMON:/d"]),
                &[]
            ),
            ok_for(&["common.rpf", "X64A.rpf"], 4)
        );
        // П60
        assert_eq!(
            verdict(
                &deletes(&["update:/a", "common:/b", "x64a:/c", "x/d", "setup2.xml"]),
                &[]
            ),
            ok_for(&["common.rpf", "update/update.rpf", "x64a.rpf"], 5)
        );
        // П61: ни у одной цели нет корневого архива, действия всё равно считаются
        assert_eq!(
            verdict(&deletes(&["setup2.xml", "assembly.xml"]), &[]),
            ok_for(&[], 2)
        );
        // П64: тип числом
        let numbers = r#"{"Actions":[
            {"Type":0,"TargetPath":"common:/x","SourcePath":"payload/a"},
            {"Type":1,"TargetPath":"update:/x","SourcePath":"payload/a"},
            {"Type":2,"TargetPath":"x64b:/x"}]}"#;
        assert_eq!(
            verdict(numbers, &[("payload/a", b"abc")]),
            ok_for(&["common.rpf", "update/update.rpf", "x64b.rpf"], 3)
        );
        // П65: не-ASCII регистр дубли не склеивает
        assert_eq!(
            verdict(&deletes(&["\u{c4}:/x", "\u{e4}:/y"]), &[]),
            ok_for(&["\u{c4}.rpf", "\u{e4}.rpf"], 2)
        );
    }

    // ----- команда validate-rpf-patch -----

    fn options(args: &[&str]) -> Options {
        let owned: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        Options::parse(&owned).unwrap()
    }

    #[test]
    fn the_command_answers_with_three_fields_in_this_order() {
        let manifest = br#"{"Actions":[
            {"Type":"Replace","TargetPath":"update:/x64/a.xml","SourcePath":"payload/a","Size":3},
            {"Type":"Delete","TargetPath":"common:/old"}]}"#;
        let dir = patch_with(manifest, &[("payload/a", b"abc")]);
        let patch = dir.path().to_string_lossy().into_owned();
        let answer =
            validate_rpf_patch(&options(&["--patch", &patch]), &Progress::silent()).unwrap();
        let full = paths::full_path(&patch)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let expected = serde_json::json!({
            "patchDirectory": full,
            "archives": ["common.rpf", "update/update.rpf"],
            "actions": 2,
        });
        assert_eq!(answer.to_string(), expected.to_string());
        // имя параметра без учёта регистра; прочие параметры команда не использует
        let again = validate_rpf_patch(
            &options(&[
                "--PATCH",
                &patch,
                "--game-root",
                "Z:\\nowhere",
                "--keys",
                "k",
            ]),
            &Progress::silent(),
        )
        .unwrap();
        assert_eq!(again.to_string(), expected.to_string());
    }

    #[test]
    fn the_command_refuses_a_missing_blank_or_unknown_patch_folder() {
        let refused = |args: &[&str]| {
            let error = validate_rpf_patch(&options(args), &Progress::silent()).unwrap_err();
            (error.code, error.message)
        };
        let argument = |message: &str| ("ArgumentException".to_owned(), message.to_owned());
        assert_eq!(refused(&[]), argument("--patch is required."));
        assert_eq!(refused(&["--patch", ""]), argument("The path is empty."));
        assert_eq!(refused(&["--patch", "   "]), argument("The path is empty."));
        let dir = tempdir().unwrap();
        let missing = dir.path().join("missing").to_string_lossy().into_owned();
        assert_eq!(
            refused(&["--patch", &missing]),
            (
                "FileNotFoundException".to_owned(),
                "RPF patch manifest.json was not found.".to_owned()
            )
        );
        // отказ описи с неверным отпечатком (v1-bad-sha)
        let manifest = br#"{"Actions":[{"Type":"Replace","TargetPath":"update:/x","SourcePath":"payload/a_new.xml","Sha256":"00"}]}"#;
        let bad = patch_with(manifest, &[("payload/a_new.xml", b"abc")]);
        assert_eq!(
            refused(&["--patch", &bad.path().to_string_lossy()]),
            (
                "InvalidDataException".to_owned(),
                "Patch checksum mismatch: payload/a_new.xml".to_owned()
            )
        );
    }

    #[test]
    fn a_relative_patch_path_is_taken_from_the_current_folder() {
        // paths::full_path достраивает путь от рабочей папки: отказ называет именно её папку
        let relative = ".";
        match validate(Path::new(relative), None) {
            Err(error) => assert_eq!(error.message, "RPF patch manifest.json was not found."),
            Ok(done) => assert_eq!(done.patch_directory, std::env::current_dir().unwrap()),
        }
    }
}
