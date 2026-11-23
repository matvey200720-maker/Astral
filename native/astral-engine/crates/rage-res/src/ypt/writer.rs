//! Запись в `core.ypt` Legacy: подмена байтов ступеней текстур в словаре
//! текстур ядра.
//!
//! Новые байты ложатся поверх прежних на том же месте: структура и указатели
//! не меняются, раскладка текстуры обязана совпасть. После правки ресурс
//! собирается заново через граф блоков, а готовый результат проверяется
//! перечитыванием. Неизменённый ресурс сюда не должен попадать: пересборка даёт
//! другие байты, чем вход (иное сжатие, области выровнены по страницам).

use miniz_oxide::inflate::core::{decompress, inflate_flags, DecompressorOxide};
use std::borrow::Cow;
use std::ops::Range;

use super::layout::lengths;
use super::{read, Core};
use crate::dds::{self, Dds};
use crate::error::{Error, Result};
use crate::resource::{Resource, HEADER_BYTES};
use crate::resource_graph::{
    append_block, identity_order, rebuild, repack, scan, write_at, Address, Block, Graph, Slot,
    Segment,
};
use crate::texture::{Format, TextureRef};

/// Правка одной текстуры: имя в словаре и целый файл DDS.
#[derive(Debug, Clone)]
pub struct TexturePatch {
    pub texture: String,
    pub dds: Vec<u8>,
}

/// Как собирается результат: на прежних местах блоков или только то, что
/// описано схемой ядра.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout {
    Identity,
    Structured,
}

/// Байт, который замыкает область структурной раскладки.
const TAIL_MARK: u8 = 1;
const MSG_CUT_BODY: &str = "Ресурс короче заявленного: разбирать нечего.";

/// Выход пересборки: байты файла и сколько настоящих указателей в нём ждём
/// (`None` — не сверять).
type Assembled = (Vec<u8>, Option<usize>);

