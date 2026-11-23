/*
 * Метки и GPS (задача 9 ТЗ 10.10.2026): договор окна и установщика.
 *
 * Что за чем в игре игрока (Steam Legacy, update.rpf) — снято в игре
 * 10.10.2026 (`tools/ingame-qa/runs/tz1010/gps-*.mjs`):
 *   метка  — `common/data/ui/hudcolor.dat`, строка `HUD_COLOUR_WAYPOINT` в
 *            обеих палитрах ([HD] и [CRT]): ею игра красит и значок метки, и
 *            линию маршрута к ней — на радаре и на карте паузы. Отдельного
 *            цвета у линии нет;
 *   сервер — маршрут к значку (SET_BLIP_ROUTE) игра красит строкой цвета
 *            значка: у каждого из 86 цветов значков своя строка
 *            (`GPS_ROUTE_COLOURS`, опыт с номерами строк вместо цветов),
 *            свой маршрут скрипта (START_GPS_*_ROUTE) — строкой по номеру.
 *            Строка общая: той же краской игра рисует значки этого цвета и
 *            свои надписи, поэтому перекрашивается только выбранное;
 *   значок — клетка 64×64 в левом верхнем углу листа `blips_texturesheet_NG`
 *            (`scaleform_minimap.rpf/minimap.ytd`): белый крест-цветок с
 *            чёрным контуром, игра красит его умножением в цвет метки —
 *            свой значок туда же, белым силуэтом с тёмным контуром;
 *   путь   — узлы дорог (`paths.js`).
 */

import { GPS_ACCURACY_LEVELS } from "./paths.js";
import { GPS_MARKER_HUD, GPS_MARKER_ICONS, minimapGpsLine, normalizeMinimapGps } from "./gps-marker.js";

export { GPS_ACCURACY_LEVELS, GPS_MARKER_HUD, GPS_MARKER_ICONS };
export {
  DEFAULT_MINIMAP_GPS,
  GPS_LINE_LIMITS,
  GPS_LINE_STYLES,
  GPS_MARKER_ICON_IDS,
  GPS_MARKER_LIMITS,
  gpsLinePattern,
  minimapGpsIsStock,
  minimapGpsLine,
  minimapGpsWaypoint,
  normalizeMinimapGps,
} from "./gps-marker.js";

export const GPS_SCHEMA_VERSION = 1;
export const GPS_HUD_ENTRY = "common/data/ui/hudcolor.dat";
export const GPS_HUD_TARGET = `update:/${GPS_HUD_ENTRY}`;
export const GPS_ICON_ENTRY = "x64/patch/data/cdimages/scaleform_minimap.rpf/minimap.ytd";
export const GPS_ICON_TARGET = `update:/${GPS_ICON_ENTRY}`;
export const GPS_ICON_TEXTURE = "blips_texturesheet_ng";
/* Клетка метки в листе: левый верхний угол, 64×64 на верхнем уровне. */
export const GPS_ICON_CELL = Object.freeze({ x: 0, y: 0, size: 64 });

/* Метка и два её тона — `GPS_MARKER_HUD` в `gps-marker.js` (как в hudcolor.dat
   update.rpf, Steam Legacy, 10.10.2026). */

/*
 * Строки, которыми игра красит маршрут к значку сервера, и номера цветов
 * значков (SET_BLIP_COLOUR / SET_BLIP_ROUTE_COLOUR) на каждой. Белый (4)
 * не перекрашивается: им написан почти весь текст игры. У цветов 72, 79,
 * 80 и 85 линии маршрута в игре нет. `main` — те, что серверы ставят чаще.
 */
