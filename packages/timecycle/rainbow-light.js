/*
 * Свет радуги по часам.
 *
 * Радуга в игре — излучающая модель (`SkyRainbowCommands.cs`): её яркость в
 * единицах HDR задана числом и сама по себе не меняется. А небо за ней от
 * полудня к полуночи темнеет на девять с половиной стопов — `sky_hdr` ванили
 * 30 → 0.3, у редукса владельца 38 → 0.2. Экспозиция игры подстраивается под
 * тёмный кадр, и дуга с дневной яркостью ночью светила в сотни раз сильнее
 * неба вокруг: сияние и ореол (27.09.2026, владелец: «эта радуга издаёт
 * сильное свечение»). Так же Rockstar разводит день и ночь у фар и фонарей
 * машин — в `visualsettings.dat` у каждой своя ночная яркость.
 *
 * Поэтому радуга идёт за небом игрока: в каждый час она та же доля яркости
 * неба, что и в полдень. Моделей несколько — ступенями по два стопа
 * (`RAINBOW_LIGHT.bandStops`), каждая видна в свои часы; яркость ступени —
 * среднее её часов. Ночная ступень не темнее `floorStops`: радуга
 * «круглосуточно» ночью остаётся видна, как лунная, но не сияет.
 *
 * Небо меряется так же, как кадр подбирает экспозицию (`skyLuminance`), по
 * ясному дню игрока с видом — тем, что кадр и показывает. Модуль один на окно
 * и на главный процесс: кадр и модели в игре светят одними числами. Эталон
 * ванили сюда не тянется — он весит, а обложкам неба, которые рисуют радугу
 * тем же рендерером, он не нужен: без неба игрока его подставляет тот, кто
 * зовёт (`sky-rainbow.js`, редактор неба).
 */

import { ALL_HOURS, rainbowHours } from "./rainbow.js";
import { resolveSkyState, skyLuminance } from "./sky-state.js";

export const RAINBOW_LIGHT = Object.freeze({
  /* Шаг ступеней: внутри ступени яркость ошибается не больше чем на стоп. */
  bandStops: 2,
  /* Ниже неба в 256 раз радуга не темнеет: лунная, но видная. */
  floorStops: -8,
  /* Ступеней — от полудня до пола: 0…−2, −2…−4, −4…−6, −6…−8 и сам пол. */
  maxTiers: 5,
});

const clampStops = (value) =>
  Math.min(
    0,
    Math.max(Number.isFinite(value) ? value : 0, RAINBOW_LIGHT.floorStops),
  );

/**
 * Яркость неба в каждый час суток (середина часа) в стопах от самого
 * светлого часа: 0 в полдень, около −9.5 в полночь. `null` — без неба.
 *
 * `document` — разобранный файл ясной погоды: в главном процессе — тот, что
 * уйдёт в игру, в окне — база игрока, а правки вида — `project` на погоду
 * `weather`.
 */
export function rainbowSkyStops({
  document = null,
  project = null,
  weather = null,
  region = "GLOBAL",
} = {}) {
  if (!document?.regions?.length) return null;
  const levels = ALL_HOURS.map((hour) =>
    skyLuminance(
      resolveSkyState({ document, project, weather, region, hour: hour + 0.5 }),
    ),
  );
  const peak = Math.max(...levels);
  if (!(peak > 0)) return ALL_HOURS.map(() => 0);
  return levels.map((level) =>
    Math.max(Math.log2(Math.max(level, 1e-12) / peak), -40),
  );
}

/** Профиль неба годится: 24 числа. */
export const isRainbowSkyStops = (stops) =>
  Array.isArray(stops) &&
  stops.length === ALL_HOURS.length &&
  stops.every((value) => Number.isFinite(Number(value)));

/**
 * Ступени радуги: какие часы видит какая модель и во сколько раз она тусклее
 * полуденной. Ярчайшая — первой. Без профиля неба — одна ступень во все часы
 * радуги, как было до 27.09.
 *
 * @returns {{ hours: number[], light: number }[]}
 */
export function rainbowTiers(raw, stops) {
  const hours = rainbowHours(raw);
  if (!hours.length) return [];
  if (!isRainbowSkyStops(stops)) return [{ hours, light: 1 }];
  const bands = new Map();
  for (const hour of hours) {
    const value = clampStops(Number(stops[hour]));
    const band = Math.min(
      Math.floor(-value / RAINBOW_LIGHT.bandStops),
      RAINBOW_LIGHT.maxTiers - 1,
    );
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push({ hour, value });
  }
  return [...bands.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, items]) => ({
      hours: items.map((item) => item.hour),
      light:
        2 **
        (items.reduce((total, item) => total + item.value, 0) / items.length),
    }));
}

/**
 * Доля полуденной яркости у радуги в этот час — для кадра. Вне часов радуги
 * — ступень соседнего часа: в ней радуга и гаснет или проявляется
 * (`rainbowVisibility`).
 */
export function rainbowLightAt(raw, stops, hour) {
  const byHour = new Map();
  for (const tier of rainbowTiers(raw, stops))
    for (const item of tier.hours) byHour.set(item, tier.light);
  const current = ((Math.floor(Number(hour) || 0) % 24) + 24) % 24;
  for (const candidate of [current, (current + 23) % 24, (current + 1) % 24])
    if (byHour.has(candidate)) return byHour.get(candidate);
  return 0;
}
