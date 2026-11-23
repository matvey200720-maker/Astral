/*
 * Вид → числа таймцикла.
 *
 * Срез вида («10:00: небо розовое, облаков больше, солнце крупнее») ложится на
 * файл погоды как набор преобразований его собственных чисел. Здесь решается
 * ровно одно: что делает каждая настройка с какими параметрами и в каких
 * погодах.
 *
 * ДВА РОДА НАСТРОЕК
 *
 *  • Вид неба — цвет неба, его яркость, облака, дымка, цвет и яркость
 *    солнца. Это то, чем ясный день отличается от вашего ясного дня, и
 *    ложится он на ясные погоды и на те, что выключены: выключенный дождь
 *    становится вашим ясным днём целиком.
 *  • Общее — луна, звёзды, размер солнца, свет мира, яркость и
 *    насыщенность картинки, «этот час как другой», вечные сутки. Это стиль, а не погода, и он ложится на все
 *    погоды: ночь под дождём остаётся ночью с вашей луной.
 *
 * Включённый дождь поэтому остаётся дождём: его серое небо не красится в
 * розовый, а капли падают под той же луной и в том же свете, что и в ясную
 * ночь.
 *
 * ПОЧЕМУ ЦВЕТ — С ЯРКОСТЬЮ ИЗ БАЗЫ
 *
 * Небо в файле — не цвет, а цвет, помноженный на яркость часа (`sky_hdr`
 * бывает и 0.2, и 38). «Розовое небо» — это оттенок; яркость полудня и
 * полуночи остаётся своей. `recolour` меняет оттенок и насыщенность, сохраняя
 * светимость каждого кадра: закат остаётся темнее полудня, а горизонт — ярче
 * зенита, ровно как было в файле.
 */

import { SAMPLE_COUNT, celestialDirections, sampleAtHour } from "./samples.js";
import { cycleHours, hexToLinear, normalizeLook, skyPartColours } from "./look.js";
import { MOON_DISC_SIZE_LIMIT } from "./sky-body.js";
import { LENS_FLARE_WEATHER_PARAMETERS, SUN_GLARE_PARAMETERS } from "./lens-flare.js";
import { densityForVisibility } from "./atmosphere.js";
import { applyAtmosphereDetail, atmosphereBaseHeightCeiling } from "./atmosphere-detail.js";
import { AURORA_WEATHERS, auroraPeak, auroraPosition } from "./aurora.js";

/*
 * Свет мира и небо.
 *
 * Свет мира — числа, которыми освещён город: солнце или луна на стенах
 * (`light_dir_*`), свет неба и отражённый свет на земле (`light_natural_amb_*`,
 * `light_directional_amb_*`), подсветка фонарей (`light_artificial_*`), тени,
 * затенение углов, отражения и вся обработка картинки (`postfx_*`: экспозиция
 * игры подобрана под свет своего часа). Всё остальное — небо: купол, солнце и
 * луна на нём, облака, туман и дымка, лучи и блики от солнца, вода.
 *
 * Разделение нужно вечным суткам: небо полуночи со светом полудня — чёрное
 * ночное небо над светлым городом (`cycle.light` в `look.js`).
 */
const WORLD_LIGHT = /^(light_(?!ray_)|ped_light_|ssao_|dir_shadow_|postfx_|reflection_tweak_|reflection_hdr_mult$|natural_ambient_multiplier$|artificial_int_ambient_multiplier$|mirror_reflection_)/;
export const isWorldLightParameter = (name) => WORLD_LIGHT.test(String(name));

/* «Свет мира» среза: солнце или луна на домах, свет неба и отражённый свет.
   Фонари (`light_artificial_*`) не трогает — у них свой редактор. */
const WORLD_LIGHT_INTENSITY = Object.freeze([
  "light_dir_mult",
  "light_natural_amb_up_intensity",
  "light_natural_amb_down_intensity",
  "light_directional_amb_intensity",
]);

const LUMA = [0.2126, 0.7152, 0.0722];
const luminance = (rgb) =>
  rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];

/**
 * Оттенок цели при светимости основы.
 *
 * `strength` — доля: 1 — цвет цели целиком, 0.3 — лёгкий налёт. Цвет цели
 * берётся в линейном свете (`hexToLinear`), его собственная светлота
 * отбрасывается: светлый и тёмный розовый дают одно и то же небо, а
 * насыщенность — разную.
 */
export function recolour(base, target, strength = 1) {
  const lum = luminance(base);
  const targetLum = Math.max(luminance(target), 1e-4);
  return base.map((value, index) => {
    const goal = (target[index] / targetLum) * lum;
    return value + (goal - value) * strength;
  });
}

/*
 * Цвета и их множители.
 *
 * Насыщенный оттенок при той же светимости требует канала больше единицы:
 * синий светит в четырнадцать раз слабее белого. Где у цвета есть множитель,
 * который игра действительно читает (`sky_moon_iten` у луны, `light_dir_mult`
 * у солнечного света), лишнее уезжает в него, и цвет остаётся в пределах
 * единицы.
 *
 * У цветов купола такого множителя нет: `sky_*_col_inten` в градиент неба не
 * входит (см. `skyGradient` в `sky-renderer.js` — ванильный зенит в полдень
 * стоит на 0.02 и всё равно синий). Поэтому яркость купола остаётся в самом
 * цвете: файл игры хранит числа с плавающей точкой, и ванильные цвета сами
 * заходят за единицу. Потолок — `HDR_COLOUR_LIMIT`, чтобы вырожденный случай
 * не записал в файл тысячу.
 */
