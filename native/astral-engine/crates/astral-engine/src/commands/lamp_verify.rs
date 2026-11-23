//! `lamp-verify`: сверка собранного фонаря с планом правки, без записи на диск.
//!
//! Свет входа и свет выхода сравниваются по номеру: у света без правки
//! отпечаток обязан совпасть, у света с правкой совпадает неизменяемая часть
//! и каждое названное поле. Правки с номером за пределами списка молча
//! проходят и попадают в ответ.

use std::collections::BTreeMap;

use rage_res::lamp_light::Light;
use serde_json::{Map, Value};

use super::lamp_mutations::{assert_applied, is_sha256, mutations_of, refuse, Mutation};
use crate::error::Result;

/// Условие должно выполняться, иначе отказ с этим текстом.
fn require(holds: bool, what: &str) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(refuse(what))
    }
}

/// Имена двух файлов запроса, уже проверенные по форме.
struct Files<'a> {
    input: &'a str,
    output: &'a str,
}

impl<'a> Files<'a> {
    fn of(root: &'a Value) -> Result<Self> {
        let text = |key: &str| root.get(key).and_then(Value::as_str);
        require(
            text("mode") == Some("lamp-verify"),
            "Запрос проверки света другого режима",
        )?;
        let input = text("inputFile").ok_or_else(|| refuse("Проверка света без входного файла"))?;
        let output =
            text("outputFile").ok_or_else(|| refuse("Проверка света без выходного файла"))?;
        let yft = |name: &str| name.to_lowercase().ends_with(".yft");
        require(yft(input) && yft(output), "Проверка света — только .yft")?;
        require(
            !input.eq_ignore_ascii_case(output),
            "Вход и выход проверки совпали",
        )?;
        Ok(Self { input, output })
    }
}

/// Ожидаемая сумма входа: строка из 64 шестнадцатеричных цифр.
fn checksum_of(root: &Value) -> Result<&str> {
    match root.get("expectedInputSha256") {
        Some(Value::String(text)) if is_sha256(text) => Ok(text),
        _ => Err(refuse("SHA-256 базы")),
    }
}

/// Один из двух файлов: байты и свет в них.
struct Side {
    bytes: Vec<u8>,
    lights: Vec<Light>,
}

