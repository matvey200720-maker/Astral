/*
 * Таймциклы: набор ключевых кадров «час суток → цветокоррекция» и всё, что с
 * ними делают — нормализация чужого ввода, выборка значения между кадрами,
 * добавление и удаление часа.
 *
 * TIMECYCLE_BASE_VALUES и TIMECYCLE_COLOR_FIELDS экспортируются ради миграции
 * проекта и определения модуля «Таймциклы»; наружу, в публичный API набора,
 * они не выходят.
 */

export const TIMECYCLE_VALUE_FIELDS = Object.freeze([
  "exposure",
  "gamma",
  "brightness",
  "contrast",
  "saturation",
  "ambient",
  "sky",
  "horizon",
  "sun",
  "moon",
  "shadowIntensity",
  "fogColor",
  "fogDensity",
  "bloom",
  "reflectionIntensity",
  "artificialLights",
  "streetLights",
  "nightDarkness",
  "waterTint",
]);

export const TIMECYCLE_COLOR_FIELDS = new Set([
  "ambient",
  "sky",
  "horizon",
  "sun",
  "moon",
  "fogColor",
  "waterTint",
]);
export const TIMECYCLE_BASE_VALUES = Object.freeze({
  exposure: 108,
  gamma: 100,
  brightness: 100,
  contrast: 108,
  saturation: 112,
  ambient: "#7985bd",
  sky: "#302f67",
  horizon: "#e58e72",
  sun: "#ffd0a3",
  moon: "#d8e2ff",
  shadowIntensity: 62,
  fogColor: "#7c7895",
  fogDensity: 18,
  bloom: 28,
  reflectionIntensity: 72,
  artificialLights: 84,
  streetLights: 88,
  nightDarkness: 42,
  waterTint: "#233d5f",
});

const timecycleFrame = (time, label, patch = {}) => ({
  id: `time-${String(Math.round(time * 100)).padStart(4, "0")}`,
  time,
  label,
  values: { ...TIMECYCLE_BASE_VALUES, ...patch },
});

export const DEFAULT_TIMECYCLE_KEYFRAMES = Object.freeze([
  timecycleFrame(0, "Ночь", {
    exposure: 72,
    gamma: 88,
    brightness: 74,
    contrast: 116,
    saturation: 78,
    ambient: "#26325f",
    sky: "#111735",
    horizon: "#2d3154",
    sun: "#605c82",
    moon: "#dce6ff",
    shadowIntensity: 76,
    fogColor: "#303650",
    fogDensity: 24,
    bloom: 34,
    reflectionIntensity: 82,
    artificialLights: 118,
    streetLights: 126,
    nightDarkness: 76,
    waterTint: "#132847",
  }),
  timecycleFrame(6, "Рассвет", {
    exposure: 96,
    gamma: 98,
    brightness: 94,
    contrast: 106,
    saturation: 104,
    ambient: "#7d7290",
    sky: "#756c98",
    horizon: "#ee9b78",
    sun: "#ffc987",
    moon: "#aab5d0",
    shadowIntensity: 55,
    fogColor: "#9a8290",
    fogDensity: 22,
    bloom: 38,
    reflectionIntensity: 74,
    artificialLights: 68,
    streetLights: 72,
    nightDarkness: 22,
    waterTint: "#38516d",
  }),
  timecycleFrame(12, "День", {
    exposure: 118,
    gamma: 104,
    brightness: 112,
    contrast: 102,
    saturation: 108,
    ambient: "#a7bdd1",
    sky: "#6fa4d2",
    horizon: "#c5d8dd",
    sun: "#fff0c7",
    moon: "#dbe5f2",
    shadowIntensity: 48,
    fogColor: "#a6bac4",
    fogDensity: 8,
    bloom: 14,
    reflectionIntensity: 66,
    artificialLights: 20,
    streetLights: 8,
    nightDarkness: 0,
    waterTint: "#39718e",
  }),
  timecycleFrame(20, "Вечер", {
    exposure: 108,
    gamma: 100,
    brightness: 100,
    contrast: 108,
    saturation: 112,
    ambient: "#7985bd",
    sky: "#302f67",
    horizon: "#e58e72",
    sun: "#ffd0a3",
    moon: "#d8e2ff",
    shadowIntensity: 62,
    fogColor: "#7c7895",
    fogDensity: 18,
    bloom: 28,
    reflectionIntensity: 72,
    artificialLights: 84,
    streetLights: 88,
    nightDarkness: 42,
    waterTint: "#233d5f",
  }),
]);

export const boundedTimecycleHour = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((((number % 24) + 24) % 24) * 4) / 4;
};

const validTimecycleValue = (field, value, fallback) => {
  if (TIMECYCLE_COLOR_FIELDS.has(field))
    return /^#[0-9a-f]{6}$/i.test(String(value || ""))
      ? String(value)
      : fallback;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
};

