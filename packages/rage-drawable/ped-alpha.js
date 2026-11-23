/*
 * Прозрачность вещи одежды — шейдер игры `ped_alpha` (задача 3 ТЗ
 * 05.10.2026: «настраивает прозрачность / непрозрачность вещи, если это
 * технически возможно»).
 *
 * Так сделаны стёкла очков педов (`p_eyes_001.ydd`): те же текстуры цвета,
 * деталей, нормалей и блеска, корзина 1 (прозрачные), прозрачность — альфа
 * текстуры цвета. Обычная одежда нарисована `ped_default` / `ped` и их
 * вариантами с палитрой: их блок параметров (388 байт) длиннее нужного
 * `ped_alpha` (368), поэтому набор переписывается на месте — как свечение
 * ствола (`shader-glow.js`) и прозрачность ствола (`model-adjust.js`).
 * Раскладка — как у очков в файлах игры (одна на все 31 место в
 * `x64v.rpf`): четыре текстуры, восемь векторов; у трёх параметров в
 * файлах только хеши имён — они и пишутся.
 *
 * Волосы (вырез), наклейки и светящиеся детали не перешиваются: у них своя
 * прозрачность или её нет по смыслу.
 */

import { pointerAt } from "@modovik/ypt/resource-core";
import { FX, bucketMaskOf, diffuseName, readParameters } from "./shader-glow.js";
import { joaat, shaderName } from "./shaders.js";

const PED_ALPHA = "ped_alpha";
const ALPHA_BUCKET = 1;
const MAX_DRAWABLES = 4096;
const MAX_SHADERS = 256;
const LOD_FLAGS = Object.freeze([0x80, 0x84, 0x88, 0x8c]);

/* Параметры по хешам: у трёх в файлах игры имени нет. */
const DETAIL = 0xab98831e;
const DETAIL_SETTINGS_2 = 0x21ffda1a;
const SPEC_SETTINGS = 0x1a06bf4b;
const LAYOUT = Object.freeze([
  [joaat("DiffuseSampler"), 0],
  [DETAIL, 0],
  [joaat("BumpSampler"), 0],
  [joaat("SpecSampler"), 0],
  [DETAIL_SETTINGS_2, 1],
  [SPEC_SETTINGS, 1],
  [joaat("specularIntensityMult"), 1],
  [joaat("specularFalloffMult"), 1],
  [joaat("specularFresnel"), 1],
  [joaat("bumpiness"), 1],
  [joaat("detailSettings"), 1],
  [joaat("StubbleControl"), 1],
]);
/* Значения, если у прежнего шейдера параметра не было: как у очков игры. */
const DEFAULTS = new Map([
  [DETAIL_SETTINGS_2, [0.002, 0.002, 7, 7]],
  [SPEC_SETTINGS, [25, 25, 0, 0]],
  [joaat("specularIntensityMult"), [0.125, 0, 0, 0]],
  [joaat("specularFalloffMult"), [100, 0, 0, 0]],
  [joaat("specularFresnel"), [0.97, 0, 0, 0]],
  [joaat("bumpiness"), [1, 0, 0, 0]],
  [joaat("detailSettings"), [0.1, 0.75, 40, 0]],
  [joaat("StubbleControl"), [2, 0.6, 0, 0]],
]);
/* Непрозрачные шейдеры вещей, что переводятся на `ped_alpha`. */
const OPAQUE_PED = new Set(
  [
    "ped",
    "ped_default",
    "ped_default_mp",
    "ped_palette",
    "ped_default_palette",
    "ped_nopeddamagedecals",
    "ped_cloth",
    "ped_default_cloth",
    "ped_enveff",
    "ped_default_enveff",
    "ped_cloth_enveff",
    "ped_wrinkle",
    "ped_wrinkle_cloth",
    "ped_wrinkle_enveff",
    "ped_wrinkle_cloth_enveff",
  ].map((name) => joaat(name)),
);

/* Модели ресурса: у словаря (`.ydd`) — все его модели, у `.ydr` — одна. */
function drawablesOf(resource) {
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  if (rootAt < 0) return [];
  /* У словаря в 0x18 стоит единица, у модели — указатель на скелет или 0. */
  if (view.getBigUint64(rootAt + 0x18, true) !== 1n) return [rootAt];
  const listAt = pointerAt(resource, rootAt + 0x30);
  const count = view.getUint16(rootAt + 0x38, true);
  if (listAt < 0 || count > MAX_DRAWABLES) return [];
  const drawables = [];
  for (let index = 0; index < count; index += 1) {
    const at = pointerAt(resource, listAt + index * 8);
    if (at >= 0) drawables.push(at);
  }
  return drawables;
}

