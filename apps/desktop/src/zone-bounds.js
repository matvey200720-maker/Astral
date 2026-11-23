/*
 * Рамки архетипов в типах (`.ytyp`) — расширить, когда модель выросла (задача 23 ТЗ 18.10.2026: у зон со стенкой или
 * шире мода сетка выходит за рамку мода).
 *
 * Игра отсекает вещь по рамке её архетипа (`CBaseArchetypeDef`: `bbMin` +32, `bbMax` +48, `bsCentre` +64,
 * `bsRadius` +80, хеш имени +88), а не по сетке: стенка в тридцать метров над рамкой в десять не пропадёт, пока рамка
 * в кадре, но рамка вне кадра — и стенку не нарисуют. Здесь рамки архетипов называемых моделей только растут (до
 * объединения со старой), правка — на месте: длина файла та же, ресурс пережимается с прежним заголовком, как у
 * `place-isolation.js`. Карта (`.ymap`) не трогается: у зон дальность в километры, и запас карты больше любой стенки.
 */

import zlib from "node:zlib";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const ARCHETYPES = 24;
const BB_MIN = 32;
const BB_MAX = 48;
const BS_CENTRE = 64;
const BS_RADIUS = 80;
const NAME = 88;

function openTypes(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateResource);
  if (resource.version !== 2) throw new Error("Файл типов — не Meta-ресурс.");
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const blockCount = view.getInt16(rootAt + 0x4c, true);
  const rootBlock = view.getInt32(rootAt + 0x1c, true);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const at = blocksAt + index * 16;
    blocks.push({ dataAt: resource.at(view.getBigUint64(at + 8, true)) });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? block.dataAt + Number((pointer >> 12n) & 0xfffffn) : -1;
  };
  const rootData = blocks[rootBlock - 1]?.dataAt;
  if (rootData == null || rootData < 0) throw new Error("Корень типов не найден.");
  const listAt = resolve(view.getBigUint64(rootData + ARCHETYPES, true));
  const count = view.getUint16(rootData + ARCHETYPES + 8, true);
  const archetypes = [];
  for (let index = 0; index < count && listAt >= 0; index += 1) {
    const at = resolve(view.getBigUint64(listAt + index * 8, true));
    if (at >= 0) archetypes.push(at);
  }
  const save = () => {
    const compressed = deflateRaw(resource.data, { level: zlib.constants.Z_BEST_COMPRESSION });
    const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
    Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
    compressed.copy(out, RSC7_HEADER_BYTES);
    return out;
  };
  return { view, archetypes, save };
}

const vectorAt = (view, at) => [0, 4, 8].map((offset) => view.getFloat32(at + offset, true));

/** Рамки архетипов файла типов: `[{ hash, min, max }]` (для проверок и разбора). */
export function readArchetypeBounds(bytes) {
  const meta = openTypes(bytes);
  return meta.archetypes.map((at) => ({
    hash: meta.view.getUint32(at + NAME, true) >>> 0,
    min: vectorAt(meta.view, at + BB_MIN),
    max: vectorAt(meta.view, at + BB_MAX),
  }));
}

/**
 * Рамки архетипов вырастают до объединения со `wanted` (`Map(хеш имени → { min, max })`, метры модели). Ответ —
 * `{ bytes, grown }`: новый файл (или тот же, если рамки уже хватало) и сколько архетипов выросло. Шар (`bsCentre`,
 * `bsRadius`) пересчитывается по новой рамке.
 */
export function growArchetypeBounds(bytes, wanted) {
  const meta = openTypes(bytes);
  const { view } = meta;
  let grown = 0;
  for (const at of meta.archetypes) {
    const want = wanted.get(view.getUint32(at + NAME, true) >>> 0);
    if (!want) continue;
    const min = vectorAt(view, at + BB_MIN);
    const max = vectorAt(view, at + BB_MAX);
    /* Рамка хранится float32: сравнение — по тому же округлению, иначе вторая правка снова «растила» бы то же самое. */
    const nextMin = min.map((value, axis) => Math.fround(Math.min(value, want.min[axis])));
    const nextMax = max.map((value, axis) => Math.fround(Math.max(value, want.max[axis])));
    if (nextMin.every((value, axis) => value === min[axis]) && nextMax.every((value, axis) => value === max[axis])) continue;
    nextMin.forEach((value, axis) => view.setFloat32(at + BB_MIN + axis * 4, value, true));
    nextMax.forEach((value, axis) => view.setFloat32(at + BB_MAX + axis * 4, value, true));
    const centre = nextMin.map((value, axis) => (value + nextMax[axis]) / 2);
    centre.forEach((value, axis) => view.setFloat32(at + BS_CENTRE + axis * 4, value, true));
    view.setFloat32(at + BS_RADIUS, Math.hypot(...nextMax.map((value, axis) => value - centre[axis])), true);
    grown += 1;
  }
  return { bytes: grown ? meta.save() : bytes, grown };
}
