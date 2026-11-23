// Каналы редактора килл-эффекта. Описание разложено по аспектам: шапки, поля, правила
// записи и правила чтения хранятся отдельными таблицами по id канала и собираются в конце.
import { hexToRgb, rgbToHex } from "./color.js";

export const KILL_EFFECT_GROUPS = Object.freeze(
  [
    ["color", "Цвет и тон", "Оттенок вспышки, насыщенность и яркость кадра"],
    ["screen", "Экранный градиент", "Затемнение или заливка верха, середины и низа экрана"],
    ["frame", "Виньетка", "Рамка по краям кадра: цвет, радиус и жёсткость"],
    ["distance", "Даль", "Уход в туман и размытие фона — «серая даль»"],
    ["optics", "Оптика", "Свечение, размытие, искажение линзы и хроматика"],
    ["film", "Плёнка", "Зерно и строчная развёртка поверх кадра"],
  ].map(([id, label, hint]) => Object.freeze({ id, label, hint })),
);

// ---------------------------------------------------------------- вспомогательное

const confine = (lo, hi, x) => Math.min(hi, Math.max(lo, x));
const rescalable = (field) => field.kind === "number" && field.scaled;
const restPoint = (field) => field.neutral ?? 0;

// ---------------------------------------------------------------- поля

const swatch = (key, label, preset) => Object.freeze({ scaled: false, key, label, kind: "color", default: preset });

// Порядок ключей: сначала базовые границы, затем добавочные в порядке вызова.
const RANGE_BASE = { min: 0, max: 100, step: 1, unit: "%", neutral: 0 };
const ranged = (key, label, opts) =>
  Object.freeze({ scaled: true, key, label, kind: "number", ...RANGE_BASE, ...opts });

const FIELD_SETS = {
  tint: [
    swatch("color", "Цвет", "#38aaff"),
    ranged("amount", "Сила", {
      max: 200,
      default: 15,
      hint: "0 % — кадр не трогается, 200 % — предельный сдвиг ванильных эффектов",
    }),
  ],
  grade: [swatch("color", "Цвет", "#ffffff"), ranged("amount", "Сила", { max: 120, default: 0 })],
  saturation: [ranged("value", "Насыщенность", { max: 200, neutral: 100, default: 50 })],
  exposure: [ranged("value", "Экспозиция", { min: -200, max: 200, unit: "", default: 0, format: "hundredths" })],
  gradient: [
    swatch("top", "Верх", "#000000"),
    swatch("middle", "Середина", "#ffffff"),
    swatch("bottom", "Низ", "#ffffff"),
    ranged("topMidpoint", "Граница верх/середина", { neutral: 50, default: 33 }),
    ranged("bottomMidpoint", "Граница середина/низ", { neutral: 50, default: 66 }),
  ],
  vignette: [
    swatch("color", "Цвет", "#000000"),
    ranged("intensity", "Сила", { default: 10 }),
    ranged("radius", "Радиус", {
      min: 100,
      max: 1000,
      unit: "",
      neutral: 1000,
      default: 1000,
      format: "hundredths",
      hint: "Меньше радиус — плотнее и ближе к центру",
    }),
    ranged("contrast", "Жёсткость", { default: 0 }),
  ],
  fog: [
    swatch("color", "Цвет тумана", "#9aa3ad"),
    ranged("density", "Плотность", { max: 250, unit: "", default: 40 }),
    ranged("falloff", "Спад по высоте", { max: 1000, unit: "", default: 20 }),
    ranged("alpha", "Непрозрачность", { neutral: 100, default: 100 }),
  ],
  depthOfField: [
    ranged("distance", "Дистанция резкости", { min: 1, unit: " м", neutral: 100, default: 15 }),
    ranged("amount", "Сила размытия", { default: 100 }),
  ],
  bloom: [
    ranged("intensity", "Сила", { max: 400, default: 0 }),
    ranged("threshold", "Порог", { max: 200, neutral: 50, default: 50 }),
  ],
  blur: [ranged("value", "Сила", { default: 0 })],
  lens: [
    ranged("distortion", "Искажение", { min: -100, max: 15, default: 0 }),
    ranged("chromatic", "Хроматика", { default: 0 }),
    ranged("artefacts", "Блики", { max: 300, neutral: 100, default: 100 }),
  ],
  grain: [ranged("amount", "Количество", { default: 20 }), ranged("size", "Размер", { default: 30 })],
  scanlines: [
    ranged("intensity", "Сила", { default: 16 }),
    ranged("frequency", "Частота", { min: 10, max: 2000, unit: "", neutral: 10, default: 900 }),
    ranged("secondary", "Вторая частота", { min: 10, max: 2000, unit: "", neutral: 10, default: 396 }),
    ranged("speed", "Скорость", { default: 85 }),
  ],
};

