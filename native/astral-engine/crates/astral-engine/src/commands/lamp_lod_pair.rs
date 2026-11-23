//! `lamp-lod-inspect-pair`: опись огней дальнего света города из пары карт
//! `.ymap` (файл LOD и дальний файл с параллельными массивами одной длины).
//!
//! Тут же живут общие для `lamp_lod_patch` вещи: чтение и проверка пары
//! (`load_pair`) и отпечатки огня (`immutable_json`, `fingerprint`).

use std::collections::BTreeMap;

use rage_res::lamp_light::float_json;
use rage_res::mlo::{DistantLights, LodLights};
use serde_json::Value;

use crate::error::{EngineError, Result};

/// Счётчики сводки, которые у файла «только огни» все равны нулю.
const NON_LIGHT_COUNTERS: [&str; 9] = [
    "entities",
    "containerLods",
    "boxOccluders",
    "occludeModels",
    "physicsDictionaries",
    "propInstances",
    "grassInstances",
    "timeCycleModifiers",
    "carGenerators",
];

const NON_FINITE: &str = "Lamp resource contains non-finite value.";

/// Длины перечисленных массивов одной структуры.
macro_rules! column_sizes {
    ($owner:expr => $($column:ident),+ $(,)?) => {
        [$($owner.$column.len()),+]
    };
}

/// Пара файлов, прочитанная и проверенная: массивы огней, сводки полей и число огней.
pub(super) struct Pair {
    pub lod: LodLights,
    pub distant: DistantLights,
    pub lod_envelope: BTreeMap<String, String>,
    pub distant_envelope: BTreeMap<String, String>,
    pub count: usize,
}

pub fn lamp_lod_inspect_pair(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Result<Value> {
    let given = ["lod", "distant"]
        .iter()
        .map(|name| crate::paths::existing_file(options.required(name)?, &[".ymap"]))
        .collect::<Result<Vec<_>>>()?;
    let bodies = given
        .iter()
        .map(std::fs::read)
        .collect::<std::io::Result<Vec<_>>>()?;
    let pair = load_pair(&bodies[0], &bodies[1])?;

    let mut lights = Vec::with_capacity(pair.count);
    for index in 0..pair.count {
        lights.push(light_entry(&pair, index)?);
    }
    let digest = |envelope: &BTreeMap<String, String>| -> Value {
        let text = serde_json::to_string(envelope).unwrap_or_default();
        rage_res::hash::sha256_hex(text.as_bytes()).into()
    };
    let source = |at: usize| {
        object([
            ("path", given[at].display().to_string().into()),
            ("sha256", rage_res::hash::sha256_hex(&bodies[at]).into()),
            ("bytes", bodies[at].len().into()),
        ])
    };

    Ok(object([
        ("status", "ready".into()),
        ("mode", "lamp-lod-inspect-pair".into()),
        ("edition", "legacy".into()),
        (
            "inputs",
            object([("lod", source(0)), ("distant", source(1))]),
        ),
        ("alignedLightCount", pair.count.into()),
        ("lights", lights.into()),
        (
            "validation",
            object([
                ("dedicatedLightOnlyMaps", true.into()),
                ("exactlyAligned", true.into()),
                (
                    "nonLightEnvelopeFingerprints",
                    object([
                        ("lod", digest(&pair.lod_envelope)),
                        ("distant", digest(&pair.distant_envelope)),
                    ]),
                ),
            ]),
        ),
    ]))
}

/// Объект из пар «ключ, значение» в том же порядке.
fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    let mut map = serde_json::Map::new();
    for (key, value) in pairs {
        map.insert(key.to_owned(), value);
    }
    Value::Object(map)
}

