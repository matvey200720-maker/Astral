//! Списки имён шейдеров и сэмплеров, как их знает игра.
//!
//! Только данные: `shaders` хеширует имена при первом обращении и дальше ищет по хешу.

pub static SHADERS: &[&str] = &[
    "default",
    "default_um",
    "default_tnt",
    "default_spec",
    "default_spec_um",
    "default_alpha",
    "default_detail",
    "default_detail_um",
    "default_spec_detail",
    "default_terrain_wet",
    "alpha",
    "normal",
    "normal_um",
    "normal_tnt",
    "normal_alpha",
    "normal_cutout",
    "normal_decal",
    "normal_decal_pxm",
    "normal_decal_tnt",
    "normal_um_tnt",
    "normal_reflect",
    "normal_reflect_alpha",
    "normal_reflect_decal",
    "normal_screendooralpha",
    "normal_spec",
    "normal_spec_alpha",
    "normal_spec_cutout",
    "normal_spec_tnt",
    "normal_spec_emissive",
    "normal_spec_um",
    "normal_spec_decal",
    "normal_spec_decal_pxm",
    "normal_spec_decal_tnt",
    "normal_spec_detail",
    "normal_spec_detail_um",
    "normal_spec_reflect",
    "normal_spec_reflect_alpha",
    "normal_spec_reflect_decal",
    "normal_spec_reflect_emissivenight",
    "normal_spec_reflect_emissivenight_alpha",
    "spec",
    "spec_alpha",
    "spec_decal",
    "spec_decal_pxm",
    "spec_reflect",
    "spec_reflect_alpha",
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
    "emissivenight_geomnightonly",
    "emissivestrong",
    "emissivestrong_alpha",
    "glass",
    "glass_normal_spec",
    "glass_normal_spec_reflect",
    "glass_pv",
    "glass_pv_env",
    "glass_spec",
    "glass_emissive",
    "glass_emissive_alpha",
    "glass_emissivenight",
    "glass_emissivenight_alpha",
    "glass_breakable",
    "glass_breakable_screendooralpha",
    "cutout",
    "cutout_um",
    "decal",
    "decal_diff_only_um",
    "decal_dirt",
    "decal_emissive_only",
    "decal_emissivenight_only",
    "decal_normal_only",
    "decal_shadow_only",
    "decal_spec_only",
    "decal_tnt",
    "weapon_normal_spec",
    "weapon_normal_spec_alpha",
    "weapon_normal_spec_cutout",
    "weapon_normal_spec_tnt",
    "weapon_normal_spec_palette",
    "weapon_normal_spec_detail",
    "weapon_normal_spec_detail_palette",
    "weapon_normal_spec_palette_detail_2",
    "weapon_normal_spec_detail_tnt",
    "weapon_normal_spec_cutout_palette",
    "weapon_emissive_tnt",
    "weapon_emissivestrong_alpha",
    "vehicle_vehglass",
    "vehicle_vehglass_inner",
    "vehicle_emissive_alpha",
    "vehicle_emissive_opaque",
    "vehicle_lightsemissive",
    "ped",
    "ped_alpha",
    "ped_cloth",
    "ped_cloth_enveff",
    "ped_decal",
    "ped_decal_decoration",
    "ped_decal_exp",
    "ped_decal_nodiff",
    "ped_default",
    "ped_default_cloth",
    "ped_default_enveff",
    "ped_default_mp",
    "ped_default_palette",
    "ped_emissive",
    "ped_enveff",
    "ped_fur",
    "ped_hair_cutout_alpha",
    "ped_hair_spiked",
    "ped_nopeddamagedecals",
    "ped_palette",
    "ped_wrinkle",
    "ped_wrinkle_cloth",
    "ped_wrinkle_cloth_enveff",
    "ped_wrinkle_cs",
    "ped_wrinkle_enveff",
];

