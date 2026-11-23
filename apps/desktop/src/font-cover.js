/*
 * Обложка «Шрифта» редукса (13.11.2026).
 *
 * Часть — одна библиотека шрифтов Scaleform (`font_lib_efigs_pc.gfx`): девять шрифтов игры (`$Font2`, `$Font2_cond`, `$gtaCash`, `$Font5` …) с их глифами. Сцены у неё нет, и кадр обзора с YouTube о ней
 * ничего не говорит. Обложка — сами глифы: строки-образцы (латиница, цифры, кириллица), набранные контурами из файла автора, без системных шрифтов окна и без надписей поверх: слова на картинке — это
 * глифы автора. Нарисованного «как в игре» здесь нет — это образец набора, и подпись обложки (`FONT_CAPTIONS`) говорит это прямо.
 *
 *   • у части в файле автора другие шрифты, чем в игре, — обложка парами «слева из игры, справа из файла автора», только изменённые шрифты (отличие — по контурам, ширинам и кернингу);
 *   • игры нет (штатная библиотека не прочиталась) — образцы одного файла автора, без пары;
 *   • файл автора байт в байт тот же, что в игре, — образцы того же файла, а подпись говорит, что шрифты совпадают с игровыми: «ничего не изменено» — тоже сведение.
 *
 * Поле — чёрное матовое, как у остальных обложек мастерской (`workshop-matte.js`), без рамок и обводок. Сборка без окна (`sharp`), как у `hudcolor-cover.js`.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import { listGfxFonts } from "@modovik/gfx/fonts";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";

export const FONT_COVER = Object.freeze({ width: 1200, height: 800 });

/** Где в игре лежит штатная библиотека: обновление главнее (его и читает игра). */
export const STOCK_FONT_PLACES = Object.freeze([
  "update/update.rpf:x64/data/cdimages/scaleform_platform_pc.rpf/font_lib_efigs_pc.gfx",
]);

/** Подписи обложки (ключи словаря окна, `ui-text/zone-font-cover-1311.js`). */
export const FONT_CAPTIONS = Object.freeze({
  pair: "Шрифты: слева из игры, справа из файла автора — образец набран их глифами",
  author: "Шрифты из файла автора — образец набран его глифами",
  same: "Шрифты в файле автора те же, что в игре — образец набран глифами файла",
});

/** Шрифты для образцов по порядку предпочтения (имена экспорта игры): основной, узкий, «деньги», рукописный, фирменный, таблица. */
const PREFERRED = Object.freeze([
  "$Font2",
  "$Font2_cond",
  "$gtaCash",
  "$Font5",
  "$RockstarTAG",
  "$GTAVLeaderboard",
]);
/** Шрифту нужно не меньше стольких латинских букв, чтобы по нему делать образец (у служебных — шесть-сорок). */
const MIN_LATIN = 40;
/** Образцы шрифта: латиница с цифрами и кириллица — по строке. */
export const SAMPLE_LINES = Object.freeze([
  "Los Santos  0123456789",
  "Лос-Сантос  Ёё",
]);
/** Колонка пары уже кадра: у одного шрифта в паре строки короче и крупнее — четыре строки (латиница, прописные и строчные, цифры, кириллица), иначе середина кадра остаётся пустой. */
export const SAMPLE_LINES_NARROW = Object.freeze([
  "Los Santos",
  "ABC  abc",
  "0123456789",
  "Лос-Сантос  Ёё",
]);
/** Пара из одного шрифта снимается короткими строками. */
const NARROW_ROWS = 2;
/** Шрифтов на обложке не больше. */
const FONTS_MAX = 4;
const MARGIN = 56;
const COLUMN_GAP = 40;
const INK = "#ececf2";

const lowered = (value) => String(value || "").toLowerCase();

/** Шрифты библиотеки: `[{ id, name, exports, font }]`; не читается — пусто. */
export function readFonts(bytes) {
  try {
    return bytes?.length ? listGfxFonts(bytes) : [];
  } catch {
    return [];
  }
}

