//! Клип полёта дирижабля: словарь клипов `.ycd` с одним клипом и одной анимацией.
//!
//! Окно присылает длительность и путь (кадры по семь чисел: место и кватернион
//! поворота), по желанию ещё «местное» движение гибкой части модели. Путь
//! проверяется, пересчитывается линейной смесью на 30, 15, 10 или 5 кадров в
//! секунду и раскладывается по двум костям модели; словарь собирает
//! `ycd_write::new_dictionary`. Значения не округляются: CodeWalker читает те же
//! числа, что хост на C#. Порядок операций с плавающей точкой влияет на биты
//! результата, поэтому он расписан ниже явно.

use std::array::from_fn;
use std::f64::consts::PI;
use std::ops::RangeInclusive;

use crate::error::{Error, Result};
use crate::star_clip::{check_name, BONES, MOVING_BONE};
use crate::ycd_write::{name_hash, new_dictionary, BoneTrack, Channel, ClipProperty, Group, NewAnimation, NewClip, NewSequence};

/// Путь полёта: длительность в секундах и кадры `[x, y, z, qx, qy, qz, qw]`.
#[derive(Debug, Clone, PartialEq)]
pub struct Path {
    pub duration: f64,
    pub frames: Vec<[f64; 7]>,
}

/// Местное движение гибкой части: сдвиг и поворот в осях модели по кадрам.
#[derive(Debug, Clone, PartialEq)]
pub struct Local {
    pub frames: Vec<[f64; 7]>,
}

type Frame = [f64; 7];
type Vec3 = [f64; 3];

/// Гибкая кость («Innards») в таблице костей.
const FLEX_BONE: usize = 3;
/// Подпись анимации в XML хоста.
const SIGNATURE: u32 = 0xF3A9_5F25;

/// Что известно о частоте клипа: предпочтительные частоты, потолок числа шагов
/// и размер куска длинного клипа (лимит блока).
struct Timing {
    rates: [u32; 4],
    max_steps: f64,
    long_limit: usize,
}

const TIMING: Timing = Timing {
    rates: [30, 15, 10, 5],
    max_steps: 9000.0,
    long_limit: 1503,
};

/// Допуск единичности кватерниона; общий для пути и местного движения.
const UNIT_TOLERANCE: f64 = 0.01;

/// Правила проверки кадров: сколько их бывает и какими словами отказывать.
struct Scope {
    count: RangeInclusive<usize>,
    texts: Texts,
    /// Дополнительное правило к кадру (диапазон места или длина сдвига) и текст отказа.
    extra: fn(&Frame) -> Option<&'static str>,
    /// Нормировать ли кватернион кадра после проверки.
    normalize: bool,
}

struct Texts {
    count: &'static str,
    finite: &'static str,
    unit: &'static str,
    sign: &'static str,
}

fn plane_and_height(frame: &Frame) -> Option<&'static str> {
    let out = frame[0].abs() > 3000.0 || frame[1].abs() > 3000.0 || !(-100.0..=2000.0).contains(&frame[2]);
    out.then_some("Путь полёта: ±3000 м по плоскости и от −100 до 2000 м по высоте.")
}

fn short_shift(frame: &Frame) -> Option<&'static str> {
    let reach = (frame[0] * frame[0] + frame[1] * frame[1] + frame[2] * frame[2]).sqrt();
    (reach > 40.0).then_some("Местное движение: сдвиг не больше 40 м.")
}

fn path_scope() -> Scope {
    Scope {
        count: 2..=1024,
        texts: Texts {
            count: "Путь полёта: от 2 до 1024 кадров.",
            finite: "Путь полёта: кадр — семь конечных чисел.",
            unit: "Путь полёта: поворот — единичный кватернион.",
            sign: "Путь полёта: знак поворота меняется между соседними кадрами; нужны непрерывные по знаку кватернионы.",
        },
        extra: plane_and_height,
        normalize: true,
    }
}

