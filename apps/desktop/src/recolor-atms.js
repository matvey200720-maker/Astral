/*
 * «Банкоматы» в файлах (задача 4 ТЗ 17.10.2026).
 *
 * Основа — штатные банкоматы игры игрока (опись `atms`): у каждой модели
 * сама модель (`prop_atm_01.yft`, `prop_atm_02/03.ydr`, `prop_fleeca_atm.ydr`
 * — листы и палитры зашиты в неё) и словарь высокой чёткости (`+hifr.ytd` /
 * `+hidr.ytd`) — те же листы крупнее, для взгляда вблизи. Оба едут с одной
 * и той же правкой: на любой дистанции банкомат один.
 *
 *   • корпус и рамка — столбцы палитры тинта (`<модель>_pal`, у второго
 *     уровня детализации — `_l1_pal`): металл `prop_chrome_dirty_02`
 *     умножается в игре на цвет столбца, и правка цвета — это правка
 *     столбцов (`atmPaletteChanges`), лист металла остаётся как был. У
 *     тумбы палитры нет — её корпус красится тоном листа-атласа;
 *   • панель, клавиатура тумбы, экран, вывеска, полоса логотипов, лампа,
 *     металл Fleeca и стекло тумбы — места листов (`areas` описи): правка
 *     ложится только в своё место, соседние места листа остаются байт в байт —
 *     блоки DXT без тронутых текселей едут прежними (`texturePayload` с
 *     оригиналом); своя картинка и свой текст (та же картинка, её рисует окно)
 *     встают в острова места (`placeImageInIslands` — та же функция, что у
 *     кадра окна); у стекла «прозрачность» — сила оттенка (шейдер непрозрачный);
 *   • листы с картинкой или текстом поднимаются до ≥1024 по большой стороне
 *     (задача 5.2 ТЗ 18.10.2026): у моделей `.ydr` лист — свой, увеличенный
 *     (`split-sheet-surfaces` нативного хоста: геометрия берёт новый лист,
 *     прежний остаётся дальней детализации); у фрагмента тумбы (`.yft`) хост
 *     листов не добавляет — её листы остаются штатного размера;
 *   • свечение — множитель `emissiveMultiplier` светящихся шейдеров модели
 *     (`model-shader-vectors.js`: у фрагмента тумбы — его модель).
 *
 * Файлы банкоматов берут только банкоматы (опись мира: других вещей у этих
 * моделей и словарей нет), поэтому правка не расползается на другие объекты.
 */

import sharp from "sharp";
import { decodeTextureRef } from "@modovik/rage-drawable";
import { writeDdsHeader } from "@modovik/dds";
import { placeImageInIslands } from "@modovik/climb-contract/recolor/arena-slots";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { normalizeFinishImage } from "@modovik/climb-contract/recolor/finish";
import {
  ATMS_INVENTORY,
  atmGlowMultiplier,
  atmLookIsStock,
  atmLookOf,
  atmPaletteChanges,
  atmSurfaceHasPicture,
  atmSurfaceIsStock,
  atmSurfaceTransform,
  atmsProjectIsStock,
  findAtmPart,
  normalizeAtmsProject,
} from "@modovik/climb-contract/recolor/atms";
import { bakeSheetFinish, finishSource } from "./finish-bake.js";
import { patchModelVectors } from "./model-shader-vectors.js";
import { splitSheetSurfaces, surfaceSheetName } from "./recolor-sheet-split.js";
import { resourceRefs, stripPixels, tintPixels } from "./recolor-sheets.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";

/* Подъём тёмного у тона: как у зданий и остановок, чёрные швы листа не остаются чёрными. */
const TINT_LIFT = 0.2;

