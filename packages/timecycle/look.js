/*
 * Простое небо: вид острова целиком, а не четыреста параметров.
 *
 * Человек не выбирает ни погоду, ни регион. Он выбирает время — «10:00» или
 * «весь вечер» — и говорит, каким оно должно быть: какое небо, какие облака,
 * какое солнце, насколько светло. Это и есть документ вида: тринадцать
 * срезов по опорным кадрам суток (`TIMECYCLE_SAMPLES`), выбор облачных шапок
 * и выключатели погоды. Сборщик (`look-apply.js`) раскладывает его на все
 * семнадцать файлов погоды и оба региона сразу.
 *
 * КАЖДАЯ НАСТРОЙКА — ПРЕОБРАЗОВАНИЕ БАЗЫ, А НЕ ЧИСЛО ИЗ ФАЙЛА
 *
 * «Яркость неба ×1.4», «облаков вдвое больше», «небо розовое» — всё это
 * считается от файла самого игрока. Отсюда три свойства, ради которых схема
 * и выбрана:
 *
 *  • нейтральный срез возвращает ровно исходные числа — «как в игре» значит
 *    «не трогать», а не «записать похожее»;
 *  • одна и та же настройка ложится на любую погоду, и дождь остаётся
 *    дождём: его серое небо не подменяется ясным, если дождь не выключен;
 *  • вид ложится на любой установленный редукс, а не только на ваниль.
 *
 * Цвет — единственное исключение из «относительного»: розовое небо задаётся
 * цветом, но яркость каждого часа берётся из базы. Полдень остаётся ярче
 * полуночи, а небо — розовым в оба часа (`recolour` в `look-apply.js`).
 */

import { TIMECYCLE_SAMPLES, SAMPLE_COUNT, celestialDirections } from "./samples.js";
import { createRainbow, normalizeRainbow } from "./rainbow.js";
import { MOON_SIZE_LIMIT, normalizeBody } from "./sky-body.js";
import { normalizeStarSheet } from "./sky-stars.js";
import { atmosphereIsNeutral, normalizeAtmosphere } from "./atmosphere.js";
import { lightIsNeutral, normalizeLight } from "./light.js";
import { cloudSizeIsNeutral, normalizeCloudSize } from "./cloud-size.js";
import { auroraIsNeutral, normalizeAurora } from "./aurora.js";
import { cometIsNeutral, normalizeComet } from "./comet.js";
import { appliedMoonBody } from "./space-templates.js";
import { CLOUD_TEMPLATE_IDS, OWN_CLOUD_LIMITS, normalizeOwnCloudTemplate } from "./cloud-templates.js";

/** Облачные шапки, которые позволено выбрать: ключи — `CLOUD_HATS` из `cloud-keyframes.js`. */
const HAT_ID = /^[a-z0-9-]{2,32}$/;

/*
 * Срезы суток.
 *
 * Тринадцать опорных кадров — это язык файла, а не человека. Человек говорит
 * «утро», «день», «вечер», «ночь», и правит обычно их, а не 07:00 отдельно от
 * 10:00. Границы — по высоте солнца, посчитанной по орбите игры
 * (`celestialDirections`): 06:00 и 20:00 кладут солнце на горизонт, луна
 * выходит после 21:00. Поэтому ночь — это 21, 22, 00 и 05, а не «с восьми».
 */
export const LOOK_SLOT_GROUPS = Object.freeze([
  group("night", "Ночь", "Night", [11, 12, 0, 1]),
  group("morning", "Утро", "Morning", [2, 3, 4]),
  group("day", "День", "Day", [5, 6, 7]),
  group("evening", "Вечер", "Evening", [8, 9, 10]),
]);

function group(id, ru, en, slots) {
  return Object.freeze({
    id,
    label: Object.freeze({ ru, en }),
    slots: Object.freeze(slots),
  });
}

export const ALL_SLOTS = Object.freeze(
  TIMECYCLE_SAMPLES.map((sample) => sample.index),
);

/** Ночной ли срез: над горизонтом луна, а не солнце. */
export const isNightSlot = (index) =>
  LOOK_SLOT_GROUPS[0].slots.includes(Number(index));

/** Высота солнца в срезе — по орбите игры, как и в кадре предпросмотра. */
export const slotSunElevation = (index) =>
  celestialDirections(TIMECYCLE_SAMPLES[index]?.hour ?? 12).sun.z;

/** В какой части суток стоит срез. */
export const slotGroup = (index) =>
  LOOK_SLOT_GROUPS.find((item) => item.slots.includes(Number(index))) ||
  LOOK_SLOT_GROUPS[2];

