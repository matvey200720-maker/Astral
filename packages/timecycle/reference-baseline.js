// Эталонное небо для предпросмотра, пока файлы игры не подключены: документ ключевых кадров
// той же формы, что даёт parseKeyframeXml, но числа считаются по высоте солнца и характеру погоды.
import { KEYFRAME_PARAMETER_NAMES } from "./parameter-names.js";
import {
  SAMPLE_COUNT,
  TIMECYCLE_REGIONS,
  TIMECYCLE_SAMPLES,
  celestialDirections,
  findWeather,
} from "./samples.js";

export const REFERENCE_BASELINE_LABEL = Object.freeze({
  ru: "Эталон Astral",
  en: "Astral reference",
});

const DOCUMENT_VERSION = "1.000000";

// Характер погоды по id: ясность, облачность, дымка, оттенок, сдвиг экспозиции.
const WEATHER_PROFILES = [
  { id: "EXTRASUNNY", clarity: 1, clouds: 0.05, haze: 0.35, tint: [1.04, 1, 0.94], exposure: 0.1 },
  { id: "CLEAR", clarity: 0.94, clouds: 0.18, haze: 0.45, tint: [1, 1, 1], exposure: 0 },
  { id: "CLOUDS", clarity: 0.72, clouds: 0.62, haze: 0.6, tint: [0.98, 0.99, 1.02], exposure: -0.05 },
  { id: "SMOG", clarity: 0.6, clouds: 0.35, haze: 0.95, tint: [1.06, 1, 0.86], exposure: -0.05 },
  { id: "FOGGY", clarity: 0.4, clouds: 0.5, haze: 1.6, tint: [0.98, 1, 1.02], exposure: -0.15 },
  { id: "OVERCAST", clarity: 0.45, clouds: 0.9, haze: 0.85, tint: [0.96, 0.98, 1.03], exposure: -0.2 },
  { id: "RAIN", clarity: 0.32, clouds: 0.95, haze: 0.85, tint: [0.93, 0.97, 1.05], exposure: -0.3 },
  { id: "THUNDER", clarity: 0.22, clouds: 1, haze: 0.95, tint: [0.9, 0.94, 1.08], exposure: -0.4 },
  { id: "CLEARING", clarity: 0.68, clouds: 0.55, haze: 0.7, tint: [1, 1, 1], exposure: -0.05 },
  { id: "NEUTRAL", clarity: 0.85, clouds: 0.3, haze: 0.5, tint: [1, 1, 1], exposure: 0 },
  { id: "SNOW", clarity: 0.5, clouds: 0.85, haze: 1, tint: [0.97, 0.99, 1.06], exposure: -0.1 },
  { id: "BLIZZARD", clarity: 0.28, clouds: 1, haze: 1.7, tint: [0.95, 0.98, 1.08], exposure: -0.25 },
  { id: "SNOWLIGHT", clarity: 0.66, clouds: 0.6, haze: 0.8, tint: [0.98, 1, 1.05], exposure: -0.05 },
  { id: "XMAS", clarity: 0.55, clouds: 0.8, haze: 0.95, tint: [0.97, 0.99, 1.07], exposure: -0.12 },
  { id: "HALLOWEEN", clarity: 0.5, clouds: 0.7, haze: 0.9, tint: [1.02, 0.94, 0.98], exposure: -0.18 },
];
const PROFILES = new Map(WEATHER_PROFILES.map((profile) => [profile.id, profile]));

// Множители области: дымка, тепло, фон.
const REGION_TWEAKS = { GLOBAL: { haze: 1, warmth: 1, ambient: 1 }, URBAN: { haze: 1.18, warmth: 1.05, ambient: 1.12 } };

// Опорные цвета неба: ночь, сумерки, день.
const PALETTE = {
  zenith: [[0.006, 0.012, 0.032], [0.045, 0.075, 0.17], [0.055, 0.16, 0.42]],
  horizon: [[0.012, 0.02, 0.045], [0.42, 0.2, 0.14], [0.34, 0.44, 0.62]],
  sun: [[0.06, 0.08, 0.14], [1, 0.42, 0.18], [1, 0.92, 0.78]],
};

