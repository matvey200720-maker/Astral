/*
 * Расчёт выстрела трассера (задача 4А, 18.10.2026): когда игра ставит след — чистая функция, проверяется
 * тестами. Путь пули и кадр «Объёмный» убраны (22.10.2026): трассеры показывает один ролик из игры; штрихи
 * по кадрам игры рисует выстрел килла и попаданий (`combat-shot-fx.js`).
 *
 * Игра ставит след не одним спрайтом, а по экземпляру правила на каждый свой
 * кадр: от точки, где пуля была в прошлом кадре, к точке, где она за кадр
 * оказалась. На 60 к/с штрихи стоят далеко друг от друга, на 187 — втрое чаще.
 */

import { add, length, normalize, scale, sub } from "./combat-layout.js";

/**
 * Штрихи следа вдоль пути: по одному на кадр игры.
 *
 * @param {object} options
 * @param {number[]} options.from — откуда вылетела пуля
 * @param {number[]} options.direction — единичное направление
 * @param {number} options.reach — расстояние до стены, м
 * @param {number} options.speed — скорость пули, м/с
 * @param {number} options.fps — кадров игры в секунду
 * @returns {Array<{ at: number, origin: number[], direction: number[], length: number }>}
 *   `at` — секунд после выстрела, когда игра ставит штрих; `origin` —
 *   начало отрезка, `length` — его длина
 */
export function tracerSegments({ from, direction, reach, speed, fps }) {
  if (!(reach > 0) || !(speed > 0) || !(fps > 0)) return [];
  const step = speed / fps;
  const segments = [];
  let previous = from;
  for (let frame = 1; frame < 10000; frame += 1) {
    const travelled = Math.min(step * frame, reach);
    const next = add(from, scale(direction, travelled));
    const segment = sub(next, previous);
    const span = length(segment);
    if (span > 1e-4) segments.push({ at: frame / fps, origin: previous, direction: normalize(segment), length: span });
    previous = next;
    if (travelled >= reach) break;
  }
  return segments;
}

/* Больше стольких штрихов на один выстрел не ставим: след длиной в десятки метров из коротких штрихов рассыпается пунктиром. */
export const MAX_TRACER_STROKES = 20;

/**
 * Штрихи авторского следа встык от дула до цели (предпросмотр на кадре игры, `docs/fx-scenes.md` §6а).
 *
 * Игра ставит штрих по кадру, а пуля пролетает за кадр десятки метров: на коротком пути (стенд — 3–30 м) получается один штрих длиной со слот
 * (до 6 м) с центром у дула — половина его за спиной стрелка, а до цели след не дотягивается. Здесь путь `0…reach` делится на `ceil(reach / length)`
 * равных штрихов, каждый не длиннее слота автора: след идёт от дула ровно до цели, не торча за дулом и не уходя за цель. Короче одного слота — один
 * штрих по длине пути. Когда штрихов вышло бы больше `MAX_TRACER_STROKES` (след 0,3 м на 30 м), они остаются своей длины и стоят через равные промежутки.
 * Время штриха — кадр игры, в который пуля доходит до его начала.
 *
 * @param {object} options
 * @param {number[]} options.from — дуло
 * @param {number[]} options.direction — единичное направление пули
 * @param {number} options.reach — расстояние до цели, м
 * @param {number} options.length — длина штриха слота автора, м
 * @param {number} options.speed — скорость пули, м/с
 * @param {number} options.fps — кадров игры в секунду
 * @returns {Array<{ at: number, origin: number[], direction: number[], length: number, start: number }>}
 *   `origin` — середина штриха (спрайт слота стоит центром на точке), `start` — расстояние от дула до его начала
 */
export function tracerStrokes({ from, direction, reach, length, speed, fps }) {
  if (!(reach > 0) || !(length > 0) || !(speed > 0) || !(fps > 0)) return [];
  const step = speed / fps;
  const tiled = Math.ceil(reach / length - 1e-9);
  const count = Math.min(tiled, MAX_TRACER_STROKES);
  const pitch = reach / count;
  const stroke = tiled > MAX_TRACER_STROKES ? length : pitch;
  const strokes = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * pitch;
    strokes.push({
      at: Math.max(1, Math.ceil(start / step - 1e-9)) / fps,
      origin: add(from, scale(direction, start + stroke / 2)),
      direction,
      length: stroke,
      start,
    });
  }
  return strokes;
}