/*
 * Выключатели погоды.
 *
 * `true` — погода бывает в игре такой, какая она есть; `false` — её нет:
 * там, где сервер включит дождь, будет ваше ясное небо без капель и луж.
 * Радуга наоборот: её в игре нет, и `true` добавляет её отдельным файлом.
 * Какие типы погоды стоят за каждым выключателем — `WEATHER_TOGGLES` в
 * `look-apply.js`: таблица одна на сборку и на подписи.
 *
 * Блики объектива (`flares`) — тоже на сутки целиком, но с обратным
 * умолчанием: «как в игре» — это `true`, а вид Astral начинается без них
 * (`false`). Полосы и пятна от солнца владелец счёл браком установленного
 * неба (26.09.2026), и новое небо их не несёт, пока человек сам не вернёт.
 * Что именно гасится — `lens-flare.js`.
 *
 * Весь кадр серым (`grayFrame`, задача 35 (в), 19.10.2026) — выключатель с
 * умолчанием «выключен»: насыщенность картинки игры (`postfx_desaturation`)
 * ставится в ноль во все часы и во всех типах погоды, поверх ползунка
 * «Насыщенность» срезов. Серыми становятся и люди, и машины, и небо с водой —
 * то, что не берут текстуры «ЧБ-мира». HUD игры рисуется после этого и
 * остаётся цветным. Включает его вкладка «ЧБ-мир», а не редактор неба.
 */
export const WEATHER_TOGGLE_IDS = Object.freeze([
  "fog",
  "overcast",
  "rain",
  "thunder",
  "snow",
  "blizzard",
]);

/*
 * Вечная погода (ТЗ 17.10.2026, вечер, задача 3): одна погода на всё
 * расписание игры. `weather.eternal` — тип из `weather.xml` или `null`, «как в
 * игре»: тогда расписание не трогается. Расписание — раздел `WeatherCycles`
 * файла погоды; его читает игра без скрипта. Сервер, миссия или скрипт,
 * который сам ставит погоду, расписание перекрывает — и файл этого не меняет.
 * Все семнадцать типов — те же, что в `LOOK_WEATHERS` (`look-apply.js`); тест
 * держит списки одинаковыми.
 */
export const ETERNAL_WEATHER_IDS = Object.freeze([
  "EXTRASUNNY",
  "CLEAR",
  "CLOUDS",
  "SMOG",
  "FOGGY",
  "OVERCAST",
  "RAIN",
  "CLEARING",
  "THUNDER",
  "SNOW",
  "SNOWLIGHT",
  "XMAS",
  "BLIZZARD",
  "NEUTRAL",
  "HALLOWEEN",
  "RAIN_HALLOWEEN",
  "SNOW_HALLOWEEN",
]);

/** Выключатель, без которого погода — ясный день: вечная гроза при выключенной грозе была бы дождём. */
const ETERNAL_NEEDS = Object.freeze({
  FOGGY: "fog",
  OVERCAST: "overcast",
  RAIN: "rain",
  CLEARING: "rain",
  THUNDER: "thunder",
  SNOW: "snow",
  SNOWLIGHT: "snow",
  XMAS: "snow",
  BLIZZARD: "blizzard",
});

/*
 * Пределы. Одни на разбор чужого кода, на ползунки и на сборку: число из
 * кода работы, которое вышло бы за ползунок, не должно доехать до файла игры.
 */
export const LOOK_LIMITS = Object.freeze({
  skyBrightness: Object.freeze({ min: 0.01, max: 4 }),
  /* Свет мира — солнце или луна на домах и свет неба на земле: от двадцатой
     доли (ночь, где видны одни фонари) до четырёх раз. */
  light: Object.freeze({ min: 0.05, max: 4 }),
  sunSize: Object.freeze({ min: 0, max: 6 }),
  /* Яркость солнца — диск и ореол вместе (`look-apply.js`). Вдвое ярче игры
     — предел: диск в игре и так на пороге белого (`sky_sun_hdr` до 220), и
     выше пересвет съедал полнеба. */
  sunGlow: Object.freeze({ min: 0, max: 2 }),
  /* Размер луны — множитель к штатному `sky_moon_disc_size`: лист луны в игре 128×128 и выше предела мылит (`sky-body.js`, `MOON_SIZE_LIMIT`). */
  moonSize: Object.freeze({ min: 0, max: MOON_SIZE_LIMIT }),
  moonBrightness: Object.freeze({ min: 0, max: 6 }),
  stars: Object.freeze({ min: 0, max: 8 }),
  /* Ночь подробно (21.11.2026): зарево луны у горизонта — сила и разлёт, свечение картинки ночью. */
  halo: Object.freeze({ min: 0, max: 2 }),
  haloSpread: Object.freeze({ min: 0.25, max: 4 }),
  bloom: Object.freeze({ min: 0, max: 4 }),
  cloudAmount: Object.freeze({ min: 0, max: 2 }),
  haze: Object.freeze({ min: 0.05, max: 4 }),
  exposure: Object.freeze({ min: -2, max: 2 }),
  saturation: Object.freeze({ min: 0, max: 2 }),
});

