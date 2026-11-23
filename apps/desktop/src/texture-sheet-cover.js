/*
 * Обложка части маппинга, где у автора одни текстуры (ENEMY V2 · graz, 14.11.2026): тринадцать словарей `majestic_veh_brand_*.ytd` — логотипы марок автомобилей — и два файла
 * частиц, ни карт, ни моделей. Строить здесь нечего (ни здания, ни интерьера), и часть оставалась с кадром обзора YouTube вместо своей картинки. Обложка — сами листы автора:
 * из каждого словаря берётся главный лист (диффузный, с «logo» в имени, а без него — самый большой, не заглушка 4×4, не карта нормалей и бликов), и они лежат сеткой в тех же пикселях, что в файлах — без
 * раскраски, без подгонки света, без рамок и надписей на картинке (подпись — под ней, `TEXTURE_SHEET_CAPTION`). Тёмный логотип кладётся на светлую плитку, светлый — на тёмную:
 * плитка нужна только затем, чтобы лист было видно, цвет самого листа она не меняет. Сборка без окна (`sharp`), как у остальных рисовальщиков частей.
 */

import sharp from "sharp";
import { decodedSet } from "./water-textures-cover.js";

export const TEXTURE_SHEET = Object.freeze({ width: 1200, height: 675 });

/** Подпись обложки (ключ словаря окна, `ui-text/zone-texture-sheet-1411.js`). */
export const TEXTURE_SHEET_CAPTION =
  "Текстуры из файлов автора, как они лежат в архиве";

/** Лист не берётся, если его сторона короче: заглушки 4×4 и мелочь. */
export const MIN_SIDE = 64;
/** Не больше стольких плиток: больше — логотипы мельче глаза. */
export const TILES_MAX = 12;
const COLUMNS_MAX = 4;
const MARGIN = 30;
const GAP = 20;
const TILE_MAX_WIDTH = 270;
const PADDING = 18;
const RADIUS = 14;
const CANVAS = "#0e0e11";
const TILE_DARK = "#17171b";
const TILE_LIGHT = "#d9d9df";
/** Карты нормалей и бликов: по суффиксу имени и по формату (`ATI2` — нормали). */
const NOT_DIFFUSE = /(?:_n|_s)(?:_[0-9a-f]{8})?$/i;
/** Лист с «logo» в имени главнее прочих: у словаря марки это знак, а не панель приборов или наклейки. */
const LOGO_NAME = /logo/i;
const NORMAL_FORMATS = /^ATI[12]$/i;
/** Лист прозрачный или одного цвета: показывать нечего. */
const BLANK_ALPHA = 8;
const BLANK_DEVIATION = 2.5;
/** Светлее этого (яркость 0…255 по непрозрачным точкам) логотип лежит на тёмной плитке. */
const LIGHT_LOGO = 110;

const SAMPLE = 48;