/// Правки в том виде, в каком их принесли.
enum Edits<'a> {
    /// Готовые байты ступеней: имя и данные.
    Payloads(&'a [(String, Vec<u8>)]),
    /// Файлы DDS: раскладка сверяется с текстурой ядра.
    Dds(&'a [TexturePatch]),
}

/// Раскладка ступеней: размеры, число ступеней, формат и длина байтов.
#[derive(PartialEq)]
struct Shape {
    width: u32,
    height: u32,
    levels: u32,
    format: Option<Format>,
    bytes: usize,
}

impl Shape {
    fn of_texture(texture: &TextureRef) -> Shape {
        Shape {
            width: texture.width,
            height: texture.height,
            levels: texture.levels,
            format: texture.format,
            bytes: texture.bytes,
        }
    }

    fn of_dds(image: &Dds) -> Shape {
        Shape {
            width: image.width,
            height: image.height,
            levels: u32::from(image.levels),
            format: Some(image.format),
            bytes: image.payload.len(),
        }
    }

    /// Текст отказа: как выглядит текстура ядра `name`, с которой DDS не сошёлся.
    fn refusal(&self, name: &str) -> String {
        let Shape {
            width,
            height,
            levels,
            bytes,
            ..
        } = self;
        format!(
            "Раскладка DDS не совпадает с текстурой ядра: {name} ({width}×{height}, ступеней {levels}, {bytes} байт)."
        )
    }
}

/// Файл ядра, разобранный до словаря текстур.
struct Opened {
    res: Resource,
    core: Core,
}

/// Хватает ли тела файла на весь заявленный объём. Разбор ресурса при обрыве
/// потока отдаёт буфер, добитый нулями, и принимает его за целый; писатель
/// собрал бы из него файл с обнулённым хвостом, поэтому здесь число
/// настоящих распакованных байт считается отдельно. Потерянный только маркер
/// конца потока при полном объёме не мешает.
fn body_covers_declared(file: &[u8], res: &Resource) -> bool {
    let declared = res.header.system_size + res.header.graphics_size;
    let mut sink = vec![0u8; declared.max(1)];
    let mut state = DecompressorOxide::new();
    let (_, _, produced) = decompress(
        &mut state,
        &file[HEADER_BYTES..],
        &mut sink,
        0,
        inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
    );
    produced >= declared
}

impl Opened {
    fn parse(bytes: &[u8]) -> Result<Opened> {
        // Быстрый путь разбора сам доказывает, что байтов хватило: вторая распаковка нужна
        // только оборванным и необычным потокам.
        let (res, proven) = Resource::parse_proven(bytes)?;
        if !proven && !body_covers_declared(bytes, &res) {
            return Err(Error::broken(MSG_CUT_BODY));
        }
        let core = read(&res)?;
        Ok(Opened { res, core })
    }

    /// Позиция в данных ресурса как область и смещение в ней.
    fn split(&self, at: usize) -> (Segment, usize) {
        match at.checked_sub(self.res.header.system_size) {
            None => (Segment::System, at),
            Some(offset) => (Segment::Graphics, offset),
        }
    }

    /// Область и промежуток `[от, до)` для `length` байт, начиная с позиции `at`.
    fn span(&self, at: usize, length: usize) -> (Segment, usize, usize) {
        let (segment, from) = self.split(at);
        (segment, from, from + length)
    }

    /// Первая текстура словаря, чьё имя совпало с именем правки.
    fn texture_for(&self, patch_name: &str) -> Option<&TextureRef> {
        self.core
            .textures
            .iter()
            .find(|texture| names_agree(patch_name, &texture.name))
    }

    /// Промежутки ступеней всех текстур, у которых есть данные.
    fn pixel_spans(&self) -> impl Iterator<Item = (Segment, usize, usize)> + '_ {
        self.core.textures.iter().filter_map(|texture| {
            let at = texture.data_at.filter(|_| texture.bytes > 0)?;
            Some(self.span(at, texture.bytes))
        })
    }

    /// Байты ступеней текстуры; нет указателя или данных — `None`.
    fn pixels(&self, texture: &TextureRef) -> Option<&[u8]> {
        self.res.bytes(texture.data_at?, texture.bytes).ok()
    }
}

/// Имя правки (без пробелов по краям) и имя в словаре совпадают, если равны
/// с точностью до регистра ASCII.
fn names_agree(patch_name: &str, texture_name: &str) -> bool {
    texture_name.eq_ignore_ascii_case(patch_name.trim())
}

fn unknown_texture(name: &str) -> Error {
    Error::broken(format!("Текстуры {name} нет в словаре ядра."))
}

/// Падает с текстом, если условие не выполнено.
fn require(holds: bool, text: impl FnOnce() -> String) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(Error::broken(text()))
    }
}

fn count_words(graph: &Graph) -> usize {
    graph.blocks.iter().fold(0, |sum, block| sum + block.slots.len())
}

/// Граф, в котором оставлены только слова-указатели, одобренные `keep`.
/// Блоки не двигаются: меняются лишь их списки слов.
fn keep_words(mut graph: Graph, keep: impl Fn(&Block, &Slot) -> bool) -> Graph {
    let blocks = std::mem::take(&mut graph.blocks);
    graph.blocks = blocks
        .into_iter()
        .map(|block| {
            let slots = block
                .slots
                .iter()
                .filter(|slot| keep(&block, slot))
                .copied()
                .collect();
            Block { slots, ..block }
        })
        .collect();
    graph
}

/// Слова внутри ступеней, похожие на указатели, указателями не считаются:
/// пиксели при пересборке остаются как были.
fn pixel_free(graph: Graph, opened: &Opened) -> Graph {
    let mut lanes: [Vec<Range<usize>>; 2] = Default::default();
    for (segment, from, to) in opened.pixel_spans() {
        lanes[segment as usize].push(from..to);
    }
    keep_words(graph, |block, slot| {
        let word = block.start + slot.relative;
        !lanes[block.segment as usize]
            .iter()
            .any(|span| span.contains(&word))
    })
}

