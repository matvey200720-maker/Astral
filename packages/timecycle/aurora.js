/*
 * Северное сияние, ступень А (21.11.2026): мягкая цветная полоса света на ночном небе — таймциклом, без моделей.
 *
 * Что это и чем не является. Небо игры у горизонта красят три цвета: восточный, западный и «переходный» (sky_azimuth_transition_col с положением
 * sky_azimuth_transition_position — на какой высоте от горизонта лежит полоса). Ночью они почти чёрные. Сияние здесь — это переходный цвет ночных
 * срезов, поднятый до цвета сияния нужной яркости, и положение полосы по высоте: мягкая полоса света над горизонтом, а не лента-занавес.
 * Занавес с лучами и движением — моделью в мире (ступень 5 плана, новая команда движка). Яркость и высоту подбирают глазом: шкала sky_azimuth_* в игре
 * не измерена, поэтому значения здесь — умолчания, а проверка — «атмосфера-пачка» и кадры стенда.
 * Ложится на ночные срезы (и на все часы вечной ночи); днём небо игры не трогается.
 */

/*
 * Северное сияние возвращено (22.11.2026, проба сияния на стенде: вариант Б принят — мягкое зелёное свечение неба, сильнее к западу, плавно гаснет вверх, ночь остаётся ночью). Первый вариант
 * (переходный цвет sky_azimuth_transition) глазу не был виден, поэтому сияние красит ЦВЕТА ГОРИЗОНТА (sky_azimuth_east_col и sky_azimuth_west_col). Другие механизмы остались в модели для проб
 * (`mode`: transition — узкая полоса над домами, читается как зарево города; zenith — красит облака плоской ядовитой краской, брак). Ложится только на ясные погоды (`AURORA_WEATHERS`).
 * Занавес с лучами — моделью в мире, после альфы (SKY-LIVE-PLAN-2111).
 */
export const AURORA_AVAILABLE = true;

/* Типы погоды, на которые сияние ложится (ясное небо): на облачной, дождливой и зимней погоде его нет — на облаках зелёное ложится плоской краской (вариант В пробы). */
export const AURORA_WEATHERS = Object.freeze(["EXTRASUNNY", "CLEAR", "CLEARING"]);

/* Чем красим небо (проба 22.11.2026: пояс от переходного цвета глазу не виден): переходный цвет, цвета горизонта (восток и запад) или переходный цвет у зенита. */
export const AURORA_MODES = Object.freeze(["transition", "horizon", "zenith"]);

export const AURORA_LIMITS = Object.freeze({
  /* Ночной sky_hdr поднимается до этого числа в срезах с сиянием (у игры 0,2…2): множитель яркости всего неба. */
  hdr: Object.freeze({ min: 0, max: 6 }),
  /* Яркость сияния: 0 — едва видно, 3 — полнеба. */
  brightness: Object.freeze({ min: 0, max: 3 }),
  /* Высота полосы над горизонтом: 0 — у самого горизонта, 1 — высоко. */
  height: Object.freeze({ min: 0, max: 1 }),
});

const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (value, { min, max }, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : fallback;
};

/** Сияние выключено: объекта нет. Включённое — цвет, яркость, высота (умолчание — зелёное, среднее). */
export function createAurora() {
  return { colour: "#35e08a", brightness: 2.2, height: 0.35, mode: "horizon", hdr: 0.4 };
}

/** В границах: не объект — null (сияния нет); объект — своё, недостающее — умолчания. */
export function normalizeAurora(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const base = createAurora();
  return {
    colour: typeof raw.colour === "string" && HEX.test(raw.colour) ? raw.colour.toLowerCase() : base.colour,
    brightness: clamp(raw.brightness, AURORA_LIMITS.brightness, base.brightness),
    height: clamp(raw.height, AURORA_LIMITS.height, base.height),
    mode: AURORA_MODES.includes(raw.mode) ? raw.mode : base.mode,
    hdr: raw.hdr === undefined ? base.hdr : raw.hdr === null ? null : clamp(raw.hdr, AURORA_LIMITS.hdr, base.hdr),
  };
}

/** Сияния нет — вид им ничего не меняет. */
export const auroraIsNeutral = (raw) => normalizeAurora(raw) === null;

/** Положение полосы в таймцикле (sky_azimuth_transition_position): от самого низа до верха неба. */
export const auroraPosition = (height) => 0.12 + clamp(height, AURORA_LIMITS.height, 0.5) * 0.8;

/** Пик цвета сияния в линейном свете (цвет масштабируется так, чтобы наибольший канал был этим числом). */
export const auroraPeak = (brightness) => 0.06 + clamp(brightness, AURORA_LIMITS.brightness, 1) * 0.3;