pub static DIFFUSE_SAMPLERS: &[&str] = &[
    "DiffuseSampler",
    "DiffuseSampler2",
    "DiffuseSamplerPhase2",
    "DiffuseSamplerPoint",
    "DiffuseTexSampler",
    "DiffuseTexSampler01",
    "DiffuseTexSampler02",
    "DiffuseTexSampler03",
    "DiffuseTexSampler04",
    "gDiffuse",
    "TextureGrassSampler",
    "TextureNoWrapSampler",
    "textureSamp",
    "TextureSampler",
    "TextureSampler_layer0",
    "TextureSampler2",
    "BaseSampler",
    "baseTextureSampler",
];

pub static NORMAL_SAMPLERS: &[&str] = &[
    "NormalMapSampler",
    "NormalMapSampler1",
    "NormalMapSampler2",
    "NormalMapTexSampler",
    "NormalSampler",
    "NormalTextureSampler",
    "BumpSampler",
    "BumpSampler_layer0",
    "BumpSampler2",
];

pub static SPECULAR_SAMPLERS: &[&str] = &["SpecSampler", "SpecularSampler", "SpecSampler_layer0"];

pub static DETAIL_SAMPLERS: &[&str] = &["DetailSampler", "DetailSampler2"];

pub static PALETTE_SAMPLERS: &[&str] = &["TextureSamplerDiffPal", "PaletteSampler"];

pub static EMISSIVE_SAMPLERS: &[&str] = &["EmissiveSampler", "GlowSampler"];

pub static CUTOUT_SHADERS: &[&str] = &[
    "cutout",
    "cutout_um",
    "emissive_clip",
    "normal_cutout",
    "normal_spec_cutout",
    "weapon_normal_spec_cutout",
    "weapon_normal_spec_cutout_palette",
    "ped_hair_cutout_alpha",
    "ped_hair_spiked",
    "normal_screendooralpha",
    "glass_breakable_screendooralpha",
    "ped_fur",
];

pub static BLEND_SHADERS: &[&str] = &[
    "alpha",
    "default_alpha",
    "normal_alpha",
    "normal_spec_alpha",
    "spec_alpha",
    "spec_reflect_alpha",
    "normal_reflect_alpha",
    "normal_spec_reflect_alpha",
    "emissive_alpha",
    "emissive_additive_alpha",
    "emissive_alpha_tnt",
    "emissivenight_alpha",
    "emissivestrong",
    "emissivestrong_alpha",
    "glass",
    "glass_normal_spec",
    "glass_normal_spec_reflect",
    "glass_pv",
    "glass_pv_env",
    "glass_spec",
    "glass_emissive_alpha",
    "glass_emissivenight_alpha",
    "vehicle_emissive_alpha",
    "vehicle_vehglass",
    "vehicle_vehglass_inner",
    "weapon_normal_spec_alpha",
    "weapon_emissivestrong_alpha",
    "decal",
    "decal_tnt",
    "decal_dirt",
    "normal_decal",
    "normal_spec_decal",
    "spec_decal",
    "ped_alpha",
    "ped_decal",
    "ped_decal_decoration",
    "ped_decal_exp",
    "ped_decal_nodiff",
];