/// Пишет ступени в блок текстуры; байты текстуры целиком должны лежать в одном блоке.
fn put_pixels(
    graph: &mut Graph,
    opened: &Opened,
    texture: &TextureRef,
    payload: &[u8],
    shorter_is_whole: bool,
) -> Result<()> {
    let name = &texture.name;
    let Some(data_at) = texture.data_at else {
        return Err(Error::broken(format!("Текстура {name}: нет данных.")));
    };
    let (segment, offset) = opened.split(data_at);
    let Some(block) = graph.block_at(Address { segment, offset }) else {
        return Err(Error::broken(format!(
            "Текстура {name}: байты вне блоков ресурса."
        )));
    };
    // Сколько байт блока лежит до начала текстуры и сколько от неё до конца блока.
    let host = &graph.blocks[block];
    let (behind, ahead) = (offset - host.start, host.end - offset);
    // DDS в раскладке помощника короче длины «по блокам» у двух листов ядра: целым считается он, не лишние байты за ним.
    let length = if shorter_is_whole {
        payload.len().min(texture.bytes)
    } else {
        texture.bytes
    };
    require(length <= ahead, || {
        format!("Текстура {name}: байты переходят за блок.")
    })?;
    write_at(graph, block, behind, payload)
}

/// За данными каждой непустой области ставится байт-замыкание: без него хвост
/// из нулей обрезается вместе с блоками.
fn seal_tails(graph: &mut Graph) {
    let areas = [Segment::System, Segment::Graphics];
    let filled = areas.map(|segment| !graph.bytes(segment).is_empty());
    areas
        .into_iter()
        .zip(filled)
        .filter(|&(_, filled)| filled)
        .for_each(|(segment, _)| {
            append_block(graph, segment, [TAIL_MARK].to_vec(), Vec::new());
        });
}

/// Структурная раскладка: в выход идут ступени и объекты из карты длин.
/// `None`, если перенос не сошёлся.
fn carve(opened: &Opened, graph: &Graph) -> Result<Option<Vec<u8>>> {
    let found = lengths(&opened.res)?;
    let wanted: Vec<(Segment, usize, usize)> = found
        .objects
        .iter()
        .map(|(&at, &length)| opened.span(at, length))
        .chain(opened.pixel_spans())
        .collect();

    // Слова-хеши имён свойств ключевых кадров указателями не считаются.
    let working = keep_words(graph.clone(), |block, slot| {
        let word = block.start + slot.relative;
        block.segment != Segment::System
            || !found.name_hashes.iter().any(|at| (word..word + 8).contains(at))
    });

    let Ok((mut moved, _)) = repack(&working, &wanted) else {
        return Ok(None);
    };
    seal_tails(&mut moved);
    let [system, graphics] = [Segment::System, Segment::Graphics].map(|s| identity_order(&moved, s));
    rebuild(&moved, &system, &graphics).map(Some)
}