fn local_scope() -> Scope {
    Scope {
        count: 2..=9001,
        texts: Texts {
            count: "Местное движение: от 2 до 9001 кадров.",
            finite: "Местное движение: кадр — семь конечных чисел.",
            unit: "Местное движение: поворот — единичный кватернион.",
            sign: "Местное движение: знак поворота меняется между соседними кадрами.",
        },
        extra: short_shift,
        normalize: false,
    }
}

/// Кватернион `[x, y, z, w]`. Порядок слагаемых в операциях задаёт биты результата.
#[derive(Clone, Copy)]
struct Quat([f64; 4]);

/// Слагаемые компонент произведения `a ⊗ b`: (индекс у `a`, индекс у `b`, знак),
/// складываются слева направо.
const PRODUCT_TERMS: [[(usize, usize, f64); 4]; 4] = [
    [(3, 0, 1.0), (0, 3, 1.0), (1, 2, 1.0), (2, 1, -1.0)],
    [(3, 1, 1.0), (0, 2, -1.0), (1, 3, 1.0), (2, 0, 1.0)],
    [(3, 2, 1.0), (0, 1, 1.0), (1, 0, -1.0), (2, 3, 1.0)],
    [(3, 3, 1.0), (0, 0, -1.0), (1, 1, -1.0), (2, 2, -1.0)],
];

impl Quat {
    fn of(frame: &Frame) -> Quat {
        Quat(from_fn(|i| frame[3 + i]))
    }

    /// Скалярное произведение: сумма попарных произведений слева направо.
    fn inner(&self, other: &Quat) -> f64 {
        let [a, b, c, d] = from_fn(|i| self.0[i] * other.0[i]);
        a + b + c + d
    }

    fn unit(self) -> Quat {
        let norm = self.inner(&self).sqrt();
        Quat(self.0.map(|c| c / norm))
    }

    fn times(&self, other: &Quat) -> Quat {
        Quat(PRODUCT_TERMS.map(|terms| {
            terms
                .iter()
                .map(|&(i, j, sign)| sign * (self.0[i] * other.0[j]))
                .reduce(|sum, term| sum + term)
                .unwrap_or(0.0)
        }))
    }

    /// Поворот точки: x, y, z у `(q ⊗ (v, 0)) ⊗ q̄`.
    fn turn(&self, point: Vec3) -> Vec3 {
        let mirror = Quat([-self.0[0], -self.0[1], -self.0[2], self.0[3]]);
        let lifted = Quat([point[0], point[1], point[2], 0.0]);
        let [x, y, z, _] = self.times(&lifted).times(&mirror).0;
        [x, y, z]
    }
}

/// Скачок знака между соседними кадрами: скалярное произведение ниже нуля.
fn flips_sign(frames: &[Frame]) -> bool {
    frames
        .iter()
        .zip(frames.iter().skip(1))
        .any(|(before, after)| Quat::of(before).inner(&Quat::of(after)) < 0.0)
}

fn refuse(text: &str) -> Error {
    Error::argument(text)
}

fn check_count(scope: &Scope, count: usize) -> Result<()> {
    if scope.count.contains(&count) {
        Ok(())
    } else {
        Err(refuse(scope.texts.count))
    }
}

/// Проверяет один кадр: конечность, правило области, единичность кватерниона.
fn vet_frame(frame: &Frame, scope: &Scope) -> Result<Frame> {
    if frame.iter().any(|value| !value.is_finite()) {
        return Err(refuse(scope.texts.finite));
    }
    if let Some(text) = (scope.extra)(frame) {
        return Err(refuse(text));
    }
    let q = Quat::of(frame);
    if (q.inner(&q).sqrt() - 1.0).abs() > UNIT_TOLERANCE {
        return Err(refuse(scope.texts.unit));
    }
    let mut kept = *frame;
    if scope.normalize {
        kept[3..].copy_from_slice(&q.unit().0);
    }
    Ok(kept)
}