const route = (hud, label, stock, blips, extra = {}) => Object.freeze({ hud, label, stock, blips: Object.freeze(blips), ...extra });
export const GPS_ROUTE_COLOURS = Object.freeze([
  route("HUD_COLOUR_YELLOW", "Жёлтый", "#f0c850", [0, 5, 60, 66, 70, 71, 73], { main: true, shared: "жёлтые значки, маршруты заданий, жёлтые слова подсказок и третья полоса под картой (способность)" }),
  route("HUD_COLOUR_BLUE", "Синий", "#5db6e5", [3, 57, 67, 68, 74, 77, 84], { main: true, shared: "синие значки и полоса брони под картой" }),
  route("HUD_COLOUR_RED", "Красный", "#e03232", [1, 49, 59, 75], { main: true, shared: "красные значки и полоса здоровья, когда его мало" }),
  route("HUD_COLOUR_GREEN", "Зелёный", "#72cc72", [2, 69], { main: true, shared: "зелёные значки и полоса здоровья под картой" }),
  route("HUD_COLOUR_PURPLE", "Фиолетовый", "#8466e2", [50], { main: true }),
  route("HUD_COLOUR_ORANGE", "Оранжевый", "#ff8555", [51], { main: true }),
  route("HUD_COLOUR_PINK", "Розовый", "#cb3694", [61], { main: true }),
  route("HUD_COLOUR_BLUELIGHT", "Голубой", "#aedbf2", [53], { main: true }),
  route("HUD_COLOUR_FREEMODE", "Синий онлайна", "#2d6eb9", [38], { main: true }),
  route("HUD_COLOUR_MENU_YELLOW", "Золотой", "#f0a000", [81], { main: true }),
  route("HUD_COLOUR_REDLIGHT", "Светло-красный", "#f09999", [41]),
  route("HUD_COLOUR_REDDARK", "Тёмно-красный", "#701919", [76]),
  route("HUD_COLOUR_GREENDARK", "Тёмно-зелёный", "#396639", [52]),
  route("HUD_COLOUR_BLUEDARK", "Тёмно-синий", "#2f5c73", [54, 78]),
  route("HUD_COLOUR_YELLOWDARK", "Тёмно-жёлтый", "#7e6b29", [56]),
  route("HUD_COLOUR_PURPLEDARK", "Тёмно-фиолетовый", "#43396f", [58]),
  route("HUD_COLOUR_GREY", "Серый", "#9b9b9b", [55]),
  route("HUD_COLOUR_GREYLIGHT", "Светло-серый", "#cdcdcd", [62]),
  route("HUD_COLOUR_GREYDARK", "Тёмно-серый", "#4d4d4d", [40]),
  route("HUD_COLOUR_INACTIVE_MISSION", "Серый задания", "#9a9a9a", [39]),
  route("HUD_COLOUR_SIMPLEBLIP_DEFAULT", "Мятный", "#9fc9a6", [82]),
  route("HUD_COLOUR_MICHAEL", "Майкл", "#65b4d4", [42]),
  route("HUD_COLOUR_FRANKLIN", "Франклин", "#abedab", [43]),
  route("HUD_COLOUR_TREVOR", "Тревор", "#ffa357", [44]),
  route("HUD_COLOUR_GOLF_P1", "Белый значка 45", "#f0f0f0", [45]),
  route("HUD_COLOUR_GOLF_P2", "Лимонный", "#ebef1e", [46]),
  route("HUD_COLOUR_GOLF_P3", "Апельсиновый", "#ff950e", [47]),
  route("HUD_COLOUR_GOLF_P4", "Малиновый", "#f63ca1", [48]),
  route("HUD_COLOUR_GANG1", "Банда 1", "#1d6499", [63]),
  route("HUD_COLOUR_GANG2", "Банда 2", "#d6740f", [64]),
  route("HUD_COLOUR_GANG3", "Банда 3", "#877d8e", [65]),
  ...[
    "#c25050", "#9c6eaf", "#ff7bc4", "#f79f7b", "#b29084", "#8dcea7", "#71a9af", "#d3d1e7",
    "#907f99", "#6ac4bf", "#d6c499", "#ea8e50", "#98cbea", "#b26287", "#908e7a", "#a6755e",
    "#afa8a8", "#e88e9b", "#bbd65b", "#0c7b56", "#7bc4ff", "#ab3ce6", "#cea90d", "#4763ad",
    "#2aa6b9", "#ba9d7d", "#c9e1ff", "#f0f096", "#ed8ca1", "#f98a8a", "#fcefa6", "#f0f0f0",
  ].map((stock, index) => route(`HUD_COLOUR_NET_PLAYER${index + 1}`, `Игрок ${index + 1}`, stock, [6 + index])),
]);
const ROUTE_BY_HUD = new Map(GPS_ROUTE_COLOURS.map((item) => [item.hud, item]));
export const GPS_DEFAULT_SERVER_ROUTE = "HUD_COLOUR_YELLOW";

