// Хэш JOAAT (Дженкинс «один за раз») по младшим байтам единиц кода строки в нижнем регистре.
export const joaat = (text) => {
  const source = String(text).toLowerCase();
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash + (source.charCodeAt(index) & 0xff), 1025);
    hash ^= hash >>> 6;
  }
  hash = Math.imul(hash, 9);
  hash ^= hash >>> 11;
  return Math.imul(hash, 32769) >>> 0;
};

// Имя сэмплера окружения роли не имеет: материалы ищут его по этой константе.
export const ENVIRONMENT_SAMPLER = 3317411368;

// Имена шейдеров игры; хэшируются и с суффиксом файла `.sps`.
const SHADER_NAMES = [
  "glass_env", "trees", "normal_detail", "normal_spec_pxm", "spec_tnt", "reflect", "default",
  "default_um", "default_tnt", "default_spec", "default_spec_um", "default_alpha",
  "default_detail", "default_detail_um", "default_spec_detail", "default_terrain_wet", "alpha",
  "normal", "normal_um", "normal_tnt", "normal_alpha", "normal_cutout", "normal_decal",
  "normal_decal_pxm", "normal_decal_tnt", "normal_um_tnt", "normal_reflect",
  "normal_reflect_alpha", "normal_reflect_decal", "normal_screendooralpha", "normal_spec",
  "normal_spec_alpha", "normal_spec_cutout", "normal_spec_tnt", "normal_spec_emissive",
  "normal_spec_um", "normal_spec_decal", "normal_spec_decal_pxm", "normal_spec_decal_tnt",
  "normal_spec_detail", "normal_spec_detail_um", "normal_spec_reflect",
  "normal_spec_reflect_alpha", "normal_spec_reflect_decal", "normal_spec_reflect_emissivenight",
  "normal_spec_reflect_emissivenight_alpha", "spec", "spec_alpha", "spec_decal", "spec_decal_pxm",
  "spec_reflect", "spec_reflect_alpha", "emissive", "emissive_additive_alpha",
  "emissive_additive_uv_alpha", "emissive_alpha", "emissive_alpha_tnt", "emissive_clip",
  "emissive_speclum", "emissive_tnt", "emissivenight", "emissivenight_alpha",
  "emissivenight_geomnightonly", "emissivestrong", "emissivestrong_alpha", "glass",
  "glass_normal_spec", "glass_normal_spec_reflect", "glass_pv", "glass_pv_env", "glass_spec",
  "glass_emissive", "glass_emissive_alpha", "glass_emissivenight", "glass_emissivenight_alpha",
  "glass_breakable", "glass_breakable_screendooralpha", "cutout", "cutout_um", "decal",
  "decal_diff_only_um", "decal_dirt", "decal_emissive_only", "decal_emissivenight_only",
  "decal_normal_only", "decal_shadow_only", "decal_spec_only", "decal_tnt", "weapon_normal_spec",
  "weapon_normal_spec_alpha", "weapon_normal_spec_cutout", "weapon_normal_spec_tnt",
  "weapon_normal_spec_palette", "weapon_normal_spec_detail", "weapon_normal_spec_detail_palette",
  "weapon_normal_spec_palette_detail_2", "weapon_normal_spec_detail_tnt",
  "weapon_normal_spec_cutout_palette", "weapon_emissive_tnt", "weapon_emissivestrong_alpha",
  "vehicle_vehglass", "vehicle_vehglass_inner", "vehicle_emissive_alpha",
  "vehicle_emissive_opaque", "vehicle_lightsemissive", "ped", "ped_alpha", "ped_cloth",
  "ped_cloth_enveff", "ped_decal", "ped_decal_decoration", "ped_decal_exp", "ped_decal_nodiff",
  "ped_default", "ped_default_cloth", "ped_default_enveff", "ped_default_mp",
  "ped_default_palette", "ped_emissive", "ped_enveff", "ped_fur", "ped_hair_cutout_alpha",
  "ped_hair_spiked", "ped_nopeddamagedecals", "ped_palette", "ped_wrinkle", "ped_wrinkle_cloth",
  "ped_wrinkle_cloth_enveff", "ped_wrinkle_cs", "ped_wrinkle_enveff",
];