/// Кадры целиком: каждый по порядку, затем скачки знака между соседними.
fn vet_frames(frames: &[Frame], scope: &Scope) -> Result<Vec<Frame>> {
    let kept = frames
        .iter()
        .map(|frame| vet_frame(frame, scope))
        .collect::<Result<Vec<_>>>()?;
    if flips_sign(&kept) {
        return Err(refuse(scope.texts.sign));
    }
    Ok(kept)
}

/// Угол между двумя поворотами в градусах; знак выбирается по скалярному произведению.
fn turn_degrees(a: &Quat, b: &Quat) -> f64 {
    let sign = if a.inner(b) < 0.0 { -1.0 } else { 1.0 };
    // Корень суммы квадратов покомпонентных сумм `a + k·b`.
    let reach = |k: f64| -> f64 {
        let terms: [f64; 4] = from_fn(|i| a.0[i] + k * b.0[i]);
        terms.iter().fold(0.0, |sum, term| sum + term * term).sqrt()
    };
    // Разности `a − s·b` дают числитель, суммы `a + s·b` — знаменатель.
    4.0 * reach(-sign).atan2(reach(sign)) * 180.0 / PI
}

/// Местное движение должно кончаться там же, где начинается.
fn closes_up(frames: &[Frame]) -> bool {
    let (first, last) = (&frames[0], &frames[frames.len() - 1]);
    let apart: [f64; 3] = from_fn(|i| first[i] - last[i]);
    let shift = (apart[0] * apart[0] + apart[1] * apart[1] + apart[2] * apart[2]).sqrt();
    shift <= 0.01 && turn_degrees(&Quat::of(first), &Quat::of(last)) <= 0.5
}

/// Сколько шагов у клипа: первая частота, при которой их не больше потолка.
fn count_steps(duration: f64) -> Result<usize> {
    TIMING
        .rates
        .iter()
        .find_map(|&rate| {
            let steps = (duration * f64::from(rate)).round_ties_even();
            (steps <= TIMING.max_steps).then_some(steps as usize)
        })
        .map(|steps| steps.max(1))
        .ok_or_else(|| refuse("Путь полёта: слишком длинный для клипа."))
}

/// Лимит кадров блока и кадры каждого куска (оба конца включены): граничный кадр общий.
fn plan_blocks(steps: usize) -> (usize, Vec<(usize, usize)>) {
    let short = steps <= TIMING.long_limit;
    let (limit, pieces) = if short {
        ((steps + 1).div_ceil(16) * 16 - 1, 1)
    } else {
        (TIMING.long_limit, steps.div_ceil(TIMING.long_limit))
    };
    let spans = (0..pieces)
        .map(|piece| {
            let first = piece * limit;
            (first, (first + limit).min(steps))
        })
        .collect();
    (limit, spans)
}

/// Кадр клипа `frame` на кривой из `frames`, растянутой равномерно на `steps` шагов:
/// смесь двух соседних кадров, кватернион нормирован.
fn sample(frames: &[Frame], frame: usize, steps: usize) -> (Vec3, Quat) {
    let last = frames.len() - 1;
    let u = frame as f64 * last as f64 / steps as f64;
    let from = (u as usize).min(last - 1);
    let alpha = (u - from as f64).clamp(0.0, 1.0);
    let (a, b) = (&frames[from], &frames[from + 1]);
    let mixed: Frame = from_fn(|k| a[k] + (b[k] - a[k]) * alpha);
    (from_fn(|i| mixed[i]), Quat::of(&mixed).unit())
}

/// Дорожка кости: место и поворот на каждый кадр клипа.
struct Track {
    place: Vec<[f32; 3]>,
    turn: Vec<[f32; 4]>,
}

fn narrowed<const N: usize>(values: [f64; N]) -> [f32; N] {
    values.map(|v| v as f32)
}

fn drum_track(path: &[Frame], steps: usize) -> Track {
    let (place, turn) = (0..=steps)
        .map(|frame| {
            let (p, q) = sample(path, frame, steps);
            (narrowed(p), narrowed(q.0))
        })
        .unzip();
    Track { place, turn }
}

