/*
 * Значки Astral для строк «Расписания» (ТЗ владельца 11.10.2026, утро,
 * задача 4: «он мог бы менять значки у каждого вот этого»).
 *
 * Рисунки свои, векторные: каждый собран здесь из простых фигур на сетке
 * 64 × 64 (прямоугольники, круги, многоугольники), чужих картинок нет.
 * Фигура — путь SVG с правилом заливки `nonzero`: внешние контуры идут по
 * часовой стрелке (на экране, y вниз), дырки — против, поэтому
 * перекрывающиеся части сливаются, а дырка остаётся дыркой. Порядок обхода
 * ставят помощники сами — по знаку площади.
 *
 * Один и тот же путь рисует лист табло (`Path2D` в окне) и плитка выбора в
 * панели (`<path d>`), так что в панели — ровно то, что встанет на щит.
 */

const fmt = (value) => String(Math.round(value * 100) / 100);

/* Удвоенная площадь со знаком: больше нуля — по часовой стрелке на экране. */
function area(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** Многоугольник: контур (`hole` — дырка) с нужным обходом. */
function polygon(points, hole = false) {
  const clockwise = area(points) > 0;
  const ordered = clockwise === !hole ? points : [...points].reverse();
  return `M${ordered.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z`;
}

/* Точки дуги эллипса: углы в радианах, 0 — вправо, π/2 — вниз (экран). */
function arc(cx, cy, rx, ry, from, to, steps) {
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = from + ((to - from) * step) / steps;
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return points;
}

/* Поворот точек вокруг (cx, cy) на `angle` радиан. */
const turn = (points, cx, cy, angle) =>
  points.map(([x, y]) => [cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle), cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)]);

const ellipsePoints = (cx, cy, rx, ry, angle = 0) => turn(arc(cx, cy, rx, ry, 0, Math.PI * 2, 48).slice(0, -1), cx, cy, angle);
const ellipse = (cx, cy, rx, ry, { hole = false, angle = 0 } = {}) => polygon(ellipsePoints(cx, cy, rx, ry, angle), hole);
const circle = (cx, cy, r, hole = false) => ellipse(cx, cy, r, r, { hole });
const rectPoints = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const rect = (x, y, w, h, hole = false) => polygon(rectPoints(x, y, w, h), hole);

/* Прямоугольник со скруглёнными углами: `r` — число или [лв, пв, пн, лн]. */
function roundRectPoints(x, y, w, h, r) {
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map((value) => Math.min(value, w / 2, h / 2));
  const corner = (cx, cy, radius, from) => (radius > 0 ? arc(cx, cy, radius, radius, from, from + Math.PI / 2, 6) : [[cx, cy]]);
  return [
    ...corner(x + tl, y + tl, tl, Math.PI),
    ...corner(x + w - tr, y + tr, tr, -Math.PI / 2),
    ...corner(x + w - br, y + h - br, br, 0),
    ...corner(x + bl, y + h - bl, bl, Math.PI / 2),
  ];
}
const roundRect = (x, y, w, h, r, hole = false) => polygon(roundRectPoints(x, y, w, h, r), hole);

