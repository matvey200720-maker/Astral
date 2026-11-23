/*
 * Зона на настоящем месте (ТЗ владельца 01.11.2026: «чтобы там рисовалось это здание, этот ландшафт, чтобы человек мог пролетать и посмотреть, как зона
 * отображается в самих объектах»; это отменяет решение 20.10 «ленты на чёрном»).
 *
 * Сцену места собирает Astral Desktop из файлов игры игрока (`apps/desktop/src/world-place-scene.js`): здания, земля и реквизит целиком, без ужатия. Здесь:
 *
 *   • какое место просить у зоны (`zonePlace`). Зелёной и запретной — только её саму и два метра вокруг (ТЗ владельца 02.11.2026: «в двух метрах от зелёной зоны уже
 *     можешь делать черноту»): план по оболочке ленты, дальше чёрное. У обводов в сцене зон лежит только угол, поэтому круг берётся по всему обводу (`OUTLINE_CENTRE`, размер —
 *     из описи), а обе линии целиком кладёт сама сцена места;
 *   • зоны в сцену места кладёт окно (`mergeZonesIntoPlace`): ленты — поставка Astral, в файле игры их нет; сцена остаётся той же, что у чужих кадров, а зоны в
 *     ней — как в сцене местности: у каждой материал с её id и своя часть, сдвиг от точки зоны — `зона.position − начало сцены`;
 *   • какой размер листа просить у материала (`placeSheetSizes`): листов у места тысячи, и все в 1024 не влезут в видеокарту. Чем больше поверхность листа в
 *     метрах, тем он крупнее — вблизи стена и дорога читаются, столбик и урна с такого расстояния не требуют большего;
 *   • источник сцены — ссылка `blob:` на сеанс окна, как у «Интерьеров» (`shop-scene-source.js`).
 */

import { useEffect, useMemo, useState } from "react";
import { ZONES_INVENTORY, PLACED_ZONES } from "@modovik/climb-contract/recolor/zones";
import { readWorldPlaceScene } from "../../../api.js";
import { detectLegacyGame } from "../install-queue/game-root.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";

/* Сколько земли вокруг обвода (м): не меньше этого и не меньше доли его размера. */
const AROUND = 90;
const AROUND_SHARE = 0.22;
const REACH = Object.freeze([150, 720]);
/*
 * Середины обводов в осях игры: рамка обеих половин обеих линий, измерено по моделям набора (`resources/recolor/zones/*.ydr`; проверяет
 * `tests/world-place-scene.test.js`). В описи её нет: `position` зоны — точка первой половины, а не середина.
 */
export const OUTLINE_CENTRE = Object.freeze({ bizvar: [1002.2, 2300.8], vzhzone: [2780, 1517.2], porta: [1028.7, -3079.7] });

/* План зоны: сколько метров места вокруг ленты, сколько рёбер у многоугольника (`PLAN_POINTS` настольного приложения), какая самая короткая сторона оболочки идёт отдельным ребром
   и насколько далеко от оболочки может уйти угол плана. Высота над лентой: фасады первого этажа видны, а крыша и этажи над зоной её не закрывают; у большой зоны — доля размера (склон). */
export const PLAN_MARGIN = 14;
const PLAN_HEIGHT = 8;
const PLAN_HEIGHT_SHARE = 0.12;
const PLAN_EDGES = 16;
const PLAN_SHORT_SIDE = 0.5;
const PLAN_FAR_CORNER = 8;
/* Первая часть сцены места (`WORLD_PLACE_PART` настольного приложения). */
export const WORLD_PLACE_PART = "world-place";
/* Пролистанные зоны не просим: сборка идёт, когда человек остановился. */
const SETTLE_MS = 350;
/* Ссылок на сцены за сеанс окна: одна сцена — десятки мегабайт. */
const SOURCES_LIMIT = 6;
/* Лента лежит на самой земле: с высоты кадра глубины не хватает, и она мерцает. Три сантиметра вверх глазом не видны, а мерцание уходит. */
const ZONE_LIFT = 0.03;

