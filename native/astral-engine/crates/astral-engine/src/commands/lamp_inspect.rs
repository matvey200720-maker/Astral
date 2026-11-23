//! `lamp-inspect`: опись источников света одного `.yft` (фрагмент) или `.ydr` (рисовалка).
//!
//! Читатель выбирается по хвосту текста пути, а не по содержимому файла: таблица
//! `READERS` говорит, какой список света открывать и как собрать описание.
//! Текст света готовит `Light::describe`, здесь он разбирается обратно в JSON.

use rage_res::resource::Resource;
use serde_json::{Map, Value};

use crate::{args::Options, error::Result, progress::Progress};

/// Читатель одного вида файла.
struct Reader {
    /// Расширение без точки; сравнивается без учёта регистра ASCII.
    suffix: &'static str,
    asset_kind: &'static str,
    /// Чей это массив света (есть только у фрагмента).
    owner: Option<&'static str>,
    /// Тексты описи всех светов списка по порядку.
    texts: fn(&Resource) -> Result<Vec<String>>,
}

static READERS: [Reader; 2] = [
    Reader {
        suffix: "yft",
        asset_kind: "yft-fragment",
        owner: Some("FragType.LightAttributes"),
        texts: fragment_texts,
    },
    Reader {
        suffix: "ydr",
        asset_kind: "ydr-drawable",
        owner: None,
        texts: drawable_texts,
    },
];

fn fragment_texts(resource: &Resource) -> Result<Vec<String>> {
    let found = rage_res::lamp_light::fragment_lights(resource)?;
    Ok(found
        .into_iter()
        .zip(0..)
        .map(|((light, model), index)| -> Result<String> {
            light.check_described(index, model)?;
            Ok(light.describe(index, model))
        })
        .collect::<Result<Vec<_>>>()?)
}

fn drawable_texts(resource: &Resource) -> Result<Vec<String>> {
    let Some(root) = resource.at(rage_res::resource::SYSTEM_BASE) else {
        return Err(super::lamp_mutations::refuse("Ресурс без корня"));
    };
    let found = rage_res::lamp_light::drawable_lights(resource, root)?;
    Ok(found
        .iter()
        .zip(0..)
        .map(|(light, index)| -> Result<String> {
            light.check_finite(index)?;
            Ok(light.describe(index, None))
        })
        .collect::<Result<Vec<_>>>()?)
}

/// Читатель по хвосту после последней точки всей строки (без точек — вся строка).
fn reader_for(text: &str) -> Option<&'static Reader> {
    let tail = text.rsplit('.').next().unwrap_or(text);
    READERS
        .iter()
        .find(|reader| tail.eq_ignore_ascii_case(reader.suffix))
}

/// Файл описи по значению `--input`: сам путь к `.yft`/`.ydr` или запрос приложения (`.json`).
///
/// Приложение зовёт все `lamp-*` одинаково: запрос лежит файлом, в `--input` его путь
/// (`tryLampOnEngine`, `rpf-composer.js`), а описываемый файл назван в запросе полем `inputFile`.
/// Путь к ресурсу без `.json` остаётся прежним способом вызова (стенды и тесты).
fn described_file(given: &str) -> Result<String> {
    let is_request = given
        .rsplit_once('.')
        .is_some_and(|(_, tail)| tail.eq_ignore_ascii_case("json"));
    if !is_request {
        return Ok(given.to_owned());
    }
    let request = crate::paths::existing_file(given, &[".json"])?;
    let root: Value = serde_json::from_slice(&std::fs::read(request)?)
        .map_err(|_| super::lamp_mutations::refuse("Запрос описи света не читается"))?;
    match root.get("inputFile").and_then(Value::as_str) {
        Some(file) if !file.trim().is_empty() => Ok(file.to_owned()),
        _ => Err(super::lamp_mutations::refuse(
            "В запросе описи света нет inputFile",
        )),
    }
}

