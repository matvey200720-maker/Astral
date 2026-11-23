//! `sample-anim-track`: вся дорожка анимации одной командой (этап 3 «3D на Rust»).
//!
//! Дорожку окна (`apps/desktop/src/animations/animation-track.js`) снимает `sample-anim-pose`, по вызову
//! на кадр: файл читается, словарь распаковывается, разбираются все блоки клипа, а потом из них берётся
//! один кадр. Здесь словарь каждого слоя открывается один раз (`ClipSampler`), а все моменты слоя
//! снимаются из уже разобранного клипа. Ответ — то, что JS получал из `sampleClip` после разбора ответа
//! `sample-anim-pose`, число в число: каждый момент даёт ровно ту же позу, что и вызов
//! `sample-anim-pose --time <момент>`, а числа стоят в том же виде (кратчайшая десятичная запись `f32`,
//! прочитанная как `f64`). Смешивание кадров, сетку и упаковку в `Float32Array` JS оставляет себе:
//! `Math.acos`, `Math.sin` и `Math.hypot` у V8 и системная математика Rust не обязаны совпадать до бита.
//!
//! Вход — JSON: `--request <файл>` или `--request-json <текст>`:
//! `{ clip, layers: [{ input, times: ["0", "0.0166…"] }], format?, threads?, timings?, travel? }`.
//! `input` — путь к `.ycd` (тот же отбор, что у `--input` команды `sample-anim-pose`); `times` — моменты
//! как **строки** с записью числа, какую получает `--time` (JS кладёт `String(Number(t) || 0)`): число
//! JSON читается без точного округления, а запись `f32` берётся из текста, поэтому числа отвергаются.
//! Нечитаемая строка — момент 0, как у `--time`.
//!
//! Ответ по слоям, в порядке запроса. Слой, который не открылся (нет файла, не словарь, нет клипа,
//! битый блок), отвечает `{ error: { code, message } }` и не роняет остальные. У открывшегося:
//! `{ file, clip, frames, duration, times, slots, samples }` — `times[i]` — момент выборки (`time` ответа
//! `sample-anim-pose`), `slots[i]` — номер записи в `samples`. Моменты одного кадра анимации делят запись:
//! поза зависит только от кадра. Запись — `{ frame, mover, tags, rotations }`: `tags` — теги костей с поворотом
//! (кроме тега 0), `rotations` — по четыре числа на тег, `mover` — `[x, y, z, w, tx, ty, tz]` или `null`,
//! если у клипа в кадре нет мувера (тег 0); у кадра, который не снялся, — `{ frame, error }`.
//!
//! `format: "binary"` кладёт числа в контейнер канала данных; ответ — `{ container: { sha256, bytes, store, url? } }`,
//! как у `read-workshop-textures`: в резидентном процессе контейнер лежит в памяти (`shelf.rs`) и забирается
//! `GET <url>` один раз, `store: "file"` во входе (и разовый запуск, и полная полка) пишет его в папку хранилища
//! (`--assets-dir`, иначе настройка резидентного процесса). Контейнер `ATK1`:
//! 4 байта `ATK1`, `u32` длина головы, голова — тот же JSON `{ layers }`, добитый пробелами до кратного
//! восьми, дальше тело. В голове у записи вместо `tags`, `rotations` и `mover` лежат `count`, `hasMover`
//! и `at` — смещение записи в теле: `count` тегов `u16`, добивка нулями до восьми байт, семь `f64`
//! мувера (без мувера — `0 0 0 1 0 0 0`), `4 × count` чисел `f64`. Всё — little-endian, записи выровнены на восемь.
//!
//! Корневое движение (`"travel": true` во входе, по умолчанию выключено): сдвиг тега `0xFFFD` (`MOVER_ALIAS` у `ycd-mover.js`: у копии словаря
//! `aliasMovers` под этим тегом лежат дорожки 5 и 6) — поле записи `travel: [x, y, z]` (`null`, если сдвига тега в кадре нет). Поворот тега `0xFFFD`
//! остаётся среди `tags` и `rotations`, как у любой кости: вынести его в `travel` — дело оболочки (как в `sampleClip`). Без поля во входе ответ
//! байт в байт прежний (JSON без ключа `travel`, контейнер `ATK1`), поэтому прежние клиенты не ломаются. С полем контейнер называется `ATK2`:
//! у записи в голове добавлен `hasTravel`, а в теле три `f64` сдвига идут сразу за семью числами мувера (без сдвига — нули), потом повороты.
//! Движок без поля вернёт `ATK1` и записи без `travel`: клиент, что просил поле, узнаёт это по знаку контейнера (или по отсутствию ключа в JSON).

