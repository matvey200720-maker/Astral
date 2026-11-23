/*
 * Подгонка своей модели ствола (задача 6 ТЗ 17.10.2026): масштаб, поворот и
 * сдвиг из осей `.glb` в оси модели ствола кадра (glTF модели игры: x —
 * вдоль ствола, дуло на +x, y — вверх). Одна матрица (`fitMatrix`) — и в
 * кадре (группа подгонки three.js), и в игре (сборка кусков,
 * `own-model.js`).
 *
 * Отдельный модуль без импортов: проект студии (`project.js`) хранит
 * подгонку в работе, а тянуть ради этого разбор GLB и упрощение в общий
 * кусок окна незачем.
 */

/* Сдвиг — не дальше метра от начала осей ствола (рукояти). */
export const OWN_FIT_MAX_OFFSET = 1;
export const OWN_MAGAZINE_MODES = Object.freeze(["hide", "keep"]);

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

export const OWN_FIT_STANDARD = Object.freeze({ scale: 1, rotation: Object.freeze({ x: 0, y: 0, z: 0 }), offset: Object.freeze({ x: 0, y: 0, z: 0 }) });

/** Подгонка в границах: масштаб 0,0001…1000 (единицы модели — любые), поворот ±180°, сдвиг ±1 м. */
export function normalizeOwnFit(input) {
  const angle = (value) => {
    const number = Number(value) || 0;
    const wrapped = ((((number + 180) % 360) + 360) % 360) - 180;
    return round(wrapped, 2) + 0;
  };
  const scale = Number(input?.scale);
  return {
    scale: Number.isFinite(scale) && scale > 0 ? round(clamp(scale, 0.0001, 1000), 6) : 1,
    rotation: { x: angle(input?.rotation?.x), y: angle(input?.rotation?.y), z: angle(input?.rotation?.z) },
    offset: {
      x: round(clamp(input?.offset?.x, -OWN_FIT_MAX_OFFSET, OWN_FIT_MAX_OFFSET)) + 0,
      y: round(clamp(input?.offset?.y, -OWN_FIT_MAX_OFFSET, OWN_FIT_MAX_OFFSET)) + 0,
      z: round(clamp(input?.offset?.z, -OWN_FIT_MAX_OFFSET, OWN_FIT_MAX_OFFSET)) + 0,
    },
  };
}

/** Подгонка из проекта: `null` — её нет (модель ещё не подогнана). */
export const projectOwnFit = (value) => (value && typeof value === "object" ? normalizeOwnFit(value) : null);

/** Что со штатным магазином у своей модели: `hide` (по умолчанию) или `keep`. */
export const ownMagazineMode = (value) => (value === "keep" ? "keep" : "hide");

/* Поворот по осям X·Y·Z (как у three.js с порядком «XYZ»): матрица 3×3 по строкам. */
export function rotationRows({ x, y, z }) {
  const [a, b, c] = [x, y, z].map((value) => (value * Math.PI) / 180);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cc = Math.cos(c);
  const sc = Math.sin(c);
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/** Матрица подгонки 4×4 по столбцам (как у three.js `Matrix4.elements`): сдвиг · поворот · масштаб. */
export function fitMatrix(input) {
  const fit = normalizeOwnFit(input);
  const r = rotationRows(fit.rotation);
  const s = fit.scale;
  return [
    r[0][0] * s, r[1][0] * s, r[2][0] * s, 0,
    r[0][1] * s, r[1][1] * s, r[2][1] * s, 0,
    r[0][2] * s, r[1][2] * s, r[2][2] * s, 0,
    fit.offset.x, fit.offset.y, fit.offset.z, 1,
  ];
}
