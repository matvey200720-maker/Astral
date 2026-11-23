/*
 * Таблица значков карты игры: номер спрайта → символ `radar_*` → клетка листа в `minimap.ytd`
 * (задача 05.11.2026, «Иконки» большой карты; устройство — `docs/BLIP-ICONS.md`).
 *
 * Что в файле игры (разобрано на настоящем `minimap.gfx`, 227 324 байта):
 *   — номер спрайта, который ставит сервер (73, 110…), — индекс в массиве `Blips.getListOfBlips` (DoInitAction класса
 *     `com.rockstargames.gtav.constants.Blips`, 973 записи: имена символов по порядку);
 *   — символ `radar_*` — спрайт; у большинства он один раз ставит фигуру-квадрат 16×16 с растровой заливкой, а растр —
 *     внешняя картинка (`DefineExternalImage2`) из словаря текстур фильма, то есть лист `blips_texturesheet_*` в
 *     `minimap.ytd`. Матрица заливки выбирает клетку листа (64×64 точки), её размер и место — «клетка» ниже;
 *   — часть символов — векторные фигуры без картинки (`radar_level`, числа, оружие) и красные заглушки без единой
 *     картинки: у них клетки нет, и этим модулем они не правятся.
 *
 * Координаты клетки считаются в точках листа, как их объявил фильм (`DefineExternalImage2`): у `blips_texturesheet_NG_3`
 * объявлено 1024×448, а в словаре лежит 1024×512 — клетка по вертикали растянута, и в точках текстуры она 64×73
 * (`realRect`). Клетка, что ложится на сетку блоков DXT 4×4 целиком, правится блоками; остальные — граничными блоками
 * (`blip-icon-sheets.js`).
 */

import { TAG, actionTape, displayList, readGfx, readShape, readSprite } from "@modovik/gfx";

export const BLIP_CELL_SIDE = 64;
const SHAPE_TAGS = new Set([2, 22, 32, 83]);
const MAX_DEPTH = 6;
const EPSILON = 1e-3;

/** Имена символов по номерам спрайтов (массив `getListOfBlips`) или `null`, если класса нет. */
export function readBlipSpriteNames(gfx) {
  for (const tag of gfx.tags) {
    if (tag.code !== TAG.DO_INIT_ACTION || tag.end - tag.start < 3) continue;
    let tape;
    try {
      tape = actionTape(gfx.bytes, tag.start + 2, tag.end);
    } catch {
      continue;
    }
    const values = tape.map((item) => item.value).filter((value) => typeof value === "string");
    const at = values.indexOf("getListOfBlips");
    if (at < 0 || !values.includes("radar_higher")) continue;
    const names = [];
    for (let index = at + 2; index < values.length; index += 1) {
      const value = values[index];
      if (value === "push") continue;
      names.push(value);
    }
    /* За массивом идёт хвост класса: `com rockstargames gtav constants Blips prototype ASSetPropFlags`. */
    const tail = names.indexOf("com", Math.max(0, names.length - 12));
    return tail > 0 ? names.slice(0, tail) : names;
  }
  return null;
}

/* Конечные фигуры символа на первом кадре: сквозь вложенные спрайты. */
function leafShapes(gfx, spriteId, depth, out, info) {
  if (depth > MAX_DEPTH) {
    info.deep = true;
    return;
  }
  const sprite = readSprite(gfx, spriteId);
  if (!sprite) return;
  if (sprite.frameCount > 1) info.animated = true;
  for (const item of displayList(gfx, spriteId, 0)) {
    const definition = gfx.definitions.get(item.characterId);
    if (!definition) continue;
    if (definition.code === TAG.DEFINE_SPRITE) leafShapes(gfx, item.characterId, depth + 1, out, info);
    else if (SHAPE_TAGS.has(definition.code)) out.push(item.characterId);
  }
}

const cellKey = (cell) => [cell.sheet, cell.x, cell.y, cell.w, cell.h].map((value) => (typeof value === "number" ? +value.toFixed(3) : value)).join(":");

/* Клетка из растровой заливки фигуры: объявленные точки листа. */
function cellOf(gfx, shape, fill) {
  const external = gfx.externalImages.get(fill.bitmapId);
  if (!external) return null;
  const { matrix } = fill;
  if (!matrix || !matrix.a || !matrix.d) return null;
  const { bounds } = shape;
  const x = (bounds.xmin - matrix.tx) / matrix.a;
  const y = (bounds.ymin - matrix.ty) / matrix.d;
  const w = (bounds.xmax - bounds.xmin) / matrix.a;
  const h = (bounds.ymax - bounds.ymin) / matrix.d;
  if (!(w > 0) || !(h > 0)) return null;
  const cell = {
    sheet: String(external.exportName || "").toLowerCase(),
    sheetWidth: external.width,
    sheetHeight: external.height,
    x,
    y,
    w,
    h,
  };
  return { ...cell, key: cellKey(cell) };
}