pub fn lamp_inspect(options: &Options, _progress: &Progress) -> Result<Value> {
    let named = described_file(options.required("input")?)?;
    let given = named.as_str();
    let Some(reader) = reader_for(given) else {
        return Err(super::lamp_mutations::refuse(
            "Опись света — только .yft и .ydr",
        ));
    };
    let dotted = format!(".{}", reader.suffix);
    let path = crate::paths::existing_file(given, &[dotted.as_str()])?;
    let bytes = std::fs::read(&path)?;
    let texts = (reader.texts)(&Resource::parse(&bytes)?)?;

    let pairs: [(&str, Value); 7] = [
        ("status", "ready".into()),
        ("mode", "lamp-inspect".into()),
        ("edition", "legacy".into()),
        ("input", path.display().to_string().into()),
        ("bytes", bytes.len().into()),
        ("sha256", rage_res::hash::sha256_hex(&bytes).into()),
        ("inventory", inventory(reader, &texts)?),
    ];
    Ok(object(pairs))
}

/// Объект из пар «ключ, значение» в том же порядке.
fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Объект `inventory`: владелец массива идёт сразу после вида файла, если он есть.
fn inventory(reader: &Reader, texts: &[String]) -> Result<Value> {
    let lights =
        texts.iter().try_fold(Vec::new(), |mut done, text| {
            match serde_json::from_str::<Value>(text) {
                Ok(light) => {
                    done.push(light);
                    Ok(done)
                }
                Err(_) => Err(crate::error::EngineError::new(
                    "lamp-inspect",
                    "Опись света не собралась.",
                )),
            }
        })?;
    let mut map = Map::new();
    map.insert("assetKind".into(), reader.asset_kind.into());
    if let Some(owner) = reader.owner {
        map.insert("lightArrayOwner".into(), owner.into());
    }
    map.insert("lightCount".into(), lights.len().into());
    map.insert("lights".into(), Value::Array(lights));
    Ok(Value::Object(map))
}

pub const COMMANDS: &[super::Command] = &[super::Command::new("lamp-inspect", lamp_inspect)];

#[cfg(test)]
mod tests {
    use crate::progress::Progress;
    use rage_res::lamp_light::{Light, LIGHT_BYTES};
    use serde_json::{json, Value};
    use std::fs;
    use std::path::Path;

    /// Запись света с теми же значениями по умолчанию, что у собранных образцов описания.
    fn lamp(kind: u8, flags: u32, color: [u8; 3], intensity: f32) -> Light {
        let mut light = Light::decode(&[0u8; LIGHT_BYTES]).expect("запись");
        light.kind = kind;
        light.flags = flags;
        light.color = color;
        light.intensity = intensity;
        light.time_flags = 15_728_703;
        light.position = [0.0, 0.0, 5.0];
        light.falloff = 18.0;
        light.falloff_exponent = 96.0;
        light.volume_intensity = 1.0;
        light.volume_size_scale = 1.0;
        light.volume_outer_color = [255, 255, 255];
        light.volume_outer_intensity = 1.0;
        light.volume_outer_exponent = 1.0;
        light.corona_intensity = 0.1;
        light.corona_size = 3.0;
        light.corona_z_bias = 0.1;
        light.direction = [0.0, 0.0, -1.0];
        light.tangent = [1.0, 0.0, 0.0];
        light.cone_inner_angle = 10.0;
        light.cone_outer_angle = 70.0;
        light.extent = [1.0, 1.0, 1.0];
        light
    }

    /// Тело ресурса: корень 0x120 байт, затем записи света; список указан на `list_at`, `count` на `+0x118`.
    fn body_with(
        lights: &[Light],
        list_offset: usize,
        count_field: u16,
        root_at: usize,
    ) -> Vec<u8> {
        let mut body = vec![0u8; list_offset + lights.len() * LIGHT_BYTES];
        let pointer = 0x5000_0000u64 + list_offset as u64;
        body[root_at + 0x110..root_at + 0x118].copy_from_slice(&pointer.to_le_bytes());
        body[root_at + 0x118..root_at + 0x11a].copy_from_slice(&count_field.to_le_bytes());
        for (index, light) in lights.iter().enumerate() {
            let from = list_offset + index * LIGHT_BYTES;
            light.encode(&mut body[from..from + LIGHT_BYTES]);
        }
        body
    }