use std::collections::HashMap;
use std::fmt::{self, Write};
use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use rage_res::ycd_pose::{ClipSampler, PoseBone};
use serde_json::{json, Map, Value};

use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
    readers::ars2,
    shelf::{deliver, Shelf},
};

const COMMAND_NAME: &str = "sample-anim-track";
/// Слоёв в запросе не больше стольких (окно собирает до четырёх).
const MAX_LAYERS: usize = 16;
/// Моментов на слой не больше стольких (дорожка в 16 секунд — около пятисот).
const MAX_MOMENTS: usize = 50_000;
/// Запрос длиннее не принимается.
const MAX_REQUEST_BYTES: u64 = 8 * 1024 * 1024;
/// Тег мувера: не кость скелета, а ход самого клипа.
const MOVER_TAG: u16 = 0;
/// Мувер без записи в клипе: поворот на месте, сдвиг нулевой.
const STILL_MOVER: [f64; 7] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
/// Тег корневого движения у копии словаря `aliasMovers` (`MOVER_ALIAS`): его сдвиг — поле `travel`.
const TRAVEL_TAG: u16 = 0xFFFD;
/// Знак контейнера канала данных.
const MAGIC: &[u8; 4] = b"ATK1";
/// Знак контейнера с корневым движением (вход с `travel: true`).
const MAGIC_TRAVEL: &[u8; 4] = b"ATK2";
/// Потолок потоков по умолчанию.
const MAX_THREADS: usize = 8;
/// Меньше стольких разных кадров делить между потоками не стоит.
const PARALLEL_FRAMES: usize = 64;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::argument(message)
}

// ------------------------------------------------------------------ вход

/// Слой запроса: файл словаря и моменты, уже приведённые к `f32` так же, как `--time`.
#[derive(Debug, Clone, PartialEq)]
struct Ask {
    input: String,
    moments: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
struct Request {
    clip: String,
    layers: Vec<Ask>,
    binary: bool,
    /// `store: "file"`: контейнер пишется в хранилище-папку, а не кладётся на полку в памяти канала.
    to_file: bool,
    timings: bool,
    threads: Option<usize>,
    /// `travel: true`: в записи есть сдвиг тега `0xFFFD`, контейнер — `ATK2`.
    travel: bool,
}

/// Момент из записи числа: как `pose_answer` читает `--time` (нечитаемое — ноль).
fn moment_of(text: &str) -> f32 {
    text.trim().parse::<f32>().ok().unwrap_or_default()
}

impl Request {
    fn parse(body: &Value) -> Result<Request> {
        let fields = body
            .as_object()
            .ok_or_else(|| bad("Запрос sample-anim-track — не объект."))?;
        let clip = fields
            .get("clip")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| bad("В запросе sample-anim-track не назван клип (clip)."))?
            .to_owned();
        let list = fields
            .get("layers")
            .and_then(Value::as_array)
            .filter(|list| !list.is_empty())
            .ok_or_else(|| bad("В запросе sample-anim-track нет слоёв (layers)."))?;
        if list.len() > MAX_LAYERS {
            return Err(bad(format!(
                "Слоёв в запросе sample-anim-track не больше {MAX_LAYERS}."
            )));
        }
        let layers = list.iter().map(Ask::parse).collect::<Result<Vec<_>>>()?;
        let binary = match fields.get("format").map(Value::as_str) {
            None | Some(Some("json")) => false,
            Some(Some("binary")) => true,
            Some(_) => {
                return Err(bad(
                    "Формат ответа sample-anim-track — json или binary (format).",
                ))
            }
        };
        let threads = match fields.get("threads") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_u64()
                    .filter(|count| (1..=64).contains(count))
                    .ok_or_else(|| {
                        bad("Потоков в запросе sample-anim-track от 1 до 64 (threads).")
                    })? as usize,
            ),
        };
        let travel = match fields.get("travel") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(on)) => *on,
            Some(_) => {
                return Err(bad(
                    "Корневое движение в запросе sample-anim-track — true или false (travel).",
                ))
            }
        };
        Ok(Request {
            clip,
            layers,
            binary,
            travel,
            to_file: fields.get("store").and_then(Value::as_str) == Some("file"),
            timings: fields
                .get("timings")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            threads,
        })
    }
}

