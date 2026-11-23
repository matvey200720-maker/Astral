//! `compile-manifest`: манифест контейнера `_manifest.ymf` из короткого запроса.
//!
//! Новый файл или слияние с уже существующим манифестом: карты контейнера и
//! типы, которые каждая карта использует. Раскладку байтов пишет
//! `rage_res::manifest_write`; здесь запрос, порядок отказов, запись и ответ.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use rage_res::manifest_write::{self as pso, Dependency, Kept};
use serde_json::Value;

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Пределы запроса: границы включены.
mod limits {
    pub const REQUEST_BYTES: (u64, u64) = (1, 64 * 1024);
    pub const BASE_BYTES: (u64, u64) = (1, 4 * 1024 * 1024);
    pub const MAPS: (usize, usize) = (1, 64);
    pub const TYPES: (usize, usize) = (1, 16);
    pub const NAME_BYTES: usize = 63;
}

/// Названия формата запроса и расширение, которого ждут от основы и выхода.
mod wire {
    pub const REQUEST: &str = "astral.compile-manifest";
    pub const VERSION: u64 = 1;
    pub const SUFFIX: &str = ".ymf";
}

const BASE_REFUSAL: &str = "Manifest base must be an existing .ymf file up to 4 MiB.";

pub const COMMANDS: &[Command] = &[Command::new("compile-manifest", compile_manifest)];

/// Объект JSON из пар «ключ, значение» в порядке записи.
fn table<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn in_range(count: usize, (low, high): (usize, usize)) -> bool {
    (low..=high).contains(&count)
}

/// Файл целиком, если его размер лежит в `(low, high)`.
fn read_within(path: &Path, (low, high): (u64, u64), refusal: &str) -> Result<Vec<u8>> {
    match fs::metadata(path)?.len() {
        size if (low..=high).contains(&size) => Ok(fs::read(path)?),
        _ => Err(EngineError::invalid_data(refusal)),
    }
}

/// Имя ассета: 1–63 байта, первый знак — строчная латинская буква или цифра,
/// дальше строчные буквы, цифры и `_`.
fn is_asset_name(name: &str) -> bool {
    (1..=limits::NAME_BYTES).contains(&name.len())
        && name.bytes().enumerate().all(|(position, byte)| match byte {
            b'a'..=b'z' | b'0'..=b'9' => true,
            b'_' => position > 0,
            _ => false,
        })
}

/// Запрос как JSON-значение: размер, разбор и формат проверяются в этом порядке.
fn read_root(path: &Path) -> Result<Value> {
    let bytes = read_within(
        path,
        limits::REQUEST_BYTES,
        "Manifest request must be between 1 byte and 64 KiB.",
    )?;
    let Ok(root) = serde_json::from_slice::<Value>(&bytes) else {
        return Err(EngineError::invalid_data(
            "Manifest request is empty or broken.",
        ));
    };
    let stamped = matches!(
        (root.get("format"), root.get("version")),
        (Some(Value::String(format)), Some(version))
            if format == wire::REQUEST && version.as_u64() == Some(wire::VERSION)
    );
    match stamped {
        true => Ok(root),
        false => Err(EngineError::invalid_data(
            "Manifest request has an unknown format.",
        )),
    }
}

/// Основа: нет поля, `null` или пустая строка — основы нет; непустая строка — путь
/// к существующему `.ymf`; всё остальное отказывает.
fn base_of(root: &Value) -> Result<Option<PathBuf>> {
    let Some(base) = root.get("base").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    match base {
        Value::String(text) if text.trim().is_empty() => Ok(None),
        Value::String(text) => paths::existing_file(text, &[wire::SUFFIX]).map(Some),
        _ => Err(EngineError::invalid_data(BASE_REFUSAL)),
    }
}

/// Одна связь `{ map, types }`; `seen` хранит карты предыдущих элементов.
fn dependency_of(item: &Value, seen: &mut HashSet<String>) -> Result<Dependency> {
    let map = match item.get("map") {
        Some(Value::String(text)) => text.as_str(),
        _ => "",
    };
    let usable = is_asset_name(map) && seen.insert(map.to_owned());
    if !usable {
        return Err(EngineError::invalid_data(format!(
            "Manifest map {map} is not valid or repeats."
        )));
    }
    let listed = match item.get("types") {
        Some(Value::Array(list)) if in_range(list.len(), limits::TYPES) => list
            .iter()
            .map(Value::as_str)
            .map(|entry| entry.filter(|name| is_asset_name(name)).map(str::to_owned))
            .collect::<Option<Vec<_>>>(),
        _ => None,
    };
    match listed {
        Some(types) => Ok(Dependency {
            map: map.to_owned(),
            types,
        }),
        None => Err(EngineError::invalid_data(format!(
            "Manifest map {map} needs 1–16 valid types."
        ))),
    }
}

