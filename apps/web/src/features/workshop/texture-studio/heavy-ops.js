/*
 * Тяжёлые операции студии (ТЗ 18.10.2026, Session 1, задача 6): волшебная
 * палочка, «убрать фон», фильтры и коррекции на куске пикселей. Чистые
 * функции над буферами: их зовёт рабочий поток (`studio-worker.js`), чтобы
 * окно не подвисало на листе 8089 × 1280, а где потока нет (тесты, старое
 * окно) — само окно (`heavy.js`).
 *
 * Запрос и ответ — простые объекты с буферами: `pixels` — `Uint8ClampedArray`
 * RGBA куска, `mask` — `Uint8Array` маски того же размера (или `null`).
 */

import { applyAdjustment } from "./engine/adjust.js";
import { applyFilter } from "./engine/filters.js";
import { backgroundMask, magicWand } from "./engine/selection.js";

/** Операции по имени; каждая получает запрос и отдаёт `{ ...ответ, transfer: [буферы] }`. */
export const HEAVY_OPS = Object.freeze({
  filter({ pixels, width, height, kind, params, mask }) {
    const data = new Uint8ClampedArray(pixels);
    const selection = mask ? { width, height, data: new Uint8Array(mask) } : null;
    const known = applyFilter(data, width, height, kind, params, { mask: selection });
    return { pixels: data, known, transfer: [data.buffer] };
  },
  adjust({ pixels, width, height, kind, params, mask }) {
    const data = new Uint8ClampedArray(pixels);
    const selection = mask ? { width, height, data: new Uint8Array(mask) } : null;
    const known = applyAdjustment(data, width, height, kind, params, { mask: selection });
    return { pixels: data, known, transfer: [data.buffer] };
  },
  wand({ pixels, width, height, x, y, tolerance, contiguous }) {
    const mask = magicWand(new Uint8ClampedArray(pixels), width, height, x, y, { tolerance, contiguous });
    return { mask: mask.data, transfer: [mask.data.buffer] };
  },
  background({ pixels, width, height, tolerance, feather }) {
    const mask = backgroundMask(new Uint8ClampedArray(pixels), width, height, { tolerance, feather });
    return { mask: mask.data, transfer: [mask.data.buffer] };
  },
});

export function runHeavyOp(op, request) {
  const run = HEAVY_OPS[op];
  if (!run) throw new Error(`Тяжёлая операция студии неизвестна: ${op}.`);
  return run(request);
}