/** Правка листа по облику части (цвет тоном, эффект, «Без текстуры», отделка) или `null`. */
export function atmSurfaceOp(partId, surface) {
  if (atmSurfaceIsStock(surface)) return null;
  const kind = findAtmPart(partId)?.kind;
  if (kind === "finish") {
    if (surface.mode === "colour") {
      const look = normalizeColourEffect(surface.look);
      return look.mode === "solid" ? { tint: look.colour, lift: TINT_LIFT } : { strip: look, lift: TINT_LIFT };
    }
    if (surface.mode === "flat") return { flat: hexBytes(normalizeColourEffect(surface.look).colour) };
    return { finish: surface };
  }
  /* Картинка, текст, цвет и ровный цвет остальных частей (клавиатура, экран, вывеска, лампа, металл, стекло). */
  if (surface.mode === "colour") return { tint: surface.colour, lift: TINT_LIFT };
  if (surface.mode === "flat") return { flat: hexBytes(surface.colour) };
  return null;
}

/* Пиксели уровня по операции: ровный цвет, тон, полоса эффекта, общая отделка. */
function opPixels(level, op, sources) {
  const { rgba, width, height } = level;
  if (op.flat) {
    const out = new Uint8ClampedArray(rgba);
    for (let at = 0; at < out.length; at += 4) {
      out[at] = op.flat[0];
      out[at + 1] = op.flat[1];
      out[at + 2] = op.flat[2];
    }
    return out;
  }
  if (op.tint) return tintPixels(rgba, op.tint, op.lift || 0);
  if (op.strip) return stripPixels(rgba, width, height, op.strip, op.lift || 0);
  if (op.finish) return bakeSheetFinish(rgba, width, height, op.finish, sources(op.finish));
  return null;
}

const inRect = (rect, u, v) => u >= rect[0] && u <= rect[2] && v >= rect[1] && v <= rect[3];

/** Место листа у каждого текселя: номер записи `areas` (первая подходящая; без прямоугольника — остальное). */
export function atmAreaMap(areas, width, height) {
  const map = new Uint8Array(width * height);
  const fallback = Math.max(0, areas.findIndex((area) => !area.rect));
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const found = areas.findIndex((area) => !area.rect || inRect(area.rect, u, v));
      map[y * width + x] = found < 0 ? fallback : found;
    }
  return map;
}

/**
 * Новые пиксели листа по облику на уровне `level` (`{ rgba, width, height }`)
 * или `null` — лист как в игре. `sheet` — запись описи (места листа),
 * `images` — свои картинки (`Map` ключ → `{ rgba, width, height }`), `sources` —
 * источник отделки. Размер уровня любой: у увеличенного листа те же места
 * (`areas` — доли листа) и те же острова.
 */
export function atmSheetFromLevel(level, sheet, look, { images = new Map(), sources = null } = {}) {
  const original = new Uint8ClampedArray(level.rgba);
  const out = new Uint8ClampedArray(original);
  const base = { rgba: original, width: level.width, height: level.height };
  let map = null;
  let changed = false;
  sheet.areas.forEach((area, index) => {
    if (!area.part) return;
    const surface = look.parts[area.part];
    if (atmSurfaceIsStock(surface)) return;
    let pixels = null;
    if (atmSurfaceHasPicture(surface)) {
      const image = images.get(normalizeFinishImage(surface.image).asset);
      if (!image)
        throw new Error(surface.mode === "text" ? "Картинка текста банкомата не пришла — нажмите «Применить» ещё раз." : "Своя картинка банкомата не пришла — выберите её ещё раз.");
      pixels = new Uint8ClampedArray(original);
      placeImageInIslands(pixels, level.width, level.height, area.islands || [], image, atmSurfaceTransform(surface));
    } else {
      const op = atmSurfaceOp(area.part, surface);
      if (!op) return;
      pixels = opPixels(base, op, sources);
      /* Стекло: сила оттенка — доля оттенка поверх листа (0 % — стекло как есть). */
      if (pixels && area.part === "glass" && surface.strength < 100) {
        const keep = 1 - surface.strength / 100;
        for (let at = 0; at < pixels.length; at += 4)
          for (let channel = 0; channel < 3; channel += 1) pixels[at + channel] = Math.round(original[at + channel] * keep + pixels[at + channel] * (1 - keep));
      }
    }
    if (!pixels) return;
    map ||= atmAreaMap(sheet.areas, level.width, level.height);
    for (let texel = 0; texel < map.length; texel += 1) {
      if (map[texel] !== index) continue;
      const at = texel * 4;
      out[at] = pixels[at];
      out[at + 1] = pixels[at + 1];
      out[at + 2] = pixels[at + 2];
      out[at + 3] = pixels[at + 3];
    }
    changed = true;
  });
  return changed ? { rgba: out, original } : null;
}

