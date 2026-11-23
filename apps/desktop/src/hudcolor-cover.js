/*
 * Обложка «Цветов интерфейса» редукса (HALLOWEN 240, 13.11.2026).
 *
 * Часть — один файл `common/data/ui/hudcolor.dat`: таблица именованных цветов интерфейса игры (полосы здоровья и брони, метки
 * карты, подсветка меню). Сцены у неё нет, и кадр обзора с YouTube о ней ничего не говорит. Обложка — сами цвета: только те,
 * что автор изменил, парами «в игре → у автора», в тех же числах, что в файлах. Нарисованного «как в игре» здесь нет — это
 * таблица из двух файлов, и подпись обложки (`HUDCOLOR_CAPTION`) говорит это прямо.
 *
 * Имя цвета под парой — имя из файла без приставки `HUD_COLOUR_` (язык окна к нему отношения не имеет). Изменённых цветов
 * больше, чем помещается, — показываются самые заметные (наибольшая разница), в порядке файла. Игры нет (штатная таблица не
 * прочиталась) или автор ничего не изменил — обложки нет: сравнивать не с чем, выдумывать нечего.
 */

import sharp from "sharp";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";

export const HUDCOLOR_COVER = Object.freeze({ width: 1200, height: 800 });

/** Где в игре лежит штатная таблица: обновление главнее (его и читает игра), затем базовый архив. */
export const STOCK_HUDCOLOR_PLACES = Object.freeze([
  "update/update.rpf:common/data/ui/hudcolor.dat",
  "common.rpf:data/ui/hudcolor.dat",
]);

/** Подпись обложки (ключ словаря окна, `ui-text/zone-hudcolor-cover-1311.js`). */
export const HUDCOLOR_CAPTION =
  "Цвета интерфейса: слева из игры, справа из файла автора";

/** Больше стольких пар на обложке не помещается: 6 колонок × 4 ряда. */
const COLUMNS = 6;
const ROWS = 4;
const PAIRS_MAX = COLUMNS * ROWS;
const PREFIX = /^HUD_COLOUR_/;
/** Глубже стольких ссылок цвет на цвет таблица не ходит (в игре — одна-две). */
const LINK_DEPTH = 8;

/**
 * Таблица цветов раздела `[HD]` (его читает игра на ПК): `Map имя → { r, g, b, a }` в порядке файла. Строка-ссылка
 * (`HUD_COLOUR_X  HUD_COLOUR_Y`) получает цвет того, на кого ссылается; ссылка в никуда — пропускается.
 */
export function parseHudColours(text) {
  const direct = new Map();
  const links = new Map();
  let section = "";
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const head = /^\[([^\]]+)\]/.exec(line);
    if (head) {
      section = head[1].toUpperCase();
      continue;
    }
    if (section && section !== "HD") continue;
    const [name, link, ...rest] = line.split(/\s+/);
    if (!/^[A-Z0-9_]+$/i.test(name) || !link) continue;
    if (link.toUpperCase() === "RGBA") {
      const [r, g, b, a = 255] = rest.map(Number);
      if (
        ![r, g, b, a].every(
          (value) => Number.isInteger(value) && value >= 0 && value <= 255,
        )
      )
        continue;
      direct.set(name, { r, g, b, a });
    } else links.set(name, link);
  }
  const colours = new Map();
  const resolve = (name, depth = 0) =>
    direct.get(name) ||
    (depth < LINK_DEPTH && links.has(name)
      ? resolve(links.get(name), depth + 1)
      : null);
  for (const name of new Set([...direct.keys(), ...links.keys()])) {
    const colour = resolve(name);
    if (colour) colours.set(name, colour);
  }
  return colours;
}

const distance = (left, right) =>
  Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b),
    Math.abs(left.a - right.a),
  );

/** Что автор изменил: `[{ name, from, to, delta }]` в порядке файла автора; `from: null` — цвета в игре нет (новый). */
export function changedHudColours(author, stock) {
  const changes = [];
  for (const [name, to] of author) {
    const from = stock.get(name) || null;
    const delta = from ? distance(from, to) : 255;
    if (delta > 0) changes.push({ name, from, to, delta });
  }
  return changes;
}