pub fn lamp_verify(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Result<Value> {
    let root = read_request(options.required("input")?)?;
    let files = Files::of(&root)?;
    let mutations = mutations_of(root.get("lampHdMutations"))?;
    let expected = checksum_of(&root)?;

    let [input, output] =
        [files.input, files.output].map(|name| crate::paths::existing_file(name, &[".yft"]));
    let [input_bytes, output_bytes] = [input?, output?].map(std::fs::read);
    let (input_bytes, output_bytes) = (input_bytes?, output_bytes?);
    let input_sha = rage_res::hash::sha256_hex(&input_bytes);
    require(
        input_sha.eq_ignore_ascii_case(expected),
        "SHA-256 базы не совпал",
    )?;

    let before = Side {
        lights: lights_of(&input_bytes)?,
        bytes: input_bytes,
    };
    let after = Side {
        lights: lights_of(&output_bytes)?,
        bytes: output_bytes,
    };
    match (before.lights.len(), after.lights.len()) {
        (0, _) | (_, 0) => return Err(refuse("В фрагменте нет света")),
        (was, now) if was != now => return Err(refuse("Число источников света изменилось")),
        _ => {}
    }

    let planned = mutations
        .iter()
        .fold(BTreeMap::new(), |mut by_index, mutation| {
            by_index.insert(mutation.light_index, mutation);
            by_index
        });
    (0..before.lights.len()).try_for_each(|slot| {
        verdict(
            slot,
            &before.lights[slot],
            &after.lights[slot],
            planned.get(&slot).copied(),
        )
    })?;
    // Раньше номер света, которого нет в файле, не проверялся, но попадал в verifiedLightIndices: ответ называл проверенным то,
    // чего не было. Теперь такая правка отказывает тем же текстом, что lamp-plan и lamp-patch (после остальных проверок).
    if planned
        .keys()
        .next_back()
        .is_some_and(|&last| last >= before.lights.len())
    {
        return Err(refuse("Номер света вне списка фрагмента"));
    }

    Ok(answer(
        &input_sha,
        &after.bytes,
        planned.keys().copied().collect(),
    ))
}

fn answer(input_sha: &str, output: &[u8], verified: Value) -> Value {
    let validated = [
        "reopened",
        "exactInputSha256",
        "exactLightFingerprints",
        "lightTopologyPreserved",
        "immutableFieldsPreserved",
        "unownedLightsPreserved",
    ];
    let flags: Map<String, Value> = validated
        .iter()
        .map(|key| ((*key).to_owned(), Value::Bool(true)))
        .collect();
    let pairs: [(&str, Value); 7] = [
        ("status", "ready".into()),
        ("mode", "lamp-verify".into()),
        ("edition", "legacy".into()),
        ("inputSha256", input_sha.into()),
        ("outputSha256", rage_res::hash::sha256_hex(output).into()),
        ("verifiedLightIndices", verified),
        ("validation", flags.into()),
    ];
    Map::from_iter(pairs.map(|(key, value)| (key.to_owned(), value))).into()
}

/// Приговор одному месту списка: есть правка или её нет. Проверки идут по одной, не разом:
/// отпечаток, который не нужен, не считается.
fn verdict(slot: usize, old: &Light, new: &Light, planned: Option<&Mutation>) -> Result<()> {
    old.check_finite(slot)?;
    let Some(mutation) = planned else {
        new.check_finite(slot)?;
        return require(
            old.fingerprint() == new.fingerprint(),
            "Свет без правки изменился",
        );
    };
    let known = old.fingerprint();
    require(
        known.eq_ignore_ascii_case(&mutation.expected_fingerprint),
        "Отпечаток базы не совпал",
    )?;
    new.check_finite(slot)?;
    require(
        old.immutable_fingerprint() == new.immutable_fingerprint(),
        "Правка тронула неизменяемые поля света",
    )?;
    assert_applied(new, mutation)
}

fn read_request(given: &str) -> Result<Value> {
    let bytes = std::fs::read(crate::paths::existing_file(given, &[".json"])?)?;
    match serde_json::from_slice(&bytes) {
        Ok(root) => Ok(root),
        Err(_) => Err(refuse("Запрос проверки света не читается")),
    }
}

fn lights_of(file: &[u8]) -> Result<Vec<Light>> {
    let parsed = rage_res::resource::Resource::parse(file)?;
    let found = rage_res::lamp_light::fragment_lights(&parsed)?;
    Ok(found.into_iter().map(|(light, _)| light).collect())
}

pub const COMMANDS: &[super::Command] = &[super::Command::new("lamp-verify", lamp_verify)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use rage_res::hash::sha256_hex;
    use rage_res::lamp_light::LIGHT_BYTES;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

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
        input: PathBuf,
        sha: String,
        base: Vec<Light>,
        outputs: std::cell::Cell<usize>,
    }

    impl Bench {
        fn new() -> Self {
            Self::with(syn4())
        }

        fn with(base: Vec<Light>) -> Self {
            let dir = tempfile::tempdir().expect("папка");
            let input = dir.path().join("syn-4.yft");
            let bytes = fragment(&base);
            fs::write(&input, &bytes).expect("запись");
            Self {
                dir,
                input,
                sha: sha256_hex(&bytes),
                base,
                outputs: std::cell::Cell::new(0),
            }
        }

        fn fp(&self, index: usize) -> String {
            self.base[index].fingerprint()
        }

        /// Выход: копия света входа с правкой `change` у света `index`.
        fn out_with(&self, index: usize, change: impl Fn(&mut Light)) -> String {
            let mut lights = self.base.clone();
            change(&mut lights[index]);
            self.put_next(&fragment(&lights))
        }

        /// Новый файл выхода с очередным номером в имени.
        fn put_next(&self, bytes: &[u8]) -> String {
            self.outputs.set(self.outputs.get() + 1);
            self.put(&format!("out-{}.yft", self.outputs.get()), bytes)
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.dir.path().join(name);
            fs::write(&path, bytes).expect("запись");
            path.display().to_string()
        }

        fn request(&self, output: &str, mutations: Value) -> Value {
            json!({
                "mode": "lamp-verify",
                "inputFile": self.input.display().to_string(),
                "outputFile": output,
                "expectedInputSha256": self.sha,
                "lampHdMutations": mutations,
            })
        }

        fn color_edit(&self) -> Value {
            json!([{"lightIndex": 1, "expectedFingerprint": self.fp(1), "color": {"r": 1, "g": 2, "b": 3}}])
        }

        fn run(&self, request: &Value) -> (Value, i32) {
            self.run_text(&request.to_string())
        }

        fn run_text(&self, text: &str) -> (Value, i32) {
            let file = self.dir.path().join("req.json");
            fs::write(&file, text).expect("запись");
            let argv = vec![
                "lamp-verify".to_owned(),
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

    fn recolor(light: &mut Light) {
        light.color = [1, 2, 3];
    }

    #[test]
    fn a_recolored_light_verifies_and_the_answer_has_no_paths() {
        let bench = Bench::new();
        let output = bench.out_with(1, recolor);
        let (response, code) = bench.run(&bench.request(&output, bench.color_edit()));
        assert_eq!(code, 0, "{response}");
        let result = &response["result"];
        assert_eq!(result["inputSha256"], bench.sha);
        assert_eq!(
            result["outputSha256"],
            sha256_hex(&fs::read(&output).expect("файл"))
        );
        assert_eq!(result["verifiedLightIndices"], json!([1]));
        let keys: Vec<&String> = result.as_object().expect("объект").keys().collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "edition",
                "inputSha256",
                "outputSha256",
                "verifiedLightIndices",
                "validation"
            ]
        );
        let validation: Vec<&String> = result["validation"]
            .as_object()
            .expect("объект")
            .keys()
            .collect();
        assert_eq!(
            validation,
            [
                "reopened",
                "exactInputSha256",
                "exactLightFingerprints",
                "lightTopologyPreserved",
                "immutableFieldsPreserved",
                "unownedLightsPreserved"
            ]
        );
    }

    #[test]
    fn several_edits_numbers_are_sorted_and_out_of_range_ones_are_refused() {
        let bench = Bench::new();
        let mut lights = bench.base.clone();
        lights[3].intensity = 7.0;
        lights[0].falloff = 6.0;
        let output = bench.put("out.yft", &fragment(&lights));
        let edits = json!([
            {"lightIndex": 3, "expectedFingerprint": bench.fp(3), "intensity": 7},
            {"lightIndex": 0, "expectedFingerprint": bench.fp(0), "falloff": 6},
        ]);
        assert_eq!(
            bench.run(&bench.request(&output, edits)).0["result"]["verifiedLightIndices"],
            json!([0, 3])
        );

        let copy = bench.put("copy.yft", &fragment(&bench.base));
        let unordered = json!([
            {"lightIndex": 3, "expectedFingerprint": bench.fp(3)},
            {"lightIndex": 0, "expectedFingerprint": bench.fp(0)},
            {"lightIndex": 2, "expectedFingerprint": bench.fp(2)},
        ]);
        assert_eq!(
            bench.run(&bench.request(&copy, unordered)).0["result"]["verifiedLightIndices"],
            json!([0, 2, 3])
        );

        let output = bench.out_with(1, recolor);
        let beyond = json!([
            {"lightIndex": 1, "expectedFingerprint": bench.fp(1), "color": {"r": 1, "g": 2, "b": 3}},
            {"lightIndex": 9, "expectedFingerprint": "a".repeat(64), "intensity": 5},
        ]);
        // Раньше номер света, которого нет в файле, не проверялся и всё равно попадал в verifiedLightIndices ([1, 9]):
        // ответ называл проверенным то, чего не было. Теперь отказ тем же текстом, что у lamp-plan и lamp-patch.
        assert_eq!(
            refused(&bench.run(&bench.request(&output, beyond)).0),
            host("Номер света вне списка фрагмента")
        );
        let huge =
            json!([{"lightIndex": 18446744073709551615u64, "expectedFingerprint": "a".repeat(64)}]);
        let (response, code) = bench.run(&bench.request(&copy, huge));
        assert_eq!(code, 1, "{response}");
        assert_eq!(refused(&response), host("Номер света вне списка фрагмента"));
        // Номер вне списка, а свет 1 изменён: он «без правки».
        let outside = json!([{"lightIndex": 9, "expectedFingerprint": "a".repeat(64)}]);
        assert_eq!(
            refused(&bench.run(&bench.request(&output, outside)).0),
            host("Свет без правки изменился")
        );
    }

    #[test]
    fn exact_bit_comparison_and_flag_rules() {
        let bench = Bench::new();
        let edit_at = |index: usize, fields: Value| {
            let mut base = json!({"lightIndex": index, "expectedFingerprint": bench.fp(index)});
            base.as_object_mut()
                .expect("объект")
                .extend(fields.as_object().expect("объект").clone());
            json!([base])
        };
        let edit = |fields: Value| edit_at(1, fields);
        let check = |output: &str, mutations: Value| bench.run(&bench.request(output, mutations));
        // Яркость целым числом совпадает с битами выхода, лишнее изменение цвета не проверяется.
        let out = bench.out_with(1, |l| l.intensity = 20.0);
        assert_eq!(check(&out, edit(json!({"intensity": 20}))).1, 0);
        let out = bench.out_with(1, |l| {
            l.intensity = 20.0;
            l.color = [1, 2, 3];
        });
        assert_eq!(check(&out, edit(json!({"intensity": 20}))).1, 0);
        // Яркость выхода на один бит больше.
        let out = bench.out_with(1, |l| l.intensity = f32::from_bits(20.0f32.to_bits() + 1));
        assert_eq!(
            refused(&check(&out, edit(json!({"intensity": 20}))).0),
            host("Правка не легла в свет точно")
        );
        // Минус нуль и плюс нуль различаются побитно.
        let negative = bench.out_with(1, |l| l.intensity = -0.0);
        let positive = bench.out_with(1, |l| l.intensity = 0.0);
        let negated = check(&negative, edit(json!({"intensity": -0.0})));
        assert_eq!(negated.1, 0, "{}", negated.0);
        assert_eq!(
            refused(&check(&positive, edit(json!({"intensity": -0.0}))).0),
            host("Правка не легла в свет точно")
        );
        // Пределы здесь не проверяются.
        let out = bench.out_with(1, |l| l.intensity = 1_000_000.0);
        assert_eq!(check(&out, edit(json!({"intensity": 1000000}))).1, 0);
        // Цвет и яркость в правке, а выход только с цветом.
        let out = bench.out_with(1, recolor);
        assert_eq!(
            refused(
                &check(
                    &out,
                    edit(json!({"color": {"r": 1, "g": 2, "b": 3}, "intensity": 77}))
                )
                .0
            ),
            host("Правка не легла в свет точно")
        );
        // Выход без изменений при правке цвета.
        let copy = bench.put("copy.yft", &fragment(&bench.base));
        assert_eq!(
            refused(&check(&copy, bench.color_edit()).0),
            host("Правка не легла в свет точно")
        );
        // Флаги: оба ключа сверяются по маске, один ключ не отказ.
        let out = bench.out_with(2, |l| l.flags = (l.flags & !15) | 5);
        let flags = |fields: Value| edit_at(2, fields);
        assert_eq!(
            check(&out, flags(json!({"flagsValue": 5, "ownedFlagsMask": 15}))).1,
            0
        );
        let wrong = bench.out_with(2, |l| l.flags = (l.flags & !15) | 4);
        assert_eq!(
            refused(
                &check(
                    &wrong,
                    flags(json!({"flagsValue": 5, "ownedFlagsMask": 15}))
                )
                .0
            ),
            host("Правка не легла в свет точно")
        );
        // Пара флагов проверяется как у плана и правки (раньше сверка пропускала одиночный ключ и маску 0).
        for fields in [
            json!({"flagsValue": 99}),
            json!({"flagsValue": 1}),
            json!({"ownedFlagsMask": 15}),
        ] {
            assert_eq!(
                refused(&check(&copy, edit(fields)).0),
                host("Флаги и маска — вместе")
            );
        }
        for fields in [
            json!({"flagsValue": 0, "ownedFlagsMask": 0}),
            json!({"flagsValue": 1, "ownedFlagsMask": 0}),
            json!({"flagsValue": 9, "ownedFlagsMask": 7}),
        ] {
            assert_eq!(
                refused(&check(&copy, edit(fields)).0),
                host("Флаги вне своей маски")
            );
        }
    }

    #[test]
    fn light_by_light_failures_in_index_order() {
        let bench = Bench::new();
        let wrong = "a".repeat(64);
        // Изменён свет 2, правка только света 1.
        let with_recolor = |change: fn(&mut Light)| {
            let mut lights = bench.base.clone();
            recolor(&mut lights[1]);
            change(&mut lights[2]);
            bench.put_next(&fragment(&lights))
        };
        let changed = with_recolor(|l| l.color = [9, 9, 9]);
        assert_eq!(
            refused(&bench.run(&bench.request(&changed, bench.color_edit())).0),
            host("Свет без правки изменился")
        );
        let moved = with_recolor(|l| l.position = [7.0, 7.0, 7.0]);
        assert_eq!(
            refused(&bench.run(&bench.request(&moved, bench.color_edit())).0),
            host("Свет без правки изменился")
        );
        // Свет 0 изменён и не назван, у правки света 1 неверный отпечаток: свет 0 первым.
        let first = bench.out_with(0, |l| l.color = [9, 9, 9]);
        let bad = json!([{"lightIndex": 1, "expectedFingerprint": wrong, "color": {"r": 1, "g": 2, "b": 3}}]);
        assert_eq!(
            refused(&bench.run(&bench.request(&first, bad.clone())).0),
            host("Свет без правки изменился")
        );
        let good_out = bench.out_with(1, recolor);
        assert_eq!(
            refused(&bench.run(&bench.request(&good_out, bad)).0),
            host("Отпечаток базы не совпал")
        );
        let foreign = json!([{"lightIndex": 1, "expectedFingerprint": bench.fp(2), "color": {"r": 1, "g": 2, "b": 3}}]);
        assert_eq!(
            refused(&bench.run(&bench.request(&good_out, foreign)).0),
            host("Отпечаток базы не совпал")
        );
        // В свете 1 тронуто положение.
        let touched = bench.out_with(1, |l| {
            l.color = [1, 2, 3];
            l.position = [8.0, 8.0, 8.0];
        });
        assert_eq!(
            refused(&bench.run(&bench.request(&touched, bench.color_edit())).0),
            host("Правка тронула неизменяемые поля света")
        );
        // Изменён последний из трёхсот: свет без правки.
        let many: Vec<Light> = (0..300).map(|i| lamp(1, 1, [i as u8, 0, 0], 1.0)).collect();
        let big = Bench::with(many.clone());
        let mut altered = many;
        altered[299].intensity = 2.0;
        let out = big.put("out.yft", &fragment(&altered));
        let single = json!([{"lightIndex": 0, "expectedFingerprint": big.fp(0)}]);
        assert_eq!(
            refused(&big.run(&big.request(&out, single)).0),
            host("Свет без правки изменился")
        );
    }

    #[test]
    fn input_and_output_names_are_compared_as_text_before_any_file_is_read() {
        let bench = Bench::new();
        let same = bench.input.display().to_string();
        assert_eq!(
            refused(&bench.run(&bench.request(&same, bench.color_edit())).0),
            host("Вход и выход проверки совпали")
        );
        let upper = bench.input.display().to_string().to_uppercase();
        assert_eq!(
            refused(&bench.run(&bench.request(&upper, bench.color_edit())).0),
            host("Вход и выход проверки совпали")
        );
        assert_eq!(
            refused(&bench.run(&bench.request(&same, json!([]))).0),
            host("Вход и выход проверки совпали")
        );
        // Тот же файл другой записью проходит, правка цвета не легла.
        let detour = format!("{}\\zz\\..\\syn-4.yft", bench.dir.path().display());
        assert_eq!(
            refused(&bench.run(&bench.request(&detour, bench.color_edit())).0),
            host("Правка не легла в свет точно")
        );
        // Копия входа без правок и правка без полей годятся.
        let copy = bench.put("copy.yft", &fragment(&bench.base));
        let plain = json!([{"lightIndex": 2, "expectedFingerprint": bench.fp(2)}]);
        let (response, code) = bench.run(&bench.request(&copy, plain));
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["outputSha256"], bench.sha);
    }

    #[test]
    fn request_fields_and_their_order() {
        let bench = Bench::new();
        let output = bench.out_with(1, recolor);
        let mut request = bench.request(&output, bench.color_edit());
        request["lodInputFile"] = json!("x.ymap");
        request["note"] = json!(1);
        assert_eq!(bench.run(&request).1, 0);
        let mut request = bench.request(&output, bench.color_edit());
        request["inputFile"] = json!(5);
        assert_eq!(
            refused(&bench.run(&request).0),
            host("Проверка света без входного файла")
        );
        request.as_object_mut().expect("объект").remove("inputFile");
        request
            .as_object_mut()
            .expect("объект")
            .remove("outputFile");
        assert_eq!(
            refused(&bench.run(&request).0),
            host("Проверка света без входного файла")
        );
        let mut request = bench.request(&output, bench.color_edit());
        request["outputFile"] = Value::Null;
        assert_eq!(
            refused(&bench.run(&request).0),
            host("Проверка света без выходного файла")
        );
        let only = host("Проверка света — только .yft");
        for (input, output) in [
            ("syn-2.ydr", "out.yft"),
            ("syn-4.yft", "syn-2.ydr"),
            ("syn-4.yft", "out.txt"),
            ("a.txt", "b.txt"),
        ] {
            let mut request = bench.request(output, bench.color_edit());
            request["inputFile"] = json!(input);
            assert_eq!(refused(&bench.run(&request).0), only, "{input} {output}");
        }
        for text in ["", "not json"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос проверки света не читается")
            );
        }
        for text in ["{}", "[]", "{\"mode\":\"lamp-plan\"}"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос проверки света другого режима")
            );
        }
    }

    #[test]
    fn list_and_checksum_rules_come_before_the_files() {
        let bench = Bench::new();
        let output = bench.out_with(1, recolor);
        let shape = host("SHA-256 базы");
        let mut request = bench.request(&output, json!([]));
        request["expectedInputSha256"] = json!("abc");
        assert_eq!(
            refused(&bench.run(&request).0),
            host("Число правок вне 1…256")
        );
        request
            .as_object_mut()
            .expect("объект")
            .remove("lampHdMutations");
        assert_eq!(refused(&bench.run(&request).0), host("Нет правок света"));
        let mut request = bench.request(&output, bench.color_edit());
        request["expectedInputSha256"] = json!(&bench.sha[1..]);
        assert_eq!(refused(&bench.run(&request).0), shape);
        request
            .as_object_mut()
            .expect("объект")
            .remove("expectedInputSha256");
        assert_eq!(refused(&bench.run(&request).0), shape);
        // Сумма не той длины и файлов нет: побеждает сумма.
        let mut ghost = bench.request(&bench.put("b.yft", b""), bench.color_edit());
        ghost["inputFile"] = json!(bench.dir.path().join("a.yft").display().to_string());
        ghost["expectedInputSha256"] = json!("abc");
        assert_eq!(refused(&bench.run(&ghost).0), shape);
        // Файлы: вход, затем выход; отсутствие — без слов «пока на хосте».
        let absent = |name: &str| bench.dir.path().join(name).display().to_string();
        let mut request = bench.request(&absent("absent.yft"), bench.color_edit());
        assert_eq!(
            refused(&bench.run(&request).0),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {}", absent("absent.yft"))
            )
        );
        request["inputFile"] = json!(absent("absent1.yft"));
        request["outputFile"] = json!(absent("absent2.yft"));
        assert_eq!(
            refused(&bench.run(&request).0).1,
            format!("File was not found: {}", absent("absent1.yft"))
        );
        // Неверная сумма побеждает испорченный выход.
        let magic = bench.put("bad-magic.yft", &[1u8; 32]);
        let mut request = bench.request(&magic, bench.color_edit());
        let mut flipped = bench.sha.clone();
        flipped.pop();
        flipped.push(if bench.sha.ends_with('0') { '1' } else { '0' });
        request["expectedInputSha256"] = json!(flipped);
        assert_eq!(
            refused(&bench.run(&request).0),
            host("SHA-256 базы не совпал")
        );
        request["expectedInputSha256"] = json!(bench.sha.to_uppercase());
        assert_eq!(
            refused(&bench.run(&request).0),
            (
                "InvalidOperationException".to_owned(),
                "Файл не является ресурсом RSC7.".to_owned()
            )
        );
    }

    #[test]
    fn unreadable_or_mismatched_files() {
        let bench = Bench::new();
        let invalid = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        let edit = bench.color_edit();
        let empty = bench.put("bad-empty.yft", b"");
        assert_eq!(
            refused(&bench.run(&bench.request(&empty, edit.clone())).0),
            invalid("Ресурс короче заголовка RSC7.")
        );
        // Оба не ресурсы: сообщение про входной.
        let short = Bench::with(vec![]);
        let short_input = short.dir.path().join("syn-4.yft");
        fs::write(&short_input, b"RSC7").expect("запись");
        let sum = sha256_hex(b"RSC7");
        let mut request = short.request(&short.put("bad-magic.yft", &[1u8; 32]), edit.clone());
        request["expectedInputSha256"] = json!(sum);
        assert_eq!(
            refused(&short.run(&request).0),
            invalid("Ресурс короче заголовка RSC7.")
        );
        // Света нет во входе или в выходе.
        let none = bench.put("syn-0.yft", &fragment(&[]));
        assert_eq!(
            refused(&bench.run(&bench.request(&none, edit.clone())).0),
            host("В фрагменте нет света")
        );
        let bare = Bench::with(vec![]);
        let copy = bare.put("copy0.yft", &fragment(&[]));
        assert_eq!(
            refused(&bare.run(&bare.request(&copy, edit.clone())).0),
            host("В фрагменте нет света")
        );
        // Три источника вместо четырёх.
        let three = bench.put("syn-3.yft", &fragment(&bench.base[..3]));
        assert_eq!(
            refused(&bench.run(&bench.request(&three, edit.clone())).0),
            host("Число источников света изменилось")
        );
        // Число света выхода больше его тела.
        let mut body = vec![0u8; 0x120 + LIGHT_BYTES];
        body[0x110..0x118].copy_from_slice(&0x5000_0120u64.to_le_bytes());
        body[0x118..0x11a].copy_from_slice(&5000u16.to_le_bytes());
        let mut raw = fragment(&[]);
        raw.truncate(16);
        raw.extend(rage_res::resource::deflate_zlib9(&body));
        let big = bench.put("syn-bigcount.yft", &raw);
        assert_eq!(
            refused(&bench.run(&bench.request(&big, edit)).0),
            invalid("Чтение за концом данных ресурса.")
        );
    }

    #[test]
    fn nan_in_an_unnamed_light_is_refused_at_fingerprint_time() {
        let mut nan = lamp(1, 1, [1, 2, 3], 5.0);
        nan.intensity = f32::NAN;
        let bench = Bench::with(vec![lamp(2, 1, [4, 5, 6], 6.0), nan]);
        let copy = bench.put("copy.yft", &fragment(&bench.base));
        let edit = json!([{"lightIndex": 0, "expectedFingerprint": bench.fp(0)}]);
        let (response, code) = bench.run(&bench.request(&copy, edit));
        assert_eq!(code, 1);
        // Раньше здесь паника «научная запись» (InternalError).
        assert_eq!(
            refused(&response),
            non_finite("Свет 1: поле intensity не число (NaN или бесконечность).")
        );
    }
}
