/*
 * Размер и прозрачность модели оружия — в самой модели (задача 2 ТЗ
 * 05.10.2026: «изменение размера самой модели оружия», «прозрачность /
 * непрозрачность оружия»).
 *
 * Размера у оружия в файлах игры нет: ни `weapons.meta`, ни архетип ствола
 * масштаба не знают, и без скрипта ствол в руках всегда такой, какой его
 * сделал Rockstar. Поэтому крупнее или мельче становится сама модель — на
 * месте, как перешивка свечения (`shader-glow.js`): страницы ресурса те
 * же, меняются только числа.
 *
 *   • вершины всех уровней детализации — позиции float3 умножаются на
 *     множитель. Модели оружия «с кожей» (вершины в осях модели, веса по
 *     костям), поэтому вместе с ними множатся переносы костей скелета и
 *     переносы обеих матриц позы (`Transformations` и обратной): элементы
 *     12–14. В элементах 3, 7, 11 у RAGE служебные числа — их не трогать
 *     (сверено на w_pi_pistol, w_ar_carbinerifle, w_sg_pumpshotgun);
 *   • границы модели (сфера и коробка) и коробки частей.
 *
 * Кость рукояти (`Gun_GripR`) остаётся в руке: ствол растёт от начала осей
 * модели, а рука держит её кость, которая переезжает вместе со стволом.
 *
 * Прозрачность — шейдер игры `weapon_normal_spec_alpha` (им сделаны стёкла
 * прицелов): у каждой детали ствола набор параметров переписывается в её же
 * блок на месте — те же текстуры цвета, нормалей и блеска, раскладка как в
 * 55 местах файлов игры, корзина 1 (прозрачные). Прозрачность даёт альфа
 * текстуры цвета — её пишет запекание скина (`ytd-bake.js`). Светящиеся
 * детали (свечение в игре) и уже прозрачные (линзы) не перешиваются.
 */

import { pointerAt, readPointerList } from "@modovik/ypt/resource-core";
import { FX, bucketMaskOf, diffuseName, isDecorationTexture, readParameters, shaderList } from "./shader-glow.js";
import { alphaModeOf, isEmissiveShader, joaat, shaderName } from "./shaders.js";
import { SEMANTIC, TYPE, vertexLayout } from "./vertex.js";

/** Размер модели: множитель длины. */
export const MODEL_SCALE = Object.freeze({ min: 0.5, max: 2, standard: 1 });
/** Непрозрачность модели: 1 — как в игре. */
export const MODEL_OPACITY = Object.freeze({ min: 0.1, max: 1, standard: 1 });

const LOD_POINTERS = Object.freeze([0x50, 0x58, 0x60, 0x68]);
/* Маски корзин отрисовки по уровням детализации: младший байт — корзины
   шейдеров (бит 0 — сплошные, бит 1 — прозрачные). */
const LOD_FLAGS = Object.freeze([0x80, 0x84, 0x88, 0x8c]);
const MAX_MODELS = 256;
const MAX_GEOMETRIES = 1024;
const MAX_VERTICES = 1 << 20;
const MAX_BONES = 1024;

const ALPHA_SHADER = "weapon_normal_spec_alpha";
/* Раскладка `weapon_normal_spec_alpha` в файлах игры — одна на все 55 мест
   (прицелы w_at_scope_*): три текстуры и семь векторов, блок 312 байт. */
const ALPHA_LAYOUT = Object.freeze([
  ["DiffuseSampler", 0],
  ["BumpSampler", 0],
  ["SpecSampler", 0],
  ["useTessellation", 1],
  ["wetnessMultiplier", 1],
  ["bumpiness", 1],
  ["specMapIntMask", 1],
  ["specularIntensityMult", 1],
  ["specularFalloffMult", 1],
  ["specularFresnel", 1],
]);
/* Значения, если у прежнего шейдера такого параметра не было: как у прицелов
   игры, кроме маски блеска — у ствола блеск берётся из красного канала. */
const ALPHA_DEFAULTS = Object.freeze({
  useTessellation: [0, 0, 0, 0],
  wetnessMultiplier: [0, 0, 0, 0],
  bumpiness: [1, 0, 0, 0],
  specMapIntMask: [1, 0, 0, 0],
  specularIntensityMult: [1, 0, 0, 0],
  specularFalloffMult: [40, 0, 0, 0],
  specularFresnel: [0.6, 0, 0, 0],
});
const ALPHA_BUCKET = 1;

const clamp = (value, { min, max, standard }) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : standard;
};

/** Множитель размера в пределах (по сотым). */
export const normalizeModelScale = (value) => Math.round(clamp(value, MODEL_SCALE) * 100) / 100;
/** Непрозрачность в пределах (по сотым). */
export const normalizeModelOpacity = (value) => Math.round(clamp(value, MODEL_OPACITY) * 100) / 100;