    /// Файл RSC7: одна системная страница нужного размера, поток deflate.
    fn rsc7(version: u32, body: &[u8]) -> Vec<u8> {
        let shift = (0..16u32)
            .find(|s| (0x200usize << s) >= body.len())
            .expect("размер");
        let mut out = Vec::new();
        for word in [
            0x3743_5352u32,
            version,
            0x0800_0000 | (version << 28 & 0xf000_0000) | shift,
            0x2000_0000,
        ] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.extend(rage_res::resource::deflate_zlib9(body));
        out
    }

    fn fragment(lights: &[Light]) -> Vec<u8> {
        rsc7(0xa2, &body_with(lights, 0x120, lights.len() as u16, 0))
    }

    /// Рисовалка: список на `+0xb0`, число на `+0xb8`.
    fn drawable(lights: &[Light]) -> Vec<u8> {
        let mut body = vec![0u8; 0x100 + lights.len() * LIGHT_BYTES];
        let pointer = 0x5000_0100u64;
        body[0xb0..0xb8].copy_from_slice(&pointer.to_le_bytes());
        body[0xb8..0xba].copy_from_slice(&(lights.len() as u16).to_le_bytes());
        for (index, light) in lights.iter().enumerate() {
            let from = 0x100 + index * LIGHT_BYTES;
            light.encode(&mut body[from..from + LIGHT_BYTES]);
        }
        rsc7(0xa5, &body)
    }

    fn run_command(args: &[&str]) -> (Value, i32) {
        let argv: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        let outcome = crate::run(&argv, &Progress::silent());
        (
            serde_json::from_str(&outcome.line).expect("одна строка JSON"),
            outcome.exit_code,
        )
    }

    fn inspect(path: &Path) -> (Value, i32) {
        run_command(&["lamp-inspect", "--input", &path.display().to_string()])
    }

    /// Отказ на не конечном числе света: код и текст соседа (раньше здесь была паника «научная запись»).
    fn non_finite(text: &str) -> (String, String) {
        ("InvalidOperationException".to_owned(), text.to_owned())
    }

    fn failure(response: &Value) -> (String, String) {
        let error = &response["error"];
        (
            error["code"].as_str().unwrap_or_default().to_owned(),
            error["message"].as_str().unwrap_or_default().to_owned(),
        )
    }

    /// Четыре света образца `syn-4.yft`: точечный, прожектор с костью, капсула, серый с нулевыми флагами.
    fn syn4() -> Vec<Light> {
        let mut point = lamp(1, 1, [255, 0, 0], 10.0);
        point.falloff = 5.0;
        point.falloff_exponent = 2.0;
        let mut spot = lamp(2, 1408, [0, 255, 0], 32.0);
        spot.bone_id = 5;
        spot.position = [1.5, -2.25, 3.125];
        let mut capsule = lamp(4, 0xffff_ffff, [0, 0, 255], 1.0);
        capsule.extent = [2.0, 3.0, 4.0];
        let mut gray = lamp(2, 0, [9, 9, 9], 0.5);
        gray.falloff = 0.5;
        gray.falloff_exponent = 1.0;
        gray.volume_intensity = 0.0;
        gray.corona_size = 0.0;
        vec![point, spot, capsule, gray]
    }

