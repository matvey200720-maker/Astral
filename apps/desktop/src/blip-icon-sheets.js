/*
 * Листы значков в `minimap.ytd`: чтение клеток и замена пикселей клетки (задача 05.11.2026, «Иконки» большой карты).
 *
 * Лист — текстура DXT (`blips_texturesheet_NG`: 1024×1024, 3 уровня mip; `_NG_2`: один уровень; `_NG_3`, старый лист),
 * клетка — квадрат 64×64 точки. Замена клетки — это блоки DXT 4×4 этой клетки на каждом уровне mip, а всё остальное
 * (другие клетки листа, другие листы словаря) остаётся байт в байт: так же правит клетку значка метки GPS
 * (`gps-customizer.js`, проверено в игре 10.10.2026).
 *
 * Клетка, что целиком лежит на сетке блоков, правится прямой подстановкой блоков. Клетка с границей посреди блока
 * (лист `_NG_3` растянут по вертикали, у части клеток дробные края) правится граничными блоками — см. `replaceCellEdges`.
 */

import { decodeBlocks, downsample, encodeBlocks, resample } from "@modovik/dds";
import { readTextureDictionary } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";

export const DXT_BLOCK_BYTES = Object.freeze({ DXT1: 8, DXT3: 16, DXT5: 16 });
const BLOCK = 4;

/** Листы словаря `minimap.ytd` по имени (строчными): `{ name, format, width, height, levels: [Buffer] }`. */
export function readSheets(ytdBytes) {
  const textures = readTextureDictionary(ytdBytes, { inflateRaw: inflateRawNode });
  const sheets = new Map();
  for (const ref of textures) {
    if (!/^blips_texturesheet/i.test(ref.name)) continue;
    const levels = ref.spans.map((span) =>
      Buffer.from(ref.resource.data.subarray(ref.dataAt + span.offset, ref.dataAt + span.offset + span.bytes)),
    );
    sheets.set(ref.name.toLowerCase(), { name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels });
  }
  return sheets;
}

export const isBlockFormat = (sheet) => Object.hasOwn(DXT_BLOCK_BYTES, sheet.format);

const levelWidth = (sheet, level) => Math.max(1, sheet.width >> level);

/** Клетка на уровне mip: целые точки, или `null`, если на этом уровне она уже меньше блока. */
export function levelRect(rect, level) {
  const x0 = rect.x0 >> level;
  const y0 = rect.y0 >> level;
  const x1 = rect.x1 >> level;
  const y1 = rect.y1 >> level;
  /* Клетка на сетке блоков остаётся на ней, пока её сторона делится на 4. */
  const aligned = x0 % BLOCK === 0 && y0 % BLOCK === 0 && x1 % BLOCK === 0 && y1 % BLOCK === 0 && x1 > x0 && y1 > y0;
  return aligned && x0 << level === rect.x0 && y0 << level === rect.y0 && x1 << level === rect.x1 && y1 << level === rect.y1
    ? { x0, y0, x1, y1 }
    : null;
}

/** Сколько уровней mip клетки можно переписать блоками (на остальных клетка меньше блока — они не трогаются). */
export function cellLevelCount(sheet, rect) {
  let count = 0;
  for (let level = 0; level < sheet.levels.length; level += 1) {
    if (!levelRect(rect, level)) break;
    count += 1;
  }
  return count;
}

/* Строки блоков прямоугольника уровня: смещения и длина в байтах. */
function blockRows(sheet, level, rect) {
  const block = DXT_BLOCK_BYTES[sheet.format];
  const perRow = Math.ceil(levelWidth(sheet, level) / BLOCK);
  const rows = [];
  for (let row = rect.y0 / BLOCK; row < rect.y1 / BLOCK; row += 1)
    rows.push({ offset: (row * perRow + rect.x0 / BLOCK) * block, bytes: ((rect.x1 - rect.x0) / BLOCK) * block });
  return rows;
}

/** Пиксели клетки верхнего уровня: `{ width, height, rgba }`. */
export function readCell(sheet, rect) {
  if (!isBlockFormat(sheet)) throw new Error(`Лист ${sheet.name} — ${sheet.format}: Astral правит только листы DXT.`);
  const top = levelRect(rect, 0);
  if (!top) throw new Error("Клетка лежит не на сетке блоков листа.");
  const blocks = Buffer.concat(blockRows(sheet, 0, top).map(({ offset, bytes }) => sheet.levels[0].subarray(offset, offset + bytes)));
  const width = top.x1 - top.x0;
  const height = top.y1 - top.y0;
  return { width, height, rgba: decodeBlocks(sheet.format, blocks, width, height) };
}