/// Читает обе карты и проверяет, что это выровненная пара «только огни».
/// Сначала идёт всё чтение, потом проверки пары по порядку.
pub(super) fn load_pair(lod_bytes: &[u8], distant_bytes: &[u8]) -> Result<Pair> {
    use rage_res::meta_graph::read;
    use rage_res::mlo::{lod_envelope, read_distant_lights, read_lod_lights};

    let (lod_map, distant_map) = (read(lod_bytes)?, read(distant_bytes)?);
    let (lod, distant) = (
        read_lod_lights(&lod_map)?,
        read_distant_lights(&distant_map)?,
    );
    // Чужие массивы в каждом файле: дальние огни в файле LOD и огни LOD в дальнем файле.
    let (stray_distant, stray_lod) = (
        read_distant_lights(&lod_map)?,
        read_lod_lights(&distant_map)?,
    );
    let (lod_envelope, distant_envelope) = (lod_envelope(&lod_map)?, lod_envelope(&distant_map)?);

    let count = lod.direction.len();
    let sizes = column_sizes!(lod => falloff, falloff_exponent, time_and_state_flags, hash,
        cone_inner_angle, cone_outer_angle_or_cap_ext, corona_intensity);
    let sizes_distant = column_sizes!(distant => positions, colours);
    let uneven = count == 0
        || sizes
            .iter()
            .chain(sizes_distant.iter())
            .any(|&size| size != count);

    let verdicts = [
        (
            !is_light_only(&lod_envelope),
            "LOD input is not a dedicated light-only YMAP and cannot use the V1 safe writer.",
        ),
        (
            !is_light_only(&distant_envelope),
            "Distant input is not a dedicated light-only YMAP and cannot use the V1 safe writer.",
        ),
        (count == 0, "LOD input has no CLODLight arrays."),
        (
            distant.positions.is_empty(),
            "Distant input has no CDistantLODLight arrays.",
        ),
        (
            !stray_distant.positions.is_empty() || !stray_lod.direction.is_empty(),
            "LOD pair files contain mixed HD/distant arrays.",
        ),
        (uneven, "LOD/distant SOA arrays are not exactly aligned."),
    ];
    match verdicts.into_iter().find(|&(broken, _)| broken) {
        Some((_, message)) => Err(EngineError::invalid_data(message)),
        None => Ok(Pair {
            lod,
            distant,
            lod_envelope,
            distant_envelope,
            count,
        }),
    }
}

/// Неизменяемая часть огня: направление, флаги, хеш, углы и позиция.
pub(super) fn immutable_json(
    lod: &LodLights,
    distant: &DistantLights,
    index: usize,
) -> Result<String> {
    let (direction, position) = (lod.direction[index], distant.positions[index]);
    ensure_finite(direction.iter().chain(position.iter()))?;
    let members = [
        ("direction", vector_text(direction)),
        (
            "timeAndStateFlags",
            lod.time_and_state_flags[index].to_string(),
        ),
        ("hash", lod.hash[index].to_string()),
        ("coneInnerAngle", lod.cone_inner_angle[index].to_string()),
        (
            "coneOuterAngleOrCapExt",
            lod.cone_outer_angle_or_cap_ext[index].to_string(),
        ),
        ("position", vector_text(position)),
    ];
    Ok(braced(&members))
}

/// Отпечаток огня: неизменяемая запись плюс спад, показатель, корона и цвет `RGBI` целиком.
pub(super) fn fingerprint(
    lod: &LodLights,
    distant: &DistantLights,
    index: usize,
) -> Result<String> {
    let falloff = [lod.falloff[index], lod.falloff_exponent[index]];
    ensure_finite(falloff.iter())?;
    let members = [
        ("immutable", immutable_json(lod, distant, index)?),
        ("falloff", float_json(falloff[0])),
        ("falloffExponent", float_json(falloff[1])),
        ("coronaIntensity", lod.corona_intensity[index].to_string()),
        ("rgbi", distant.colours[index].to_string()),
    ];
    Ok(rage_res::hash::sha256_hex(braced(&members).as_bytes()))
}

/// `{"ключ":значение,…}` без пробелов; значения уже записаны как JSON.
fn braced(members: &[(&str, String)]) -> String {
    let inner: Vec<String> = members
        .iter()
        .map(|(key, value)| format!("\"{key}\":{value}"))
        .collect();
    format!("{{{}}}", inner.join(","))
}

fn ensure_finite<'a>(mut values: impl Iterator<Item = &'a f32>) -> Result<()> {
    if values.all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(EngineError::invalid_data(NON_FINITE))
    }
}

fn is_light_only(envelope: &BTreeMap<String, String>) -> bool {
    NON_LIGHT_COUNTERS
        .iter()
        .all(|key| matches!(envelope.get(*key), Some(count) if count == "0"))
}

fn vector_text(value: [f32; 3]) -> String {
    let [x, y, z] = value.map(float_json);
    format!("{{\"x\":{x},\"y\":{y},\"z\":{z}}}")
}

