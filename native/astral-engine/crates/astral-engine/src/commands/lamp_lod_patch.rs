//! `lamp-lod-patch`: правка огней дальнего света в паре карт `.ymap`.
//!
//! Запрос (JSON) превращается в `Plan`; пара читается и сверяется с планом,
//! правки пишутся прямо в тела двух файлов, результат перечитывается и
//! сверяется, и только потом оба файла ложатся на диск рядом с временными.
//! Сторон две, и всё, что к ним относится, лежит в массивах: 0 — файл LOD, 1 — дальний.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use rage_res::ymap_write::LodEdit;
use serde_json::Value;

use super::fresh_dirs::FreshDirs;
use super::lamp_lod_pair::{fingerprint, immutable_json, load_pair, Pair};
use crate::error::{EngineError, Result};

/// Пределы запроса.
mod limits {
    pub const AMENDMENTS: usize = 4096;
    /// Спад и показатель спада: нижняя и верхняя граница включительно.
    pub const FALLOFF: (f32, f32) = (0.01, 10_000.0);
    pub const EXPONENT: (f32, f32) = (0.01, 128.0);
}

/// Ключи запроса и тексты отказов одной стороны пары.
struct Side {
    input: &'static str,
    output: &'static str,
    taken: &'static str,
    sum: &'static str,
}

const SIDES: [Side; 2] = [
    Side {
        input: "lodInputFile",
        output: "lodOutputFile",
        taken: "LOD output must be a new staging path.",
        sum: "expectedLodInputSha256",
    },
    Side {
        input: "distantInputFile",
        output: "distantOutputFile",
        taken: "distant output must be a new staging path.",
        sum: "expectedDistantInputSha256",
    },
];

pub fn lamp_lod_patch(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Result<Value> {
    let request = read_request(options.required("request")?)?;
    // Папки результатов создаются раньше проверок запроса; отказ убирает созданное, пока оно пусто.
    let guard = FreshDirs::merged(
        SIDES
            .iter()
            .map(|side| FreshDirs::beside(Ok(text_at(&request, side.output)))),
    );
    let plan = Plan::of(&request)?;

    let bodies = plan
        .inputs
        .iter()
        .map(std::fs::read)
        .collect::<std::io::Result<Vec<_>>>()?;
    let shas: Vec<String> = bodies
        .iter()
        .map(|body| rage_res::hash::sha256_hex(body))
        .collect();
    if shas != plan.sums {
        return Err(refusal(
            "LOD pair input SHA-256 does not match the approved plan.",
        ));
    }

    let pair = load_pair(&bodies[0], &bodies[1])?;
    let before = snapshot(&pair)?;
    vet(&pair, &before, &plan.amendments)?;

    let edits: Vec<LodEdit> = plan.amendments.iter().map(|a| a.edit.clone()).collect();
    let (new_lod, new_distant) =
        rage_res::ymap_write::edit_lod_pair(&bodies[0], &bodies[1], &edits)?;
    audit(&pair, &before, &edits, (&new_lod, &new_distant))?;
    publish(
        (&plan.outputs[0], &new_lod),
        (&plan.outputs[1], &new_distant),
    )?;
    guard.keep();

    let consumed = |at: usize| {
        object([
            ("path", plan.inputs[at].display().to_string().into()),
            ("sha256", shas[at].as_str().into()),
        ])
    };
    let produced = |at: usize, bytes: &[u8]| {
        object([
            ("path", plan.outputs[at].display().to_string().into()),
            ("sha256", rage_res::hash::sha256_hex(bytes).into()),
            ("bytes", bytes.len().into()),
        ])
    };
    let validation = [
        "reopened",
        "exactInputSha256",
        "exactLightFingerprints",
        "alignedTopologyPreserved",
        "immutableFieldsPreserved",
        "nonLightEnvelopePreserved",
        "stagingOnly",
    ];
    let indices: Vec<u64> = plan.amendments.iter().map(|a| a.index).collect();
    Ok(object([
        ("status", "ready".into()),
        ("mode", "lamp-lod-patch".into()),
        ("edition", "legacy".into()),
        (
            "inputs",
            object([("lod", consumed(0)), ("distant", consumed(1))]),
        ),
        (
            "outputs",
            object([
                ("lod", produced(0, &new_lod)),
                ("distant", produced(1, &new_distant)),
            ]),
        ),
        ("mutatedAlignedLightIndices", indices.into()),
        (
            "validation",
            Value::Object(
                validation
                    .iter()
                    .map(|key| ((*key).to_owned(), Value::Bool(true)))
                    .collect(),
            ),
        ),
    ]))
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn refusal(text: &str) -> EngineError {
    EngineError::invalid_data(text)
}

fn read_request(given: &str) -> Result<Value> {
    let file = crate::paths::existing_file(given, &[".json"])?;
    let bytes = std::fs::read(file)?;
    serde_json::from_slice(&bytes).map_err(|_| refusal("Запрос правки LOD пустой или сломан."))
}

fn text_at<'a>(request: &'a Value, key: &str) -> &'a str {
    request.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Всё, что берётся из запроса: по стороне пары пути, суммы и правки по возрастанию номера огня.
struct Plan {
    inputs: Vec<PathBuf>,
    outputs: Vec<PathBuf>,
    sums: Vec<String>,
    amendments: Vec<Amendment>,
}

impl Plan {
    /// Порядок проверок: входы, результаты, общая папка, суммы, правки.
    fn of(request: &Value) -> Result<Self> {
        let inputs = SIDES
            .iter()
            .map(|side| crate::paths::existing_file(text_at(request, side.input), &[".ymap"]))
            .collect::<Result<Vec<_>>>()?;
        let outputs = SIDES
            .iter()
            .map(|side| fresh_path(text_at(request, side.output), side.taken))
            .collect::<Result<Vec<_>>>()?;
        if outputs[0].parent() != outputs[1].parent() {
            return Err(refusal(
                "LOD pair outputs must share one staging directory.",
            ));
        }
        // Раньше оба результата в один путь проходили, второй затирал первый, и ответ говорил об успехе.
        if outputs[0].to_string_lossy().to_lowercase()
            == outputs[1].to_string_lossy().to_lowercase()
        {
            return Err(refusal("LOD pair outputs must be two different files."));
        }
        let sums = SIDES
            .iter()
            .map(|side| digest_at(request, side.sum))
            .collect::<Result<Vec<_>>>()?;
        let amendments = Amendment::list(request.get("lampLodMutations"))?;
        Ok(Self {
            inputs,
            outputs,
            sums,
            amendments,
        })
    }
}

/// Путь результата: расширение `.ymap`, папки созданы, самого пути ещё нет.
fn fresh_path(given: &str, taken: &str) -> Result<PathBuf> {
    Some(crate::paths::output_file(given, &[".ymap"])?)
        .filter(|path| !path.exists())
        .ok_or_else(|| refusal(taken))
}

/// Ровно 64 шестнадцатеричные цифры любого регистра.
fn is_digest(text: &str) -> bool {
    text.len() == 64 && text.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn digest_at(request: &Value, key: &str) -> Result<String> {
    match text_at(request, key) {
        text if is_digest(text) => Ok(text.to_ascii_lowercase()),
        _ => Err(refusal(&format!("{key} must be a SHA-256 hex string."))),
    }
}

/// Одна правка огня: номер, ожидаемый отпечаток и значения, которые меняются.
struct Amendment {
    index: u64,
    expected: String,
    edit: LodEdit,
}

impl Amendment {
    /// Список правок: длина до разбора, ошибка поля раньше повтора номера, итог по возрастанию номера.
    fn list(raw: Option<&Value>) -> Result<Vec<Self>> {
        let Some(items) = raw.and_then(Value::as_array) else {
            return Err(refusal("lamp-lod-patch requires 1-4096 mutations."));
        };
        if !(1..=limits::AMENDMENTS).contains(&items.len()) {
            return Err(refusal("lamp-lod-patch requires 1-4096 mutations."));
        }
        let mut parsed = Vec::with_capacity(items.len());
        for item in items {
            parsed.push(Self::parse(&Item(item))?);
        }
        parsed.sort_by_key(|amendment| amendment.index);
        match parsed.windows(2).any(|pair| pair[0].index == pair[1].index) {
            true => Err(refusal("Each aligned LOD index may be mutated only once.")),
            false => Ok(parsed),
        }
    }

    fn parse(item: &Item) -> Result<Self> {
        let Some(index) = item.0.get("alignedLightIndex").and_then(Value::as_u64) else {
            return Err(refusal("alignedLightIndex must be a non-negative integer."));
        };
        let colour = item.colour()?;
        let expected = match item.0.get("expectedFingerprint").and_then(Value::as_str) {
            Some(text) if is_digest(text) => text.to_ascii_lowercase(),
            _ => return Err(refusal("expectedFingerprint must be a SHA-256 hex string.")),
        };
        let intensity = item.byte("intensity")?;
        let falloff = item.real("falloff", limits::FALLOFF, "Lamp lod.falloff")?;
        let falloff_exponent = item.real(
            "falloffExponent",
            limits::EXPONENT,
            "Lamp lod.falloffExponent",
        )?;
        let corona_intensity = item.byte("coronaIntensity")?;
        let edit = LodEdit {
            index: usize::try_from(index).unwrap_or(usize::MAX),
            falloff,
            falloff_exponent,
            corona_intensity,
            intensity,
            colour,
        };
        Ok(Self {
            index,
            expected,
            edit,
        })
    }
}

/// Читатель одной правки: поля «не трогать» (нет ключа или `null`) отдаются как `None`.
struct Item<'a>(&'a Value);

impl Item<'_> {
    fn given(&self, key: &str) -> Option<&Value> {
        self.0.get(key).filter(|raw| !raw.is_null())
    }

    fn byte(&self, key: &str) -> Result<Option<u8>> {
        let Some(raw) = self.given(key) else {
            return Ok(None);
        };
        match as_byte(raw) {
            Some(value) => Ok(Some(value)),
            None => Err(refusal(&format!("{key} must be a byte from 0 to 255."))),
        }
    }

    fn colour(&self) -> Result<Option<[u8; 3]>> {
        let Some(raw) = self.given("color") else {
            return Ok(None);
        };
        let channel = |name: &str| {
            raw.get(name)
                .and_then(as_byte)
                .ok_or_else(|| refusal(&format!("color.{name} must be a byte from 0 to 255.")))
        };
        Ok(Some([channel("r")?, channel("g")?, channel("b")?]))
    }

    /// Число в пределах (проверка в `f32`); не число молча пропускается.
    fn real(&self, key: &str, (low, high): (f32, f32), label: &str) -> Result<Option<f32>> {
        let Some(number) = self.0.get(key).and_then(Value::as_f64) else {
            return Ok(None);
        };
        let narrowed = number as f32;
        if (low..=high).contains(&narrowed) {
            Ok(Some(narrowed))
        } else {
            Err(refusal(&format!(
                "{label} is outside the helper safety envelope."
            )))
        }
    }
}

