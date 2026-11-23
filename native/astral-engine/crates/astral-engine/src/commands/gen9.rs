//! `convert-gen9`: словари текстур `.ytd` формата Legacy (версия 13) → gen9 (версия 5).
//!
//! Перевод делает `rage_res::ytd_gen9`; здесь запрос, порядок проверок, запись
//! файлов и ответ. Всё, что движок пока не умеет (модели, чужие и битые файлы),
//! отдаётся хосту отказом со словами «пока на хосте».

use std::fs;
use std::path::{Path, PathBuf};

use rage_res::resource::{read_header, VERSION_YTD, VERSION_YTD_ENHANCED};
use rage_res::{hash, ytd_gen9};
use serde_json::Value;

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Пределы запроса и входов.
mod limit {
    use std::ops::RangeInclusive;

    pub const REQUEST_BYTES: u64 = 1024 * 1024;
    pub const DICTIONARY_BYTES: u64 = 256 * 1024 * 1024;
    pub const FILES: RangeInclusive<usize> = 1..=4000;
}

/// Названия формата запроса и ответа.
mod wire {
    pub const REQUEST: &str = "astral.convert-gen9";
    pub const ANSWER: &str = "astral.gen9";
    pub const VERSION: u64 = 1;
}

pub const COMMANDS: &[Command] = &[Command::new("convert-gen9", convert_gen9)];

/// Отказы команды с их текстами; все идут кодом `InvalidDataException`.
enum Reject {
    RequestSize,
    Unreadable,
    UnknownFormat,
    NoFileList,
    FileCount,
    SameFile,
    /// Файл не наш: по этим словам приложение возвращается к хосту.
    HostOnly(String),
    /// Вход пуст или больше 256 МиБ.
    DictionarySize(String),
}

impl Reject {
    fn words(&self) -> String {
        match self {
            Reject::RequestSize => "convert-gen9: запрос от 1 байта до 1 МиБ.".to_owned(),
            Reject::Unreadable => "convert-gen9: запрос не читается.".to_owned(),
            Reject::UnknownFormat => {
                "convert-gen9: неизвестный формат или версия запроса.".to_owned()
            }
            Reject::NoFileList => "convert-gen9: нет списка файлов.".to_owned(),
            Reject::FileCount => "convert-gen9: нужно от 1 до 4000 файлов.".to_owned(),
            Reject::SameFile => "convert-gen9: выход должен отличаться от входа.".to_owned(),
            Reject::HostOnly(name) => format!(
                "convert-gen9: {name} пока на хосте (движок переводит словари текстур .ytd)."
            ),
            Reject::DictionarySize(name) => {
                format!("convert-gen9: {name} пуст или больше 256 МиБ.")
            }
        }
    }
}

impl From<Reject> for EngineError {
    fn from(reject: Reject) -> Self {
        EngineError::invalid_data(reject.words())
    }
}

/// Объект JSON из пар «ключ, значение» в порядке записи.
fn table<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Последнее звено пути, как оно записано.
fn leaf(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
}

/// Список `files` из запроса: файл запроса читается и проверяется целиком.
fn read_file_list(request: &Path) -> Result<Vec<Value>> {
    if !(1..=limit::REQUEST_BYTES).contains(&fs::metadata(request)?.len()) {
        return Err(Reject::RequestSize.into());
    }
    let mut root: Value =
        serde_json::from_slice(&fs::read(request)?).map_err(|_| Reject::Unreadable)?;
    let stamped = matches!(
        (root.get("format"), root.get("version")),
        (Some(Value::String(format)), Some(version))
            if format == wire::REQUEST && version.as_u64() == Some(wire::VERSION)
    );
    if !stamped {
        return Err(Reject::UnknownFormat.into());
    }
    match root.get_mut("files").map(Value::take) {
        Some(Value::Array(files)) if limit::FILES.contains(&files.len()) => Ok(files),
        Some(Value::Array(_)) => Err(Reject::FileCount.into()),
        _ => Err(Reject::NoFileList.into()),
    }
}

/// Один и тот же существующий файл под разным написанием пути: регистр букв на Windows, ссылки.
/// Прежняя проверка сравнивала только строки путей, и `VICTIM.YTD` рядом с `victim.ytd` молча заменял вход.
fn is_same_file(first: &Path, second: &Path) -> bool {
    match (fs::canonicalize(first), fs::canonicalize(second)) {
        (Ok(first), Ok(second)) => first == second,
        _ => false,
    }
}