/** Клетка нужного размера: `rgba` как есть, а иначе пересчитанная (коробочный фильтр). */
export function fitCell(rgba, width, height, nextWidth, nextHeight) {
  return resample(rgba, width, height, nextWidth, nextHeight);
}

/* Квадрат стороны `side` с рисунком `width × height` по центру: прозрачные поля. */
function centred(rgba, width, height, side) {
  if (width === side && height === side) return rgba;
  const out = new Uint8ClampedArray(side * side * 4);
  const ox = Math.floor((side - width) / 2);
  const oy = Math.floor((side - height) / 2);
  for (let y = 0; y < height; y += 1) out.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), ((oy + y) * side + ox) * 4);
  return out;
}

/** Рамка рисунка с пропорцией клетки (`aspect` = ширина ÷ высота как на экране) внутри квадрата `side`. */
export function displayBox(aspect, side) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return ratio >= 1 ? { width: side, height: Math.max(1, Math.round(side / ratio)) } : { width: Math.max(1, Math.round(side * ratio)), height: side };
}

/**
 * Клетка квадратной картинкой `side × side` для окна: рисунок с экранной пропорцией клетки по центру (у клетки листа
 * `_NG_3` точки растянуты по вертикали — на экране она квадрат; у мелких деталей старого листа — прямоугольник).
 */
export function cellPicture(sheet, rect, aspect = 1, side = 64) {
  const box = displayBox(aspect, side);
  const { rgba } = cropCell(sheet, rect, [box.width, box.height]);
  return centred(rgba, box.width, box.height, side);
}

/** Клетка с экранной пропорцией, близкой к квадрату (до 10 %): её точки текстуры можно растянуть под квадратный рисунок. */
const nearSquare = (aspect) => !Number.isFinite(aspect) || Math.abs(aspect - 1) < 0.1;

/**
 * Квадрат `side × side` (обычный значок) — в клетку листа `width × height` точек текстуры, чья экранная пропорция
 * `aspect`. Клетка почти квадратная (в том числе растянутая клетка `_NG_3`) — рисунок растягивается на неё целиком,
 * на экране он выходит квадратом; узкая или широкая — рисунок вписывается в её рамку по центру.
 */
export function placeInCell(rgba, side, aspect, width, height) {
  if (nearSquare(aspect)) return resample(rgba, side, side, width, height);
  const box = displayBox(aspect, side);
  const inner = Math.max(1, Math.min(box.width, box.height));
  const small = resample(rgba, side, side, inner, inner);
  const canvas = new Uint8ClampedArray(box.width * box.height * 4);
  const ox = Math.floor((box.width - inner) / 2);
  const oy = Math.floor((box.height - inner) / 2);
  for (let y = 0; y < inner; y += 1) canvas.set(small.subarray(y * inner * 4, (y + 1) * inner * 4), ((oy + y) * box.width + ox) * 4);
  return resample(canvas, box.width, box.height, width, height);
}

/**
 * Клетка картинкой по границам её точек, без требования сетки блоков: читаются блоки, что накрывают клетку, и берётся её
 * часть. `size` — `[ширина, высота]`: клетка пересчитывается (у листа `_NG_3` она растянута по вертикали и в точках текстуры
 * 64×73 — окну нужен квадрат 64×64).
 */