function shadersOf(resource, drawableAt) {
  const view = resource.view;
  const groupAt = pointerAt(resource, drawableAt + 0x10);
  if (groupAt < 0) return [];
  const shadersAt = pointerAt(resource, groupAt + 0x10);
  const count = view.getUint16(groupAt + 0x18, true);
  if (shadersAt < 0 || count > MAX_SHADERS) return [];
  return Array.from({ length: count }, (_, index) => pointerAt(resource, shadersAt + index * 8)).filter((at) => at >= 0);
}

/**
 * Детали вещи — на `ped_alpha`, на месте: `{ changed, skipped }`.
 * `changed` — `[{ shader, texture }]` (`texture` — текстура цвета: её альфа
 * даст прозрачность), `skipped` — `[{ texture, reason }]`.
 */
export function pedAlphaShaders(resource) {
  const view = resource.view;
  const size = LAYOUT.length * 16 + LAYOUT.filter(([, type]) => type).length * 16;
  const bytes = size + LAYOUT.length * 4;
  const dataSize = Math.ceil((32 + bytes) / 16) * 16;
  const changed = [];
  const skipped = [];
  for (const drawableAt of drawablesOf(resource)) {
    let switched = 0;
    for (const shaderAt of shadersOf(resource, drawableAt)) {
      const nameHash = view.getUint32(shaderAt + FX.name, true);
      if (!OPAQUE_PED.has(nameHash >>> 0)) continue;
      const name = shaderName(nameHash) || `0x${nameHash.toString(16)}`;
      const params = readParameters(resource, shaderAt);
      const texture = params ? diffuseName(resource, params.entries) : null;
      if (!params || !texture) {
        skipped.push({ texture, reason: "у детали нет текстуры цвета" });
        continue;
      }
      /* Пустые текстуры (деталь — всегда, нормали и блеск — у части вещей)
         в файлах игры обычны: игра берёт свои по умолчанию. Нужна только
         текстура цвета — её альфа и есть прозрачность. */
      const pointers = new Map(params.entries.filter((entry) => entry.type === 0).map((entry) => [entry.hash >>> 0, entry.pointer]));
      if (!pointers.get(LAYOUT[0][0])) {
        skipped.push({ texture, reason: `у шейдера ${name} нет текстуры цвета` });
        continue;
      }
      if (bytes > params.bytes) {
        skipped.push({ texture, reason: `блок параметров детали короче нужного (${params.bytes} из ${bytes} байт)` });
        continue;
      }
      const values = new Map(params.entries.filter((entry) => entry.values).map((entry) => [entry.hash >>> 0, entry.values]));
      const base = view.getBigUint64(shaderAt + FX.parameters, true);
      const at = params.at;
      resource.data.fill(0, at, at + params.bytes);
      let vector = 0;
      for (const [slot, [hash, type]] of LAYOUT.entries()) {
        const entryAt = at + slot * 16;
        if (type === 0) {
          view.setUint8(entryAt, 0);
          view.setBigUint64(entryAt + 8, pointers.get(hash) || 0n, true);
          continue;
        }
        const dataOffset = LAYOUT.length * 16 + vector * 16;
        view.setUint8(entryAt, 1);
        view.setBigUint64(entryAt + 8, base + BigInt(dataOffset), true);
        (values.get(hash) || DEFAULTS.get(hash)).forEach((number, component) =>
          view.setFloat32(at + dataOffset + component * 4, number, true),
        );
        vector += 1;
      }
      LAYOUT.forEach(([hash], slot) => view.setUint32(at + size + slot * 4, hash, true));
      view.setUint32(shaderAt + FX.name, joaat(PED_ALPHA), true);
      view.setUint32(shaderAt + FX.file, joaat(`${PED_ALPHA}.sps`), true);
      view.setUint8(shaderAt + FX.count, LAYOUT.length);
      view.setUint8(shaderAt + FX.bucket, ALPHA_BUCKET);
      view.setUint32(shaderAt + FX.bucketMask, bucketMaskOf(ALPHA_BUCKET), true);
      view.setUint16(shaderAt + FX.flags, 0x8000, true);
      view.setUint16(shaderAt + FX.parameterSize, size, true);
      view.setUint16(shaderAt + FX.parameterDataSize, dataSize, true);
      view.setUint8(shaderAt + FX.textureCount, LAYOUT.filter(([, type]) => type === 0).length);
      changed.push({ shader: name, texture });
      switched += 1;
    }
    /* Корзина прозрачных — в маски уровней этой модели. */
    if (switched)
      for (const offset of LOD_FLAGS) {
        const flags = view.getUint32(drawableAt + offset, true);
        if (flags) view.setUint32(drawableAt + offset, flags | (1 << ALPHA_BUCKET), true);
      }
  }
  return { changed, skipped };
}