fn dependencies_of(root: &Value) -> Result<Vec<Dependency>> {
    let items = match root.get("dependencies") {
        Some(Value::Array(items)) if in_range(items.len(), limits::MAPS) => items,
        _ => {
            return Err(EngineError::invalid_data(
                "Manifest needs 1–64 map dependencies.",
            ))
        }
    };
    let mut seen = HashSet::new();
    items
        .iter()
        .map(|item| dependency_of(item, &mut seen))
        .collect()
}

/// Прочитанный запрос: основа (если есть) и связи по порядку запроса.
struct Request {
    base: Option<PathBuf>,
    dependencies: Vec<Dependency>,
}

impl Request {
    fn load(path: &Path) -> Result<Self> {
        let root = read_root(path)?;
        // Основа проверяется до связей, а её размер и содержимое — после них.
        Ok(Self {
            base: base_of(&root)?,
            dependencies: dependencies_of(&root)?,
        })
    }
}

/// Собранные байты файла и что известно про основу.
struct Built {
    bytes: Vec<u8>,
    kept: Option<Kept>,
    replaced: usize,
}

fn assemble(request: &Request) -> Result<Built> {
    let Some(base) = &request.base else {
        let bytes = pso::fresh(&request.dependencies)?;
        pso::verify_fresh(&bytes, &request.dependencies)?;
        return Ok(Built {
            bytes,
            kept: None,
            replaced: 0,
        });
    };
    let merged = pso::merge(
        &read_within(base, limits::BASE_BYTES, BASE_REFUSAL)?,
        &request.dependencies,
    )?;
    Ok(Built {
        bytes: merged.bytes,
        kept: Some(merged.kept),
        replaced: merged.replaced,
    })
}

/// Размеры массивов корня основы до слияния.
fn kept_table(kept: &Kept) -> Value {
    table([
        ("mapDataGroups", kept.map_data_groups.into()),
        ("imapDependencies", kept.imap_dependencies.into()),
        ("imapDependencies2", kept.imap_dependencies2.into()),
        ("itypDependencies2", kept.itype_dependencies2.into()),
        ("hdTxdBindings", kept.hd_txd_bindings.into()),
        ("interiors", kept.interiors.into()),
    ])
}

/// Имя выходного файла (последнее звено), если оно кончается на `.ymf`.
fn ymf_name(output: &Path) -> Result<String> {
    let name = output
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    match name.to_ascii_lowercase().ends_with(wire::SUFFIX) {
        true => Ok(name),
        false => Err(EngineError::invalid_data(
            "Manifest output must be a .ymf file.",
        )),
    }
}

/// Файл запроса и полный путь выхода: сначала `--input`, потом `--output`.
fn invocation(options: &Options) -> Result<(PathBuf, PathBuf)> {
    let request = options
        .required("input")
        .and_then(|text| paths::existing_file(text, &[".json"]))?;
    let output = options.required("output").and_then(paths::full_path)?;
    Ok((request, output))
}