/** Новые пиксели листа модели (лист игры `ref`) по облику или `null` — лист как в игре. */
export function atmSheetPixels(ref, sheet, look, options = {}) {
  return atmSheetFromLevel(decodeTextureRef(ref, { level: 0 }), sheet, look, options);
}

/** Новые пиксели палитры тинта: столбцы `columns` (`Map` столбец → `#hex`) во всех строках. */
export function atmPalettePixels(ref, columns) {
  const level = decodeTextureRef(ref, { level: 0 });
  const original = new Uint8ClampedArray(level.rgba);
  const out = new Uint8ClampedArray(original);
  for (const [column, colour] of columns) {
    if (column < 0 || column >= level.width) continue;
    const [r, g, b] = hexBytes(colour);
    for (let row = 0; row < level.height; row += 1) {
      const at = (row * level.width + column) * 4;
      out[at] = r;
      out[at + 1] = g;
      out[at + 2] = b;
    }
  }
  return { rgba: out, original };
}

/* Байты листа ресурса: для `texturePayload` с оригиналом — пережимаются только тронутые блоки. */
const payloadOf = (ref, { rgba, original }) =>
  texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba, {
    original,
    originalData: ref.resource?.data && ref.dataAt >= 0 ? ref.resource.data.subarray(ref.dataAt, ref.dataAt + ref.bytes) : null,
  });

/* ------------------------------------------------------------------ *
 * Увеличенные листы (задача 5.2): картинка и текст не должны быть мыльными
 * ------------------------------------------------------------------ */

/** Большая сторона увеличенного листа: от неё игра показывает экран вблизи чётко. */
export const ATM_BIG_SIDE = 1024;

/** Во сколько раз поднять лист `width × height`, чтобы большая сторона дошла до `ATM_BIG_SIDE` (степень двойки). */
export function atmSheetScale(width, height) {
  let scale = 1;
  while (Math.max(width, height) * scale < ATM_BIG_SIDE && scale < 16) scale *= 2;
  return scale;
}

const BLOCK_BYTES = Object.freeze({ DXT1: 8, DXT3: 16, DXT5: 16 });
const mipCount = (width, height) => Math.floor(Math.log2(Math.max(width, height))) + 1;
function chainBytes(format, width, height) {
  let total = 0;
  for (let level = 0, w = width, h = height; level < mipCount(width, height); level += 1, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1))
    total += Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * BLOCK_BYTES[format];
  return total;
}

/** Имя увеличенной копии листа в модели. */
export const atmBigSheetName = (sheet) => surfaceSheetName(sheet, "atm");

/**
 * Увеличенный лист с правкой частей: исходный лист (чёткий словарь, если он есть)
 * поднимается ланцошем, правка ложится на уровень нового размера — картинка и
 * текст рисуются сразу в нём. Ответ — `{ name, dds, width, height, from }` или `null`
 * (формат листа сжатыми блоками не пишется, правки на листе нет).
 */
