//! Клипы «звезды арены»: подъём и поворот барабана по кадрам и «живая картинка»
//! (сдвиги текстурных координат). Модуль собирает клипы и отдаёт их `ycd_write`.
//!
//! Числа, которые прежний хост печатал в XML с шестью знаками, округляются так же
//! (`round6`): их читает CodeWalker. Таблица костей штатной звезды и правило имени
//! модели общие с клипом дирижабля (`sky_clip`).

use crate::error::{Error, Result};
use crate::ycd_write::{self as yw, Channel as Ch};

/// Кость штатной звезды: метка и положение покоя.
pub struct TemplateBone {
    pub tag: u16,
    pub translation: [f32; 3],
}

pub const BONES: [TemplateBone; 4] = [
    TemplateBone { tag: 0, translation: [0.0, 0.0, 0.0] },
    TemplateBone { tag: 4501, translation: [0.0, 0.0, 0.0] },
    TemplateBone { tag: 40657, translation: [0.0006432533, -0.31497478, 1.1202866] },
    TemplateBone { tag: 64297, translation: [0.0006432533, -0.31497478, 0.9070908] },
];

/// Кость барабана: единственная, что двигается.
pub const MOVING_BONE: usize = 2;

/// Подъём и поворот барабана по кадрам.
#[derive(Debug, Clone, PartialEq)]
pub struct Motion {
    pub duration: f32,
    pub lift: Vec<f32>,
    pub angle: Vec<f32>,
}

/// Сдвиги `(u, v)` по кадрам; частота фиксирована, 30 кадров в секунду.
#[derive(Debug, Clone, PartialEq)]
pub struct UvAnimation {
    pub duration: f32,
    pub shifts: Vec<[f32; 2]>,
}

/// Пределы одного вида клипа и тексты отказов по ним.
struct Rules {
    frames: (usize, usize),
    seconds: (f32, f32),
    bad_frames: &'static str,
    bad_seconds: &'static str,
    signature: u32,
}

impl Rules {
    fn frames_fit(&self, count: usize) -> bool {
        (self.frames.0..=self.frames.1).contains(&count)
    }

    fn seconds_fit(&self, duration: f32) -> bool {
        duration.is_finite() && (self.seconds.0..=self.seconds.1).contains(&duration)
    }
}

const MSG_MOTION_FRAMES: &str = "Движение звезды: от 2 до 512 кадров подъёма и поворота.";
const MSG_MOTION_TIME: &str = "Движение звезды: длительность от 0,1 до 120 с.";
const MSG_UV_FRAMES: &str = "Живая картинка: от 2 до 1201 кадров.";
const MSG_UV_TIME: &str = "Живая картинка: длительность от 0,05 до 40 с.";

const MOTION: Rules = Rules {
    frames: (2, 512),
    seconds: (0.1, 120.0),
    bad_frames: MSG_MOTION_FRAMES,
    bad_seconds: MSG_MOTION_TIME,
    signature: 0xF3A9_5F25,
};

const PICTURE: Rules = Rules {
    frames: (2, 1201),
    seconds: (0.05, 40.0),
    bad_frames: MSG_UV_FRAMES,
    bad_seconds: MSG_UV_TIME,
    signature: 0x6B00_2400,
};

const MSG_NAME: &str = "Имя модели звезды: строчные латинские буквы, цифры и «_», до 63 знаков.";
const MSG_NOTHING: &str = "Клип звезды: нужно движение или живая картинка.";
const MSG_MOTION_LIFT: &str = "Движение звезды: подъём от 0 до 10.";
const MSG_MOTION_ANGLE: &str = "Движение звезды: поворот по модулю не больше 7.";
const MSG_UV_RATE: &str = "Живая картинка: 30 кадров в секунду.";
const MSG_UV_SHIFT: &str = "Живая картинка: сдвиги по модулю не больше 4.";

/// Подъём или поворот с модулем не больше этого считается покоем.
const IDLE: f32 = 1e-5;

