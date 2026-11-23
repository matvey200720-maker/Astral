// Расчёт неба на выбранный час: состояние неба по документу, правкам, погоде и области,
// яркость и экспозиция, тональные кривые и цвета-образцы.
import { TIMECYCLE_SAMPLES, celestialDirections, sampleAtHour } from "./samples.js";
import { readParameter } from "./project.js";
import { findRegion } from "./keyframe-xml.js";

const words = (text) => text.trim().split(/\s+/);

// ---- константы освещения и экспозиции ----

export const SCENE_LIGHT = Object.freeze(Object.fromEntries([["ambient", 4.8], ["direct", 0.38], ["albedo", 0.2], ["groundShare", 0.38]]));

const CURVE_ROWS = [["scale", -106.2], ["power", 0.007], ["offset", 104.7]];

export const GAME_EXPOSURE_CURVE = Object.freeze(Object.fromEntries(CURVE_ROWS));
export const GAME_EXPOSURE_MIN = -3.5;

// Альбедо земли для кадра игры — отдельное число, не из SCENE_LIGHT.
const GAME_GROUND_ALBEDO = 0.2;

// Коэффициенты плёночной кривой игры a…f и белая точка.
const [FILM_A, FILM_B, FILM_C, FILM_D, FILM_E, FILM_F, FILM_WHITE_POINT] = [0.22, 0.3, 0.1, 0.2, 0.01, 0.3, 4];

