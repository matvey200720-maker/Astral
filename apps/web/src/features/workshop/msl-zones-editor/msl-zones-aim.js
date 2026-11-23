/*
 * Щелчок по кадру МСЛ-зон (18.10.2026, Session 2, задача 2): линии какого
 * цвета мода под курсором — их облик и правит «Цвет».
 *
 * Линии рисует объект кадра, сетки сцены описи спрятаны. Чтобы по линиям
 * можно было щёлкать, объект раскладывает свою сетку по цветам мода (у
 * каждого свой облик) и каждому цвету даёт невидимую «мишень» — ту же ленту,
 * но шире (лента мода — 0,4 м: с высоты района она тоньше пикселя, и
 * попасть в неё иначе нельзя). Мишень и сетка цвета называют себя правимыми
 * (`userData.pick`, см. `mslColourPick`), кадр отдаёт это редактору в
 * `hit.pick`.
 *
 * Чистые функции и работа с массивами, без React и three.
 */

import { MSL_LIMITS, MSL_PALETTE, findMslColour, mslBandV } from "@modovik/climb-contract/recolor/msl-zones";

export const MSL_COLOUR_PICK = "msl-colour";
export const MSL_LINES_PICK = "msl-lines";

/* Шире ленты мода, но не шире, чем даёт договор (4 м): мишень ложится на ту же ленту по рельефу. */
export const MSL_PICK_WIDTH = MSL_LIMITS.width[1];
/* Инструмент, где правится облик цвета мода. */
export const MSL_AIM_TOOL = "look";

/** Что объект называет своим: корень — линии района, цвет — `{ kind, id }`. */
export const mslLinesPick = () => ({ kind: MSL_LINES_PICK });
export const mslColourPick = (colourId) => ({ kind: MSL_COLOUR_PICK, id: colourId });

/** Цвет мода под попаданием кадра: `{ colour: id }` или `null` — это не линия. */
export function mslAimTarget(hit) {
  const pick = hit?.pick;
  if (pick?.kind !== MSL_COLOUR_PICK) return null;
  const colour = findMslColour(pick.id);
  return colour ? { colour: colour.id } : null;
}

/**
 * Описание для кадра (`aimTarget`): править есть что, а подсвечивать сетки
 * нечем — линии нарисованы объектом, и подсветка у них своя. `null` — править нечего.
 */
export const mslAimSpec = (hit) => (mslAimTarget(hit) ? { none: true } : null);

/* Номер цвета мода по развёртке V вершины сетки работы: полоса цвета — `mslBandV(номер)`. */
const BAND_STEP = mslBandV(1) - mslBandV(0);
export const mslBandOf = (v) => Math.min(MSL_PALETTE.length - 1, Math.max(0, Math.round((v - mslBandV(0)) / BAND_STEP)));

/**
 * Индексы сетки работы по цветам мода: массив на цвет палитры (`null` — у
 * цвета нет ни одного треугольника). Цвет треугольника — по первой его вершине:
 * у ленты и стенки вершины одного звена делят полосу цвета.
 */
export function splitMslByColour({ indices, uvs }) {
  const lists = MSL_PALETTE.map(() => []);
  for (let at = 0; at + 2 < indices.length; at += 3) lists[mslBandOf(uvs[indices[at] * 2 + 1])].push(indices[at], indices[at + 1], indices[at + 2]);
  return lists.map((list) => (list.length ? Uint32Array.from(list) : null));
}