/// Округление до шести знаков после точки (точная ничья идёт к чётной цифре);
/// результат читается обратно как ближайшее `f32`. `NaN` и бесконечности проходят.
pub fn round6(value: f32) -> f32 {
    let text = format!("{value:.6}");
    text.parse::<f32>().unwrap_or(value)
}

/// Имя модели: 1…63 байта, строчные латинские буквы, цифры и «_», но не с «_» в начале.
pub fn check_name(name: &str) -> Result<()> {
    let class = |b: &u8| matches!(b, b'a'..=b'z' | b'0'..=b'9');
    match name.as_bytes() {
        [first, rest @ ..] if rest.len() < 63 && class(first) && rest.iter().all(|b| class(b) || *b == b'_') => Ok(()),
        _ => Err(Error::argument(MSG_NAME)),
    }
}

/// Словарь клипов: сначала движение, затем живая картинка; что не задано, пропускается.
pub fn build_dictionary(name: &str, motion: Option<&Motion>, uv: Option<&UvAnimation>) -> Result<Vec<u8>> {
    check_name(name)?;
    let moving = motion.map(|m| motion_clip(name, m)).transpose()?;
    let picture = uv.map(|u| uv_clip(name, u)).transpose()?;
    let clips: Vec<yw::NewClip> = moving.into_iter().chain(picture).collect();
    match clips.as_slice() {
        [] => Err(Error::argument(MSG_NOTHING)),
        ready => yw::new_dictionary(ready),
    }
}

/// Первое сработавшее условие отказа по порядку; условия считаются лениво.
fn refuse_first(checks: &[(&dyn Fn() -> bool, &str)]) -> Result<()> {
    match checks.iter().find(|(failed, _)| failed()) {
        Some(&(_, text)) => Err(Error::argument(text)),
        None => Ok(()),
    }
}

/// Всё, из чего складывается клип с одной анимацией.
struct Draft {
    clip_hash: u32,
    label: String,
    animation_hash: u32,
    signature: u32,
    seconds: f32,
    frames: usize,
    bones: Vec<yw::BoneTrack>,
    groups: Vec<yw::Group>,
}

impl Draft {
    fn into_clip(self) -> yw::NewClip {
        yw::NewClip {
            hash: self.clip_hash,
            name: format!("pack:/{}.clip", self.label),
            start: 0.0,
            end: self.seconds,
            rate: 1.0,
            properties: vec![yw::ClipProperty::host_model()],
            animation: yw::NewAnimation {
                hash: self.animation_hash,
                signature: self.signature,
                duration: self.seconds,
                frames: self.frames,
                limit: self.frames + 2,
                bones: self.bones,
                groups: self.groups,
                sequences: None,
            },
        }
    }
}

/// Группа из каналов по порядку слотов; лишние слоты остаются пустыми.
fn grouped(channels: impl IntoIterator<Item = Ch>, cached: Option<u8>) -> yw::Group {
    let mut channels = channels.into_iter();
    yw::Group { slots: std::array::from_fn(|_| channels.next()), cached }
}

/// Дорожки костей из троек `(кость, дорожка, неизвестное)`.
fn tracks(entries: impl IntoIterator<Item = (u16, u8, u8)>) -> Vec<yw::BoneTrack> {
    entries.into_iter().map(|(bone, track, unk)| yw::BoneTrack { bone, track, unk }).collect()
}

/// Самый мелкий шаг, который переживает округление до шести знаков.
const FINEST_STEP: f32 = 1e-6;

/// Канал по ряду: шаг — размах, делённый на число ступеней, не мельче `floor`;
/// смещение — наименьшее значение; значения и шаг округляются до шести знаков,
/// а шаг после округления не меньше миллионной: нулевой шаг формат не принимает,
/// а порог `floor` мельче шестого знака округление съедало.
fn ranged_channel(series: &[f32], (low, high): (f32, f32), (steps, floor): (f32, f32), indirect: bool) -> Ch {
    let quantum = round6(((high - low) / steps).max(floor)).max(FINEST_STEP);
    let offset = round6(low);
    let values = series.iter().map(|&v| round6(v)).collect();
    if indirect {
        Ch::Indirect { quantum, offset, values }
    } else {
        Ch::Quantize { quantum, offset, values }
    }
}