/**
 * Подножия зон по сетке сцены зон: `Map(id зоны → { centre: [x, y], radius, part })` в осях игры. Сетки лежат от точки зоны (`zone.position`).
 */
export function zoneFootprints(asset, zones = PLACED_ZONES) {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const boxes = new Map();
  const points = new Map();
  const tops = new Map();
  for (const mesh of asset.meshes) {
    const zone = byId.get(asset.materials[mesh.material]?.id);
    if (!zone) continue;
    const box = boxes.get(zone.id) || [Infinity, Infinity, -Infinity, -Infinity];
    let high = tops.get(zone.id) ?? -Infinity;
    if (!points.has(zone.id)) points.set(zone.id, []);
    const list = points.get(zone.id);
    for (let at = 0; at + 2 < mesh.positions.length; at += 3) {
      const x = mesh.positions[at] + zone.position[0];
      const y = mesh.positions[at + 1] + zone.position[1];
      high = Math.max(high, mesh.positions[at + 2] + zone.position[2]);
      list.push([x, y]);
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
    boxes.set(zone.id, box);
    tops.set(zone.id, high);
  }
  const out = new Map();
  for (const [id, box] of boxes) out.set(id, { box, points: points.get(id), top: tops.get(id), centre: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], radius: Math.hypot(box[2] - box[0], box[3] - box[1]) / 2, part: byId.get(id).part });
  return out;
}