const INTENSITY_OF = Object.freeze({
  sky_moon_col: "sky_moon_iten",
  light_dir_col: "light_dir_mult",
});
const HDR_COLOUR_LIMIT = 4;

/* Туман и дымка у горизонта идут за горизонтом неба, но не целиком: у
   тумана своя роль — он растворяет даль, и совсем без своего цвета мир
   сливается с небом в одну заливку. */
const HAZE_COLOURS = Object.freeze([
  "fog_haze_col",
  "fog_col",
  "fog_near_col",
  "fog_east_col",
  "fog_moon_col",
]);
/* Туман со стороны солнца — это закатное зарево у горизонта: цвет солнца
   красит его наполовину, чтобы красное солнце не садилось в жёлтую дымку. */
const SUN_GLOW_STRENGTH = 0.5;
const HAZE_STRENGTH = 0.85;
/* Свет неба на земле берёт оттенок неба чуть-чуть: розовое небо даёт розовый
   отсвет на стенах, но мир не заливается розовым. */
const AMBIENT_STRENGTH = 0.3;
/* Солнечный свет на земле — так же: оттенок солнца на стенах, а не краска. */
const SUNLIGHT_STRENGTH = 0.3;

/* Ниже этой «Яркости солнца» диск уменьшается вместе с ней до невидимого. */
const SUN_FADE = 0.2;
/*
 * Самый маленький диск солнца, который можно записать. Ноль ломает игру: она
 * делит на площадь диска, поправка экспозиции становится NaN, и глаз прилипает
 * к нижнему пределу — «Яркость» перестаёт работать (замер 28.09.2026, у вида
 * владельца «Размер солнца 0»). 0.01 — меньше пикселя: диска не видно.
 */
export const SUN_DISC_MIN = 0.01;

/* Сколько середины остаётся над горизонтом у неба со своими сторонами. */
const HORIZON_BLEND_KEEP = 0.35;

/** Заданы ли стороны горизонта отдельно — небо не двухцветное. */
const hasOwnHorizon = (sky) =>
  Boolean(
    sky &&
      ((sky.east && sky.east !== sky.horizon) ||
        (sky.west && sky.west !== sky.horizon) ||
        (sky.sides && sky.sides !== sky.horizon)),
  );

const CLOUD_COLOURS = Object.freeze([
  ["sky_cloud_base_col", 0.9],
  ["sky_cloud_mid_col", 0.9],
  ["sky_small_cloud_col", 0.9],
  ["sky_cloud_shadow_col", 0.5],
]);

/**
 * Типы погоды, на которые раскладывается вид.
 *
 * `family`:
 *   clear  — ясные: вид ложится целиком на их собственный файл;
 *   toggle — погода с выключателем: включена — остаётся собой и получает
 *            только общее, выключена — становится ясным днём с видом;
 *   event  — праздничные и служебные: остаются собой, получают общее, а их
 *            дождь, снег и молнию снимают выключатели.
 *
 * `replacement` — чем стать выключенной погоде, если родственная включена:
 * гроза без грозы — это дождь, метель без метели — снегопад.
 *
 * Хеллоуинских типов в `WEATHER_TYPES` нет — их знает только свежий
 * `update.rpf`, — поэтому таблица своя, а файлы у неё названы явно.
 */
export const LOOK_WEATHERS = Object.freeze([
  weather("EXTRASUNNY", "w_extrasunny.xml", "clear"),
  weather("CLEAR", "w_clear.xml", "clear"),
  weather("CLOUDS", "w_clouds.xml", "clear"),
  weather("SMOG", "w_smog.xml", "clear"),
  weather("FOGGY", "w_foggy.xml", "toggle", "fog"),
  weather("OVERCAST", "w_overcast.xml", "toggle", "overcast"),
  weather("RAIN", "w_rain.xml", "toggle", "rain"),
  weather("CLEARING", "w_clearing.xml", "toggle", "rain"),
  weather("THUNDER", "w_thunder.xml", "toggle", "thunder", {
    toggle: "rain",
    weather: "RAIN",
  }),
  weather("SNOW", "w_snow.xml", "toggle", "snow"),
  weather("SNOWLIGHT", "w_snowlight.xml", "toggle", "snow"),
  weather("XMAS", "w_xmas.xml", "toggle", "snow"),
  weather("BLIZZARD", "w_blizzard.xml", "toggle", "blizzard", {
    toggle: "snow",
    weather: "SNOW",
  }),
  weather("NEUTRAL", "w_neutral.xml", "event"),
  weather("HALLOWEEN", "w_halloween.xml", "event"),
  weather("RAIN_HALLOWEEN", "w_rainhalloween.xml", "event"),
  weather("SNOW_HALLOWEEN", "w_snowhalloween.xml", "event"),
]);

function weather(id, file, family, toggle = null, replacement = null) {
  return Object.freeze({ id, file, family, toggle, replacement });
}

/** Ясный день, которым становится выключенная погода. */
export const CLEAR_SOURCE = "EXTRASUNNY";

export const findLookWeather = (id) =>
  LOOK_WEATHERS.find((item) => item.id === String(id).toUpperCase()) || null;