const latinCount = (font) =>
  font.glyphs.filter(
    (glyph) =>
      (glyph.code >= 0x41 && glyph.code <= 0x5a) ||
      (glyph.code >= 0x61 && glyph.code <= 0x7a),
  ).length;

/** Отпечаток шрифта: глифы (код, ширина, контуры) и кернинг. Одинаковые шрифты — одинаковый отпечаток. */
export function fontPrint(font) {
  const glyphs = [...font.glyphs]
    .sort((left, right) => left.code - right.code)
    .map((glyph) => [glyph.code, glyph.advance, glyph.contours]);
  const kerning = [...font.kerning]
    .sort((left, right) => left.a - right.a || left.b - right.b)
    .map((pair) => [pair.a, pair.b, pair.advance]);
  return createHash("sha1")
    .update(
      JSON.stringify([
        font.nominal,
        font.ascent,
        font.descent,
        glyphs,
        kerning,
      ]),
    )
    .digest("hex");
}

const keyOf = (entry) => lowered(entry.exports[0] || entry.name);

/** Порядок образцов: сначала шрифты игры по `PREFERRED`, затем остальные с достаточным числом латинских букв. */
function orderOf(entries) {
  const usable = entries.filter((entry) => latinCount(entry.font) >= MIN_LATIN);
  const rank = (entry) => {
    const at = PREFERRED.findIndex((name) =>
      entry.exports.some((one) => lowered(one) === lowered(name)),
    );
    return at < 0 ? PREFERRED.length : at;
  };
  return [...usable].sort(
    (left, right) => rank(left) - rank(right) || left.id - right.id,
  );
}

/**
 * Какие шрифты образцов и в каком режиме. `author` и `stock` — `readFonts`. Ответ — `{ mode, rows: [{ author, stock? }] }`: режим `pair` — изменённые шрифты с их штатными парами, `same` — файл не отличается от штатного
 * (образцы автора), `author` — штатной библиотеки нет. Пусто (`rows: []`), если у автора нечего показать.
 */
export function pickSamples(author, stock = []) {
  const ordered = orderOf(author);
  if (!ordered.length) return { mode: "author", rows: [] };
  if (!stock.length)
    return {
      mode: "author",
      rows: ordered.slice(0, FONTS_MAX).map((entry) => ({ author: entry })),
    };
  const stockBy = new Map(stock.map((entry) => [keyOf(entry), entry]));
  const changed = ordered.filter((entry) => {
    const pair = stockBy.get(keyOf(entry));
    return !pair || fontPrint(pair.font) !== fontPrint(entry.font);
  });
  if (!changed.length)
    return {
      mode: "same",
      rows: ordered.slice(0, FONTS_MAX).map((entry) => ({ author: entry })),
    };
  return {
    mode: "pair",
    rows: changed.slice(0, FONTS_MAX).map((entry) => ({
      author: entry,
      stock: stockBy.get(keyOf(entry)) || null,
    })),
  };
}

/** Контуры глифа в путь SVG: оси шрифта (Y вниз, базовая линия — ноль), масштаб и сдвиг по иксу. */
export function glyphPath(glyph, scale, originX, baseline) {
  const at = (x, y) =>
    `${(originX + x * scale).toFixed(1)} ${(baseline + y * scale).toFixed(1)}`;
  const parts = [];
  for (const contour of glyph.contours) {
    parts.push(`M${at(contour.start.x, contour.start.y)}`);
    for (const segment of contour.segments)
      parts.push(
        "cx" in segment
          ? `Q${at(segment.cx, segment.cy)} ${at(segment.x, segment.y)}`
          : `L${at(segment.x, segment.y)}`,
      );
    parts.push("Z");
  }
  return parts.join("");
}

/** Строка шрифтом: `{ glyphs: [{ glyph, x }], width }` в единицах шрифта. Нет глифа — знака нет (пробел — треть кегля); пара с кернингом сдвигает следующий знак. */
export function layoutLine(font, text) {
  const byCode = new Map(font.glyphs.map((glyph) => [glyph.code, glyph]));
  const kerning = new Map(
    font.kerning.map((pair) => [`${pair.a},${pair.b}`, pair.advance]),
  );
  const placed = [];
  let x = 0;
  let previous = null;
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0);
    const glyph = byCode.get(code);
    if (!glyph && char !== " ") continue;
    if (previous !== null) x += kerning.get(`${previous},${code}`) || 0;
    if (glyph) {
      placed.push({ glyph, x });
      x += glyph.advance;
    } else {
      x += font.nominal / 3;
    }
    previous = code;
  }
  return { glyphs: placed, width: x };
}