export function normalizeTimecycleKeyframes(
  value,
  fallback = TIMECYCLE_BASE_VALUES,
) {
  const source =
    Array.isArray(value) && value.length ? value : DEFAULT_TIMECYCLE_KEYFRAMES;
  const byTime = new Map();
  for (const item of source.slice(0, 24)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const time = boundedTimecycleHour(item.time);
    const rawValues =
      item.values &&
      typeof item.values === "object" &&
      !Array.isArray(item.values)
        ? item.values
        : item;
    const values = Object.fromEntries(
      TIMECYCLE_VALUE_FIELDS.map((field) => [
        field,
        validTimecycleValue(
          field,
          rawValues[field],
          fallback[field] ?? TIMECYCLE_BASE_VALUES[field],
        ),
      ]),
    );
    byTime.set(time, {
      id: String(
        item.id || `time-${String(Math.round(time * 100)).padStart(4, "0")}`,
      )
        .replace(/[^a-z0-9_-]/gi, "-")
        .slice(0, 64),
      time,
      label: String(
        item.label ||
          `${String(Math.floor(time)).padStart(2, "0")}:${String(Math.round((time % 1) * 60)).padStart(2, "0")}`,
      ).slice(0, 40),
      values,
    });
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

const interpolateColor = (left, right, ratio) => {
  const channel = (value, offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16);
  const part = (offset) =>
    Math.round(
      channel(left, offset) +
        (channel(right, offset) - channel(left, offset)) * ratio,
    )
      .toString(16)
      .padStart(2, "0");
  return `#${part(1)}${part(3)}${part(5)}`;
};

export function sampleTimecycleAt(config, hour) {
  const current = boundedTimecycleHour(hour);
  const frames = normalizeTimecycleKeyframes(
    config?.keyframes,
    config || TIMECYCLE_BASE_VALUES,
  );
  if (!frames.length) return { ...config, time: current };
  let previous = frames.at(-1);
  let next = frames[0];
  let previousTime = previous.time - 24;
  let nextTime = next.time;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index].time <= current) {
      previous = frames[index];
      next = frames[(index + 1) % frames.length];
      previousTime = previous.time;
      nextTime = index === frames.length - 1 ? next.time + 24 : next.time;
    }
  }
  const adjustedCurrent = current < previousTime ? current + 24 : current;
  const span = Math.max(0.25, nextTime - previousTime);
  let ratio = Math.max(0, Math.min(1, (adjustedCurrent - previousTime) / span));
  if (config?.interpolation === "step") ratio = 0;
  if (config?.interpolation === "smooth")
    ratio = ratio * ratio * (3 - 2 * ratio);
  const values = Object.fromEntries(
    TIMECYCLE_VALUE_FIELDS.map((field) => {
      const left = previous.values[field];
      const right = next.values[field];
      return [
        field,
        TIMECYCLE_COLOR_FIELDS.has(field)
          ? interpolateColor(left, right, ratio)
          : left + (right - left) * ratio,
      ];
    }),
  );
  return { ...config, ...values, time: current };
}

export function upsertTimecycleKeyframe(config, hour, source = config) {
  const time = boundedTimecycleHour(hour);
  const frames = normalizeTimecycleKeyframes(
    config?.keyframes,
    config || TIMECYCLE_BASE_VALUES,
  );
  const existing = frames.find((frame) => frame.time === time);
  const values = Object.fromEntries(
    TIMECYCLE_VALUE_FIELDS.map((field) => [
      field,
      validTimecycleValue(
        field,
        source?.[field],
        config?.[field] ?? TIMECYCLE_BASE_VALUES[field],
      ),
    ]),
  );
  const frame = {
    id:
      existing?.id || `time-${String(Math.round(time * 100)).padStart(4, "0")}`,
    time,
    label:
      existing?.label ||
      `${String(Math.floor(time)).padStart(2, "0")}:${String(Math.round((time % 1) * 60)).padStart(2, "0")}`,
    values,
  };
  return normalizeTimecycleKeyframes(
    [...frames.filter((item) => item.time !== time), frame],
    config || TIMECYCLE_BASE_VALUES,
  );
}

export function copyTimecycleHour(config, sourceHour, targetHour) {
  return upsertTimecycleKeyframe(
    config,
    targetHour,
    sampleTimecycleAt(config, sourceHour),
  );
}

export function removeTimecycleKeyframe(config, frameId) {
  const frames = normalizeTimecycleKeyframes(
    config?.keyframes,
    config || TIMECYCLE_BASE_VALUES,
  );
  return frames.length <= 2
    ? frames
    : frames.filter((frame) => frame.id !== frameId);
}