    #[test]
    fn four_lights_of_a_fragment_match_the_documented_fingerprints() {
        let dir = tempfile::tempdir().expect("папка");
        let file = dir.path().join("syn-4.yft");
        fs::write(&file, fragment(&syn4())).expect("запись");
        let (response, code) = inspect(&file);
        assert_eq!(code, 0, "{response}");
        let lights = &response["result"]["inventory"]["lights"];
        let expected = [
            (
                "12b5f77630e2da00b6d5f16c1fb6dc9cf5290da17928b73d648db0c56ed11609",
                "b51ec009f0f93bc75fabe6f39db6fe57cbe54d3a82001ab36cfac46ef92da3dc",
            ),
            (
                "db8705db372ce7a86b83dd7e2bc0a2b20698d25b12f1c8a7f31d8a199e8e6224",
                "38df6c83bad67e105c8e90e12ea12f45716f37ca174564c04edbc9d4c2d9aeba",
            ),
            (
                "05bb6e6a63e679bc760503f625a6e8a77312b5979f54915b631dea69550aefae",
                "1880dcec7cca246b063d7f67be3cba88a29d9290476e0f901ed87dc10ea08a5a",
            ),
            (
                "67f991d63381305dfe82b2e813d0ae50f0f8ad625f826ffa3671b5ff8f4a3867",
                "7e9e1a05afac44daf4642bc1974446760736d92c27691b0955d9b6cb1fa3448b",
            ),
        ];
        for (index, (fingerprint, immutable)) in expected.iter().enumerate() {
            assert_eq!(lights[index]["fingerprint"], *fingerprint, "свет {index}");
            assert_eq!(
                lights[index]["immutableFingerprint"], *immutable,
                "свет {index}"
            );
        }
        assert_eq!(lights[2]["type"], "capsule");
        assert_eq!(lights[2]["flags"], 4_294_967_295u64);
        assert_eq!(lights[1]["boneTag"], 5);
        assert_eq!(
            response["result"]["inventory"]["lightArrayOwner"],
            "FragType.LightAttributes"
        );
        assert_eq!(response["result"]["inventory"]["lightCount"], 4);
    }