/// Число `float` как JSON-число `f64`: текст `float_json` разбирается стандартным разбором, при неудаче 0.
fn real(value: f32) -> Value {
    Value::from(float_json(value).parse::<f64>().unwrap_or(0.0))
}

fn vector_value(value: [f32; 3]) -> Value {
    object([
        ("x", real(value[0])),
        ("y", real(value[1])),
        ("z", real(value[2])),
    ])
}

fn light_entry(pair: &Pair, index: usize) -> Result<Value> {
    let Pair { lod, distant, .. } = pair;
    let packed = distant.colours[index];
    let channel = |shift: u32| Value::from((packed >> shift) & 0xff);
    Ok(object([
        ("alignedLightIndex", index.into()),
        ("fingerprint", fingerprint(lod, distant, index)?.into()),
        (
            "immutableFingerprint",
            rage_res::hash::sha256_hex(immutable_json(lod, distant, index)?.as_bytes()).into(),
        ),
        ("position", vector_value(distant.positions[index])),
        ("direction", vector_value(lod.direction[index])),
        (
            "color",
            object([("r", channel(16)), ("g", channel(8)), ("b", channel(0))]),
        ),
        ("intensity", (packed >> 24).into()),
        ("falloff", real(lod.falloff[index])),
        ("falloffExponent", real(lod.falloff_exponent[index])),
        ("timeAndStateFlags", lod.time_and_state_flags[index].into()),
        ("hash", format!("0x{:08X}", lod.hash[index]).into()),
        ("coneInnerAngle", lod.cone_inner_angle[index].into()),
        (
            "coneOuterAngleOrCapExt",
            lod.cone_outer_angle_or_cap_ext[index].into(),
        ),
        ("coronaIntensity", lod.corona_intensity[index].into()),
    ]))
}