/**
 * Во что превращается погода при этих выключателях.
 *
 * Возвращает `{ base, mode }`: чей файл берётся за основу и что на него
 * ложится — `look` (вид целиком) или `style` (только общее).
 *
 * Хамелеон (`toggles.chameleon` вместе с вечной погодой `toggles.eternal`):
 * каждый из семнадцати типов — копия одного и того же, того, во что
 * превратилась бы выбранная погода при этих выключателях. Сервер ставит тип
 * по имени, и любое имя выглядит выбранной погодой.
 */
export function resolveWeatherPlan(weatherId, toggles = {}) {
  const item = findLookWeather(weatherId);
  if (!item) return null;
  if (toggles.chameleon === true && findLookWeather(toggles.eternal)) {
    const target = resolveWeatherPlan(toggles.eternal, { ...toggles, chameleon: false });
    if (target) return { base: target.base, mode: target.mode };
  }
  if (item.family === "clear") return { base: item.id, mode: "look" };
  if (item.family === "event") return { base: item.id, mode: "style" };
  if (toggles[item.toggle] !== false) return { base: item.id, mode: "style" };
  if (item.replacement && toggles[item.replacement.toggle] !== false)
    return { base: item.replacement.weather, mode: "style" };
  return { base: CLEAR_SOURCE, mode: "look" };
}

/* --- Чтение и запись параметров региона --- */

const readCurve = (values, name) =>
  Array.isArray(values?.[name]) ? values[name] : null;

function readColour(values, base) {
  const r = readCurve(values, `${base}_r`);
  const g = readCurve(values, `${base}_g`);
  const b = readCurve(values, `${base}_b`);
  return r && g && b ? { r, g, b } : null;
}

/**
 * Рабочая копия региона: параметр → тринадцать чисел. Правки идут в неё, а
 * сравнение с базой в конце отдаёт только изменённое.
 */
function workingCopy(values) {
  return Object.fromEntries(
    Object.entries(values || {}).map(([name, curve]) => [name, [...curve]]),
  );
}

function setColourAt(work, base, index, rgb) {
  const intensityName = INTENSITY_OF[base];
  const peak = Math.max(rgb[0], rgb[1], rgb[2]);
  let scaled = rgb;
  if (peak > 1 && intensityName && work[intensityName]) {
    work[intensityName][index] *= peak;
    scaled = rgb.map((value) => value / peak);
  } else if (peak > HDR_COLOUR_LIMIT) {
    scaled = rgb.map((value) => (value / peak) * HDR_COLOUR_LIMIT);
  }
  ["r", "g", "b"].forEach((channel, position) => {
    const curve = work[`${base}_${channel}`];
    if (curve) curve[index] = Math.max(scaled[position], 0);
  });
}

function recolourAt(work, base, index, target, strength) {
  const colour = readColour(work, base);
  if (!colour) return;
  const current = [colour.r[index], colour.g[index], colour.b[index]];
  setColourAt(work, base, index, recolour(current, target, strength));
}

function scaleAt(work, name, index, factor) {
  const curve = work[name];
  if (curve && Number.isFinite(factor)) curve[index] *= factor;
}

function addAt(work, name, index, amount) {
  const curve = work[name];
  if (curve && Number.isFinite(amount)) curve[index] += amount;
}

const mixRgb = (left, right, share) =>
  left.map((value, index) => value + (right[index] - value) * share);

/* Ночные часы (срезы группы «Ночь») и яркости неба, что светят в них. */
const NIGHT_SAMPLES = new Set([11, 12, 0, 1]);
const NIGHT_SKY_INTENSITY = Object.freeze([
  "sky_zenith_col_inten",
  "sky_zenith_transition_col_inten",
  "sky_azimuth_east_col_inten",
  "sky_azimuth_transition_col_inten",
  "sky_azimuth_west_col_inten",
  "sky_plane_inten",
]);

/*
 * Ночь подробно (21.11.2026). Лунный свет на городе, цвет теней, туман и зарево луны — настройки ночных срезов:
 * днём `light_dir_col` — это солнце, и красить его «лунным светом» нельзя. Поэтому они ложатся только на ночные срезы
 * (`NIGHT_SAMPLES`) и на все срезы вечной ночи, где в каждом часу числа полуночи (`nightEverywhere`).
 */
const MOONLIGHT_STRENGTH = 0.85;
const SHADOW_STRENGTH = 0.8;
const NIGHT_FOG_COLOURS = Object.freeze(["fog_haze_col", "fog_col", "fog_near_col", "fog_east_col"]);
const NIGHT_FOG_STRENGTH = 0.9;
/* Зарево луны — степень пятна: чем она больше, тем уже зарево (`fog_moon_lighting_calc_pow`). */
const HALO_POWER_MIN = 0.5;

/** Стоят ли сутки на ночи целиком («вечная ночь», «свой час» ночью): тогда ночные настройки идут во все срезы. */
function nightEverywhere(cycle) {
  const hours = cycleHours(cycle);
  return Boolean(hours) && celestialDirections(hours.sky).usesMoon;
}

/* --- Преобразования среза --- */

/*
 * Облака купола.
 *
 * Облачный слой купола рисуется по `density_mult` и `density_bias`
 * (`SkydomePS.hlsl`: покрытие = (шум · mult − bias)²). Ясный день в игре
 * держит `density_mult` в нуле, и простое умножение не могло бы добавить
 * облаков туда, где их нет. Поэтому «больше единицы» не только умножает, но
 * и прибавляет: к плотности и против порога.
 */