// Поля состояния в порядке чтения: [способ, поле, ...что читать].
//   s — число; p — число, которое считается только строго больше нуля;
//   c3 — цвет из трёх каналов; c4i — цвет и множитель _inten;
//   c4a — цвет и альфа; v4 — четыре числа; special — собирается отдельно.
const STATE_FIELDS = [
  ["s", "hdrIntensity", "sky_hdr", 1],
  ["c4i", "zenithColour", "sky_zenith_col", [0.05, 0.15, 0.4]],
  ["c4i", "zenithTransitionColour", "sky_zenith_transition_col", [0.2, 0.35, 0.6]],
  ["c4i", "azimuthEastColour", "sky_azimuth_east_col", [0.4, 0.5, 0.7]],
  ["c4i", "azimuthWestColour", "sky_azimuth_west_col", [0.4, 0.5, 0.7]],
  ["c4i", "azimuthTransitionColour", "sky_azimuth_transition_col", [0.4, 0.5, 0.7]],
  ["s", "azimuthTransitionPosition", "sky_azimuth_transition_position", 0.5],
  [
    "v4",
    "zenithConstants",
    [
      ["sky_zenith_blend_start", 0.05],
      ["sky_zenith_transition_east_blend", 0.5],
      ["sky_zenith_transition_west_blend", 0.5],
      ["sky_zenith_transition_position", 0.4],
    ],
  ],
  ["special", "sunColourHdr"],
  ["special", "sunConstants"],
  ["special", "sunDiscColour"],
  ["s", "sunDiscSize", "sky_sun_disc_size", 6],
  ["c3", "moonColour", "sky_moon_col", [0.7, 0.75, 0.95]],
  ["s", "moonDiscSize", "sky_moon_disc_size", 8],
  ["s", "moonIntensity", "sky_moon_iten", 0],
  ["s", "moonScatterIntensity", "sky_moon_scatter_inten", 0],
  ["s", "moonInfluenceRadius", "sky_moon_influence_radius", 300],
  ["s", "starsIntensity", "sky_stars_iten", 0],
  ["c3", "cloudBaseColour", "sky_cloud_base_col", [0.8, 0.8, 0.85]],
  ["c3", "cloudMidColour", "sky_cloud_mid_col", [0.6, 0.62, 0.7]],
  ["c3", "cloudShadowColour", "sky_cloud_shadow_col", [0.3, 0.32, 0.4]],
  ["s", "cloudBaseStrength", "sky_cloud_base_strength", 1],
  ["s", "cloudShadowStrength", "sky_cloud_shadow_strength", 1],
  ["s", "cloudDensity", "sky_cloud_density_mult", 0.5],
  ["s", "cloudDensityBias", "sky_cloud_density_bias", 0],
  ["s", "cloudStrength", "sky_cloud_overall_strength", 0.5],
  ["s", "cloudOverallColour", "sky_cloud_overall_color", 0],
  ["s", "cloudHdr", "sky_cloud_hdr", 1],
  ["s", "cloudFadeout", "sky_cloud_fadeout", 0.25],
  ["s", "cloudEdgeStrength", "sky_cloud_edge_strength", 0.5],
  ["s", "cloudOffset", "sky_cloud_offset", 0.1],
  ["s", "cloudGenFrequency", "sky_cloud_gen_frequency", 2],
  ["s", "cloudGenScale", "sky_cloud_gen_scale", 60],
  ["s", "cloudGenThreshold", "sky_cloud_gen_threshold", 0.4],
  ["s", "cloudGenSoftness", "sky_cloud_gen_softness", 0.4],
  ["s", "cloudGenDensityOffset", "sky_cloud_gen_density_offset", 0],
  ["c3", "smallCloudColour", "sky_small_cloud_col", [0.85, 0.87, 0.9]],
  ["s", "smallCloudDensity", "sky_small_cloud_density_mult", 0.3],
  ["c4a", "fogColour", "fog_col", [0.5, 0.55, 0.6], "fog_col_a", 1],
  ["c3", "fogNearColour", "fog_near_col", [0.5, 0.55, 0.6]],
  ["c3", "fogEastColour", "fog_east_col", [0.5, 0.55, 0.6]],
  ["c4a", "fogMoonColour", "fog_moon_col", [0.1, 0.12, 0.18], "fog_moon_col_a", 1],
  ["p", "fogSunPower", "fog_sun_lighting_calc_pow", 8],
  ["p", "fogMoonPower", "fog_moon_lighting_calc_pow", 18],
  ["s", "fogFalloff", "fog_falloff", 5],
  ["s", "fogAlpha", "fog_alpha", 1],
  ["c3", "fogHazeColour", "fog_haze_col", [0.6, 0.63, 0.68]],
  ["s", "fogHazeDensity", "fog_haze_density", 0.2],
  ["s", "fogHazeAlpha", "fog_haze_alpha", 0.4],
  ["s", "fogDensity", "fog_density", 0.1],
  ["s", "fogHdr", "fog_hdr", 1],
  ["s", "fogHazeHdr", "fog_haze_hdr", 1],
  ["s", "horizonTintScale", "fog_horizon_tint_scale", 0.75],
  ["c3", "lightDirColour", "light_dir_col", [1, 1, 1]],
  ["s", "lightDirIntensity", "light_dir_mult", 1],
  ["c3", "ambientUpColour", "light_natural_amb_up_col", [0.4, 0.5, 0.7]],
  ["s", "ambientUpIntensity", "light_natural_amb_up_intensity", 1],
  ["c3", "ambientDownColour", "light_natural_amb_down_col", [0.25, 0.26, 0.3]],
  ["s", "ambientDownIntensity", "light_natural_amb_down_intensity", 1],
  ["c3", "artificialColour", "light_artificial_ext_up_col", [1, 0.6, 0.25]],
  ["s", "artificialIntensity", "light_artificial_ext_up_intensity", 0],
  ["special", "tonemap"],
  ["s", "bloomIntensity", "postfx_intensity_bloom", 0.2],
  ["s", "bloomThreshold", "postfx_bright_pass_thresh", 1.1],
  ["s", "exposure", "postfx_exposure", 0],
  ["s", "exposureMin", "postfx_exposure_min", -3.5],
  ["s", "exposureMax", "postfx_exposure_max", 5],
  ["s", "saturation", "postfx_desaturation", 1],
];

// Части купола: [поле, основа имени цвета, запасной цвет]; цвет в квадрате и умножен на _inten.
const DOME_PARTS = [
  ["zenith", "sky_zenith_col", [0.05, 0.15, 0.4]],
  ["zenithTransition", "sky_zenith_transition_col", [0.2, 0.35, 0.6]],
  ["east", "sky_azimuth_east_col", [0.4, 0.5, 0.7]],
  ["west", "sky_azimuth_west_col", [0.4, 0.5, 0.7]],
  ["transition", "sky_azimuth_transition_col", [0.4, 0.5, 0.7]],
];

