//! `lamp-plan`: проверка плана правки света фонаря без записи на диск.
//!
//! Запрос лежит в JSON-файле и оборачивается в `Request`: его вопросы к тексту
//! (режим, пара LOD, файл, сумма) отвечают списком «условие, отказ». Потом
//! читается `.yft`, и каждая правка репетируется над копией света в порядке
//! возрастания номера.

use rage_res::lamp_light::Light;
use serde_json::Value;

use super::lamp_mutations::{apply, refuse, Mutation};
use crate::{args::Options, error::Result, progress::Progress};

/// Запрос плана: корень JSON, любой формы.
struct Request(Value);

impl Request {
    fn read(given: &str) -> Result<Self> {
        let file = crate::paths::existing_file(given, &[".json"])?;
        let bytes = std::fs::read(file)?;
        match serde_json::from_slice(&bytes) {
            Ok(root) => Ok(Self(root)),
            Err(_) => Err(refuse("Запрос плана света не читается")),
        }
    }

    /// Строка по ключу; всё, что не строка, читается как пустая.
    fn text(&self, key: &str) -> &str {
        self.0.get(key).and_then(Value::as_str).unwrap_or("")
    }

    /// Первое нарушенное условие среди тех, которым диск не нужен.
    fn gap_before_disk(&self) -> Option<&'static str> {
        let root = &self.0;
        let conditions: [(bool, &str); 4] = [
            (
                root.get("mode").and_then(Value::as_str) == Some("lamp-plan"),
                "Запрос плана света другого режима",
            ),
            (
                matches!(root.get("lodInputFile"), None | Some(Value::Null)),
                "План пары LOD",
            ),
            (
                matches!(root.get("inputFile"), Some(Value::String(_))),
                "План света без файла",
            ),
            (
                self.text("inputFile").to_lowercase().ends_with(".yft"),
                "План света — только .yft",
            ),
        ];
        first_failed(&conditions)
    }

    fn gap_after_disk(&self) -> Option<&'static str> {
        let shaped = super::lamp_mutations::is_sha256(self.text("expectedInputSha256"));
        first_failed(&[(shaped, "SHA-256 базы")])
    }
}

