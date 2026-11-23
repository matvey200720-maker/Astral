/*
 * Накладки радара в minimap.gfx — спрайты `radar_overlay_*` (задача 21 ТЗ 18.10.2026, вечер).
 *
 * Три накладки лежат в `scaleform_minimap.rpf/minimap.gfx` у `update.rpf`: «$» (`ready_for_sell`), «⚠»
 * (`missing_supplies`) и «⚡» (`jammed`) — значки бизнесов Online поверх метки на мини-карте и карте паузы.
 * Спрайт — один кадр векторных фигур; многокадровый спрайт Scaleform крутится по кругу сам, поэтому здесь —
 * единственное место, где гифка в игре действительно играет (лист ytd статичен).
 *
 * Файл общий с редактором «Мини-карта», поэтому правится ровно то, что своё, поверх живого файла:
 *   — спрайт с номером накладки заменяется (номер, а с ним и экспорт, прежние — игра ищет по имени);
 *   — новые определения (растры кадров, фигуры, копия штатного спрайта) лежат в своём диапазоне номеров
 *     `OVERLAY_ID_BASE…+999`, куда мини-карта (она берёт номера сверху от 65000) не доходит; перед сборкой всё,
 *     что лежит в этом диапазоне, снимается — повторная сборка не копит мусор, а «Как в игре» не оставляет следов;
 *   — штатный вид накладки берётся из файла сборки до Astral (или Rockstar), а нет его — из самого файла, если
 *     накладка в нём ещё не правлена нами.
 *
 * Правка накладки:
 *   цвет   — копия штатного спрайта под своим номером и обёртка, что ставит её с умножением цвета (белое
 *            становится цветом, чёрная обводка остаётся);
 *   убрать — пустой спрайт;
 *   кадры  — растры кадров (`DefineBitsLossless2`) на фигурах размером с габарит штатной накладки, кадр спрайта —
 *            фигура кадра гифки; задержка гифки — повторы кадра по частоте фильма.
 */

import crypto from "node:crypto";
import sharp from "sharp";
import { createRenderer, readGfx, surfaceToRgba } from "@modovik/gfx";
import {
  SWF_TAG,
  TWIPS,
  characterBounds,
  defineBitmapRectShape,
  defineLosslessBitmap,
  defineSprite,
  defineSpriteFrames,
  indexSwf,
  multiplyColor,
  parseSwfTags,
  placeObject2,
  readPlacement,
  scaleformHeaderLength,
  swfTag,
  uncompressedScaleform,
} from "./scaleform-swf.js";

/* Номера символов, что отданы накладкам: по тысяче на всё, по триста на накладку. */
export const OVERLAY_ID_BASE = 59000;
export const OVERLAY_ID_LIMIT = OVERLAY_ID_BASE + 999;
const OVERLAY_ID_BLOCK = 300;
/* Кадров гифки на накладку и всего кадров спрайта — запас от раздутого файла. */
export const OVERLAY_MAX_GIF_FRAMES = 24;
const OVERLAY_MAX_SPRITE_FRAMES = 240;
/* Растр кадра: во сколько раз крупнее габарита накладки (сглаживание при масштабе радара) и потолок стороны. */
const BITMAP_SUPERSAMPLE = 4;
const BITMAP_MAX_SIDE = 128;
const BITMAP_MIN_SIDE = 16;

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const inOwnRange = (id) => id >= OVERLAY_ID_BASE && id <= OVERLAY_ID_LIMIT;

/** Частота фильма — кадров в секунду (заголовок SWF: после RECT, 8.8). */
export function frameRateOf(buffer) {
  const offset = scaleformHeaderLength(buffer) - 4;
  return buffer.readUInt16LE(offset) / 256 || 30;
}

/* Номера, на которые спрайт ссылается размещениями (во всех кадрах). */
function spriteDependencies(buffer, tag) {
  const ids = new Set();
  for (const inner of parseSwfTags(buffer, tag.payloadStart + 4, tag.end)) {
    if (inner.code !== SWF_TAG.PLACE_OBJECT2 && inner.code !== SWF_TAG.PLACE_OBJECT3) continue;
    const placement = readPlacement(buffer, inner);
    if (placement?.characterId !== undefined) ids.add(placement.characterId);
  }
  return ids;
}

/**
 * Где в файле накладки: `Map<имя экспорта, { id, tag, bounds }>`; `bounds` — габарит в твипах. Бросает с
 * объяснением, если файл устроен не как у игры.
 */
