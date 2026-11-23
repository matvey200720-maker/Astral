/*
 * Метка GPS и маршрут в мини-карте (задача 10 ТЗ 10.10.2026, вечер; линия
 * маршрута и ползунки — задача 1 ТЗ 11.10.2026, утро).
 *
 * Отдельного редактора «Метки и GPS» больше нет: метка и маршрут —
 * инструменты мини-карты, их настройки лежат в её проекте блоком `gps`, и в
 * игру они уходят одним патчем с мини-картой:
 *
 *   цвет и значок метки, точность маршрута — те же файлы, что ставил прежний
 *     редактор (`gps.js`, `paths.js`, установщик `gps-customizer.js`):
 *     строка `HUD_COLOUR_WAYPOINT` hudcolor.dat (ею игра красит и значок, и
 *     линию к нему), клетка листа значков minimap.ytd, флаги узлов paths.rpf;
 *   размер и прозрачность метки — символ `radar_waypoint` в minimap.gfx
 *     (спрайт 16×16 точек с клеткой листа значков): им игра ставит метку на
 *     радар, тот же фильм рисует карту паузы. Правит компилятор мини-карты;
 *   линия маршрута — толщина, вид (пунктир, точки…), прозрачность и свой
 *     цвет. Чисел линии в файлах игры нет: ни в hudcolor.dat, ни в
 *     minimap.ymt (тюнинг радара — сонар, камера, плитки), ни в
 *     mapzoomdata.meta. Путь рисует код игры командами рисования Scaleform в
 *     слоях фильма мини-карты: в GTA5.exe рядом стоят имя слоя `asGpsLayer%d`
 *     и имена команд `lineStyle`, `moveTo`, `lineTo`, `clear`. Эти команды
 *     игра зовёт по имени, и ActionScript фильма может их перехватить —
 *     так и сделано (`apps/desktop/src/minimap-gps-line.js`). Числа линии
 *     здесь, а перехват их только исполняет.
 *
 * Маршрута сервера здесь нет — решение владельца 10.10.2026: строки цветов
 * значков остаются игры.
 *
 * Модуль лёгкий: его читает проект мини-карты (`index.js`), а таблицы
 * маршрутов сервера и узлы дорог ему не нужны.
 */

/** Метка и два её тона — как в hudcolor.dat update.rpf (Steam Legacy, 10.10.2026). */
export const GPS_MARKER_HUD = Object.freeze({
  HUD_COLOUR_WAYPOINT: "#a44cf2",
  HUD_COLOUR_WAYPOINTLIGHT: "#d2a6f9",
  HUD_COLOUR_WAYPOINTDARK: "#522679",
});

/** Уровни точности маршрута: как в игре и «улучшенный» (флаги paths.rpf). */
export const GPS_ACCURACY_LEVELS = Object.freeze(["stock", "direct"]);

/*
 * Значки метки: «stock» — значок игры, «custom» — своя картинка, остальное —
 * готовые силуэты (контур — путь SVG в квадрате 64×64). Белая заливка и
 * тёмный контур — как у значков игры: цвет даёт игра.
 */