/* Выпуклая оболочка точек плана, против часовой стрелки (монотонная цепочка). */
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list) => {
    const chain = [];
    for (const point of list) {
      while (chain.length >= 2) {
        const a = chain[chain.length - 2];
        const b = chain[chain.length - 1];
        if ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) > 1e-6) break;
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/* Углы многоугольника из плоскостей `[nx, ny, d]` (внутри — `n·p ≤ d`), идущих против часовой стрелки: каждый угол — две соседние. */
function cornersOf(planes) {
  const corners = [];
  for (let at = 0; at < planes.length; at += 1) {
    const [ax, ay, ad] = planes[at];
    const [bx, by, bd] = planes[(at + 1) % planes.length];
    const det = ax * by - ay * bx;
    if (det <= 1e-6) return null;
    corners.push([(ad * by - bd * ay) / det, (ax * bd - bx * ad) / det]);
  }
  return corners;
}

/* Вершины идут строго против часовой стрелки и после округления до дециметра: так их примет настольное приложение (`planPoints`). */
function convexAfterRounding(points) {
  return points.every(([ax, ay], at) => {
    const [bx, by] = points[(at + 1) % points.length];
    const [cx, cy] = points[(at + 2) % points.length];
    return (bx - ax) * (cy - by) - (by - ay) * (cx - bx) > 0;
  });
}

/**
 * План вокруг точек зоны: выпуклый многоугольник на `margin` метров шире оболочки, вершины против часовой стрелки, относительно `origin`, до `PLAN_EDGES` штук. Оболочка простая —
 * её же стороны, сдвинутые наружу. Сложная (скругления, острые углы, что ушли бы далеко) — 16 направлений от самой длинной стороны: фигура всегда шире оболочки, лишнего немного.
 */
export function zonePlan(points, origin, margin = PLAN_MARGIN) {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  const sides = hull.map((point, at) => {
    const next = hull[(at + 1) % hull.length];
    const size = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const nx = (next[1] - point[1]) / (size || 1);
    const ny = -(next[0] - point[0]) / (size || 1);
    return { size, plane: [nx, ny, nx * point[0] + ny * point[1] + margin] };
  });
  const kept = sides.filter((side) => side.size >= PLAN_SHORT_SIDE).map((side) => side.plane);
  let corners = kept.length >= 3 && kept.length <= PLAN_EDGES ? cornersOf(kept) : null;
  if (corners && corners.some((corner) => Math.min(...hull.map((point) => Math.hypot(point[0] - corner[0], point[1] - corner[1]))) > PLAN_FAR_CORNER + margin)) corners = null;
  if (!corners) {
    const longest = sides.reduce((best, side) => (side.size > best.size ? side : best));
    const start = Math.atan2(longest.plane[1], longest.plane[0]);
    corners = cornersOf(
      Array.from({ length: PLAN_EDGES }, (_, at) => {
        const nx = Math.cos(start + (at * Math.PI * 2) / PLAN_EDGES);
        const ny = Math.sin(start + (at * Math.PI * 2) / PLAN_EDGES);
        return [nx, ny, Math.max(...hull.map((point) => nx * point[0] + ny * point[1])) + margin];
      }),
    );
  }
  const rounded = corners.map(([x, y]) => [Math.round((x - origin[0]) * 10) / 10, Math.round((y - origin[1]) * 10) / 10]);
  if (convexAfterRounding(rounded)) return rounded;
  /* Очень мелкая фигура: углы слиплись при округлении. Рамка — всегда годный план. */
  const xs = rounded.map((point) => point[0]);
  const ys = rounded.map((point) => point[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 0.1, Math.max(...xs) + 0.1, Math.min(...ys) - 0.1, Math.max(...ys) + 0.1].map((value) => Math.round(value * 10) / 10);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Место зоны: `{ key, origin: [x, y, z], reach, plan?, top? }`. У обвода — круг, обе линии вместе (одна часть сцены); у остальных — план вокруг самой зоны. */
export function zonePlace(zone, footprints) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const points = [];
  let high = -Infinity;
  let found = false;
  for (const item of footprints.values()) {
    if (item.part !== zone.part) continue;
    found = true;
    points.push(...item.points);
    high = Math.max(high, item.top);
    box[0] = Math.min(box[0], item.box[0]);
    box[1] = Math.min(box[1], item.box[1]);
    box[2] = Math.max(box[2], item.box[2]);
    box[3] = Math.max(box[3], item.box[3]);
  }
  if (!found) return null;
  const centre = OUTLINE_CENTRE[zone.part];
  if (!centre) {
    const origin = [Math.round((box[0] + box[2]) / 2), Math.round((box[1] + box[3]) / 2), Math.round(zone.position[2])];
    const plan = zonePlan(points, origin);
    if (plan) {
      const reach = Math.max(3, Math.ceil(Math.max(...plan.map(([x, y]) => Math.hypot(x, y)))));
      const top = Math.ceil(high - origin[2] + Math.max(PLAN_HEIGHT, Math.hypot(box[2] - box[0], box[3] - box[1]) * PLAN_HEIGHT_SHARE));
      return { key: `${origin.join(",")}|${reach}|${top}|${plan.join(";")}`, origin, reach, plan, top };
    }
  }
  /* Размер обвода — по внешней линии: у обеих линий одно место. */
  const outlineRadius = () => Math.max(...PLACED_ZONES.filter((item) => item.part === zone.part).map((item) => Math.hypot(item.size[0], item.size[1]) / 2));
  const radius = centre ? outlineRadius() : Math.hypot(box[2] - box[0], box[3] - box[1]) / 2;
  const reach = Math.round(Math.min(REACH[1], Math.max(REACH[0], radius + Math.max(AROUND, radius * AROUND_SHARE))));
  const middle = centre || [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const origin = [Math.round(middle[0]), Math.round(middle[1]), Math.round(zone.position[2])];
  return { key: `${origin.join(",")}|${reach}${centre ? `|${zone.part}` : ""}`, origin, reach, ...(centre ? { outline: zone.part, corner: box } : {}) };
}

/**
 * Где встать у зелёной или запретной зоны (ТЗ владельца 10.11.2026: «камера не в небе, а в трёх-четырёх метрах от зоны»): южная точка ленты, снаружи, на
 * уровне человека, взгляд на ленту. `foot` — подножие зоны (`zoneFootprints`), `origin` — начало сцены места, `ground` — высота земли у зоны в осях сцены.
 * Результат — `focus` рамки кадра (`model-stage/focus-frame.js`): точка на ленте, её лицо наружу, метры до глаза.
 */
export const PLAN_STAND = 4;
export const PLAN_EYE = 1.7;
/* Подъём глаза над человеком, м, если лента закрыта стеной: сперва стоя, потом на цыпочках, потом с подставки. */
export const PLAN_SPOTS = 48;
export const PLAN_EYE_LIFT = [0, 0.9, 1.8, 3];

/* Одна точка стояния: у вершины `spot` подножия, лицом наружу от середины подножия. */
function standAtSpot(spot, foot, origin, { stand, eye, ground }) {
  const dx = spot[0] - foot.centre[0];
  const dy = spot[1] - foot.centre[1];
  const length = Math.hypot(dx, dy) || 1;
  /* Лента зелёной и запретной зоны лежит на земле: взгляд — на неё сверху вниз, чтобы глаз встал на высоте человека, а лента была перед ним. */
  const look = 0.1;
  return {
    point: [spot[0] - origin[0], spot[1] - origin[1], ground + look],
    normal: [dx / length, dy / length, 0],
    pitch: Math.asin(Math.min(0.95, Math.max(0.05, (eye - look) / stand))),
    size: [8, 3],
    distance: stand,
  };
}

/**
 * Где встать у зелёной или запретной зоны. Первая точка — южная вершина ленты; `clear(focus)` (необязательная) говорит, видна ли лента
 * из глаза: стена или здание между глазом и лентой закрывают её (кадр «Стройки» упирался в блочную стену), тогда берётся следующая вершина
 * к северу. Ни одна не открыта — южная, как без проверки.
 */
export function planFocus(foot, origin, { stand = PLAN_STAND, eye = PLAN_EYE, ground = 0, clear = null } = {}) {
  if (!foot?.points?.length) return null;
  const sorted = [...foot.points].sort((a, b) => a[1] - b[1]);
  /* У большой зоны вершин тысячи (все точки сетки): проверять каждую незачем — не больше PLAN_SPOTS равномерно, южная всегда первая. */
  const spots = sorted.length > PLAN_SPOTS ? Array.from({ length: PLAN_SPOTS }, (_, at) => sorted[Math.floor((at * sorted.length) / PLAN_SPOTS)]) : sorted;
  const at = (height) => spots.map((spot) => standAtSpot(spot, foot, origin, { stand, eye: height, ground }));
  const first = at(eye);
  if (!clear) return first[0];
  /* Стройка и другие обнесены стеной выше человека: с глаза в 1,7 м ленты не видно ни с одной стороны — тогда глаз поднимается (PLAN_EYE_LIFT), стоя всё там же. */
  for (const lift of PLAN_EYE_LIFT) {
    const found = (lift === 0 ? first : at(eye + lift)).find((option) => clear(option));
    if (found) return found;
  }
  return first[0];
}

/** Глаз стоящего у `planFocus`: точка на ленте плюс `distance` метров назад и вверх по наклону взгляда (оси сцены, метры). */
export function standEye(focus) {
  const flat = Math.cos(focus.pitch) * focus.distance;
  return [focus.point[0] + focus.normal[0] * flat, focus.point[1] + focus.normal[1] * flat, focus.point[2] + Math.sin(focus.pitch) * focus.distance];
}

const meshBox = new WeakMap();
function boxOf(mesh) {
  if (mesh.bounds?.length === 6) return mesh.bounds;
  let box = meshBox.get(mesh);
  if (!box) {
    box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let at = 0; at + 2 < mesh.positions.length; at += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        box[axis] = Math.min(box[axis], mesh.positions[at + axis]);
        box[axis + 3] = Math.max(box[axis + 3], mesh.positions[at + axis]);
      }
    }
    meshBox.set(mesh, box);
  }
  return box;
}

/**
 * Перекрыт ли отрезок `from → to` сеткой сцены. Не считаются: ближние к земле треугольники (все вершины ниже `minHeight` — сама земля,
 * дороги, разметка) и последние 4 % отрезка у цели. Метод Мёллера — Трамбора по треугольникам сеток, чья рамка пересекает рамку отрезка.
 */
export function segmentBlocked(meshes, from, to, { minHeight = 0.5, upTo = 0.96 } = {}) {
  const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const low = [0, 1, 2].map((axis) => Math.min(from[axis], to[axis]) - 0.01);
  const high = [0, 1, 2].map((axis) => Math.max(from[axis], to[axis]) + 0.01);
  for (const mesh of meshes) {
    const box = boxOf(mesh);
    if (box[0] > high[0] || box[3] < low[0] || box[1] > high[1] || box[4] < low[1] || box[2] > high[2] || box[5] < low[2]) continue;
    const { positions, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 3;
      const b = indices[at + 1] * 3;
      const c = indices[at + 2] * 3;
      if (Math.max(positions[a + 2], positions[b + 2], positions[c + 2]) < minHeight) continue;
      const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
      const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
      const h = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-9) continue;
      const s = [from[0] - positions[a], from[1] - positions[a + 1], from[2] - positions[a + 2]];
      const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (t > 0 && t < upTo) return true;
    }
  }
  return false;
}