// ---------------------------------------------------------------- запись в параметры модификатора

// Источник первого числа записывается строкой:
//   "ключ:r|g|b" — доля цвета поля, "ключ/100" — поле, делённое на 100,
//   "ключ" — поле как есть, "=0" — постоянный ноль.
function sourceOf(text) {
  if (text === "=0") return () => 0;
  const colon = text.indexOf(":");
  if (colon > 0) {
    const key = text.slice(0, colon);
    const part = text.slice(colon + 1);
    return (value) => hexToRgb(value[key])[part];
  }
  if (text.endsWith("/100")) {
    const key = text.slice(0, -4);
    return (value) => value[key] / 100;
  }
  return (value) => value[text];
}

const rgbRows = (prefix, key, tail = 0) => ["r", "g", "b"].map((part) => [`${prefix}_${part}`, `${key}:${part}`, tail]);

const WRITE_ROWS = {
  tint: [...rgbRows("postfx_shift_col", "color", 1), ["postfx_shift_cutoff", "amount/100"]],
  grade: [...rgbRows("postfx_correct_col", "color"), ["postfx_correct_cutoff", "amount/100"]],
  saturation: [["postfx_desaturation", "value/100"]],
  exposure: [["postfx_exposure", "value/100"]],
  gradient: [
    ...rgbRows("postfx_grad_top_col", "top"),
    ...rgbRows("postfx_grad_middle_col", "middle"),
    ...rgbRows("postfx_grad_bottom_col", "bottom"),
    ["postfx_grad_top_middle_midpoint", "topMidpoint/100"],
    ["postfx_grad_middle_bottom_midpoint", "bottomMidpoint/100"],
  ],
  vignette: [
    ["postfx_vignetting_intensity", "intensity/100"],
    ["postfx_vignetting_radius", "radius/100"],
    ["postfx_vignetting_contrast", "contrast/100"],
    ...rgbRows("postfx_vignetting_col", "color"),
  ],
  fog: [
    ...rgbRows("fog_col", "color"),
    ["fog_col_a", "alpha/100"],
    ["fog_density", "density"],
    ["fog_falloff", "falloff"],
  ],
  depthOfField: [["dof_far", "distance"], ["dof_blur_far", "amount/100"], ["dof_blur_mid", "=0"]],
  bloom: [["postfx_intensity_bloom", "intensity/100"], ["postfx_bright_pass_thresh", "threshold/100"]],
  blur: [["screen_blur_intensity", "value/100"]],
  lens: [
    ["lens_dist_coeff", "distortion/100"],
    ["chrom_aberration_coeff", "chromatic/100"],
    ["lens_artefacts_intensity", "artefacts/100"],
  ],
  grain: [["postfx_noise", "amount/100"], ["postfx_noise_size", "size/100"]],
  scanlines: [
    ["postfx_scanlineintensity", "intensity/100"],
    ["postfx_scanline_frequency_0", "frequency"],
    ["postfx_scanline_frequency_1", "secondary"],
    ["postfx_scanline_speed", "speed/100"],
  ],
};

function rowWriter(rows) {
  const plan = rows.map(([name, text, tail = 0]) => [name, sourceOf(text), tail]);
  return (value) => plan.map(([name, read, tail]) => [name, read(value), tail]);
}

// ---------------------------------------------------------------- чтение из параметров модификатора