// Рецепты кривых: скаляр — одно выражение на параметр, rgb — цвет из трёх параметров.
// Выражение: число, имя из области видимости или [операция, ...аргументы].
const RECIPES = [
  { kind: "rgb", base: "sky_zenith", suffix: "col", expr: ["zenith"] },
  {
    kind: "rgb",
    base: "sky_zenith_transition",
    suffix: "col",
    expr: ["mixRgb", ["zenith"], ["horizon"], 0.55],
  },
  {
    kind: "rgb",
    base: "sky_azimuth_east",
    suffix: "col",
    expr: [
      "mixRgb",
      ["horizon"],
      ["sun"],
      [
        "mul",
        ["mul", ["clamp", ["sub", 1, ["div", "frame", 5]]], 0.45],
        ["clamp", ["sub", 1, ["mul", ["abs", "elevation"], 2]]],
      ],
    ],
  },
  {
    kind: "rgb",
    base: "sky_azimuth_west",
    suffix: "col",
    expr: [
      "mixRgb",
      ["horizon"],
      ["sun"],
      [
        "mul",
        ["mul", ["clamp", ["div", ["sub", "frame", 6], 5]], 0.5],
        ["clamp", ["sub", 1, ["mul", ["abs", "elevation"], 2]]],
      ],
    ],
  },
  { kind: "rgb", base: "sky_azimuth_transition", suffix: "col", expr: ["horizon"] },
  { kind: "scalar", name: "sky_zenith_col_inten", expr: 1 },
  { kind: "scalar", name: "sky_zenith_transition_col_inten", expr: 1 },
  { kind: "scalar", name: "sky_azimuth_east_col_inten", expr: 1 },
  { kind: "scalar", name: "sky_azimuth_west_col_inten", expr: 1 },
  { kind: "scalar", name: "sky_azimuth_transition_col_inten", expr: 1 },
  { kind: "scalar", name: "sky_zenith_transition_position", expr: 0.42 },
  { kind: "scalar", name: "sky_zenith_blend_start", expr: 0.05 },
  { kind: "scalar", name: "sky_zenith_transition_east_blend", expr: 0.6 },
  { kind: "scalar", name: "sky_zenith_transition_west_blend", expr: 0.6 },
  { kind: "scalar", name: "sky_azimuth_transition_position", expr: 0.5 },
  {
    kind: "scalar",
    name: "sky_hdr",
    expr: ["mul", ["mix", 0.3, 30, ["pow", "day", 0.8]], ["mix", 0.6, 1, "clarity"]],
  },
  { kind: "rgb", base: "sky_sun", suffix: "col", expr: ["sun"] },
  { kind: "rgb", base: "sky_sun_disc", suffix: "col", expr: ["scaleRgb", ["sun"], 1.25] },
  { kind: "scalar", name: "sky_sun_disc_size", expr: ["mix", 2.5, 2, "day"] },
  { kind: "scalar", name: "sky_sun_hdr", expr: ["mul", ["mix", 5, 220, ["pow", "day", 0.7]], "clarity"] },
  { kind: "scalar", name: "sky_sun_miephase", expr: 0.72 },
  { kind: "scalar", name: "sky_sun_miescatter", expr: 1.7 },
  { kind: "scalar", name: "sky_sun_mie_intensity_mult", expr: ["mix", 0.4, 1.15, ["add", "twilight", "day"]] },
  { kind: "scalar", name: "sky_sun_influence_radius", expr: ["mix", 20, 95, "twilight"] },
  { kind: "scalar", name: "sky_sun_scatter_inten", expr: ["mul", ["mix", 0.35, 1.25, "twilight"], "clarity"] },
  { kind: "rgb", base: "sky_moon", suffix: "col", expr: ["rgb", 0.68, 0.74, 0.95] },
  { kind: "scalar", name: "sky_moon_disc_size", expr: 3 },
  { kind: "scalar", name: "sky_moon_iten", expr: ["mix", 0.2, 2, "night"] },
  { kind: "scalar", name: "sky_moon_influence_radius", expr: 90 },
  { kind: "scalar", name: "sky_moon_scatter_inten", expr: ["mul", "night", 0.6] },
  { kind: "scalar", name: "sky_stars_iten", expr: ["mul", 0.5, ["clamp", ["sub", 1.15, "clouds"]]] },
  {
    kind: "rgb",
    base: "sky_cloud_base",
    suffix: "col",
    expr: ["scaleRgb", ["mixRgb", ["horizon"], ["rgb", 1, 1, 1], 0.4], ["cloudLight"]],
  },
  {
    kind: "rgb",
    base: "sky_cloud_mid",
    suffix: "col",
    expr: ["scaleRgb", ["mixRgb", ["zenith"], ["rgb", 0.85, 0.87, 0.92], 0.55], ["cloudLight"]],
  },
  {
    kind: "rgb",
    base: "sky_cloud_shadow",
    suffix: "col",
    expr: ["scaleRgb", ["zenith"], ["mul", 0.55, ["cloudLight"]]],
  },
  { kind: "scalar", name: "sky_cloud_base_strength", expr: 1 },
  { kind: "scalar", name: "sky_cloud_shadow_strength", expr: 1 },
  { kind: "scalar", name: "sky_cloud_density_mult", expr: ["mix", 2.8, 4.4, "clouds"] },
  { kind: "scalar", name: "sky_cloud_density_bias", expr: ["mix", 0.86, 0.92, "clouds"] },
  { kind: "scalar", name: "sky_cloud_overall_strength", expr: ["mix", 0.16, 0.78, "clouds"] },
  { kind: "scalar", name: "sky_cloud_overall_color", expr: ["mix", 0.6, 1, "clouds"] },
  { kind: "scalar", name: "sky_cloud_edge_strength", expr: ["mix", 0.5, 0.25, "clouds"] },
  { kind: "scalar", name: "sky_cloud_fadeout", expr: ["mix", 0, 0.52, "day"] },
  {
    kind: "scalar",
    name: "sky_cloud_hdr",
    expr: ["mul", ["mix", 0.5, 24, "day"], ["mix", 0.6, 1, "clarity"]],
  },
  { kind: "scalar", name: "sky_cloud_gen_frequency", expr: 2 },
  { kind: "scalar", name: "sky_cloud_gen_scale", expr: 48 },
  { kind: "scalar", name: "sky_cloud_gen_threshold", expr: ["mix", 0.74, 0.28, "clouds"] },
  { kind: "scalar", name: "sky_cloud_gen_softness", expr: ["mix", 0.29, 0.3, "clouds"] },
  { kind: "scalar", name: "sky_cloud_gen_density_offset", expr: 0 },
  { kind: "scalar", name: "sky_cloud_offset", expr: 0.1 },
  {
    kind: "rgb",
    base: "sky_small_cloud",
    suffix: "col",
    expr: ["scaleRgb", ["mixRgb", ["horizon"], ["rgb", 1, 1, 1], 0.55], ["cloudLight"]],
  },
  { kind: "scalar", name: "sky_small_cloud_density_mult", expr: ["mix", 0.2, 0.9, "clouds"] },
  { kind: "scalar", name: "sky_small_cloud_detail_strength", expr: 0.5 },
  { kind: "scalar", name: "sky_small_cloud_detail_scale", expr: 1.2 },
  { kind: "rgb", base: "fog", suffix: "col", expr: ["fog"] },
  { kind: "rgb", base: "fog_near", suffix: "col", expr: ["scaleRgb", ["fog"], 1.1] },
  { kind: "rgb", base: "fog_east", suffix: "col", expr: ["mixRgb", ["fog"], ["sun"], 0.3] },
  { kind: "rgb", base: "fog_moon", suffix: "col", expr: ["rgb", 0.35, 0.42, 0.6] },
  {
    kind: "rgb",
    base: "fog_haze",
    suffix: "col",
    expr: ["scaleRgb", ["mixRgb", ["fog"], ["rgb", 0.8, 0.83, 0.88], 0.4], 0.09],
  },
  { kind: "scalar", name: "fog_col_a", expr: 1 },
  { kind: "scalar", name: "fog_near_col_a", expr: 1 },
  { kind: "scalar", name: "fog_east_col_a", expr: 1 },
  { kind: "scalar", name: "fog_moon_col_a", expr: 1 },
  {
    kind: "scalar",
    name: "fog_density",
    expr: ["mul", ["mix", 3, 24, ["clamp", ["div", "haze", 1.8]]], ["mix", 1.4, 0.6, "day"]],
  },
  { kind: "scalar", name: "fog_start", expr: ["mix", 180, 40, ["clamp", ["div", "haze", 1.8]]] },
  { kind: "scalar", name: "fog_falloff", expr: 55 },
  { kind: "scalar", name: "fog_hdr", expr: ["mix", 0.2, 13, "day"] },
  { kind: "scalar", name: "fog_alpha", expr: 1 },
  { kind: "scalar", name: "fog_horizon_tint_scale", expr: ["mix", 9, 1.8, "day"] },
  {
    kind: "scalar",
    name: "fog_haze_density",
    expr: ["mul", ["mix", 3.5, 5, ["clamp", ["div", "haze", 1.8]]], "regionHaze"],
  },
  { kind: "scalar", name: "fog_haze_alpha", expr: 1 },
  { kind: "scalar", name: "fog_haze_start", expr: 60 },
  {
    kind: "scalar",
    name: "fog_haze_hdr",
    expr: ["mul", ["mix", 0.2, 18, "day"], ["clamp", ["div", "haze", 1.2], 0.35, 1.6]],
  },
  { kind: "rgb", base: "light_dir", suffix: "col", expr: ["sun"] },
  { kind: "scalar", name: "light_dir_mult", expr: ["mul", ["mix", 0, 52, "day"], "clarity"] },
  {
    kind: "rgb",
    base: "light_directional_amb",
    suffix: "col",
    expr: ["mixRgb", ["zenith"], ["rgb", 0.6, 0.68, 0.85], 0.5],
  },
  {
    kind: "scalar",
    name: "light_directional_amb_intensity",
    expr: ["mul", ["mix", 0.08, 1, "day"], "regionAmbient"],
  },
  {
    kind: "rgb",
    base: "light_natural_amb_up",
    suffix: "col",
    expr: ["mixRgb", ["zenith"], ["rgb", 0.55, 0.66, 0.9], 0.55],
  },
  {
    kind: "scalar",
    name: "light_natural_amb_up_intensity",
    expr: ["mul", ["mix", 0.05, 2.4, "day"], "regionAmbient"],
  },
  {
    kind: "rgb",
    base: "light_natural_amb_down",
    suffix: "col",
    expr: ["mixRgb", ["horizon"], ["rgb", 0.4, 0.42, 0.45], 0.5],
  },
  {
    kind: "scalar",
    name: "light_natural_amb_down_intensity",
    expr: ["mul", ["mix", 0.04, 1.8, "day"], "regionAmbient"],
  },
  { kind: "rgb", base: "light_artificial_ext_up", suffix: "col", expr: ["rgb", 1, 0.62, 0.24] },
  {
    kind: "scalar",
    name: "light_artificial_ext_up_intensity",
    expr: ["mul", ["mul", "night", 0.5], "regionAmbient"],
  },
  { kind: "rgb", base: "light_artificial_ext_down", suffix: "col", expr: ["rgb", 1, 0.55, 0.18] },
  {
    kind: "scalar",
    name: "light_artificial_ext_down_intensity",
    expr: ["mul", ["mul", "night", 0.45], "regionAmbient"],
  },
  { kind: "scalar", name: "postfx_exposure", expr: "exposure" },
  { kind: "scalar", name: "postfx_exposure_min", expr: -3.5 },
  { kind: "scalar", name: "postfx_exposure_max", expr: 5 },
  { kind: "scalar", name: "postfx_intensity_bloom", expr: ["mix", 0.35, 1.1, "day"] },
  { kind: "scalar", name: "postfx_bright_pass_thresh", expr: 1.1 },
  { kind: "scalar", name: "postfx_desaturation", expr: ["mix", 1, 0.88, ["sub", 1, "clarity"]] },
  { kind: "scalar", name: "far_clip", expr: ["mix", 12000, 4200, ["clamp", ["div", "haze", 1.8]]] },
  { kind: "scalar", name: "temperature", expr: ["sub", ["mix", 11, 26, "day"], ["mul", "clouds", 4]] },
  { kind: "scalar", name: "wind_speed_mult", expr: ["mix", 0.2, 1.4, "clouds"] },
];