/** Строки образца для кадра: короткие — у пары из одного-двух шрифтов, иначе длинные. */
export const sampleLinesFor = (paired, rows) =>
  paired && rows <= NARROW_ROWS ? SAMPLE_LINES_NARROW : SAMPLE_LINES;

/** Одна колонка образцов шрифта: строки, вписанные в `box = { x, y, width, height }`. Кегль — по самой широкой строке и по высоте колонки. */
function columnSvg(font, box, texts, align = "middle") {
  const lines = texts.map((text) => layoutLine(font, text));
  const widest = Math.max(...lines.map((line) => line.width), 1);
  const lineCell = box.height / lines.length;
  const size = Math.min(
    box.width / widest,
    (lineCell * 0.86) / (font.ascent + font.descent),
  );
  const paths = [];
  lines.forEach((line, index) => {
    const baseline =
      box.y +
      lineCell * index +
      lineCell / 2 +
      ((font.ascent - font.descent) / 2) * size;
    const slack = box.width - line.width * size;
    const originX =
      box.x + (align === "end" ? slack : align === "start" ? 0 : slack / 2);
    for (const { glyph, x } of line.glyphs) {
      const d = glyphPath(glyph, size, originX + x * size, baseline);
      if (d) paths.push(`<path d="${d}" fill="${INK}" fill-rule="evenodd"/>`);
    }
  });
  return paths.join("");
}

/** Кадр обложки SVG: ряды шрифтов; в паре — две колонки (игра слева, автор справа): текст пары прижат к общему шву, середина кадра занята, а не пуста. */
export function fontCoverSvg(
  selection,
  { width = FONT_COVER.width, height = FONT_COVER.height } = {},
) {
  const { mode, rows } = selection;
  if (!rows.length) return null;
  const paired = mode === "pair";
  const rowHeight = (height - MARGIN * 2) / rows.length;
  const columnWidth = paired
    ? (width - MARGIN * 2 - COLUMN_GAP) / 2
    : width - MARGIN * 2;
  const texts = sampleLinesFor(paired, rows.length);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];
  rows.forEach((row, index) => {
    const y = MARGIN + rowHeight * index;
    const cell = (column) => ({
      x: MARGIN + column * (columnWidth + COLUMN_GAP),
      y: y + rowHeight * 0.06,
      width: columnWidth,
      height: rowHeight * 0.88,
    });
    if (paired) {
      if (row.stock)
        parts.push(columnSvg(row.stock.font, cell(0), texts, "end"));
      parts.push(columnSvg(row.author.font, cell(1), texts, "start"));
    } else {
      parts.push(columnSvg(row.author.font, cell(0), texts));
    }
  });
  parts.push("</svg>");
  return parts.join("");
}

/**
 * Обложка по файлу автора и штатной библиотеке игры: `{ png, caption, mode, fonts }` или `null` (файл не читается как библиотека шрифтов или в нём нет шрифта с латиницей). Штатной библиотеки нет (`stock` пусто) —
 * образцы одного файла автора.
 */
export async function fontCover(
  authorBytes,
  { stock = null, width = FONT_COVER.width, height = FONT_COVER.height } = {},
) {
  const author = readFonts(authorBytes);
  const selection = pickSamples(author, readFonts(stock));
  const svg = fontCoverSvg(selection, { width, height });
  if (svg === null) return null;
  const field = workshopMatteRgba(width, height);
  const png = await sharp(Buffer.from(field.buffer), {
    raw: { width, height, channels: 4 },
  })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  return {
    png: new Uint8Array(png),
    caption: FONT_CAPTIONS[selection.mode],
    mode: selection.mode,
    fonts: selection.rows.map(
      (row) => row.author.exports[0] || row.author.name,
    ),
  };
}