// Правило чтения канала:
//   colors   — цвета из трёх долей: { field, base, otherwise }, имена base_r / base_g / base_b;
//   numbers  — числовые поля: { field, from, times, otherwise };
//   triggers — одиночные имена, при которых канал присутствует (имена цветов тоже);
//   take     — имена, которые канал забирает всегда, после найденных цветов;
//   live     — true (всегда включён) либо ключ поля, которое должно быть больше нуля.
const READ_RULES = {
  tint: {
    colors: [{ field: "color", base: "postfx_shift_col", otherwise: "#38aaff" }],
    numbers: [{ field: "amount", from: "postfx_shift_cutoff", times: 100, otherwise: 15 }],
    triggers: ["postfx_shift_cutoff"],
    take: ["postfx_shift_cutoff"],
  },
  grade: {
    colors: [{ field: "color", base: "postfx_correct_col", otherwise: "#ffffff" }],
    numbers: [{ field: "amount", from: "postfx_correct_cutoff", times: 100, otherwise: 0 }],
    triggers: ["postfx_correct_cutoff"],
    take: ["postfx_correct_cutoff"],
  },
  saturation: {
    numbers: [{ field: "value", from: "postfx_desaturation", times: 100 }],
    triggers: ["postfx_desaturation"],
    take: ["postfx_desaturation"],
  },
  exposure: {
    numbers: [{ field: "value", from: "postfx_exposure", times: 100 }],
    triggers: ["postfx_exposure"],
    take: ["postfx_exposure"],
    live: true,
  },
  gradient: {
    colors: [
      { field: "top", base: "postfx_grad_top_col", otherwise: "#ffffff" },
      { field: "middle", base: "postfx_grad_middle_col", otherwise: "#ffffff" },
      { field: "bottom", base: "postfx_grad_bottom_col", otherwise: "#ffffff" },
    ],
    numbers: [
      { field: "topMidpoint", from: "postfx_grad_top_middle_midpoint", times: 100, otherwise: 33 },
      { field: "bottomMidpoint", from: "postfx_grad_middle_bottom_midpoint", times: 100, otherwise: 66 },
    ],
    take: ["postfx_grad_top_middle_midpoint", "postfx_grad_middle_bottom_midpoint", "postfx_grad_midpoint"],
    live: true,
  },
  vignette: {
    colors: [{ field: "color", base: "postfx_vignetting_col", otherwise: "#000000" }],
    numbers: [
      { field: "intensity", from: "postfx_vignetting_intensity", times: 100, otherwise: 10 },
      { field: "radius", from: "postfx_vignetting_radius", times: 100, otherwise: 1000 },
      { field: "contrast", from: "postfx_vignetting_contrast", times: 100, otherwise: 0 },
    ],
    triggers: ["postfx_vignetting_intensity"],
    take: ["postfx_vignetting_intensity", "postfx_vignetting_radius", "postfx_vignetting_contrast"],
  },
  fog: {
    colors: [{ field: "color", base: "fog_col", otherwise: "#9aa3ad" }],
    numbers: [
      { field: "density", from: "fog_density", times: 1, otherwise: 40 },
      { field: "falloff", from: "fog_falloff", times: 1, otherwise: 20 },
      { field: "alpha", from: "fog_col_a", times: 100, otherwise: 100 },
    ],
    triggers: ["fog_density"],
    take: ["fog_col_a", "fog_density", "fog_falloff"],
    live: true,
  },
  depthOfField: {
    numbers: [
      { field: "distance", from: "dof_far", times: 1 },
      { field: "amount", from: "dof_blur_far", times: 100, otherwise: 100 },
    ],
    triggers: ["dof_far"],
    take: ["dof_far", "dof_blur_far", "dof_blur_mid"],
    live: true,
  },
  bloom: {
    numbers: [
      { field: "intensity", from: "postfx_intensity_bloom", times: 100 },
      { field: "threshold", from: "postfx_bright_pass_thresh", times: 100, otherwise: 50 },
    ],
    triggers: ["postfx_intensity_bloom"],
    take: ["postfx_intensity_bloom", "postfx_bright_pass_thresh"],
  },
  blur: {
    numbers: [{ field: "value", from: "screen_blur_intensity", times: 100 }],
    triggers: ["screen_blur_intensity"],
    take: ["screen_blur_intensity"],
  },
  lens: {
    numbers: [
      { field: "distortion", from: "lens_dist_coeff", times: 100, otherwise: 0 },
      { field: "chromatic", from: "chrom_aberration_coeff", times: 100, otherwise: 0 },
      { field: "artefacts", from: "lens_artefacts_intensity", times: 100, otherwise: 100 },
    ],
    triggers: ["lens_dist_coeff", "chrom_aberration_coeff", "lens_artefacts_intensity"],
    take: ["lens_dist_coeff", "chrom_aberration_coeff", "lens_artefacts_intensity"],
  },
  grain: {
    numbers: [
      { field: "amount", from: "postfx_noise", times: 100 },
      { field: "size", from: "postfx_noise_size", times: 100, otherwise: 30 },
    ],
    triggers: ["postfx_noise"],
    take: ["postfx_noise", "postfx_noise_size"],
    live: "amount",
  },
  scanlines: {
    numbers: [
      { field: "intensity", from: "postfx_scanlineintensity", times: 100 },
      { field: "frequency", from: "postfx_scanline_frequency_0", times: 1, otherwise: 900 },
      { field: "secondary", from: "postfx_scanline_frequency_1", times: 1, otherwise: 396 },
      { field: "speed", from: "postfx_scanline_speed", times: 100, otherwise: 85 },
    ],
    triggers: ["postfx_scanlineintensity"],
    take: ["postfx_scanlineintensity", "postfx_scanline_frequency_0", "postfx_scanline_frequency_1", "postfx_scanline_speed"],
    live: "intensity",
  },
};

