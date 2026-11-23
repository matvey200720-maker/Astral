//! Имена шейдеров, роли сэмплеров и режимы прозрачности по хешам RAGE.
//!
//! Ресурс хранит только хеши; здесь они сопоставляются спискам имён из
//! `shader_tables`. Таблицы строятся один раз на процесс.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::hash::joaat;
use crate::shader_tables as lists;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Diffuse,
    Normal,
    Specular,
    Detail,
    Palette,
    Emissive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlphaMode {
    Opaque,
    Mask,
    Blend,
}

const FLAG_MASK: u8 = 1;
const FLAG_BLEND: u8 = 2;
const FLAG_GLOW: u8 = 4;

struct Tables {
    names: HashMap<u32, &'static str>,
    roles: HashMap<u32, Role>,
    flags: HashMap<u32, u8>,
}

/// Написания шейдера, под которыми его хеш встречается в ресурсах.
fn spellings(name: &str) -> [String; 2] {
    [name.to_owned(), format!("{name}.sps")]
}

fn tables() -> &'static Tables {
    static CELL: OnceLock<Tables> = OnceLock::new();
    CELL.get_or_init(|| {
        let mut names = HashMap::new();
        for &name in lists::SHADERS {
            names.insert(joaat(name), name);
            // Строка с суффиксом нужна до конца процесса: таблица одна и живёт столько же.
            let file: &'static str = Box::leak(format!("{name}.sps").into_boxed_str());
            names.insert(joaat(file), file);
        }

        let sampler_groups: [(&[&str], Role); 6] = [
            (lists::DIFFUSE_SAMPLERS, Role::Diffuse),
            (lists::NORMAL_SAMPLERS, Role::Normal),
            (lists::SPECULAR_SAMPLERS, Role::Specular),
            (lists::DETAIL_SAMPLERS, Role::Detail),
            (lists::PALETTE_SAMPLERS, Role::Palette),
            (lists::EMISSIVE_SAMPLERS, Role::Emissive),
        ];
        let roles = sampler_groups
            .iter()
            .flat_map(|&(group, role)| group.iter().map(move |name| (joaat(name), role)))
            .collect();

        let mut flags: HashMap<u32, u8> = HashMap::new();
        let flag_groups: [(&[&str], u8); 3] = [
            (lists::CUTOUT_SHADERS, FLAG_MASK),
            (lists::BLEND_SHADERS, FLAG_BLEND),
            (lists::EMISSIVE_SHADERS, FLAG_GLOW),
        ];
        for (group, bit) in flag_groups {
            for spelled in group.iter().flat_map(|name| spellings(name)) {
                *flags.entry(joaat(&spelled)).or_default() |= bit;
            }
        }
        Tables {
            names,
            roles,
            flags,
        }
    })
}

fn flags_of(shader_hash: u32, file_hash: u32) -> u8 {
    let table = &tables().flags;
    [shader_hash, file_hash]
        .iter()
        .map(|hash| table.get(hash).copied().unwrap_or(0))
        .fold(0, |all, one| all | one)
}

pub fn shader_name(hash: u32) -> Option<&'static str> {
    tables().names.get(&hash).copied()
}

pub fn sampler_role(hash: u32) -> Option<Role> {
    tables().roles.get(&hash).copied()
}

pub fn alpha_mode_of(shader_hash: u32, file_hash: u32, render_bucket: u8) -> AlphaMode {
    let flags = flags_of(shader_hash, file_hash);
    if flags & FLAG_MASK != 0 {
        return AlphaMode::Mask;
    }
    if flags & FLAG_BLEND != 0 {
        return AlphaMode::Blend;
    }
    if shader_name(shader_hash).is_none() && shader_name(file_hash).is_none() {
        return AlphaMode::Opaque;
    }
    match render_bucket {
        1 => AlphaMode::Mask,
        2 => AlphaMode::Blend,
        _ => AlphaMode::Opaque,
    }
}

