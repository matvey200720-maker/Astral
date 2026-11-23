//! `lamp-patch`: правка света фонаря в `.yft` с записью результата в новый файл.
//!
//! Запрос (JSON) проходит как цепочка этапов: пути, форма суммы, список правок,
//! основание (`Base`), репетиция правок над копиями света, сборка файла соседом,
//! повторное чтение результата и только в самом конце запись на диск.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rage_res::lamp_light::Light;
use serde_json::Value;

use super::lamp_mutations::{apply, assert_applied, is_sha256, mutations_of, refuse, Mutation};
use crate::error::Result;

/// Условие должно выполняться, иначе отказ с этим текстом.
fn require(holds: bool, what: &str) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(refuse(what))
    }
}

/// Значение, которого не хватило запросу, — отказ с этим текстом.
fn need<T>(found: Option<T>, what: &str) -> Result<T> {
    found.ok_or_else(|| refuse(what))
}

/// Входной файл, прочитанный и сверенный с ожидаемой суммой, и свет в нём.
struct Base {
    source: Vec<u8>,
    sha: String,
    lights: Vec<Light>,
}

impl Base {
    fn read(input: &Path, wanted: &str) -> Result<Self> {
        let source = std::fs::read(input)?;
        let sha = rage_res::hash::sha256_hex(&source);
        require(sha.eq_ignore_ascii_case(wanted), "SHA-256 базы не совпал")?;
        let lights = lights_of(&source)?;
        Ok(Self {
            source,
            sha,
            lights,
        })
    }
}

