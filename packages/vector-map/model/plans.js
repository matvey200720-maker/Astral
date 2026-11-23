import * as defaults from "./defaults.js";
import { normalizeWorldMap } from "./world.js";

const isShown = (item) => item.enabled !== false;
const isLayer = (layer) => layer !== "water";
const isOn = (category) => category.on;
const LEVELED = ["brightness", "contrast", "saturation"];

// Основа не такая, как у карты игры (чтения идут по порядку полей, до первого отличия).
const baseDeviates = (base) => {
  if (base.recolor) return true;
  for (const field of LEVELED) {
    if (base[field] !== 100) return true;
  }
  if (base.tintOpacity > 0) return true;
  if (base.textureId !== "none" && base.textureOpacity > 0) return true;
  // «3D-здания» (21.11) меняют картинку карты сами по себе: без них «Применить» снимал бы карту к штатной
  if (base.volumeBuildings) return true;
  return base.hidden.some(isLayer);
};

// Раздел «нарисован»: не выключен и содержит хотя бы один включённый элемент.
// У надписей выключателя раздела нет — решают элементы.
const drawsSomething = (section) => {
  if (section.enabled === false) return false;
  return section.items.some(isShown);
};

// Разделы с элементами, которые проверяются на «нарисовано».
const DRAWN_KEYS = ["zones", "markers", "paint", "emblems"];

const anyOn = (majestic) => Object.values(majestic.categories).some(isOn);

// Проверки идут по порядку, на первой сработавшей остальные поля не читаются.
export const worldMapDiffersFromGame = (config) => {
  const map = normalizeWorldMap(config);
  const base = map.base;
  if (base.source !== "game" || baseDeviates(base)) return true;
  for (const key of DRAWN_KEYS) {
    if (drawsSomething(map[key])) return true;
  }
  return anyOn(map.majestic);
};

const fromPercent = (number) => number / 100;

export const radarPlan = (config) => {
  const map = normalizeWorldMap(config);
  const paint = worldMapDiffersFromGame(map);
  const radar = map.radar;
  // «и» без приведения к булеву: ложный paint остаётся в layers, items и opaque как есть
  const layers = paint && radar.layers;
  const items = layers && radar.items;
  const textScale = fromPercent(radar.textScale);
  const tint = fromPercent(radar.tint);
  const opaque = paint && radar.opaque;
  // Наклон — отдельный ключ и только когда включён: у карты без наклона план прежний
  const tilt = radar.tilt?.on ? { tilt: { strength: radar.tilt.strength } } : {};
  return { mode: paint ? "map" : "game", paint, layers, items, textScale, tint, opaque, ...tilt };
};

export const pauseMapPlan = (config) => {
  const map = normalizeWorldMap(config);
  const sea = map.pauseMap.sea;
  const seaColor = map.pauseMap.seaColor;
  const hideOverlays = worldMapDiffersFromGame(map);
  const blur = map.pauseMap.blur !== "off";
  const painted = sea === "color" ? seaColor : null;
  return { hideOverlays, seaColor: painted, blur, needed: hideOverlays || Boolean(painted) };
};

export const pauseTileSea = (config) => pauseMapPlan(config).seaColor || defaults.PAUSE_MAP_GAME_SEA;

// Установка фильма паузы нужна всегда; море в нём не рисуется.
export const pauseMapInstallPlan = (config) => {
  const plan = pauseMapPlan(config);
  plan.seaColor = null;
  plan.needed = true;
  plan.noSea = true;
  return plan;
};
