//! Карты `.ymap` и типы `.ytyp` GTA V (ресурс RSC7 версии 2 «Meta») для сборщика мест мира: то же чтение по смещениям, что у `readMapData`,
//! `readMapTypes` и `mloEntities` в `apps/desktop/src/project-interiors/meta.js`.
//!
//! Указатель Meta — номер блока (12 бит, с единицы) и смещение в нём (20 бит). Из карты нужны сущности `CEntityDef`, из типов — архетипы
//! (`CBaseArchetypeDef`, `CMloArchetypeDef`) и у интерьера его сущности и наборы сущностей. Комнаты и порталы интерьера сборщику места не нужны и здесь не читаются.
//! Числа — `f64` из `f32` файла (как у JS).

use crate::error::{Error, Result};
use crate::resource::Resource;

/// Имя структуры блока `CMloArchetypeDef` (хеш с регистром).
const MLO_ARCHETYPE: u32 = 0x1050_6455;
/// Набор-вариант: большой набор, что в основном повторяет уже взятое, — не добавка к помещению. Малые наборы берутся все.
const VARIANT_MIN: usize = 20;
const VARIANT_SHARE: f64 = 0.5;
const VARIANT_REACH: f64 = 1.0;

/// Сущность `CEntityDef`.
#[derive(Debug, Clone, PartialEq)]
pub struct MapEntity {
    pub archetype: u32,
    pub flags: u32,
    pub position: [f64; 3],
    pub rotation: [f64; 4],
    pub scale_xy: f64,
    pub scale_z: f64,
    pub parent_index: i32,
    pub lod_dist: f64,
    pub child_lod_dist: f64,
    pub lod_level: u32,
    pub tint_value: u32,
}

/// Набор сущностей интерьера (`CMloEntitySet`): имя-хеш, комнаты сущностей и сами сущности.
#[derive(Debug, Clone, PartialEq)]
pub struct EntitySet {
    pub name: u32,
    pub locations: Vec<u32>,
    pub entities: Vec<MapEntity>,
}

/// Архетип: `mlo` — интерьер; у него `entities` и `entity_sets`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Archetype {
    pub mlo: bool,
    pub lod_dist: f64,
    pub flags: u32,
    pub bb_min: [f64; 3],
    pub bb_max: [f64; 3],
    pub name: u32,
    pub texture_dictionary: u32,
    pub drawable_dictionary: u32,
    pub asset_type: u32,
    pub asset_name: u32,
    pub entities: Vec<MapEntity>,
    pub entity_sets: Vec<EntitySet>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MapData {
    pub name: u32,
    pub parent: u32,
    pub flags: u32,
    pub content_flags: u32,
    pub entities: Vec<MapEntity>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MapTypes {
    pub name: u32,
    pub archetypes: Vec<Archetype>,
}

struct Block {
    name_hash: u32,
    data_at: Option<usize>,
}

struct Meta<'a> {
    res: &'a Resource,
    blocks: Vec<Block>,
    root: usize,
}

fn bad(text: &str) -> Error {
    Error::broken(text)
}

fn open(res: &Resource) -> Result<Meta<'_>> {
    if res.version() != 2 {
        return Err(bad(&format!(
            "Это не Meta-ресурс (версия {}).",
            res.version()
        )));
    }
    let root_at = res
        .root()
        .ok_or_else(|| bad("Корень Meta-ресурса не найден."))?;
    let root_block = res.u32(root_at + 0x1c)? as i32;
    let blocks_at = res.pointer_at(root_at + 0x30);
    let count = res.u16(root_at + 0x4c)? as i16;
    let mut blocks = Vec::new();
    for index in 0..count.max(0) as usize {
        let at = blocks_at.map_or(usize::MAX, |base| base + index * 16);
        blocks.push(Block {
            name_hash: res.u32(at)?,
            data_at: res.pointer_at(at.wrapping_add(8)),
        });
    }
    let root = usize::try_from(root_block - 1)
        .ok()
        .and_then(|index| blocks.get(index))
        .and_then(|block| block.data_at)
        .ok_or_else(|| bad("Корень Meta-ресурса не найден."))?;
    Ok(Meta { res, blocks, root })
}