/// Перечитывает результат: словарь, указатели, метаданные и байты ступеней.
fn confirm(
    before: &Opened,
    output: &[u8],
    patches: &[(String, Vec<u8>)],
    pointers: Option<usize>,
    shorter_is_whole: bool,
) -> Result<()> {
    let after = Opened::parse(output)?;
    require(
        before.core.textures.len() == after.core.textures.len(),
        || "После записи словарь текстур другой длины.".to_string(),
    )?;
    if let Some(expected) = pointers {
        let found = count_words(&pixel_free(scan(&after.res)?, &after));
        require(found == expected, || {
            format!(
                "После записи число указателей ресурса другое: ожидалось {expected}, найдено {found}."
            )
        })?;
    }
    for (old, new) in before.core.textures.iter().zip(&after.core.textures) {
        // Число ступеней и глубина сюда не входят: сверяются имя, размеры, формат и длина.
        let facts = |t: &TextureRef| (t.name.clone(), t.width, t.height, t.format, t.bytes);
        require(facts(old) == facts(new), || {
            format!("После записи текстура {} изменила метаданные.", old.name)
        })?;
        let written = after.pixels(new);
        match patches.iter().find(|(name, _)| names_agree(name, &new.name)) {
            Some((_, payload)) => {
                let wanted = &payload[..payload.len().min(new.bytes)];
                // У DDS в раскладке помощника сверяется записанное им начало листа; хвост ядра остаётся как был.
                let seen = written.map(|all| if shorter_is_whole { &all[..wanted.len()] } else { all });
                require(seen == Some(wanted), || {
                    format!("После записи {} не совпадает с DDS.", new.name)
                })?;
            }
            None => require(written == before.pixels(old), || {
                format!("Текстура {} изменилась без правки.", old.name)
            })?,
        }
    }
    Ok(())
}

/// Какие из правок повторяют имя более ранней (имена сравниваются как при поиске текстуры).
fn repeat_flags(patches: &[(String, Vec<u8>)]) -> Vec<bool> {
    patches
        .iter()
        .scan(Vec::<String>::new(), |keys, (name, _)| {
            let key = name.trim().to_ascii_lowercase();
            let repeated = keys.contains(&key);
            keys.push(key);
            Some(repeated)
        })
        .collect()
}

/// Разбирает DDS правки и сверяет раскладку с текстурой словаря.
fn vet_dds(before: &Opened, patch: &TexturePatch) -> Result<(String, Vec<u8>)> {
    let image = dds::parse_helper_layout(&patch.dds)?;
    let texture = before
        .texture_for(&patch.texture)
        .ok_or_else(|| unknown_texture(&patch.texture))?;
    // Длина ступеней в ядре — как её считает помощник: мелкие ступени без округления до блока 4×4, а у неквадратной
    // цепочки последняя ступень нулевой высоты и не занимает ничего. У 105 листов из 107 это то же число, что по блокам;
    // у `ptfx_blood_spurt` (699 050 вместо 699 088 байт) и `ptfx_insects_rgb` (1 398 101 вместо 1 398 128) — меньше.
    // Файл DDS приложения (`yptTextureDds`) несёт именно такую длину; DDS «по блокам» помощник отказывает
    // («DDS layout must match the existing YPT texture exactly»), а движок писал его на 38 байт дальше конца листа —
    // в соседний лист или за конец блока (сверка 16.11.2026).
    let mut ours = Shape::of_texture(texture);
    if let Some(format) = texture.format {
        ours.bytes = format.helper_total_bytes(texture.width, texture.height, texture.levels);
    }
    require(Shape::of_dds(&image) == ours, || ours.refusal(&texture.name))?;
    Ok((patch.texture.clone(), image.payload))
}