export async function bigAtmSheet(ref, sheet, look, { images, sources }) {
  if (!BLOCK_BYTES[ref.format]) return null;
  const small = decodeTextureRef(ref, { level: 0 });
  const scale = atmSheetScale(small.width, small.height);
  const width = small.width * scale;
  const height = small.height * scale;
  const enlarged =
    scale === 1
      ? small
      : await sharp(Buffer.from(small.rgba.buffer, small.rgba.byteOffset, small.rgba.length), { raw: { width: small.width, height: small.height, channels: 4 } })
          .resize(width, height, { kernel: "lanczos3" })
          .raw()
          .toBuffer()
          .then((raw) => ({ rgba: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length), width, height }));
  const pixels = atmSheetFromLevel(enlarged, sheet, look, { images, sources });
  if (!pixels) return null;
  const levels = mipCount(width, height);
  const payload = texturePayload({ name: sheet.name, format: ref.format, width, height, levels, bytes: chainBytes(ref.format, width, height) }, pixels.rgba);
  const header = Buffer.from(writeDdsHeader({ width, height, mipLevels: levels, format: ref.format }));
  return { name: atmBigSheetName(sheet.name), dds: Buffer.concat([header, payload]), width, height, from: `${small.width}x${small.height}` };
}

/*
 * Модель (.ydr) с увеличенными листами картинок и текста: каждая геометрия,
 * что берёт такой лист, получает его увеличенную копию под своим именем
 * (`split-sheet-surfaces`, `recolor-sheet-split.js`); прежний лист остаётся
 * дальней детализации. Ответ — `{ bytes, sheets }` или `null`.
 */
async function enlargeAtmSheets(bytes, type, look, { hdBytes, images, sources, compile, stateDir }) {
  if (typeof compile !== "function" || type.kind !== "ydr") return null;
  const wanted = type.sheets.filter((sheet) => sheet.areas.some((area) => area.part && atmSurfaceHasPicture(look.parts[area.part])));
  if (!wanted.length) return null;
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const own = resourceRefs(raw, type.file);
  const hd = hdBytes && type.hd ? resourceRefs(new Uint8Array(hdBytes), type.hd.file).refs : [];
  const high = own.drawables?.find((drawable) => drawable.lod === "high");
  const splits = [];
  const sheets = [];
  for (const sheet of wanted) {
    const ref = hd.find((item) => item.name.toLowerCase() === sheet.name && item.complete) || own.refs.find((item) => item.name.toLowerCase() === sheet.name && item.complete);
    if (!ref) continue;
    const big = await bigAtmSheet(ref, sheet, look, { images, sources });
    if (!big) continue;
    for (const mesh of high?.meshes || []) {
      if (String(mesh.material?.textures?.diffuse || "").toLowerCase() !== sheet.name) continue;
      if (!Number.isInteger(mesh.model) || !Number.isInteger(mesh.slot)) continue;
      splits.push({ model: mesh.model, slot: mesh.slot, triangles: null, from: sheet.name, to: big.name, dds: big.dds });
    }
    sheets.push({ sheet: sheet.name, to: big.name, from: big.from, size: `${big.width}x${big.height}` });
  }
  if (!splits.length) return null;
  const separated = await splitSheetSurfaces({ base: raw, fileName: type.file, splits, sheetOf: () => null, compile, stateDir, set: "atms" });
  return { bytes: separated, sheets };
}

/*
 * Один файл модели или словаря: листы с правкой (места частей) и палитры.
 * Ответ — `{ bytes, textures }` или `null`, если в файле нечего менять.
 */
function bakeAtmFile(base, file, { type, look, palettes, images, sources }) {
  const raw = base instanceof Uint8Array ? base : new Uint8Array(base);
  const { refs } = resourceRefs(raw, file);
  const replacements = {};
  for (const ref of refs) {
    if (!ref.complete) continue;
    const name = ref.name.toLowerCase();
    const sheet = type.sheets.find((item) => item.name === name);
    const columns = palettes.get(name);
    const pixels = sheet ? atmSheetPixels(ref, sheet, look, { images, sources }) : columns ? atmPalettePixels(ref, columns) : null;
    if (pixels) replacements[ref.name] = payloadOf(ref, pixels);
  }
  if (!Object.keys(replacements).length) return null;
  const patched = patchResourceTextures(raw, file, replacements);
  return { bytes: patched.bytes, textures: patched.patched };
}

