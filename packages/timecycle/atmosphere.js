/*
 * Атмосфера: туман, дымка, лучи света, видимость (21.11.2026, слово владельца: «атмосферный туман… настроить, как он раскладывается… нереальная погода и видимость»).
 *
 * Что у игры есть на самом деле (прочитано из w_*.xml, одни и те же имена в каждом из 17 типов погоды):
 *   - туман высотный: плотность на метр fog_density · 1e-4 · e^(−fog_falloff/1000 · (высота − fog_base_height)), начинается с fog_start;
 *     fog_falloff = 0 гасит туман вовсе (замер 06.10), поэтому «высоту слоя» никогда не доводим до нуля;
 *   - цвета: fog_col, fog_near_col, fog_east_col (у солнца), fog_haze_col (дымка вдали); яркость по часам идёт из файла (fog_hdr);
 *   - дымка вдали: fog_haze_density (ложится на фон за дальней плоскостью);
 *   - лучи: fogray_intensity, light_ray_mult (лучи солнца сквозь воздух);
 *   - свет фонарей и фар в тумане: fog_volume_light_intensity, fogvolume_density_scalar (днём у игры ноль: объёмный свет считается только в сумерках и ночью).
 * Настоящего объёмного тумана (как у GTA 6), тумана по районам и тумана, который двигает ветер, у игры нет.
 *
 * Видимость — расстояние, на котором мир растворяется в тумане. Из закона e^(−плотность · путь): остаётся десятая часть на пути 2,3 / плотность,
 * так что visibility метров соответствуют плотности 23000 / (visibility − fog_start) (у игры FOGGY — 70…120, то есть 190…330 м).
 *
 * Вид один на все 17 типов погоды (как «стиль» вида: ложится на любую погоду, в том числе серверную поверх хамелеона).
 * Одно число — одна ручка; «как в игре» — значение по умолчанию или null.
 * Подробный уровень (поле `detail`: слой тумана, тени, лучи, объёмный свет, дальность прорисовки) — таблицей в `atmosphere-detail.js`.
 */

import { normalizeAtmosphereDetail } from "./atmosphere-detail.js";

export const ATMOSPHERE_LIMITS = Object.freeze({
  /* Во сколько раз плотнее (и дымка вдали) игры. 0 — без тумана. */
  density: Object.freeze({ min: 0, max: 6 }),
  /* Расстояние, на котором остаётся десятая часть мира, метры; переопределяет плотность игры по всем часам. */
  visibility: Object.freeze({ min: 40, max: 10000 }),
  /* С какого расстояния начинается туман, метры. */
  start: Object.freeze({ min: 0, max: 3000 }),
  /* Высота слоя: больше единицы — туман выше и стоит стеной, меньше — стелется по земле. */
  height: Object.freeze({ min: 0.1, max: 4 }),
  /* Высота дна слоя, метры над нулём карты. */
  baseHeight: Object.freeze({ min: -100, max: 1000 }),
  haze: Object.freeze({ min: 0, max: 4 }),
  rays: Object.freeze({ min: 0, max: 4 }),
  lamps: Object.freeze({ min: 0, max: 6 }),
});

const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (value, { min, max }, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : fallback;
};
const optional = (value, limits) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, limits.min), limits.max) : null;
};
const hexOrNull = (value) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : null);

/** Атмосфера «как в игре»: ничего не меняет. */
export function createAtmosphere() {
  return {
    density: 1,
    visibility: null,
    start: null,
    height: 1,
    baseHeight: null,
    colour: null,
    nightColour: null,
    horizonColour: null,
    haze: 1,
    rays: 1,
    lamps: 1,
    /* Подробный уровень (`atmosphere-detail.js`): пункт → значение; пусто — как в игре. */
    detail: {},
  };
}

/** Атмосфера в границах: не объект — null (как в игре); любой объект — своя, недостающее — умолчания. */
export function normalizeAtmosphere(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    density: clamp(raw.density, ATMOSPHERE_LIMITS.density, 1),
    visibility: optional(raw.visibility, ATMOSPHERE_LIMITS.visibility),
    start: optional(raw.start, ATMOSPHERE_LIMITS.start),
    height: clamp(raw.height, ATMOSPHERE_LIMITS.height, 1),
    baseHeight: optional(raw.baseHeight, ATMOSPHERE_LIMITS.baseHeight),
    colour: hexOrNull(raw.colour),
    nightColour: hexOrNull(raw.nightColour),
    horizonColour: hexOrNull(raw.horizonColour),
    haze: clamp(raw.haze, ATMOSPHERE_LIMITS.haze, 1),
    rays: clamp(raw.rays, ATMOSPHERE_LIMITS.rays, 1),
    lamps: clamp(raw.lamps, ATMOSPHERE_LIMITS.lamps, 1),
    detail: normalizeAtmosphereDetail(raw.detail),
  };
}

/** Ничего не меняет: null или все ручки на умолчаниях. */
export function atmosphereIsNeutral(raw) {
  const atmosphere = normalizeAtmosphere(raw);
  if (!atmosphere) return true;
  return JSON.stringify(atmosphere) === JSON.stringify(createAtmosphere());
}

/** Плотность fog_density, при которой мир на visibility метров растворяется до десятой части (туман начинается с start). */
export function densityForVisibility(visibility, start = 0) {
  return 23000 / Math.max(20, Number(visibility) - Number(start || 0));
}

/** Видимость в метрах при плотности density с начала тумана start (обратное к densityForVisibility). */
export function visibilityForDensity(density, start = 0) {
  return Number(start || 0) + (density > 0 ? 23000 / density : Infinity);
}