impl Meta<'_> {
    fn block_of(&self, pointer: u64) -> Option<&Block> {
        let number = (pointer & 0xfff) as usize;
        number
            .checked_sub(1)
            .and_then(|index| self.blocks.get(index))
    }

    /// Адрес по указателю Meta; `None` — нет блока или он не лежит в данных.
    fn resolve(&self, pointer: u64) -> Option<usize> {
        let block = self.block_of(pointer)?;
        Some(block.data_at? + ((pointer >> 12) & 0xf_ffff) as usize)
    }

    fn f(&self, at: usize) -> Result<f64> {
        Ok(f64::from(self.res.f32(at)?))
    }

    /// Массив указателей на структуры: смещения и имена структур блоков.
    fn pointer_array(&self, at: usize) -> Result<Vec<(usize, u32)>> {
        let list = self.resolve(self.res.u64(at)?);
        let count = usize::from(self.res.u16(at + 8)?);
        let mut items = Vec::new();
        let Some(list) = list else { return Ok(items) };
        for index in 0..count {
            let pointer = self.res.u64(list + index * 8)?;
            if let Some(item) = self.resolve(pointer) {
                items.push((
                    item,
                    self.block_of(pointer).map_or(0, |block| block.name_hash),
                ));
            }
        }
        Ok(items)
    }

    /// Массив Meta: данные и число (16 байт: указатель, число, ёмкость).
    fn array_at(&self, at: usize) -> Result<(usize, Option<usize>)> {
        let count = usize::from(self.res.u16(at + 8)?);
        let data = if count == 0 {
            None
        } else {
            self.resolve(self.res.u64(at)?)
        };
        Ok((count, data))
    }

    fn entity(&self, at: usize) -> Result<MapEntity> {
        let r = self.res;
        Ok(MapEntity {
            archetype: r.u32(at + 8)?,
            flags: r.u32(at + 12)?,
            position: [self.f(at + 32)?, self.f(at + 36)?, self.f(at + 40)?],
            rotation: [
                self.f(at + 48)?,
                self.f(at + 52)?,
                self.f(at + 56)?,
                self.f(at + 60)?,
            ],
            scale_xy: self.f(at + 64)?,
            scale_z: self.f(at + 68)?,
            parent_index: r.u32(at + 72)? as i32,
            lod_dist: self.f(at + 76)?,
            child_lod_dist: self.f(at + 80)?,
            lod_level: r.u32(at + 84)?,
            tint_value: r.u32(at + 120)?,
        })
    }

    fn entities(&self, at: usize) -> Result<Vec<MapEntity>> {
        self.pointer_array(at)?
            .into_iter()
            .map(|(item, _)| self.entity(item))
            .collect()
    }

    fn entity_sets(&self, at: usize) -> Result<Vec<EntitySet>> {
        let (count, data) = self.array_at(at)?;
        let mut sets = Vec::new();
        let Some(data) = data else { return Ok(sets) };
        for index in 0..count {
            let set = data + index * 48;
            let (places, places_at) = self.array_at(set + 16)?;
            let mut locations = Vec::new();
            if let Some(places_at) = places_at {
                for place in 0..places {
                    locations.push(self.res.u32(places_at + place * 4)?);
                }
            }
            sets.push(EntitySet {
                name: self.res.u32(set + 8)?,
                locations,
                entities: self.entities(set + 32)?,
            });
        }
        Ok(sets)
    }
}

/// Смещения записей сущностей карты в данных ресурса (для правки образцов: масштаб и тинт, которых писатель карт не задаёт).
#[cfg(test)]
pub(crate) fn entity_offsets(res: &Resource) -> Result<Vec<usize>> {
    let meta = open(res)?;
    Ok(meta
        .pointer_array(meta.root + 96)?
        .into_iter()
        .map(|(at, _)| at)
        .collect())
}

/// Карта: имя, родитель, флаги и сущности.
pub fn read_map_data(res: &Resource) -> Result<MapData> {
    let meta = open(res)?;
    let at = meta.root;
    Ok(MapData {
        name: res.u32(at + 8)?,
        parent: res.u32(at + 12)?,
        flags: res.u32(at + 16)?,
        content_flags: res.u32(at + 20)?,
        entities: meta.entities(at + 96)?,
    })
}

/// Типы: архетипы с именами-хешами; у интерьера — сущности и наборы сущностей.
pub fn read_map_types(res: &Resource) -> Result<MapTypes> {
    let meta = open(res)?;
    let at = meta.root;
    let mut archetypes = Vec::new();
    for (a, structure) in meta.pointer_array(at + 24)? {
        let mut item = Archetype {
            mlo: structure == MLO_ARCHETYPE,
            lod_dist: meta.f(a + 8)?,
            flags: res.u32(a + 12)?,
            bb_min: [meta.f(a + 32)?, meta.f(a + 36)?, meta.f(a + 40)?],
            bb_max: [meta.f(a + 48)?, meta.f(a + 52)?, meta.f(a + 56)?],
            name: res.u32(a + 88)?,
            texture_dictionary: res.u32(a + 92)?,
            drawable_dictionary: res.u32(a + 100)?,
            asset_type: res.u32(a + 108)?,
            asset_name: res.u32(a + 112)?,
            ..Archetype::default()
        };
        if item.mlo {
            item.entities = meta.entities(a + 152)?;
            item.entity_sets = meta.entity_sets(a + 200)?;
        }
        archetypes.push(item);
    }
    Ok(MapTypes {
        name: res.u32(at + 40)?,
        archetypes,
    })
}

fn near(a: &MapEntity, b: &MapEntity) -> bool {
    let d = |axis: usize| a.position[axis] - b.position[axis];
    crate::js_math::hypot(&[d(0), d(1), d(2)]) <= VARIANT_REACH
}

/// Сущности интерьера: сначала свои, затем наборы по порядку в типах; набор-вариант (большой и в основном повторяющий взятое) пропускается.
pub fn mlo_entities(archetype: &Archetype) -> Vec<MapEntity> {
    let mut taken: Vec<&MapEntity> = archetype.entities.iter().collect();
    let mut out: Vec<MapEntity> = archetype.entities.clone();
    for set in &archetype.entity_sets {
        if set.entities.len() >= VARIANT_MIN {
            let repeated = set
                .entities
                .iter()
                .filter(|entity| {
                    taken
                        .iter()
                        .any(|other| other.archetype == entity.archetype && near(other, entity))
                })
                .count();
            if repeated as f64 >= set.entities.len() as f64 * VARIANT_SHARE {
                continue;
            }
        }
        for entity in &set.entities {
            taken.push(entity);
            out.push(entity.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests;