pub static EMISSIVE_SHADERS: &[&str] = &[
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
    "emissivenight_geomnightonly",
    "emissivestrong",
    "emissivestrong_alpha",
    "glass_emissive",
    "glass_emissive_alpha",
    "glass_emissivenight",
    "glass_emissivenight_alpha",
    "decal_emissive_only",
    "decal_emissivenight_only",
    "normal_spec_emissive",
    "normal_spec_reflect_emissivenight",
    "normal_spec_reflect_emissivenight_alpha",
    "vehicle_emissive_alpha",
    "vehicle_emissive_opaque",
    "vehicle_lightsemissive",
    "weapon_emissive_tnt",
    "weapon_emissivestrong_alpha",
    "ped_emissive",
];

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn digest(list: &[&str]) -> String {
        let text: String = list
            .iter()
            .map(|name| {
                format!(
                    "{name}
"
                )
            })
            .collect();
        Sha256::digest(text.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn lists_match_recorded_digests() {
        let expected: [(&[&str], usize, &str); 10] = [
            (
                SHADERS,
                124,
                "0af36fba0475489170f6ee705f2c482f355ff7d02cd51bf63e0c134d9cd19d03",
            ),
            (
                DIFFUSE_SAMPLERS,
                18,
                "dfc88b95a45e503090756c94c050127a58757d58b2a674e38bbbf1a5b254fdaf",
            ),
            (
                NORMAL_SAMPLERS,
                9,
                "d57d927e4d5b8e55dda921249c0171197b4550390255f8ffdb4cf9ebdf5178e4",
            ),
            (
                SPECULAR_SAMPLERS,
                3,
                "6a0b36d8f45d87aaa4b1603e3ef4704dce8d37cc7c2cb319496e04c734dca265",
            ),
            (
                DETAIL_SAMPLERS,
                2,
                "8efe73fdd254c3ad3fc3bdb984462486e7836f6bbdbf10f3865f8f8ef6a4530c",
            ),
            (
                PALETTE_SAMPLERS,
                2,
                "83ad07de938eca5d6bf9b0c7a82be2833f928e3ae02520570b629fa7179b4178",
            ),
            (
                EMISSIVE_SAMPLERS,
                2,
                "0e18ca4e5d6ab598ccb5b852390e393cb205ce55e387b6ac4ccc2c2a0e27e948",
            ),
            (
                CUTOUT_SHADERS,
                12,
                "65617b27a81af56144855a5fada839d0612cd1bea1cdd42571129d659c5d7e9a",
            ),
            (
                BLEND_SHADERS,
                38,
                "c5aefbb1def25d17ec006bd6253380bd491bbc6aa1c9e8682c25f869f563166a",
            ),
            (
                EMISSIVE_SHADERS,
                28,
                "6d566cf56757c41faf87b6929af7d6c095f8b4eb1abb067b6dcc7e31c8395e4b",
            ),
        ];
        for (index, (list, len, sha)) in expected.into_iter().enumerate() {
            assert_eq!(list.len(), len, "список {index}");
            assert_eq!(digest(list), sha, "список {index}");
        }
    }

    #[test]
    fn no_repeats_even_ignoring_case() {
        let all = [
            SHADERS,
            DIFFUSE_SAMPLERS,
            NORMAL_SAMPLERS,
            SPECULAR_SAMPLERS,
            DETAIL_SAMPLERS,
            PALETTE_SAMPLERS,
            EMISSIVE_SAMPLERS,
            CUTOUT_SHADERS,
            BLEND_SHADERS,
            EMISSIVE_SHADERS,
        ];
        for list in all {
            let mut lower: Vec<String> = list.iter().map(|n| n.to_ascii_lowercase()).collect();
            lower.sort();
            lower.dedup();
            assert_eq!(lower.len(), list.len());
        }
    }

    #[test]
    fn feature_lists_are_subsets_of_shaders() {
        for name in CUTOUT_SHADERS
            .iter()
            .chain(BLEND_SHADERS)
            .chain(EMISSIVE_SHADERS)
        {
            assert!(SHADERS.contains(name), "{name}");
        }
        assert!(
            CUTOUT_SHADERS.contains(&"emissive_clip")
                && EMISSIVE_SHADERS.contains(&"emissive_clip")
        );
        let both = BLEND_SHADERS
            .iter()
            .filter(|n| EMISSIVE_SHADERS.contains(n))
            .count();
        assert_eq!(both, 10);
        let bare = SHADERS
            .iter()
            .filter(|n| {
                ![CUTOUT_SHADERS, BLEND_SHADERS, EMISSIVE_SHADERS]
                    .iter()
                    .any(|l| l.contains(n))
            })
            .count();
        assert_eq!(bare, 57);
    }
}
