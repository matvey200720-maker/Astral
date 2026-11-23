//! Стадии перекраски текстуры: чёрно-белая и пять «стилей мира». Модуль решает,
//! какие стадии допустимы, как назвать папку варианта и что стадия делает с данными.

use std::{cmp::Ordering, collections::BTreeSet};

use rage_res::{style::is_style, texture::Format};

use crate::texture_levels::{codec_of, shrink, Codec, Level};

pub const GRAYSCALE: &str = "grayscale";

/// Список стадий из запроса: края без пробелов, ASCII в нижний регистр, повторы
/// схлопнуты, порядок «стиль, затем чёрно-белая». Неизвестная стадия важнее второго стиля.
pub fn normalize(stages: &[String]) -> Result<Vec<String>, String> {
    let mut grey = false;
    let mut styles = BTreeSet::new();
    for stage in stages.iter().map(|raw| raw.trim().to_ascii_lowercase()) {
        match stage.as_str() {
            GRAYSCALE => grey = true,
            _ if is_style(&stage) => {
                styles.insert(stage);
            }
            unknown => return Err(format!("Unknown texture stage: {unknown}")),
        }
    }
    if styles.len() > 1 {
        return Err("Only one world style can be applied at a time.".to_owned());
    }
    Ok(styles
        .into_iter()
        .chain(grey.then(|| GRAYSCALE.to_owned()))
        .collect())
}

/// Имя папки варианта: предел и стадии через `+`, как есть.
pub fn variant_key(cap: usize, stages: &[String]) -> String {
    let mut key = cap.to_string();
    for stage in stages {
        key += "+";
        key += stage;
    }
    key
}

const DIGITS: [char; 10] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/// Часть имени от последнего подчёркивания: целиком и словом без цифр справа.
struct Tail<'a> {
    whole: &'a str,
    word: &'a str,
}

impl<'a> Tail<'a> {
    fn of(lowercase: &'a str) -> Option<Tail<'a>> {
        let whole = &lowercase[lowercase.rfind('_')?..];
        let word = whole[1..].trim_end_matches(DIGITS);
        Some(Tail { whole, word })
    }

    /// Карта освещения: нормаль, блеск и подобное.
    fn is_lighting(&self) -> bool {
        matches!(
            self.whole,
            "_n" | "_nm"
                | "_nrm"
                | "_norm"
                | "_normal"
                | "_dn"
                | "_bump"
                | "_s"
                | "_sp"
                | "_spec"
                | "_specular"
        )
    }

    /// Маска или таблица, которую стиль не красит.
    fn is_mask(&self) -> bool {
        matches!(self.word, "ao" | "lightmap" | "mask" | "msk" | "ramp")
    }

    /// Упакованные данные: те же маски и ещё `gobo` с `h`.
    fn is_packed(&self) -> bool {
        self.is_mask() || matches!(self.word, "gobo" | "h")
    }
}

/// Красит ли стиль текстуру с таким именем и размером. Маски, палитры и узкие полосы он не трогает.
pub fn is_styled(name: &str, width: usize, height: usize) -> bool {
    let strip = 16 * height.max(1) <= width && height <= 8;
    let lower = name.to_ascii_lowercase();
    let masked = Tail::of(&lower).is_some_and(|tail| tail.is_mask());
    // `_pal_`, `_pal` на конце и `_lut` на конце: слово между подчёркиваниями.
    let pieces: Vec<&str> = lower.split('_').collect();
    let palette = lower.contains("palette")
        || pieces.iter().skip(1).any(|&piece| piece == "pal")
        || (pieces.len() > 1 && pieces.last() == Some(&"lut"));
    !(strip || masked || palette)
}

/// Фрагмент из `N` байт по смещению.
fn take<const N: usize>(bytes: &[u8], at: usize) -> [u8; N] {
    let mut out = [0u8; N];
    out.copy_from_slice(&bytes[at..at + N]);
    out
}

/// Поля RGB565: сдвиг, маска и на сколько битов расширяется до восьми.
const FIELDS565: [(u32, u32, u32); 3] = [(11, 31, 3), (5, 63, 2), (0, 31, 3)];

/// Цвет RGB565 и его серый двойник.
trait Rgb565: Copy {
    /// Три восьмибитных канала повтором старших битов.
    fn expand(self) -> [u32; 3];
    /// Серый цвет RGB565, ближайший по яркости.
    fn grey(self) -> u16;
    fn is_bluish(self) -> bool;
}

impl Rgb565 for u16 {
    fn expand(self) -> [u32; 3] {
        FIELDS565.map(|(shift, mask, up)| {
            let value = (u32::from(self) >> shift) & mask;
            (value << up) | (value >> (mask.count_ones() - up))
        })
    }

    fn grey(self) -> u16 {
        let y = u32::from(luma(self.expand()));
        let narrow = |top: u32| (y * top + 127) / 255;
        ((narrow(31) << 11) | (narrow(63) << 5) | narrow(31)) as u16
    }

    fn is_bluish(self) -> bool {
        let [r, g, b] = self.expand();
        b > 200 && r.abs_diff(128) < 50 && g.abs_diff(128) < 50
    }
}

/// Яркость в двойной точности: слагаемые складываются слева направо.
fn luma(rgb: [u32; 3]) -> u8 {
    let total = [0.2126f64, 0.7152, 0.0722]
        .iter()
        .zip(rgb)
        .fold(0.0f64, |sum, (weight, channel)| {
            sum + weight * f64::from(channel)
        });
    // Приведение к `u8` само обрезает результат до 0…255.
    total.round() as u8
}

/// Блоки DXT: размер блока и смещение его цветовой части.
#[derive(Clone, Copy)]
struct DxtLayout {
    size: usize,
    colors: usize,
}

const DXT_LAYOUTS: [(Format, DxtLayout); 3] = [
    (Format::Dxt1, DxtLayout { size: 8, colors: 0 }),
    (
        Format::Dxt3,
        DxtLayout {
            size: 16,
            colors: 8,
        },
    ),
    (
        Format::Dxt5,
        DxtLayout {
            size: 16,
            colors: 8,
        },
    ),
];

impl DxtLayout {
    fn of(format: Format) -> Option<DxtLayout> {
        DXT_LAYOUTS
            .into_iter()
            .find_map(|(known, layout)| (known == format).then_some(layout))
    }

    /// Карта нормалей ли это: голубых концов строго больше половины среди
    /// просмотренных (блоков смотрится не больше ~1024).
    fn resembles_normals(&self, data: &[u8]) -> bool {
        let step = (data.len() / self.size / 1024).max(1);
        let ends: Vec<u16> = data
            .chunks_exact(self.size)
            .step_by(step)
            .flat_map(|block| {
                (0..2).map(move |i| u16::from_le_bytes(take(block, self.colors + 2 * i)))
            })
            .collect();
        let bluish: usize = ends.iter().map(|end| usize::from(end.is_bluish())).sum();
        bluish * 2 > ends.len()
    }