/// Пути одного элемента списка (вход, выход), проверенные до чтения содержимого.
/// Не-строка (и всё, что не объект) читается как пустая строка.
fn entry_paths(entry: &Value) -> Result<(PathBuf, PathBuf)> {
    let text = |key: &str| entry.get(key).and_then(Value::as_str).unwrap_or_default();
    let input = paths::existing_file(text("input"), &[])?;
    let output = paths::full_path(text("output"))?;
    let same = output == input || is_same_file(&input, &output);
    match (output.is_absolute(), same) {
        (false, _) => Err(EngineError::argument("Helper paths must be absolute.")),
        (true, true) => Err(Reject::SameFile.into()),
        (true, false) => Ok((input, output)),
    }
}

/// Расширение входа — `ytd`, иначе файл не наш.
fn is_dictionary_name(path: &Path) -> bool {
    matches!(path.extension(), Some(extension) if extension.eq_ignore_ascii_case("ytd"))
}

/// Готовый словарь gen9 и признак «пересобран из Legacy».
fn gen9_bytes(source: Vec<u8>, name: &str) -> Result<(Vec<u8>, bool)> {
    let host_only = || EngineError::from(Reject::HostOnly(name.to_owned()));
    let Ok(header) = read_header(&source) else {
        return Err(host_only());
    };
    match header.version {
        VERSION_YTD_ENHANCED => Ok((source, false)),
        VERSION_YTD => ytd_gen9::convert(&source)
            .map(|bytes| (bytes, true))
            .map_err(|_| host_only()),
        _ => Err(host_only()),
    }
}

/// Один элемент списка от проверки путей до записи; возвращает запись ответа.
fn convert_one(entry: &Value) -> Result<Value> {
    let (input, output) = entry_paths(entry)?;
    let name = leaf(&input);
    if !is_dictionary_name(&input) {
        return Err(Reject::HostOnly(name).into());
    }
    if !(1..=limit::DICTIONARY_BYTES).contains(&fs::metadata(&input)?.len()) {
        return Err(Reject::DictionarySize(name).into());
    }
    let (bytes, converted) = gen9_bytes(fs::read(&input)?, &name)?;
    ytd_gen9::check(&bytes)?;
    write_atomic(&output, &bytes)?;

    Ok(table([
        ("file", Value::from(leaf(&output))),
        ("converted", Value::from(converted)),
        ("bytes", Value::from(bytes.len())),
        ("sha256", Value::from(hash::sha256_hex(&bytes))),
    ]))
}

