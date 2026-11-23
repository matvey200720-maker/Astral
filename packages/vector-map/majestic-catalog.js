/*
 * Метки Majestic (ТЗ 18.10, задача 1.5) — каталог категорий без данных.
 *
 * Сами места и контуры (`majestic-marks.json`, 290 КБ) подгружаются, когда
 * метки включены или открыт инструмент (`majestic-marks.js`); здесь — то, что
 * нужно панели и модели сразу: названия, цвета, группы, значки и сколько чего в
 * категории (сверяется с данными тестом). Источник данных — вики Majestic RP,
 * снимок 10.10.2026 (`scripts/map-pack-labels/majestic_marks.mjs`).
 *
 * `group` — «Зоны» или «Точки» в панели; зона у категории может быть и среди
 * точек (у тайников и камер DMV есть и то и другое — панель считает основное).
 */

export const MAJESTIC_SOURCE = "Majestic RP wiki";
export const MAJESTIC_SOURCE_DATE = "2026-10-10";


/* Где стоит подпись источника (юго-запад моря, метры карты) и какой она высоты. */

/** Общие размеры: значок и толщина контура (метры), заливка зон (%). */
export const MAJESTIC_DEFAULTS = Object.freeze({ size: 40, fill: 100 });
export const MAJESTIC_LIMITS = Object.freeze({ size: [0, 1000], fill: [0, 300], line: [0, 300], icon: [20, 300] });

const entry = (id, title, group, color, glyph, zones, points) =>
  Object.freeze({ id, title, group, color, glyph, zones, points });

export const MAJESTIC_CATALOG = Object.freeze([
  entry("stash", "Тайники", "points", "#a90226", "package", 17, 174),
  entry("airdrop", "ВЗА", "zones", "#6d9aed", "plane", 30, 16),
  entry("treasure", "Клады", "zones", "#3388ff", null, 71, 0),
  entry("greenZones", "Зелёные зоны", "zones", "#04ff1c", null, 220, 0),
  entry("redZones", "Красные зоны", "zones", "#a90226", null, 10, 0),
  entry("hunting", "Охота", "zones", "#2ecc71", null, 10, 0),
  entry("fishing", "Рыбалка", "points", "#ffffff", "fish", 0, 20),
  entry("trucker", "Дальнобойщики", "points", "#b29084", "truck", 0, 2),
  entry("cameras", "Камеры DMV", "points", "#e13c3c", "camera", 43, 43),
  entry("mushrooms", "Грибы", "zones", "#8e44ad", null, 6, 0),
  entry("forest", "Рубка леса", "points", "#72cc72", "axe", 0, 4),
  entry("gatherer", "Собирательство", "zones", "#27ae60", null, 26, 0),
  entry("dumpsters", "Мусорные баки", "points", "#a53c40", "trash", 0, 190),
  entry("phones", "Счастливые телефоны", "points", "#e0cb53", "phone", 0, 115),
]);

export const MAJESTIC_MAP = Object.freeze(Object.fromEntries(MAJESTIC_CATALOG.map((item) => [item.id, item])));

/** Сколько «штук» показывает счётчик категории: зон — у зон, точек — у точек. */
export const majesticCount = (item) => (item.group === "zones" ? item.zones : item.points);