export function cropCell(sheet, rect, size = null) {
  if (!isBlockFormat(sheet)) throw new Error(`Лист ${sheet.name} — ${sheet.format}: Astral читает только листы DXT.`);
  const block = DXT_BLOCK_BYTES[sheet.format];
  const perRow = Math.ceil(sheet.width / BLOCK);
  const x0 = Math.max(0, rect.x0);
  const y0 = Math.max(0, rect.y0);
  const x1 = Math.min(sheet.width, rect.x1);
  const y1 = Math.min(sheet.height, rect.y1);
  const bx0 = Math.floor(x0 / BLOCK);
  const bx1 = Math.ceil(x1 / BLOCK);
  const by0 = Math.floor(y0 / BLOCK);
  const by1 = Math.ceil(y1 / BLOCK);
  const parts = [];
  for (let row = by0; row < by1; row += 1) {
    const at = (row * perRow + bx0) * block;
    parts.push(sheet.levels[0].subarray(at, at + (bx1 - bx0) * block));
  }
  const stride = (bx1 - bx0) * BLOCK;
  const region = decodeBlocks(sheet.format, Buffer.concat(parts), stride, (by1 - by0) * BLOCK);
  const width = x1 - x0;
  const height = y1 - y0;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((y0 - by0 * BLOCK + y) * stride + (x0 - bx0 * BLOCK)) * 4;
    out.set(region.subarray(from, from + width * 4), y * width * 4);
  }
  return size ? { width: size[0], height: size[1], rgba: resample(out, width, height, size[0], size[1]) } : { width, height, rgba: out };
}

/**
 * Лист с новыми пикселями клетки: `rgba` — размером с клетку (`x1 - x0` × `y1 - y0`). Уровни mip строятся усреднением
 * клетки, как строит их и сама игра. Возвращает уровни — копии; не тронутые блоки те же байты.
 */
export function replaceCell(sheet, rect, rgba) {
  if (!isBlockFormat(sheet)) throw new Error(`Лист ${sheet.name} — ${sheet.format}: Astral правит только листы DXT.`);
  const top = levelRect(rect, 0);
  if (!top) throw new Error("Клетка лежит не на сетке блоков листа.");
  const width = top.x1 - top.x0;
  const height = top.y1 - top.y0;
  if (rgba.length !== width * height * 4) throw new Error("Картинка клетки не того размера.");
  const levels = sheet.levels.map((level) => Buffer.from(level));
  let image = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  let imageWidth = width;
  let imageHeight = height;
  for (let level = 0; level < levels.length; level += 1) {
    const place = levelRect(rect, level);
    if (!place) break;
    const encoded = Buffer.from(encodeBlocks(sheet.format, image, imageWidth, imageHeight));
    let at = 0;
    for (const { offset, bytes } of blockRows(sheet, level, place)) {
      encoded.copy(levels[level], offset, at, at + bytes);
      at += bytes;
    }
    if (level + 1 < levels.length && levelRect(rect, level + 1)) {
      image = downsample(image, imageWidth, imageHeight);
      imageWidth = Math.max(1, imageWidth >> 1);
      imageHeight = Math.max(1, imageHeight >> 1);
    }
  }
  return levels;
}

/** Клетка из другого листа (штатного) — блоки как есть: «Как в игре» возвращает байты Rockstar. */
export function copyCellBlocks(live, stock, rect) {
  if (stock.format !== live.format || stock.width !== live.width || stock.height !== live.height || stock.levels.length !== live.levels.length)
    throw new Error("Лист другого устройства: клетку из него вернуть нельзя.");
  const levels = live.levels.map((level) => Buffer.from(level));
  for (let level = 0; level < levels.length; level += 1) {
    const place = levelRect(rect, level);
    if (!place) break;
    for (const { offset, bytes } of blockRows(live, level, place)) stock.levels[level].copy(levels[level], offset, offset, offset + bytes);
  }
  return levels;
}

/** Клетка в двух листах одинакова на всех уровнях, что она занимает. */
export function sameCell(a, b, rect) {
  if (a.format !== b.format || a.width !== b.width || a.height !== b.height || a.levels.length !== b.levels.length) return false;
  for (let level = 0; level < a.levels.length; level += 1) {
    const place = levelRect(rect, level);
    if (!place) break;
    for (const { offset, bytes } of blockRows(a, level, place))
      if (!a.levels[level].subarray(offset, offset + bytes).equals(b.levels[level].subarray(offset, offset + bytes))) return false;
  }
  return true;
}

/* ------------------------------------------------ клетки с границей посреди блока */

/*
 * Клетка, чья граница не лежит на сетке блоков DXT 4×4: лист `_NG_3` растянут по вертикали (клетка 64×73 точки — край посреди
 * блока), у части клеток старых листов дробные края. Блок DXT хранит два цвета и индексы на 16 точек, поэтому точку внутри блока
 * нельзя заменить, не пересжав блок целиком. Так и делается: блоки, что накрывают клетку, распаковываются, в них меняются
 * только точки клетки, и блоки сжимаются обратно. Блоки целиком вне клетки не трогаются — те же байты. Точки соседей в
 * граничных блоках после пересжатия отличаются на ошибку DXT (`EDGE_TOLERANCE`).
 *
 * Уровни mip: на каждом уровне клетка — накрывающий прямоугольник целых точек (границы округляются наружу), рисунок для него —
 * клетка, пересчитанная до его размера. Уровень, где клетка мельче точки, не правится.
 */

