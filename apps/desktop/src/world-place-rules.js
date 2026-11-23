/*
 * Правила отбора сущностей для места мира (`world-place-scene.js`): чистые функции и числа — их берут сборка, таблица карт и тесты.
 */

/* Крупная модель: дальность показа от столького (м) — плита земли, скала, обрыв. Лежит вокруг своей точки на сотни метров, ищется дальше обычной. */
export const BIG_LOD_DIST = 200;
/* Насколько дальше круга места искать сущности: обычные модели и крупные (м). Без запаса у круга остаются дыры в земле (бизвар и ВЗХ: плиты стоят в 250 м от середины). */
export const NEAR_MARGIN = 90;
export const BIG_MARGIN = 330;

/* Уровни сущностей `rage__eLodType`: что кадр рисует вблизи. */
const LEVEL_HD = 0;
const LEVEL_ORPHAN = 5;
export const nearLevel = (level) => level === LEVEL_HD || level === LEVEL_ORPHAN;

/*
 * Модели, которых в дневном кадре нет: дальние копии, только тень или только отражение, ночные огни, световые конусы, сетки-заменители.
 * Реквизит, деревья, наклейки и стёкла остаются: кадр должен быть как игра, а не «без мелочи».
 */
const NOT_IN_FRAME = /(_lod\d*$|_lod_|slod|_emissive|_emis\d*$|_emis_|_shadow|shadowproxy|refprox|proxy$|_proxy_|runlight|_lightcone|furgrass|_fur\d*$|_fur_|_puddle|_rwire)/;
export const modelInFrame = (name) => !NOT_IN_FRAME.test(name);

/*
 * Состояния карты, что включает сюжет или сервер, а не игра сама: разрушенное, сгоревшее, грязное, декорация миссии. Лежат рядом с обычным состоянием
 * и без этого встали бы двойным домом поверх него. Список — по именам карт игры (прочитан по всей таблице): обычное состояние (`fiblobby`, `rc12b_default`,
 * `showroom_closed`) остаётся, а настоящие тоннели с `_end` в имени (`sc1_rd_…_inttun2b_end`) — тоже. В самой карте признака нет: состояние включает скрипт.
 */
const STATE_MAP = /(_destroyed|_destruct|_burnt|_burned|_collapsed|fake|_damaged?$|_damaged_|_trash|_tidy|_onmission|_sunk|_wreck|_crash|_mission\d*$|^des_|^rc12b_(fixed|destroyed)|_movie$|^prologue|^canyonriver|_hc_end$|_hc_req$|^trv1_trail_end$|_heist_(dmg|lights)$|^fbi_(repair|colplug)|_request$|mission$|_cutscene|_mph4_|^h4_|_open$|_open_|_broken$|_ipl_gr|_ipl$|banners|_int_off$|_int_on$|_switch_off$)/;
export const mapInWorld = (name) => !STATE_MAP.test(name);

/* Круг и точка плана. */
export const distance2d = (x0, y0, x1, y1) => Math.hypot(x0 - x1, y0 - y1);

/** Лежит ли сущность в поиске места: крупные модели ищутся дальше. */
export function entityInReach(position, lodDist, centre, reach) {
  const margin = lodDist >= BIG_LOD_DIST ? BIG_MARGIN : NEAR_MARGIN;
  return distance2d(position[0], position[1], centre[0], centre[1]) <= reach + margin;
}

/** Карта таблицы задевает круг места: рамка её сущностей с запасом. */
export function mapTouches(box, big, centre, reach) {
  const margin = reach + (big ? BIG_MARGIN : NEAR_MARGIN);
  const dx = Math.max(box[0] - centre[0], 0, centre[0] - box[2]);
  const dy = Math.max(box[1] - centre[1], 0, centre[1] - box[3]);
  return Math.hypot(dx, dy) <= margin;
}

/*
 * План места (ТЗ владельца 02.11.2026: «в двух метрах от зелёной зоны уже можешь делать черноту»): выпуклый многоугольник в осях сцены, вершины против часовой стрелки.
 * Сцена — только то, что его задевает; край режет кадр (`edge-fade.js`, форма `plan`).
 */
export const PLAN_POINTS = 16;

