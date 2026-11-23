//! `awc-stream-patch`: замена и удаление потоков плоского банка `.awc`.
//!
//! Слои правки приходят файлом JSON, пределы слота памяти игры — необязательным
//! вторым файлом. Банк собирает `rage_res::awc::patch`; здесь читаются файлы,
//! разбираются идентификаторы, сверяются суммы источников и пределы, и результат
//! ложится на диск одним переименованием.

use crate::error::EngineError;
use serde_json::Value as Json;

type Outcome<T> = crate::error::Result<T>;

pub const COMMANDS: &[super::Command] =
    &[super::Command::new("awc-stream-patch", awc_stream_patch)];

fn awc_stream_patch(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Outcome<Json> {
    let fresh = super::fresh_dirs::FreshDirs::beside(options.required("output"));
    let files = Files::locate(options)?;
    // Слои читаются до основы: ошибки источников идут раньше ошибок основы.
    let layers = Layers::read(&files.patches)?;
    let base = std::fs::read(&files.input)?;
    let built = layers.assemble(&base)?;
    files.check_limits(&built)?;
    super::shop::write_atomic(&files.output, &built.bytes)?;
    fresh.keep();
    Ok(files.answer(&built))
}

fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

// ---------------------------------------------------------------------------
// Файлы команды и ответ.
// ---------------------------------------------------------------------------

/// Пути в порядке проверок. Путь пределов проверяется позже, после сборки.
struct Files {
    input: std::path::PathBuf,
    output: std::path::PathBuf,
    patches: std::path::PathBuf,
    limits: Option<String>,
}

impl Files {
    fn locate(options: &crate::args::Options) -> Outcome<Self> {
        // Выход проверяется расширением и сразу получает каталог; остальные должны существовать.
        let find = |name: &str, extension: &str, is_output: bool| {
            let raw = options.required(name)?;
            if is_output {
                crate::paths::output_file(raw, &[extension])
            } else {
                crate::paths::existing_file(raw, &[extension])
            }
        };
        Ok(Self {
            input: find("input", ".awc", false)?,
            output: find("output", ".awc", true)?,
            patches: find("patches", ".json", false)?,
            limits: options.optional("limits").map(str::to_owned),
        })
    }

    fn check_limits(&self, built: &Built) -> Outcome<()> {
        let Some(raw) = &self.limits else {
            return Ok(());
        };
        let file = crate::paths::existing_file(raw, &[".json"])?;
        Limits::load(&file)?.enforce(built)
    }

    fn answer(&self, built: &Built) -> Json {
        let shown = |path: &std::path::Path| Json::from(path.display().to_string());
        let rows: [(&str, Json); 12] = [
            ("status", "ready".into()),
            ("mode", "awc-stream-patch".into()),
            ("input", shown(&self.input)),
            ("output", shown(&self.output)),
            ("streams", built.streams.into()),
            ("replaced", hex_list(&built.replaced)),
            ("dropped", hex_list(&built.dropped)),
            ("bytes", built.bytes.len().into()),
            ("headerBytes", built.header.into()),
            ("metadataBytes", built.metadata.into()),
            ("contentBytes", built.content.into()),
            ("sha256", rage_res::hash::sha256_hex(&built.bytes).into()),
        ];
        Json::Object(
            rows.into_iter()
                .map(|(key, value)| (key.to_owned(), value))
                .collect(),
        )
    }
}

/// Идентификатор потока в ответе и в тексте отказа: `0x` и восемь прописных цифр.
struct StreamName(u32);

impl std::fmt::Display for StreamName {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(out, "0x{:08X}", self.0)
    }
}

