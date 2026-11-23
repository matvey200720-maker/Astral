/*
 * Листы на месте — общее у арены и зданий из игры (Мегамолл, Ашан / Икея).
 *
 * Файл игры (модель со встроенными листами или словарь) правится на месте:
 * каждый лист с правкой декодируется, получает новый облик и пишется в том
 * же формате и с той же цепочкой мипов (`texturePayload`), файл той же
 * раскладки (`patchResourceTextures`). Правка листа — операцией:
 *
 *   `{ flat: [r, g, b] }` — ровный цвет (плашка 4×4);
 *   `{ tint: "#hex" }` — тон по светотени листа;
 *   `{ strip: look }` — эффект цвета полосой вдоль развёртки;
 *   `{ finish: settings }` — общая отделка (узор, картинка, градиент);
 *   `{ recolour: "#hex" }` — зелёное листа в свой цвет (знаки выхода);
 *   `{ transparent: true }` — прозрачный лист;
 *   `{ image, islands, transform }` — своя картинка в острова развёртки;
 *   `{ layers: [{ islands, image?, transform, clear? }] }` — несколько
 *     картинок и заливок по своим островам одного листа (надпись и таблички
 *     атласа, места фасада арены); `clear` — сперва стереть остров куском
 *     того же листа (прежний логотип на панели);
 *   `exclude: [[u0, v0, u1, v1]]` у любой операции — эти области листа
 *     остаются как были (вывески в листе стены не перекрашиваются тоном).
 */

import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { writeDdsHeader } from "@modovik/dds";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { colourEffectAt } from "@modovik/climb-contract/recolor";
import { patchIslands, placeImageInIslands, recolourGreen } from "@modovik/climb-contract/recolor/arena-slots";
import { cleanSheetPixels } from "@modovik/climb-contract/recolor/shops-shine";
import { meanLuma } from "@modovik/climb-contract/recolor/colour";
import { bakeSheetFinish } from "./finish-bake.js";
import { tintTable } from "./recolor-pixels.js";
import { openResourceTextures, patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";
import { inflateResource } from "@modovik/native-rs";

export const inflateRaw = inflateResource;

const LUT_STEPS = 1024;

/*
 * Лист как DDS без пересжатия: заголовок и уровни листа игры байт в байт. Так едут листы, которые не перекрашиваются (нормали, блеск, общие `env_…` — часто ATI2/BC5, что
 * `encodeDds` не пишет), — копия получает их такими, какими их кладёт игра. Только блочные форматы со своим FourCC (DX10-заголовок BC7 здесь не пишется): `null` — иначе.
 */
export const RAW_DDS_FORMATS = Object.freeze(["DXT1", "DXT3", "DXT5", "ATI1", "ATI2"]);
export function rawDdsOf(ref) {
  if (!ref?.complete || !RAW_DDS_FORMATS.includes(ref.format)) return null;
  const header = writeDdsHeader({ width: ref.width, height: ref.height, mipLevels: ref.levels, format: ref.format });
  const levels = ref.spans.slice(0, ref.levels).map((span) => ref.resource.data.subarray(ref.dataAt + span.offset, ref.dataAt + span.offset + span.bytes));
  const out = new Uint8Array(header.length + levels.reduce((sum, level) => sum + level.length, 0));
  out.set(header, 0);
  let at = header.length;
  for (const level of levels) {
    out.set(level, at);
    at += level.length;
  }
  return out;
}

export const kindOf = (name) => String(name || "").toLowerCase().split(".").pop();

/* Листы ресурса (словарь или встроенные в модель). */
export function resourceRefs(bytes, fileName) {
  const resource = openResourceWith(bytes, inflateRaw);
  if (kindOf(fileName) === "ytd") return { resource, refs: readTextureDictionary(resource) };
  const seen = new Set();
  const read = readDrawable(resource, { inflateRaw, kind: kindOf(fileName) });
  return {
    resource,
    drawables: read.drawables,
    refs: read.drawables.flatMap((drawable) => drawable.embeddedTextures || []).filter((ref) => (seen.has(ref.dataAt) ? false : seen.add(ref.dataAt))),
  };
}

export const solid = (width, height, [r, g, b], alpha) => {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < out.length; at += 4) {
    out[at] = r;
    out[at + 1] = g;
    out[at + 2] = b;
    out[at + 3] = alpha;
  }
  return out;
};

/* Тон по светотени: таблица на цвет, подъём тёмного и опору — общая на файл. */
const tables = new Map();
function tableOf(colour, lift = 0, ref = 0.5) {
  const key = `${colour}|${lift}|${ref}`;
  if (!tables.has(key)) tables.set(key, tintTable({ colour, ref, brightness: 1, lift }));
  return tables.get(key);
}

