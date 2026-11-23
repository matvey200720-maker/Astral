//! Подмена ступеней текстур в образе ядра: байты ложатся поверх прежних на месте, указатели и слова-хеши не двигаются.
//!
//! Прежний писатель текстур (`writer`, `write-ypt-texture-patch`) собирает файл заново из своего разбора ресурса, где
//! слово-хеш в диапазоне адресов области принимается за указатель; здесь текстуры правятся в том же образе, что слоты,
//! клоны, кадры и правила, и файл собирается один раз.

use super::structure::Structure;
use crate::error::{Error, Result};
use crate::texture::TextureRef;

/// Готовые байты ступеней одной текстуры: имя в словаре (без учёта регистра, пробелы по краям не в счёт) и данные.
pub type Payload = (String, Vec<u8>);

fn unknown(name: &str) -> Error {
    Error::broken(format!("Текстуры {name} нет в словаре ядра."))
}

/// Длина данных листа в ядре так, как её держит помощник и считает приложение (`helperPayloadBytes`): ступени мельче 4×4 не
/// округляются до блока, а у неквадратной цепочки последняя ступень нулевой высоты и не занимает ничего. У 105 листов ядра
/// игры из 107 это то же число, что «по блокам» (`TextureRef::bytes`); у `ptfx_blood_spurt` (699 050 вместо 699 088) и
/// `ptfx_insects_rgb` (1 398 101 вместо 1 398 128) — меньше. Лист занимает в данных именно столько байт: записать больше —
/// затереть начало соседнего листа.
pub fn leaf_bytes(texture: &TextureRef) -> usize {
    texture
        .format
        .map_or(texture.bytes, |format| format.helper_total_bytes(texture.width, texture.height, texture.levels))
        .min(texture.bytes)
}

/// Ступени текстур по именам. Длина данных обязана совпасть с длиной данных листа (`leaf_bytes`) — не с длиной «по блокам»,
/// которая у двух листов ядра больше настоящей, — и пишется ровно она; имя повторяться не может.
pub fn put(structure: &mut Structure, patches: &[Payload]) -> Result<()> {
    if patches.is_empty() {
        return Ok(());
    }
    let res = structure.to_resource();
    let core = super::read(&res)?;
    let system_size = res.header.system_size;
    let mut written: Vec<String> = Vec::new();
    for (name, payload) in patches {
        let key = name.trim().to_ascii_lowercase();
        if written.contains(&key) {
            return Err(Error::broken(format!("Текстура {name} правится дважды.")));
        }
        let texture = core
            .textures
            .iter()
            .find(|texture| texture.name.eq_ignore_ascii_case(name.trim()))
            .ok_or_else(|| unknown(name))?;
        let wanted = leaf_bytes(texture);
        if payload.len() != wanted {
            return Err(Error::broken(format!(
                "Длина ступеней не совпадает с текстурой ядра: {} ({} байт, пришло {}).",
                texture.name,
                wanted,
                payload.len()
            )));
        }
        let at = texture
            .data_at
            .ok_or_else(|| Error::broken(format!("Текстура {}: нет данных.", texture.name)))?;
        match at.checked_sub(system_size) {
            None => structure.put(at, payload)?,
            Some(offset) => structure.put_graphics(offset, payload)?,
        }
        written.push(key);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
