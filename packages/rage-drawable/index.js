import { openResourceWith } from "@modovik/ypt/resource-core";
import {
  DRAWABLE_VERSION_LEGACY,
  FRAGMENT_VERSION_LEGACY,
  drawableKindOf,
  readDrawable,
  readDrawableAt,
} from "./drawable.js";
import { normalMapRgba, specularRoughnessRgba } from "./normal.js";
import {
  MODEL_OPACITY,
  MODEL_SCALE,
  alphaShaders,
  normalizeModelOpacity,
  normalizeModelScale,
  scaleDrawable,
} from "./model-adjust.js";
import {
  MODEL_MATERIALS,
  MODEL_MATERIAL_TINT,
  MODEL_XRAY_GLOW,
  materialPixels,
  materialShaders,
  normalizeMaterialTint,
  normalizeModelMaterial,
} from "./model-material.js";
import {
  DECORATION_TEXTURE_PREFIX,
  GLOW_INTENSITY,
  GLOW_SHADERS,
  glowCandidates,
  glowShaders,
  isDecorationTexture,
} from "./shader-glow.js";
import { ENVIRONMENT_SAMPLER, alphaModeOf, isEmissiveShader, joaat, samplerRole, shaderName } from "./shaders.js";
import {
  TEXTURE_FORMATS,
  YTD_VERSION_LEGACY,
  decodeTextureRef,
  readTextureDictionaryAt,
  readTextureDictionaryResource,
} from "./texture.js";
import { VEHICLE_WHEELS, readVehicle } from "./vehicle.js";
import { halfToFloat, vertexLayout } from "./vertex.js";

const YTD_ENHANCED = 5;

// Ресурс, который уже открыт: у него есть и view, и at.
const isOpened = (input) => Boolean(input?.view && input?.at);

const wrongVersion = (version) => {
  const [code, text] =
    version === YTD_ENHANCED
      ? ["RAGE_ENHANCED", "Словарь текстур из GTA V Enhanced — Astral читает Legacy."]
      : ["RAGE_VERSION", `Это не словарь текстур Legacy (версия ${version}).`];
  return Object.assign(new Error(text), { code });
};

function readTextureDictionary(input, { inflateRaw } = {}) {
  const resource = isOpened(input) ? input : openResourceWith(input, inflateRaw);
  if (resource.version === YTD_VERSION_LEGACY) return readTextureDictionaryResource(resource);
  throw wrongVersion(resource.version);
}

// Все записи всех словарей по порядку; пустые словари и отсутствующие пропускаются.
function* entriesOf(dictionaries) {
  for (const dictionary of dictionaries || []) {
    for (const texture of dictionary || []) yield texture;
  }
}

const firstWhere = (items, test) => {
  for (const item of items) {
    if (test(item)) return item;
  }
  return undefined;
};

const hasName = (wanted) => (texture) => texture.name.toLowerCase() === wanted;

const findTexture = (name, dictionaries) =>
  name ? (firstWhere(entriesOf(dictionaries), hasName(String(name).toLowerCase())) ?? null) : null;

const decodeNamedTexture = (name, dictionaries, options) => {
  const ref = findTexture(name, dictionaries);
  return ref && decodeTextureRef(ref, options);
};

export {
  DECORATION_TEXTURE_PREFIX,
  DRAWABLE_VERSION_LEGACY,
  ENVIRONMENT_SAMPLER,
  FRAGMENT_VERSION_LEGACY,
  GLOW_INTENSITY,
  GLOW_SHADERS,
  MODEL_MATERIALS,
  MODEL_MATERIAL_TINT,
  MODEL_OPACITY,
  MODEL_SCALE,
  MODEL_XRAY_GLOW,
  TEXTURE_FORMATS,
  VEHICLE_WHEELS,
  YTD_VERSION_LEGACY,
  alphaModeOf,
  alphaShaders,
  decodeNamedTexture,
  decodeTextureRef,
  drawableKindOf,
  findTexture,
  glowCandidates,
  glowShaders,
  halfToFloat,
  isDecorationTexture,
  isEmissiveShader,
  joaat,
  materialPixels,
  materialShaders,
  normalMapRgba,
  normalizeMaterialTint,
  normalizeModelMaterial,
  normalizeModelOpacity,
  normalizeModelScale,
  readDrawable,
  readDrawableAt,
  readTextureDictionary,
  readTextureDictionaryAt,
  readVehicle,
  samplerRole,
  scaleDrawable,
  shaderName,
  specularRoughnessRgba,
  vertexLayout,
};
