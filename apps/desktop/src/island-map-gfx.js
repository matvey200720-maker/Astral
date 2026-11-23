/*
 * Остров Кайо-Перико: `int3232302352.gfx` (19.10.2026, задача 34).
 *
 * Радар и карту паузы на острове рисует не картинка, а фильм Scaleform из
 * одноцветных векторных фигур (`packages/vector-map/island-map.js`, откуда
 * он и как привязан к миру). Перекрасить остров — значит поменять цвет его
 * заливок: так же, как «Большая карта» красит штат, только вместо пикселей
 * плиток здесь байты цвета в фигурах. Форма, порядок и число фигур остаются,
 * длина файла не меняется (`@modovik/gfx/fills.js`).
 *
 * Основа — файл из игры самого игрока, тем же порядком доверия, что у
 * фильма карты паузы (`game-scaleform-base.js`): живой `update.rpf`, если
 * остров в нём не ставил каталог или наша же карта; иначе копия, снятая
 * Astral до первой установки; иначе проверенный ранее файл этой игры. Чужие
 * копии Rockstar в поставке не нужны, а перекрашенное повторно красить
 * нельзя.
 */

import { createHash } from "node:crypto";
import { fillPalette, readGfx, recolourSolidFills, solidFills } from "@modovik/gfx";
import { ISLAND_MAP_ENTRY, ISLAND_MAP_NAME } from "@modovik/vector-map/island";

export const ISLAND_MAP_GFX_ENTRY = ISLAND_MAP_ENTRY;

/* У штатного фильма 277 заливок; меньше полусотни — уже не он. */
const MIN_FILLS = 50;
/* Штатный фильм — сорок килобайт; два мегабайта — уже не он. */
const MAX_BYTES = 2 * 1024 * 1024;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/**
 * Проверка основы по устройству: фильм, в котором есть символ острова и сотни
 * сплошных заливок, — а не по хешу: сборок игры много.
 */
export function verifyIslandMapBase(buffer) {
  if (!Buffer.isBuffer(buffer))
    throw new TypeError("Base int3232302352.gfx must be a Buffer.");
  if (buffer.length > MAX_BYTES)
    throw new Error("int3232302352.gfx: файл больше двух мегабайт — это не фильм острова.");
  const gfx = readGfx(new Uint8Array(buffer));
  if (!gfx.exports.has(ISLAND_MAP_NAME))
    throw new Error(`int3232302352.gfx: в фильме нет символа ${ISLAND_MAP_NAME}.`);
  const fills = solidFills(gfx);
  if (fills.length < MIN_FILLS)
    throw new Error("int3232302352.gfx: в фильме слишком мало сплошных заливок для острова.");
}

/** Цвета заливок фильма: `[{ rgba, fills }]` — окно считает по ним новые. */
export function readIslandMapPalette(buffer) {
  return fillPalette(new Uint8Array(buffer));
}

/**
 * Фильм острова под проект.
 *
 * @param {Buffer} baseBuffer штатный файл из игры игрока
 * @param {object} options
 * @param {string[]} options.colours пары `RRGGBBAA=RRGGBBAA` по палитре фильма
 * @returns {{buffer: Buffer, sha256: string, changed: number, colours: number}}
 */
export function compileIslandGfx(baseBuffer, { colours = [] } = {}) {
  verifyIslandMapBase(baseBuffer);
  const { bytes, changed } = recolourSolidFills(new Uint8Array(baseBuffer), colours);
  const buffer = Buffer.from(bytes);
  return { buffer, sha256: sha256(buffer), changed, colours: colours.length };
}

/**
 * Описание основы для `resolveGameScaleformBase`: какая запись нужна, что
 * считать занятым каталогом и как проверять. Свой пакет карты живёт в том же
 * архиве, и его запись тоже считается занятой — база возьмётся из копии до
 * установки, а не из нашей же перекраски.
 */
export const ISLAND_MAP_BASE = Object.freeze({
  memory: "island-map-bases",
  files: Object.freeze([{ key: "gfx", entry: ISLAND_MAP_ENTRY, extension: "gfx" }]),
  catalogOwns: (entry) => entry === ISLAND_MAP_ENTRY.toLowerCase(),
  verify: ({ gfx }) => verifyIslandMapBase(gfx),
  memoryLabel: "проверенный ранее фильм острова этой игры",
  missing: "в архиве нет int3232302352.gfx (острова Кайо-Перико)",
  notFound:
    "Не удалось найти штатный фильм острова Кайо-Перико — в этой игре его, возможно, нет.",
});
