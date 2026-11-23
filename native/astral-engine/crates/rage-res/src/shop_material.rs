//! Как игра рисует материал сетки помещения: класс материала сборщика сцен магазинов
//! (`shopMaterialClass`, `diffuseOf`, `shaderFileName` в `apps/desktop/src/recolor-shops-scene.js`).
//!
//! Повторяется JS до выражения: список шейдеров `SHADER_FILES` — **свой**, не таблица `shaders.rs` (в нём меньше имён: сверка с таблицей
//! читателя — в `shop_material/tests.rs`), порядок проверок, округление свечения (`Math.round`). Вход — материал читателя
//! `drawable.rs` и числовые параметры шейдера (`shader_vectors.rs`); сверка с JS — `fixtures/ars1/materials/shop-materials.json`.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::drawable::Material;
use crate::hash::joaat;
use crate::js_math::round;
use crate::shader_vectors::{ShaderVectors, EMISSIVE_MULTIPLIER};
use crate::shaders::Role;

/// Шейдеры помещений (имена файлов `.sps`), как их знает сборщик магазинов: хеш `<имя>.sps` и хеш `<имя>`.
pub const SHADER_FILES: [&str; 96] = [
    "alpha",
    "cable",
    "cloth_default",
    "cloth_normal_spec",
    "cutout",
    "decal",
    "decal_amb_only",
    "decal_dirt",
    "decal_emissive_only",
    "decal_emissivenight_only",
    "decal_glue",
    "decal_normal_only",
    "decal_shadow_only",
    "decal_spec_only",
    "decal_tnt",
    "default",
    "default_detail",
    "default_spec",
    "default_tnt",
    "default_um",
    "emissive",
    "emissive_additive_alpha",
    "emissive_additive_uv_alpha",
    "emissive_alpha",
    "emissive_alpha_tnt",
    "emissive_clip",
    "emissive_speclum",
    "emissive_tnt",
    "emissivenight",
    "emissivenight_alpha",
    "emissivestrong",
    "emissivestrong_alpha",
    "glass",
    "glass_breakable",
    "glass_breakable_screendooralpha",
    "glass_displacement",
    "glass_emissive",
    "glass_emissive_alpha",
    "glass_emissivenight",
    "glass_emissivenight_alpha",
    "glass_env",
    "glass_normal_spec_reflect",
    "glass_pv",
    "glass_pv_env",
    "glass_reflect",
    "glass_spec",
    "mirror_crack",
    "mirror_decal",
    "mirror_default",
    "normal",
    "normal_alpha",
    "normal_cutout",
    "normal_decal",
    "normal_decal_pxm",
    "normal_decal_tnt",
    "normal_detail",
    "normal_pxm",
    "normal_reflect",
    "normal_reflect_alpha",
    "normal_reflect_decal",
    "normal_screendooralpha",
    "normal_spec",
    "normal_spec_alpha",
    "normal_spec_cutout",
    "normal_spec_decal",
    "normal_spec_decal_detail",
    "normal_spec_decal_pxm",
    "normal_spec_decal_tnt",
    "normal_spec_detail",
    "normal_spec_detail_tnt",
    "normal_spec_emissive",
    "normal_spec_pxm",
    "normal_spec_reflect",
    "normal_spec_reflect_alpha",
    "normal_spec_reflect_decal",
    "normal_spec_reflect_emissivenight",
    "normal_spec_tnt",
    "normal_tnt",
    "normal_um",
    "reflect",
    "reflect_alpha",
    "reflect_decal",
    "spec",
    "spec_alpha",
    "spec_const",
    "spec_decal",
    "spec_reflect",
    "spec_reflect_alpha",
    "spec_reflect_decal",
    "spec_screendooralpha",
    "spec_tnt",
    "trees",
    "trees_normal",
    "trees_normal_spec",
    "trees_tnt",
    "weapon_normal_spec_tnt",
];

/// Шейдеры, что цвета не рисуют: только нормаль, блеск, окружение, зеркальный пол, провода.
const NO_COLOUR: [&str; 11] = [
    "decal_normal_only",
    "decal_spec_only",
    "decal_amb_only",
    "decal_shadow_only",
    "spec_decal",
    "reflect_decal",
    "spec_reflect_decal",
    "normal_reflect_decal",
    "mirror_decal",
    "mirror_crack",
    "cable",
];

/// Хеш сэмплера палитры тинта (`TintPaletteSampler`).
pub fn palette_sampler() -> u32 {
    static HASH: OnceLock<u32> = OnceLock::new();
    *HASH.get_or_init(|| joaat("TintPaletteSampler"))
}

fn files() -> &'static HashMap<u32, &'static str> {
    static TABLE: OnceLock<HashMap<u32, &'static str>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = HashMap::new();
        for name in SHADER_FILES {
            // Порядок вставки — как у `flatMap` в JS: позже записанное затирает раньше записанное.
            table.insert(joaat(&format!("{name}.sps")), name);
            table.insert(joaat(name), name);
        }
        table
    })
}