/** Мелкая копия листа и его вид: яркость непрозрачного, пустой ли лист. */
async function lookOf(pixels) {
  const { data } = await sharp(pixels.data, {
    raw: { width: pixels.width, height: pixels.height, channels: 4 },
  })
    .resize(SAMPLE, SAMPLE, { fit: "fill", kernel: "linear" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let alpha = 0;
  let weight = 0;
  let sum = 0;
  const light = [];
  for (let at = 0; at < data.length; at += 4) {
    const value =
      0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2];
    alpha += data[at + 3];
    light.push(value);
    sum += value * data[at + 3];
    weight += data[at + 3];
  }
  const count = Math.max(1, light.length);
  const mean = light.reduce((total, value) => total + value, 0) / count;
  const deviation = Math.sqrt(
    light.reduce((total, value) => total + (value - mean) ** 2, 0) / count,
  );
  const blank = alpha / count < BLANK_ALPHA || deviation < BLANK_DEVIATION;
  return { blank, brightness: weight ? sum / weight : mean };
}

/**
 * Главные листы словарей: `[{ file, name, width, height, pixels, brightness }]` — по одному на словарь (самый большой диффузный лист), не больше `TILES_MAX`, в порядке имён файлов.
 * @param {{ name: string, bytes: Uint8Array }[]} files словари `.ytd` части
 */
export async function mainSheets(files) {
  const chosen = [];
  const ordered = [...files].sort((left, right) =>
    String(left.name).localeCompare(String(right.name)),
  );
  for (const file of ordered) {
    if (chosen.length >= TILES_MAX) break;
    const candidates = decodedSet(file.bytes)
      .filter(
        (item) =>
          Math.min(item.width, item.height) >= MIN_SIDE &&
          !NOT_DIFFUSE.test(item.name) &&
          !NORMAL_FORMATS.test(item.format),
      )
      .sort(
        (left, right) =>
          Number(LOGO_NAME.test(right.name)) -
            Number(LOGO_NAME.test(left.name)) ||
          right.width * right.height - left.width * left.height ||
          left.name.localeCompare(right.name),
      );
    for (const item of candidates) {
      const look = await lookOf(item.pixels);
      if (look.blank) continue;
      chosen.push({
        file: file.name,
        name: item.name,
        width: item.width,
        height: item.height,
        pixels: item.pixels,
        brightness: look.brightness,
      });
      break;
    }
  }
  return chosen;
}

/** Раскладка плиток: `[{ left, top, width, height }]` — до четырёх в ряду, ряды по центру кадра. */
export function layoutTiles(count, { width, height } = TEXTURE_SHEET) {
  if (count < 1) return [];
  const columns = Math.min(COLUMNS_MAX, count);
  const rows = Math.ceil(count / columns);
  const tileWidth = Math.min(
    TILE_MAX_WIDTH,
    Math.floor((width - 2 * MARGIN - (columns - 1) * GAP) / columns),
  );
  const tileHeight = Math.min(
    Math.floor((tileWidth * 190) / 270),
    Math.floor((height - 2 * MARGIN - (rows - 1) * GAP) / rows),
  );
  const gridHeight = rows * tileHeight + (rows - 1) * GAP;
  const top = Math.floor((height - gridHeight) / 2);
  const tiles = [];
  for (let at = 0; at < count; at += 1) {
    const row = Math.floor(at / columns);
    const inRow = Math.min(columns, count - row * columns);
    const rowWidth = inRow * tileWidth + (inRow - 1) * GAP;
    tiles.push({
      left:
        Math.floor((width - rowWidth) / 2) + (at % columns) * (tileWidth + GAP),
      top: top + row * (tileHeight + GAP),
      width: tileWidth,
      height: tileHeight,
    });
  }
  return tiles;
}

const tileBackground = (width, height, colour) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${RADIUS}" fill="${colour}"/></svg>`,
  );

/** Картинка обложки по главным листам (`mainSheets`): PNG. */
export async function textureSheetPng(sheets) {
  const size = TEXTURE_SHEET;
  const layers = [];
  const places = layoutTiles(sheets.length, size);
  for (const [at, sheet] of sheets.entries()) {
    const place = places[at];
    layers.push({
      input: tileBackground(
        place.width,
        place.height,
        sheet.brightness >= LIGHT_LOGO ? TILE_DARK : TILE_LIGHT,
      ),
      left: place.left,
      top: place.top,
    });
    const logo = await sharp(sheet.pixels.data, {
      raw: {
        width: sheet.pixels.width,
        height: sheet.pixels.height,
        channels: 4,
      },
    })
      .resize(place.width - 2 * PADDING, place.height - 2 * PADDING, {
        fit: "inside",
        kernel: "lanczos3",
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({
      input: logo.data,
      left: place.left + Math.floor((place.width - logo.info.width) / 2),
      top: place.top + Math.floor((place.height - logo.info.height) / 2),
    });
  }
  return sharp({
    create: {
      width: size.width,
      height: size.height,
      channels: 3,
      background: CANVAS,
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/**
 * Обложка из текстур автора: `{ png, caption, sheets }` или `null` (в словарях нет ни одного листа, что стоит показать).
 * @param {{ name: string, bytes: Uint8Array }[]} files словари `.ytd` части
 */
export async function textureSheetCover(files) {
  const sheets = await mainSheets(files);
  if (!sheets.length) return null;
  return {
    png: await textureSheetPng(sheets),
    caption: TEXTURE_SHEET_CAPTION,
    sheets: sheets.map(
      (sheet) => `${sheet.file}: ${sheet.name} ${sheet.width}×${sheet.height}`,
    ),
  };
}