/// Единая точка входа: правит ступени, собирает файл заново и проверяет результат.
fn edit(input: &[u8], edits: Edits<'_>, strict: bool, layout: Layout) -> Result<Vec<u8>> {
    let before = Opened::parse(input)?;
    // Длину DDS уже сверил `vet_dds` (по листу ядра в раскладке помощника); у готовых байтов она обязана равняться длине по блокам.
    let from_dds = matches!(edits, Edits::Dds(_));
    let patches: Cow<'_, [(String, Vec<u8>)]> = match edits {
        Edits::Payloads(list) => Cow::Borrowed(list),
        Edits::Dds(list) => Cow::Owned(
            list.iter()
                .map(|patch| vet_dds(&before, patch))
                .collect::<Result<Vec<_>>>()?,
        ),
    };

    let mut graph = pixel_free(scan(&before.res)?, &before);
    for ((name, payload), repeated) in patches.iter().zip(repeat_flags(&patches)) {
        if repeated {
            return Err(Error::broken(format!("Текстура {name} правится дважды.")));
        }
        let texture = before
            .texture_for(name)
            .ok_or_else(|| unknown_texture(name))?;
        require(!strict || from_dds || texture.bytes == payload.len(), || {
            format!(
                "Длина ступеней не совпадает с текстурой ядра: {} ({} байт, пришло {}).",
                texture.name,
                texture.bytes,
                payload.len()
            )
        })?;
        put_pixels(&mut graph, &before, texture, payload, from_dds)?;
    }

    let carved = match layout {
        Layout::Structured => carve(&before, &graph)?,
        Layout::Identity => None,
    };
    let (bytes, pointers): Assembled = match carved {
        Some(bytes) => (bytes, None),
        None => {
            let [system, graphics] =
                [Segment::System, Segment::Graphics].map(|s| identity_order(&graph, s));
            (rebuild(&graph, &system, &graphics)?, Some(count_words(&graph)))
        }
    };
    confirm(&before, &bytes, &patches, pointers, from_dds)?;
    Ok(bytes)
}

/// Подмена ступеней файлами DDS с раскладкой «как есть».
pub fn patch_textures(input: &[u8], patches: &[TexturePatch]) -> Result<Vec<u8>> {
    edit(input, Edits::Dds(patches), true, Layout::Identity)
}

/// Подмена ступеней файлами DDS: раскладка DDS обязана совпасть с текстурой ядра.
pub fn patch_textures_with(
    input: &[u8],
    patches: &[TexturePatch],
    layout: Layout,
) -> Result<Vec<u8>> {
    edit(input, Edits::Dds(patches), true, layout)
}

/// Подмена ступеней по готовым байтам (без DDS) с раскладкой «как есть».
pub fn patch_payloads(
    input: &[u8],
    patches: &[(String, Vec<u8>)],
    strict: bool,
) -> Result<Vec<u8>> {
    edit(input, Edits::Payloads(patches), strict, Layout::Identity)
}

