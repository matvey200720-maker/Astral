/*
 * Комета (21.11.2026): ночью по небу пролетает тело с хвостом — не картинка, а летающая модель с клипом пути (как дирижабли, `compile-sky-flyer`).
 *
 * Здесь только вид-модель: что человек выбрал. Модель, путь и файлы игры собирает сборщик набора по этим четырём настройкам; серверных скриптов нет,
 * движение запечено в клип. Выключатель по умолчанию выключен: выключенная комета ничего не пишет и не считается правкой вида.
 *
 *   enabled    — летает ли комета;
 *   speed      — за сколько секунд она пролетает через небо (20…90: меньше — быстрее);
 *   period     — как часто пролетает, минуты между пролётами (1…10);
 *   tailLength — длина хвоста в градусах неба (3…15);
 *   colour     — цвет головы и хвоста, #rrggbb.
 */

/**
 * Окно показывает раздел «Комета» только когда сборщик файлов игры умеет её писать (часы показа и масштаб летающей модели в `compile-placements`).
 * Пока `false`, раздела в окне нет вовсе — ни плитки, ни пункта; включается одной правкой здесь.
 */
export const COMET_AVAILABLE = false;

export const COMET_LIMITS = Object.freeze({
  /* Секунды пролёта через небо. */
  speed: Object.freeze({ min: 20, max: 90 }),
  /* Минуты между пролётами. */
  period: Object.freeze({ min: 1, max: 10 }),
  /* Длина хвоста, градусы неба. */
  tailLength: Object.freeze({ min: 3, max: 15 }),
});

const HEX = /^#[0-9a-f]{6}$/i;

/* Шаг, на котором живёт значение: целые секунды и минуты, хвост — полградуса. Так разбор идемпотентен и в файл не уходят «хвосты» дробей. */
const STEPS = Object.freeze({ speed: 1, period: 1, tailLength: 0.5 });

const clamp = (value, key, fallback) => {
  const text = typeof value === "string" ? value.trim() : value;
  if (typeof text !== "number" && (typeof text !== "string" || text === ""))
    return fallback;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return fallback;
  const { min, max } = COMET_LIMITS[key];
  const step = STEPS[key];
  return Math.min(Math.max(Math.round(numeric / step) * step, min), max);
};

/** Комета по умолчанию: выключена; облетает небо за 45 с, раз в 4 минуты, хвост 8°, холодный белый. */
export function createComet() {
  return {
    enabled: false,
    speed: 45,
    period: 4,
    tailLength: 8,
    colour: "#bfe3ff",
  };
}

/** В границах: не объект — null (кометы нет); объект — своё, недостающее — умолчания; мусор — в границы. Включает только явное `true`. */
export function normalizeComet(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const base = createComet();
  return {
    enabled: raw.enabled === true,
    speed: clamp(raw.speed, "speed", base.speed),
    period: clamp(raw.period, "period", base.period),
    tailLength: clamp(raw.tailLength, "tailLength", base.tailLength),
    colour:
      typeof raw.colour === "string" && HEX.test(raw.colour)
        ? raw.colour.toLowerCase()
        : base.colour,
  };
}

/** Кометы нет или она выключена — вид ею ничего не меняет. */
export const cometIsNeutral = (raw) => {
  const comet = normalizeComet(raw);
  return comet === null || !comet.enabled;
};