// Части купола, где цвет только в квадрате.
const DOME_SQUARES = [
  ["moonColour", "sky_moon_col", [0.7, 0.75, 0.95]],
  ["cloudBase", "sky_cloud_base_col", [0.8, 0.8, 0.85]],
  ["cloudMid", "sky_cloud_mid_col", [0.6, 0.62, 0.7]],
  ["cloudShadow", "sky_cloud_shadow_col", [0.3, 0.32, 0.4]],
];

const STATE_KEY_ORDER = words(`
  hour region dome sunDirection moonDirection hdrIntensity zenithColour zenithTransitionColour
  azimuthEastColour azimuthWestColour azimuthTransitionColour azimuthTransitionPosition
  zenithConstants sunColourHdr sunConstants sunDiscColour sunDiscSize moonColour moonDiscSize
  moonIntensity moonScatterIntensity moonInfluenceRadius starsIntensity cloudBaseColour
  cloudMidColour cloudShadowColour cloudBaseStrength cloudShadowStrength cloudDensity
  cloudDensityBias cloudStrength cloudOverallColour cloudHdr cloudFadeout cloudEdgeStrength
  cloudOffset cloudGenFrequency cloudGenScale cloudGenThreshold cloudGenSoftness
  cloudGenDensityOffset smallCloudColour smallCloudDensity fogColour fogNearColour fogEastColour
  fogMoonColour fogSunPower fogMoonPower fogFalloff fogAlpha fogHazeColour fogHazeDensity
  fogHazeAlpha fogDensity fogHdr fogHazeHdr horizonTintScale lightDirColour lightDirIntensity
  ambientUpColour ambientUpIntensity ambientDownColour ambientDownIntensity artificialColour
  artificialIntensity tonemap bloomIntensity bloomThreshold exposure exposureMin exposureMax
  saturation
`);

// Блоки чтения: [параметр, запасное значение].
const SUN_READS = [
  ["sky_sun_miephase", 0.7],
  ["sky_sun_miescatter", 1.7],
  ["sky_sun_mie_intensity_mult", 1],
  ["sky_sun_influence_radius", 800],
];
const DOME_MIE_READS = [
  ["sky_sun_miephase", 0.948],
  ["sky_sun_miescatter", 1],
];
const DOME_ZENITH_READS = [
  ["sky_zenith_transition_position", 0.4],
  ["sky_zenith_transition_east_blend", 0.5],
  ["sky_zenith_transition_west_blend", 0.5],
  ["sky_zenith_blend_start", 0],
];

// Наборы плёночной кривой: [ключ, хвост у признака и экспозиции, хвост у коэффициентов].
const FILMIC_SETS = [
  ["bright", "_bright", "_bright"],
  ["dark", "_dark", ""],
];
const FILMIC_COEFFICIENTS = words("a b c d e f w");

const WHITE = [1, 1, 1];

// ---- общие помощники ----

const clamp = (x, lo = 0, hi = 1) => Math.min(Math.max(x, lo), hi);
const square = (c) => c * c;
const toByte = (channel) => Math.round(channel * 255);

// x * (p * x + q) + r
const quadratic = (p, q, r) => (x) => x * (p * x + q) + r;

const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722];
const luma = (colour) => LUMA_WEIGHTS.map((weight, i) => colour[i] * weight).reduce((a, b) => a + b);

// ---- чтение чисел из правок проекта и документа ----

function makeReader({ source, project, weather, region, hour }) {
  const stored = (parameter) => {
    const found = source?.values?.[parameter];
    return Array.isArray(found) ? found : null;
  };
  return (parameter, fallback = 0) => {
    const edit = project ? readParameter(project, { weather, region, parameter }) : null;
    const samples = edit || stored(parameter);
    return samples ? sampleAtHour(samples, hour) : fallback;
  };
}

