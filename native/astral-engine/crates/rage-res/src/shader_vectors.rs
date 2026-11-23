//! Числовые параметры шейдеров модели: то, что читает `shaderVectors` сборщиков сцен
//! (`apps/desktop/src/recolor-shops-scene.js`, `world-place-scene.js`).
//!
//! Читатель материалов (`drawable::read_materials`) берёт у шейдера только текстурные слоты; здесь —
//! остальные: записи с видом больше нуля несут указатель на четыре числа `f32`. Разметка та же, что у
//! `readShaders` пакета `rage-drawable`:
//!
//! * группа шейдеров — `+0x10` массив указателей, `+0x18` число шейдеров (`u16`);
//! * шейдер — `+0x00` указатель на параметры, `+0x10` число записей (`u8`);
//! * запись параметра — 16 байт: вид (`u8`), у числового указатель на данные в `+8`;
//! * после записей идут блоки данных (по 16 байт на единицу вида), за ними — хеши имён параметров (`u32`).
//!
//! Повторяется JS до мелочей: предел 96 записей на шейдер, пустой набор у шейдера без указателя,
//! порядок ключей по возрастанию хеша (у объекта JS целые ключи идут по возрастанию), а там, где JS
//! бросает `RangeError` (чтение за концом данных), здесь `Err`. Читатель материалов этого не делает:
//! у него обрыв молча пропускает слот; сборщики сцен — как JS.

use std::collections::BTreeMap;

use crate::error::Result;
use crate::resource::Resource;

/// Хеш `emissiveMultiplier` — множитель свечения помещений (1…16).
pub const EMISSIVE_MULTIPLIER: u32 = 0x5eeb_ed48;
/// Хеш `globalAnimUV0` — смещение развёртки по времени (первый вектор).
pub const GLOBAL_ANIM_UV0: u32 = 0xd79b_fc1e;
/// Хеш `globalAnimUV1` — смещение развёртки по времени (второй вектор).
pub const GLOBAL_ANIM_UV1: u32 = 0xba54_c190;

/// Больше записей на шейдер не читаем (так же, как JS).
const MAX_PARAMETERS: usize = 96;
const RECORD_BYTES: usize = 16;

/// Параметры одного шейдера: хеш имени → четыре числа.
pub type ShaderVectors = BTreeMap<u32, [f32; 4]>;

/// Указатель в данных: `Err` — чтение за концом (JS бросает), `Ok(None)` — нуль или адрес вне ресурса.
fn pointer(res: &Resource, at: usize) -> Result<Option<usize>> {
    Ok(res.at(res.u64(at)?))
}

/// Где в ресурсе модель: у `.ydr` — корень, у фрагмента (`.yft`) — общая модель по `+0x30` корня.
/// `Ok(None)` — модели нет (пустой ресурс или нулевой указатель).
pub fn drawable_root_at(res: &Resource, fragment: bool) -> Result<Option<usize>> {
    let Some(root) = res.root() else {
        return Ok(None);
    };
    if fragment {
        pointer(res, root + 0x30)
    } else {
        Ok(Some(root))
    }
}

/// Числовые параметры шейдеров модели, по одному набору на каждый шейдер группы по порядку.
/// Нет группы шейдеров — пустой список; шейдер без параметров — пустой набор.
pub fn shader_vectors(res: &Resource, drawable_at: usize) -> Result<Vec<ShaderVectors>> {
    let Some(group) = pointer(res, drawable_at + 0x10)? else {
        return Ok(Vec::new());
    };
    let array = pointer(res, group + 0x10)?;
    let count = usize::from(res.u16(group + 0x18)?);
    let mut out = Vec::new();
    let Some(array) = array else {
        return Ok(out);
    };
    for index in 0..count {
        let shader = pointer(res, array + index * 8)?;
        out.push(match shader {
            Some(shader) => read_shader(res, shader)?,
            None => ShaderVectors::new(),
        });
    }
    Ok(out)
}

fn read_shader(res: &Resource, shader: usize) -> Result<ShaderVectors> {
    let mut found = ShaderVectors::new();
    let declared = usize::from(res.u8(shader + 0x10)?);
    let Some(params) = pointer(res, shader)? else {
        return Ok(found);
    };
    if declared > MAX_PARAMETERS {
        return Ok(found);
    }

    // Записи читаются, пока запись целиком помещается в данные; блоки данных считаются по ним же.
    let mut kinds = Vec::with_capacity(declared);
    let mut blocks = 0usize;
    for slot in 0..declared {
        let at = params + slot * RECORD_BYTES;
        if at + RECORD_BYTES > res.len() {
            break;
        }
        let kind = res.u8(at)?;
        kinds.push((kind, at));
        blocks += usize::from(kind);
    }
    // Хеши — после всех записей (по заявленному числу, не по прочитанному) и блоков данных.
    let hashes = params + declared * RECORD_BYTES + blocks * RECORD_BYTES;
    for (slot, &(kind, at)) in kinds.iter().enumerate() {
        if kind == 0 || hashes + slot * 4 + 4 > res.len() {
            continue;
        }
        let Some(data) = pointer(res, at + 8)? else {
            continue;
        };
        if data + 16 > res.len() {
            continue;
        }
        let mut value = [0f32; 4];
        for (k, part) in value.iter_mut().enumerate() {
            *part = res.f32(data + k * 4)?;
        }
        found.insert(res.u32(hashes + slot * 4)?, value);
    }
    Ok(found)
}

#[cfg(test)]
mod tests;