function scaleFloats(view, at, offsets, factor) {
  for (const offset of offsets) view.setFloat32(at + offset, view.getFloat32(at + offset, true) * factor, true);
}

/* Части модели всех уровней детализации: смещения структур DrawableModel. */
function modelsOf(resource, rootAt) {
  const models = [];
  for (const offset of LOD_POINTERS) {
    const listAt = pointerAt(resource, rootAt + offset);
    if (listAt < 0) continue;
    const list = readPointerList(resource, listAt);
    const entriesAt = resource.at(list.entries);
    if (!list.count || entriesAt < 0) continue;
    if (list.count > MAX_MODELS) throw new Error("Модель заявляет слишком много частей.");
    for (let index = 0; index < list.count; index += 1) {
      const modelAt = pointerAt(resource, entriesAt + index * 8);
      if (modelAt >= 0) models.push(modelAt);
    }
  }
  return models;
}

/**
 * Масштаб модели на месте: `{ vertices, bones, models }`. Бросает, если у
 * геометрии позиции не float3/float4 — тогда модель целиком остаётся как
 * была (полумасштаб хуже любого).
 */
export function scaleDrawable(resource, factor) {
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  if (rootAt < 0) throw new Error("Корень модели недоступен.");
  if (!(factor > 0) || !Number.isFinite(factor)) throw new Error("Множитель размера должен быть положительным.");
  const models = modelsOf(resource, rootAt);
  /* Сначала проверка всех буферов: менять — только если меняется всё. */
  const buffers = new Map();
  for (const modelAt of models) {
    const count = view.getUint16(modelAt + 0x10, true);
    if (count > MAX_GEOMETRIES) throw new Error("Часть модели заявляет слишком много геометрий.");
    const geometriesAt = pointerAt(resource, modelAt + 0x08);
    for (let slot = 0; slot < count && geometriesAt >= 0; slot += 1) {
      const geometryAt = pointerAt(resource, geometriesAt + slot * 8);
      if (geometryAt < 0) continue;
      const bufferAt = pointerAt(resource, geometryAt + 0x18);
      if (bufferAt < 0) continue;
      const vertices = view.getUint32(bufferAt + 0x18, true);
      const declarationAt = pointerAt(resource, bufferAt + 0x30);
      if (declarationAt < 0 || vertices > MAX_VERTICES) throw new Error("Буфер вершин модели не читается.");
      const { layout, stride: computed } = vertexLayout(
        view.getUint32(declarationAt, true),
        view.getBigUint64(declarationAt + 8, true),
      );
      const position = layout.get(SEMANTIC.position);
      if (!position || (position.type !== TYPE.float3 && position.type !== TYPE.float4))
        throw new Error("Позиции вершин модели не в float3 — размер не поменять.");
      const stride = view.getUint16(bufferAt + 0x08, true) || view.getUint16(declarationAt + 4, true) || computed;
      for (const pointer of [0x10, 0x20]) {
        const dataAt = pointerAt(resource, bufferAt + pointer);
        if (dataAt < 0) continue;
        if (dataAt + vertices * stride > view.byteLength) throw new Error("Буфер вершин модели длиннее файла.");
        buffers.set(dataAt, { vertices, stride, offset: position.offset });
      }
    }
  }
  let vertices = 0;
  for (const [dataAt, buffer] of buffers) {
    for (let index = 0; index < buffer.vertices; index += 1)
      scaleFloats(view, dataAt + index * buffer.stride + buffer.offset, [0, 4, 8], factor);
    vertices += buffer.vertices;
  }
  /* Коробки частей: на каждую геометрию своя и общая, если геометрий больше одной. */
  for (const modelAt of models) {
    const boundsAt = pointerAt(resource, modelAt + 0x18);
    const count = view.getUint16(modelAt + 0x10, true);
    if (boundsAt < 0) continue;
    const boxes = count > 1 ? count + 1 : count;
    for (let box = 0; box < boxes; box += 1) scaleFloats(view, boundsAt + box * 32, [0, 4, 8, 16, 20, 24], factor);
  }
  /* Границы модели: центр и радиус сферы, коробка (четвёртые числа — не оси). */
  scaleFloats(view, rootAt, [0x20, 0x24, 0x28, 0x2c, 0x30, 0x34, 0x38, 0x40, 0x44, 0x48], factor);
  /* Скелет: переносы костей и обеих матриц позы. */
  let bones = 0;
  const skeletonAt = pointerAt(resource, rootAt + 0x18);
  if (skeletonAt >= 0) {
    const count = view.getUint16(skeletonAt + 0x5e, true);
    if (count > MAX_BONES) throw new Error("Скелет модели заявляет слишком много костей.");
    const bonesAt = pointerAt(resource, skeletonAt + 0x20);
    if (bonesAt >= 0) for (let bone = 0; bone < count; bone += 1) scaleFloats(view, bonesAt + bone * 0x50, [0x10, 0x14, 0x18], factor);
    for (const pointer of [0x28, 0x30]) {
      const matricesAt = pointerAt(resource, skeletonAt + pointer);
      if (matricesAt >= 0) for (let bone = 0; bone < count; bone += 1) scaleFloats(view, matricesAt + bone * 64, [48, 52, 56], factor);
    }
    bones = count;
  }
  return { vertices, bones, models: models.length };
}

