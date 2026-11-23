//! Служебные слова моделей: «голова» по `+0x00` и размер блоков моделей по `+0x9A`.
//!
//! Прежний хост при каждой записи ресурса модели пишет в неё эти два значения; команды,
//! которые правят модели (`restyle-model`, `lamp-pole`), обязаны писать их так же.
//! Команд в модуле нет, только помощники для соседей.

use std::iter;

use rage_res::resource_graph::{self as rgraph, Graph};

use super::split::{geometry_blocks, invalid, need_block, pointer_block, u16_at, u32_at};
use crate::error::Result;

/// Голова рисовалки `.ydr`, как её пишет хост.
pub(super) const YDR_HEAD: u32 = 0x4057_3178;

/// Слоты и поля: корень (рисовалка или фрагмент), список уровня, модель, геометрия.
mod slot {
    pub const HEAD: usize = 0x00;
    pub const BLOCKS_SIZE: usize = 0x9a;
    pub const FRAGMENT_MODEL: usize = 0x30;
    pub const FRAGMENT_ARRAY: usize = 0x38;
    pub const FRAGMENT_COUNT: usize = 0x48;
    /// Списки уровней: High, Medium, Low, VeryLow.
    pub const LEVELS: [usize; 4] = [0x50, 0x58, 0x60, 0x68];
    pub const LEVEL_ARRAY: usize = 0x00;
    pub const LEVEL_COUNT: usize = 0x08;
    pub const GEOMETRY_COUNT: usize = 0x10;
    pub const PALETTE: usize = 0x68;
    pub const PALETTE_LEN: usize = 0x72;
}

/// Размеры раскладки в байтах.
mod width {
    pub const ALIGN: usize = 16;
    pub const ENTRY: usize = 8;
    pub const LIST_HEAD: usize = 16;
    pub const MODEL_HEAD: usize = 48;
    pub const SOLO_PAD: usize = 6;
    pub const FRAME: usize = 32;
    pub const GEOMETRY: usize = 152;
    pub const LONG_PALETTE: usize = 4;
    pub const LONG_EXTRA: usize = 8;
}

/// Линейка раскладки: блоки идут подряд, начало каждого - на границе 16 байт.
#[derive(Clone, Copy)]
struct Ruler(usize);

impl Ruler {
    fn skip(self, bytes: usize) -> Ruler {
        Ruler(self.0 + bytes)
    }

    fn snap(self) -> Ruler {
        Ruler(self.0.next_multiple_of(width::ALIGN))
    }

    fn lay(self, bytes: usize) -> Ruler {
        self.snap().skip(bytes)
    }
}

/// Счёт по формуле хоста над одним графом.
struct Sizer<'g>(&'g Graph);

impl Sizer<'_> {
    /// Одна запись геометрии: палитра берётся из `+0x72`, если у геометрии есть её слот.
    fn geometry(&self, geometry: usize) -> Result<usize> {
        let palette = pointer_block(self.0, geometry, slot::PALETTE).map_or(Ok(0), |_| {
            u16_at(self.0, geometry, slot::PALETTE_LEN).map(usize::from)
        })?;
        let long = palette > width::LONG_PALETTE;
        Ok(width::GEOMETRY + palette * 2 + if long { width::LONG_EXTRA } else { 0 })
    }

    /// Длина модели по счётчику геометрий: заголовок, номера, границы и записи геометрий.
    fn model(&self, model: usize) -> Result<usize> {
        let count = usize::from(u16_at(self.0, model, slot::GEOMETRY_COUNT)?);
        let head = Ruler(width::MODEL_HEAD + count * 2);
        let numbers = match count {
            1 => head.skip(width::SOLO_PAD),
            _ => head.snap(),
        };
        let frames = (count + usize::from(count > 1)) * width::FRAME;
        let start = numbers.skip(count * width::ENTRY).snap().skip(frames);
        geometry_blocks(self.0, model)?
            .into_iter()
            .try_fold(start, |end, geometry| {
                self.geometry(geometry).map(|record| end.lay(record))
            })
            .map(|end| end.0)
    }

    /// Длина списка уровня вместе с моделями; без массива записей моделей считается ноль.
    fn level(&self, header: usize) -> Result<usize> {
        let declared = u16_at(self.0, header, slot::LEVEL_COUNT)?;
        let listed = match pointer_block(self.0, header, slot::LEVEL_ARRAY) {
            Some(array) => (0..usize::from(declared))
                .map(|item| need_block(self.0, array, item * width::ENTRY, "пустая модель"))
                .collect::<Result<Vec<_>>>()?,
            None => Vec::new(),
        };
        let start = Ruler(width::LIST_HEAD + listed.len() * width::ENTRY);
        listed
            .into_iter()
            .try_fold(start, |end, model| {
                self.model(model).map(|length| end.lay(length))
            })
            .map(|end| end.0)
    }
}

