/*
 * Полотна арены по одному (ТЗ 11.10.2026, ночь, задача 2).
 *
 * Владелец: «человек мог редактировать какой-то конкретный определённый
 * баннер… подлетит, нажмёт колёсико мыши — и у него будет редактироваться
 * именно этот баннер», «я выбрал редактировать — у меня вторые поломались».
 *
 * Почему ломались. Место картинки делилось на элементы по листам и
 * островам развёртки, а Rockstar раздаёт один кусок листа многим полотнам:
 * у трёх баннеров фойе (`v_62_bannersx`) шесть сторон и всего три острова —
 * лицо первого баннера и изнанка третьего рисуют один и тот же кусок, восемь
 * телевизоров фойе — один лист целиком. Свой вид «острова» поэтому ложился
 * на чужие полотна, а сторона, оставшаяся прежней, мерцала с новой.
 *
 * Как теперь. Элемент такого места — физическое полотно: связная плоская
 * часть модели со всеми своими сторонами, найденная по самой сцене
 * (`findArenaPanels`, подготовка — `scripts/prepare-arena-panels.mjs`,
 * опись — `inventory/arena-panels.js`). Общий вид раздела («Все сразу»)
 * по-прежнему пишется в лист — у всех полотен места разом. Свой вид полотна
 * — своя плашка ровно по полотну (`arenaPanelPlates`): у двусторонней
 * ткани — по плашке на каждую сторону, каждая лицом наружу, в сантиметре от
 * ткани. Лист при этом не трогается, и соседние полотна остаются какими
 * были — и в кадре, и в игре.
 *
 * Чистые функции без DOM и Node: их читают окно (кадр, выбор колесом),
 * установщик и тесты.
 */

import ARENA_PANEL_INVENTORY from "./inventory/arena-panels.js";

export { ARENA_PANEL_INVENTORY };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const size = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / size, a[1] / size, a[2] / size];
};
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits + 0;

/* ------------------------------------------------------------------ *
 * Поиск полотен в сцене (подготовка)
 * ------------------------------------------------------------------ */

/* Плоское — если точки отходят от плоскости не дальше этого, м. */
const FLAT_SLACK = 0.04;
/* Куски одного полотна: плоскости совпадают (м) и рамки касаются (м). */
const SAME_PLANE = 0.06;
const TOUCH = 0.06;
/* Меньше этой площади (м²) — не полотно, а кромка, крепёж или блик. */
const MIN_AREA = 0.04;

/* Стороны света от середины зала: «с севера», «с юго-востока»… (север — +Y игры). */
const COMPASS = Object.freeze(["с севера", "с северо-востока", "с востока", "с юго-востока", "с юга", "с юго-запада", "с запада", "с северо-запада"]);
const bearing = (point, centre) => (((Math.atan2(point[0] - centre[0], point[1] - centre[1]) * 180) / Math.PI) % 360 + 360) % 360;
export const arenaCompass = (point, centre) => COMPASS[Math.round(bearing(point, centre) / 45) % 8];