impl Ask {
    fn parse(layer: &Value) -> Result<Ask> {
        let input = layer
            .get("input")
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .ok_or_else(|| bad("У слоя sample-anim-track нет файла (input)."))?
            .to_owned();
        let times = layer
            .get("times")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("У слоя sample-anim-track нет моментов (times)."))?;
        if times.len() > MAX_MOMENTS {
            return Err(bad(format!(
                "Моментов на слой sample-anim-track не больше {MAX_MOMENTS}."
            )));
        }
        let moments = times
            .iter()
            .map(|time| {
                time.as_str().map(moment_of).ok_or_else(|| {
                    bad("Момент sample-anim-track — строка с записью числа, как у --time (times).")
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Ask { input, moments })
    }
}

// ------------------------------------------------------------------ числа и записи

/// `f32` как кратчайшая десятичная запись, прочитанная как `f64`: так число доходит до JS в ответе
/// `sample-anim-pose` (`via_text` читателей).
fn via_text(value: f32) -> f64 {
    let mut text = Stack {
        bytes: [0; 64],
        len: 0,
    };
    let written = write!(text, "{value}").is_ok();
    match std::str::from_utf8(&text.bytes[..text.len]) {
        Ok(digits) if written => digits.parse().unwrap_or(0.0),
        _ => value.to_string().parse().unwrap_or(0.0),
    }
}

/// Запись числа на стеке: самая длинная запись `f32` короче шестидесяти четырёх знаков, куча не нужна.
struct Stack {
    bytes: [u8; 64],
    len: usize,
}

impl fmt::Write for Stack {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        let end = self.len + text.len();
        self.bytes
            .get_mut(self.len..end)
            .ok_or(fmt::Error)?
            .copy_from_slice(text.as_bytes());
        self.len = end;
        Ok(())
    }
}

/// То же для полей, которые JS читает как `Number(x) || 0`: не число и минус ноль — ноль.
fn plain(value: f32) -> f64 {
    let number = via_text(value);
    if number.is_finite() {
        number + 0.0
    } else {
        0.0
    }
}

/// Поза одного кадра в том виде, в каком её держит `sampleClip` JS.
#[derive(Debug, Clone, PartialEq)]
struct Digest {
    /// Мувер кадра; `None` — в кадре нет ни поворота, ни сдвига тега 0.
    mover: Option<[f64; 7]>,
    tags: Vec<u16>,
    /// По четыре числа на тег.
    rotations: Vec<f64>,
    /// Сдвиг тега `TRAVEL_TAG` (корневое движение копии `aliasMovers`); `None` — его в кадре нет.
    travel: Option<[f64; 3]>,
}

impl Digest {
    /// Как `sampleClip`: поворот тега 0 и его сдвиг — мувер, повороты прочих тегов — по тегу, при повторе
    /// тега остаётся последний; прочие дорожки читаются, но не берутся.
    fn of(bones: &[PoseBone]) -> Digest {
        let mut mover = STILL_MOVER;
        let mut has_mover = false;
        let mut travel = None;
        let (mut tags, mut rotations): (Vec<u16>, Vec<f64>) = (Vec::new(), Vec::new());
        let mut place: HashMap<u16, usize> = HashMap::new();
        for bone in bones {
            match (bone.track, bone.value.as_slice()) {
                ("rotation", &[x, y, z, w]) => {
                    let quad = [x, y, z, w].map(via_text);
                    if bone.tag == MOVER_TAG {
                        mover[..4].copy_from_slice(&quad);
                        has_mover = true;
                    } else if let Some(&at) = place.get(&bone.tag) {
                        rotations[at * 4..at * 4 + 4].copy_from_slice(&quad);
                    } else {
                        place.insert(bone.tag, tags.len());
                        tags.push(bone.tag);
                        rotations.extend(quad);
                    }
                }
                ("translation", &[x, y, z]) if bone.tag == MOVER_TAG => {
                    mover[4..].copy_from_slice(&[x, y, z].map(via_text));
                    has_mover = true;
                }
                // При повторе тега остаётся последний сдвиг, как у `travel[4 + at] = …` в `sampleClip`.
                ("translation", &[x, y, z]) if bone.tag == TRAVEL_TAG => {
                    travel = Some([x, y, z].map(via_text));
                }
                _ => {}
            }
        }
        Digest {
            mover: has_mover.then_some(mover),
            tags,
            rotations,
            travel,
        }
    }
}

/// Запись слоя: поза кадра анимации или отказ, с которым `sample-anim-pose` ответил бы на любой момент этого кадра.
struct Sample {
    frame: usize,
    pose: Result<Digest>,
}

struct Ready {
    file: String,
    clip: String,
    frames: u16,
    duration: f32,
    /// Момент выборки каждого запрошенного момента и номер его записи.
    times: Vec<(f32, u32)>,
    samples: Vec<Sample>,
}

enum Layer {
    Failed(EngineError),
    Ready(Ready),
}

// ------------------------------------------------------------------ счётчики

/// Время этапов в микросекундах, сумма по потокам.
#[derive(Default)]
struct Probe {
    read: AtomicU64,
    open: AtomicU64,
    locate: AtomicU64,
    pose: AtomicU64,
    digest: AtomicU64,
}

impl Probe {
    fn spent<T>(slot: &AtomicU64, work: impl FnOnce() -> T) -> T {
        let began = Instant::now();
        let out = work();
        slot.fetch_add(
            u64::try_from(began.elapsed().as_micros()).unwrap_or(u64::MAX),
            Relaxed,
        );
        out
    }
}

fn millis(micros: u64) -> f64 {
    (micros as f64 / 10.0).round() / 100.0
}

// ------------------------------------------------------------------ слой

fn default_threads() -> usize {
    thread::available_parallelism().map_or(1, |cores| (cores.get() / 2).clamp(1, MAX_THREADS))
}

/// Разбирает `count` работ по потокам, результаты — в порядке номеров.
fn parallel_map<T: Send>(count: usize, threads: usize, work: impl Fn(usize) -> T + Sync) -> Vec<T> {
    if threads <= 1 || count < 2 {
        return (0..count).map(work).collect();
    }
    let next = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<T>>> = (0..count).map(|_| Mutex::new(None)).collect();
    thread::scope(|scope| {
        for _ in 0..threads.min(count) {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, Relaxed);
                if index >= count {
                    break;
                }
                let done = work(index);
                *slots[index]
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(done);
            });
        }
    });
    slots
        .into_iter()
        .map(|slot| {
            slot.into_inner()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        })
        .map(|done| done.expect("работа выполнена"))
        .collect()
}

