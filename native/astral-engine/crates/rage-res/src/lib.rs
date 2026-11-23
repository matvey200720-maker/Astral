//! Ресурсы GTA V (Legacy): контейнер RSC7, словари текстур, модели.
//!
//! Крейт читает файлы, а не архивы: на вход байты `.ytd`, `.ydr`, `.ydd`,
//! `.yft`, на выход PNG и GLB. Разметка структур описана в
//! `launcher_app/docs/RUST-ENGINE-PLAN.md` и сверена с нашим форматным слоем
//! (`packages/rage-drawable`, `packages/ypt`, `packages/dds`) и с открытым
//! RageLib (MIT, см. `native/THIRD_PARTY_NOTICES.md`).

pub mod animal_model;
pub mod ars1;
pub mod awc;
pub mod awc_build;
pub mod weapons_meta;
pub mod weapons_meta_decimal;
pub mod bc7_mode6;
pub mod bc_encode;
pub mod body_skin;
pub mod dds_build;
pub mod dxt_block;
pub mod card;
pub mod convert;
pub mod dds;
pub mod drawable;
pub mod drawable_js;
pub mod donor;
pub mod drawable_write;
pub mod error;
pub mod fragment_textures;
pub mod glb;
pub mod gpu_asset;
pub mod gpu_model;
pub mod hash;
pub mod js_math;
mod math;
pub mod manifest_write;
pub mod meta_graph;
pub mod mlo;
mod parallel;
pub mod climb_mod;
pub mod place_types;
pub mod png_io;
pub mod lamp_glass;
pub mod lamp_light;
pub mod placements;
pub mod pso;
pub mod resource;
pub mod resource_graph;
pub mod scene;
mod shader_tables;
pub mod meta_map;
pub mod placement_math;
pub mod shader_vectors;
pub mod shop_material;
pub mod shaders;
pub mod sheet_blocks;
pub mod shader_write;
pub mod style;
pub mod texture;
pub mod texture_js;
pub mod vertex;
pub mod ypt;
pub mod ytd_edit;
pub mod ytd_gen9;
pub mod ydr_gen9;
pub mod wallbang;
pub mod sky_rainbow;
pub mod ycd;
pub mod ycd_pose;
pub mod ycd_uv;
pub mod sky_clip;
pub mod star_clip;
pub mod ycd_write;
pub mod rbf;
pub mod ymap_write;
pub mod ytyp_write;
pub mod ytyp_particles;
pub mod ytd_write;
pub mod ydr_synth;
pub mod world_mesh;
pub mod world_place;
pub mod world_rules;

pub use error::{Error, Kind, Result};
pub use resource::Resource;