// Запись параметра, не являющаяся массивом, даёт NaN: нормализация подставит умолчание.
const headOf = (entry) => (Array.isArray(entry) ? entry[0] : NaN);
const triple = (base) => [`${base}_r`, `${base}_g`, `${base}_b`];

function buildReader({ colors = [], numbers = [], triggers = [], take = [], live }) {
  const probes = [...colors.flatMap(({ base }) => triple(base)), ...triggers];
  return (params) => {
    const look = (name) => params.get(name);
    if (!probes.some((name) => look(name))) return null;

    const raw = {};
    const claimed = [];
    for (const { field, base, otherwise } of colors) {
      const names = triple(base);
      const entries = names.map((name) => look(name));
      const [r, g, b] = entries.map((entry) => (entry ? headOf(entry) : 0));
      raw[field] = entries.some(Boolean) ? rgbToHex({ r, g, b }) : otherwise;
      claimed.push(...names.filter((name) => params.has(name)));
    }
    for (const { field, from, times, otherwise } of numbers) {
      const entry = look(from);
      raw[field] = entry ? headOf(entry) * times : otherwise;
    }
    if (live === true) raw.enabled = true;
    else if (live) raw.enabled = raw[live] > 0;
    return { value: raw, consumed: [...claimed, ...take] };
  };
}

// Обычный объект: id вроде "toString" находит унаследованное свойство.
const READERS = Object.fromEntries(Object.entries(READ_RULES).map(([id, rule]) => [id, buildReader(rule)]));

// ---------------------------------------------------------------- сборка каналов

