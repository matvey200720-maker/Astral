/*
 * Какую погоду показывает кадр редактора неба.
 *
 * Выключатели погоды — это «бывает ли она в игре» (`look.weather`), а кадр
 * один и показывает один момент: игра тоже не рисует дождь со снегом сразу.
 * Поэтому здесь выбирается ОДНА погода, и выбирается так, как её соберёт
 * установка (`resolveWeatherPlan`): выключенная гроза — это дождь, если он
 * включён, а выключенная метель — снегопад; иначе — ясный день игрока. Кадр и
 * установка не могут разойтись, потому что решает одна функция.
 *
 * Что показывается:
 *  • вечная погода, если она выбрана, — игра держит её по расписанию, и она
 *    видна сразу;
 *  • иначе погода последнего нажатого выключателя (`focus`): включил снег —
 *    снег, выключил метель — то, чем её заменит сборка;
 *  • иначе (открыли сохранённую работу, выключателей не касались): когда
 *    включено всё — ясный день, как в игре без правок, а когда часть
 *    выключена — сильнейшее из оставшегося.
 *
 * Осадки, ветер и туман кадра — подсказка, какую погоду смотрят
 * (`weather-conditions.js`), а не правка: в файлы игры они не уезжают.
 */

import {
  PREVIEW_WEATHER,
  WEATHER_TOGGLE_IDS,
  resolveWeatherPlan,
  weatherConditions,
} from "@modovik/timecycle";

/** Выключатели от сильного к слабому и погода, которую каждый показывает. */
const TOGGLE_WEATHERS = Object.freeze([
  { toggle: "blizzard", weather: "BLIZZARD" },
  { toggle: "thunder", weather: "THUNDER" },
  { toggle: "snow", weather: "SNOW" },
  { toggle: "rain", weather: "RAIN" },
  { toggle: "fog", weather: "FOGGY" },
  { toggle: "overcast", weather: "OVERCAST" },
]);

const WEATHER_OF = Object.freeze(
  Object.fromEntries(TOGGLE_WEATHERS.map((item) => [item.toggle, item.weather])),
);

function wantedWeather(toggles, focus) {
  if (toggles.eternal) return toggles.eternal;
  if (focus && WEATHER_OF[focus]) return WEATHER_OF[focus];
  if (WEATHER_TOGGLE_IDS.every((id) => toggles[id] !== false)) return PREVIEW_WEATHER;
  return (
    TOGGLE_WEATHERS.find((item) => toggles[item.toggle] !== false)?.weather ||
    PREVIEW_WEATHER
  );
}

/**
 * Погода кадра: `weather` — какая выбрана, `base` — чей файл таймцикла рисует
 * небо (выключенная гроза рисуется файлом дождя), `mode` — что на него ложится
 * (`look` — вид целиком, `style` — только общее).
 */
export function previewWeatherPlan(look, focus = null) {
  const toggles = look?.weather || {};
  const weather = wantedWeather(toggles, focus);
  const plan = resolveWeatherPlan(weather, toggles) || { base: PREVIEW_WEATHER, mode: "look" };
  return { weather, base: plan.base, mode: plan.mode };
}

/*
 * Двух хеллоуинских типов нет в таблице условий (их знает только свежий
 * `update.rpf`): дождь и снег у них обычные, туман — хеллоуинский.
 */
const HALLOWEEN_FALL = Object.freeze({ RAIN_HALLOWEEN: "RAIN", SNOW_HALLOWEEN: "SNOW" });

/** Осадки, ветер, снег, мокрота, молния и туман кадра — для рендерера (`weather`). */
export function previewConditions(weather) {
  const fall = HALLOWEEN_FALL[weather];
  if (!fall) return weatherConditions(weather);
  const base = weatherConditions(fall);
  return Object.freeze({
    ...base,
    weather,
    mist: Math.max(base.mist, weatherConditions("HALLOWEEN").mist),
  });
}

/*
 * Нечего рисовать сверх таймцикла: ни осадков, ни снега, ни мокрой земли, ни
 * молнии, ни тумана. Один ветер не в счёт — он ведёт только облака, а кадр
 * ясного дня всегда рисовался без него.
 */
export const isCalm = (conditions) =>
  conditions.precipitation.kind === "none" &&
  conditions.snow === 0 &&
  conditions.wetness === 0 &&
  conditions.lightning === 0 &&
  conditions.mist === 0;