export function resolveOverlays(gfxBuffer, names) {
  const buffer = uncompressedScaleform(gfxBuffer);
  const index = indexSwf(buffer);
  const sprites = new Map();
  for (const name of names) {
    const id = index.exports.get(name);
    if (id === undefined) throw new Error(`В minimap.gfx нет символа ${name} — это не мини-карта игры.`);
    const tag = index.definitions.get(id);
    if (!tag || tag.code !== SWF_TAG.DEFINE_SPRITE) throw new Error(`В minimap.gfx ${name} — не клип.`);
    const bounds = characterBounds(index, id);
    sprites.set(name, { id, tag, bounds });
  }
  return { buffer, index, sprites };
}

/** Есть ли в файле что-то из нашего диапазона номеров — накладка уже правлена Astral. */
export const overlaysEdited = (gfxBuffer) => {
  const index = indexSwf(uncompressedScaleform(gfxBuffer));
  return [...index.usedIds].some(inOwnRange);
};

/**
 * Накладки из одного файла — в другой: «Мини-карта» собирается не всегда поверх живого minimap.gfx (базой бывает резервная
 * копия или память о файле до её прежней сборки), и накладки, что легли в игру позже, остались бы за бортом. Здесь всё
 * наше (определения из нашего диапазона номеров и три спрайта накладок под их прежними номерами) снимается с `to` и
 * ставится на место из `from`; остальное в `to` не меняется. `null` — переносить нечего или файлы устроены по-разному
 * (нет символа, номера не совпали, наших определений не по месту): вызывающий оставляет `to` как есть.
 */
export function carryOverlays(fromBuffer, toBuffer, names) {
  const from = uncompressedScaleform(fromBuffer);
  const to = uncompressedScaleform(toBuffer);
  const fromIndex = indexSwf(from);
  const toIndex = indexSwf(to);
  const definitionOf = (buffer, tag) => (DEFINITION_ID_TAGS.has(tag.code) && tag.length >= 2 ? buffer.readUInt16LE(tag.payloadStart) : null);
  const groups = new Map();
  let carried = 0;
  for (const name of names) {
    const id = fromIndex.exports.get(name);
    if (id === undefined || id !== toIndex.exports.get(name)) return null;
    const fromTag = fromIndex.definitions.get(id);
    const toTag = toIndex.definitions.get(id);
    if (!fromTag || !toTag || fromTag.code !== SWF_TAG.DEFINE_SPRITE || toTag.code !== SWF_TAG.DEFINE_SPRITE) return null;
    const tags = [from.subarray(fromTag.offset, fromTag.end)];
    for (let at = fromIndex.tags.indexOf(fromTag) - 1; at >= 0; at -= 1) {
      const tag = fromIndex.tags[at];
      const definition = definitionOf(from, tag);
      if (definition === null || !inOwnRange(definition)) break;
      tags.unshift(from.subarray(tag.offset, tag.end));
      carried += 1;
    }
    groups.set(toTag.offset, tags);
  }
  /* Наши определения, что не легли рядом со своей накладкой, переносить нельзя: ссылки в них пришлось бы угадывать. */
  const ownInFrom = fromIndex.tags.filter((tag) => {
    const definition = definitionOf(from, tag);
    return definition !== null && inOwnRange(definition);
  }).length;
  if (ownInFrom !== carried) return null;
  const output = [to.subarray(0, toIndex.headerLength)];
  for (const tag of toIndex.tags) {
    const definition = definitionOf(to, tag);
    if (definition !== null && inOwnRange(definition)) continue;
    const group = groups.get(tag.offset);
    if (group) output.push(...group);
    else output.push(to.subarray(tag.offset, tag.end));
  }
  const carriedBuffer = Buffer.concat(output);
  carriedBuffer.writeUInt32LE(carriedBuffer.length, 4);
  return carriedBuffer;
}

/*
 * Копия штатного спрайта под другим номером: заголовок тега тот же, первые два байта тела — номер.
 * Короткий тег (меньше 63 байт тела) остаётся коротким — длина записана в заголовке.
 */
function spriteCopy(buffer, tag, id) {
  const copy = Buffer.from(buffer.subarray(tag.offset, tag.end));
  copy.writeUInt16LE(id, tag.headerLength);
  return copy;
}

const removeObject = (depth) => {
  const body = Buffer.alloc(2);
  body.writeUInt16LE(depth);
  return swfTag(SWF_TAG.REMOVE_OBJECT2, body);
};

/*
 * Размер растра кадра: габарит накладки в точках экрана, увеличенный в BITMAP_SUPERSAMPLE раз, но не больше
 * BITMAP_MAX_SIDE по длинной стороне; пропорции габарита сохраняются (картинка вписывается в них).
 */
function bitmapSize(bounds) {
  const width = Math.max(1, (bounds.xmax - bounds.xmin) / TWIPS);
  const height = Math.max(1, (bounds.ymax - bounds.ymin) / TWIPS);
  const scale = Math.min(BITMAP_SUPERSAMPLE, BITMAP_MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(BITMAP_MIN_SIDE, Math.round(width * scale)),
    height: Math.max(BITMAP_MIN_SIDE, Math.round(height * scale)),
  };
}