/// Гибкая кость: покачивается по кругу относительно барабана.
fn flex_track(path: &[Frame], local: &[Frame], steps: usize) -> Track {
    let rest: Vec3 = from_fn(|axis| {
        f64::from(BONES[FLEX_BONE].translation[axis] - BONES[MOVING_BONE].translation[axis])
    });
    let (place, turn) = (0..=steps)
        .scan(Quat([0.0; 4]), |before, frame| {
            let (p, q) = sample(path, frame, steps);
            let (shift, r) = sample(local, frame, steps);
            let held = r.turn(rest);
            let moved = q.turn(from_fn(|axis| shift[axis] + held[axis]));
            let place = narrowed(from_fn(|axis| p[axis] + moved[axis]));

            let mut whole = q.times(&r);
            if frame > 0 && before.inner(&whole) < 0.0 {
                whole = Quat(whole.0.map(|c| -c));
            }
            *before = whole;
            Some((place, narrowed(whole.0)))
        })
        .unzip();
    Track { place, turn }
}

/// Как кодировать ряд значений: размах, ниже которого ряд считается постоянным,
/// шаг сетки и потолок числа бит.
struct Coding {
    flat: f32,
    step: f64,
    max_bits: f64,
}

const PLACE_CODING: Coding = Coding {
    flat: 1e-4,
    step: 0.002,
    max_bits: 20.0,
};
const TURN_CODING: Coding = Coding {
    flat: 1e-6,
    step: 2.0 / 65535.0,
    max_bits: 16.0,
};
const MIN_BITS: f64 = 4.0;

/// Наименьшее и наибольшее значение ряда.
fn bounds(row: &[f32]) -> (f32, f32) {
    row.iter()
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(low, high), &v| {
            (low.min(v), high.max(v))
        })
}

/// Квантованный ряд: шаг сетки по размаху и числу бит, смещение — наименьшее значение.
fn quantized(row: &[f32], coding: &Coding) -> Channel {
    let (low, high) = bounds(row);
    let range = f64::from(high) - f64::from(low);
    let wanted = (range / coding.step + 1.0).log2().ceil();
    let bits = wanted.clamp(MIN_BITS, coding.max_bits) as i32;
    Channel::Quantize {
        quantum: (range / (2f64.powi(bits) - 1.0)) as f32,
        offset: low,
        values: row.to_vec(),
    }
}

/// Каналы по рядам, если хоть один ряд движется; иначе `None`.
fn moving_channels<const N: usize>(
    rows: &[Vec<f32>; N],
    coding: &Coding,
) -> Option<[Option<Channel>; 4]> {
    let spreads: [f32; N] = from_fn(|i| {
        let (low, high) = bounds(&rows[i]);
        high - low
    });
    if spreads.iter().all(|&spread| spread < coding.flat) {
        return None;
    }
    let mut slots: [Option<Channel>; 4] = Default::default();
    for ((slot, row), spread) in slots.iter_mut().zip(rows).zip(spreads) {
        *slot = Some(if spread < coding.flat {
            Channel::StaticFloat(row[0])
        } else {
            quantized(row, coding)
        });
    }
    Some(slots)
}

/// Группа каналов по рядам куска; если всё постоянно, одним значением из первых строк.
fn group_of<const N: usize>(
    rows: &[Vec<f32>; N],
    coding: &Coding,
    cached: Option<u8>,
    still: impl FnOnce([f32; N]) -> Channel,
) -> Group {
    match moving_channels(rows, coding) {
        Some(slots) => Group { slots, cached },
        None => Group {
            slots: [Some(still(from_fn(|i| rows[i][0]))), None, None, None],
            cached: None,
        },
    }
}

/// Ряды по компонентам из среза кадров дорожки.
fn rows_of<const N: usize>(part: &[[f32; N]]) -> [Vec<f32>; N] {
    from_fn(|axis| part.iter().map(|value| value[axis]).collect())
}