fn sample_layer(ask: &Ask, clip: &str, threads: usize, probe: &Probe) -> Layer {
    let outcome = Probe::spent(&probe.read, || {
        paths::existing_file(&ask.input, &[".ycd"]).and_then(|path| {
            let bytes = fs::read(&path)?;
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            Ok((name, bytes))
        })
    });
    let (file, bytes) = match outcome {
        Ok(read) => read,
        Err(error) => return Layer::Failed(error),
    };
    let sampler = match Probe::spent(&probe.open, || ClipSampler::open(&bytes, clip)) {
        Ok(sampler) => sampler,
        Err(error) => return Layer::Failed(error.into()),
    };

    // Моменты одного кадра анимации делят запись: поза зависит только от кадра.
    let (times, order) = Probe::spent(&probe.locate, || {
        let mut slot_of: HashMap<usize, u32> = HashMap::new();
        let mut order: Vec<usize> = Vec::new();
        let times = ask
            .moments
            .iter()
            .map(|&moment| {
                let (time, frame) = sampler.locate(moment);
                let slot = *slot_of.entry(frame).or_insert_with(|| {
                    order.push(frame);
                    (order.len() - 1) as u32
                });
                (time, slot)
            })
            .collect::<Vec<_>>();
        (times, order)
    });

    let workers = if order.len() >= PARALLEL_FRAMES {
        threads
    } else {
        1
    };
    let samples = parallel_map(order.len(), workers, |at| {
        let frame = order[at];
        let bones = Probe::spent(&probe.pose, || sampler.bones_at(frame));
        let pose = bones
            .map(|bones| Probe::spent(&probe.digest, || Digest::of(&bones)))
            .map_err(EngineError::from);
        Sample { frame, pose }
    });
    Layer::Ready(Ready {
        file,
        clip: sampler.clip().to_owned(),
        frames: sampler.frames(),
        duration: sampler.duration(),
        times,
        samples,
    })
}

