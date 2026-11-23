import * as nodeUtil from "node:util";
import * as zlib from "node:zlib";
import * as nodePath from "node:path";
import * as fsp from "node:fs/promises";
import * as nodeCrypto from "node:crypto";
import * as engine from "@modovik/install-engine";
import * as drawable from "@modovik/rage-drawable";
import * as resourceCore from "@modovik/ypt/resource-core";
import { encodeDds } from "@modovik/vector-map";
import { OWN_WORLD_MAP_PACKAGE, entryOwner } from "./pause-menu-blur.js";

const inflateRawAsync = nodeUtil.promisify(zlib.inflateRaw);
const deflateRawAsync = nodeUtil.promisify(zlib.deflateRaw);

// Веса R, G, B в светлоте точки.
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722];
// После DXT1 ровно 255 не получается, поэтому «плотная» — от 254.
const DENSE_BODY = 254;
const DDS_HEADER_BYTES = 128;
const GAME_ARCHIVE = "update/update.rpf";
const LIVE_COPY = "graphics-live.ytd";
const DETAIL_LIMIT = 300;

export const RADAR_MASKS = Object.freeze(["radarmasksm", "radarmasklg"]);

const toByte = (value) => Math.min(255, Math.round(value));

// Светлота точки, начинающейся с позиции `at`: веса складываются по порядку каналов.
function lightAt(rgba, at) {
  let light = 0;
  for (let channel = 0; channel < LUMA_WEIGHTS.length; channel += 1) {
    light += LUMA_WEIGHTS[channel] * rgba[at + channel];
  }
  return light;
}

// Обход точек по порядку: visit получает светлоту каждой.
function eachLight(rgba, visit) {
  for (let at = 0; at < rgba.length; at += 4) visit(lightAt(rgba, at));
}

export function radarMaskBody(rgba) {
  let peak = 0;
  eachLight(rgba, (light) => {
    peak = Math.max(peak, light);
  });
  if (!peak) return 0;

  const floor = peak / 2;
  const histogram = new Map();
  let counted = 0;
  eachLight(rgba, (light) => {
    if (!(light >= floor)) return;
    const bin = toByte(light);
    histogram.set(bin, (histogram.get(bin) ?? 0) + 1);
    counted += 1;
  });
  // Нижняя медиана: первая по возрастанию светлота, где накоплена половина учтённых точек.
  const bins = [...histogram.keys()].sort((a, b) => a - b);
  let seen = 0;
  const median = bins.find((bin) => {
    seen += histogram.get(bin);
    return seen * 2 >= counted;
  });
  return median === undefined ? Math.round(peak) : median;
}

export function opaqueMaskPixels(rgba, body) {
  const gain = 255 / body;
  const size = rgba.length;
  const result = new Uint8Array(size);
  for (let origin = 0; origin < size; origin += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      result[origin + channel] = toByte(rgba[origin + channel] * gain);
    }
    result[origin + 3] = 255;
  }
  return result;
}

function findMask(textures, name) {
  const found = textures.find((item) => name === item.name.toLowerCase());
  if (!found) throw new Error(`В graphics.ytd нет маски ${name}.`);
  if (found.format !== "DXT1" || !found.complete) {
    const shown = found.format || "неизвестный формат";
    throw new Error(`Маска ${name} — ${shown}: Astral правит только целую маску DXT1.`);
  }
  return found;
}

// Уровни DDS идут подряд после заголовка; каждому достаётся столько байт, сколько он занимает в текстуре.
function writeLevels(data, ref, dds, name) {
  let cursor = DDS_HEADER_BYTES;
  let level = 0;
  while (level < ref.levels) {
    const span = ref.spans[level];
    const end = cursor + span.bytes;
    const chunk = dds.subarray(cursor, end);
    if (chunk.length !== span.bytes) {
      throw new Error(`Маска ${name}: уровень ${level} сжался не в тот размер.`);
    }
    data.set(chunk, ref.dataAt + span.offset);
    cursor = end;
    level += 1;
  }
}