/**
 * Файлы банкоматов под работу: `{ files: [{ name, bytes }], patches, report }`.
 * `game` — читатель игры игрока, `images` — свои картинки (`Map` ключ →
 * `{ rgba, width, height }`), `compile` и `stateDir` — сборщик моделей хоста
 * (увеличенные листы; без него листы остаются штатного размера).
 */
export async function buildAtmFiles(input, { game = null, images = new Map(), compile = null, stateDir = "" } = {}) {
  const project = normalizeAtmsProject(input);
  if (atmsProjectIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  if (!game) throw new Error("Банкоматы собираются из файлов вашей игры — подключите GTA V.");
  const sources = new Map();
  const sourceOf = (item) => {
    const key = JSON.stringify([item.mode, item.pattern, item.image, item.gradient]);
    if (!sources.has(key)) sources.set(key, finishSource(item, images));
    return sources.get(key);
  };
  const files = [];
  const patches = [];
  const report = { types: [], placements: 0, glow: 0, missing: [], enlarged: [] };
  for (const type of ATMS_INVENTORY.types) {
    const look = atmLookOf(project, type.id);
    if (atmLookIsStock(look, type.id)) continue;
    const palettes = atmPaletteChanges(type.id, look);
    const context = { type, look, palettes, images, sources: sourceOf };
    let touched = false;

    /* Модель: листы, палитры и свечение. */
    const base = await game.read(type.at).catch(() => null);
    const hdBase = type.hd ? await game.read(type.hd.at).catch(() => null) : null;
    if (!base) report.missing.push(type.file);
    else {
      const baked = bakeAtmFile(base, type.file, context);
      let bytes = baked?.bytes || null;
      const glow = (type.glow || []).filter(() => look.glow !== 100);
      if (glow.length) {
        bytes = patchModelVectors(bytes || base, type.kind, glow.map((item) => ({ shader: item.shader, name: "emissiveMultiplier", values: [atmGlowMultiplier(item.multiplier, look.glow)] }))).bytes;
        report.glow += glow.length;
      }
      /* Увеличенные листы — после свечения: копия шейдера берёт его уже с новым множителем. */
      const big = await enlargeAtmSheets(bytes || base, type, look, { hdBytes: hdBase, images, sources: sourceOf, compile, stateDir });
      if (big) {
        bytes = big.bytes;
        report.enlarged.push(...big.sheets.map((item) => ({ type: type.id, ...item })));
      }
      if (bytes) {
        files.push({ name: type.file, bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
        patches.push({ file: type.file, type: type.id, textures: baked?.textures || [], ...(glow.length ? { glow: look.glow } : {}), ...(big ? { enlarged: big.sheets.map((item) => `${item.sheet} ${item.from} → ${item.size}`) } : {}) });
        touched = true;
      }
    }

    /* Словарь высокой чёткости — те же листы крупнее (палитр и свечения в нём нет). */
    const hdSheets = type.sheets.filter((sheet) => sheet.hd && sheet.areas.some((area) => area.part && !atmSurfaceIsStock(look.parts[area.part])));
    if (type.hd && hdSheets.length) {
      const hd = hdBase;
      if (!hd) report.missing.push(type.hd.file);
      else {
        const baked = bakeAtmFile(hd, type.hd.file, { ...context, type: { ...type, sheets: hdSheets }, palettes: new Map() });
        if (baked) {
          files.push({ name: type.hd.file, bytes: Buffer.from(baked.bytes.buffer, baked.bytes.byteOffset, baked.bytes.byteLength) });
          patches.push({ file: type.hd.file, type: type.id, textures: baked.textures });
          touched = true;
        }
      }
    }
    if (touched) {
      report.types.push(type.id);
      report.placements += type.placements || 0;
    }
  }
  return { files, patches, report };
}