fn hex_list(ids: &[u32]) -> Json {
    Json::Array(
        ids.iter()
            .map(|&id| Json::String(StreamName(id).to_string()))
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Слои правки.
// ---------------------------------------------------------------------------

/// Слой с уже прочитанным источником.
struct Layer {
    source: Vec<u8>,
    streams: Vec<u32>,
    drop: Vec<u32>,
}

struct Layers(Vec<Layer>);

impl Layers {
    fn read(patches: &std::path::Path) -> Outcome<Self> {
        let text = std::fs::read(patches)?;
        match serde_json::from_slice::<Json>(&text) {
            Ok(Json::Array(items)) if items.is_empty() => {
                Err(invalid("At least one AWC stream patch is required."))
            }
            // Каждая правка разбирается целиком до следующей: ошибка первой
            // побеждает отсутствующий источник второй.
            Ok(Json::Array(items)) => items
                .iter()
                .map(Layer::load)
                .collect::<Outcome<_>>()
                .map(Self),
            _ => Err(invalid("AWC patch list is empty or broken.")),
        }
    }

    fn assemble(&self, base: &[u8]) -> Outcome<Built> {
        let views: Vec<rage_res::awc::PatchLayer> = self
            .0
            .iter()
            .map(|layer| rage_res::awc::PatchLayer {
                source: &layer.source,
                streams: layer.streams.clone(),
                drop: layer.drop.clone(),
            })
            .collect();
        Built::measure(rage_res::awc::patch(base, &views)?)
    }
}

impl Layer {
    fn load(entry: &Json) -> Outcome<Self> {
        let path = entry.get("source").and_then(Json::as_str).unwrap_or("");
        let source = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => {
                return Err(EngineError::file_not_found(
                    "AWC patch source was not found.",
                ))
            }
        };
        check_sum(entry["sha256"].as_str(), path, &source)?;
        let streams = Ids(&entry["streams"]).parse()?;
        let drop = Ids(&entry["drop"]).parse()?;
        Ok(Self {
            source,
            streams,
            drop,
        })
    }
}

/// Сумма сверяется, только если она непустая строка; не строка пропускает проверку.
fn check_sum(expected: Option<&str>, path: &str, source: &[u8]) -> Outcome<()> {
    match expected {
        Some(wanted)
            if !wanted.is_empty()
                && !wanted.eq_ignore_ascii_case(&rage_res::hash::sha256_hex(source)) =>
        {
            let name = match std::path::Path::new(path).file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => String::new(),
            };
            Err(invalid(format!("AWC patch checksum mismatch: {name}")))
        }
        _ => Ok(()),
    }
}

/// Список идентификаторов: не массив читается как пустой, не строка как пустая строка.
struct Ids<'a>(&'a Json);

impl Ids<'_> {
    fn parse(&self) -> Outcome<Vec<u32>> {
        let items = self.0.as_array().map_or(&[][..], |list| list.as_slice());
        items
            .iter()
            .map(|item| Self::one(item.as_str().unwrap_or_default()))
            .collect()
    }

    /// Идентификатор в банке занимает 29 бит: лишнее не обрезается, а отказывает.
    fn one(text: &str) -> Outcome<u32> {
        let Some(number) = stream_number(text) else {
            return Err(invalid(format!("Invalid AWC stream identifier: {text}")));
        };
        match u32::try_from(number) {
            Ok(id) if id & !ID_MASK == 0 => Ok(id),
            _ => Err(invalid(format!(
                "AWC stream identifier does not fit 29 bits: {text}"
            ))),
        }
    }
}

const ID_MASK: u32 = 0x1FFF_FFFF;