pub fn is_emissive(shader_hash: u32, file_hash: u32) -> bool {
    flags_of(shader_hash, file_hash) & FLAG_GLOW != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(text: &str) -> Option<&'static str> {
        shader_name(joaat(text))
    }

    fn mode(shader: &str, bucket: u8) -> AlphaMode {
        alpha_mode_of(joaat(shader), 0, bucket)
    }

    #[test]
    fn names_resolve_in_both_spellings() {
        let cases = [
            ("default", Some("default")),
            ("normal_spec", Some("normal_spec")),
            ("NORMAL_SPEC", Some("normal_spec")),
            ("Normal_Spec_Cutout", Some("normal_spec_cutout")),
            ("ped_palette", Some("ped_palette")),
            ("emissivenight", Some("emissivenight")),
            ("glass", Some("glass")),
            ("nonexistent_shader", None),
            ("default.sps", Some("default.sps")),
            ("normal_spec.sps", Some("normal_spec.sps")),
            ("NORMAL_SPEC.SPS", Some("normal_spec.sps")),
            ("glass.sps", Some("glass.sps")),
            ("default.SPS", Some("default.sps")),
            ("default.sps.sps", None),
            ("default ", None),
            (" default", None),
            ("default.sp", None),
        ];
        for (text, expected) in cases {
            assert_eq!(name(text), expected, "{text}");
        }
        for hash in [0, 1, 12345, u32::MAX] {
            assert_eq!(shader_name(hash), None);
        }
    }

    #[test]
    fn reference_hashes() {
        for (text, hash) in [
            ("default", 0xe4df_46d5),
            ("normal_spec", 0x38dd_00df),
            ("normal_spec.sps", 0x14a7_80fd),
            ("glass", 0xd9f8_c9bf),
            ("default.sps", 0x18ad_1594),
            ("emissivenight", 0xb08c_6435),
            ("ped_palette", 0xa91d_bbce),
        ] {
            assert_eq!(joaat(text), hash, "{text}");
        }
    }

    #[test]
    fn sampler_roles_by_name() {
        use Role::*;
        let cases = [
            ("DiffuseSampler", Some(Diffuse)),
            ("diffusesampler", Some(Diffuse)),
            ("DIFFUSESAMPLER", Some(Diffuse)),
            ("DiffuseSampler2", Some(Diffuse)),
            ("gDiffuse", Some(Diffuse)),
            ("textureSamp", Some(Diffuse)),
            ("TextureSampler", Some(Diffuse)),
            ("BaseSampler", Some(Diffuse)),
            ("baseTextureSampler", Some(Diffuse)),
            ("NormalMapSampler", Some(Normal)),
            ("BumpSampler", Some(Normal)),
            ("BumpSampler2", Some(Normal)),
            ("NormalTextureSampler", Some(Normal)),
            ("SpecSampler", Some(Specular)),
            ("SpecularSampler", Some(Specular)),
            ("SpecSampler_layer0", Some(Specular)),
            ("DetailSampler", Some(Detail)),
            ("DetailSampler2", Some(Detail)),
            ("TextureSamplerDiffPal", Some(Palette)),
            ("PaletteSampler", Some(Palette)),
            ("EmissiveSampler", Some(Emissive)),
            ("GlowSampler", Some(Emissive)),
            ("DiffuseSampler.sps", None),
            ("Sampler", None),
            ("", None),
            ("nonsense", None),
        ];
        for (text, expected) in cases {
            assert_eq!(sampler_role(joaat(text)), expected, "{text}");
        }
        assert_eq!(sampler_role(0), None);
        assert_eq!(sampler_role(joaat("DiffuseSampler") ^ 1), None);
    }

    #[test]
    fn alpha_by_name_and_bucket() {
        use AlphaMode::*;
        let cases = [
            ("normal_cutout", 0, Mask),
            ("normal_cutout", 2, Mask),
            ("normal_cutout.sps", 0, Mask),
            ("Normal_Spec_Cutout", 0, Mask),
            ("glass", 0, Blend),
            ("glass", 1, Blend),
            ("glass.sps", 5, Blend),
            ("default_alpha", 0, Blend),
            ("default", 0, Opaque),
            ("default", 1, Mask),
            ("default", 2, Blend),
            ("default", 3, Opaque),
            ("default", 255, Opaque),
            ("default.sps", 1, Mask),
            ("normal_spec", 2, Blend),
            ("emissive_clip", 2, Mask),
            ("emissive_alpha", 1, Blend),
            ("zzz_unknown", 0, Opaque),
            ("zzz_unknown", 1, Opaque),
            ("zzz_unknown", 2, Opaque),
            ("emissivenight", 1, Mask),
            ("emissive", 2, Blend),
            ("ped_fur", 0, Mask),
            ("alpha", 0, Blend),
            ("cutout", 0, Mask),
            ("decal", 0, Blend),
        ];
        for (text, bucket, expected) in cases {
            assert_eq!(mode(text, bucket), expected, "{text} {bucket}");
        }
        for bucket in 0..3 {
            assert_eq!(alpha_mode_of(0, 0, bucket), Opaque);
        }
        assert_eq!(alpha_mode_of(1, 2, 1), Opaque);
    }

    #[test]
    fn file_hash_takes_part() {
        use AlphaMode::*;
        let zzz = joaat("zzz_unknown");
        let cases = [
            (zzz, "normal_cutout.sps", 0, Mask),
            (zzz, "glass.sps", 0, Blend),
            (zzz, "default.sps", 1, Mask),
            (zzz, "default.sps", 2, Blend),
            (zzz, "default", 2, Blend),
            (joaat("normal_cutout"), "glass.sps", 0, Mask),
            (joaat("glass"), "normal_cutout.sps", 0, Mask),
        ];
        for (shader, file, bucket, expected) in cases {
            assert_eq!(
                alpha_mode_of(shader, joaat(file), bucket),
                expected,
                "{file}"
            );
        }
        assert_eq!(alpha_mode_of(joaat("default"), u32::MAX, 1), Mask);
    }

    #[test]
    fn glow_flags() {
        let cases = [
            ("emissive", "", true),
            ("emissivenight", "", true),
            ("Emissive_Speclum", "", true),
            ("emissive.sps", "", true),
            ("default", "", false),
            ("default", "emissive.sps", true),
            ("emissive_clip", "", true),
            ("glass", "", false),
            ("zzz", "", false),
        ];
        for (shader, file, expected) in cases {
            let file_hash = if file.is_empty() { 0 } else { joaat(file) };
            assert_eq!(is_emissive(joaat(shader), file_hash), expected, "{shader}");
        }
        assert!(!is_emissive(0, 0));
    }

    #[test]
    fn table_sizes_and_consistency() {
        assert_eq!(lists::SHADERS.len(), 124);
        assert_eq!(tables().names.len(), 248);
        let sampler_total: usize = [
            lists::DIFFUSE_SAMPLERS.len(),
            lists::NORMAL_SAMPLERS.len(),
            lists::SPECULAR_SAMPLERS.len(),
            lists::DETAIL_SAMPLERS.len(),
            lists::PALETTE_SAMPLERS.len(),
            lists::EMISSIVE_SAMPLERS.len(),
        ]
        .iter()
        .sum();
        assert_eq!(sampler_total, 36);
        assert_eq!(tables().roles.len(), 36);
        assert_eq!(lists::CUTOUT_SHADERS.len(), 12);
        assert_eq!(lists::BLEND_SHADERS.len(), 38);
        assert_eq!(lists::EMISSIVE_SHADERS.len(), 28);
        for &shader in lists::SHADERS {
            let spelled = format!("{shader}.sps");
            assert_eq!(name(shader), Some(shader));
            assert_eq!(name(&spelled), Some(spelled.as_str()));
        }
        for &shader in lists::CUTOUT_SHADERS {
            assert_eq!(mode(shader, 0), AlphaMode::Mask);
            assert_eq!(mode(&format!("{shader}.sps"), 0), AlphaMode::Mask);
        }
        for &shader in lists::BLEND_SHADERS {
            if !lists::CUTOUT_SHADERS.contains(&shader) {
                assert_eq!(mode(shader, 0), AlphaMode::Blend);
            }
        }
        for &shader in lists::EMISSIVE_SHADERS {
            assert!(is_emissive(joaat(shader), 0));
            assert!(is_emissive(0, joaat(&format!("{shader}.sps"))));
        }
    }
}
