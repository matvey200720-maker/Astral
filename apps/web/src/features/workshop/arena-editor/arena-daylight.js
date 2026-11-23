// Свет арены снаружи по часу суток: направление на солнце (ночью на луну), яркости и цвета.
// Все величины относительные: кадр «Дня» (13:00) остаётся прежним, остальные часы сдвигаются от полудня.
import { PREVIEW_WEATHER, celestialDirections, referenceKeyframeDocument, sampleAtHour } from "@modovik/timecycle";

const ARENA_DAY = "day";
const ARENA_HOURS = Object.freeze(
  [
    ["morning", 8, "Утро"],
    ["day", 13, "День"],
    ["evening", 19, "Вечер"],
    ["night", 23, "Ночь"],
  ].map(([id, hour, label]) => Object.freeze({ id, hour, label })),
);

// Числа подстройки света одним объектом; пары в limits — пределы «от, до».
const TUNE = Object.freeze({
  limits: { share: [0, 1], lift: [1, 8], sky: [0.12, 1], shift: [0.4, 2.5] },
  luma: [0.2126, 0.7152, 0.0722],
  noon: 13,
  eyeShare: 0.6,
  directScale: 0.38,
  skyScale: 4.8,
  horizonSpan: 0.08,
  moonBelow: -0.1,
  leastHeight: 0.12,
  moonMix: 0.55,
  tiny: 1e-6,
  tinyChannel: 1e-3,
});
const LIMITS = TUNE.limits;

const MOON_HEX = "#a9bcff";

// Ряды таймцикла, которые читает модуль: три цветовых канала у каждого света и пять множителей.
const colourRows = (stem) => ["r", "g", "b"].map((letter) => `${stem}_${letter}`);
const COLOUR_ROWS = {
  direct: colourRows("light_dir_col"),
  up: colourRows("light_natural_amb_up_col"),
  down: colourRows("light_natural_amb_down_col"),
};
const GAIN_ROWS = [
  "light_dir_mult",
  "light_natural_amb_up_intensity",
  "light_natural_amb_up_intensity_mult",
  "light_natural_amb_down_intensity",
  "natural_ambient_multiplier",
];
const ALL_ROWS = [...COLOUR_ROWS.direct, ...COLOUR_ROWS.up, ...COLOUR_ROWS.down, ...GAIN_ROWS];

function clamp(value, [low, high]) {
  return Math.min(high, Math.max(low, value));
}

function glow(rgb) {
  return TUNE.luma[0] * rgb[0] + TUNE.luma[1] * rgb[1] + TUNE.luma[2] * rgb[2];
}

function byteHex(channel) {
  const byte = Math.round(clamp(channel, LIMITS.share) * 255);
  return byte.toString(16).padStart(2, "0");
}

// Цвет в долях 0–1: читается из «#rrggbb», пишется обратно байтами.
class Tone {
  constructor(channels) {
    this.channels = channels;
  }

  static parse(hex) {
    const channels = [];
    for (let from = 1; from < 7; from += 2) channels.push(parseInt(hex.slice(from, from + 2), 16) / 255);
    return new Tone(channels);
  }

  toString() {
    return `#${this.channels.map(byteHex).join("")}`;
  }

  mixedWith(other, share) {
    return new Tone(other.channels.map((target, at) => this.channels[at] + (target - this.channels[at]) * share));
  }

  // Тот же цвет, сдвинутый в ту сторону и на столько, на сколько свет игры ушёл от полудня.
  drifted(now, noon) {
    const [a, b] = [now, noon].map(measure);
    if (!(a.peak > TUNE.tiny && b.peak > TUNE.tiny)) return this;
    const keep = Math.max(...this.channels);
    const moved = [];
    this.channels.forEach((channel, at) => {
      moved.push(channel * clamp(a.share[at] / Math.max(b.share[at], TUNE.tinyChannel), LIMITS.shift));
    });
    const top = Math.max(...moved) || 1;
    const settled = [];
    for (const channel of moved) settled.push((channel / top) * keep);
    return new Tone(settled);
  }
}

function measure(rgb) {
  const peak = Math.max(...rgb);
  return { peak, share: rgb.map((channel) => channel / peak) };
}