/// Число идентификатора: `0x`/`0X` и шестнадцатеричные цифры (до 64 бит) либо десятичное число в пределах `u32`.
fn stream_number(text: &str) -> Option<u64> {
    let text = text.trim();
    let hex = ["0x", "0X"]
        .iter()
        .find_map(|prefix| text.strip_prefix(prefix))
        .filter(|digits| digits.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .and_then(|digits| u64::from_str_radix(digits, 16).ok());
    hex.or_else(|| text.parse::<u32>().ok().map(u64::from))
}

// ---------------------------------------------------------------------------
// Собранный банк и пределы слота.
// ---------------------------------------------------------------------------

struct Built {
    bytes: Vec<u8>,
    streams: usize,
    replaced: Vec<u32>,
    dropped: Vec<u32>,
    header: usize,
    metadata: usize,
    content: usize,
}

impl Built {
    fn measure(patched: rage_res::awc::PatchResult) -> Outcome<Self> {
        let budget = rage_res::awc::budget(&patched.bytes)?;
        let bank = rage_res::awc::read_bank(&patched.bytes)?;
        Ok(Self {
            streams: bank.streams.len(),
            header: budget.0,
            metadata: budget.1,
            content: budget.2,
            replaced: patched.replaced,
            dropped: patched.dropped,
            bytes: patched.bytes,
        })
    }
}

/// Пределы слота: каждый необязателен, строгое «больше» нарушает.
struct Limits {
    slot: String,
    header: Option<u64>,
    metadata: Option<u64>,
    content: Option<u64>,
}

impl Limits {
    fn load(path: &std::path::Path) -> Outcome<Self> {
        let broken = || invalid("AWC slot limits are empty or broken.");
        let text = std::fs::read(path).map_err(|_| broken())?;
        let root: Json = serde_json::from_slice(&text).map_err(|_| broken())?;
        let cap = |key: &str| root[key].as_u64();
        Ok(Self {
            slot: root["slot"].as_str().unwrap_or("slot").to_owned(),
            header: cap("header"),
            metadata: cap("metadata"),
            content: cap("bytes"),
        })
    }

    fn enforce(&self, built: &Built) -> Outcome<()> {
        let rows = [
            ("header", built.header, self.header),
            ("metadata", built.metadata, self.metadata),
            ("content", built.content, self.content),
        ];
        let over: Vec<String> = rows
            .iter()
            .filter_map(|&(label, actual, cap)| {
                let cap = cap?;
                (actual as u64 > cap).then(|| format!("{label} {actual}/{cap}"))
            })
            .collect();
        match over.as_slice() {
            [] => Ok(()),
            _ => Err(invalid(format!(
                "AWC slot budget exceeded ({}): {}",
                self.slot,
                over.join(", ")
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::args::Options;
    use crate::error::Result;
    use crate::progress::Progress;
    use rage_res::awc;
    use rage_res::awc::NewStream;
    use rage_res::hash;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;

    const DATA: u8 = 0x55;
    const FORMAT: u8 = 0xfa;
    const PEAK: u8 = 0x36;

    fn format(samples: u32, rate: u16, codec: u8, peak: bool) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(samples.to_le_bytes());
        out.extend(0i32.to_le_bytes());
        out.extend(rate.to_le_bytes());
        out.extend(0i16.to_le_bytes());
        out.extend([0u8; 6]);
        out.push(0);
        out.push(codec);
        if peak {
            out.extend(0u32.to_le_bytes());
        }
        out
    }

    /// Поток PCM из `bytes` байт данных; содержимое задаёт `seed`.
    fn pcm_stream(id: u32, bytes: usize, seed: u8) -> NewStream {
        let data: Vec<u8> = (0..bytes).map(|i| seed.wrapping_add(i as u8)).collect();
        NewStream {
            id,
            chunks: vec![
                (DATA, data),
                (FORMAT, format((bytes / 2) as u32, 22050, 0, false)),
            ],
        }
    }

    fn bank(version: u16, flags: u16, streams: &[NewStream]) -> Vec<u8> {
        awc::encode(version, flags, streams).unwrap()
    }

    /// Размеры, подобранные так, чтобы совпасть с цифрами из таблиц описания.
    fn base3() -> Vec<u8> {
        bank(
            255,
            0xff00,
            &[
                pcm_stream(0x10, 240, 1),
                pcm_stream(0x20, 208, 2),
                pcm_stream(0x30, 272, 3),
            ],
        )
    }

    struct Lab {
        dir: tempfile::TempDir,
    }

    impl Lab {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.path(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path.display().to_string().replace('\\', "/")
        }

        fn run(&self, extra: &[&str], patches: &str) -> Result<Value> {
            self.put("patches.json", patches.as_bytes());
            let mut argv: Vec<String> = Vec::new();
            for (flag, default) in [
                ("--input", self.path("in.awc")),
                ("--output", self.path("out.awc")),
                ("--patches", self.path("patches.json")),
            ] {
                if !extra.contains(&flag) {
                    argv.push(flag.to_owned());
                    argv.push(default.display().to_string());
                }
            }
            argv.extend(extra.iter().map(|arg| arg.to_string()));
            let options = Options::parse(&argv)?;
            awc_stream_patch(&options, &Progress::silent())
        }
    }

    fn lab_with_sources() -> (Lab, String, String) {
        let lab = Lab::new();
        lab.put("in.awc", &base3());
        let src10 = lab.put(
            "p-src-10.awc",
            &bank(255, 0xff00, &[pcm_stream(0x10, 80, 9)]),
        );
        let src30 = lab.put(
            "p-src-30.awc",
            &bank(255, 0xff00, &[pcm_stream(0x30, 320, 7)]),
        );
        (lab, src10, src30)
    }

    fn patch_json(source: &str, streams: &str, drop: &str) -> String {
        format!(r#"[{{"source":"{source}","streams":{streams},"drop":{drop}}}]"#)
    }

    fn summary(value: &Value) -> (u64, u64, u64, u64) {
        (
            value["streams"].as_u64().unwrap(),
            value["bytes"].as_u64().unwrap(),
            value["headerBytes"].as_u64().unwrap(),
            value["metadataBytes"].as_u64().unwrap(),
        )
    }

    #[test]
    fn replace_one_matches_the_table_sizes() {
        let (lab, src10, _) = lab_with_sources();
        let value = lab
            .run(&[], &patch_json(&src10, r#"["0x10"]"#, "[]"))
            .unwrap();
        assert_eq!(summary(&value), (3, 704, 76, 60));
        assert_eq!(value["contentBytes"], 704);
        assert_eq!(value["replaced"], json!(["0x00000010"]));
        assert_eq!(value["dropped"], json!([]));
        let keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "input",
                "output",
                "streams",
                "replaced",
                "dropped",
                "bytes",
                "headerBytes",
                "metadataBytes",
                "contentBytes",
                "sha256"
            ]
        );
        let written = fs::read(lab.path("out.awc")).unwrap();
        assert_eq!(value["sha256"], hash::sha256_hex(&written));
        assert_eq!(value["output"], lab.path("out.awc").display().to_string());
        assert!(!lab.path("out.awc.shop-stage").exists());
    }

    #[test]
    fn replace_and_drop_and_two_layers() {
        let (lab, src10, src30) = lab_with_sources();
        let value = lab
            .run(&[], &patch_json(&src10, r#"["0x10"]"#, r#"["0x20"]"#))
            .unwrap();
        assert_eq!(summary(&value), (2, 448, 56, 40));
        assert_eq!(value["dropped"], json!(["0x00000020"]));

        let both = format!(
            r#"[{{"source":"{src10}","streams":["0x10"],"drop":[]}},{{"source":"{src30}","streams":["0x30"],"drop":["0x20"]}}]"#
        );
        let value = lab.run(&[], &both).unwrap();
        assert_eq!(summary(&value), (2, 496, 56, 40));
        assert_eq!(value["replaced"], json!(["0x00000010", "0x00000030"]));

        let reverse = format!(
            r#"[{{"source":"{src30}","streams":["0x30"],"drop":[]}},{{"source":"{src10}","streams":["0x10"],"drop":[]}}]"#
        );
        let value = lab.run(&[], &reverse).unwrap();
        assert_eq!(summary(&value), (3, 752, 76, 60));
        let sorted = lab
            .run(&[], &patch_json(&src30, r#"["0x30"]"#, "[]"))
            .unwrap();
        assert_eq!(summary(&sorted), (3, 912, 76, 60));
    }

    #[test]
    fn identifier_forms() {
        let (lab, src10, _) = lab_with_sources();
        let ok = |text: &str| {
            let streams = format!("[{}]", serde_json::to_string(text).unwrap());
            lab.run(&[], &patch_json(&src10, &streams, "[]"))
                .map(|value| value["replaced"].clone())
        };
        let ten = json!(["0x00000010"]);
        for text in [
            "16",
            "016",
            "0x0000000000000010",
            "0x10",
            "0X10",
            "+16",
            "  0x10  ",
            "0x00000000000000010",
            "0x00000010",
        ] {
            assert_eq!(ok(text).unwrap(), ten, "{text}");
        }
        for text in [
            "4294967296",
            "16.0",
            "１６",
            "0xZZ",
            "0x",
            "0x-10",
            "0x10000000000000000",
            "-16",
            "1e1",
            "abc",
            "1_6",
            "",
            "qq",
        ] {
            let error = ok(text).unwrap_err();
            assert_eq!(error.code, "InvalidDataException", "{text}");
            assert_eq!(
                error.message,
                format!("Invalid AWC stream identifier: {text}")
            );
        }
        assert_eq!(
            ok("  zz ").unwrap_err().message,
            "Invalid AWC stream identifier:   zz "
        );
        // Больше 29 бит: прежний код молча обрезал (`0x20000010` становился `0x10`), теперь отказ с причиной.
        for text in [
            "536870928",
            "0x20000010",
            "0xFFFFFF10",
            "4294967295",
            "0x100000010",
            "0xFFFFFFFFFFFFFFFF",
        ] {
            let error = ok(text).unwrap_err();
            assert_eq!(error.code, "InvalidDataException", "{text}");
            assert_eq!(
                error.message,
                format!("AWC stream identifier does not fit 29 bits: {text}")
            );
        }
        assert_eq!(
            ok("0x1FFFFFFF").unwrap_err().message,
            "AWC source does not contain stream 0x1FFFFFFF."
        );
        assert_eq!(
            ok("10").unwrap_err().message,
            "AWC source does not contain stream 0x0000000A."
        );
        let not_strings = [r#"[true]"#, "[null]", "[16]", "[{}]"];
        for list in not_strings {
            let error = lab.run(&[], &patch_json(&src10, list, "[]")).unwrap_err();
            assert_eq!(error.message, "Invalid AWC stream identifier: ");
        }
    }

    #[test]
    fn list_file_refusals() {
        let (lab, src10, _) = lab_with_sources();
        let broken = |text: &str| lab.run(&[], text).unwrap_err();
        for text in [
            "",
            "this is not json",
            "null",
            r#"{"source":"x"}"#,
            "\u{feff}[]",
        ] {
            let error = broken(text);
            assert_eq!(
                (error.code.as_str(), error.message.as_str()),
                ("InvalidDataException", "AWC patch list is empty or broken.")
            );
        }
        assert_eq!(
            broken("[]").message,
            "At least one AWC stream patch is required."
        );
        for text in ["[1,2]", "[null]", r#"["x"]"#] {
            let error = broken(text);
            assert_eq!(error.code, "FileNotFoundException");
            assert_eq!(error.message, "AWC patch source was not found.");
        }
        let missing = patch_json("nope.awc", r#"["0x10"]"#, "[]");
        assert_eq!(broken(&missing).message, "AWC patch source was not found.");
        let streams_absent = format!(r#"[{{"source":"{src10}"}}]"#);
        assert_eq!(
            broken(&streams_absent).message,
            "AWC patch has no declared streams."
        );
        let not_array = format!(r#"[{{"source":"{src10}","streams":"0x10"}}]"#);
        assert_eq!(
            broken(&not_array).message,
            "AWC patch has no declared streams."
        );
        // ошибка идентификатора в первой правке побеждает потерянный источник второй
        let first_wins = format!(
            r#"[{{"source":"{src10}","streams":["zz"]}},{{"source":"nope.awc","streams":["0x10"]}}]"#
        );
        assert_eq!(
            broken(&first_wins).message,
            "Invalid AWC stream identifier: zz"
        );
        // каталог на месте источника тоже «не найден»
        let dir = lab.path("dir-source");
        fs::create_dir(&dir).unwrap();
        let as_source = patch_json(
            &dir.display().to_string().replace('\\', "/"),
            r#"["0x10"]"#,
            "[]",
        );
        assert_eq!(
            broken(&as_source).message,
            "AWC patch source was not found."
        );
    }

    #[test]
    fn checksums() {
        let (lab, src10, src30) = lab_with_sources();
        let good = hash::sha256_hex(&fs::read(lab.path("p-src-10.awc")).unwrap());
        let with = |sum: &str| {
            format!(r#"[{{"source":"{src10}","streams":["0x10"],"drop":[],"sha256":{sum}}}]"#)
        };
        assert!(lab
            .run(&[], &with(&format!("\"{}\"", good.to_uppercase())))
            .is_ok());
        for skipped in ["true", "null", "5", r#""""#] {
            assert!(lab.run(&[], &with(skipped)).is_ok(), "{skipped}");
        }
        for wrong in [r#""aa""#, r#""abc""#, &format!("\"{}\"", "0".repeat(64))] {
            let error = lab.run(&[], &with(wrong)).unwrap_err();
            assert_eq!(error.code, "InvalidDataException");
            assert_eq!(error.message, "AWC patch checksum mismatch: p-src-10.awc");
        }
        let second = format!(
            r#"[{{"source":"{src10}","streams":["0x10"],"drop":[]}},{{"source":"{src30}","streams":["0x30"],"drop":[],"sha256":"ff"}}]"#
        );
        assert_eq!(
            lab.run(&[], &second).unwrap_err().message,
            "AWC patch checksum mismatch: p-src-30.awc"
        );
        let before_id = format!(r#"[{{"source":"{src10}","streams":["zz"],"sha256":"ff"}}]"#);
        assert_eq!(
            lab.run(&[], &before_id).unwrap_err().message,
            "AWC patch checksum mismatch: p-src-10.awc"
        );
    }

    #[test]
    fn limits_are_checked_after_assembly() {
        let (lab, src10, _) = lab_with_sources();
        let patches = patch_json(&src10, r#"["0x10"]"#, "[]");
        let limits = |body: &str| {
            let path = lab.put("limits.json", body.as_bytes());
            lab.run(&["--limits", &path], &patches)
        };
        let over = |body: &str| limits(body).unwrap_err();
        assert!(limits(r#"{"bytes":100000,"header":100000,"metadata":100000,"slot":"S"}"#).is_ok());
        assert!(limits(r#"{"bytes":704,"header":76,"metadata":60,"slot":"X"}"#).is_ok());
        for passing in [
            "{}",
            r#"{"bytes":1.5}"#,
            r#"{"bytes":-1}"#,
            r#"{"bytes":null}"#,
            r#"{"bytes":"1"}"#,
            "[1,2]",
            "null",
            "5",
        ] {
            assert!(limits(passing).is_ok(), "{passing}");
        }
        let all = over(r#"{"bytes":1,"header":1,"metadata":1,"slot":"ALL"}"#);
        assert_eq!(all.code, "InvalidDataException");
        assert_eq!(
            all.message,
            "AWC slot budget exceeded (ALL): header 76/1, metadata 60/1, content 704/1"
        );
        let reordered = over(r#"{"metadata":1,"header":1,"bytes":1}"#);
        assert_eq!(
            reordered.message,
            "AWC slot budget exceeded (slot): header 76/1, metadata 60/1, content 704/1"
        );
        assert_eq!(
            over(r#"{"bytes":703,"slot":"X"}"#).message,
            "AWC slot budget exceeded (X): content 704/703"
        );
        assert_eq!(
            over(r#"{"header":75,"slot":"X"}"#).message,
            "AWC slot budget exceeded (X): header 76/75"
        );
        assert_eq!(
            over(r#"{"metadata":59,"slot":"X"}"#).message,
            "AWC slot budget exceeded (X): metadata 60/59"
        );
        assert_eq!(
            over(r#"{"bytes":1,"slot":5}"#).message,
            "AWC slot budget exceeded (slot): content 704/1"
        );
        assert_eq!(
            over(r#"{"bytes":0}"#).message,
            "AWC slot budget exceeded (slot): content 704/0"
        );
        for broken in ["nope", ""] {
            assert_eq!(over(broken).message, "AWC slot limits are empty or broken.");
        }
        let _ = fs::remove_file(lab.path("out.awc"));
        let refused = over(r#"{"bytes":1}"#);
        assert_eq!(refused.code, "InvalidDataException");
        assert!(!lab.path("out.awc").exists());
    }

    #[test]
    fn limits_path_errors_come_after_assembly() {
        let (lab, src10, _) = lab_with_sources();
        let patches = patch_json(&src10, r#"["0x10"]"#, "[]");
        let missing = lab.path("nope.json").display().to_string();
        let error = lab.run(&["--limits", &missing], &patches).unwrap_err();
        assert_eq!(error.code, "FileNotFoundException");
        assert_eq!(error.message, format!("File was not found: {missing}"));
        let error = lab.run(&["--limits", ""], &patches).unwrap_err();
        assert_eq!(error.message, "The path is empty.");
        let txt = lab.put("limits.txt", b"{}");
        let error = lab.run(&["--limits", &txt], &patches).unwrap_err();
        assert_eq!(error.message, "Unsupported file extension: .txt");
        // сборка побеждает путь пределов
        let no_streams = patch_json(&src10, "[]", "[]");
        let error = lab.run(&["--limits", &missing], &no_streams).unwrap_err();
        assert_eq!(error.message, "AWC patch has no declared streams.");
        // последнее значение побеждает
        let bad = lab.put("bad.json", br#"{"bytes":1}"#);
        let good = lab.put("good.json", b"{}");
        assert!(lab
            .run(&["--limits", &bad, "--limits", &good], &patches)
            .is_ok());
    }

    #[test]
    fn composition_refusals_come_from_the_neighbor() {
        let (lab, src10, src30) = lab_with_sources();
        let refuse = |patches: String| lab.run(&[], &patches).unwrap_err();
        let op = "InvalidOperationException";
        let error = refuse(patch_json(&src10, r#"["0x10"]"#, r#"["0x99"]"#));
        assert_eq!(error.code, op);
        assert_eq!(
            error.message,
            "AWC base does not contain stream 0x00000099 to drop."
        );
        assert_eq!(
            refuse(patch_json(&src10, r#"["0x10"]"#, r#"["0x10"]"#)).message,
            "AWC stream 0x00000010 is claimed by multiple active layers."
        );
        assert_eq!(
            refuse(patch_json(&src10, r#"["0x10"]"#, r#"["0x20","0x20"]"#)).message,
            "AWC stream 0x00000020 is claimed by multiple active layers."
        );
        assert_eq!(
            refuse(patch_json(&src10, r#"["0x20"]"#, "[]")).message,
            "AWC source does not contain stream 0x00000020."
        );
        let twice = format!(
            r#"[{{"source":"{src30}","streams":["0x30"]}},{{"source":"{src30}","streams":["0x30"]}}]"#
        );
        assert_eq!(
            refuse(twice).message,
            "AWC stream 0x00000030 is claimed by multiple active layers."
        );
        let v2 = lab.put("p-src-v2.awc", &bank(2, 0xff00, &[pcm_stream(0x10, 80, 1)]));
        assert_eq!(
            refuse(patch_json(&v2, r#"["0x10"]"#, "[]")).message,
            "AWC: источник другой версии, чем основа."
        );
        let short = lab.put("x-short.awc", &[1, 2, 3]);
        assert_eq!(
            refuse(patch_json(&short, r#"["0x10"]"#, "[]")).message,
            "Файл короче заголовка AWC."
        );
        let mut foreign = bank(255, 0xff00, &[pcm_stream(0x10, 80, 1)]);
        foreign[..4].copy_from_slice(b"RIFF");
        let enc = lab.put("p-enc.awc", &foreign);
        assert_eq!(
            refuse(patch_json(&enc, r#"["0x10"]"#, "[]")).message,
            "AWC (источник): зашифрованный или многоканальный банк — пока на хосте."
        );
    }

    #[test]
    fn peaks_are_recomputed_for_24_byte_format() {
        let lab = Lab::new();
        let peaked = |samples: u32, data: usize| NewStream {
            id: 0x10,
            chunks: vec![
                (PEAK, vec![0; 8]),
                (DATA, vec![5u8; data]),
                (FORMAT, format(samples, 22050, 0, true)),
            ],
        };
        lab.put("in.awc", &bank(255, 0xff00, &[peaked(100, 200)]));
        let src = lab.put("src.awc", &bank(255, 0xff00, &[peaked(100, 200)]));
        let patches = patch_json(&src, r#"["0x10"]"#, "[]");
        let value = lab.run(&[], &patches).unwrap();
        assert_eq!(value["streams"], 1);
        let out = fs::read(lab.path("out.awc")).unwrap();
        assert_eq!(value["sha256"], hash::sha256_hex(&out));
        lab.put("in.awc", &bank(255, 0xff00, &[peaked(0, 200)]));
        let src0 = lab.put("src.awc", &bank(255, 0xff00, &[peaked(0, 200)]));
        let error = lab
            .run(&[], &patch_json(&src0, r#"["0x10"]"#, "[]"))
            .unwrap_err();
        assert_eq!(error.message, "AWC: пустой поток с пиком.");
    }

    #[test]
    fn output_handling() {
        let (lab, src10, _) = lab_with_sources();
        let patches = patch_json(&src10, r#"["0x10"]"#, "[]");
        // каталог, созданный отказавшей командой, не остаётся (раньше оставался пустым)
        let made = lab.path("made/by/failure/out.awc").display().to_string();
        let missing = lab.path("missing.json").display().to_string();
        let error = lab
            .run(&["--output", &made, "--patches", &missing], &patches)
            .unwrap_err();
        assert_eq!(error.message, format!("File was not found: {missing}"));
        assert!(!lab.path("made").exists());
        // несуществующий вход отказывает до создания каталога
        let nope = lab.path("nope.awc").display().to_string();
        let early = lab.path("made2/out.awc").display().to_string();
        let error = lab
            .run(&["--input", &nope, "--output", &early], &patches)
            .unwrap_err();
        assert_eq!(error.code, "FileNotFoundException");
        assert!(!lab.path("made2").exists());
        // расширения
        let bank_ext = lab.path("out.bank").display().to_string();
        assert_eq!(
            lab.run(&["--output", &bank_ext], &patches)
                .unwrap_err()
                .message,
            "Unsupported output extension: .bank"
        );
        let upper = lab.path("OUT.AWC").display().to_string();
        assert!(lab.run(&["--output", &upper], &patches).is_ok());
        assert!(lab.path("OUT.AWC").is_file());
        // выход совпадает со входом
        let same = lab.path("in.awc").display().to_string();
        let value = lab.run(&["--output", &same], &patches).unwrap();
        assert_eq!(
            fs::read(lab.path("in.awc")).unwrap().len() as u64,
            value["bytes"]
        );
        // выход занят каталогом
        let dir_out = lab.path("dir.awc");
        fs::create_dir(&dir_out).unwrap();
        let error = lab
            .run(&["--output", &dir_out.display().to_string()], &patches)
            .unwrap_err();
        assert_eq!(error.code, "UnauthorizedAccessException");
        assert!(!lab.path("dir.awc.shop-stage").exists());
    }

    #[test]
    fn parameter_refusals() {
        let (lab, src10, _) = lab_with_sources();
        let patches = patch_json(&src10, r#"["0x10"]"#, "[]");
        let build = |args: &[&str]| -> Result<Value> {
            lab.put("patches.json", patches.as_bytes());
            let argv: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
            awc_stream_patch(&Options::parse(&argv)?, &Progress::silent())
        };
        assert_eq!(build(&[]).unwrap_err().message, "--input is required.");
        let input = lab.path("in.awc").display().to_string();
        assert_eq!(
            build(&["--input", &input]).unwrap_err().message,
            "--output is required."
        );
        let out = lab.path("out.awc").display().to_string();
        assert_eq!(
            build(&["--input", &input, "--output", &out])
                .unwrap_err()
                .message,
            "--patches is required."
        );
        assert_eq!(
            build(&["--input", &input, "--output", ""])
                .unwrap_err()
                .message,
            "The path is empty."
        );
        let parent_file = lab.put("file", b"x");
        let nested = format!("{parent_file}/out.awc");
        assert_eq!(
            build(&["--input", &input, "--output", &nested])
                .unwrap_err()
                .code,
            "IOException"
        );
    }
}