const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (value, { min, max }, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
};

const hexOrNull = (value) => {
  const text = String(value ?? "").trim();
  return HEX.test(text) ? text.toLowerCase() : null;
};

/*
 * Небо часа — до пяти цветов, как их различает купол игры (`SkydomeVS`):
 *
 *   zenith  — верх неба (`sky_zenith_col`);
 *   middle  — переход от верха к горизонту (`sky_zenith_transition_col`);
 *   east    — горизонт со стороны востока (`sky_azimuth_east_col`);
 *   west    — горизонт со стороны запада (`sky_azimuth_west_col`);
 *   sides   — горизонт на севере и юге, между востоком и западом
 *             (`sky_azimuth_transition_col`).
 *
 * Обязательны два — верх и горизонт (`horizon`); остальные, если не заданы,
 * выводятся из них: середина — смесь верха и горизонта, стороны — горизонт.
 * Так работы и готовые виды с двумя цветами остаются ровно такими, какими
 * были, а радужное небо — это просто пять разных цветов.
 */
export const SKY_PARTS = Object.freeze(["zenith", "middle", "east", "west", "sides"]);

function normalizeSky(raw) {
  if (!raw || typeof raw !== "object") return null;
  const zenith = hexOrNull(raw.zenith);
  const horizon = hexOrNull(raw.horizon);
  if (!zenith || !horizon) return null;
  const sky = { zenith, horizon };
  for (const part of ["middle", "east", "west", "sides"]) {
    const colour = hexOrNull(raw[part]);
    if (colour) sky[part] = colour;
  }
  return sky;
}

/** Все пять цветов неба — заданные и выведенные (`#rrggbb`). */
export function skyPartColours(sky) {
  const it = normalizeSky(sky);
  if (!it) return null;
  const middle =
    it.middle ||
    linearToHex(
      hexToLinear(it.zenith).map(
        (value, index) => (value + hexToLinear(it.horizon)[index]) / 2,
      ),
    );
  return {
    zenith: it.zenith,
    middle,
    east: it.east || it.horizon,
    west: it.west || it.horizon,
    sides: it.sides || it.horizon,
  };
}

/** Одинаково ли небо у двух срезов (с выведенными частями). */
export function sameSky(left, right) {
  const a = normalizeSky(left);
  const b = normalizeSky(right);
  if (!a || !b) return !a && !b;
  const pa = skyPartColours(a);
  const pb = skyPartColours(b);
  return a.horizon === b.horizon && SKY_PARTS.every((part) => pa[part] === pb[part]);
}

/*
 * Сутки.
 *
 * «Как в игре» — день сменяет ночь. «Вечный день» и «Вечная ночь» ставят в
 * каждый час числа полудня или полуночи (`CYCLE_HOURS`), «Свой час» (ТЗ
 * 17.10.2026, вечер, задача 3) — числа любого часа суток (`cycle.hour`, шаг
 * в полчаса; между опорными кадрами — так, как смешивает их игра). Небо и
 * свет мира при этом могут прийти из разных часов (`cycle.light`): чёрное
 * ночное небо над городом, освещённым как днём, и дневное небо над тёмным
 * городом — просьба владельца 28.09.2026; свет мира — день, ночь или свой
 * час (`cycle.lightHour`). Что относится к свету мира, а что к небу, —
 * `isWorldLightParameter` в `look-apply.js`.
 *
 * Солнце и луна сюда не входят: диск и направление света идут по часам игры,
 * файл таймцикла положения светила не хранит (в `time.xml` — только орбита).
 * Замерзают числа неба, света, тумана и теней.
 */
export const LOOK_CYCLES = Object.freeze(["normal", "day", "night", "hour"]);
export const CYCLE_LIGHTS = Object.freeze(["auto", "day", "night", "hour"]);
/** Час вечного дня и вечной ночи: 12:00 и 00:00. */
export const CYCLE_HOURS = Object.freeze({ day: 12, night: 0 });
/** Опорный кадр вечного дня и вечной ночи (`TIMECYCLE_SAMPLES`): 12:00 и 00:00. */
export const CYCLE_SOURCE = Object.freeze({ day: 5, night: 0 });
/** Шаг своего часа, часов. */
export const CYCLE_HOUR_STEP = 0.5;