pub const COMMANDS: &[super::Command] = &[super::Command::new(
    "lamp-lod-inspect-pair",
    lamp_lod_inspect_pair,
)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths;
    use crate::progress::Progress;
    use crate::test_support;
    use rage_res::hash::sha256_hex;
    use rage_res::meta_graph;
    use rage_res::mlo::lod_envelope as read_envelope;
    use std::fs;
    use std::path::PathBuf;

    fn sample(name: &str) -> PathBuf {
        test_support::engine(&format!(
            "parity/host-port/lamp-lod-inspect-pair/pairs/{name}"
        ))
    }

    fn run_args(args: &[&str]) -> (Value, i32, String) {
        let argv: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        let outcome = crate::run(&argv, &Progress::silent());
        (
            serde_json::from_str(&outcome.line).expect("JSON"),
            outcome.exit_code,
            outcome.line,
        )
    }

    fn inspect(lod: &std::path::Path, distant: &std::path::Path) -> (Value, i32, String) {
        run_args(&[
            "lamp-lod-inspect-pair",
            "--lod",
            &lod.display().to_string(),
            "--distant",
            &distant.display().to_string(),
        ])
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

    fn lights_text(raw: &str) -> &str {
        let start = raw.find("\"lights\":").expect("lights") + "\"lights\":".len();
        let end = raw.find(",\"validation\":").expect("validation");
        &raw[start..end]
    }

    /// Пары, у которых описание даёт и число огней, и сводку текста массива `lights`.
    const PAIRS: [(&str, usize, usize, &str); 3] = [
        (
            "small008",
            626,
            313_764,
            "b512e09701f323a0837ab002a2dc2cdcec63ed68ae987209ff6fda0da80f6642",
        ),
        (
            "small045",
            324,
            163_107,
            "9480470dc5ac2f9a4b00922718ce9643ab7da79a83736abc71912a0b5d33c527",
        ),
        (
            "medium017",
            1039,
            517_406,
            "014a0c36b2c597b8ab4820ff44835ffc02ae5c3f438537e8bb93671f60124b80",
        ),
    ];

    #[test]
    fn real_pairs_match_the_documented_light_texts() {
        for (name, count, length, digest) in PAIRS {
            let (response, code, raw) = inspect(
                &sample(&format!("lodlights_{name}.ymap")),
                &sample(&format!("distlodlights_{name}.ymap")),
            );
            assert_eq!(code, 0, "{name}: {response}");
            assert_eq!(response["result"]["alignedLightCount"], count, "{name}");
            let text = lights_text(&raw);
            assert_eq!(text.chars().count(), length, "{name}");
            assert_eq!(sha256_hex(text.as_bytes()), digest, "{name}");
        }
    }

    #[test]
    fn first_and_last_lights_and_the_answer_shape() {
        let (response, _, _) = inspect(
            &sample("lodlights_small045.ymap"),
            &sample("distlodlights_small045.ymap"),
        );
        let result = &response["result"];
        let keys: Vec<&String> = result.as_object().expect("объект").keys().collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "edition",
                "inputs",
                "alignedLightCount",
                "lights",
                "validation"
            ]
        );
        let first = &result["lights"][0];
        assert_eq!(
            first.to_string(),
            r#"{"alignedLightIndex":0,"fingerprint":"b703daeb8aab4352f4fa46e17fc920fd4eb2bcd6f02af1e3f79da6f120a3335c","immutableFingerprint":"4943ab75afa7b0f8050ac73b827b0b6e192cda79d7ea9beda294307e0c91074c","position":{"x":178.84366,"y":-716.1918,"z":49.132206},"direction":{"x":0.337618,"y":0.368802,"z":-0.866025},"color":{"r":255,"g":193,"b":99},"intensity":170,"falloff":8.0,"falloffExponent":256.0,"timeAndStateFlags":166723647,"hash":"0x01E1DED2","coneInnerAngle":2,"coneOuterAngleOrCapExt":106,"coronaIntensity":2}"#
        );
        assert_eq!(
            result["lights"][323].to_string(),
            r#"{"alignedLightIndex":323,"fingerprint":"689513d02837f79212b515318e80998eee2e911da1650b8971cd4bb3009ca0fc","immutableFingerprint":"17833570c79e2ef5c790590f7962f4da4558e63dbd6f00255848916902fd697b","position":{"x":105.9782,"y":-933.3739,"z":36.202904},"direction":{"x":-2.880396,"y":1.049655,"z":0.0},"color":{"r":255,"g":247,"b":201},"intensity":26,"falloff":2.0,"falloffExponent":45.0,"timeAndStateFlags":82837567,"hash":"0xFFE41319","coneInnerAngle":14,"coneOuterAngleOrCapExt":35,"coronaIntensity":3}"#
        );
        let inputs = &result["inputs"];
        let lod_bytes = fs::read(sample("lodlights_small045.ymap")).expect("файл");
        assert_eq!(inputs["lod"]["bytes"], lod_bytes.len());
        assert_eq!(inputs["lod"]["sha256"], sha256_hex(&lod_bytes));
        let collapsed = paths::full_path(&sample("lodlights_small045.ymap").display().to_string())
            .expect("путь");
        assert_eq!(inputs["lod"]["path"], collapsed.display().to_string());
        assert_eq!(result["validation"]["dedicatedLightOnlyMaps"], true);
        assert_eq!(result["validation"]["exactlyAligned"], true);
    }

    #[test]
    fn envelope_text_is_the_documented_one() {
        let bytes = fs::read(sample("lodlights_small045.ymap")).expect("файл");
        let read = meta_graph::read(&bytes).expect("карта");
        let text = serde_json::to_string(&read_envelope(&read).expect("сводка")).expect("текст");
        assert_eq!(
            text,
            r#"{"boxOccluders":"0","carGenerators":"0","containerLods":"0","contentFlags":"128","distantCategory":"absent","distantNumStreetLights":"absent","entities":"0","entitiesExtentsMax":"0x43532000,0xC41D96F7,0x4387435E","entitiesExtentsMin":"0xC1C6B0EE,0xC46ED986,0x41B974F4","flags":"0","grassInstances":"0","name":"0xCE5F30BF","occludeModels":"0","parent":"0x19359396","physicsDictionaries":"0","propInstances":"0","streamingExtentsMax":"0x442486BA,0xC33AB4F4,0x4432CB22","streamingExtentsMin":"0xC3E9C2E5,0xC4AF2437,0xC3D25924","timeCycleModifiers":"0","unused0":"0","unused1":"0","unused2":"0","unused3":"0","unused4":"0x7F800001","unused5":"0x7F800001","unused6":"0x7F800001","unused7":"0x7F800001"}"#
        );
        let (response, _, _) = inspect(
            &sample("lodlights_small045.ymap"),
            &sample("distlodlights_small045.ymap"),
        );
        assert_eq!(
            response["result"]["validation"]["nonLightEnvelopeFingerprints"]["lod"],
            sha256_hex(text.as_bytes())
        );
    }

    #[test]
    fn fingerprints_follow_their_formulas() {
        let lod_bytes = fs::read(sample("lodlights_small045.ymap")).expect("файл");
        let distant_bytes = fs::read(sample("distlodlights_small045.ymap")).expect("файл");
        let pair = load_pair(&lod_bytes, &distant_bytes).expect("пара");
        assert_eq!(pair.count, 324);
        let immutable = immutable_json(&pair.lod, &pair.distant, 0).expect("запись");
        assert_eq!(
            immutable,
            r#"{"direction":{"x":0.337618,"y":0.368802,"z":-0.866025},"timeAndStateFlags":166723647,"hash":31579858,"coneInnerAngle":2,"coneOuterAngleOrCapExt":106,"position":{"x":178.84366,"y":-716.1918,"z":49.132206}}"#
        );
        let packed = pair.distant.colours[0];
        let expected = format!(
            r#"{{"immutable":{immutable},"falloff":8,"falloffExponent":256,"coronaIntensity":2,"rgbi":{packed}}}"#
        );
        assert_eq!(
            fingerprint(&pair.lod, &pair.distant, 0).expect("отпечаток"),
            sha256_hex(expected.as_bytes())
        );
        assert_eq!(pair.lod_envelope.len(), 27);
    }

    #[test]
    fn parameters_and_paths() {
        let lod = sample("lodlights_small045.ymap").display().to_string();
        let distant = sample("distlodlights_small045.ymap").display().to_string();
        let (response, _, _) = run_args(&["lamp-lod-inspect-pair"]);
        assert_eq!(refused(&response).1, "--lod is required.");
        let (response, _, _) = run_args(&["lamp-lod-inspect-pair", "--lod", &lod]);
        assert_eq!(refused(&response).1, "--distant is required.");
        let (response, _, _) = run_args(&["lamp-lod-inspect-pair", "--distant", &distant]);
        assert_eq!(refused(&response).1, "--lod is required.");
        // Несуществующий --lod побеждает отсутствие --distant.
        let dir = tempfile::tempdir().expect("папка");
        let missing = dir.path().join("a.ymap");
        let (response, _, _) = run_args(&[
            "lamp-lod-inspect-pair",
            "--lod",
            &missing.display().to_string(),
        ]);
        assert_eq!(
            refused(&response),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {}", missing.display())
            )
        );
        // Чужое расширение побеждает отсутствие --distant тоже.
        let wrong = dir.path().join("x.yft");
        fs::write(&wrong, b"x").expect("запись");
        let (response, _, _) = run_args(&[
            "lamp-lod-inspect-pair",
            "--lod",
            &wrong.display().to_string(),
        ]);
        assert_eq!(
            refused(&response),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .yft".to_owned()
            )
        );
        let (response, _, _) =
            run_args(&["lamp-lod-inspect-pair", "--lod", "", "--distant", &distant]);
        assert_eq!(refused(&response).1, "The path is empty.");
        let folder = dir.path().join("d.ymap");
        fs::create_dir(&folder).expect("папка");
        let (response, _, _) = inspect(&folder, &sample("distlodlights_small045.ymap"));
        assert_eq!(refused(&response).0, "FileNotFoundException");
        // Повторы, регистр имён, лишние параметры, прямые слэши и `..`.
        let (response, code, raw) = run_args(&[
            "lamp-lod-inspect-pair",
            "--LOD",
            &sample("lodlights_small008.ymap").display().to_string(),
            "--lod",
            &format!(
                "{}/sub/../lodlights_small045.ymap",
                sample("x.ymap").parent().expect("папка").display()
            ),
            "--Distant",
            &distant,
            "--other",
            "x",
        ]);
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["alignedLightCount"], 324);
        assert_eq!(sha256_hex(lights_text(&raw).as_bytes()), PAIRS[1].3);
        // Копия с расширением .YMAP.
        let upper = dir.path().join("L.YMAP");
        fs::copy(sample("lodlights_small045.ymap"), &upper).expect("копия");
        assert_eq!(inspect(&upper, &sample("distlodlights_small045.ymap")).1, 0);
    }

    #[test]
    fn pairs_that_break_the_rules() {
        let c = |name: &str| sample(name);
        let aligned_lod = c("lodlights_small045.ymap");
        let aligned_distant = c("distlodlights_small045.ymap");
        let case = |lod: &PathBuf, distant: &PathBuf| refused(&inspect(lod, distant).0);
        let data = |text: &str| ("InvalidDataException".to_owned(), text.to_owned());
        // Файлы поменяны местами, один и тот же файл дважды.
        assert_eq!(
            case(&aligned_distant, &aligned_lod),
            data("LOD input has no CLODLight arrays.")
        );
        assert_eq!(
            case(&aligned_lod, &aligned_lod),
            data("Distant input has no CDistantLODLight arrays.")
        );
        assert_eq!(
            case(&aligned_distant, &aligned_distant),
            data("LOD input has no CLODLight arrays.")
        );
        // Разная длина массивов.
        let aligned = data("LOD/distant SOA arrays are not exactly aligned.");
        assert_eq!(
            case(&c("lodlights_small008.ymap"), &aligned_distant),
            aligned
        );
        assert_eq!(
            case(&aligned_lod, &c("distlodlights_medium017.ymap")),
            aligned
        );
    }

    #[test]
    fn unreadable_maps_report_the_neighbor_text() {
        let dir = tempfile::tempdir().expect("папка");
        let distant = sample("distlodlights_small045.ymap");
        let put = |name: &str, bytes: &[u8]| {
            let path = dir.path().join(name);
            fs::write(&path, bytes).expect("запись");
            path
        };
        let invalid = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        let case = |path: &PathBuf| refused(&inspect(path, &distant).0);
        assert_eq!(
            case(&put("t.ymap", b"not a map at all, just text")),
            invalid("Файл не является ресурсом RSC7.")
        );
        assert_eq!(
            case(&put("empty.ymap", b"")),
            invalid("Ресурс короче заголовка RSC7.")
        );
        let good = fs::read(sample("lodlights_small045.ymap")).expect("файл");
        assert_eq!(
            case(&put("head.ymap", &good[..16])),
            invalid("Поток ресурса пуст или не распакован.")
        );
        assert_eq!(
            case(&put("cut.ymap", &good[..good.len() / 3])).0,
            "InvalidOperationException"
        );
        // На месте дальней — тот же фрагмент текста.
        let (response, _, _) = inspect(
            &sample("lodlights_small045.ymap"),
            &put("junk.ymap", b"zzzzzzzzzzzzzzzzzzzzzzzzzz"),
        );
        assert_eq!(
            refused(&response),
            invalid("Файл не является ресурсом RSC7.")
        );
    }

    #[test]
    fn non_finite_numbers_are_reported_as_invalid_data() {
        let dir = tempfile::tempdir().expect("папка");
        let lod_bytes = fs::read(sample("lodlights_small045.ymap")).expect("файл");
        let distant_bytes = fs::read(sample("distlodlights_small045.ymap")).expect("файл");
        let poison = |bytes: &[u8], needle: f32, with: f32, name: &str| {
            let mut resource = rage_res::resource::Resource::parse(bytes).expect("ресурс");
            let wanted = needle.to_le_bytes();
            let at = resource
                .data()
                .windows(4)
                .position(|window| window == wanted)
                .expect("число в теле");
            resource.data_mut()[at..at + 4].copy_from_slice(&with.to_le_bytes());
            let path = dir.path().join(name);
            fs::write(&path, resource.to_file_bytes().expect("файл")).expect("запись");
            path
        };
        let broken_lod = poison(&lod_bytes, 0.337618, f32::NAN, "nan.ymap");
        let (response, code, _) = inspect(&broken_lod, &sample("distlodlights_small045.ymap"));
        assert_eq!(code, 1);
        assert_eq!(
            refused(&response),
            ("InvalidDataException".to_owned(), NON_FINITE.to_owned())
        );
        let broken_distant = poison(&distant_bytes, 178.84366, f32::INFINITY, "inf.ymap");
        let (response, _, _) = inspect(&sample("lodlights_small045.ymap"), &broken_distant);
        assert_eq!(refused(&response).1, NON_FINITE);
    }
}