fn as_byte(raw: &Value) -> Option<u8> {
    u8::try_from(raw.as_u64()?).ok()
}

/// Отпечаток и неизменяемая запись огня.
#[derive(PartialEq)]
struct Digest {
    fingerprint: String,
    immutable: String,
}

/// Снимок каждого огня пары; `NaN` и бесконечность отказывают здесь.
fn snapshot(pair: &Pair) -> Result<Vec<Digest>> {
    let mut digests = Vec::with_capacity(pair.count);
    for slot in 0..pair.count {
        digests.push(Digest {
            fingerprint: fingerprint(&pair.lod, &pair.distant, slot)?,
            immutable: immutable_json(&pair.lod, &pair.distant, slot)?,
        });
    }
    Ok(digests)
}

/// Каждая правка по возрастанию номера: огонь в паре и его отпечаток прежний.
fn vet(pair: &Pair, before: &[Digest], amendments: &[Amendment]) -> Result<()> {
    for amendment in amendments {
        let slot = match usize::try_from(amendment.index) {
            Ok(slot) if slot < pair.count => slot,
            _ => {
                return Err(refusal(&format!(
                    "Aligned LOD index is out of range: {}.",
                    amendment.index
                )))
            }
        };
        if before[slot].fingerprint != amendment.expected {
            return Err(refusal(&format!(
                "LOD light fingerprint changed at index {}.",
                amendment.index
            )));
        }
    }
    Ok(())
}

fn require(holds: bool, what: &str) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(refusal(what))
    }
}