/*
 * Что за символ: `bitmap` — есть растровые заливки (клетки); `vector` — цветные фигуры без картинки;
 * `placeholder` — одни красные заливки (заглушка Rockstar); `empty` — нет ни заливок, ни линий; `missing` — в файле нет
 * символа с таким именем.
 */
function classify(shapes) {
  const fills = shapes.flatMap((shape) => shape.fills);
  if (fills.some((fill) => fill.type === "bitmap")) return "bitmap";
  if (!fills.length) return "empty";
  const red = fills.every((fill) => fill.type === "solid" && fill.color[0] === 255 && fill.color[1] === 0 && fill.color[2] === 0);
  return red ? "placeholder" : "vector";
}

/**
 * Таблица значков файла `minimap.gfx`.
 *
 * `sprites` — по номеру: `{ sprite, symbol, symbolId, kind, animated, cells: [клетка] }`; `byCell` — ключ клетки → номера
 * спрайтов, что её берут (общие клетки: `garage` и `multistorey_garage`). Бросает, если файл не мини-карта игры.
 */
export function readBlipTable(gfxBytes) {
  const gfx = readGfx(gfxBytes);
  const names = readBlipSpriteNames(gfx);
  if (!names?.length) throw new Error("В minimap.gfx нет таблицы значков Blips — это не мини-карта игры.");
  const shapeCache = new Map();
  const shapeOf = (id) => {
    if (!shapeCache.has(id)) {
      const tag = gfx.definitions.get(id);
      shapeCache.set(id, tag ? readShape(gfx.bytes, tag) : null);
    }
    return shapeCache.get(id);
  };
  const sprites = new Map();
  const byCell = new Map();
  for (const [sprite, symbol] of names.entries()) {
    if (symbol === "radar_empty") {
      sprites.set(sprite, { sprite, symbol, symbolId: null, kind: "empty", animated: false, cells: [] });
      continue;
    }
    const symbolId = gfx.exports.get(symbol);
    if (symbolId === undefined) {
      sprites.set(sprite, { sprite, symbol, symbolId: null, kind: "missing", animated: false, cells: [] });
      continue;
    }
    const leaves = [];
    const info = {};
    leafShapes(gfx, symbolId, 0, leaves, info);
    const shapes = leaves.map(shapeOf).filter(Boolean);
    const kind = classify(shapes);
    const cells = [];
    const seen = new Set();
    for (const shape of shapes)
      for (const fill of shape.fills) {
        if (fill.type !== "bitmap") continue;
        const cell = cellOf(gfx, shape, fill);
        if (!cell || seen.has(cell.key)) continue;
        seen.add(cell.key);
        cells.push(cell);
      }
    sprites.set(sprite, { sprite, symbol, symbolId, kind, animated: Boolean(info.animated), cells });
    for (const cell of cells) {
      const list = byCell.get(cell.key) || [];
      list.push(sprite);
      byCell.set(cell.key, list);
    }
  }
  return { gfx, sprites, byCell };
}

/** Клетка в точках текстуры листа: масштаб — настоящий размер словаря к объявленному в фильме. */
export function realRect(cell, sheet) {
  const kx = sheet.width / cell.sheetWidth;
  const ky = sheet.height / cell.sheetHeight;
  const exact = (value) => Math.abs(value - Math.round(value)) < EPSILON;
  const x0 = cell.x * kx;
  const y0 = cell.y * ky;
  const x1 = (cell.x + cell.w) * kx;
  const y1 = (cell.y + cell.h) * ky;
  /* Дробный край у границы листа (клетка начинается в −0,6 точки) прижимается к листу: за ним точек нет. */
  const clamp = (value, limit) => Math.min(limit, Math.max(0, Math.round(value)));
  return {
    x0: clamp(x0, sheet.width),
    y0: clamp(y0, sheet.height),
    x1: clamp(x1, sheet.width),
    y1: clamp(y1, sheet.height),
    /* Границы клетки — целые точки текстуры (иначе её края лежат между точками). */
    exact: [x0, y0, x1, y1].every(exact),
    scaleX: kx,
    scaleY: ky,
  };
}

/** Клетка стоит на сетке блоков DXT 4×4 целиком: её можно заменить блоками, не трогая соседей. */
export const blockAligned = (rect) =>
  rect.exact && rect.x0 % 4 === 0 && rect.y0 % 4 === 0 && rect.x1 % 4 === 0 && rect.y1 % 4 === 0 && rect.x1 > rect.x0 && rect.y1 > rect.y0;
