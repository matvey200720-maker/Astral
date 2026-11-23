//! `lamp-studio-ytyp`: расширения-частицы на архетипах фонарей в файле типов `.ytyp`.
//!
//! Модуль разбирает запрос в `Job`, зовёт `ytyp_particles::patch`, проверяет, что
//! результат читается, и пишет его в новый файл. Правила содержимого запроса
//! (префикс, имена, пределы точек) проверяет сосед при перестройке.

use std::path::{Path, PathBuf};

use rage_res::ytyp_particles::{Patched, Point, Request};
use serde_json::Value;

use super::lamp_mutations::refuse;
use crate::error::Result;

/// Читатель JSON-объекта: типизированные поля по ключу, всё чужого типа — `None`.
struct Fields<'a>(&'a Value);

impl<'a> Fields<'a> {
    fn pick<T>(&self, key: &str, convert: fn(&'a Value) -> Option<T>) -> Option<T> {
        convert(self.0.get(key)?)
    }

    fn text(&self, key: &str) -> Option<&'a str> {
        self.pick(key, Value::as_str)
    }

    fn whole(&self, key: &str) -> Option<u64> {
        self.pick(key, Value::as_u64)
    }

    fn real(&self, key: &str) -> Option<f64> {
        self.pick(key, Value::as_f64)
    }

    fn list(&self, key: &str) -> Option<&'a Vec<Value>> {
        self.pick(key, Value::as_array)
    }
}

/// Значение, которого не хватило запросу, — отказ с этим текстом.
fn need<T>(found: Option<T>, what: &str) -> Result<T> {
    found.ok_or_else(|| refuse(what))
}

/// Разобранный запрос: входной `.ytyp`, путь нового файла, префикс и частицы.
struct Job<'a> {
    input: PathBuf,
    output: PathBuf,
    prefix: &'a str,
    wanted: Vec<Request>,
}

impl<'a> Job<'a> {
    /// Порядок проверок: файлы, префикс, список запросов.
    fn of(request: &Fields<'a>) -> Result<Self> {
        let (input, output) = locate(request)?;
        let prefix = need(
            request.text("lampStudioExtensionPrefix"),
            "Нет префикса частиц",
        )?;
        let wanted = particle_requests(request)?;
        Ok(Self {
            input,
            output,
            prefix,
            wanted,
        })
    }

    /// Исходные байты и перестроенный файл; результат обязан читаться.
    fn rewrite(&self) -> Result<(Vec<u8>, Patched)> {
        let source = std::fs::read(&self.input)?;
        let patched = rage_res::ytyp_particles::patch(&source, self.prefix, &self.wanted)
            .map_err(|_| refuse("Файл типов не переписан"))?;
        match rage_res::meta_graph::read(&patched.bytes) {
            Ok(_) => Ok((source, patched)),
            Err(_) => Err(refuse("Результат не читается")),
        }
    }
}