/* Сетка зоны в сцене места: копия со сдвигом, коробка — та же, сдвинутая (кадр не считает её заново). */
function shiftedMesh(mesh, shift, material, part) {
  const positions = new Float32Array(mesh.positions.length);
  for (let at = 0; at < positions.length; at += 1) positions[at] = mesh.positions[at] + shift[at % 3];
  const bounds = mesh.bounds ? mesh.bounds.map((value, at) => value + shift[at % 3]) : null;
  return { ...mesh, positions, material, part, ...(bounds ? { bounds } : {}) };
}

/**
 * Сцена места с зонами круга: новый объект, загруженная сцена не трогается. Зона берётся, если её подножие задевает круг. Ответ несёт `worldKey`: кадр по нему
 * узнаёт, что сцена в руках — та, что просили.
 */
export function mergeZonesIntoPlace(place, zonesAsset, { key, origin, reach, plan }, zones = PLACED_ZONES) {
  const footprints = zoneFootprints(zonesAsset, zones);
  const materials = [...place.materials];
  const parts = [...place.parts];
  const meshes = [...place.meshes];
  const partIndex = new Map();
  const materialIndex = new Map();
  const min = [...place.bounds.min];
  const max = [...place.bounds.max];
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const own = new Set(place.materials.map((info) => info.id));
  const planBox = plan ? [Math.min(...plan.map((point) => point[0])) + origin[0], Math.min(...plan.map((point) => point[1])) + origin[1], Math.max(...plan.map((point) => point[0])) + origin[0], Math.max(...plan.map((point) => point[1])) + origin[1]] : null;
  for (const mesh of zonesAsset.meshes) {
    const info = zonesAsset.materials[mesh.material];
    const zone = byId.get(info?.id);
    const foot = zone && footprints.get(zone.id);
    /* Обвод уже лежит в сцене места целиком (`outline`): угла из сцены зон поверх него не нужно. */
    if (own.has(info?.id)) continue;
    if (!foot || Math.hypot(foot.centre[0] - origin[0], foot.centre[1] - origin[1]) > reach + foot.radius) continue;
    /* На плане — только зоны, что на него заходят: сосед за чернотой ни к чему. */
    if (planBox && (foot.box[2] < planBox[0] || foot.box[0] > planBox[2] || foot.box[3] < planBox[1] || foot.box[1] > planBox[3])) continue;
    if (!partIndex.has(zone.part)) {
      partIndex.set(zone.part, parts.length);
      parts.push({ id: zone.part, bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } });
    }
    if (!materialIndex.has(zone.id)) {
      materialIndex.set(zone.id, materials.length);
      materials.push({ ...info, texture: null });
    }
    const shift = zone.position.map((value, axis) => value - origin[axis] + (axis === 2 ? ZONE_LIFT : 0));
    const placed = shiftedMesh(mesh, shift, materialIndex.get(zone.id), partIndex.get(zone.part));
    meshes.push(placed);
    const bounds = parts[partIndex.get(zone.part)].bounds;
    for (let at = 0; at + 2 < placed.positions.length; at += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        const value = placed.positions[at + axis];
        if (value < bounds.min[axis]) bounds.min[axis] = value;
        if (value > bounds.max[axis]) bounds.max[axis] = value;
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
  }
  return { ...place, bounds: { min, max }, parts, materials, meshes, worldKey: key };
}