function applyCloudAmount(work, index, amount) {
  if (amount === null || amount === undefined) return;
  const a = Math.min(Math.max(Number(amount), 0), 2);
  if (a === 0) {
    for (const name of ["sky_cloud_density_mult", "sky_small_cloud_density_mult"])
      if (work[name]) work[name][index] = 0;
    return;
  }
  scaleAt(work, "sky_cloud_density_mult", index, a);
  scaleAt(work, "sky_small_cloud_density_mult", index, a);
  if (a > 1) {
    addAt(work, "sky_cloud_density_mult", index, (a - 1) * 3.2);
    const bias = work.sky_cloud_density_bias;
    if (bias) bias[index] = Math.max(bias[index] - (a - 1) * 0.35, -0.5);
  }
}

/** Вид неба: небо, его яркость, облака, дымка, цвет и свечение солнца. */
function applySkyLook(work, index, slot, look, night = false) {
  if (slot.sky) {
    /* Пять цветов купола (`SKY_PARTS` в look.js): у двухцветного неба
       середина — смесь, а все стороны горизонта — один горизонт. */
    const parts = skyPartColours(slot.sky);
    const zenith = hexToLinear(parts.zenith);
    const east = hexToLinear(parts.east);
    const west = hexToLinear(parts.west);
    const sides = hexToLinear(parts.sides);
    const middle = slot.sky.middle
      ? hexToLinear(parts.middle)
      : mixRgb(zenith, hexToLinear(slot.sky.horizon), 0.5);
    recolourAt(work, "sky_zenith_col", index, zenith, 1);
    recolourAt(work, "sky_zenith_transition_col", index, middle, 1);
    recolourAt(work, "sky_azimuth_east_col", index, east, 1);
    recolourAt(work, "sky_azimuth_west_col", index, west, 1);
    recolourAt(work, "sky_azimuth_transition_col", index, sides, 1);
    /*
     * Горизонт своими цветами. Купол игры кладёт на нижнюю половину неба
     * середину поверх сторон горизонта долей `sky_zenith_transition_*_blend`
     * (`SkydomeVS`): у ванильного полудня это 0.73–0.94, и восток с западом
     * там почти не видны. Небу с разными сторонами горизонта — радужному —
     * доля середины уменьшается: стороны должны быть видны, раз их задали.
     */
    if (hasOwnHorizon(slot.sky)) {
      scaleAt(work, "sky_zenith_transition_east_blend", index, HORIZON_BLEND_KEEP);
      scaleAt(work, "sky_zenith_transition_west_blend", index, HORIZON_BLEND_KEEP);
    }
    /* Дымка — у земли по всему кругу: её оттенок — средний по сторонам
       горизонта, иначе радужный горизонт залил бы даль одним цветом. */
    const horizon = [east, west, sides].reduce(
      (sum, colour) => sum.map((value, channel) => value + colour[channel] / 3),
      [0, 0, 0],
    );
    for (const base of HAZE_COLOURS)
      recolourAt(work, base, index, horizon, HAZE_STRENGTH);
    recolourAt(work, "light_natural_amb_up_col", index, zenith, AMBIENT_STRENGTH);
  }

  const brightness = slot.skyBrightness;
  if (brightness !== 1) {
    scaleAt(work, "sky_hdr", index, brightness);
    scaleAt(work, "fog_haze_hdr", index, brightness);
    scaleAt(work, "fog_hdr", index, brightness);
  }

  const sunColour = hexToLinear(slot.sun.colour);
  if (sunColour) {
    recolourAt(work, "sky_sun_col", index, sunColour, 1);
    recolourAt(work, "sky_sun_disc_col", index, sunColour, 1);
    recolourAt(work, "light_dir_col", index, sunColour, SUNLIGHT_STRENGTH);
    recolourAt(work, "fog_col", index, sunColour, SUN_GLOW_STRENGTH);
  }
  /*
   * Яркость солнца — диск и ореол вместе. Прежний ползунок гасил только
   * ореол (рассеяние и радиус влияния), и при нуле диск оставался во всю
   * силу `sky_sun_hdr`: у редукса владельца это 255 при размере диска вшестеро
   * больше ванильного — белое пятно на полнеба (26.09.2026). Ноль теперь —
   * ноль: солнца на небе не видно, свет от него на город остаётся (это
   * `light_dir_*`, а не диск).
   */
  /*
   * Ореол в шейдере купола игры — это смесь «небо · (1 − доля) + солнце ·
   * доля», и доля растёт с `sky_sun_miescatter` (sky-state.js, `dome`).
   * Погасить ореол яркостью (`sky_sun_hdr` или `mie_intensity` в ноль) —
   * значит вырезать в небе тёмную дыру: проверено в игре 28.09.2026. Гасится
   * он долей — `miescatter`: в нуле ни свечения, ни дыры. `influence_radius`
   * в ореол игры не входит вовсе — его ползунок больше не трогает.
   */
  if (slot.sun.glow !== 1) {
    scaleAt(work, "sky_sun_hdr", index, slot.sun.glow);
    scaleAt(work, "sky_sun_miescatter", index, slot.sun.glow);
    scaleAt(work, "sky_sun_scatter_inten", index, slot.sun.glow);
  }

  /* «Без облаков» в выборе шапок снимает и облака купола: человек, который
     попросил чистое небо, не должен искать второй ползунок ради пелены. */
  const amount = Array.isArray(look.clouds.types) && !look.clouds.types.length
    ? 0
    : slot.clouds.amount;
  applyCloudAmount(work, index, amount);
  const cloudColour = hexToLinear(slot.clouds.colour);
  if (cloudColour)
    for (const [base, strength] of CLOUD_COLOURS)
      recolourAt(work, base, index, cloudColour, strength);

  /* Цвет тумана ночью — свой, а не горизонта неба. Туман под луной (`fog_moon_col`) остаётся лунным. */
  const nightFog = night ? hexToLinear(slot.night.fog) : null;
  if (nightFog) for (const base of NIGHT_FOG_COLOURS) recolourAt(work, base, index, nightFog, NIGHT_FOG_STRENGTH);

  if (slot.haze !== 1) {
    scaleAt(work, "fog_density", index, slot.haze);
    scaleAt(work, "fog_haze_density", index, slot.haze);
  }
}