/// Модель, на которую смотрит корень: у фрагмента `.yft` она отдельная, у `.ydr` это сам корень.
pub(super) fn drawable_of(graph: &Graph, root: usize) -> usize {
    pointer_block(graph, root, slot::FRAGMENT_MODEL).unwrap_or(root)
}

/// Основная модель и элементы массива `DrawableArray` (если он есть).
pub(super) fn drawables_of(graph: &Graph, root: usize) -> Result<Vec<usize>> {
    // Корень фонарей в файле короче: хвост из нулей не хранится, тогда элементов нет.
    let listed = pointer_block(graph, root, slot::FRAGMENT_ARRAY).map_or_else(
        || Ok(Vec::new()),
        |array| {
            let stored = u32_at(graph, root, slot::FRAGMENT_COUNT).unwrap_or(0);
            (0..stored as usize)
                .map(|item| {
                    need_block(
                        graph,
                        array,
                        item * width::ENTRY,
                        "пустой элемент DrawableArray",
                    )
                })
                .collect::<Result<Vec<_>>>()
        },
    )?;
    Ok(iter::once(drawable_of(graph, root)).chain(listed).collect())
}

/// Пишет в каждую модель корня слово `word(граф, модель)` по смещению `at`: список моделей строится
/// заранее, слово каждой модели считается прямо перед её записью.
fn stamp<const N: usize>(
    graph: &mut Graph,
    root: usize,
    at: usize,
    word: impl Fn(&Graph, usize) -> Result<[u8; N]>,
) -> Result<()> {
    drawables_of(graph, root)?
        .into_iter()
        .try_for_each(|model| {
            let bytes = word(graph, model)?;
            Ok(rgraph::write_at(graph, model, at, &bytes)?)
        })
}

pub(super) fn write_drawable_heads(graph: &mut Graph, root: usize, head: u32) -> Result<()> {
    stamp(graph, root, slot::HEAD, |_, _| Ok(head.to_le_bytes()))
}

pub(super) fn write_models_sizes(graph: &mut Graph, root: usize) -> Result<()> {
    stamp(graph, root, slot::BLOCKS_SIZE, |graph, model| {
        models_blocks_size(graph, model).map(u16::to_le_bytes)
    })
}

/// Значение для `+0x9A`: число 16-байтовых единиц, которые занимают списки моделей и сами модели.
/// Поле шириной 16 бит: большее число не обрезается, а отказывает.
pub(super) fn models_blocks_size(graph: &Graph, drawable: usize) -> Result<u16> {
    let sizer = Sizer(graph);
    let end = slot::LEVELS
        .iter()
        .filter_map(|&at| pointer_block(graph, drawable, at))
        .try_fold(Ruler(0), |end, header| {
            sizer.level(header).map(|length| end.lay(length))
        })?;
    u16::try_from(end.0.div_ceil(width::ALIGN))
        .map_err(|_| invalid("размер блоков моделей не помещается в 16 бит."))
}

#[cfg(test)]
mod tests;