const css = ({ r, g, b, a }) => `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
const escapeXml = (text) =>
  String(text).replace(
    /[<>&"]/g,
    (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char],
  );

/** SVG обложки: сетка пар «в игре → у автора», под парой — имя цвета из файла. */
export function hudColourCoverSvg(
  changes,
  { width = HUDCOLOR_COVER.width, height = HUDCOLOR_COVER.height } = {},
) {
  if (!changes.length) return null;
  /* Не помещаются — самые заметные, но в порядке файла: соседние цвета (RED, REDLIGHT, REDDARK) остаются рядом. */
  const kept =
    changes.length > PAIRS_MAX
      ? new Set(
          [...changes]
            .sort((left, right) => right.delta - left.delta)
            .slice(0, PAIRS_MAX),
        )
      : null;
  const shown = kept ? changes.filter((change) => kept.has(change)) : changes;
  /* Колонок не больше, чем пар: одна-две изменённые пары стоят по центру кадра и крупно, а не в углу пустой сетки. */
  const columns = Math.min(
    COLUMNS,
    shown.length,
    Math.max(1, Math.ceil(Math.sqrt(shown.length * 1.5))),
  );
  const rows = Math.ceil(shown.length / columns);
  const margin = 56;
  const cellWidth = (width - margin * 2) / columns;
  const cellHeight = Math.min(
    rows <= 2 ? 360 : 220,
    (height - margin * 2) / rows,
  );
  const top = (height - cellHeight * rows) / 2;
  const swatch = Math.min(cellWidth * 0.34, cellHeight * 0.52);
  const gap = swatch * 0.36;
  const label = Math.max(11, Math.min(26, cellWidth / 13, swatch / 7));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];
  /* Шахматка под полупрозрачным цветом: прозрачность — тоже правка автора, на чёрном поле её не видно. */
  parts.push(
    '<defs><pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#3a3a3f"/><rect width="8" height="8" fill="#4b4b51"/><rect x="8" y="8" width="8" height="8" fill="#4b4b51"/></pattern></defs>',
  );
  const square = (x, y, colour) => {
    const radius = (swatch * 0.16).toFixed(1);
    const box = `x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${swatch.toFixed(1)}" height="${swatch.toFixed(1)}" rx="${radius}"`;
    if (!colour)
      return `<rect ${box} fill="none" stroke="#5a5a60" stroke-width="2" stroke-dasharray="6 6"/>`;
    return `${colour.a < 255 ? `<rect ${box} fill="url(#checker)"/>` : ""}<rect ${box} fill="${css(colour)}" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>`;
  };
  shown.forEach((change, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centre = margin + cellWidth * (column + 0.5);
    const y = top + cellHeight * row + (cellHeight - swatch - label * 2.2) / 2;
    const left = centre - gap / 2 - swatch;
    const right = centre + gap / 2;
    const middle = y + swatch / 2;
    parts.push(square(left, y, change.from), square(right, y, change.to));
    const tip = centre + gap * 0.26;
    parts.push(
      `<path d="M ${(centre - gap * 0.26).toFixed(1)} ${middle.toFixed(1)} H ${tip.toFixed(1)} M ${(tip - gap * 0.16).toFixed(1)} ${(middle - gap * 0.16).toFixed(1)} L ${tip.toFixed(1)} ${middle.toFixed(1)} L ${(tip - gap * 0.16).toFixed(1)} ${(middle + gap * 0.16).toFixed(1)}" fill="none" stroke="#b9b9c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    const name = change.name.replace(PREFIX, "").replace(/_/g, " ");
    parts.push(
      `<text x="${centre.toFixed(1)}" y="${(y + swatch + label * 1.7).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" font-size="${label.toFixed(1)}" font-weight="600" fill="#d8d8de" text-anchor="middle">${escapeXml(name.length > 22 ? `${name.slice(0, 21)}…` : name)}</text>`,
    );
  });
  parts.push("</svg>");
  return parts.join("");
}

/**
 * Обложка по файлу автора и штатной таблице игры: `{ png, caption, changes }` или `null` (штатной таблицы нет, автор
 * ничего не изменил, файл не читается).
 */
export async function hudColourCover(
  authorBytes,
  {
    stock = null,
    width = HUDCOLOR_COVER.width,
    height = HUDCOLOR_COVER.height,
  } = {},
) {
  if (!authorBytes?.length || !stock?.length) return null;
  const decode = (bytes) => new TextDecoder("utf-8").decode(bytes);
  const changes = changedHudColours(
    parseHudColours(decode(authorBytes)),
    parseHudColours(decode(stock)),
  );
  const svg = hudColourCoverSvg(changes, { width, height });
  if (svg === null) return null;
  const field = workshopMatteRgba(width, height);
  const png = await sharp(Buffer.from(field.buffer), {
    raw: { width, height, channels: 4 },
  })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  return { png: new Uint8Array(png), caption: HUDCOLOR_CAPTION, changes };
}
