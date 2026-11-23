/*
 * Сплошные заливки фильма и их перекраска на месте (19.10.2026, остров
 * Кайо-Перико на большой карте).
 *
 * Остров рисует не картинка, а векторный фильм Scaleform: суша, дороги, дома и
 * вода ступенями глубины — это заливки фигур одного цвета. Перекрасить такой
 * фильм — значит поменять байты цвета в этих заливках: форма, число и порядок
 * фигур остаются, длина файла не меняется, и игре подсунуть нечего, кроме
 * другого оттенка. Градиентные и растровые заливки не трогаются.
 *
 * Модуль чистый: читает и пишет байты, про файловую систему и игру не знает.
 */

import { readGfx } from "./file.js";
import { isShapeTag, readShape } from "./shape.js";

const hex2 = (value) => value.toString(16).padStart(2, "0").toUpperCase();
const PAIR = /^([0-9A-F]{8})=([0-9A-F]{8})$/;

/**
 * Все сплошные заливки всех фигур файла.
 *
 * @param {Uint8Array|object} input байты `.gfx` или уже разобранный `readGfx`
 * @returns {{shapeId: number, at: number, alpha: boolean, rgba: string}[]}
 *   `at` — смещение цвета в несжатых байтах файла, `rgba` — `RRGGBBAA`
 *   (у фигур без альфы — `FF`)
 */
export function solidFills(input) {
  const gfx = input?.definitions ? input : readGfx(input);
  const found = [];
  for (const [id, tag] of gfx.definitions) {
    if (!isShapeTag(tag.code)) continue;
    let shape;
    try {
      shape = readShape(gfx.bytes, tag);
    } catch {
      continue;
    }
    for (const fill of shape.fills)
      if (fill?.type === "solid" && Number.isInteger(fill.at))
        found.push({
          shapeId: id,
          at: fill.at,
          alpha: fill.alpha === true,
          rgba: fill.color.map((value) => hex2(Math.round(value))).join(""),
        });
  }
  return found;
}

/**
 * Палитра фильма: какие цвета в заливках и сколько заливок каждого.
 *
 * @returns {{rgba: string, fills: number}[]} в порядке первого появления
 */
export function fillPalette(input) {
  const counts = new Map();
  for (const fill of solidFills(input))
    counts.set(fill.rgba, (counts.get(fill.rgba) || 0) + 1);
  return [...counts].map(([rgba, fills]) => ({ rgba, fills }));
}

/**
 * Пары «RRGGBBAA=RRGGBBAA» → таблица «было → стало». Строки не по форме
 * пропускаются, а не принимаются на веру: байты цвета пишутся по ним.
 */
export function pairTable(pairs) {
  const table = new Map();
  for (const item of Array.isArray(pairs) ? pairs : []) {
    const match = PAIR.exec(String(item || "").toUpperCase());
    if (match) table.set(match[1], match[2]);
  }
  return table;
}

/**
 * Копия файла с перекрашенными заливками.
 *
 * Заливка меняется, если её цвет (с альфой) назван в парах слева. У фигур без
 * альфы пишутся три байта цвета, у фигур с альфой — четыре; прозрачность
 * заливки остаётся прежней, если пара не просит иной.
 *
 * @param {Uint8Array|object} input байты `.gfx` или `readGfx`
 * @param {string[]|Map<string, string>} pairs
 * @returns {{bytes: Uint8Array, changed: number}} `bytes` — несжатый файл
 *   той же длины; `changed` — сколько заливок перекрашено
 */
export function recolourSolidFills(input, pairs) {
  const gfx = input?.definitions ? input : readGfx(input);
  const table = pairs instanceof Map ? pairs : pairTable(pairs);
  const bytes = Uint8Array.from(gfx.bytes);
  let changed = 0;
  if (!table.size) return { bytes, changed };
  for (const fill of solidFills(gfx)) {
    const to = table.get(fill.rgba);
    if (!to || to === fill.rgba) continue;
    for (let channel = 0; channel < (fill.alpha ? 4 : 3); channel += 1)
      bytes[fill.at + channel] = parseInt(to.slice(channel * 2, channel * 2 + 2), 16);
    changed += 1;
  }
  return { bytes, changed };
}