// ---- арифметика над числами и цветами (порядок действий важен до последнего бита) ----

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (x, lo = 0, hi = 1) => Math.min(Math.max(x, lo), hi);
const mixRgb = (from, to, t) => from.map((c, i) => mix(c, to[i], t));
const scaleRgb = (colour, factor) => colour.map((c) => c * factor);
const tintRgb = (colour, tint) => colour.map((c, i) => c * tint[i]);

const smoothStep = (edge0, edge1, v) => {
  const t = clamp((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const OPERATIONS = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  abs: Math.abs,
  pow: (a, b) => a ** b,
  rgb: (r, g, b) => [r, g, b],
  mix,
  clamp,
  mixRgb,
  scaleRgb,
};

function evaluate(expr, scope) {
  if (typeof expr === "number") return expr;
  if (typeof expr === "string") return scope[expr];
  const [name, ...args] = expr;
  if (args.length === 0) return scope[name];
  return OPERATIONS[name](...args.map((arg) => evaluate(arg, scope)));
}

// ---- кадры суток: вес дня, сумерек и ночи по высоте солнца ----

const FRAMES = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
  const { hour } = TIMECYCLE_SAMPLES[index];
  const elevation = celestialDirections(hour).sun.z;
  const eveningBias = clamp((hour - 11) / 9);
  return {
    index,
    elevation,
    day: smoothStep(-0.15, 0.45, elevation),
    twilight: Math.exp(-((elevation / 0.2) ** 2)),
    night: 1 - smoothStep(-0.25, 0.1, elevation),
    warmth: 1 + eveningBias * 0.14,
  };
});