/* Все строки, которых касается работа, и их цвета у игры. */
export const GPS_STOCK_HUD = Object.freeze({
  ...GPS_MARKER_HUD,
  ...Object.fromEntries(GPS_ROUTE_COLOURS.map((item) => [item.hud, item.stock])),
});
export const GPS_HUD_NAMES = Object.freeze(Object.keys(GPS_STOCK_HUD));

/* Значки метки — `GPS_MARKER_ICONS` в `gps-marker.js`: их читает и проект
   мини-карты, которому таблицы маршрутов сервера не нужны. */
const ICON_IDS = new Set([...GPS_MARKER_ICONS.map((item) => item.id), "custom"]);

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);
const rgbOf = (value) => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
const hexOf = (rgb) => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

/* Светлый и тёмный тон метки — как у игры: половина к белому и половина цвета. */
export const gpsLightTone = (color) => hexOf(rgbOf(color).map((channel) => (channel + 255) / 2));
export const gpsDarkTone = (color) => hexOf(rgbOf(color).map((channel) => channel / 2));

export function createDefaultGpsWork() {
  return {
    schemaVersion: GPS_SCHEMA_VERSION,
    marker: { color: GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT, icon: "stock", assetId: "" },
    server: { color: ROUTE_BY_HUD.get(GPS_DEFAULT_SERVER_ROUTE).stock, routes: [GPS_DEFAULT_SERVER_ROUTE] },
    route: { accuracy: "stock" },
  };
}

export function normalizeGpsWork(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = createDefaultGpsWork();
  const marker = source.marker && typeof source.marker === "object" ? source.marker : {};
  const server = source.server && typeof source.server === "object" ? source.server : {};
  const route = source.route && typeof source.route === "object" ? source.route : {};
  const icon = ICON_IDS.has(marker.icon) ? marker.icon : "stock";
  const assetId = String(marker.assetId || "").slice(0, 160);
  const routes = Array.isArray(server.routes)
    ? [...new Set(server.routes.map(String).filter((hud) => ROUTE_BY_HUD.has(hud)))]
    : defaults.server.routes;
  return {
    schemaVersion: GPS_SCHEMA_VERSION,
    marker: {
      color: hex(marker.color, defaults.marker.color),
      icon: icon === "custom" && !assetId ? "stock" : icon,
      assetId,
    },
    server: { color: hex(server.color, defaults.server.color), routes },
    route: { accuracy: GPS_ACCURACY_LEVELS.includes(route.accuracy) ? route.accuracy : "stock" },
  };
}

/**
 * Строки hudcolor.dat, которые даёт работа: `{ HUD_COLOUR_*: "#rrggbb" }`.
 * Метка — свой цвет и два тона от него (как у игры), маршруты сервера —
 * свой цвет на каждой выбранной строке.
 */
export function gpsHudColours(work) {
  const normalized = normalizeGpsWork(work);
  return {
    HUD_COLOUR_WAYPOINT: normalized.marker.color,
    HUD_COLOUR_WAYPOINTLIGHT: gpsLightTone(normalized.marker.color),
    HUD_COLOUR_WAYPOINTDARK: gpsDarkTone(normalized.marker.color),
    ...Object.fromEntries(normalized.server.routes.map((hud) => [hud, normalized.server.color])),
  };
}

/** Перекрашенные маршруты сервера: выбранные строки, у которых цвет не как у игры. */
export function gpsServerRoutesChanged(work) {
  const normalized = normalizeGpsWork(work);
  return normalized.server.routes.filter((hud) => ROUTE_BY_HUD.get(hud).stock !== normalized.server.color);
}