/**
 * Ночь подробно: цвет лунного света на городе, цвет теней, зарево луны у горизонта, свечение картинки.
 *
 * Лунный свет — `light_dir_col` (ночью направленный свет идёт от луны). Цвет теней — свет неба «снизу»
 * (`light_natural_amb_down_col`) и отражённый (`light_directional_amb_col`). Зарево — туман под луной: сила — доля
 * (`fog_moon_col_a`, шейдер купола держит её в 0…1, выше единицы прибавляется яркость цвета), разлёт — степень пятна
 * (`fog_moon_lighting_calc_pow`). Свечение — `postfx_intensity_bloom`. Цвет — с сохранением яркости кадра (`recolour`).
 */
function applyNightDetails(work, index, slot) {
  const night = slot.night;
  const moonlight = hexToLinear(night.moonlight);
  if (moonlight) recolourAt(work, "light_dir_col", index, moonlight, MOONLIGHT_STRENGTH);
  const shadows = hexToLinear(night.shadows);
  if (shadows) {
    recolourAt(work, "light_natural_amb_down_col", index, shadows, SHADOW_STRENGTH);
    recolourAt(work, "light_directional_amb_col", index, shadows, SHADOW_STRENGTH);
  }
  if (night.halo !== 1) {
    const alpha = work.fog_moon_col_a;
    if (alpha) alpha[index] = Math.min(Math.max(alpha[index] * Math.min(night.halo, 1), 0), 1);
    if (night.halo > 1)
      for (const channel of ["r", "g", "b"]) scaleAt(work, `fog_moon_col_${channel}`, index, night.halo);
  }
  if (night.haloSpread !== 1) {
    const power = work.fog_moon_lighting_calc_pow;
    if (power) power[index] = Math.max(power[index] / night.haloSpread, HALO_POWER_MIN);
  }
  if (night.bloom !== 1) scaleAt(work, "postfx_intensity_bloom", index, night.bloom);
}

/** Общее: размер солнца, луна, звёзды, свет мира, яркость и насыщенность картинки. */
function applyStyle(work, index, slot, night = false) {
  if (slot.sun.size !== 1) {
    scaleAt(work, "sky_sun_disc_size", index, slot.sun.size);
  }
  /* Почти погашенное солнце — и диск прячется: диск тусклее неба игра рисует
     тёмным кружком (он не прибавляется к небу, а закрывает его). */
  if (slot.sun.glow < SUN_FADE) scaleAt(work, "sky_sun_disc_size", index, slot.sun.glow / SUN_FADE);
  if (slot.moon.size !== 1) {
    /* Лист луны 128×128 мылит выше предела (`MOON_DISC_SIZE_LIMIT`): у типов погоды со штатным размером выше тройки множитель не уводит диск за предел
       (а штатное значение игры выше предела остаётся как есть). */
    const stock = work.sky_moon_disc_size?.[index];
    scaleAt(work, "sky_moon_disc_size", index, slot.moon.size);
    if (slot.moon.size > 1 && Number.isFinite(stock)) work.sky_moon_disc_size[index] = Math.min(work.sky_moon_disc_size[index], Math.max(MOON_DISC_SIZE_LIMIT, stock));
    scaleAt(work, "sky_moon_influence_radius", index, Math.sqrt(slot.moon.size));
  }
  if (slot.moon.brightness !== 1) {
    scaleAt(work, "sky_moon_iten", index, slot.moon.brightness);
    scaleAt(work, "sky_moon_scatter_inten", index, slot.moon.brightness);
  }
  const moonColour = hexToLinear(slot.moon.colour);
  if (moonColour) {
    recolourAt(work, "sky_moon_col", index, moonColour, 1);
    recolourAt(work, "fog_moon_col", index, moonColour, SUN_GLOW_STRENGTH);
  }
  if (slot.stars !== 1) scaleAt(work, "sky_stars_iten", index, slot.stars);
  if (night) applyNightDetails(work, index, slot);
  if (slot.light !== 1)
    for (const name of WORLD_LIGHT_INTENSITY) scaleAt(work, name, index, slot.light);
  /*
   * Яркость картинки — сдвиг цели глаза игры (`postfx_exposure`) и его
   * пределов вместе с ним: +1 — ровно вдвое светлее в игре, как и в кадре
   * (`gameExposureEv` в sky-state.js). Пределы едут следом, чтобы тёмная
   * «Яркость» не упёрлась в нижний, а светлая — в верхний. Замеры в игре
   * 28.09.2026 — docs/TIMECYCLE-SKY.md, «Экспозиция».
   */
  if (slot.exposure !== 0) {
    addAt(work, "postfx_exposure", index, slot.exposure);
    addAt(work, "postfx_exposure_min", index, slot.exposure);
    addAt(work, "postfx_exposure_max", index, slot.exposure);
  }
  if (slot.saturation !== 1)
    scaleAt(work, "postfx_desaturation", index, slot.saturation);
}

