/*
 * Материал модели оружия — «Стекло» и «Рентген» (задача 1 ТЗ 06.10.2026).
 *
 * Как и прозрачность (`alphaShaders`), материал меняется настоящим шейдером
 * игры в самой модели ствола, на месте: у каждой детали её набор параметров
 * переписывается в её же блок — те же указатели на текстуры цвета, нормалей
 * и блеска, раскладка как в файлах игры (порядок параметров позиционный, и
 * чужой порядок ронял бы игру). Детали, которые светятся сами (свечение
 * скина), и уже прозрачные (линзы прицелов) остаются как были.
 *
 *   • «Стекло» — шейдер стёкол игры `glass_env` (витрины, холодильники):
 *     отражение неба и окружения (`EnvironmentSampler` шейдер берёт сам),
 *     узкий яркий блик (`specularFalloffMult` 300, `specularFresnel` 0,96),
 *     корзина прозрачных. Раскладка — как у `prop_bar_beerfridge_01.ydr`:
 *     три текстуры и восемь векторов, 348 байт. Цвет стекла и его
 *     прозрачность пишет запекание (`ytd-bake.js`, `materialPixels`).
 *   • «Рентген» — светящийся полупрозрачный шейдер игры `emissive` с файлом
 *     `emissive_alpha.sps` (светящиеся вывески за стеклом, `v_66_fridge`):
 *     деталь светится своим цветом и просвечивает; запекание делает из её
 *     текстуры контуры деталей одним цветом («снимок»), альфа — по контуру.
 *     Раскладка `emissive` (семь параметров, 236 байт).
 *
 * Чего игра не даёт: «рентгена сквозь стены» у ствола нет — модель видна
 * только там, где её видно и без материала.
 */

import { FX, bucketMaskOf, diffuseName, isDecorationTexture, readParameters, shaderList } from "./shader-glow.js";
import { alphaModeOf, isEmissiveShader, joaat, shaderName } from "./shaders.js";
import { MODEL_XRAY_GLOW } from "./material-pixels.js";

export {
  MODEL_MATERIALS,
  MODEL_MATERIAL_TINT,
  MODEL_XRAY_GLOW,
  materialPixels,
  normalizeMaterialTint,
  normalizeModelMaterial,
} from "./material-pixels.js";

const LOD_FLAGS = Object.freeze([0x80, 0x84, 0x88, 0x8c]);
const TRANSPARENT_BUCKET = 1;

/*
 * Раскладки — из файлов игры: `[имя, тип]` (0 — текстура, 1 — вектор) и
 * значения векторов. Текстуры берутся указателями прежнего шейдера детали.
 */
const MATERIALS = Object.freeze({
  glass: Object.freeze({
    shader: "glass_env",
    file: "glass_env.sps",
    layout: Object.freeze([
      ["DiffuseSampler", 0],
      ["BumpSampler", 0],
      ["SpecSampler", 0],
      ["useTessellation", 1],
      ["bumpiness", 1],
      ["specMapIntMask", 1],
      ["specularIntensityMult", 1],
      ["specularFalloffMult", 1],
      ["specularFresnel", 1],
      ["globalAnimUV1", 1],
      ["globalAnimUV0", 1],
    ]),
    values: Object.freeze({
      useTessellation: [0, 0, 0, 0],
      bumpiness: [0.6, 0, 0, 0],
      specMapIntMask: [1, 0, 0, 0],
      specularIntensityMult: [1.2, 0, 0, 0],
      specularFalloffMult: [300, 0, 0, 0],
      specularFresnel: [0.96, 0, 0, 0],
      globalAnimUV1: [0, 1, 0, 0],
      globalAnimUV0: [1, 0, 0, 0],
    }),
    textures: ["DiffuseSampler", "BumpSampler", "SpecSampler"],
  }),
  xray: Object.freeze({
    shader: "emissive",
    file: "emissive_alpha.sps",
    layout: Object.freeze([
      ["DiffuseSampler", 0],
      ["matMaterialColorScale", 1],
      ["HardAlphaBlend", 1],
      ["useTessellation", 1],
      ["emissiveMultiplier", 1],
      ["globalAnimUV1", 1],
      ["globalAnimUV0", 1],
    ]),
    values: Object.freeze({
      matMaterialColorScale: [1, 0, 0, 1],
      HardAlphaBlend: [1, 0, 0, 0],
      useTessellation: [0, 0, 0, 0],
      emissiveMultiplier: [MODEL_XRAY_GLOW.standard, 0, 0, 0],
      globalAnimUV1: [0, 1, 0, 0],
      globalAnimUV0: [1, 0, 0, 0],
    }),
    textures: ["DiffuseSampler"],
  }),
});

/** Размеры блока: записи по 16 байт, векторы по 16, хеши по 4. */
function sizesOf(layout) {
  const vectors = layout.filter(([, type]) => type).length;
  const size = layout.length * 16 + vectors * 16;
  const bytes = size + layout.length * 4;
  return { size, bytes, dataSize: Math.ceil((32 + bytes) / 16) * 16 };
}

