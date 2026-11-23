//! `lamp-studio-inspect`: краткая опись света до 512 моделей (`.yft`, `.ydr`, `.ydd`) для мастерской фонарей.
//!
//! Модели обрабатываются по очереди, первая беда прерывает всё. Читатель
//! выбирается по хвосту имени файла из таблицы `READERS`; текст света собирает
//! `studio_describe`, здесь он разбирается обратно в JSON.

use rage_res::resource::Resource;
use serde_json::Value;

use super::lamp_mutations::refuse;
use crate::{args::Options, error::Result, progress::Progress};

/// Как читать список света одного вида файла.
type Describe = fn(&Resource) -> Result<Vec<String>>;

/// Хвост имени и читатель; порядок строк — порядок проверки хвоста.
const READERS: [(&str, Describe); 3] = [
    (".ydd", dictionary_texts),
    (".yft", fragment_texts),
    (".ydr", drawable_texts),
];

fn fragment_texts(resource: &Resource) -> Result<Vec<String>> {
    let found = rage_res::lamp_light::fragment_lights(resource)?;
    Ok(found
        .iter()
        .zip(0..)
        .map(|((light, _), slot)| -> Result<String> {
            light.check_finite(slot)?;
            Ok(light.studio_describe("fragment", slot))
        })
        .collect::<Result<Vec<_>>>()?)
}

fn drawable_texts(resource: &Resource) -> Result<Vec<String>> {
    let Some(root) = resource.at(rage_res::resource::SYSTEM_BASE) else {
        return Err(refuse("Ресурс без корня"));
    };
    let found = rage_res::lamp_light::drawable_lights(resource, root)?;
    Ok(found
        .iter()
        .zip(0..)
        .map(|(light, slot)| -> Result<String> {
            light.check_finite(slot)?;
            Ok(light.studio_describe("drawable", slot))
        })
        .collect::<Result<Vec<_>>>()?)
}

fn dictionary_texts(resource: &Resource) -> Result<Vec<String>> {
    let mut texts = Vec::new();
    for (place, lights) in rage_res::lamp_light::dictionary_lights(resource)? {
        let list = format!("drawable:{place}");
        for (light, slot) in lights.iter().zip(0..) {
            light.check_finite(slot)?;
            texts.push(light.studio_describe(&list, slot));
        }
    }
    Ok(texts)
}

/// Модель запроса после проверок формы: имя, путь и читатель.
struct Spec<'a> {
    file: &'a str,
    name: &'a str,
    suffix: &'static str,
    describe: Describe,
}

impl<'a> Spec<'a> {
    fn of(item: &'a Value) -> Result<Self> {
        let text = |key: &str| item.get(key).and_then(Value::as_str);
        let file = text("file").ok_or_else(|| refuse("Модель без файла"))?;
        let name = text("model").ok_or_else(|| refuse("Модель без имени"))?;
        if !std::path::Path::new(file).is_absolute() {
            return Err(refuse("Путь модели не абсолютный"));
        }
        let lowered = file.to_lowercase();
        match READERS.iter().find(|(suffix, _)| lowered.ends_with(suffix)) {
            Some(&(suffix, describe)) => Ok(Self {
                file,
                name,
                suffix,
                describe,
            }),
            None => Err(refuse("Опись света — только .yft, .ydr и .ydd")),
        }
    }