pub fn lamp_patch(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Result<Value> {
    let request = read_request(options.required("input")?)?;
    let (input, output) = ends_of(&request)?;
    let wanted = checksum_of(&request)?;
    let mutations = mutations_of(request.get("lampHdMutations"))?;

    let base = Base::read(&input, wanted)?;
    let edits = rehearse(&base.lights, mutations)?;
    let result = assemble(&base, &edits)?;
    deliver(&output, &result)?;
    Ok(answer(&input, &output, &base.sha, &result, &edits))
}

/// Файл с правками от соседа, сразу же перечитанный и сверенный.
fn assemble(base: &Base, edits: &BTreeMap<usize, Light>) -> Result<Vec<u8>> {
    let pairs: Vec<(usize, Light)> = edits
        .iter()
        .map(|(&index, &light)| (index, light))
        .collect();
    let result = rage_res::lamp_light::patch_fragment_lights(&base.source, &pairs)?;
    audit(&base.lights, &result, edits)?;
    Ok(result)
}

fn answer(
    input: &Path,
    output: &Path,
    input_sha: &str,
    result: &[u8],
    edits: &BTreeMap<usize, Light>,
) -> Value {
    let validation = [
        "reopened",
        "exactInputSha256",
        "exactLightFingerprints",
        "lightTopologyPreserved",
        "immutableFieldsPreserved",
        "atomicOutput",
    ];
    let pairs: [(&str, Value); 10] = [
        ("status", "ready".into()),
        ("mode", "lamp-patch".into()),
        ("edition", "legacy".into()),
        ("input", input.display().to_string().into()),
        ("output", output.display().to_string().into()),
        ("inputSha256", input_sha.into()),
        ("outputSha256", rage_res::hash::sha256_hex(result).into()),
        ("outputBytes", result.len().into()),
        ("mutatedLightIndices", edits.keys().copied().collect()),
        (
            "validation",
            Value::Object(
                validation
                    .iter()
                    .map(|key| ((*key).to_owned(), Value::Bool(true)))
                    .collect(),
            ),
        ),
    ];
    let mut answer = serde_json::Map::new();
    pairs.into_iter().for_each(|(key, value)| {
        answer.insert(key.to_owned(), value);
    });
    Value::Object(answer)
}

fn read_request(given: &str) -> Result<Value> {
    let bytes = std::fs::read(crate::paths::existing_file(given, &[".json"])?)?;
    match serde_json::from_slice(&bytes) {
        Ok(root) => Ok(root),
        Err(_) => Err(refuse("Запрос правки света не читается")),
    }
}

/// Ожидаемая сумма входа: строка из 64 шестнадцатеричных цифр.
fn checksum_of(request: &Value) -> Result<&str> {
    match request.get("expectedInputSha256") {
        Some(Value::String(text)) if is_sha256(text) => Ok(text),
        _ => Err(refuse("SHA-256 базы")),
    }
}

/// Существующий вход и путь результата, который не совпадает со входом.
fn ends_of(request: &Value) -> Result<(PathBuf, PathBuf)> {
    let text = |key: &str| request.get(key).and_then(Value::as_str);
    require(
        text("mode") == Some("lamp-patch"),
        "Запрос правки света другого режима",
    )?;
    let given = text("inputFile").unwrap_or("");
    require(
        given.to_lowercase().ends_with(".yft"),
        "Правка света — только .yft",
    )?;
    let input = crate::paths::existing_file(given, &[".yft"])
        .map_err(|_| refuse("Файл света не найден"))?;
    let output = text("outputFile").and_then(|given| crate::paths::full_path(given).ok());
    let output = need(output, "Путь результата не годится")?;
    require(
        output != input && !super::lamp_mutations::is_same_file(&input, &output),
        "Результат совпадает со входом",
    )?;
    Ok((input, output))
}

fn lights_of(file: &[u8]) -> Result<Vec<Light>> {
    let parsed = rage_res::resource::Resource::parse(file)?;
    let found = rage_res::lamp_light::fragment_lights(&parsed)?;
    Ok(found.into_iter().map(|(light, _)| light).collect())
}

/// Правки по возрастанию номера света над копиями: итог — исправленные копии по номерам.
fn rehearse(lights: &[Light], mut mutations: Vec<Mutation>) -> Result<BTreeMap<usize, Light>> {
    mutations.sort_by_key(|mutation| mutation.light_index);
    mutations
        .iter()
        .map(|mutation| Ok((mutation.light_index, amend(lights, mutation)?)))
        .collect()
}

/// Одна правка: диапазон, отпечаток, пределы, точная сверка, неизменяемая часть.
fn amend(lights: &[Light], mutation: &Mutation) -> Result<Light> {
    let original = need(
        lights.get(mutation.light_index),
        "Номер света вне списка фрагмента",
    )?;
    original.check_finite(mutation.light_index)?;
    require(
        original
            .fingerprint()
            .eq_ignore_ascii_case(&mutation.expected_fingerprint),
        "Отпечаток света изменился",
    )?;
    let mut copy = *original;
    apply(&mut copy, mutation)?;
    require(
        assert_applied(&copy, mutation).is_ok(),
        "Правка не легла в свет точно",
    )?;
    require(
        copy.immutable_fingerprint() == original.immutable_fingerprint(),
        "Правка трогает неизменяемые поля света",
    )?;
    Ok(copy)
}

/// Результат читается заново и сверяется со входом и с правками; отпечатки считаются у всех светов.
fn audit(before: &[Light], result: &[u8], edits: &BTreeMap<usize, Light>) -> Result<()> {
    let after = lights_of(result).map_err(|_| refuse("Результат не читается"))?;
    require(after.len() == before.len(), "Число светильников изменилось")?;
    for (index, (old, new)) in before.iter().zip(&after).enumerate() {
        let (expected, failure) = match edits.get(&index) {
            Some(planned) => (planned.fingerprint(), "Правка не легла точно"),
            None => {
                old.check_finite(index)?;
                (old.fingerprint(), "Светильник без правки изменился")
            }
        };
        new.check_finite(index)?;
        require(new.fingerprint() == expected, failure)?;
    }
    Ok(())
}

/// Папки, временный файл рядом, переименование. Сбой переименования убирает временный файл.
fn deliver(output: &Path, bytes: &[u8]) -> Result<()> {
    output.parent().map(std::fs::create_dir_all).transpose()?;
    let mut name = output.as_os_str().to_owned();
    name.push(".lamp-tmp");
    let staging = PathBuf::from(name);
    std::fs::write(&staging, bytes)?;
    std::fs::rename(&staging, output).map_err(|failure| {
        let _ = std::fs::remove_file(&staging);
        failure.into()
    })
}

pub const COMMANDS: &[super::Command] = &[super::Command::new("lamp-patch", lamp_patch)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use rage_res::hash::sha256_hex;
    use rage_res::lamp_light::LIGHT_BYTES;
    use rage_res::resource::Resource;
    use serde_json::json;
    use std::fs;

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

    fn body_of(lights: &[Light]) -> Vec<u8> {
        let mut body = vec![0u8; 0x120 + lights.len() * LIGHT_BYTES];
        body[0x110..0x118].copy_from_slice(&0x5000_0120u64.to_le_bytes());
        body[0x118..0x11a].copy_from_slice(&(lights.len() as u16).to_le_bytes());
        for (index, light) in lights.iter().enumerate() {
            let from = 0x120 + index * LIGHT_BYTES;
            light.encode(&mut body[from..from + LIGHT_BYTES]);
        }
        body
    }

    fn pack(body: &[u8]) -> Vec<u8> {
        let shift = (0..16u32)
            .find(|s| (0x200usize << s) >= body.len())
            .expect("размер");
        let mut out = Vec::new();
        for word in [0x3743_5352u32, 0xa2, 0xa800_0000 | shift, 0x2000_0000] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.extend(rage_res::resource::deflate_zlib9(body));
        out
    }

    fn fragment(lights: &[Light]) -> Vec<u8> {
        pack(&body_of(lights))
    }

    struct Bench {
        dir: tempfile::TempDir,
        yft: PathBuf,
        sha: String,
    }

    impl Bench {
        fn new() -> Self {
            Self::with(&fragment(&syn4()))
        }

        fn with(bytes: &[u8]) -> Self {
            let dir = tempfile::tempdir().expect("папка");
            let yft = dir.path().join("syn-4.yft");
            fs::write(&yft, bytes).expect("запись");
            Self {
                dir,
                yft,
                sha: sha256_hex(bytes),
            }
        }

        fn lights(&self) -> Vec<Light> {
            lights_of(&fs::read(&self.yft).expect("файл")).expect("свет")
        }

        fn fp(&self, index: usize) -> String {
            self.lights()[index].fingerprint()
        }

        fn out(&self, tail: &str) -> String {
            let joined = tail
                .split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part));
            joined.display().to_string()
        }

        fn request(&self, output: &str, mutations: Value) -> Value {
            json!({
                "mode": "lamp-patch",
                "inputFile": self.yft.display().to_string(),
                "outputFile": output,
                "expectedInputSha256": self.sha,
                "lampHdMutations": mutations,
            })
        }

        fn color(&self, output: &str) -> Value {
            let edit = json!([{"lightIndex": 1, "expectedFingerprint": self.fp(1), "color": {"r": 1, "g": 2, "b": 3}}]);
            self.request(output, edit)
        }

        fn run(&self, request: &Value) -> (Value, i32) {
            self.run_text(&request.to_string())
        }

        fn run_text(&self, text: &str) -> (Value, i32) {
            let file = self.dir.path().join("req.json");
            fs::write(&file, text).expect("запись");
            let argv = vec![
                "lamp-patch".to_owned(),
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
    fn color_edit_writes_a_new_file_and_leaves_the_input_alone() {
        let bench = Bench::new();
        let output = bench.out("out/patched.yft");
        let (response, code) = bench.run(&bench.color(&output));
        assert_eq!(code, 0, "{response}");
        let written = fs::read(&output).expect("результат");
        assert_eq!(fs::read(&bench.yft).expect("вход"), fragment(&syn4()));
        let result = &response["result"];
        assert_eq!(result["output"], output);
        assert_eq!(result["inputSha256"], bench.sha);
        assert_eq!(result["outputSha256"], sha256_hex(&written));
        assert_eq!(result["outputBytes"], written.len());
        assert_eq!(result["mutatedLightIndices"], json!([1]));
        let keys: Vec<&String> = result.as_object().expect("объект").keys().collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "edition",
                "input",
                "output",
                "inputSha256",
                "outputSha256",
                "outputBytes",
                "mutatedLightIndices",
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
                "atomicOutput"
            ]
        );
        // Заголовок прежний, тело того же размера, изменена только запись света 1, цвет (1, 2, 3).
        let before = fs::read(&bench.yft).expect("вход");
        assert_eq!(written[..16], before[..16]);
        let old_body = Resource::parse(&before).expect("ресурс");
        let new_body = Resource::parse(&written).expect("ресурс");
        assert_eq!(old_body.data().len(), new_body.data().len());
        let changed: Vec<usize> = old_body
            .data()
            .iter()
            .zip(new_body.data())
            .enumerate()
            .filter(|(_, (a, b))| a != b)
            .map(|(at, _)| at)
            .collect();
        let record = 0x120 + LIGHT_BYTES;
        assert!(
            changed
                .iter()
                .all(|at| (record + 0x18..record + 0x1b).contains(at)),
            "{changed:?}"
        );
        let after = lights_of(&written).expect("свет");
        assert_eq!(after[1].color, [1, 2, 3]);
        assert_eq!(after[0], bench.lights()[0]);
        // Временного файла не осталось.
        assert!(!bench.dir.path().join("out/patched.yft.lamp-tmp").exists());
    }

    #[test]
    fn two_edits_in_any_order_and_every_field_group() {
        let bench = Bench::new();
        let output = bench.out("p.yft");
        let edits = json!([
            {"lightIndex": 3, "expectedFingerprint": bench.fp(3), "intensity": 7},
            {"lightIndex": 0, "expectedFingerprint": bench.fp(0), "falloff": 6},
        ]);
        let (response, code) = bench.run(&bench.request(&output, edits));
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["mutatedLightIndices"], json!([0, 3]));
        let after = lights_of(&fs::read(&output).expect("файл")).expect("свет");
        assert_eq!((after[3].intensity, after[0].falloff), (7.0, 6.0));

        let all = json!([{
            "lightIndex": 2, "expectedFingerprint": bench.fp(2).to_uppercase(),
            "color": {"r": 10, "g": 20, "b": 30}, "intensity": 55.5, "falloff": 12, "falloffExponent": 64,
            "coronaIntensity": 2.5, "coronaSize": 4, "coronaZBias": -1.5, "volumeIntensity": 0.25,
            "volumeSizeScale": 2, "volumeOuterColor": {"r": 1, "g": 2, "b": 3}, "volumeOuterIntensity": 3,
            "volumeOuterExponent": 2, "lightFadeDistance": 77, "volumetricFadeDistance": 88,
            "flagsValue": 5, "ownedFlagsMask": 15,
        }]);
        let output = bench.out("all.yft");
        let mut request = bench.request(&output, all);
        request["expectedInputSha256"] = json!(bench.sha.to_uppercase());
        request["lodInputFile"] = json!("C:\\nothing.ymap");
        request["note"] = json!("x");
        let (response, code) = bench.run(&request);
        assert_eq!(code, 0, "{response}");
        let after = lights_of(&fs::read(&output).expect("файл")).expect("свет");
        let light = after[2];
        assert_eq!(
            (
                light.color,
                light.intensity,
                light.falloff,
                light.falloff_exponent
            ),
            ([10, 20, 30], 55.5, 12.0, 64.0)
        );
        assert_eq!(
            (
                light.corona_intensity,
                light.corona_size,
                light.corona_z_bias
            ),
            (2.5, 4.0, -1.5)
        );
        assert_eq!(
            (
                light.volume_intensity,
                light.volume_size_scale,
                light.volume_outer_color
            ),
            (0.25, 2.0, [1, 2, 3])
        );
        assert_eq!(
            (
                light.light_fade_distance,
                light.volumetric_fade_distance,
                light.flags
            ),
            (77, 88, !15 | 5)
        );
        // Правка без полей даёт файл с тем же светом.
        let output = bench.out("none.yft");
        let noop = json!([{"lightIndex": 0, "expectedFingerprint": bench.fp(0)}]);
        assert_eq!(bench.run(&bench.request(&output, noop)).1, 0);
        let after = lights_of(&fs::read(&output).expect("файл")).expect("свет");
        assert_eq!(after, bench.lights());
    }

    #[test]
    fn two_hundred_fifty_six_edits_on_three_hundred_lights() {
        let lights: Vec<Light> = (0..300)
            .map(|i| lamp(1, 1, [i as u8, 2, 3], 1.0 + i as f32))
            .collect();
        let bench = Bench::with(&fragment(&lights));
        let edits: Vec<Value> = (0..256)
            .rev()
            .map(|i| json!({"lightIndex": i, "expectedFingerprint": bench.fp(i), "intensity": i}))
            .collect();
        let output = bench.out("many.yft");
        let (response, code) = bench.run(&bench.request(&output, Value::Array(edits)));
        assert_eq!(code, 0, "{response}");
        let planned: Vec<usize> = (0..256).collect();
        assert_eq!(response["result"]["mutatedLightIndices"], json!(planned));
        let after = lights_of(&fs::read(&output).expect("файл")).expect("свет");
        assert_eq!(
            (after[255].intensity, after[256], after[299]),
            (255.0, lights[256], lights[299])
        );
    }

    #[test]
    fn output_location_rules_and_side_effects() {
        let bench = Bench::new();
        // Существующий результат молча заменяется, старый временный файл заменяется и исчезает.
        let output = bench.out("out/patched.yft");
        fs::create_dir_all(bench.dir.path().join("out")).expect("папка");
        fs::write(&output, b"old").expect("запись");
        fs::write(format!("{output}.lamp-tmp"), b"stale").expect("запись");
        assert_eq!(bench.run(&bench.color(&output)).1, 0);
        assert!(fs::read(&output).expect("файл").len() > 16);
        assert!(!bench.dir.path().join("out/patched.yft.lamp-tmp").exists());
        // Новые вложенные папки, расширение любое, `..` и прямые слэши сворачиваются.
        let nested = bench.out("a/b/c/result");
        assert_eq!(bench.run(&bench.color(&nested)).1, 0);
        assert!(bench.dir.path().join("a/b/c/result").is_file());
        let tricky = format!("{}/q/x/../.\\Мой результат.YFT", bench.dir.path().display());
        let (response, code) = bench.run(&bench.color(&tricky));
        assert_eq!(code, 0, "{response}");
        assert_eq!(
            response["result"]["output"],
            bench.out("q/Мой результат.YFT")
        );
    }

    #[test]
    fn output_equal_to_input_is_refused_by_text_not_by_identity() {
        let bench = Bench::new();
        let same = bench.yft.display().to_string();
        assert_eq!(
            refused(&bench.run(&bench.color(&same)).0),
            host("Результат совпадает со входом")
        );
        let detour = format!("{}\\zz\\..\\syn-4.yft", bench.dir.path().display());
        assert_eq!(
            refused(&bench.run(&bench.color(&detour)).0),
            host("Результат совпадает со входом")
        );
        let mut early = bench.color(&same);
        early["expectedInputSha256"] = json!("abc");
        assert_eq!(
            refused(&bench.run(&early).0),
            host("Результат совпадает со входом")
        );
        assert!(!bench.dir.path().join("zz").exists());
    }

    #[cfg(windows)]
    #[test]
    fn same_file_in_another_letter_case_is_refused_not_overwritten() {
        let dir = tempfile::tempdir().expect("папка");
        let folder = dir.path().join("in");
        fs::create_dir(&folder).expect("папка");
        let source = folder.join("Lamp.yft");
        let bytes = fragment(&syn4());
        fs::write(&source, &bytes).expect("запись");
        let bench = Bench {
            dir,
            yft: source.clone(),
            sha: sha256_hex(&bytes),
        };
        let upper = bench.out("in/LAMP.YFT");
        // Прежний код сравнивал строки путей и перезаписывал вход; теперь это тот же файл, и команда отказывает.
        let (response, code) = bench.run(&bench.color(&upper));
        assert_eq!(code, 1, "{response}");
        assert_eq!(refused(&response), host("Результат совпадает со входом"));
        assert_eq!(fs::read(&source).expect("файл"), bytes);
    }

    #[test]
    fn unusable_output_paths() {
        let bench = Bench::new();
        let unusable = host("Путь результата не годится");
        let mut request = bench.color("");
        for value in [json!(""), json!("   "), json!(5), Value::Null] {
            request["outputFile"] = value;
            assert_eq!(refused(&bench.run(&request).0), unusable);
        }
        request
            .as_object_mut()
            .expect("объект")
            .remove("outputFile");
        assert_eq!(refused(&bench.run(&request).0), unusable);
        // Входной файл не найден побеждает плохой путь результата.
        let absent = bench.dir.path().join("absent.yft");
        request["inputFile"] = json!(absent.display().to_string());
        assert_eq!(
            refused(&bench.run(&request).0),
            host("Файл света не найден")
        );
        // Нет inputFile и нет outputFile: побеждает inputFile.
        request.as_object_mut().expect("объект").remove("inputFile");
        assert_eq!(
            refused(&bench.run(&request).0),
            host("Правка света — только .yft")
        );
    }

    #[test]
    fn write_failures_leave_the_documented_traces() {
        let bench = Bench::new();
        // На месте результата папка: временный файл остаётся.
        let folder = bench.dir.path().join("out/patched.yft");
        fs::create_dir_all(&folder).expect("папка");
        let (response, code) = bench.run(&bench.color(&folder.display().to_string()));
        assert_eq!(code, 1);
        assert_eq!(
            refused(&response).0,
            "UnauthorizedAccessException",
            "{response}"
        );
        // Временный файл убран (прежняя команда оставляла его на диске).
        let staging = bench.dir.path().join("out/patched.yft.lamp-tmp");
        assert!(!staging.exists());
        // Родитель результата — файл.
        let blocker = bench.dir.path().join("blocker");
        fs::write(&blocker, b"x").expect("запись");
        let (response, _) = bench.run(&bench.color(&blocker.join("x.yft").display().to_string()));
        assert_eq!(refused(&response).0, "IOException", "{response}");
        // На месте временного файла папка.
        let target = bench.dir.path().join("second/patched.yft");
        fs::create_dir_all(bench.dir.path().join("second/patched.yft.lamp-tmp")).expect("папка");
        let (response, _) = bench.run(&bench.color(&target.display().to_string()));
        assert_eq!(
            refused(&response).0,
            "UnauthorizedAccessException",
            "{response}"
        );
    }

    #[test]
    fn nothing_is_created_before_all_checks_pass() {
        let bench = Bench::new();
        let output = bench.out("never/made/x.yft");
        let wrong_fingerprint = json!([{"lightIndex": 1, "expectedFingerprint": "0".repeat(64)}]);
        assert_eq!(
            refused(&bench.run(&bench.request(&output, wrong_fingerprint)).0),
            host("Отпечаток света изменился")
        );
        let mut wrong_sum = bench.color(&output);
        wrong_sum["expectedInputSha256"] = json!("0".repeat(64));
        assert_eq!(
            refused(&bench.run(&wrong_sum).0),
            host("SHA-256 базы не совпал")
        );
        assert!(!bench.dir.path().join("never").exists());
    }

    #[test]
    fn request_level_failures_in_order() {
        let bench = Bench::new();
        let output = bench.out("o.yft");
        for text in ["", "not json", "\u{feff}{}"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос правки света не читается"),
                "{text:?}"
            );
        }
        for text in [
            "[]",
            "{}",
            "{\"mode\":\"lamp-plan\"}",
            "{\"mode\":\"LAMP-PATCH\"}",
        ] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос правки света другого режима"),
                "{text:?}"
            );
        }
        let mut request = bench.color(&output);
        for value in [Value::Null, json!(5), json!(""), json!("syn-2.ydr")] {
            request["inputFile"] = value;
            assert_eq!(
                refused(&bench.run(&request).0),
                host("Правка света — только .yft")
            );
        }
        let mut request = bench.color(&output);
        let shape = host("SHA-256 базы");
        for value in [
            Value::Null,
            json!(5),
            json!(&bench.sha[1..]),
            json!(format!("{}0", bench.sha)),
            json!(format!("g{}", &bench.sha[1..])),
        ] {
            request["expectedInputSha256"] = value;
            assert_eq!(refused(&bench.run(&request).0), shape);
        }
        let mut empty = bench.request(&output, json!([]));
        empty["expectedInputSha256"] = json!("a".repeat(64));
        assert_eq!(
            refused(&bench.run(&empty).0),
            host("Число правок вне 1…256")
        );
        empty["expectedInputSha256"] = json!("abc");
        assert_eq!(refused(&bench.run(&empty).0), shape);
    }

    #[test]
    fn light_checks_follow_the_ascending_order() {
        let bench = Bench::new();
        let output = bench.out("o.yft");
        let run = |edits: Value| refused(&bench.run(&bench.request(&output, edits)).0);
        assert_eq!(
            run(json!([{"lightIndex": 4, "expectedFingerprint": "a".repeat(64)}])),
            host("Номер света вне списка фрагмента")
        );
        assert_eq!(
            run(
                json!([{"lightIndex": 3, "expectedFingerprint": "a".repeat(64)}, {"lightIndex": 0, "expectedFingerprint": bench.fp(0), "intensity": -1}])
            ),
            host("Значение света вне предела")
        );
        assert_eq!(
            run(
                json!([{"lightIndex": 7, "expectedFingerprint": "a".repeat(64)}, {"lightIndex": 1, "expectedFingerprint": bench.fp(1), "intensity": -1}])
            ),
            host("Значение света вне предела")
        );
        assert_eq!(
            run(
                json!([{"lightIndex": 1, "expectedFingerprint": "a".repeat(64), "intensity": 100001}])
            ),
            host("Отпечаток света изменился")
        );
        assert_eq!(
            run(json!([{"lightIndex": 1, "expectedFingerprint": bench.fp(1), "flagsValue": 1}])),
            host("Флаги и маска — вместе")
        );
        assert_eq!(
            run(
                json!([{"lightIndex": 1, "expectedFingerprint": bench.fp(1), "flagsValue": 3, "ownedFlagsMask": 1}])
            ),
            host("Флаги вне своей маски")
        );
        assert_eq!(
            run(
                json!([{"lightIndex": 1, "expectedFingerprint": bench.fp(1)}, {"lightIndex": 1, "expectedFingerprint": bench.fp(1)}])
            ),
            host("Номер света в плане повторяется")
        );
    }

    #[test]
    fn unreadable_inputs_report_the_neighbor_text() {
        let invalid = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        let edit = |bench: &Bench| {
            bench.request(
                &bench.out("o.yft"),
                json!([{"lightIndex": 0, "expectedFingerprint": "a".repeat(64)}]),
            )
        };
        let magic = Bench::with(&[9u8; 40]);
        assert_eq!(
            refused(&magic.run(&edit(&magic)).0),
            invalid("Файл не является ресурсом RSC7.")
        );
        let empty = Bench::with(b"");
        assert_eq!(
            refused(&empty.run(&edit(&empty)).0),
            invalid("Ресурс короче заголовка RSC7.")
        );
        let none = Bench::with(&fragment(&[]));
        assert_eq!(
            refused(&none.run(&edit(&none)).0),
            host("Номер света вне списка фрагмента")
        );
        let mut body = body_of(&[lamp(1, 1, [1, 2, 3], 1.0)]);
        body[0x118..0x11a].copy_from_slice(&5000u16.to_le_bytes());
        let big = Bench::with(&pack(&body));
        assert_eq!(
            refused(&big.run(&edit(&big)).0),
            invalid("Чтение за концом данных ресурса.")
        );
    }

    #[test]
    fn nan_anywhere_in_the_file_is_refused_by_name_but_only_after_the_edit_passed() {
        let mut nan = lamp(1, 1, [1, 2, 3], 5.0);
        nan.intensity = f32::NAN;
        let bench = Bench::with(&fragment(&[lamp(2, 1, [4, 5, 6], 6.0), nan]));
        let output = bench.out("nan/patched.yft");
        let edit = json!([{"lightIndex": 0, "expectedFingerprint": bench.fp(0)}]);
        let (response, code) = bench.run(&bench.request(&output, edit));
        assert_eq!(code, 1);
        // Раньше здесь паника «научная запись» (InternalError); теперь отказ с номером света и полем.
        assert_eq!(
            refused(&response),
            non_finite("Свет 1: поле intensity не число (NaN или бесконечность).")
        );
        assert!(!bench.dir.path().join("nan").exists());
        // NaN в названном свете отказывает уже на сверке отпечатка.
        let named = json!([{"lightIndex": 1, "expectedFingerprint": "a".repeat(64)}]);
        let (response, _) = bench.run(&bench.request(&output, named));
        assert_eq!(
            refused(&response),
            non_finite("Свет 1: поле intensity не число (NaN или бесконечность).")
        );
    }
}