// Имена сэмплеров по ролям, в порядке проверки.
const SAMPLER_ROLES = [
  ["diffuse", [
    "DiffuseSampler", "DiffuseSampler2", "DiffuseSamplerPhase2", "DiffuseSamplerPoint",
    "DiffuseTexSampler", "DiffuseTexSampler01", "DiffuseTexSampler02", "DiffuseTexSampler03",
    "DiffuseTexSampler04", "gDiffuse", "TextureGrassSampler", "TextureNoWrapSampler",
    "textureSamp", "TextureSampler", "TextureSampler_layer0", "TextureSampler2", "BaseSampler",
    "baseTextureSampler",
  ]],
  ["normal", [
    "NormalMapSampler", "NormalMapSampler1", "NormalMapSampler2", "NormalMapTexSampler",
    "NormalSampler", "NormalTextureSampler", "BumpSampler", "BumpSampler_layer0", "BumpSampler2",
  ]],
  ["specular", [
    "SpecSampler", "SpecularSampler", "SpecSampler_layer0",
  ]],
  ["detail", [
    "DetailSampler", "DetailSampler2",
  ]],
  ["palette", [
    "TextureSamplerDiffPal", "PaletteSampler",
  ]],
  ["emissive", [
    "EmissiveSampler", "GlowSampler",
  ]],
];

const CUTOUT_SHADERS = [
  "trees", "cutout", "cutout_um", "emissive_clip", "normal_cutout", "normal_spec_cutout",
  "weapon_normal_spec_cutout", "weapon_normal_spec_cutout_palette", "ped_hair_cutout_alpha",
  "ped_hair_spiked", "normal_screendooralpha", "glass_breakable_screendooralpha", "ped_fur",
];

const BLEND_SHADERS = [
  "glass_env", "alpha", "default_alpha", "normal_alpha", "normal_spec_alpha", "spec_alpha",
  "spec_reflect_alpha", "normal_reflect_alpha", "normal_spec_reflect_alpha", "emissive_alpha",
  "emissive_additive_alpha", "emissive_alpha_tnt", "emissivenight_alpha", "emissivestrong",
  "emissivestrong_alpha", "glass", "glass_normal_spec", "glass_normal_spec_reflect", "glass_pv",
  "glass_pv_env", "glass_spec", "glass_emissive_alpha", "glass_emissivenight_alpha",
  "vehicle_emissive_alpha", "vehicle_vehglass", "vehicle_vehglass_inner",
  "weapon_normal_spec_alpha", "weapon_emissivestrong_alpha", "decal", "decal_tnt", "decal_dirt",
  "normal_decal", "normal_spec_decal", "spec_decal", "ped_alpha", "ped_decal",
  "ped_decal_decoration", "ped_decal_exp", "ped_decal_nodiff",
];

const EMISSIVE_SHADERS = [
  "emissive", "emissive_additive_alpha", "emissive_additive_uv_alpha", "emissive_alpha",
  "emissive_alpha_tnt", "emissive_clip", "emissive_speclum", "emissive_tnt", "emissivenight",
  "emissivenight_alpha", "emissivenight_geomnightonly", "emissivestrong", "emissivestrong_alpha",
  "glass_emissive", "glass_emissive_alpha", "glass_emissivenight", "glass_emissivenight_alpha",
  "decal_emissive_only", "decal_emissivenight_only", "normal_spec_emissive",
  "normal_spec_reflect_emissivenight", "normal_spec_reflect_emissivenight_alpha",
  "vehicle_emissive_alpha", "vehicle_emissive_opaque", "vehicle_lightsemissive",
  "weapon_emissive_tnt", "weapon_emissivestrong_alpha", "ped_emissive",
];

const withFiles = (names) => names.flatMap((name) => [name, `${name}.sps`]);

const hashSet = (names) => new Set(names.map(joaat));

const NAME_OF_HASH = new Map(withFiles(SHADER_NAMES).map((name) => [joaat(name), name]));
const ROLE_HASHES = SAMPLER_ROLES.map(([role, names]) => [role, hashSet(names)]);
const CUTOUT_HASHES = hashSet(withFiles(CUTOUT_SHADERS));
const BLEND_HASHES = hashSet(withFiles(BLEND_SHADERS));
const EMISSIVE_HASHES = hashSet(withFiles(EMISSIVE_SHADERS));

// Любое число приводится к беззнаковому 32-битному (bigint и символ бросают).
const asHash = (value) => value >>> 0;

const anyOf = (set, [shader, file]) => set.has(shader) || set.has(file);

const hashPair = (shaderHash, fileHash) => [asHash(shaderHash), asHash(fileHash)];

export const shaderName = (hash) => NAME_OF_HASH.get(asHash(hash)) ?? null;

export const samplerRole = (hash) => {
  const wanted = asHash(hash);
  return ROLE_HASHES.find(([, hashes]) => hashes.has(wanted))?.[0] ?? null;
};

export const alphaModeOf = (shaderHash, fileHash) => {
  const pair = hashPair(shaderHash, fileHash);
  if (anyOf(CUTOUT_HASHES, pair)) return "mask";
  return anyOf(BLEND_HASHES, pair) ? "blend" : "opaque";
};

export const isEmissiveShader = (shaderHash, fileHash) =>
  anyOf(EMISSIVE_HASHES, hashPair(shaderHash, fileHash));