    fn inspect(&self, entry: Value) -> Result<Value> {
        let path = crate::paths::existing_file(self.file, &[self.suffix])?;
        let bytes = std::fs::read(path)?;
        let texts = (self.describe)(&Resource::parse(&bytes)?)?;
        let mut lights = Vec::with_capacity(texts.len());
        for text in &texts {
            match serde_json::from_str::<Value>(text) {
                Ok(light) => lights.push(light),
                Err(_) => {
                    return Err(crate::error::EngineError::new(
                        "lamp-studio-inspect",
                        "Опись света не собралась.",
                    ))
                }
            }
        }
        Ok(object([
            ("model", self.name.into()),
            ("entry", entry),
            ("sha256", rage_res::hash::sha256_hex(&bytes).into()),
            ("bytes", bytes.len().into()),
            ("lights", lights.into()),
        ]))
    }
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn read_request(given: &str) -> Result<Value> {
    let file = crate::paths::existing_file(given, &[".json"])?;
    let bytes = std::fs::read(file)?;
    let root: Value =
        serde_json::from_slice(&bytes).map_err(|_| refuse("Запрос описи света не читается"))?;
    if root.get("mode").and_then(Value::as_str) == Some("lamp-studio-inspect") {
        Ok(root)
    } else {
        Err(refuse("Запрос описи света другого режима"))
    }
}

/// Предел помощника (`MaxModels` в `LampStudioCommands.cs`). Мастерская фонарей отдаёт все 83 модели одним запросом;
/// прежние 64 в движке отказывали каждому такому запросу словами «пока на хосте» (сверка 16.11.2026).
const MAX_MODELS: usize = 512;

pub fn lamp_studio_inspect(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = read_request(options.required("input")?)?;
    let Some(models) = request.get("lampStudioModels").and_then(Value::as_array) else {
        return Err(refuse("Нет моделей"));
    };
    if models.is_empty() || models.len() > MAX_MODELS {
        return Err(refuse("Число моделей вне 1…512"));
    }
    let mut described = Vec::with_capacity(models.len());
    for item in models {
        let entry = item.get("entry").cloned().unwrap_or(Value::Null);
        described.push(Spec::of(item)?.inspect(entry)?);
    }
    Ok(object([
        ("status", "ready".into()),
        ("mode", "lamp-studio-inspect".into()),
        ("models", described.into()),
    ]))
}

pub const COMMANDS: &[super::Command] = &[super::Command::new(
    "lamp-studio-inspect",
    lamp_studio_inspect,
)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use rage_res::hash::sha256_hex;
    use rage_res::lamp_light::{Light, LIGHT_BYTES};
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
        light.corona_intensity = 0.1;
        light.corona_size = 3.0;
        light.direction = [0.0, 0.0, -1.0];
        light.cone_outer_angle = 70.0;
        light
    }

    fn pack(version: u32, body: &[u8]) -> Vec<u8> {
        let shift = (0..16u32)
            .find(|s| (0x200usize << s) >= body.len())
            .expect("размер");
        let mut out = Vec::new();
        for word in [
            0x3743_5352u32,
            version,
            0x0800_0000 | ((version << 28) & 0xf000_0000) | shift,
            0x2000_0000,
        ] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.extend(rage_res::resource::deflate_zlib9(body));
        out
    }

    fn put_lights(body: &mut [u8], from: usize, lights: &[Light]) {
        for (slot, light) in lights.iter().enumerate() {
            let at = from + slot * LIGHT_BYTES;
            light.encode(&mut body[at..at + LIGHT_BYTES]);
        }
    }

    fn fragment(lights: &[Light]) -> Vec<u8> {
        let mut body = vec![0u8; 0x120 + lights.len() * LIGHT_BYTES];
        body[0x110..0x118].copy_from_slice(&0x5000_0120u64.to_le_bytes());
        body[0x118..0x11a].copy_from_slice(&(lights.len() as u16).to_le_bytes());
        put_lights(&mut body, 0x120, lights);
        pack(0xa2, &body)
    }

    fn drawable(lights: &[Light]) -> Vec<u8> {
        let mut body = vec![0u8; 0x100 + lights.len() * LIGHT_BYTES];
        body[0xb0..0xb8].copy_from_slice(&0x5000_0100u64.to_le_bytes());
        body[0xb8..0xba].copy_from_slice(&(lights.len() as u16).to_le_bytes());
        put_lights(&mut body, 0x100, lights);
        pack(0xa5, &body)
    }

    /// Словарь: на каждое место либо пусто, либо рисовалка с этим светом.
    fn dictionary(places: &[Option<Vec<Light>>], declared: u16) -> Vec<u8> {
        let list_at = 0x100usize;
        let mut body = vec![0u8; list_at + places.len() * 8];
        body[0x30..0x38].copy_from_slice(&(0x5000_0000u64 + list_at as u64).to_le_bytes());
        body[0x38..0x3a].copy_from_slice(&declared.to_le_bytes());
        for (place, entry) in places.iter().enumerate() {
            let Some(lights) = entry else { continue };
            let at = body.len();
            body.resize(at + 0x100 + lights.len() * LIGHT_BYTES, 0);
            body[list_at + place * 8..list_at + place * 8 + 8]
                .copy_from_slice(&(0x5000_0000u64 + at as u64).to_le_bytes());
            body[at + 0xb0..at + 0xb8]
                .copy_from_slice(&(0x5000_0000u64 + (at + 0x100) as u64).to_le_bytes());
            body[at + 0xb8..at + 0xba].copy_from_slice(&(lights.len() as u16).to_le_bytes());
            put_lights(&mut body, at + 0x100, lights);
        }
        pack(0xa5, &body)
    }

