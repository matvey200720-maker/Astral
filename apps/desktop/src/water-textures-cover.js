/*
 * Обложка воды из текстур автора (редукс ENEMY V2, 13.11.2026).
 *
 * Часть «Вода» бывает без `water.xml`: автор меняет только словарь текстур поверхности `x64/textures/water.ytd`, и кадру моря из игры
 * (`water-sea-capture.js`) нечего брать — он красит море числами из `water.xml`, а лист поверхности (`waterclear`) не читает вовсе, то есть
 * положить на него текстуры автора честно нельзя. Поэтому обложка — сами текстуры: слева та, что лежит в игре, справа та, что в файле автора
 * («было → у автора»), в тех же пикселях, что в файлах, без раскраски и без подгонки света. Показываются только изменённые: текстура, что
 * в файле автора байт в байт как в игре (или отличается дальше шума сжатия, но не глазом), обложку не получает.
 *
 *   • изменённая — есть в игре и отличается размером или содержимым;
 *   • новая — в игре такого листа нет: рисуется одна, без пары;
 *   • пустышка — лист автора прозрачный или одного цвета: рисуется как есть, прозрачное — на шахматке, чтобы пустое было видно пустым.
 *
 * Без надписей на картинке: подпись под ней (`captionOf`) — словом языка окна, шрифтов на машине разбора может не быть. Сборка без окна
 * (`sharp`), как у остальных рисовальщиков частей (`part-cover-painters.js`). Игры нет (штатный словарь не прочитался) — одна текстура
 * автора на весь кадр: сравнивать не с чем, но и выдумывать нечего.
 */

import sharp from "sharp";
import { inflateRawNode } from "@modovik/rpf7/node";
import {
  decodeTextureRef,
  readTextureDictionary,
} from "@modovik/rage-drawable";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";

export const WATER_COVER = Object.freeze({ width: 1200, height: 675 });

/** Где в игре лежит штатный словарь воды: обновление главнее (оно и читается игрой), затем базовый архив. */
export const STOCK_WATER_PLACES = Object.freeze([
  "update/update.rpf:x64/textures/water.ytd",
  "x64a.rpf:textures/water.ytd",
]);

/** Подписи обложки (ключи словаря окна, `ui-text/zone-water-textures-1311.js`): с парой «игра → автор» и без неё. */
export const WATER_CAPTION =
  "Текстуры воды: слева из игры, справа из файла автора";
export const WATER_CAPTION_AUTHOR_ONLY = "Текстуры воды из файла автора";

/** Не больше стольких изменённых текстур на обложке: больше — плитки мельче глаза. */
const PAIRS_MAX = 4;
/** Сторона, по которой сравниваются две текстуры, и отличие (среднее по каналам, 0…255), с которого они разные. */
const COMPARE_SIDE = 48;
const DIFFERENT = 6;
/** Лист — «пустышка»: средняя прозрачность ниже этой или разброс цвета ниже второй. */
const BLANK_ALPHA = 8;
const BLANK_DEVIATION = 2.5;
/** Раскладка: поле, зазор между плитками пары и скругление. */
const MARGIN = 36;
const GAP = 64;
const RADIUS = 18;
/** Шахматка под прозрачным: клетка и два серых. */
const CHECKER = 24;
const CHECKER_COLOURS = Object.freeze(["#3a3a3f", "#4b4b51"]);

const lowered = (text) => String(text || "").toLowerCase();

/** Листы словаря: `[{ name, width, height, format }]` и ссылки на пиксели; словарь не читается — пусто. */
function refsOf(bytes) {
  if (!bytes?.length) return [];
  try {
    return readTextureDictionary(new Uint8Array(bytes), {
      inflateRaw: inflateRawNode,
    });
  } catch {
    return [];
  }
}

/** Лист в точки RGBA: `{ width, height, data }` или `null`, если формат не читается. */
function pixelsOf(ref) {
  try {
    const { width, height, rgba } = decodeTextureRef(ref, { maxSize: 4096 });
    return {
      width,
      height,
      data: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    };
  } catch {
    return null;
  }
}