pub fn compile_manifest(options: &Options, _: &Progress) -> Result<Value> {
    let (request_path, output) = invocation(options)?;
    let built = assemble(&Request::load(&request_path)?)?;

    // Имя проверяется после сборки и до создания каталогов.
    let file = ymf_name(&output)?;
    output.parent().map_or(Ok(()), fs::create_dir_all)?;
    write_atomic(&output, &built.bytes)?;
    let links = pso::count_links(&built.bytes)?;

    let kept = built.kept.as_ref().map_or(Value::Null, kept_table);
    Ok(table([
        ("file", file.into()),
        ("bytes", built.bytes.len().into()),
        ("sha256", rage_res::hash::sha256_hex(&built.bytes).into()),
        (
            "semantic",
            table([
                ("semanticReopen", true.into()),
                ("imapDependencies", links.into()),
                ("kept", kept),
                ("replaced", built.replaced.into()),
            ]),
        ),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use serde_json::json;

    struct Bench {
        dir: tempfile::TempDir,
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

        fn request(&self, name: &str, body: &str) -> String {
            self.put(name, body.as_bytes())
        }

        fn exec(&self, args: &[&str]) -> (Value, i32) {
            let mut argv = vec!["compile-manifest".to_owned()];
            argv.extend(args.iter().map(|arg| (*arg).to_owned()));
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }

        /// Запрос в файл `<имя>.json` и запуск с выходом `output`.
        fn compile(&self, body: &str, output: &str) -> (Value, i32) {
            let input = self.request("request.json", body);
            self.exec(&["--input", &input, "--output", output])
        }
    }

    fn request_of(dependencies: &str) -> String {
        format!(
            r#"{{"format":"astral.compile-manifest","version":1,"dependencies":{dependencies}}}"#
        )
    }

    fn with_base(base: &str, dependencies: &str) -> String {
        let base = base.replace('\\', "\\\\");
        format!(
            r#"{{"format":"astral.compile-manifest","version":1,"base":"{base}","dependencies":{dependencies}}}"#
        )
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

    fn result_of(reply: &(Value, i32)) -> &Value {
        assert_eq!(reply.1, 0, "{}", reply.0);
        &reply.0["result"]
    }

    const ONE_MAP: &str = r#"[{"map":"astral_probe_map","types":["astral_probe_type"]}]"#;

    #[test]
    fn new_files_match_the_host_dumps() {
        let bench = Bench::new();
        let cases = [
            (
                ONE_MAP,
                "out.ymf",
                480,
                "c13c2ed3c9cb7799ea6df9cf373c0f22ab92b3dae398c2588fc7c2447fd1925e",
                1,
            ),
            (
                r#"[{"map":"astral_probe_map","types":["t_one","t_two"]},{"map":"other_map","types":["t_three"]}]"#,
                "two.ymf",
                512,
                "dea7c3eef0f5f508073032d93ecbd3dc8ee79c6d5c72389a49cd81fdc4292b52",
                2,
            ),
            (
                r#"[{"map":"prop_a","types":["a1","a2","a3"]},{"map":"prop_bb","types":["b1"]},{"map":"prop_ccc","types":["c1","c2","c3","c4","c5"]}]"#,
                "three.ymf",
                560,
                "339deaae149a7343c7395e0057e076b5f0d96a9a46c2ca7db8567520bb488024",
                3,
            ),
        ];
        for (dependencies, name, bytes, sha, links) in cases {
            let reply = bench.compile(&request_of(dependencies), &bench.path(name));
            assert_eq!(
                result_of(&reply),
                &json!({
                    "file": name,
                    "bytes": bytes,
                    "sha256": sha,
                    "semantic": {
                        "semanticReopen": true,
                        "imapDependencies": links,
                        "kept": null,
                        "replaced": 0
                    }
                })
            );
            assert_eq!(
                rage_res::hash::sha256_hex(&std::fs::read(bench.path(name)).unwrap()),
                sha
            );
        }
    }

    #[test]
    fn answer_keys_come_in_the_documented_order() {
        let bench = Bench::new();
        let input = bench.request("r.json", &request_of(ONE_MAP));
        let out = bench.path("o.ymf");
        let outcome = run(
            &["compile-manifest", "--input", &input, "--output", &out].map(str::to_owned),
            &Progress::silent(),
        );
        let expected = r#"{"ok":true,"command":"compile-manifest","result":{"file":"o.ymf","bytes":480,"sha256":"c13c2ed3c9cb7799ea6df9cf373c0f22ab92b3dae398c2588fc7c2447fd1925e","semantic":{"semanticReopen":true,"imapDependencies":1,"kept":null,"replaced":0}}}"#.to_owned();
        assert_eq!(outcome.line, expected);
    }

    #[test]
    fn merging_follows_the_host_chain_and_replaces_the_same_map() {
        let bench = Bench::new();
        let first = bench.path("base1.ymf");
        bench.compile(&request_of(ONE_MAP), &first);

        let second = bench.path("base2.ymf");
        let reply = bench.compile(
            &with_base(
                &first,
                r#"[{"map":"other_map","types":["other_type_a","other_type_b"]}]"#,
            ),
            &second,
        );
        assert_eq!(
            result_of(&reply),
            &json!({
                "file": "base2.ymf",
                "bytes": 512,
                "sha256": "399894815815344bd5aec2c398087bf2a3f55e77ebc528849cb3302523a553bf",
                "semantic": {
                    "semanticReopen": true,
                    "imapDependencies": 2,
                    "kept": {
                        "mapDataGroups": 0,
                        "imapDependencies": 0,
                        "imapDependencies2": 1,
                        "itypDependencies2": 0,
                        "hdTxdBindings": 0,
                        "interiors": 0
                    },
                    "replaced": 0
                }
            })
        );

        let third = bench.path("base3.ymf");
        let reply = bench.compile(
            &with_base(&second, r#"[{"map":"third_map","types":["third_type"]}]"#),
            &third,
        );
        let answer = result_of(&reply);
        assert_eq!(answer["bytes"], 540);
        assert_eq!(
            answer["sha256"],
            "de949e7198b141ebebd069a229b356ff8b3c68a0d9ace94ad16e1348e74c20c0"
        );
        assert_eq!(answer["semantic"]["imapDependencies"], 3);
        assert_eq!(answer["semantic"]["kept"]["imapDependencies2"], 2);

        // Карта, что уже есть в основе, заменяется, а не повторяется.
        let replaced = bench.path("replaced.ymf");
        let reply = bench.compile(
            &with_base(&second, r#"[{"map":"other_map","types":["x_one"]}]"#),
            &replaced,
        );
        let answer = result_of(&reply);
        assert_eq!(answer["semantic"]["replaced"], 1);
        assert_eq!(answer["semantic"]["imapDependencies"], 2);
    }

    /// Результат ложится через черновик рядом: имя черновика занято папкой - запись отказывает,
    /// прежний файл цел. Прямая запись молча перезаписала бы его.
    #[test]
    fn a_result_that_cannot_be_staged_leaves_the_old_file() {
        let bench = Bench::new();
        let target = bench.path("keep.ymf");
        let stage = bench.path("keep.ymf.shop-stage");
        std::fs::write(&target, b"old manifest").unwrap();
        std::fs::create_dir(&stage).unwrap();
        let reply = bench.compile(&request_of(ONE_MAP), &target);
        assert_eq!(reply.1, 1, "{}", reply.0);
        assert_eq!(reply.0["error"]["code"], "UnauthorizedAccessException");
        assert_eq!(std::fs::read(&target).unwrap(), b"old manifest");
        assert!(std::path::Path::new(&stage).is_dir());

        std::fs::remove_dir(&stage).unwrap();
        assert_eq!(
            result_of(&bench.compile(&request_of(ONE_MAP), &target))["bytes"],
            480
        );
        assert!(!std::path::Path::new(&stage).exists());
    }

    #[test]
    fn merging_in_place_rewrites_the_base() {
        let bench = Bench::new();
        let target = bench.path("inplace.ymf");
        bench.compile(&request_of(ONE_MAP), &target);
        let reply = bench.compile(
            &with_base(
                &target,
                r#"[{"map":"other_map","types":["other_type_a","other_type_b"]}]"#,
            ),
            &target,
        );
        assert_eq!(result_of(&reply)["bytes"], 512);
        assert_eq!(std::fs::read(&target).unwrap().len(), 512);
    }

    #[test]
    fn a_missing_empty_or_blank_base_means_a_new_file() {
        let bench = Bench::new();
        for base in [r#""base":null,"#, r#""base":"","#, r#""base":"   ","#, ""] {
            let body = format!(
                r#"{{"format":"astral.compile-manifest","version":1,{base}"dependencies":{ONE_MAP}}}"#
            );
            let reply = bench.compile(&body, &bench.path("o.ymf"));
            assert_eq!(result_of(&reply)["semantic"]["kept"], Value::Null, "{base}");
        }
    }

    #[test]
    fn base_refusals_follow_the_documented_order() {
        let bench = Bench::new();
        let out = bench.path("o.ymf");
        let kind = r#""base":123,"#;
        for base in [kind, r#""base":false,"#, r#""base":[],"#, r#""base":{},"#] {
            let body = format!(
                r#"{{"format":"astral.compile-manifest","version":1,{base}"dependencies":{ONE_MAP}}}"#
            );
            assert_eq!(
                bench.compile(&body, &out),
                invalid_data("Manifest base must be an existing .ymf file up to 4 MiB."),
                "{base}"
            );
        }
        let none = bench.path("none.ymf");
        assert_eq!(
            bench.compile(&with_base(&none, ONE_MAP), &out),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {none}")
            )
        );
        let bin = bench.put("base.bin", b"x");
        assert_eq!(
            bench.compile(&with_base(&bin, ONE_MAP), &out),
            refused("ArgumentException", "Unsupported file extension: .bin")
        );
        let missing_bin = bench.path("none.bin");
        assert_eq!(
            bench.compile(&with_base(&missing_bin, ONE_MAP), &out),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {missing_bin}")
            )
        );
        // Существование и расширение основы идут до связей, размер и содержимое — после.
        let garbage = bench.put("garbage.ymf", b"this is not a manifest at all");
        assert_eq!(
            bench.compile(
                &with_base(&garbage, r#"[{"map":"BAD","types":["t"]}]"#),
                &out
            ),
            invalid_data("Manifest map BAD is not valid or repeats.")
        );
        assert_eq!(
            bench.compile(&with_base(&garbage, "[]"), &out),
            invalid_data("Manifest needs 1–64 map dependencies.")
        );
        assert_eq!(
            bench.compile(&with_base(&garbage, ONE_MAP), &out),
            refused(
                "ArgumentException",
                "Manifest base is not a PSO _manifest.ymf."
            )
        );
        let empty = bench.put("empty.ymf", b"");
        assert_eq!(
            bench.compile(&with_base(&empty, ONE_MAP), &out),
            invalid_data("Manifest base must be an existing .ymf file up to 4 MiB.")
        );
        let big = bench.put("big.ymf", &vec![0u8; 4 * 1024 * 1024 + 1]);
        assert_eq!(
            bench.compile(&with_base(&big, ONE_MAP), &out),
            invalid_data("Manifest base must be an existing .ymf file up to 4 MiB.")
        );
        let exact = bench.put("exact.ymf", &vec![7u8; 4 * 1024 * 1024]);
        assert_eq!(
            bench.compile(&with_base(&exact, ONE_MAP), &out),
            refused(
                "ArgumentException",
                "Manifest base is not a PSO _manifest.ymf."
            )
        );
        let folder = bench.put("folder.ymf/inside.txt", b"x");
        let folder = folder.rsplit_once(['\\', '/']).unwrap().0.to_owned();
        assert_eq!(
            bench.compile(&with_base(&folder, ONE_MAP), &out),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {folder}")
            )
        );
    }

    #[test]
    fn request_file_refusals() {
        let bench = Bench::new();
        let out = bench.path("o.ymf");
        let call = |name: &str, body: &[u8]| {
            let input = bench.put(name, body);
            bench.exec(&["--input", &input, "--output", &out])
        };
        assert_eq!(
            call("empty.json", b""),
            invalid_data("Manifest request must be between 1 byte and 64 KiB.")
        );
        assert_eq!(
            call("not-json.json", b"not json"),
            invalid_data("Manifest request is empty or broken.")
        );
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(request_of(ONE_MAP).as_bytes());
        assert_eq!(
            call("bom.json", &bom),
            invalid_data("Manifest request is empty or broken.")
        );
        let mut junk = request_of(ONE_MAP).into_bytes();
        junk.extend_from_slice(b" junk");
        assert_eq!(
            call("junk.json", &junk),
            invalid_data("Manifest request is empty or broken.")
        );
        let mut spaced = b"  \n".to_vec();
        spaced.extend_from_slice(request_of(ONE_MAP).as_bytes());
        spaced.extend_from_slice(b"\n\n");
        assert_eq!(result_of(&call("spaced.json", &spaced))["bytes"], 480);
        for root in ["[]", "null", "5", "\"text\""] {
            assert_eq!(
                call("root.json", root.as_bytes()),
                invalid_data("Manifest request has an unknown format."),
                "{root}"
            );
        }
        let exact = format!(
            "{}{}",
            request_of(ONE_MAP),
            " ".repeat(64 * 1024 - request_of(ONE_MAP).len())
        );
        assert_eq!(exact.len(), 64 * 1024);
        assert_eq!(
            result_of(&call("exact.json", exact.as_bytes()))["bytes"],
            480
        );
        let over = format!("{exact} ");
        assert_eq!(
            call("over.json", over.as_bytes()),
            invalid_data("Manifest request must be between 1 byte and 64 KiB.")
        );
    }

    #[test]
    fn format_and_version_are_strict() {
        let bench = Bench::new();
        let out = bench.path("o.ymf");
        let unknown = invalid_data("Manifest request has an unknown format.");
        let bodies = [
            format!(r#"{{"version":1,"dependencies":{ONE_MAP}}}"#),
            format!(r#"{{"format":"astral.compile-xxx","version":1,"dependencies":{ONE_MAP}}}"#),
            format!(
                r#"{{"format":"Astral.Compile-Manifest","version":1,"dependencies":{ONE_MAP}}}"#
            ),
            format!(r#"{{"format":5,"version":1,"dependencies":{ONE_MAP}}}"#),
            format!(r#"{{"format":"astral.compile-manifest","dependencies":{ONE_MAP}}}"#),
            format!(
                r#"{{"format":"astral.compile-manifest","version":2,"dependencies":{ONE_MAP}}}"#
            ),
            format!(
                r#"{{"format":"astral.compile-manifest","version":0,"dependencies":{ONE_MAP}}}"#
            ),
            format!(
                r#"{{"format":"astral.compile-manifest","version":"1","dependencies":{ONE_MAP}}}"#
            ),
            format!(
                r#"{{"format":"astral.compile-manifest","version":true,"dependencies":{ONE_MAP}}}"#
            ),
            format!(
                r#"{{"format":"astral.compile-manifest","version":1.0,"dependencies":{ONE_MAP}}}"#
            ),
            format!(
                r#"{{"format":"astral.compile-manifest","version":1e0,"dependencies":{ONE_MAP}}}"#
            ),
        ];
        for body in bodies {
            assert_eq!(bench.compile(&body, &out), unknown, "{body}");
        }
        // Лишние поля не мешают, повтор ключа решает последнее значение.
        let extra = r#"{"format":"astral.compile-manifest","version":1,"note":1,"dependencies":[{"map":"m","types":["t"],"extra":true}],"version":1}"#.to_owned();
        assert_eq!(result_of(&bench.compile(&extra, &out))["bytes"], 480);
        let last = format!(
            r#"{{"format":"astral.compile-manifest","version":2,"version":1,"dependencies":{ONE_MAP}}}"#
        );
        assert_eq!(result_of(&bench.compile(&last, &out))["bytes"], 480);
    }

    #[test]
    fn dependency_list_rules_and_texts() {
        let bench = Bench::new();
        let out = bench.path("o.ymf");
        let count_refusal = invalid_data("Manifest needs 1–64 map dependencies.");
        for list in ["null", "{}", "\"x\"", "[]"] {
            assert_eq!(
                bench.compile(&request_of(list), &out),
                count_refusal,
                "{list}"
            );
        }
        let missing = r#"{"format":"astral.compile-manifest","version":1}"#;
        assert_eq!(bench.compile(missing, &out), count_refusal);
        let many = |count: usize| {
            let items: Vec<String> = (0..count)
                .map(|i| format!(r#"{{"map":"m{i}","types":["t"]}}"#))
                .collect();
            format!("[{}]", items.join(","))
        };
        let sixty_four = bench.compile(&request_of(&many(64)), &out);
        assert_eq!(result_of(&sixty_four)["bytes"], 2244);
        assert_eq!(bench.compile(&request_of(&many(65)), &out), count_refusal);
        let blank_name = invalid_data("Manifest map  is not valid or repeats.");
        for item in [
            "5",
            "null",
            "[]",
            "{}",
            r#"{"types":["t"]}"#,
            r#"{"map":5,"types":["t"]}"#,
            r#"{"map":null,"types":["t"]}"#,
            r#"{"map":"","types":["t"]}"#,
        ] {
            assert_eq!(
                bench.compile(&request_of(&format!("[{item}]")), &out),
                blank_name,
                "{item}"
            );
        }
        for (map, shown) in [
            ("BAD", "BAD"),
            ("_map", "_map"),
            ("карта", "карта"),
            ("m\\n", "m\n"),
            ("a-b", "a-b"),
            ("a.b", "a.b"),
        ] {
            let item = format!(r#"[{{"map":"{map}","types":["t"]}}]"#);
            assert_eq!(
                bench.compile(&request_of(&item), &out),
                invalid_data(&format!("Manifest map {shown} is not valid or repeats.")),
                "{map}"
            );
        }
        let long = "a".repeat(64);
        assert_eq!(
            bench.compile(
                &request_of(&format!(r#"[{{"map":"{long}","types":["t"]}}]"#)),
                &out
            ),
            invalid_data(&format!("Manifest map {long} is not valid or repeats."))
        );
        for map in ["0abc", "123", "a_b", "x", &"a".repeat(63)] {
            let item = format!(r#"[{{"map":"{map}","types":["t"]}}]"#);
            assert_eq!(
                result_of(&bench.compile(&request_of(&item), &out))["bytes"],
                480,
                "{map}"
            );
        }
        let repeat = r#"[{"map":"m","types":["t"]},{"map":"m","types":["t"]}]"#;
        assert_eq!(
            bench.compile(&request_of(repeat), &out),
            invalid_data("Manifest map m is not valid or repeats.")
        );
    }

    #[test]
    fn type_list_rules_and_check_order() {
        let bench = Bench::new();
        let out = bench.path("o.ymf");
        let needs =
            |map: &str| invalid_data(&format!("Manifest map {map} needs 1–16 valid types."));
        for types in [
            "null",
            "\"t\"",
            "{}",
            "[]",
            r#"["T"]"#,
            "[5]",
            "[null]",
            r#"[""]"#,
            r#"["t-x"]"#,
            r#"["ok","BAD"]"#,
        ] {
            let item = format!(r#"[{{"map":"m","types":{types}}}]"#);
            assert_eq!(
                bench.compile(&request_of(&item), &out),
                needs("m"),
                "{types}"
            );
        }
        let missing = r#"[{"map":"m"}]"#;
        assert_eq!(bench.compile(&request_of(missing), &out), needs("m"));
        let seventeen: Vec<String> = (0..17).map(|i| format!("\"t{i}\"")).collect();
        let item = format!(r#"[{{"map":"m","types":[{}]}}]"#, seventeen.join(","));
        assert_eq!(bench.compile(&request_of(&item), &out), needs("m"));
        let sixteen: Vec<String> = (0..16).map(|i| format!("\"t{i}\"")).collect();
        let item = format!(r#"[{{"map":"m","types":[{}]}}]"#, sixteen.join(","));
        assert_eq!(
            result_of(&bench.compile(&request_of(&item), &out))["bytes"],
            540
        );
        // Повтор типа допустим: и внутри карты, и между картами.
        let repeated = r#"[{"map":"m","types":["t","t","t"]}]"#;
        assert_eq!(
            result_of(&bench.compile(&request_of(repeated), &out))["bytes"],
            488
        );
        let shared = r#"[{"map":"a","types":["t"]},{"map":"b","types":["t"]}]"#;
        assert_eq!(
            result_of(&bench.compile(&request_of(shared), &out))["bytes"],
            508
        );
        // Элементы разбираются по очереди и целиком: побеждает первый плохой.
        let both = r#"[{"map":"a","types":["BAD"]},{"map":"B","types":["t"]}]"#;
        assert_eq!(bench.compile(&request_of(both), &out), needs("a"));
        let second = r#"[{"map":"a","types":["t"]},{"map":"b","types":[]}]"#;
        assert_eq!(bench.compile(&request_of(second), &out), needs("b"));
        let bad_map_and_types = r#"[{"map":"BAD","types":[]}]"#;
        assert_eq!(
            bench.compile(&request_of(bad_map_and_types), &out),
            invalid_data("Manifest map BAD is not valid or repeats.")
        );
    }

    #[test]
    fn parameters_and_output_name_rules() {
        let bench = Bench::new();
        let input = bench.request("req.json", &request_of(ONE_MAP));
        let argument = |message: &str| refused("ArgumentException", message);
        assert_eq!(bench.exec(&[]), argument("--input is required."));
        assert_eq!(
            bench.exec(&["--output", "x.ymf"]),
            argument("--input is required.")
        );
        assert_eq!(
            bench.exec(&["--input", &input]),
            argument("--output is required.")
        );
        assert_eq!(
            bench.exec(&["--input", &input, "--output", ""]),
            argument("The path is empty.")
        );
        assert_eq!(
            bench.exec(&["--input", &input, "--output", "  "]),
            argument("The path is empty.")
        );
        let wrong = bench.path("host.ymf");
        assert_eq!(
            bench.exec(&["--input", &wrong, "--output", "x.ymf"]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {wrong}")
            )
        );
        let ymf = bench.put("host.ymf", b"x");
        assert_eq!(
            bench.exec(&["--input", &ymf, "--output", "x.ymf"]),
            argument("Unsupported file extension: .ymf")
        );
        // Сначала выход (пусто), потом содержимое запроса.
        let broken = bench.request("broken.json", "nonsense");
        assert_eq!(
            bench.exec(&["--input", &broken, "--output", ""]),
            argument("The path is empty.")
        );

        let ext = invalid_data("Manifest output must be a .ymf file.");
        for name in ["xymf", "o.bin", "o-noext", "o-dot.ymf."] {
            assert_eq!(
                bench.exec(&["--input", &input, "--output", &bench.path(name)]),
                ext,
                "{name}"
            );
        }
        for name in [
            "o-upper.YMF",
            "o-mixed.YmF",
            ".ymf",
            "_manifest.ymf",
            "Name With Space.ymf",
        ] {
            let reply = bench.exec(&["--input", &input, "--output", &bench.path(name)]);
            assert_eq!(result_of(&reply)["file"], name, "{name}");
        }
        let nested = bench.path("new/sub/dirs/_manifest.ymf");
        assert_eq!(
            result_of(&bench.exec(&["--input", &input, "--output", &nested]))["file"],
            "_manifest.ymf"
        );
        assert!(Path::new(&nested).is_file());
        let dotted = bench.path("rel/../rel2/o.ymf");
        assert_eq!(
            result_of(&bench.exec(&["--input", &input, "--output", &dotted]))["file"],
            "o.ymf"
        );
        assert!(Path::new(&bench.path("rel2/o.ymf")).is_file());
        let loud = bench.exec(&[
            "--INPUT",
            &input,
            "--Output",
            &bench.path("up.ymf"),
            "--note",
            "x",
        ]);
        assert_eq!(result_of(&loud)["bytes"], 480);
        let repeated = bench.exec(&[
            "--input",
            "none.json",
            "--input",
            &input,
            "--output",
            &bench.path("ir.ymf"),
        ]);
        assert_eq!(result_of(&repeated)["bytes"], 480);
    }

    #[test]
    fn effects_on_disk_follow_the_order_of_checks() {
        let bench = Bench::new();
        let keep = bench.put("keep2.ymf", b"hello world");
        let bad = request_of(r#"[{"map":"BAD","types":["t"]}]"#);
        assert_eq!(
            bench.compile(&bad, &keep),
            invalid_data("Manifest map BAD is not valid or repeats.")
        );
        assert_eq!(std::fs::read(&keep).unwrap(), b"hello world");
        // Неверное расширение выхода не создаёт каталогов, даже при неверном запросе.
        let never = bench.path("never/made/o.bin");
        assert_eq!(
            bench.compile(&bad, &never),
            invalid_data("Manifest map BAD is not valid or repeats.")
        );
        assert_eq!(
            bench.compile(&request_of(ONE_MAP), &never),
            invalid_data("Manifest output must be a .ymf file.")
        );
        assert!(!Path::new(&bench.path("never")).exists());
        // Удача заменяет прежний файл целиком; повтор даёт те же байты.
        assert_eq!(
            result_of(&bench.compile(&request_of(ONE_MAP), &keep))["bytes"],
            480
        );
        let again = bench.compile(&request_of(ONE_MAP), &keep);
        assert_eq!(
            result_of(&again)["sha256"],
            "c13c2ed3c9cb7799ea6df9cf373c0f22ab92b3dae398c2588fc7c2447fd1925e"
        );
        // Выход-каталог: системный отказ, каталог цел.
        let adir = bench.path("folder.ymf");
        std::fs::create_dir(&adir).unwrap();
        let reply = bench.compile(&request_of(ONE_MAP), &adir);
        assert_eq!(reply.1, 1);
        assert_eq!(reply.0["error"]["code"], "UnauthorizedAccessException");
        assert!(Path::new(&adir).is_dir());
    }

    #[test]
    fn asset_names_follow_the_rule() {
        assert!(is_asset_name("emb_test"));
        assert!(is_asset_name("0abc"));
        assert!(is_asset_name(&"a".repeat(63)));
        for bad in [
            "",
            "_a",
            "A",
            "a-b",
            "a.b",
            "a b",
            "a\n",
            "é",
            &"a".repeat(64),
        ] {
            assert!(!is_asset_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_wrong_hash_is_caught() {
        // Отрицательный контроль: слияние даёт не тот же файл, что новый.
        let bench = Bench::new();
        let reply = bench.compile(&request_of(ONE_MAP), &bench.path("a.ymf"));
        assert_ne!(
            result_of(&reply)["sha256"],
            "399894815815344bd5aec2c398087bf2a3f55e77ebc528849cb3302523a553bf"
        );
    }
}