/// Результат читается заново: топология, сводки полей, огни вне правок, неизменяемая часть и точные значения.
fn audit(
    pair: &Pair,
    before: &[Digest],
    edits: &[LodEdit],
    (new_lod, new_distant): (&[u8], &[u8]),
) -> Result<()> {
    let after = load_pair(new_lod, new_distant)?;
    require(
        after.count == pair.count,
        "Patched LOD pair changed aligned array topology.",
    )?;
    let moved: Vec<String> = [
        ("lod", &pair.lod_envelope, &after.lod_envelope),
        ("distant", &pair.distant_envelope, &after.distant_envelope),
    ]
    .into_iter()
    .flat_map(|(side, was, is)| changed_keys(side, was, is))
    .collect();
    require(
        moved.is_empty(),
        &format!(
            "Patched LOD pair changed non-light envelope fields: {}.",
            moved.join(", ")
        ),
    )?;

    let now = snapshot(&after)?;
    // Правки идут по возрастанию номера, поэтому нужную находит двоичный поиск.
    for slot in 0..pair.count {
        match edits.binary_search_by_key(&slot, |edit| edit.index) {
            Err(_) => require(
                now[slot] == before[slot],
                &format!("Unowned LOD light changed at index {slot}."),
            )?,
            Ok(found) => verify_edit(pair, &after, (before, &now), slot, &edits[found])?,
        }
    }
    Ok(())
}

fn verify_edit(
    old: &Pair,
    new: &Pair,
    (before, now): (&[Digest], &[Digest]),
    slot: usize,
    edit: &LodEdit,
) -> Result<()> {
    require(
        now[slot].immutable == before[slot].immutable,
        &format!("Immutable LOD fields changed at index {slot}."),
    )?;
    let bits = |wanted: Option<f32>, was: f32| wanted.unwrap_or(was).to_bits();
    let (was, is) = (old.distant.colours[slot], new.distant.colours[slot]);
    let colour = edit.colour.map_or(was & 0x00ff_ffff, |[r, g, b]| {
        u32::from_be_bytes([0, r, g, b])
    });
    require(
        bits(edit.falloff, old.lod.falloff[slot]) == new.lod.falloff[slot].to_bits(),
        "Patched LOD failed exact falloff verification.",
    )?;
    require(
        bits(edit.falloff_exponent, old.lod.falloff_exponent[slot])
            == new.lod.falloff_exponent[slot].to_bits(),
        "Patched LOD failed exact falloffExponent verification.",
    )?;
    require(
        edit.corona_intensity
            .unwrap_or(old.lod.corona_intensity[slot])
            == new.lod.corona_intensity[slot],
        "Patched LOD failed exact corona verification.",
    )?;
    require(
        u32::from(edit.intensity.unwrap_or((was >> 24) as u8)) == is >> 24,
        "Patched LOD failed exact intensity verification.",
    )?;
    require(
        colour == is & 0x00ff_ffff,
        "Patched LOD failed exact RGB verification.",
    )
}

/// Ключи сводки, значение которых отличается, в порядке имён, с приставкой стороны.
fn changed_keys(
    side: &str,
    before: &std::collections::BTreeMap<String, String>,
    after: &std::collections::BTreeMap<String, String>,
) -> Vec<String> {
    let names: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
    names
        .into_iter()
        .filter(|key| before.get(*key) != after.get(*key))
        .map(|key| format!("{side}.{key}"))
        .collect()
}

/// Что уже лежит на диске из-за этой команды; пока запись не доведена до конца, всё убирается при выходе.
struct Staged {
    temps: Vec<PathBuf>,
    placed: Vec<PathBuf>,
    finished: bool,
}