export { NEAR_CAP, NEAR_FLOOR, NEAR_FULL, NEAR_MID, placeSheetSizes, planSheetSizes, sceneDistances } from "../model-stage/sheet-budget.js";

const sources = new Map();

/** Сцена места: обещание `{ url }`, `{ reason, desktop }` (сцены нет) или `{ skipped: true }` (пролистано). */
export function worldPlaceSource(place) {
  if (!sources.has(place.key)) {
    const pending = (async () => {
      const gameRoot = await detectLegacyGame().catch(() => "");
      let answer = null;
      try {
        answer = await readWorldPlaceScene({ origin: place.origin, reach: place.reach, ...(place.plan ? { plan: place.plan, top: place.top } : {}), ...(place.outline ? { outline: place.outline } : {}), gameRoot: gameRoot || undefined });
      } catch (error) {
        return { reason: String(error?.message || error || ""), desktop: true };
      }
      if (!answer) return { reason: "", desktop: false };
      if (answer.skipped) return { skipped: true };
      if (!answer.scene) return { reason: answer.reason || "", desktop: true };
      return { url: URL.createObjectURL(new Blob([answer.scene], { type: "application/octet-stream" })) };
    })().then((result) => {
      /* Без сцены — не помним: игру могли подключить, а пролистанное спросим снова, когда к нему вернутся. */
      if (!result.url && sources.get(place.key) === pending) sources.delete(place.key);
      return result;
    });
    sources.set(place.key, pending);
    /* Старые ссылки отпускаются: кадр уже разобрал свою сцену, а вернутся — Astral Desktop отдаст её из кэша. */
    while (sources.size > SOURCES_LIMIT) {
      const [oldKey, oldSource] = sources.entries().next().value;
      sources.delete(oldKey);
      oldSource.then((result) => {
        if (result.url) URL.revokeObjectURL(result.url);
      });
    }
  }
  return sources.get(place.key);
}