/**
 * Тон по светотени: `ref` — яркость пикселя, что станет ровно цветом (0,5 — прежняя опора; `meanLuma(rgba)` — средний пиксель листа).
 * `cap` — потолок яркости пикселя листа до таблицы тона (1 — как было): белое светящееся окошко и люминесцентная панель листа остановки
 * на таблице уходили в светлую лаванду, а не в цвет работы (11.11.2026, снимок владельца: «фиолетовая остановка, окошко и панель на крыше белые»).
 */
export function tintPixels(rgba, colour, lift = 0, ref = 0.5, cap = 1) {
  const table = tableOf(colour, lift, Math.round(ref * 1000) / 1000);
  const out = new Uint8ClampedArray(rgba);
  for (let at = 0; at < rgba.length; at += 4) {
    const luma = Math.min(cap, (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255);
    const step = Math.min(LUT_STEPS - 1, Math.round(luma * (LUT_STEPS - 1))) * 3;
    out[at] = table[step];
    out[at + 1] = table[step + 1];
    out[at + 2] = table[step + 2];
  }
  return out;
}

/*
 * Эффект по листу: доля `t` — вдоль (u), поперёк (v) или снизу вверх
 * (1 − v); цвет полосы в доле — тоном по светотени текселя.
 */
export function stripPixels(rgba, width, height, look, lift = 0, cap = 1) {
  const steps = 64;
  const strip = Array.from({ length: steps }, (_, index) => {
    const [r, g, b] = colourEffectAt(look, index / (steps - 1));
    return tableOf(`#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`, lift);
  });
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const t = look.direction === "across" ? (y + 0.5) / height : look.direction === "height" ? 1 - (y + 0.5) / height : (x + 0.5) / width;
      const period = look.mode === "line" ? (t * 6) % 1 : t;
      const table = strip[Math.min(steps - 1, Math.round(period * (steps - 1)))];
      const luma = Math.min(cap, (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255);
      const step = Math.min(LUT_STEPS - 1, Math.round(luma * (LUT_STEPS - 1))) * 3;
      out[at] = table[step];
      out[at + 1] = table[step + 1];
      out[at + 2] = table[step + 2];
    }
  return out;
}

/**
 * Лист светящейся поверхности (`emissive.sps` с множителем `gain`): яркость пикселя до множителя не выше 1 / gain, цвет (отношение каналов) тот же. Игра умножает лист на
 * множитель свечения (светильник навеса ×9), и любой цвет с каналом выше ~11 % уходил в белое — кольцо на светильнике было белой панелью. Тёмные пиксели не трогаются.
 */
export function limitGain(rgba, gain) {
  for (let at = 0; at < rgba.length; at += 4) {
    const peak = (Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) / 255) * gain;
    if (peak <= 1) continue;
    rgba[at] = Math.round(rgba[at] / peak);
    rgba[at + 1] = Math.round(rgba[at + 1] / peak);
    rgba[at + 2] = Math.round(rgba[at + 2] / peak);
  }
  return rgba;
}

/* Области листа (доли развёртки), что остаются как были. */
function restoreRects(rgba, original, width, height, rects) {
  for (const rect of rects || []) {
    const x0 = Math.max(0, Math.floor(rect[0] * width));
    const y0 = Math.max(0, Math.floor(rect[1] * height));
    const x1 = Math.min(width, Math.ceil(rect[2] * width));
    const y1 = Math.min(height, Math.ceil(rect[3] * height));
    for (let y = y0; y < y1; y += 1) {
      const from = (y * width + x0) * 4;
      rgba.set(original.subarray(from, from + (x1 - x0) * 4), from);
    }
  }
  return rgba;
}

/*
 * Новые пиксели листа по операции (или `null` — лист как был). `images` —
 * свои картинки по ключу (`{ rgba, width, height }`), `sources(settings)` —
 * источник общей отделки.
 */