    #[test]
    fn key_order_of_the_answer_and_of_a_light_is_fixed() {
        let dir = tempfile::tempdir().expect("папка");
        let file = dir.path().join("one.yft");
        fs::write(&file, fragment(&syn4()[..1])).expect("запись");
        let (response, _) = inspect(&file);
        let top: Vec<&str> = response["result"]
            .as_object()
            .expect("объект")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            top,
            [
                "status",
                "mode",
                "edition",
                "input",
                "bytes",
                "sha256",
                "inventory"
            ]
        );
        let inventory: Vec<&str> = response["result"]["inventory"]
            .as_object()
            .expect("объект")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            inventory,
            ["assetKind", "lightArrayOwner", "lightCount", "lights"]
        );
        let light: Vec<&str> = response["result"]["inventory"]["lights"][0]
            .as_object()
            .expect("объект")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            light,
            [
                "index",
                "fingerprint",
                "immutableFingerprint",
                "boneTag",
                "type",
                "flags",
                "timeFlags",
                "position",
                "modelPosition",
                "color",
                "intensity",
                "falloff",
                "falloffExponent",
                "lightFadeDistance",
                "volume",
                "corona",
                "direction",
                "tangent",
                "coneInnerAngle",
                "coneOuterAngle",
                "extent",
                "projectedTextureHash",
            ]
        );
        assert_eq!(response["result"]["input"], file.display().to_string());
    }

    #[test]
    fn drawable_has_null_model_position_and_no_owner() {
        let dir = tempfile::tempdir().expect("папка");
        let file = dir.path().join("syn-2.ydr");
        let mut first = lamp(1, 1408, [255, 200, 100], 20.0);
        first.bone_id = 7;
        let mut second = lamp(2, 1408, [1, 2, 3], 20.0);
        second.position = [4.0, 5.0, 6.0];
        fs::write(&file, drawable(&[first, second])).expect("запись");
        let (response, code) = inspect(&file);
        assert_eq!(code, 0, "{response}");
        let inventory = &response["result"]["inventory"];
        assert_eq!(inventory["assetKind"], "ydr-drawable");
        assert!(inventory.get("lightArrayOwner").is_none());
        assert_eq!(inventory["lightCount"], 2);
        assert!(inventory["lights"][0]["modelPosition"].is_null());
        assert_eq!(inventory["lights"][0]["boneTag"], 7);
        assert_eq!(
            response["result"]["bytes"],
            fs::metadata(&file).expect("файл").len()
        );
    }

    #[test]
    fn empty_lists_give_an_empty_array() {
        let dir = tempfile::tempdir().expect("папка");
        let file = dir.path().join("none.yft");
        fs::write(&file, fragment(&[])).expect("запись");
        let (response, _) = inspect(&file);
        assert_eq!(response["result"]["inventory"]["lightCount"], 0);
        assert_eq!(response["result"]["inventory"]["lights"], json!([]));
        // Фрагмент без списка: указатель 0.
        let mut body = body_with(&[], 0x120, 0, 0);
        body[0x110..0x118].fill(0);
        let bare = dir.path().join("bare.yft");
        fs::write(&bare, rsc7(0xa2, &body)).expect("запись");
        assert_eq!(inspect(&bare).0["result"]["inventory"]["lightCount"], 0);
    }

    #[test]
    #[allow(clippy::excessive_precision)]
    fn numbers_keep_the_standard_serde_json_spelling() {
        let dir = tempfile::tempdir().expect("папка");
        let file = dir.path().join("odd.yft");
        let mut a = lamp(2, 1408, [255, 200, 100], 1.0e15);
        a.falloff = 1.0e16;
        a.corona_intensity = f32::MAX;
        a.corona_size = 1.0e-5;
        let mut b = lamp(2, 1408, [255, 200, 100], -0.0);
        b.falloff = 16_777_216.0;
        b.falloff_exponent = 0.1;
        b.volume_intensity = f32::from_bits(1);
        b.corona_z_bias = 123_456.79;
        let mut c = lamp(2, 1408, [255, 200, 100], 2539.90625);
        c.falloff = 4620.03125;
        c.falloff_exponent = 0.3;
        c.direction = [-1.410179e-7, 0.0001, 0.00009999];
        fs::write(&file, fragment(&[a, b, c])).expect("запись");
        let raw = {
            let outcome = crate::run(
                &[
                    "lamp-inspect".to_owned(),
                    "--input".to_owned(),
                    file.display().to_string(),
                ],
                &Progress::silent(),
            );
            outcome.line
        };
        for expected in [
            "\"intensity\":1000000000000000.0",
            "\"falloff\":1e+16",
            "\"intensity\":3.4028235e+38",
            "\"size\":0.00001",
            "\"intensity\":-0.0",
            "\"falloff\":16777216",
            "\"intensity\":1.0000000000000001e-45",
            "\"zBias\":123456.79",
            "\"intensity\":2539.9062",
            "\"falloff\":4620.0312",
            "\"x\":-1.410179e-7",
            "\"z\":0.00009999",
        ] {
            assert!(raw.contains(expected), "нет {expected} в {raw}");
        }
    }

    #[test]
    fn branch_is_chosen_by_the_name_not_by_the_content() {
        let dir = tempfile::tempdir().expect("папка");
        let as_ydr = dir.path().join("frag.ydr");
        fs::write(&as_ydr, fragment(&syn4())).expect("запись");
        let (response, _) = inspect(&as_ydr);
        assert_eq!(response["result"]["inventory"]["assetKind"], "ydr-drawable");
        assert_eq!(response["result"]["inventory"]["lightCount"], 0);
        let as_yft = dir.path().join("draw.yft");
        fs::write(&as_yft, drawable(&syn4()[..2])).expect("запись");
        let (response, _) = inspect(&as_yft);
        assert_eq!(response["result"]["inventory"]["assetKind"], "yft-fragment");
        assert_eq!(response["result"]["inventory"]["lightCount"], 0);
        let upper = dir.path().join("UPPER.YFT");
        fs::write(&upper, fragment(&syn4()[..1])).expect("запись");
        assert_eq!(inspect(&upper).0["result"]["inventory"]["lightCount"], 1);
    }

    #[test]
    fn extension_is_judged_by_the_text_before_the_disk() {
        let host = "Опись света — только .yft и .ydr: пока на хосте.";
        for given in [
            "C:\\x\\lamp.ymap",
            "C:\\x\\a.txt",
            "noext",
            "trailingdot.",
            "",
            "   ",
            "C:\\x.yft\\name",
            "a.yft ",
            "a.yft.bak",
        ] {
            let (response, code) = run_command(&["lamp-inspect", "--input", given]);
            assert_eq!(code, 1, "{given}");
            assert_eq!(
                failure(&response),
                ("ArgumentException".to_owned(), host.to_owned()),
                "{given}"
            );
        }
        let (response, _) = run_command(&["lamp-inspect"]);
        assert_eq!(failure(&response).1, "--input is required.");
    }

    /// Так `lamp-inspect` зовёт приложение (16.11.2026): в `--input` лежит запрос JSON, как у остальных `lamp-*`,
    /// описываемый файл — в его поле `inputFile`. До правки движок отказывал «только .yft и .ydr: пока на хосте».
    #[test]
    fn the_request_json_of_the_app_names_the_file_to_describe() {
        let dir = tempfile::tempdir().expect("папка");
        let model = dir.path().join("prop_lamp.yft");
        fs::write(&model, fragment(&syn4())).expect("запись");
        let by_path = inspect(&model);
        assert_eq!(by_path.1, 0);

        let write_request = |name: &str, body: Value| {
            let file = dir.path().join(name);
            fs::write(&file, body.to_string()).expect("запись");
            file
        };
        let request = write_request(
            "request.json",
            serde_json::json!({
                "mode": "lamp-inspect",
                "gameRoot": "C:\\Games\\GTA V",
                "edition": "Legacy",
                "inputFile": model.display().to_string(),
            }),
        );
        let by_request = inspect(&request);
        assert_eq!(by_request.1, 0, "{:?}", by_request.0);
        assert_eq!(by_request.0, by_path.0);

        // Запрос на `.ydr` берёт читатель рисовалки, как и путь напрямую.
        let drawable_file = dir.path().join("prop_lamp.ydr");
        fs::write(&drawable_file, drawable(&syn4()[..2])).expect("запись");
        let request = write_request(
            "request-ydr.JSON",
            serde_json::json!({ "inputFile": drawable_file.display().to_string() }),
        );
        assert_eq!(
            inspect(&request).0["result"]["inventory"]["assetKind"],
            "ydr-drawable"
        );

        // Запрос без имени файла и запрос не про свет отказывают словами, а не молчат.
        let nameless = write_request("nameless.json", serde_json::json!({ "mode": "lamp-inspect" }));
        assert_eq!(
            failure(&inspect(&nameless).0),
            (
                "ArgumentException".to_owned(),
                "В запросе описи света нет inputFile: пока на хосте.".to_owned()
            )
        );
        let foreign = write_request(
            "foreign.json",
            serde_json::json!({ "inputFile": dir.path().join("lamp.ymap").display().to_string() }),
        );
        assert_eq!(
            failure(&inspect(&foreign).0).1,
            "Опись света — только .yft и .ydr: пока на хосте."
        );
        let broken = dir.path().join("broken.json");
        fs::write(&broken, "{").expect("запись");
        assert_eq!(
            failure(&inspect(&broken).0).1,
            "Запрос описи света не читается: пока на хосте."
        );
    }

    #[test]
    fn missing_file_and_bare_extension_name() {
        let dir = tempfile::tempdir().expect("папка");
        let missing = dir.path().join("absent.yft");
        let (response, _) = inspect(&missing);
        assert_eq!(failure(&response).0, "FileNotFoundException");
        assert_eq!(
            failure(&response).1,
            format!("File was not found: {}", missing.display())
        );
        let folder = dir.path().join("folder.yft");
        fs::create_dir(&folder).expect("папка");
        assert_eq!(failure(&inspect(&folder).0).0, "FileNotFoundException");
        // Файл, названный целиком `.yft`: расширения у пути нет.
        let bare = dir.path().join(".yft");
        fs::write(&bare, fragment(&[])).expect("запись");
        assert_eq!(
            failure(&inspect(&bare).0),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: ".to_owned()
            )
        );
    }

    #[test]
    fn broken_resources_report_the_neighbor_text() {
        let dir = tempfile::tempdir().expect("папка");
        let case = |name: &str, bytes: &[u8]| {
            let file = dir.path().join(name);
            fs::write(&file, bytes).expect("запись");
            failure(&inspect(&file).0)
        };
        let invalid = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        assert_eq!(
            case("empty.yft", b""),
            invalid("Ресурс короче заголовка RSC7.")
        );
        assert_eq!(
            case("short.yft", b"RSC7"),
            invalid("Ресурс короче заголовка RSC7.")
        );
        assert_eq!(
            case("magic.yft", &[0u8; 40]),
            invalid("Файл не является ресурсом RSC7.")
        );
        let mut header_only = fragment(&[]);
        header_only.truncate(16);
        assert_eq!(
            case("head.yft", &header_only),
            invalid("Поток ресурса пуст или не распакован.")
        );
        let mut huge = fragment(&[]);
        huge[8..12].copy_from_slice(&0xa8ff_ffffu32.to_le_bytes());
        assert_eq!(
            case("huge.yft", &huge),
            invalid("Ресурс заявляет больше 256 МБ.")
        );
        // Число света больше тела.
        let big = rsc7(0xa2, &body_with(&syn4()[..1], 0x120, 5000, 0));
        assert_eq!(
            case("big.yft", &big),
            invalid("Чтение за концом данных ресурса.")
        );
    }

    #[test]
    fn non_finite_numbers_are_refused_by_light_and_field() {
        let dir = tempfile::tempdir().expect("папка");
        for (name, value) in [
            ("nan", f32::NAN),
            ("inf", f32::INFINITY),
            ("neg", f32::NEG_INFINITY),
        ] {
            let file = dir.path().join(format!("{name}.yft"));
            let mut light = lamp(1, 1, [1, 2, 3], 5.0);
            light.intensity = value;
            fs::write(&file, fragment(&[light])).expect("запись");
            let (response, code) = inspect(&file);
            assert_eq!(code, 1);
            // Раньше соседняя запись числа паниковала («научная запись») и ответ был InternalError.
            assert_eq!(
                failure(&response),
                non_finite("Свет 0: поле intensity не число (NaN или бесконечность)."),
                "{name}"
            );
        }
    }

    #[test]
    fn repeated_and_uppercase_option_names() {
        let dir = tempfile::tempdir().expect("папка");
        let one = dir.path().join("one.yft");
        let none = dir.path().join("none.yft");
        fs::write(&one, fragment(&syn4()[..1])).expect("запись");
        fs::write(&none, fragment(&[])).expect("запись");
        let (response, _) = run_command(&[
            " LAMP-Inspect ",
            "--input",
            &none.display().to_string(),
            "--INPUT",
            &one.display().to_string(),
            "--other",
            "x",
        ]);
        assert_eq!(response["command"], "lamp-inspect");
        assert_eq!(response["result"]["inventory"]["lightCount"], 1);
        // Прямые слэши и `..` сворачиваются.
        let tricky = format!("{}/sub/../one.yft", dir.path().display());
        let (response, _) = run_command(&["lamp-inspect", "--input", &tricky]);
        assert_eq!(response["result"]["input"], one.display().to_string());
    }
}