/* Для тестов: ссылки живут весь сеанс окна. */
export function forgetWorldPlaces() {
  sources.clear();
}

/**
 * Место зоны для кадра: `{ state: "waiting" | "building" | "ready" | "missing", place, url, reason, desktop, zones }`. `zones` — разобранная сцена зон (ей кадр
 * дополняет сцену места).
 */
export function useZoneWorldPlace(zone) {
  const url = ZONES_INVENTORY.scene.url;
  const [zones, setZones] = useState(null);
  useEffect(() => {
    let alive = true;
    loadSceneAsset(url)
      .then((asset) => alive && setZones(asset))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  const footprints = useMemo(() => (zones ? zoneFootprints(zones) : null), [zones]);
  const place = useMemo(() => (footprints ? zonePlace(zone, footprints) : null), [footprints, zone]);
  const key = place?.key || "";
  const [result, setResult] = useState({ key: "", state: "waiting" });
  useEffect(() => {
    if (!place) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      setResult((current) => (current.key === key ? current : { key, state: "building" }));
      worldPlaceSource(place).then((answer) => {
        if (!alive || answer.skipped) return;
        setResult(answer.url ? { key, state: "ready", url: answer.url } : { key, state: "missing", reason: answer.reason || "", desktop: answer.desktop !== false });
      });
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // Место меняется ключом, а не новым объектом с теми же числами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const own = result.key === key ? result : { key, state: "waiting" };
  return { ...own, place, zones };
}
