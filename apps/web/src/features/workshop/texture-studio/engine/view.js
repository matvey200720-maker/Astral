/*
 * Вид холста студии (ТЗ 18.10.2026, Session 1, задача 6): масштаб и сдвиг,
 * «вписать», приближение к точке под курсором, пересчёт точек экрана в точки
 * холста и обратно. Чистая арифметика: окно рисует и слушает мышь, а считает
 * здесь — тест проверяет ту же математику.
 *
 * Вид — `{ zoom, x, y }`: `zoom` — пикселей экрана на пиксель холста, `(x, y)`
 * — где на экране левый верхний угол холста.
 */

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 32;
/* Ступени масштаба для «+/−» и колеса. */
export const ZOOM_STEPS = Object.freeze([0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32]);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Масштаб, при котором холст `doc` целиком влезает в окно `box` с полем `margin` px (не крупнее 1 — «вписать» не растягивает). */
export function fitZoom(doc, box, margin = 24) {
  const room = { width: Math.max(1, box.width - margin * 2), height: Math.max(1, box.height - margin * 2) };
  return clamp(Math.min(room.width / doc.width, room.height / doc.height), ZOOM_MIN, 1);
}

/** Вид «вписать»: холст по центру окна. */
export function fitView(doc, box, margin = 24) {
  const zoom = fitZoom(doc, box, margin);
  return { zoom, x: (box.width - doc.width * zoom) / 2, y: (box.height - doc.height * zoom) / 2 };
}

/** Вид «100 %»: холст по центру окна. */
export function actualView(doc, box) {
  return { zoom: 1, x: (box.width - doc.width) / 2, y: (box.height - doc.height) / 2 };
}

/** Точка окна → точка холста. */
export const toDocument = (view, point) => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom });

/** Точка холста → точка окна. */
export const toScreen = (view, point) => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y });

/** Приблизить к `zoom` так, чтобы точка окна `around` осталась на месте. */
export function zoomAt(view, zoom, around) {
  const next = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const scale = next / view.zoom;
  return { zoom: next, x: around.x - (around.x - view.x) * scale, y: around.y - (around.y - view.y) * scale };
}

/** Следующая ступень масштаба (`direction` +1 ближе, −1 дальше). */
export function stepZoom(zoom, direction) {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom * 1.001) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom / 1.001) ?? ZOOM_MIN;
}

/** Сдвиг вида не уводит холст за окно целиком: от холста остаётся не меньше `keep` px по каждой оси. */
export function clampView(view, doc, box, keep = 80) {
  const width = doc.width * view.zoom;
  const height = doc.height * view.zoom;
  return {
    zoom: view.zoom,
    x: clamp(view.x, keep - width, box.width - keep),
    y: clamp(view.y, keep - height, box.height - keep),
  };
}

/** Вид, в который влезает прямоугольник холста `rect` (рамка «Масштаба»). */
export function viewOfRect(rect, box, margin = 16) {
  const zoom = clamp(Math.min((box.width - margin * 2) / Math.max(1, rect.width), (box.height - margin * 2) / Math.max(1, rect.height)), ZOOM_MIN, ZOOM_MAX);
  return { zoom, x: box.width / 2 - (rect.x + rect.width / 2) * zoom, y: box.height / 2 - (rect.y + rect.height / 2) * zoom };
}

/** Прямоугольник холста, что видно в окне `box`: `{ x, y, width, height }` (может выходить за холст). */
export function visibleRect(view, box) {
  return { x: -view.x / view.zoom, y: -view.y / view.zoom, width: box.width / view.zoom, height: box.height / view.zoom };
}

/** Подпись масштаба: «17 %», «100 %», «1600 %». */
export const zoomText = (zoom) => `${zoom < 0.1 ? (zoom * 100).toFixed(1).replace(/\.0$/, "") : Math.round(zoom * 100)} %`;
