//! Туман воды: плитка `waterfog-N.ytd` в облике работы — `recolourFogTile` из
//! `apps/desktop/src/water-tiles.js` и `recolourWaterFogLevel` из
//! `packages/climb-contract/recolor/water.js` байт в байт.
//!
//! Что работа значит, решает приложение: облик групп приходит готовыми числами
//! (`waterFogEngineLook`) — полоса цвета на 256 ступеней уже байтами, направление эффекта,
//! границы карты, опорная яркость глубины и отмели, озёра. Здесь остаётся арифметика точки и
//! работа с плиткой: каждый уровень mip разбирается, красится и сжимается обратно в свой формат
//! (BC7 режима 6, DXT) той же длины; уровень, который правка не меняет, остаётся как был.

use std::time::Instant;

use rage_res::dxt_block;
use rage_res::texture::{self, Format, TextureRef};

use crate::bc7::{self, js_round};
use crate::dictionary::{open_resource, pack_patched, unique_refs, Clock, LEVEL_FALLBACK_BYTES};
use crate::sheet;

/// Куда растёт эффект цвета.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// От берега в глубину.
    Height,
    /// По карте с юга на север.
    Across,
    /// По карте с запада на восток.
    Along,
}

/// Облик группы воды (море или озёра и реки).
#[derive(Clone, Debug)]
pub struct FogLook {
    /// Группа красится; иначе её точки остаются как в игре.
    pub tint: bool,
    /// Эффект «линия»: полоса повторяется по ширине `width`.
    pub line: bool,
    pub direction: Direction,
    /// Ширина полосы линии, м.
    pub width: f64,
    /// Цвет ступени: 256 ступеней по три байта, уже в пределах игры.
    pub table: Vec<[u8; 3]>,
}

/// Всё, от чего зависит цвет точки тумана.
#[derive(Clone, Debug)]
pub struct Fog {
    /// Границы карты для эффектов «по карте» (`WATER_EFFECT_BOUNDS`).
    pub west: f64,
    pub east: f64,
    pub south: f64,
    pub north: f64,
    /// Глубина линии «от берега в глубину», м (`WATER_DEPTH_METRES`).
    pub depth_metres: f64,
    /// Яркость тумана Rockstar на глубине и на отмели.
    pub luma_deep: f64,
    pub luma_shallow: f64,
    /// Зелёный ниже этого — точка без воды (`WATER_FOG_MIN_GREEN`).
    pub min_green: u8,
    pub sea: FogLook,
    pub inland: FogLook,
    /// Озёра: `[запад, юг, восток, север]`.
    pub lakes: Vec<[f64; 4]>,
}

/// Мировой прямоугольник плитки (север — сверху).
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub west: f64,
    pub north: f64,
    pub size: f64,
}

impl Fog {
    /// Облик годится движку: полосы полны, ширина линии — положительное число.
    pub fn sound(&self) -> bool {
        let look = |look: &FogLook| !look.tint || (look.table.len() == 256 && (!look.line || (look.width.is_finite() && look.width > 0.0)));
        look(&self.sea) && look(&self.inland) && (self.luma_shallow - self.luma_deep) != 0.0
    }

    /// Отмель (1) или глубина (0) — по яркости тумана Rockstar (`waterShallowness`).
    fn shallowness(&self, r: u8, g: u8, b: u8) -> f64 {
        let luma = 0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b);
        let s = (luma - self.luma_deep) / (self.luma_shallow - self.luma_deep);
        if s < 0.0 {
            0.0
        } else if s > 1.0 {
            1.0
        } else {
            s
        }
    }

    /// Ступень полосы в точке (`effectParameter` и выбор ступени в `waterFogTexel`).
    fn step(&self, look: &FogLook, s: f64, x: f64, y: f64) -> usize {
        if look.line {
            let metres = match look.direction {
                Direction::Height => (1.0 - s) * self.depth_metres,
                Direction::Across => y - self.south,
                Direction::Along => x - self.west,
            };
            let u = metres / (2.0 * look.width);
            let t = u - u.floor();
            let step = (t * 256.0).floor();
            return if step >= 255.0 { 255 } else if step > 0.0 { step as usize } else { 0 };
        }
        let t = match look.direction {
            Direction::Height => 1.0 - s,
            Direction::Across => (y - self.south) / (self.north - self.south),
            Direction::Along => (x - self.west) / (self.east - self.west),
        };
        let t = if look.direction == Direction::Height {
            t
        } else if t < 0.0 {
            0.0
        } else if t > 1.0 {
            1.0
        } else {
            t
        };
        let step = js_round(t * 255.0);
        if step >= 255.0 {
            255
        } else if step > 0.0 {
            step as usize
        } else {
            0
        }
    }
}