/** Мелкая копия для сравнения и разбора пустышек: RGBA `COMPARE_SIDE`². */
async function sampleOf(pixels) {
  const { data } = await sharp(pixels.data, {
    raw: { width: pixels.width, height: pixels.height, channels: 4 },
  })
    .resize(COMPARE_SIDE, COMPARE_SIDE, { fit: "fill", kernel: "linear" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/** Среднее отличие двух мелких копий по каналам (0…255). */
export function sampleDistance(left, right) {
  const count = Math.min(left.length, right.length);
  if (!count) return 0;
  let sum = 0;
  for (let at = 0; at < count; at += 1) sum += Math.abs(left[at] - right[at]);
  return sum / count;
}

/** Что у листа с виду: прозрачный, одноцветный или обычный. */
export function blankOf(sample) {
  let alpha = 0;
  const light = [];
  for (let at = 0; at < sample.length; at += 4) {
    alpha += sample[at + 3];
    light.push(
      0.2126 * sample[at] + 0.7152 * sample[at + 1] + 0.0722 * sample[at + 2],
    );
  }
  const count = Math.max(1, light.length);
  if (alpha / count < BLANK_ALPHA) return "transparent";
  const mean = light.reduce((sum, value) => sum + value, 0) / count;
  const deviation = Math.sqrt(
    light.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count,
  );
  return deviation < BLANK_DEVIATION ? "flat" : "";
}

/** Листы словаря, уже в точках: `[{ name, width, height, format, pixels }]`; словарь не читается или лист не раскодирован — его в ответе нет. */
export function decodedSet(bytes) {
  return refsOf(bytes).flatMap((ref) => {
    const pixels = pixelsOf(ref);
    return pixels
      ? [
          {
            name: ref.name,
            width: ref.width,
            height: ref.height,
            format: ref.format || "",
            pixels,
          },
        ]
      : [];
  });
}

/**
 * Что автор сделал с каждым листом своего словаря относительно игры (листы — `decodedSet`).
 *
 * @returns {Promise<{ name: string, state: "changed"|"same"|"new", blank: ""|"transparent"|"flat", author: object, stock: object|null }[]>}
 *   у каждого листа: размеры и формат с обеих сторон и точки (`pixels`) для рисования; штатного листа нет — `stock: null`
 */
export async function compareTextureSets(authorSet, stockSet = []) {
  const stockByName = new Map(
    stockSet.map((item) => [lowered(item.name), item]),
  );
  const rows = [];
  for (const ours of authorSet) {
    const sample = await sampleOf(ours.pixels);
    const base = stockByName.get(lowered(ours.name)) || null;
    let state = "new";
    if (base) {
      /* Другой размер — правка и при похожем содержимом: автор перевыпустил лист (256² → 4K). */
      const sameSize =
        base.pixels.width === ours.pixels.width &&
        base.pixels.height === ours.pixels.height;
      state =
        sameSize &&
        sampleDistance(sample, await sampleOf(base.pixels)) < DIFFERENT
          ? "same"
          : "changed";
    }
    rows.push({
      name: ours.name,
      state,
      blank: blankOf(sample),
      author: ours,
      stock: base,
    });
  }
  return rows;
}

/** Сравнение двух словарей по файлам: `water.ytd` автора и штатный (`null` — игры нет). */
export const compareWaterTextures = (author, stock = null) =>
  compareTextureSets(decodedSet(author), decodedSet(stock));

// ---------------------------------------------------------------- рисование

const roundedMask = (side) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${RADIUS}" fill="#fff"/></svg>`,
  );

const frameOutline = (side) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect x="1" y="1" width="${side - 2}" height="${side - 2}" rx="${RADIUS}" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"/></svg>`,
  );

const checkerBoard = (side) => {
  const cells = [];
  for (let y = 0; y * CHECKER < side; y += 1)
    for (let x = 0; x * CHECKER < side; x += 1)
      cells.push(
        `<rect x="${x * CHECKER}" y="${y * CHECKER}" width="${CHECKER}" height="${CHECKER}" fill="${CHECKER_COLOURS[(x + y) % 2]}"/>`,
      );
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">${cells.join("")}</svg>`,
  );
};

/** Стрелка «было → стало» между плитками пары: одна и та же на любом языке. */
const arrowOf = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><path d="M14 32 H48 M36 18 L50 32 L36 46" fill="none" stroke="#ffffff" stroke-opacity="0.78" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );

/** Плитка листа: по центру квадратом `side`, поверх шахматки (прозрачное видно пустым), скруглённая, с тонкой кромкой. */
async function tileOf(pixels, side, fit = "cover") {
  const picture = await sharp(pixels.data, {
    raw: { width: pixels.width, height: pixels.height, channels: 4 },
  })
    .resize(side, side, { fit, position: "centre", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const flat = await sharp(checkerBoard(side))
    .composite([{ input: picture }])
    .png()
    .toBuffer();
  const rounded = await sharp(flat)
    .composite([{ input: roundedMask(side), blend: "dest-in" }])
    .png()
    .toBuffer();
  return sharp(rounded)
    .composite([{ input: frameOutline(side) }])
    .png()
    .toBuffer();
}

/** Раскладка пар: ячейки по сетке, в каждой пара плиток одной стороны и стрелка между ними. */
export function layoutPairs(
  count,
  {
    width = WATER_COVER.width,
    height = WATER_COVER.height,
    paired = true,
  } = {},
) {
  const columns = count <= 2 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const cellWidth = (width - (columns + 1) * MARGIN) / columns;
  const cellHeight = (height - (rows + 1) * MARGIN) / rows;
  const gap = paired ? Math.min(GAP, Math.round(cellWidth * 0.1)) : 0;
  const side = Math.floor(
    Math.min(cellHeight, paired ? (cellWidth - gap) / 2 : cellWidth),
  );
  const span = paired ? side * 2 + gap : side;
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = Math.round(
      MARGIN + column * (cellWidth + MARGIN) + (cellWidth - span) / 2,
    );
    const top = Math.round(
      MARGIN + row * (cellHeight + MARGIN) + (cellHeight - side) / 2,
    );
    cells.push({ left, top, side, gap });
  }
  return cells;
}

/**
 * Обложка по сравнению: PNG `Uint8Array` и подпись, либо `null`, если показывать нечего (ни одной изменённой и новой текстуры).
 *
 * @param {Awaited<ReturnType<typeof compareWaterTextures>>} rows
 */
export async function waterTexturesPng(rows) {
  const shown = rows.filter((row) => row.state !== "same").slice(0, PAIRS_MAX);
  if (!shown.length) return null;
  const { width, height } = WATER_COVER;
  const paired = shown.some((row) => row.stock);
  const matte = workshopMatteRgba(width, height);
  const base = sharp(
    Buffer.from(matte.buffer, matte.byteOffset, matte.byteLength),
    { raw: { width, height, channels: 4 } },
  );
  const layers = [];

  if (!paired && shown.length === 1) {
    /* Сравнивать не с чем: единственный лист автора — на весь кадр, как лежит (16 : 9 у листа обложки — 16 : 9 у самой текстуры воды). */
    const only = await sharp(shown[0].author.pixels.data, {
      raw: {
        width: shown[0].author.width,
        height: shown[0].author.height,
        channels: 4,
      },
    })
      .resize(width, height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    const flat = await sharp(checkerBoard(Math.max(width, height)))
      .extract({ left: 0, top: 0, width, height })
      .composite([{ input: only }])
      .png()
      .toBuffer();
    return {
      png: new Uint8Array(await sharp(flat).png().toBuffer()),
      caption: WATER_CAPTION_AUTHOR_ONLY,
      shown: shown.length,
      paired: false,
    };
  }

  const cells = layoutPairs(shown.length, { width, height, paired });
  for (const [index, row] of shown.entries()) {
    const cell = cells[index];
    const ours = await tileOf(row.author.pixels, cell.side);
    if (row.stock) {
      layers.push({
        input: await tileOf(row.stock.pixels, cell.side),
        left: cell.left,
        top: cell.top,
      });
      const arrow = Math.min(cell.gap, 56);
      layers.push({
        input: arrowOf(arrow),
        left: cell.left + cell.side + Math.round((cell.gap - arrow) / 2),
        top: cell.top + Math.round((cell.side - arrow) / 2),
      });
      layers.push({
        input: ours,
        left: cell.left + cell.side + cell.gap,
        top: cell.top,
      });
    } else {
      /* Лист, которого в игре нет, — справа, на месте «у автора»: слева пусто, чтобы пары выровнялись. */
      layers.push({
        input: ours,
        left: cell.left + cell.side + cell.gap,
        top: cell.top,
      });
    }
  }
  const png = await base.composite(layers).png().toBuffer();
  return {
    png: new Uint8Array(png),
    caption: WATER_CAPTION,
    shown: shown.length,
    paired: true,
  };
}

/**
 * Обложка части «Вода» по её `water.ytd`: `{ png, caption, rows }` или `null` (словарь не читается или ничего не изменено).
 *
 * @param {Uint8Array} author — `water.ytd` автора
 * @param {{ stock?: Uint8Array|null }} [options] — `stock`: штатный словарь игры (`STOCK_WATER_PLACES`); без него — одна текстура автора
 */
export async function waterTexturesCover(author, { stock = null } = {}) {
  const rows = await compareWaterTextures(author, stock);
  const drawn = await waterTexturesPng(rows);
  return drawn
    ? {
        ...drawn,
        rows: rows.map(
          ({ name, state, blank, author: mine, stock: theirs }) => ({
            name,
            state,
            blank,
            author: pick(mine),
            stock: theirs ? pick(theirs) : null,
          }),
        ),
      }
    : null;
}

const pick = ({ width, height, format }) => ({ width, height, format });