/* Звезда: `count` лучей, внешний и внутренний радиусы, первый луч — вверх. */
function star(cx, cy, outer, inner, count = 5, hole = false) {
  const points = [];
  for (let index = 0; index < count * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / count;
    const radius = index % 2 ? inner : outer;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return polygon(points, hole);
}

/* Сердце — по классической кривой, вписанное в сетку. */
function heartPoints(cx, cy, scale) {
  const points = [];
  for (let step = 0; step < 64; step += 1) {
    const t = (step / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push([cx + x * scale, cy - y * scale]);
  }
  return points;
}

/* Скважина замка: круг сверху и щель вниз — одной дыркой. */
function keyhole(cx, cy, radius, slot) {
  const top = arc(cx, cy, radius, radius, (Math.PI * 2) / 3, Math.PI * 2 + Math.PI / 3, 16);
  const half = radius * 0.42;
  return polygon([...top, [cx + half, cy + slot], [cx - half, cy + slot]], true);
}

const icon = (id, label, ...parts) => Object.freeze({ id: `astral-${id}`, label, path: parts.join("") });

/**
 * Значки Astral: `{ id, label, path }`; `path` — путь SVG на сетке 64 × 64,
 * правило заливки `nonzero`. Порядок — порядок в панели.
 */
export const SCHEDULE_ASTRAL_ICONS = Object.freeze([
  icon("stash", "Тайник", roundRect(8, 12, 48, 14, [8, 8, 0, 0]), roundRect(8, 29, 48, 24, [0, 0, 4, 4]), keyhole(32, 37, 3.6, 8)),
  icon("box", "Груз", roundRect(8, 8, 48, 48, 3), rect(14, 14, 36, 36, true), polygon([[14, 43], [43, 14], [50, 14], [50, 21], [21, 50], [14, 50]])),
  icon("key", "Ключ", circle(19, 32, 12), circle(19, 32, 5, true), rect(29, 29, 28, 6), rect(46, 34, 4.5, 8), rect(52.5, 34, 4.5, 10)),
  icon(
    "pistol",
    "Пистолет",
    roundRect(8, 17, 48, 11, 2),
    polygon([[14, 27], [28, 27], [23, 51], [9, 51]]),
    polygon([[27, 27], [38, 27], [38, 33], [34, 38], [27, 38]]),
    polygon([[29.5, 30], [35.5, 30], [35.5, 32.2], [33, 35], [29.5, 35]], true),
  ),
  icon(
    "knife",
    "Нож",
    polygon(turn([[26.5, -2], [37.5, 9], [37.5, 37], [26.5, 37]], 32, 32, Math.PI / 4)),
    polygon(turn(rectPoints(19, 36.5, 26, 5.5), 32, 32, Math.PI / 4)),
    polygon(turn(roundRectPoints(27, 41.5, 10, 22, 3.5), 32, 32, Math.PI / 4)),
  ),
  icon("target", "Прицел", circle(32, 32, 22), circle(32, 32, 17, true), circle(32, 32, 10), circle(32, 32, 6, true), circle(32, 32, 2.5), rect(30.5, 3, 3, 13), rect(30.5, 48, 3, 13), rect(3, 30.5, 13, 3), rect(48, 30.5, 13, 3)),
  icon(
    "car",
    "Машина",
    polygon([[5, 41], [5, 33], [13, 30.5], [20, 22], [42, 22], [51, 30], [59, 32], [59, 41]]),
    polygon([[21.5, 25], [30.5, 25], [30.5, 30], [15.5, 30]], true),
    polygon([[33.5, 25], [41, 25], [46.5, 30], [33.5, 30]], true),
    circle(17, 44, 7),
    circle(17, 44, 2.8, true),
    circle(47, 44, 7),
    circle(47, 44, 2.8, true),
  ),
  icon(
    "boat",
    "Катер",
    polygon([[4, 38], [60, 38], [52, 50], [12, 50]]),
    polygon([[20, 39], [22.5, 28], [42, 28], [48, 39]]),
    polygon([[26, 31], [34, 31], [34, 36], [25, 36]], true),
    rect(31, 12, 2.5, 17),
    polygon([[33, 12], [45, 16.5], [33, 21]]),
    roundRect(8, 54, 48, 3.5, 1.75),
  ),
  icon(
    "plane",
    "Самолёт",
    roundRect(29, 5, 6, 54, 3),
    polygon([[32, 23], [59, 36], [59, 41], [32, 34], [5, 41], [5, 36]]),
    polygon([[32, 48], [45, 56], [45, 59], [32, 55.5], [19, 59], [19, 56]]),
  ),
  icon(
    "heli",
    "Вертолёт",
    ellipse(26, 37, 14, 10),
    ellipse(20, 34, 5, 4, { hole: true }),
    polygon([[37, 33], [58, 30.5], [58, 34.5], [37, 41]]),
    rect(55, 24, 3, 14),
    rect(24.5, 21, 3, 8),
    roundRect(6, 18.5, 40, 3.5, 1.75),
    rect(14, 51, 26, 3),
    rect(18, 46, 2.5, 6),
    rect(32, 46, 2.5, 6),
  ),
  icon("money", "Деньги", roundRect(5, 16, 54, 32, 4), circle(32, 32, 8.5, true), circle(32, 32, 4.5), circle(12.5, 23.5, 2.6, true), circle(51.5, 40.5, 2.6, true)),
  icon(
    "bag",
    "Мешок денег",
    polygon([[27, 23], [37, 23], [45, 29], [51, 37], [54, 46], [51, 53], [44, 57], [20, 57], [13, 53], [10, 46], [13, 37], [19, 29]]),
    roundRect(24, 19, 16, 5, 2),
    polygon([[25, 20], [19, 9], [28, 13], [32, 7], [36, 13], [45, 9], [39, 20]]),
    circle(32, 43, 8.5, true),
    circle(32, 43, 4.5),
  ),
  icon("flag", "Флаг", rect(12, 6, 4, 50), polygon([[15, 8], [26, 5.5], [36, 9.5], [46, 7], [55, 6.5], [55, 29], [46, 31], [36, 33], [26, 29], [15, 31]]), roundRect(6, 55, 16, 4.5, 1.5)),
  icon(
    "race",
    "Гонка",
    rect(9, 6, 4, 53),
    rect(13, 8, 42, 28),
    rect(15.5, 10.5, 37, 23, true),
    ...[0, 1, 2]
      .flatMap((line) => [0, 1, 2, 3].map((cell) => [line, cell]))
      .filter(([line, cell]) => (line + cell) % 2 === 0)
      .map(([line, cell]) => rect(15.5 + cell * 9.25, 10.5 + line * (23 / 3), 9.25, 23 / 3)),
  ),
  icon("crown", "Корона", polygon([[8, 46], [6, 21], [20, 32], [32, 13], [44, 32], [58, 21], [56, 46]]), rect(8, 49, 48, 6), circle(6, 18, 3.5), circle(32, 10, 4), circle(58, 18, 3.5)),
  icon("star", "Звезда", star(32, 34, 28, 11.5)),
  icon("bolt", "Молния", polygon([[38, 4], [13, 36], [29, 36], [22, 60], [51, 24], [35, 24], [45, 4]])),
  icon("clock", "Часы", circle(32, 32, 27), circle(32, 32, 21.5, true), rect(30.5, 15, 3, 18), rect(31, 30.5, 15, 3), circle(32, 32, 3.8)),
  icon(
    "skull",
    "Череп",
    ellipse(32, 27, 22, 20),
    roundRect(20, 41, 24, 16, 4),
    ellipse(23, 29, 6, 7, { hole: true }),
    ellipse(41, 29, 6, 7, { hole: true }),
    polygon([[32, 35], [29.5, 40], [34.5, 40]], true),
    rect(25, 49, 2.6, 6, true),
    rect(30.7, 49, 2.6, 6, true),
    rect(36.4, 49, 2.6, 6, true),
  ),
  icon(
    "shield",
    "Щит",
    polygon([[32, 4], [54, 12], [54, 30], [51, 40], [44, 50], [32, 60], [20, 50], [13, 40], [10, 30], [10, 12]]),
    polygon([[32, 9.5], [49, 15.5], [49, 30], [46.5, 38.5], [40.5, 47], [32, 54], [23.5, 47], [17.5, 38.5], [15, 30], [15, 15.5]], true),
    star(32, 31, 12, 5),
  ),
  icon(
    "cup",
    "Кубок",
    polygon([[16, 7], [48, 7], [47, 22], [43, 30], [36, 35], [28, 35], [21, 30], [17, 22]]),
    circle(15, 17, 8),
    circle(15, 17, 4.5, true),
    circle(49, 17, 8),
    circle(49, 17, 4.5, true),
    rect(29.5, 34, 5, 13),
    roundRect(21, 46, 22, 5, 1.5),
    roundRect(16, 51, 32, 6, 2),
  ),
  icon("bomb", "Бомба", circle(28, 38, 20), ellipse(20, 31, 3.5, 5.5, { hole: true, angle: 0.6 }), polygon(turn(rectPoints(36, 15, 10, 9), 41, 19.5, Math.PI / 4)), star(51, 11, 8, 3, 8)),
  icon("pin", "Метка", circle(32, 24, 18), polygon([[17.5, 33], [46.5, 33], [32, 60]]), circle(32, 24, 7, true)),
  icon(
    "bell",
    "Колокол",
    polygon([[10, 48], [14, 44], [16, 36], [17, 26], [20, 18], [26, 13], [32, 12], [38, 13], [44, 18], [47, 26], [48, 36], [50, 44], [54, 48]]),
    rect(8, 46.5, 48, 4.5),
    circle(32, 54.5, 5),
    circle(32, 9.5, 3.5),
  ),
  icon(
    "fire",
    "Огонь",
    polygon([[32, 4], [40, 16], [47, 24], [51, 34], [50, 45], [44, 54], [36, 59], [28, 59], [20, 54], [14, 45], [13, 35], [17, 26], [22, 32], [24, 22], [29, 14]]),
    polygon([[32, 29], [38.5, 39], [40, 47], [36, 54], [28, 54], [24, 47], [25.5, 39]], true),
    polygon([[32, 37], [36, 44], [35.5, 50], [32, 52], [28.5, 50], [28, 44]]),
  ),
  icon(
    "gift",
    "Подарок",
    rect(10, 29, 18.5, 27),
    rect(35.5, 29, 18.5, 27),
    rect(7, 20, 21.5, 7.5),
    rect(35.5, 20, 21.5, 7.5),
    rect(30, 17, 4, 39),
    ellipse(24.5, 13.5, 7, 4.5, { angle: -0.35 }),
    ellipse(39.5, 13.5, 7, 4.5, { angle: 0.35 }),
  ),
  icon("medic", "Медпомощь", rect(24, 8, 16, 48), rect(8, 24, 48, 16)),
  icon("house", "Дом", polygon([[32, 6], [60, 31], [4, 31]]), rect(43, 10, 6, 14), rect(12, 29, 40, 27), rect(27, 40, 10, 16, true), rect(16.5, 36, 7.5, 7.5, true), rect(40, 36, 7.5, 7.5, true)),
  icon("dice", "Кости", roundRect(8, 8, 48, 48, 9), circle(20, 20, 4.6, true), circle(44, 20, 4.6, true), circle(32, 32, 4.6, true), circle(20, 44, 4.6, true), circle(44, 44, 4.6, true)),
  icon(
    "music",
    "Музыка",
    ellipse(18, 48, 8, 6, { angle: -0.35 }),
    ellipse(46, 42, 8, 6, { angle: -0.35 }),
    rect(22.5, 14, 4, 34),
    rect(50.5, 8, 4, 34),
    polygon([[22.5, 14], [54.5, 8], [54.5, 16], [22.5, 22]]),
  ),
  icon("fish", "Рыбалка", ellipse(28, 32, 20, 12), polygon([[44, 32], [60, 20], [56, 32], [60, 44]]), polygon([[22, 22], [32, 12], [36, 22]]), circle(17, 29, 2.6, true)),
  icon("heart", "Сердце", polygon(heartPoints(32, 30, 1.7))),
]);

const BY_ID = new Map(SCHEDULE_ASTRAL_ICONS.map((item) => [item.id, item]));
export const findScheduleAstralIcon = (id) => BY_ID.get(id) || null;
/* Сетка рисунков: путь лежит в квадрате 0…64. */
export const SCHEDULE_ASTRAL_ICON_GRID = 64;