/** Наибольшее расхождение канала у точек соседей в граничном блоке, которое считается ошибкой DXT, а не чужой правкой. */
export const EDGE_TOLERANCE = 40;

/** Клетка стоит на сетке блоков целиком — правится прямой подстановкой блоков (`replaceCell`). */
export const cellAligned = (rect) => levelRect(rect, 0) !== null;

/* Накрывающий прямоугольник клетки на уровне (целые точки) или `null`: лист на этом уровне не кратен блоку, клетка меньше точки. */
function coverRect(sheet, rect, level) {
  const width = Math.max(1, sheet.width >> level);
  const height = Math.max(1, sheet.height >> level);
  if (width % BLOCK || height % BLOCK) return null;
  const factor = 1 << level;
  const x0 = Math.floor(rect.x0 / factor);
  const y0 = Math.floor(rect.y0 / factor);
  const x1 = Math.min(width, Math.ceil(rect.x1 / factor));
  const y1 = Math.min(height, Math.ceil(rect.y1 / factor));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

function blockSpan(sheet, level, cover) {
  const bx0 = Math.floor(cover.x0 / BLOCK);
  const by0 = Math.floor(cover.y0 / BLOCK);
  const bx1 = Math.ceil(cover.x1 / BLOCK);
  const by1 = Math.ceil(cover.y1 / BLOCK);
  const perRow = Math.ceil(Math.max(1, sheet.width >> level) / BLOCK);
  const block = DXT_BLOCK_BYTES[sheet.format];
  const rows = [];
  for (let row = by0; row < by1; row += 1) rows.push({ offset: (row * perRow + bx0) * block, bytes: (bx1 - bx0) * block });
  return { bx0, by0, bx1, by1, rows, regionWidth: (bx1 - bx0) * BLOCK, regionHeight: (by1 - by0) * BLOCK };
}

/**
 * Лист с новыми пикселями клетки (`rgba` — `x1 - x0` × `y1 - y0` точек верхнего уровня): граничные блоки пересжимаются, остальные
 * блоки листа — те же байты. Возвращает уровни — копии.
 */
export function replaceCellEdges(sheet, rect, rgba) {
  if (!isBlockFormat(sheet)) throw new Error(`Лист ${sheet.name} — ${sheet.format}: Astral правит только листы DXT.`);
  const width = rect.x1 - rect.x0;
  const height = rect.y1 - rect.y0;
  if (!(width > 0 && height > 0) || rgba.length !== width * height * 4) throw new Error("Картинка клетки не того размера.");
  const content = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const levels = sheet.levels.map((level) => Buffer.from(level));
  for (let level = 0; level < levels.length; level += 1) {
    const cover = coverRect(sheet, rect, level);
    if (!cover) break;
    const span = blockSpan(sheet, level, cover);
    const cellWidth = cover.x1 - cover.x0;
    const cellHeight = cover.y1 - cover.y0;
    const image = level === 0 ? content : resample(content, width, height, cellWidth, cellHeight);
    const region = decodeBlocks(
      sheet.format,
      Buffer.concat(span.rows.map(({ offset, bytes }) => levels[level].subarray(offset, offset + bytes))),
      span.regionWidth,
      span.regionHeight,
    );
    for (let y = 0; y < cellHeight; y += 1)
      region.set(image.subarray(y * cellWidth * 4, (y + 1) * cellWidth * 4), ((cover.y0 - span.by0 * BLOCK + y) * span.regionWidth + (cover.x0 - span.bx0 * BLOCK)) * 4);
    const encoded = Buffer.from(encodeBlocks(sheet.format, region, span.regionWidth, span.regionHeight));
    let at = 0;
    for (const { offset, bytes } of span.rows) {
      encoded.copy(levels[level], offset, at, at + bytes);
      at += bytes;
    }
  }
  return levels;
}

/* Точка внутри накрывающего прямоугольника? */
const inside = (cover, x, y) => x >= cover.x0 && x < cover.x1 && y >= cover.y0 && y < cover.y1;

/* Ошибка DXT растёт с уровнем mip: блок мелкого уровня покрывает больше исходных точек. */
const toleranceAt = (level) => EDGE_TOLERANCE + 20 * level;

const closeRgba = (a, b, at, level = 0) => {
  const tolerance = toleranceAt(level);
  for (let channel = 0; channel < 4; channel += 1) if (Math.abs(a[at + channel] - b[at + channel]) > tolerance) return false;
  return true;
};

/**
 * «Как в игре» для клетки с границей посреди блока: блок целиком в клетке — байты штатного листа; граничный блок — штатные
 * байты, если точки соседей в живом листе отличаются от штатных не больше ошибки DXT (так и бывает после нашей же правки), а
 * иначе штатные точки клетки поверх живых соседей. Лист, у которого соседи не тронуты, возвращается байт в байт.
 */
export function restoreCellEdges(live, stock, rect) {
  if (stock.format !== live.format || stock.width !== live.width || stock.height !== live.height || stock.levels.length !== live.levels.length)
    throw new Error("Лист другого устройства: клетку из него вернуть нельзя.");
  const levels = live.levels.map((level) => Buffer.from(level));
  const block = DXT_BLOCK_BYTES[live.format];
  for (let level = 0; level < levels.length; level += 1) {
    const cover = coverRect(live, rect, level);
    if (!cover) break;
    const span = blockSpan(live, level, cover);
    const perRow = Math.ceil(Math.max(1, live.width >> level) / BLOCK);
    for (let by = span.by0; by < span.by1; by += 1)
      for (let bx = span.bx0; bx < span.bx1; bx += 1) {
        const offset = (by * perRow + bx) * block;
        const liveBlock = levels[level].subarray(offset, offset + block);
        const stockBlock = stock.levels[level].subarray(offset, offset + block);
        if (liveBlock.equals(stockBlock)) continue;
        const liveRgba = decodeBlocks(live.format, liveBlock, BLOCK, BLOCK);
        const stockRgba = decodeBlocks(live.format, stockBlock, BLOCK, BLOCK);
        let neighboursKept = true;
        for (let y = 0; y < BLOCK && neighboursKept; y += 1)
          for (let x = 0; x < BLOCK; x += 1)
            if (!inside(cover, bx * BLOCK + x, by * BLOCK + y) && !closeRgba(liveRgba, stockRgba, (y * BLOCK + x) * 4, level)) {
              neighboursKept = false;
              break;
            }
        if (neighboursKept) {
          stockBlock.copy(levels[level], offset);
          continue;
        }
        const merged = new Uint8ClampedArray(liveRgba);
        for (let y = 0; y < BLOCK; y += 1)
          for (let x = 0; x < BLOCK; x += 1)
            if (inside(cover, bx * BLOCK + x, by * BLOCK + y)) merged.set(stockRgba.subarray((y * BLOCK + x) * 4, (y * BLOCK + x) * 4 + 4), (y * BLOCK + x) * 4);
        Buffer.from(encodeBlocks(live.format, merged, BLOCK, BLOCK)).copy(levels[level], offset);
      }
  }
  return levels;
}

/** Клетка в двух листах одинакова: на сетке блоков — блоки на всех уровнях, иначе — точки верхнего уровня в пределах ошибки DXT. */
export function sameCellAny(a, b, rect) {
  if (a.format !== b.format || a.width !== b.width || a.height !== b.height || a.levels.length !== b.levels.length) return false;
  if (cellAligned(rect)) return sameCell(a, b, rect);
  const left = cropCell(a, rect).rgba;
  const right = cropCell(b, rect).rgba;
  for (let at = 0; at < left.length; at += 4) if (!closeRgba(left, right, at)) return false;
  return true;
}

/** Новые уровни листа с картинкой клетки — на сетке блоков прямой подстановкой, иначе граничными блоками. */
export const replaceCellAny = (sheet, rect, rgba) => (cellAligned(rect) ? replaceCell(sheet, rect, rgba) : replaceCellEdges(sheet, rect, rgba));

/** Новые уровни листа с клеткой из штатного — блоками (на сетке) или с разбором граничных блоков. */
export const restoreCellAny = (live, stock, rect) => (cellAligned(rect) ? copyCellBlocks(live, stock, rect) : restoreCellEdges(live, stock, rect));