/*
 * «Этот час как другой».
 *
 * Вечная ночь и вечный закат — это не ползунки, а перестановка кадров: в
 * полдень ложатся числа полуночи. Делается до остальных настроек, чтобы
 * «ночь в полдень» можно было дальше править как любой другой срез.
 */
/*
 * Атмосфера (21.11.2026): туман, дымка, лучи, свет фонарей в тумане, видимость. Это «общее», а не вид неба: ложится на ВСЕ типы погоды — и на ясные,
 * и на выключенные, и на дождь с грозой, и на серверные (поверх хамелеона), — поэтому вызывается при любом режиме. Цвета — оттенок с яркостью часа из файла
 * (`recolour`), а не готовый цвет: серый туман днём светлый, ночью тёмный. Что делает каждая ручка — `atmosphere.js`.
 */
const FOG_MAIN_COLOURS = Object.freeze(["fog_col", "fog_near_col", "fog_east_col"]);
const FOG_HORIZON_COLOURS = Object.freeze(["fog_haze_col", "fog_east_col"]);
/* Туман не гаснет и не уходит за предел игры: `fog_falloff` = 0 отключает его (замер 06.10), нулевая плотность — «без тумана» только по прямой просьбе (`density: 0`). */
const FALLOFF_MIN = 0.2;
const FALLOFF_MAX = 100;

function setAt(work, name, index, value) {
  const curve = work[name];
  if (curve && Number.isFinite(value)) curve[index] = value;
}

function applyAtmosphere(work, atmosphere, index, night) {
  if (!atmosphere) return;
  /* Базой служит рабочая копия: «Дымка» вида неба уже могла сдвинуть плотность, атмосфера считает поверх. */
  const start = atmosphere.start ?? work.fog_start?.[index] ?? 0;
  if (atmosphere.start !== null) setAt(work, "fog_start", index, atmosphere.start);
  /* Плотность: своя видимость заменяет плотность игры в этом часу, множитель — поверх. */
  const baseDensity = work.fog_density?.[index];
  if (baseDensity !== undefined) {
    const density = (atmosphere.visibility !== null ? densityForVisibility(atmosphere.visibility, start) : baseDensity) * atmosphere.density;
    setAt(work, "fog_density", index, density);
  }
  /* Высота слоя: спад по высоте делится на «высоту» (выше — стоит стеной); нуль не выставляем. */
  const baseFalloff = work.fog_falloff?.[index];
  if (atmosphere.height !== 1 && baseFalloff !== undefined && baseFalloff > 0)
    setAt(work, "fog_falloff", index, Math.min(Math.max(baseFalloff / atmosphere.height, FALLOFF_MIN), FALLOFF_MAX));
  /* Дно слоя не выше потолка спада: плотность у земли растёт как e^(спад/1000 · дно), выше — белая стена (`atmosphere-detail.js`). */
  if (atmosphere.baseHeight !== null)
    setAt(work, "fog_base_height", index, Math.min(atmosphere.baseHeight, atmosphereBaseHeightCeiling(work.fog_falloff?.[index])));
  /* Цвет: дневной и ночной — основные цвета тумана; у горизонта — дымка вдали и туман у солнца. */
  const main = hexToLinear(night ? atmosphere.nightColour : atmosphere.colour);
  if (main) for (const base of FOG_MAIN_COLOURS) recolourAt(work, base, index, main, 1);
  const horizon = hexToLinear(atmosphere.horizonColour);
  if (horizon) for (const base of FOG_HORIZON_COLOURS) recolourAt(work, base, index, horizon, 1);
  if (atmosphere.haze !== 1) scaleAt(work, "fog_haze_density", index, atmosphere.haze);
  if (atmosphere.rays !== 1) for (const name of ["fogray_intensity", "light_ray_mult"]) scaleAt(work, name, index, atmosphere.rays);
  /* Объёмный свет фонарей: у игры днём ноль (считается в сумерках и ночью), от нуля множитель ничего не даёт — и не должен. */
  if (atmosphere.lamps !== 1) for (const name of ["fog_volume_light_intensity", "fogvolume_density_scalar"]) scaleAt(work, name, index, atmosphere.lamps);
  /* Подробный уровень: слой, тени, лучи, объёмный свет, дальность прорисовки — по таблице `atmosphere-detail.js`. */
  applyAtmosphereDetail(work, atmosphere.detail, index, night);
}

/*
 * Свет и картинка (21.11.2026): ручки `light.js`. Общее, как атмосфера: ложится в любом режиме на все типы погоды. Где у игры ноль (глубина резкости, виньетка), множитель
 * ничего не даёт — число кладётся явно; где единица или переменная кривая — множитель поверх игры.
 */