fn first_failed(conditions: &[(bool, &'static str)]) -> Option<&'static str> {
    conditions
        .iter()
        .find_map(|&(holds, what)| (!holds).then_some(what))
}

pub fn lamp_plan(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = Request::read(options.required("input")?)?;
    if let Some(what) = request.gap_before_disk() {
        return Err(refuse(what));
    }
    let input = crate::paths::existing_file(request.text("inputFile"), &[".yft"])?;
    if let Some(what) = request.gap_after_disk() {
        return Err(refuse(what));
    }
    let mutations = super::lamp_mutations::mutations_of(request.0.get("lampHdMutations"))?;

    let bytes = std::fs::read(&input)?;
    let digest = rage_res::hash::sha256_hex(&bytes);
    if !digest.eq_ignore_ascii_case(request.text("expectedInputSha256")) {
        return Err(refuse("SHA-256 базы не совпал"));
    }

    let parsed = rage_res::resource::Resource::parse(&bytes)?;
    let lights: Vec<Light> = rage_res::lamp_light::fragment_lights(&parsed)?
        .into_iter()
        .map(|found| found.0)
        .collect();
    let planned = rehearse_all(&lights, mutations)?;

    let validation = [
        ("readOnly", true),
        ("exactInputSha256", true),
        ("exactLightFingerprints", true),
        ("immutableFieldsPreserved", true),
    ];
    let pairs: [(&str, Value); 7] = [
        ("status", "ready".into()),
        ("mode", "lamp-plan".into()),
        ("edition", "legacy".into()),
        ("input", input.display().to_string().into()),
        ("inputSha256", digest.into()),
        ("plannedLightIndices", planned.into()),
        ("validation", flags(validation)),
    ];
    Ok(pairs
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect::<serde_json::Map<String, Value>>()
        .into())
}

/// Объект из логических пар в заданном порядке.
fn flags<const N: usize>(pairs: [(&str, bool); N]) -> Value {
    let mut map = serde_json::Map::new();
    for (key, on) in pairs {
        map.insert(key.to_owned(), Value::Bool(on));
    }
    Value::Object(map)
}

/// Правки по возрастанию номера света; результат — номера в том же порядке.
fn rehearse_all(lights: &[Light], mut mutations: Vec<Mutation>) -> Result<Vec<usize>> {
    mutations.sort_by_key(|mutation| mutation.light_index);
    let mut planned = Vec::with_capacity(mutations.len());
    for mutation in &mutations {
        planned.push(rehearse(lights, mutation)?);
    }
    Ok(planned)
}

/// Одна правка на копии света: номер в списке, отпечаток, пределы; неизменяемая часть остаётся прежней.
fn rehearse(lights: &[Light], mutation: &Mutation) -> Result<usize> {
    let slot = mutation.light_index;
    let Some(original) = lights.get(slot) else {
        return Err(refuse("Номер света вне списка фрагмента"));
    };
    original.check_finite(slot)?;
    let current = original.fingerprint();
    if !current.eq_ignore_ascii_case(&mutation.expected_fingerprint) {
        return Err(refuse("Отпечаток света изменился"));
    }
    let mut draft = *original;
    apply(&mut draft, mutation)?;
    match draft.immutable_fingerprint() == original.immutable_fingerprint() {
        true => Ok(slot),
        false => Err(refuse("План правит неизменяемые поля света")),
    }
}

pub const COMMANDS: &[super::Command] = &[super::Command::new("lamp-plan", lamp_plan)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use rage_res::hash::sha256_hex;
    use rage_res::lamp_light::fragment_lights;
    use rage_res::lamp_light::LIGHT_BYTES;
    use rage_res::resource::Resource;
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};

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

    /// Фрагмент: корень 0x120 байт, список света сразу за ним.
    fn fragment(lights: &[Light]) -> Vec<u8> {
        let mut body = vec![0u8; 0x120 + lights.len() * LIGHT_BYTES];
        body[0x110..0x118].copy_from_slice(&0x5000_0120u64.to_le_bytes());
        body[0x118..0x11a].copy_from_slice(&(lights.len() as u16).to_le_bytes());
        for (index, light) in lights.iter().enumerate() {
            let from = 0x120 + index * LIGHT_BYTES;
            light.encode(&mut body[from..from + LIGHT_BYTES]);
        }
        let shift = (0..16u32)
            .find(|s| (0x200usize << s) >= body.len())
            .expect("размер");
        let mut out = Vec::new();
        for word in [0x3743_5352u32, 0xa2, 0xa800_0000 | shift, 0x2000_0000] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.extend(rage_res::resource::deflate_zlib9(&body));
        out
    }

    struct Bench {
        dir: tempfile::TempDir,
        yft: PathBuf,
        sha: String,
    }

    impl Bench {
        fn new() -> Self {
            Self::with(&syn4())
        }

        fn with(lights: &[Light]) -> Self {
            let dir = tempfile::tempdir().expect("папка");
            let yft = dir.path().join("syn-4.yft");
            let bytes = fragment(lights);
            fs::write(&yft, &bytes).expect("запись");
            let sha = sha256_hex(&bytes);
            Self { dir, yft, sha }
        }

        fn fp(&self, index: usize) -> String {
            let found = fragment_lights(
                &Resource::parse(&fs::read(&self.yft).expect("файл")).expect("ресурс"),
            )
            .expect("свет");
            found[index].0.fingerprint()
        }

        /// Запрос по образцу описания: `inputFile` и сумма подставлены, правки заданы.
        fn request(&self, mutations: Value) -> Value {
            json!({
                "mode": "lamp-plan",
                "inputFile": self.yft.display().to_string(),
                "expectedInputSha256": self.sha,
                "lampHdMutations": mutations,
            })
        }

        fn color_of_one(&self) -> Value {
            json!([{"lightIndex": 1, "expectedFingerprint": self.fp(1), "color": {"r": 1, "g": 2, "b": 3}}])
        }

        fn run_text(&self, text: &str) -> (Value, i32) {
            let file = self.dir.path().join("req.json");
            fs::write(&file, text).expect("запись");
            self.run_file(&file)
        }

        fn run(&self, request: &Value) -> (Value, i32) {
            self.run_text(&request.to_string())
        }

        fn run_file(&self, file: &Path) -> (Value, i32) {
            let argv = vec![
                "lamp-plan".to_owned(),
                "--input".to_owned(),
                file.display().to_string(),
            ];
            let outcome = crate::run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).expect("JSON"),
                outcome.exit_code,
            )
        }
    }

    fn refused(response: &Value) -> (String, String) {
        (
            response["error"]["code"].as_str().unwrap_or("").to_owned(),
            response["error"]["message"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
        )
    }

    /// Отказ на не конечном числе света: код и текст соседа (раньше здесь была паника «научная запись»).
    fn non_finite(text: &str) -> (String, String) {
        ("InvalidOperationException".to_owned(), text.to_owned())
    }

    fn host(what: &str) -> (String, String) {
        (
            "ArgumentException".to_owned(),
            format!("{what}: пока на хосте."),
        )
    }

    #[test]
    fn one_color_edit_is_planned() {
        let bench = Bench::new();
        let (response, code) = bench.run(&bench.request(bench.color_of_one()));
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["command"], "lamp-plan");
        let expected = json!({
            "status": "ready", "mode": "lamp-plan", "edition": "legacy",
            "input": bench.yft.display().to_string(), "inputSha256": bench.sha,
            "plannedLightIndices": [1],
            "validation": {"readOnly": true, "exactInputSha256": true, "exactLightFingerprints": true, "immutableFieldsPreserved": true},
        });
        assert_eq!(response["result"], expected);
        let keys: Vec<&String> = response["result"]
            .as_object()
            .expect("объект")
            .keys()
            .collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "edition",
                "input",
                "inputSha256",
                "plannedLightIndices",
                "validation"
            ]
        );
    }

    #[test]
    fn edits_run_in_ascending_order_whatever_the_request_order() {
        let bench = Bench::new();
        let edits = json!([
            {"lightIndex": 3, "expectedFingerprint": bench.fp(3), "intensity": 7},
            {"lightIndex": 0, "expectedFingerprint": bench.fp(0), "falloff": 6},
        ]);
        let (response, _) = bench.run(&bench.request(edits));
        assert_eq!(response["result"]["plannedLightIndices"], json!([0, 3]));
        // Свет 0 проверяется первым: отпечаток света 3 неверен, но предел света 0 нарушен раньше.
        let mixed = json!([
            {"lightIndex": 3, "expectedFingerprint": "a".repeat(64)},
            {"lightIndex": 0, "expectedFingerprint": bench.fp(0), "intensity": -1},
        ]);
        assert_eq!(
            refused(&bench.run(&bench.request(mixed)).0),
            host("Значение света вне предела")
        );
        let outside = json!([
            {"lightIndex": 7, "expectedFingerprint": "a".repeat(64)},
            {"lightIndex": 1, "expectedFingerprint": bench.fp(1), "intensity": -1},
        ]);
        assert_eq!(
            refused(&bench.run(&bench.request(outside)).0),
            host("Значение света вне предела")
        );
    }

    #[test]
    fn all_field_groups_and_uppercase_digits_pass() {
        let bench = Bench::new();
        let everything = json!([{
            "lightIndex": 2, "expectedFingerprint": bench.fp(2).to_uppercase(),
            "color": {"r": 10, "g": 20, "b": 30}, "intensity": 55.5, "falloff": 12, "falloffExponent": 64,
            "coronaIntensity": 2.5, "coronaSize": 4, "coronaZBias": -1.5, "volumeIntensity": 0.25,
            "volumeSizeScale": 2, "volumeOuterColor": {"r": 1, "g": 2, "b": 3}, "volumeOuterIntensity": 3,
            "volumeOuterExponent": 2, "lightFadeDistance": 77, "volumetricFadeDistance": 88,
            "flagsValue": 5, "ownedFlagsMask": 15,
        }]);
        let mut request = bench.request(everything);
        request["expectedInputSha256"] = json!(bench.sha.to_uppercase());
        let (response, code) = bench.run(&request);
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["plannedLightIndices"], json!([2]));
        // Сумма в ответе строчная, хотя запрос дал прописную.
        assert_eq!(response["result"]["inputSha256"], bench.sha);
    }

    #[test]
    fn extra_keys_and_null_lod_are_ignored_but_other_lod_values_refuse() {
        let bench = Bench::new();
        let mut request = bench.request(bench.color_of_one());
        request["note"] = json!("x");
        request["lodInputFile"] = Value::Null;
        assert_eq!(bench.run(&request).1, 0);
        for lod in [json!("x.ymap"), json!(""), json!(false), json!(0)] {
            request["lodInputFile"] = lod;
            assert_eq!(refused(&bench.run(&request).0), host("План пары LOD"));
        }
        // Побеждает LOD, хотя `inputFile` нет.
        let bare = json!({"mode": "lamp-plan", "lodInputFile": "x", "lampHdMutations": []});
        assert_eq!(refused(&bench.run(&bare).0), host("План пары LOD"));
    }

    #[test]
    fn nan_in_an_unnamed_light_is_not_fingerprinted_but_in_a_named_one_it_is_refused() {
        let mut nan = lamp(1, 1, [1, 2, 3], 5.0);
        let healthy = lamp(2, 1, [4, 5, 6], 6.0);
        nan.intensity = f32::NAN;
        let bench = Bench::with(&[healthy, nan]);
        let first = json!([{"lightIndex": 0, "expectedFingerprint": bench.fp(0)}]);
        let (response, code) = bench.run(&bench.request(first));
        assert_eq!(
            (code, &response["result"]["plannedLightIndices"]),
            (0, &json!([0]))
        );
        let second = json!([{"lightIndex": 1, "expectedFingerprint": "a".repeat(64)}]);
        let (response, code) = bench.run(&bench.request(second));
        assert_eq!(code, 1);
        // Раньше здесь паника «научная запись» (InternalError).
        assert_eq!(
            refused(&response),
            non_finite("Свет 1: поле intensity не число (NaN или бесконечность).")
        );
    }

    #[test]
    fn request_file_failures() {
        let bench = Bench::new();
        let run_arg = |args: &[&str]| {
            let argv: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            let outcome = crate::run(&argv, &Progress::silent());
            serde_json::from_str::<Value>(&outcome.line).expect("JSON")
        };
        assert_eq!(refused(&run_arg(&["lamp-plan"])).1, "--input is required.");
        let missing = bench.dir.path().join("none.json");
        let response = run_arg(&["lamp-plan", "--input", &missing.display().to_string()]);
        assert_eq!(
            refused(&response),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {}", missing.display())
            )
        );
        let text = bench.dir.path().join("req.txt");
        fs::write(&text, "{}").expect("запись");
        let response = run_arg(&["lamp-plan", "--input", &text.display().to_string()]);
        assert_eq!(
            refused(&response),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .txt".to_owned()
            )
        );
        assert_eq!(
            refused(&run_arg(&["lamp-plan", "--input", ""])).1,
            "The path is empty."
        );
        // Расширение запроса без учёта регистра.
        let upper = bench.dir.path().join("req.JSON");
        fs::write(&upper, bench.request(bench.color_of_one()).to_string()).expect("запись");
        assert_eq!(bench.run_file(&upper).1, 0);
        // Каталог вместо файла.
        let folder = bench.dir.path().join("dir.json");
        fs::create_dir(&folder).expect("папка");
        assert_eq!(
            refused(&bench.run_file(&folder).0).0,
            "FileNotFoundException"
        );
    }

    #[test]
    fn unreadable_requests_and_wrong_modes() {
        let bench = Bench::new();
        let unreadable = host("Запрос плана света не читается");
        for text in [
            "",
            "not json",
            "{\"mode\":\"lamp-plan\",}",
            "\u{feff}{\"mode\":\"lamp-plan\"}",
            "{\"mode\":\"lamp-plan\"} x",
            "{\"mode\":\"lamp-plan\",\"x\":1e999}",
        ] {
            assert_eq!(refused(&bench.run_text(text).0), unreadable, "{text:?}");
        }
        let other = host("Запрос плана света другого режима");
        for text in [
            "[]",
            "null",
            "\"lamp-plan\"",
            "{}",
            "{\"mode\":5}",
            "{\"mode\":\"Lamp-Plan\"}",
            "{\"mode\":\"lamp-plan \"}",
            "{\"mode\":\"lamp-patch\"}",
        ] {
            assert_eq!(refused(&bench.run_text(text).0), other, "{text:?}");
        }
    }

    #[test]
    fn input_file_rules_come_in_their_order() {
        let bench = Bench::new();
        let mut request = bench.request(bench.color_of_one());
        let without = host("План света без файла");
        let only_yft = host("План света — только .yft");
        for (value, expected) in [
            (Value::Null, &without),
            (json!(5), &without),
            (json!(""), &only_yft),
            (json!("syn-2.ydr"), &only_yft),
            (json!(format!("{} ", bench.yft.display())), &only_yft),
        ] {
            request["inputFile"] = value;
            assert_eq!(&refused(&bench.run(&request).0), expected);
        }
        request.as_object_mut().expect("объект").remove("inputFile");
        assert_eq!(refused(&bench.run(&request).0), without);
        // Отсутствие файла — без слов «пока на хосте».
        let absent = bench.dir.path().join("absent.yft");
        request["inputFile"] = json!(absent.display().to_string());
        assert_eq!(
            refused(&bench.run(&request).0),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {}", absent.display())
            )
        );
        // Файл не найден побеждает отсутствующую сумму.
        request
            .as_object_mut()
            .expect("объект")
            .remove("expectedInputSha256");
        assert_eq!(refused(&bench.run(&request).0).0, "FileNotFoundException");
        // Путь с точками и прямыми слэшами сворачивается.
        let tricky = format!("{}/x/../syn-4.yft", bench.dir.path().display());
        let mut good = bench.request(bench.color_of_one());
        good["inputFile"] = json!(tricky);
        let (response, _) = bench.run(&good);
        assert_eq!(response["result"]["input"], bench.yft.display().to_string());
        let upper = bench.dir.path().join("UP.YFT");
        fs::copy(&bench.yft, &upper).expect("копия");
        good["inputFile"] = json!(upper.display().to_string());
        assert_eq!(bench.run(&good).1, 0);
    }

    #[test]
    fn checksum_shape_then_edit_list_then_checksum_value() {
        let bench = Bench::new();
        let shape = host("SHA-256 базы");
        for value in [
            Value::Null,
            json!(5),
            json!(&bench.sha[1..]),
            json!(format!("{}0", bench.sha)),
            json!(format!("g{}", &bench.sha[1..])),
            json!(format!("0x{}", &bench.sha[2..])),
        ] {
            let mut request = bench.request(bench.color_of_one());
            request["expectedInputSha256"] = value;
            assert_eq!(refused(&bench.run(&request).0), shape);
        }
        let mut request = bench.request(bench.color_of_one());
        request
            .as_object_mut()
            .expect("объект")
            .remove("expectedInputSha256");
        assert_eq!(refused(&bench.run(&request).0), shape);
        let mut flipped = bench.sha.clone();
        flipped.pop();
        flipped.push(if bench.sha.ends_with('0') { '1' } else { '0' });
        let mut request = bench.request(bench.color_of_one());
        request["expectedInputSha256"] = json!(flipped);
        assert_eq!(
            refused(&bench.run(&request).0),
            host("SHA-256 базы не совпал")
        );
        // Список правок пуст, сумма не совпадает: побеждает список; сумма не той длины — побеждает сумма.
        let mut empty = bench.request(json!([]));
        empty["expectedInputSha256"] = json!("a".repeat(64));
        assert_eq!(
            refused(&bench.run(&empty).0),
            host("Число правок вне 1…256")
        );
        empty["expectedInputSha256"] = json!("abc");
        assert_eq!(refused(&bench.run(&empty).0), shape);
    }

    #[test]
    fn edit_list_failures_come_from_the_neighbor() {
        let bench = Bench::new();
        let fp1 = bench.fp(1);
        let cases = [
            (Value::Null, "Нет правок света"),
            (json!({}), "Нет правок света"),
            (json!([]), "Число правок вне 1…256"),
            (
                json!([{"lightIndex": 1, "expectedFingerprint": fp1}, {"lightIndex": 1, "expectedFingerprint": fp1, "intensity": 3}]),
                "Номер света в плане повторяется",
            ),
            (
                json!([{"lightIndex": "1", "expectedFingerprint": fp1}]),
                "Номер света",
            ),
            (
                json!([{"lightIndex": 1, "expectedFingerprint": "abc"}]),
                "Отпечаток света",
            ),
            (
                json!([{"lightIndex": 1, "expectedFingerprint": fp1, "color": {"r": 1, "g": 2}}]),
                "Цвет правки",
            ),
            (
                json!([{"lightIndex": 1, "expectedFingerprint": fp1}, {"lightIndex": 1, "expectedFingerprint": fp1, "intensity": "x"}]),
                "Число правки",
            ),
        ];
        for (mutations, what) in cases {
            let mut request = bench.request(mutations.clone());
            if mutations.is_null() {
                request
                    .as_object_mut()
                    .expect("объект")
                    .remove("lampHdMutations");
            }
            assert_eq!(refused(&bench.run(&request).0), host(what), "{what}");
        }
        let many: Vec<Value> = (0..257)
            .map(|i| json!({"lightIndex": i, "expectedFingerprint": fp1}))
            .collect();
        assert_eq!(
            refused(&bench.run(&bench.request(Value::Array(many))).0),
            host("Число правок вне 1…256")
        );
    }

    #[test]
    fn light_level_failures() {
        let bench = Bench::new();
        let (fp1, fp2) = (bench.fp(1), bench.fp(2));
        let run = |edit: Value| refused(&bench.run(&bench.request(json!([edit]))).0);
        assert_eq!(
            run(json!({"lightIndex": 4, "expectedFingerprint": "a".repeat(64)})),
            host("Номер света вне списка фрагмента")
        );
        assert_eq!(
            run(
                json!({"lightIndex": 18446744073709551615u64, "expectedFingerprint": "a".repeat(64)})
            ),
            host("Номер света вне списка фрагмента")
        );
        assert_eq!(
            run(json!({"lightIndex": 1, "expectedFingerprint": fp2})),
            host("Отпечаток света изменился")
        );
        assert_eq!(
            run(json!({"lightIndex": 1, "expectedFingerprint": "0".repeat(64)})),
            host("Отпечаток света изменился")
        );
        assert_eq!(
            run(json!({"lightIndex": 1, "expectedFingerprint": fp1, "intensity": 100001})),
            host("Значение света вне предела")
        );
        assert_eq!(
            run(json!({"lightIndex": 1, "expectedFingerprint": fp1, "flagsValue": 1})),
            host("Флаги и маска — вместе")
        );
        assert_eq!(
            run(
                json!({"lightIndex": 1, "expectedFingerprint": fp1, "flagsValue": 3, "ownedFlagsMask": 1})
            ),
            host("Флаги вне своей маски")
        );
        // Отпечаток побеждает предел той же правки.
        assert_eq!(
            run(
                json!({"lightIndex": 1, "expectedFingerprint": "a".repeat(64), "intensity": 100001})
            ),
            host("Отпечаток света изменился")
        );
        // Правка без полей и правка флагов в своей маске годятся.
        assert_eq!(
            bench
                .run(&bench.request(json!([{"lightIndex": 0, "expectedFingerprint": bench.fp(0)}])))
                .1,
            0
        );
        assert_eq!(bench.run(&bench.request(json!([{"lightIndex": 1, "expectedFingerprint": fp1, "flagsValue": 5, "ownedFlagsMask": 15}]))).1, 0);
    }

    #[test]
    fn broken_resources_and_missing_lights() {
        let dir = tempfile::tempdir().expect("папка");
        let make = |name: &str, bytes: &[u8]| {
            let file = dir.path().join(name);
            fs::write(&file, bytes).expect("запись");
            Bench {
                dir: tempfile::tempdir().expect("папка"),
                sha: sha256_hex(bytes),
                yft: file,
            }
        };
        let edit = json!([{"lightIndex": 1, "expectedFingerprint": "a".repeat(64), "color": {"r": 1, "g": 2, "b": 3}}]);
        let invalid = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        let bad_magic = make("bad-magic.yft", &[7u8; 64]);
        assert_eq!(
            refused(&bad_magic.run(&bad_magic.request(edit.clone())).0),
            invalid("Файл не является ресурсом RSC7.")
        );
        let empty = make("bad-empty.yft", b"");
        assert_eq!(
            refused(&empty.run(&empty.request(edit.clone())).0),
            invalid("Ресурс короче заголовка RSC7.")
        );
        // В файле нет света.
        let none = make("syn-0.yft", &fragment(&[]));
        assert_eq!(
            refused(&none.run(&none.request(edit)).0),
            host("Номер света вне списка фрагмента")
        );
        // Число света больше тела.
        let mut body = vec![0u8; 0x120 + LIGHT_BYTES];
        body[0x110..0x118].copy_from_slice(&0x5000_0120u64.to_le_bytes());
        body[0x118..0x11a].copy_from_slice(&5000u16.to_le_bytes());
        let mut raw = fragment(&[]);
        raw.truncate(16);
        raw.extend(rage_res::resource::deflate_zlib9(&body));
        let big = make("syn-bigcount.yft", &raw);
        let edit = json!([{"lightIndex": 1, "expectedFingerprint": "a".repeat(64)}]);
        assert_eq!(
            refused(&big.run(&big.request(edit)).0),
            invalid("Чтение за концом данных ресурса.")
        );
    }
}
