/*
 * Настройки инструментов студии (ТЗ 18.10.2026, Session 1, задача 6): одно
 * состояние на все инструменты — размер кисти не сбрасывается, когда человек
 * сходил за ластиком, а цвета «кисти» и «фона» общие. Чистые данные.
 */

import { toolOf } from "./engine/tools.js";

export const DEFAULT_OPTIONS = Object.freeze({
  tool: "brush",
  /* Вид каждого инструмента, у которого они есть. */
  kinds: Object.freeze({ marquee: "rect", lasso: "free", fill: "bucket", tone: "dodge", soften: "blur", shape: "rect" }),
  size: 48,
  hardness: 80,
  opacity: 100,
  flow: 100,
  tolerance: 32,
  contiguous: true,
  sampleAll: false,
  feather: 0,
  selectionOp: "new",
  foreground: "#ffffff",
  background: "#000000",
  amount: 50,
  range: "midtones",
  aligned: true,
  gradient: null,
  shape: Object.freeze({ fill: false, strokeWidth: 8 }),
  text: Object.freeze({ size: 96, font: "sans" }),
});

/** Настройки с видом текущего инструмента: `options.kind`. */
export function effectiveOptions(options) {
  return { ...options, kind: options.kinds[options.tool] || toolOf(options.tool).kinds[0] || "" };
}

export function patchOptions(options, patch) {
  const next = { ...options, ...patch };
  if (patch.kind !== undefined) {
    next.kinds = { ...options.kinds, [options.tool]: patch.kind };
    delete next.kind;
  }
  if (patch.tool && patch.tool !== options.tool && !toolOf(patch.tool).kinds.length) delete next.kind;
  return next;
}

export const SELECTION_OP_LABELS = Object.freeze({ new: "Новая", add: "Добавить", sub: "Вычесть", inter: "Пересечь" });
export const TONE_RANGES = Object.freeze([
  ["shadows", "Тени"],
  ["midtones", "Полутона"],
  ["highlights", "Света"],
]);
export const KIND_LABELS = Object.freeze({
  rect: "Прямоугольная",
  ellipse: "Овальная",
  free: "От руки",
  polygon: "Ломаная",
  bucket: "Ведро",
  linear: "Линейный градиент",
  radial: "Радиальный градиент",
  dodge: "Осветлитель",
  burn: "Затемнитель",
  blur: "Размытие",
  sharpen: "Резкость",
  smudge: "Палец",
  line: "Линия",
  arrow: "Стрелка",
});