/** Кадры гифки → пиксели растра кадра: вписаны целиком по центру, вокруг прозрачно. */
export async function fitOverlayFrames(frames, bounds) {
  const size = bitmapSize(bounds);
  const out = [];
  for (const frame of frames.slice(0, OVERLAY_MAX_GIF_FRAMES)) {
    const { data } = await sharp(frame.png, { failOn: "error", limitInputPixels: 4096 * 4096 })
      .ensureAlpha()
      .resize(size.width, size.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    out.push({ width: size.width, height: size.height, rgba: data, delayMs: frame.delayMs });
  }
  return out;
}

/**
 * Накладки в файле. `edits` — `Map<имя, правка>`: `{ mode: "colour", color }`, `{ mode: "hidden" }` или
 * `{ mode: "image", frames: [{ width, height, rgba, delayMs }] }` (кадры — `fitOverlayFrames`); `restore` — имена,
 * что возвращаются к штатному виду; остальное в файле не меняется. `stockBuffer` — файл с штатными накладками
 * (сборка до Astral или Rockstar): без него штатный вид берётся из живого файла, где накладка не правлена нами.
 */
export function compileOverlayGfx(liveBuffer, { names, edits = new Map(), restore = new Set(), stockBuffer = null }) {
  const wanted = [...names].filter((name) => edits.has(name) || restore.has(name));
  const live = resolveOverlays(liveBuffer, wanted);
  const stock = stockBuffer ? resolveOverlays(stockBuffer, wanted) : null;
  const { buffer, index } = live;
  const fps = frameRateOf(buffer);
  const edited = [...index.usedIds].some(inOwnRange);

  /* Штатный спрайт накладки: из файла со штатным видом; в живом — только пока он не правлен. */
  const stockSprite = (name) => {
    if (stock) {
      const found = stock.sprites.get(name);
      for (const dependency of spriteDependencies(stock.buffer, found.tag))
        if (!index.definitions.has(dependency)) throw new Error(`В minimap.gfx игрока нет части накладки ${name} (символ ${dependency}) — файл устроен не как у сборки Rockstar.`);
      return { buffer: stock.buffer, tag: found.tag, bounds: found.bounds };
    }
    if (edited) throw new Error("Накладки в minimap.gfx уже правлены Astral, а штатного файла под рукой нет — вернуть их нечем.");
    const found = live.sprites.get(name);
    return { buffer, tag: found.tag, bounds: found.bounds };
  };

  const replacements = new Map();
  const changed = [];
  wanted.forEach((name, slot) => {
    const target = live.sprites.get(name);
    const base = OVERLAY_ID_BASE + slot * OVERLAY_ID_BLOCK;
    let next = base;
    const allocate = (count) => {
      const ids = Array.from({ length: count }, (_, step) => next + step);
      next += count;
      if (next > base + OVERLAY_ID_BLOCK) throw new Error("Накладка не помещается в отведённые ей номера символов.");
      return ids;
    };
    const original = stockSprite(name);
    if (!edits.has(name)) {
      /* Вернуть: штатный спрайт под прежним номером — части, на которые он ссылается, в живом файле на месте. */
      replacements.set(target.tag.offset, { tags: [spriteCopy(original.buffer, original.tag, target.id)] });
      changed.push({ name, mode: "stock" });
      return;
    }
    const edit = edits.get(name);
    if (edit.mode === "hidden") {
      replacements.set(target.tag.offset, { tags: [defineSprite(target.id, [])] });
    } else if (edit.mode === "colour") {
      const [copyId] = allocate(1);
      const rgb = [1, 3, 5].map((at) => Number.parseInt(String(edit.color || "").slice(at, at + 2), 16) || 0);
      replacements.set(target.tag.offset, {
        tags: [
          spriteCopy(original.buffer, original.tag, copyId),
          defineSprite(target.id, [placeObject2({ depth: 1, characterId: copyId, cxform: multiplyColor(rgb) })]),
        ],
      });
    } else if (edit.mode === "image") {
      const bounds = original.bounds || target.bounds;
      if (!bounds) throw new Error(`У накладки ${name} нет габарита — картинку вписывать не во что.`);
      const frames = edit.frames || [];
      if (!frames.length) throw new Error(`У накладки ${name} нет кадров картинки.`);
      const tags = [];
      const shapes = [];
      for (const frame of frames) {
        const [bitmapId, shapeId] = allocate(2);
        tags.push(defineLosslessBitmap(bitmapId, frame));
        tags.push(
          defineBitmapRectShape(
            shapeId,
            bitmapId,
            { x: bounds.xmin, y: bounds.ymin, width: bounds.xmax - bounds.xmin, height: bounds.ymax - bounds.ymin },
            { a: (bounds.xmax - bounds.xmin) / frame.width, b: 0, c: 0, d: (bounds.ymax - bounds.ymin) / frame.height, tx: bounds.xmin, ty: bounds.ymin },
          ),
        );
        shapes.push({ shapeId, repeat: Math.max(1, Math.round(((frame.delayMs || 100) / 1000) * fps)) });
      }
      /* Кадры спрайта: гифка — по фигуре на кадр (прежнюю снимаем), задержка — повторами без правок. */
      const timeline = [];
      shapes.forEach(({ shapeId, repeat }, step) => {
        timeline.push(step === 0 ? [placeObject2({ depth: 1, characterId: shapeId })] : [removeObject(1), placeObject2({ depth: 1, characterId: shapeId })]);
        for (let again = 1; again < repeat; again += 1) timeline.push([]);
      });
      if (timeline.length > OVERLAY_MAX_SPRITE_FRAMES) timeline.length = OVERLAY_MAX_SPRITE_FRAMES;
      tags.push(defineSpriteFrames(target.id, timeline));
      replacements.set(target.tag.offset, { tags });
    } else {
      throw new Error(`Неизвестный вид правки накладки: ${edit.mode}.`);
    }
    changed.push({ name, mode: edit.mode });
  });

  const output = [buffer.subarray(0, index.headerLength)];
  for (const tag of index.tags) {
    const definition = DEFINITION_ID_TAGS.has(tag.code) && tag.length >= 2 ? buffer.readUInt16LE(tag.payloadStart) : null;
    /* Свои прежние определения снимаются целиком: каждая сборка кладёт их заново. */
    if (definition !== null && inOwnRange(definition)) continue;
    const replacement = replacements.get(tag.offset);
    if (replacement) output.push(...replacement.tags);
    else output.push(buffer.subarray(tag.offset, tag.end));
  }
  const compiled = Buffer.concat(output);
  compiled.writeUInt32LE(compiled.length, 4);
  return { buffer: compiled, changed, sha256: sha256(compiled) };
}

/* Теги с номером символа первым полем — те, что `indexSwf` считает определениями (и растр кадров). */
const DEFINITION_ID_TAGS = new Set([2, 6, 7, 10, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 60, 75, 83, 84, 87, 90, 91]);

/**
 * Накладка картинкой: `{ png, width, height, box, frames }` — кадр `frame` спрайта на прозрачном фоне в `scale` раз
 * крупнее экрана. Штатные накладки — куски листа значков `minimap.ytd` (внешние картинки Scaleform): `images(внешняя
 * картинка)` отдаёт их читалке как `{ width, height, rgba }` (`decodeTextureRef`); правленые кадры лежат в самом файле.
 */
export async function renderOverlayPng(gfxBuffer, name, { scale = 8, frame = 0, images = null } = {}) {
  const gfx = readGfx(gfxBuffer);
  const id = gfx.exports.get(name);
  if (id === undefined) return null;
  const index = indexSwf(uncompressedScaleform(gfxBuffer));
  const bounds = characterBounds(index, id);
  if (!bounds) return null;
  const pad = 2;
  const left = bounds.xmin / TWIPS;
  const top = bounds.ymin / TWIPS;
  const width = Math.max(1, Math.ceil(((bounds.xmax - bounds.xmin) / TWIPS) * scale) + pad * 2);
  const height = Math.max(1, Math.ceil(((bounds.ymax - bounds.ymin) / TWIPS) * scale) + pad * 2);
  const renderer = createRenderer(gfx, { images });
  const surface = renderer.renderFrame({
    sprite: id,
    frame,
    width,
    height,
    transform: { a: scale, b: 0, c: 0, d: scale, tx: pad - left * scale, ty: pad - top * scale },
  });
  const rgba = surfaceToRgba(surface);
  const png = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer();
  return {
    png,
    width,
    height,
    /* Габарит накладки в точках экрана — окну: пропорции рисунка. */
    box: { width: (bounds.xmax - bounds.xmin) / TWIPS, height: (bounds.ymax - bounds.ymin) / TWIPS },
    frames: spriteFrameCount(gfxBuffer, id),
  };
}

/** Сколько кадров у спрайта (поле FrameCount заголовка DefineSprite). */
export function spriteFrameCount(gfxBuffer, id) {
  const buffer = uncompressedScaleform(gfxBuffer);
  const tag = indexSwf(buffer).definitions.get(id);
  return tag?.code === SWF_TAG.DEFINE_SPRITE ? buffer.readUInt16LE(tag.payloadStart + 2) : 0;
}
