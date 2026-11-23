/*
 * Ручки воды: геометрия жестов без единого пикселя.
 *
 * Всё, что делает мышь на заливе — куда ставится стрела волны, во что
 * превращается её протяжка, как вертикальный ход руки становится уровнем, —
 * выражено здесь чистыми функциями. Причина та же, что у большой карты:
 * попадание, границы и порядок округления — места, где ошибка не видна глазом
 * на одном кадре, а тесты не умеют возить мышь по WebGL.
 *
 * Соглашение осей — сцены превью: X вправо, Z на камеру, компас волны из
 * `water-model.js` ложится в плоскость как (sin d, cos d). Ноль градусов —
 * волна бежит на +Z, к берегу у камеры; ровно так же считает `waveTrains`.
 */

import { AMPLITUDE_MAX, WATER_RANGES } from "./water-model.js";

/*
 * Якорь стрелы стоит на воде перед камерой берега, чуть левее оси взгляда:
 * справа блик солнца — класть ручку в самое яркое место кадра значило бы
 * прятать ровно то, ради чего сюда пришли.
 */
export const ARROW_ANCHOR = Object.freeze({ x: -8, z: -16 });

/*
 * Длина стрелы — это амплитуда. Минимум не ноль: у штиля стрела остаётся в
 * руке, иначе бассейн нельзя было бы разогнать обратно в шторм тем же жестом.
 */
export const ARROW_MIN_LENGTH = 4;
export const ARROW_MAX_LENGTH = 15;

/* Буй уровня — у кромки, где сдвиг воды виден по песку немедленно. */
export const BUOY_SPOT = Object.freeze({ x: 7.5, z: -10 });

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const step = (range, value) =>
  Number(
    (
      Math.round(clamp(value, range.min, range.max) / range.step) * range.step
    ).toFixed(4),
  );

/** Куда смотрит и какой длины стоит стрела при данном проекте. */
export function arrowState(project) {
  const surface = project?.surface || {};
  const radians = ((surface.direction || 0) * Math.PI) / 180;
  const share = clamp((surface.amplitude || 0) / AMPLITUDE_MAX, 0, 1);
  const length =
    ARROW_MIN_LENGTH + share * (ARROW_MAX_LENGTH - ARROW_MIN_LENGTH);
  const direction = { x: Math.sin(radians), z: Math.cos(radians) };
  return {
    radians,
    length,
    direction,
    tip: {
      x: ARROW_ANCHOR.x + direction.x * length,
      z: ARROW_ANCHOR.z + direction.z * length,
    },
  };
}

/**
 * Протяжка наконечника → правка поверхности.
 *
 * Угол от якоря — направление, расстояние — амплитуда. Оба приводятся к шагу
 * своих ползунков: гизмо и ползунок обязаны писать в проект одинаковые числа,
 * иначе после жеста ползунок показывает «0.6200000001» и выглядит сломанным.
 */
export function arrowDragPatch(point) {
  const dx = (point?.x ?? ARROW_ANCHOR.x) - ARROW_ANCHOR.x;
  const dz = (point?.z ?? ARROW_ANCHOR.z) - ARROW_ANCHOR.z;
  const distance = Math.hypot(dx, dz);
  const patch = {};
  /* У самого якоря угла нет: направление при нулевой длине — шум жеста. */
  if (distance > 0.5) {
    const degrees = (Math.atan2(dx, dz) * 180) / Math.PI;
    patch.direction = step(WATER_RANGES.direction, (degrees + 360) % 360);
  }
  const share = clamp(
    (distance - ARROW_MIN_LENGTH) / (ARROW_MAX_LENGTH - ARROW_MIN_LENGTH),
    0,
    1,
  );
  patch.amplitude = step(WATER_RANGES.amplitude, share * AMPLITUDE_MAX);
  return patch;
}

/** Вертикальный ход руки в метрах → уровень воды, зажатый в пределы игры. */
export function buoyDragLevel(startLevel, deltaY) {
  return step(WATER_RANGES.level, (startLevel || 0) + (deltaY || 0));
}

/**
 * Масштаб ручки по расстоянию до камеры: на отходе камеры ручка не должна
 * таять в точку, на подлёте — заслонять залив.
 */
export const gizmoScale = (distance) => clamp(distance / 26, 0.85, 4.5);