fn convert_gen9(options: &Options, _: &Progress) -> Result<Value> {
    let request = options
        .required("input")
        .and_then(|text| paths::existing_file(text, &[".json"]))?;
    // Файлы идут строго по очереди: записанное до отказа остаётся на диске.
    let records = read_file_list(&request)?
        .iter()
        .map(convert_one)
        .collect::<Result<Vec<_>>>()?;
    Ok(table([
        ("format", Value::from(wire::ANSWER)),
        ("version", Value::from(wire::VERSION)),
        ("files", Value::Array(records)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use rage_res::resource::Resource;
    use rage_res::texture::Format;
    use rage_res::ytd_write::{payload_bytes, write, NewTexture};
    use serde_json::json;

    struct Bench {
        dir: tempfile::TempDir,
    }

    fn texture(name: &str, side: u16, format: Format, levels: u8, fill: u8) -> NewTexture {
        let size = usize::from(side);
        NewTexture {
            name: name.into(),
            width: side,
            height: side,
            format,
            levels,
            payload: vec![fill; payload_bytes(format, size, size, usize::from(levels))],
        }
    }

    /// Словарь Legacy без текстур: писатель такой не строит, поэтому у словаря из одной
    /// текстуры обнуляется счётчик корня (слово +0x38).
    fn empty_legacy() -> Vec<u8> {
        let one = write(&[texture("only", 4, Format::A8R8G8B8, 1, 1)]).unwrap();
        let mut resource = Resource::parse(&one).unwrap();
        let root = resource.root().unwrap();
        resource.data_mut()[root + 0x38..root + 0x3a].copy_from_slice(&0u16.to_le_bytes());
        resource.to_file_bytes().unwrap()
    }

    fn legacy_three() -> Vec<u8> {
        write(&[
            texture("cj_white", 32, Format::Dxt1, 6, 7),
            texture("script_rt_one", 16, Format::Dxt5, 5, 9),
            texture("normal_flat", 4, Format::A8R8G8B8, 1, 3),
        ])
        .unwrap()
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, name: &str) -> String {
            self.dir.path().join(name).to_string_lossy().into_owned()
        }

        fn put(&self, name: &str, body: &[u8]) -> String {
            let path = self.dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, body).unwrap();
            path.to_string_lossy().into_owned()
        }

        /// Запрос со списком пар `(вход, выход)` и запуск команды.
        fn convert(&self, pairs: &[(&str, &str)]) -> (Value, i32) {
            let entries: Vec<Value> = pairs
                .iter()
                .map(|(input, output)| json!({ "input": input, "output": output }))
                .collect();
            let body = json!({ "format": "astral.convert-gen9", "version": 1, "files": entries });
            self.raw(&body.to_string())
        }

        fn raw(&self, body: &str) -> (Value, i32) {
            let request = self.put("request.json", body.as_bytes());
            self.exec(&["--input", &request])
        }

        fn exec(&self, args: &[&str]) -> (Value, i32) {
            let mut argv = vec!["convert-gen9".to_owned()];
            argv.extend(args.iter().map(|arg| (*arg).to_owned()));
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }
    }

    fn refused(code: &str, message: &str) -> (Value, i32) {
        (
            json!({ "ok": false, "error": { "code": code, "message": message } }),
            1,
        )
    }

    fn invalid_data(message: &str) -> (Value, i32) {
        refused("InvalidDataException", message)
    }

    fn host(name: &str) -> (Value, i32) {
        invalid_data(&format!(
            "convert-gen9: {name} пока на хосте (движок переводит словари текстур .ytd)."
        ))
    }

    fn files_of(reply: &(Value, i32)) -> &Vec<Value> {
        assert_eq!(reply.1, 0, "{}", reply.0);
        reply.0["result"]["files"].as_array().unwrap()
    }

    #[test]
    fn an_empty_legacy_dictionary_becomes_the_documented_50_bytes() {
        let bench = Bench::new();
        let input = bench.put("one-empty-dictionary.ytd", &empty_legacy());
        let output = bench.path("out.ytd");
        let reply = bench.convert(&[(&input, &output)]);
        assert_eq!(
            reply.0["result"],
            json!({
                "format": "astral.gen9",
                "version": 1,
                "files": [{
                    "file": "out.ytd",
                    "converted": true,
                    "bytes": 50,
                    "sha256": "23a940cfe7237df5a7d6bfcf42d9f10b360f9913e3b9b54c244ef265d78af610"
                }]
            })
        );
        let written = std::fs::read(&output).unwrap();
        assert_eq!(written.len(), 50);
        assert_eq!(&written[..8], [0x52, 0x53, 0x43, 0x37, 5, 0, 0, 0]);
    }

    #[test]
    fn a_legacy_dictionary_is_converted_by_the_neighbour_and_a_gen9_one_is_copied() {
        let bench = Bench::new();
        let legacy = legacy_three();
        let input = bench.put("three.ytd", &legacy);
        let first = bench.path("chain1.ytd");
        let second = bench.path("chain2.ytd");
        let third = bench.path("chain3.ytd");
        let reply = bench.convert(&[(&input, &first), (&first, &second), (&input, &third)]);
        let files = files_of(&reply);
        assert_eq!(files.len(), 3);
        let expected = rage_res::ytd_gen9::convert(&legacy).unwrap();
        let sha = rage_res::hash::sha256_hex(&expected);
        for (record, flag, name) in [
            (&files[0], true, "chain1.ytd"),
            (&files[1], false, "chain2.ytd"),
            (&files[2], true, "chain3.ytd"),
        ] {
            assert_eq!(
                record,
                &json!({ "file": name, "converted": flag, "bytes": expected.len(), "sha256": sha })
            );
        }
        for path in [&first, &second, &third] {
            assert_eq!(std::fs::read(path).unwrap(), expected);
            assert!(!Path::new(&format!("{path}.shop-stage")).exists());
        }
    }

    #[test]
    fn the_answer_line_has_keys_in_the_documented_order() {
        let bench = Bench::new();
        let input = bench.put("a.ytd", &legacy_three());
        let output = bench.path("one-three.ytd");
        let request = bench.put(
            "r.json",
            json!({ "format": "astral.convert-gen9", "version": 1, "files": [{ "input": input, "output": output }] })
                .to_string()
                .as_bytes(),
        );
        let outcome = run(
            &[
                "convert-gen9",
                "--input",
                &request,
                "--output",
                "ignored.ytd",
            ]
            .map(str::to_owned),
            &Progress::silent(),
        );
        let written = std::fs::read(&output).unwrap();
        let expected = format!(
            r#"{{"ok":true,"command":"convert-gen9","result":{{"format":"astral.gen9","version":1,"files":[{{"file":"one-three.ytd","converted":true,"bytes":{},"sha256":"{}"}}]}}}}"#,
            written.len(),
            rage_res::hash::sha256_hex(&written)
        );
        assert_eq!(outcome.line, expected);
        assert_eq!(outcome.exit_code, 0);
    }

    #[test]
    fn request_level_refusals_in_the_documented_order() {
        let bench = Bench::new();
        let argument = |message: &str| refused("ArgumentException", message);
        assert_eq!(bench.exec(&[]), argument("--input is required."));
        let none = bench.path("none.json");
        assert_eq!(
            bench.exec(&["--input", &none]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {none}")
            )
        );
        let ytd = bench.put("single.ytd", b"x");
        assert_eq!(
            bench.exec(&["--input", &ytd]),
            argument("Unsupported file extension: .ytd")
        );
        assert_eq!(bench.exec(&["--input", ""]), argument("The path is empty."));

        let call = |name: &str, body: &[u8]| {
            let request = bench.put(name, body);
            bench.exec(&["--input", &request])
        };
        let size = invalid_data("convert-gen9: запрос от 1 байта до 1 МиБ.");
        assert_eq!(call("zero.json", b""), size);
        assert_eq!(call("over.json", &vec![b' '; 1024 * 1024 + 1]), size);
        let broken = invalid_data("convert-gen9: запрос не читается.");
        assert_eq!(call("bad.json", b"not json"), broken);
        assert_eq!(call("bom.json", b"\xEF\xBB\xBF{}"), broken);
        assert_eq!(call("junk.json", b"{} junk"), broken);
        let unknown = invalid_data("convert-gen9: неизвестный формат или версия запроса.");
        for body in [
            "[]",
            "null",
            "{}",
            r#"{"format":"astral.convert-gen9","files":[]}"#,
            r#"{"format":"Astral.Convert-Gen9","version":1,"files":[]}"#,
            r#"{"format":"astral.convert-gen9","version":2,"files":[]}"#,
            r#"{"format":"astral.convert-gen9","version":"1","files":[]}"#,
            r#"{"format":"astral.convert-gen9","version":-1,"files":[]}"#,
            r#"{"format":"astral.convert-gen9","version":1.0,"files":[]}"#,
            r#"{"format":"astral.convert-gen9","version":1e0,"files":[]}"#,
        ] {
            assert_eq!(call("fmt.json", body.as_bytes()), unknown, "{body}");
        }
        let no_list = invalid_data("convert-gen9: нет списка файлов.");
        for tail in ["", r#","files":null"#, r#","files":{}"#, r#","files":"x""#] {
            let body = format!(r#"{{"format":"astral.convert-gen9","version":1{tail}}}"#);
            assert_eq!(call("list.json", body.as_bytes()), no_list, "{tail}");
        }
        let count = invalid_data("convert-gen9: нужно от 1 до 4000 файлов.");
        let many = |n: usize, item: &str| {
            let items = vec![item; n].join(",");
            format!(r#"{{"format":"astral.convert-gen9","version":1,"files":[{items}]}}"#)
        };
        assert_eq!(call("c0.json", many(0, "{}").as_bytes()), count);
        assert_eq!(call("c4001.json", many(4001, "{}").as_bytes()), count);
        assert_eq!(call("c4001n.json", many(4001, "5").as_bytes()), count);
        assert_eq!(
            call("c4000.json", many(4000, "{}").as_bytes()),
            argument("The path is empty.")
        );
    }

    #[test]
    fn entries_read_non_strings_as_empty_paths() {
        let bench = Bench::new();
        let empty = refused("ArgumentException", "The path is empty.");
        for entry in [
            "5",
            "null",
            "[]",
            "{}",
            r#"{"output":"x.ytd"}"#,
            r#"{"input":5,"output":"x.ytd"}"#,
            r#"{"input":null,"output":"x.ytd"}"#,
            r#"{"input":"","output":"x.ytd"}"#,
            r#"{"input":"   ","output":"x.ytd"}"#,
        ] {
            let body =
                format!(r#"{{"format":"astral.convert-gen9","version":1,"files":[{entry}]}}"#);
            assert_eq!(bench.raw(&body), empty, "{entry}");
        }
        // Вход проверяется раньше выхода.
        let input = bench.put("here.ytd", &legacy_three());
        let missing = bench.path("gone.ytd");
        assert_eq!(
            bench.convert(&[(&missing, "")]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {missing}")
            )
        );
        assert_eq!(bench.convert(&[(&input, "")]), empty);
        assert_eq!(bench.convert(&[(&input, "   ")]), empty);
        let folder = bench.path("");
        let folder = folder.trim_end_matches(['\\', '/']).to_owned();
        assert_eq!(
            bench.convert(&[(&folder, "")]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {folder}")
            )
        );
    }

    #[test]
    fn output_must_differ_from_input_even_when_spelled_in_another_case() {
        let bench = Bench::new();
        let input = bench.put("victim.ytd", &legacy_three());
        let different = invalid_data("convert-gen9: выход должен отличаться от входа.");
        assert_eq!(bench.convert(&[(&input, &input)]), different);
        let dotted = bench.path("sub/../victim.ytd");
        assert_eq!(bench.convert(&[(&input, &dotted)]), different);
        let upper = bench.path("VICTIM.YTD");
        let reply = bench.convert(&[(&input, &upper)]);
        if cfg!(windows) {
            // Один и тот же файл: прежний код заменял им входной словарь Legacy.
            assert_eq!(reply, different);
            assert_eq!(std::fs::read(&input).unwrap(), legacy_three());
        } else {
            assert_eq!(files_of(&reply)[0]["file"], "VICTIM.YTD");
        }
    }

    #[test]
    fn output_naming_folders_and_replacement() {
        let bench = Bench::new();
        let input = bench.put("src.ytd", &legacy_three());
        for name in ["no-extension", "other.bin", "Выход с пробелом.ytd"] {
            let reply = bench.convert(&[(&input, &bench.path(name))]);
            assert_eq!(files_of(&reply)[0]["file"], name, "{name}");
        }
        // Каталоги результата не создаются.
        let nested = bench.path("no/such/dir/out.ytd");
        let reply = bench.convert(&[(&input, &nested)]);
        assert_eq!(reply.1, 1);
        assert_eq!(reply.0["error"]["code"], "FileNotFoundException");
        // Существующий результат заменяется целиком; отказ не трогает его.
        let keep = bench.put("keep.ytd", b"hello world");
        let broken = bench.put("brand.ytd", b"garbage, not a resource at all");
        assert_eq!(bench.convert(&[(&broken, &keep)]), host("brand.ytd"));
        assert_eq!(std::fs::read(&keep).unwrap(), b"hello world");
        let reply = bench.convert(&[(&input, &keep)]);
        assert_eq!(reply.1, 0);
        assert_ne!(std::fs::read(&keep).unwrap(), b"hello world");
        // Результат-каталог: отказ системы, временного файла не остаётся.
        let adir = bench.path("folder-as-output.ytd");
        std::fs::create_dir(&adir).unwrap();
        let reply = bench.convert(&[(&input, &adir)]);
        assert_eq!(reply.0["error"]["code"], "UnauthorizedAccessException");
        assert!(Path::new(&adir).is_dir());
        assert!(!Path::new(&format!("{adir}.shop-stage")).exists());
    }

    #[test]
    fn files_are_processed_in_order_and_earlier_results_stay() {
        let bench = Bench::new();
        let good = bench.put("good.ytd", &legacy_three());
        let brand = bench.put("brand.ytd", b"not a dictionary");
        let first = bench.path("partial1.ytd");
        let second = bench.path("partial2.ytd");
        assert_eq!(
            bench.convert(&[(&good, &first), (&brand, &second)]),
            host("brand.ytd")
        );
        assert!(Path::new(&first).is_file());
        assert!(!Path::new(&second).exists());
        let missing = bench.path("none.ytd");
        let third = bench.path("partial3.ytd");
        let reply = bench.convert(&[(&good, &third), (&missing, &second)]);
        assert_eq!(reply.0["error"]["code"], "FileNotFoundException");
        assert!(Path::new(&third).is_file());
    }

    #[test]
    fn input_extension_size_and_content_rules() {
        let bench = Bench::new();
        let out = bench.path("o.ytd");
        let legacy = legacy_three();
        let upper = bench.put("up.YTD", &legacy);
        assert_eq!(
            files_of(&bench.convert(&[(&upper, &out)]))[0]["converted"],
            true
        );
        for (name, body) in [
            ("noext", legacy.clone()),
            ("model.ydr", legacy.clone()),
            (
                "really-ydr.ytd",
                b"RSC7ydr-content-not-a-dictionary-at-all".to_vec(),
            ),
            ("garbage.ytd", b"garbage garbage garbage garbage".to_vec()),
            ("short-header.ytd", b"RSC7".to_vec()),
            ("header-only.ytd", legacy[..16].to_vec()),
            ("truncated-body.ytd", legacy[..legacy.len() / 2].to_vec()),
        ] {
            let input = bench.put(name, &body);
            assert_eq!(bench.convert(&[(&input, &out)]), host(name), "{name}");
        }
        let spaced = bench.put("имя с пробелом.ytd", b"junk");
        assert_eq!(
            bench.convert(&[(&spaced, &out)]),
            host("имя с пробелом.ytd")
        );
        let zero = bench.put("empty.ytd", b"");
        assert_eq!(
            bench.convert(&[(&zero, &out)]),
            invalid_data("convert-gen9: empty.ytd пуст или больше 256 МиБ.")
        );
    }

    #[test]
    fn a_gen9_dictionary_is_checked_but_not_rebuilt() {
        let bench = Bench::new();
        let gen9 = rage_res::ytd_gen9::convert(&legacy_three()).unwrap();
        let out = bench.path("o.ytd");
        let whole = bench.put("gen9.ytd", &gen9);
        let reply = bench.convert(&[(&whole, &out)]);
        assert_eq!(files_of(&reply)[0]["converted"], false);
        assert_eq!(std::fs::read(&out).unwrap(), gen9);
        // Структурная проверка отказывает без слов «пока на хосте».
        let truncated = bench.put("gen9-cut.ytd", &gen9[..gen9.len() - 40]);
        let reply = bench.convert(&[(&truncated, &out)]);
        assert_eq!(reply.1, 1);
        assert_eq!(reply.0["error"]["code"], "InvalidOperationException");
        assert!(!reply.0["error"]["message"]
            .as_str()
            .unwrap()
            .contains("на хосте"));
        let header_only = bench.put("gen9-head.ytd", &gen9[..16]);
        let reply = bench.convert(&[(&header_only, &out)]);
        assert_eq!(reply.0["error"]["code"], "InvalidOperationException");
        // Изменённый байт данных проходит: проверяется структура, а не содержимое.
        let version_in_header = {
            let mut copy = legacy_three();
            copy[4] = 7;
            copy
        };
        let odd = bench.put("v7.ytd", &version_in_header);
        assert_eq!(
            files_of(&bench.convert(&[(&odd, &out)]))[0]["converted"],
            true
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_drive_relative_output_is_not_absolute() {
        let bench = Bench::new();
        let input = bench.put("src.ytd", &legacy_three());
        assert_eq!(
            bench.convert(&[(&input, "Z:rel-out.ytd")]),
            refused("ArgumentException", "Helper paths must be absolute.")
        );
    }

    #[test]
    fn a_wrong_expectation_is_caught() {
        // Отрицательный контроль: хэш пустого словаря не равен хэшу трёх текстур.
        let bench = Bench::new();
        let input = bench.put("t.ytd", &legacy_three());
        let reply = bench.convert(&[(&input, &bench.path("o.ytd"))]);
        assert_ne!(
            files_of(&reply)[0]["sha256"],
            "23a940cfe7237df5a7d6bfcf42d9f10b360f9913e3b9b54c244ef265d78af610"
        );
    }
}