    /// Переписывает цветовую часть каждого блока в серых тонах; `true`, если что-то изменилось.
    fn grey_all(&self, data: &mut [u8], transparent_possible: bool) -> bool {
        data.chunks_exact_mut(self.size)
            .fold(false, |changed, block| {
                let colors = &mut block[self.colors..self.colors + 8];
                let before = Palette::from(take::<8>(colors, 0));
                let after = before.greyed(transparent_possible);
                let differs = after != before;
                if differs {
                    colors.copy_from_slice(&<[u8; 8]>::from(&after));
                }
                changed | differs
            })
    }
}

/// Цветовая часть блока DXT: два конца и 32 бита индексов.
#[derive(PartialEq)]
struct Palette {
    ends: [u16; 2],
    picks: u32,
}

impl Eq for Palette {}

/// Младшие биты всех двухбитных индексов.
const LOW_BITS: u32 = 0x5555_5555;

impl From<[u8; 8]> for Palette {
    fn from(raw: [u8; 8]) -> Palette {
        Palette {
            ends: [
                u16::from_le_bytes(take(&raw, 0)),
                u16::from_le_bytes(take(&raw, 2)),
            ],
            picks: u32::from_le_bytes(take(&raw, 4)),
        }
    }
}

impl From<&Palette> for [u8; 8] {
    fn from(palette: &Palette) -> [u8; 8] {
        let mut raw = [0u8; 8];
        raw[..2].copy_from_slice(&palette.ends[0].to_le_bytes());
        raw[2..4].copy_from_slice(&palette.ends[1].to_le_bytes());
        raw[4..].copy_from_slice(&palette.picks.to_le_bytes());
        raw
    }
}

impl Palette {
    /// Тот же блок в серых тонах. Если после перекраски светлее оказался не тот
    /// конец, концы меняются местами, а индексы переписываются под новый порядок.
    fn greyed(&self, can_be_transparent: bool) -> Palette {
        let [g0, g1] = self.ends.map(Rgb565::grey);
        let picks = self.picks;
        let three_colors = can_be_transparent && self.ends[0] <= self.ends[1];
        let (ends, picks) = match (three_colors, g0.cmp(&g1)) {
            // индексы 0 и 1 меняются местами, 2 и 3 остаются
            (true, Ordering::Greater) => ([g1, g0], picks ^ (!(picks >> 1) & LOW_BITS)),
            (true, _) => ([g0, g1], picks),
            (false, Ordering::Less) => ([g1, g0], picks ^ LOW_BITS),
            (false, Ordering::Equal) => ([g0, g1], 0),
            (false, Ordering::Greater) => ([g0, g1], picks),
        };
        Palette { ends, picks }
    }
}

/// Серые точки несжатых пикселей по четыре байта; четвёртый байт остаётся как был.
trait GreyPixels {
    /// `order` — номера байтов красного, зелёного и синего в пикселе.
    fn grey_pixels(&mut self, order: [usize; 3]) -> bool;
}

impl GreyPixels for [u8] {
    fn grey_pixels(&mut self, order: [usize; 3]) -> bool {
        self.chunks_exact_mut(4).fold(false, |changed, pixel| {
            let y = luma(order.map(|at| u32::from(pixel[at])));
            let differs = pixel[..3].iter().any(|&channel| channel != y);
            pixel[..3].fill(y);
            changed | differs
        })
    }
}

/// Пиксели RGBA подряд.
type Pixels = Vec<u8>;

/// Кадр RGBA и его размер.
struct Frame {
    rgba: Pixels,
    side: (usize, usize),
}

/// Одна ступень цепочки в данных: номер, где лежит, размер и сколько байт занимает.
struct Rung {
    index: usize,
    at: usize,
    side: (usize, usize),
    need: usize,
}

/// Форматы, в которых есть что красить.
const COLOR_FORMATS: [Format; 4] = [
    Format::Bc7,
    Format::A8R8G8B8,
    Format::X8R8G8B8,
    Format::A8B8G8R8,
];

/// Перекраска текстуры на месте.
trait Repaint {
    fn carries_color(&self) -> bool;
    fn rungs(&self, codec: Codec) -> Vec<Rung>;
    fn repaint(&mut self, paint: impl FnMut(&Rung, &[u8]) -> Option<Pixels>) -> bool;
    fn paint_world(&mut self, stage: &str) -> bool;
    fn paint_grey(&mut self) -> bool;
}

impl Repaint for Level {
    /// Несёт ли текстура цвет, который имеет смысл менять.
    fn carries_color(&self) -> bool {
        let lower = self.name.to_ascii_lowercase();
        let plain_name =
            !Tail::of(&lower).is_some_and(|tail| tail.is_lighting() || tail.is_packed());
        let format_fits = match DxtLayout::of(self.format) {
            Some(layout) => !layout.resembles_normals(&self.data),
            None => COLOR_FORMATS.contains(&self.format),
        };
        self.depth <= 1 && !self.data.is_empty() && plain_name && format_fits
    }

    /// Ступени подряд, пока не кончились данные или ступени. Сторона ступени:
    /// деление на два в степени номера, не меньше единицы, вверх до кратной наименьшей.
    fn rungs(&self, codec: Codec) -> Vec<Rung> {
        let side_of = |full: usize, index: usize| {
            let halved = u32::try_from(index)
                .map_or(0, |shift| full.checked_shr(shift).unwrap_or(0))
                .max(1);
            halved + (codec.min - halved % codec.min) % codec.min
        };
        (0..self.levels)
            .scan(0usize, |at, index| {
                if *at >= self.data.len() {
                    return None;
                }
                let side = (side_of(self.width, index), side_of(self.height, index));
                let need = codec.bytes(side.0, side.1);
                let rung = Rung {
                    index,
                    at: *at,
                    side,
                    need,
                };
                *at += need;
                Some(rung)
            })
            .collect()
    }

    /// Перекраска через RGBA, ступень за ступенью. `paint` получает ступень и её
    /// разжатые пиксели, а возвращает новые. Если ступень не уместилась в данные
    /// целиком, вместо неё берётся уменьшенная предыдущая. Текстура меняется только
    /// при полном успехе, и тогда ответ `true`.
    fn repaint(&mut self, mut paint: impl FnMut(&Rung, &[u8]) -> Option<Pixels>) -> bool {
        let rewritten = codec_of(self.format).and_then(|codec| {
            let (out, last) = self.rungs(codec).iter().try_fold(
                (self.data.clone(), None::<Frame>),
                |(mut out, above), rung| {
                    let room = out.len() - rung.at;
                    let source = if rung.need <= room {
                        codec
                            .decode(
                                &self.data[rung.at..rung.at + rung.need],
                                rung.side.0,
                                rung.side.1,
                            )
                            .ok()?
                    } else {
                        let up = above.as_ref()?;
                        shrink(&up.rgba, up.side.0, up.side.1, rung.side.0, rung.side.1)
                    };
                    let packed = codec
                        .encode(&paint(rung, &source)?, rung.side.0, rung.side.1)
                        .ok()?;
                    let part = packed.len().min(room);
                    out[rung.at..][..part].copy_from_slice(&packed[..part]);
                    Some((
                        out,
                        Some(Frame {
                            rgba: source,
                            side: rung.side,
                        }),
                    ))
                },
            )?;
            last.map(|_| (codec.output, out))
        });
        match rewritten {
            Some((format, data)) => {
                self.format = format;
                self.data = data;
                true
            }
            None => false,
        }
    }

    /// Стиль мира: красится верхняя ступень, нижние получаются из неё уменьшением,
    /// но свою прозрачность каждая сохраняет.
    fn paint_world(&mut self, stage: &str) -> bool {
        let eligible = self.carries_color() && is_styled(&self.name, self.width, self.height);
        let mut top: Option<Frame> = None;
        eligible
            && self.repaint(|rung, original| match (rung.index, &top) {
                (0, _) => {
                    let mut frame = original.to_vec();
                    rage_res::style::style(&mut frame, rung.side.0, rung.side.1, stage, None)
                        .ok()?;
                    top = Some(Frame {
                        rgba: frame.clone(),
                        side: rung.side,
                    });
                    Some(frame)
                }
                (_, Some(base)) => {
                    let (base_w, base_h) = base.side;
                    let mut smaller = shrink(&base.rgba, base_w, base_h, rung.side.0, rung.side.1);
                    let own_alpha = original.iter().skip(3).step_by(4);
                    let mine = smaller.iter_mut().skip(3).step_by(4);
                    mine.zip(own_alpha).for_each(|(slot, alpha)| *slot = *alpha);
                    Some(smaller)
                }
                _ => None,
            })
    }