export const GPS_MARKER_ICONS = Object.freeze([
  Object.freeze({ id: "stock", label: "Как в игре" }),
  Object.freeze({ id: "pin", label: "Булавка", path: "M32 6c-10.5 0-19 8.3-19 18.6C13 38.5 32 58 32 58s19-19.5 19-33.4C51 14.3 42.5 6 32 6zm0 26a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" }),
  Object.freeze({ id: "flag", label: "Флаг", path: "M15 6h5v52h-5zM20 8h29l-7 10 7 10H20z" }),
  Object.freeze({ id: "star", label: "Звезда", path: "M32 5l7.9 17.1 18.6 2.1-13.8 12.7 3.7 18.4L32 46l-16.4 9.3 3.7-18.4L5.5 24.2l18.6-2.1z" }),
  Object.freeze({ id: "cross", label: "Крест", path: "M25 8h14v17h17v14H39v17H25V39H8V25h17z" }),
  Object.freeze({ id: "heart", label: "Сердце", path: "M32 56S7 40.5 7 23.5C7 15 13.5 8.5 21.5 8.5c4.6 0 8.4 2.3 10.5 5.8 2.1-3.5 5.9-5.8 10.5-5.8C50.5 8.5 57 15 57 23.5 57 40.5 32 56 32 56z" }),
  Object.freeze({ id: "diamond", label: "Ромб", path: "M32 4l26 28-26 28L6 32z" }),
  Object.freeze({ id: "target", label: "Мишень", path: "M32 6a26 26 0 1 0 0 52 26 26 0 0 0 0-52zm0 10a16 16 0 1 1 0 32 16 16 0 0 1 0-32zm0 8a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }),
]);
export const GPS_MARKER_ICON_IDS = Object.freeze([...GPS_MARKER_ICONS.map((item) => item.id), "custom"]);

/*
 * Размер и прозрачность метки — ползунками (владелец, 11.10.2026: «размер и
 * прозрачность тоже нужно поменять, чтобы это всё настраивалось ползунком, и
 * прозрачность метки… до 100 %»). Размер — множитель штатного значка 16×16
 * точек; прозрачность хранится непрозрачностью: 1 — как в игре, 0 — метки не
 * видно. Прежние ступени (×0,75…×2, 1/0,75/0,5/0,3) лежат внутри пределов и
 * открываются как были.
 */
export const GPS_MARKER_LIMITS = Object.freeze({
  size: Object.freeze({ min: 0.5, max: 3, step: 0.05 }),
  opacity: Object.freeze({ min: 0, max: 1, step: 0.01 }),
});

/*
 * Линия маршрута (задача 1 ТЗ 11.10.2026). Владелец: «добавить редактор самой
 * линии, чтобы человек мог менять размер и делать линию пунктирной,
 * разрывчатой или другой… шире, тоньше… всё ползунком».
 *
 * Толщина — множитель той, что передаёт игра (у радара и карты паузы она
 * своя). Штрих и промежуток — в толщинах линии: линия шире — штрихи длиннее,
 * и узор одинаков на радаре и на карте паузы при любом приближении.
 */
export const GPS_LINE_STYLES = Object.freeze([
  Object.freeze({ id: "solid", label: "Сплошная", note: "Как в игре" }),
  Object.freeze({ id: "dashed", label: "Пунктир", note: "Короткие штрихи", dash: 3, gap: 2 }),
  Object.freeze({ id: "broken", label: "Разрывчатая", note: "Длинные отрезки, короткие разрывы", dash: 8, gap: 1.5 }),
  Object.freeze({ id: "dotted", label: "Точки", note: "Круглые точки", gap: 1.5 }),
  Object.freeze({ id: "dashdot", label: "Штрих-пунктир", note: "Штрих, точка, штрих", dash: 5, gap: 1.5 }),
]);
export const GPS_LINE_STYLE_IDS = Object.freeze(GPS_LINE_STYLES.map((item) => item.id));
export const GPS_LINE_LIMITS = Object.freeze({
  width: Object.freeze({ min: 0.25, max: 4, step: 0.05 }),
  dash: Object.freeze({ min: 1, max: 12, step: 0.5 }),
  gap: Object.freeze({ min: 0.5, max: 8, step: 0.5 }),
  opacity: Object.freeze({ min: 0, max: 1, step: 0.01 }),
});
/* Длина «точки» в толщинах: при круглых концах отрезок такой длины — круг. */
export const GPS_LINE_DOT = 0.05;

export const DEFAULT_MINIMAP_GPS = Object.freeze({
  marker: Object.freeze({
    color: GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT,
    icon: "stock",
    assetId: "",
    size: 1,
    opacity: 1,
  }),
  route: Object.freeze({
    accuracy: "stock",
    line: Object.freeze({
      style: "solid",
      width: 1,
      dash: 3,
      gap: 2,
      opacity: 1,
      colorMode: "marker",
      color: GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT,
    }),
  }),
});

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);

/* Число в пределах и на шаге ползунка: код чужой работы или прежний
   черновик не уводят метку и линию мимо органов окна. */
function stepped(value, { min, max, step }, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const snapped = Math.round((Math.min(max, Math.max(min, number)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(4));
}

function normalizeLine(input) {
  const line = input && typeof input === "object" ? input : {};
  const defaults = DEFAULT_MINIMAP_GPS.route.line;
  return {
    style: GPS_LINE_STYLE_IDS.includes(line.style) ? line.style : defaults.style,
    width: stepped(line.width, GPS_LINE_LIMITS.width, defaults.width),
    dash: stepped(line.dash, GPS_LINE_LIMITS.dash, defaults.dash),
    gap: stepped(line.gap, GPS_LINE_LIMITS.gap, defaults.gap),
    opacity: stepped(line.opacity, GPS_LINE_LIMITS.opacity, defaults.opacity),
    colorMode: line.colorMode === "custom" ? "custom" : "marker",
    color: hex(line.color, defaults.color),
  };
}

/** Блок `gps` проекта мини-карты в одной форме. */
export function normalizeMinimapGps(input) {
  const source = input && typeof input === "object" ? input : {};
  const marker = source.marker && typeof source.marker === "object" ? source.marker : {};
  const route = source.route && typeof source.route === "object" ? source.route : {};
  const defaults = DEFAULT_MINIMAP_GPS;
  const assetId = String(marker.assetId || "").slice(0, 160);
  const icon = GPS_MARKER_ICON_IDS.includes(marker.icon) ? marker.icon : "stock";
  return {
    marker: {
      color: hex(marker.color, defaults.marker.color),
      icon: icon === "custom" && !assetId ? "stock" : icon,
      assetId,
      size: stepped(marker.size, GPS_MARKER_LIMITS.size, defaults.marker.size),
      opacity: stepped(marker.opacity, GPS_MARKER_LIMITS.opacity, defaults.marker.opacity),
    },
    route: {
      accuracy: GPS_ACCURACY_LEVELS.includes(route.accuracy) ? route.accuracy : "stock",
      line: normalizeLine(route.line),
    },
  };
}

/** Размер и прозрачность значка метки: правка `radar_waypoint` нужна, только когда они не штатные. */
export function minimapGpsWaypoint(gps) {
  const { marker } = normalizeMinimapGps(gps);
  return { size: marker.size, opacity: marker.opacity, changed: marker.size !== 1 || marker.opacity !== 1 };
}

/**
 * Узор линии: доли «рисуем, пропускаем» по очереди, в толщинах линии.
 *
 * Концы у штрихов круглые — каждый вылезает на полтолщины с обеих сторон.
 * Поэтому рисуемая часть короче видимой на толщину, а пропуск длиннее: тогда
 * «штрих 3, промежуток 2» и выглядит как три и два — и в предпросмотре
 * (`stroke-dasharray` с круглыми концами), и в игре (перехват `lineTo`).
 * У сплошной линии узора нет — `null`.
 */
export function gpsLinePattern(line) {
  const { style, dash, gap } = normalizeLine(line);
  const on = Math.max(GPS_LINE_DOT, dash - 1);
  const off = gap + 1;
  if (style === "dashed" || style === "broken") return [on, off];
  if (style === "dotted") return [GPS_LINE_DOT, off];
  if (style === "dashdot") return [on, off, GPS_LINE_DOT, off];
  return null;
}

/**
 * Линия маршрута для перехвата в minimap.gfx: толщина и прозрачность —
 * множители чисел игры, `colour` — свой цвет линии к метке (или `null`:
 * линия цвета метки, как у игры), `pattern` — узор (`null` — сплошная).
 * `changed` — нужен ли перехват вообще: линия как в игре — фильм не трогается.
 */
export function minimapGpsLine(gps) {
  const { marker, route } = normalizeMinimapGps(gps);
  const { line } = route;
  const colour = line.colorMode === "custom" && line.color !== marker.color ? line.color : null;
  const pattern = gpsLinePattern(line);
  return {
    style: line.style,
    width: line.width,
    opacity: line.opacity,
    colour,
    marker: marker.color,
    pattern,
    changed: line.width !== 1 || line.opacity !== 1 || colour !== null || pattern !== null,
  };
}

/** Метка и маршрут — как в игре: ни цвета, ни значка, ни размера, ни точности, ни своей линии. */
export function minimapGpsIsStock(gps) {
  const { marker, route } = normalizeMinimapGps(gps);
  return (
    marker.color === DEFAULT_MINIMAP_GPS.marker.color &&
    marker.icon === "stock" &&
    marker.size === 1 &&
    marker.opacity === 1 &&
    route.accuracy === "stock" &&
    !minimapGpsLine(gps).changed
  );
}