const blendByElevation = (frame, [night, twilight, day]) =>
  mixRgb(mixRgb(night, day, frame.day), twilight, frame.twilight * 0.75);

const average = ([r, g, b]) => (r + g + b) / 3;

// Цвета кадра: зенит, горизонт, солнце, туман и свет облаков.
function frameColours(frame, profile, tweak) {
  const { clarity, haze, tint } = profile;
  const w = frame.warmth;

  const zenithBase = blendByElevation(frame, PALETTE.zenith);
  const grey = average(zenithBase);
  const muted = mixRgb(zenithBase, [grey, grey, grey], (1 - clarity) * 0.6);
  const zenith = tintRgb(mixRgb(muted, scaleRgb(muted, 0.6), 1 - clarity), tint);

  const hazeTint = mixRgb([0.55, 0.58, 0.62], [0.3, 0.32, 0.36], 1 - clarity);
  const hazy = mixRgb(blendByElevation(frame, PALETTE.horizon), hazeTint, clamp(haze * 0.32, 0, 0.75));
  const horizon = tintRgb(scaleRgb([hazy[0] * w, hazy[1], hazy[2] / w], tweak.warmth), tint);

  const sunBase = blendByElevation(frame, PALETTE.sun);
  const sun = tintRgb([sunBase[0], sunBase[1] / (w ** 0.5), sunBase[2] / w], tint);

  return {
    zenith,
    horizon,
    sun,
    fog: mixRgb(horizon, [0.62, 0.66, 0.72], 0.35 * frame.day),
    cloudLight: (0.12 + 0.88 * frame.day) * mix(0.4, 1, clarity),
  };
}