pub fn lamp_studio_ytyp(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Result<Value> {
    let root = read_request(options.required("input")?)?;
    let job = Job::of(&Fields(&root))?;
    let (source, patched) = job.rewrite()?;
    save(&job.output, &patched.bytes)?;
    Ok(answer(&job.output, &source, patched))
}

/// Папки вокруг результата и сам файл через черновик рядом.
fn save(path: &Path, bytes: &[u8]) -> Result<()> {
    path.parent().map(std::fs::create_dir_all).transpose()?;
    super::shop::write_atomic(path, bytes)
}

fn answer(output: &Path, source: &[u8], patched: Patched) -> Value {
    let digest = rage_res::hash::sha256_hex;
    let validated = ["reopened", "onlyAstralParticlesChanged"]
        .iter()
        .map(|key| ((*key).to_owned(), Value::Bool(true)))
        .collect();
    let pairs: [(&str, Value); 9] = [
        ("status", "ready".into()),
        ("mode", "lamp-studio-ytyp".into()),
        ("output", output.display().to_string().into()),
        ("inputSha256", digest(source).into()),
        ("outputSha256", digest(&patched.bytes).into()),
        ("archetypes", patched.archetypes.into()),
        ("added", patched.added.into()),
        ("missing", patched.missing.into()),
        ("validation", Value::Object(validated)),
    ];
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn read_request(given: &str) -> Result<Value> {
    let bytes = std::fs::read(crate::paths::existing_file(given, &[".json"])?)?;
    let Ok(root) = serde_json::from_slice::<Value>(&bytes) else {
        return Err(refuse("Запрос частиц не читается"));
    };
    match root.get("mode") {
        Some(Value::String(mode)) if mode == "lamp-studio-ytyp" => Ok(root),
        _ => Err(refuse("Запрос частиц другого режима")),
    }
}

/// Существующий входной `.ytyp` и путь нового файла, отличный от входа.
fn locate(request: &Fields) -> Result<(PathBuf, PathBuf)> {
    let given = request.text("inputFile").unwrap_or("");
    let input = crate::paths::existing_file(given, &[".ytyp"])
        .map_err(|_| refuse("Файл типов не найден"))?;
    let output = request
        .text("outputFile")
        .and_then(|given| crate::paths::full_path(given).ok());
    let output = need(output, "Путь результата не годится")?;
    if output == input || super::lamp_mutations::is_same_file(&input, &output) {
        return Err(refuse("Результат совпадает со входом"));
    }
    Ok((input, output))
}

/// Запросы частиц по порядку; пределы значений проверяет сосед, не этот разбор.
fn particle_requests(request: &Fields) -> Result<Vec<Request>> {
    let items = need(request.list("lampStudioExtensions"), "Нет запросов частиц")?;
    match items.len() {
        0..=512 => items
            .iter()
            .map(|item| particle_request(&Fields(item)))
            .collect(),
        _ => Err(refuse("Запросов больше 512")),
    }
}

fn particle_request(item: &Fields) -> Result<Request> {
    let [archetype, fx_name] = [
        ("archetype", "Запрос без архетипа"),
        ("fxName", "Запрос без эффекта"),
    ]
    .map(|(key, what)| need(item.text(key), what).map(str::to_owned));
    let (archetype, fx_name) = (archetype?, fx_name?);
    let wide = need(item.whole("probability"), "Вероятность не число")?;
    let points = need(item.list("points"), "Запрос без точек")?
        .iter()
        .map(|raw| point_of(&Fields(raw)))
        .collect::<Result<Vec<Point>>>()?;
    let probability = need(u32::try_from(wide).ok(), "Вероятность вне пределов")?;
    Ok(Request {
        archetype,
        fx_name,
        probability,
        points,
    })
}

/// Точка: сначала кость целым, потом три координаты числами, потом кость в 32 бита.
fn point_of(raw: &Fields) -> Result<Point> {
    let wide = need(raw.whole("bone"), "Кость не число")?;
    let [Some(x), Some(y), Some(z)] = ["x", "y", "z"].map(|axis| raw.real(axis)) else {
        return Err(refuse("Координата точки не число"));
    };
    let bone = need(u32::try_from(wide).ok(), "Кость вне диапазона")?;
    Ok(Point {
        x: x as f32,
        y: y as f32,
        z: z as f32,
        bone,
    })
}

pub const COMMANDS: &[super::Command] =
    &[super::Command::new("lamp-studio-ytyp", lamp_studio_ytyp)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use crate::test_support;
    use serde_json::json;
    use std::fs;
    use std::path::Path;

    struct Bench {
        dir: tempfile::TempDir,
        ytyp: PathBuf,
    }

    impl Bench {
        /// Файл типов без описания частицы в схеме: из парити-образцов.
        fn plain() -> Self {
            let dir = tempfile::tempdir().expect("папка");
            let ytyp = dir.path().join("types.ytyp");
            fs::copy(
                test_support::engine("parity/host-port/placements/sample-types.ytyp"),
                &ytyp,
            )
            .expect("копия");
            Self { dir, ytyp }
        }

        fn out(&self, tail: &str) -> String {
            tail.split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
                .display()
                .to_string()
        }

        fn request(&self, output: &str, extensions: Value) -> Value {
            json!({
                "mode": "lamp-studio-ytyp",
                "inputFile": self.ytyp.display().to_string(),
                "outputFile": output,
                "lampStudioExtensionPrefix": "astral_lamp_",
                "lampStudioExtensions": extensions,
            })
        }

        fn good(&self) -> Value {
            json!([{
                "archetype": "prop_streetlight_01", "fxName": "astral_lamp_fx", "probability": 70,
                "points": [{"x": 1.9, "y": 0, "z": 9.1, "bone": 29567}],
            }])
        }

        fn run(&self, request: &Value) -> (Value, i32) {
            self.run_text(&request.to_string())
        }

        fn run_text(&self, text: &str) -> (Value, i32) {
            let file = self.dir.path().join("req.json");
            fs::write(&file, text).expect("запись");
            run_args(&["lamp-studio-ytyp", "--input", &file.display().to_string()])
        }
    }

    fn run_args(args: &[&str]) -> (Value, i32) {
        let argv: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        let outcome = crate::run(&argv, &Progress::silent());
        (
            serde_json::from_str(&outcome.line).expect("JSON"),
            outcome.exit_code,
        )
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

    #[test]
    fn request_file_failures() {
        let bench = Bench::plain();
        assert_eq!(
            refused(&run_args(&["lamp-studio-ytyp"]).0).1,
            "--input is required."
        );
        let missing = bench.out("none.json");
        assert_eq!(
            refused(&run_args(&["lamp-studio-ytyp", "--input", &missing]).0),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {missing}")
            )
        );
        let text = bench.out("req.txt");
        fs::write(&text, "{}").expect("запись");
        assert_eq!(
            refused(&run_args(&["lamp-studio-ytyp", "--input", &text]).0).1,
            "Unsupported file extension: .txt"
        );
        for text in [
            "",
            "not json",
            "\u{feff}{}",
            "{\"mode\":\"lamp-studio-ytyp\"} x",
        ] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос частиц не читается"),
                "{text:?}"
            );
        }
        for text in [
            "[]",
            "{}",
            "null",
            "{\"mode\":\"lamp-plan\"}",
            "{\"mode\":5}",
        ] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос частиц другого режима"),
                "{text:?}"
            );
        }
    }

    #[test]
    fn paths_and_the_prefix_and_list_come_before_the_file_content() {
        let bench = Bench::plain();
        let output = bench.out("out.ytyp");
        let mut request = bench.request(&output, bench.good());
        let not_found = host("Файл типов не найден");
        for input in [
            json!(null),
            json!(5),
            json!(""),
            json!(bench.out("absent.ytyp")),
            json!(bench.out("types.txt")),
        ] {
            request["inputFile"] = input;
            assert_eq!(refused(&bench.run(&request).0), not_found);
        }
        fs::create_dir(bench.out("d.ytyp")).expect("папка");
        request["inputFile"] = json!(bench.out("d.ytyp"));
        assert_eq!(refused(&bench.run(&request).0), not_found);
        let mut request = bench.request(&output, bench.good());
        let unusable = host("Путь результата не годится");
        for value in [json!(""), json!("   "), json!(5), Value::Null] {
            request["outputFile"] = value;
            assert_eq!(refused(&bench.run(&request).0), unusable);
        }
        request
            .as_object_mut()
            .expect("объект")
            .remove("outputFile");
        assert_eq!(refused(&bench.run(&request).0), unusable);
        // Результат совпадает со входом по тексту пути (после свёртки), раньше префикса.
        let same = bench.ytyp.display().to_string();
        let mut request = bench.request(&same, bench.good());
        request
            .as_object_mut()
            .expect("объект")
            .remove("lampStudioExtensionPrefix");
        assert_eq!(
            refused(&bench.run(&request).0),
            host("Результат совпадает со входом")
        );
        // Тот же файл в другом регистре (Windows): раньше результат перезаписывал вход.
        #[cfg(windows)]
        {
            let upper = bench.out("TYPES.YTYP");
            assert_eq!(
                refused(&bench.run(&bench.request(&upper, bench.good())).0),
                host("Результат совпадает со входом")
            );
        }
        let detour = format!("{}\\zz\\..\\types.ytyp", bench.dir.path().display());
        assert_eq!(
            refused(&bench.run(&bench.request(&detour, bench.good())).0),
            host("Результат совпадает со входом")
        );
        let mut request = bench.request(&output, bench.good());
        request
            .as_object_mut()
            .expect("объект")
            .remove("lampStudioExtensionPrefix");
        assert_eq!(refused(&bench.run(&request).0), host("Нет префикса частиц"));
        request["lampStudioExtensionPrefix"] = json!(5);
        assert_eq!(refused(&bench.run(&request).0), host("Нет префикса частиц"));
        let mut request = bench.request(&output, Value::Null);
        request
            .as_object_mut()
            .expect("объект")
            .remove("lampStudioExtensions");
        assert_eq!(refused(&bench.run(&request).0), host("Нет запросов частиц"));
        assert_eq!(
            refused(&bench.run(&bench.request(&output, json!({}))).0),
            host("Нет запросов частиц")
        );
        let many = vec![json!({}); 513];
        assert_eq!(
            refused(&bench.run(&bench.request(&output, Value::Array(many))).0),
            host("Запросов больше 512")
        );
        assert!(!Path::new(&output).exists());
    }

    #[test]
    fn element_rules_in_their_order() {
        let bench = Bench::plain();
        let output = bench.out("out.ytyp");
        let full = || json!({"archetype": "a", "fxName": "astral_lamp_fx", "probability": 5, "points": [{"x": 1, "y": 2, "z": 3, "bone": 4}]});
        let with = |key: &str, value: Value| {
            let mut item = full();
            item.as_object_mut()
                .expect("объект")
                .insert(key.to_owned(), value);
            item
        };
        let without = |key: &str| {
            let mut item = full();
            item.as_object_mut().expect("объект").remove(key);
            item
        };
        let run = |item: Value| refused(&bench.run(&bench.request(&output, json!([item]))).0);
        assert_eq!(run(without("archetype")), host("Запрос без архетипа"));
        assert_eq!(
            run(with("archetype", json!(5))),
            host("Запрос без архетипа")
        );
        assert_eq!(run(without("fxName")), host("Запрос без эффекта"));
        assert_eq!(run(without("probability")), host("Вероятность не число"));
        assert_eq!(
            run(with("probability", json!(70.0))),
            host("Вероятность не число")
        );
        assert_eq!(
            run(with("probability", json!(-1))),
            host("Вероятность не число")
        );
        assert_eq!(run(without("points")), host("Запрос без точек"));
        assert_eq!(run(with("points", json!({}))), host("Запрос без точек"));
        let point = |value: Value| run(with("points", json!([value])));
        assert_eq!(
            point(json!({"x": 1, "y": 2, "z": 3})),
            host("Кость не число")
        );
        assert_eq!(
            point(json!({"x": 1, "y": 2, "z": 3, "bone": 1.5})),
            host("Кость не число")
        );
        assert_eq!(
            point(json!({"y": 2, "z": 3, "bone": 1})),
            host("Координата точки не число")
        );
        assert_eq!(
            point(json!({"x": "1", "y": 2, "z": 3, "bone": 1})),
            host("Координата точки не число")
        );
        assert_eq!(
            point(json!({"x": 1, "y": 2, "z": null, "bone": 1})),
            host("Координата точки не число")
        );
        // Кость вне 32 бит проверяется после координат, вероятность — после всех точек.
        assert_eq!(
            point(json!({"x": 1, "y": 2, "z": 3, "bone": 4294967296u64})),
            host("Кость вне диапазона")
        );
        assert_eq!(
            point(json!({"x": "q", "y": 2, "z": 3, "bone": 4294967296u64})),
            host("Координата точки не число")
        );
        assert_eq!(
            run(with("probability", json!(4294967296u64))),
            host("Вероятность вне пределов")
        );
        let bad_point_and_probability = {
            let mut item = with("probability", json!(4294967296u64));
            item["points"] = json!([{"x": 1, "y": 2, "z": 3}]);
            item
        };
        assert_eq!(run(bad_point_and_probability), host("Кость не число"));
        // Ошибка запроса побеждает ошибку содержимого файла (в файле нет частицы в схеме).
        assert_eq!(run(without("fxName")), host("Запрос без эффекта"));
        assert!(!Path::new(&output).exists());
    }

    #[test]
    fn content_rules_and_file_problems_are_all_reported_as_one_text() {
        let bench = Bench::plain();
        let output = bench.out("out/new.ytyp");
        let rewrite_failed = host("Файл типов не переписан");
        // В схеме образца нет частицы.
        assert_eq!(
            refused(&bench.run(&bench.request(&output, bench.good())).0),
            rewrite_failed
        );
        assert_eq!(
            refused(&bench.run(&bench.request(&output, json!([]))).0),
            rewrite_failed
        );
        // Нарушены правила соседа: префикс, имя архетипа, эффект без префикса, точки.
        let mut request = bench.request(&output, bench.good());
        request["lampStudioExtensionPrefix"] = json!("ab");
        assert_eq!(refused(&bench.run(&request).0), rewrite_failed);
        let foreign = json!([{"archetype": "a", "fxName": "other_fx", "probability": 5, "points": [{"x": 0, "y": 0, "z": 0, "bone": 0}]}]);
        assert_eq!(
            refused(&bench.run(&bench.request(&output, foreign)).0),
            rewrite_failed
        );
        // Не файл типов: словарь и мусор.
        fs::write(
            bench.out("junk.ytyp"),
            b"this is not a ytyp, just some text bytes",
        )
        .expect("запись");
        let mut request = bench.request(&output, bench.good());
        request["inputFile"] = json!(bench.out("junk.ytyp"));
        assert_eq!(refused(&bench.run(&request).0), rewrite_failed);
        let other = test_support::engine("parity/host-port/climb/mod3-types.ytyp");
        let mut request = bench.request(&output, bench.good());
        request["inputFile"] = json!(other.display().to_string());
        assert_eq!(refused(&bench.run(&request).0), rewrite_failed);
        // Папка результата не создаётся, пока перестройка не прошла.
        assert!(!Path::new(&bench.out("out")).exists());
    }

    /// Результат ложится через черновик рядом: имя черновика занято папкой - запись отказывает,
    /// прежний файл цел. Прямая запись молча перезаписала бы его.
    #[test]
    fn a_result_that_cannot_be_staged_leaves_the_old_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("out").join("keep.ytyp");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"old types").unwrap();
        let stage = dir.path().join("out").join("keep.ytyp.shop-stage");
        fs::create_dir(&stage).unwrap();
        let failure = save(&target, b"new types").unwrap_err();
        assert_eq!(failure.code, "UnauthorizedAccessException");
        assert_eq!(fs::read(&target).unwrap(), b"old types");
        assert!(stage.is_dir());

        fs::remove_dir(&stage).unwrap();
        save(&target, b"new types").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new types");
        assert!(!stage.exists());
    }
}