/** Час суток в границах: 0…23.5 с шагом в полчаса; не число — запасной (полдень). */
export function clampCycleHour(value, fallback = 12) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const wrapped = ((number % 24) + 24) % 24;
  return (Math.round(wrapped / CYCLE_HOUR_STEP) * CYCLE_HOUR_STEP) % 24;
}

/**
 * Из какого часа в вечных сутках берутся небо и свет мира: `{ sky, light }` в
 * часах суток; `null` — сутки как в игре.
 */
export function cycleHours(cycle) {
  if (!cycle || cycle.mode === "normal" || !LOOK_CYCLES.includes(cycle.mode)) return null;
  const sky = cycle.mode === "hour" ? clampCycleHour(cycle.hour) : CYCLE_HOURS[cycle.mode];
  let light = sky;
  if (cycle.light === "hour") light = clampCycleHour(cycle.lightHour, sky);
  else if (cycle.light === "day" || cycle.light === "night") light = CYCLE_HOURS[cycle.light];
  return { sky, light };
}

/** Срез «как в игре»: ни одна настройка не трогает базу. */
export function createSlot() {
  return {
    sky: null,
    skyBrightness: 1,
    light: 1,
    sun: { size: 1, glow: 1, colour: null },
    moon: { size: 1, brightness: 1, colour: null },
    stars: 1,
    /* Ночь подробно: лунный свет на городе, цвет теней, зарево луны, туман, свечение. Только ночные срезы. */
    night: { moonlight: null, shadows: null, fog: null, halo: 1, haloSpread: 1, bloom: 1 },
    clouds: { amount: null, colour: null },
    haze: 1,
    exposure: 0,
    saturation: 1,
    from: null,
  };
}

/**
 * Вид «как в игре»: пустые срезы, облака и погода не тронуты.
 *
 * Облака — одно из трёх: как в игре (`types: null`, `template: null`), свои
 * виды шапок (`types` — список, пустой — «без облаков») или готовое небо
 * облаков (`template` — `cloud-templates.js`). Шаблон и свои виды друг друга
 * исключают: шаблон — это уже целиком собранное небо.
 *
 * `own` — свои шаблоны, собранные человеком (`normalizeOwnCloudTemplate`): они
 * едут в проекте неба, а `template` может называть и такой номер. Выбор облаков
 * (`types`, `template`) список не меняет; нейтральность вида он не трогает.
 */
export function createLook() {
  return {
    slots: Array.from({ length: SAMPLE_COUNT }, createSlot),
    cycle: { mode: "normal", light: "auto" },
    clouds: { types: null, template: null, own: [] },
    weather: {
      fog: true,
      overcast: true,
      rain: true,
      thunder: true,
      snow: true,
      blizzard: true,
      rainbow: false,
      flares: false,
      eternal: null,
      chameleon: false,
      grayFrame: false,
      noStars: false,
    },
    /* Когда видна радуга и насколько ярко (`rainbow.js`); стоит ли она
       вообще — выключатель `weather.rainbow`. */
    rainbow: createRainbow(),
    /* Атмосфера (`atmosphere.js`): туман, дымка, лучи, видимость на все 17 типов погоды; `null` — как в игре. */
    atmosphere: null,
    /* Свет и картинка (`light.js`): жёсткость света, тени, лужи, резкость, виньетка, ветер; `null` — как в игре. */
    light: null,
    /* Большие облака (`cloud-size.js`): размер, высота, скорость шапок; `null` — как в игре. */
    cloudSize: null,
    /* Северное сияние, ступень А (`aurora.js`): цветная полоса на ночном небе; `null` — сияния нет. */
    aurora: null,
    /* Комета (`comet.js`): ночью по небу пролетает тело с хвостом; `null` — кометы нет, выключенная тоже ничего не меняет. */
    comet: null,
    /* Небесное тело вместо луны (`sky-body.js`); `null` — луна игры. */
    moonBody: null,
    /* Свой лист звёзд (`sky-stars.js`); `null` — звёзды игры. */
    starSheet: null,
  };
}

/**
 * Срез в границах. Всё, чего нет или что не число, становится «как в игре»:
 * срез приходит и из кода работы, и из пресета, и из старой версии
 * приложения, и отказ на одном кривом поле потерял бы весь вид.
 */