impl Drop for Staged {
    fn drop(&mut self) {
        if !self.finished {
            for path in self.temps.iter().chain(&self.placed) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

/// Оба файла рядом с результатами под временными именами, проверка, что результатов ещё нет, затем
/// переименование. Любой сбой убирает оба временных файла и те результаты, которые поставила эта команда.
fn publish(lod: (&Path, &[u8]), distant: (&Path, &[u8])) -> Result<()> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let marker = format!("{}-{nanos}", std::process::id());
    let beside = |path: &Path, tail: String| {
        let mut name = path.as_os_str().to_owned();
        name.push(tail);
        PathBuf::from(name)
    };
    let mut staged = Staged {
        temps: vec![
            beside(lod.0, format!(".lamp-lod-{marker}")),
            beside(distant.0, format!(".lamp-dist-{marker}")),
        ],
        placed: Vec::new(),
        finished: false,
    };

    for (temp, bytes) in staged.temps.iter().zip([lod.1, distant.1]) {
        std::fs::write(temp, bytes)?;
    }
    if lod.0.exists() || distant.0.exists() {
        return Err(refusal(
            "LOD pair output appeared while patching; nothing was written.",
        ));
    }
    for (at, target) in [lod.0, distant.0].into_iter().enumerate() {
        std::fs::rename(&staged.temps[at], target)?;
        staged.placed.push(target.to_path_buf());
    }
    staged.finished = true;
    Ok(())
}

pub const COMMANDS: &[super::Command] = &[super::Command::new("lamp-lod-patch", lamp_lod_patch)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use crate::test_support;
    use rage_res::hash::sha256_hex;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::fs;

    fn sample(name: &str) -> PathBuf {
        test_support::engine(&format!(
            "parity/host-port/lamp-lod-inspect-pair/pairs/{name}"
        ))
    }

    struct Bench {
        dir: tempfile::TempDir,
        lod: PathBuf,
        distant: PathBuf,
        pair: Pair,
        lod_sum: String,
        distant_sum: String,
    }

    impl Bench {
        fn new() -> Self {
            Self::of("small045")
        }

        fn of(name: &str) -> Self {
            let dir = tempfile::tempdir().expect("папка");
            let lod = dir.path().join(format!("lodlights_{name}.ymap"));
            let distant = dir.path().join(format!("distlodlights_{name}.ymap"));
            fs::copy(sample(&format!("lodlights_{name}.ymap")), &lod).expect("копия");
            fs::copy(sample(&format!("distlodlights_{name}.ymap")), &distant).expect("копия");
            Self::around(dir, lod, distant)
        }

        fn around(dir: tempfile::TempDir, lod: PathBuf, distant: PathBuf) -> Self {
            let (lod_bytes, distant_bytes) = (
                fs::read(&lod).expect("файл"),
                fs::read(&distant).expect("файл"),
            );
            let pair = load_pair(&lod_bytes, &distant_bytes).unwrap_or(Pair {
                lod: Default::default(),
                distant: Default::default(),
                lod_envelope: BTreeMap::new(),
                distant_envelope: BTreeMap::new(),
                count: 0,
            });
            Self {
                dir,
                lod,
                distant,
                pair,
                lod_sum: sha256_hex(&lod_bytes),
                distant_sum: sha256_hex(&distant_bytes),
            }
        }

        fn fp(&self, index: usize) -> String {
            fingerprint(&self.pair.lod, &self.pair.distant, index).expect("отпечаток")
        }

        fn out(&self, tail: &str) -> String {
            tail.split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
                .display()
                .to_string()
        }

        fn request(&self, mutations: Value) -> Value {
            json!({
                "lodInputFile": self.lod.display().to_string(),
                "distantInputFile": self.distant.display().to_string(),
                "lodOutputFile": self.out("out/lod.ymap"),
                "distantOutputFile": self.out("out/dist.ymap"),
                "expectedLodInputSha256": self.lod_sum,
                "expectedDistantInputSha256": self.distant_sum,
                "lampLodMutations": mutations,
            })
        }

        fn edit(&self, index: usize, fields: Value) -> Value {
            let mut item =
                json!({"alignedLightIndex": index, "expectedFingerprint": self.fp(index)});
            item.as_object_mut()
                .expect("объект")
                .extend(fields.as_object().expect("объект").clone());
            item
        }

        fn run(&self, request: &Value) -> (Value, i32) {
            self.run_text(&request.to_string())
        }

        fn run_text(&self, text: &str) -> (Value, i32) {
            let file = self.dir.path().join("req.json");
            fs::write(&file, text).expect("запись");
            run_args(&["lamp-lod-patch", "--request", &file.display().to_string()])
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

    fn data(text: &str) -> (String, String) {
        ("InvalidDataException".to_owned(), text.to_owned())
    }

    fn all_fields() -> Value {
        json!({"color": {"r": 10, "g": 20, "b": 30}, "intensity": 200, "falloff": 12.5, "falloffExponent": 4, "coronaIntensity": 9})
    }

    fn bench_distant(bench: &Bench) -> Vec<u8> {
        fs::read(&bench.distant).expect("файл")
    }

    fn read_back(path: &str) -> (Vec<u8>, String) {
        let bytes = fs::read(path).expect("файл");
        let sha = sha256_hex(&bytes);
        (bytes, sha)
    }

    #[test]
    fn all_five_fields_reproduce_the_documented_files() {
        let bench = Bench::new();
        let (response, code) = bench.run(&bench.request(json!([bench.edit(0, all_fields())])));
        assert_eq!(code, 0, "{response}");
        let result = &response["result"];
        let (lod, lod_sha) = read_back(&bench.out("out/lod.ymap"));
        let (dist, dist_sha) = read_back(&bench.out("out/dist.ymap"));
        assert_eq!(
            (lod.len(), lod_sha.as_str()),
            (
                4845,
                "0da2e4ec3b121058e0e0e5eb046c8d2ee95b98d732fb0cdef0f8d587a15bffc0"
            )
        );
        assert_eq!(
            (dist.len(), dist_sha.as_str()),
            (
                4451,
                "fce990b78e8628437bae209c2d9b24fd88ccc27ad4552ba7178e07720fe34f29"
            )
        );
        assert_eq!(
            result["outputs"]["lod"],
            json!({"path": bench.out("out/lod.ymap"), "sha256": lod_sha, "bytes": 4845})
        );
        assert_eq!(
            result["outputs"]["distant"],
            json!({"path": bench.out("out/dist.ymap"), "sha256": dist_sha, "bytes": 4451})
        );
        assert_eq!(
            result["inputs"]["lod"],
            json!({"path": bench.lod.display().to_string(), "sha256": bench.lod_sum})
        );
        assert_eq!(result["mutatedAlignedLightIndices"], json!([0]));
        let keys: Vec<&String> = result.as_object().expect("объект").keys().collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "edition",
                "inputs",
                "outputs",
                "mutatedAlignedLightIndices",
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
                "alignedTopologyPreserved",
                "immutableFieldsPreserved",
                "nonLightEnvelopePreserved",
                "stagingOnly"
            ]
        );
        // Вход не тронут, временных файлов нет.
        assert_eq!(
            sha256_hex(&fs::read(&bench.lod).expect("файл")),
            bench.lod_sum
        );
        let names: Vec<String> = fs::read_dir(bench.dir.path().join("out"))
            .expect("папка")
            .map(|entry| {
                entry
                    .expect("запись")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");
        // Прочитанный обратно результат: огонь 0 изменён точно, остальные равны входу.
        let after = load_pair(&lod, &dist).expect("пара");
        assert_eq!(after.lod.falloff[0], 12.5);
        assert_eq!(after.lod.falloff_exponent[0], 4.0);
        assert_eq!(after.lod.corona_intensity[0], 9);
        assert_eq!(
            after.distant.colours[0],
            (200 << 24) | (10 << 16) | (20 << 8) | 30
        );
        assert_eq!(after.lod.direction, bench.pair.lod.direction);
        assert_eq!(&after.lod.falloff[1..], &bench.pair.lod.falloff[1..]);
        assert_eq!(
            &after.distant.colours[1..],
            &bench.pair.distant.colours[1..]
        );
    }

    #[test]
    fn single_field_edits_and_the_empty_edit() {
        let bench = Bench::new();
        assert_eq!(
            bench.distant_sum,
            "41dc348f1aebd9ec67d6a05c242d54df426bc89a81b918c2e6a515f1f5a47a29"
        );
        let run_one = |fields: Value, folder: &str| {
            let mut request = bench.request(json!([bench.edit(1, fields)]));
            request["lodOutputFile"] = json!(bench.out(&format!("{folder}/lod.ymap")));
            request["distantOutputFile"] = json!(bench.out(&format!("{folder}/dist.ymap")));
            let (response, code) = bench.run(&request);
            assert_eq!(code, 0, "{response}");
            (
                read_back(&bench.out(&format!("{folder}/lod.ymap"))),
                read_back(&bench.out(&format!("{folder}/dist.ymap"))),
            )
        };
        let ((lod, lod_sha), (dist, dist_sha)) =
            run_one(json!({"color": {"r": 10, "g": 20, "b": 30}}), "color");
        assert_eq!(
            (lod_sha.as_str(), lod.len()),
            (bench.lod_sum.as_str(), 4840)
        );
        let after = load_pair(&lod, &dist).expect("пара");
        assert_eq!(
            after.distant.colours[1],
            (bench.pair.distant.colours[1] & 0xff00_0000) | (10 << 16) | (20 << 8) | 30
        );
        assert_ne!(dist_sha, bench.distant_sum);
        let ((_, _), (dist, _)) = run_one(json!({"intensity": 200}), "intensity");
        let after = load_pair(&read_back(&bench.out("intensity/lod.ymap")).0, &dist).expect("пара");
        assert_eq!(after.distant.colours[1] >> 24, 200);
        assert_eq!(
            after.distant.colours[1] & 0xff_ffff,
            bench.pair.distant.colours[1] & 0xff_ffff
        );
        let ((lod, _), (_, dist_sha)) = run_one(json!({"falloff": 12.5}), "falloff");
        assert_eq!(dist_sha, bench.distant_sum);
        let after = load_pair(&lod, &bench_distant(&bench)).expect("пара");
        assert_eq!(after.lod.falloff[1], 12.5);
        assert_eq!(
            after.lod.falloff_exponent[1],
            bench.pair.lod.falloff_exponent[1]
        );
        let ((lod, _), _) = run_one(json!({"falloffExponent": 4}), "exponent");
        let after = load_pair(&lod, &bench_distant(&bench)).expect("пара");
        assert_eq!(
            (after.lod.falloff_exponent[1], after.lod.falloff[1]),
            (4.0, bench.pair.lod.falloff[1])
        );
        let ((lod, _), _) = run_one(json!({"coronaIntensity": 9}), "corona");
        let after = load_pair(&lod, &bench_distant(&bench)).expect("пара");
        assert_eq!(after.lod.corona_intensity[1], 9);
        // Правка без полей и правка со всеми полями null: тот же результат, что у входа.
        let ((lod, lod_sha), (dist, dist_sha)) = run_one(json!({}), "plain");
        assert_eq!(
            (lod.len(), lod_sha.as_str()),
            (4840, bench.lod_sum.as_str())
        );
        assert_eq!(
            (dist.len(), dist_sha.as_str()),
            (4446, bench.distant_sum.as_str())
        );
        let nulls = json!({"color": null, "intensity": null, "falloff": null, "falloffExponent": null, "coronaIntensity": null});
        let ((_, lod_sha), _) = run_one(nulls, "nulls");
        assert_eq!(lod_sha, bench.lod_sum);
    }

    #[test]
    fn several_edits_are_sorted_and_the_last_light_can_be_edited() {
        let bench = Bench::new();
        let edits = json!([
            bench.edit(3, json!({"color": {"r": 1, "g": 1, "b": 1}})),
            bench.edit(0, json!({"intensity": 5})),
            bench.edit(2, json!({"coronaIntensity": 4})),
        ]);
        let (response, code) = bench.run(&bench.request(edits));
        assert_eq!(code, 0, "{response}");
        assert_eq!(
            response["result"]["mutatedAlignedLightIndices"],
            json!([0, 2, 3])
        );
        let bench = Bench::new();
        let (response, _) = bench.run(&bench.request(json!([bench.edit(323, all_fields())])));
        assert_eq!(
            response["result"]["mutatedAlignedLightIndices"],
            json!([323])
        );
        let (lod, dist) = (
            read_back(&bench.out("out/lod.ymap")).0,
            read_back(&bench.out("out/dist.ymap")).0,
        );
        let after = load_pair(&lod, &dist).expect("пара");
        assert_eq!(after.lod.corona_intensity[323], 9);
        assert_eq!(after.lod.falloff[322], bench.pair.lod.falloff[322]);
        // Все 324 огня сразу.
        let bench = Bench::new();
        let every: Vec<Value> = (0..324)
            .map(|i| bench.edit(i, json!({"intensity": 1})))
            .collect();
        let (response, code) = bench.run(&bench.request(Value::Array(every)));
        assert_eq!(code, 0, "{response}");
        assert_eq!(
            response["result"]["mutatedAlignedLightIndices"]
                .as_array()
                .map(Vec::len),
            Some(324)
        );
    }

    #[test]
    fn range_edges_integers_and_rounding() {
        let bench = Bench::new();
        let run = |fields: Value| {
            let (response, code) = bench.run(&bench.request(json!([bench.edit(1, fields)])));
            let _ = fs::remove_dir_all(bench.dir.path().join("out"));
            (response, code)
        };
        assert_eq!(run(json!({"falloff": 0.01, "falloffExponent": 0.01, "intensity": 0, "coronaIntensity": 0})).1, 0);
        assert_eq!(run(json!({"falloff": 10000, "falloffExponent": 128, "intensity": 255, "coronaIntensity": 255})).1, 0);
        assert_eq!(run(json!({"falloff": 12.3456789})).1, 0);
        // Не число для спада и показателя молча пропускается.
        assert_eq!(run(json!({"falloff": "12", "falloffExponent": true})).1, 0);
        let envelope = |text: &str| data(text);
        for (fields, text) in [
            (
                json!({"falloff": 0.0099}),
                "Lamp lod.falloff is outside the helper safety envelope.",
            ),
            (
                json!({"falloff": 0}),
                "Lamp lod.falloff is outside the helper safety envelope.",
            ),
            (
                json!({"falloff": 10000.5}),
                "Lamp lod.falloff is outside the helper safety envelope.",
            ),
            (
                json!({"falloff": 1e39}),
                "Lamp lod.falloff is outside the helper safety envelope.",
            ),
            (
                json!({"falloff": -1}),
                "Lamp lod.falloff is outside the helper safety envelope.",
            ),
            (
                json!({"falloffExponent": 0.005}),
                "Lamp lod.falloffExponent is outside the helper safety envelope.",
            ),
            (
                json!({"falloffExponent": 128.5}),
                "Lamp lod.falloffExponent is outside the helper safety envelope.",
            ),
            (
                json!({"falloff": 0, "falloffExponent": 0}),
                "Lamp lod.falloff is outside the helper safety envelope.",
            ),
        ] {
            assert_eq!(refused(&run(fields.clone()).0), envelope(text), "{fields}");
        }
    }

    #[test]
    fn item_parsing_order_and_messages() {
        let bench = Bench::new();
        let run = |item: Value| refused(&bench.run(&bench.request(json!([item]))).0);
        let fp = bench.fp(1);
        assert_eq!(
            run(json!(5)),
            data("alignedLightIndex must be a non-negative integer.")
        );
        for index in [json!(null), json!("1"), json!(1.0), json!(-1)] {
            assert_eq!(
                run(json!({"alignedLightIndex": index, "expectedFingerprint": fp})),
                data("alignedLightIndex must be a non-negative integer.")
            );
        }
        assert_eq!(
            run(json!({"alignedLightIndex": 1})),
            data("expectedFingerprint must be a SHA-256 hex string.")
        );
        assert_eq!(
            run(json!({"alignedLightIndex": 1, "expectedFingerprint": "abcdef0123"})),
            data("expectedFingerprint must be a SHA-256 hex string.")
        );
        let base = |extra: Value| {
            let mut item = json!({"alignedLightIndex": 1, "expectedFingerprint": fp});
            item.as_object_mut()
                .expect("объект")
                .extend(extra.as_object().expect("объект").clone());
            item
        };
        let color = |text: &str| data(&format!("color.{text} must be a byte from 0 to 255."));
        assert_eq!(run(base(json!({"color": "red"}))), color("r"));
        assert_eq!(run(base(json!({"color": {"g": 1, "b": 1}}))), color("r"));
        assert_eq!(run(base(json!({"color": {"r": 1, "b": 1}}))), color("g"));
        assert_eq!(run(base(json!({"color": {"r": 1, "g": 1}}))), color("b"));
        assert_eq!(
            run(base(json!({"color": {"r": 256, "g": 1, "b": 1}}))),
            color("r")
        );
        assert_eq!(
            run(base(json!({"color": {"r": 1, "g": -1, "b": 1}}))),
            color("g")
        );
        assert_eq!(
            run(base(json!({"color": {"r": 1, "g": 1, "b": 1.5}}))),
            color("b")
        );
        assert_eq!(
            run(base(json!({"intensity": 256}))),
            data("intensity must be a byte from 0 to 255.")
        );
        assert_eq!(
            run(base(json!({"intensity": "x"}))),
            data("intensity must be a byte from 0 to 255.")
        );
        assert_eq!(
            run(base(json!({"intensity": 5.5}))),
            data("intensity must be a byte from 0 to 255.")
        );
        assert_eq!(
            run(base(json!({"coronaIntensity": 300}))),
            data("coronaIntensity must be a byte from 0 to 255.")
        );
        assert_eq!(
            run(base(json!({"coronaIntensity": true}))),
            data("coronaIntensity must be a byte from 0 to 255.")
        );
        // Порядок: индекс, цвет, отпечаток, яркость.
        assert_eq!(
            run(
                json!({"alignedLightIndex": "x", "color": {"r": 999}, "expectedFingerprint": "zz"})
            ),
            data("alignedLightIndex must be a non-negative integer.")
        );
        assert_eq!(
            run(json!({"alignedLightIndex": 1, "color": {"r": 999}, "expectedFingerprint": "zz"})),
            color("r")
        );
        assert_eq!(
            run(json!({"alignedLightIndex": 1, "expectedFingerprint": "zz", "intensity": 999})),
            data("expectedFingerprint must be a SHA-256 hex string.")
        );
        // Ошибка поля первого элемента побеждает повтор номера во втором, повтор — номер вне пары.
        let items = json!([base(json!({"intensity": 999})), base(json!({}))]);
        assert_eq!(
            refused(&bench.run(&bench.request(items)).0),
            data("intensity must be a byte from 0 to 255.")
        );
        let items = json!([{"alignedLightIndex": 400, "expectedFingerprint": fp}, {"alignedLightIndex": 400, "expectedFingerprint": fp}]);
        assert_eq!(
            refused(&bench.run(&bench.request(items)).0),
            data("Each aligned LOD index may be mutated only once.")
        );
    }

    #[test]
    fn list_size_and_range_rules() {
        let bench = Bench::new();
        let many = data("lamp-lod-patch requires 1-4096 mutations.");
        let mut request = bench.request(Value::Null);
        request
            .as_object_mut()
            .expect("объект")
            .remove("lampLodMutations");
        assert_eq!(refused(&bench.run(&request).0), many);
        for value in [Value::Null, json!({}), json!([])] {
            assert_eq!(refused(&bench.run(&bench.request(value)).0), many);
        }
        let fp = bench.fp(0);
        let too_many: Vec<Value> = (0..4097)
            .map(|i| json!({"alignedLightIndex": i, "expectedFingerprint": fp}))
            .collect();
        assert_eq!(
            refused(&bench.run(&bench.request(Value::Array(too_many))).0),
            many
        );
        let big_list: Vec<Value> = (324..324 + 4096)
            .map(|i| json!({"alignedLightIndex": i, "expectedFingerprint": fp}))
            .collect();
        assert_eq!(
            refused(&bench.run(&bench.request(Value::Array(big_list))).0),
            data("Aligned LOD index is out of range: 324.")
        );
        let outside =
            |index: u64| {
                refused(
                    &bench
                        .run(&bench.request(
                            json!([{"alignedLightIndex": index, "expectedFingerprint": fp}]),
                        ))
                        .0,
                )
            };
        assert_eq!(
            outside(324),
            data("Aligned LOD index is out of range: 324.")
        );
        assert_eq!(
            outside(u64::MAX),
            data("Aligned LOD index is out of range: 18446744073709551615.")
        );
        assert_eq!(
            outside(18446744073709551614),
            data("Aligned LOD index is out of range: 18446744073709551614.")
        );
        // Неверный отпечаток и номер вне пары: первым проверяется меньший номер.
        let mixed = json!([{"alignedLightIndex": 400, "expectedFingerprint": fp}, {"alignedLightIndex": 1, "expectedFingerprint": "0".repeat(64)}]);
        assert_eq!(
            refused(&bench.run(&bench.request(mixed)).0),
            data("LOD light fingerprint changed at index 1.")
        );
        let foreign = json!([{"alignedLightIndex": 1, "expectedFingerprint": bench.fp(2)}]);
        assert_eq!(
            refused(&bench.run(&bench.request(foreign)).0),
            data("LOD light fingerprint changed at index 1.")
        );
        // Отказ по отпечатку: папка результата уже создана и пуста, файлов нет.
        let mut request =
            bench.request(json!([{"alignedLightIndex": 1, "expectedFingerprint": "0".repeat(64)}]));
        request["lodOutputFile"] = json!(bench.out("made/lod.ymap"));
        request["distantOutputFile"] = json!(bench.out("made/dist.ymap"));
        assert_eq!(
            refused(&bench.run(&request).0).1,
            "LOD light fingerprint changed at index 1."
        );
        assert!(!bench.dir.path().join("made").exists());
    }

    #[test]
    fn request_file_and_path_failures() {
        let bench = Bench::new();
        let (response, _) = run_args(&["lamp-lod-patch"]);
        assert_eq!(refused(&response).1, "--request is required.");
        let (response, _) = run_args(&["lamp-lod-patch", "--input", "x.json"]);
        assert_eq!(refused(&response).1, "--request is required.");
        let missing = bench.dir.path().join("none.json");
        let (response, _) = run_args(&[
            "lamp-lod-patch",
            "--request",
            &missing.display().to_string(),
        ]);
        assert_eq!(
            refused(&response),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {}", missing.display())
            )
        );
        let text = bench.dir.path().join("req.txt");
        fs::write(&text, "{}").expect("запись");
        let (response, _) = run_args(&["lamp-lod-patch", "--request", &text.display().to_string()]);
        assert_eq!(
            refused(&response),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .txt".to_owned()
            )
        );
        for text in ["", "not json", "\u{feff}{}"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                data("Запрос правки LOD пустой или сломан."),
                "{text:?}"
            );
        }
        let empty = (
            "ArgumentException".to_owned(),
            "The path is empty.".to_owned(),
        );
        for text in ["{}", "[]", "\"x\"", "null"] {
            assert_eq!(refused(&bench.run_text(text).0), empty, "{text:?}");
        }
        let mut request = bench.request(json!([bench.edit(0, json!({}))]));
        request["lodInputFile"] = json!(5);
        assert_eq!(refused(&bench.run(&request).0), empty);
        let absent = bench.dir.path().join("absent.ymap").display().to_string();
        request["lodInputFile"] = json!(absent);
        assert_eq!(
            refused(&bench.run(&request).0),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {absent}")
            )
        );
        request["lodInputFile"] = json!(bench.dir.path().join("x.yft").display().to_string());
        fs::write(bench.dir.path().join("x.yft"), b"x").expect("запись");
        assert_eq!(
            refused(&bench.run(&request).0),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .yft".to_owned()
            )
        );
        let mut request = bench.request(json!([bench.edit(0, json!({}))]));
        request["distantInputFile"] = json!(absent);
        assert_eq!(refused(&bench.run(&request).0).0, "FileNotFoundException");
    }

    #[test]
    fn output_paths_must_be_new_and_share_one_folder() {
        let bench = Bench::new();
        let edit = || json!([bench.edit(0, all_fields())]);
        let mut request = bench.request(edit());
        request["lodOutputFile"] = json!(bench.out("out/lod.bin"));
        assert_eq!(
            refused(&bench.run(&request).0),
            (
                "ArgumentException".to_owned(),
                "Unsupported output extension: .bin".to_owned()
            )
        );
        request["lodOutputFile"] = json!(bench.out("out/lod"));
        assert_eq!(
            refused(&bench.run(&request).0).1,
            "Unsupported output extension: "
        );
        request["lodOutputFile"] = json!("");
        assert_eq!(refused(&bench.run(&request).0).1, "The path is empty.");
        let mut request = bench.request(edit());
        request["distantOutputFile"] = json!(bench.out("out/d.txt"));
        assert_eq!(
            refused(&bench.run(&request).0).1,
            "Unsupported output extension: .txt"
        );
        // Результат уже есть или это папка.
        fs::create_dir_all(bench.dir.path().join("taken")).expect("папка");
        fs::write(bench.dir.path().join("taken/lod.ymap"), b"x").expect("запись");
        fs::create_dir_all(bench.dir.path().join("taken/dist.ymap")).expect("папка");
        let mut request = bench.request(edit());
        request["lodOutputFile"] = json!(bench.out("taken/lod.ymap"));
        assert_eq!(
            refused(&bench.run(&request).0),
            data("LOD output must be a new staging path.")
        );
        request["lodOutputFile"] = json!(bench.out("taken/dist.ymap"));
        assert_eq!(
            refused(&bench.run(&request).0),
            data("LOD output must be a new staging path.")
        );
        let mut request = bench.request(edit());
        request["distantOutputFile"] = json!(bench.out("taken/dist.ymap"));
        assert_eq!(
            refused(&bench.run(&request).0),
            data("distant output must be a new staging path.")
        );
        // Разные папки: обе создаются, хотя запрос отказан; регистр букв различает папки.
        let mut request = bench.request(edit());
        request["lodOutputFile"] = json!(bench.out("f1/lod.ymap"));
        request["distantOutputFile"] = json!(bench.out("f2/dist.ymap"));
        assert_eq!(
            refused(&bench.run(&request).0),
            data("LOD pair outputs must share one staging directory.")
        );
        // Созданные ради отказавшей команды пустые папки убраны (раньше оставались).
        assert!(!bench.dir.path().join("f1").exists() && !bench.dir.path().join("f2").exists());
        let mut request = bench.request(edit());
        request["distantOutputFile"] = json!(bench.out("Out/dist.ymap"));
        assert_eq!(
            refused(&bench.run(&request).0).1,
            "LOD pair outputs must share one staging directory."
        );
        // Родители совпали после свёртки.
        let mut request = bench.request(edit());
        request["lodOutputFile"] = json!(bench.out("same/a/../lod.ymap"));
        request["distantOutputFile"] = json!(bench.out("same/dist.ymap"));
        assert_eq!(bench.run(&request).1, 0);
        // Родитель результата — файл.
        let blocker = bench.dir.path().join("blocker");
        fs::write(&blocker, b"x").expect("запись");
        let mut request = bench.request(edit());
        request["lodOutputFile"] = json!(blocker.join("lod.ymap").display().to_string());
        assert_eq!(refused(&bench.run(&request).0).0, "IOException");
    }

    #[test]
    fn two_results_with_one_path_are_refused_and_nothing_is_written() {
        let bench = Bench::new();
        // Раньше второй результат молча затирал первый, а ответ был успешным.
        for (lod, distant) in [
            ("out/same.ymap", "out/same.ymap"),
            ("out/same.ymap", "out/SAME.YMAP"),
        ] {
            let mut request = bench.request(json!([bench.edit(0, all_fields())]));
            request["lodOutputFile"] = json!(bench.out(lod));
            request["distantOutputFile"] = json!(bench.out(distant));
            let (response, code) = bench.run(&request);
            assert_eq!(code, 1, "{response}");
            assert_eq!(
                refused(&response),
                (
                    "InvalidDataException".to_owned(),
                    "LOD pair outputs must be two different files.".to_owned()
                )
            );
            assert!(!bench.dir.path().join("out").exists(), "{lod} {distant}");
        }
        // Результаты с расширением в верхнем регистре и новые вложенные папки.
        let mut request = bench.request(json!([bench.edit(0, all_fields())]));
        request["lodOutputFile"] = json!(bench.out("new/deeper/LOD.YMAP"));
        request["distantOutputFile"] = json!(bench.out("new/deeper/DIST.YMAP"));
        assert_eq!(bench.run(&request).1, 0);
        assert!(bench.dir.path().join("new/deeper/LOD.YMAP").is_file());
    }

    #[test]
    fn sums_come_after_their_shape_and_the_list_after_the_sums() {
        let bench = Bench::new();
        let edit = || json!([bench.edit(0, all_fields())]);
        let lod_shape = data("expectedLodInputSha256 must be a SHA-256 hex string.");
        let distant_shape = data("expectedDistantInputSha256 must be a SHA-256 hex string.");
        for value in [
            Value::Null,
            json!(5),
            json!(&bench.lod_sum[1..]),
            json!(format!("g{}", &bench.lod_sum[1..])),
        ] {
            let mut request = bench.request(edit());
            request["expectedLodInputSha256"] = value;
            assert_eq!(refused(&bench.run(&request).0), lod_shape);
        }
        let mut request = bench.request(edit());
        request
            .as_object_mut()
            .expect("объект")
            .remove("expectedDistantInputSha256");
        assert_eq!(refused(&bench.run(&request).0), distant_shape);
        request["expectedLodInputSha256"] = json!("x");
        assert_eq!(refused(&bench.run(&request).0), lod_shape);
        let mut request = bench.request(json!([]));
        request["expectedLodInputSha256"] = json!("abc");
        assert_eq!(refused(&bench.run(&request).0), lod_shape);
        // Верные суммы прописными цифрами годятся; перепутанные местами суммы — отказ.
        let mut request = bench.request(edit());
        request["expectedLodInputSha256"] = json!(bench.lod_sum.to_uppercase());
        request["expectedDistantInputSha256"] = json!(bench.distant_sum.to_uppercase());
        assert_eq!(bench.run(&request).1, 0);
        fs::remove_dir_all(bench.dir.path().join("out")).expect("папка");
        let mismatch = data("LOD pair input SHA-256 does not match the approved plan.");
        let mut request = bench.request(edit());
        request["expectedLodInputSha256"] = json!(bench.distant_sum);
        request["expectedDistantInputSha256"] = json!(bench.lod_sum);
        assert_eq!(refused(&bench.run(&request).0), mismatch);
        let mut request = bench.request(edit());
        let mut flipped = bench.distant_sum.clone();
        flipped.pop();
        flipped.push(if bench.distant_sum.ends_with('0') {
            '1'
        } else {
            '0'
        });
        request["expectedDistantInputSha256"] = json!(flipped);
        assert_eq!(refused(&bench.run(&request).0), mismatch);
        assert!(!bench.dir.path().join("out").exists());
        // Ошибка поля правки побеждает неверную сумму.
        let mut request = bench.request(json!([{"alignedLightIndex": "x"}]));
        request["expectedLodInputSha256"] = json!("0".repeat(64));
        assert_eq!(
            refused(&bench.run(&request).0),
            data("alignedLightIndex must be a non-negative integer.")
        );
    }

    #[test]
    fn pairs_that_do_not_load_report_the_pair_reader_text() {
        let build = |lod: &str, distant: &str| {
            let dir = tempfile::tempdir().expect("папка");
            let (lod_path, distant_path) = (dir.path().join("l.ymap"), dir.path().join("d.ymap"));
            fs::copy(sample(lod), &lod_path).expect("копия");
            fs::copy(sample(distant), &distant_path).expect("копия");
            Bench::around(dir, lod_path, distant_path)
        };
        let fp = "a".repeat(64);
        let edit = json!([{"alignedLightIndex": 0, "expectedFingerprint": fp}]);
        let swapped = build("distlodlights_small045.ymap", "lodlights_small045.ymap");
        assert_eq!(
            refused(&swapped.run(&swapped.request(edit.clone())).0),
            data("LOD input has no CLODLight arrays.")
        );
        let misaligned = build("lodlights_small008.ymap", "distlodlights_small045.ymap");
        assert_eq!(
            refused(&misaligned.run(&misaligned.request(edit.clone())).0),
            data("LOD/distant SOA arrays are not exactly aligned.")
        );
        let dir = tempfile::tempdir().expect("папка");
        let junk = dir.path().join("bad.ymap");
        fs::write(&junk, b"junk junk junk junk junk").expect("запись");
        let broken = Bench::around(dir, junk, sample("distlodlights_small045.ymap"));
        assert_eq!(
            refused(&broken.run(&broken.request(edit)).0),
            (
                "InvalidOperationException".to_owned(),
                "Файл не является ресурсом RSC7.".to_owned()
            )
        );
    }

    #[test]
    fn non_finite_light_beats_every_edit_error() {
        let dir = tempfile::tempdir().expect("папка");
        let lod_path = dir.path().join("nan.ymap");
        let source = fs::read(sample("lodlights_small045.ymap")).expect("файл");
        let mut resource = rage_res::resource::Resource::parse(&source).expect("ресурс");
        let wanted = 0.337618f32.to_le_bytes();
        let at = resource
            .data()
            .windows(4)
            .position(|window| window == wanted)
            .expect("число в теле");
        resource.data_mut()[at..at + 4].copy_from_slice(&f32::NAN.to_le_bytes());
        fs::write(&lod_path, resource.to_file_bytes().expect("файл")).expect("запись");
        let distant_path = dir.path().join("d.ymap");
        fs::copy(sample("distlodlights_small045.ymap"), &distant_path).expect("копия");
        let bench = Bench::around(dir, lod_path, distant_path);
        let edit = json!([{"alignedLightIndex": 400, "expectedFingerprint": "0".repeat(64)}]);
        assert_eq!(
            refused(&bench.run(&bench.request(edit)).0),
            data("Lamp resource contains non-finite value.")
        );
    }

    #[test]
    fn writing_failures_remove_what_was_written() {
        let bench = Bench::new();
        // На месте дальнего результата после проверки появляется файл: проверка «результат появился»
        // здесь срабатывает только в гонке, поэтому проверяем сам откат прямым вызовом.
        let lod_out = bench.dir.path().join("race/lod.ymap");
        let distant_out = bench.dir.path().join("race/dist.ymap");
        fs::create_dir_all(bench.dir.path().join("race")).expect("папка");
        fs::write(&distant_out, b"appeared").expect("запись");
        let failure = publish((&lod_out, b"lod"), (&distant_out, b"dist")).expect_err("отказ");
        assert_eq!(
            (failure.code, failure.message),
            data("LOD pair output appeared while patching; nothing was written.")
        );
        // Файл, который появился у кого-то другого, остаётся нетронутым (прежний откат стирал и его); свои временные убраны.
        assert!(!lod_out.exists());
        assert_eq!(fs::read(&distant_out).expect("файл"), b"appeared");
        let leftovers = fs::read_dir(bench.dir.path().join("race"))
            .expect("папка")
            .count();
        assert_eq!(leftovers, 1);
        // Успех: имена временных файлов не остаются.
        fs::remove_file(&distant_out).expect("снять");
        publish((&lod_out, b"lod"), (&distant_out, b"dist")).expect("запись");
        assert_eq!(fs::read(&lod_out).expect("файл"), b"lod");
        assert_eq!(
            fs::read_dir(bench.dir.path().join("race"))
                .expect("папка")
                .count(),
            2
        );
    }

    #[test]
    fn medium_pair_last_light() {
        let bench = Bench::of("medium017");
        let (response, code) = bench.run(&bench.request(json!([bench.edit(1038, all_fields())])));
        assert_eq!(code, 0, "{response}");
        assert_eq!(
            response["result"]["mutatedAlignedLightIndices"],
            json!([1038])
        );
    }
}