/** Работа — вид игры: ни цвета, ни значка, ни узлов. */
export function gpsWorkIsStock(work) {
  const normalized = normalizeGpsWork(work);
  return (
    normalized.marker.icon === "stock" &&
    normalized.route.accuracy === "stock" &&
    normalized.marker.color === GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT &&
    gpsServerRoutesChanged(normalized).length === 0
  );
}

/*
 * Цвета строк одной палитры: свои числа и ссылки на другие строки
 * (`HUD_COLOUR_OBJECTIVE_ROUTE HUD_COLOUR_YELLOW`) — с разрешением ссылок.
 */
function paletteColours(lines) {
  const values = new Map();
  const aliases = new Map();
  for (const line of lines) {
    const match = /^\s*(HUD_COLOUR_[A-Z0-9_]+)\s+(.*)$/.exec(line);
    if (!match || values.has(match[1]) || aliases.has(match[1])) continue;
    const rgba = /^RGBA\s+(\d+)\s+(\d+)\s+(\d+)/.exec(match[2]);
    if (rgba) values.set(match[1], hexOf([1, 2, 3].map((k) => Math.min(255, Number(rgba[k])))));
    else {
      const link = /^(HUD_COLOUR_[A-Z0-9_]+)/.exec(match[2]);
      if (link) aliases.set(match[1], link[1]);
    }
  }
  const resolve = (name, depth = 0) => values.get(name) || (depth < 8 && aliases.has(name) ? resolve(aliases.get(name), depth + 1) : null);
  return resolve;
}

/* Палитры файла: строки до первой `[…]` и после каждой — свой набор. */
function palettes(lines) {
  const sections = [[]];
  for (const line of lines) {
    if (/^\s*\[[^\]]+\]/.test(line)) sections.push([]);
    sections[sections.length - 1].push(line);
  }
  return sections;
}

/**
 * hudcolor.dat игрока с другими цветами строк `colours`: в каждой палитре
 * ([HD] и [CRT]) строка остаётся на месте и под тем же именем, меняются
 * только числа; строка-ссылка становится своим цветом. Строки, у которых
 * цвет уже такой, и всё остальное — байт в байт.
 */
export function compileHudColours(text, colours) {
  const wanted = new Map(
    Object.entries(colours || {})
      .filter(([name, value]) => /^HUD_COLOUR_[A-Z0-9_]+$/.test(name) && HEX.test(String(value || "")))
      .map(([name, value]) => [name, String(value).toLowerCase()]),
  );
  const changed = new Set();
  const parts = String(text).split(/(\r?\n)/);
  const lines = parts.filter((_, index) => index % 2 === 0);
  const sections = palettes(lines);
  let lineIndex = 0;
  for (const section of sections) {
    const resolve = paletteColours(section);
    for (const line of section) {
      const at = lineIndex * 2;
      lineIndex += 1;
      const match = /^(\s*)(HUD_COLOUR_[A-Z0-9_]+)(\s+)(.*)$/.exec(line);
      if (!match || !wanted.has(match[2])) continue;
      const colour = wanted.get(match[2]);
      if (resolve(match[2]) === colour) continue;
      const [r, g, b] = rgbOf(colour);
      const rgba = /^RGBA\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(match[4]);
      const alpha = rgba ? Number(rgba[4]) : 255;
      parts[at] = `${match[1]}${match[2]}${match[3]}RGBA\t${r}\t${g}\t${b}\t${alpha}`;
      changed.add(match[2]);
    }
  }
  return { text: parts.join(""), changed: [...changed] };
}

/** Цвета строк работы в hudcolor.dat игрока (первая палитра, [HD]). */
export function readHudColours(text, names = GPS_HUD_NAMES) {
  const sections = palettes(String(text).split(/\r?\n/));
  const first = sections.find((section) => section.some((line) => /^\s*HUD_COLOUR_/.test(line))) || [];
  const resolve = paletteColours(first);
  return Object.fromEntries(names.map((name) => [name, resolve(name)]));
}