export function normalizeSlot(raw) {
  const base = createSlot();
  if (!raw || typeof raw !== "object") return base;
  const from = Number(raw.from);
  return {
    sky: normalizeSky(raw.sky),
    skyBrightness: clamp(raw.skyBrightness, LOOK_LIMITS.skyBrightness, 1),
    light: clamp(raw.light, LOOK_LIMITS.light, 1),
    sun: {
      size: clamp(raw.sun?.size, LOOK_LIMITS.sunSize, 1),
      glow: clamp(raw.sun?.glow, LOOK_LIMITS.sunGlow, 1),
      colour: hexOrNull(raw.sun?.colour),
    },
    moon: {
      size: clamp(raw.moon?.size, LOOK_LIMITS.moonSize, 1),
      brightness: clamp(raw.moon?.brightness, LOOK_LIMITS.moonBrightness, 1),
      colour: hexOrNull(raw.moon?.colour),
    },
    stars: clamp(raw.stars, LOOK_LIMITS.stars, 1),
    night: {
      moonlight: hexOrNull(raw.night?.moonlight),
      shadows: hexOrNull(raw.night?.shadows),
      fog: hexOrNull(raw.night?.fog),
      halo: clamp(raw.night?.halo, LOOK_LIMITS.halo, 1),
      haloSpread: clamp(raw.night?.haloSpread, LOOK_LIMITS.haloSpread, 1),
      bloom: clamp(raw.night?.bloom, LOOK_LIMITS.bloom, 1),
    },
    clouds: {
      amount:
        raw.clouds?.amount === null || raw.clouds?.amount === undefined
          ? null
          : clamp(raw.clouds.amount, LOOK_LIMITS.cloudAmount, null),
      colour: hexOrNull(raw.clouds?.colour),
    },
    haze: clamp(raw.haze, LOOK_LIMITS.haze, 1),
    exposure: clamp(raw.exposure, LOOK_LIMITS.exposure, 0),
    saturation: clamp(raw.saturation, LOOK_LIMITS.saturation, 1),
    from:
      raw.from !== null &&
      raw.from !== undefined &&
      Number.isInteger(from) &&
      from >= 0 &&
      from < SAMPLE_COUNT
        ? from
        : null,
  };
}

/**
 * Сутки в границах. Час лежит в виде только там, где он нужен: у «своего
 * часа» неба и у «своего часа» света; остальные виды суток хранят то же, что
 * и раньше, — `{ mode, light }`.
 */
function normalizeCycle(raw) {
  const mode = LOOK_CYCLES.includes(raw.mode) ? raw.mode : "normal";
  const light = CYCLE_LIGHTS.includes(raw.light) ? raw.light : "auto";
  const cycle = { mode, light };
  if (mode === "hour") cycle.hour = clampCycleHour(raw.hour);
  if (mode !== "normal" && light === "hour") cycle.lightHour = clampCycleHour(raw.lightHour, cycle.hour ?? CYCLE_HOURS[mode] ?? 12);
  return cycle;
}

/** Свои шаблоны облаков в границах пакета: только узнанные, без повторов номера, не больше `OWN_CLOUD_LIMITS.templates`. */
function normalizeOwnCloudList(raw) {
  const own = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const { template } = normalizeOwnCloudTemplate(item);
    if (!template || own.some((known) => known.id === template.id)) continue;
    own.push(template);
    if (own.length >= OWN_CLOUD_LIMITS.templates) break;
  }
  return own;
}

/** Вид в границах: тринадцать срезов, облака, погода. */
export function normalizeLook(raw) {
  const base = createLook();
  if (!raw || typeof raw !== "object") return base;
  const slots = Array.isArray(raw.slots) ? raw.slots : [];
  const types = raw.clouds?.types;
  /* Шаблон из чужого кода, которого этот Astral не знает, — «как в игре», а
     не отказ открыть работу. */
  const own = normalizeOwnCloudList(raw.clouds?.own);
  const template =
    CLOUD_TEMPLATE_IDS.includes(raw.clouds?.template) || own.some((item) => item.id === raw.clouds?.template)
      ? raw.clouds.template
      : null;
  const weather = raw.weather && typeof raw.weather === "object" ? raw.weather : {};
  const cycle = raw.cycle && typeof raw.cycle === "object" ? raw.cycle : {};
  return {
    slots: base.slots.map((_, index) => normalizeSlot(slots[index])),
    cycle: normalizeCycle(cycle),
    clouds: {
      types:
        !template && Array.isArray(types)
          ? [...new Set(types.map(String).filter((id) => HAT_ID.test(id)))].slice(0, 24)
          : null,
      template,
      own,
    },
    weather: {
      ...Object.fromEntries(
        WEATHER_TOGGLE_IDS.map((id) => [id, weather[id] !== false]),
      ),
      rainbow: weather.rainbow === true,
      /* Вид из старой версии, где выключателя не было, тоже без бликов:
         они и есть тот брак, который тогда уезжал в игру. */
      flares: weather.flares === true,
      /* Расписание погоды: тип, который держит игра, или «как в игре». */
      eternal: ETERNAL_WEATHER_IDS.includes(weather.eternal) ? weather.eternal : null,
      /* Хамелеон: выбранная погода — и на сервере. Своего типа у него нет: он
         держит тот, что выбран как вечный, и без него не существует. */
      chameleon: ETERNAL_WEATHER_IDS.includes(weather.eternal) && weather.chameleon === true,
      /* Серый кадр включает только явное `true`: вид из старой версии его не знает. */
      grayFrame: weather.grayFrame === true,
      /* Без звёзд: ночное небо идеально чёрное (`applyLookToRegion`). */
      noStars: weather.noStars === true,
    },
    rainbow: normalizeRainbow(raw.rainbow),
    atmosphere: normalizeAtmosphere(raw.atmosphere),
    light: normalizeLight(raw.light),
    cloudSize: normalizeCloudSize(raw.cloudSize),
    aurora: normalizeAurora(raw.aurora),
    comet: normalizeComet(raw.comet),
    moonBody: normalizeBody(raw.moonBody),
    starSheet: normalizeStarSheet(raw.starSheet),
  };
}