/**
 * Детали модели — на прозрачный шейдер игры, на месте: `{ changed, skipped }`.
 * `changed` — `[{ index, shader, texture }]`, где `texture` — имя текстуры
 * цвета детали: её альфа и даст прозрачность. `skipped` — `[{ texture,
 * reason }]`.
 */
export function alphaShaders(resource) {
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  /* Записи по 16 байт, векторы данных, хеши имён — как в файлах игры:
     272 байта записей и векторов, 312 с хешами, 352 у ShaderFX. */
  const vectorCount = ALPHA_LAYOUT.filter(([, type]) => type).length;
  const size = ALPHA_LAYOUT.length * 16 + vectorCount * 16;
  const bytes = size + ALPHA_LAYOUT.length * 4;
  const dataSize = Math.ceil((32 + bytes) / 16) * 16;
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
    if (isEmissiveShader(nameHash, fileHash)) {
      skipped.push({ texture, reason: "деталь светится — свечение остаётся непрозрачным" });
      continue;
    }
    if (alphaModeOf(nameHash, fileHash) === "blend") continue;
    if (!params || !texture) {
      skipped.push({ texture, reason: "у детали нет текстуры цвета" });
      continue;
    }
    const pointers = new Map(
      params.entries.filter((entry) => entry.type === 0).map((entry) => [entry.hash, entry.pointer]),
    );
    const missing = ["DiffuseSampler", "BumpSampler", "SpecSampler"].filter((sampler) => !pointers.get(joaat(sampler)));
    if (missing.length) {
      skipped.push({ texture, reason: `у шейдера ${name} нет ${missing.join(", ")} — прозрачной её не сделать` });
      continue;
    }
    if (bytes > params.bytes) {
      skipped.push({ texture, reason: `блок параметров детали короче нужного (${params.bytes} из ${bytes} байт)` });
      continue;
    }
    const values = new Map(
      params.entries.filter((entry) => entry.values).map((entry) => [entry.hash, entry.values]),
    );
    const base = view.getBigUint64(shaderAt + FX.parameters, true);
    const at = params.at;
    resource.data.fill(0, at, at + params.bytes);
    let vector = 0;
    for (const [slot, [parameter, type]] of ALPHA_LAYOUT.entries()) {
      const entryAt = at + slot * 16;
      if (type === 0) {
        view.setUint8(entryAt, 0);
        view.setBigUint64(entryAt + 8, pointers.get(joaat(parameter)), true);
        continue;
      }
      const dataOffset = ALPHA_LAYOUT.length * 16 + vector * 16;
      view.setUint8(entryAt, 1);
      view.setBigUint64(entryAt + 8, base + BigInt(dataOffset), true);
      const value = values.get(joaat(parameter)) || ALPHA_DEFAULTS[parameter];
      value.forEach((number, component) => view.setFloat32(at + dataOffset + component * 4, number, true));
      vector += 1;
    }
    const hashesAt = at + size;
    ALPHA_LAYOUT.forEach(([parameter], slot) => view.setUint32(hashesAt + slot * 4, joaat(parameter), true));
    view.setUint32(shaderAt + FX.name, joaat(ALPHA_SHADER), true);
    view.setUint32(shaderAt + FX.file, joaat(`${ALPHA_SHADER}.sps`), true);
    view.setUint8(shaderAt + FX.count, ALPHA_LAYOUT.length);
    view.setUint8(shaderAt + FX.bucket, ALPHA_BUCKET);
    view.setUint32(shaderAt + FX.bucketMask, bucketMaskOf(ALPHA_BUCKET), true);
    view.setUint16(shaderAt + FX.flags, 0x8000, true);
    view.setUint16(shaderAt + FX.parameterSize, size, true);
    view.setUint16(shaderAt + FX.parameterDataSize, dataSize, true);
    view.setUint8(shaderAt + FX.textureCount, 3);
    changed.push({ index, shader: name, texture });
  }
  /* Корзина прозрачных — в маски уровней детализации, что есть у модели:
     иначе игра не позовёт эти детали в проход прозрачных. */
  if (changed.length && rootAt >= 0)
    for (const offset of LOD_FLAGS) {
      const flags = view.getUint32(rootAt + offset, true);
      if (flags) view.setUint32(rootAt + offset, flags | (1 << ALPHA_BUCKET), true);
    }
  return { changed, skipped };
}
