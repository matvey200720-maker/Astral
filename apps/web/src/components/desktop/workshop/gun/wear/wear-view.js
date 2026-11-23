/*
 * Кадр мастерской одежды: масштаб и подпись «Сохранено».
 *
 * Чистые функции, без сцены и без React: как округлить масштаб и сколько прошло с последней записи черновика. Сцена (`gun-scene.js`)
 * отдаёт масштаб в процентах «весь рост»; зум (`WearStage.jsx`) только показывает его и командует сцене. Виды «Спереди / Сзади / Сбоку»
 * убраны 31.10.2026 (владелец): камеру крутят мышью.
 */

/** Шаг колеса масштаба в «+» и «−». */
export const ZOOM_STEP = 1.25;

/** Масштаб на кнопке: целое число процентов, в разумных пределах (кадр не показывает «0 %» и «99999 %»). */
export const zoomLabel = (zoom) => Math.max(1, Math.min(9999, Math.round(Number(zoom) || 100)));

/**
 * Сколько прошло с записи черновика: `{ kind: "now" }`, `{ kind: "minutes", count }` или `{ kind: "hours", count }`.
 * До минуты — «только что»: черновик пишется после каждой правки, слово «только что» честно, пока правят.
 */
export function savedSince(savedAt, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - savedAt) / 60_000);
  if (minutes < 1) return { kind: "now", count: 0 };
  if (minutes < 60) return { kind: "minutes", count: minutes };
  return { kind: "hours", count: Math.min(99, Math.floor(minutes / 60)) };
}