/** Настройки радуги: когда видна и насколько ярко. */
export function setRainbow(look, patch) {
  const current = normalizeLook(look);
  return normalizeLook({
    ...current,
    rainbow: { ...current.rainbow, ...(patch || {}) },
  });
}

const sameNumber = (left, right) => Math.abs(left - right) < 1e-9;

/** Нейтрален ли срез — не меняет ли он в базе ничего. */
export function slotIsNeutral(slot) {
  const it = normalizeSlot(slot);
  return (
    !it.sky &&
    sameNumber(it.skyBrightness, 1) &&
    sameNumber(it.light, 1) &&
    sameNumber(it.sun.size, 1) &&
    sameNumber(it.sun.glow, 1) &&
    !it.sun.colour &&
    sameNumber(it.moon.size, 1) &&
    sameNumber(it.moon.brightness, 1) &&
    !it.moon.colour &&
    sameNumber(it.stars, 1) &&
    !it.night.moonlight &&
    !it.night.shadows &&
    !it.night.fog &&
    sameNumber(it.night.halo, 1) &&
    sameNumber(it.night.haloSpread, 1) &&
    sameNumber(it.night.bloom, 1) &&
    it.clouds.amount === null &&
    !it.clouds.colour &&
    sameNumber(it.haze, 1) &&
    sameNumber(it.exposure, 0) &&
    sameNumber(it.saturation, 1) &&
    it.from === null
  );
}

/**
 * Сутки «как в игре»: все погоды на месте, радуги нет, блики объектива —
 * как у игры. Без бликов (умолчание вида Astral) — это правка: «Применить»
 * их уберёт. Серый кадр — тоже правка.
 */
export const weatherIsNeutral = (weather) =>
  WEATHER_TOGGLE_IDS.every((id) => weather?.[id] !== false) &&
  weather?.rainbow !== true &&
  weather?.flares === true &&
  weather?.grayFrame !== true &&
  weather?.noStars !== true &&
  !weather?.eternal;

/** Нейтрален ли вид целиком: «Применить» такого не ставит в игру ничего. */
export function lookIsNeutral(look) {
  const it = normalizeLook(look);
  return (
    it.slots.every(slotIsNeutral) &&
    it.cycle.mode === "normal" &&
    it.clouds.types === null &&
    it.clouds.template === null &&
    atmosphereIsNeutral(it.atmosphere) &&
    lightIsNeutral(it.light) &&
    cloudSizeIsNeutral(it.cloudSize) &&
    auroraIsNeutral(it.aurora) &&
    cometIsNeutral(it.comet) &&
    appliedMoonBody(it.moonBody) === null &&
    it.starSheet === null &&
    weatherIsNeutral(it.weather)
  );
}

/*
 * Небо часа ложится целиком: выбранный образец с двумя цветами не должен
 * унаследовать восток и запад прежнего радужного неба. Правка одного цвета
 * присылает небо целиком (`skyWithPart`).
 */
const ATOMIC_SLOT_KEYS = new Set(["sky"]);

/** Небо с одним изменённым цветом: остальные — как видны сейчас. */
export function skyWithPart(sky, part, colour) {
  const parts = skyPartColours(sky) || null;
  const value = hexOrNull(colour);
  if (!value || !SKY_PARTS.includes(part)) return normalizeSky(sky);
  const base = parts || {
    zenith: value,
    middle: value,
    east: value,
    west: value,
    sides: value,
  };
  const next = { ...base, [part]: value };
  /* Горизонт в модели — общий цвет сторон; сохраняется восточный, чтобы
     старые читатели двух цветов видели осмысленное небо. */
  return normalizeSky({ ...next, horizon: next.east });
}