/// Один уровень плитки в новом облике (`recolourWaterFogLevel`). Точки без воды и группа «как в
/// игре» не трогаются; альфа тумана — как была.
pub fn recolour_level(rgba: &[u8], width: usize, height: usize, rect: &Rect, fog: &Fog) -> Vec<u8> {
    let mut out = rgba.to_vec();
    /* Озёра, что могут накрыть точки этой плитки: у штата их сотня, а плитку задевают одно-два. Точки плитки лежат в её
       прямоугольнике включительно (округление сумм монотонно), так что отброшенное озеро ни одну из них не накрыло бы. */
    let (east, south) = (rect.west + rect.size, rect.north - rect.size);
    let whole = rect.size.is_nan() || rect.size < 0.0;
    let near: Vec<&[f64; 4]> = fog
        .lakes
        .iter()
        .filter(|lake| whole || (lake[0] <= east && lake[2] >= rect.west && lake[1] <= rect.north && lake[3] >= south))
        .collect();
    for py in 0..height {
        let y = rect.north - ((py as f64 + 0.5) / height as f64) * rect.size;
        for px in 0..width {
            let at = (py * width + px) * 4;
            if rgba[at + 1] < fog.min_green {
                continue;
            }
            let x = rect.west + ((px as f64 + 0.5) / width as f64) * rect.size;
            let inland = near.iter().any(|lake| x >= lake[0] && x <= lake[2] && y >= lake[1] && y <= lake[3]);
            let look = if inland { &fog.inland } else { &fog.sea };
            if !look.tint {
                continue;
            }
            let s = fog.shallowness(rgba[at], rgba[at + 1], rgba[at + 2]);
            let texel = look.table[fog.step(look, s, x, y)];
            out[at..at + 3].copy_from_slice(&texel);
        }
    }
    out
}

fn dxt_format(format: Format) -> Option<dxt_block::Format> {
    match format {
        Format::Dxt1 => Some(dxt_block::Format::Dxt1),
        Format::Dxt3 => Some(dxt_block::Format::Dxt3),
        Format::Dxt5 => Some(dxt_block::Format::Dxt5),
        _ => None,
    }
}

/// Уровень в RGBA тем же разбором, что у приложения; `None` — формат движок не разбирает.
fn decode_level(format: Format, data: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    match format {
        Format::Bc7 => texture::decode_pixels(format, data, width, height).ok(),
        _ => sheet::decode_blocks(dxt_format(format)?, data, width, height),
    }
}

/// RGBA в байты формата листа (`encodeLevel`); `None` — формат движок не пишет.
fn encode_level(format: Format, rgba: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    match format {
        Format::Bc7 => Some(bc7::encode(rgba, width, height)),
        _ => {
            let kind = dxt_format(format)?;
            let mut out = vec![0u8; dxt_block::blocks_len(kind, width, height)];
            dxt_block::encode_blocks(kind, rgba, width, height, &mut out);
            Some(out)
        }
    }
}

/// Что вышло с листом.
enum Sheet {
    /// Новые байты всех уровней.
    Changed(Vec<u8>),
    /// Ни один уровень не изменился (или длина сжатого уровня не сошлась — у JS лист остаётся как был).
    Same,
    /// Формат листа движок не знает: плитку собирает приложение.
    Foreign,
}