/// Что группа описывает: место или поворот кости.
#[derive(Clone, Copy)]
enum Quantity {
    Place,
    Turn,
}

/// Группа кости на куске кадров: по дорожке, а у кости без дорожки — состояние покоя.
fn bone_group(quantity: Quantity, bone: usize, track: Option<&Track>, span: (usize, usize)) -> Group {
    let (first, last) = span;
    match (quantity, track) {
        (Quantity::Place, Some(track)) => group_of(
            &rows_of(&track.place[first..=last]),
            &PLACE_CODING,
            None,
            Channel::StaticVector3,
        ),
        (Quantity::Turn, Some(track)) => group_of(
            &rows_of(&track.turn[first..=last]),
            &TURN_CODING,
            Some(0),
            |mut q| {
                // Постоянный кватернион пишется с неотрицательным w.
                if q[3] < 0.0 {
                    q = q.map(|c| -c);
                }
                Channel::StaticQuaternion(q)
            },
        ),
        (Quantity::Place, None) => Group {
            slots: [
                Some(Channel::StaticVector3(BONES[bone].translation)),
                None,
                None,
                None,
            ],
            cached: None,
        },
        (Quantity::Turn, None) => Group {
            slots: [
                Some(Channel::StaticQuaternion([0.0, 0.0, 0.0, 1.0])),
                None,
                None,
                None,
            ],
            cached: None,
        },
    }
}

/// Блок последовательности: четыре группы мест, затем четыре группы поворотов.
fn block_for(tracks: &[Option<Track>; 4], span: (usize, usize)) -> NewSequence {
    let groups = [Quantity::Place, Quantity::Turn]
        .into_iter()
        .flat_map(|quantity| {
            (0..BONES.len())
                .map(move |bone| (quantity, bone))
        })
        .map(|(quantity, bone)| bone_group(quantity, bone, tracks[bone].as_ref(), span))
        .collect();
    NewSequence {
        frames: span.1 - span.0 + 1,
        groups,
    }
}