/** Проверка просьбы: вершины `[[x, y], …]` выпуклого многоугольника против часовой стрелки, округлённые до дециметра, или `null`. */
export function planPoints(input, limit) {
  if (!Array.isArray(input) || input.length < 3 || input.length > PLAN_POINTS) return null;
  const points = [];
  for (const point of input) {
    const x = Number(point?.[0]);
    const y = Number(point?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > limit) return null;
    points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  for (let at = 0; at < points.length; at += 1) {
    const [ax, ay] = points[at];
    const [bx, by] = points[(at + 1) % points.length];
    const [cx, cy] = points[(at + 2) % points.length];
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return null;
  }
  return points;
}

/** Многоугольник плана для проверок: рёбра `[a, b, c]` (`a·x + b·y + c` — метры внутрь) и его рамка. */
export function planShape(points) {
  const edges = points.map(([x0, y0], at) => {
    const [x1, y1] = points[(at + 1) % points.length];
    const size = Math.hypot(x1 - x0, y1 - y0) || 1;
    const a = -(y1 - y0) / size;
    const b = (x1 - x0) / size;
    return [a, b, -(a * x0 + b * y0)];
  });
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return { points, edges, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** Расстояние от точки до плана в плане сцены: внутри — ноль. */
export function planDistance(shape, x, y) {
  if (shape.edges.every(([a, b, c]) => a * x + b * y + c >= 0)) return 0;
  let best = Infinity;
  shape.points.forEach(([x0, y0], at) => {
    const [x1, y1] = shape.points[(at + 1) % shape.points.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const along = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - x0 - along * dx, y - y0 - along * dy));
  });
  return best;
}

/** Задевает ли треугольник план: разделяющие оси обеих фигур. По середине судить нельзя: большой треугольник земли с серединой снаружи оставил бы дыру внутри. */
export function triangleTouchesPlan(shape, ax, ay, bx, by, cx, cy) {
  const { box, edges, points } = shape;
  if (Math.max(ax, bx, cx) < box[0] || Math.min(ax, bx, cx) > box[2] || Math.max(ay, by, cy) < box[1] || Math.min(ay, by, cy) > box[3]) return false;
  for (const [a, b, c] of edges) if (a * ax + b * ay + c < 0 && a * bx + b * by + c < 0 && a * cx + b * cy + c < 0) return false;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  /* Стена с высоты — отрезок: у него осей своих нет, хватает проверки рёбер плана. */
  if (Math.abs(area) < 1e-6) return true;
  const sign = area > 0 ? 1 : -1;
  const sides = [ax, ay, bx, by, bx, by, cx, cy, cx, cy, ax, ay];
  for (let at = 0; at < sides.length; at += 4) {
    const x0 = sides[at];
    const y0 = sides[at + 1];
    const dx = sides[at + 2] - x0;
    const dy = sides[at + 3] - y0;
    if (points.every(([x, y]) => sign * (dx * (y - y0) - dy * (x - x0)) < 0)) return false;
  }
  return true;
}

/** Лежит ли сущность на плане: шар рамки её типа (`place` — точка модели → мир). Рамки нет — прежний поиск с запасом от точки сущности. */
export function entityTouchesPlan(shape, origin, archetype, place, position) {
  const low = archetype?.bbMin;
  const high = archetype?.bbMax;
  if (!low || !high || low.every((value, axis) => value === high[axis])) {
    const margin = (archetype?.lodDist || 0) >= BIG_LOD_DIST ? BIG_MARGIN : NEAR_MARGIN;
    return planDistance(shape, position[0] - origin[0], position[1] - origin[1]) <= margin;
  }
  const a = place(low);
  const b = place(high);
  return planDistance(shape, (a[0] + b[0]) / 2 - origin[0], (a[1] + b[1]) / 2 - origin[1]) <= Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2 + 1;
}

/* Ключ места сущности: копия дополнения (`hei_`) стоит на месте основной. */
export const entityKey = (name, position) => `${name.replace(/^hei_/, "")}|${Math.round(position[0] * 10)}|${Math.round(position[1] * 10)}|${Math.round(position[2] * 10)}`;

/** Разбор строк таблицы карт: `{ name, box, big, types }`. */
export function parseWorldMaps(text) {
  return String(text || "")
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [name, x0, y0, x1, y1, big, types] = row.split("|");
      return { name, box: [Number(x0), Number(y0), Number(x1), Number(y1)], big: big === "1", types: types ? types.split(",").map(Number) : [] };
    });
}

/** Родство словарей из таблицы: `Map(ребёнок → родитель)`. */
export function parseTxdParents(text) {
  const parents = new Map();
  for (const row of String(text || "").split("\n")) {
    const at = row.indexOf(":");
    if (at < 0) continue;
    const parent = row.slice(0, at);
    for (const child of row.slice(at + 1).split(",")) if (child) parents.set(child, parent);
  }
  return parents;
}

/**
 * Какие карты читать для места: те, что задевают круг; основная не берётся, если есть её копия дополнения (`hei_x` заменяет `x`: дополнение отключает
 * основной файл и включает свой). Состояния сюжета — не берутся.
 */
export function mapsForPlace(maps, centre, reach) {
  const names = new Set(maps.map((map) => map.name));
  return maps.filter((map) => mapTouches(map.box, map.big, centre, reach) && mapInWorld(map.name) && !names.has(`hei_${map.name}`));
}
