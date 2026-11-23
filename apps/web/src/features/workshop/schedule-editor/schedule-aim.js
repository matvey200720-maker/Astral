/*
 * Выбор щелчком в кадре «На месте» «Расписания» (18.10.2026, Session 2,
 * задача 2): что правится под курсором на плашке табло. Без React и three.
 *
 * Плашка табло в кадре — вещь, нарисованная кодом (`schedule-art.js`), сетки
 * сцены под ней нет, поэтому кадр отдаёт `hit.pick` плашки и точку попадания
 * в метрах сцены. Точка пересчитывается в раскладку листа (те же оси, что у
 * плоского табло: `scheduleLayout` договора, 2048 точек по ширине), и по ней
 * находится место на рисунке: квадрат значка, плашка строки или заголовок.
 * Мимо них (фон щита, рамка, зазор между строками) править нечего.
 */

import { scheduleLayout } from "@modovik/climb-contract/recolor/schedule";

/** Что это за вещь кадра: `userData.pick` плашки табло. */
export const SCHEDULE_BOARD_PICK = "schedule-board";

/* Раскладка по числу строк и колонкам работы — одна на сочетание, как `sheetLayout`. */
const layouts = new Map();
function layoutOf(project) {
  const key = `${project.rows.length}|${project.columns}`;
  if (!layouts.has(key)) layouts.set(key, scheduleLayout(project));
  return layouts.get(key);
}

const inside = ([x0, y0, x1, y1], [x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Место заголовка на листе: `[x, y, ширина, высота]` — то же, что у плоского табло. */
export function headingRect(layout) {
  const heading = layout.heading;
  return [heading.x - heading.width / 2, Math.max(0, heading.y - heading.cap * 1.1), heading.width, heading.cap * 2.2];
}

/**
 * Точка попадания на плашке → точка раскладки листа или `null` (мимо плашки).
 * `pick` — `{ width, height, lift }` плашки в метрах: низ стоит на `lift`
 * над полом кадра, середина — на оси X = 0, лицо смотрит в −Y.
 */
export function boardPoint(pick, point, layout) {
  if (!pick || !point || !(pick.width > 0) || !(pick.height > 0)) return null;
  const u = (point[0] + pick.width / 2) / pick.width;
  const v = 1 - (point[2] - (pick.lift || 0)) / pick.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return [u * layout.width, v * layout.height];
}

/** Место на листе под точкой раскладки: значок, строка или заголовок; иначе `null`. */
export function scheduleSpotAt(layout, at) {
  for (const slot of layout.rows) {
    if (inside(slot.box, at)) return { kind: "icon", index: slot.index };
    if (inside(slot.plate, at)) return { kind: "row", index: slot.index };
  }
  const [x, y, w, h] = headingRect(layout);
  return inside([x, y, x + w, y + h], at) ? { kind: "title" } : null;
}

/**
 * Что открыть по попаданию: `{ tool, kind, index?, focus }` или `null`.
 * Значок строки — «Строки» на значках, плашка строки — «Строки» на названии,
 * заголовок — «Заголовок и шрифт». `project` — нормализованная работа: от неё
 * число строк и колонок, то есть и места на листе.
 */
export function scheduleAimTarget(project, hit) {
  if (hit?.pick?.kind !== SCHEDULE_BOARD_PICK) return null;
  const layout = layoutOf(project);
  const at = boardPoint(hit.pick, hit.point, layout);
  const spot = at ? scheduleSpotAt(layout, at) : null;
  if (!spot) return null;
  if (spot.kind === "title") return { tool: "title", kind: "title", focus: "title" };
  return { tool: "rows", kind: spot.kind, index: spot.index, focus: spot.kind === "icon" ? "icon" : "name" };
}

/**
 * Прямоугольник выбранного на листе `[x, y, ширина, высота]` или `null`:
 * строка — вся её плашка (со значком), заголовок — его место.
 */
export function scheduleSelectionRect(project, { tool, index = -1 }) {
  const layout = layoutOf(project);
  if (tool === "title") return headingRect(layout);
  const slot = tool === "rows" ? layout.rows[index] : null;
  return slot ? [slot.plate[0], slot.plate[1], slot.plate[2] - slot.plate[0], slot.plate[3] - slot.plate[1]] : null;
}

/** Размеры листа в точках раскладки — для перевода в метры плашки. */
export function scheduleSheetSize(project) {
  const layout = layoutOf(project);
  return { width: layout.width, height: layout.height };
}