const STUDIO = {
  sun: Tone.parse("#fff3e4"),
  fill: Tone.parse("#d4e0ff"),
  sky: Tone.parse("#f2f5ff"),
  ground: Tone.parse("#4d4842"),
  moon: Tone.parse(MOON_HEX),
};

let referenceCache;
const referenceRow = (name) => (referenceCache ??= referenceKeyframeDocument(PREVIEW_WEATHER).regions[0].values)[name];
const usableRow = (row) => (Array.isArray(row) && row.length > 0 ? row : undefined);
const rowOf = (values, name) => usableRow(values?.[name]) ?? referenceRow(name);

// Всё, что таймцикл говорит об одном часе суток.
function readSky(hour, values) {
  const sampled = {};
  for (const name of ALL_ROWS) sampled[name] = sampleAtHour(rowOf(values, name), hour);
  const bodies = celestialDirections(hour);
  const sunUp = bodies.sun.z > TUNE.moonBelow;
  const toward = bodies[sunUp ? "sun" : "moon"];
  const falloff = clamp(toward.z / TUNE.horizonSpan, LIMITS.share);
  const ambience = sampled.natural_ambient_multiplier || 1;
  const gain = {
    direct: sampled.light_dir_mult * falloff,
    up: sampled.light_natural_amb_up_intensity * (sampled.light_natural_amb_up_intensity_mult || 1) * ambience,
    down: sampled.light_natural_amb_down_intensity * ambience,
  };
  const light = {};
  for (const which in COLOUR_ROWS) {
    light[which] = [];
    for (const name of COLOUR_ROWS[which]) light[which].push(Math.max(0, sampled[name]) * gain[which]);
  }
  const directBright = glow(light.direct) * TUNE.directScale;
  const skyBright = (glow(light.up) + glow(light.down)) * 0.5 * TUNE.skyScale;
  const grey = directBright * clamp(toward.z, LIMITS.share) + skyBright;
  return { sunUp, toward, light, directBright, skyBright, grey };
}

// Цвет неба и заливки: сдвиг по верхнему свету, ночью он ещё смешан с лунным.
function skyTone(studio, ctx) {
  const shifted = String(studio.drifted(ctx.now.light.up, ctx.noon.light.up));
  return ctx.moonLit ? String(Tone.parse(shifted).mixedWith(STUDIO.moon, TUNE.moonMix)) : shifted;
}

function aimed({ x, y, z }) {
  const height = Math.max(z, TUNE.leastHeight);
  const length = Math.hypot(x, y, height) || 1;
  return [x / length, y / length, height / length];
}

const FIELD_ORDER = [
  "sun",
  "ambient",
  "environment",
  "exposure",
  "sunColour",
  "fillColour",
  "skyColour",
  "groundColour",
  "sunDirection",
];

function fieldOf(name, ctx) {
  const { now, noon } = ctx;
  switch (name) {
    case "sun":
      return clamp(ratio(now.directBright, noon.directBright) * ctx.lift, LIMITS.share);
    case "ambient":
    case "environment":
      return ctx.ambient;
    case "exposure":
      return 1;
    case "sunColour":
      return ctx.moonLit ? MOON_HEX : String(STUDIO.sun.drifted(now.light.direct, noon.light.direct));
    case "fillColour":
      return skyTone(STUDIO.fill, ctx);
    case "skyColour":
      return skyTone(STUDIO.sky, ctx);
    case "groundColour":
      return String(STUDIO.ground.drifted(now.light.down, noon.light.down));
    default:
      return aimed(now.toward);
  }
}

// Отношение к опорной величине: знаменатель не меньше малого числа.
const ratio = (top, bottom) => top / Math.max(bottom, TUNE.tiny);

const arenaStageDaylight = (hour = TUNE.noon, values = null) => {
  const noon = readSky(TUNE.noon, values);
  const now = readSky(hour, values);
  const lift = clamp(ratio(noon.grey, now.grey) ** TUNE.eyeShare, LIMITS.lift);
  const ambient = clamp(ratio(now.skyBright, noon.skyBright) * lift, LIMITS.sky);
  const ctx = { now, noon, lift, ambient, moonLit: !now.sunUp };
  const result = {};
  for (const name of FIELD_ORDER) result[name] = fieldOf(name, ctx);
  return result;
};

export { ARENA_DAY, ARENA_HOURS, arenaStageDaylight };
