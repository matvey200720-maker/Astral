/*
 * Свет внутри помещений (задача 5 ТЗ 17.10.2026, вечер): цвет и сила ламп,
 * что несут сами модели помещения (`LightAttributes` в .ydr/.yft).
 *
 * Лампы помещений лежат не в оболочке, а в мелких моделях — «деталях»,
 * неоне, подвесах, плакатах с подсветкой (опись `inventory/shops-lights.js`,
 * `scripts/prepare-shop-lights.mjs`). Правятся только модели, которые игра
 * ставит в одно это помещение: общие (банкомат, автоматы, лампа на улице)
 * остаются штатными — их свет увидели бы и снаружи. Свет в кадре студийный:
 * цвет ламп помещения кадр не показывает, это сказано в панели.
 *
 * Правка — точные байты LightAttributes (цвет и сила); как у фонарей
 * мастерской, их меняет помощник RPF (`lamp-studio-patch`) на файлах,
 * вынутых из игры. Здесь — договор и чистый расчёт правок.
 */

import { normalizeRecolourHex } from "./colour.js";
import SHOP_LIGHTS from "./inventory/shops-lights.js";

export const SHOP_LIGHT_MODES = Object.freeze(["standard", "colour"]);
export const SHOP_LIGHT_LABELS = Object.freeze({ standard: "Как в игре", colour: "Свой цвет" });
/* Сила ламп в процентах от штатной. */
export const SHOP_LIGHT_INTENSITY = Object.freeze([25, 200]);
export const SHOP_LIGHT_COLOUR = "#ffe2b0";
export const SHOP_LIGHT_SWATCHES = Object.freeze(["#fff1d6", "#ffe2b0", "#ffc27a", "#ff7a59", "#ff3d6e", "#b57cff", "#6aa8ff", "#7fffe0", "#9dff7a"]);

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** Свет помещения: режим, цвет и сила (в процентах). Без «Свой цвет» цвет и сила помнятся, но не едут. */
export function normalizeShopLight(input) {
  const source = plain(input);
  const intensity = Number(source.intensity);
  return {
    mode: SHOP_LIGHT_MODES.includes(source.mode) ? source.mode : "standard",
    colour: normalizeRecolourHex(source.colour, SHOP_LIGHT_COLOUR),
    intensity: Number.isFinite(intensity) ? Math.round(Math.min(SHOP_LIGHT_INTENSITY[1], Math.max(SHOP_LIGHT_INTENSITY[0], intensity))) : 100,
  };
}

/** Свет «как в игре»: ставить нечего. */
export const shopLightIsStock = (light) => !light || light.mode !== "colour";

/** Что свет помещения меняет в файлах: цвет и сила — пока режим «Свой цвет». */
export const shopLightSignature = (light) => (shopLightIsStock(light) ? null : { colour: light.colour, intensity: light.intensity });

/** Модели помещения с лампами, что правятся: `[{ name, file, at, lights }]` (только свои модели помещения). */
export const shopLightModels = (interiorId) => SHOP_LIGHTS.interiors?.[interiorId] || [];

/** Сколько ламп и в скольких моделях у помещения. */
export function shopLightCount(interiorId) {
  const models = shopLightModels(interiorId);
  return { models: models.length, lights: models.reduce((sum, model) => sum + (model.lights || 0), 0) };
}

const bytesOf = (hex) => {
  const value = parseInt(String(hex).slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

/**
 * Правки света одной модели по описи помощника (`lights` — то, что вернул
 * `lamp-studio-inspect`: `{ list, index, color, intensity, … }`). Цвет — тот
 * же у всех ламп, сила — штатная × процент.
 */
export function shopLightMutations(lights, light) {
  if (shopLightIsStock(light)) return [];
  const colour = bytesOf(light.colour);
  const factor = light.intensity / 100;
  return (lights || []).map((item) => ({
    list: item.list,
    index: item.index,
    color: { ...colour },
    intensity: Math.round(Math.max(0, Number(item.intensity) || 0) * factor * 1000) / 1000,
  }));
}