function densifyMask(data, textures, name) {
  const ref = findMask(textures, name);
  const { width, height, levels } = ref;
  const top = drawable.decodeTextureRef(ref, { level: 0 }).rgba;
  const body = radarMaskBody(top);
  if (!(body > 0)) throw new Error(`Маска ${name} чёрная: мини-карты под ней нет.`);

  const already = body >= DENSE_BODY;
  if (body < DENSE_BODY) {
    const dds = encodeDds(opaqueMaskPixels(top, body), width, height, { format: "bc1", mipmaps: levels > 1 });
    writeLevels(data, ref, dds, name);
  }
  return { name, width, height, levels, body, already };
}

// Список текстур словаря: сам массив либо поле textures.
function texturesOf(dictionary) {
  if (Array.isArray(dictionary)) return dictionary;
  return dictionary?.textures || [];
}

export async function opaqueRadarMasks(input) {
  const original = Buffer.from(input);
  const head = original.subarray(0, resourceCore.RSC7_HEADER_BYTES);
  const header = resourceCore.readResourceHeader(original);
  const data = await inflateRawAsync(original.subarray(resourceCore.RSC7_HEADER_BYTES));
  if (data.length < header.systemSize + header.graphicsSize) {
    throw new Error("graphics.ytd обрезан: распакованных байт меньше, чем заявляет заголовок.");
  }

  const dictionary = drawable.readTextureDictionary(resourceCore.resourceFromData(data, header));
  const textures = texturesOf(dictionary);
  const masks = [];
  for (const name of RADAR_MASKS) masks.push(densifyMask(data, textures, name));
  const tail = await deflateRawAsync(data);
  return { bytes: Buffer.concat([head, tail]), masks };
}

function refusal(reason, extra) {
  return { file: null, summary: { opaque: false, reason, ...extra } };
}

// В итог идут только имя, тело и признак «уже плотная», в этом порядке.
function maskReport(masks) {
  return masks.map((mask) => ({ name: mask.name, body: mask.body, already: mask.already }));
}

function explain(error) {
  return String(error?.message || error).slice(0, DETAIL_LIMIT);
}

// Один заход сборки файла масок: владелец записи → чтение и правка живого файла → запись в пакет.
export async function buildRadarMaskFile(paths, tools) {
  const { gameRoot, packageRoot, stateDir } = paths;

  // Чужой владелец записи или null.
  async function owned() {
    const owner = await entryOwner(gameRoot, stateDir, tools, engine.WORLD_MAP_RADAR_MASK_ENTRY);
    return owner && !OWN_WORLD_MAP_PACKAGE.test(owner) ? owner : null;
  }

  async function patched() {
    const liveCopy = nodePath.join(packageRoot, LIVE_COPY);
    const request = {
      gameRoot,
      archive: GAME_ARCHIVE,
      entry: engine.WORLD_MAP_RADAR_MASK_ENTRY,
      output: liveCopy,
    };
    let outcome;
    try {
      outcome = { failed: false, result: await opaqueRadarMasks(await tools.readGameBytes(request)) };
    } catch (error) {
      outcome = { failed: true, error };
    } finally {
      await fsp.rm(liveCopy, { force: true }).catch(() => {});
    }
    return outcome;
  }

  async function place(built) {
    const { bytes, masks } = built;
    const target = nodePath.join(packageRoot, engine.WORLD_MAP_RADAR_MASK_SOURCE);
    await fsp.mkdir(nodePath.dirname(target), { recursive: true });
    await fsp.writeFile(target, bytes);
    const file = Object.fromEntries([
      ["source", engine.WORLD_MAP_RADAR_MASK_SOURCE],
      ["target", GAME_ARCHIVE],
      ["action", "replace"],
      ["entry", engine.WORLD_MAP_RADAR_MASK_ENTRY],
      ["size", bytes.length],
      ["sha256", nodeCrypto.createHash("sha256").update(bytes).digest("hex")],
    ]);
    return { file, summary: { opaque: true, reason: "", masks: maskReport(masks) } };
  }

  const owner = await owned();
  if (owner) return refusal("owned", { owner });

  const outcome = await patched();
  if (outcome.failed) return refusal("unreadable", { detail: explain(outcome.error) });
  return place(outcome.result);
}