// Кривые моделируемых параметров одной области: имя → 13 чисел.
function modelledCurves(profile, tweak) {
  const curves = new Map();
  const sink = (name) => {
    if (!curves.has(name)) curves.set(name, []);
    return curves.get(name);
  };
  for (const frame of FRAMES) {
    const scope = {
      frame: frame.index,
      elevation: frame.elevation,
      day: frame.day,
      twilight: frame.twilight,
      night: frame.night,
      clarity: profile.clarity,
      clouds: profile.clouds,
      haze: profile.haze,
      exposure: profile.exposure,
      regionHaze: tweak.haze,
      regionAmbient: tweak.ambient,
      ...frameColours(frame, profile, tweak),
    };
    for (const recipe of RECIPES) {
      const result = evaluate(recipe.expr, scope);
      if (recipe.kind === "scalar") {
        sink(recipe.name).push(result);
      } else {
        ["r", "g", "b"].forEach((channel, i) => {
          sink(`${recipe.base}_${recipe.suffix}_${channel}`).push(result[i]);
        });
      }
    }
  }
  return curves;
}

// ---- нейтральные значения для параметров, которые модуль не моделирует ----

const COLOUR_CHANNEL_ENDINGS = ["_col_", "_colour_", "_color_"].flatMap((stem) =>
  ["r", "g", "b"].map((channel) => stem + channel),
);