/// Ряд с равномерным шагом: 4095 ступеней, шаг не мельче миллионной.
fn even_series(series: &[f32]) -> Ch {
    let ends = series
        .iter()
        .fold((series[0], series[0]), |(lo, hi), &v| (if v < lo { v } else { lo }, if v > hi { v } else { hi }));
    ranged_channel(series, ends, (4095.0, 1e-6), false)
}

/// Ступенчатый ряд: постоянный даёт одно число (первое по кадрам), иначе косвенный
/// канал на 65535 ступеней с шагом не мельче десятимиллионной.
fn stepped_series(series: &[f32]) -> Ch {
    let low = series.iter().copied().min_by(f32::total_cmp).unwrap_or_default();
    let high = series.iter().copied().max_by(f32::total_cmp).unwrap_or_default();
    if low == high {
        Ch::StaticFloat(round6(series[0]))
    } else {
        ranged_channel(series, (low, high), (65535.0, 1e-7), true)
    }
}

pub fn motion_clip(name: &str, motion: &Motion) -> Result<yw::NewClip> {
    let frames = motion.lift.len();
    let strays = |series: &[f32], fits: &dyn Fn(f32) -> bool| series.iter().any(|&v| !v.is_finite() || !fits(v));
    refuse_first(&[
        (&|| motion.angle.len() != frames || !MOTION.frames_fit(frames), MOTION.bad_frames),
        (&|| !MOTION.seconds_fit(motion.duration), MOTION.bad_seconds),
        (&|| strays(&motion.lift, &|v| (0.0..=10.0).contains(&v)), MSG_MOTION_LIFT),
        (&|| strays(&motion.angle, &|v| v.abs() <= 7.0), MSG_MOTION_ANGLE),
    ])?;
    let stirs = |series: &[f32]| series.iter().copied().map(f32::abs).fold(0.0, f32::max) > IDLE;
    // По умолчанию кости стоят; двигается только барабан, и только если есть что двигать.
    let mut places: Vec<yw::Group> =
        BONES.iter().map(|bone| grouped([Ch::StaticVector3(bone.translation.map(round6))], None)).collect();
    let mut spins: Vec<yw::Group> =
        BONES.iter().map(|_| grouped([Ch::StaticQuaternion([0.0, 0.0, 0.0, 1.0])], None)).collect();
    if stirs(&motion.lift) {
        let [x, y, z] = BONES[MOVING_BONE].translation;
        let heights: Vec<f32> = motion.lift.iter().map(|up| z + up).collect();
        places[MOVING_BONE] = grouped([Ch::StaticFloat(round6(x)), Ch::StaticFloat(round6(y)), even_series(&heights)], None);
    }
    if stirs(&motion.angle) {
        let half_turn = |f: fn(f64) -> f64| -> Vec<f32> { motion.angle.iter().map(|a| f(f64::from(a / 2.0)) as f32).collect() };
        let (sines, cosines) = (even_series(&half_turn(f64::sin)), even_series(&half_turn(f64::cos)));
        spins[MOVING_BONE] = grouped([Ch::StaticFloat(0.0), Ch::StaticFloat(0.0), sines, cosines], Some(0));
    }
    Ok(Draft {
        clip_hash: yw::name_hash(name),
        label: name.to_string(),
        animation_hash: yw::name_hash(name),
        signature: MOTION.signature,
        seconds: round6(motion.duration),
        frames,
        bones: tracks((0..2u8).flat_map(|track| BONES.iter().map(move |bone| (bone.tag, track, track)))),
        groups: places.into_iter().chain(spins).collect(),
    }
    .into_clip())
}

