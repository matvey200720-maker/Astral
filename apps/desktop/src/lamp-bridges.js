/*
 * Лампы под мостами и в тоннелях: свет и сами трубки — в цвет работы.
 *
 * Лампы эстакад, мостов и дорожных тоннелей — часть моделей дорог
 * (`@modovik/street-light-contract/lamps`, `bridges.js`), поэтому правка
 * идёт не по пропам фонарей, а по самим моделям и словарям района, на месте:
 *
 *   свет   — цвет каждой записи LightAttributes модели (и цвет объёма, если
 *            лампа его рисует) — те же байты, что правит редактор у пропов;
 *            сигнальные огоньки остаются своего цвета;
 *   трубки — лист светящейся полосы эстакад центра: рисунок яркости
 *            остаётся, цвет — света (`tintGlass`), все уровни пересчитаны;
 *            у дальних моделей — их уменьшенная копия листа, чтобы издалека
 *            эстакада светилась тем же цветом.
 *
 * Файлы — копии из игры игрока; уезжают тем же пакетом, что и фонари, в
 * `x64/astral/astral_lights.rpf`. Модели, которой нет у игрока, установщик
 * пропускает и называет в сводке.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import {
  BRIDGE_DICTIONARIES,
  BRIDGE_MODELS,
  BRIDGE_STRIP_TEXTURE,
  hexToRgb,
  isIndicatorLight,
  tintGlass,
} from "@modovik/street-light-contract/lamps";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const inflateRaw = inflateResource;

/* Раскладка записи LightAttributes (CodeWalker Drawable.cs): 168 байт. */
const LIGHT_STRIDE = 168;
const LIGHT_LIST = 0xb0;
const COLOUR = 0x18;
const INTENSITY = 0x1c;
const FLAGS = 0x20;
const FALLOFF = 0x2c;
const VOLUME_OUTER_COLOUR = 0x54;
/* Флаг «у объёма свой внешний цвет» — как у редактора фонарей. */
const VOLUME_OUTER_FLAG = 0x80000;
const MAX_LIGHTS = 4096;

/**
 * Цвет ламп модели в распакованных данных ресурса: `data` — байты
 * системной части, `listAt` — где список ламп, `count` — сколько их.
 * Сигнальные огоньки (`isIndicatorLight`: красная точка аварийки, зелёный
 * «выход») остаются своего цвета. Правит массив на месте и возвращает число
 * перекрашенных ламп.
 */
export function paintLightRecords(data, listAt, count, { r, g, b }) {
  if (listAt < 0 || count < 0 || count > MAX_LIGHTS || listAt + count * LIGHT_STRIDE > data.length)
    throw new Error("Список ламп модели выходит за её данные.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let painted = 0;
  for (let index = 0; index < count; index += 1) {
    const at = listAt + index * LIGHT_STRIDE;
    const indicator = isIndicatorLight({
      colour: { r: data[at + COLOUR], g: data[at + COLOUR + 1], b: data[at + COLOUR + 2] },
      intensity: view.getFloat32(at + INTENSITY, true),
      falloff: view.getFloat32(at + FALLOFF, true),
    });
    if (indicator) continue;
    painted += 1;
    data[at + COLOUR] = r;
    data[at + COLOUR + 1] = g;
    data[at + COLOUR + 2] = b;
    if (view.getUint32(at + FLAGS, true) & VOLUME_OUTER_FLAG) {
      data[at + VOLUME_OUTER_COLOUR] = r;
      data[at + VOLUME_OUTER_COLOUR + 1] = g;
      data[at + VOLUME_OUTER_COLOUR + 2] = b;
    }
  }
  return painted;
}

function repack(raw, resource) {
  const level = resource.data.length > 8 * 1024 * 1024 ? 6 : zlib.constants.Z_BEST_COMPRESSION;
  const compressed = deflateRaw(resource.data, { level });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  compressed.copy(out, RSC7_HEADER_BYTES);
  return out;
}

/**
 * Модель (`.ydr`) с лампами цвета `hex`: `{ bytes, lights }`. Модель без
 * ламп — отказ: значит, у игрока другой файл, и красить в нём нечего.
 */
export function paintDrawableLights(bytes, hex) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const view = resource.view;
  const pointer = view.getBigUint64(LIGHT_LIST, true);
  const count = view.getUint16(LIGHT_LIST + 8, true);
  if (!pointer || !count) throw new Error("В модели нет ламп.");
  const lights = paintLightRecords(resource.data, resource.at(pointer), count, hexToRgb(hex));
  return { bytes: repack(raw, resource), lights };
}

/* Лист трубки в цвет света: яркость рисунка та же, цвет — света. */
function tintedStrip(ref, hex) {
  const level = decodeTextureRef(ref, { level: 0 });
  return tintGlass(level.rgba, hex);
}

/**
 * Текстуры `names` в ресурсе (словарь или модель со своими текстурами) —
 * в цвет света. Имени нет — отказ (у игрока другой файл).
 */
export function tintStripTextures(bytes, fileName, names, hex) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const refs = fileName.toLowerCase().endsWith(".ytd")
    ? readTextureDictionary(resource)
    : readDrawable(resource, { inflateRaw }).drawables.flatMap((drawable) => drawable.embeddedTextures || []);
  const replacements = {};
  for (const name of names) {
    const ref = refs.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!ref) throw new Error(`${fileName}: нет листа ${name}.`);
    replacements[ref.name] = texturePayload(
      { name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes },
      tintedStrip(ref, hex),
    );
  }
  return patchResourceTextures(raw, fileName, replacements).bytes;
}

/**
 * Файлы фонарей под мостами цвета `hex` из игры игрока: `reader` —
 * чтение архивов (`createGameReader`), `out` — папка. Возвращает
 * `{ files: [{ name, source }], lights, strips, missing }`.
 */
export async function buildBridgeFiles({ reader, hex, out }) {
  await fs.mkdir(out, { recursive: true });
  const files = [];
  const missing = [];
  let lights = 0;
  let strips = 0;
  for (const model of BRIDGE_MODELS) {
    const original = await reader.read(`${model.archive}:${model.entry}`);
    /* У игрока другой файл или его нет — остальные лампы не ждут. */
    if (!original) {
      missing.push(model.file);
      continue;
    }
    let { bytes, lights: count } = paintDrawableLights(original, hex);
    if (!count && !model.strip) continue;
    if (model.strip) {
      bytes = tintStripTextures(bytes, model.file, [BRIDGE_STRIP_TEXTURE], hex);
      strips += 1;
    }
    lights += count;
    const source = path.join(out, model.file);
    await fs.writeFile(source, bytes);
    files.push({ name: model.file, source });
  }
  for (const dictionary of BRIDGE_DICTIONARIES) {
    const original = await reader.read(`${dictionary.archive}:${dictionary.entry}`);
    if (!original) {
      missing.push(dictionary.file);
      continue;
    }
    const bytes = tintStripTextures(original, dictionary.file, dictionary.textures, hex);
    strips += dictionary.textures.length;
    const source = path.join(out, dictionary.file);
    await fs.writeFile(source, bytes);
    files.push({ name: dictionary.file, source });
  }
  return { files, lights, strips, missing };
}