const NEUTRAL_RULES = [
  [(name) => ["_mult", "_multiplier", "_scale", "_intensity_mult"].some((s) => name.endsWith(s)), 1],
  [(name) => name.startsWith("enable_") || name === "render_exterior" || name === "water_reflection", 1],
  [(name) => COLOUR_CHANNEL_ENDINGS.some((s) => name.endsWith(s)), 1],
  [(name) => name.startsWith("lod_mult_"), 1],
  [(name) => name.startsWith("postfx_tonemap_filmic_w"), 11.2],
];

const neutralValue = (name) => NEUTRAL_RULES.find(([applies]) => applies(name))?.[1] ?? 0;

// ---- сборка документа ----

function buildValues(profile, tweak) {
  const curves = modelledCurves(profile, tweak);
  return Object.freeze(
    Object.fromEntries(
      KEYFRAME_PARAMETER_NAMES.map((name) => [
        name,
        curves.get(name) ?? new Array(SAMPLE_COUNT).fill(neutralValue(name)),
      ]),
    ),
  );
}

function buildDocument(weatherId) {
  const profile = PROFILES.get(weatherId);
  return Object.freeze({
    version: DOCUMENT_VERSION,
    rootAttributes: { version: DOCUMENT_VERSION },
    cycleName: weatherId,
    cycleAttributes: { name: weatherId, regions: String(TIMECYCLE_REGIONS.length) },
    source: "reference",
    regions: Object.freeze(
      TIMECYCLE_REGIONS.map(({ id }) =>
        Object.freeze({
          name: id,
          attributes: { name: id },
          order: [...KEYFRAME_PARAMETER_NAMES],
          values: buildValues(profile, REGION_TWEAKS[id]),
        }),
      ),
    ),
  });
}

const documents = new Map();

export function referenceKeyframeDocument(weatherId) {
  const weather = findWeather(weatherId);
  if (!weather) throw new Error(`Неизвестный тип погоды: ${weatherId}`);
  if (!documents.has(weather.id)) documents.set(weather.id, buildDocument(weather.id));
  return documents.get(weather.id);
}