/**
 * Детали модели — на шейдер материала (`glass`, `xray`), на месте:
 * `{ changed: [{ index, shader, texture }], skipped: [{ texture, reason }] }`.
 * `texture` — имя текстуры цвета детали: её пиксели и альфу пишет
 * запекание. `glow` — сила свечения рентгена.
 */
export function materialShaders(resource, material, { glow = MODEL_XRAY_GLOW.standard } = {}) {
  const spec = MATERIALS[material];
  if (!spec) return { changed: [], skipped: [] };
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const sizes = sizesOf(spec.layout);
  const changed = [];
  const skipped = [];
  for (const [index, shaderAt] of shaderList(resource).entries()) {
    if (shaderAt < 0) continue;
    const nameHash = view.getUint32(shaderAt + FX.name, true);
    const fileHash = view.getUint32(shaderAt + FX.file, true);
    const params = readParameters(resource, shaderAt);
    const texture = params ? diffuseName(resource, params.entries) : null;
    /* Украшение Astral — своим видом, без «не легло». */
    if (isDecorationTexture(texture)) continue;
    const name = shaderName(nameHash) || `0x${nameHash.toString(16)}`;
    /* Уже на материале (повторная сборка той же модели). */
    if (fileHash === joaat(spec.file) && nameHash === joaat(spec.shader)) continue;
    if (isEmissiveShader(nameHash, fileHash)) {
      skipped.push({ texture, reason: "деталь светится — свечение остаётся как было" });
      continue;
    }
    if (alphaModeOf(nameHash, fileHash) === "blend" || fileHash === joaat("glass_env.sps")) continue;
    if (!params || !texture) {
      skipped.push({ texture, reason: "у детали нет текстуры цвета" });
      continue;
    }
    const pointers = new Map(params.entries.filter((entry) => entry.type === 0).map((entry) => [entry.hash, entry.pointer]));
    const missing = spec.textures.filter((sampler) => !pointers.get(joaat(sampler)));
    if (missing.length) {
      skipped.push({ texture, reason: `у шейдера ${name} нет ${missing.join(", ")} — материал не наложить` });
      continue;
    }
    if (sizes.bytes > params.bytes) {
      skipped.push({ texture, reason: `блок параметров детали короче нужного (${params.bytes} из ${sizes.bytes} байт)` });
      continue;
    }
    const base = view.getBigUint64(shaderAt + FX.parameters, true);
    const at = params.at;
    resource.data.fill(0, at, at + params.bytes);
    let vector = 0;
    for (const [slot, [parameter, type]] of spec.layout.entries()) {
      const entryAt = at + slot * 16;
      if (type === 0) {
        view.setUint8(entryAt, 0);
        view.setBigUint64(entryAt + 8, pointers.get(joaat(parameter)), true);
        continue;
      }
      const dataOffset = spec.layout.length * 16 + vector * 16;
      view.setUint8(entryAt, 1);
      view.setBigUint64(entryAt + 8, base + BigInt(dataOffset), true);
      const value = parameter === "emissiveMultiplier" ? [glow, 0, 0, 0] : spec.values[parameter];
      value.forEach((number, component) => view.setFloat32(at + dataOffset + component * 4, number, true));
      vector += 1;
    }
    const hashesAt = at + sizes.size;
    spec.layout.forEach(([parameter], slot) => view.setUint32(hashesAt + slot * 4, joaat(parameter), true));
    view.setUint32(shaderAt + FX.name, joaat(spec.shader), true);
    view.setUint32(shaderAt + FX.file, joaat(spec.file), true);
    view.setUint8(shaderAt + FX.count, spec.layout.length);
    view.setUint8(shaderAt + FX.bucket, TRANSPARENT_BUCKET);
    view.setUint32(shaderAt + FX.bucketMask, bucketMaskOf(TRANSPARENT_BUCKET), true);
    view.setUint16(shaderAt + FX.flags, 0x8000, true);
    view.setUint16(shaderAt + FX.parameterSize, sizes.size, true);
    view.setUint16(shaderAt + FX.parameterDataSize, sizes.dataSize, true);
    view.setUint8(shaderAt + FX.textureCount, spec.textures.length);
    changed.push({ index, shader: name, texture });
  }
  /* Корзина прозрачных — в маски уровней детализации модели: иначе игра не
     позовёт эти детали в проход прозрачных (задача 2 ТЗ 05.10.2026). */
  if (changed.length && rootAt >= 0)
    for (const offset of LOD_FLAGS) {
      const flags = view.getUint32(rootAt + offset, true);
      if (flags) view.setUint32(rootAt + offset, flags | (1 << TRANSPARENT_BUCKET), true);
    }
  return { changed, skipped };
}