function applyLight(work, light, index) {
  if (!light) return;
  if (light.hardness !== 1) {
    scaleAt(work, "light_dir_mult", index, light.hardness);
    for (const name of ["light_directional_amb_intensity", "light_natural_amb_down_intensity"]) scaleAt(work, name, index, light.hardness ** -0.5);
  }
  if (light.shadowSoftness !== null) setAt(work, "dir_shadow_softness", index, light.shadowSoftness);
  if (light.shadowDistance !== 1) for (const name of ["dir_shadow_distance_multiplier", "shadow_distance_mult"]) scaleAt(work, name, index, light.shadowDistance);
  if (light.drying !== 1) scaleAt(work, "water_drying_speed_mult", index, light.drying);
  if (light.depthOfField > 0) {
    setAt(work, "dof_blur_mid", index, light.depthOfField * 0.5);
    setAt(work, "dof_blur_far", index, light.depthOfField);
  }
  if (light.vignette > 0) setAt(work, "postfx_vignetting_intensity", index, light.vignette);
  if (light.wind !== 1) scaleAt(work, "wind_speed_mult", index, light.wind);
}

/*
 * Северное сияние, ступень А (21.11.2026): переходный цвет ночных срезов — цвет сияния, поднятый до нужной яркости, и положение полосы по высоте.
 * Только ночью (или при вечной ночи): днём небо игры остаётся. Цвет кладётся абсолютным (у игры он почти чёрный — множитель ничего не даст).
 */
function applyAurora(work, aurora, index, night, weather = null) {
  if (!aurora || !night) return;
  /* Сияние — на ясные погоды; тип известен — остальные пропускаются (на облаках зелёное красит облака плоской краской). */
  if (weather && !AURORA_WEATHERS.includes(weather)) return;
  const rgb = hexToLinear(aurora.colour);
  if (!rgb) return;
  const peak = Math.max(rgb[0], rgb[1], rgb[2]) || 1;
  const level = auroraPeak(aurora.brightness) / peak;
  const colour = rgb.map((value) => value * level);
  const paint = (base) => {
    setColourAt(work, base, index, colour);
    if (work[`${base}_inten`]) work[`${base}_inten`][index] = 1;
  };
  if (aurora.mode === "horizon") {
    /* Цвета горизонта: восточный и западный (у игры ночью почти чёрные). */
    paint("sky_azimuth_east_col");
    paint("sky_azimuth_west_col");
  } else if (aurora.mode === "zenith") {
    /* Переходный цвет у зенита. */
    paint("sky_zenith_transition_col");
  } else {
    paint("sky_azimuth_transition_col");
    setAt(work, "sky_azimuth_transition_position", index, auroraPosition(aurora.height));
  }
  /* Ночной sky_hdr (множитель яркости неба) поднимается до заданного: при 0,2 цвет неба ночью почти не виден. */
  if (aurora.hdr !== null && Array.isArray(work.sky_hdr)) work.sky_hdr[index] = Math.max(work.sky_hdr[index], aurora.hdr);
}

function applyTimeRemap(work, source, slots) {
  const remapped = slots.some((slot) => slot.from !== null);
  if (!remapped) return;
  for (const [name, curve] of Object.entries(source)) {
    if (!Array.isArray(curve) || curve.length !== SAMPLE_COUNT) continue;
    slots.forEach((slot, index) => {
      if (slot.from !== null) work[name][index] = curve[slot.from];
    });
  }
}

/*
 * Вечный день, вечная ночь и свой час: каждый час — числа одного часа, небо
 * из одного часа, свет мира — из своего (`cycleHours`). Между опорными
 * кадрами число считается так, как смешивает кадры игра (`sampleAtHour`); у
 * опорного часа это ровно число кадра. Солнце и луна в игре ходят по часам и
 * так: в вечную ночь солнце в полдень стоит над головой, но его не видно —
 * у полуночи `sky_sun_hdr` ноль, а свет на дома идёт с его стороны с силой
 * лунного.
 */
function applyCycle(work, source, cycle) {
  const from = cycleHours(cycle);
  if (!from) return;
  for (const [name, curve] of Object.entries(source)) {
    if (!Array.isArray(curve) || curve.length !== SAMPLE_COUNT) continue;
    const value = sampleAtHour(curve, isWorldLightParameter(name) ? from.light : from.sky);
    work[name] = work[name].map(() => value);
  }
}

const EPSILON = 1e-7;
const sameCurve = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((value, index) => Math.abs(value - right[index]) <= EPSILON);

/**
 * Правки одного региона: какие параметры и какими стали.
 *
 * `values` — регион файла-основы («параметр → 13 чисел»), `mode` — `look`
 * или `style`. Возвращает только то, что отличается от основы: если вид
 * ничего не меняет, правок нет вовсе, и в игру уезжает нетронутый файл.
 */
/*
 * Светлая ночь игры (21.11.2026, контроль на чистой игре и числа w_*.xml базы): у SNOW и BLIZZARD в срезах 21, 22 и 00 ч, у SNOWLIGHT и NEUTRAL в срезе 22 ч естественный свет неба —
 * 6,25…8,5 вместо 0,02…0,10 у остальных погод, а наружные фонари выключены (light_artificial_ext_*_intensity = 0): ночью на этих погодах земля, стены и деревья светлые как днём, окна и
 * фонари не горят — это поведение самой игры, без Astral. Тёмное небо Astral со звёздами над такой землёй выглядит ошибкой, поэтому в такие срезы Astral ничего не пишет (небо, звёзды, луна,
 * свет, туман): ночь там штатная, наша — дневная часть и остальные ночные срезы. Срез определяется по числам самого файла (порог естественного света 3: у обычной ночи не выше 0,25, у светлой 6,25 и больше), а не по имени погоды.
 */
