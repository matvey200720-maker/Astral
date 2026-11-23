//! Запись шейдера «летающей» вещи на доноре: блок параметров плюс копия блока образца с правками.

use std::iter::once;

use crate::{
    error::{Error, Result},
    hash::joaat,
    resource_graph::{append_block, Address, Graph, Segment, Slot, ALIGN},
};

/// Раскладка полей: в блоке шейдера (`NAME`…`FILE`) и в блоке параметров (`VALUES`, `HASHES`).
mod at {
    pub const NAME: usize = 0x08;
    pub const COUNT: usize = 0x10;
    pub const BUCKET: usize = 0x11;
    /// Длина таблицы параметров (строки и векторы), `u16`.
    pub const TABLE_BYTES: usize = 0x14;
    /// Длина блока параметров целиком (с хешами имён и служебными байтами), `u16`.
    pub const BLOCK_BYTES: usize = 0x16;
    pub const FILE: usize = 0x18;
    /// Маска корзин: общий байт `0xFF00` и бит корзины, `u32`. Игра выбирает проход отрисовки по ней, а не по номеру корзины.
    pub const MASK: usize = 0x20;
    /// Число листов среди параметров.
    pub const SHEETS: usize = 0x27;
    /// Здесь в блоке параметров лежат значения векторов.
    pub const VALUES: usize = 0x70;
    /// Здесь — таблица хешей имён параметров.
    pub const HASHES: usize = 0xd0;
}

/// Число параметров шейдера: текстура и шесть векторов.
const PARAM_COUNT: u8 = 7;
/// Листов среди параметров: один диффузный.
const SHEET_COUNT: u8 = 1;
/// Длина таблицы параметров: семь строк и шесть векторов по 16 байт.
const TABLE_BYTES: u16 = 16 * (PARAM_COUNT as u16 + PARAM_COUNT as u16 - SHEET_COUNT as u16);
/// Длина блока параметров: таблица, четыре байта хеша на параметр и 32 служебных, кратно 16 (формула сверена с шейдерами игры).
const BLOCK_BYTES: u16 = (TABLE_BYTES + 4 * PARAM_COUNT as u16 + 32).div_ceil(16) * 16;

/// Пресет шейдера хоста.
#[derive(Debug, Clone, PartialEq)]
pub struct ShaderSpec {
    pub name: String,
    pub file: String,
    pub alpha: bool,
    pub emissive: Option<f32>,
}