/// Словарь клипов с клипом `name`: путь, при желании с местным движением гибкой кости.
pub fn build_dictionary(name: &str, path: &Path, local: Option<&Local>) -> Result<Vec<u8>> {
    check_name(name)?;
    let (path_scope, local_scope) = (path_scope(), local_scope());
    check_count(&path_scope, path.frames.len())?;
    if !(1.0..=1800.0).contains(&path.duration) {
        return Err(refuse("Путь полёта: длительность от 1 до 1800 с."));
    }
    let frames = vet_frames(&path.frames, &path_scope)?;
    let local_frames = match local {
        None => None,
        Some(local) => {
            check_count(&local_scope, local.frames.len())?;
            let kept = vet_frames(&local.frames, &local_scope)?;
            if !closes_up(&kept) {
                return Err(refuse("Местное движение: кончается там же, где начинается."));
            }
            Some(kept)
        }
    };

    let steps = count_steps(path.duration)?;
    let (limit, spans) = plan_blocks(steps);
    let mut tracks: [Option<Track>; 4] = Default::default();
    tracks[MOVING_BONE] = Some(drum_track(&frames, steps));
    tracks[FLEX_BONE] = local_frames
        .as_deref()
        .map(|local| flex_track(&frames, local, steps));
    let sequences = spans.iter().map(|&span| block_for(&tracks, span)).collect();

    let hash = name_hash(name);
    let duration = path.duration as f32;
    let bones = [0u8, 1]
        .into_iter()
        .flat_map(|track| {
            BONES.iter().map(move |bone| BoneTrack {
                bone: bone.tag,
                track,
                unk: track,
            })
        })
        .collect();
    let animation = NewAnimation {
        bones,
        limit,
        frames: steps + 1,
        sequences: Some(sequences),
        groups: Vec::new(),
        duration,
        signature: SIGNATURE,
        hash,
    };
    new_dictionary(&[NewClip {
        animation,
        properties: vec![ClipProperty::host_model()],
        rate: 1.0,
        end: duration,
        start: 0.0,
        name: format!("pack:/{name}.clip"),
        hash,
    }])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ycd::summarize;
    use crate::ycd_pose::{clip_names, sample_clip};

    /// Круг радиусом 40 м на высоте 60 м; поворот по курсу вокруг z.
    fn orbit(duration: f64, frames: usize) -> Path {
        Path {
            duration,
            frames: (0..frames)
                .map(|i| {
                    let angle = i as f64 / (frames - 1) as f64 * std::f64::consts::TAU;
                    let (sin, cos) = (angle / 2.0).sin_cos();
                    [40.0 * angle.cos(), 40.0 * angle.sin(), 60.0, 0.0, 0.0, sin, cos]
                })
                .collect(),
        }
    }

    #[test]
    fn orbit_reads_back_with_resampling_to_thirty_frames() {
        let bytes = build_dictionary("ycd_sky_test", &orbit(4.0, 9), None).unwrap();
        assert_eq!(clip_names(&bytes).unwrap(), ["ycd_sky_test"]);
        let clips = summarize(&bytes).unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].frames, 121);
    }

    #[test]
    fn long_path_splits_into_sequences_with_shared_frames() {
        let bytes = build_dictionary("ycd_sky_long", &orbit(60.0, 16), None).unwrap();
        let clips = summarize(&bytes).unwrap();
        assert_eq!(clips[0].frames, 1801);
        assert_eq!(clips[0].sequence_frame_limit, 1503);
        // 1800 шагов по 1503 кадра дают два куска; граничный кадр общий.
        assert_eq!(plan_blocks(1800).1, [(0, 1503), (1503, 1800)]);
        let pose = sample_clip(&bytes, "ycd_sky_long", 45.0).unwrap();
        assert_eq!(pose.bones.len(), 8);
    }

    #[test]
    fn unit_quaternion_is_required() {
        let mut path = orbit(4.0, 5);
        path.frames[2][6] = 2.0;
        assert!(build_dictionary("ycd_sky_test", &path, None).is_err());
    }

    #[test]
    fn sign_flips_between_frames_are_refused() {
        let mut path = orbit(4.0, 5);
        for k in 3..7 {
            path.frames[2][k] = -path.frames[2][k];
        }
        assert!(build_dictionary("ycd_sky_test", &path, None).is_err());
    }

    #[test]
    fn block_limit_follows_the_frame_count() {
        assert_eq!(plan_blocks(30).0, 31);
        assert_eq!(plan_blocks(100).0, 111);
        assert_eq!(plan_blocks(1502).0, 1503);
        assert_eq!(plan_blocks(1504).1.len(), 2);
        assert_eq!(plan_blocks(9000).1.len(), 6);
    }

    #[test]
    fn quantization_uses_between_four_and_the_maximum_bits() {
        let bits_of = |range: f32, coding: &Coding| match quantized(&[0.0, range], coding) {
            Channel::Quantize { quantum, .. } => {
                // квант = размах / (2^бит - 1)
                (f64::from(range) / f64::from(quantum) + 1.0).log2().round() as i32
            }
            _ => unreachable!(),
        };
        assert_eq!(bits_of(0.002, &PLACE_CODING), 4);
        assert_eq!(bits_of(1.0, &PLACE_CODING), 9);
        assert_eq!(bits_of(6000.0, &PLACE_CODING), 20);
        assert_eq!(bits_of(2.0, &TURN_CODING), 16);
    }

    #[test]
    fn the_product_of_quaternions_matches_the_hand_formula() {
        let (a, b) = (Quat([0.1, 0.2, 0.3, 0.9]), Quat([-0.4, 0.5, 0.6, 0.2]));
        let p = a.times(&b).0;
        let (a, b) = (a.0, b.0);
        let by_hand = [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
        ];
        assert_eq!(p, by_hand);
    }
}
