/*
 * Каталожная часть набора: что показывать в мастерской и что с чем конфликтует.
 * Держится отдельно от самих определений, чтобы список выпущенных модулей и
 * таблицу конфликтов можно было читать, не пролистывая две тысячи строк
 * ползунков.
 */
import { WORKSHOP_MODULES } from "./modules/index.js";

export { WORKSHOP_MODULES };

export const WORKSHOP_RELEASED_MODULE_IDS = Object.freeze([
  "crosshair",
  "minimap",
  "world-map",
  /* Залазы стоят на витрине мастерской своей плиткой: у них свой редактор,
     и результат его работы — готовая пара текстур, а не настройка, которую
     ещё некуда применить. */
  "climbs",
]);
export const WORKSHOP_RETICLE_MODULE_IDS = Object.freeze([
  "crosshair",
  "sniper-scope",
]);

export const WORKSHOP_MODULE_MAP = Object.fromEntries(
  WORKSHOP_MODULES.map((module) => [module.id, module]),
);

export const WORKSHOP_CONFLICT_DEFINITIONS = Object.freeze({
  "atmosphere-profile": Object.freeze({
    modules: Object.freeze(["timecycle", "weather"]),
    message: "Таймцикл и погода используют общий профиль атмосферы",
    strategy: "safe-merge",
    options: Object.freeze([]),
  }),
  "gps-style": Object.freeze({
    modules: Object.freeze(["minimap", "blips-gps"]),
    message: "Мини-карта и Blips/GPS задают оформление маршрута",
    strategy: "choose-source",
    options: Object.freeze(["minimap", "blips-gps"]),
  }),
});

export const WORKSHOP_CATEGORIES = [
  ["all", "Все категории"],
  ["interface", "Интерфейс"],
  ["weapons", "Оружие"],
  ["environment", "Окружение"],
  ["world", "Мир"],
  ["audio", "Аудио"],
];