/// Имя шейдера по хешу файла, иначе по хешу шейдера; пустое, если ни один не из списка.
pub fn shader_file_name(shader_hash: u32, shader_file_hash: u32) -> &'static str {
    let table = files();
    table
        .get(&shader_file_hash)
        .or_else(|| table.get(&shader_hash))
        .copied()
        .unwrap_or("")
}

/// Лист цвета материала, в нижнем регистре: роль `diffuse` по первому имени роли; иначе лист с ролью `diffuse`; иначе первый лист без роли,
/// что не палитра и по имени не нормаль, не блеск и не палитра. Нет — пустая строка.
pub fn diffuse_of(material: &Material) -> String {
    let named = || {
        material.samplers.iter().filter_map(|sampler| {
            Some((
                sampler,
                sampler.texture.as_deref().filter(|name| !name.is_empty())?,
            ))
        })
    };
    let by_role = material
        .textures
        .get(&Role::Diffuse)
        .map(String::as_str)
        .filter(|name| !name.is_empty());
    let name = by_role
        .or_else(|| {
            named()
                .find(|(sampler, _)| sampler.role == Some(Role::Diffuse))
                .map(|(_, name)| name)
        })
        .or_else(|| {
            named()
                .find(|(sampler, name)| {
                    sampler.role.is_none()
                        && sampler.hash != palette_sampler()
                        && !is_service_name(name)
                })
                .map(|(_, name)| name)
        })
        .unwrap_or("");
    name.to_lowercase()
}

/// `/(_n|_nm|_nrm|_normal|_s|_spec|_pal)$/i`.
fn is_service_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    ["_n", "_nm", "_nrm", "_normal", "_s", "_spec", "_pal"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alpha {
    Opaque,
    Cutout,
    Blend,
}

impl Alpha {
    /// Слово, которым класс записан в сцену.
    pub fn as_str(self) -> &'static str {
        match self {
            Alpha::Opaque => "opaque",
            Alpha::Cutout => "cutout",
            Alpha::Blend => "blend",
        }
    }
}

/// `{ alpha, decal, dirt, mirror, emission, vertexAlpha, tint, glass }` у `shopMaterialClass`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShopClass {
    pub alpha: Alpha,
    pub decal: bool,
    pub dirt: bool,
    pub mirror: bool,
    pub glass: bool,
    /// Свечение кадра: множитель шейдера (1…16 у помещений) в долю цвета листа; 0 — не светится.
    pub emission: f64,
    /// Альфа вершины — у прозрачного и наклеек (стёкла, грязь, тени).
    pub vertex_alpha: bool,
    pub tint: bool,
}

/// Как игра рисует материал сетки: `None` — цвета не рисует (в кадре нет).
pub fn shop_material_class(material: &Material, vectors: &ShaderVectors) -> Option<ShopClass> {
    let shader = shader_file_name(material.shader_hash, material.shader_file_hash);
    if NO_COLOUR.contains(&shader) {
        return None;
    }
    let bucket = material.render_bucket;
    let mirror = shader.starts_with("mirror_");
    let dirt = shader == "decal_dirt";
    let decal = bucket == 2 || shader.contains("decal");
    let cutout = bucket == 3
        || shader.contains("cutout")
        || shader.contains("screendoor")
        || shader.starts_with("trees");
    let blend = !cutout
        && (bucket == 1 || decal || shader.contains("alpha") || shader.starts_with("glass"));
    let emissive = shader.contains("emissive") || material.emissive;
    let multiplier = vectors
        .get(&EMISSIVE_MULTIPLIER)
        .map(|value| f64::from(value[0]));
    let emission = if emissive {
        let seed = match multiplier {
            Some(value) if value.is_finite() => value,
            _ => 4.0,
        };
        let raw = 0.35 + 0.12 * seed;
        // `Math.min(2.4, raw)`: у конечного `raw` — меньшее из двух.
        let capped = if raw < 2.4 { raw } else { 2.4 };
        round(capped * 100.0) / 100.0
    } else {
        0.0
    };
    Some(ShopClass {
        alpha: if mirror {
            Alpha::Opaque
        } else if cutout {
            Alpha::Cutout
        } else if blend {
            Alpha::Blend
        } else {
            Alpha::Opaque
        },
        decal,
        dirt,
        mirror,
        glass: shader.starts_with("glass"),
        emission,
        vertex_alpha: blend || dirt,
        tint: material.samplers.iter().any(|sampler| {
            sampler.hash == palette_sampler()
                && sampler
                    .texture
                    .as_deref()
                    .is_some_and(|name| !name.is_empty())
        }),
    })
}

#[cfg(test)]
mod tests;
