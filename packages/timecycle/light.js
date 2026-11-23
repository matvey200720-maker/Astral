/*
 * Свет и картинка (21.11.2026): жёсткость света, тени, высыхание луж, глубина резкости, виньетка, ветер — «реалистичные моменты» одним разделом.
 * Все ручки — общее (стиль): ложатся на все 17 типов погоды, как атмосфера, и считаются от чисел игры (множитель или явное число там, где у игры ноль).
 *
 * Что делает каждая (имена — из w_*.xml, прочитано 21.11 из чистого update.rpf):
 *   hardness        — жёсткость света: прямой свет light_dir_mult ×h, рассеянный light_directional_amb_intensity и light_natural_amb_down_intensity ×h^−0,5
 *                     (резкий полдень — тени глубже; мягкий свет — тени светлее);
 *   shadowSoftness  — мягкость краёв теней dir_shadow_softness (у игры 0…1; null — как в игре);
 *   shadowDistance  — дальность теней dir_shadow_distance_multiplier и shadow_distance_mult ×d;
 *   drying          — как быстро сохнут лужи water_drying_speed_mult ×d (меньше единицы — сохнут долго; мокрый асфальт без дождя таймциклом не включить);
 *   depthOfField    — размытие дальних планов dof_blur_mid и dof_blur_far (у игры ноль; число 0…1 — сила, смысл шкалы проверяется пачкой для стенда);
 *   vignette        — затемнение углов postfx_vignetting_intensity (у игры ноль; 0…1);
 *   wind            — ветер wind_speed_mult ×w (деревья и трава).
 * Длина теней идёт от высоты солнца (орбита), а не из таймцикла — здесь её нет.
 */

export const LIGHT_LIMITS = Object.freeze({
  hardness: Object.freeze({ min: 0.3, max: 2 }),
  shadowSoftness: Object.freeze({ min: 0, max: 1 }),
  shadowDistance: Object.freeze({ min: 0.3, max: 3 }),
  drying: Object.freeze({ min: 0.1, max: 8 }),
  depthOfField: Object.freeze({ min: 0, max: 1 }),
  vignette: Object.freeze({ min: 0, max: 1 }),
  wind: Object.freeze({ min: 0, max: 3 }),
});

const clamp = (value, { min, max }, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : fallback;
};
const optional = (value, limits) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, limits.min), limits.max) : null;
};

/** Свет и картинка «как в игре». */
export function createLight() {
  return { hardness: 1, shadowSoftness: null, shadowDistance: 1, drying: 1, depthOfField: 0, vignette: 0, wind: 1 };
}

/** В границах: не объект — null (как в игре); объект — свой, недостающее — умолчания. */
export function normalizeLight(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    hardness: clamp(raw.hardness, LIGHT_LIMITS.hardness, 1),
    shadowSoftness: optional(raw.shadowSoftness, LIGHT_LIMITS.shadowSoftness),
    shadowDistance: clamp(raw.shadowDistance, LIGHT_LIMITS.shadowDistance, 1),
    drying: clamp(raw.drying, LIGHT_LIMITS.drying, 1),
    depthOfField: clamp(raw.depthOfField, LIGHT_LIMITS.depthOfField, 0),
    vignette: clamp(raw.vignette, LIGHT_LIMITS.vignette, 0),
    wind: clamp(raw.wind, LIGHT_LIMITS.wind, 1),
  };
}

/** Ничего не меняет: null или все ручки на умолчаниях. */
export function lightIsNeutral(raw) {
  const light = normalizeLight(raw);
  return !light || JSON.stringify(light) === JSON.stringify(createLight());
}
