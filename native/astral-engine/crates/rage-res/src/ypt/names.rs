//! Имена из хешей для ядра эффектов (`core.ypt`).
//!
//! В файле лежат только 32-битные хеши имён свойств эволюций, ключей эффектов,
//! эмиттеров, доменов и переменных шейдера. Здесь считается хеш RAGE от строки
//! и по короткому закрытому списку известных имён восстанавливается написание.
//! Для незнакомого хеша имя пустое.

use std::sync::OnceLock;

/// Слой перемешивания: либо «прибавить себя, сдвинутого влево», либо
/// «сложить исключающим „или“ с собой, сдвинутым вправо».
#[derive(Clone, Copy)]
enum Layer {
    Grow,
    Fold,
}

impl Layer {
    fn apply(self, value: u32, shift: u32) -> u32 {
        match self {
            Layer::Grow => value.wrapping_add(value << shift),
            Layer::Fold => value ^ (value >> shift),
        }
    }
}

/// Слои, которыми заканчивается хеш после последнего байта.
const FINISH: [(Layer, u32); 3] = [(Layer::Grow, 3), (Layer::Fold, 11), (Layer::Grow, 15)];

/// Состояние счётчика one-at-a-time: байты подмешиваются по одному, в конце
/// состояние «затвердевает». Вся арифметика по модулю 2^32.
#[derive(Clone, Copy)]
struct Scrambler(u32);

impl Scrambler {
    /// Подмешивает байт (латинские A-Z уже сведены к строчным).
    fn absorb(self, byte: u8) -> Scrambler {
        let added = self.0.wrapping_add(u32::from(byte));
        Scrambler(Layer::Fold.apply(Layer::Grow.apply(added, 10), 6))
    }

    fn settle(self) -> u32 {
        FINISH
            .iter()
            .fold(self.0, |value, &(layer, shift)| layer.apply(value, shift))
    }
}

/// Хеш RAGE (one-at-a-time Дженкинса) от байтов строки; латинские A-Z сводятся
/// к строчным, остальные байты берутся как есть.
pub fn hash_name(text: &str) -> u32 {
    text.bytes()
        .map(|byte| byte.to_ascii_lowercase())
        .fold(Scrambler(0), Scrambler::absorb)
        .settle()
}

/// Имя по хешу: первая запись `KNOWN` с таким хешем, иначе пустая строка.
/// Возвращается написание из таблицы, а не то, которым хеш был получен.
pub fn name_of(hash: u32) -> &'static str {
    static BY_HASH: OnceLock<Vec<(u32, &'static str)>> = OnceLock::new();
    let pairs = BY_HASH.get_or_init(|| KNOWN.iter().map(|&name| (hash_name(name), name)).collect());
    pairs
        .iter()
        .find_map(|&(seen, name)| (seen == hash).then_some(name))
        .unwrap_or("")
}