/// Слой под защитой от паники разбора: упавший слой отвечает отказом, остальные живут.
fn guarded_layer(ask: &Ask, clip: &str, threads: usize, probe: &Probe) -> Layer {
    panic::catch_unwind(AssertUnwindSafe(|| sample_layer(ask, clip, threads, probe)))
        .unwrap_or_else(|_| {
            Layer::Failed(EngineError::internal(
                "Разбор клипа sample-anim-track упал.",
            ))
        })
}

// ------------------------------------------------------------------ ответ

fn error_json(error: &EngineError) -> Value {
    json!({ "code": error.code, "message": error.message })
}

fn numbers(values: &[f64]) -> Value {
    values.iter().map(|&number| Value::from(number)).collect()
}

fn pad8(length: usize) -> usize {
    length.next_multiple_of(8)
}

/// Одно описание слоя; `body` — тело контейнера, если числа уходят в него; `travel` — вход просил корневое движение.
fn layer_json(layer: &Layer, mut body: Option<&mut Vec<u8>>, travel: bool) -> Value {
    let ready = match layer {
        Layer::Failed(error) => return json!({ "error": error_json(error) }),
        Layer::Ready(ready) => ready,
    };
    let samples: Vec<Value> = ready
        .samples
        .iter()
        .map(|sample| match (&sample.pose, body.as_deref_mut()) {
            (Err(error), _) => json!({ "frame": sample.frame, "error": error_json(error) }),
            (Ok(digest), None) => {
                let mut record = json!({
                    "frame": sample.frame,
                    "mover": digest.mover.as_ref().map_or(Value::Null, |mover| numbers(mover)),
                    "tags": digest.tags,
                    "rotations": numbers(&digest.rotations),
                });
                if travel {
                    record["travel"] = digest
                        .travel
                        .as_ref()
                        .map_or(Value::Null, |shift| numbers(shift));
                }
                record
            }
            (Ok(digest), Some(body)) => {
                let at = body.len();
                for tag in &digest.tags {
                    body.extend_from_slice(&tag.to_le_bytes());
                }
                body.resize(at + pad8(digest.tags.len() * 2), 0);
                let mover = digest.mover.unwrap_or(STILL_MOVER);
                for number in &mover {
                    body.extend_from_slice(&number.to_le_bytes());
                }
                if travel {
                    for number in digest.travel.unwrap_or([0.0; 3]) {
                        body.extend_from_slice(&number.to_le_bytes());
                    }
                }
                for number in &digest.rotations {
                    body.extend_from_slice(&number.to_le_bytes());
                }
                let mut record = json!({
                    "frame": sample.frame,
                    "count": digest.tags.len(),
                    "hasMover": digest.mover.is_some(),
                    "at": at,
                });
                if travel {
                    record["hasTravel"] = Value::Bool(digest.travel.is_some());
                }
                record
            }
        })
        .collect();
    let times: Vec<f64> = ready.times.iter().map(|&(time, _)| plain(time)).collect();
    let slots: Vec<u32> = ready.times.iter().map(|&(_, slot)| slot).collect();
    json!({
        "file": ready.file,
        "clip": ready.clip,
        "frames": ready.frames,
        "duration": plain(ready.duration),
        "times": numbers(&times),
        "slots": slots,
        "samples": samples,
    })
}

