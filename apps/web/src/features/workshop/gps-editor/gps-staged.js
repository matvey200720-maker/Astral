/*
 * Постановочная схема маршрута для инструмента «Маршрут» мини-карты (ТЗ 22.10.2026).
 *
 * Владелец: «в миникарте там где маршрут сделать уже готовые фотки, а не чтобы человек мог переставлять метку, сделать
 * 2 варианта, где улучшенный доставит тебя быстрее». Кадр показывает готовую картинку выбранного варианта, а не
 * карту, по которой надо щёлкать.
 *
 * Листов Rockstar в репозитории и поставке нет (CLAUDE.md), поэтому без игры кадр рисует себя сам: тёмные кварталы,
 * шоссе и два пути от игрока к метке. Улицы и пути здесь выдуманы — подпись кадра прямо говорит, что это схема Astral,
 * а не кадр из игры. Настоящие длины (Форт-Занкудо: 7,10 км «как в игре» и 6,01 км «улучшенным») сняты в игре
 * 10.10.2026, их показывает подпись; на схеме улучшенный путь короче штатного в том же отношении, ~0,88 против 0,85.
 *
 * Когда игра под рукой и дороги прочитаны, кадр кладёт настоящие плитки карты и настоящие пути по узлам дорог
 * (`route-model.js`) — эта схема тогда не нужна.
 *
 * Всё в единицах кадра: 1000 × 625, ось Y вниз (`GPS_STAGE_WIDTH` × `GPS_STAGE_HEIGHT`).
 */

export const STAGED_WIDTH = 1000;
export const STAGED_HEIGHT = 625;

/* Игрок — в кварталах справа внизу, метка — на северо-западе. */
export const STAGED_START = Object.freeze({ x: 838, y: 560 });
export const STAGED_END = Object.freeze({ x: 168, y: 108 });

/* Шоссе от кварталов на северо-запад: общая часть обоих путей после развилки. */
const TRUNK = Object.freeze([
  [574, 392],
  [520, 350],
  [430, 300],
  [330, 230],
  [240, 160],
  [168, 108],
]);

/* «Улучшенный»: все улицы в обе стороны — по прямой улице на запад и вверх на шоссе. */
const DIRECT = Object.freeze([[838, 560], [574, 560], ...TRUNK]);

/* «Как в игре»: улица к западу от игрока односторонняя против хода, штатный GPS объезжает её через северную дорогу. */
const STOCK = Object.freeze([
  [838, 560],
  [838, 476],
  [750, 476],
  [750, 392],
  [750, 300],
  [640, 246],
  [520, 350],
  ...TRUNK.slice(2),
]);

/** Длина ломаной в единицах кадра. */
export function stagedLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
}

/** Пути схемы: `[[x, y], …]` кадра. */
export const STAGED_ROUTES = Object.freeze({ stock: STOCK, direct: DIRECT });

/** Знак «въезд запрещён» на улице, которую штатный GPS обходит. */
export const STAGED_NO_ENTRY = Object.freeze({ x: 706, y: 560 });

/* Кварталы справа внизу: улицы через 42 и 44 единицы, как плотный город на карте. */
const GRID_X = Array.from({ length: 10 }, (_, index) => 574 + 44 * index);
const GRID_Y = Array.from({ length: 6 }, (_, index) => 392 + 42 * index);

const line = (x1, y1, x2, y2) => `M${x1} ${y1}L${x2} ${y2}`;

/**
 * Улицы схемы одним списком: `{ d, tone }`, где `tone` — вес дороги (`local`, `avenue`, `highway`). Порядок — снизу
 * вверх: мелкие улицы под проспектами, проспекты под шоссе.
 */
export function stagedRoads() {
  const roads = [];
  for (const y of GRID_Y) roads.push({ d: line(574, y, 970, y), tone: "local" });
  for (const x of GRID_X) roads.push({ d: line(x, 392, x, 602), tone: "local" });
  /* Каждая четвёртая улица — проспект. */
  for (const y of GRID_Y.filter((_, index) => index % 3 === 0)) roads.push({ d: line(574, y, 970, y), tone: "avenue" });
  for (const x of GRID_X.filter((_, index) => index % 3 === 0)) roads.push({ d: line(x, 392, x, 602), tone: "avenue" });
  /* Просёлки и въезды: обычная карта не из одного шоссе. */
  const extra = [
    [[970, 392], [990, 300], [930, 210], [800, 150]],
    [[750, 300], [750, 392]],
    [[750, 300], [640, 246], [520, 350]],
    [[430, 300], [470, 420], [574, 470]],
    [[240, 160], [300, 92], [420, 70], [540, 80]],
    [[330, 230], [470, 190], [600, 130], [700, 118]],
    [[520, 350], [640, 330], [750, 300]],
    [[168, 108], [120, 180], [110, 300], [150, 420]],
    [[574, 560], [460, 540], [330, 560], [210, 520]],
  ];
  for (const points of extra) roads.push({ d: points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(""), tone: "avenue" });
  roads.push({ d: TRUNK.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(""), tone: "highway" });
  return roads;
}

/** Море слева: волнистая кромка от верха до низа. */
export const STAGED_SEA = "M0 0H64Q82 80 58 160T70 320Q96 410 62 480T74 625H0Z";
/** Озеро и парки — пятна воды и зелени между улиц. */
export const STAGED_LAKE = Object.freeze({ cx: 330, cy: 452, rx: 92, ry: 46 });
export const STAGED_PARKS = Object.freeze([
  Object.freeze({ x: 590, y: 406, w: 80, h: 64 }),
  Object.freeze({ x: 874, y: 490, w: 70, h: 52 }),
  Object.freeze({ x: 330, y: 100, w: 110, h: 70 }),
]);

/** Ломаная для SVG `points`: `x,y x,y …`. */
export const stagedPolyline = (points) => points.map(([x, y]) => `${x},${y}`).join(" ");
