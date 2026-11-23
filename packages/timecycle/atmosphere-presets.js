/*
 * Готовые атмосферы (21.11.2026): простой уровень раздела «Атмосфера» — одним щелчком, потом правятся теми же ручками.
 * Числа — не цвет «как нарисовано», а оттенок и сила: яркость каждого часа приходит из файла игрока (см. atmosphere.js, applyAtmosphere).
 * Видимость — расстояние, на котором мир растворяется до десятой части; «высота слоя»: меньше единицы — стелется по земле, больше — стоит стеной.
 */

import { normalizeAtmosphere } from "./atmosphere.js";

function preset(id, ru, hint, atmosphere, cover = {}) {
  return Object.freeze({
    id,
    label: Object.freeze({ ru }),
    hint: Object.freeze({ ru: hint }),
    atmosphere: Object.freeze(normalizeAtmosphere(atmosphere)),
    /* В какой час снимать плитку: день и ночь рядом. */
    cover: Object.freeze({ day: cover.day ?? 13, night: cover.night ?? 22 }),
  });
}

export const ATMOSPHERE_PRESETS = Object.freeze([
  preset(
    "grey-fog",
    "Серый туман",
    "Плотная серая мгла: мир тонет в нескольких сотнях метров, фонари светятся",
    { visibility: 260, height: 1.4, colour: "#9ea4ab", nightColour: "#1c2024", horizonColour: "#b8bdc3", haze: 1.5, rays: 1.3, lamps: 2 },
  ),
  preset(
    "morning-haze",
    "Утренняя дымка",
    "Низкая светлая дымка над землёй, тёплый горизонт, лучи света",
    { visibility: 900, height: 0.6, colour: "#d9dfe8", nightColour: "#20252d", horizonColour: "#f0e6d8", haze: 1.8, rays: 1.6, lamps: 1.5 },
    { day: 8, night: 22 },
  ),
  preset(
    "milk",
    "Молочная мгла",
    "Белёсая стена тумана на всю высоту, свет мягкий, без лучей",
    { visibility: 450, height: 2.2, colour: "#e8ebef", nightColour: "#2a2e33", horizonColour: "#f4f5f7", haze: 2.2, rays: 0.6, lamps: 1.5 },
  ),
  preset(
    "dusk",
    "Сумеречный",
    "Лиловая дымка, тёплые огни, дальний план тонет в сумерках",
    { visibility: 1400, height: 1, colour: "#8f84a8", nightColour: "#161422", horizonColour: "#d98a6a", haze: 1.6, rays: 1, lamps: 2.5 },
    { day: 18, night: 22 },
  ),
  preset(
    "after-rain",
    "После дождя",
    "Чистый влажный воздух, туман у самой земли, длинные лучи света",
    { visibility: 2200, height: 0.5, colour: "#a9b6c2", nightColour: "#1a2026", horizonColour: "#cfd9e2", haze: 1.3, rays: 1.8, lamps: 1.5 },
  ),
  preset(
    "sandstorm",
    "Песчаная буря",
    "Рыжая пыльная дымка: видно на двести метров",
    { visibility: 200, height: 1.6, colour: "#c9985a", nightColour: "#2a1d10", horizonColour: "#e8b878", haze: 1.8, rays: 0.6, lamps: 2.5 },
  ),
  preset(
    "unreal",
    "Нереальный",
    "Лиловый туман с бирюзовым горизонтом: мир не из этой планеты",
    { visibility: 600, height: 1.8, colour: "#b06ad9", nightColour: "#1a0a2a", horizonColour: "#6ad9c0", haze: 2, rays: 2, lamps: 3 },
  ),
]);

export const findAtmospherePreset = (id) => ATMOSPHERE_PRESETS.find((item) => item.id === id) || null;