    struct Bench {
        dir: tempfile::TempDir,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().expect("папка"),
            }
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path: PathBuf = self.dir.path().join(name);
            fs::write(&path, bytes).expect("запись");
            path.display().to_string()
        }

        fn run(&self, request: &Value) -> (Value, i32) {
            self.run_text(&request.to_string())
        }

        fn run_text(&self, text: &str) -> (Value, i32) {
            let file = self.dir.path().join("req.json");
            fs::write(&file, text).expect("запись");
            let argv = vec![
                "lamp-studio-inspect".to_owned(),
                "--input".to_owned(),
                file.display().to_string(),
            ];
            let outcome = crate::run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).expect("JSON"),
                outcome.exit_code,
            )
        }

        fn one(&self, file: &str, entry: Option<Value>) -> (Value, i32) {
            let mut model = json!({"file": file, "model": "m"});
            if let Some(entry) = entry {
                model["entry"] = entry;
            }
            self.run(&json!({"mode": "lamp-studio-inspect", "lampStudioModels": [model]}))
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

    fn host(what: &str) -> (String, String) {
        (
            "ArgumentException".to_owned(),
            format!("{what}: пока на хосте."),
        )
    }

    fn lists(response: &Value) -> Vec<(String, u64)> {
        response["result"]["models"][0]["lights"]
            .as_array()
            .map(|lights| {
                lights
                    .iter()
                    .map(|light| {
                        (
                            light["list"].as_str().unwrap_or("").to_owned(),
                            light["index"].as_u64().unwrap_or(99),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn fragment_drawable_and_dictionary_branches() {
        let bench = Bench::new();
        let mut spot = lamp(2, 1408, [0, 255, 0], 32.0);
        spot.bone_id = 5;
        let lights = [lamp(1, 1, [255, 0, 0], 10.0), spot];
        let yft = bench.put("a.yft", &fragment(&lights));
        let (response, code) = bench.one(&yft, None);
        assert_eq!(code, 0, "{response}");
        let model = &response["result"]["models"][0];
        let bytes = fs::read(&yft).expect("файл");
        assert_eq!(model["sha256"], sha256_hex(&bytes));
        assert_eq!(model["bytes"], bytes.len());
        assert_eq!(
            lists(&response),
            [("fragment".to_owned(), 0), ("fragment".to_owned(), 1)]
        );
        let keys: Vec<&String> = response["result"]
            .as_object()
            .expect("объект")
            .keys()
            .collect();
        assert_eq!(keys, ["status", "mode", "models"]);
        let model_keys: Vec<&String> = model.as_object().expect("объект").keys().collect();
        assert_eq!(model_keys, ["model", "entry", "sha256", "bytes", "lights"]);
        let light_keys: Vec<&String> = model["lights"][1]
            .as_object()
            .expect("объект")
            .keys()
            .collect();
        assert_eq!(
            light_keys,
            [
                "list",
                "index",
                "type",
                "flags",
                "timeFlags",
                "bone",
                "color",
                "intensity",
                "falloff",
                "falloffExponent",
                "corona",
                "volume",
                "position",
                "direction",
                "coneOuterAngle"
            ]
        );
        assert_eq!(model["lights"][1]["bone"], 5);
        assert_eq!(model["lights"][1]["type"], "spot");
        assert_eq!(model["lights"][0]["type"], "point");
        // Рисовалка.
        let ydr = bench.put("b.ydr", &drawable(&lights));
        assert_eq!(
            lists(&bench.one(&ydr, None).0),
            [("drawable".to_owned(), 0), ("drawable".to_owned(), 1)]
        );
        // Словарь: места 0 и 3 пусты, остальные несут свет 1, 2 и 1.
        let dict = dictionary(
            &[
                None,
                Some(vec![lights[0]]),
                Some(lights.to_vec()),
                None,
                Some(vec![lights[1]]),
            ],
            5,
        );
        let ydd = bench.put("c.ydd", &dict);
        assert_eq!(
            lists(&bench.one(&ydd, None).0),
            [
                ("drawable:1".to_owned(), 0),
                ("drawable:2".to_owned(), 0),
                ("drawable:2".to_owned(), 1),
                ("drawable:4".to_owned(), 0),
            ]
        );
    }

    #[test]
    fn empty_and_oversized_dictionaries() {
        let bench = Bench::new();
        let light = lamp(1, 1, [1, 2, 3], 1.0);
        let none = bench.put("none.ydd", &dictionary(&[None, None], 2));
        assert_eq!(
            bench.one(&none, None).0["result"]["models"][0]["lights"],
            json!([])
        );
        let zero = bench.put("zero.ydd", &dictionary(&[], 0));
        assert_eq!(
            bench.one(&zero, None).0["result"]["models"][0]["lights"],
            json!([])
        );
        let (response, code) = bench.one(&bench.put("big.ydd", &dictionary(&[None], 4097)), None);
        assert_eq!(code, 1);
        assert_eq!(
            refused(&response),
            (
                "InvalidOperationException".to_owned(),
                "Словарь заявляет слишком много рисовалок.".to_owned()
            )
        );
        let mut places = vec![None; 4095];
        places.push(Some(vec![light]));
        let last = bench.put("last.ydd", &dictionary(&places, 4096));
        assert_eq!(
            lists(&bench.one(&last, None).0),
            [("drawable:4095".to_owned(), 0)]
        );
    }

    #[test]
    fn the_name_not_the_content_picks_the_reader() {
        let bench = Bench::new();
        let lights = [lamp(1, 1, [1, 2, 3], 1.0), lamp(2, 1, [3, 2, 1], 2.0)];
        let dict = dictionary(&[None, Some(vec![lights[0]])], 2);
        let frag = fragment(&lights);
        let draw = drawable(&lights);
        assert_eq!(
            bench.one(&bench.put("d.ydr", &dict), None).0["result"]["models"][0]["lights"],
            json!([])
        );
        assert_eq!(
            bench.one(&bench.put("f.ydd", &frag), None).0["result"]["models"][0]["lights"],
            json!([])
        );
        assert_eq!(
            bench.one(&bench.put("r.yft", &draw), None).0["result"]["models"][0]["lights"],
            json!([])
        );
        assert_eq!(
            lists(&bench.one(&bench.put("UP.YFT", &frag), None).0).len(),
            2
        );
        assert_eq!(
            lists(&bench.one(&bench.put("Mixed.Ydd", &dict), None).0),
            [("drawable:1".to_owned(), 0)]
        );
    }

    #[test]
    fn entry_is_copied_as_it_was_read() {
        let bench = Bench::new();
        let file = bench.put("a.yft", &fragment(&[lamp(1, 1, [1, 2, 3], 1.0)]));
        let raw = |entry_text: &str| {
            let request = format!(
                r#"{{"mode":"lamp-studio-inspect","lampStudioModels":[{{"file":{},"model":"m","entry":{entry_text}}}]}}"#,
                serde_json::to_string(&file).expect("текст")
            );
            let (response, _) = bench.run_text(&request);
            response["result"]["models"][0]["entry"].to_string()
        };
        assert_eq!(raw("\"text\""), "\"text\"");
        assert_eq!(raw("null"), "null");
        assert_eq!(raw("1.50"), "1.5");
        assert_eq!(
            raw(r#"{"b":[1,{"z":2,"a":3}],"a":null}"#),
            r#"{"b":[1,{"z":2,"a":3}],"a":null}"#
        );
        assert_eq!(raw("18446744073709551616"), "1.8446744073709552e+19");
        assert_eq!(raw("18446744073709551615"), "18446744073709551615");
        assert_eq!(
            bench.one(&file, None).0["result"]["models"][0]["entry"],
            Value::Null
        );
        // Пустое имя и кириллица.
        let (response, _) = bench.run(&json!({"mode": "lamp-studio-inspect", "lampStudioModels": [{"file": file, "model": ""}, {"file": file, "model": "фонарь №1"}]}));
        assert_eq!(response["result"]["models"][0]["model"], "");
        assert_eq!(response["result"]["models"][1]["model"], "фонарь №1");
    }

    #[test]
    fn several_models_keep_their_order_and_one_failure_drops_all() {
        let bench = Bench::new();
        let yft = bench.put("a.yft", &fragment(&[lamp(1, 1, [1, 2, 3], 1.0)]));
        let ydr = bench.put(
            "b.ydr",
            &drawable(&[lamp(1, 1, [1, 2, 3], 1.0), lamp(2, 1, [3, 2, 1], 2.0)]),
        );
        let request =
            |models: Value| json!({"mode": "lamp-studio-inspect", "lampStudioModels": models});
        let (response, code) = bench.run(&request(json!([
            {"file": yft, "model": "a"}, {"file": ydr, "model": "b"}, {"file": yft, "model": "a"}
        ])));
        assert_eq!(code, 0, "{response}");
        let names: Vec<&str> = response["result"]["models"]
            .as_array()
            .expect("массив")
            .iter()
            .map(|m| m["model"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(names, ["a", "b", "a"]);
        let models: Vec<Value> = (0..64)
            .map(|i| json!({"file": yft, "model": format!("m{i}")}))
            .collect();
        assert_eq!(
            bench.run(&request(Value::Array(models))).0["result"]["models"]
                .as_array()
                .map(Vec::len),
            Some(64)
        );
        let missing = bench.dir.path().join("missing.yft").display().to_string();
        let (response, _) = bench.run(&request(
            json!([{"file": yft, "model": "ok"}, {"file": missing, "model": "x"}]),
        ));
        assert_eq!(
            refused(&response),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {missing}")
            )
        );
    }

    #[test]
    fn model_level_refusals_in_their_order() {
        let bench = Bench::new();
        let yft = bench.put("a.yft", &fragment(&[]));
        let model = |item: Value| {
            refused(
                &bench
                    .run(&json!({"mode": "lamp-studio-inspect", "lampStudioModels": [item]}))
                    .0,
            )
        };
        assert_eq!(model(json!(5)), host("Модель без файла"));
        assert_eq!(model(json!({})), host("Модель без файла"));
        assert_eq!(
            model(json!({"file": 5, "model": "m"})),
            host("Модель без файла")
        );
        assert_eq!(model(json!({"file": yft})), host("Модель без имени"));
        assert_eq!(
            model(json!({"file": yft, "model": 5})),
            host("Модель без имени")
        );
        assert_eq!(
            model(json!({"model": "m", "file": "a.yft"})),
            host("Путь модели не абсолютный")
        );
        assert_eq!(model(json!({"file": "a.yft"})), host("Модель без имени"));
        for relative in ["", "C:a.yft", "dir\\a.yft", "\\a.yft"] {
            assert_eq!(
                model(json!({"file": relative, "model": "m"})),
                host("Путь модели не абсолютный"),
                "{relative:?}"
            );
        }
        let only = host("Опись света — только .yft, .ydr и .ydd");
        let base = bench.dir.path().display().to_string();
        for tail in ["x.ymap", "x.txt", "noext", "x.yft.bak", "x.doc"] {
            assert_eq!(
                model(json!({"file": format!("{base}\\{tail}"), "model": "m"})),
                only,
                "{tail}"
            );
        }
        // Файл, названный целиком `.yft`: у пути расширения нет.
        let bare = bench.put(".yft", &fragment(&[]));
        assert_eq!(
            model(json!({"file": bare, "model": "m"})),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: ".to_owned()
            )
        );
        let folder = bench.dir.path().join("d.yft");
        fs::create_dir(&folder).expect("папка");
        let shown = folder.display().to_string();
        assert_eq!(
            model(json!({"file": shown, "model": "m"})),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {shown}")
            )
        );
        // Тот же путь с `..` и прямыми слэшами годится.
        let tricky = format!("{}/x/../a.yft", bench.dir.path().display());
        assert_eq!(bench.one(&tricky, None).1, 0);
    }

    #[test]
    fn broken_resources_numbers_and_panics() {
        let bench = Bench::new();
        let case = |name: &str, bytes: &[u8]| refused(&bench.one(&bench.put(name, bytes), None).0);
        let invalid = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        assert_eq!(case("e.yft", b""), invalid("Ресурс короче заголовка RSC7."));
        assert_eq!(
            case("m.yft", &[3u8; 40]),
            invalid("Файл не является ресурсом RSC7.")
        );
        assert_eq!(
            case("m.ydd", &[3u8; 40]),
            invalid("Файл не является ресурсом RSC7.")
        );
        let mut head = fragment(&[]);
        head.truncate(16);
        assert_eq!(
            case("h.yft", &head),
            invalid("Поток ресурса пуст или не распакован.")
        );
        let mut body = vec![0u8; 0x120 + LIGHT_BYTES];
        body[0x110..0x118].copy_from_slice(&0x5000_0120u64.to_le_bytes());
        body[0x118..0x11a].copy_from_slice(&5000u16.to_le_bytes());
        assert_eq!(
            case("big.yft", &pack(0xa2, &body)),
            invalid("Чтение за концом данных ресурса.")
        );
        for (name, value) in [
            ("nan", f32::NAN),
            ("inf", f32::INFINITY),
            ("neg", f32::NEG_INFINITY),
        ] {
            let mut light = lamp(1, 1, [1, 2, 3], 5.0);
            light.intensity = value;
            // Раньше соседняя запись числа паниковала («научная запись»), ответ был InternalError.
            assert_eq!(
                case(&format!("{name}.yft"), &fragment(&[light])),
                invalid("Свет 0: поле intensity не число (NaN или бесконечность).")
            );
        }
        let mut nan = lamp(1, 1, [1, 2, 3], 5.0);
        nan.falloff = f32::NAN;
        assert_eq!(
            case("d.ydd", &dictionary(&[Some(vec![nan])], 1)),
            invalid("Свет 0: поле falloff не число (NaN или бесконечность).")
        );
        // Особые числа в описи: стандартная запись serde_json.
        let mut odd = lamp(1, 1, [1, 2, 3], 1.0e15);
        odd.falloff = 1.0e16;
        odd.falloff_exponent = 1.0e-5;
        odd.corona_intensity = f32::from_bits(1);
        odd.corona_size = -0.0;
        let file = bench.put("odd.yft", &fragment(&[odd]));
        bench.one(&file, None);
        let argv = vec![
            "lamp-studio-inspect".to_owned(),
            "--input".to_owned(),
            bench.dir.path().join("req.json").display().to_string(),
        ];
        let light = crate::run(&argv, &Progress::silent()).line;
        for expected in [
            "\"intensity\":1000000000000000.0",
            "\"falloff\":1e+16",
            "\"falloffExponent\":0.00001",
            "\"corona\":{\"intensity\":1.0000000000000001e-45,\"size\":-0.0}",
        ] {
            assert!(light.contains(expected), "{expected} в {light}");
        }
    }

    #[test]
    fn request_level_refusals_in_their_order() {
        let bench = Bench::new();
        let run_arg = |args: &[&str]| {
            let argv: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
            let outcome = crate::run(&argv, &Progress::silent());
            serde_json::from_str::<Value>(&outcome.line).expect("JSON")
        };
        assert_eq!(
            refused(&run_arg(&["lamp-studio-inspect"])).1,
            "--input is required."
        );
        let missing = bench.dir.path().join("none.json").display().to_string();
        assert_eq!(
            refused(&run_arg(&["lamp-studio-inspect", "--input", &missing])),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {missing}")
            )
        );
        let text = bench.put("req.txt", b"{}");
        assert_eq!(
            refused(&run_arg(&["lamp-studio-inspect", "--input", &text])),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .txt".to_owned()
            )
        );
        for text in ["", "not json"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос описи света не читается")
            );
        }
        for text in ["[]", "{}", "{\"mode\":\"lamp-plan\"}"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос описи света другого режима")
            );
        }
        let missing_list = [
            "{\"mode\":\"lamp-studio-inspect\"}",
            "{\"mode\":\"lamp-studio-inspect\",\"lampStudioModels\":null}",
            "{\"mode\":\"lamp-studio-inspect\",\"lampStudioModels\":{}}",
        ];
        for text in missing_list {
            assert_eq!(refused(&bench.run_text(text).0), host("Нет моделей"));
        }
        assert_eq!(
            refused(
                &bench
                    .run_text("{\"mode\":\"lamp-studio-inspect\",\"lampStudioModels\":[]}")
                    .0
            ),
            host("Число моделей вне 1…512")
        );
        let too_many = vec![json!({"file": "x", "model": "m"}); 513];
        assert_eq!(
            refused(
                &bench
                    .run(&json!({"mode": "lamp-studio-inspect", "lampStudioModels": too_many}))
                    .0
            ),
            host("Число моделей вне 1…512")
        );
        // Мастерская фонарей спрашивает все 83 модели разом (сверка 16.11.2026): прежний предел в 64 отказывал им всем.
        let yft = bench.put("workshop.yft", &fragment(&[]));
        let workshop: Vec<Value> = (0..83)
            .map(|index| json!({"file": yft, "model": format!("prop_streetlight_{index}"), "entry": "x.yft"}))
            .collect();
        let (response, code) = bench.run(&json!({"mode": "lamp-studio-inspect", "lampStudioModels": workshop}));
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["models"].as_array().map(Vec::len), Some(83));
        // Лишние ключи не мешают.
        let yft = bench.put("a.yft", &fragment(&[]));
        let (response, code) = bench.run(&json!({"mode": "lamp-studio-inspect", "extra": 1, "lampStudioModels": [{"file": yft, "model": "m", "x": 1}]}));
        assert_eq!(code, 0, "{response}");
    }
}