const BRIGHT_NIGHT_AMBIENT = 3;
export const isBrightStockNight = (values, index) => NIGHT_SAMPLES.has(index) && Number(values?.light_natural_amb_up_intensity?.[index]) > BRIGHT_NIGHT_AMBIENT;

export function applyLookToRegion(values, rawLook, mode = "look", context = {}) {
  const look = normalizeLook(rawLook);
  const work = workingCopy(values);
  applyTimeRemap(work, values, look.slots);
  applyCycle(work, values, look.cycle);
  const everywhere = nightEverywhere(look.cycle);
  look.slots.forEach((slot, index) => {
    /* Светлая ночь игры (SNOW, BLIZZARD, SNOWLIGHT в 22 ч, NEUTRAL в 22 ч): штатное небо там остаётся — наше тёмное небо над по-дневному светлой землёй не согласовано. */
    if (!everywhere && isBrightStockNight(values, index)) return;
    const night = everywhere || NIGHT_SAMPLES.has(index);
    if (mode === "look") applySkyLook(work, index, slot, look, night);
    applyStyle(work, index, slot, night);
    applyAtmosphere(work, look.atmosphere, index, night);
    applyLight(work, look.light, index);
    applyAurora(work, look.aurora, index, night, context?.weather ?? null);
  });
  /* Весь кадр серым: насыщенность картинки — ноль во все часы, какой бы ни была
     в основе и что бы ни стояло на ползунке «Насыщенность» срезов. Ноль в
     пределах параметра (`postfx_desaturation: [0, 1]` в `parameters.js`). */
  if (look.weather.grayFrame && Array.isArray(work.postfx_desaturation))
    work.postfx_desaturation = work.postfx_desaturation.map(() => 0);
  /*
   * Без звёзд (01.11.2026, владелец: «отключил звёзды — отключился и шум, идеально чёрное небо»): звёзды и зерно картинки — ноль во все часы, небо ночных часов — ноль яркости. Луна остаётся: у неё свой ползунок.
   */
  if (look.weather.noStars) {
    for (const name of ["sky_stars_iten", "postfx_noise"])
      if (Array.isArray(work[name])) work[name] = work[name].map(() => 0);
    for (const name of NIGHT_SKY_INTENSITY)
      if (Array.isArray(work[name])) work[name] = work[name].map((value, index) => (NIGHT_SAMPLES.has(index) ? 0 : value));
  }
  /* Без бликов: числа, которые их разрешают, — ванильный ноль во все часы
     и в каждой погоде, какой бы редукс ни лежал в основе. Вместе с ними
     гаснут и лучи от солнца (`SUN_GLARE_PARAMETERS`): их оранжевый засвет
     вокруг солнца владелец видел и при выключенных бликах. */
  if (!look.weather.flares)
    for (const name of [...LENS_FLARE_WEATHER_PARAMETERS, ...SUN_GLARE_PARAMETERS])
      if (Array.isArray(work[name])) work[name] = work[name].map(() => 0);
  /* Диску солнца — никогда не ноль (`SUN_DISC_MIN`), даже если ноль был в
     основе: иначе в игре ломается экспозиция. */
  if (Array.isArray(work.sky_sun_disc_size))
    work.sky_sun_disc_size = work.sky_sun_disc_size.map((value) => Math.max(value, SUN_DISC_MIN));
  const changed = {};
  for (const [name, curve] of Object.entries(work)) {
    if (!Array.isArray(curve) || curve.length !== SAMPLE_COUNT) continue;
    if (!sameCurve(curve, values[name])) changed[name] = curve;
  }
  return changed;
}

/**
 * Правки одной погоды — по всем регионам её основы.
 *
 * `bases` — разобранные файлы погоды (`parseKeyframeXml`) по именам типов.
 * Если погода становится другой (выключенный дождь — ясным днём), основа
 * берётся у той, другой, и все её числа уезжают в файл дождя целиком, а не
 * только изменённые видом: иначе в файле дождя остались бы его собственные
 * тучи под вашим небом.
 */
export function lookWeatherEdits({ weather: weatherId, bases, look }) {
  const normalized = normalizeLook(look);
  const plan = resolveWeatherPlan(weatherId, normalized.weather);
  if (!plan) return null;
  const own = bases?.[weatherId] || null;
  const source = bases?.[plan.base] || null;
  if (!source) return { plan, regions: {}, complete: false };
  const regions = {};
  for (const region of source.regions) {
    const edits = applyLookToRegion(region.values, normalized, plan.mode, { weather: plan.base });
    if (plan.base !== weatherId) {
      /* Основа чужая: весь регион уезжает целиком. Параметры, которых в
         своём файле нет, игра не ждёт — их оставим за бортом. */
      const target = own?.regions.find(
        (item) => item.name.toUpperCase() === region.name.toUpperCase(),
      );
      const full = {};
      for (const [name, curve] of Object.entries(region.values)) {
        if (target && !Array.isArray(target.values[name])) continue;
        const next = edits[name] || curve;
        if (!target || !sameCurve(next, target.values[name])) full[name] = [...next];
      }
      if (Object.keys(full).length) regions[region.name] = full;
    } else if (Object.keys(edits).length) {
      regions[region.name] = edits;
    }
  }
  return { plan, regions, complete: true };
}