pub fn uv_clip(name: &str, uv: &UvAnimation) -> Result<yw::NewClip> {
    let frames = uv.shifts.len();
    refuse_first(&[
        (&|| !PICTURE.frames_fit(frames), PICTURE.bad_frames),
        (&|| !PICTURE.seconds_fit(uv.duration), PICTURE.bad_seconds),
        (&|| ((frames - 1) as f32 / uv.duration - 30.0).abs() > 0.5, MSG_UV_RATE),
        (&|| uv.shifts.iter().flatten().any(|v| !v.is_finite() || v.abs() > 4.0), MSG_UV_SHIFT),
    ])?;
    let clip = format!("{name}_uv_0");
    // Ось u держит константы (1, 0), ось v — (0, 1); третьим идёт сам ряд сдвигов.
    let (us, vs): (Vec<f32>, Vec<f32>) = uv.shifts.iter().map(|&[u, v]| (u, v)).unzip();
    let groups = [(us, [1.0, 0.0]), (vs, [0.0, 1.0])]
        .into_iter()
        .map(|(column, [first, second])| {
            grouped([Ch::StaticFloat(first), Ch::StaticFloat(second), stepped_series(&column)], None)
        })
        .collect();
    Ok(Draft {
        clip_hash: yw::name_hash(name).wrapping_add(1),
        animation_hash: yw::name_hash(&clip),
        label: clip,
        signature: PICTURE.signature,
        seconds: round6(uv.duration),
        frames,
        bones: tracks([(0, 17, 0), (0, 18, 0)]),
        groups,
    }
    .into_clip())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ycd, ycd_pose};

    fn spin(frames: usize, duration: f32) -> Motion {
        let n = frames as f32;
        Motion {
            duration,
            lift: (0..frames).map(|i| 0.3 * (i as f32 / n)).collect(),
            angle: (0..frames).map(|i| 6.0 * i as f32 / n).collect(),
        }
    }

    #[test]
    fn motion_and_uv_clips_read_back() {
        let motion = spin(20, 19.0 / 30.0);
        let uv = UvAnimation { duration: 19.0 / 30.0, shifts: (0..20).map(|f| [0.05 * (f % 4) as f32, 0.0]).collect() };
        let bytes = build_dictionary("ycd_star_test", Some(&motion), Some(&uv)).unwrap();
        let names = ycd_pose::clip_names(&bytes).unwrap();
        assert!(names.contains(&"ycd_star_test".to_string()) && names.contains(&"ycd_star_test_uv_0".to_string()));
        assert_eq!(ycd::summarize(&bytes).unwrap().len(), 2);
        // четыре места и четыре поворота
        assert_eq!(ycd_pose::sample_clip(&bytes, "ycd_star_test", 0.0).unwrap().bones.len(), 8);
    }

    #[test]
    fn a_nearly_still_picture_is_built_with_the_smallest_step() {
        // размах меньше 0,0328 давал шаг 0 после округления до шести знаков, и словарь
        // отказывал ошибкой квантования, тогда как размах 0,05 строился
        let wobble = |height: f32| UvAnimation {
            duration: 19.0 / 30.0,
            shifts: (0..20).map(|f| [if f % 2 == 1 { height } else { 0.0 }, 0.0]).collect(),
        };
        for height in [0.01, 0.0005, 0.000002] {
            let uv = wobble(height);
            let bytes = build_dictionary("ycd_star_tiny", None, Some(&uv))
                .unwrap_or_else(|err| panic!("размах {height}: {err}"));
            let clip = uv_clip("ycd_star_tiny", &uv).unwrap();
            let Some(Ch::Indirect { quantum, offset, values }) = &clip.animation.groups[0].slots[2] else {
                panic!("ряд u должен быть косвенным каналом");
            };
            assert_eq!((*quantum, *offset), (1e-6, 0.0), "размах {height}");
            assert_eq!(values.len(), 20);
            assert_eq!(ycd::summarize(&bytes).unwrap().len(), 1);
        }
        // ряды выше порога строились и раньше и остались прежними: шаг — размах на 65535
        // ступеней, округлённый до шести знаков
        for (height, expected) in [(0.05, 1e-6), (0.5, 8e-6), (4.0, 6.1e-5)] {
            let before = uv_clip("ycd_star_tiny", &wobble(height)).unwrap();
            assert!(
                matches!(&before.animation.groups[0].slots[2], Some(Ch::Indirect { quantum, .. }) if *quantum == expected),
                "размах {height}"
            );
        }
        // совсем неподвижный ряд по-прежнему одно число
        let still = uv_clip("ycd_star_tiny", &wobble(0.0)).unwrap();
        assert_eq!(still.animation.groups[0].slots[2], Some(Ch::StaticFloat(0.0)));
    }

    #[test]
    fn motion_refuses_a_bad_angle() {
        let mut motion = spin(4, 3.0 / 30.0);
        assert!(build_dictionary("ycd_star_bad", Some(&motion), None).is_ok());
        motion.angle[1] = 8.0;
        let err = build_dictionary("ycd_star_bad", Some(&motion), None).unwrap_err();
        assert_eq!(err.to_string(), MSG_MOTION_ANGLE);
    }

    #[test]
    fn uv_refuses_a_wrong_frame_rate() {
        let uv = UvAnimation { duration: 1.0, shifts: vec![[0.0, 0.0]; 4] };
        let err = build_dictionary("ycd_star_fps", None, Some(&uv)).unwrap_err();
        assert_eq!(err.to_string(), MSG_UV_RATE);
        assert_eq!(build_dictionary("ycd_star_fps", None, None).unwrap_err().to_string(), MSG_NOTHING);
    }

    #[test]
    fn rounding_matches_the_six_digit_format() {
        assert_eq!(round6(0.12345678), 0.123457);
        assert_eq!(round6(1.0000004), 1.0);
        assert_eq!(round6(0.0078125), 0.007812);
        assert_eq!(round6(0.0234375), 0.023438);
        assert!(round6(-4e-7).is_sign_negative() && round6(-4e-7) == 0.0);
        assert!(round6(f32::NAN).is_nan());
        assert_eq!(round6(f32::INFINITY), f32::INFINITY);
    }

    #[test]
    fn names_follow_the_model_rule() {
        for ok in ["a", "9", "star_1", &"x".repeat(63)] {
            assert!(check_name(ok).is_ok(), "{ok}");
        }
        for bad in ["", "_a", "Star", "a b", "a-b", "a.b", "a/b", "a\n", "звезда", &"x".repeat(64), "caf\u{e9}"] {
            assert_eq!(check_name(bad).unwrap_err().to_string(), MSG_NAME, "{bad:?}");
        }
    }

    #[test]
    fn motion_clip_has_eight_groups_and_checks_in_order() {
        let clip = motion_clip("t", &spin(2, 0.5)).unwrap();
        assert_eq!(clip.animation.groups.len(), 8);
        assert_eq!(clip.animation.bones.len(), 8);
        assert_eq!((clip.animation.frames, clip.animation.limit), (2, 4));
        assert_eq!(clip.hash, yw::name_hash("t"));
        assert_eq!(clip.name, "pack:/t.clip");
        let bad = Motion { duration: f32::NAN, lift: vec![11.0; 3], angle: vec![9.0; 2] };
        assert_eq!(motion_clip("t", &bad).unwrap_err().to_string(), MSG_MOTION_FRAMES);
        let bad = Motion { duration: f32::NAN, lift: vec![11.0; 3], angle: vec![9.0; 3] };
        assert_eq!(motion_clip("t", &bad).unwrap_err().to_string(), MSG_MOTION_TIME);
        let bad = Motion { duration: 1.0, lift: vec![11.0; 3], angle: vec![9.0; 3] };
        assert_eq!(motion_clip("t", &bad).unwrap_err().to_string(), MSG_MOTION_LIFT);
    }

    #[test]
    fn uv_clip_shares_the_model_hash_plus_one() {
        let uv = UvAnimation { duration: 2.0 / 30.0, shifts: vec![[0.0, 0.0], [0.25, 0.5], [0.5, 1.0]] };
        let clip = uv_clip("ycd_star_test", &uv).unwrap();
        assert_eq!(clip.hash, 0x1252_3f76);
        assert_eq!(clip.animation.hash, 0x0ec0_9597);
        assert_eq!(clip.name, "pack:/ycd_star_test_uv_0.clip");
        assert_eq!(clip.animation.groups[1].slots[2], Some(Ch::Indirect { quantum: 1.5e-5, offset: 0.0, values: vec![0.0, 0.5, 1.0] }));
    }
}