/// Лист плитки: каждый уровень разбирается, красится и сжимается обратно (`recolourTexture`).
fn recolour_sheet(item: &TextureRef, payload: &[u8], rect: &Rect, fog: &Fog, clock: &Clock) -> Sheet {
    let Some(format) = item.format.filter(|format| matches!(format, Format::Bc7 | Format::Dxt1 | Format::Dxt3 | Format::Dxt5)) else {
        return Sheet::Foreign;
    };
    let mut out = payload.to_vec();
    let mut offset = 0usize;
    let mut changed = false;
    for level in 0..item.levels {
        /* Сдвиг — как у JS: счёт сдвига берётся по модулю 32. */
        let width = (item.width >> (level & 31)).max(1) as usize;
        let height = (item.height >> (level & 31)).max(1) as usize;
        let size = format.level_bytes(width, height);
        if offset + size > out.len() {
            break;
        }
        let from = Instant::now();
        let rgba = decode_level(format, &out[offset..offset + size], width, height);
        Clock::add(&clock.decode, from);
        let Some(rgba) = rgba else { return Sheet::Foreign };
        let from = Instant::now();
        let next = recolour_level(&rgba, width, height, rect, fog);
        Clock::add(&clock.pixels, from);
        if next != rgba {
            let from = Instant::now();
            let encoded = encode_level(format, &next, width, height);
            Clock::add(&clock.encode, from);
            match encoded {
                Some(bytes) if bytes.len() == size => out[offset..offset + size].copy_from_slice(&bytes),
                Some(_) => return Sheet::Same,
                None => return Sheet::Foreign,
            }
            changed = true;
        }
        offset += size;
    }
    if changed {
        Sheet::Changed(out)
    } else {
        Sheet::Same
    }
}

/// Итог плитки.
pub enum Tile {
    /// Плитка в новом облике: байты файла.
    Built(Vec<u8>),
    /// Правка плитку не меняет.
    Unchanged,
    /// Плитку собирает приложение прежним кодом.
    Fallback(String),
}