const readAll = (read, table) => table.map(([name, fallback]) => read(name, fallback));
const readTriple = (read, base, fallback) =>
  fallback.map((value, i) => read(`${base}_${"rgb"[i]}`, value));

const READERS = {
  s: (read, param, fallback) => read(param, fallback),
  p: (read, param, fallback) => {
    const value = read(param, fallback);
    return value > 0 ? value : fallback;
  },
  c3: (read, base, fallback) => readTriple(read, base, fallback),
  c4i: (read, base, fallback) => [...readTriple(read, base, fallback), read(`${base}_inten`, 1)],
  c4a: (read, base, fallback, alpha, alphaFallback) => [
    ...readTriple(read, base, fallback),
    read(alpha, alphaFallback),
  ],
  v4: (read, table) => readAll(read, table),
};

// Цвет солнца: каналы, к каждому применяется curve, затем умножение на яркость солнца.
const sunGlow = (read, base, sunHdr, curve = (c) => c) =>
  readTriple(read, base, WHITE).map((c) => curve(c) * sunHdr);

const sunConstants = (read) => {
  const [phase, scatter, intensity, radius] = readAll(read, SUN_READS);
  return [phase * scatter, scatter, 0.00003 * radius, intensity];
};

const readFilmicSet = (read, flagTail, coefficientTail) => {
  const named = (field, tail) => read(`postfx_tonemap_filmic_${field}${tail}`);
  return Object.fromEntries([
    ["override", named("override", flagTail) > 0],
    ["exposure", named("exposure", flagTail)],
    ...FILMIC_COEFFICIENTS.map((key) => [key, named(key, coefficientTail)]),
  ]);
};

// Поля kind: "special", которые остались после предварительного прохода по солнцу.
const SPECIAL_READERS = {
  sunDiscColour: (read, sunHdr) => sunGlow(read, "sky_sun_disc_col", sunHdr),
  tonemap: (read) =>
    Object.fromEntries(
      FILMIC_SETS.map(([key, flagTail, coefficientTail]) => [
        key,
        readFilmicSet(read, flagTail, coefficientTail),
      ]),
    ),
};

// Числа для шейдера купола: цвета уже в квадрате, запасные значения другие, чем наверху.
function buildDome(read, sunHdr) {
  const [phase, scatter] = readAll(read, DOME_MIE_READS);
  const g = (phase + 0.98) / 2;
  const gg = g * g;
  const dome = {};
  for (const [field, base, fallback] of DOME_PARTS) {
    dome[field] = readTriple(read, base, fallback).map((c) => square(c) * read(`${base}_inten`, 1));
  }
  dome.sunColourHdr = sunGlow(read, "sky_sun_col", sunHdr, square);
  dome.sunDiscColour = sunGlow(read, "sky_sun_disc_col", sunHdr, square);
  dome.sunConstants = [
    2 * g,
    1 + gg,
    scatter * 1e-3 * ((3 * (1 - gg)) / (2 * (2 + gg))),
    read("sky_sun_mie_intensity_mult", 1),
  ];
  const [position, eastBlend, westBlend, blendStart] = readAll(read, DOME_ZENITH_READS);
  dome.zenithConstants = [position, eastBlend, westBlend, 1 - blendStart];
  for (const [field, base, fallback] of DOME_SQUARES) {
    dome[field] = readTriple(read, base, fallback).map(square);
  }
  dome.stars = read("sky_stars_iten", 0);
  return dome;
}