    fn paint_grey(&mut self) -> bool {
        self.carries_color()
            && match (self.format, DxtLayout::of(self.format)) {
                (_, Some(layout)) => layout.grey_all(&mut self.data, self.format == Format::Dxt1),
                (Format::A8R8G8B8 | Format::X8R8G8B8, _) => self.data.grey_pixels([2, 1, 0]),
                (Format::A8B8G8R8, _) => self.data.grey_pixels([0, 1, 2]),
                (Format::Bc7, _) => self.repaint(|_, rgba| {
                    let pixels = rgba.chunks_exact(4).flat_map(|p| {
                        let y = luma([p[0], p[1], p[2]].map(u32::from));
                        [y, y, y, p[3]]
                    });
                    Some(pixels.collect())
                }),
                _ => false,
            }
    }
}

/// Применяет стадию к текстуре на месте. Имя стадии сравнивается точно; `true` —
/// текстура обработана (для стиля и BC7 это не обязательно значит «байты изменились»).
pub fn apply(level: &mut Level, stage: &str) -> bool {
    match stage {
        GRAYSCALE => level.paint_grey(),
        named if is_style(named) => level.paint_world(named),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::texture_levels::Codec;
    use sha2::{Digest, Sha256};

    type Pattern = fn(usize, usize) -> Vec<u8>;

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn unhex(text: &str) -> Vec<u8> {
        text.split_whitespace()
            .map(|part| u8::from_str_radix(part, 16).unwrap())
            .collect()
    }

    fn assert_data(data: &[u8], digest: &str, head: &str) {
        assert_eq!(sha(data), digest);
        let count = head.split_whitespace().count();
        assert_eq!(hex(&data[..count]), head);
    }

    fn texts(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    fn pattern(w: usize, h: usize) -> Vec<u8> {
        let mut out = Vec::new();
        for y in 0..h {
            for x in 0..w {
                out.extend([
                    (x * 255 / w) as u8,
                    (y * 255 / h) as u8,
                    ((7 * x + 13 * y) % 256) as u8,
                    255,
                ]);
            }
        }
        out
    }

    fn pattern_alpha(w: usize, h: usize) -> Vec<u8> {
        let mut out = pattern(w, h);
        for y in 0..h {
            for x in 0..w {
                out[(y * w + x) * 4 + 3] = ((31 * x + 17 * y) % 256) as u8;
            }
        }
        out
    }

    /// Вырез: цвет как у `P`, видима (альфа 255) каждая третья точка, остальные прозрачны.
    fn pattern_cut(w: usize, h: usize) -> Vec<u8> {
        let mut out = pattern(w, h);
        for y in 0..h {
            for x in 0..w {
                out[(y * w + x) * 4 + 3] = if (y * w + x) % 3 == 0 { 255 } else { 0 };
            }
        }
        out
    }

    fn seq(n: usize) -> Vec<u8> {
        (0..n).map(|i| ((37 * i + 11) % 256) as u8).collect()
    }

    fn codec(format: Format) -> Codec {
        codec_of(format).unwrap()
    }

    fn chain(format: Format, w: usize, h: usize, levels: usize, draw: Pattern) -> Vec<u8> {
        let step = codec(format).min;
        (0..levels)
            .flat_map(|i| {
                let lw = (w >> i).max(1).next_multiple_of(step);
                let lh = (h >> i).max(1).next_multiple_of(step);
                codec(format).encode(&draw(lw, lh), lw, lh).unwrap()
            })
            .collect()
    }

    fn level(
        name: &str,
        format: Format,
        w: usize,
        h: usize,
        levels: usize,
        data: Vec<u8>,
    ) -> Level {
        Level {
            name: name.to_owned(),
            format,
            width: w,
            height: h,
            stride: 0,
            levels,
            depth: 1,
            data,
        }
    }

    /// Плоская текстура 4×4 с заданными байтами.
    fn raw(format: Format, data: &str) -> Level {
        level("t", format, 4, 4, 1, unhex(data))
    }

    /// Применяет стадию и проверяет ответ, формат и байты.
    fn expect_apply(mut subject: Level, stage: &str, done: bool, format: Format, bytes: &str) {
        assert_eq!(apply(&mut subject, stage), done, "{stage}");
        assert_eq!(subject.format, format, "{stage}");
        assert_eq!(hex(&subject.data), bytes, "{stage}");
    }

    #[test]
    fn stage_lists_are_trimmed_lowercased_and_ordered() {
        // Нм1 – Нм44
        let ok = |input: &[&str], want: &[&str]| {
            assert_eq!(normalize(&texts(input)), Ok(texts(want)), "{input:?}");
        };
        let err = |input: &[&str], message: &str| {
            assert_eq!(
                normalize(&texts(input)),
                Err(message.to_owned()),
                "{input:?}"
            );
        };
        let two = "Only one world style can be applied at a time.";
        ok(&[], &[]);
        ok(&["grayscale"], &["grayscale"]);
        ok(&["GRAYSCALE"], &["grayscale"]);
        ok(&["Grayscale"], &["grayscale"]);
        ok(&["  grayscale\t"], &["grayscale"]);
        ok(&["\u{a0}grayscale\u{a0}"], &["grayscale"]);
        ok(&["\u{2003}grayscale"], &["grayscale"]);
        err(
            &["\u{200b}grayscale"],
            "Unknown texture stage: \u{200b}grayscale",
        );
        err(&["grayscale\0"], "Unknown texture stage: grayscale\0");
        for style in [
            "style-painted",
            "style-comic",
            "style-watercolor",
            "style-retro",
        ] {
            ok(&[style], &[style]);
        }
        ok(&["STYLE-COMIC"], &["style-comic"]);
        ok(&["  Style-Cartoon "], &["style-cartoon"]);
        ok(&["grayscale", "style-comic"], &["style-comic", "grayscale"]);
        ok(&["style-comic", "grayscale"], &["style-comic", "grayscale"]);
        ok(&["grayscale", "grayscale", "grayscale"], &["grayscale"]);
        ok(&["style-comic", "style-comic"], &["style-comic"]);
        ok(
            &["style-comic", "STYLE-COMIC", " style-comic "],
            &["style-comic"],
        );
        ok(
            &["grayscale", "style-retro", "grayscale", "style-retro"],
            &["style-retro", "grayscale"],
        );
        ok(
            &["style-comic", "grayscale", "style-comic"],
            &["style-comic", "grayscale"],
        );
        err(&["style-comic", "style-retro"], two);
        err(&["style-retro", "style-comic"], two);
        err(&["grayscale", "style-painted", "style-comic"], two);
        err(&["comic"], "Unknown texture stage: comic");
        err(&["bogus"], "Unknown texture stage: bogus");
        err(&["  BoGuS "], "Unknown texture stage: bogus");
        err(&[""], "Unknown texture stage: ");
        err(&["   "], "Unknown texture stage: ");
        err(&["style-"], "Unknown texture stage: style-");
        err(&["style"], "Unknown texture stage: style");
        err(
            &["style-comic ", "style-comic\u{200b}"],
            "Unknown texture stage: style-comic\u{200b}",
        );
        err(&["grayscale", "bogus"], "Unknown texture stage: bogus");
        err(&["bogus", "grayscale"], "Unknown texture stage: bogus");
        err(
            &["style-comic", "style-retro", "bogus"],
            "Unknown texture stage: bogus",
        );
        err(
            &["bogus", "style-comic", "style-retro"],
            "Unknown texture stage: bogus",
        );
        err(
            &["style-comic", "bogus", "style-retro"],
            "Unknown texture stage: bogus",
        );
        err(
            &["style-comic", "style-retro", ""],
            "Unknown texture stage: ",
        );
        err(
            &["\u{421}TYLE-COMIC"],
            "Unknown texture stage: \u{421}tyle-comic",
        );
        err(
            &["Style-C\u{f6}mic"],
            "Unknown texture stage: style-c\u{f6}mic",
        );
        ok(&["GRAYSCALE", "grayscale", "Grayscale"], &["grayscale"]);
        err(&["grayscale-"], "Unknown texture stage: grayscale-");
        let thousand = vec!["grayscale".to_owned(); 1000];
        assert_eq!(normalize(&thousand), Ok(texts(&["grayscale"])));
    }

    #[test]
    fn variant_names_join_the_cap_and_stages() {
        // Кл1 – Кл12
        let key = |cap: usize, stages: &[&str]| variant_key(cap, &texts(stages));
        assert_eq!(key(128, &[]), "128");
        assert_eq!(key(128, &["grayscale"]), "128+grayscale");
        assert_eq!(
            key(128, &["style-comic", "grayscale"]),
            "128+style-comic+grayscale"
        );
        assert_eq!(key(0, &[]), "0");
        assert_eq!(key(0, &["grayscale"]), "0+grayscale");
        assert_eq!(key(4096, &["style-retro"]), "4096+style-retro");
        assert_eq!(
            key(usize::MAX, &["grayscale"]),
            format!("{}+grayscale", usize::MAX)
        );
        assert_eq!(key(16, &["", "x"]), "16++x");
        assert_eq!(key(16, &["a+b", "c"]), "16+a+b+c");
        assert_eq!(
            key(16, &["Grayscale", " grayscale "]),
            "16+Grayscale+ grayscale "
        );
        assert_eq!(
            key(16, &["grayscale", "grayscale"]),
            "16+grayscale+grayscale"
        );
        assert_eq!(key(7, &[""]), "7+");
    }

    #[test]
    fn styles_skip_masks_palettes_and_strips() {
        // Ок1 – Ок51
        let rows: [(&str, usize, usize, bool); 51] = [
            ("wall", 256, 256, true),
            ("Wall", 256, 256, true),
            ("", 256, 256, true),
            ("wall_mask", 256, 256, false),
            ("wall_MASK", 256, 256, false),
            ("wall_mask2", 256, 256, false),
            ("wall_mask12", 256, 256, false),
            ("wall_mask_01", 256, 256, true),
            ("wall_mask_a", 256, 256, true),
            ("wall_masks", 256, 256, true),
            ("mask", 256, 256, true),
            ("mask2", 256, 256, true),
            ("_mask", 256, 256, false),
            ("wall_msk", 256, 256, false),
            ("wall_ao", 256, 256, false),
            ("wall_ao3", 256, 256, false),
            ("wall_lightmap", 256, 256, false),
            ("wall_ramp", 256, 256, false),
            ("wall_ramp1", 256, 256, false),
            ("wall_h", 256, 256, true),
            ("wall_n", 256, 256, true),
            ("wall_s", 256, 256, true),
            ("wall_pal", 256, 256, false),
            ("wall_PAL", 256, 256, false),
            ("wall_pal_a", 256, 256, false),
            ("wall_pals", 256, 256, true),
            ("pal_wall", 256, 256, true),
            ("wall_pal2", 256, 256, true),
            ("wall_lut", 256, 256, false),
            ("wall_lut2", 256, 256, true),
            ("lut", 256, 256, true),
            ("wall_lut_a", 256, 256, true),
            ("tintpalette", 256, 256, false),
            ("palette", 256, 256, false),
            ("my_Palette_1", 256, 256, false),
            ("wall", 256, 8, false),
            ("wall", 128, 8, false),
            ("wall", 127, 8, true),
            ("wall", 16, 1, false),
            ("wall", 15, 1, true),
            ("wall", 32, 2, false),
            ("wall", 31, 2, true),
            ("wall", 128, 9, true),
            ("wall", 1024, 9, true),
            ("wall", 256, 0, false),
            ("wall", 0, 0, true),
            ("wall", 8, 8, true),
            ("wall", 1, 1, true),
            ("wall", 4096, 4, false),
            ("wall", 64, 4, false),
            ("wall", 63, 4, true),
        ];
        for (name, w, h, want) in rows {
            assert_eq!(is_styled(name, w, h), want, "{name} {w}x{h}");
        }
    }

    #[test]
    fn names_decide_which_textures_carry_colour() {
        // Им1 – Им63: (имя, красит ЧБ, красит стиль)
        let rows: [(&str, bool, bool); 63] = [
            ("wall", true, true),
            ("Wall", true, true),
            ("", true, true),
            ("_", true, true),
            ("n", true, true),
            ("wall_n", false, false),
            ("wall_N", false, false),
            ("wall_nm", false, false),
            ("wall_nrm", false, false),
            ("wall_norm", false, false),
            ("wall_normal", false, false),
            ("wall_dn", false, false),
            ("wall_bump", false, false),
            ("wall_s", false, false),
            ("wall_sp", false, false),
            ("wall_spec", false, false),
            ("wall_specular", false, false),
            ("wall_n1", true, true),
            ("wall_ns", true, true),
            ("wall_normals", true, true),
            ("wall_spec2", true, true),
            ("wall_s_dif", true, true),
            ("wall_n_dif", true, true),
            ("normal", true, true),
            ("spec", true, true),
            ("bump", true, true),
            ("wall_nor", true, true),
            ("wall_bumpmap", true, true),
            ("wall_dif_n", false, false),
            ("wall n", true, true),
            ("wall-n", true, true),
            ("wall_n ", true, true),
            (" wall_n", false, false),
            ("_n", false, false),
            ("_s", false, false),
            ("wall_h", false, false),
            ("wall_H", false, false),
            ("wall_h2", false, false),
            ("wall_h12", false, false),
            ("wall_hh", true, true),
            ("hall", true, true),
            ("h", true, true),
            ("wall_gobo", false, false),
            ("wall_gobo3", false, false),
            ("wall_gobo12", false, false),
            ("wall_mask", false, false),
            ("wall_mask7", false, false),
            ("wall_msk", false, false),
            ("wall_ao", false, false),
            ("wall_lightmap", false, false),
            ("wall_lightmap2", false, false),
            ("wall_ramp", false, false),
            ("wall_ramp9", false, false),
            ("wall_MASK3", false, false),
            ("wall_mask_01", true, true),
            ("wall_mask_", true, true),
            ("mask", true, true),
            ("wall_ao_", true, true),
            ("ao_wall", true, true),
            ("wall_pal", true, false),
            ("wall_lut", true, false),
            ("palette", true, false),
            ("wall_d", true, true),
        ];
        let data = chain(Format::A8R8G8B8, 4, 4, 1, pattern);
        for (name, grey, painted) in rows {
            let mut one = level(name, Format::A8R8G8B8, 4, 4, 1, data.clone());
            assert_eq!(apply(&mut one, GRAYSCALE), grey, "grayscale {name:?}");
            let mut two = level(name, Format::A8R8G8B8, 4, 4, 1, data.clone());
            assert_eq!(apply(&mut two, "style-painted"), painted, "style {name:?}");
        }
    }

    #[test]
    fn only_colour_formats_are_repainted() {
        // Фм1 – Фм11
        let rows = [
            (Format::Dxt1, true, Format::Dxt1),
            (Format::Dxt3, true, Format::Dxt3),
            (Format::Dxt5, true, Format::Dxt5),
            (Format::Ati1, false, Format::Ati1),
            (Format::Ati2, false, Format::Ati2),
            (Format::Bc7, true, Format::Dxt5),
            (Format::A8R8G8B8, true, Format::A8R8G8B8),
            (Format::X8R8G8B8, true, Format::X8R8G8B8),
            (Format::A8, false, Format::A8),
            (Format::A8B8G8R8, true, Format::A8B8G8R8),
            (Format::L8, false, Format::L8),
        ];
        for (format, repainted, after) in rows {
            for stage in [GRAYSCALE, "style-painted"] {
                let data = if format == Format::Bc7 {
                    seq(16)
                } else {
                    chain(format, 4, 4, 1, pattern)
                };
                let mut subject = level("t", format, 4, 4, 1, data.clone());
                assert_eq!(apply(&mut subject, stage), repainted, "{format:?} {stage}");
                assert_eq!(subject.format, after, "{format:?} {stage}");
                assert_eq!(subject.data != data, repainted, "{format:?} {stage}");
            }
        }
    }

    #[test]
    fn unfit_textures_and_unknown_stages_stay_untouched() {
        // Ат1 – Ат14
        let data = chain(Format::A8R8G8B8, 4, 4, 1, pattern);
        assert_data(
            &data,
            "bec73119239a57c3623d97515360c26fea56ee386efd0f2d58cba72c77cd29f9",
            "00 00 00 ff 07 00 3f ff 0e 00 7f ff 15 00 bf ff",
        );
        let plain = || level("t", Format::A8R8G8B8, 4, 4, 1, data.clone());
        for stage in [GRAYSCALE, "style-painted"] {
            let mut deep = Level {
                depth: 2,
                ..plain()
            };
            assert!(!apply(&mut deep, stage), "{stage}");
            assert_eq!(deep.data, data);
            let mut empty = level("t", Format::A8R8G8B8, 4, 4, 1, Vec::new());
            assert!(!apply(&mut empty, stage), "{stage}");
            assert!(empty.data.is_empty());
        }
        for stage in [
            "Grayscale",
            "GRAYSCALE",
            " grayscale",
            "gray",
            "style-nope",
            "style-Painted",
            "",
            "style-painted ",
        ] {
            let mut subject = plain();
            assert!(!apply(&mut subject, stage), "{stage:?}");
            assert_eq!(subject, plain());
        }
        let mut no_levels = Level {
            levels: 0,
            ..plain()
        };
        assert!(!apply(&mut no_levels, "style-painted"));
        assert_eq!(no_levels.data, data);
        // чёрно-белая стадия число ступеней не читает
        let mut grey = Level {
            levels: 0,
            ..plain()
        };
        assert!(apply(&mut grey, GRAYSCALE));
        assert_data(
            &grey.data,
            "9072ef4971ca42cb9487d094076ab3f304d38879f26116c62dbf6576a922b074",
            "00 00 00 ff 0e 0e 0e ff 1c 1c 1c ff 2a 2a 2a ff",
        );
    }

    /// Блок DXT1 из двух концов и нулевых индексов.
    fn ends(a: u16, b: u16) -> Vec<u8> {
        [a.to_le_bytes(), b.to_le_bytes(), [0; 2], [0; 2]].concat()
    }

    fn dxt1_blocks(blocks: &[Vec<u8>]) -> Vec<u8> {
        blocks.concat()
    }

    #[test]
    fn normal_maps_are_recognised_by_their_blocks() {
        // Нр1 – Нр23
        let (n, k) = (0x841F, 0xF800);
        let grey_run = |w: usize, blocks: Vec<Vec<u8>>| {
            let mut subject = level("t", Format::Dxt1, w, 4, 1, dxt1_blocks(&blocks));
            let before = subject.data.clone();
            let done = apply(&mut subject, GRAYSCALE);
            (done, before, subject.data)
        };
        let (done, before, after) = grey_run(4, vec![ends(n, n)]);
        assert!(!done && before == after);
        let (done, _, after) = grey_run(4, vec![ends(n, k)]);
        assert!(done);
        assert_eq!(hex(&after), "a7 39 51 8c 55 55 55 55");
        let (done, before, after) = grey_run(8, vec![ends(n, n), ends(n, k)]);
        assert!(!done && before == after);
        let (done, _, after) = grey_run(8, vec![ends(n, n), ends(k, k)]);
        assert!(done);
        assert_eq!(
            hex(&after),
            "51 8c 51 8c 00 00 00 00 a7 39 a7 39 00 00 00 00"
        );
        let (done, _, after) = grey_run(12, vec![ends(n, n), ends(n, k), ends(k, k)]);
        assert!(done);
        assert_eq!(
            hex(&after),
            "51 8c 51 8c 00 00 00 00 a7 39 51 8c 55 55 55 55 a7 39 a7 39 00 00 00 00"
        );
        let (done, before, after) = grey_run(12, vec![ends(n, n), ends(n, n), ends(n, k)]);
        assert!(!done && before == after);

        // границы «голубого»
        let edges: [(u16, bool, &str); 11] = [
            (0x841F, false, ""),
            (0x8419, false, ""),
            (0x8418, true, "30 84 30 84 00 00 00 00"),
            (0x541F, false, ""),
            (0x4C1F, true, "ef 7b ef 7b 00 00 00 00"),
            (0xAC1F, false, ""),
            (0xB41F, true, "b2 94 b2 94 00 00 00 00"),
            (0x829F, false, ""),
            (0x827F, true, "2c 63 2c 63 00 00 00 00"),
            (0x857F, false, ""),
            (0x859F, true, "75 ad 75 ad 00 00 00 00"),
        ];
        for (color, repainted, bytes) in edges {
            let (done, before, after) = grey_run(4, vec![ends(color, color)]);
            assert_eq!(done, repainted, "{color:#06x}");
            if repainted {
                assert_eq!(hex(&after), bytes, "{color:#06x}");
            } else {
                assert_eq!(before, after, "{color:#06x}");
            }
        }

        // выборка с шагом: смотрятся блоки 0, 4, 8, …
        let sampled_normal: Vec<Vec<u8>> = (0..4096)
            .map(|i| if i % 4 == 0 { ends(n, n) } else { ends(k, k) })
            .collect();
        let (done, before, after) = {
            let mut subject = level("t", Format::Dxt1, 256, 256, 1, dxt1_blocks(&sampled_normal));
            let before = subject.data.clone();
            (apply(&mut subject, GRAYSCALE), before, subject.data)
        };
        assert!(!done && before == after);
        let unseen_normal: Vec<Vec<u8>> = (0..4096)
            .map(|i| if i % 4 == 0 { ends(k, k) } else { ends(n, n) })
            .collect();
        let mut subject = level("t", Format::Dxt1, 256, 256, 1, dxt1_blocks(&unseen_normal));
        assert!(apply(&mut subject, GRAYSCALE));
        assert_data(
            &subject.data,
            "1a796ad8d652f0afac37555b27441cc9175f4181da059d1e28b4eec3e0e936c4",
            "a7 39 a7 39 00 00 00 00 51 8c 51 8c 00 00 00 00",
        );
        assert_eq!(subject.data.len(), 32768);

        // все ступени сразу против одной верхней
        let mut top: Vec<Vec<u8>> = (0..16)
            .map(|i| if i < 7 { ends(n, n) } else { ends(k, k) })
            .collect();
        let mut with_tail = top.clone();
        with_tail.extend((0..5).map(|_| ends(n, n)));
        let (done, before, after) = grey_run_sized(16, 16, 3, with_tail);
        assert!(!done && before == after);
        let (done, _, after) = grey_run_sized(16, 16, 1, std::mem::take(&mut top));
        assert!(done);
        assert_data(
            &after,
            "1b3d21813144ef765ce00dbecbd529f521ebada45574b9323d61c015003ef921",
            "51 8c 51 8c 00 00 00 00 51 8c 51 8c 00 00 00 00",
        );
        assert_eq!(after.len(), 128);

        // DXT5: смотрится цвет со смещения 8
        let alpha = |first: u16| -> Vec<u8> {
            [first.to_le_bytes(), first.to_le_bytes()]
                .concat()
                .into_iter()
                .chain([0u8; 4])
                .collect()
        };
        let both = [vec![0xff, 0, 0, 0, 0, 0, 0, 0], ends(n, n)].concat();
        let mut flat = level("t", Format::Dxt5, 4, 4, 1, both.clone());
        assert!(!apply(&mut flat, GRAYSCALE));
        assert_eq!(flat.data, both);
        let tricky = [alpha(0x841F), ends(k, k)].concat();
        let mut picked = level("t", Format::Dxt5, 4, 4, 1, tricky);
        assert!(apply(&mut picked, GRAYSCALE));
        assert_eq!(
            hex(&picked.data),
            "1f 84 1f 84 00 00 00 00 a7 39 a7 39 00 00 00 00"
        );
    }

    fn grey_run_sized(
        w: usize,
        h: usize,
        levels: usize,
        blocks: Vec<Vec<u8>>,
    ) -> (bool, Vec<u8>, Vec<u8>) {
        let mut subject = level("t", Format::Dxt1, w, h, levels, dxt1_blocks(&blocks));
        let before = subject.data.clone();
        let done = apply(&mut subject, GRAYSCALE);
        (done, before, subject.data)
    }

    #[test]
    fn grey_dxt1_blocks_keep_their_order_rules() {
        // Дк1 – Дк20
        let rows: [(&str, &str, bool); 16] = [
            ("00 f8 1f 00 00 00 00 00", "a7 39 82 10 00 00 00 00", true),
            ("00 f8 1f 00 e4 e4 e4 e4", "a7 39 82 10 e4 e4 e4 e4", true),
            ("1f 00 00 f8 e4 e4 e4 e4", "82 10 a7 39 e4 e4 e4 e4", true),
            ("1f 08 e0 07 e4 e4 e4 e4", "b6 b5 a2 10 b1 b1 b1 b1", true),
            ("00 f8 00 f8 e4 e4 e4 e4", "a7 39 a7 39 e4 e4 e4 e4", true),
            ("21 00 20 00 e4 e4 e4 e4", "20 00 20 00 00 00 00 00", true),
            ("e0 07 00 f8 e4 e4 e4 e4", "a7 39 b6 b5 e1 e1 e1 e1", true),
            ("e0 07 00 f8 aa aa aa aa", "a7 39 b6 b5 aa aa aa aa", true),
            ("e0 07 00 f8 ff ff ff ff", "a7 39 b6 b5 ff ff ff ff", true),
            ("00 00 01 00 e4 e4 e4 e4", "00 00 00 00 e4 e4 e4 e4", true),
            ("a7 39 82 10 e4 e4 e4 e4", "a6 31 82 10 e4 e4 e4 e4", true),
            ("82 10 a7 39 e4 e4 e4 e4", "82 10 a6 31 e4 e4 e4 e4", true),
            ("10 84 00 00 e4 e4 e4 e4", "10 84 00 00 e4 e4 e4 e4", false),
            ("ff ff 00 00 e4 e4 e4 e4", "ff ff 00 00 e4 e4 e4 e4", false),
            ("00 00 ff ff e4 e4 e4 e4", "00 00 ff ff e4 e4 e4 e4", false),
            (
                "00 f8 1f 00 00 00 00 00 aa",
                "a7 39 82 10 00 00 00 00 aa",
                true,
            ),
        ];
        for (input, output, done) in rows {
            expect_apply(
                raw(Format::Dxt1, input),
                GRAYSCALE,
                done,
                Format::Dxt1,
                output,
            );
        }
        expect_apply(
            level(
                "t",
                Format::Dxt1,
                8,
                4,
                1,
                unhex("00 f8 1f 00 1b 1b 1b 1b e0 07 00 f8 1b 1b 1b 1b"),
            ),
            GRAYSCALE,
            true,
            Format::Dxt1,
            "a7 39 82 10 1b 1b 1b 1b a7 39 b6 b5 4b 4b 4b 4b",
        );
        expect_apply(
            raw(Format::Dxt1, "f8 00 1f 00 00 00 00"),
            GRAYSCALE,
            false,
            Format::Dxt1,
            "f8 00 1f 00 00 00 00",
        );
        let two_levels = "00 f8 1f 00 00 00 00 00 1f 00 00 f8 00 00 00 00 e0 07 00 f8 00 00 00 00 00 f8 e0 07 00 00 00 00 10 84 00 00 00 00 00 00";
        for levels in [2, 1] {
            let mut subject = level("t", Format::Dxt1, 8, 8, levels, unhex(two_levels));
            assert!(apply(&mut subject, GRAYSCALE));
            assert_data(
                &subject.data,
                "5405fd76dc345c8ee3962a12dbfa2abb175b2827626d7a9b4f8c27adf12c41d4",
                "a7 39 82 10 00 00 00 00 82 10 a7 39 00 00 00 00",
            );
        }
    }

    #[test]
    fn grey_dxt3_and_dxt5_always_use_four_colours() {
        // Дц1 – Дц9
        let alpha = "10 32 54 76 98 ba dc fe";
        let rows: [(Format, &str, &str, bool); 8] = [
            (
                Format::Dxt5,
                "00 f8 1f 00 e4 e4 e4 e4",
                "a7 39 82 10 e4 e4 e4 e4",
                true,
            ),
            (
                Format::Dxt5,
                "1f 00 00 f8 e4 e4 e4 e4",
                "a7 39 82 10 b1 b1 b1 b1",
                true,
            ),
            (
                Format::Dxt3,
                "1f 00 00 f8 e4 e4 e4 e4",
                "a7 39 82 10 b1 b1 b1 b1",
                true,
            ),
            (
                Format::Dxt5,
                "21 00 20 00 e4 e4 e4 e4",
                "20 00 20 00 00 00 00 00",
                true,
            ),
            (
                Format::Dxt5,
                "00 f8 00 f8 e4 e4 e4 e4",
                "a7 39 a7 39 00 00 00 00",
                true,
            ),
            (
                Format::Dxt3,
                "00 f8 1f 00 1b 1b 1b 1b",
                "a7 39 82 10 1b 1b 1b 1b",
                true,
            ),
            (
                Format::Dxt5,
                "a7 39 82 10 e4 e4 e4 e4",
                "a6 31 82 10 e4 e4 e4 e4",
                true,
            ),
            (
                Format::Dxt5,
                "10 84 00 00 e4 e4 e4 e4",
                "10 84 00 00 e4 e4 e4 e4",
                false,
            ),
        ];
        for (format, colors, want, done) in rows {
            expect_apply(
                raw(format, &format!("{alpha} {colors}")),
                GRAYSCALE,
                done,
                format,
                &format!("{alpha} {want}"),
            );
        }
        expect_apply(
            raw(Format::Dxt1, "1f 00 00 f8 e4 e4 e4 e4"),
            GRAYSCALE,
            true,
            Format::Dxt1,
            "82 10 a7 39 e4 e4 e4 e4",
        );
    }

    #[test]
    fn grey_pixels_keep_their_fourth_byte() {
        // Пк1 – Пк14
        let rows: [(Format, &str, &str, bool); 12] = [
            (Format::A8R8G8B8, "00 00 ff ff", "36 36 36 ff", true),
            (Format::A8R8G8B8, "ff 00 00 80", "12 12 12 80", true),
            (Format::A8R8G8B8, "00 ff 00 00", "b6 b6 b6 00", true),
            (Format::A8R8G8B8, "ff ff ff ff", "ff ff ff ff", false),
            (Format::A8R8G8B8, "40 40 40 ff", "40 40 40 ff", false),
            (
                Format::A8R8G8B8,
                "00 00 ff ff 10 20 30 40 ff 80 00 7f",
                "36 36 36 ff 22 22 22 40 6e 6e 6e 7f",
                true,
            ),
            (Format::A8R8G8B8, "00 00 ff ff 77", "36 36 36 ff 77", true),
            (Format::X8R8G8B8, "00 00 ff 00", "36 36 36 00", true),
            (Format::X8R8G8B8, "10 20 30 7f", "22 22 22 7f", true),
            (Format::A8B8G8R8, "ff 00 00 ff", "36 36 36 ff", true),
            (Format::A8B8G8R8, "10 20 30 40", "1e 1e 1e 40", true),
            (Format::A8B8G8R8, "33 33 33 33", "33 33 33 33", false),
        ];
        for (format, input, output, done) in rows {
            expect_apply(raw(format, input), GRAYSCALE, done, format, output);
        }
        for levels in [3, 1] {
            let mut subject = level(
                "t",
                Format::A8R8G8B8,
                4,
                4,
                levels,
                chain(Format::A8R8G8B8, 4, 4, 3, pattern),
            );
            assert!(apply(&mut subject, GRAYSCALE));
            assert_data(
                &subject.data,
                "482fd57f181d3a83610ce9e15bcbc65be0f2d49044cda8f9fda1f80e66d1c100",
                "00 00 00 ff 0e 0e 0e ff 1c 1c 1c ff 2a 2a 2a ff",
            );
            assert_eq!(subject.data.len(), 84);
        }
    }

    #[test]
    fn grey_bc7_is_rewritten_as_dxt5() {
        // Бс1 – Бс10
        let cases: [(&str, Level, bool, Format, &str, &str); 8] = [
            (
                "Бс1",
                level("t", Format::Bc7, 4, 4, 1, seq(16)),
                true,
                Format::Dxt5,
                "",
                "ff ff 00 00 00 00 00 00 ba d6 cb 5a 5a 50 f0 b3",
            ),
            (
                "Бс2",
                level("t", Format::Bc7, 4, 4, 1, vec![0; 16]),
                true,
                Format::Dxt5,
                "",
                "ff 00 49 92 24 49 92 24 00 00 00 00 00 00 00 00",
            ),
            (
                "Бс3",
                level("t", Format::Bc7, 4, 4, 1, vec![255; 16]),
                true,
                Format::Dxt5,
                "",
                "ff ff 00 00 00 00 00 00 ff ff ff ff 00 00 00 00",
            ),
            (
                "Бс6",
                level("t", Format::Bc7, 8, 8, 2, seq(8)),
                false,
                Format::Bc7,
                "",
                "0b 30 55 7a 9f c4 e9 0e",
            ),
            (
                "Бс9",
                level("t", Format::Bc7, 4, 4, 0, seq(16)),
                false,
                Format::Bc7,
                "",
                "0b 30 55 7a 9f c4 e9 0e 33 58 7d a2 c7 ec 11 36",
            ),
            (
                "Бс10",
                Level {
                    depth: 2,
                    ..level("t", Format::Bc7, 4, 4, 1, seq(16))
                },
                false,
                Format::Bc7,
                "",
                "0b 30 55 7a 9f c4 e9 0e 33 58 7d a2 c7 ec 11 36",
            ),
            (
                "Бс11",
                level("t", Format::Bc7, 8, 8, 1, seq(16)),
                false,
                Format::Bc7,
                "",
                "0b 30 55 7a 9f c4 e9 0e 33 58 7d a2 c7 ec 11 36",
            ),
            (
                "Бс12",
                level("t", Format::Bc7, 4, 4, 1, Vec::new()),
                false,
                Format::Bc7,
                "",
                "",
            ),
        ];
        for (label, mut subject, done, format, _, bytes) in cases {
            assert_eq!(apply(&mut subject, GRAYSCALE), done, "{label}");
            assert_eq!(subject.format, format, "{label}");
            assert_eq!(hex(&subject.data), bytes, "{label}");
        }
        let long: [(&str, usize, usize, usize, &str, &str); 4] = [
            (
                "Бс4",
                8,
                3,
                96,
                "7134b1fad3477c9f2109934120456bc87bdd908be478cf704ff8c2a9b6a9b8bc",
                "ff ff 00 00 00 00 00 00 ba d6 cb 5a 5a 50 f0 b3",
            ),
            (
                "Бс5",
                8,
                2,
                72,
                "66477961431df2ca6bf9da4b9c0e51d001246edccb01dab83e3e8649e551c077",
                "ff ff 00 00 00 00 00 00 ba d6 cb 5a 5a 50 f0 b3",
            ),
            (
                "Бс7",
                8,
                5,
                80,
                "60b10c803b68a1b1e57d5dee7d60fe1d31d61be98b516fee3c1feb28fdf9acee",
                "ff ff 00 00 00 00 00 00 ba d6 cb 5a 5a 50 f0 b3",
            ),
            (
                "Бс8",
                6,
                1,
                64,
                "7efed0e60cfdaa0f5283134eda95f88e22014c4c1155ffdc183043b9bf39e7bf",
                "ff ff 00 00 00 00 00 00 ba d6 cb 5a 5a 50 f0 b3",
            ),
        ];
        for (label, side, levels, len, digest, head) in long {
            let mut subject = level("t", Format::Bc7, side, side, levels, seq(len));
            assert!(apply(&mut subject, GRAYSCALE), "{label}");
            assert_eq!(subject.format, Format::Dxt5, "{label}");
            assert_eq!(subject.data.len(), len, "{label}");
            assert_data(&subject.data, digest, head);
        }
    }

    #[test]
    fn world_styles_keep_formats_and_alpha_rules() {
        // Сф1 – Сф19: все форматы, стиль style-painted, 32×32, 6 ступеней
        let draws: [Pattern; 3] = [pattern, pattern_alpha, pattern_cut];
        let rows: [(Format, [(&str, &str); 3]); 5] = [
            (
                Format::Dxt1,
                [
                    (
                        "a60bb86bf06a59d6717283b056c60a5e07916c2722582073fa981eb799da1f95",
                        "03 31 c6 18 00 fc fc fc 03 31 a8 30 00 57 57 57",
                    ),
                    (
                        "a60bb86bf06a59d6717283b056c60a5e07916c2722582073fa981eb799da1f95",
                        "03 31 c6 18 00 fc fc fc 03 31 a8 30 00 57 57 57",
                    ),
                    (
                        "a60bb86bf06a59d6717283b056c60a5e07916c2722582073fa981eb799da1f95",
                        "03 31 c6 18 00 fc fc fc 03 31 a8 30 00 57 57 57",
                    ),
                ],
            ),
            (
                Format::Dxt3,
                [
                    (
                        "8d70eb13bfb3f4c6f9505bd9d5b09cdb44d603964d0e0f9aebec835f701fd731",
                        "ff ff ff ff ff ff ff ff 03 31 c6 18 00 fc fc fc",
                    ),
                    (
                        "6ae6c459507658f08e438a3e466c0b58721a8bf7cb79f093af59b4f606c312b7",
                        "20 54 31 65 42 76 53 87 03 31 c6 18 00 fc fc fc",
                    ),
                    (
                        "65d3ff117bd0896e3be0f3ceeee9ab62ef46306b8d47fc10485d5960bcdc1eb2",
                        "0f f0 f0 00 00 0f 0f f0 e3 30 27 19 aa ba ba fa",
                    ),
                ],
            ),
            (
                Format::Dxt5,
                [
                    (
                        "2151d5c72c98194315728e8eca06222c5cfc2769bcb6b7a481dc3ba54d37d2c7",
                        "ff ff 00 00 00 00 00 00 03 31 c6 18 00 fc fc fc",
                    ),
                    (
                        "3304802d71f35fee33519b4002d5fcfb3cefcf3c937319568ba00809a8560553",
                        "0f 8d d6 08 b1 1a 2b 36 03 31 c6 18 00 fc fc fc",
                    ),
                    (
                        "952d54030cd9680f1c07c949a8188a9a9a32e88ec3f564a973cd83c4e7237b06",
                        "ff 00 48 10 24 09 82 04 e3 30 27 19 aa ba ba fa",
                    ),
                ],
            ),
            (
                Format::A8R8G8B8,
                [
                    (
                        "6f66a351d62e60c5c68ffbfe1dcdd2ab284f84b0523c24dc5250a6b96f392710",
                        "1b 21 2f ff 1b 21 2e ff 1b 21 2e ff 1b 21 2e ff",
                    ),
                    (
                        "6b2ea77db44749f1392ce1c8ceb6295be074b20b51300ada83aa812a38653b81",
                        "1b 21 2f 00 1b 21 2e 1f 1b 21 2e 3e 1b 21 2e 5d",
                    ),
                    (
                        "34bb75f09cb920daef52bf032707dacfe7c93e7f41186746fbfcb5923dd7584a",
                        "1b 21 2f ff 1b 21 2e 00 1b 21 2e 00 1b 21 2e ff",
                    ),
                ],
            ),
            (
                Format::A8B8G8R8,
                [
                    (
                        "d783129ccfbec1f9368a2d2ac12c44adda57b10826ac2f1ada7af80e9684bffb",
                        "2f 21 1b ff 2e 21 1b ff 2e 21 1b ff 2e 21 1b ff",
                    ),
                    (
                        "fd8662d39bfc22099d0fcdd63a607f414ced8361acdb68182db1e74a42fc0e15",
                        "2f 21 1b 00 2e 21 1b 1f 2e 21 1b 3e 2e 21 1b 5d",
                    ),
                    (
                        "651d89656964ad619fb58126a82d21fdac7b4a3bbf8f999769d2e4c3c5421984",
                        "2f 21 1b ff 2e 21 1b 00 2e 21 1b 00 2e 21 1b ff",
                    ),
                ],
            ),
        ];
        for (format, expectations) in rows {
            for (draw, (digest, head)) in draws.iter().zip(expectations) {
                let data = chain(format, 32, 32, 6, *draw);
                let len = data.len();
                let mut subject = level("t", format, 32, 32, 6, data);
                assert!(apply(&mut subject, "style-painted"), "{format:?}");
                assert_eq!(subject.format, format);
                assert_eq!(subject.data.len(), len);
                assert_data(&subject.data, digest, head);
            }
        }
        // X8R8G8B8 читается так же, как A8R8G8B8, вместе с «альфой» в четвёртом байте
        let argb_cut = chain(Format::A8R8G8B8, 32, 32, 6, pattern_cut);
        let mut x8 = level("t", Format::X8R8G8B8, 32, 32, 6, argb_cut);
        assert!(apply(&mut x8, "style-painted"));
        assert_data(
            &x8.data,
            "34bb75f09cb920daef52bf032707dacfe7c93e7f41186746fbfcb5923dd7584a",
            "1b 21 2f ff 1b 21 2e 00 1b 21 2e 00 1b 21 2e ff",
        );
        let mut bc7 = level("t", Format::Bc7, 32, 32, 6, seq(1392));
        assert!(apply(&mut bc7, "style-painted"));
        assert_eq!(bc7.format, Format::Dxt5);
        assert_data(
            &bc7.data,
            "f6f7fb7a5593ac34afef0203ce8c536a6c979bd6b57338e671d7f2f33cf108fd",
            "ff ff 00 00 00 00 00 00 0a 4d 04 39 d4 d4 fc 56",
        );
    }

    #[test]
    #[allow(clippy::type_complexity)]
    fn each_style_gives_its_own_picture() {
        // Сс1 – Сс10
        let rows: [(&str, (&str, &str), (&str, &str)); 5] = [
            (
                "style-painted",
                (
                    "a60bb86bf06a59d6717283b056c60a5e07916c2722582073fa981eb799da1f95",
                    "03 31 c6 18 00 fc fc fc 03 31 a8 30 00 57 57 57",
                ),
                (
                    "6b2ea77db44749f1392ce1c8ceb6295be074b20b51300ada83aa812a38653b81",
                    "1b 21 2f 00 1b 21 2e 1f 1b 21 2e 3e 1b 21 2e 5d",
                ),
            ),
            (
                "style-comic",
                (
                    "31263dd2ab8a5bf8456946b1f0e58fa53deb102905c46105a7623d1c40d343c8",
                    "e7 18 62 10 55 fd 8d 8d ab 38 62 10 55 ff aa aa",
                ),
                (
                    "f031c58d8051b8da3e7b7b36ba385fed432d6e8bd41e431793dfdd43881e6b38",
                    "13 0d 0f 00 13 0d 0e 1f 13 0d 0f 3e 13 0d 0f 5d",
                ),
            ),
            (
                "style-cartoon",
                (
                    "7a68981c8d31c3dcee2c4b2e0ad6633079759ee09f09f1ff32334f644ef014d1",
                    "26 28 26 11 55 fc fc dc 8b 40 25 11 55 aa 2a 2a",
                ),
                (
                    "ba809425c2d627809fc10156cd628f62e18ea3ed656cbeb56244c4e6cda83e20",
                    "30 26 26 00 1d 25 05 1f 1d 26 04 3e 20 25 05 5d",
                ),
            ),
            (
                "style-watercolor",
                (
                    "c5d4f0be023f469cb67de6934de2711d0c1e0d48fb4acb34576f8bffc6857ada",
                    "86 28 e7 21 55 aa f8 b8 08 31 e8 29 55 00 00 00",
                ),
                (
                    "16b26a3b96ab31fd21800322a031c2c97b165fff6f1cebe5cf35aaaacf3214fa",
                    "40 39 39 00 38 3f 22 1f 31 3a 16 3e 36 3c 1a 5d",
                ),
            ),
            (
                "style-retro",
                (
                    "38a40d9049aa2fe4bc71f36f6d4355843c3c88d2aab45d5082660d869e7363f2",
                    "a3 18 86 18 00 00 ff ff 46 30 29 30 00 00 00 ff",
                ),
                (
                    "3d993cd4a3f9e14a1ebed5c3367aa618e405a3d6a527e18dc88708e929276d08",
                    "13 13 13 00 13 13 13 1f 13 13 13 3e 2f 07 2f 5d",
                ),
            ),
        ];
        for (stage, (dxt_digest, dxt_head), (argb_digest, argb_head)) in rows {
            let mut dxt = level(
                "t",
                Format::Dxt1,
                32,
                32,
                6,
                chain(Format::Dxt1, 32, 32, 6, pattern_alpha),
            );
            assert!(apply(&mut dxt, stage), "{stage}");
            assert_data(&dxt.data, dxt_digest, dxt_head);
            let mut argb = level(
                "t",
                Format::A8R8G8B8,
                32,
                32,
                6,
                chain(Format::A8R8G8B8, 32, 32, 6, pattern_alpha),
            );
            assert!(apply(&mut argb, stage), "{stage}");
            assert_data(&argb.data, argb_digest, argb_head);
        }
    }

    #[test]
    fn style_frames_follow_the_level_sizes() {
        // Рз1 – Рз16 (style-comic)
        let d = Format::Dxt1;
        let a = Format::A8R8G8B8;
        type Row = (
            &'static str,
            Format,
            usize,
            usize,
            usize,
            Option<&'static str>,
            &'static str,
            &'static str,
        );
        let rows: [Row; 16] = [
            ("Рз1", d, 4, 4, 1, None, "e2 61 02 5c 00 00 55 55", ""),
            ("Рз2", a, 4, 4, 1, Some("049ec829eb1356a1e7b535c23bdf3fdddcef3d5127e4dbbdf57c151cd9db6a04"), "0d 3f 3f ff 0d 3f 3e ff 12 3d 88 ff 12 3d 88 ff", ""),
            ("Рз3", d, 6, 6, 1, None, "c2 40 85 3a ff 00 d7 d7 a5 a8 88 9a aa 82 aa 55 66 3b a8 25 28 d7 d7 ff ec 9d 27 83 7d ff 00 ff", ""),
            ("Рз4", a, 6, 6, 1, Some("60fc83d8e9143050c3e8dfcf3f629723dc690112f93401587db4f58d06915996"), "1e 46 46 ff 1f 4b 31 ff 1d 41 5a ff 1a 36 7f ff", ""),
            ("Рз5", d, 8, 4, 2, None, "e2 41 03 3c 00 00 55 55 e5 b1 06 ac 00 00 55 55 a5 99 23 4c 0a 0a 55 55", ""),
            ("Рз6", a, 8, 4, 2, Some("7f3bc6cdc827fb543191e96996e72f4259e7d17f1e4f3d539cf8ac89d74fb23b"), "0e 38 38 ff 0e 40 1b ff 0e 38 37 ff 1d 43 6b ff", ""),
            ("Рз7", d, 16, 16, 1, Some("26a5899b1bfb40a1021a8c9e46f805ff28cfaa3c08df1782a10419a5281b57f2"), "84 20 a7 19 57 28 a8 bb cb 59 66 48 aa 55 55 00", ""),
            ("Рз8", a, 16, 16, 1, Some("c918647c04b113a4ff6a6d5a7191d36ab3fd4a6e153baf4b3832caedb04f8c76"), "32 2f 30 ff 36 37 15 ff 38 34 1c ff 3a 31 25 ff", ""),
            ("Рз9", d, 16, 16, 5, Some("64950df80f06e5f37fb8c0e46a33933ca49c86cddf07195ada336a1616592556"), "84 20 a7 19 57 28 a8 bb cb 59 66 48 aa 55 55 00", ""),
            ("Рз10", a, 16, 16, 5, Some("080da0d01f8ce50235cb43909b6ce8273c85ab2fdc61bd3e1463e4130e078e81"), "32 2f 30 ff 36 37 15 ff 38 34 1c ff 3a 31 25 ff", ""),
            ("Рз11", d, 64, 64, 7, Some("fe4f288f64d0e4898a8bfe2027ed33007912c25d56961bd179193720a06ce39a"), "e8 18 62 10 55 fd 8d 8d aa 20 62 10 55 ff 00 00", ""),
            ("Рз12", a, 64, 64, 7, Some("0e284bab6216925b757ebad8189ff76a2c7aa84cdab9f65a9ab88d737ea5d52e"), "13 0d 0f ff 13 0d 0e ff 13 0d 0e ff 13 0d 0e ff", ""),
            ("Рз13", d, 4, 32, 3, Some("ae85391cd6e62eee2fbb35717f31d79477c6698eec6970fe5aca5549c14251bd"), "02 60 26 4a f5 0a 0a 0a 0f 9a 85 28 a5 aa aa aa", ""),
            ("Рз14", a, 4, 32, 3, Some("93456c38edee12a35b2fb2d2c427540ecaa4ab1a42a1c39e9e49ad8adc7b706a"), "2f 46 46 ff 2f 46 45 ff 26 33 86 ff 26 33 86 ff", ""),
            ("Рз15", d, 1, 1, 1, None, "e2 61 02 5c 00 00 55 55", ""),
            ("Рз16", a, 1, 1, 1, None, "00 00 00 ff", ""),
        ];
        for (label, format, w, h, levels, digest, head, _) in rows {
            let data = chain(format, w, h, levels, pattern);
            let mut subject = level("t", format, w, h, levels, data.clone());
            assert!(apply(&mut subject, "style-comic"), "{label}");
            assert_eq!(subject.data.len(), data.len(), "{label}");
            match digest {
                Some(digest) => assert_data(&subject.data, digest, head),
                None => assert_eq!(hex(&subject.data), head, "{label}"),
            }
            assert_eq!(subject.data == data, label == "Рз16", "{label}");
        }
    }

    #[test]
    #[allow(clippy::type_complexity)]
    fn truncated_chains_are_finished_from_the_level_above() {
        // Об1 – Об7 (style-painted)
        let sixteen = chain(Format::A8R8G8B8, 16, 16, 5, pattern);
        let cases: [(
            &str,
            Format,
            usize,
            usize,
            Vec<u8>,
            usize,
            Option<(&str, &str)>,
        ); 6] = [
            (
                "Об1",
                Format::A8R8G8B8,
                16,
                5,
                sixteen[..1124].to_vec(),
                1124,
                Some((
                    "d2bdf7e6dc08e9d1552d1a90eb0933701434739e05bf6ef197fa27191b9309c7",
                    "2c 2f 35 ff 2d 33 1a ff 2f 31 21 ff 31 2e 28 ff",
                )),
            ),
            (
                "Об2",
                Format::A8R8G8B8,
                16,
                5,
                sixteen[..1024].to_vec(),
                1024,
                Some((
                    "da4fd200193610c6daa74ed3795eec7145fda547d7a54e50c14d30f78fb8cd3a",
                    "2c 2f 35 ff 2d 33 1a ff 2f 31 21 ff 31 2e 28 ff",
                )),
            ),
            (
                "Об4",
                Format::Dxt1,
                16,
                3,
                chain(Format::Dxt1, 16, 16, 3, pattern)[..138].to_vec(),
                138,
                Some((
                    "4f67f2592bbf17801a3dd0076bb780e96b2b59dfc192c3365d60d623704b3b53",
                    "a4 30 86 29 55 28 aa 57 66 60 a9 51 55 00 fe fd",
                )),
            ),
            (
                "Об5",
                Format::Dxt1,
                16,
                3,
                [chain(Format::Dxt1, 16, 16, 3, pattern), vec![0xee; 5]].concat(),
                173,
                Some((
                    "470cd22636a26c90f2aee78967aade1c3e153ae49b065e1d5281b9c09c7b7bb8",
                    "a4 30 86 29 55 28 aa 57 66 60 a9 51 55 00 fe fd",
                )),
            ),
            (
                "Об7",
                Format::Dxt1,
                16,
                1,
                chain(Format::Dxt1, 16, 16, 3, pattern),
                168,
                Some((
                    "1d687d69915f2becb5f0b869622c16555045c40a39bfead80f6f11b12f6f55f9",
                    "a4 30 86 29 55 28 aa 57 66 60 a9 51 55 00 fe fd",
                )),
            ),
            (
                "Об3",
                Format::A8R8G8B8,
                16,
                5,
                sixteen[..1000].to_vec(),
                1000,
                None,
            ),
        ];
        for (label, format, side, levels, data, len, expected) in cases {
            let mut subject = level("t", format, side, side, levels, data.clone());
            let done = apply(&mut subject, "style-painted");
            assert_eq!(done, expected.is_some(), "{label}");
            assert_eq!(subject.data.len(), len, "{label}");
            match expected {
                Some((digest, head)) => assert_data(&subject.data, digest, head),
                None => assert_eq!(subject.data, data, "{label}"),
            }
        }
        // Об6: хвост за последней ступенью остаётся как был
        let mut extra = level(
            "t",
            Format::Dxt1,
            16,
            16,
            3,
            [chain(Format::Dxt1, 16, 16, 3, pattern), vec![0xee; 5]].concat(),
        );
        assert!(apply(&mut extra, "style-painted"));
        assert_eq!(hex(&extra.data[168..]), "ee ee ee ee ee");
    }

    #[test]
    fn names_and_strips_decide_the_style_but_not_the_grey() {
        // Сн1 – Сн9
        let top = chain(Format::Dxt1, 16, 16, 3, pattern);
        let untouched = "3e2fd04bf082cb1867dbdf9db2c5ad8460b41f9d854f6661e8d9bfee026d9364";
        let mut wall = level("wall", Format::Dxt1, 16, 16, 3, top.clone());
        assert!(apply(&mut wall, "style-painted"));
        assert_data(
            &wall.data,
            "3dba50fa3e1fbf801c3ad3eaba4afc1dd1980a794128c08292a16f1c2f5136ed",
            "a4 30 86 29 55 28 aa 57 66 60 a9 51 55 00 fe fd",
        );
        for name in ["wall_mask", "wall_pal", "wall_lut", "wall_n", "wall_h"] {
            let mut subject = level(name, Format::Dxt1, 16, 16, 3, top.clone());
            assert!(!apply(&mut subject, "style-painted"), "{name}");
            assert_data(
                &subject.data,
                untouched,
                "86 19 01 18 55 ff aa 00 8a 59 05 58 55 ff aa 00",
            );
        }
        let strip = chain(Format::A8R8G8B8, 64, 4, 1, pattern);
        let mut band = level("t", Format::A8R8G8B8, 64, 4, 1, strip.clone());
        assert!(!apply(&mut band, "style-painted"));
        assert_data(
            &band.data,
            "1d281d5b988fd1be2d303a5e7ba849866e57ce53c43b0d2ca9c2b256519236ca",
            "00 00 00 ff 07 00 03 ff 0e 00 07 ff 15 00 0b ff",
        );
        let mut almost = level(
            "t",
            Format::A8R8G8B8,
            63,
            4,
            1,
            chain(Format::A8R8G8B8, 63, 4, 1, pattern),
        );
        assert!(apply(&mut almost, "style-painted"));
        assert_data(
            &almost.data,
            "03e3d2ff035e9913d33baf0870ca6aa708301be5c8924a2cd891a5614c08e7e4",
            "3b 41 41 ff 16 43 06 ff 1c 42 09 ff 21 40 0a ff",
        );
        let mut grey = level("t", Format::A8R8G8B8, 64, 4, 1, strip);
        assert!(apply(&mut grey, GRAYSCALE));
        assert_data(
            &grey.data,
            "342b0155e7f13cb7a869cb82f457c4d5cf36042ac3a54a451544e35188d1cd2b",
            "00 00 00 ff 01 01 01 ff 02 02 02 ff 04 04 04 ff",
        );
    }

    #[test]
    fn luma_and_grey_tables_match_the_reference_sums() {
        // контрольные суммы раздела «Контрольные суммы таблиц»
        let mut table = Vec::with_capacity(1 << 24);
        for r in 0..256u32 {
            for g in 0..256u32 {
                for b in 0..256u32 {
                    table.push(luma([r, g, b]));
                }
            }
        }
        assert_eq!(
            sha(&table),
            "f12a412e99941ae7111b5e5839fdda855a33138ebc613ee399546be4216cdd75"
        );
        for (r, g, b, y) in [
            (255, 0, 0, 54),
            (0, 255, 0, 182),
            (0, 0, 255, 18),
            (255, 255, 0, 237),
            (255, 0, 255, 73),
            (0, 255, 255, 201),
            (255, 255, 255, 255),
            (128, 128, 128, 128),
            (200, 100, 50, 118),
            (10, 20, 30, 19),
            (1, 1, 0, 1),
            (0, 1, 0, 1),
            (0, 0, 1, 0),
            (0, 14, 76, 15),
            (0, 41, 44, 33),
        ] {
            assert_eq!(luma([r, g, b]), y, "({r},{g},{b})");
        }
        let greys: Vec<u8> = (0..=u16::MAX)
            .flat_map(|color| color.grey().to_le_bytes())
            .collect();
        assert_eq!(
            sha(&greys),
            "789872d891929f974526c03fd148ec53743ac0069518d6da0c4d40084fe9450a"
        );
        for (color, grey) in [
            (0x0000, 0x0000),
            (0x0001, 0x0000),
            (0x0020, 0x0020),
            (0x0800, 0x0000),
            (0x001F, 0x1082),
            (0x07E0, 0xB5B6),
            (0xF800, 0x39A7),
            (0xFFFF, 0xFFFF),
            (0x8410, 0x8410),
            (0x39A7, 0x31A6),
            (0x841F, 0x8C51),
        ] {
            assert_eq!(color.grey(), grey, "{color:#06x}");
        }
    }
}