export function sheetPixels(ref, op, { images = {}, sources = null } = {}) {
  if (op.transparent) return solid(ref.width, ref.height, [0, 0, 0], 0);
  const level = decodeTextureRef(ref, { level: 0 });
  /* Чистый лист («Интерьеры», ТЗ 12.10.2026, задача 2): пятна и грязь
     сглажены до правки цвета — свой цвет ложится уже на чистый лист. */
  const pixels = op.clean ? cleanSheetPixels(level.rgba, ref.width, ref.height, op.clean.amount, op.clean.lift) : new Uint8ClampedArray(level.rgba);
  let rgba = op.clean ? pixels : null;
  if (op.flat) {
    rgba = new Uint8ClampedArray(pixels);
    for (let at = 0; at < rgba.length; at += 4) {
      rgba[at] = op.flat[0];
      rgba[at + 1] = op.flat[1];
      rgba[at + 2] = op.flat[2];
    }
    /* Проверочная метка носителя (arena11diag): к заливке — крупные диагональные полосы цвета `op.stripes` (период — треть длинной стороны листа, не меньше 8 пикселей). */
    if (op.stripes) {
      const period = Math.max(8, Math.round(Math.max(ref.width, ref.height) / 3));
      for (let y = 0; y < ref.height; y += 1)
        for (let x = 0; x < ref.width; x += 1) {
          if ((x + y) % period >= period / 2) continue;
          const at = (y * ref.width + x) * 4;
          rgba[at] = op.stripes[0];
          rgba[at + 1] = op.stripes[1];
          rgba[at + 2] = op.stripes[2];
        }
    }
  } else if (op.tint) rgba = tintPixels(pixels, op.tint, op.lift || 0, op.ref === "mean" ? meanLuma(pixels) : (op.ref ?? 0.5), op.cap ?? 1);
  else if (op.strip) rgba = stripPixels(pixels, ref.width, ref.height, op.strip, op.lift || 0, op.cap ?? 1);
  else if (op.finish) rgba = bakeSheetFinish(pixels, ref.width, ref.height, op.finish, sources(op.finish));
  else if (op.recolour) rgba = recolourGreen(pixels, op.recolour);
  else if (op.image) {
    const image = typeof op.image === "string" ? images?.[op.image] : op.image;
    if (!image) throw new Error("Своя картинка не пришла — выберите её ещё раз.");
    rgba = placeImageInIslands(new Uint8ClampedArray(pixels), ref.width, ref.height, op.islands, image, op.transform);
  } else if (op.base || op.layers) rgba = op.base ? sheetPixels(ref, op.base, { images, sources }) : new Uint8ClampedArray(pixels);
  if (rgba && op.exclude?.length) restoreRects(rgba, pixels, ref.width, ref.height, op.exclude);
  if (rgba && op.gain > 1) limitGain(rgba, op.gain);
  if (op.layers?.length) {
    rgba ||= new Uint8ClampedArray(pixels);
    for (const layer of op.layers) {
      const image = typeof layer.image === "string" ? images?.[layer.image] : layer.image || null;
      if (layer.image && !image) throw new Error("Картинка надписи не пришла — нажмите «Применить» ещё раз.");
      if (layer.clear) patchIslands(rgba, ref.width, ref.height, layer.islands, layer.clear);
      placeImageInIslands(rgba, ref.width, ref.height, layer.islands, image, layer.transform);
    }
  }
  return rgba;
}

/**
 * Файл с обликом по листам. `base` — байты основы, `opOf(name, ref)` — что
 * делать с листом. `{ bytes, textures, skipped }`.
 */
export async function bakeFile(base, fileName, opOf, { images, sources } = {}) {
  const raw = base instanceof Uint8Array ? base : new Uint8Array(base);
  const { refs } = resourceRefs(raw, fileName);
  const replacements = {};
  let skipped = 0;
  for (const ref of refs) {
    if (!ref.complete) continue;
    const op = opOf(ref.name.toLowerCase(), ref);
    if (!op) continue;
    try {
      const rgba = sheetPixels(ref, op, { images, sources });
      if (!rgba) continue;
      replacements[ref.name] = texturePayload(
        { name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes },
        rgba,
      );
    } catch (error) {
      /* Формат, которого правка не пишет, — лист остаётся как был. */
      if (/картинка/i.test(String(error?.message || ""))) throw error;
      skipped += 1;
    }
  }
  if (!Object.keys(replacements).length) return { bytes: Buffer.from(raw), textures: [], skipped };
  try {
    const patched = patchResourceTextures(raw, fileName, replacements);
    return { bytes: Buffer.from(patched.bytes), textures: patched.patched, skipped };
  } catch (error) {
    /* Лист, чьи байты делит соседний (мипы налегают), на месте не переписать: остальные листы файла всё равно ложатся, этот остаётся как был. */
    const editor = openResourceTextures(raw, fileName);
    const patched = [];
    for (const [name, payload] of Object.entries(replacements)) {
      try {
        patched.push(...editor.patch({ [name]: payload }));
      } catch {
        skipped += 1;
      }
    }
    if (!patched.length) {
      if (!skipped) throw error;
      return { bytes: Buffer.from(raw), textures: [], skipped };
    }
    return { bytes: Buffer.from(editor.finish()), textures: patched, skipped };
  }
}