/// Шесть векторов блока параметров: (имя для хеша, четыре значения).
fn vector_table(emissive: Option<f32>, hard_alpha: f32) -> [(&'static str, [f32; 4]); 6] {
    // Четвёртый вектор — свечение, если оно задано, иначе влажность.
    let (label, x) = emissive.map_or(("wetnessMultiplier", 1.0), |glow| ("emissiveMultiplier", glow));
    [
        ("matMaterialColorScale", [1.0, 0.0, 0.0, 1.0]),
        ("HardAlphaBlend", [hard_alpha, 0.0, 0.0, 0.0]),
        ("useTessellation", [0.0; 4]),
        (label, [x, 0.0, 0.0, 0.0]),
        ("globalAnimUV1", [0.0, 1.0, 0.0, 0.0]),
        ("globalAnimUV0", [1.0, 0.0, 0.0, 0.0]),
    ]
}

/// Хвосты строк шапки блока параметров (байты 1…7 каждой строки по 16 байт): у настоящих шейдеров в них номера регистров
/// (`a5`…`a0` у шести векторов), у текстуры — `02` у хоста и `00` у игры. Хост пишет их у каждого шейдера из XML; блок «с нуля» их нулит.
#[derive(Clone, Copy)]
struct Tails {
    texture: u8,
    vectors: [[u8; 7]; 6],
}

/// Первый байт строки шапки: `0` — текстура, `1` — вектор.
const TEXTURE_ROW: u8 = 0;
const VECTOR_ROW: u8 = 1;

impl Tails {
    /// Хвосты строк у блока параметров образца: семь параметров — текстура и шесть векторов; иначе образец не годится.
    fn of(graph: &Graph, template: &Draft) -> Option<Tails> {
        if template.bytes[at::COUNT] != PARAM_COUNT {
            return None;
        }
        let at = template.slots[template.params_slot].target;
        let block = graph.block_at(at)?;
        let content = graph.content(block).get(..at::VALUES)?;
        let shaped = content[0] == TEXTURE_ROW && (1..=6).all(|row| content[16 * row] == VECTOR_ROW);
        shaped.then(|| Tails { texture: 2, vectors: std::array::from_fn(|k| content[16 * (k + 1) + 1..16 * (k + 1) + 8].try_into().unwrap_or_default()) })
    }
}

/// Блок параметров: байты и список его указателей.
struct Params {
    bytes: Vec<u8>,
    slots: Vec<Slot>,
}

impl Params {
    /// Раскладывает блок, который встанет в системную область на `origin`:
    /// цели векторов лежат внутри него самого. `tails` — хвосты строк шапки, `None` — нули.
    fn lay_out(texture: Address, emissive: Option<f32>, hard_alpha: f32, origin: usize, tails: Option<Tails>) -> Self {
        let vectors = vector_table(emissive, hard_alpha);
        // Шапка — семь строк по 16 байт: нулевая под текстуру, остальные с единицей в начале.
        let rows = 0..=vectors.len();
        let head = rows.clone().flat_map(|row| {
            let mut line = [0u8; 16];
            line[0] = if row > 0 { VECTOR_ROW } else { TEXTURE_ROW };
            if let Some(tails) = tails {
                match row.checked_sub(1) {
                    None => line[1] = tails.texture,
                    Some(k) => line[1..8].copy_from_slice(&tails.vectors[k]),
                }
            }
            line
        });
        let values = vectors.iter().flat_map(|(_, quad)| quad.iter().flat_map(|part| part.to_le_bytes()));
        let hashes = once("DiffuseSampler").chain(vectors.iter().map(|(name, _)| *name)).flat_map(|name| joaat(name).to_le_bytes());
        let bytes: Vec<u8> = head.chain(values).chain(hashes).collect();
        debug_assert_eq!(bytes.len(), at::HASHES + 4 * (vectors.len() + 1));

        let slots = rows
            .map(|row| Slot {
                relative: 0x10 * row + 0x08,
                target: match row.checked_sub(1) {
                    None => texture,
                    Some(k) => Address { segment: Segment::System, offset: origin + at::VALUES + 0x10 * k },
                },
            })
            .collect();
        Self { bytes, slots }
    }
}

/// Копия блока образца: сегмент, байты и указатели, а также номер указателя на параметры.
struct Draft {
    segment: Segment,
    bytes: Vec<u8>,
    slots: Vec<Slot>,
    params_slot: usize,
}

impl Draft {
    /// Снимает копию блока `index`; все отказы случаются здесь, до первой записи в граф.
    fn lift(graph: &Graph, index: usize) -> Result<Self> {
        let block = graph.blocks.get(index).ok_or_else(|| Error::broken("шаблон шейдера: нет такого блока"))?;
        let bytes = graph.content(index).to_vec();
        (bytes.len() >= at::FILE + 4).then_some(()).ok_or_else(|| Error::broken("шаблон шейдера короче записи шейдера"))?;
        let params_slot = block.slots.iter().position(|slot| slot.relative == 0).ok_or_else(|| Error::broken("шаблон шейдера без указателя параметров"))?;
        Ok(Self { segment: block.segment, bytes, slots: block.slots.clone(), params_slot })
    }

    /// Имя, файл, число параметров, корзина, маска корзин, длины таблицы параметров и число листов — поля, которые
    /// правятся в копии: образец мог прийти от шейдера другой корзины и другого состава.
    fn stamp(&mut self, spec: &ShaderSpec) {
        let bucket = u8::from(spec.alpha);
        let words = [
            (at::NAME, joaat(&spec.name).to_le_bytes().to_vec()),
            (at::FILE, joaat(&spec.file).to_le_bytes().to_vec()),
            (at::TABLE_BYTES, TABLE_BYTES.to_le_bytes().to_vec()),
            (at::BLOCK_BYTES, BLOCK_BYTES.to_le_bytes().to_vec()),
            (at::MASK, (0xFF00u32 | 1u32 << bucket).to_le_bytes().to_vec()),
            (at::SHEETS, vec![SHEET_COUNT]),
        ];
        for (at, word) in words {
            // у образца короче записи шейдера (проверки на таких образцах) поля за его концом не пишутся
            for (cell, byte) in self.bytes.iter_mut().skip(at).zip(word) {
                *cell = byte;
            }
        }
        self.bytes[at::COUNT] = PARAM_COUNT;
        self.bytes[at::BUCKET] = bucket;
    }
}

/// Дописывает в граф блок параметров и копию шейдера `template` с новым именем, файлом и корзиной.
/// Возвращает номер нового блока шейдера; вставкой в список группы занимается вызывающий.
pub fn shader_item(graph: &mut Graph, template: usize, spec: &ShaderSpec, texture: Address) -> Result<usize> {
    shader_item_with(graph, template, spec, texture, 1.0, false)
}

/// То же, но `HardAlphaBlend` задан вызывающим и, с `hosted`, шейдер пишется как у хоста в моделях надписи: хвосты строк шапки
/// параметров (номера регистров векторов) берутся у образца — иначе нули, которых нет ни у хоста, ни в игре. Маска корзин, длины
/// таблицы параметров и число листов пишутся по пресету всегда (`stamp`, сдача звезды и дирижаблей 18.11).
pub fn shader_item_with(graph: &mut Graph, template: usize, spec: &ShaderSpec, texture: Address, hard_alpha: f32, hosted: bool) -> Result<usize> {
    // Образец проверяется целиком до первой записи: отказ не оставляет в графе блока параметров.
    let mut draft = Draft::lift(graph, template)?;
    let tails = if hosted { Tails::of(graph, &draft) } else { None };

    let origin = graph.system.len().next_multiple_of(ALIGN);
    let Params { bytes, slots } = Params::lay_out(texture, spec.emissive, hard_alpha, origin, tails);
    let params = append_block(graph, Segment::System, bytes, slots);

    draft.slots[draft.params_slot].target = Address { segment: Segment::System, offset: graph.blocks[params].start };
    draft.stamp(spec);
    Ok(append_block(graph, draft.segment, draft.bytes, draft.slots))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{GRAPHICS_BASE, SYSTEM_BASE};
    use crate::resource_graph::from_parts;

    const SYS: Segment = Segment::System;

    fn spec(name: &str, file: &str, alpha: bool, emissive: Option<f32>) -> ShaderSpec {
        ShaderSpec { name: name.into(), file: file.into(), alpha, emissive }
    }

    fn default_spec() -> ShaderSpec {
        spec("default", "default.sps", false, None)
    }

    fn link(area: &mut [u8], at: usize, base: u64, to: usize) {
        area[at..at + 8].copy_from_slice(&(base + to as u64).to_le_bytes());
    }

    fn floats(values: [f32; 4]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    /// Корень (0x40) → шаблон на 0x40 длиной 0xc0 (узор 0xa0+i; указатели +0 на старые параметры и +0x28 на добавку),
    /// корень +8 → объект текстуры на 0x180. Возвращает граф, номер шаблона и адрес текстуры.
    fn sample(with_params: bool, in_graphics: bool) -> (Graph, usize, Address) {
        let mut sys = vec![0u8; 0x1c0];
        let mut gfx = vec![0u8; 0x60];
        link(&mut sys, 0, SYSTEM_BASE, 0x40);
        link(&mut sys, 8, SYSTEM_BASE, 0x180);
        for (area, at) in [(&mut sys, 0x40), (&mut gfx, 0x20)] {
            for i in 0..0x40 {
                area[at + i] = 0xa0u8.wrapping_add(i as u8);
            }
            if with_params {
                link(area, at, SYSTEM_BASE, 0x100);
            } else {
                area[at..at + 8].fill(0);
            }
            link(area, at + 0x28, SYSTEM_BASE, 0x140);
        }
        if in_graphics {
            link(&mut sys, 0, GRAPHICS_BASE, 0x20);
        }
        for (at, fill) in [(0x100, 0x11), (0x140, 0x22), (0x180, 0x33)] {
            sys[at..at + 0x20].fill(fill);
        }
        let graph = from_parts(165, 0, 0, sys, gfx);
        let at = if in_graphics { Address { segment: Segment::Graphics, offset: 0x20 } } else { Address { segment: SYS, offset: 0x40 } };
        let template = graph.block_at(at).expect("блок шаблона");
        (graph, template, Address { segment: SYS, offset: 0x180 })
    }

    fn slots_of(graph: &Graph, block: usize) -> Vec<(usize, Address)> {
        graph.blocks[block].slots.iter().map(|slot| (slot.relative, slot.target)).collect()
    }

    #[test]
    fn default_preset_writes_parameters_then_shader() {
        let (mut graph, template, texture) = sample(true, false);
        let before = graph.blocks.len();
        let result = shader_item(&mut graph, template, &default_spec(), texture).expect("шейдер");
        assert_eq!((result, graph.blocks.len()), (before + 1, before + 2));

        let params = result - 1;
        assert_eq!((graph.blocks[params].start, graph.content(params).len()), (0x1c0, 236));
        let mut expected = vec![(0x08, texture)];
        expected.extend((0..6).map(|k| (0x18 + 0x10 * k, Address { segment: SYS, offset: 0x230 + 0x10 * k })));
        assert_eq!(slots_of(&graph, params), expected);

        let bytes = graph.content(params);
        assert_eq!(bytes[0x70..0x80], floats([1.0, 0.0, 0.0, 1.0])[..]);
        // Четвёртый вектор без свечения — влажность [1, 0, 0, 0], а в таблице хешей её имя.
        assert_eq!(bytes[0xa0..0xb0], floats([1.0, 0.0, 0.0, 0.0])[..]);
        assert_eq!(bytes[0xd0 + 16..0xd0 + 20], joaat("wetnessMultiplier").to_le_bytes());

        let shader = graph.content(result);
        assert_eq!(shader[8..12], joaat("default").to_le_bytes());
        assert_eq!((shader[0x10], shader[0x11]), (7, 0));
        assert_eq!(shader[0x18..0x1c], joaat("default.sps").to_le_bytes());
        assert_eq!(shader[0x0c..0x10], [0xac, 0xad, 0xae, 0xaf]);
        assert_eq!(slots_of(&graph, result), vec![(0, Address { segment: SYS, offset: 0x1c0 }), (0x28, Address { segment: SYS, offset: 0x140 })]);
    }

    /// Шейдеры модели надписи: `HardAlphaBlend` задаёт вызывающий, слово масок корзин считается по корзине (`0xFF00 | 1 << корзина`;
    /// это общее правило `stamp`, а не только надписи).
    #[test]
    fn sign_shaders_carry_their_hard_alpha_and_the_mask_of_their_bucket() {
        let (mut graph, template, texture) = sample(true, false);
        // В образце слово масок — узор `0xa0 + i`: у шейдера его пишет сама запись.
        let alpha = shader_item_with(&mut graph, template, &spec("default", "alpha.sps", true, None), texture, 1.0, true).expect("alpha");
        let solid = shader_item_with(&mut graph, template, &default_spec(), texture, 0.0, true).expect("default");
        let glow = shader_item_with(&mut graph, template, &spec("emissive", "emissive.sps", false, Some(3.0)), texture, 1.0, true).expect("emissive");
        let mask = |shader: usize| u32::from_le_bytes(graph.content(shader)[0x20..0x24].try_into().unwrap());
        assert_eq!((mask(alpha), mask(solid), mask(glow)), (0xFF02, 0xFF01, 0xFF01));
        let hard = |shader: usize| graph.content(shader - 1)[0x80..0x84].to_vec();
        assert_eq!(hard(alpha), 1.0f32.to_le_bytes());
        assert_eq!(hard(solid), 0.0f32.to_le_bytes());
        assert_eq!(hard(glow), 1.0f32.to_le_bytes());
        // `shader_item` (летающие) по-прежнему пишет `HardAlphaBlend` = 1; маска у него та же, по корзине.
        let kept = shader_item(&mut graph, template, &default_spec(), texture).expect("прежний путь");
        assert_eq!(graph.content(kept)[0x20..0x24], 0xFF01u32.to_le_bytes());
        assert_eq!(graph.content(kept - 1)[0x80..0x84], 1.0f32.to_le_bytes());
    }

    /// Шейдер из настоящей игры хранит в байтах 1…7 строк шапки параметров номера регистров (`a5`…`a0` у шести векторов); блок «с нуля»
    /// писал туда нули. Шейдер надписи берёт хвосты у образца, текстуре ставит `02`, как хост; образец другой формы — нули.
    #[test]
    fn sign_shaders_take_the_register_tails_of_their_template() {
        // Шаблон на 0x40 (число параметров 7) → параметры на 0x100 (длина до 0x200): текстура и шесть векторов с регистрами.
        let mut sys = vec![0u8; 0x400];
        link(&mut sys, 0, SYSTEM_BASE, 0x40);
        link(&mut sys, 8, SYSTEM_BASE, 0x300);
        link(&mut sys, 0x10, SYSTEM_BASE, 0x200);
        link(&mut sys, 0x40, SYSTEM_BASE, 0x100);
        sys[0x40 + 0x10] = 7;
        for row in 0..7usize {
            let at = 0x100 + 16 * row;
            sys[at] = u8::from(row > 0);
            if row > 0 {
                sys[at + 1] = 0xa6 - row as u8;
                sys[at + 4] = row as u8;
            }
        }
        let mut odd_sys = sys.clone();
        odd_sys[0x40 + 0x10] = 4;
        let mut graph = from_parts(165, 0, 0, sys, Vec::new());
        let template = graph.block_at(Address { segment: SYS, offset: 0x40 }).expect("шаблон");
        let texture = Address { segment: SYS, offset: 0x300 };
        let hosted = shader_item_with(&mut graph, template, &default_spec(), texture, 0.0, true).expect("как у хоста");
        let rows = |graph: &Graph, shader: usize| graph.content(shader - 1)[..0x70].chunks(16).map(|row| (row[0], row[1], row[4])).collect::<Vec<_>>();
        assert_eq!(rows(&graph, hosted), vec![(0, 2, 0), (1, 0xa5, 1), (1, 0xa4, 2), (1, 0xa3, 3), (1, 0xa2, 4), (1, 0xa1, 5), (1, 0xa0, 6)]);
        // Без `hosted` — нули, как у летающих: их путь не менялся.
        let flyer = shader_item_with(&mut graph, template, &default_spec(), texture, 1.0, false).expect("прежний путь");
        assert_eq!(rows(&graph, flyer), vec![(0, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0)]);
        // Образец не той формы (параметров не семь) — нули и у шейдера как у хоста.
        let mut odd = from_parts(165, 0, 0, odd_sys, Vec::new());
        let template = odd.block_at(Address { segment: SYS, offset: 0x40 }).expect("шаблон");
        let shader = shader_item_with(&mut odd, template, &default_spec(), texture, 0.0, true).expect("образец другой формы");
        assert_eq!(odd.content(shader - 1)[16..18], [1, 0]);
    }

    #[test]
    fn emissive_presets_pick_the_emissive_name_and_bucket() {
        let (mut graph, template, texture) = sample(true, false);
        let glow = spec("emissive", "emissive_alpha.sps", true, Some(2.5));
        let result = shader_item(&mut graph, template, &glow, texture).expect("шейдер");
        let bytes = graph.content(result - 1);
        assert_eq!(bytes[0xa0..0xa4], 2.5f32.to_le_bytes());
        assert_eq!(bytes[0xd0 + 16..0xd0 + 20], joaat("emissiveMultiplier").to_le_bytes());
        let shader = graph.content(result);
        assert_eq!((shader[0x10], shader[0x11]), (7, 1));
        assert_eq!(shader[8..12], joaat("emissive").to_le_bytes());
        assert_eq!(shader[0x18..0x1c], 0x0aaf_1851u32.to_le_bytes());
    }

    /// Поля шейдера, по которым играет игра, а слепок XML их не показывает (проверка в GTA V 17.11.2026, навес с прозрачностью):
    /// маска корзин (`0xFF00` и бит корзины), длины таблицы параметров (семь строк и шесть векторов по 16 байт; блок с хешами и
    /// 32 служебными, кратно 16) и число листов. Образец от шейдера другой корзины не должен приносить свою маску.
    #[test]
    fn bucket_mask_param_lengths_and_sheet_count_follow_the_preset() {
        let presets = [
            (spec("default", "default.sps", false, None), 0xFF01u32),
            (spec("default", "alpha.sps", true, None), 0xFF02),
            (spec("emissive", "emissive.sps", false, Some(2.0)), 0xFF01),
            (spec("emissive", "emissive_alpha.sps", true, Some(1.5)), 0xFF02),
        ];
        for (preset, mask) in presets {
            let (mut graph, template, texture) = sample(true, false);
            // образец пришёл от шейдера другой корзины и другого состава: в узоре 0xa0 + i маска `0xa8a9aaab`, длины `0xb4b5`/`0xb6b7`
            let result = shader_item(&mut graph, template, &preset, texture).expect("шейдер");
            let shader = graph.content(result);
            assert_eq!(u32::from_le_bytes(shader[0x20..0x24].try_into().unwrap()), mask, "маска корзины у {preset:?}");
            assert_eq!(u16::from_le_bytes(shader[0x14..0x16].try_into().unwrap()), 208, "длина таблицы у {preset:?}");
            assert_eq!(u16::from_le_bytes(shader[0x16..0x18].try_into().unwrap()), 272, "длина блока параметров у {preset:?}");
            assert_eq!(shader[0x27], 1, "число листов у {preset:?}");
            // прочие байты образца остаются теми, что были
            assert_eq!(shader[0x12..0x14], [0xb2, 0xb3]);
            assert_eq!(shader[0x31], 0xd1);
        }
    }

    #[test]
    fn emissive_value_is_written_as_is() {
        for value in [f32::NAN, -0.0, f32::MAX, f32::INFINITY, 0.0, -3.5] {
            let (mut graph, template, texture) = sample(true, false);
            let result = shader_item(&mut graph, template, &spec("emissive", "emissive.sps", false, Some(value)), texture).expect("шейдер");
            assert_eq!(graph.content(result - 1)[0xa0..0xa4], value.to_le_bytes());
        }
    }

    #[test]
    fn names_are_hashed_without_case() {
        let (mut graph, template, texture) = sample(true, false);
        for (name, file, hashes) in [("DEFAULT", "DEFAULT.SPS", (0xe4df_46d5u32, 0x18ad_1594u32)), ("", "", (0, 0))] {
            let result = shader_item(&mut graph, template, &spec(name, file, false, None), texture).expect("шейдер");
            let shader = graph.content(result);
            assert_eq!(shader[8..12], hashes.0.to_le_bytes());
            assert_eq!(shader[0x18..0x1c], hashes.1.to_le_bytes());
        }
    }

    #[test]
    fn texture_address_is_not_checked_here() {
        let (mut graph, template, _) = sample(true, false);
        let far = Address { segment: SYS, offset: 0x9999 };
        shader_item(&mut graph, template, &default_spec(), far).expect("шейдер");
        // Отказывает только сборка файла: указатель ведёт мимо блоков.
        let failure = crate::drawable_write::finish(&graph).expect_err("сборка");
        assert_eq!(failure.message, "Указатель вне блоков.");
    }

    #[test]
    fn missing_parameter_pointer_is_refused_and_leaves_the_graph_alone() {
        let (mut graph, template, texture) = sample(false, false);
        let (blocks, area) = (graph.blocks.len(), graph.system.len());
        let failure = shader_item(&mut graph, template, &default_spec(), texture).expect_err("отказ");
        assert_eq!(failure.message, "шаблон шейдера без указателя параметров");
        assert_eq!((graph.blocks.len(), graph.system.len()), (blocks, area));
    }

    #[test]
    fn short_template_or_unknown_block_is_refused_before_anything_is_added() {
        for (len, refused) in [(16, true), (24, true), (27, true), (28, false)] {
            // Шаблон ровно `len` байт: следующий блок начинается сразу за ним.
            let mut sys = vec![0u8; 0x100];
            link(&mut sys, 0, SYSTEM_BASE, 0x20);
            link(&mut sys, 8, SYSTEM_BASE, 0x20 + len);
            link(&mut sys, 0x20, SYSTEM_BASE, 0x20 + len);
            let mut graph = from_parts(165, 0, 0, sys, Vec::new());
            let template = graph.block_at(Address { segment: SYS, offset: 0x20 }).expect("шаблон");
            assert_eq!(graph.content(template).len(), len);
            let texture = Address { segment: SYS, offset: 0x20 + len };
            let (blocks, area) = (graph.blocks.len(), graph.system.len());
            let outcome = shader_item(&mut graph, template, &default_spec(), texture);
            if refused {
                assert_eq!(outcome.expect_err("отказ").message, "шаблон шейдера короче записи шейдера", "длина {len}");
                assert_eq!((graph.blocks.len(), graph.system.len()), (blocks, area), "длина {len}");
            } else {
                outcome.expect("шейдер");
                assert_eq!(graph.blocks.len(), blocks + 2);
            }
        }
        let (mut graph, _, texture) = sample(true, false);
        let (blocks, area) = (graph.blocks.len(), graph.system.len());
        let refused = shader_item(&mut graph, 99_999, &default_spec(), texture).expect_err("отказ");
        assert_eq!(refused.message, "шаблон шейдера: нет такого блока");
        assert_eq!((graph.blocks.len(), graph.system.len()), (blocks, area));
    }

    #[test]
    fn graphics_template_keeps_its_segment() {
        let (mut graph, template, texture) = sample(true, true);
        let result = shader_item(&mut graph, template, &default_spec(), texture).expect("шейдер");
        assert_eq!(graph.blocks[result - 1].segment, SYS);
        assert_eq!(graph.blocks[result].segment, Segment::Graphics);
        assert_eq!(slots_of(&graph, result)[0], (0, Address { segment: SYS, offset: 0x1c0 }));
    }

    #[test]
    fn repeated_calls_make_independent_pairs() {
        let (mut graph, template, texture) = sample(true, false);
        let first = shader_item(&mut graph, template, &default_spec(), texture).expect("первый");
        let second = shader_item(&mut graph, template, &spec("emissive", "emissive.sps", false, Some(2.5)), texture).expect("второй");
        assert_eq!((first, second), (7, 9));
        assert_eq!(graph.blocks[8].start, 0x370);
        assert_eq!(slots_of(&graph, 8)[1].1.offset, 0x3e0);
        assert_eq!(slots_of(&graph, 9)[0].1.offset, 0x370);
    }

    #[test]
    fn spec_compares_by_fields() {
        let base = default_spec();
        assert_eq!(base, base.clone());
        assert_ne!(base, ShaderSpec { alpha: true, ..base.clone() });
        let nan = ShaderSpec { emissive: Some(f32::NAN), ..base.clone() };
        assert_ne!(nan, nan.clone());
        assert_eq!(ShaderSpec { emissive: Some(0.0), ..base.clone() }, ShaderSpec { emissive: Some(-0.0), ..base });
    }
}