/* Оси плашки по нормали: «вверх» — вертикаль мира, у пола и потолка — +Y. */
export function panelAxes(normal) {
  const n = norm(normal);
  const world = Math.abs(n[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const up = norm(sub(world, scale(n, dot(world, n))));
  /* Правая рука смотрящего на лицо (против нормали): right = up × n. */
  return { normal: n, up, right: norm(cross(up, n)) };
}

/*
 * Треугольники листа → полотна. `triangles` — `[{ points: [[x,y,z]×3],
 * island }]` в метрах сцены (Z вверх); `island` — номер острова листа (или
 * −1). Связные куски (общие вершины до миллиметра) → плоские → сливаются,
 * если лежат в одной плоскости и касаются рамками; лицо и изнанка ткани
 * (противоположные нормали в одной плоскости) — одно полотно с `sides: 2`.
 * `flatSlack` — свой допуск плоскости (табло Majestic: грань шириной 2,7 м с прогибом 4,6 см — тоже грань, а не кривое). У треугольника с `u` —
 * `[u0, u1]` его развёртки — у полотна тот же диапазон по всем кускам (`u`): по нему склейка граней узнаёт, где кончился один экран листа.
 */
export function findArenaPanels(input, { centre = [0, 0, 0], flatSlack = FLAT_SLACK } = {}) {
  /*
   * Лицо и изнанка ткани делят вершины (те же точки, обход обратный): связность
   * — по точке И стороне, иначе две стороны слились бы в кусок с нулевой
   * нормалью. Сторона — нормаль треугольника, грубо (кривое в полотна не идёт).
   */
  const triangles = input
    .map((triangle) => {
      const [a, b, c] = triangle.points;
      const facing = norm(cross(sub(b, a), sub(c, a)));
      return { ...triangle, side: facing.map((value) => Math.round(value * 4)).join(",") };
    })
    .filter((triangle) => triangle.side !== "0,0,0");
  const key = (point, side) => `${point.map((value) => Math.round(value * 1000)).join(",")}|${side}`;
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let at = id;
    while (parent.get(at) !== root) {
      const next = parent.get(at);
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const triangle of triangles)
    for (const point of triangle.points) {
      const id = key(point, triangle.side);
      if (!parent.has(id)) parent.set(id, id);
    }
  for (const triangle of triangles) {
    union(key(triangle.points[0], triangle.side), key(triangle.points[1], triangle.side));
    union(key(triangle.points[0], triangle.side), key(triangle.points[2], triangle.side));
  }
  /* Куски: нормаль по площади, площадь, точки, острова. */
  const pieces = new Map();
  for (const triangle of triangles) {
    const [a, b, c] = triangle.points;
    const area2 = cross(sub(b, a), sub(c, a));
    const area = Math.hypot(...area2) / 2;
    if (area < 1e-6) continue;
    const root = find(key(a, triangle.side));
    const piece = pieces.get(root) || { normal: [0, 0, 0], area: 0, points: [], islands: new Map(), u: null };
    if (triangle.u) piece.u = piece.u ? [Math.min(piece.u[0], triangle.u[0]), Math.max(piece.u[1], triangle.u[1])] : [...triangle.u];
    piece.normal = add(piece.normal, area2);
    piece.area += area;
    piece.points.push(a, b, c);
    piece.islands.set(triangle.island, (piece.islands.get(triangle.island) || 0) + area);
    pieces.set(root, piece);
  }
  /* Плоские куски с рамкой в своей плоскости. */
  const flat = [];
  for (const piece of pieces.values()) {
    if (piece.area < MIN_AREA / 4) continue;
    const normal = norm(piece.normal);
    const centroid = scale(piece.points.reduce(add, [0, 0, 0]), 1 / piece.points.length);
    const spread = Math.max(...piece.points.map((point) => Math.abs(dot(sub(point, centroid), normal))));
    if (spread > flatSlack) continue;
    flat.push({ ...piece, normal, centroid });
  }
  /* Слияние: одна плоскость (нормали параллельны или встречны) и рамки касаются. */
  const groups = [];
  for (const piece of flat) {
    const axes = panelAxes(piece.normal);
    const box = (points, frame) => {
      const along = points.map((point) => [dot(point, frame.right), dot(point, frame.up)]);
      return [Math.min(...along.map((p) => p[0])), Math.min(...along.map((p) => p[1])), Math.max(...along.map((p) => p[0])), Math.max(...along.map((p) => p[1]))];
    };
    const home = groups.find((group) => {
      if (Math.abs(dot(group.axes.normal, piece.normal)) < 0.97) return false;
      if (Math.abs(dot(sub(piece.centroid, group.centroid), group.axes.normal)) > SAME_PLANE) return false;
      const [a0, b0, a1, b1] = box(piece.points, group.axes);
      const [c0, d0, c1, d1] = group.box;
      return a0 <= c1 + TOUCH && c0 <= a1 + TOUCH && b0 <= d1 + TOUCH && d0 <= b1 + TOUCH;
    });
    if (home) {
      home.pieces.push(piece);
      home.points.push(...piece.points);
      const [a0, b0, a1, b1] = box(piece.points, home.axes);
      home.box = [Math.min(home.box[0], a0), Math.min(home.box[1], b0), Math.max(home.box[2], a1), Math.max(home.box[3], b1)];
    } else groups.push({ axes, centroid: piece.centroid, pieces: [piece], points: [...piece.points], box: box(piece.points, axes) });
  }
  const panels = [];
  for (const group of groups) {
    /* Лицо — сторона с большей площадью; при равенстве — смотрящая к середине зала. */
    let front = [0, 0, 0];
    let back = 0;
    let area = 0;
    for (const piece of group.pieces) {
      const same = dot(piece.normal, group.axes.normal) > 0;
      front = add(front, scale(piece.normal, piece.area * (same ? 1 : -1)));
      if (!same) back += piece.area;
      area += piece.area;
    }
    let normal = norm(front);
    const sides = back > area * 0.2 && back < area * 0.8 ? 2 : 1;
    if (sides === 2 && dot(normal, sub(centre, group.centroid)) < 0) normal = scale(normal, -1);
    else if (sides === 1 && back > area / 2) normal = scale(normal, -1);
    const axes = panelAxes(normal);
    const along = group.points.map((point) => [dot(point, axes.right), dot(point, axes.up), dot(point, axes.normal)]);
    const lo = [0, 1, 2].map((axis) => Math.min(...along.map((p) => p[axis])));
    const hi = [0, 1, 2].map((axis) => Math.max(...along.map((p) => p[axis])));
    const middle = [0, 1, 2].map((axis) => (lo[axis] + hi[axis]) / 2);
    const point = add(add(scale(axes.right, middle[0]), scale(axes.up, middle[1])), scale(axes.normal, middle[2]));
    const width = hi[0] - lo[0];
    const height = hi[1] - lo[1];
    const faceArea = sides === 2 ? area / 2 : area;
    if (faceArea < MIN_AREA || width < 0.08 || height < 0.08) continue;
    /* Остров, что рисует лицо (больше всего площади лица). */
    const islands = new Map();
    for (const piece of group.pieces)
      if (dot(piece.normal, normal) > 0) for (const [island, share] of piece.islands) islands.set(island, (islands.get(island) || 0) + share);
    const island = [...islands.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    panels.push({
      point: point.map((value) => round(value)),
      normal: axes.normal.map((value) => round(value, 4)),
      width: round(width, 3),
      height: round(height, 3),
      sides,
      island,
      area: round(faceArea, 3),
      ...(group.pieces.every((piece) => piece.u) ? { u: [Math.min(...group.pieces.map((piece) => piece.u[0])), Math.max(...group.pieces.map((piece) => piece.u[1]))].map((value) => round(value, 3)) } : {}),
    });
  }
  /* Номера — по кругу от севера по часовой стрелке, как у полотен у арок. */
  return panels
    .sort((left, right) => bearing(left.point, centre) - bearing(right.point, centre) || left.point[2] - right.point[2])
    .map((panel) => ({ ...panel, hint: arenaCompass(panel.point, centre) }));
}

/* ------------------------------------------------------------------ *
 * Изогнутые экраны гранями (Majestic, ТЗ 12.10.2026, задача 4)
 * ------------------------------------------------------------------ */

/*
 * Табло и экраны зала Majestic — дуги из плоских граней: табло турнира —
 * три-четыре грани, экран с картой — две. Поиск полотен находит каждую
 * грань отдельно, и своя картинка ложилась бы на половину экрана. Соседние
 * грани одного листа (края сходятся, та же высота, излом не больше 70°)
 * склеиваются в одно полотно: `facets` — грани по порядку слева направо (как
 * смотрит зритель), у каждой — своя доля ширины картинки (`crop`). Кольцо
 * граней (круглый экран над залом) — одно полотно на всё место.
 */
const FACET_GAP = 0.3;
/* Грани одного экрана на листе идут подряд: следующая начинается по `u` там, где кончилась прежняя (доля листа). */
const FACET_SHEET_GAP = 0.04;
const FACET_HEIGHT = 0.25;
const FACET_BEND = Math.cos((70 * Math.PI) / 180);

/* Края грани слева и справа (по её оси «вправо»), на середине высоты. */
function facetEnds(panel) {
  const axes = panelAxes(panel.normal);
  const half = scale(axes.right, panel.width / 2);
  return { left: sub(panel.point, half), right: add(panel.point, half) };
}

const gapBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Соседние грани одного экрана: правый край первой — у левого края второй. `sheetOrder` — ещё и по листу: тот же остров и `u` подряд (табло Majestic:
 * два экрана стоят в 0,2 м друг от друга, и без этого правая грань одного склеивалась с левой гранью другого — «Табло 2» на двух экранах, 01.11.2026).
 */
function facetFollows(first, second, sheetOrder = false) {
  if (first.texture !== second.texture || first.sides !== 1 || second.sides !== 1) return false;
  if (sheetOrder && (first.island !== second.island || !first.u || !second.u || Math.abs(second.u[0] - first.u[1]) > FACET_SHEET_GAP)) return false;
  if (Math.abs(first.height - second.height) > FACET_HEIGHT || Math.abs(first.point[2] - second.point[2]) > FACET_HEIGHT) return false;
  if (dot(norm(first.normal), norm(second.normal)) < FACET_BEND) return false;
  return gapBetween(facetEnds(first).right, facetEnds(second).left) < FACET_GAP;
}

/**
 * Полотна места → с гранями, склеенными в экраны (`panels` — ответ
 * `findArenaPanels` с `texture`). У склеенного: середина и нормаль — по
 * граням с весом ширины, ширина — сумма, высота — наибольшая, `facets` —
 * `[{ point, normal, width, height, crop: [s0, s1] }]`. `sheetOrder` — грани склеиваются, только если идут подряд и по листу (`facetFollows`).
 */
export function joinArenaFacets(panels, { centre = [0, 0, 0], sheetOrder = false } = {}) {
  const next = new Map();
  const previous = new Map();
  panels.forEach((first, a) =>
    panels.forEach((second, b) => {
      if (a === b || next.has(a) || previous.has(b) || !facetFollows(first, second, sheetOrder)) return;
      next.set(a, b);
      previous.set(b, a);
    }),
  );
  const used = new Set();
  const out = [];
  const chainFrom = (start) => {
    const chain = [];
    for (let at = start; at !== undefined && !used.has(at); at = next.get(at)) {
      used.add(at);
      chain.push(panels[at]);
    }
    return chain;
  };
  /* Цепочки — с левого края; кольцо (у каждой грани есть сосед слева) — с любой. */
  const starts = panels.map((_, index) => index).filter((index) => !previous.has(index));
  const chains = starts.map(chainFrom);
  for (let index = 0; index < panels.length; index += 1) if (!used.has(index)) chains.push(chainFrom(index));
  for (const chain of chains) {
    if (chain.length === 1) {
      out.push(chain[0]);
      continue;
    }
    const width = chain.reduce((sum, item) => sum + item.width, 0);
    let from = 0;
    const facets = chain.map((item) => {
      const crop = [round(from / width, 4), round((from + item.width) / width, 4)];
      from += item.width;
      return { point: item.point, normal: item.normal, width: item.width, height: item.height, crop };
    });
    const point = chain.reduce((sum, item) => add(sum, scale(item.point, item.width / width)), [0, 0, 0]).map((value) => round(value));
    const normal = norm(chain.reduce((sum, item) => add(sum, scale(norm(item.normal), item.width)), [0, 0, 0]));
    out.push({
      ...chain[0],
      point,
      normal: normal.map((value) => round(value, 4)),
      width: round(width, 3),
      height: round(Math.max(...chain.map((item) => item.height)), 3),
      area: round(chain.reduce((sum, item) => sum + item.area, 0), 3),
      hint: arenaCompass(point, centre),
      facets,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Полотна места (опись)
 * ------------------------------------------------------------------ */

/**
 * Полотна места: `[{ key, place, point, normal, width, height, sides,
 * texture, island, hint }]` в метрах сцены «внутри» сервера. Пусто — место
 * делится по-старому (листы, острова) или не делится вовсе.
 */
export function arenaPlacePanels(server, section, place) {
  const list = ARENA_PANEL_INVENTORY?.[server]?.[section]?.[place];
  return Array.isArray(list) ? list : [];
}

/** Делится ли место на полотна. */
export const arenaPlaceHasPanels = (server, section, place) => arenaPlacePanels(server, section, place).length > 1;

/** Сцена полотен сервера (`<сервер>-inside`): полотна описи сняты с неё. */
export const arenaPanelScene = (server) => `${server}-inside`;

/* Плашка — в сантиметре от ткани: ближе мерцает, дальше видна щель. */
export const ARENA_PANEL_OFFSET = 0.012;

/*
 * Маска точек поверх экранов Majestic (`tk_ammo_dots_mask_diffuse`, вырез `cutout.sps`): табло, ТВ, мониторы, плакаты
 * команд. Она стоит перед экраном, и перед плоской гранью изогнутого табло выступает до 4,4 см — дуга экрана и маски
 * гранями не повторяется. Плашка в 1,2 см от грани уходила под маску полосами (владелец 31.10.2026: «сетка пиксельная,
 * полоски от прошлой текстуры») — и в кадре, и в игре: плашки вшиты в модель зала. Поэтому у грани в описи `over` —
 * насколько маска выступает перед её плоскостью (`scripts/prepare-arena-panels.mjs`), и плашка встаёт над маской на
 * `ARENA_OVERLAY_CLEAR`.
 */
export const ARENA_SCREEN_OVERLAYS = Object.freeze(["tk_ammo_dots_mask_diffuse"]);
export const ARENA_OVERLAY_CLEAR = 0.006;

/*
 * Стык граней изогнутого экрана (владелец 01.11.2026: табло слева от круглого лого Majestic — «кривое позиционирование», в стыке полоса прежнего
 * экрана): грань — хорда дуги, и каждая ещё поднята над маской точек вдоль своей нормали, так что края соседних плашек расходились на 1–4,5 см.
 * Левая плашка дотягивается до правой через щель с нахлёстом `FACET_JOIN`, её доля картинки (`crop`) та же — растягивается на эти сантиметры, а не
 * повторяет кусок соседней (повтор двоил цифру на стыке). Края экрана не трогаются.
 */
const FACET_JOIN = 0.003;
function joinFacetFaces(faces) {
  return faces.map((face, at) => {
    const next = faces[at + 1];
    if (!next) return face;
    const gap = sub(add(next.point, scale(next.right, -next.width / 2)), add(face.point, scale(face.right, face.width / 2)));
    const reach = Math.max(0, dot(gap, face.right)) + FACET_JOIN;
    return { ...face, point: add(face.point, scale(face.right, reach / 2)), width: face.width + reach };
  });
}

/**
 * Стороны полотна плашками: `[{ side, point, normal, right, up, width,
 * height, crop? }]` — у двусторонней ткани две, каждая лицом наружу от своей
 * стороны (изнанка — с обратной нормалью: картинка на ней читается сзади
 * не зеркально); у изогнутого экрана — по грани, `crop` — её доля ширины
 * картинки `[s0, s1]`.
 */
export function arenaPanelFaces(panel, offset = ARENA_PANEL_OFFSET) {
  /* Лицо — не ближе `offset` к полотну и над маской точек, если она перед ним (`over`). */
  const lift = (item) => (item.over > 0 ? Math.max(offset, item.over + ARENA_OVERLAY_CLEAR) : offset);
  /* Изогнутый экран — по плашке на грань, каждой — своя доля картинки (`crop`). */
  if (Array.isArray(panel.facets) && panel.facets.length) {
    const faces = panel.facets.map((facet) => {
      const axes = panelAxes(facet.normal);
      return { side: "front", point: add(facet.point, scale(axes.normal, lift(facet))), ...axes, width: facet.width, height: facet.height, crop: facet.crop };
    });
    return joinFacetFaces(faces);
  }
  const out = [];
  const front = panelAxes(panel.normal);
  out.push({ side: "front", point: add(panel.point, scale(front.normal, lift(panel))), ...front, width: panel.width, height: panel.height });
  if (panel.sides === 2) {
    const back = panelAxes(scale(panel.normal, -1));
    out.push({ side: "back", point: add(panel.point, scale(back.normal, offset)), ...back, width: panel.width, height: panel.height });
  }
  return out;
}

/**
 * Полотно под точкой сцены (выбор колесом): точка в рамке полотна и почти
 * в его плоскости. `candidates` — `[{ key, panel }]`. Ближайшее к плоскости
 * или `null`.
 */
export function arenaPanelAtPoint(candidates, point, { slack = 0.15, depth = 0.25 } = {}) {
  let best = null;
  let distance = Infinity;
  for (const entry of candidates) {
    /* Изогнутый экран — по его граням. */
    for (const flat of entry.panel.facets?.length ? entry.panel.facets : [entry.panel]) {
      const axes = panelAxes(flat.normal);
      const offset = sub(point, flat.point);
      const away = Math.abs(dot(offset, axes.normal));
      if (away > depth) continue;
      if (Math.abs(dot(offset, axes.right)) > flat.width / 2 + slack || Math.abs(dot(offset, axes.up)) > flat.height / 2 + slack) continue;
      if (away < distance) {
        best = entry;
        distance = away;
      }
    }
  }
  return best;
}

/**
 * Поворот плашки своих моделей (`place-models.js`: лицо — в −Y, ширина —
 * по X, высота — по Z) лицом по нормали стороны: углы Z·Y·X в градусах, как
 * `placeModelMatrix`. Матрица — столбцы [right, −normal, up].
 */
export function arenaPanelRotation(face) {
  const r = face.right;
  const y = scale(face.normal, -1);
  const u = face.up;
  /* R[i][j]: строка i, столбец j; столбцы — образы осей X, Y, Z. */
  const m = [
    [r[0], y[0], u[0]],
    [r[1], y[1], u[1]],
    [r[2], y[2], u[2]],
  ];
  const deg = 180 / Math.PI;
  const ry = Math.asin(Math.max(-1, Math.min(1, -m[2][0])));
  let rx;
  let rz;
  if (Math.abs(Math.cos(ry)) > 1e-6) {
    rx = Math.atan2(m[2][1], m[2][2]);
    rz = Math.atan2(m[1][0], m[0][0]);
  } else {
    rx = Math.atan2(-m[1][2], m[1][1]);
    rz = 0;
  }
  return [rx, ry, rz].map((value) => round(value * deg, 2));
}

/* Сторона картинки плашки полотна, px: длинная — 1024 (у узкого — не меньше 16). */
export function arenaPanelPixels(panel) {
  const aspect = panel.width / Math.max(0.01, panel.height);
  return aspect >= 1 ? [1024, Math.max(16, Math.round(1024 / aspect))] : [Math.max(16, Math.round(1024 * aspect)), 1024];
}