/// Плитка тумана `file_name` в облике работы (`recolourFogTile`).
pub fn process_tile(raw: &[u8], file_name: &str, rect: &Rect, fog: &Fog, clock: &Clock) -> Tile {
    if !file_name.to_ascii_lowercase().ends_with(".ytd") {
        return Tile::Fallback("плитка не словарь текстур".to_owned());
    }
    let parse_from = Instant::now();
    let mut res = match open_resource(raw) {
        Ok(res) if res.complete => res,
        Ok(_) => return Tile::Fallback("данные ресурса короче заявленных".to_owned()),
        Err(error) => return Tile::Fallback(error.to_string()),
    };
    let refs = match texture::read_dictionary(&res) {
        Ok(refs) => refs,
        Err(error) => return Tile::Fallback(error.to_string()),
    };
    Clock::add(&clock.parse, parse_from);
    /* Имя вне ASCII или из одних цифр у объекта JS ведёт себя иначе: такую плитку собирает приложение. */
    if refs.iter().any(|item| item.complete && (!item.name.is_ascii() || item.name.bytes().all(|byte| byte.is_ascii_digit()))) {
        return Tile::Fallback("имя листа вне ASCII или из одних цифр".to_owned());
    }

    let mut replacements: Vec<(String, std::sync::Arc<Vec<u8>>)> = Vec::new();
    for (item, at) in unique_refs(&refs) {
        let Ok(payload) = res.bytes(at, item.bytes) else {
            return Tile::Fallback(format!("лист {} выходит за данные", item.name));
        };
        match recolour_sheet(item, payload, rect, fog, clock) {
            Sheet::Foreign => return Tile::Fallback(format!("лист {} в формате, который движок не пишет", item.name)),
            Sheet::Same => {}
            Sheet::Changed(bytes) => match replacements.iter_mut().find(|(name, _)| *name == item.name) {
                Some(slot) => slot.1 = std::sync::Arc::new(bytes),
                None => replacements.push((item.name.clone(), std::sync::Arc::new(bytes))),
            },
        }
    }
    if replacements.is_empty() {
        return Tile::Unchanged;
    }
    match pack_patched(raw, &mut res, &refs, &replacements, Some(LEVEL_FALLBACK_BYTES), clock) {
        Ok(bytes) => Tile::Built(bytes),
        Err(reason) => Tile::Fallback(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn look(tint: bool, line: bool, direction: Direction) -> FogLook {
        FogLook { tint, line, direction, width: 50.0, table: (0..=255u8).map(|step| [step, 255 - step, step / 2 + 4]).collect() }
    }

    fn fog(sea: FogLook, inland: FogLook) -> Fog {
        Fog {
            west: -4000.0,
            east: 6700.0,
            south: -7150.0,
            north: 8000.0,
            depth_metres: 200.0,
            luma_deep: 0.2126 * 1.0 + 0.7152 * 27.0 + 0.0722 * 33.0,
            luma_shallow: 0.2126 * 50.0 + 0.7152 * 82.0 + 0.0722 * 82.0,
            min_green: 4,
            sea,
            inland,
            lakes: vec![[0.0, 0.0, 100.0, 100.0]],
        }
    }

    const RECT: Rect = Rect { west: 0.0, north: 500.0, size: 500.0 };

    #[test]
    fn land_and_the_untinted_group_stay_as_they_were() {
        let fog = fog(look(true, false, Direction::Height), look(false, false, Direction::Height));
        /* Две точки в ряд: суша (зелёный 3) и море. */
        let rgba = [9u8, 3, 9, 200, 1, 27, 33, 180];
        let out = recolour_level(&rgba, 2, 1, &RECT, &fog);
        assert_eq!(&out[..4], &rgba[..4], "суша не тронута");
        assert_eq!(out[7], 180, "альфа тумана как была");
        /* Глубина: отмель 0 → доля 1 → ступень 255. */
        assert_eq!(&out[4..7], &[255, 0, 131]);
        /* Та же точка в озере, а озёра «как в игре»: не меняется. */
        let lake = Rect { west: 0.0, north: 100.0, size: 100.0 };
        assert_eq!(recolour_level(&rgba, 2, 1, &lake, &fog), rgba);
    }

    #[test]
    fn the_shallow_end_takes_the_first_step_and_the_map_effect_follows_the_point() {
        let fog = fog(look(true, false, Direction::Height), look(true, false, Direction::Along));
        let shallow = [50u8, 82, 82, 255];
        assert_eq!(&recolour_level(&shallow, 1, 1, &RECT, &fog)[..3], &[0, 255, 4], "отмель — ступень 0");
        /* Озеро: эффект с запада на восток, точка x = 50 → доля 4050 / 10700 → ступень 97. */
        let lake = Rect { west: 0.0, north: 100.0, size: 100.0 };
        assert_eq!(&recolour_level(&shallow, 1, 1, &lake, &fog)[..3], &[97, 158, 52]);
    }

    #[test]
    fn the_line_effect_repeats_across_its_width() {
        let fog = fog(look(true, true, Direction::Along), look(false, false, Direction::Height));
        /* Ширина полосы 50 м: период 100 м; x = 4125 от запада карты → доля 0,25 → ступень 64. */
        let sea = [1u8, 27, 33, 255];
        let rect = Rect { west: 100.0, north: 500.0, size: 50.0 };
        assert_eq!(&recolour_level(&sea, 1, 1, &rect, &fog)[..3], &[64, 191, 36]);
        let next = Rect { west: 200.0, north: 500.0, size: 50.0 };
        assert_eq!(&recolour_level(&sea, 1, 1, &next, &fog)[..3], &[64, 191, 36], "через период — тот же цвет");
    }

    #[test]
    fn a_lake_on_the_edge_of_the_tile_still_counts_and_a_far_one_does_not() {
        let mut fog = fog(look(true, false, Direction::Height), look(false, false, Direction::Height));
        let sea = [1u8, 27, 33, 255];
        /* Плитка 0…500 по обеим осям, одна точка в середине (250, 250). */
        assert_eq!(&recolour_level(&sea, 1, 1, &RECT, &fog)[..3], &[255, 0, 131], "озеро в углу карты точку не накрывает");
        fog.lakes = vec![[250.0, 250.0, 9000.0, 9000.0]];
        assert_eq!(recolour_level(&sea, 1, 1, &RECT, &fog), sea, "край озера ровно в точке — она в озере, а озёра как в игре");
        fog.lakes = vec![[500.5, 0.0, 900.0, 500.0], [-900.0, 0.0, -0.5, 500.0]];
        assert_eq!(&recolour_level(&sea, 1, 1, &RECT, &fog)[..3], &[255, 0, 131], "озёра рядом с плиткой её точек не трогают");
    }

    #[test]
    fn an_incomplete_look_is_not_for_the_engine() {
        let mut broken = look(true, true, Direction::Along);
        broken.width = 0.0;
        assert!(!fog(broken, look(false, false, Direction::Height)).sound());
        let mut short = look(true, false, Direction::Height);
        short.table.truncate(10);
        assert!(!fog(short, look(false, false, Direction::Height)).sound());
        assert!(fog(look(true, false, Direction::Height), look(false, false, Direction::Height)).sound());
    }
}
