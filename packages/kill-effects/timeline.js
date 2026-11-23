// Модель предпросмотра килл-эффекта во времени: окно, сила, кайма, кадр, акцент.
import { hexLuminance, hexToCss, hexToRgb, mixHex } from "./color.js";
import { resolveChannelValue } from "./project.js";

export { hexToCss };

export const KILL_EFFECT_ENVELOPE = Object.freeze({ attack: 0.18, release: 0.45 });

const GLOW_FLOOR = 0.02;
const GLOW_BASE = 0.12;
const GLOW_GAIN = 0.44;
const GLOW_CEIL = 0.72;
const ACCENT_MIX_FROM = "#8a97a8";
const ACCENT_DEFAULT = "#38aaff";
const ACCENT_GRAY = "#9aa3ad";
const DARK_LUMA = 0.35;
const CHANNEL_IDS = [
  "tint",
  "grade",
  "saturation",
  "exposure",
  "gradient",
  "vignette",
  "fog",
  "depthOfField",
  "bloom",
  "blur",
  "lens",
  "grain",
  "scanlines",
];

const confine = (lo, hi, x) => Math.min(hi, Math.max(lo, x));
const finiteOrZero = (value) => {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : number;
};

// ---------------------------------------------------------------- окно эффекта

export function killEffectEnvelope(project) {
  const total = Math.max(1, finiteOrZero(project?.duration));
  const rise = Math.round(total * KILL_EFFECT_ENVELOPE.attack);
  const fall = Math.round(total * KILL_EFFECT_ENVELOPE.release);
  return { duration: total, attackMs: rise, holdMs: Math.max(0, total - rise - fall), releaseMs: fall };
}

const easeRise = (x) => confine(0, 1, x * x * (3 - 2 * x));
const easeFall = (x) => confine(0, 1, 1 - x * x);

// Кусочная кривая силы: отрезки по порядку, каждый действует до своего конца.
function profileOf(win) {
  const fallStart = win.duration - win.releaseMs;
  return [
    { to: win.attackMs, closed: false, level: (t) => easeRise(t / Math.max(1, win.attackMs)) },
    { to: fallStart, closed: true, level: () => 1 },
    { to: Infinity, closed: true, level: (t) => easeFall((t - fallStart) / Math.max(1, win.releaseMs)) },
  ];
}

export function killEffectStrength(project, elapsedMs) {
  const win = killEffectEnvelope(project);
  const t = finiteOrZero(elapsedMs);
  if (t <= 0 || t >= win.duration) return 0;
  const piece = profileOf(win).find(({ to, closed }) => (closed ? t <= to : t < to));
  return piece.level(t);
}

// ---------------------------------------------------------------- кайма

// Охват цвета коррекции: белый кадр не меняет, чёрный (и негодный) меняет полностью.
function coverage(color) {
  const { r, g, b } = hexToRgb(color);
  return 1 - Math.min(r, g, b);
}

// Кайма по найденным каналам: цвет берёт тот, что двигает кадр сильнее.
function glowFrom(tint, grade) {
  const tintPull = tint ? Math.max(0, tint.amount) / 100 : 0;
  const gradePull = grade ? (Math.max(0, grade.amount) / 100) * coverage(grade.color) : 0;
  const pull = Math.max(tintPull, gradePull);
  if (pull < GLOW_FLOOR) return null;
  return {
    color: gradePull > tintPull ? grade.color : tint.color,
    amount: confine(0, GLOW_CEIL, GLOW_BASE + GLOW_GAIN * Math.sqrt(pull)),
  };
}

export function killEffectFlash(project) {
  return glowFrom(resolveChannelValue(project, "tint"), resolveChannelValue(project, "grade"));
}

// ---------------------------------------------------------------- кадр

const towardOne = (target, power) => 1 + (target - 1) * power;

// Поля кадра без условий: значения по умолчанию, когда канала нет.
const REST_FRAME = {
  saturation: 1,
  brightness: 1,
  blur: 0,
  backgroundBlur: 0,
  focusDistance: null,
  chromatic: 0,
  distortion: 0,
  lensArtefacts: 1,
};

// Канал -> функция, которая выдаёт его поля кадра (power — значение огибающей).
const FIELDS_OF_CHANNEL = {
  saturation: (v, power) => ({ saturation: towardOne(v.value / 100, power) }),
  exposure: (v, power) => ({ brightness: towardOne(1 + v.value / 200, power) }),
  blur: (v, power) => ({ blur: (v.value / 100) * 6 * power }),
  depthOfField: (v, power) => ({ backgroundBlur: (v.amount / 100) * 10 * power, focusDistance: v.distance }),
  lens: (v, power) => ({
    chromatic: (v.chromatic / 100) * 8 * power,
    distortion: (v.distortion / 100) * power,
    lensArtefacts: towardOne(v.artefacts / 100, power),
  }),
};