/// Контейнер `ATK1` (с корневым движением — `ATK2`): голова JSON `{ layers }` и тело с числами.
fn container(layers: &[Layer], travel: bool) -> Vec<u8> {
    let mut body = Vec::new();
    let list: Vec<Value> = layers
        .iter()
        .map(|layer| layer_json(layer, Some(&mut body), travel))
        .collect();
    let mut head = json!({ "layers": list }).to_string().into_bytes();
    head.resize(pad8(head.len() + 8) - 8, b' ');
    let mut out = Vec::with_capacity(8 + head.len() + body.len());
    out.extend_from_slice(if travel { MAGIC_TRAVEL } else { MAGIC });
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&body);
    out
}

fn run(request: &Request, assets: &Path, shelf: Option<&Arc<Shelf>>) -> Result<Value> {
    let began = Instant::now();
    let probe = Probe::default();
    let threads = request.threads.unwrap_or_else(default_threads);
    let across = threads.min(request.layers.len());
    let within = (threads / across.max(1)).max(1);
    let layers = parallel_map(request.layers.len(), across, |at| {
        guarded_layer(&request.layers[at], &request.clip, within, &probe)
    });

    let mut answer = Map::new();
    let encoded = Instant::now();
    let mut stored = 0;
    if request.binary {
        let delivery = deliver(
            container(&layers, request.travel),
            request.to_file,
            shelf,
            assets,
        )?;
        stored = delivery.bytes;
        answer.insert("container".to_owned(), delivery.json());
    } else {
        let list: Vec<Value> = layers
            .iter()
            .map(|layer| layer_json(layer, None, request.travel))
            .collect();
        answer.insert("layers".to_owned(), Value::Array(list));
    }
    if request.timings {
        let ready = layers.iter().filter_map(|layer| match layer {
            Layer::Ready(ready) => Some(ready),
            Layer::Failed(_) => None,
        });
        let (moments, samples) = ready.fold((0, 0), |(m, s), one| {
            (m + one.times.len(), s + one.samples.len())
        });
        let failed = layers
            .iter()
            .filter(|layer| matches!(layer, Layer::Failed(_)))
            .count();
        answer.insert(
            "timings".to_owned(),
            json!({
                "wallMs": millis(u64::try_from(began.elapsed().as_micros()).unwrap_or(u64::MAX)),
                "threads": { "layers": across, "frames": within },
                "layers": request.layers.len(),
                "failedLayers": failed,
                "moments": moments,
                "samples": samples,
                "containerBytes": stored,
                "ms": {
                    "read": millis(probe.read.load(Relaxed)),
                    "open": millis(probe.open.load(Relaxed)),
                    "locate": millis(probe.locate.load(Relaxed)),
                    "pose": millis(probe.pose.load(Relaxed)),
                    "digest": millis(probe.digest.load(Relaxed)),
                    "encode": millis(u64::try_from(encoded.elapsed().as_micros()).unwrap_or(u64::MAX)),
                },
            }),
        );
    }
    Ok(Value::Object(answer))
}

// ------------------------------------------------------------------ команда

fn request_body(options: &Options) -> Result<Value> {
    let text = match options.optional("request-json") {
        Some(inline) => inline.to_owned(),
        None => {
            let path = paths::full_path(options.required("request")?)?;
            if fs::metadata(&path).map_err(EngineError::from)?.len() > MAX_REQUEST_BYTES {
                return Err(bad("Запрос sample-anim-track слишком велик."));
            }
            fs::read_to_string(&path).map_err(EngineError::from)?
        }
    };
    text.trim_start_matches('\u{feff}')
        .parse()
        .map_err(|_| bad("Запрос sample-anim-track — не JSON."))
}

fn sample_anim_track(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = Request::parse(&request_body(options)?)?;
    run(
        &request,
        &ars2::assets_dir(options),
        crate::shelf::production().as_ref(),
    )
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, sample_anim_track)];

#[cfg(test)]
mod tests;