// Шаги сборки состояния: каждый дописывает поля в накопитель; ctx хранит общие значения.
const SKY_STEPS = [
  (ctx, out) => {
    out.hdrIntensity = ctx.read("sky_hdr", 1);
    ctx.sunHdr = ctx.read("sky_sun_hdr", 1);
  },
  (ctx, out) => {
    out.sunColourHdr = sunGlow(ctx.read, "sky_sun_col", ctx.sunHdr);
    out.sunConstants = sunConstants(ctx.read);
  },
  (ctx, out) => {
    out.dome = buildDome(ctx.read, ctx.sunHdr);
  },
  (ctx, out) => {
    for (const [kind, field, ...args] of STATE_FIELDS) {
      if (field in out) continue;
      out[field] =
        kind === "special"
          ? SPECIAL_READERS[field](ctx.read, ctx.sunHdr)
          : READERS[kind](ctx.read, ...args);
    }
  },
  (ctx, out) => {
    const { sun, moon } = celestialDirections(ctx.hour);
    Object.assign(out, {
      hour: ctx.hour,
      region: ctx.regionName,
      sunDirection: sun,
      moonDirection: moon,
    });
  },
];

export function resolveSkyState({ document, project, weather, region = "GLOBAL", hour = 12 }) {
  const source = findRegion(document, region) ?? document?.regions?.[0] ?? null;
  const regionName = source?.name || region;
  const read = makeReader({ source, project, weather, region: regionName, hour });
  const ctx = { read, hour, regionName, sunHdr: 1 };
  const out = {};
  SKY_STEPS.forEach((step) => step(ctx, out));
  return Object.fromEntries(STATE_KEY_ORDER.map((key) => [key, out[key]]));
}

// ---- яркость и экспозиция ----

// Яркость источника: цвет, умноженный на неотрицательную силу (и на вес, если он есть).
const emitted = (colour, strength, weight = 1) => luma(colour) * Math.max(strength, 0) * weight;

const ambientLight = (state) =>
  emitted(state.ambientUpColour, state.ambientUpIntensity) +
  emitted(state.ambientDownColour, state.ambientDownIntensity);

const directLight = (state, facing) => emitted(state.lightDirColour, state.lightDirIntensity, facing);

export function skyLuminance(state) {
  const zenith = luma(state.zenithColour) * 0.5;
  const horizon = luma(state.azimuthTransitionColour) * 0.5;
  return (zenith + horizon) * Math.max(state.hdrIntensity, 0.001);
}

const { ambient: AMBIENT_GAIN, direct: DIRECT_GAIN, albedo: ALBEDO, groundShare } = SCENE_LIGHT;

export function autoExposureStops(state) {
  const sky = skyLuminance(state);
  const ambient = ambientLight(state);
  const direct = directLight(state, Math.max(state.sunDirection?.z || 0, 0));
  const ground = (ambient * 0.5 * AMBIENT_GAIN + direct * DIRECT_GAIN) * ALBEDO;
  const key = sky * (1 - groundShare) + ground * groundShare;
  return clamp(Math.log2(0.28 / Math.max(key, 1e-4)) * 0.85, -5, 3.6);
}

export function gameFrameLuminance(state) {
  if (!state?.dome) return 1;
  const { dome } = state;
  const sky =
    luma(dome.zenith.map((z, i) => (z + dome.transition[i]) / 2)) * Math.max(state.hdrIntensity, 0);
  const ambient = ambientLight(state) / 2;
  const sunZ = state.sunDirection.z;
  const facing = sunZ > 0 ? sunZ : Math.max(state.moonDirection.z, 0);
  return 0.5 * sky + 0.5 * GAME_GROUND_ALBEDO * (directLight(state, facing) + ambient);
}

// Предел из состояния, если число конечное (null и [] приводятся к 0), иначе запасной.
const limitOr = (raw, fallback) => {
  const number = Number(raw);
  return Number.isFinite(number) ? number : fallback;
};

export function gameExposureEv(state) {
  const frame = Math.max(gameFrameLuminance(state), 1e-6);
  const { scale, power, offset } = GAME_EXPOSURE_CURVE;
  const target = scale * frame ** power + offset + (Number(state?.exposure) || 0);
  const low = limitOr(state?.exposureMin, GAME_EXPOSURE_MIN);
  const high = limitOr(state?.exposureMax, 5);
  return clamp(target, low, Math.max(low, high));
}

export const GAME_EXPOSURE_OFFSET = 0.25;

export function gameExposureStops(state) {
  return gameExposureEv(state) + GAME_EXPOSURE_OFFSET;
}

// ---- тональные кривые ----