function rampLayer(ramp, power) {
  const cutTop = confine(0, 1, ramp.topMidpoint / 100);
  const cutBottom = Math.max(cutTop, confine(0, 1, ramp.bottomMidpoint / 100));
  return {
    alpha: power,
    stops: [
      { color: ramp.top, offset: 0 },
      { color: ramp.middle, offset: cutTop },
      { color: ramp.middle, offset: cutBottom },
      { color: ramp.bottom, offset: 1 },
    ],
  };
}

function rimLayer(rim, power) {
  const reach = confine(0.1, 1, rim.radius / 1000);
  return {
    color: rim.color,
    alpha: (rim.intensity / 100) * power,
    inner: confine(0.05, 0.85, reach * 0.55),
    outer: confine(0.4, 1.05, 0.72 + reach * 0.28),
    contrast: rim.contrast / 100,
  };
}

// Слои кадра в порядке ключей результата: ключ -> (значения каналов, power) -> слой или ложь.
const LAYERS = [
  [
    "flash",
    (v, power) => {
      const glow = glowFrom(v.tint, v.grade);
      return glow && { color: glow.color, alpha: glow.amount * power };
    },
  ],
  [
    "tint",
    (v, power) => v.tint && v.tint.amount > 0 && { color: v.tint.color, alpha: confine(0, 1, (v.tint.amount / 200) * 0.75) * power },
  ],
  [
    "grade",
    (v, power) => v.grade && v.grade.amount > 0 && { color: v.grade.color, alpha: confine(0, 1, (v.grade.amount / 120) * 0.6) * power },
  ],
  ["gradient", (v, power) => v.gradient && rampLayer(v.gradient, power)],
  ["vignette", (v, power) => v.vignette && v.vignette.intensity > 0 && rimLayer(v.vignette, power)],
  [
    "fog",
    (v, power) =>
      v.fog && {
        color: v.fog.color,
        alpha: confine(0, 1, (v.fog.density / 250) * (v.fog.alpha / 100) * 1.6) * power,
        falloff: confine(0, 1, v.fog.falloff / 200),
      },
  ],
  [
    "bloom",
    (v, power) =>
      v.bloom &&
      v.bloom.intensity > 0 && {
        alpha: confine(0, 1, (v.bloom.intensity / 400) * 0.85) * power,
        threshold: confine(0, 1, v.bloom.threshold / 200),
      },
  ],
  [
    "grain",
    (v, power) =>
      v.grain &&
      v.grain.amount > 0 && {
        alpha: confine(0, 1, v.grain.amount / 100) * 0.35 * power,
        size: Math.max(1, Math.round(1 + (v.grain.size / 100) * 4)),
      },
  ],
  [
    "scanlines",
    (v, power) =>
      v.scanlines &&
      v.scanlines.intensity > 0 && {
        alpha: confine(0, 1, v.scanlines.intensity / 100) * power,
        period: Math.max(2, Math.round(2000 / Math.max(10, v.scanlines.frequency))),
        speed: v.scanlines.speed / 100,
      },
  ],
];

export function killEffectFrame(project, elapsedMs) {
  const power = killEffectStrength(project, elapsedMs);
  if (power <= 0) return { strength: 0 };

  const values = Object.fromEntries(CHANNEL_IDS.map((id) => [id, resolveChannelValue(project, id)]));
  const frame = { strength: power, ...REST_FRAME };
  for (const [id, fieldsOf] of Object.entries(FIELDS_OF_CHANNEL)) {
    if (values[id]) Object.assign(frame, fieldsOf(values[id], power));
  }
  for (const [key, build] of LAYERS) {
    const layer = build(values, power);
    if (layer) frame[key] = layer;
  }
  return frame;
}

// ---------------------------------------------------------------- акцент карточки

// Правила по порядку: первое, давшее не null, и есть акцент.
const ACCENT_RULES = [
  (project) => {
    const glow = killEffectFlash(project);
    return glow ? mixHex(ACCENT_MIX_FROM, glow.color, confine(0, 1, glow.amount / 0.5)) : null;
  },
  (project) => {
    const ramp = resolveChannelValue(project, "gradient");
    return ramp ? ramp.top : null;
  },
  (project) => {
    const rim = resolveChannelValue(project, "vignette");
    return rim && rim.intensity > 20 ? rim.color : null;
  },
  (project) => {
    const tone = resolveChannelValue(project, "saturation");
    return tone && tone.value < 40 ? ACCENT_GRAY : null;
  },
];

export function killEffectAccent(project) {
  for (const rule of ACCENT_RULES) {
    const color = rule(project);
    if (color !== null) return color;
  }
  return ACCENT_DEFAULT;
}

export function isDarkAccent(hex) {
  return hexLuminance(hex) < DARK_LUMA;
}