/// Подмена ступеней по готовым байтам. При `strict` длина обязана совпасть с
/// текстурой; без него короче или длиннее проходит запись, но не проверка.
pub fn patch_payloads_with(
    input: &[u8],
    patches: &[(String, Vec<u8>)],
    strict: bool,
    layout: Layout,
) -> Result<Vec<u8>> {
    edit(input, Edits::Payloads(patches), strict, layout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::resource::{Header, GRAPHICS_BASE, SYSTEM_BASE};

    const SYSTEM: usize = 0x1000;
    const GRAPHICS: usize = 0x400;
    const DXT1: u32 = 0x3154_5844;
    const DXT5: u32 = 0x3554_5844;

    fn pattern(len: usize, seed: u8) -> Vec<u8> {
        (0..len)
            .map(|i| (i as u8).wrapping_mul(37).wrapping_add(seed))
            .collect()
    }

    /// Ядро с двумя текстурами: `tex_a` (DXT1 8×8, 32 байта) и `Tex_B`
    /// (DXT5 16×16 с двумя ступенями, 320 байт); `tweak` правит образ до упаковки.
    fn core_file(tweak: impl FnOnce(&mut [u8])) -> Vec<u8> {
        let mut data = vec![0u8; SYSTEM + GRAPHICS];
        let word = |data: &mut Vec<u8>, at: usize, value: u64| {
            data[at..at + 8].copy_from_slice(&value.to_le_bytes());
        };
        word(&mut data, 0x10, SYSTEM_BASE + 0x100);
        data[0x100..0x108].copy_from_slice(b"core_syn");
        word(&mut data, 0x20, SYSTEM_BASE + 0x120);
        word(&mut data, 0x120 + 0x30, SYSTEM_BASE + 0x160);
        // число и ёмкость списка текстур
        data[0x120 + 0x38..0x120 + 0x3C].copy_from_slice(&[2, 0, 2, 0]);
        let specs = [
            ("tex_a", 8u16, 8u16, DXT1, 1u8, 0usize, 32usize),
            ("Tex_B", 16, 16, DXT5, 2, 32, 320),
        ];
        for (n, (name, w, h, format, levels, at, len)) in specs.into_iter().enumerate() {
            let object = 0x200 + n * 0x80;
            word(&mut data, 0x160 + n * 8, SYSTEM_BASE + object as u64);
            let text = 0x500 + n * 0x20;
            data[text..text + name.len()].copy_from_slice(name.as_bytes());
            word(&mut data, object + 0x28, SYSTEM_BASE + text as u64);
            data[object + 0x50..object + 0x52].copy_from_slice(&w.to_le_bytes());
            data[object + 0x52..object + 0x54].copy_from_slice(&h.to_le_bytes());
            data[object + 0x54..object + 0x56].copy_from_slice(&1u16.to_le_bytes());
            data[object + 0x58..object + 0x5C].copy_from_slice(&format.to_le_bytes());
            data[object + 0x5D] = levels;
            word(&mut data, object + 0x70, GRAPHICS_BASE + at as u64);
            let pixels = pattern(len, n as u8 + 1);
            data[SYSTEM + at..SYSTEM + at + len].copy_from_slice(&pixels);
        }
        tweak(&mut data);
        let header = Header {
            system_flags: 0x4100_0000,
            graphics_flags: 0x4400_0000,
            system_size: SYSTEM,
            graphics_size: GRAPHICS,
            version: 68,
            declared_version: 68,
        };
        Resource::from_parts(header, data).to_file_bytes().unwrap()
    }

    /// Ступени текстуры по имени из готового файла.
    fn pixels_of(file: &[u8], name: &str) -> Vec<u8> {
        let res = Resource::parse(file).unwrap();
        let core = read(&res).unwrap();
        let texture = core.textures.iter().find(|t| t.name == name).unwrap();
        res.bytes(texture.data_at.unwrap(), texture.bytes)
            .unwrap()
            .to_vec()
    }

    fn dds_of(fourcc: &[u8; 4], side: u32, mips: u32, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; 128];
        out[..4].copy_from_slice(b"DDS ");
        let fields = [(4, 124), (8, 0x21007), (12, side), (16, side), (28, mips)];
        for (at, value) in fields {
            out[at..at + 4].copy_from_slice(&u32::to_le_bytes(value));
        }
        out[84..88].copy_from_slice(fourcc);
        out.extend_from_slice(payload);
        out
    }

    fn pair(name: &str, payload: Vec<u8>) -> (String, Vec<u8>) {
        (name.to_string(), payload)
    }

    #[test]
    fn repacking_without_patches_keeps_every_texture() {
        let file = core_file(|_| {});
        let out = patch_payloads(&file, &[], false).unwrap();
        assert_eq!(out, patch_textures(&file, &[]).unwrap());
        assert_ne!(out, file);
        for name in ["tex_a", "Tex_B"] {
            assert_eq!(pixels_of(&out, name), pixels_of(&file, name));
        }
    }

    #[test]
    fn a_patch_lands_on_its_texture_and_nowhere_else() {
        let file = core_file(|_| {});
        let fresh = pattern(32, 99);
        let out = patch_payloads(&file, &[pair(" TEX_A ", fresh.clone())], true).unwrap();
        assert_eq!(pixels_of(&out, "tex_a"), fresh);
        assert_eq!(pixels_of(&out, "Tex_B"), pixels_of(&file, "Tex_B"));
    }

    /// Лист 16×8 с четырьмя ступенями: у ядра игры так лежат `ptfx_blood_spurt` и `ptfx_insects_rgb` (неквадратная цепочка,
    /// последняя ступень нулевой высоты), а приложение собирает DDS ядру без округления мелких ступеней до блока:
    /// 170 байт, не 192. Движок отказывал таким DDS «нужно 192» (сверка 16.11.2026 на ядре update.rpf).
    #[test]
    fn a_dds_in_the_helper_layout_lands_on_a_non_square_sheet() {
        let file = core_file(|data| {
            let object = 0x200 + 0x80;
            data[object + 0x52..object + 0x54].copy_from_slice(&8u16.to_le_bytes());
            data[object + 0x5D] = 4;
        });
        let fresh = pattern(170, 5);
        let mut image = dds_of(b"DXT5", 16, 4, &fresh);
        image[12..16].copy_from_slice(&8u32.to_le_bytes());
        let patch = TexturePatch {
            texture: "Tex_B".into(),
            dds: image,
        };
        let out = patch_textures(&file, &[patch]).unwrap();
        // Записаны ровно 170 байт начала листа; хвост до длины «по блокам» (192) остался прежним.
        let (was, now) = (pixels_of(&file, "Tex_B"), pixels_of(&out, "Tex_B"));
        assert_eq!((was.len(), now.len()), (192, 192));
        assert_eq!(now[..170], fresh[..]);
        assert_eq!(now[170..], was[170..]);
        assert_eq!(pixels_of(&out, "tex_a"), pixels_of(&file, "tex_a"));
        // DDS «по блокам» (192 байта) тому же листу помощник отказывает, и движок тоже: он писал бы за конец листа.
        let mut by_blocks = dds_of(b"DXT5", 16, 4, &pattern(192, 6));
        by_blocks[12..16].copy_from_slice(&8u32.to_le_bytes());
        let refused = patch_textures(
            &file,
            &[TexturePatch {
                texture: "Tex_B".into(),
                dds: by_blocks,
            }],
        )
        .unwrap_err();
        assert!(refused.message.contains("Раскладка DDS не совпадает"), "{}", refused.message);
    }

    #[test]
    fn a_dds_with_the_same_layout_is_written_and_another_is_refused() {
        let file = core_file(|_| {});
        let fresh = pattern(32, 7);
        let patch = TexturePatch {
            texture: "tex_a".into(),
            dds: dds_of(b"DXT1", 8, 1, &fresh),
        };
        let out = patch_textures(&file, &[patch]).unwrap();
        assert_eq!(pixels_of(&out, "tex_a"), fresh);

        let narrow = TexturePatch {
            texture: "tex_a".into(),
            dds: dds_of(b"DXT1", 4, 1, &pattern(8, 7)),
        };
        let err = patch_textures(&file, &[narrow]).unwrap_err();
        assert_eq!(
            err.message,
            "Раскладка DDS не совпадает с текстурой ядра: tex_a (8×8, ступеней 1, 32 байт)."
        );
    }

    #[test]
    fn refusals_name_the_texture_as_the_caller_wrote_it() {
        let file = core_file(|_| {});
        let refused = |patches: &[(String, Vec<u8>)]| {
            patch_payloads(&file, patches, true).unwrap_err().message
        };
        assert_eq!(
            refused(&[pair(" Nope ", vec![])]),
            "Текстуры  Nope  нет в словаре ядра."
        );
        assert_eq!(
            refused(&[pair("tex_a", pattern(31, 1))]),
            "Длина ступеней не совпадает с текстурой ядра: tex_a (32 байт, пришло 31)."
        );
        assert_eq!(
            refused(&[pair("tex_a", pattern(32, 1)), pair("TEX_A", vec![1])]),
            "Текстура TEX_A правится дважды."
        );
        // без строгой длины короткая правка доходит до проверки результата
        let loose = patch_payloads(&file, &[pair("tex_a", pattern(31, 1))], false).unwrap_err();
        assert_eq!(loose.kind, Kind::Broken);
        assert_eq!(loose.message, "После записи tex_a не совпадает с DDS.");
    }

    #[test]
    fn foreign_files_are_refused_before_any_edit() {
        let err = patch_payloads(b"short", &[], false).unwrap_err();
        assert_eq!(err.message, "Ресурс короче заголовка RSC7.");
        let mut broken = core_file(|_| {});
        broken[0] = b'X';
        let err = patch_payloads(&broken, &[], false).unwrap_err();
        assert_eq!(err.message, "Файл не является ресурсом RSC7.");
    }

    #[test]
    fn the_structured_layout_keeps_the_pixels_and_is_off_by_default() {
        assert_ne!(Layout::Identity, Layout::Structured);
        let file = core_file(|_| {});
        let fresh = pattern(32, 55);
        let patches = [pair("tex_a", fresh.clone())];
        let out = patch_payloads_with(&file, &patches, true, Layout::Structured).unwrap();
        assert_eq!(pixels_of(&out, "tex_a"), fresh);
        assert_eq!(pixels_of(&out, "Tex_B"), pixels_of(&file, "Tex_B"));
        let plain = patch_payloads_with(&file, &patches, true, Layout::Identity).unwrap();
        assert_eq!(plain, patch_payloads(&file, &patches, true).unwrap());
    }

    #[test]
    fn a_body_cut_short_is_refused_and_never_repacked_with_zeros() {
        // Разбор ресурса при обрыве потока отдаёт буфер, добитый нулями; если он не
        // короче заявленного объёма, ресурс считался целым, и писатель собирал файл,
        // в котором ступени текстур, не успевшие распаковаться, стали нулями.
        let file = core_file(|_| {});
        let original = Resource::parse(&file).unwrap();
        let padded = (17..file.len()).find(|&cut| {
            Resource::parse(&file[..cut])
                .map(|cut_res| cut_res.complete && cut_res.data() != original.data())
                .unwrap_or(false)
        });
        let padded = padded.expect("есть обрыв, который разбор принимает за целый ресурс");
        let err = patch_payloads(&file[..padded], &[], false).unwrap_err();
        assert_eq!(err.kind, Kind::Broken);
        assert_eq!(err.message, "Ресурс короче заявленного: разбирать нечего.");

        // что бы ни принял писатель, ступени остаются прежними
        for cut in 17..file.len() {
            let Ok(out) = patch_payloads(&file[..cut], &[], false) else {
                continue;
            };
            for name in ["tex_a", "Tex_B"] {
                assert_eq!(pixels_of(&out, name), pixels_of(&file, name), "обрыв на {cut}");
            }
        }
    }

    #[test]
    fn a_pointer_like_word_inside_pixels_stays_a_pixel() {
        // слово, похожее на указатель в графику, лежит внутри ступеней `tex_a`
        let file = core_file(|data| {
            let at = SYSTEM + 8;
            data[at..at + 8].copy_from_slice(&(GRAPHICS_BASE + 0x10).to_le_bytes());
        });
        let out = patch_payloads(&file, &[], false).unwrap();
        assert_eq!(pixels_of(&out, "tex_a"), pixels_of(&file, "tex_a"));
        // Такое слово не делит блок пикселей (до 18.11.2026 делило, и правка этой текстуры отказывалась словами «байты переходят
        // за блок»): разбор графа не ищет указатели в пикселях обычных текстур. Правка проходит, соседняя текстура не тронута.
        let patched = patch_payloads(&file, &[pair("tex_a", pattern(32, 3))], true).unwrap();
        assert_eq!(pixels_of(&patched, "tex_a"), pattern(32, 3));
        assert_eq!(pixels_of(&patched, "Tex_B"), pixels_of(&file, "Tex_B"));
        let other = patch_payloads(&file, &[pair("Tex_B", pattern(320, 3))], true).unwrap();
        assert_eq!(pixels_of(&other, "Tex_B"), pattern(320, 3));
        assert_eq!(pixels_of(&other, "tex_a"), pixels_of(&file, "tex_a"));
    }
}