/// Известные имена: выгрузка по 628 файлам `core` и `update`. Порядок побайтовый
/// (заглавные раньше строчных) и обязателен: при совпадении хешей побеждает
/// первая запись.
pub const KNOWN: &[&str] = &[
    "alphacutoffminmax",
    "ambientmult",
    "camerabias",
    "camerashrink",
    "diffusetex2",
    "directionalmult",
    "dirnormalbias",
    "extralightmult",
    "normalarc",
    "normalmapmult",
    "normalspecmap",
    "ptxAttractorDomain:m_positionKFP",
    "ptxAttractorDomain:m_rotationKFP",
    "ptxAttractorDomain:m_sizeInnerKFP",
    "ptxAttractorDomain:m_sizeOuterKFP",
    "ptxCreationDomain:m_positionKFP",
    "ptxCreationDomain:m_rotationKFP",
    "ptxCreationDomain:m_sizeInnerKFP",
    "ptxCreationDomain:m_sizeOuterKFP",
    "ptxEffectRule:m_colourTintMaxKFP",
    "ptxEffectRule:m_colourTintMinKFP",
    "ptxEffectRule:m_dataCapsuleKFP",
    "ptxEffectRule:m_dataSphereKFP",
    "ptxEffectRule:m_zoomScalarKFP",
    "ptxEmitterRule:m_accnScalarKFP",
    "ptxEmitterRule:m_dampeningScalarKFP",
    "ptxEmitterRule:m_inheritVelocityKFP",
    "ptxEmitterRule:m_matrixWeightScalarKFP",
    "ptxEmitterRule:m_particleLifeKFP",
    "ptxEmitterRule:m_playbackRateScalarKFP",
    "ptxEmitterRule:m_sizeScalarKFP",
    "ptxEmitterRule:m_spawnRateOverDistKFP",
    "ptxEmitterRule:m_spawnRateOverTimeKFP",
    "ptxEmitterRule:m_speedScalarKFP",
    "ptxTargetDomain:m_positionKFP",
    "ptxTargetDomain:m_rotationKFP",
    "ptxTargetDomain:m_sizeInnerKFP",
    "ptxTargetDomain:m_sizeOuterKFP",
    "ptxd_Trail:m_texInfoKFP",
    "ptxu_Acceleration:m_strengthKFP",
    "ptxu_Acceleration:m_xyzMaxKFP",
    "ptxu_Acceleration:m_xyzMinKFP",
    "ptxu_AnimateTexture:m_animRateKFP",
    "ptxu_Collision:m_bounceDirVarKFP",
    "ptxu_Collision:m_bouncinessKFP",
    "ptxu_Colour:m_emissiveIntensityKFP",
    "ptxu_Colour:m_rgbaMaxKFP",
    "ptxu_Colour:m_rgbaMinKFP",
    "ptxu_Dampening:m_xyzMaxKFP",
    "ptxu_Dampening:m_xyzMinKFP",
    "ptxu_Decal:m_alphaKFP",
    "ptxu_Decal:m_dimensionsKFP",
    "ptxu_FogVolume:m_densityRangeKFP",
    "ptxu_FogVolume:m_rgbTintMaxKFP",
    "ptxu_FogVolume:m_rgbTintMinKFP",
    "ptxu_FogVolume:m_rotationMaxKFP",
    "ptxu_FogVolume:m_rotationMinKFP",
    "ptxu_FogVolume:m_scaleMaxKFP",
    "ptxu_FogVolume:m_scaleMinKFP",
    "ptxu_Light:m_coronaFlareKFP",
    "ptxu_Light:m_coronaIntensityKFP",
    "ptxu_Light:m_coronaRgbMaxKFP",
    "ptxu_Light:m_coronaRgbMinKFP",
    "ptxu_Light:m_coronaSizeKFP",
    "ptxu_Light:m_intensityKFP",
    "ptxu_Light:m_rangeKFP",
    "ptxu_Light:m_rgbMaxKFP",
    "ptxu_Light:m_rgbMinKFP",
    "ptxu_MatrixWeight:m_mtxWeightKFP",
    "ptxu_Noise:m_posNoiseMaxKFP",
    "ptxu_Noise:m_posNoiseMinKFP",
    "ptxu_Noise:m_velNoiseMaxKFP",
    "ptxu_Noise:m_velNoiseMinKFP",
    "ptxu_Rotation:m_angleMaxKFP",
    "ptxu_Rotation:m_angleMinKFP",
    "ptxu_Rotation:m_initialAngleMaxKFP",
    "ptxu_Rotation:m_initialAngleMinKFP",
    "ptxu_Size:m_tblrScalarKFP",
    "ptxu_Size:m_tblrVelScalarKFP",
    "ptxu_Size:m_whdMaxKFP",
    "ptxu_Size:m_whdMinKFP",
    "ptxu_Wind:m_influenceKFP",
    "ptxu_ZCull:m_fadeDistKFP",
    "ptxu_ZCull:m_heightKFP",
    "refractionmap",
    "rg_blendenddistance",
    "rg_blendstartdistance",
    "shadowamount",
    "softness",
    "softnesscurve",
    "softnessshadowmult",
    "softnessshadowoffset",
    "superalpha",
    "wraplightingterm",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hash_of_a_known_name_leads_back_to_it() {
        let name = "ptxEffectRule:m_colourTintMinKFP";
        assert_eq!(name_of(hash_name(name)), name);
        // Регистр запроса не мешает: возвращается написание таблицы.
        assert_eq!(name_of(hash_name(&name.to_uppercase())), name);
    }

    #[test]
    fn an_unknown_hash_gives_an_empty_name() {
        assert_eq!(name_of(0xDEAD_BEEF), "");
        assert_eq!(name_of(0), "");
        assert_eq!(name_of(hash_name("PTXUSER:m_foo")), "");
    }

    #[test]
    fn known_hashes_are_distinct_and_all_resolve() {
        let mut seen = std::collections::HashSet::new();
        for name in KNOWN {
            assert!(seen.insert(hash_name(name)), "коллизия на {name}");
            assert_eq!(name_of(hash_name(name)), *name);
        }
        assert_eq!(KNOWN.len(), 94);
    }

    #[test]
    fn hash_ignores_ascii_case_only() {
        assert_eq!(hash_name(""), 0);
        assert_eq!(hash_name("ABC"), hash_name("abc"));
        assert_eq!(hash_name("abc"), 0xed13_1f5b);
        assert_ne!(hash_name("Ä"), hash_name("ä"));
    }
}