export function describeGpsWork(work) {
  const normalized = normalizeGpsWork(work);
  if (gpsWorkIsStock(normalized)) return "Метка и GPS как в игре";
  const parts = [];
  if (normalized.marker.color !== GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT) parts.push("свой цвет метки");
  if (normalized.marker.icon !== "stock") parts.push("свой значок метки");
  const routes = gpsServerRoutesChanged(normalized);
  if (routes.length === 1) parts.push(`${ROUTE_BY_HUD.get(routes[0]).label.toLowerCase()} маршрут сервера своим цветом`);
  else if (routes.length > 1) {
    const tail = routes.length % 100;
    const many = (tail >= 11 && tail <= 14) || routes.length % 10 === 0 || routes.length % 10 >= 5;
    parts.push(`${routes.length} ${many ? "цветов" : "цвета"} маршрутов сервера своим цветом`);
  }
  if (normalized.route.accuracy === "direct") parts.push("маршрут напрямую");
  return parts.join(", ");
}

/*
 * Метка и маршрут мини-карты (задача 10 ТЗ 10.10.2026, вечер) ⇄ работа
 * установщика `gps-customizer.js`.
 *
 * Блок `gps` проекта мини-карты несёт то, что человек правит в двух её
 * инструментах; установщику из него нужны цвет, значок и точность — в его
 * работе. Маршрут сервера в мини-карте не правится: в работе он остаётся
 * игры, и его строки hudcolor.dat установка не трогает.
 */
export function minimapGpsWork(gps) {
  const block = normalizeMinimapGps(gps);
  return normalizeGpsWork({
    marker: { color: block.marker.color, icon: block.marker.icon, assetId: block.marker.assetId },
    route: { accuracy: block.route.accuracy },
  });
}

/**
 * Работа прежнего редактора «Метки и GPS» (черновик, «Мои работы», код
 * `ASTRAL-GPS1-…`) → блок `gps` мини-карты: цвет, значок и точность
 * переезжают, размер и прозрачность метки и линия маршрута — те, что уже
 * стоят в мини-карте. Маршрут сервера не переезжает: его в мини-карте нет.
 */
export function minimapGpsFromWork(work, current = null) {
  const normalized = normalizeGpsWork(work);
  const block = normalizeMinimapGps(current);
  return normalizeMinimapGps({
    marker: {
      ...block.marker,
      color: normalized.marker.color,
      icon: normalized.marker.icon,
      assetId: normalized.marker.assetId,
    },
    route: { ...block.route, accuracy: normalized.route.accuracy },
  });
}

const decimal = (value) => String(value).replace(".", ",");
const STYLE_WORDS = Object.freeze({
  dashed: "пунктирная линия",
  broken: "разрывчатая линия",
  dotted: "линия точками",
  dashdot: "линия штрих-пунктиром",
});

/** Что из метки и маршрута мини-карты не как в игре — словами для строки «В процессе». */
export function describeMinimapGps(gps) {
  const block = normalizeMinimapGps(gps);
  const parts = [];
  if (block.marker.color !== GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT) parts.push("свой цвет метки");
  if (block.marker.icon !== "stock") parts.push("свой значок метки");
  if (block.marker.size !== 1) parts.push(`метка ×${decimal(block.marker.size)}`);
  if (block.marker.opacity !== 1) parts.push(`прозрачность метки ${Math.round((1 - block.marker.opacity) * 100)} %`);
  if (block.route.accuracy === "direct") parts.push("улучшенный маршрут");
  const line = minimapGpsLine(block);
  if (STYLE_WORDS[line.style]) parts.push(STYLE_WORDS[line.style]);
  if (line.width !== 1) parts.push(`линия ×${decimal(line.width)}`);
  if (line.opacity !== 1) parts.push(`прозрачность линии ${Math.round((1 - line.opacity) * 100)} %`);
  if (line.colour) parts.push("свой цвет линии");
  return parts.join(", ");
}