/**
 * Правка нескольких срезов разом.
 *
 * `patch` — часть среза: `{ sun: { size: 1.4 } }` меняет только размер
 * солнца и оставляет его цвет и свечение. Вложенные объекты сливаются, а не
 * подменяются: иначе ползунок размера стирал бы выбранный рядом цвет.
 * Возвращает новый вид; исходный не меняется — на нём стоит история отмены.
 */
export function patchSlots(look, indexes, patch) {
  const current = normalizeLook(look);
  const targets = new Set(
    (Array.isArray(indexes) ? indexes : [indexes]).map(Number),
  );
  const slots = current.slots.map((slot, index) => {
    if (!targets.has(index)) return slot;
    const next = { ...slot };
    for (const [key, value] of Object.entries(patch || {})) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !ATOMIC_SLOT_KEYS.has(key) &&
        slot[key] &&
        typeof slot[key] === "object"
      )
        next[key] = { ...slot[key], ...value };
      else next[key] = value;
    }
    return normalizeSlot(next);
  });
  return { ...current, slots };
}

/** Срезы целиком из другого среза — «сделать вечер как этот час». */
export function copySlot(look, from, indexes) {
  const current = normalizeLook(look);
  const source = current.slots[Number(from)];
  if (!source) return current;
  const targets = new Set(
    (Array.isArray(indexes) ? indexes : [indexes]).map(Number),
  );
  return {
    ...current,
    slots: current.slots.map((slot, index) =>
      targets.has(index) && index !== Number(from)
        ? normalizeSlot(structuredCloneSafe(source))
        : slot,
    ),
  };
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Выбор облаков: `null` — как в игре, `[]` — без облачных шапок. */
export function setCloudTypes(look, types) {
  const current = normalizeLook(look);
  return normalizeLook({ ...current, clouds: { types, template: null, own: current.clouds.own } });
}

/** Готовое небо облаков (`cloud-templates.js`); `null` — как в игре. */
export function setCloudTemplate(look, template) {
  const current = normalizeLook(look);
  return normalizeLook({ ...current, clouds: { types: null, template, own: current.clouds.own } });
}

/**
 * Свой шаблон облаков — в проект неба: новый номер добавляется, прежний заменяется. `select` (по умолчанию) ещё и
 * выбирает его небом проекта. Не прошедший пределы пакета шаблон проект не меняет.
 */
export function saveOwnCloudTemplate(look, rawTemplate, { select = true } = {}) {
  const current = normalizeLook(look);
  const { template } = normalizeOwnCloudTemplate(rawTemplate);
  if (!template) return current;
  const own = current.clouds.own.some((item) => item.id === template.id)
    ? current.clouds.own.map((item) => (item.id === template.id ? template : item))
    : [...current.clouds.own, template];
  if (own.length > OWN_CLOUD_LIMITS.templates) return current;
  return normalizeLook({
    ...current,
    clouds: select
      ? { types: null, template: template.id, own }
      : { ...current.clouds, own },
  });
}

/** Убрать свой шаблон из проекта; если он был небом проекта, облака снова «как в игре». */
export function removeOwnCloudTemplate(look, id) {
  const current = normalizeLook(look);
  const own = current.clouds.own.filter((item) => item.id !== id);
  return normalizeLook({
    ...current,
    clouds: { ...current.clouds, template: current.clouds.template === id ? null : current.clouds.template, own },
  });
}

/** Сутки: `{ mode }` — как в игре, вечный день или ночь; `{ light }` — чей свет у мира. */
export function setCycle(look, patch) {
  const current = normalizeLook(look);
  return normalizeLook({ ...current, cycle: { ...current.cycle, ...(patch || {}) } });
}

/**
 * Вечная погода: тип, который игра держит по расписанию, или `null` — «как в
 * игре». Выключатель, без которого такая погода стала бы ясным днём
 * (дождь, снег, туман…), включается вместе с выбором.
 */
export function setEternalWeather(look, id) {
  const current = normalizeLook(look);
  const eternal = ETERNAL_WEATHER_IDS.includes(id) ? id : null;
  const needs = eternal ? ETERNAL_NEEDS[eternal] : null;
  return normalizeLook({
    ...current,
    weather: { ...current.weather, eternal, ...(needs ? { [needs]: true } : {}) },
  });
}

/**
 * Небесное тело вместо луны: `null` — луна игры; `{ kind, … }` — планета (`sky-body.js`). Тело того же вида правится
 * по полям (фаза, свет, наклон), другого вида — начинается с умолчаний своего вида.
 */
/**
 * Атмосфера (`atmosphere.js`): `null` — как в игре; объект — туман, дымка, лучи, видимость. Правка по полям: незаданное остаётся, каким было.
 */
export function setAtmosphere(look, patch) {
  const current = normalizeLook(look);
  if (patch === null || patch === undefined) return normalizeLook({ ...current, atmosphere: null });
  return normalizeLook({ ...current, atmosphere: normalizeAtmosphere({ ...(current.atmosphere || {}), ...patch }) });
}

/** Свет и картинка (`light.js`): `null` — как в игре; правка по полям. */
export function setLight(look, patch) {
  const current = normalizeLook(look);
  if (patch === null || patch === undefined) return normalizeLook({ ...current, light: null });
  return normalizeLook({ ...current, light: normalizeLight({ ...(current.light || {}), ...patch }) });
}

/** Большие облака (`cloud-size.js`): `null` — как в игре; правка по полям. */
export function setCloudSize(look, patch) {
  const current = normalizeLook(look);
  if (patch === null || patch === undefined) return normalizeLook({ ...current, cloudSize: null });
  return normalizeLook({ ...current, cloudSize: normalizeCloudSize({ ...(current.cloudSize || {}), ...patch }) });
}

/** Северное сияние (`aurora.js`): `null` — сияния нет; правка по полям, пустой объект — сияние с умолчаниями. */
export function setAurora(look, patch) {
  const current = normalizeLook(look);
  if (patch === null || patch === undefined) return normalizeLook({ ...current, aurora: null });
  return normalizeLook({ ...current, aurora: normalizeAurora({ ...(current.aurora || {}), ...patch }) });
}

/**
 * Комета (`comet.js`): `null` — кометы нет; правка по полям, незаданное остаётся, каким было (настройки живут и у выключенной).
 * Включает `{ enabled: true }`; пустой объект даёт выключенную комету с умолчаниями.
 */
export function setComet(look, patch) {
  const current = normalizeLook(look);
  if (patch === null || patch === undefined) return normalizeLook({ ...current, comet: null });
  return normalizeLook({ ...current, comet: normalizeComet({ ...(current.comet || {}), ...patch }) });
}

export function setMoonBody(look, patch) {
  const current = normalizeLook(look);
  if (patch === null || patch === undefined) return normalizeLook({ ...current, moonBody: null });
  const same = current.moonBody && (!patch.kind || patch.kind === current.moonBody.kind);
  return normalizeLook({ ...current, moonBody: normalizeBody({ ...(same ? current.moonBody : {}), ...patch }) });
}

/**
 * Свой лист звёзд вместо листа игры: `null` — звёзды игры; объект — плотность, яркость, цвет, лучи (`sky-stars.js`).
 * Правка по полям: незаданное остаётся, каким было.
 */
export function setStarSheet(look, patch) {
  const current = normalizeLook(look);
  if (patch === null || patch === undefined) return normalizeLook({ ...current, starSheet: null });
  return normalizeLook({ ...current, starSheet: normalizeStarSheet({ ...(current.starSheet || {}), ...patch }) });
}

/**
 * Погода-хамелеон (21.11.2026): все семнадцать типов погоды выглядят как
 * вечная погода. Расписание перекрывают сервер, миссия и скрипт: они ставят
 * тип по имени, а как он выглядит, берётся из файлов игрока — поэтому, если
 * каждый тип в них копия выбранного, любая погода сервера выглядит выбранной.
 * Работает только вместе с вечной погодой (из неё берётся тип); без неё — «как в игре».
 */
export function setChameleonWeather(look, on) {
  const current = normalizeLook(look);
  return normalizeLook({
    ...current,
    weather: { ...current.weather, chameleon: Boolean(on) && current.weather.eternal !== null },
  });
}

/** Весь кадр серым: насыщенность картинки в ноль во все часы (`weather.grayFrame`). */
export function setGrayFrame(look, on) {
  const current = normalizeLook(look);
  return normalizeLook({ ...current, weather: { ...current.weather, grayFrame: Boolean(on) } });
}

/** Выключатель погоды. */
export function setWeatherToggle(look, id, on) {
  const current = normalizeLook(look);
  return normalizeLook({
    ...current,
    weather: { ...current.weather, [id]: Boolean(on) },
  });
}

/*
 * Цвет в линейном свете.
 *
 * Человек выбирает цвет на экране — в sRGB. Шейдер неба и сама игра
 * складывают свет линейно и переводят в экранный цвет только в конце, поэтому
 * выбранный оттенок переводится туда же: иначе розовый в палитре выходил бы
 * в кадре лососевым, а голубой — бирюзовым.
 */
export function hexToLinear(hex) {
  const value = hexOrNull(hex);
  if (!value) return null;
  return [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

export function linearToHex(rgb) {
  const channels = (rgb || [0, 0, 0]).map((channel) => {
    const value = Math.min(Math.max(Number(channel) || 0, 0), 1);
    const encoded =
      value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(Math.max(encoded, 0), 1) * 255)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}