const previewTop = quadratic(2.51, 0.03, 0);
const previewBottom = quadratic(2.43, 0.59, 0.14);
const previewCurve = (v) => previewTop(v) / previewBottom(v);

const filmicTop = quadratic(FILM_A, FILM_C * FILM_B, FILM_D * FILM_E);
const filmicBottom = quadratic(FILM_A, FILM_B, FILM_D * FILM_F);
const filmicCurve = (x) => filmicTop(x) / filmicBottom(x) - FILM_E / FILM_F;
const FILMIC_WHITE = filmicCurve(FILM_WHITE_POINT);
const gameCurve = (v) => filmicCurve(v) / FILMIC_WHITE;

function applyCurve(rgb, stops, curve) {
  const gain = 2 ** stops;
  return rgb.map((channel) => clamp(curve(Math.max(channel * gain, 0))) ** (1 / 2.2));
}

export function tonemapPreview(rgb, stops = 0) {
  return applyCurve(rgb, stops, previewCurve);
}

export function tonemapGame(rgb, stops = 0) {
  return applyCurve(rgb, stops, gameCurve);
}

// ---- суточные величины и цвета-образцы ----

// Три канала: первый цвет с весом 0.45, второй с весом 0.55, умноженные на яркость неба.
function blendedSky(state, first, second) {
  const brightness = Math.max(state.hdrIntensity, 0.001);
  return [0, 1, 2].map((i) => (first[i] * 0.45 + second[i] * 0.55) * brightness);
}

const domeSky = (state) => blendedSky(state, state.dome.zenith, state.dome.transition);
const fieldSky = (state) => blendedSky(state, state.zenithColour, state.azimuthTransitionColour);

// Состояния на каждый из 13 кадров суток, по одному.
function* daySkyStates({ document, project, weather, region }) {
  for (const { hour } of TIMECYCLE_SAMPLES) {
    yield resolveSkyState({ document, project, weather, region, hour });
  }
}

export function dayExposureStops(input) {
  let peak = 0;
  for (const state of daySkyStates(input)) peak = Math.max(peak, luma(fieldSky(state)));
  return Math.log2(0.66 / Math.max(peak, 1e-4));
}

const domeSwatch = (state) => tonemapGame(domeSky(state), gameExposureStops(state)).map(toByte);

export function daySwatches(input) {
  const frames = [...daySkyStates(input)];
  return { exposure: gameExposureStops(frames[0]), colours: frames.map(domeSwatch) };
}

const hermite = (t) => t * t * (3 - 2 * t);
const smoothStep = (edge0, edge1, v) => hermite(clamp((v - edge0) / (edge1 - edge0 || 1e-4)));

// Доля облачного покрытия по порогу и мягкости генератора облаков.
function cloudCoverage(state) {
  const { cloudGenThreshold: threshold, cloudGenSoftness: softness } = state;
  const step = smoothStep(threshold - softness * 0.5, threshold + softness * 0.5, 0.5);
  return clamp(clamp(step * state.cloudDensity - state.cloudDensityBias) ** 2);
}

// Явная экспозиция: не заданная — автоматическая, остальное приводится числом.
function finishSwatch(state, rgb, exposure) {
  const stops = exposure === undefined ? autoExposureStops(state) : Number(exposure);
  return tonemapPreview(rgb, stops).map(toByte);
}

export function weatherSwatch(input) {
  const { document, project, weather, region, hour = 12, exposure } = input;
  const state = resolveSkyState({ document, project, weather, region, hour });
  const coverage = cloudCoverage(state);
  const cloudLevel = Math.max(state.cloudHdr, 0);
  const mixed = fieldSky(state).map(
    (sky, i) => sky * (1 - coverage) + state.cloudBaseColour[i] * cloudLevel * coverage,
  );
  return finishSwatch(state, mixed, exposure);
}

export function swatchAtHour(input) {
  const { document, project, weather, region, hour, exposure } = input;
  const state = resolveSkyState({ document, project, weather, region, hour });
  return finishSwatch(state, fieldSky(state), exposure);
}
