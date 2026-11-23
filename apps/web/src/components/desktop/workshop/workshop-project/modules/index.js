/*
 * Собирает WORKSHOP_MODULES из определений, разложенных по категориям.
 *
 * Порядок карточек задан отдельным списком, а не порядком файлов: раскладка по
 * категориям и очередь показа в мастерской — разные вещи, и совпадать они
 * перестали бы на первом же новом модуле. Список ниже повторяет порядок,
 * который был у массива, когда он лежал одним куском.
 */
import { minimapModule } from "./minimap.js";
import { interfaceModules } from "./interface.js";
import { worldModules } from "./world.js";
import { environmentModules } from "./environment.js";
import { weaponModules } from "./weapons.js";

const MODULE_ORDER = [
  "minimap",
  "world-map",
  "timecycle",
  "arenas",
  "weapon-effects",
  "tracers",
  "interiors",
  "street-lights",
  "climbs",
  "crosshair",
  "sniper-scope",
  "vegetation",
  "hud",
  "blips-gps",
  "weather",
  "impacts",
];

const byId = new Map(
  [
    minimapModule,
    ...interfaceModules,
    ...worldModules,
    ...environmentModules,
    ...weaponModules,
  ].map((module) => [module.id, module]),
);

/* Расхождение списка порядка с набором определений — опечатка разработчика, и
   молча отдавать дырявый массив хуже, чем упасть на импорте. */
const missing = MODULE_ORDER.filter((id) => !byId.has(id));
const extra = [...byId.keys()].filter((id) => !MODULE_ORDER.includes(id));
if (missing.length || extra.length)
  throw new Error(
    `WORKSHOP_MODULES: порядок и определения разошлись (нет определения: ${missing.join(", ") || "—"}; нет в порядке: ${extra.join(", ") || "—"})`,
  );

export const WORKSHOP_MODULES = MODULE_ORDER.map((id) => byId.get(id));