// [id, группа, где ключ optional (0 — нет, 1 — перед fields, 2 — после fields), подпись, подсказка]
const CHANNEL_HEADS = [
  ["tint", "color", 0, "Оттенок килла", "Цвет, в который игра уводит кадр. У ванильной игры это холодный синий #38AAFF."],
  ["grade", "color", 0, "Цветокоррекция", "Умножение кадра на цвет — тёплый или холодный грейд поверх оттенка."],
  ["saturation", "color", 0, "Насыщенность", "100 % — как в игре, 0 % — чёрно-белый кадр. Ванильный килл ставит 50 %."],
  ["exposure", "color", 2, "Экспозиция", "Подсветить или притушить весь кадр на время эффекта."],
  ["gradient", "screen", 1, "Градиент по экрану", "Три полосы поверх кадра: верх, середина и низ. Именно так делается затемнение верхней части экрана."],
  ["vignette", "frame", 0, "Виньетка", "Рамка по краям кадра. Ванильный `damage` — красная рамка на полную силу."],
  ["fog", "distance", 1, "Туман", "Заливка дали цветом — тот самый «уход вдаль серым»."],
  ["depthOfField", "distance", 1, "Размытие фона", "Дальний план уходит в расфокус, цель остаётся резкой."],
  ["bloom", "optics", 0, "Свечение", "Разлив света от ярких мест кадра."],
  ["blur", "optics", 0, "Размытие экрана", "Общая мягкость кадра в момент килла."],
  ["lens", "optics", 0, "Линза", "Бочка/подушка и хроматические ореолы по краям."],
  ["grain", "film", 1, "Зерно", "Плёночный шум поверх кадра."],
  ["scanlines", "film", 1, "Развёртка", "Горизонтальные полосы как у камеры наблюдения."],
];

function assembleChannel([id, group, optionalMode, label, hint]) {
  const head = { id, group, label, hint };
  const fields = Object.freeze(FIELD_SETS[id]);
  const write = rowWriter(WRITE_ROWS[id]);
  if (optionalMode === 1) return Object.freeze({ ...head, optional: true, fields, write });
  if (optionalMode === 2) return Object.freeze({ ...head, fields, optional: true, write });
  return Object.freeze({ ...head, fields, write });
}

export const KILL_EFFECT_CHANNELS = Object.freeze(CHANNEL_HEADS.map(assembleChannel));

export const KILL_EFFECT_CHANNEL_MAP = Object.freeze(
  Object.fromEntries(KILL_EFFECT_CHANNELS.map((channel) => [channel.id, channel])),
);

// ---------------------------------------------------------------- значения каналов

// Значение канала по полям; у необязательного канала в конце добавляется enabled: false.
function valueFromFields(channel, pick) {
  const value = Object.fromEntries(channel.fields.map((field) => [field.key, pick(field)]));
  if (channel.optional) value.enabled = false;
  return value;
}

export const channelDefaults = (channel) => valueFromFields(channel, (field) => field.default);

export const channelSilence = (channel) =>
  valueFromFields(channel, (field) => (rescalable(field) ? restPoint(field) : field.default));

// Обработчики нормализации по виду поля; неизвестный вид читается как число.
const FIELD_NORMALIZERS = new Map([
  ["color", (field, raw) => (raw === null || raw === undefined ? field.default : String(raw))],
  [
    "number",
    (field, raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return field.default;
      return confine(field.min, field.max, Math.round(n / field.step) * field.step);
    },
  ],
]);

const normalizeField = (field, raw) =>
  (FIELD_NORMALIZERS.get(field.kind) ?? FIELD_NORMALIZERS.get("number"))(field, raw);

export function normalizeChannelValue(channel, input) {
  const source = typeof input === "object" && input !== null ? input : {};
  const value = Object.fromEntries(channel.fields.map((field) => [field.key, normalizeField(field, source[field.key])]));
  if (channel.optional) value.enabled = Boolean(source.enabled);
  return value;
}

export function isChannelNeutral(channel, value) {
  const scaled = channel.fields.filter(rescalable);
  return scaled.length > 0 && scaled.every((field) => value[field.key] === restPoint(field));
}

export function scaleChannelValue(channel, value, intensity) {
  const ratio = Number.isFinite(intensity) ? intensity / 100 : 1;
  if (ratio === 1) return value;
  const moved = Object.fromEntries(
    channel.fields.filter(rescalable).map((field) => {
      const rest = restPoint(field);
      return [field.key, confine(field.min, field.max, rest + (value[field.key] - rest) * ratio)];
    }),
  );
  return { ...value, ...moved };
}

export function readChannelValue(channel, params) {
  const reader = READERS[channel.id];
  if (!reader) return null;
  const found = reader(params);
  if (found === null) return null;
  const { value, consumed } = found;
  return { value: normalizeChannelValue(channel, value), consumed };
}
